import { Card, AgeBadge } from '@/shared/ui'
import { useRouteFreshnesses } from '@/shared/hooks'

const WATCH = [
  { route: '/api/market/latest', label: '盘中脉冲·主快照' },
  { route: '/api/market/feedback', label: '涨停反馈矩阵' },
  { route: '/api/market/candidates', label: '盘中候选' },
  { route: '/api/market/signals', label: '短线精灵' },
  { route: '/api/theme/rotation', label: '题材轮动' },
  { route: '/api/flow/live', label: '板块资金' },
  { route: '/api/data/exit-peaks', label: '日内离场峰值' },
  { route: '/api/intraday/timeline', label: '盘中时间轴' },
] as const
const ROUTES = WATCH.map((w) => w.route)

/** 仅复用实际页面请求的健康头，不轮询八条业务大响应。 */
export function DataFreshnessPanel() {
  const states = useRouteFreshnesses(ROUTES)
  const stale = states.filter((s) => s?.stale === true).length
  const failed = states.filter((s) => s?.error).length
  const retired = states.filter((s) => s?.retired === true).length
  const unknown = states.filter((s) => !s || (!s.error && s.retired !== true && (s.stale == null || s.ageSec == null || s.retired == null))).length
  const summary = [stale && `${stale} 路陈旧`, failed && `${failed} 路失败`, retired && `${retired} 路停更`, unknown && `${unknown} 路未知`].filter(Boolean).join(' · ') || '已观测数据未超阈值'
  return (
    <Card title="数据健康告警">
      <details>
        <summary className={`text-11 cursor-pointer ${stale || failed ? 'text-warn' : 'text-sub'}`} aria-label={`数据健康：${summary}`}>{summary}（展开详情）</summary>
        <p className="text-11 text-sub my-2">仅反映已访问接口的数据健康；未访问或缺少元信息显示未知。不能据此判断板块普跌或市场无机会。</p>
        <ul>
          {WATCH.map((w, i) => <li key={w.route} className="flex items-center justify-between gap-2 py-1 border-b border-line-faint last:border-0">
            <span className="text-11 text-txt">{w.label}</span><AgeBadge freshness={states[i]} />
          </li>)}
        </ul>
      </details>
    </Card>
  )
}
