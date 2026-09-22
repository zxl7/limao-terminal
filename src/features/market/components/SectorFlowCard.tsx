import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, fmtYi } from '@/shared/lib'
import { BarList, Card, type BarListItem } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/** 板块资金与弱势板块均来自主快照，不额外请求或重算后台强弱口径。 */
export function SectorFlowCard() {
  const { data } = useQuery(marketQueries.latest())
  const risk = data?.sector_risk

  // 分别取上游两侧榜单，避免合并降序截断后流出板块全部消失。
  const flowGroups = [
    { label: '主力流入', tone: 'text-up', rows: risk?.inflow_top ?? [] },
    { label: '主力流出', tone: 'text-down', rows: risk?.outflow_top ?? [] },
  ].map((group) => ({
    ...group,
    items: group.rows.filter((s) => s.flow_yi != null).slice(0, 5).map((s): BarListItem => ({
      label: s.name,
      value: s.flow_yi ?? null,
      sub: s.pct != null ? fmtPct(s.pct, 1) : undefined,
    })),
  }))
  // 两侧共用金额尺度，条长才能直接比较流入与流出的量级。
  const flowMax = Math.max(0, ...flowGroups.flatMap((group) => group.items.map((item) => Math.abs(item.value ?? 0))))
  const declining = [...(risk?.declining ?? [])]
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 10)

  return (
    <Card title="💰 板块资金与弱势板块" extra={<span className="text-[10.5px] font-normal text-sub">主力净额 · 亿元</span>}>
      <div className="space-y-2.5">
        {flowGroups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <div className="mb-1.5 flex items-center justify-between text-[10.5px]">
              <span className={cn('font-medium', group.tone)}>{group.label}</span>
              <span className="text-sub">前 {group.items.length} 项</span>
            </div>
            <BarList
              items={group.items}
              format={fmtYi}
              max={flowMax}
              bipolar
              barHeight={16}
              labelWidth={112}
              emptyText={`暂无${group.label}数据`}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 pt-2 border-t border-line">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-txt">弱势板块 · 跌幅榜</span>
          <span className="text-[10.5px] text-sub">
            阈值 {risk?.threshold != null ? `${risk.threshold}%` : '—'}
            {risk?.count != null && ` · ${risk.count} 个`}
          </span>
        </div>
        {declining.length > 0 ? (
          <div className="grid grid-cols-1 gap-1 min-[480px]:grid-cols-2">
            {declining.map((s) => (
              <div key={s.name} className={cn(
                'flex min-w-0 items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[11px]',
                s.is_focus ? 'bg-warn-soft' : 'bg-line-faint',
              )}>
                <span className="min-w-0 truncate text-txt" title={s.name}>{s.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <b className={cn('num', pctTone(s.pct))}>{fmtPct(s.pct, 1)}</b>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-sm bg-line-faint px-2 py-2 text-[11px] text-sub">
            {risk?.ok ? '当前快照暂无达到阈值的弱势板块' : '弱势板块数据暂不可用'}
          </p>
        )}
      </div>
    </Card>
  )
}
