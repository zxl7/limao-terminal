import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { GeneHistory, GeneProfile } from '@/shared/api'
import { analyticsQueries, n1, pct, tone } from '@/features/analytics'
import { BarChart, BarList, Card, CardBadge, EmptyState, Icon } from '@/shared/ui'
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
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'gene' | 'zt250' | 'promo'>('gene')

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
              <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
                <Icon name="dna" size={13} className="text-up" />
                股性分 Top 15
              </div>
              <BarList items={top} format={(v) => (v == null ? '—' : n1(v))} labelWidth={72} />
              <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
                条长按<b className="text-txt">本批最高股性分</b>归一，故仅表批内相对强弱；
                绝对水平请读右侧数字。附注的「近 250 日涨停次数」来自长周期档 ——
                <b className="text-txt">股性分高但长周期平淡 = 近期偶发</b>，不宜按老牌强势股对待。
                本能卡片始终按股性分排序，与表格上方的排序按钮互不影响。
              </p>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
                <Icon name="layers" size={13} className="text-sub" />
                股性分分布
              </div>
              <BarChart bars={dist.bars} height={170} format={(v) => `${v} 只`} maxBarWidth={34} showValue />
              <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
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

      <Card
        title="🧬 股性基因"
      extra={
        <CardBadge tone="neutral">
          {filtered.length}/{rows.length} 只 · 含长周期 {withHist}
        </CardBadge>
      }
    >
      <p className="text-sub text-[11.5px] mb-2 leading-relaxed">
        股性分来自近期涨停行为，<span className="text-txt">长周期列</span>（近 250 日）来自 1500 根不复权日K ——
        两者同看：股性分高但长周期平淡 = 近期偶发，不宜按「老牌强势股」对待。
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜个股名 / 代码 / 行业…"
          className={cn(
            'flex-1 min-w-[200px] px-2.5 py-1.5 text-[12.5px] rounded-sm',
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
                'px-2.5 py-1 text-[12px] rounded-sm border cursor-pointer bg-transparent transition-colors',
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
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full border-collapse text-[12.5px]">
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
              {filtered.map(({ profile: p, hist: h }) => (
                <tr key={p.code} className="border-b border-line-faint">
                  <td className="py-1.5 px-2 whitespace-nowrap text-rec">
                    {p.name}
                    <span className="text-sub num ml-1.5">{p.code}</span>
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
            </tbody>
          </table>
        </div>
      )}
      </Card>
    </div>
  )
}
