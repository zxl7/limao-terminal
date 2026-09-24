import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { PoolStock, RotationCandidate, SectorFlowFull } from '@/shared/api'
import { DataTable, SegTabs, StatPair, Tag, n1, n2, pct } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarList, Card, CardBadge, EmptyState, Icon, Sparkline, Zone, ZoneRow } from '@/shared/ui'
import { cn, capitalText, klineText, phaseText, ztDirText } from '@/shared/lib'

/**
 * 题材轮动 —— 数据源 `cache/rotation.json`（`scripts/theme_rotation.py` 产出）。
 *
 * ## 这一页承载三块互不重叠的信息
 *
 * 1. **回流候选**（`candidates`）——「哪些炒过的题材快回来了」。
 *    核心字段是 `cooled_days`（冷却天数）与 `confidence`（置信度）。
 *    `confidence_factors` 把置信度拆成**五因子**（催化 / 大盘 / 资金 / 阶段 / K线止跌），
 *    这是**可核查的**置信度，不是拍脑袋的分数。
 * 2. **板块资金 5 日**（`flow_5d`）——「钱往哪去」。区间累计净额 + 流入天数
 *    比单日净额稳健得多（单日容易被大单扰动）。
 * 3. **规避名单**（`avoidance_sweep`）——「钱从哪走」。这是原系统少见的
 *    **负向清单**，`tier`/`stance` 给出回避强度。
 *
 * ## ⚠️ 铁律：`watch_pool` 的题材标签不可直接采信
 *
 * 原系统 2026-09-03 定的最高级铁律：按个股**真实主轴**归类，不得盲从
 * `watch_pool` 的标签（典型误判：星网锐捷 = 通信/CPO 算力，**非**数字货币）。
 * 本页因此把 `watch_pool` 与 `main_board_pool` 并列展示，并把板块归属
 * （`board`）显式列出，便于人工核对。
 */

export async function loader() {
  await queryClient.ensureQueryData(marketQueries.rotation())
  return null
}

