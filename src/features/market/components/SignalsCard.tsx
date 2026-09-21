import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/**
 * 短线精灵 —— 对应原 watch.html 的 `renderWatch` / `buildSpirit` 逻辑。
 * 数据源：`/api/market/signals`（short_spirit_signals.json）
 */
export function SignalsCard() {
  const { data } = useQuery(marketQueries.signals())
  const rows = data?.signals ?? []
  const sessionText = data?.session === 'morning' ? '早盘' : '午后'

  return (
    <Card
      title="⚡ 短线精灵"
      extra={
        data && (
          <span className="text-[11px] font-normal text-sub">
            {data.after_filter}/{data.pool_total} · {sessionText}
          </span>
        )
      }
    >
      {rows.length > 0 ? (
        /* 上限 300px + 内部滚动：信号条数随盘面变化（实测盘中 6 条起），
           不封顶会把等权网格的整行拉高、把页面顶出首屏（与 LeadersCard 同口径）。 */
        <div className="flex flex-col gap-2 max-h-[300px] overflow-auto">
          {rows.map((s) => (
            <div
              key={s.code ?? s.name}
              className="pb-[7px] border-b border-line last:border-b-0 last:pb-0"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-[13px] font-semibold">{s.name}</span>
                <span className="text-[11px] text-sub">{s.code}</span>
                <span className={cn('num text-[13px] font-semibold ml-auto', pctTone(s.pct))}>
                  {fmtPct(s.pct)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-[3px]">
                {[s.type, ...(s.tags ?? [])].filter(Boolean).map((t) => (
                  <span key={t} className="badge bg-line text-sub">
                    {t}
                  </span>
                ))}
                <span className="text-[11px] text-sub">{s.reason}</span>
              </div>

              <div className="num text-[11px] text-sub mt-0.5">
                共振 {s.resonance} ｜ 强度 {(s.strength ?? 0).toFixed(2)} ｜ 资金 {s.flow_yi} 亿 ｜ 市值{' '}
                {s.market_cap_yi} 亿
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="暂无短线信号" />
      )}
    </Card>
  )
}
