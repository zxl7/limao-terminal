import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { GeneHistory, GenePoolFile, GeneProfile, GeneSummary } from '@/shared/api'
import { analyticsQueries, DataTable, n1, pct, rate, tone } from '@/features/analytics'
import { BarChart, BarList, Card, CardBadge, EmptyState, Icon, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { useMeasuredHeight, useVirtualRows } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 股性基因 —— 数据源 `cache/zt_genes/`（`scripts/zt_genes.py` 产出）。
 *
 * ## 为什么把两个文件源合并成一张表
 *
 * 原系统把股性拆成两个文件：
 *   · `gene_{code}.json` —— 近期涨停行为（炸板率/晋级成功率/首板次日溢价/股性分）
 *   · `hist_{code}.json` —— 近 250/500 日长周期统计（涨停次数/最长连板/历史晋级率）
 *
 * 分开存是**采集成本**的考虑（前者靠涨停池滚动，后者要拉 1500 根日K）。
 * 但判断股性必须两者同看：`gene_score` 高可能只是近期运气好，
 * 而 `hist` 的长周期数据才能回答「这只票历史上到底爱不爱涨停」。
 * 所以页面按 code 做左连接合并 —— 这是展示层的职责，不动数据源。
 *
 * ⚠️ 口径提示：`hist` 统计窗口统一为**近 250 交易日**（原系统 2026-09-09 定，
 *    此前按全历史的口径已判定失真）。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.geneDetail())
  await queryClient.ensureQueryData(analyticsQueries.geneHist())
  await queryClient.ensureQueryData(analyticsQueries.geneSummary())
  await queryClient.ensureQueryData(analyticsQueries.genePool())
  return null
}

/** gene + hist 合并后的完整档案 */
interface GeneRow {
  profile: GeneProfile
  hist?: GeneHistory
}

