import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib'
import { useNow } from '@/shared/hooks'
import { useChartWidth } from '@/shared/ui'
import { BlockDetail, blockRangeText, KIND_LABEL } from './BlockDetail'
import { summarizeBlock, type BlockSummary } from '../lib/block-summary'
import { minToClock, SLOT_VISIBLE_SECTORS, type TimelineBlock } from '../lib/timeline'
import {
  layoutSnake,
  shapeBox,
  SHAPE_LEGEND_ORDER,
  SIGNAL_SHAPE,
  snakePos,
  SNAKE_BAR_MAX_H,
  SNAKE_BAR_W,
  SNAKE_NODE_W,
  type SignalKind,
} from '../lib/snake'
import { firstBurstByKey, type StockThemeTag, type ThemeBurst } from '../lib/theme-burst'

/**
 * 图例：轴上每种图形代表什么（2026-10-18 用户要求「时间轴顶部给每个图形做解释」）。
 *
 * ⛔ 图例与节点渲染**共用** `SIGNAL_SHAPE` + `shapeBox` —— 各写一套的话，
 * 改形状时必然出现「图例是三角、轴上是圆」的静默漂移。
 */
const LEGEND_TONE: Record<SignalKind, string> = {
  burst: 'bg-up',
  risk: 'bg-down',
  linkage: 'bg-up',
  up: 'bg-up/70',
  rotation: 'border border-rec bg-transparent',
  system: 'bg-line-strong',
  normal: 'bg-sub',
}

const LEGEND_SIZE = 15

export function ShapeLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-sm border border-line-faint bg-line-faint/40 px-2.5 py-1.5',
        className,
      )}
      aria-label="时间轴图形说明"
    >
      <span className="text-[10.5px] font-semibold tracking-[0.1em] text-sub">图形说明</span>
      {SHAPE_LEGEND_ORDER.map((kind) => {
        const spec = SIGNAL_SHAPE[kind]
        const box = shapeBox(spec.shape, LEGEND_SIZE)
        return (
          <span
            key={kind}
            className="flex items-center gap-1 text-[11px] text-sub"
            title={spec.desc}
            data-legend-kind={kind}
          >
            <span className="flex h-[16px] w-[16px] flex-none items-center justify-center">
              <span
                className={cn('inline-block', LEGEND_TONE[kind])}
                style={{
                  width: box.width,
                  height: box.height,
                  clipPath: box.clipPath,
                  borderRadius: box.borderRadius,
                  borderWidth: box.borderWidth,
                  borderStyle: box.borderWidth ? 'solid' : undefined,
                }}
              />
            </span>
            {spec.label}
          </span>
        )
      })}
      <span className="text-[10.5px] text-sub">图标等大 · 竖线高度 = 活跃度</span>
    </div>
  )
}

/**
 * **蛇形时间轴**（boustrophedon）—— 固定四段从 09:25 横走、经半圆弯道反向连接。
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
 * · **宽度跟容器、四段高度固定**（上午两根、下午两根）—— ⛔ 禁 `w-full h-auto`
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
/** 明细浮层宽度（px）—— 2026-09-20 用户「卡片 hover 可以显示大一点」：700 → 980 */
const DETAIL_W = 980
/** 明细浮层最大高度（vh）—— 超出则浮层内部滚动（62 → 76，配合宽度一起放大） */
const DETAIL_MAX_VH = 76
/** 浮层「往上放还是往下放」的 y 判定阈值（px） */
const DETAIL_FLIP_Y = 300

/** 时间刻度：整点 + 下午半点 —— 给「横轴读到哪一段」一个参照 */
const TICK_MINUTES = [10 * 60, 11 * 60, 13 * 60 + 30, 14 * 60, 14 * 60 + 30, 15 * 60]

/** 午间断点的轻量 AI 短线语录：只作节奏提示，不参与任何行情或策略计算。 */
const AI_TRADER_QUOTES = [
  '主线不在预测里，在资金的持续回流里。',
  '先看情绪，再看题材，最后才看个股。',
  '分歧不是退场信号，承接消失才是。',
  '强者恒强，但只在结构仍强时成立。',
  '不追最后一棒，只跟最清晰的共振。',
] as const

