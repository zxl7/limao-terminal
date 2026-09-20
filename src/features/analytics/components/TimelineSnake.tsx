import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib'
import { useChartWidth } from '@/shared/ui'
import { SlotBody } from './TimelineSlotCard'
import { summarizeBlock, type BlockSummary } from '../lib/block-summary'
import { minToClock, SLOT_VISIBLE_SECTORS, type TimelineBlock } from '../lib/timeline'
import {
  clockOfAxis,
  layoutSnake,
  snakePos,
  SESSION_CLOSE,
  SESSION_OPEN,
  SNAKE_BAR_MAX_H,
  SNAKE_BAR_W,
  SNAKE_NODE_W,
} from '../lib/snake'
import type { StockThemeTag } from '../lib/theme-burst'

/**
 * **蛇形时间轴**（boustrophedon）—— 一条线从 09:15 横过去、到边半圆弯下来、反向再横走。
 *
 * ## 交互（2026-09-17 用户定稿：**只要 hover，不要点击**）
 *
 * | 交互 | 行为 |
 * |---|---|
 * | **hover 节点** | 就地浮出**该刻完整明细**（个股 / 行业 / 题材 / 盘中逐事件，⛔ 全量不截断） |
 * | 移开鼠标 | 自动收起（移进浮层则保持，便于读长文 / 滚动） |
 * | 键盘 | `Tab` 聚焦节点 = hover，同等触发（可访问性） |
 *
 * ⛔ **没有「点击展开」这一步** —— 用户明确「不要点击显示明细了，直接 hover 显示明细」。
 * 故浮层不能是 `pointer-events:none`（那样无法滚动读长内容），改由
 * **延迟开启 + 延迟关闭 + 移入浮层取消关闭** 三件套防抖：
 * 节点只有 26px 宽、分钟级密集，没有防抖的话扫过一行会连闪好几个浮层。
 *
 * ## ⛔ 版面铁律（沿用本站 PC 端约定）
 *
 * · **宽度跟容器、高度由布局内核决定且有界**（`rows ∈ [3,9]`）—— ⛔ 禁 `w-full h-auto`
 *   的等比放大；宽度用 `useChartWidth` 实测后交给 `layoutSnake`，故文字 1:1 不缩放。
 * · 浮层是**绝对定位层**、不是静态文字行；且**不能改变节点命中区尺寸**，否则 hover 会抖。
 * · 节点本身是**小标记**（细竖条）：实测节点相邻间隔中位 **2 分钟**，
 *   若按卡片宽度排需 12 行 —— 文字一律交给浮层。
 *
 * ## ⚠️ 与卡片流的关系
 *
 * 共用同一批分块（`TimelineBlock`）与同一批排序内核，只是排版与交互不同 ——
 * 切视图**不改变任何结论**。
 */

/** 未测量时的兜底宽度（PC 端典型内容区宽） */
const FALLBACK_WIDTH = 1440
/** 明细浮层宽度（px） */
const DETAIL_W = 700
/** 明细浮层最大高度（vh）—— 超出则浮层内部滚动 */
const DETAIL_MAX_VH = 62
/** 浮层「往上放还是往下放」的 y 判定阈值（px） */
const DETAIL_FLIP_Y = 300

/** 时间刻度：整点 + 下午半点 —— 给「横轴读到哪一段」一个参照 */
const TICK_MINUTES = [10 * 60, 11 * 60, 13 * 60 + 30, 14 * 60, 14 * 60 + 30, 15 * 60]

const KIND_LABEL: Record<TimelineBlock['kind'], string> = {
  linkage: '🚀 板块联动',
  normal: '普通卡',
  merged: '📎 低频合并',
}

/**
 * 竖条颜色 = 该刻**性质**（与 A 股语义一致：涨红 / 跌绿 / 题材紫 / 普通灰）。
 * ⛔ 与卡片流的判断顺序同源（联动 > 杀跌 > 题材 > 合并 > 普通），免得同一时刻两种视图颜色不一致。
 */
function barTone(s: BlockSummary, block: TimelineBlock): string {
  if (block.kind === 'linkage') return 'bg-up'
  if (s.fade.length > 0 || s.downSectorCount > 0) return 'bg-down'
  if (s.burst.length > 0) return 'bg-up/70'
  if (block.kind === 'merged') return 'bg-line-strong'
  return 'bg-sub'
}

/** 该刻的**活跃度**（用于竖条高度）—— 收盘口径个股 + 盘中板块事件 + 题材信号权重 */
function activityOf(s: BlockSummary): number {
  return (
    s.stockCount +
    s.upSectorCount +
    s.downSectorCount +
    s.burst.length * 3 +
    s.fade.length * 3
  )
}