export function Component() {
  const detail = useQuery(analyticsQueries.geneDetail())
  const hist = useQuery(analyticsQueries.geneHist())
  const geneTop = useQuery(analyticsQueries.geneSummary())
  const genePoolQ = useQuery(analyticsQueries.genePool())
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'gene' | 'zt250' | 'promo'>('gene')

  /** 股性榜（近 250 交易日统计的 Top · `summary.json`） */
  const gs: GeneSummary | undefined = geneTop.data
  /** 今日涨停基因池（`pool_<日期>.json` · 最近一期） */
  const pool: GenePoolFile | null | undefined = genePoolQ.data

  const rows = useMemo<GeneRow[]>(() => {
    const hmap = new Map<string, GeneHistory>()
    for (const h of hist.data ?? []) {
      if (h.data) hmap.set(h.data.code, h.data)
    }
    const list = (detail.data ?? [])
      .map((d) => d.data)
      .filter((x): x is GeneProfile => !!x)
      .map((p) => ({ profile: p, hist: hmap.get(p.code) }))

    return list.sort((a, b) => {
      if (sort === 'zt250') {
        return (b.hist?.zt_250 ?? -1) - (a.hist?.zt_250 ?? -1)
      }
      if (sort === 'promo') {
        return (b.profile.promo_rate ?? -1) - (a.profile.promo_rate ?? -1)
      }
      return b.profile.gene_score - a.profile.gene_score
    })
  }, [detail.data, hist.data, sort])

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return rows
    return rows.filter(
      (r) =>
        r.profile.name.toLowerCase().includes(k) ||
        r.profile.code.includes(k) ||
        r.profile.industry?.includes(k),
    )
  }, [rows, q])

  /**
   * 主表虚拟滚动（205 行 × 12 列 = 2460 个单元格，全量渲染会让这页的重排开销翻几倍）。
   * 行高固定 32px（与本表 `py-1.5 + 12.5px` 实测一致）；表格内容全部 `whitespace-nowrap`，
   * 不会换行 → 满足虚拟化的前提。
   */
  const [scrollRef, viewportH] = useMeasuredHeight<HTMLDivElement>()
  const win = useVirtualRows({ count: filtered.length, rowHeight: 32, viewportHeight: viewportH })

  const withHist = rows.filter((r) => r.hist).length

  /** 股性分 Top 15 —— 始终按股性分降序，不受上方排序按钮影响（排序只作用于表格） */
  const top = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.profile.gene_score - a.profile.gene_score)
        .slice(0, 15)
        .map((r) => ({
          label: r.profile.name,
          value: r.profile.gene_score,
          sub: r.profile.industry ?? undefined,
          note:
            r.hist?.zt_250 == null ? '近250日涨停 —' : `近250日涨停 ${r.hist.zt_250} 次`,
        })),
    [rows],
  )

  /**
   * 股性分分布 —— 这批票整体「活不活」。
   *
   * 分桶按**实测值域**切（不套 0~100 十等分）：本批 85 只票的股性分落在 9.5~61.3，
   * 若按百分制切十桶，60 以上全是空桶 —— 看不出任何结构，等于白画。
   * 故用「20 / 30 / 40 / 50 / 60」五道分界，把分辨率放到数据真正聚集的区间。
   */
  const dist = useMemo(() => {
    const edges = [20, 30, 40, 50, 60]
    const buckets = [
      { label: '<20', lo: -Infinity, hi: 20 },
      ...edges.slice(0, -1).map((lo, i) => ({ label: `${lo}-${edges[i + 1]}`, lo, hi: edges[i + 1] })),
      { label: '≥60', lo: 60, hi: Infinity },
    ]
    const bars = buckets.map((b) => {
      const n = rows.filter((r) => r.profile.gene_score >= b.lo && r.profile.gene_score < b.hi).length
      // 色档 = 股性水平（≥50 高 / 30~50 中 / <30 低）；柱高 = 只数，两通道各表一件事
      return {
        label: b.label,
        value: n,
        tone: b.lo >= 50 ? ('up' as const) : b.lo >= 30 ? ('mid' as const) : ('sub' as const),
      }
    })
    const scores = rows.map((r) => r.profile.gene_score)
    return {
      bars,
      max: scores.length ? Math.max(...scores) : null,
      min: scores.length ? Math.min(...scores) : null,
    }
  }, [rows])

  return (
    <div className="flex flex-col gap-3">
      {/* ── 概览层：先看「谁最活」与「整体活不活」，再落到逐票表 ── */}
      {/* 概览窄栏（Top15 条形 + 分布柱，两图并排） + 逐票基因宽栏（多列宽表，含搜索/排序）。
          ⛔ 旧版两张卡纵向平铺，4K 下概览卡右侧大片空白。 */}
      <ZoneRow>
        <Zone label="股性概览" dot="bg-up" className="xl:w-[44%]">
          <Card
            title="🧬 股性概览"
        extra={
          <CardBadge tone={dist.max != null && dist.max >= 50 ? 'up' : 'neutral'}>
            {rows.length} 只 · 股性分 {dist.min == null ? '—' : n1(dist.min)} ~ {dist.max == null ? '—' : n1(dist.max)}
          </CardBadge>
        }
      >
        {rows.length ? (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-12 font-semibold mb-1 flex items-center gap-1">
                <Icon name="dna" size={13} className="text-up" />
                股性分 Top 15
              </div>
              <BarList items={top} format={(v) => (v == null ? '—' : n1(v))} labelWidth={72} />
              <p className="text-sub text-11 mt-1.5 leading-relaxed">
                条长按<b className="text-txt">本批最高股性分</b>归一，故仅表批内相对强弱；
                绝对水平请读右侧数字。附注的「近 250 日涨停次数」来自长周期档 ——
                <b className="text-txt">股性分高但长周期平淡 = 近期偶发</b>，不宜按老牌强势股对待。
                本能卡片始终按股性分排序，与表格上方的排序按钮互不影响。
              </p>
            </div>

            <div>
              <div className="text-12 font-semibold mb-1 flex items-center gap-1">
                <Icon name="layers" size={13} className="text-sub" />
                股性分分布
              </div>
              <BarChart bars={dist.bars} height={170} format={(v) => `${v} 只`} maxBarWidth={34} showValue />
              <p className="text-sub text-11 mt-1.5 leading-relaxed">
                柱高 = 只数，颜色 = 股性档位（<b className="text-up">红 ≥50</b> /
                <b className="text-mid"> 蓝 30~50</b> / <b className="text-txt">灰 &lt;30</b>）。
                分桶边界按<b className="text-txt">本批实测值域</b>切（
                {dist.min == null ? '—' : n1(dist.min)}~{dist.max == null ? '—' : n1(dist.max)}），
                不套百分制十等分 —— 后者会把 60 以上切成一片空桶，看不出结构。
                分布重心右移 = 这批票整体股性转活。
              </p>
            </div>
          </div>
        ) : (
          <EmptyState text="暂无股性档案" hint="cache/zt_genes/gene_*.json 未生成" />
        )}
      </Card>

        </Zone>

        <Zone label="逐票基因" dot="bg-lead" className="xl:w-[56%]">
          <Card
            title="🧬 股性基因"
      extra={
        <CardBadge tone="neutral">
          {filtered.length}/{rows.length} 只 · 含长周期 {withHist}
        </CardBadge>
      }
    >
      <p className="text-sub text-12 mb-2 leading-relaxed">
        股性分来自近期涨停行为，<span className="text-txt">长周期列</span>（近 250 日）来自 1500 根不复权日K ——
        两者同看：股性分高但长周期平淡 = 近期偶发，不宜按「老牌强势股」对待。
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜个股名 / 代码 / 行业…"
          className={cn(
            'flex-1 min-w-[200px] px-2.5 py-1.5 text-13 rounded-sm',
            'bg-transparent border border-line text-txt placeholder:text-sub',
            'focus:outline-none focus:border-line-strong',
          )}
        />
        <div className="inline-flex gap-1">
          {(
            [
              ['gene', '按股性分'],
              ['zt250', '按近250日涨停数'],
              ['promo', '按晋级率'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={cn(
                'px-2.5 py-1 text-12 rounded-sm border cursor-pointer bg-transparent transition-colors',
                sort === k
                  ? 'border-line-strong text-txt font-semibold'
                  : 'border-line text-sub hover:text-txt',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {detail.isLoading && <EmptyState text="加载股性档案…" />}
      {!detail.isLoading && filtered.length === 0 && (
        <EmptyState
          text="无匹配个股"
          hint={rows.length ? '换个关键词' : 'cache/zt_genes/gene_*.json 未生成'}
        />
      )}

      {filtered.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={win.onScroll}
          className="overflow-x-auto max-h-[var(--panel-max-h)] overflow-y-auto"
        >
          <table className="w-full border-collapse text-13">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-line text-sub">
                <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">个股</th>
                <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">行业</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">股性分</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">涨停数</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">最高连板</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">炸板率</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">晋级率</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">首板次日溢价</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">高开低走占比</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">近250日涨停</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">历史晋级率</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">历史最长连板</th>
              </tr>
            </thead>
            <tbody>
              {/* 上下占位：模拟未渲染行的高度（虚拟列表） */}
              {win.padTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={12} style={{ height: win.padTop, padding: 0, border: 0 }} />
                </tr>
              )}
              {filtered.slice(win.start, win.end).map(({ profile: p, hist: h }) => (
                <tr key={p.code} style={{ height: 32 }} className="border-b border-line-faint">
                  <td className="py-1.5 px-2 whitespace-nowrap text-txt">
                    <StockLink code={p.code}>{p.name}</StockLink>
                  </td>
                  <td className="py-1.5 px-2 whitespace-nowrap text-sub">{p.industry ?? '—'}</td>
                  <td
                    className={cn(
                      'py-1.5 px-2 text-right num font-semibold',
                      // 红色仅点睛：只标真正的高股性
                      p.gene_score >= 50 ? 'text-up' : 'text-txt',
                    )}
                  >
                    {n1(p.gene_score)}
                  </td>
                  <td className="py-1.5 px-2 text-right num">{p.zt_n ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right num">{p.max_lbc ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right num">{n1(p.broken_rate)}</td>
                  <td className="py-1.5 px-2 text-right num">{n1(p.promo_rate)}</td>
                  <td className={cn('py-1.5 px-2 text-right num', tone(p.prem_close_avg))}>
                    {pct(p.prem_close_avg)}
                  </td>
                  <td className="py-1.5 px-2 text-right num">{n1(p.low_open_zt_ratio)}</td>
                  <td className="py-1.5 px-2 text-right num text-sub">{h?.zt_250 ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right num text-sub">{n1(h?.promo_rate_hist)}</td>
                  <td className="py-1.5 px-2 text-right num text-sub">{h?.max_boards_hist ?? '—'}</td>
                </tr>
              ))}
              {win.padBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={12} style={{ height: win.padBottom, padding: 0, border: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      </Card>
        </Zone>
      </ZoneRow>

      {/* ── 榜单与当日池（两种时间尺度）──
          上方是「逐票历史档案」，这一行补两类**榜单视角**：
            · 股性榜   —— 近 250 交易日统计出的**静态股性排名**（谁反复涨停、谁封得早）
            · 涨停基因池 —— **当日**这批涨停票的基因快照（板数 / N天N板 / 封单资金）
          差别在时间尺度：榜回答「这只票一贯如何」，池回答「今天这批是谁」。 */}
      <ZoneRow>
        <Zone label="股性榜 · 近 250 交易日" dot="bg-rec" className="xl:w-[46%]">
          <Card
            title="🏅 股性榜"
            extra={<CardBadge>{gs ? `${gs.date} · ${gs.count} 只` : '—'}</CardBadge>}
          >
            {!gs || gs.top.length === 0 ? (
              <EmptyState text="股性榜未落盘（scripts/zt_genes.py 未运行）" />
            ) : (
              <div className="max-h-[var(--panel-max-h)] overflow-y-auto">
                <DataTable
                  dense
                  rows={gs.top}
                  rowKey={(r) => r.code}
                  columns={[
                    {
                      label: '名称',
                      cell: (r) => (
                        <span className="text-txt">
                          <StockLink code={r.code}>{r.name}</StockLink>
                        </span>
                      ),
                    },
                    { label: '行业', cell: (r) => <span className="text-sub">{r.industry || '—'}</span> },
                    {
                      label: '股性分',
                      num: true,
                      cell: (r) => (
                        <span
                          className={cn(
                            'num font-semibold',
                            r.gene_score >= 50
                              ? 'text-up'
                              : r.gene_score >= 30
                                ? 'text-mid'
                                : 'text-sub',
                          )}
                        >
                          {n1(r.gene_score)}
                        </span>
                      ),
                    },
                    { label: '涨停', num: true, cell: (r) => <span className="num">{r.zt_n}</span> },
                    { label: '最高板', num: true, cell: (r) => <span className="num">{r.max_lbc}</span> },
                    {
                      label: '晋级率',
                      num: true,
                      cell: (r) => <span className="num text-sub">{rate(r.promo_rate)}</span>,
                    },
                    {
                      // ⚠️ 字段名叫 rate 但**不是百分比**：源码为 broken_sum / zt_n
                      //   （每次涨停的平均炸板次数），实测出现 1.67 > 1。
                      //   渲染成 % 会输出「1.7%」这种量级错误，故标「均值·次」。
                      label: '炸板均值',
                      num: true,
                      cell: (r) => <span className="num text-sub">{n1(r.broken_rate)}</span>,
                      className: 'whitespace-nowrap',
                    },
                    {
                      label: '首封',
                      num: true,
                      cell: (r) => <span className="num text-sub">{minToClock(r.seal_min)}</span>,
                    },
                  ]}
                />
              </div>
            )}
          </Card>
        </Zone>

        <Zone label="当日涨停基因池 · 最近一期" dot="bg-up" className="xl:w-[54%]">
          <Card
            title="🧬 涨停基因池"
            extra={<CardBadge>{pool ? `${pool.date} · ${pool.pool.length} 只` : '—'}</CardBadge>}
          >
            {!pool || pool.pool.length === 0 ? (
              <EmptyState text="涨停基因池未落盘（pool_<日期>.json 缺失）" />
            ) : (
              <div className="max-h-[var(--panel-max-h)] overflow-y-auto">
                <DataTable
                  dense
                  rows={pool.pool}
                  rowKey={(r) => r.code}
                  columns={[
                    {
                      label: '名称',
                      cell: (r) => (
                        <span className="text-txt">
                          <StockLink code={r.code}>{r.name}</StockLink>
                        </span>
                      ),
                    },
                    { label: '行业', cell: (r) => <span className="text-sub">{r.industry || '—'}</span> },
                    {
                      label: '板数',
                      num: true,
                      cell: (r) => (
                        <span className="num font-semibold text-up">{r.zt_boards}</span>
                      ),
                    },
                    {
                      label: 'N天N板',
                      num: true,
                      cell: (r) => (
                        <span className="num text-sub">
                          {r.zt_days}天{r.zt_times}板
                        </span>
                      ),
                      className: 'whitespace-nowrap',
                    },
                    {
                      label: '首封',
                      num: true,
                      cell: (r) => <span className="num text-sub">{minToClock(r.seal_min)}</span>,
                    },
                    {
                      label: '末封',
                      num: true,
                      cell: (r) => (
                        <span className="num text-sub">{minToClock(r.last_seal_min)}</span>
                      ),
                    },
                    {
                      label: '炸板',
                      num: true,
                      cell: (r) => <span className="num text-sub">{r.broken ?? '—'}</span>,
                    },
                    {
                      label: '封单(亿)',
                      num: true,
                      cell: (r) => <span className="num text-sub">{n1(r.seal_fund_yi)}</span>,
                      className: 'whitespace-nowrap',
                    },
                    {
                      label: '涨幅',
                      num: true,
                      cell: (r) => <span className={cn('num', tone(r.pct))}>{pct(r.pct)}</span>,
                    },
                    {
                      label: '换手',
                      num: true,
                      cell: (r) => <span className="num text-sub">{rate(r.hs)}</span>,
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
 * 首/末封时间（**自 00:00 起算的分钟数**）→ `HH:MM`。
 *
 * ⚠️ 语义取自源码而非猜测：`scripts/zt_genes.py` 中
 *    `seal_min = _hhmm_to_min(fbt)`，把 `fbt='092500'` 转成 565（=9×60+25）。
 *    所以它是**一天内的绝对时刻、越小越早**，不是「封了多久」的时长 ——
 *    当成时长会把 09:25 首封读成「封了 9 小时」。
 */
function minToClock(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const h = Math.floor(v / 60)
  const m = Math.round(v % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