/**
 * 竖条颜色 = 该刻**性质**（涨红 / 跌绿 / 题材紫 / 普通灰）。
 * ⛔ 与卡片流的判断顺序同源（联动 > 杀跌 > 题材 > 合并 > 普通），免得同一时刻两种视图颜色不一致。
 *
 * ## ⚡ 2026-10-18 用户定调：题材爆发改「大红」，与题材紫分家
 *
 * 原实现把「题材新爆发」也画成 `bg-rec`（紫），与「轮动/回流」同色，用户看不出
 * 「这条线是今天第一次炸」还是「只是又轮动了一下」——原话：
 * 「低空经济首次爆发……可以跟这个紫色再做一个区分，变为大红色……后面继续走强也保持红色，
 *   字体稍微大一点，突出这个题材牛逼」。
 *
 * 现规则（两档，都红）：
 *   · **首爆**（该题材当日第一次爆发）→ 实心大红 `bg-up` + 竖条加宽 3px + 标签加粗放大，文案带「首爆」；
 *   · **续爆**（同一题材后续再爆发/走强）→ `bg-up/80`（仍是红，弱半档），文案带「续强」；
 *   · **轮动/回流** 保持紫色空心 —— 紫色从此只表示「不是新爆发」。
 */
function barVisual(s: BlockSummary, block: TimelineBlock, firstBurst = false): {
  kind: SignalKind
  className: string
  width: number
  title: string
} {
  // 颜色表示方向与题材，宽度/空心表示事件类型；不能只靠色相区分。
  // 联动 = 菱形（原 `ring-1` 在裁剪成菱形后会变成一圈怪边，故只用实心底色）
  if (block.kind === 'linkage') return { kind: 'linkage', className: 'bg-up', width: 14, title: '多板块联动' }
  if (s.fade.length > 0 || s.downSectorCount > 0 || s.otherDownCount > 0) return { kind: 'risk', className: 'bg-down', width: SNAKE_BAR_W, title: '风险或负反馈' }
  if (s.burst.length > 0) {
    return firstBurst
      ? { kind: 'burst', className: 'bg-up', width: SNAKE_BAR_W + 3, title: '题材首次爆发' }
      : { kind: 'burst', className: 'bg-up/80', width: SNAKE_BAR_W, title: '题材继续走强' }
  }
  // 轮动 = 空心圆（描边紫，内部透明 → 一眼区分「不是新爆发」）
  if (s.rotated.length > 0) return { kind: 'rotation', className: 'border border-rec bg-transparent', width: SNAKE_BAR_W, title: '题材轮动或回流' }
  if (s.upSectorCount > 0 || s.otherUpCount > 0) return { kind: 'up', className: 'bg-up/70', width: SNAKE_BAR_W, title: '盘中走强' }
  if (block.kind === 'merged') return { kind: 'system', className: 'bg-line-strong', width: SNAKE_BAR_W, title: '低频系统记录' }
  return { kind: 'normal', className: 'bg-sub', width: SNAKE_BAR_W, title: '盘中事实' }
}

