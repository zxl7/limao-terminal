import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SeriesTableRow } from '@/shared/api'
import { StatPair, Tag, n1 } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { Card, CardBadge, EmptyState, HeatMatrix, Icon, LineChart, Zone, ZoneRow, type HeatRow } from '@/shared/ui'
import { cn } from '@/shared/lib'

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
  const d = series.data
  const [onlyRising, setOnlyRising] = useState(false)

  const dates = useMemo(() => d?.dates ?? [], [d])
  const rows = useMemo(() => {
    const list = d?.table_rows ?? []
    return onlyRising ? list.filter((r) => r.delta > 0) : list
  }, [d?.table_rows, onlyRising])

  const lastDetail = d?.daily_details?.at(-1)

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
    return { rows: heatRows, cols: dates.map((x) => x.slice(5)), cellMax }
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
      labels: dates.map((x) => x.slice(5)),
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
              <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
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
              <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
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
            <p className="text-sub text-[11px] leading-relaxed">
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
          <p className="text-sub text-[11.5px] mt-2 leading-relaxed">
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
              <StatPair label="炸板" value={lastDetail.broken ?? '—'} tone="warn" />
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setOnlyRising((v) => !v)}
            className={cn(
              'px-2.5 py-1 text-[12px] rounded-sm border cursor-pointer bg-transparent transition-colors',
              onlyRising ? 'border-line-strong text-txt font-semibold' : 'border-line text-sub hover:text-txt',
            )}
          >
            仅看升温题材
          </button>
          <span className="text-sub text-[11.5px]">
            「·」= 该日无记录（非 0）· 悬停单元格可看当日龙头
          </span>
        </div>

        {!series.isLoading && !d && (
          <EmptyState text="题材序列未生成" hint="cache/theme_series.json 缺失" />
        )}

        {!!rows.length && (
          <div className="overflow-x-auto max-h-[68vh] overflow-y-auto">
            <table className="border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-line text-sub">
                  <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap sticky left-0 bg-card">
                    题材
                  </th>
                  {dates.map((dt) => (
                    <th key={dt} className="font-normal py-1.5 px-2 text-right whitespace-nowrap num">
                      {dt.slice(5)}
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
    </div>
  )
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
            <span className="text-rec">{row.leader_today.name}</span>
            <span className="num text-sub ml-1.5">{row.leader_today.code}</span>
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
