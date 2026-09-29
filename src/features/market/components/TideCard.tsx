import type { TideState } from '../lib/tide'
import { cn } from '@/shared/lib'

const TONE = {
  up: 'text-up border-up/40 bg-up-soft',
  down: 'text-down border-down/40 bg-down-soft',
  warn: 'text-warn border-warn/40 bg-warn-soft',
  neutral: 'text-sub border-line bg-line-faint',
} as const
const TEXT_TONE = { up: 'text-up', down: 'text-down', warn: 'text-warn', neutral: 'text-sub' } as const

/** 实时潮位展示：候选链路环境门控的可审计读法。 */
export function TideCard({ tide, conflict }: { tide: TideState; conflict: string | null }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <span className="inline-flex items-baseline gap-1">
          <span className="text-sub text-[12px]">实时潮位</span>
          <b className={cn('text-[13px] font-semibold', TEXT_TONE[tide.tone])}>{tide.label}</b>
        </span>
        <span className="inline-flex items-baseline gap-1">
          <span className="text-sub text-[12px]">环境处理</span>
          <b className="text-sub text-[13px] font-semibold">{tide.action}</b>
        </span>
      </div>

      {tide.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tide.evidence.map((item) => <span key={item} className={cn('rounded-sm border px-1.5 py-0.5 text-[11px]', TONE[tide.tone])}>{item}</span>)}
        </div>
      )}

      {conflict && (
        <p className="border-l-2 border-warn pl-2.5 text-[12px] leading-relaxed text-warn">
          日频 / 盘中冲突：{conflict}
        </p>
      )}
      {tide.caveat && <p className="text-[11.5px] leading-relaxed text-sub">数据注记：{tide.caveat}</p>}
    </div>
  )
}
