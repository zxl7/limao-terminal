import { CardBadge } from './Card'
import type { RouteFreshness } from '@/shared/api'

/** 纯展示组件；订阅由调用方的 shared/hooks 负责。 */
export function AgeBadge({ freshness: f, className }: { freshness?: RouteFreshness; className?: string }) {
  const badge = (tone: 'warn' | 'neutral', text: string) => <span className={className}><CardBadge tone={tone}>{text}</CardBadge></span>
  if (f?.error) return badge('warn', '数据请求失败')
  if (f?.retired === true) return badge('neutral', '已停更')
  if (f?.stale === true) return badge('warn', '数据陈旧')
  if (!f || f.ageSec == null || f.stale == null || f.retired == null) {
    return badge('neutral', '新鲜度未知')
  }
  const sec = f.ageSec
  const age = sec < 60 ? '刚刚' : sec < 3600 ? `${Math.floor(sec / 60)} 分钟前`
    : sec < 86400 ? `${Math.floor(sec / 3600)} 小时前` : `${Math.floor(sec / 86400)} 天前`
  return <span className={`text-11 text-sub${className ? ` ${className}` : ''}`}>更新于 {age}</span>
}
