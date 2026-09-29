import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { BoardCoreFile, BoardCoreStock } from '@/shared/api'
import { analyticsQueries } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarChart, Card, CardBadge, EmptyState, Icon, Radar, Zone, ZoneRow, type RadarAxis } from '@/shared/ui'
import { cn, isNum } from '@/shared/lib'

/**
 * 板块核心票 —— 数据源 `cache/board_core/*.json`（`scripts/board_core.py` 产出）。
 *
 * ## 这张表的用法（原系统定的口径）
 *
 * **板块异动先查 core 票动不动 —— 不动而只有杂毛涨 = 假启动。**
 *
 * 这条用法决定了页面的信息结构：第一列必须是「板块」，第二列必须是「核心票」，
 * 两者紧邻才能一眼完成「这个板块动了 → 它的核心票动没动」的判断。
 * core_score 排在其后作为量化补充，而不是让用户先看分数再看票。
 *
 * ## 四维权重（脚本内常量）
 *
 * 时效 0.25 ｜ 封板硬度 0.20 ｜ 连板领先 0.25 ｜ 带动+参与 0.30
 * 页面上按「带动 / 领先 / 封板 / 强度 / 参与率」并列展示，便于看出分数由哪一维撑起。
 *
 * ## 为什么加雷达图与分布柱：表格答不出的两个问题
 *
 *   1. **核心度是怎么来的** → 雷达图。表格里四个分数是四个数字，要心算比较；
 *      雷达把它变成形状 —— 「正方形」= 四维均衡，「缺一角」= 明显短板。
 *      并叠加**全部核心票均值**作背景多边形，立刻看出这只票强在哪一维、弱在哪一维。
 *   2. **今天强核心票多不多** → 分布柱。表格按分数排序只给了排名，给不了总量；
 *      而「核心度 ≥60 的票有 20 只还是 2 只」正是判断情绪强弱的直接输入。
 *
 * ⚠️ 四维分数是脚本自算的 **0~100** 分（实测全域落在 [0,100]，见下方雷达轴的满分量纲），
 *    故雷达轴统一以 100 为满分。个股缺该维数据时 `null` —— 顶点**落圆心并在图例标「—」**，
 *    不借均值填补：落圆心是「这一维没测到」，插值会伪造出「较弱」的假象。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.boardCore())
  await queryClient.ensureQueryData(marketQueries.latest())
  return null
}

/** 板块 + 其核心票（top[] 已按 core_score 降序，取 [0] 即核心票） */
interface BoardRow extends BoardCoreFile {
  top1: BoardCoreStock
}

/** 四维定义 —— 顺序**固定**，与脚本权重口径一致：带动+参与 0.30 / 领先 0.25 / 时效 0.25 / 封板 0.20 */
const DIMS: ReadonlyArray<{ label: string; hint: string; get: (s: BoardCoreStock) => number | null | undefined }> = [
  { label: '带动', hint: '带动+参与（权重 0.30）', get: (s) => s.drive_score },
  { label: '领先', hint: '连板领先（权重 0.25）', get: (s) => s.lead_score },
  { label: '封板', hint: '封板硬度（权重 0.20）', get: (s) => s.seal_score },
  { label: '强度', hint: '时效强度（权重 0.25）', get: (s) => s.strength_score },
]

/** 四维满分量纲 —— 脚本口径为百分制，实测全域 ≤100 */
const DIM_MAX = 100

/** 核心度分桶（10 分一桶，0~100 共 10 桶） */
const BUCKETS = Array.from({ length: 10 }, (_, i) => ({
  lo: i * 10,
  hi: (i + 1) * 10,
  label: i === 9 ? '90-100' : `${i * 10}-${(i + 1) * 10}`,
}))

