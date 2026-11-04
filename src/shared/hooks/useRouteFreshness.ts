import { useEffect, useState, useSyncExternalStore } from 'react'
import { freshnessByRoute, getFreshnessVersion, subscribeFreshness, ROUTES, type RouteFreshness } from '@/shared/api'

/** 被动订阅已有请求，不新增取数；龄期随墙钟增长，避免停留页面后永久显示新鲜。 */
export function useRouteFreshnesses(routes: readonly string[]): (RouteFreshness | undefined)[] {
  useSyncExternalStore(subscribeFreshness, getFreshnessVersion, () => 0)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return routes.map((route) => {
    const f = freshnessByRoute.get(route)
    if (!f || f.error || f.ageSec == null) return f
    const ageSec = f.ageSec + Math.max(0, (now - f.at) / 1000)
    const def = ROUTES[route as keyof typeof ROUTES]
    const threshold = def?.cadence === 'intraday' ? 1800 : def?.cadence === 'daily' ? 172800 : null
    return { ...f, ageSec, stale: f.stale === true || (f.stale === false && threshold != null && ageSec > threshold) ? true : f.stale }
  })
}

export function useRouteFreshness(route: string): RouteFreshness | undefined {
  return useRouteFreshnesses([route])[0]
}
