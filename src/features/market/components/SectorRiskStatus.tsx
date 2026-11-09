import type { SectorRiskSourceState } from '@/shared/api'

/** 仅展示对应子路的原始数据时间，不用页面刷新时间替代。 */
export function SectorRiskStatus({ label, state }: { label: string; state?: SectorRiskSourceState | null }) {
  const date = state?.asof ? new Date(state.asof) : null
  let updated = '未更新'
  if (date && !Number.isNaN(date.getTime())) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
    updated = `${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`
  }
  return <p className="m-0 mb-2 text-11 text-sub">{label}更新：{updated}</p>
}