export function Component() {
  const { data, isLoading, isError } = useQuery(analyticsQueries.boardCore())
  const latest = useQuery(marketQueries.latest())
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const boards = useMemo<BoardRow[]>(() => {
    return (data ?? [])
      .map((d) => d.data)
      .filter((x): x is BoardCoreFile => !!x && !!x.top?.length)
      .map((b) => ({ ...b, top1: b.top[0] }))
      .filter((b) => b.top1)
      .sort((a, b) => b.top1.core_score - a.top1.core_score)
  }, [data])

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return boards
    // 板块名与成分股名都能搜 —— 实战中常常是「看到某只票异动，反查它所属板块的核心度」
    return boards.filter(
      (b) =>
        b.board.toLowerCase().includes(k) ||
        b.top?.some((s) => s.name.toLowerCase().includes(k) || s.code.includes(k)),
    )
  }, [boards, q])

  /** 全部核心票池 —— 雷达均值背景与分布统计的同一分母 */
  const pool = useMemo(() => boards.flatMap((b) => b.top), [boards])

  /**
   * 雷达：当前展开行（缺省 = 核心度最高的板块）的四维形状 vs 全池均值。
   *
   * 复用表格的展开状态而非另加选择器 —— 点表格某一行，上方雷达随之切换，
   * 避免同一屏出现两个「当前板块」概念互相打架。
   */
  const radar = useMemo(() => {
    const sel = boards.find((b) => b.board === open) ?? boards[0]
    if (!sel || !pool.length) return null

    const meanOf = (get: (s: BoardCoreStock) => number | null | undefined): number | null => {
      const vs = pool.map(get).filter(isNum)
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null
    }

    const axes: RadarAxis[] = DIMS.map((d) => ({
      label: d.label,
      value: d.get(sel.top1) ?? null,
      max: DIM_MAX,
      hint: d.hint,
    }))

    return {
      board: sel.board,
      stock: sel.top1,
      axes,
      compare: DIMS.map((d) => meanOf(d.get)),
      poolSize: pool.length,
      // 缺失维数：>0 时需在图上明示「形状塌陷来自缺数据，不是弱」
      missing: axes.filter((a) => !isNum(a.value)).length,
    }
  }, [boards, open, pool])

  /**
   * 核心度分布 —— 回答「今天强核心票多不多」。
   *
   * 色档按分桶区间给定（≥60 红档 / 40~60 蓝档 / <40 灰档），**不按柱高着色**：
   * 柱高是数量，颜色是分数档位，两个通道各表一件事。
   */
  const dist = useMemo(() => {
    const bars = BUCKETS.map((b) => {
      const n = pool.filter((s) => {
        const v = s.core_score
        return isNum(v) && v >= b.lo && (b.hi === 100 ? v <= 100 : v < b.hi)
      }).length
      return {
        label: b.label,
        value: n,
        tone: b.lo >= 60 ? ('up' as const) : b.lo >= 40 ? ('mid' as const) : ('sub' as const),
      }
    })
    const strong = pool.filter((s) => isNum(s.core_score) && s.core_score >= 60).length
    return { bars, strong, total: pool.length }
  }, [pool])

  const ts = boards[0]?.ts
  const totalStocks = boards.reduce((n, b) => n + (b.top?.length ?? 0), 0)
  const maxCore = Math.max(1, ...boards.map((b) => b.top1.core_score))
  const liveLeaders = useMemo(() => {
    const coreCodes = new Set(boards.flatMap((board) => board.top.map((stock) => stock.code)))
    return (latest.data?.top5 ?? [])
      .map((theme) => ({ theme: theme.name, leader: theme.leader }))
      .filter((item) => item.leader && coreCodes.has(item.leader.code.split('.')[0]))
  }, [boards, latest.data?.top5])

  return (
    <div className="flex flex-col gap-3">
      <Card title="⚡ 今日核心核验" extra={<CardBadge tone={liveLeaders.length ? 'up' : 'neutral'}>{latest.data?.ts?.slice(11, 19) ?? '等待行情快照'}</CardBadge>}>
        {liveLeaders.length ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
            {liveLeaders.map(({ theme, leader }) => <span key={theme}><b className="text-rec">{leader?.name}</b><span className="text-sub"> · {theme}</span></span>)}
          </div>
        ) : (
          <p className="text-[11px] text-sub">当前主线题材尚未与历史核心池交集；这表示没有盘中验证，不代表核心票走弱。</p>
        )}
      </Card>
      {/* ── 视图层：形状（怎么算出来的）+ 分布（今天强票多不多）── */}
      {/* 维度说明（窄·读法解释） + 板块核心票（宽表·多列，给最大横向空间）。
          ⛔ 旧版两张卡等宽纵向平铺：雷达/维度卡右侧大片空白，核心票表又挤在半屏。 */}
      <ZoneRow>
        <Zone label="维度说明" dot="bg-mid" className="xl:w-[36%]">
          <Card
            title="🧭 核心度结构"
        extra={
          <CardBadge tone={dist.strong > 0 ? 'up' : 'neutral'}>
            核心度 ≥60 的票 {dist.strong}/{dist.total}
          </CardBadge>
        }
      >
        {radar ? (
          <div className="grid md:grid-cols-[280px_1fr] gap-4 items-start">
            <div>
              <div className="text-[12px] font-semibold mb-1 flex flex-wrap items-baseline gap-x-2">
                <span className="flex items-center gap-1">
                  <Icon name="target" size={13} className="text-up" />
                  {radar.board}
                </span>
                <span className="text-rec">{radar.stock.name}</span>
                <span className="num text-sub text-[11px]">{radar.stock.code}</span>
              </div>
              <Radar axes={radar.axes} compare={radar.compare} size={230} tone="up" compareTone="sub" />
              <p className="text-sub text-[11px] mt-1 leading-relaxed">
                红色多边形 = 该票四维；灰色 = <b className="text-txt">全部 {radar.poolSize} 只核心票均值</b>。
                {radar.missing > 0 && (
                  <>
                    <br />
                    ⚠️ 该票有 <b className="text-warn">{radar.missing}</b> 个维度无数据（顶点落到圆心、图例标「—」）——
                    <b className="text-txt">形状塌陷来自缺数据，不是该维得分为 0</b>。
                  </>
                )}
              </p>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1 flex flex-wrap items-baseline gap-x-2">
                <span className="flex items-center gap-1">
                  <Icon name="layers" size={13} className="text-sub" />
                  核心度分布
                </span>
                <span className="text-sub text-[11px]">
                  横轴 = core_score 分档 · 纵轴 = 核心票只数 · 输入 = 表格行的展开状态
                </span>
              </div>
              <BarChart bars={dist.bars} height={180} format={(v) => `${v} 只`} maxBarWidth={30} showValue />
              <p className="text-sub text-[11px] mt-2 leading-relaxed">
                柱高是<b className="text-txt">数量</b>、颜色是<b className="text-txt">分数档位</b>，两个通道各表一件事：
                <b className="text-up"> 红档 ≥60</b> / <b className="text-mid">蓝档 40~60</b> /
                <b className="text-txt"> 灰档 &lt;40</b>。
                分布重心右移 = 强势核心票变多，是情绪转强的直接证据；重心左移则相反。
              </p>
            </div>
          </div>
        ) : (
          <EmptyState text="暂无核心票数据" hint="cache/board_core/ 尚未生成" />
        )}
      </Card>

        </Zone>

        <Zone label="板块核心票" dot="bg-lead" className="xl:w-[64%]">
          <Card
            title="🏆 板块核心票"
        extra={
          <span className="flex items-center gap-2">
            {ts && <span className="text-sub text-[11px] num">{ts.slice(0, 10)}</span>}
            <CardBadge tone="neutral">
              {filtered.length}/{boards.length} 板块 · {totalStocks} 票
            </CardBadge>
          </span>
        }
      >
        <p className="text-sub text-[11.5px] mb-2 leading-relaxed">
          用法：板块异动先看核心票动没动 —— <span className="text-warn">核心票不动而只有跟风涨 = 假启动</span>。
          四维加权（带动参与 0.30 / 领先 0.25 / 时效 0.25 / 封板硬度 0.20）。
          <span className="text-txt"> 点任意一行可展开近 N 日明细，上方雷达同步切换。</span>
        </p>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜板块名或个股名 / 代码…"
          className={cn(
            'w-full mb-2 px-2.5 py-1.5 text-[12.5px] rounded-sm',
            'bg-transparent border border-line text-txt placeholder:text-sub',
            'focus:outline-none focus:border-line-strong',
          )}
        />

        {isLoading && <EmptyState text="加载板块核心度…" />}
        {isError && <EmptyState text="板块核心数据不可用" hint="检查 cache/board_core/ 是否已由 board_core.py 生成" />}

        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState text="无匹配板块" hint={boards.length ? '换个关键词试试' : '原系统尚未生成板块核心数据'} />
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-sub">
                  <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">板块</th>
                  <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">核心票</th>
                  <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">核心度</th>
                  <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">带动</th>
                  <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">领先</th>
                  <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">封板</th>
                  <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">强度</th>
                  <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">参与率</th>
                  <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">均封单</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const t = b.top1
                  const isOpen = open === b.board
                  return [
                    <tr
                      key={b.board}
                      onClick={() => setOpen(isOpen ? null : b.board)}
                      className={cn(
                        'border-b border-line-faint cursor-pointer hover:bg-line-faint',
                        isOpen && 'bg-line-faint',
                      )}
                    >
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        <span className="text-sub mr-1">{isOpen ? '▾' : '▸'}</span>
                        {b.board}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap text-rec">
                        {t.name}
                        <span className="text-sub num ml-1.5">{t.code}</span>
                      </td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap">
                        {/* 行内细条：本表内部相对比较（与自身列的 max 归一），不跨表不可跨日 */}
                        <span className="inline-flex items-center gap-1.5 justify-end">
                          <span
                            className="hidden md:inline-block h-[3px] w-[52px] rounded-sm overflow-hidden align-middle"
                            style={{ background: 'var(--color-line-faint)' }}
                          >
                            <span
                              className="block h-full rounded-sm"
                              style={{
                                width: `${(t.core_score / maxCore) * 100}%`,
                                background:
                                  t.core_score >= 60 ? 'var(--color-up)' : 'var(--color-line-strong)',
                              }}
                            />
                          </span>
                          <span
                            className={cn(
                              'num font-semibold',
                              // 红色仅点睛：只标最高档，避免整列飘红
                              t.core_score >= 60 ? 'text-up' : 'text-txt',
                            )}
                          >
                            {fmt(t.core_score)}
                          </span>
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right num">{fmt(t.drive_score)}</td>
                      <td className="py-1.5 px-2 text-right num">{fmt(t.lead_score)}</td>
                      <td className="py-1.5 px-2 text-right num">{fmt(t.seal_score)}</td>
                      <td className="py-1.5 px-2 text-right num">{fmt(t.strength_score)}</td>
                      <td className="py-1.5 px-2 text-right num">
                        {fmt(t.join_days)}/{fmt(t.total_days)}
                      </td>
                      <td className="py-1.5 px-2 text-right num">{t.fund_avg_yi ? `${t.fund_avg_yi}亿` : '—'}</td>
                    </tr>,
                    isOpen ? (
                      <tr key={`${b.board}-detail`} className="border-b border-line bg-line-faint">
                        <td colSpan={9} className="px-2 py-2">
                          <div className="text-sub text-[11.5px] mb-1.5">
                            近 {b.days} 日核心票明细（{b.top.length} 只）
                          </div>
                          <table className="w-full border-collapse text-[11.5px]">
                            <thead>
                              <tr className="text-sub border-b border-line">
                                <th className="text-left font-normal py-1 px-1.5">#</th>
                                <th className="text-left font-normal py-1 px-1.5">个股</th>
                                <th className="text-right font-normal py-1 px-1.5">核心度</th>
                                <th className="text-right font-normal py-1 px-1.5">带动</th>
                                <th className="text-right font-normal py-1 px-1.5">领先</th>
                                <th className="text-right font-normal py-1 px-1.5">封板</th>
                                <th className="text-right font-normal py-1 px-1.5">参与/总</th>
                                <th className="text-right font-normal py-1 px-1.5">均序位</th>
                                <th className="text-right font-normal py-1 px-1.5">炸板均</th>
                                <th className="text-right font-normal py-1 px-1.5">均封单</th>
                              </tr>
                            </thead>
                            <tbody>
                              {b.top.map((s, i) => (
                                <tr key={s.code} className="border-b border-line-faint last:border-0">
                                  <td className="py-1 px-1.5 text-sub num">{i + 1}</td>
                                  <td className="py-1 px-1.5 whitespace-nowrap">
                                    {s.name}
                                    <span className="text-sub num ml-1.5">{s.code}</span>
                                  </td>
                                  <td className="py-1 px-1.5 text-right num">{fmt(s.core_score)}</td>
                                  <td className="py-1 px-1.5 text-right num">{fmt(s.drive_score)}</td>
                                  <td className="py-1 px-1.5 text-right num">{fmt(s.lead_score)}</td>
                                  <td className="py-1 px-1.5 text-right num">{fmt(s.seal_score)}</td>
                                  <td className="py-1 px-1.5 text-right num">
                                    {s.join_days}/{s.total_days}
                                  </td>
                                  <td className="py-1 px-1.5 text-right num">{fmt(s.avg_order)}</td>
                                  <td className="py-1 px-1.5 text-right num">{fmt(s.broken_avg)}</td>
                                  <td className="py-1 px-1.5 text-right num">
                                    {s.fund_avg_yi ? `${s.fund_avg_yi}亿` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null,
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

/** 统一数值渲染：null / undefined 显示「—」，保留 1 位小数但去掉多余的 .0 */
function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