/** 竖条高度：开方压缩（活跃度跨度大，线性会把小节点压成看不见） */
function barHeight(s: BlockSummary): number {
  const h = 8 + 5 * Math.sqrt(activityOf(s))
  return Math.max(8, Math.min(SNAKE_BAR_MAX_H, Math.round(h)))
}

/**
 * 「显著节点」= 值得在轴上直接标出时刻的那些。
 *
 * ⛔ 为什么不给所有节点标时刻：实测节点相邻间隔**中位 2 分钟**，全标会糊成一片
 * （标签宽 ~40px，而 1 分钟的间距只有 ~23px）。
 */
function isNotable(s: BlockSummary, block: TimelineBlock): boolean {
  return (
    block.kind === 'linkage' ||
    s.burst.length > 0 ||
    s.fade.length > 0 ||
    s.sectorCount >= SLOT_VISIBLE_SECTORS ||
    s.upSectorCount + s.downSectorCount >= 2
  )
}

/** 同层相邻两个**时刻标签**的最小间距（px）—— 小于它就不标，防止叠字 */
const MIN_LABEL_GAP = 48

/** 一条竖虚线 + 时刻文字，给横轴一个「读到哪一段」的参照 */
function TimeGrid({ x, y, rowHeight, label }: { x: number; y: number; rowHeight: number; label: string }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: x, top: y - rowHeight / 2, height: rowHeight, transform: 'translateX(-0.5px)' }}
      aria-hidden
    >
      <div className="w-px h-full border-l border-dashed border-line-faint" />
      <span className="absolute -top-0.5 left-1 text-[9.5px] text-sub whitespace-nowrap">{label}</span>
    </div>
  )
}

/**
 * **悬停明细浮层** —— 把该刻的**完整明细**直接浮在节点旁。
 *
 * ⛔ 三点必须守住：
 *   ① **不需要点击**（用户 2026-09-17 明确）—— 悬停即出，移开即收；
 *   ② 内容是**全量**（`showAllSectors` + `showAllEvents` + `IntradayEventBlock showAll`），
 *      ⛔ 绝不沿用卡面「最强 3 个板块」的截断 —— 那会让「完整明细」名不副实；
 *   ③ 自身**可交互**（能滚动），故 `pointer-events` 默认（auto），
 *      并由父级的悬停状态机负责「移进来不关、移出去才关」。
 */