/** 该刻的**活跃度**（用于竖条高度）—— 收盘口径个股 + 盘中板块事件 + 题材信号权重 */
function activityOf(s: BlockSummary): number {
  return (
    s.stockCount +
    s.otherUpCount +
    s.otherDownCount +
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
    // 轮动题材也要标名字（2026-09-20 用户「其他的题材全部都没看到了」）——
    // 不标的话，仅轮动的题材在轴上依然不可见，等于白标记
    s.rotated.length > 0 ||
    s.fade.length > 0 ||
    s.sectorCount >= SLOT_VISIBLE_SECTORS ||
    s.upSectorCount + s.downSectorCount >= 1
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
  themeInfo,
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
  /** 题材名 → 当日全貌（催化 / 成员 / 观测时刻）—— 详情里才展开，卡面不展开 */
  themeInfo?: Map<string, ThemeBurst>
  x: number
  y: number
  width: number
  height: number
  onEnter: () => void
  onLeave: () => void
}) {
  /** 节点偏下 → 浮层往上放（否则会超出画布底部） */
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
      aria-label={`${blockRangeText(block)} 明细`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* ⛔ 明细内容**只此一处**（`BlockDetail`）—— 与左栏详情列表共用，防两处漂移 */}
      <BlockDetail
        block={block}
        topBoard={topBoard}
        tags={tags}
        reasonByCode={reasonByCode}
        themeInfo={themeInfo}
        scrollBody
      />
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
  themeInfo,
  focusKey,
  width,
  hoverOpenDelayMs = 110,
  hoverCloseDelayMs = 160,
}: {
  blocks: TimelineBlock[]
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  /** 题材名 → 当日全貌（催化 / 成员 / 观测时刻）—— 只在 hover 明细里展开 */
  themeInfo?: Map<string, ThemeBurst>
  /**
   * 外部聚焦的节点 key（2026-09-22）—— 左栏节点列表点击时传入，
   * 打开/强调对应节点的明细（与 hover 共用同一 `openKey` 状态）。
   * ⛔ 可选：不传则行为与改动前完全一致（纯 hover 驱动）。
   */
  focusKey?: string
  width?: number
  hoverOpenDelayMs?: number
  hoverCloseDelayMs?: number
}) {
  const { width: measured, setEl } = useChartWidth(FALLBACK_WIDTH)
  // 与盘中轮询同量级轮换，不写入数据流，也不影响事件轴的坐标或排序。
  const now = useNow(30_000)
  const W = width ?? measured
  const layout = useMemo(() => layoutSnake({ marks: blocks.map((b) => b.at), width: W }), [blocks, W])
  const aiQuote = AI_TRADER_QUOTES[Math.floor(now.getTime() / 30_000) % AI_TRADER_QUOTES.length]
  const noonSeamY = layout.lanes[1].y + layout.rowHeight / 2

  /**
   * hover 打开的节点（内部状态）。
   * ⛔ 外部聚焦（左栏点击传入的 `focusKey`）**不写进这份 state** ——
   *    改由渲染期派生 `openKey`（见下），否则要在 effect 里 setState，React Compiler 会拦。
   */
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  /**
   * 实际打开的节点 = hover 优先，否则回落到外部聚焦。
   * `focusKey` 为空串/undefined 时回落 `null`（首次渲染不凭空空弹）。
   */
  const openKey = hoverKey ?? (focusKey || null)
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
        openTimer.current = setTimeout(() => setHoverKey(key), hoverOpenDelayMs)
      } else {
        setHoverKey(key)
      }
    },
    [clearTimers, hoverOpenDelayMs],
  )

  /** 离开节点：**先不关**，留 `hoverCloseDelayMs` 给「移进浮层」这个动作 */
  const leaveNode = useCallback(() => {
    clearTimers()
    if (hoverCloseDelayMs > 0) {
      closeTimer.current = setTimeout(() => setHoverKey(null), hoverCloseDelayMs)
    } else {
      setHoverKey(null)
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

  /**
   * 首爆判定（2026-10-18 用户要求）：按**时间顺序**扫一遍，题材名第一次出现在
   * `burst` 里的那个节点 = 首爆；之后再爆发 = 续强。
   *
   * ⛔ 必须跨节点累积，不能只看单节点 —— `summarizeBlock` 只回答「这一块有没有爆发」，
   *    同一个题材一天爆发 3 次时它三次都返回 burst，无法区分「第一次」。
   */
  const firstBursts = useMemo(
    () => firstBurstByKey(nodes.map((n) => ({ key: n.block.key, burst: n.summary.burst }))),
    [nodes],
  )

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
      /**
       * ⛔ **题材节点优先占位**（2026-09-20 用户「其他的题材全部都没看到了」）：
       *
       * 旧实现是「按 x 从左到右贪心」—— 先到的普通时刻标签会把题材名挤掉，
       * 于是密集段落里的题材在轴上彻底不可见（等于没标记）。
       * 现改为**两轮**：① 先让带题材名（爆发/轮动）的节点占位；
       * ② 再用剩余空间给普通节点标时刻。间距判据对**已放置的全部标签**成立（不是只比前一个）。
       */
      const hasTheme = (n: (typeof sorted)[number]) =>
        n.summary.burst.length > 0 || n.summary.rotated.length > 0
      const ordered = [
        ...sorted.filter(hasTheme),
        ...sorted.filter((n) => !hasTheme(n)),
      ]
      const placed: number[] = []
      for (const n of ordered) {
        // ⛔ 盘外记录**一律标注**（它被夹到边界，没有标签就完全无法辨认）
        if (!n.point.outside && !isNotable(n.summary, n.block)) continue
        if (placed.some((x) => Math.abs(n.point.x - x) < MIN_LABEL_GAP)) continue
        out.add(n.block.key)
        placed.push(n.point.x)
      }
    }
    return out
  }, [nodes])

  /** 时间刻度：落在各行内的整点/半点 */
  const ticks = useMemo(
    () => TICK_MINUTES.map((m) => ({ m, ...snakePos(layout, m), label: minToClock(m) })),
    [layout],
  )

  /**
   * 相邻分钟的可视竖条可只隔约 22px，而旧命中区为 26px，会让后一个节点遮住前一个。
   * 按同一行相邻落点收窄命中区，保证密集时每个分钟节点仍可独立 hover。
   */
  const hitWidthByKey = useMemo(() => {
    const widths = new Map<string, number>()
    const byRow = new Map<number, typeof nodes>()
    for (const node of nodes) {
      const row = byRow.get(node.point.row)
      if (row) row.push(node)
      else byRow.set(node.point.row, [node])
    }
    for (const row of byRow.values()) {
      const ordered = [...row].sort((a, b) => a.point.x - b.point.x)
      ordered.forEach((node, index) => {
        const before = index > 0 ? Math.abs(node.point.x - ordered[index - 1].point.x) : SNAKE_NODE_W
        const after = index < ordered.length - 1 ? Math.abs(ordered[index + 1].point.x - node.point.x) : SNAKE_NODE_W
        // 不低于竖条宽度，避免密集时把可视标记变成难以操作的像素点。
        widths.set(node.block.key, Math.max(SNAKE_BAR_W, Math.min(SNAKE_NODE_W, before, after)))
      })
    }
    return widths
  }, [nodes])

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

        {/* ── 行标签（固定四段的墙上时钟范围）── */}
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
            {minToClock(lane.fromClock)} → {minToClock(lane.toClock)}
          </span>
        ))}

        {/* 午间停盘不是一条事件：用独立分隔带明确上午与下午的“换手”，不污染时间轴数据。 */}
        <div
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: noonSeamY, transform: 'translateY(-50%)' }}
          aria-label="黄金分割线 · AI短线语录"
        >
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-strong/80" />
          <span className="relative mx-auto flex w-max max-w-[86%] items-center gap-2 rounded-full border border-line bg-card px-3 py-1 shadow-sm">
            <span className="text-[10.5px] font-semibold tracking-[0.14em] text-lead whitespace-nowrap">黄金分割线</span>
            <span className="h-3 w-px bg-line" />
            <span className="max-w-[360px] truncate text-[11.5px] text-sub">AI短线语录 · {aiQuote}</span>
          </span>
        </div>

        {/* ── 节点（小标记：细竖条，高度编码活跃度；明细走 hover）── */}
        {nodes.map(({ block, point, summary }) => {
          const isOpen = block.key === openKey
          const firstBurstThemes = firstBursts.get(block.key)
          const isFirstBurst = !!firstBurstThemes?.length
          const visual = barVisual(summary, block, isFirstBurst)
          const shape = SIGNAL_SHAPE[visual.kind].shape
          const box = shapeBox(shape, barHeight(summary), visual.width)
          const hitWidth = hitWidthByKey.get(block.key) ?? SNAKE_NODE_W
          const outsideTag =
            point.outside === 'post' ? '（盘后）' : point.outside === 'pre' ? '（盘前）' : ''
          /**
           * 轴上直接标出的**板块名**（用户 2026-09-20「按照板块和时间节点添加到时间轴上」）：
           *   · 新崛起 → `🚀题材名`（实心紫 = 强）
           *   · 仅龙头轮动 → `题材名`（淡紫 = 弱一档，⛔ 不带 🚀）
           * 多题材只列第一个 + `+N` 防叠字；完整名单在 hover 明细里。
           */
          /**
           * 轴上题材名（用户 2026-10-18：首爆要「大红 + 字号大一点」突出）：
           *   首爆 → `首爆·低空经济`（大红加粗 11.5px）
           *   续强 → `续强·低空经济`（红 11px，弱半档）
           *   轮动 → `题材名`（紫 9.5px，保持原样）
           */
          const burstLead = isFirstBurst ? firstBurstThemes![0] : summary.burst[0]?.theme
          const extraBurst = summary.burst.length > 1 ? `+${summary.burst.length - 1}` : ''
          const themeTag =
            summary.burst.length > 0 && burstLead
              ? {
                  kind: (isFirstBurst ? 'first' : 'follow') as 'first' | 'follow',
                  text: `${isFirstBurst ? '首爆' : '续强'}·${burstLead}${extraBurst}`,
                }
              : summary.rotated.length > 0
                ? {
                    kind: 'rotation' as const,
                    text: `${summary.rotated[0].theme}${summary.rotated.length > 1 ? `+${summary.rotated.length - 1}` : ''}`,
                  }
                : summary.upSectors.length > 0
                  ? { kind: 'plain' as const, text: `${summary.upSectors[0].name}走强` }
                  : summary.downSectors.length > 0
                    ? { kind: 'plain' as const, text: `${summary.downSectors[0].name}走弱` }
                    : null
          return (
            <button
              key={block.key}
              type="button"
              // ⛔ 没有 onClick —— 明细由 hover/focus 触发（用户 2026-09-17 明确）
              onMouseEnter={() => enterNode(block.key)}
              onMouseLeave={leaveNode}
              onFocus={() => enterNode(block.key)}
              onBlur={leaveNode}
              className="absolute cursor-pointer border-0 bg-transparent p-0"
              style={{
                left: point.x,
                top: point.y,
                width: hitWidth,
                height: SNAKE_BAR_MAX_H + 22,
                // 命中区中心对齐落点（竖条再以命中区中心为基准）
                transform: 'translate(-50%, -50%)',
                zIndex: isOpen ? 12 : 10,
              }}
              aria-label={`${minToClock(block.at)}${outsideTag} ${KIND_LABEL[block.kind]} 封板${summary.stockCount}只${
                // 该刻爆发的题材名直接进无障碍名字 —— 节点要能「按板块」被识别
                summary.burst.length > 0 ? ` 题材${summary.burst.map((b) => b.theme).join('、')}` : ''
              }${
                summary.rotated.length > 0
                  ? ` 题材轮动${summary.rotated.map((r) => r.theme).join('、')}`
                  : ''
              }`}
              // 语义：本按钮会弹出一个浮层（= 明细），展开态由 hover 驱动
              aria-haspopup="dialog"
              aria-expanded={isOpen}
            >
              {/* 展开态描边（⛔ 只作视觉强调，不改命中区尺寸 → 不会造成 hover 抖动） */}
              {isOpen && (
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4px] ring-2 ring-line-strong pointer-events-none"
                  style={{ width: Math.max(SNAKE_BAR_W, hitWidth - 6), height: SNAKE_BAR_MAX_H + 10 }}
                />
              )}
              {/* 竖条：高度 = 活跃度，颜色 = 性质 */}
              {/*
                形状 = 信号性质（2026-10-18 用户：不再全部用椭圆柱体）：
                ▲首爆 ▼风险 ◆联动 ●走强 ○轮动 ■记录 │普通。
                图标**等大**（不随活跃度缩放，2026-10-18 用户：「不要忽大忽小」）；
                活跃度只由细竖线的高度表达 —— 见 `lib/snake.ts` 的 SHAPE_ICON_SIZE。
              */}
              <span
                className={cn(
                  'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none',
                  visual.className,
                  isOpen && 'ring-2 ring-line-strong',
                )}
                style={{
                  width: box.width,
                  height: box.height,
                  clipPath: box.clipPath,
                  borderRadius: box.borderRadius,
                  borderWidth: box.borderWidth,
                  borderStyle: box.borderWidth ? 'solid' : undefined,
                }}
                data-node-kind={visual.kind}
                data-node-shape={shape}
                title={visual.title}
              />
              {/* 时刻标签：只给显著节点 / 盘外记录，且同层不挤才显示 */}
              {labeled.has(block.key) && (
                <span className="absolute left-1/2 top-0 -translate-x-1/2 num text-[9.5px] text-sub whitespace-nowrap pointer-events-none">
                  {minToClock(block.at)}
                  {point.outside && (
                    <span className="text-warn">{point.outside === 'post' ? '盘后' : '盘前'}</span>
                  )}
                  {themeTag && (
                    <span
                      className={cn(
                        'ml-1',
                        themeTag.kind === 'first' && 'text-[11.5px] font-bold text-up',
                        themeTag.kind === 'follow' && 'text-[11px] font-semibold text-up/90',
                        themeTag.kind === 'rotation' && 'text-rec',
                        themeTag.kind === 'plain' && 'text-rec/60',
                      )}
                      data-burst={themeTag.kind === 'first' ? 'first' : themeTag.kind === 'follow' ? 'follow' : undefined}
                    >
                      {themeTag.text}
                    </span>
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
            themeInfo={themeInfo}
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
