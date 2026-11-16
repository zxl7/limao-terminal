import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api'
import type { DragonGeneFile } from '@/shared/api'
import { Card, CardBadge, EmptyState, StockLink } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 龙头基因沉淀池 —— 数据源 `cache/dragon_gene.json`（`scripts/dragon_gene.py` 盘后落一份）。
 *
 * ## 这一页回答的问题
 *
 * 「什么样的连板票，配叫龙头？」—— 不是板数高就算，而是**退潮时的姿态**：
 * 真正有龙头属性的票，断板后是**温和撤退**；一断板就 A 杀（两日跌超 10%）的，
 * 说明拉升靠的是情绪和资金硬顶，没有承接。
 *
 * 所以本页把「入池 → 断板 → 两日表现」做成一条可统计的样本链：
 * 入池 42 只里，保留 30、淘汰 8 —— 这个比例本身就是「龙头基因」的存活率。
 *
 * ## 口径（与后端 `scripts/dragon_gene.py` 同源，⛔ 前端不重算）
 *
 *   · 入选：连续涨停 ≥4 板（首次达到那天记为 `entry_day`）
 *   · 强票：最高板 ≥5（有望突破板块、成为市场情绪龙头）
 *   · 断板：最后一个涨停日的下一个交易日
 *   · 两日跌幅：以**最后一个涨停日收盘**为基准，断板后第 2 个交易日收盘累计
 *   · A 杀：两日跌幅 ≤ −10% → `eliminated`
 *   · 不足两日 / 停牌缺 K 线 → `pending`（⛔ 不判死、不补 0）
 *
 * ⚠️ 数据截至 `data_as_of`（最后一个**完整**归档日）。盘中归档没有逐票名单，
 * 后端会跳过而不是当成「当天没涨停」——否则会把还在连板的票凭空判成断板。
 */

interface PoolRow {
  code: string
  name: string
  sector?: string
  status: 'tracking' | 'pending' | 'retained' | 'eliminated'
  entry_day: string | null
  entry_boards: number | null
  max_boards: number
  strong: boolean
  break_day: string | null
  d1_pct: number | null
  d2_pct: number | null
  post_2d_pct: number | null
  a_kill: boolean | null
  current_boards?: number
  generation?: number
}


const STATUS: Record<PoolRow['status'], { label: string; cls: string }> = {
  tracking: { label: '在途', cls: 'text-rec border-rec/40 bg-rec-soft' },
  pending: { label: '待判', cls: 'text-sub border-line' },
  retained: { label: '保留', cls: 'text-up border-up/40 bg-up-soft' },
  eliminated: { label: '淘汰', cls: 'text-down border-down/40 bg-down-soft' },
}

/** 排序：在途 → 待判 → 保留 → 淘汰；同状态内新入池优先 */
const ORDER: Record<PoolRow['status'], number> = { tracking: 0, pending: 1, retained: 2, eliminated: 3 }

function pct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

