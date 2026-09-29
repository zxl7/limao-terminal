import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, isLimitUp } from '@/shared/lib'
import { Card, EmptyState, StockLink } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'
import { mergeCoreStocks } from '../model/filters'

export function LeadersCard() {
  const { data } = useQuery(marketQueries.latest())
  const rows = mergeCoreStocks(data?.leaders ?? [], data?.early ?? [])
  const groups = [
    { label: '未封板强势', stocks: rows.filter((s) => s.unsealed) },
    { label: '核心辨识度', stocks: rows.filter((s) => !s.unsealed) },
  ]

  return (
    <Card title="核心标的" extra={<span className="num text-[11px] font-normal text-sub">{rows.length} 只</span>}>
      {rows.length > 0 ? (
        <div className="max-h-[300px] overflow-auto">
          {groups.filter((g) => g.stocks.length > 0).map((g) => (
            <section key={g.label} aria-label={g.label} className="mb-2 last:mb-0">
              <div className="flex items-baseline gap-2 py-1 text-[11px] text-sub">
                <span>{g.label}</span><span className="num">{g.stocks.length} 只</span>
              </div>
              {g.stocks.map((s) => (
                <div key={s.code || s.name} data-stock-code={s.code} className="grid grid-cols-[minmax(150px,1fr)_minmax(100px,1fr)_64px] items-center gap-2 border-t border-line-faint py-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-w-0">
                    <StockLink code={s.code} className={cn('text-[12.5px] font-semibold', !s.unsealed && isLimitUp(s.pct, s.is_20cm, s.boards) ? 'text-up' : 'text-txt')}>{s.name}</StockLink>
                    {s.boards && <span className="badge bg-lead-soft text-lead">{s.boards}</span>}
                    {s.is_20cm && <span className="text-[10px] text-sub" title="20cm · 波动大须紧止损">20cm · 波动大</span>}
                  </div>
                  <span className="truncate text-[11px] text-sub" title={[...s.themes, ...s.catalysts].join(' · ')}>{s.themes.join(' / ') || '—'}</span>
                  <span className={cn('num text-right text-[12.5px] font-semibold', pctTone(s.pct))}>{fmtPct(s.pct)}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : <EmptyState text="暂无核心标的" />}
    </Card>
  )
}
