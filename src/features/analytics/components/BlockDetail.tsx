import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'
import { SlotBody } from './TimelineSlotCard'
import { summarizeBlock } from '../lib/block-summary'
import { minToClock, type TimelineBlock } from '../lib/timeline'
import { SESSION_CLOSE, SESSION_OPEN } from '../lib/snake'
import { groupSlotByTheme, type StockThemeTag, type ThemeBurst } from '../lib/theme-burst'

/**
 * **单个时间轴分块的完整详情**（2026-09-22）—— 双消费者共用同一实现：
 *
 * | 消费者 | 位置 | 体积 |
 * |---|---|---|
 * | `TimelineSnake` 的 hover 浮层 | 轴上节点悬停 | 固定高 + 内部滚动（`scrollBody`） |
 * | `TimelineDetailList` 左栏 | 每个节点一条，纵向列表 | 自然增高（由虚拟列表测量） |
 *
 * ⛔ **详情口径只有一处**：一律 `showAllSectors` + `showAllEvents` + `themeInfo`
 *   —— 卡面「最强 3 个板块」的截断**不得**出现在详情里，否则「完整详情」名不副实。
 * ⛔ 两种消费场景**不各写一份**（本模块存在就是为了避免两处漂移）。
 */

/** 分块类型标签（轴上 aria、浮层头、左栏详情头共用） */
export const KIND_LABEL: Record<TimelineBlock['kind'], string> = {
  linkage: '🚀 板块联动',
  normal: '盘中动态',
  merged: '📎 低频合并',
}

/** 分块时刻文案：单槽标时刻，区间卡标 `起~止` */
export function blockRangeText(block: TimelineBlock): string {
  const s = summarizeBlock(block, 999)
  return s.to === s.at ? minToClock(s.at) : `${minToClock(s.at)}~${minToClock(s.to)}`
}

export function BlockDetail({
  block,
  topBoard,
  tags,
  reasonByCode,
  themeInfo,
  scrollBody = false,
  onSelect,
  active = false,
}: {
  block: TimelineBlock
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  /** 题材名 → 当日全貌（催化 / 成员 / 观测时刻）—— 详情里才展开 */
  themeInfo?: Map<string, ThemeBurst>
  /** `true` = 卡体自身成为滚动区（浮动层用）；`false` = 自然增高（左栏虚拟列表用） */
  scrollBody?: boolean
  /** 传了则卡头变成可点按钮（左栏点击联动右侧轴） */
  onSelect?: () => void
  active?: boolean
}) {
  const summary = summarizeBlock(block, 999)
  const slots = block.kind === 'normal' ? [block.slot] : block.slots
  const range = summary.to === summary.at
    ? minToClock(summary.at)
    : `${minToClock(summary.at)}~${minToClock(summary.to)}`
  /** 盘外记录（超出交易时段）→ 必须当场说明，否则会被误读成盘中记录 */
  const outside = summary.at < SESSION_OPEN ? 'pre' : summary.at > SESSION_CLOSE ? 'post' : null

  /**
   * 本分块涉及的**题材数**（去重）—— 详情头部用它替代「行业 N / ↑N/↓N」。
   *
   * 2026-09-22 用户：「我需要看到的是**题材**…我不喜欢看到现在什么的爆发走强、
   * 杀跌这些数量」→ 头部统计一并换成题材维度（`↑N/↓N` 是盘中板块事件的计数）。
   *
   * ⚠️ 先把所有槽的票合起来去重再归类，⛔ 不是「每槽题材数相加」（同一题材跨槽会被重复计）。
   */
  const allStocks = slots.flatMap((s) => [...s.sectors.flatMap((g) => g.stocks), ...s.singles])
  // ⚠️ 不用 `useMemo`：`slots` 由 `block` 派生、每次渲染都是新数组，包一层只会「永远重算」，
  //    且会触发 lint 的 `exhaustive-deps` 类告警。归类本身是 O(票数)，可忽略。
  const themeCount = groupSlotByTheme(
    { sectors: [{ stocks: allStocks }], singles: [] },
    tags,
    new Set(),
  ).groups.length

  const headInner: ReactNode = (
    <>
      <span className="num text-[13px] font-semibold text-txt flex-none">{range}</span>
      <span className="text-[10.5px] px-1 rounded-sm bg-line-faint text-sub flex-none">
        {KIND_LABEL[block.kind]}
      </span>
      <span className="num text-sub text-[10.5px] min-w-0 break-all">
        {summary.stockCount > 0 && <>封板 {summary.stockCount} · </>}题材 {themeCount} · 盘中记录{' '}
        {/* 炸板已从 otherDownCount 单列，这里补回；跌停仍在 otherDownCount 内，⛔ 不要重复加 */}
        {summary.upSectorCount +
          summary.downSectorCount +
          summary.otherUpCount +
          summary.otherDownCount +
          summary.brokenCount}
      </span>
    </>
  )

  return (
    <>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? 'true' : undefined}
          className={cn(
            'w-full text-left border-b px-2 py-1.5 min-w-0 flex items-baseline gap-2 flex-wrap transition-colors',
            active ? 'bg-rec-soft border-b-rec' : 'border-b-line-faint hover:bg-line-faint',
          )}
        >
          {headInner}
        </button>
      ) : (
        <header className="flex-none flex items-baseline gap-2 flex-wrap border-b border-line-faint px-2.5 py-2 min-w-0">
          {headInner}
        </header>
      )}

      {outside && (
        <div className="flex-none border-b border-line-faint px-2.5 py-1 text-[10px] text-warn">
          {minToClock(summary.at)} {outside === 'post' ? '盘后' : '盘前'}记录
        </div>
      )}

      {/* 明细主体：**全量**。`scrollBody` = 浮动层（自身滚动）；否则自然增高（左栏列表滚动） */}
      <div
        className={cn(
          'p-2 flex flex-col gap-2 min-w-0 bg-line-faint/30',
          scrollBody && 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 gap-2.5',
        )}
      >
        {slots.map((s) => (
          <div key={s.key} className="rounded-[var(--radius-sm)] border border-line bg-card p-2 min-w-0 shadow-sm">
            <SlotBody
              slot={s}
              topBoard={topBoard}
              tags={tags}
              reasonByCode={reasonByCode}
              themeInfo={themeInfo}
              showTime={slots.length > 1}
              showAllSectors
              showAllEvents
              themeGrouped
            />
          </div>
        ))}
      </div>
    </>
  )
}
