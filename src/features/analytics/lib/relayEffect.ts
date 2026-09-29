import type { RelayStock } from '@/shared/api'
export type RelayView = 'strong' | 'sealed' | 'weak' | 'all'
export function selectRelay(stocks: RelayStock[], group: string, view: RelayView) {
  // 始终按昨日板数分组；首板仅在用户选中对照组时进入。
  return stocks.filter(s => group === 'relay' ? s.prev_boards >= 2 : group === '4+' ? s.prev_boards >= 4 : s.prev_boards === Number(group))
    .filter(s => view === 'all' || (!s.stale && (view === 'sealed' ? s.sealed === true : s.window != null && (view === 'strong' ? s.pct != null && s.pct > 0 && s.window.pct_change > 0 : s.window.pct_change < 0))))
    .sort((a, b) => (b.window?.amount_yi ?? -1) - (a.window?.amount_yi ?? -1) || (b.window?.pct_change ?? -Infinity) - (a.window?.pct_change ?? -Infinity) || a.code.localeCompare(b.code))
}
/** 盘中按实时时间判旧；午休与盘后按最近交易时刻判旧。 */
export function relayExpired(date: string, generated: string, now: number) {
  const bj = new Date(now + 8 * 3600_000)
  const today = bj.toISOString().slice(0, 10)
  if (date !== today) return true
  const min = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  const cutoff = min >= 900 ? Date.parse(`${date}T15:00:00+08:00`) : min >= 690 && min < 780 ? Date.parse(`${date}T11:30:00+08:00`) : now
  return cutoff - Date.parse(generated) > 180_000
}
