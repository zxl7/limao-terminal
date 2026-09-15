import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, fmtYi } from '@/shared/lib'
import { BarList, Card, type BarListItem } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/**
 * 板块资金流向 + 跌幅榜（`latest.sector_risk`）—— 盘中「钱从哪走、往哪去」。
 *
 * ## 为什么用双向条（`bipolar`）而不是两个单列榜
 *
 * 流入与流出是同一枚硬币的两面：只有把它们画在**同一条零线两侧**，
 * 「今天净流入最多的板块 44.6 亿 vs 净流出最多的 -116.4 亿」这个量级对比
 * 才一眼可见。分成两张单列榜时，两条榜各自归一，视觉上会变成「都差不多」。
 *
 * ## ⚠️ 取数口径
 *
 * `flow_yi` 只有 `inflow_top` / `outflow_top` 带（脚本已换算成亿元）；
 * `declining` 里的条目只有 `main_inflow` 原始字节数（且实测**字符串/数字两种形态
 * 都出现过**）—— 所以跌幅榜只用 `pct` 着色，不去算金额，避免踩到形态差异。
 * 缺失一律传 `null` 给 BarList：**`null` 是断点，不是 0**。
 */
export function SectorFlowCard() {
  const { data } = useQuery(marketQueries.latest())
  const risk = data?.sector_risk
  const WINDOW = 9

  const flowItems: BarListItem[] = [
    ...(risk?.inflow_top ?? []),
    ...(risk?.outflow_top ?? []),
  ]
    .map((s) => ({
      label: s.name,
      value: s.flow_yi ?? null,
      note: s.is_focus ? '关注' : undefined,
      sub: s.pct != null ? fmtPct(s.pct, 1) : undefined,
    }))
    .filter((it) => it.value != null)
    .sort((a, b) => (b.value as number) - (a.value as number))
    .slice(0, WINDOW)

  const declining = [...(risk?.declining ?? [])]
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 10)

  return (
    <Card
      title="💰 板块资金与弱势板块"
      extra={
        <span className="text-[11px] font-normal text-sub">
          弱势阈值 {risk?.threshold != null ? `${risk.threshold}%` : '—'}
          {risk?.count != null && ` · ${risk.count} 个`}
        </span>
      }
    >
      {flowItems.length > 0 ? (
        <BarList
          items={flowItems}
          format={fmtYi}
          bipolar
          barHeight={13}
          labelWidth={82}
          emptyText="板块资金未落盘"
        />
      ) : (
        <p className="text-[12px] text-sub py-1.5">板块资金数据未落盘（盘中早段常见）</p>
      )}

      {declining.length > 0 && (
        <div className="mt-2 pt-2 border-t border-line">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10.5px] text-sub flex-none">跌幅榜</span>
            {declining.map((s) => (
              <span
                key={s.name}
                className={cn(
                  'badge',
                  s.is_focus ? 'bg-up-soft text-up' : 'bg-line-faint text-sub',
                )}
              >
                {s.name}
                <b className={cn('num ml-1', pctTone(s.pct))}>{fmtPct(s.pct, 1)}</b>
              </span>
            ))}
          </div>
          {declining.some((s) => s.is_focus) && (
            <div className="text-[10.5px] text-sub mt-1">
              青底 = 重点关注板块（CPO / 光模块 / PCB / 半导体 / 算力 / 通信）走弱
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
