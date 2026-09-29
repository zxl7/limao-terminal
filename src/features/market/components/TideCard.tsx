import type { TideState, TideWindowDay } from '../lib/tide'
import { cn } from '@/shared/lib'

const TONE = {
  up: 'text-up border-up/40 bg-up-soft',
  down: 'text-down border-down/40 bg-down-soft',
  warn: 'text-warn border-warn/40 bg-warn-soft',
  neutral: 'text-sub border-line bg-line-faint',
} as const
const TEXT_TONE = { up: 'text-up', down: 'text-down', warn: 'text-warn', neutral: 'text-sub' } as const

/** 实时潮位展示：候选链路环境门控的可审计读法。 */
export function TideCard({ tide, window }: { tide: TideState; window: TideWindowDay[] }) {
  const phases = [
    ['ice', '冰点'],
    ['repair', '修复'],
    ['exuberance', '亢奋'],
    ['divergence', '分歧'],
  ] as const
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]" aria-label="情绪周期阶段">
        {phases.map(([phase, label], index) => (
          <span key={phase} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-sub">→</span>}
            <span className={cn('rounded-sm border px-1.5 py-0.5', tide.phase === phase ? TONE[tide.tone] : 'border-line-faint text-sub')}>
              {label}
            </span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <span className="inline-flex items-baseline gap-1">
          <span className="text-sub text-[12px]">当前阶段</span>
          <b className={cn('text-[13px] font-semibold', TEXT_TONE[tide.tone])}>{tide.label}</b>
        </span>
        <span className="inline-flex items-baseline gap-1">
          <span className="text-sub text-[12px]">环境处理</span>
          <b className="text-sub text-[13px] font-semibold">{tide.action}</b>
        </span>
      </div>

      <p className="border-l-2 border-line-strong pl-2.5 text-[12px] leading-relaxed text-sub">
        下一验证：{tide.next}
      </p>

      <TideWindowTable rows={window} />

      {tide.caveat && <p className="text-[11.5px] leading-relaxed text-sub">数据注记：{tide.caveat}</p>}
    </div>
  )
}

/** 周期样本只展示已归档交易日，避免与时间轴的当日盘中数据重复。 */
function TideWindowTable({ rows }: { rows: TideWindowDay[] }) {
  const value = (v: number | null, suffix = '') => (v == null ? '—' : `${v > 0 && suffix === '%' ? '+' : ''}${v.toFixed(v % 1 === 0 ? 0 : 1)}${suffix}`)
  return (
    <div className="overflow-x-auto border-t border-line-faint pt-2">
      <div className="text-[11px] text-sub mb-1">近 5 个已归档交易日</div>
      <table className="w-full text-[11.5px] whitespace-nowrap" aria-label="情绪周期多日样本">
        <thead className="text-sub text-[10.5px]">
          <tr>
            <th className="py-1 text-left font-normal">日期</th>
            <th className="px-2 text-right font-normal">情绪分</th>
            <th className="px-2 text-right font-normal">涨停</th>
            <th className="px-2 text-right font-normal">昨涨停溢价</th>
            <th className="px-2 text-right font-normal">晋级率</th>
            <th className="pl-2 text-right font-normal">核按钮</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date} className="border-t border-line-faint">
              <td className="num py-1.5 text-sub">{row.date.slice(5)}</td>
              <td className="num px-2 text-right">{value(row.sentiment)}</td>
              <td className="num px-2 text-right">{value(row.ztCount)}</td>
              <td className="num px-2 text-right">{value(row.premium, '%')}</td>
              <td className="num px-2 text-right">{value(row.promoteRate, '%')}</td>
              <td className="num pl-2 text-right">{value(row.nukeCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-[12px] text-sub">暂无可用的多日周期样本</p>}
    </div>
  )
}
