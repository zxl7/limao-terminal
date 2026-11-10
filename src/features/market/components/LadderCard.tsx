import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { cn, fmtPct } from "@/shared/lib"
import { Card, EmptyState, Kpi, KpiStrip, StockLink } from "@/shared/ui"
import { marketQueries } from "../api/queries"
import { feedbackTone, pctTone } from "../model/labels"

/**
 * 连板天梯 —— **昨日梯队 × 今日晋级**。
 *
 * ## 为什么基线取「昨日」而不是「当下」
 *
 * `latest.json` 是每轮**覆盖写**，且 `intraday_pulse.in_trading` 从 **09:00** 起为真
 * → 盘前首轮抓到的涨停池本就是空的 → `latest.ladder` 被覆盖成 `[]`，卡片整片空态
 * （用户 2026-09-21 抓包「连板天梯这里可以依然显示数据」）。
 * 而连板梯队的**基线**是上一交易日收盘结构，它不会因为今天开盘而消失 —— 所以基线取
 * `yesterday_zt`（盘后固化的唯一涨停权威），再用今日封单把股票移到对应梯位。
 *
 * 盘中这张图直接反映梯队演进：封单额 > 0 的昨日 N 板票移到 N+1 板，
 * 其余保留昨日位置；昨首板封单 > 0 时进入 2 板梯位。
 *
 * ## 两个数据口径上的钉子
 *
 * 1. 本卡的上移看当前正封单或 `sealed_today`（同日已确认封板事实）；收盘后
 *    `seal_yi` 变空时不能抹掉盘中已确认的晋级。
 * 2. 反馈矩阵的对照日必须与梯队基线**同日**才使用封单（不同日 = 把另一日
 *    的封单套到今天的梯队上）；不同日时仅显示昨日基线位置。
 * 3. 同梯位只按今日涨停池首封时间排序；未晋级票不借用昨日 fbt，排在有今日时间的股票之后。
 */
/**
 * 🎨 天梯高度梯度（2026-11-10 用户「高度前三按 4/3/2 递减」）。
 *
 * 只给**前三个梯位**上底色，且强度递减：最高板最重 → 次高 → 第三。
 * 第四档及以下不上色：梯队尾部经常有十几个 1 板，全上色等于没重点。
 * ⛔ 用字面量类名（Tailwind 不认拼接），改色只改这张表。
 */
// ⛔ 第一档不能用 `bg-up-soft`（#ffe9e5 是**固定浅粉**，比 13% 的 up 还浅，
//    实测出现「第二名比第一名深」的倒挂）。三档统一用同一底色的不透明度阶梯。
const RANK_BG = ['bg-up/26', 'bg-up/13', 'bg-up/6'] as const