function HoverDetail({
  block,
  topBoard,
  tags,
  reasonByCode,
  x,
  y,
  width,
  height,
  onEnter,
  onLeave,
}: {
  block: TimelineBlock
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  x: number
  y: number
  width: number
  height: number
  onEnter: () => void
  onLeave: () => void
}) {
  // cap 给大值 = 不截断（摘要只用于浮层的**计数行**，列表本身由 SlotBody 全量渲染）
  const summary = summarizeBlock(block, 999)
  const slots = block.kind === 'normal' ? [block.slot] : block.slots
  const range =
    summary.to === summary.at
      ? minToClock(summary.at)
      : `${minToClock(summary.at)}~${minToClock(summary.to)}`
  // 节点偏下 → 浮层往上放（否则会超出画布底部）
  /** 盘外记录（超出交易时段）→ 必须在浮层里当场说明，否则会被误读成盘中记录 */
  const outside =
    summary.at < SESSION_OPEN ? 'pre' : summary.at > SESSION_CLOSE ? 'post' : null
  const above = y > Math.max(DETAIL_FLIP_Y, height * 0.42)
  const left = Math.min(
    Math.max(x, DETAIL_W / 2 + 8),
    Math.max(DETAIL_W / 2 + 8, width - DETAIL_W / 2 - 8),
  )
  return (
    <div
      className="absolute z-30 flex flex-col min-w-0 rounded-[var(--radius-sm)] border border-line-strong bg-card shadow-xl"
      style={{
        width: DETAIL_W,
        maxHeight: `${DETAIL_MAX_VH}vh`,
        left,
        top: above ? y - 16 : y + 34,
        transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
      role="dialog"
      aria-label={`${range} 明细`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <header className="flex-none flex items-baseline gap-2 flex-wrap border-b border-line-faint px-2.5 py-2 min-w-0">
        <span className="num text-[14px] font-semibold text-txt">{range}</span>
        <span className="text-[11px] px-1 rounded-sm bg-line-faint text-sub">
          {KIND_LABEL[block.kind]}
        </span>
        <span className="text-sub text-[11px] min-w-0 break-all">
          {summary.slotCount} 个时刻 · 封板 {summary.stockCount} 只 · 行业 {summary.sectorCount} 个 ·
          盘中板块 ↑{summary.upSectorCount} / ↓{summary.downSectorCount}
        </span>
      </header>

      {outside && (
        <div className="flex-none border-b border-line-faint px-2.5 py-1 text-[10px] text-warn">
          {minToClock(summary.at)} {outside === 'post' ? '盘后' : '盘前'}记录
        </div>
      )}

      {/* 明细主体：**全量**，超出由浮层自身滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 flex flex-col gap-2.5 min-w-0">
        {slots.map((s) => (
          <div key={s.key} className="rounded-[var(--radius-sm)] border border-line p-2 min-w-0">
            <SlotBody
              slot={s}
              topBoard={topBoard}
              tags={tags}
              reasonByCode={reasonByCode}
              showTime={slots.length > 1}
              showAllSectors
              showAllEvents
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 蛇形时间轴主组件。
 *
 * @param width   可选：测试/嵌入时显式给宽。⛔ 不传则用容器实测宽（jsdom 下退化到 fallback）。
 * @param hoverOpenDelayMs  **悬停多久才弹明细**（防抖：扫过密集节点时不闪）。默认 110ms。
 * @param hoverCloseDelayMs **移开多久才收起**。默认 160ms（够移动到浮层里）。
 *   ⚠️ 测试请传 `0` —— 否则每条断言都要等定时器。
 */
export function TimelineSnake({
  blocks,
  topBoard,
  tags,
  reasonByCode,
  width,
  hoverOpenDelayMs = 110,
  hoverCloseDelayMs = 160,
}: {
  blocks: TimelineBlock[]
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  width?: number
  hoverOpenDelayMs?: number
  hoverCloseDelayMs?: number
}) {
  const { width: measured, setEl } = useChartWidth(FALLBACK_WIDTH)
  const W = width ?? measured
  const layout = useMemo(() => layoutSnake({ marks: blocks.map((b) => b.at), width: W }), [blocks, W])

  const [openKey, setOpenKey] = useState<string | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }, [])
  // 卸载时清定时器（否则 setState on unmounted）
  useEffect(() => clearTimers, [clearTimers])

  /** 进入节点：取消待关闭，按 `hoverOpenDelayMs` 决定立刻弹还是稍后弹 */
  const enterNode = useCallback(
    (key: string) => {
      clearTimers()
      if (hoverOpenDelayMs > 0) {
        openTimer.current = setTimeout(() => setOpenKey(key), hoverOpenDelayMs)
      } else {
        setOpenKey(key)
      }
    },
    [clearTimers, hoverOpenDelayMs],
  )

  /** 离开节点：**先不关**，留 `hoverCloseDelayMs` 给「移进浮层」这个动作 */
  const leaveNode = useCallback(() => {
    clearTimers()
    if (hoverCloseDelayMs > 0) {
      closeTimer.current = setTimeout(() => setOpenKey(null), hoverCloseDelayMs)
    } else {
      setOpenKey(null)
    }
  }, [clearTimers, hoverCloseDelayMs])

  /** 鼠标进入浮层 → 撤销刚才的「关闭预约」 */
  const enterDetail = useCallback(() => clearTimers(), [clearTimers])

  /** 节点列表：分块 + 落点 + 摘要（摘要只算一次，⛔ 不在 hover 时重算） */
  const nodes = useMemo(() => {
    const byAt = new Map(layout.points.map((p) => [p.at, p]))
    return blocks
      .map((block) => ({ block, point: byAt.get(block.at) ?? null, summary: summarizeBlock(block) }))
      .filter(
        (n): n is { block: TimelineBlock; point: NonNullable<typeof n.point>; summary: BlockSummary } =>
          n.point != null,
      )
  }, [blocks, layout])

  const openNode = nodes.find((n) => n.block.key === openKey) ?? null

  /**
   * 哪些节点直接标时刻 —— 同层内按 x 从左到右**贪心**挑选（与上一个标签间距 ≥ MIN_LABEL_GAP）。
   * ⛔ 纯函数式，且**确定性**：同一份数据每次选中的都是同一批节点。
   */
  const labeled = useMemo(() => {
    const byLane = new Map<number, typeof nodes>()
    for (const n of nodes) {
      const list = byLane.get(n.point.row)
      if (list) list.push(n)
      else byLane.set(n.point.row, [n])
    }
    const out = new Set<string>()
    for (const list of byLane.values()) {
      const sorted = [...list].sort((a, b) => a.point.x - b.point.x)
      let lastX = Number.NEGATIVE_INFINITY
      for (const n of sorted) {
        // ⛔ 盘外记录**一律标注**（它被夹到边界，没有标签就完全无法辨认）
        if (!n.point.outside && !isNotable(n.summary, n.block)) continue
        if (n.point.x - lastX < MIN_LABEL_GAP) continue
        out.add(n.block.key)
        lastX = n.point.x
      }
    }
    return out
  }, [nodes])

  /** 时间刻度：落在各行内的整点/半点 */
  const ticks = useMemo(
    () => TICK_MINUTES.map((m) => ({ m, ...snakePos(layout, m), label: minToClock(m) })),
    [layout],
  )

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div ref={setEl} className="relative min-w-0" style={{ height: layout.height }}>
        {/* ── 蛇形折线（横走 + 转弯半圆）── */}
        <svg
          width={layout.width}
          height={layout.height}
          className="absolute inset-0 pointer-events-none"
          aria-hidden
        >
          <path
            d={layout.path}
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>

        {/* ── 时间刻度 ── */}
        {ticks.map((t) => (
          <TimeGrid key={t.m} x={t.x} y={t.y} rowHeight={layout.rowHeight} label={t.label} />
        ))}

        {/* ── 行标签（每行的起止时刻；⛔ 用 fromClock 而非 axis）── */}
        {layout.lanes.map((lane) => (
          <span
            key={`lane-${lane.row}`}
            className="absolute text-[9.5px] text-sub whitespace-nowrap pointer-events-none"
            style={{
              left: lane.reversed ? layout.x1 : layout.x0,
              top: lane.y + layout.rowHeight / 2 - 12,
              transform: lane.reversed ? 'translateX(-100%)' : 'none',
            }}
            aria-hidden
          >
            {minToClock(clockOfAxis(lane.fromAxis))} → {minToClock(clockOfAxis(lane.toAxis))}
          </span>
        ))}

        {/* ── 节点（小标记：细竖条，高度编码活跃度；明细走 hover）── */}
        {nodes.map(({ block, point, summary }) => {
          const isOpen = block.key === openKey
          const outsideTag =
            point.outside === 'post' ? '（盘后）' : point.outside === 'pre' ? '（盘前）' : ''
          return (
            <button
              key={block.key}
              type="button"
              // ⛔ 没有 onClick —— 明细由 hover/focus 触发（用户 2026-09-17 明确）
              onMouseEnter={() => enterNode(block.key)}
              onMouseLeave={leaveNode}
              onFocus={() => enterNode(block.key)}
              onBlur={leaveNode}
              className="absolute cursor-help border-0 bg-transparent p-0"
              style={{
                left: point.x,
                top: point.y,
                width: SNAKE_NODE_W,
                height: SNAKE_BAR_MAX_H + 22,
                // 命中区中心对齐落点（竖条再以命中区中心为基准）
                transform: 'translate(-50%, -50%)',
                zIndex: isOpen ? 12 : 10,
              }}
              aria-label={`${minToClock(block.at)}${outsideTag} ${KIND_LABEL[block.kind]} 封板${summary.stockCount}只`}
              // 语义：本按钮会弹出一个浮层（= 明细），展开态由 hover 驱动
              aria-haspopup="dialog"
              aria-expanded={isOpen}
            >
              {/* 展开态描边（⛔ 只作视觉强调，不改命中区尺寸 → 不会造成 hover 抖动） */}
              {isOpen && (
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4px] ring-2 ring-line-strong pointer-events-none"
                  style={{ width: SNAKE_NODE_W - 6, height: SNAKE_BAR_MAX_H + 10 }}
                />
              )}
              {/* 竖条：高度 = 活跃度，颜色 = 性质 */}
              <span
                className={cn(
                  'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none',
                  barTone(summary, block),
                  isOpen && 'ring-2 ring-line-strong',
                )}
                style={{ width: SNAKE_BAR_W, height: barHeight(summary) }}
              />
              {/* 时刻标签：只给显著节点 / 盘外记录，且同层不挤才显示 */}
              {labeled.has(block.key) && (
                <span className="absolute left-1/2 top-0 -translate-x-1/2 num text-[9.5px] text-sub whitespace-nowrap pointer-events-none">
                  {minToClock(block.at)}
                  {point.outside && (
                    <span className="text-warn">{point.outside === 'post' ? '盘后' : '盘前'}</span>
                  )}
                </span>
              )}
            </button>
          )
        })}

        {/* ── 悬停明细浮层（锚定节点 · 可滚动 · 无需点击）── */}
        {openNode && (
          <HoverDetail
            block={openNode.block}
            topBoard={topBoard}
            tags={tags}
            reasonByCode={reasonByCode}
            x={openNode.point.x}
            y={openNode.point.y}
            width={layout.width}
            height={layout.height}
            onEnter={enterDetail}
            onLeave={leaveNode}
          />
        )}
      </div>
    </div>
  )
}
