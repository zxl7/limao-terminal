import { useQuery } from '@tanstack/react-query'
import { cn } from '@/shared/lib'
import { marketQueries } from '../api/queries'
import { buildTideState } from '../lib/tide'

/** 实时 / 盘面全 tab 共享的底层情绪状态条。 */
export function TideAlgorithmStrip({ group }: { group: '实时' | '盘面' }) {
  const feedback = useQuery(marketQueries.feedback())
  const tide = buildTideState(feedback.data)
  const textTone = tide.tone === 'up' ? 'text-up' : tide.tone === 'down' ? 'text-down' : tide.tone === 'warn' ? 'text-warn' : 'text-sub'

  return (
    <section className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line pb-2 text-12" aria-label="情绪周期之潮汐算法">
      <span className="font-semibold text-txt">情绪周期 · 潮汐算法</span>
      <span className={cn('font-semibold', textTone)}>{tide.label}</span>
      <span className="text-sub">{tide.action}</span>
      <span className="text-sub">{group}公共环境因子</span>
      {tide.caveat && <span className="text-warn">{tide.caveat}</span>}
    </section>
  )
}