export function Component() {
  const q = useQuery<DragonGeneFile>({
    queryKey: ['dragon-gene'],
    queryFn: () => api.dragonGene(),
    staleTime: 60_000,
  })
  const data = q.data
  const rows = useMemo(
    () => [...(data?.pool ?? [])].sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        String(b.entry_day ?? '').localeCompare(String(a.entry_day ?? '')),
    ),
    [data],
  )

  if (q.isLoading) return <div className="text-sub text-12 py-6">加载中…</div>
  if (q.isError) return <EmptyState text="龙头基因池读取失败" hint="检查 /api/dragon/gene" />
  if (!data || !rows.length) {
    return <EmptyState text="还没有入池样本" hint="需要至少一个 ≥4 板的完整交易日归档" />
  }

  const s = data.summary
  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🐲 龙头基因沉淀池"
        extra={
          <div className="flex items-center gap-2">
            <CardBadge tone="up">入池 {s.entered}</CardBadge>
            <CardBadge tone="warn">强票 {s.strong}</CardBadge>
          </div>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-12">
          <span><span className="text-sub">在途 </span><b className="num text-rec">{s.tracking}</b></span>
          <span><span className="text-sub">待判 </span><b className="num">{s.pending}</b></span>
          <span><span className="text-sub">保留 </span><b className="num text-up">{s.retained}</b></span>
          <span><span className="text-sub">淘汰 </span><b className="num text-down">{s.eliminated}</b></span>
          <span className="text-line">|</span>
          <span><span className="text-sub">保留率 </span><b className="num">{s.retain_rate ?? '—'}%</b></span>
          <span><span className="text-sub">A杀率 </span><b className="num text-down">{s.a_kill_rate ?? '—'}%</b></span>
          <span className="ml-auto text-sub num">数据截至 {data.data_as_of ?? '—'}</span>
        </div>
        <p className="text-sub text-11 leading-relaxed mt-2">
          入选 <b className="text-txt">连续涨停 ≥{data.rules.entry_boards} 板</b>；最高板
          ≥{data.rules.strong_boards} 板标为<b className="text-txt">强票</b>（有望突破板块、成为情绪龙头）。
          断板后<b className="text-txt">两个交易日</b>内累计跌幅超过<b className="text-txt">一个跌停板</b>
          （10cm −10% / 20cm −20% / ST −5% / 北交所 −30%）判
          <b className="text-down">A 杀</b> → 淘汰；未满两日或停牌缺 K 线记<b className="text-txt">待判</b>，
          ⛔ 不猜、不补 0。淘汰后再次走出 4 板 → <b className="text-txt">允许复活</b>（新一代，历史保留）。
        </p>
      </Card>

      <Card title="池内样本" extra={<CardBadge>{rows.length} 只</CardBadge>}>
        <div className="overflow-x-auto">
          <table className="w-full text-12">
            <thead>
              <tr className="text-sub border-b border-line">
                <th className="text-left font-normal py-1.5 pr-3">股票</th>
                <th className="text-left font-normal py-1.5 pr-3">状态</th>
                <th className="text-right font-normal py-1.5 pr-3">入池（板）</th>
                <th className="text-right font-normal py-1.5 pr-3">最高板</th>
                <th className="text-left font-normal py-1.5 pr-3">断板日</th>
                <th className="text-right font-normal py-1.5 pr-3">断板后两日</th>
                <th className="text-center font-normal py-1.5">A 杀</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status]
                return (
                  <tr key={`${r.code}-${r.entry_day}-${r.generation ?? 1}`} className="border-b border-line/50">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <StockLink code={r.code} className="text-txt">{r.name}</StockLink>
                      {r.strong && <span className="ml-1.5 text-11 text-warn">强</span>}
                      <span className="ml-1.5 text-11 text-sub num">{r.code}</span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={cn('inline-block text-11 px-1 rounded-sm border whitespace-nowrap', st.cls)}>
                        {st.label}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right num whitespace-nowrap">
                      {r.entry_day?.slice(5) ?? '—'}
                      <span className="text-sub"> · {r.entry_boards ?? '—'}板</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right num">{r.max_boards}</td>
                    <td className="py-1.5 pr-3 num whitespace-nowrap text-sub">{r.break_day?.slice(5) ?? '—'}</td>
                    <td
                      title={r.a_kill_threshold != null ? `门槛 ${r.a_kill_threshold}%（${r.limit_pct}cm 一个跌停板）` : undefined}
                      className={cn('py-1.5 pr-3 text-right num whitespace-nowrap',
                        r.a_kill === true ? 'text-down' : r.a_kill === false ? 'text-up' : 'text-sub')}>
                      {pct(r.post_2d_pct)}
                      {r.limit_pct != null && r.limit_pct !== 10 && (
                        <span className="text-11 text-sub"> /{r.a_kill_threshold}%</span>
                      )}
                      {r.status === 'pending' && r.d1_pct != null && (
                        <span className="text-11 text-sub"> (D1 {pct(r.d1_pct)})</span>
                      )}
                    </td>
                    <td className="py-1.5 text-center">
                      {r.a_kill === true ? <span className="text-down">是</span>
                        : r.a_kill === false ? <span className="text-up">否</span>
                        : <span className="text-sub">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
