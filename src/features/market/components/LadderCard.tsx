import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/**
 * 连板天梯 —— **昨日梯队 × 今日晋级**。
 *
 * ## 为什么基线取「昨日」而不是「当下」
 *
 * `latest.json` 是每轮**覆盖写**，且 `intraday_pulse.in_trading` 从 **09:00** 起为真
 * → 盘前首轮抓到的涨停池本就是空的 → `latest.ladder` 被覆盖成 `[]`，卡片整片空态
 * （用户 2026-09-21 抓包「连板天梯这里可以依然显示数据」）。
 * 而连板梯队的**基线**是上一交易日收盘结构，它不会因为今天开盘而消失 —— 所以基线取
 * `yesterday_zt`（盘后固化的唯一涨停权威），并在每只票上叠加**今日是否晋级**。
 *
 * 盘中这张图直接反映梯队演进：带 `✓` 的票今天就是 `N+1` 板，未标的即断板。
 *
 * ## 两个数据口径上的钉子
 *
 * 1. 晋级集合用 `promote_codes`（**全量**），⛔ 不用 `promote_list`（截断前 8，
 *    做集合判定会给第 9 只之后的晋级票打上「未晋级」的假标签）。
 * 2. 反馈矩阵的对照日必须与梯队基线**同日**才启用标记（不同日 = 把另一天的成绩
 *    标到今天的梯队上）；不同日时只显示梯队本身，不带任何晋级标记。
 */
export function LadderCard() {
  const { data: yzt } = useQuery(marketQueries.yesterday())
  const { data: fb } = useQuery(marketQueries.feedback())

  /** 昨日梯队（仅 ≥2 板）· 板数降序 · 纯函数式构造（⛔ 不用 push：React Compiler 要求无副作用） */
  const groups = useMemo(() => {
    const stocks = (yzt?.zt_list ?? []).filter((s) => (s.boards ?? 0) >= 2)
    const boards = [...new Set(stocks.map((s) => s.boards))].sort((a, b) => b - a)
    return boards.map((b) => ({ boards: b, stocks: stocks.filter((s) => s.boards === b) }))
  }, [yzt])

  /** 晋级集合的生效条件：反馈矩阵无异常 且 对照日 == 梯队基线日 */
  const basisDate = yzt?.date ?? ''
  const sameBasis = !!basisDate && !!fb && !fb.error && fb.prev_date === basisDate
  const promoted = useMemo(() => new Set(sameBasis ? (fb?.promote_codes ?? []) : []), [sameBasis, fb])
  /**
   * 逐票实时行情（涨幅 / 封单）—— 同样受「对照日一致」约束：
   * ⛔ 不同日时给空表，免得把**别的交易日**的涨幅标到今天的梯队上。
   */
  const quotes = useMemo(() => (sameBasis ? (fb?.quotes ?? {}) : {}), [sameBasis, fb])

  const maxBoards = groups[0]?.boards ?? 0
  const total = groups.reduce((n, g) => n + g.stocks.length, 0)
  const promotedCount = groups.reduce(
    (n, g) => n + g.stocks.filter((s) => promoted.has(s.code)).length,
    0,
  )

  return (
    <Card
      title="🪜 连板天梯"
      extra={
        groups.length > 0 && (
          <span className="text-[11px] font-normal text-sub">
            {basisDate} 梯队{sameBasis ? ` · 晋级 ${promotedCount}/${total}` : ''}
          </span>
        )
      }
    >
      {groups.length > 0 ? (
        /* 上限 300px + 内部滚动：梯队档数与每档票数随盘面变化（与 LeadersCard 同口径）。 */
        <div className="flex flex-col gap-[3px] max-h-[300px] overflow-auto">
          {groups.map((g) => {
            const isTop = g.boards === maxBoards
            return (
              <div
                key={g.boards}
                className={cn('flex items-baseline gap-2.5 px-1.5 py-[3px] rounded', isTop && 'bg-up-soft')}
              >
                <span className="num flex-none w-10 text-xs font-bold text-up">{g.boards}板</span>
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {g.stocks.map((s) => {
                    const ok = promoted.has(s.code)
                    const q = quotes[s.code]
                    return (
                      <span key={s.code} className="inline-flex items-baseline gap-0.5">
                        <span className={cn('text-xs', ok ? 'text-up font-semibold' : 'text-txt')}>
                          {s.name}
                        </span>
                        {/* 今日实时涨幅 —— 缺行情时 `—`，⛔ 不退化成 0 */}
                        <span className={cn('num text-[10.5px]', pctTone(q?.pct))}>
                          {q?.pct != null ? fmtPct(q.pct) : '—'}
                        </span>
                        {/* 封单额：仅**真封板**时后端才给值（无卖盘），非封板的票不显示 */}
                        {q?.seal_yi != null && (
                          <span className="num text-[10px] text-lead">封{q.seal_yi}亿</span>
                        )}
                        {ok && <span className="text-[10px] font-bold text-up">✓</span>}
                      </span>
                    )
                  })}
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
