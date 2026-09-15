import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, isLimitUp } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/**
 * 核心标的（`latest.leaders`）—— 可买个股 / 辨识度标的。
 *
 * ## 三态语义（原系统规则，逐条对齐，不可改）
 *
 *   可买（未封板）  → 整行紫（`--rec` / `--rec-soft`）
 *   已涨停 / 封板   → 整行红（`--up` / `--up-soft`）
 *   其余            → 常规
 *
 * 「可买」是**机会**语义，故用紫色而非红色 —— 红色在本系统专属「已涨/已封」，
 * 用红色标可买会让人分不清「已经买了还是还能买」。
 *
 * ## ⚠️ 改为按板块聚合（4K 下的可用性）
 *
 * 原实现是把 28 只平铺成一个长列表，`grid-cols-[1fr_auto_68px]` 每行一个：
 *   · 28 行 × 26px ≈ 730px 高，成为整页最高的卡，把同网格行的邻居拉出大片空白
 *   · 版块信息只在第 2 列露出一小块，**同一板块的票被随机顺序打散**
 *     （脚本按强度排序，不按板块排序），反而看不出「哪个板块在批量出票」
 *
 * 聚合后：板块头（含该板块可买数）+ 该板块的标的。可买标的多的板块排前面 ——
 * 这正是「哪个方向现在还能上车」的答案。
 *
 * ## ⚠️ 限高滚动
 *
 * 高度上限 ≈ 5 行板块头 + 若干标的行，超出滚动。这是 4K 网格的硬约束：
 * 任何单卡无限增长都会破坏整页的密度均衡。
 */
export function LeadersCard() {
  const { data } = useQuery(marketQueries.latest())
  const leaders = data?.leaders ?? []

  /** 板块聚合：保持脚本给出的组内顺序（已按强度排），只按「可买数」重排板块 */
  const bySector = new Map<string, typeof leaders>()
  for (const s of leaders) {
    const key = s.sector || '未标注板块'
    const bucket = bySector.get(key)
    if (bucket) bucket.push(s)
    else bySector.set(key, [s])
  }
  const groups = [...bySector.entries()]
    .map(([sector, list]) => ({
      sector,
      list,
      buyable: list.filter((s) => s.buyable).length,
    }))
    .sort((a, b) => b.buyable - a.buyable || b.list.length - a.list.length)

  const buyableTotal = leaders.filter((s) => s.buyable).length

  return (
    <Card
      title="🎯 核心标的"
      extra={
        <span className="text-[11px] font-normal text-sub">
          {leaders.length} 只 / 可买 <b className="num text-[12px] text-rec">{buyableTotal}</b>
        </span>
      }
    >
      {leaders.length > 0 ? (
        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
          {groups.map((g) => (
            <div key={g.sector}>
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-semibold text-txt">{g.sector}</span>
                <span className="num text-[10.5px] text-sub">{g.list.length} 只</span>
                {g.buyable > 0 && (
                  <span className="badge bg-rec-soft text-rec">可买 {g.buyable}</span>
                )}
              </div>
              <div className="flex flex-col mt-0.5">
                {g.list.map((s) => {
                  const limitUp = !s.buyable && isLimitUp(s.pct, s.is_20cm, s.boards)
                  return (
                    <div
                      key={s.code ?? s.name}
                      className={cn(
                        'grid grid-cols-[1fr_auto_64px] items-center gap-2 px-1.5 py-[3px] rounded',
                        limitUp && 'bg-up-soft',
                        s.buyable && 'bg-rec-soft',
                      )}
                    >
                      <span
                        className={cn(
                          'text-[12.5px] font-semibold flex items-center gap-1.5 min-w-0',
                          limitUp && 'text-up',
                          s.buyable && 'text-rec',
                        )}
                      >
                        <span className="truncate">{s.name}</span>
                        <span className="num text-[10.5px] font-normal text-sub">{s.code}</span>
                        {s.boards && <span className="badge bg-lead-soft text-lead">{s.boards}</span>}
                        {s.is_20cm && <span className="badge bg-line text-sub">20cm</span>}
                        {s.buyable && <span className="badge bg-rec text-white">可买</span>}
                      </span>
                      <span className="text-[10.5px] text-sub whitespace-nowrap">
                        {s.limit_up_days > 0 ? `${s.limit_up_days}板` : ''}
                      </span>
                      <span className={cn('num text-[12.5px] font-semibold text-right', pctTone(s.pct))}>
                        {fmtPct(s.pct)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="暂无核心标的" />
      )}
    </Card>
  )
}