export function Component() {
  const rot = useQuery(marketQueries.rotation())
  const d = rot.data
  const [tab, setTab] = useState<'reflow' | 'trend' | 'flow' | 'avoid'>('reflow')

  /** 候选列表：`d?.candidates ?? []` 每次渲染都会生成新数组，故显式 memo 稳定引用 */
  const candidates = useMemo(() => d?.candidates ?? [], [d])
  /** 置信度降序 —— 与原系统排序口径一致 */
  const sorted = useMemo(
    () => [...candidates].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
    [candidates],
  )

  const mc = d?.market_context
  const flows = d?.flow_5d
  const sentiment = mc?.sentiment_score

  /** 题材涨停序列的日期轴（`zt_series` 与顶层 `data_days` 严格同长） */
  const dayLabels = useMemo(() => (d?.data_days ?? []).map((x) => x.slice(5)), [d])

  /**
   * 题材涨停趋势条 —— 把 `zt_series` 从「一串数字标签」变成形状。
   *
   * 表格里的序列是 7 个并排的方块，要逐个读完再心算才能判断走势；折线一眼可辨
   * 「持续爬升 / 单根尖峰 / 逐日衰减」。取当日涨停数前 12 个题材（页面已无更细的排序口径）。
   *
   * 折线着色按 `dir`（rising 红 / falling 绿 / 走平灰）—— 方向即语义，
   * 与表格里的「方向」Tag 同源，不会出现图形与标签打架。
   */
  const trendRows = useMemo(() => {
    const list = d?.sector_zt_trends ?? []
    return [...list].sort((a, b) => b.latest - a.latest).slice(0, 12)
  }, [d])

  /** 5 日资金双向榜 —— 流入流出合成一张零线居中的榜，对冲关系一眼可见 */
  const flow5d = useMemo(() => {
    const inflow = (flows?.inflow_top ?? []).map((r) => ({
      label: r.name,
      value: r.total_yi,
      note: `${r.inflow_days}/${r.days} 日`,
    }))
    const outflow = (flows?.outflow_top ?? [])
      .slice()
      .sort((a, b) => a.total_yi - b.total_yi)
      .map((r) => ({ label: r.name, value: r.total_yi, note: `${r.inflow_days}/${r.days} 日` }))
    return [...inflow, ...outflow]
  }, [flows])

  /** 当日进出榜合并（同「资金流向」页口径） */
  const todayDuel = useMemo(() => {
    const inflow = (mc?.inflow_top ?? []).map((r) => ({ label: r.name, value: r.flow_yi }))
    const outflow = (mc?.outflow_top ?? [])
      .slice()
      .sort((a, b) => a.flow_yi - b.flow_yi)
      .map((r) => ({ label: r.name, value: r.flow_yi }))
    return [...inflow, ...outflow]
  }, [mc])

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🔄 题材轮动"
        extra={
          <CardBadge
            tone={sentiment == null ? 'neutral' : sentiment >= 6 ? 'up' : sentiment <= 2 ? 'down' : 'neutral'}
          >
            情绪 {n1(sentiment)} · 涨停 {mc?.zt_count_today ?? '—'}
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="数据日" value={d?.date ?? '—'} />
          <StatPair label="回流候选" value={candidates.length} />
          <StatPair label="晋级率" value={mc ? `${n1(mc.promote_rate)}%` : '—'} />
          <StatPair
            label="核按钮"
            value={mc?.nuke_count ?? '—'}
            tone={(mc?.nuke_count ?? 0) >= 3 ? 'down' : 'sub'}
          />
          <StatPair label="对齐天数" value={d?.data_meta?.aligned_days ?? '—'} />
          <StatPair label="窗口" value={d?.data_meta?.window ?? '—'} />
          <StatPair label="涨停源" value={d?.data_meta?.zt_source ?? '—'} />
        </div>
        {d?.note && <p className="text-sub text-[11.5px] leading-relaxed">{d.note}</p>}
        {!rot.isLoading && !d && (
          <EmptyState text="题材轮动数据未生成" hint="cache/rotation.json 缺失" />
        )}
      </Card>

      {/* 主工作区 = 轮动明细（回流候选 / 涨停趋势 / 5日资金 / 规避，四 tab 内容最重）；
          辅助区 = 当日板块资金进出榜（单日快照，次要）。
          ⛔ 旧版 3 张卡等宽纵向平铺，主次不分且 4K 下右侧大片空白。 */}
      <ZoneRow>
        <Zone label="轮动明细" dot="bg-lead" className="xl:w-[62%]">
          <Card
            title="明细"
        extra={
          <SegTabs
            items={[
              { key: 'reflow', label: `回流候选 (${sorted.length})` },
              { key: 'trend', label: `涨停趋势 (${d?.sector_zt_trends?.length ?? 0})` },
              { key: 'flow', label: '5日资金' },
              { key: 'avoid', label: `规避 (${d?.avoidance_sweep?.length ?? 0})` },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'reflow' && (
          <div className="flex flex-col gap-2">
            {sorted.length === 0 && <EmptyState text="当前无回流候选" />}
            {sorted.map((c) => (
              <ReflowRow key={c.theme} c={c} />
            ))}
            {sorted.length > 0 && (
              <p className="text-warn text-[11.5px] leading-relaxed border-l-2 border-warn pl-2.5">
                铁律：观察池的题材标签不可直接采信 —— 须按个股**真实主轴**核对（如通信 / CPO 算力票
                通常不会被题材名准确覆盖）。板块归属已并列展示供核对。
              </p>
            )}
          </div>
        )}

        {tab === 'trend' && (
          <>
            {trendRows.length > 0 && (
              <div className="mb-3">
                <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1">
                  <Icon name="trendUp" size={13} className="text-sub" />
                  涨停趋势形状（当日涨停数 Top {trendRows.length}）
                </div>
                <div className="flex flex-col gap-0.5">
                  {trendRows.map((r) => (
                    <div
                      key={r.theme}
                      className="flex items-center gap-2 text-[12px] py-0.5 border-b border-line/40 last:border-0"
                    >
                      <span className="w-[104px] shrink-0 truncate text-txt" title={r.theme}>
                        {r.theme}
                      </span>
                      <Sparkline
                        points={r.zt_series}
                        tone={r.dir === 'rising' ? 'up' : r.dir === 'falling' ? 'down' : 'sub'}
                        area
                        height={22}
                        className="flex-1"
                        /* `zt_series` 与顶层 `data_days` 严格同长（实测均为 5），故可直接对齐 */
                        labels={dayLabels}
                        format={(v) => `${n1(v)} 家`}
                      />
                      <span className="num w-[34px] shrink-0 text-right font-semibold text-txt">{r.latest}</span>
                      <span
                        className={cn(
                          'num w-[40px] shrink-0 text-right',
                          r.delta > 0 ? 'text-up' : r.delta < 0 ? 'text-down' : 'text-sub',
                        )}
                      >
                        {r.delta > 0 ? `+${r.delta}` : r.delta}
                      </span>
                      <span className="w-[38px] shrink-0 text-right text-[11px] text-sub">
                        {r.dir === 'rising' ? '升温' : r.dir === 'falling' ? '降温' : '走平'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
                  折线着色按方向（<b className="text-up">红=升温</b> / <b className="text-down">绿=降温</b> /
                  <b className="text-txt"> 灰=走平</b>），与表格「方向」列同源。
                  形状比数字更易辨：<b className="text-txt">持续爬升</b>=题材在扩散，
                  <b className="text-txt"> 单根尖峰</b>=一日游，
                  <b className="text-txt"> 逐日衰减</b>=资金撤离。
                  <b className="text-txt"> 序列中间的缺口是断线</b> —— `zt_series` 里的 null 表示该日无有效数据，
                  不补 0（补 0 会画出一个并不存在的「归零」）。
                </p>
              </div>
            )}
            <DataTable
              rows={d?.sector_zt_trends ?? []}
            rowKey={(r) => r.theme}
            empty="无趋势数据"
            columns={[
              { label: '题材', cell: (r) => <span className="text-txt">{r.theme}</span> },
              { label: '当日涨停', num: true, cell: (r) => r.latest },
              {
                label: '环比',
                num: true,
                cell: (r) => (
                  <span className={r.delta > 0 ? 'text-up' : r.delta < 0 ? 'text-down' : 'text-txt'}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </span>
                ),
              },
              {
                label: '方向',
                cell: (r) => (
                  <Tag tone={r.dir === 'rising' ? 'up' : r.dir === 'falling' ? 'down' : 'neutral'}>
                    {r.dir === 'rising' ? '升温' : r.dir === 'falling' ? '降温' : '走平'}
                  </Tag>
                ),
              },
              {
                label: '序列',
                className: 'whitespace-normal',
                cell: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.zt_series.map((v, i) => (
                      <span
                        // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                        key={i}
                        className={cn(
                          'num text-[11.5px] px-1.5 border border-line-faint rounded-sm min-w-[26px] text-center',
                          v == null ? 'text-sub' : v > 0 ? 'text-up' : 'text-txt',
                        )}
                      >
                        {v ?? '—'}
                      </span>
                    ))}
                  </span>
                ),
              },
              {
                label: '补全日数',
                num: true,
                cell: (r) => <span className="text-sub">{Object.keys(r.zt_filled ?? {}).length || '—'}</span>,
              },
            ]}
          />
          </>
        )}

        {tab === 'flow' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
                <Icon name="flow" size={13} className="text-sub" />
                5 日累计净额双向榜
              </div>
              <BarList
                items={flow5d}
                format={(v) => `${v == null ? '—' : `${v > 0 ? '+' : ''}${n2(v)}`} 亿`}
                bipolar
                labelWidth={104}
                emptyText="无 5 日资金数据"
              />
              <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
                零线居中：右侧红条为累计净流入、左侧绿条为净流出，附注是<b className="text-txt">流入天数</b>——
                金额大但天数少 = 单日脉冲，<b className="text-txt">金额与天数同时占优才是持续吸金</b>。
              </p>
            </div>
            <Flow5DTable title="5 日资金净流入 Top" rows={flows?.inflow_top ?? []} days={flows?.data_days} />
            <Flow5DTable title="5 日资金净流出 Top" rows={flows?.outflow_top ?? []} days={flows?.data_days} />
          </div>
        )}

        {tab === 'avoid' && (
          <DataTable
            rows={d?.avoidance_sweep ?? []}
            rowKey={(r) => r.name}
            rowClass={(r) => (r.stance === 'avoid' ? 'bg-down/5' : undefined)}
            empty="无规避名单（或该项未在最近一期产出）"
            columns={[
              { label: '板块', cell: (r) => <span className="text-txt">{r.name}</span> },
              {
                label: '5日累计净额',
                num: true,
                cell: (r) => (
                  <span className={r.total_5d_yi < 0 ? 'text-down' : 'text-up'}>{n2(r.total_5d_yi)} 亿</span>
                ),
              },
              {
                label: '最近一日',
                num: true,
                cell: (r) => <span className={r.last_yi < 0 ? 'text-down' : 'text-up'}>{n2(r.last_yi)} 亿</span>,
              },
              { label: '流入天数', num: true, cell: (r) => r.inflow_days },
              { label: '档位', cell: (r) => <Tag tone={r.tier === 'high' ? 'down' : 'neutral'}>{r.tier || '—'}</Tag> },
              { label: '立场', cell: (r) => <span className="text-[12px]">{r.stance || '—'}</span> },
              { label: '触发条件', cell: (r) => <span className="text-sub text-[11.5px]">{r.trigger || '—'}</span> },
              {
                label: '升级提示',
                className: 'whitespace-normal min-w-[200px]',
                cell: (r) => <span className="text-[12px]">{r.upgrade_hint || '—'}</span>,
              },
            ]}
          />
        )}
      </Card>

        </Zone>

        <Zone label="当日资金" dot="bg-up" className="xl:w-[38%]">
          <Card title="当日板块资金进出榜" extra={<CardBadge>{d?.generated_ts || '—'}</CardBadge>}>
        {todayDuel.length > 0 && (
          <div className="mb-3">
            <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
              <Icon name="compass" size={13} className="text-sub" />
              当日资金对决（零线居中）
            </div>
            <BarList
              items={todayDuel}
              format={(v) => `${v == null ? '—' : `${v > 0 ? '+' : ''}${n2(v)}`} 亿`}
              bipolar
              labelWidth={104}
            />
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <FlowSide title="净流入" rows={mc?.inflow_top ?? []} />
          <FlowSide title="净流出" rows={mc?.outflow_top ?? []} />
        </div>
      </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

/** 回流候选单行卡片 —— 字段多且分四因子，横向铺开比塞进表格更易读 */
function ReflowRow({ c }: { c: RotationCandidate }) {
  const f = c.confidence_factors
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-line rounded-sm px-2.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[13.5px] font-semibold text-txt bg-transparent border-0 cursor-pointer p-0"
        >
          {open ? '▾' : '▸'} {c.theme}
        </button>
        <Tag tone={c.catalyst_fresh ? 'up' : 'neutral'}>{c.catalyst_fresh ? '新催化' : '催化已旧'}</Tag>
        <Tag tone={c.today_hot ? 'up' : 'neutral'}>{c.today_hot ? '今日已动' : '今日未动'}</Tag>
        <StatPair label="置信度" value={n1(c.confidence)} tone={c.confidence >= 60 ? 'up' : 'sub'} />
        <StatPair label="冷却" value={`${c.cooled_days} 日`} />
        <StatPair label="爆发日" value={c.boom_day ?? '—'} />
        <StatPair label="爆发涨停" value={c.boom_zt ?? '—'} />
        <StatPair label="爆发涨幅" value={c.boom_pct != null ? pct(c.boom_pct) : '—'} />
        <StatPair
          label="5日资金"
          value={c.tx_5d_yi != null ? `${n1(c.tx_5d_yi)} 亿` : '—'}
          tone={(c.tx_5d_yi ?? 0) > 0 ? 'up' : 'down'}
        />
        <StatPair
          label="10日资金"
          value={c.tx_10d_yi != null ? `${n1(c.tx_10d_yi)} 亿` : '—'}
          tone={(c.tx_10d_yi ?? 0) > 0 ? 'up' : 'down'}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-sub">
        <span>
          因子：
          <span className={f.catalyst ? 'text-up' : 'text-sub'}>催化 {f.catalyst ? '✓' : '✗'}</span>
          {' · '}
          <span className={f.capital === 'inflow_rising' ? 'text-up' : 'text-sub'}>
            资金 {capitalText(f.capital)}
          </span>
          {' · '}
          <span className={f.phase === 'boom' ? 'text-up' : 'text-sub'}>阶段 {phaseText(f.phase)}</span>
          {' · '}
          <span className={String(f.kline ?? '').startsWith('stop_fall') ? 'text-up' : 'text-sub'}>
            K线 {klineText(f.kline)}
          </span>
          {' · '}
          <span className={f.market === false ? 'text-down' : 'text-sub'}>
            大盘 {f.market == null ? '未知' : f.market ? '配合' : '拖累'}
          </span>
        </span>
        <span>
          板块构成 主板 {c.board_mix?.main ?? '—'} / 创业 {c.board_mix?.cyb ?? '—'}
        </span>
        <span>涨停方向 {ztDirText(c.zt_dir)}</span>
        <span>有效日 {c.zt_valid_days}</span>
      </div>

      {c.trigger && (
        <div className="mt-1 text-[12px] leading-relaxed">
          <span className="text-warn">触发条件：</span>
          {c.trigger}
        </div>
      )}
      {c.catalyst && <div className="mt-0.5 text-[12px] leading-relaxed text-sub">催化：{c.catalyst}</div>}

      {open && (
        <div className="mt-2 pt-2 border-t border-line-faint grid md:grid-cols-2 gap-3">
          <PoolTable title="观察池" rows={c.watch_pool ?? []} />
          <PoolTable title="主板池" rows={c.main_board_pool ?? []} />
          {c.pool_note && (
            <p className="md:col-span-2 text-sub text-[11.5px] leading-relaxed">池备注：{c.pool_note}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** 池内个股 —— `board` 显式展示，便于核对题材标签是否与真实主轴一致 */
function PoolTable({ title, rows }: { title: string; rows: PoolStock[] }) {
  return (
    <div>
      <div className="text-[12px] text-sub mb-1">
        {title}（{rows.length}）
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.code}
        dense
        empty="空"
        columns={[
          {
            label: '个股',
            cell: (r) => (
              <span>
                {r.dragon && <span className="text-lead mr-1">龙</span>}
                <span className="text-rec">{r.name}</span>
                <span className="num text-sub ml-1">{r.code}</span>
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
          { label: '市值', num: true, cell: (r) => `${n1(r.cap_yi)}亿` },
          { label: '板块', cell: (r) => <span className="text-sub text-[11.5px]">{r.board || '—'}</span> },
          {
            label: '来源',
            cell: (r) => (r.from_zt ? <Tag tone="up">涨停池</Tag> : <span className="text-sub">—</span>),
          },
          {
            label: '风险',
            cell: (r) =>
              r.risk ? <span className="text-warn text-[11.5px]">{r.risk}</span> : <span className="text-sub">—</span>,
          },
        ]}
      />
    </div>
  )
}

function Flow5DTable({
  title,
  rows,
  days,
}: {
  title: string
  rows: Array<{ name: string; total_yi: number; days: number; inflow_days: number; last_yi: number; trend: string }>
  days?: string[]
}) {
  return (
    <div>
      <div className="text-[12px] text-sub mb-1">
        {title}
        {days?.length ? ` · 窗口 ${days[0]} ~ ${days.at(-1)}` : ''}
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.name}
        dense
        empty="无数据"
        columns={[
          { label: '板块', cell: (r) => <span className="text-txt">{r.name}</span> },
          {
            label: '区间累计净额',
            num: true,
            cell: (r) => (
              <span className={cn('font-semibold', r.total_yi > 0 ? 'text-up' : 'text-down')}>
                {r.total_yi > 0 ? '+' : ''}
                {n2(r.total_yi)} 亿
              </span>
            ),
          },
          { label: '最近一日', num: true, cell: (r) => (r.last_yi > 0 ? `+${n2(r.last_yi)}` : n2(r.last_yi)) },
          { label: '流入天数', num: true, cell: (r) => `${r.inflow_days}/${r.days}` },
          { label: '趋势', cell: (r) => <span className="text-sub text-[11.5px]">{r.trend || '—'}</span> },
        ]}
      />
    </div>
  )
}

function FlowSide({ title, rows }: { title: string; rows: SectorFlowFull[] }) {
  return (
    <div>
      <div className="text-[12px] text-sub mb-1">{title}</div>
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
                {r.is_focus && <span className="text-[11px] ml-1">关注</span>}
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
                {n2(r.flow_yi)} 亿
              </span>
            ),
          },
          { label: '超大单', num: true, cell: (r) => <span className="text-sub">{n2(r.super_large_yi)}</span> },
          { label: '大单', num: true, cell: (r) => <span className="text-sub">{n2(r.large_yi)}</span> },
          { label: '小单', num: true, cell: (r) => <span className="text-sub">{n2(r.small_yi)}</span> },
        ]}
      />
    </div>
  )
}
