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
      <span className="num text-13 font-semibold text-txt flex-none">{range}</span>
      <span className="text-11 px-1 rounded-sm bg-line-faint text-sub flex-none">
        {KIND_LABEL[block.kind]}
      </span>
      <span className="num text-sub text-11 min-w-0 break-all">
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
        <div className="flex-none border-b border-line-faint px-2.5 py-1 text-10 text-warn">
          {minToClock(summary.at)} {outside === 'post' ? '盘后' : '盘前'}记录
        </div>
      )}

      {/* 明细主体：**全量**。`scrollBody` = 浮动层（自身滚动）；否则自然增高（左栏列表滚动） */}
      <div
        className={cn(
          'min-w-0',
          scrollBody && 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
        )}
      >
        {/**
         * ⛔⛔ 2026-10-22 用户：「Hover 弹窗里面简洁一点，不要嵌套三张卡片了」。
         *
         * 原实现每个槽都套一层 `rounded + border + bg-card + shadow-sm` 的白卡，
         * 外面还有一圈 `bg-line-faint/30` 的灰底 —— 弹窗里于是同时存在
         * 「弹窗卡片 → 槽白卡 → 灰底块 → 彩色左边框块」四层框，一眼全是边。
         *
         * 现在：**槽与槽之间只留一根细线**，槽内走 `SlotBody flat`（无底色/无边框/无圆角）。
         *
         * ## 分层靠什么（用户随后补充：「可以有分割线」）
         *
         * 拆框 ≠ 拆线：段落之间保留 **hairline 分隔线**（只有上边框、极淡），
         * 视觉上是「分隔」而不是「又一个框」。落地两处：
         *   · 槽内：父级用 `[&>*+*]:border-t` 给**每个顶层段**自动加线 ——
         *     ⛔ 不逐段手写：`SlotBody` 返回 Fragment，段数随数据变化，
         *     逐段加必然漏（题材块有/无、事件块有/无都是不同分支）。
         *   · 段内：`DirectionSection` / `NewsSection` 的 `divider` 自己处理子段。
         */}
        {slots.map((s, i) => (
          <div
            key={s.key}
            className={cn(
              /**
               * ⛔ 必须 `flex flex-col gap-*`：`SlotBody` 返回的是**Fragment**，
               *    父级不是 flex 的话，它的各段会紧贴在一起 —— 拆掉内层卡片后
               *    「题材 / 盘中外强外弱 / 个股」会糊成一坨，比有卡片时更难读。
               */
              'flex min-w-0 flex-col gap-1.5 px-3 py-2',
              // 顶层段之间的分隔线（第一段不带线，靠 `*+*` 天然做到）
              '[&>*+*]:border-t [&>*+*]:border-line-faint [&>*+*]:pt-1.5',
              i > 0 && 'border-t border-line-faint',
            )}
          >
            {slots.length > 1 && (
              <div className="num text-11 font-semibold text-txt">{minToClock(s.at)}</div>
            )}
            <SlotBody
              slot={s}
              topBoard={topBoard}
              tags={tags}
              reasonByCode={reasonByCode}
              themeInfo={themeInfo}
              showAllSectors
              showAllEvents
              themeGrouped
              flat
            />
          </div>
        ))}
      </div>
    </>
  )
}
