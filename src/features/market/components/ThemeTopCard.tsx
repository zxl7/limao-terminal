import { useQuery } from '@tanstack/react-query'
import { cn } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

const DELTA_LABEL: Record<string, string> = {
  new: '新晋',
  surging: '升温',
  ongoing: '持续',
}

export function ThemeTopCard() {
  const { data } = useQuery(marketQueries.latest())
  const rows = data?.top5 ?? []

  return (
    <Card title="题材强度" extra={<span className="text-[11px] font-normal text-sub">{rows.length} 个题材</span>}>
      {rows.length > 0 ? (
        <div className="max-h-[300px] overflow-auto">
          <table className="w-full text-[11.5px] whitespace-nowrap" aria-label="题材强度">
            <thead className="sticky top-0 bg-card text-sub text-[10.5px]">
              <tr>
                <th className="py-1 text-left font-normal">题材</th>
                <th className="px-2 text-right font-normal">涨停</th>
                <th className="px-2 text-right font-normal">前值</th>
                <th className="px-2 text-right font-normal">增减</th>
                <th className="pl-2 text-right font-normal">状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const change = t.zt_count == null || t.zt_prev == null ? null : t.zt_count - t.zt_prev
                return (
                  <tr key={t.name} className="border-t border-line-faint">
                    <th className="py-1.5 text-left font-medium text-txt">{t.name}</th>
                    <td className="num px-2 text-right text-up">{t.zt_count ?? '—'}</td>
                    <td className="num px-2 text-right text-sub">{t.zt_prev ?? '—'}</td>
                    <td className={cn('num px-2 text-right', pctTone(change))}>
                      {change == null ? '—' : `${change > 0 ? '+' : ''}${change}`}
                    </td>
                    <td className="pl-2 text-right text-sub">{DELTA_LABEL[t.delta] ?? (t.delta || '—')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState text="暂无题材强度数据" />}
    </Card>
  )
}
