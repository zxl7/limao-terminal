import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { RotationData, SectorFlowFull } from '@/shared/api'
import { DataTable, SegTabs, StatPair, Tag, n1, n2, pct } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { analyticsQueries } from '@/features/analytics'
import {
  BarList,
  Card,
  CardBadge,
  EmptyState,
  HeatMatrix,
  Icon,
  Sparkline,
  type HeatRow,
} from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 资金流向 —— 数据源三路，口径必须分清（混用会得出错误结论）：
 *
 *   ① `cache/theme_rotation.json` → `market_context.inflow_top` / `outflow_top`
 *      **当日**板块主力资金（含超大/大/中/小单拆分）
 *   ② 同文件的 `flow_5d` → **5 日累计**净额与流入天数（多日视角，抗单日扰动）
 *   ③ `cache/sector_flow_history/sector_flow_YYYY-MM-DD.json` → **逐日原始档**
 *      每份含当日全板块（约 100+ 个）的 `flow_yi` 与可选 `tx_5d_yi` / `tx_10d_yi`
 *
 * ## 为什么必须区分「当日」与「多日」
 *
 * 单日净流入第一名常常是**大单扰动**（一只权重股就能翻转板块流向），
 * 而 5 日累计 + 流入天数才能回答「资金是不是持续在来」。本页把两者并列，
 * 且在逐日档里同时给出 `tx_5d_yi`（滚动 5 日）作为交叉验证。
 *
 * ## 三类视图各回答一个问题（缺一不可）
 *
 *   · **双向榜（BarList）** → 「谁在进、谁在出、量级差多少」
 *     流入流出合成一张零线居中的榜，对冲关系一眼可见；两张单边表看不出来。
 *   · **跨日矩阵（HeatMatrix）** → 「钱是不是天天在来」
 *     行=板块、列=交易日。整行连续红 = 持续吸金；红绿相间 = 一日游。
 *     单日榜永远看不到这一层 —— 它只能展示一天。
 *   · **轨迹条（Sparkline）** → 「这条板块的钱怎么走的」
 *     折线形状比数字更能暴露「突然放量」与「逐日衰减」。
 *
 * ## 字段缺失是常态
 *
 * 逐日档里 `tx_flow_yi` / `tx_5d_yi` / `tx_10d_yi` 是**可选**的 ——
 * 早于该口径上线日期的归档没有这三个字段。缺失渲染为「—」，不补 0。
 * 矩阵里「当日无该板块记录」同样以 `null` 下传，渲染为斜纹「无样本」格，
 * 与「净额恰为 0」在视觉上必须可区分。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.flowHistory())
  await queryClient.ensureQueryData(marketQueries.rotation())
  return null
}

/** 逐日档的单板块行（原文件为宽松 Record，此处按实测结构收窄） */
interface FlowBoardRow {
  name: string
  pct: number | null
  flow_yi: number | null
  tx_flow_yi?: number | null
  tx_5d_yi?: number | null
  tx_10d_yi?: number | null
  is_focus: boolean
}

interface FlowDayFile {
  date: string
  generated_ts: string
  boards: Record<string, Omit<FlowBoardRow, 'name'>>
}

/** 跨日窗口长度（交易日）。10 日 ≈ 两个自然周，足够看出一轮进出的起落 */
const WINDOW = 10
/** 矩阵行数 / 轨迹条数上限 —— 再多就变成「什么都看不清的密集网格」 */
const ROWS_MAX = 12

/** 资金额格式化：带正号 + 单位亿（正负号是资金流的语义核心，不能省） */
function yi(v: number): string {
  return `${v > 0 ? '+' : ''}${n1(v)}`
}

