import { useQuery } from '@tanstack/react-query'
import { cn, sortLadderDesc } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import { marketQueries } from '../api/queries'

/**
 * 连板天梯 —— 对应原 dashboard `render_ladder()`。
 *
 * 数据源：`latest.ladder`（⚠️ 结构为 `{ boards, stocks: string[] }`，
 * stocks 是**字符串数组**而非对象数组 —— 这是最容易写错的一处）。
 *
 * 语义：最高板整行标红（原系统「涨停整行红」规则）。
 */
export function LadderCard() {
  const { data } = useQuery(marketQueries.latest())

  const groups = sortLadderDesc(data?.ladder ?? [])
  const maxBoards = groups[0]?.boards ?? 0
  const totalStocks = groups.reduce((n, g) => n + (g.stocks?.length ?? 0), 0)

  return (
    <Card
      title="🪜 连板天梯"
      extra={
        <span className="text-[11px] font-normal text-sub">
          {totalStocks} 只 / {groups.length} 个梯队
        </span>
      }
    >
      {groups.length > 0 ? (
        <div className="flex flex-col gap-[3px]">
          {groups.map((g) => {
            const isTop = g.boards === maxBoards
            return (
              <div
                key={g.boards}
                className={cn('flex items-baseline gap-2.5 px-1.5 py-[3px] rounded', isTop && 'bg-up-soft')}
              >
                <span className="num flex-none w-10 text-xs font-bold text-up">{g.boards}板</span>
                <span className="flex flex-wrap gap-x-2.5 gap-y-1">
                  {(g.stocks ?? []).map((s) => (
                    <span
                      key={s}
                      className={cn('text-xs', isTop ? 'text-up font-semibold' : 'text-txt')}
                    >
                      {s}
                    </span>
                  ))}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState text="暂无连板梯队" />
      )}
    </Card>
  )
}
