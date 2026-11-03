import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct } from '@/shared/lib'
import { Card, EmptyState, StockLink } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { tradableStocks } from '../model/filters'
import { pctTone } from '../model/labels'

/**
 * 次日预期（`latest.em_expect`）—— 东财题材预期榜 Top5，盘中的「明天看什么」。
 *
 * ## 它和主线热度榜的区别（两者容易混）
 *
 *   · 主线热度（`top5`）—— **今天**在共振的线，按涨停数排
 *   · 次日预期（`em_expect`）—— **明天**可能发酵的线，来自东财「题材预期」栏目，
 *     排序依据是栏目自身口径（含累计涨幅与站上题材的个股数）
 *
 * 简言之：一个是「已发生的强度」，一个是「待发酵的预期」。短线里后者用于
 * **提前埋伏**（配合早鸟埋伏卡），前者用于确认当下主线是否成立。
 *
 * ## ⚠️ 字段口径
 *
 *   · `pct` / `cum_pct` 是**题材指数**涨幅（当日 / 累计），不是个股涨幅
 *   · `zt` 是该题材当日涨停家数
 *   · `stocks[].dragon` —— 东财标记的龙头；**可能一条都没有**（不能假设存在）
 *   · `title` 是新闻标题原文，可能较长 → 单行截断 + `title` 属性给全文
 *
 * ## ⛔ 科创板（688）必须在这里剔除（实测本卡是**唯一**会漏 688 的地方）
 *
 * 2026-09-15 实测：`leaders` / `early` / `top5` 的代码里都没有 688（上游脚本已过滤），
 * 唯独东财题材榜的 `stocks` 含 688313 / 688621 / 688202 … —— 因为这份数据是
 * **原样透传东财榜单**，没有过本系统的可交易性过滤。
 * 用户无科创板权限，展示即噪声，故在渲染层剔除。
 * （展示层的兜底不替代上游过滤，只是保证「眼不见」这一层不会出错。）
 */
export function ExpectCard() {
  const { data } = useQuery(marketQueries.latest())
  const rows = data?.em_expect ?? []

  return (
    <Card
      title="🧭 次日预期"
      extra={<span className="text-11 font-normal text-sub">东财题材榜 · 用于提前埋伏</span>}
    >
      {rows.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {rows.map((e) => {
            /** ⛔ 剔除科创板（用户无权限）；见本文件头注 */
            const tradable = tradableStocks(e.stocks)
            const dragons = tradable.filter((s) => s.dragon)
            const others = tradable.filter((s) => !s.dragon).slice(0, 4)
            return (
              <div
                key={e.themeCode ?? e.name}
                className="rounded-[var(--radius-sm)] bg-line-faint px-2 py-1.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-13 font-semibold text-txt">{e.name}</span>
                  <span className={cn('num text-12', pctTone(e.pct))}>{fmtPct(e.pct, 1)}</span>
                  <span className="num text-11 text-sub">累计 {fmtPct(e.cum_pct, 1)}</span>
                  <span className="num text-11 text-sub">
                    涨停 <b className="text-12 text-up">{e.zt}</b>
                  </span>
                </div>

                {e.title && (
                  <div className="text-11 text-sub mt-0.5 truncate" title={e.title}>
                    {e.title}
                  </div>
                )}

                {(dragons.length > 0 || others.length > 0) && (
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mt-0.5">
                    {dragons.map((s) => (
                      <StockLink key={s.code} code={s.code} className="text-12 font-semibold text-lead">
                        ★{s.name}
                        <span className={cn('num ml-1', pctTone(s.pct))}>{fmtPct(s.pct, 1)}</span>
                      </StockLink>
                    ))}
                    {others.map((s) => (
                      <StockLink key={s.code} code={s.code} className="text-12 text-txt">
                        {s.name}
                        <span className={cn('num ml-1', pctTone(s.pct))}>{fmtPct(s.pct, 1)}</span>
                      </StockLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div className="text-11 text-sub">
            ★ = 东财标记龙头；涨幅为题材指数涨幅；⛔ 科创板（688）已按无权限剔除
          </div>
        </div>
      ) : (
        <EmptyState text="东财题材预期榜未生成" />
      )}
    </Card>
  )
}
