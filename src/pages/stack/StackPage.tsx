import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SeriesTableRow } from '@/shared/api'
import { analyticsQueries, DataTable, StatPair, Tag, n1 } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { Card, CardBadge, EmptyState, HeatMatrix, Icon, LineChart, StockLink, Zone, ZoneRow, type HeatRow } from '@/shared/ui'
import { cn, staleLabel } from '@/shared/lib'

/**
 * 数据堆叠 —— 数据源 `cache/theme_series.json`（题材 × N 日涨停数矩阵）。
 *
 * ## 为什么这是一张「堆叠」表而不是「排名」表
 *
 * 排名表只给当日的横截面；而**叠加多日**之后，同一列纵向扫下来就能看出
 * 两种完全不同的形态：
 *   · 高开低走型：早几日高、最近归零 → 题材已结束
 *   · 逐日抬升型：整体呈上升阶梯 → 题材正在扩散
 * 这两种形态在单日排名里长得一模一样，只有横向铺开才分辨得出来。
 *
 * ## 单元格的两组信息
 *
 * 每个格子里是 **涨停家数**，鼠标悬停显示**当日该题材的龙头**——
 * 家数回答「有多少」，龙头回答「谁在带」。两者缺一不可：
 * 家数多但龙头天天换 = 缺乏核心；家数少但龙头稳定 = 尚未扩散的强核心。
 *
 * ## ⚠️ `null` 与 `0` 的差别
 *
 * `null` = 该日无数据（题材尚未被统计或归档缺失），`0` = 该日确实零涨停。
 * 本页用「·」表示 null、「0」表示 0，**不合并** —— 合并会让「题材刚开始
 * 有记录」和「题材已熄火」看起来一样。
 */