export function Component() {
  const hist = useQuery(analyticsQueries.flowHistory())
  const rot = useQuery(marketQueries.rotation())
  const [tab, setTab] = useState<'today' | '5d' | 'daily'>('today')

  const d = rot.data as RotationData | undefined

  /** 逐日档：解析成 { date, rows[] } 数组，日期倒序 */
  const days = useMemo(() => {
    return (hist.data ?? [])
      .map((f) => f.data as unknown as FlowDayFile | null)
      .filter((x): x is FlowDayFile => !!x && typeof x === 'object' && !!x.boards)
      .map((x) => ({
        date: x.date,
        generated_ts: x.generated_ts,
        rows: Object.entries(x.boards)
          .map(([name, v]) => ({ name, ...v }) as FlowBoardRow)
          .sort((a, b) => (b.flow_yi ?? -Infinity) - (a.flow_yi ?? -Infinity)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [hist.data])

  const [dayIdx, setDayIdx] = useState(0)
  const activeDay = days[Math.min(dayIdx, Math.max(0, days.length - 1))]

  /** 当日全板块合计净额 —— 判断「钱是净流入市场还是净流出」 */
  const dayNetSum = useMemo(
    () => (activeDay?.rows ?? []).reduce((s, r) => s + (r.flow_yi ?? 0), 0),
    [activeDay],
  )

  /**
   * 跨日派生视图 —— 矩阵 / 轨迹 / 全局量纲。
   *
   * 三件事一次算完（同源，共用一份按日索引）：
   *   1. `rows`    矩阵行（按窗口内**累计绝对净额**取前 12）
   *   2. `trails`  轨迹条（同口径取前 10，附窗口累计净额）
   *   3. `absMax`  全窗口最大单日绝对净额 —— 逐日双向榜的**固定量纲**
   *
   * ## 为什么选行标准是「累计绝对净额」而不是「累计净额」
   *
   * 净额会在流入流出相抵后归零：一个「天天 +80 亿再 -70 亿」的高换手板块，
   * 净额只有 +10 亿，按净额排序会被淘汰，但它恰恰是盘面最需要盯的资金主战场。
   * 绝对净额衡量的是**资金动静**，这才对应「这个板块有没有在打」。
   */
  const crossDay = useMemo(() => {
    const win = days.slice(0, WINDOW).reverse() // 时间升序：左旧右新
    if (win.length < 2) return null

    // 每日一份 name→flow 索引：避免在嵌套循环里反复 find（100+ 板块 × N 日）
    const idx = win.map((day) => new Map(day.rows.map((r) => [r.name, r.flow_yi])))
    const total = new Map<string, number>()
    const weight = new Map<string, number>()
    let absMax = 0

    for (const m of idx) {
      for (const [name, v] of m) {
        if (v == null) continue
        total.set(name, (total.get(name) ?? 0) + v)
        weight.set(name, (weight.get(name) ?? 0) + Math.abs(v))
        absMax = Math.max(absMax, Math.abs(v))
      }
    }
    if (!weight.size) return null

    const picked = [...weight.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, ROWS_MAX)
      .map(([name]) => name)

    const rows: HeatRow[] = picked.map((name) => {
      const t = total.get(name) ?? 0
      return {
        label: name,
        values: idx.map((m) => m.get(name) ?? null),
        note: yi(t),
      }
    })

    const trails = picked.slice(0, 10).map((name) => ({
      name,
      total: total.get(name) ?? 0,
      points: idx.map((m) => m.get(name) ?? null),
    }))

    return { cols: win.map((x) => x.date.slice(5)), rows, trails, absMax }
  }, [days])

  const mc = d?.market_context

  /** 当日进出榜合并成一张零线居中的双向榜 */
  const todayDuel = useMemo(() => {
    const inflow = (mc?.inflow_top ?? []).map((r) => ({ label: r.name, value: r.flow_yi }))
    const outflow = (mc?.outflow_top ?? []).map((r) => ({ label: r.name, value: r.flow_yi }))
    // 流入降序 + 流出升序 → 合成后自然形成「上红下绿」的对冲观感
    return [...inflow, ...outflow.sort((a, b) => (a.value ?? 0) - (b.value ?? 0))]
  }, [mc])

  /**
   * 逐日档当日的双向榜：仅取两端各 12 个。
   *
   * ⚠️ 归一上限用 `crossDay.absMax`（全窗口固定量纲）而非本批最大值 ——
   *    本档有日期选择器，若按各日自身最大值归一，**所有日期看起来都「一样猛」**，
   *    比较就失效了。固定量纲下「今天的条比昨天短」才是可用信息。
   */
  const dayDuel = useMemo(() => {
    const rows = activeDay?.rows ?? []
    const valid = rows.filter((r) => r.flow_yi != null)
    const head = valid.slice(0, 12)
    const tail = valid.slice(-12).filter((r) => (r.flow_yi ?? 0) < 0)
    return [...head, ...tail].map((r) => ({
      label: r.name,
      value: r.flow_yi,
      note: r.pct == null ? undefined : pct(r.pct),
    }))
  }, [activeDay])

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="💰 资金流向"
        extra={
          <CardBadge tone={dayNetSum >= 0 ? 'up' : 'down'}>
            逐日档合计 {n2(dayNetSum)} 亿
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="轮动数据日" value={d?.date ?? '—'} />
          <StatPair label="逐日档期数" value={days.length} />
          <StatPair label="最新档" value={activeDay?.date ?? '—'} />
          <StatPair label="5日窗口" value={d?.flow_5d?.data_days?.join(' ~ ') ?? '—'} />
          <StatPair label="对齐天数" value={d?.data_meta?.aligned_days ?? '—'} />
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          三路口径并列：<b className="text-txt">当日</b>主力资金（易被大单扰动）·
          <b className="text-txt">5 日累计</b>（抗扰动，看持续性）·
          <b className="text-txt">逐日原始档</b>（全板块，含滚动 5/10 日交叉验证）。
          单日冠军不等于持续主线。
        </p>
      </Card>

      <Card
        title="板块资金"
        extra={
          <SegTabs
            items={[
              { key: 'today', label: '当日进出榜' },
              { key: '5d', label: '5日累计' },
              { key: 'daily', label: `逐日原始档 (${days.length})` },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'today' && (
          <div className="flex flex-col gap-3">
            {/* 双向榜置顶：先看对冲关系，再看四档拆分明细 */}
            <div>
              <SectionHead icon="upRight" title="当日资金对决" hint="零线居中 · 右红为流入 / 左绿为流出" />
              <BarList
                items={todayDuel}
                format={(v) => `${v == null ? '—' : yi(v)} 亿`}
                bipolar
                labelWidth={104}
                emptyText="无当日资金榜"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <FlowSide title="当日净流入 Top" rows={mc?.inflow_top ?? []} />
              <FlowSide title="当日净流出 Top" rows={mc?.outflow_top ?? []} />
            </div>
          </div>
        )}

        {tab === '5d' && (
          <div className="flex flex-col gap-3">
            <div>
              <SectionHead
                icon="stairs"
                title="5 日累计净额"
                hint="附注为流入天数 —— 金额大但天数少 = 单日脉冲，非持续吸金"
              />
              <BarList
                items={[
                  ...(d?.flow_5d?.inflow_top ?? []).map((r) => ({
                    label: r.name,
                    value: r.total_yi,
                    note: `${r.inflow_days}/${r.days} 日`,
                  })),
                  ...(d?.flow_5d?.outflow_top ?? [])
                    .slice()
                    .sort((a, b) => a.total_yi - b.total_yi)
                    .map((r) => ({
                      label: r.name,
                      value: r.total_yi,
                      note: `${r.inflow_days}/${r.days} 日`,
                    })),
                ]}
                format={(v) => `${v == null ? '—' : yi(v)} 亿`}
                bipolar
                labelWidth={104}
                emptyText="无 5 日资金数据"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <Flow5D title="5 日累计净流入" rows={d?.flow_5d?.inflow_top ?? []} />
              <Flow5D title="5 日累计净流出" rows={d?.flow_5d?.outflow_top ?? []} />
            </div>
            {!d?.flow_5d?.inflow_top?.length && <EmptyState text="无 5 日资金数据" />}
          </div>
        )}

        {tab === 'daily' && (
          <>
            {days.length === 0 ? (
              <EmptyState text="无逐日档" hint="cache/sector_flow_history/ 为空" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <select
                    value={activeDay?.date ?? ''}
                    onChange={(e) => setDayIdx(days.findIndex((x) => x.date === e.target.value))}
                    className="text-[12px] px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
                  >
                    {days.map((x) => (
                      <option key={x.date} value={x.date}>
                        {x.date}
                      </option>
                    ))}
                  </select>
                  <span className="text-sub text-[11.5px]">
                    共 {activeDay?.rows.length ?? 0} 个板块 · 生成于 {activeDay?.generated_ts?.slice(11, 19) || '—'}
                  </span>
                </div>

                <div className="mb-3">
                  <SectionHead
                    icon="compass"
                    title="当日进出两端"
                    hint={
                      crossDay
                        ? `固定量纲：条长以 ${WINDOW} 日最大单日净额 ${n1(crossDay.absMax)} 亿为基准，跨日期可比`
                        : '仅本批相对比较'
                    }
                  />
                  <BarList
                    items={dayDuel}
                    format={(v) => `${v == null ? '—' : yi(v)} 亿`}
                    bipolar
                    labelWidth={104}
                    max={crossDay?.absMax}
                    emptyText="当日无资金记录"
                  />
                </div>

                <div className="max-h-[62vh] overflow-y-auto">
                  <DataTable<FlowBoardRow>
                    rows={activeDay?.rows ?? []}
                    rowKey={(r) => r.name}
                    dense
                    rowClass={(r) => (r.is_focus ? 'bg-up/5' : undefined)}
                    empty="无数据"
                    columns={[
                      {
                        label: '板块',
                        cell: (r) => (
                          <span className={r.is_focus ? 'text-up font-semibold' : 'text-txt'}>
                            {r.name}
                            {r.is_focus && <Tag tone="up">关注</Tag>}
                          </span>
                        ),
                      },
                      {
                        label: '涨幅',
                        num: true,
                        cell: (r) => (
                          <span className={cn((r.pct ?? 0) > 0 ? 'text-up' : (r.pct ?? 0) < 0 ? 'text-down' : 'text-txt')}>
                            {pct(r.pct)}
                          </span>
                        ),
                      },
                      {
                        label: '当日主力',
                        num: true,
                        cell: (r) => (
                          <span className={cn('font-semibold', (r.flow_yi ?? 0) > 0 ? 'text-up' : 'text-down')}>
                            {(r.flow_yi ?? 0) > 0 ? '+' : ''}
                            {n2(r.flow_yi)} 亿
                          </span>
                        ),
                      },
                      {
                        label: '当日同花顺',
                        num: true,
                        cell: (r) => <span className="text-sub">{n2(r.tx_flow_yi)}</span>,
                      },
                      {
                        label: '滚动5日',
                        num: true,
                        cell: (r) => (
                          <span className={cn(r.tx_5d_yi == null ? 'text-sub' : r.tx_5d_yi > 0 ? 'text-up' : 'text-down')}>
                            {n2(r.tx_5d_yi)}
                          </span>
                        ),
                      },
                      {
                        label: '滚动10日',
                        num: true,
                        cell: (r) => (
                          <span className={cn(r.tx_10d_yi == null ? 'text-sub' : r.tx_10d_yi > 0 ? 'text-up' : 'text-down')}>
                            {n2(r.tx_10d_yi)}
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
                <p className="text-sub text-[11px] mt-1.5">
                  「同花顺」「滚动 5/10 日」为可选字段 —— 早于该口径上线日期的归档没有，渲染为「—」而非 0。
                </p>
              </>
            )}
          </>
        )}
      </Card>

      {/* ── 跨日资金矩阵：单日榜看不到的「持续性」全在这一张里 ── */}
      <Card
        title="🧊 跨日资金矩阵"
        extra={
          <CardBadge tone="warn">
            行=板块 · 列=交易日 · 序 = {WINDOW} 日资金动静前 {ROWS_MAX}
          </CardBadge>
        }
      >
        {crossDay ? (
          <>
            <HeatMatrix
              rows={crossDay.rows}
              cols={crossDay.cols}
              max={crossDay.absMax}
              format={(v) => (v == null ? '—' : yi(v))}
              cellW={52}
              cellH={24}
              labelWidth={92}
              legend
            />
            <p className="text-sub text-[11.5px] mt-2 leading-relaxed">
              选行标准 = <b className="text-txt">窗口内累计绝对净额</b>（资金动静），而非累计净额 ——
              后者会在流入流出相抵后归零，把「天天大开大合」的高换手板块筛掉，而那恰恰是资金主战场。
              颜色深浅按各格绝对值占全窗口最大单日净额（<span className="num">{n1(crossDay.absMax)}</span> 亿）的比例着色：
              <b className="text-up"> 红=净流入</b> / <b className="text-down">绿=净流出</b>。
              <b className="text-txt"> 斜纹灰格 = 当日该板块无记录</b>（非 0，指数据缺失）。
            </p>
          </>
        ) : (
          <EmptyState text="跨日矩阵需要至少 2 个逐日档" hint="cache/sector_flow_history/ 归档不足" />
        )}
      </Card>

      {/* ── 板块资金轨迹：形状比数字更能暴露「突然放量」与「逐日衰减」── */}
      <Card
        title="🧵 板块资金轨迹"
        extra={<CardBadge tone={crossDay ? 'neutral' : 'warn'}>{WINDOW} 日逐日净额折线</CardBadge>}
      >
        {crossDay ? (
          <>
            <div className="flex flex-col gap-1">
              {crossDay.trails.map((t) => (
                <div
                  key={t.name}
                  className="flex items-center gap-2 text-[12px] py-0.5 border-b border-line/40 last:border-0"
                >
                  <span className="w-[92px] shrink-0 truncate text-txt" title={t.name}>
                    {t.name}
                  </span>
                  <Sparkline
                    points={t.points}
                    tone={t.total >= 0 ? 'up' : 'down'}
                    area
                    height={22}
                    className="flex-1"
                    /* 带日期轴：否则悬浮只能报「第 4 个点 = 37」，而人真正要问的是「哪一天是 37」 */
                    labels={crossDay.cols}
                    format={(v) => `${yi(v)} 亿`}
                  />
                  <span
                    className={cn(
                      'num w-[68px] shrink-0 text-right font-semibold',
                      t.total > 0 ? 'text-up' : t.total < 0 ? 'text-down' : 'text-txt',
                    )}
                    title={`${WINDOW} 日累计净额`}
                  >
                    {yi(t.total)} 亿
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sub text-[11.5px] mt-2 leading-relaxed">
              每行一条折线 = 该板块在窗口内的逐日净额轨迹。着色按<b className="text-txt">
                窗口累计净额
              </b>的正负（红=净流入 / 绿=净流出），形状则反映节奏：连续同色爬升 = 持续吸金，
              单根尖峰 = 一日游，逐步收敛向零 = 资金撤离。
              <b className="text-txt"> 缺失日断线不补零</b> —— 补零会伪造出「资金归零」的形态。
            </p>
          </>
        ) : (
          <EmptyState text="轨迹需要至少 2 个逐日档" />
        )}
      </Card>
    </div>
  )
}

/** 小节标题 —— 统一「图标 + 标题 + 口径提示」三件套，避免口径靠读者自己猜 */
function SectionHead({ icon, title, hint }: { icon: 'upRight' | 'stairs' | 'compass'; title: string; hint?: string }) {
  return (
    <div className="text-[12px] mb-1.5 flex flex-wrap items-baseline gap-x-2">
      <span className="flex items-center gap-1 font-semibold text-txt">
        <Icon name={icon} size={13} className="text-sub" />
        {title}
      </span>
      {hint && <span className="text-sub text-[11px]">{hint}</span>}
    </div>
  )
}

function FlowSide({ title, rows }: { title: string; rows: SectorFlowFull[] }) {
  const isIn = title.includes('流入')
  return (
    <div>
      <div className="text-[12px] text-sub mb-1 flex items-center gap-1">
        <Icon name={isIn ? 'upRight' : 'downRight'} size={12} className={isIn ? 'text-up' : 'text-down'} />
        {title}
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.name}
        dense
        empty="无数据"
        columns={[
          {
            label: '板块',
            cell: (r) => (
              <span className={r.is_focus ? 'text-up font-semibold' : 'text-txt'}>
                {r.name}
                {r.is_focus && <Tag tone="up">关注</Tag>}
              </span>
            ),
          },
          {
            label: '涨幅',
            num: true,
            cell: (r) => (
              <span className={r.pct > 0 ? 'text-up' : r.pct < 0 ? 'text-down' : 'text-txt'}>{pct(r.pct)}</span>
            ),
          },
          {
            label: '主力净额',
            num: true,
            cell: (r) => (
              <span className={r.flow_yi > 0 ? 'text-up' : 'text-down'}>
                {r.flow_yi > 0 ? '+' : ''}
                {n2(r.flow_yi)}
              </span>
            ),
          },
          { label: '超大单', num: true, cell: (r) => <span className="text-sub">{n2(r.super_large_yi)}</span> },
          { label: '大单', num: true, cell: (r) => <span className="text-sub">{n2(r.large_yi)}</span> },
          { label: '中单', num: true, cell: (r) => <span className="text-sub">{n2(r.mid_yi)}</span> },
          { label: '小单', num: true, cell: (r) => <span className="text-sub">{n2(r.small_yi)}</span> },
        ]}
      />
    </div>
  )
}

function Flow5D({
  title,
  rows,
}: {
  title: string
  rows: Array<{ name: string; total_yi: number; days: number; inflow_days: number; last_yi: number; trend: string }>
}) {
  const isIn = title.includes('流入')
  return (
    <div>
      <div className="text-[12px] text-sub mb-1 flex items-center gap-1">
        <Icon name={isIn ? 'upRight' : 'downRight'} size={12} className={isIn ? 'text-up' : 'text-down'} />
        {title}
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.name}
        dense
        empty="无数据"
        columns={[
          { label: '板块', cell: (r) => <span className="text-txt">{r.name}</span> },
          {
            label: '区间累计',
            num: true,
            cell: (r) => (
              <span className={cn('font-semibold', r.total_yi > 0 ? 'text-up' : 'text-down')}>
                {r.total_yi > 0 ? '+' : ''}
                {n2(r.total_yi)} 亿
              </span>
            ),
          },
          {
            label: '最近一日',
            num: true,
            cell: (r) => <span className={r.last_yi > 0 ? 'text-up' : 'text-down'}>{n2(r.last_yi)}</span>,
          },
          {
            label: '流入持续性',
            num: true,
            cell: (r) => (
              <span className={r.inflow_days / Math.max(r.days, 1) >= 0.6 ? 'text-up' : 'text-txt'}>
                {r.inflow_days}/{r.days} 日
              </span>
            ),
          },
          { label: '趋势', cell: (r) => <span className="text-sub text-[11.5px]">{r.trend || '—'}</span> },
          { label: '日均', num: true, cell: (r) => <span className="text-sub">{r.days ? n1(r.total_yi / r.days) : '—'}</span> },
        ]}
      />
    </div>
  )
}