export function LadderCard() {
  const { data: yzt } = useQuery(marketQueries.yesterday())
  const { data: fb, isError: feedbackError } = useQuery(marketQueries.feedback())

  /** 封单生效条件：反馈矩阵无异常且对照日与梯队基线日相同。 */
  const basisDate = yzt?.date ?? ""
  const sameBasis = !!basisDate && !!fb && !fb.error && fb.prev_date === basisDate
  /**
   * 逐票实时行情（涨幅 / 封单）—— 同样受「对照日一致」约束：
   * ⛔ 不同日时给空表，免得把**别的交易日**的涨幅标到今天的梯队上。
   */
  const quotes = useMemo(() => (sameBasis ? (fb?.quotes ?? {}) : {}), [sameBasis, fb])

  /** 昨日梯队按今日封单重排；未上移者仅保留原位置，不推断其今日连板状态。 */
  const groups = useMemo(() => {
    const stocks = (yzt?.zt_list ?? []).flatMap((s) => {
      const quote = quotes[s.code]
      // 收盘后当前封单额可能为空；同日已确认封板的股票仍留在晋级后的梯位。
      const moved = (quote?.seal_yi ?? 0) > 0 || quote?.sealed_today === true
      const todayFbt = moved && /^\d{6}$/.test(quote?.today_fbt ?? "") ? quote?.today_fbt : null
      return s.boards >= 2 || (s.boards === 1 && moved) ? [{ ...s, position: s.boards + Number(moved), moved, todayFbt }] : []
    })
    const boards = [...new Set(stocks.map((s) => s.position))].sort((a, b) => b - a)
    // 今日首封时间早的在前；无今日时间的保持原快照顺序，绝不混用昨日 fbt。
    return boards.map((b) => ({
      boards: b,
      stocks: stocks
        .filter((s) => s.position === b)
        .sort((a, c) => {
          if (a.todayFbt && c.todayFbt) return a.todayFbt.localeCompare(c.todayFbt)
          if (a.todayFbt) return -1
          if (c.todayFbt) return 1
          return 0
        }),
    }))
  }, [yzt, quotes])

  const maxBoards = groups[0]?.boards ?? 0
  const movedCount = groups.reduce((n, g) => n + g.stocks.filter((s) => s.moved).length, 0)
  const gate = fb?.trend?.promotion_gate_10d ?? 25

  return (
    <Card
      title="🪜 连板天梯"
      extra={
        groups.length > 0 && (
          <span className="text-11 font-normal text-sub">
            {basisDate} 梯队{sameBasis ? ` · 封单上移 ${movedCount} 只` : ""}
          </span>
        )
      }>
      {feedbackError && (
        <p role="status" className="text-11 text-warn mb-2">
          {fb ? "反馈更新失败，保留上次数据" : "反馈加载失败"}
        </p>
      )}
      {sameBasis && fb ? (
        <div className="mb-2.5 pb-2 border-b border-line-faint">
          <div className="num text-11 text-sub mb-1.5">反馈时间 {fb.generated_ts}</div>
          {/* 晋级指标沿用反馈矩阵口径；与昨日梯队日期一致后才展示。 */}
          <KpiStrip min={96}>
            <Kpi
              label="昨涨停晋级"
              value={fb.promote_rate ?? "—"}
              unit="%"
              tone={fb.promote_rate == null ? "sub" : feedbackTone(fb.promote_rate < gate)}
              sub={`晋级 ${fb.promote_count ?? "—"}/${fb.prev_zt_count ?? "—"} · 阀门 ${gate.toFixed(1)}%`}
              size="sm"
            />
            <Kpi
              label="连板晋级"
              value={fb.lb_promote_rate ?? "—"}
              unit="%"
              tone={fb.lb_promote_rate == null ? "sub" : feedbackTone(fb.lb_promote_rate < 30)}
              sub={`晋级 ${fb.lb_promote_count ?? "—"}/${fb.lb_prev_count ?? "—"}`}
              size="sm"
            />
            <Kpi label="昨涨停今均涨幅" value={fb.avg_pct ?? "—"} unit="%" tone={fb.avg_pct == null ? "sub" : fb.avg_pct < 0 ? "down" : "up"} size="sm" />
            <Kpi label="昨涨停今上涨占比" value={fb.up_rate ?? "—"} unit="%" tone={fb.up_rate == null ? "sub" : fb.up_rate < 50 ? "down" : "up"} size="sm" />
            <Kpi
              label="最高板变化"
              value={`${fb.prev_max_boards ?? "—"}→${fb.now_max_boards ?? "—"}`}
              tone={fb.max_trend == null ? "sub" : fb.max_trend < 0 ? "down" : "up"}
              sub={fb.max_trend == null ? "高度趋势未提供" : fb.max_trend < 0 ? "高度压缩" : "高度维持"}
              size="sm"
            />
          </KpiStrip>
        </div>
      ) : (
        ""
      )}
      {groups.length > 0 ? (
        /* 上限 300px + 内部滚动：梯队档数与每档票数随盘面变化。 */
        <div className="flex flex-col gap-1 max-h-[300px] overflow-auto">
          {groups.map((g, rank) => {
            const isTop = g.boards === maxBoards
            // 前三个梯位按 1/2/3 递减上色；第四档起不上色（尾部 1 板太多，全上色就没重点了）
            const rankBg = RANK_BG[rank] ?? ""
            return (
              <div key={g.boards} className={cn("flex items-baseline gap-2.5 px-1.5 py-1 rounded", rankBg)}>
                <span className={cn("num flex-none w-10 text-xs font-bold", isTop ? "text-up" : "text-up/75")}>{g.boards}板</span>
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {g.stocks.map((s) => {
                    const q = quotes[s.code]
                    // 反馈对照日不一致时使用当日涨停池原值，不把行情渲染为空。
                    const displayPct = q?.pct ?? (sameBasis ? null : s.pct)
                    const displaySeal = q?.seal_yi ?? (sameBasis ? null : s.seal)
                    const displayFbt = s.todayFbt ?? (sameBasis ? null : s.fbt)
                    return (
                      <span key={s.code} className="inline-flex items-baseline gap-0.5">
                        <StockLink code={s.code} className={cn("text-xs", s.moved ? "text-up font-semibold" : "text-txt")}>
                          {s.name}
                        </StockLink>
                        <span className={cn("num text-11", pctTone(displayPct))}>{displayPct != null ? fmtPct(displayPct) : "—"}</span>
                        {displaySeal != null && <span className="num text-10 text-lead">封{displaySeal}亿</span>}
                        {displayFbt && (
                          <span className="num text-10 text-sub">
                            {displayFbt.slice(0, 2)}:{displayFbt.slice(2, 4)}:{displayFbt.slice(4, 6)}
                          </span>
                        )}
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