export function Component() {
  const series = useQuery(marketQueries.series())
  const weekly = useQuery(analyticsQueries.weeklyZtMap())
  const d = series.data
  const [onlyRising, setOnlyRising] = useState(false)

  const dates = useMemo(() => d?.dates ?? [], [d])
  const rows = useMemo(() => {
    const list = d?.table_rows ?? []
    return onlyRising ? list.filter((r) => r.delta > 0) : list
  }, [d?.table_rows, onlyRising])

  const lastDetail = d?.daily_details?.at(-1)

  /**
   * 周涨停地图（`cache/weekly_zt_map.json`）—— **个股 × 本周交易日**的涨停轨迹。
   *
   * 与上方「题材 × 日」矩阵的分工：那个看**题材**有没有升温，
   * 这个看**个股**有没有持续性（同一只票连着几天封板 = 真实强度）；
   * 一天封完就熄火的是脉冲，不是强度。
   *
   * ⚠️ 编码诚实性：原始数据只给 `dates`（哪几天涨停）与 `max_boards`（**本周**最高板），
   *    **没有逐日板数**。故格子只表达「当日是否涨停」（1/0 二元），
   *    绝不拿周最高板去填每一天 —— 那会把「周三首板、周五 3 板」
   *    渲染成「三天都是 3 板」。周最高板只放行尾注。
   */
  const wk = weekly.data
  const wkView = useMemo(() => {
    const days = Object.keys(wk?.day_totals ?? {}).sort()
    const all = Object.entries(wk?.map ?? {}).map(([code, e]) => ({ code, e }))
    const sorted = all.sort(
      (a, b) => b.e.dates.length - a.e.dates.length || b.e.max_boards - a.e.max_boards,
    )
    const wkRows: HeatRow[] = sorted.slice(0, 40).map(({ code, e }) => ({
      label: e.name,
      sub: code,
      values: days.map((day) => (e.dates.includes(day) ? 1 : 0)),
      note: `${e.dates.length} 天 · 最高 ${e.max_boards} 板`,
    }))
    /** 持续性最强的一批（涨停日 ≥3）—— 一天涨停只是脉冲，三天以上才算强度 */
    const persistent = sorted.filter((x) => x.e.dates.length >= 3)
    return { days, rows: wkRows, persistent, total: all.length }
  }, [wk])

  /**
   * 热力矩阵 —— 把「题材 × 日」的涨停家数从数字矩阵变成色块矩阵。
   *
   * ## 与下方明细表的分工（不是替代关系）
   *
   * 矩阵负责**看形态**：横向一整条红 = 持续有量，左红右白 = 已熄火，
   * 右红左白 = 正在扩散。表格负责**读精确值与查龙头**（悬停单元格看当日龙头）。
   * 矩阵丢掉了龙头信息，所以表格必须保留 —— 两者互补，不重复。
   *
   * ## 行选取与颜色量纲
   *
   * 行 = 窗口内涨停家数累计前 18 个题材（含 0 与 null 都不加分，故不会把
   * 「只有一天爆发」的题材排在「持续有量」之前）。**不受「仅看升温」开关影响** ——
   * 开关只过滤下方表格，矩阵保持稳定参照系，否则一按开关颜色量纲就变，无法对比。
   *
   * 颜色量纲 = 窗口内单日最大涨停家数（最大值格满色）。
   * `null` 不参与量纲计算，并以斜纹灰格呈现（「无记录」≠「零涨停」）。
   */
  const heat = useMemo(() => {
    const list = d?.table_rows ?? []
    if (!list.length || !dates.length) return null

    const picked = [...list]
      .map((r) => ({ r, sum: r.values.reduce<number>((a, v) => a + (v ?? 0), 0) }))
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 18)

    const heatRows: HeatRow[] = picked.map(({ r }) => ({
      label: r.theme,
      values: r.values,
      note: r.delta_str || (r.delta > 0 ? `+${r.delta}` : String(r.delta)),
    }))

    const cellMax = Math.max(0, ...heatRows.flatMap((r) => r.values.map((v) => (v == null ? 0 : v))))
    return { rows: heatRows, cols: dates.map(dayLabel), cellMax }
  }, [d, dates])

  /**
   * 窗口脉搏 —— 涨停家数与最高板**分两张小图**（Y 轴各自独立、X 轴严格对齐）。
   *
   * 两者量纲差一个数量级（家数 20~90，最高板 2~9），共轴会把最高板压成贴底直线，
   * 「高度是升是降」这一最关键的信息当场消失。同一时间轴上的小倍数叠加，
   * 才能既对齐日期又保住各自的分辨率。
   */
  const pulse = useMemo(() => {
    if (!dates.length) return null
    return {
      labels: dates.map(dayLabel),
      totals: d?.daily_totals ?? [],
      maxBoards: d?.max_boards ?? [],
    }
  }, [d, dates])

  return (
    <div className="flex flex-col gap-3">
      {/* 窗口热力宽栏（双图 + 色块矩阵，横轴列多需宽度） + 数据堆叠窄栏（逐题材表格）。
          ⛔ 旧版两卡纵向平铺，4K 下各自右侧大片空白。 */}
      <ZoneRow>
        <Zone label="窗口热力" dot="bg-lead" className="xl:w-[58%]">
      {/* ── 形态层：整个窗口的脉搏 + 色块矩阵（看形状，不比精确值）── */}
      {heat && pulse && (
        <Card
          title="🧊 窗口热力矩阵（题材 × 日 涨停家数）"
          extra={
            <CardBadge tone="warn">
              X 轴对齐 · 色深 = 家数占窗口最大值 {heat.cellMax} 的比例
            </CardBadge>
          }
        >
          <div className="flex flex-col gap-2 mb-3">
            <div>
              <div className="text-12 font-semibold mb-1 flex items-center gap-1">
                <Icon name="pulse" size={13} className="text-up" />
                窗口内每日涨停家数
              </div>
              <LineChart
                labels={pulse.labels}
                series={[{ name: '涨停家数', values: pulse.totals, tone: 'up', area: true }]}
                height={125}
                showLegend={false}
                zeroBased
                format={(v) => `${n1(v)} 家`}
              />
            </div>
            <div>
              <div className="text-12 font-semibold mb-1 flex items-center gap-1">
                <Icon name="stairs" size={13} className="text-lead" />
                窗口内最高连板（独立 Y 轴）
              </div>
              <LineChart
                labels={pulse.labels}
                series={[{ name: '最高板', values: pulse.maxBoards, tone: 'lead' }]}
                height={100}
                showLegend={false}
                zeroBased
                format={(v) => `${n1(v)} 板`}
              />
            </div>
            <p className="text-sub text-11 leading-relaxed">
              两张小图<b className="text-txt">共用同一时间轴、各自独立 Y 轴</b> ——
              家数在 20~90 量级、最高板在 2~9 量级，共轴会把最高板压成贴底直线，
              「高度是升是降」当场消失。此处的对齐是为了让「家数上升 + 高度上升 = 情绪全面转强」
              这类组合判读成为可能。
            </p>
          </div>

          <HeatMatrix
            rows={heat.rows}
            cols={heat.cols}
            format={(v) => (v == null ? '·' : String(v))}
            legend
            cellW={46}
            cellH={22}
            labelWidth={96}
          />
          <p className="text-sub text-12 mt-2 leading-relaxed">
            行 = 窗口内涨停家数累计前 <b className="text-txt">{heat.rows.length}</b> 个题材，
            <b className="text-txt">不受「仅看升温题材」开关影响</b>（开关只过滤下方表格）——
            否则一按开关颜色量纲就变，跨次截图无法对比。
            <br />
            横向读形态：<b className="text-txt">整行连续深红</b>=持续有量；
            <b className="text-txt"> 左红右白</b>=已熄火；<b className="text-txt">右红左白</b>=正在扩散。
            <b className="text-txt"> 斜纹灰格 = 该日无记录</b>（`null`），
            与「当日零涨停」在视觉上严格区分 —— 前者是数据缺失，后者是真实归零。
          </p>
        </Card>
      )}
        </Zone>

        <Zone label="数据堆叠" dot="bg-up" className="xl:w-[42%]">
          <Card
            title="🧱 数据堆叠（题材 × N 日涨停）"
        extra={<CardBadge tone={lastDetail && lastDetail.sentiment >= 6 ? 'up' : 'neutral'}>
          {lastDetail ? `最新日情绪 ${n1(lastDetail.sentiment)}` : '—'}
        </CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="窗口天数" value={dates.length} />
          <StatPair label="题材数" value={d?.table_rows?.length ?? '—'} />
          <StatPair label="窗口" value={dates.length ? `${dates[0]} ~ ${dates.at(-1)}` : '—'} />
          <StatPair label="最新日涨停" value={d?.daily_totals?.at(-1) ?? '—'} tone="up" />
          <StatPair label="最新日最高板" value={d?.max_boards?.at(-1) ?? '—'} />
          {lastDetail && (
            <>
              <StatPair label="20cm 家数" value={lastDetail.count_20cm ?? '—'} />
              <StatPair label="2板以上" value={lastDetail.boards_2plus ?? '—'} />
              <StatPair label="封板率" value={lastDetail.seal_rate != null ? `${n1(lastDetail.seal_rate)}%` : '—'} />
              <StatPair label="炸板" value={lastDetail.broken ?? '—'} tone="down" />
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setOnlyRising((v) => !v)}
            className={cn(
              'px-2.5 py-1 text-12 rounded-sm border cursor-pointer bg-transparent transition-colors',
              onlyRising ? 'border-line-strong text-txt font-semibold' : 'border-line text-sub hover:text-txt',
            )}
          >
            仅看升温题材
          </button>
          <span className="text-sub text-12">
            「·」= 该日无记录（非 0）· 悬停单元格可看当日龙头
          </span>
        </div>

        {!series.isLoading && !d && (
          <EmptyState text="题材序列未生成" hint="cache/theme_series.json 缺失" />
        )}

        {!!rows.length && (
          <div className="overflow-x-auto max-h-[var(--panel-max-h)] overflow-y-auto">
            <table className="border-collapse text-13">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-line text-sub">
                  <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap sticky left-0 bg-card">
                    题材
                  </th>
                  {dates.map((dt) => (
                    <th key={dt} className="font-normal py-1.5 px-2 text-right whitespace-nowrap num">
                      {dayLabel(dt)}
                    </th>
                  ))}
                  <th className="font-normal py-1.5 px-2 text-right whitespace-nowrap">环比</th>
                  <th className="font-normal py-1.5 px-2 text-left whitespace-nowrap">趋势</th>
                  <th className="font-normal py-1.5 px-2 text-left whitespace-nowrap">今日龙头</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <MatrixRow key={r.theme} row={r} leaders={d?.theme_leaders?.[r.theme]} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
        </Zone>
      </ZoneRow>

      {/* ── 个股视角：一周之内谁在「持续」涨停 ──
          上方整页是「题材 × 日」维度（哪条线在升温）；这一行换成
          「个股 × 日」维度，回答另一个问题：升温是**一群票轮流涨停**，
          还是**同一批票连着涨停**。后者才是真强度。 */}
      <ZoneRow>
        <Zone label="周涨停地图 · 个股 × 交易日" dot="bg-up" className="xl:w-[68%]">
          <Card
            title="🗓 周涨停地图"
            extra={
              <CardBadge>
                {wk ? (
                  <span className="flex items-center gap-1.5">
                    <span>
                      {weekRange(wkView.days)} · {wkView.days.length} 日 · {wkView.total} 只
                    </span>
                    {staleLabel(weekStart(wkView.days), 7) && (
                      <span className="badge bg-warn-soft text-warn">
                        {staleLabel(weekStart(wkView.days), 7)}
                      </span>
                    )}
                  </span>
                ) : (
                  '—'
                )}
              </CardBadge>
            }
          >
            {!wk || wkView.rows.length === 0 ? (
              <EmptyState text="周涨停地图未落盘（cache/weekly_zt_map.json 缺失）" />
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {wkView.days.map((day) => (
                    <StatPair
                      key={day}
                      label={`${day.slice(4, 6)}-${day.slice(6, 8)} 涨停`}
                      value={wk.day_totals?.[day] ?? '—'}
                      tone="up"
                    />
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <HeatMatrix
                    rows={wkView.rows}
                    cols={wkView.days.map((x) => `${x.slice(4, 6)}-${x.slice(6, 8)}`)}
                    max={1}
                    format={wkCell}
                    labelWidth={150}
                    cellW={34}
                    cellH={20}
                  />
                </div>
                <div className="text-sub text-11">
                  按该周涨停天数降序取前 40 只 · 格子只表示「当日是否涨停」，
                  板数见行尾（原数据无逐日板数）
                </div>
              </div>
            )}
          </Card>
        </Zone>

        <Zone label="持续性最强 · 涨停日 ≥3" dot="bg-rec" className="xl:w-[32%]">
          <Card title="🔥 持续涨停票" extra={<CardBadge>{wkView.persistent.length} 只</CardBadge>}>
            {wkView.persistent.length === 0 ? (
              <EmptyState text="该周无涨停 ≥3 天的个股" />
            ) : (
              <div className="max-h-[var(--panel-max-h)] overflow-y-auto">
                <DataTable
                  dense
                  rows={wkView.persistent}
                  rowKey={(r) => r.code}
                  columns={[
                    {
                      label: '名称',
                      cell: (r) => (
                        <span className="text-txt">
                          <StockLink code={r.code}>{r.e.name}</StockLink>
                        </span>
                      ),
                    },
                    {
                      label: '涨停天数',
                      num: true,
                      className: 'whitespace-nowrap',
                      cell: (r) => (
                        <span className="num font-semibold text-up">{r.e.dates.length}</span>
                      ),
                    },
                    {
                      label: '最高板',
                      num: true,
                      cell: (r) => <span className="num">{r.e.max_boards}</span>,
                    },
                    {
                      label: '涨停日',
                      className: 'whitespace-nowrap',
                      cell: (r) => (
                        <span className="num text-sub">
                          {r.e.dates.map((x) => `${x.slice(4, 6)}-${x.slice(6, 8)}`).join(' ')}
                        </span>
                      ),
                    },
                    {
                      label: '原因',
                      className: 'max-w-[280px] truncate',
                      cell: (r) => (
                        <span className="text-sub text-12">{r.e.reasons?.[0] || '—'}</span>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

/**
 * 周地图格值文本 —— **必须提到模块作用域**。
 *
 * `HeatMatrix` 会把单元格 memo 化；写在 JSX 里传内联箭头函数，每次渲染都换引用，
 * 等于让 memo 白做（40 行 × 5 列 = 200 次无谓重算）。
 *
 * 二元编码：`1` = 当日涨停 → 实心点；`0` = 当日未涨停 → **留空而不是印「0」**，
 * 否则整张图 90% 是 0，图案被数字淹没。
 */
function wkCell(v: number | null | undefined): string {
  return v === 1 ? '●' : ''
}

function MatrixRow({
  row,
  leaders,
}: {
  row: SeriesTableRow
  leaders?: Array<{ name: string; code: string; boards: number; pct: number } | null>
}) {
  return (
    <tr className="border-b border-line-faint">
      <td className="py-1.5 px-2 whitespace-nowrap sticky left-0 bg-card">
        <span className="text-txt">{row.theme}</span>
      </td>
      {row.values.map((v, i) => {
        const ld = leaders?.[i]
        return (
          <td
            // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
            key={i}
            className={cn(
              'num py-1.5 px-2 text-right',
              v == null ? 'text-sub' : v > 0 ? 'text-up' : 'text-txt',
            )}
            title={ld ? `龙头 ${ld.name}（${ld.boards}板 ${n1(ld.pct)}%）` : undefined}
          >
            {v == null ? '·' : v}
          </td>
        )
      })}
      <td
        className={cn(
          'num py-1.5 px-2 text-right font-semibold',
          row.delta > 0 ? 'text-up' : row.delta < 0 ? 'text-down' : 'text-txt',
        )}
      >
        {row.delta_str || (row.delta > 0 ? `+${row.delta}` : row.delta)}
      </td>
      <td className="py-1.5 px-2">
        <Tag tone={row.trend === 'up' || row.trend === 'rising' ? 'up' : row.trend === 'down' || row.trend === 'falling' ? 'down' : 'neutral'}>
          {trendLabel(row.trend)}
        </Tag>
      </td>
      <td className="py-1.5 px-2 whitespace-nowrap">
        {row.leader_today ? (
          <span>
            <StockLink code={row.leader_today.code} className="text-txt">{row.leader_today.name}</StockLink>
            {row.leader_today.boards > 0 && <Tag tone="up">{row.leader_today.boards}板</Tag>}
          </span>
        ) : (
          <span className="text-sub">—</span>
        )}
      </td>
    </tr>
  )
}

function trendLabel(t: string): string {
  const m: Record<string, string> = {
    up: '升温',
    rising: '升温',
    down: '降温',
    falling: '降温',
    flat: '走平',
  }
  return m[t] ?? t ?? '—'
}

/**
 * 日期标签（2026-10-18 修）。
 *
 * `theme_series.dates` **混着两种粒度**：日频是 `YYYY-MM-DD`，当日盘中追加的点是 `HH:MM`。
 * 旧实现一律 `slice(5)` → 盘中点变成空字符串，表头出现一串空列、窗口显示「13:29 ~ 15:00」。
 * 这里按长度分支：≥10 位取 `MM-DD`，否则原样保留（`13:29` 是可读的时点）。
 */
function dayLabel(d: string): string {
  return d.length >= 10 ? d.slice(5, 10) : d
}

/** `20260907` 这类 8 位周内日期 → `YYYY-MM-DD`（取不到返回 null） */
function weekStart(days: string[]): string | null {
  const d = days[0]
  if (!d || d.length !== 8) return null
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

/** 周区间：`2026-09-07 ~ 09-11`；只有 1 天时只显示一天 */
function weekRange(days: string[]): string {
  if (days.length === 0) return '—'
  const first = weekStart(days)
  const last = days.at(-1) ?? ''
  const lastLabel = last.length === 8 ? `${last.slice(4, 6)}-${last.slice(6, 8)}` : last
  return first ? `${first} ~ ${lastLabel}` : lastLabel
}
