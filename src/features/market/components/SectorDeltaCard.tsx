import { useQuery } from '@tanstack/react-query'
import { cn } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import { marketQueries } from '../api/queries'

/**
 * 板块增量（`latest.sector_delta`）—— 今日 vs 昨日同刻的板块涨停数变化。
 *
 * ## 三类语义（脚本 `_sector_status` 判定）
 *
 *   · `new`      —— 昨日快照里没有这个板块（**新晋**）
 *   · `surging`  —— 涨停数 +3，或增幅 ≥50%，或从 0 到 ≥2（**升温**）
 *   · `ongoing`  —— 其余（**持续**，字符串自带 `名称(N→M)` 便于直接读变化）
 *
 * ## 为什么值得单独一张卡
 *
 * 主线热度榜（top5）只给**此刻最强**的，它看不出「谁是新起来的」。
 * 而短线交易里，**新晋与升温**往往比「一直很强」更有交易价值 ——
 * 强了很久的板块已经在高位，刚升温的还在分歧转一致的早期。
 *
 * ⚠️ `new` / `surging` 在盘面平稳时**实测为空数组**（属正常，不是数据缺失）；
 *    空组不渲染，避免用空标题占掉网格高度。
 */
const GROUP: { key: 'new' | 'surging' | 'ongoing'; label: string; cls: string; hint: string }[] = [
  { key: 'new', label: '新晋', cls: 'bg-rec-soft text-rec', hint: '昨快照无此板块' },
  { key: 'surging', label: '升温', cls: 'bg-up-soft text-up', hint: '涨停数 +3 / 增幅≥50%' },
  { key: 'ongoing', label: '持续', cls: 'bg-line-faint text-sub', hint: '与前一日基本持平' },
]

export function SectorDeltaCard() {
  const { data } = useQuery(marketQueries.latest())
  const delta = data?.sector_delta
  const groups = GROUP.map((g) => ({ ...g, items: delta?.[g.key] ?? [] }))
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <Card
      title="🔀 板块增减"
      extra={<span className="text-11 font-normal text-sub">{total} 个板块</span>}
    >
      {total > 0 ? (
        <div className="flex flex-col gap-1.5">
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.key} className="flex items-start gap-2">
                <span className={cn('badge flex-none mt-[1px]', g.cls)} title={g.hint}>
                  {g.label} {g.items.length}
                </span>
                <span className="flex flex-wrap gap-x-2.5 gap-y-1 min-w-0">
                  {g.items.map((s) => (
                    <span key={s} className="text-12 text-txt whitespace-nowrap">
                      {s}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          <div className="text-11 text-sub mt-0.5">
            括号内为「今日涨停数 → 昨日同期」；涨停家数相同不代表结构相同
          </div>
        </div>
      ) : (
        <EmptyState text="无板块增减数据（快照对比未生成）" />
      )}
    </Card>
  )
}
