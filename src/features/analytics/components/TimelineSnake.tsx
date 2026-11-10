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
  SHAPE_ICON_SIZE,
  SHAPE_LEGEND_ORDER,
  SIGNAL_SHAPE,
  snakePos,
  SNAKE_BAR_MAX_H,
  SNAKE_BAR_W,
  SNAKE_NODE_W,
  type SignalKind,
  type SignalShape,
} from '../lib/snake'
import { normTheme, type StockThemeTag, type ThemeBurst } from '../lib/theme-burst'

/**
 * 图例：轴上每种图形代表什么（2026-10-18 用户要求「时间轴顶部给每个图形做解释」）。
 *
 * ⛔ 图例与节点渲染**共用** `SIGNAL_SHAPE` + `shapeBox` —— 各写一套的话，
 * 改形状时必然出现「图例是三角、轴上是圆」的静默漂移。
 */
const LEGEND_TONE: Record<SignalKind, string> = {
  burst: 'text-rec',
  broken: 'text-break',
  risk: 'text-down',
  linkage: 'bg-up',
  up: 'bg-up/70',
  rotation: 'border border-rec bg-transparent',
  system: 'bg-line-strong',
  normal: 'bg-sub',
}

const LEGEND_SIZE = 15

/**
 * hover 高亮环直径。19px = 14px 图标 + 2.5px 呼吸边。
 *
 * ⛔ 不能再大：相邻节点间距中位 ~23px，22px 的环已经会蹭到隔壁图标，
 *    在一串密集风险节点上看起来像「两个节点都被选中」。
 */
const HOVER_RING = 19

/** 四角星：四向尖角 + 凹边贝塞尔（14px 下是「亮点炸开」，不是几何三角） */
const SPARKLE_PATH =
  'M7 0 C7.55 4.45 9.55 6.45 14 7 C9.55 7.55 7.55 9.55 7 14 C6.45 9.55 4.45 7.55 0 7 C4.45 6.45 6.45 4.45 7 0 Z'

/** 叉：两条圆头斜线（最通用的「否定/异常」符号） */
const CROSS_PATH = 'M3.6 3.6 L10.4 10.4 M10.4 3.6 L3.6 10.4'

/**
 * 形状标记 —— 节点与图例**唯一**的绘制出口（2026-10-20 抽出）。
 *
 * ⛔ 抽出来的理由：形状规范化之后，节点和图例各写一遍 `clipPath` / `borderRadius` 分支，
 *    改形状时必然出现「图例是星、轴上是三角」的静默漂移 —— 页面不会报错，只有肉眼能发现。
 *    尖角形状（星/叉）走 SVG，几何形状（圆/方/菱形）走 CSS，两路都在这一个函数里分支。
 */
function ShapeMark({
  shape,
  height = SHAPE_ICON_SIZE,
  tone,
  className,
  title,
  nodeKind,
  glow = false,
}: {
  shape: SignalShape
  height?: number
  tone: string
  className?: string
  title?: string
  /** 只有**轴上的节点**才传；图例不传（否则会把图例算进节点统计） */
  nodeKind?: SignalKind
  /**
   * 同色柔和光晕（2026-10-20 用户：「加一圈很淡的同色光晕」）。
   * 用 `drop-shadow` 而不是再画一个圆：圆是实心的会盖住形状边缘，
   * drop-shadow 是**沿轮廓**扩散，星形的四个尖角会自然带出一圈光。
   */
  glow?: boolean
}) {
  const box = shapeBox(shape, height)
  const boxStyle = { width: box.width, height: box.height }
  const common = {
    title,
    'data-node-kind': nodeKind,
    'data-node-shape': nodeKind ? shape : undefined,
  }

  if (box.glyph) {
    return (
      <svg
        viewBox="0 0 14 14"
        className={cn(
          'inline-block overflow-visible',
          tone,
          className,
        )}
        style={boxStyle}
        aria-hidden
        {...common}
      >
        {box.glyph === 'ring-gap' ? (
          /*
          炸板 = **缺口圆环**（黄色）：一圈「板」被打掉一块。
          ⛔ 用 stroke-dasharray 而不是剪裁：缺口是「线断掉」的语义，
             剪掉一块扇形会变成「饼图」，读不出「环被打开」。
          */
          <circle
            cx={7}
            cy={7}
            r={5.2}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeDasharray="25 7"
            strokeLinecap="round"
            transform="rotate(-90 7 7)"
          />
        ) : box.glyph === 'sparkle' ? (
          <>
            {/*
              光晕 = **同形状放大 1.4/1.8 倍的淡紫**，不是 drop-shadow。
              ⛔ 为什么不用 `filter: drop-shadow(0 0 4px currentColor)`：
                 14px 的星在 4px 模糊下几乎看不出（实测截图），加大到 9px 又会糊到隔壁节点。
                 同形状外扩是可控的：形状完全同构、透明度固定、尺寸精确。
              ⛔ svg 必须 `overflow-visible`，否则外扩部分被 14×14 的 viewBox 裁掉。
            */}
            {glow && (
              <>
                <path
                  d={SPARKLE_PATH}
                  fill="currentColor"
                  opacity={0.22}
                  transform="translate(7 7) scale(1.42) translate(-7 -7)"
                />
                <path
                  d={SPARKLE_PATH}
                  fill="currentColor"
                  opacity={0.11}
                  transform="translate(7 7) scale(1.85) translate(-7 -7)"
                />
              </>
            )}
            <path d={SPARKLE_PATH} fill="currentColor" />
          </>
        ) : (
          // 2.2 在 14 的 viewBox 里 → 缩到 11px 后视觉约 1.7px；用 2.4 会糊成一团墨点
          <path
            d={CROSS_PATH}
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
    )
  }

  return (
    <span
      className={cn('inline-block', tone, className)}
      style={{
        ...boxStyle,
        clipPath: box.clipPath,
        borderRadius: box.borderRadius,
        borderWidth: box.borderWidth,
        borderStyle: box.borderWidth ? 'solid' : undefined,
      }}
      {...common}
    />
  )
}

/**
 * 轴上的一枚标签 + 它的引导线（2026-10-20 抽出）。
 *
 * ⛔ 上下两侧各渲染一次，互不感知 —— 这是「一个节点同时显示上下两条线路」的落点。
 * ⛔ 位置与线长完全由 `slot.tier` 决定，⛔ 不要在这里再算避让：
 *    排版决策全部发生在 `labelSlots`（那里才知道同层还有谁）。
 */
function LabelChip({
  slot,
  dir,
  clock,
  outside,
}: {
  slot: LabelSlot
  dir: SnakeLabelDir
  clock: string
  outside: 'pre' | 'post' | null
}) {
  const isUp = dir === 'up'
  const tag = slot.tag
  return (
    <>
      {/* 引导线：第 0 层也画（长度 = LEADER_DROP），否则贴轴的标签找不到对应节点 */}
      <span
        className={cn(
          'absolute left-1/2 -translate-x-1/2 w-px pointer-events-none',
          slot.tone === 'rec'
            ? 'bg-rec/45'
            : slot.tone === 'up'
              ? 'bg-up/45'
              : slot.tone === 'news'
                ? 'bg-line-strong/70'
                : slot.tone === 'break'
                  ? 'bg-break/45'
                  : 'bg-down/45',
        )}
        style={
          isUp
            ? { bottom: HIT_H - LEADER_DROP, height: slot.tier * LABEL_STEP + LEADER_DROP }
            : { top: HIT_H - LEADER_DROP, height: slot.tier * LABEL_STEP + LEADER_DROP }
        }
        data-label-leader={slot.tier}
        data-label-dir={dir}
      />
      <span
        className="absolute left-1/2 -translate-x-1/2 num text-11 text-txt whitespace-nowrap pointer-events-none"
        style={isUp ? { bottom: HIT_H + slot.tier * LABEL_STEP } : { top: HIT_H + slot.tier * LABEL_STEP }}
        data-label-tier={slot.tier}
        data-label-dir={dir}
      >
        {/* 紧凑形态不带时刻（见 `SnakeThemeTag.compact`）；ml-1 也不加，省下每一像素 */}
        {!tag?.compact && clock}
        {outside && <span className="text-warn">{outside === 'post' ? '盘后' : '盘前'}</span>}
        {tag && (
          <span
            className={cn(
              tag.compact ? undefined : 'ml-1',
              tag.kind === 'first' && 'text-12 font-bold text-rec',
              tag.kind === 'follow' && 'text-11 font-semibold text-rec/80',
              tag.kind === 'rotation' && 'text-rec',
              // 走强红、走弱绿 —— 与引导线同色，除「上/下」之外还能直接读强弱
              tag.kind === 'plain' && (tag.dir === 'down' ? 'text-down/75' : 'text-up/75'),
              // 消息面：中性深灰（既不是机会红也不是风险绿），带「消息·」前缀自解释
              tag.kind === 'news' && 'text-txt/70',
              // 短线精灵异动：机会向（半档紫），但比板块走强弱 —— 它没有题材归属
              tag.kind === 'signal' && 'text-rec/70',
              // 炸板：琥珀（与轴上黄环同色，一眼认得「这是涨停被打断」）；
              // 70% 透明 —— 用户定过「炸板降权」，弱化但不隐藏
              tag.kind === 'break' && 'text-break/70',
            )}
            data-burst={tag.kind === 'first' ? 'first' : tag.kind === 'follow' ? 'follow' : undefined}
          >
            {tag.text}
          </span>
        )}
      </span>
    </>
  )
}

export function ShapeLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm border border-line-faint bg-line-faint/40 px-2 py-1',
        className,
      )}
      aria-label="时间轴图形说明"
    >
      <span className="text-11 font-semibold tracking-[0.1em] text-txt">图形说明</span>
      {SHAPE_LEGEND_ORDER.map((kind) => {
        const spec = SIGNAL_SHAPE[kind]
        return (
          <span
            key={kind}
            className="flex items-center gap-1 text-10 text-txt/85"
            title={spec.desc}
            data-legend-kind={kind}
          >
            <span className="flex h-[16px] w-[16px] flex-none items-center justify-center">
              <ShapeMark
                shape={spec.shape}
                height={LEGEND_SIZE}
                tone={LEGEND_TONE[kind]}
              />
            </span>
            {spec.label}
          </span>
        )
      })}
      <span className="text-10 text-sub">图标等大 · 竖线高度 = 活跃度</span>
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
/**
 * 明细浮层宽度（px）—— **跟着内容走，不是跟着容器走**。
 *
 * ⚠️ 2026-10-22 用户两次纠正：
 *   ①「弹窗宽度自适应」→ 我把写死的 980 换成 `容器×0.82`；
 *   ②「弹窗的宽度自适应啊。弹窗宽度没有自适应，现在宽度很宽，留白太大了！！」
 *      —— 对，那只是**换了个固定值**：14:30 那种只有 4 行的节点照样 1052px，右边全空。
 *
 * ## 为什么不直接用 CSS `width: max-content`
 *
 * 实测过，不行：`max-content` 取的是「所有子项不换行时的最大宽」，而本组件内部大量用
 * `flex flex-wrap` + `grid(1fr)`：
 *   · `flex-wrap` 的子项在 `max-content` 下**不撑开**，反而被压；
 *   · `grid` 的 `1fr` 在 `max-content` 下算 0。
 * 结果 09:31（37 行内容）只算出 365px、高 548px —— 内容被挤成一列，比原来看。
 *
 * 故改为**按内容量估算**：条目越多越宽，到 `DETAIL_W_MAX` 封顶；内容少就窄。
 * 估算用的是可数的业务量（板块/个股/事件条数），⛔ 不读 DOM（读 DOM 要两帧、会闪）。
 */
const DETAIL_W_MIN = 340
const DETAIL_W_MAX = 1180
/** 估算：每「视觉行」占多少宽度（含缩进与列间距的空隙） */
const DETAIL_LINE_W = 24
/** 估算：基础宽度（时刻 + 类型标签 + 计数那一行本身） */
const DETAIL_BASE_W = 330
/** 浮层与容器左右边的最小留白（px）—— 贴边会看不清边界 */
const DETAIL_EDGE = 16
/** 明细浮层最大高度（vh）—— 超出则浮层内部滚动（62 → 76，配合宽度一起放大） */
const DETAIL_MAX_VH = 76
/** 浮层「往上放还是往下放」的 y 判定阈值（px） */
const DETAIL_FLIP_Y = 300

/**
 * 浮层**字号缩放**（2026-10-22 用户：「字体放大一点」）。
 *
 * ⛔ 为什么用 `zoom` 而不是逐个改 `text-11`：详情内容是 `SlotBody` +
 *    `IntradayEventLine` + `StockRow` + `EventSlot` 六七个组件拼的，逐个改字号
 *    必然漏一两处，出现「题材名 13.5px、股票名 12px、事件 11.5px」的混排错位。
 *    `zoom` 是**整块等比放大**（字号/间距/圆角一起），不会互相错位；且真实布局重算，
 *    文字不发虚。改一个数就能整体调，好回退。
 */
const DETAIL_ZOOM = 1.15

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
 * ## ⚡ 2026-10-20（下半场）用户再改口：首爆回到**紫色 + 同色光晕**
 *
 * 「首爆改为紫色，然后加一圈很淡的同色光晕！」
 *
 * 现规则（两档，都紫）：
 *   · **首爆**（该题材当日第一次出现在轴上）→ 实心紫四角星 + **一圈很淡的同色光晕** + 标签加粗放大；
 *   · **续强**（同一题材后续再爆发）→ 60% 紫四角星（无光晕），文案带「续强」；
 *   · **轮动/回流** 仍是紫色空心圆 —— 与首爆靠**形状**分开（星 vs 空心圆），不再靠色相。
 *
 * ⛔ 光晕只给首爆：它承担「强调」职责。给续强也加，密集段落会连成一片紫雾，
 *    反而把首爆淹掉（同一天续强节点是首爆的数倍）。
 * ⚠️ 2026-10-20 早些时候：「首爆和风险换一个 icon，这个红绿三角不好看」→ 三角改星/叉。
 */
function barVisual(
  s: BlockSummary,
  block: TimelineBlock,
  firstBurst = false,
  /**
   * 该节点**上区标签的类型**（`labelSlots` 已经算好）。
   *
   * ⛔ 2026-10-20 用户：「如果标题写的是首爆，那么这 icon 也改成首爆，不要显示为其他的 icon，
   *    那样子的话不统一！」
   *    标签文案与节点形状原本是两套独立判据：标签按「首次出现」判首爆（`firstSeen`），
   *    形状按「有没有 burst 事件」判 —— 于是会出现「标题写首爆·国产芯片，图标却是红圆」。
   *    现在只要**标签是首爆/续强**，形状一律让位给紫星；反之亦然。
   */
  tagKind?: SnakeThemeTag['kind'],
): {
  kind: SignalKind
  className: string
  width: number
  title: string
} {
  // 标题与图标必须统一：标签说首爆/续强 → 图标就是星（压过联动/风险/走强的形状判定）
  if (tagKind === 'first' || tagKind === 'follow') {
    return tagKind === 'first'
      ? { kind: 'burst', className: 'text-rec', width: SNAKE_BAR_W, title: '题材首次爆发' }
      : { kind: 'burst', className: 'text-rec/60', width: SNAKE_BAR_W, title: '题材继续走强' }
  }
  // 颜色表示方向与题材，宽度/空心表示事件类型；不能只靠色相区分。
  // 联动 = 菱形（原 `ring-1` 在裁剪成菱形后会变成一圈怪边，故只用实心底色）
  if (block.kind === 'linkage') return { kind: 'linkage', className: 'bg-up', width: 14, title: '多板块联动' }
  // 走弱同理分两档：板块杀跌 = 满色绿叉（异动，必须看见）；纯个股回落 = 35% 绿（背景）
  if (s.fade.length > 0 || s.downSectorCount > 0) return { kind: 'risk', className: 'text-down/70', width: SNAKE_BAR_W, title: '板块走弱或负反馈' }
  if (s.otherDownCount > 0) return { kind: 'risk', className: 'text-down/35', width: SNAKE_BAR_W, title: '个股走弱' }
  if (s.burst.length > 0) {
    return firstBurst
      ? { kind: 'burst', className: 'text-rec', width: SNAKE_BAR_W, title: '题材首次爆发' }
      : { kind: 'burst', className: 'text-rec/60', width: SNAKE_BAR_W, title: '题材继续走强' }
  }

  // 轮动 = 空心圆（描边紫，内部透明 → 一眼区分「不是新爆发」）
  if (s.rotated.length > 0) return { kind: 'rotation', className: 'border border-rec bg-transparent', width: SNAKE_BAR_W, title: '题材轮动或回流' }
  /**
   * 走强分两档（2026-10-20 用户：「单独的个股提示可以减弱，但类似板块异动的这种一定要提示出来」）：
   *   · 有**板块**走强 → 实心红圆，满色（这是要看见的异动）
   *   · 只有**个股**走强 → 同形状但 35% 红（背景信息，不抢板块的眼）
   */
  if (s.upSectorCount > 0) return { kind: 'up', className: 'bg-up/70', width: SNAKE_BAR_W, title: '板块走强' }
  if (s.otherUpCount > 0) return { kind: 'up', className: 'bg-up/35', width: SNAKE_BAR_W, title: '个股走强' }
  if (block.kind === 'merged') return { kind: 'system', className: 'bg-line-strong', width: SNAKE_BAR_W, title: '低频系统记录' }
  /**
   * 炸板（涨停被打开）→ 黄色缺口环（2026-10-20 用户：「打开涨停可以提示为黄色节点」）。
   *
   * ## ⛔⛔ 2026-10-20 用户两次修正，最终口径「降权 ≠ 不显示」
   *
   * 第一次：「炸板炸板不需要……还是首爆优先，炸板不需要权重，你这全是炸板了！！」
   *   → 原因是旧版把它排在 **linkage 之后、所有信号之前**，只要该分钟有 `broken_new`
   *     整根轴就变黄环，首爆/走弱/走强全被吞掉。**优先级必须降到最低**。
   *
   * 第二次：「我说降低权重不是不显示哈，当节点没有更多重要信息的时候，
   *   单一个股信息还是可以显示的！！」
   *   → 我一度加了「≥2 只才显示」的门槛，结果**单票炸板直接消失**（退成灰细线），
   *     这属于把「降权」做成了「删除」。现改为**弱化显示**：
   *
   * | 情形 | 节点形状 |
   * |---|---|
   * | 该刻有 首爆/续强 · 板块走弱 · 轮动 · 走强 · 低频记录 | 显示那些（炸板让位） |
   * | 只剩炸板，单只 | 黄环 · **70% 透明**（与「板块走弱 70%」同档，看得见但不抢） |
   * | 只剩炸板，≥2 只 | 黄环 · 满色（炸板潮） |
   * | 什么都没有 | 灰色细线 |
   *
   * ⛔ 与 `normal` 的相对位置不能反过来：`normal` 是 catch-all 兜底，
   *    放到它后面炸板就真的渲染不出来了。
   */
  if (s.brokenCount > 0) {
    const batch = s.brokenCount >= BROKEN_BATCH_MIN
    return {
      kind: 'broken',
      className: batch ? 'text-break' : 'text-break/70',
      width: SNAKE_BAR_W,
      title: `涨停打开${s.brokenCount > 1 ? ` ×${s.brokenCount}` : ''}`,
    }
  }
  return { kind: 'normal', className: 'bg-sub', width: SNAKE_BAR_W, title: '盘中事实' }
}

/**
 * 一个节点要**几只**票炸板才算「炸板潮」（满色显示）。
 *
 * ⛔ 这个阈值只决定**颜色深浅**，不决定「显示还是不显示」——
 *    2026-10-20 用户明确：「降低权重不是不显示，单一个股信息还是可以显示的」。
 *    单票炸板照样画黄环，只是降到 70% 透明，让成批炸板自然更抢眼。
 */
const BROKEN_BATCH_MIN = 2

/** 该刻的**活跃度**（用于竖条高度）—— 收盘口径个股 + 盘中板块事件 + 题材信号权重 */
function activityOf(s: BlockSummary): number {
  return (
    s.stockCount +
    s.otherUpCount +
    s.otherDownCount +
    // 炸板已从 otherDownCount 单列，活跃度要补回来（跌停没拆，仍在其内）
    s.brokenCount +
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
    // 消息面（2026-10-20 用户「消息面也要提示，目前还是很多空白」）：
    // 只推了消息、没有板块异动的时刻，此前连时刻都不标 → 轴上只剩一个灰点
    s.pushed.length > 0 ||
    // 短线精灵信号（同一诉求的第二档）：不认它的话，`labelSlots` 的准入闸门
    // 会在 `downTagOf` 之前就把节点跳过 —— 下区「异动·」标签永远渲染不出来
    s.signals.length > 0 ||
    // 外部快讯（消息面第一档）：同上，进了准入闸门才有机会占位
    s.news.length > 0 ||
    // 个股走强同样要能标（否则「有票在动」的时刻仍是一片空白）
    s.upStocks.length > 0 ||
    s.sectorCount >= SLOT_VISIBLE_SECTORS ||
    s.upSectorCount + s.downSectorCount >= 1
  )
}

/** 同层相邻两个**时刻标签**的最小间距（px）—— 小于它就不标，防止叠字 */
const MIN_LABEL_GAP = 48

/**
 * 标签三层错位 + 引导线（2026-10-20 用户：「标题做一个引导线，可以链接三个高度的标题，
 * 避免标题重叠在一起」）。
 *
 * 原来所有标签挤在同一条水平线上，只能靠「放不下就不标」来避让 —— 密集段落里
 * 「首爆·军工」和「首爆·国产芯片」两个 ~118px 的长标签，中心距 75px 时就压字了。
 * 现在每个标签可以落在 0/1/2 三档高度，用一条 1px 竖线连回节点。
 *
 * ## 2026-10-20（下半场）用户加了一条：走强在上、走弱在下
 *
 * 「上方显示走强红线，下方再来一根绿线显示走弱！单独的个股提示可以减弱，
 *   但是类似板块异动的这种一定要提示出来。」
 *
 *   ┌ 首爆·国产芯片        ← 上方第 2 层（红线 up）
 *   │ ┌ 军工走强           ← 上方第 1 层
 *   │ │
 *   ✦ │ │                 ← 节点
 *   │ │ └ 白银走弱         ← 下方第 0 层（绿线 down）
 *   │     └ 医药走弱       ← 下方第 1 层
 *
 * ⛔ 方向 = 标签的**语义**（走强/爆发/轮动 vs 走弱/杀跌），不是节点的颜色。
 * ⛔ 上下两区各自独立分三层：它们占据不同纵向空间，互不遮挡，不该互相挤占。
 * ⛔ 层间距必须 ≥ 标签行高（首爆标签 11.5px 加粗 → 约 16px），否则上下两层自己会压。
 *
 * ## ⛔⛔ 三层空间必须**常驻预留**（2026-10-20 用户：「还是把高度预留出来吧！！」）
 *
 * 当天上午试过「逐段行高自适应」：按每段实际堆到的层数收窄段距（实测 196/120/120，
 * 总高 824→616）。用户当场否掉：「高度压缩了，我有些线看不到了」——
 * 收窄后上一段的下标签与下一段的上标签挤在一起，引导线看着像被截断；
 * 而密集时段随时会再冒一层标签，预留不足必然压字。宁可有留白。
 */
const LABEL_TIERS = 3
/**
 * 层间距 20px：首爆标签是 11.5px 加粗，实际行高约 16px —— 用 16px 时上下两层
 * 几乎贴在一起（实测截图里层 1 和层 2 只差 16px，看上去仍像压字）。
 */
const LABEL_STEP = 20
/** 节点命中区高度（标签与引导线都以它的顶边为基准） */
const HIT_H = SNAKE_BAR_MAX_H + 22
/**
 * 引导线从「命中区顶边」往下再吃的长度：命中区 68px 而图标只有 11–14px，
 * 图标顶边其实在命中区内部约 26px 处。线不往下吃这段，标签和图标之间就是断开的。
 */
const LEADER_DROP = 26

/** 标签方向：走强（上 / 红线）还是走弱（下 / 绿线） */
export type SnakeLabelDir = 'up' | 'down'

/** 引导线色调：题材紫 / 上涨红 / 下跌绿 / 消息面灰 / 炸板琥珀 */
export type LabelTone = 'rec' | 'up' | 'down' | 'news' | 'break'

/** 某个节点在某一侧占到的位置 */
export interface LabelSlot {
  tier: number
  tone: LabelTone
  /** 文案为 null = 只有时刻、没有题材名 */
  tag: SnakeThemeTag | null
}
/** 轴上题材名标签（渲染与碰撞判据共用同一份结构） */
export type SnakeThemeTag = {
  /**
   * `signal` = 短线精灵个股异动（2026-10-20 用户：「消息面呢？这边是否介入快讯
   * 【短线精灵 + 终端！！】」）—— 它是**消息面通道的第二档**，排在「消息·推送」之后：
   * 文案前缀「异动·」，文字用半档紫（机会向但未经题材归类），引导线仍走中性灰。
   */
  kind: 'first' | 'follow' | 'rotation' | 'plain' | 'news' | 'signal' | 'break'
  dir: SnakeLabelDir
  text: string
  /**
   * **紧凑形态**：轴上不渲染时刻，只留文案（2026-10-22）。
   *
   * ⛔ 密集段三层全被相邻标签占满时，原实现直接把这条标签**丢掉** —— 用户看到的
   *    就是「点位在那儿、一句描述都没有」。现改为「先试完整形态（含时刻），
   *    放不下就退到紧凑形态再试」，实在放不下才丢。
   * ⚠️ 缩略的是**我方的排版冗余**，不是事实：时刻在同一段邻近标签上仍可读到。
   */
  compact?: boolean
}

/**
 * 该节点的轴上标签内容 —— **纯函数，标签挑选与最终渲染都走这里**。
 *
 * ## ⚡ 2026-10-20 用户：「9:43，国产芯片就已经触发了，为什么还是首爆？！」
 *
 * 原实现把「首爆」绑在 memory 的 `rise` 事件上（「新主线崛起：X 涨停 N 只」），
 * 而那条事件要等**涨停家数达标**才生成 —— 实测 10-20 国产芯片 09:43 就 `sector_up`（1 只涨停），
 * 但 `rise` 到 10:48（3 只）才出现，于是轴上标了个 10:48 的「首爆」，比真实触发晚了 65 分钟。
 *
 * 现在：**首次触发即首爆** —— 由 `firstSeenNames`（该题材/板块当日第一次出现在轴上）决定，
 * 不再依赖后端阈值。`burst` 事件如果**不是**首次出现，就降级为「续强」。
 *
 * ⛔ 抽成纯函数的原因：标签宽度估算与最终文案必须同源，否则会出现「算着放得下、渲染却压字」。
 */
function upTagOf(
  summary: BlockSummary,
  /**
   * 该节点上「当日首次出现」的题材/板块名（见 `firstSeen`）。
   * 非空 = 它就是这个题材的首爆点。
   */
  firstSeenNames: string[] | undefined,
  /**
   * 该**板块名**当日第几次走强（2026-10-20 用户：「走强可以设置为 +1，然后无限叠，
   * 比如机器人走强可以改为：机器人+1，机器人+2」）。
   * ⛔ 缺省 1：第一次出现就叫 `+1`，不从 0 起（`+0` 读起来像「没发生」）。
   * ⛔ 必须**按名字**取序号，不能按节点取（见下）：`streakOf(name)`。
   */
  streakOf: (name?: string | null) => number = () => 1,
): SnakeThemeTag | null {
  /**
   * ## ⛔⛔ 首爆必须按**名字**判，不能按节点判（2026-10-22 用户抓包）
   *
   * 用户截图：「09:26 / 09:31 / 09:32」三个节点全写「首爆·机器人」。
   *
   * 旧实现 `isFirst = firstSeenNames?.length > 0` 是**节点级**布尔值 ——
   * 「这个节点引入了新名字」；而标签上的名字固定取 `upSectors[0].name`（最强板块）。
   * 两者不同源 → 09:31 当刻真正新出现的是「云计算数据中心」（排名第 2），
   * 最强的机器人只是又涨了一只（第 2 次），却因为 `isFirst=true` 被写成「首爆·机器人」。
   *
   * 现改为 `fresh(name)`：**这个名字**今天第一次出现才算首爆。三条口径：
   *   · 最强板块本身是新的 → 首爆·它；
   *   · 最强板块是旧的、但有别的板块是新的 → 首爆·那条新线（信息量更大，且不会被误读）；
   *   · 全都旧 → 最强板块 `+N`。
   */
  const fresh = (name?: string | null): boolean => {
    if (!name) return false
    const key = normTheme(name)
    if (!key) return false
    return (firstSeenNames ?? []).some((n) => normTheme(n) === key)
  }
  const burstLead = summary.burst[0]?.theme
  const extraBurst = summary.burst.length > 1 ? `+${summary.burst.length - 1}` : ''
  if (summary.burst.length > 0 && burstLead) {
    const first = fresh(burstLead)
    return {
      kind: first ? 'first' : 'follow',
      dir: 'up',
      text: `${first ? '首爆' : '续强'}·${burstLead}${extraBurst}`,
    }
  }
  if (summary.rotated.length > 0) {
    const extra = summary.rotated.length > 1 ? `+${summary.rotated.length - 1}` : ''
    // 轮动是「旧线又活了」，属于机会侧 → 也走上区
    return { kind: 'rotation', dir: 'up', text: `${summary.rotated[0].theme}${extra}` }
  }
  if (summary.upSectors.length > 0) {
    const name = summary.upSectors[0].name
    // 板块当日第一次出现在轴上 → 这就是「首爆」（不再等涨停家数达标）
    if (fresh(name)) return { kind: 'first', dir: 'up', text: `首爆·${name}` }
    // 最强板块是旧线，但该节点确有一条**新线**首次触发 → 标新线（否则这条线今天就永远没有首爆点）
    const freshName = (firstSeenNames ?? []).find((n) => n && n !== name)
    if (freshName) return { kind: 'first', dir: 'up', text: `首爆·${freshName}` }
    // 「+N」= 这条线今天第 N 次走强（同一板块名跨节点累加），不是涨停家数
    return { kind: 'plain', dir: 'up', text: `${name}+${streakOf(name)}` }
  }
  /**
   * 个股兜底（最弱一档）—— 2026-10-20 用户两句话合起来的口径：
   * 「单一个股信息还是可以显示的」「目前还是很多空白」。
   *
   * 只在该节点**没有任何板块/题材**时才出手，⛔ 不与板块抢上方跑道；
   * 出现的是 `stock_up` 里涨幅最高的那只，多只用 `+N` 收口（全名在 hover 明细）。
   */
  if (summary.upStocks.length > 0 && summary.upStocks[0].name) {
    const extra = summary.upStocks.length > 1 ? `+${summary.upStocks.length - 1}` : ''
    return { kind: 'plain', dir: 'up', text: `${summary.upStocks[0].name}${extra}` }
  }
  /**
   * 最后一档：**新封板**。`zt_total.added` 是全市场涨停池的完整名单，
   * 比「涨停+1」多出「是谁」——同一件事实里信息量最大的那部分。
   */
  if (summary.ztAdded.length > 0) {
    const extra = summary.ztAdded.length > 1 ? `+${summary.ztAdded.length - 1}` : ''
    return { kind: 'plain', dir: 'up', text: `涨停·${summary.ztAdded[0]}${extra}` }
  }
  if (summary.ztDelta > 0) return { kind: 'plain', dir: 'up', text: `涨停+${summary.ztDelta}` }
  return null
}

/**
 * 下方（走弱）标签 —— 与上区**完全独立**。
 *
 * 2026-10-20 用户：「一个节点可以同时显示上下两条线路数据！」
 * 旧实现是 `themeTagOf` 返回**单个** tag，走强分支在前面直接 return，
 * 于是「某个板块走强的同一分钟恰好有另一个板块走弱」时，走弱那条被整条吞掉。
 *
 * ⛔ 只对**板块级**走弱出标签：`downSectors` 是板块；`otherDownCount` 是个股回落，
 *    个股按用户要求「降低权重」—— 不占标签位（hover 明细里仍然能看到）。
 */
function downTagOf(summary: BlockSummary): SnakeThemeTag | null {
  if (summary.downSectors.length > 0) {
    const name = summary.downSectors[0].name
    const extra = summary.downSectors.length > 1 ? `+${summary.downSectors.length - 1}` : ''
    return { kind: 'plain', dir: 'down', text: `${name}走弱${extra}` }
  }
  /**
   * **外部快讯**（2026-10-20 用户：「消息面呢？这边是否介入快讯【短线精灵+终端！！】」）
   *
   * 消息面通道的**第一档**：`newsflash_new` 由 `scripts/intraday_timeline.py` 按 id 去重后
   * append-only 记账，时刻取快讯自己的 `ctime` —— 是真能落到分钟轴的事实。
   * ⛔ 标题压到 `NEWS_LABEL_MAX` 字（快讯标题常 30+ 字，原样上轴会横跨好几个节点）；
   *    全文在 hover 明细里，⛔ 不在轴上硬塞。
   * ⛔ 仍让位给「板块走弱」：风险优先，消息次要。
   */
  if (summary.news.length > 0) {
    const first = summary.news[0]
    // `title` 在事件上是开放字段（`[k: string]: unknown`）→ 先收窄再压字
    const raw = typeof first.title === 'string' ? first.title : first.name
    const title = shortNewsTitle(raw)
    const extra = summary.news.length > 1 ? `+${summary.news.length - 1}` : ''
    if (title) return { kind: 'news', dir: 'down', text: `快讯·${title}${extra}` }
  }
  /**
   * **消息面落在下方空位**（2026-10-20 用户：「消息面也要提示，目前还是很多空白」）。
   *
   * `pushed_topics` 带 `first_pushed` 时刻与 `context` 摘要，`buildTimeline` 早已把它
   * 建成独立 push 节点 —— 但此前轴上**完全不给标签**（`isNotable` 也不认它），
   * 于是每个推送时刻只剩一个灰点，正是用户说的「很多空白」。
   *
   * ⛔ 为什么放**下方**而不是抢上方：上区是题材/走强的跑道（一天 70+ 条标签，三层常满），
   *    消息面挤进去必然被吞；下区只有走弱（一天 18 条），大量空位正好放消息。
   *    且「消息·」前缀 + 灰色引导线（tone=news）与走弱的绿线能一眼分开。
   * ⛔ 同一节点的消息**只显示一次**：下方没有走弱/快讯时才顶上，绝不与走强争同一行。
   */
  if (summary.pushed.length > 0 && summary.pushed[0].name) {
    const extra = summary.pushed.length > 1 ? `+${summary.pushed.length - 1}` : ''
    return { kind: 'news', dir: 'down', text: `消息·${summary.pushed[0].name}${extra}` }
  }
  /**
   * 短线精灵信号（2026-10-20 用户：「消息面呢？这边是否介入快讯【短线精灵+终端！！】」）。
   *
   * `signals_today` 带 `first_seen`（全天 79 条），是**个股级异动**：涨停/放量/共振。
   * 排在「走弱」「消息」之后 —— 它数量最多、信息密度最低，只用来填最后一批空位。
   * 文案前缀「异动·」+ 半档红（tone=signal），既能看出是机会向，又不会抢走强的眼。
   */
  if (summary.signals.length > 0 && summary.signals[0].name) {
    const extra = summary.signals.length > 1 ? `+${summary.signals.length - 1}` : ''
    return { kind: 'signal', dir: 'down', text: `异动·${summary.signals[0].name}${extra}` }
  }
  /**
   * ## 兜底：让**每个点位**都读得出发生了什么（2026-10-22 用户：「这些点位的描述呢？」）
   *
   * 用户截图上有一长串只有图标、没有任何文字的 × 点位。根因是这里到 `return null` 为止，
   * 而**炸板 / 跌停 / 个股回落 / 涨停总数变化**四类事实**从不给标签** ——
   * 轴上于是只剩一个「×」或「黄环」，读者完全读不出是哪只票、发生了什么事。
   *
   * ⛔ 下区三层平时只用 0–1 层（板块走弱一天 ~20 条），空位大量闲置 ——
   *    这些「有名字的事实」正该占这些空位，不占上区跑道。
   * ⛔ 仍然**排在上区之后**：只有该节点上区没有更重要的题材/走强时，才轮到它们。
   * ⛔ 顺序＝信息量降序：炸板（有名字，且是涨停被打断）＞ 跌停（有名字）＞
   *    涨停总数变化（有数字）＞ 个股回落（只有只数，最模糊）。
   * ⛔ 炸板用 70% 琥珀：用户 2026-10-20 定过「炸板降权，不要全是炸板」——
   *    降权 = 弱化显示，不是不给（同「降权 ≠ 不显示」那条铁律）。
   */
  if (summary.brokenNames.length > 0) {
    const extra = summary.brokenNames.length > 1 ? `+${summary.brokenNames.length - 1}` : ''
    return { kind: 'break', dir: 'down', text: `炸板·${summary.brokenNames[0]}${extra}` }
  }
  /**
   * **打开涨停**（`zt_total.removed`）—— 与 `broken_new` 是同一件事的两个来源：
   * `broken.names` 来自快照的炸板名单（可能滞后一分钟），`removed` 来自涨停池差分。
   * 上面那档已覆盖 broken，这里兜住「差分才有、炸板名单没有」的情形，
   * 避免退化成无名的「涨停-1」。
   */
  if (summary.ztRemoved.length > 0) {
    const extra = summary.ztRemoved.length > 1 ? `+${summary.ztRemoved.length - 1}` : ''
    return { kind: 'break', dir: 'down', text: `打开·${summary.ztRemoved[0]}${extra}` }
  }
  if (summary.limitDownNames.length > 0) {
    const extra = summary.limitDownNames.length > 1 ? `+${summary.limitDownNames.length - 1}` : ''
    return { kind: 'plain', dir: 'down', text: `跌停·${summary.limitDownNames[0]}${extra}` }
  }
  /**
   * ⚠️ **必须排在 `otherDownCount` 之前**：`otherDownCount` 是
   * `下跌事件 − 板块走弱 − 炸板`，里面剩下的主力就是 `zt_total` 的负变化
   * （跌停已被上一档拦掉）。先判 `ztDelta` 才能写出「涨停-1」这个**准确的**事实；
   * 否则会笼统写成「回落·1只」——同样的节点，一个说得出数字、一个说不出。
   */
  if (summary.ztDelta < 0) {
    return { kind: 'plain', dir: 'down', text: `涨停${summary.ztDelta}` }
  }
  if (summary.otherDownCount > 0) {
    return { kind: 'plain', dir: 'down', text: `回落·${summary.otherDownCount}只` }
  }
  return null
}

/** 时刻文字「09:42」的估算宽度（9.5px 等宽数字 ≈ 5.4px/字符） */
const CLOCK_LABEL_W = 5 * 5.4

/**
 * 快讯标题在轴上最多占几个字。
 *
 * ⛔ 快讯标题常 30+ 字（「工信部：加快推进人形机器人产业创新发展」），原样上轴会横跨
 *    好几个节点、把三层跑道一次吃光。轴上只留「够认出来的前半句」，全文进 hover 明细。
 */
const NEWS_LABEL_MAX = 10

/** 快讯标题压成轴上可读的短标签（超长截断加省略号） */
function shortNewsTitle(text?: string | null, max = NEWS_LABEL_MAX): string {
  const s = String(text ?? '').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 标签宽度估算（px）—— 用于「放不放得下」。
 *
 * ⚠️ 2026-10-20：原判据是**固定 48px 中心距**，但「09:42」只有 ~27px，
 * 而「09:46 首爆·国产芯片」有 ~110px —— 两个长标签中心距 60px 时照样压字
 * （实测截图出现「09:42 机器 09:46 机器」叠在一起）。
 * 现按「时刻宽 + 题材名宽」估算，判据改为**半宽之和**。
 */
function labelWidth(tag: SnakeThemeTag | null): number {
  if (!tag) return CLOCK_LABEL_W
  const fontSize = tag.kind === 'first' ? 11.5 : tag.kind === 'follow' ? 11 : 9.5
  // 汉字按字号满宽、数字/符号略窄，取 0.95 折中；+4 是「分钟」与题材名之间的 ml-1
  const textW = tag.text.length * fontSize * 0.95
  // 紧凑形态不渲染时刻，也不加 ml-1 —— 宽度必须跟着一起减，否则估算永远判「放不下」
  return tag.compact ? textW : CLOCK_LABEL_W + 4 + textW
}

/** 一条竖虚线 + 时刻文字，给横轴一个「读到哪一段」的参照 */
function TimeGrid({ x, y, rowHeight, label }: { x: number; y: number; rowHeight: number; label: string }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: x, top: y - rowHeight / 2, height: rowHeight, transform: 'translateX(-0.5px)' }}
      aria-hidden
    >
      <div className="w-px h-full border-l border-dashed border-line-faint" />
      <span className="absolute -top-0.5 left-1 text-10 text-sub whitespace-nowrap">{label}</span>
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

  /**
   * **按内容量估宽**（详见 `DETAIL_W_MIN` 上方的取舍说明）。
   *
   * 三个权重来自「实际会渲染出几行」：
   *   · 每个板块走强/走弱 ≈ 1 行；
   *   · 每只个股 ≈ 1 行（`ROW_GRID` 横排，名称/板数/板块/换手挤一行）；
   *   · 炸板/跌停/异动/快讯/推送/首爆各自也会占行，按 1～2 行计。
   * ⛔ 只用 `summarizeBlock` 的计数，⛔ 不读 DOM（读 DOM 要两帧，浮层会先闪一下宽再收）。
   */
  const s = summarizeBlock(block, 999)
  /** 本块的槽（`normal` 单槽、`linkage`/`merged` 多槽）—— 用于取事件文本长度 */
  const detailSlots = block.kind === 'normal' ? [block.slot] : block.slots
  const eventCount = detailSlots.reduce((n, sl) => n + (sl.events?.length ?? 0), 0)
  /** 最长的一条系统观测原文——它决定「换行要几行」，也决定弹窗最少得多宽 */
  const longestEvent = detailSlots.reduce(
    (m, sl) => (sl.events ?? []).reduce((k, e) => Math.max(k, String(e.event ?? '').length), m),
    0,
  )
  const visualLines =
    s.upSectorCount +
    s.downSectorCount +
    s.stockCount +
    s.brokenCount +
    s.limitDownCount +
    s.signals.length +
    s.news.length +
    s.pushed.length * 1.5 +
    s.burst.length * 2 +
    eventCount
  /**
   * 长句加成：超过 ~18 字的事件原文在窄弹窗里会被折成两三行，
   * 读起来比「弹窗宽一点、一行读完」更累，故按超出部分补宽度（封顶 240px）。
   */
  const textBonus = longestEvent > 18 ? Math.min(240, (longestEvent - 18) * 6) : 0
  /** 容器能用多宽（留 16px 呼吸）—— 估算再准也不能超出容器 */
  const cap = Math.round(width - DETAIL_EDGE * 2)
  const dw = Math.min(
    DETAIL_W_MAX,
    cap,
    Math.max(DETAIL_W_MIN, Math.round(DETAIL_BASE_W + visualLines * DETAIL_LINE_W + textBonus)),
  )
  /**
   * 水平居中于节点，但**不许出容器**。
   * ⛔ 用 `dw/2`（本次真实宽）而不是任何固定上限：
   *    宽度现在由内容决定，用固定值会在窄弹窗时把浮层顶偏、宽弹窗时又贴边。
   */
  const half = dw / 2 + 8
  const left = Math.min(Math.max(x, half), Math.max(half, width - half))
  return (
    <div
      className="absolute z-30 flex flex-col min-w-0 rounded-[var(--radius-sm)] border border-line-strong bg-card shadow-xl"
      style={{
        /**
         * `zoom` 会等比放大**布局尺寸**，故 width / maxHeight / left 都要先按 zoom 折算，
         * 否则 1.15 倍之后视觉宽度溢出容器、高度顶出视口、浮层整体右漂。
         */
        width: dw / DETAIL_ZOOM,
        maxHeight: `calc(${DETAIL_MAX_VH}vh / ${DETAIL_ZOOM})`,
        zoom: DETAIL_ZOOM,
        left: left / DETAIL_ZOOM,
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
  /**
   * 布局（四段行高固定 196 = 3+3 排完整预留）。
   * ⛔ 2026-10-20 已回退「按实际标签层数收窄段距」：压缩后引导线看着像被截断，
   *    用户明确要求「还是把高度预留出来」。
   */
  const layout = useMemo(() => layoutSnake({ marks: blocks.map((b) => b.at), width: W }), [blocks, W])
  const aiQuote = AI_TRADER_QUOTES[Math.floor(now.getTime() / 30_000) % AI_TRADER_QUOTES.length]
  const noonSeamY = (layout.lanes[1].y + layout.lanes[2].y) / 2

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
   * **首爆判定 = 该题材/板块当日第一次出现在轴上**（2026-10-20 用户纠正口径）。
   *
   * 「9:43，国产芯片就已经触发了，为什么还是首爆？！」—— 原来只在 memory 的 `burst`
   * （= 「新主线崛起：X 涨停 N 只」）里找第一次，而那条事件要等**涨停家数达标**才生成：
   * 实测 10-20 国产芯片 09:43 就 `sector_up`（1 只涨停），`rise` 直到 10:48（3 只）才出现，
   * 轴上于是标了个晚 65 分钟的「首爆」。
   *
   * 现在把 `burst` 和 `upSectors` **两路来源合并**成「当日首次出现」：
   *   · 先出现的那个节点 → 首爆（不论当时几只涨停）；
   *   · 之后同题材的 burst → 降级为「续强」；
   *   · 之后同板块走强 → `+N`。
   *
   * ⛔ 两路名字可能不同（`burst.theme` = 题材名、`upSectors[].name` = 板块名），
   *    必须用 `normTheme` 归一后再判重，否则「国产芯片」和「国产芯片概念」会各算一次首爆。
   * ⛔ 必须按时间顺序扫，不能只看单节点。
   * ⛔ **必须用 `upSectorNames`（全量）而不是 `upSectors`（截断 3 个）**：
   *    当刻排第 4 的板块若不算「已出现」，它下次冒头就会被误标首爆。
   */
  const firstSeen = useMemo(() => {
    const seen = new Set<string>()
    const out = new Map<string, string[]>()
    const ordered = [...nodes].sort((a, b) => a.block.at - b.block.at)
    for (const n of ordered) {
      const names = [
        ...n.summary.burst.map((b) => b.theme),
        ...n.summary.upSectorNames,
      ].filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      const fresh: string[] = []
      for (const raw of names) {
        const key = normTheme(raw)
        if (!key || seen.has(key)) continue
        seen.add(key)
        fresh.push(raw)
      }
      if (fresh.length > 0) out.set(n.block.key, fresh)
    }
    return out
  }, [nodes])

  /**
   * 每条线当天第几次走强 → 轴上标 `机器人+1 / +2 / +3`（2026-10-20 用户要求）。
   *
   * ⛔ 必须**按时间顺序**累加：`nodes` 虽然来自有序的 blocks，但这里仍显式排一遍 ——
   *    一旦上游改了分块顺序（比如按强度排），计数会变成「按强度序」的假序号，
   *    而页面照常渲染、不报错，属于最难发现的那类错。
   * ⛔ 计数键是**板块名**（归一后），不是「节点最强板块」：
   *    2026-10-22 实测 —— 「丁板块」10:00 排第 4（被截断，没上标签），10:20 单独走强时
   *    按节点计数只数到 1，于是标成 `丁板块+1`，与事实（今天第 2 次走强）不符。
   *    现按 `upSectorNames`（全量）逐节点累加，任何一次出现都计入。
   */
  const streakByNode = useMemo(() => {
    const counter = new Map<string, number>()
    const out = new Map<string, Map<string, number>>()
    const ordered = [...nodes].sort((a, b) => a.block.at - b.block.at)
    for (const n of ordered) {
      const perNode = new Map<string, number>()
      for (const raw of n.summary.upSectorNames) {
        const k = normTheme(raw)
        if (!k || perNode.has(k)) continue
        const next = (counter.get(k) ?? 0) + 1
        counter.set(k, next)
        perNode.set(k, next)
      }
      out.set(n.block.key, perNode)
    }
    return out
  }, [nodes])

  const openNode = nodes.find((n) => n.block.key === openKey) ?? null

  /**
   * 哪个节点在轴上标字、标在**哪一侧（上/下）**、以及该侧的第几层。
   *
   * 同侧层内按 x 从左到右贪心挑选，横向放不下就往高一层让（最多三层），
   * 三层都放不下才放弃标注。
   *
   * ⛔ 上下两区**各自独立分层**：它们占不同纵向空间，互不遮挡 ——
   *    如果共用一套层级，一段「上方全满」会连带把下方的走弱标签也挤掉。
   * ⛔ 纯函数式，且**确定性**：同一份数据每次选中的都是同一批节点、同一层。
   */
  const labelSlots = useMemo(() => {
    const byLane = new Map<number, typeof nodes>()
    for (const n of nodes) {
      const list = byLane.get(n.point.row)
      if (list) list.push(n)
      else byLane.set(n.point.row, [n])
    }
    const out = new Map<string, { up?: LabelSlot; down?: LabelSlot }>()
    for (const list of byLane.values()) {
      const sorted = [...list].sort((a, b) => a.point.x - b.point.x)
      /**
       * 占位优先级（从高到低）：
       *   0. **首爆** —— 用户 2026-10-20：「有首爆的节点优先显示首爆」。
       *      首爆是当天信息量最大的一格，必须先拿到离节点最近的位置，不能被普通走强挤掉。
       *   1. 有题材/轮动、**板块走弱**、该线第一次走强（+1）。
       *      ⛔ 板块走弱必须进这一档：用户「下跌标题显示不够全量」，根因就是它被当成普通节点。
       *   2. 其余（普通时刻、+N 走强等）。
       */
      const rankOf = (n: (typeof sorted)[number]) => {
        if (firstSeen.has(n.block.key)) return 0
        if (n.summary.burst.length > 0 || n.summary.rotated.length > 0) return 1
        if (n.summary.downSectors.length > 0) return 1
        // 该线当天第一次走强（+1）也要占好位置 —— 首爆是「新线第一次」，这里兜的是
        // 「该板块首次走强但当天已出现过（比如先前被截断/在合并块里）」的情形
        const top = n.summary.upSectors[0]?.name
        if (top && (streakByNode.get(n.block.key)?.get(normTheme(top)) ?? 0) === 1) return 1
        return 2
      }
      const ordered = [0, 1, 2].flatMap((rank) => sorted.filter((n) => rankOf(n) === rank))
      /** 每层已放置的标签：中心 x + 估算半宽（⛔ 只存 x 的话，长短标签混排必然压字） */
      const emptyTiers = () =>
        Array.from({ length: LABEL_TIERS }, () => [] as Array<{ x: number; half: number }>)
      // 上区（走强/爆发/轮动）与下区（走弱）各三层，互不抢位
      const lanes: Record<SnakeLabelDir, Array<Array<{ x: number; half: number }>>> = {
        up: emptyTiers(),
        down: emptyTiers(),
      }
      /**
       * 在某一侧找一个放得下的层。
       * 间距要求 = max(两者半宽之和 + 4, MIN_LABEL_GAP)：
       * ⛔ 保留 MIN_LABEL_GAP 作**下限** —— 短标签本来 30px 就不重叠，但轴上太密会糊成一片。
       */
      const place = (dir: SnakeLabelDir, half: number, x: number): number => {
        const need = (p: { half: number }) => Math.max(half + p.half + 4, MIN_LABEL_GAP)
        const tiers = lanes[dir]
        const tier = tiers.findIndex((placed) => !placed.some((p) => Math.abs(x - p.x) < need(p)))
        if (tier >= 0) tiers[tier].push({ x, half })
        return tier
      }
      /**
       * 某一侧标签的两级尝试：完整形态 → 紧凑形态（不带时刻）。
       * 返回 null 表示三层都放不下（调用方就不再渲染这条标签）。
       */
      const placeOn = (
        dir: SnakeLabelDir,
        n: (typeof nodes)[number],
        tag: SnakeThemeTag | null,
      ): { tier: number; tag: SnakeThemeTag | null } | null => {
        const tier = place(dir, labelWidth(tag) / 2, n.point.x)
        if (tier >= 0) return { tier, tag }
        // ⛔ 纯时刻标签没有可压缩的内容（砍掉时刻就等于什么都没有）→ 不做紧凑尝试
        if (!tag) return null
        const compactTag: SnakeThemeTag = { ...tag, compact: true }
        const tier2 = place(dir, labelWidth(compactTag) / 2, n.point.x)
        return tier2 >= 0 ? { tier: tier2, tag: compactTag } : null
      }
      const placeUp = (n: (typeof nodes)[number], tag: SnakeThemeTag | null) =>
        placeOn('up', n, tag)
      for (const n of ordered) {
        const notable = isNotable(n.summary, n.block)
        const streaks = streakByNode.get(n.block.key)
        const upTag = upTagOf(n.summary, firstSeen.get(n.block.key), (name) =>
          (name ? streaks?.get(normTheme(name)) : undefined) ?? 1,
        )
        const downTag = downTagOf(n.summary)
        // ⛔ 盘外记录**一律标注**（它被夹到边界，没有标签就完全无法辨认）
        if (!n.point.outside && !notable && !upTag && !downTag) continue
        /**
         * 2026-10-20 用户：「一个节点可以同时显示上下两条线路数据！」
         *
         * 上区条件 = 盘外记录 **或** 有走强标签 **或** 该节点本身值得标（纯时刻）。
         * 下区条件 = 有走弱/消息标签。
         * ⛔ 盘外记录必须无条件上区（它被夹到边界，没有时刻就完全无法辨认）。
         * ⛔ 两者独立判断，互不吞并 —— 旧实现是单返回值，走强分支直接 return，
         *    「同刻另一个板块走弱」那条会被整条吞掉。
         *
         * ⛔ **同一时刻不标两遍**：下区标签自带时钟（`LabelChip` 渲染 `{clock}{tag}`），
         *    若上区只剩一根「纯时刻」标签，同一个 10:00 会在节点上下各出现一次 ——
         *    违反用户反复强调的「同一件事实只说一次」。故有下区标签时，
         *    上区只在**真有内容**（走强/爆发/轮动/盘外）时才占位。
         */
        const wantUp = n.point.outside || !!upTag || (notable && !downTag)
        if (wantUp) {
          /**
           * 两级尝试（2026-10-22）：
           *   ① 完整形态（时刻 + 文案）；
           *   ② 放不下 → **紧凑形态**（只留文案，省掉 ~31px 时刻宽）再试一次；
           *   ③ 仍放不下才丢。
           *
           * ⛔ 上一版只有 ①，密集段三层一满就直接丢弃 —— 用户截图里那串没有描述的
           *    点位就是这么来的：**不是没数据，是排版把它吞了**。
           */
          const placed = placeUp(n, upTag)
          if (placed) {
            // 消息面单独一档色调：既不是题材紫，也不是走强红（否则引导线会误导方向）
            const tone: LabelTone =
              upTag?.kind === 'news' ? 'news' : upTag && upTag.kind !== 'plain' ? 'rec' : 'up'
            out.set(n.block.key, { ...(out.get(n.block.key) ?? {}), up: { ...placed, tone } })
          }
        }
        if (downTag) {
          const placed = placeOn('down', n, downTag)
          if (placed) {
            out.set(n.block.key, {
              ...(out.get(n.block.key) ?? {}),
              /**
               * 引导线色调 = **语义方向**，不是「它落在哪一侧」：
               *   题材紫（走强/爆发）、上涨红、下跌绿、中性灰（消息面）、琥珀（炸板）。
               * ⛔ 消息(`news`) 与短线精灵异动(`signal`) 都是**中性消息** —— 它们落在下半区
               *    只是因为上区跑道被题材占满，不能因此给它们画一根「走弱绿线」，
               *    否则轴上会把「有条消息」误读成「这条线在跌」。
               */
              down: {
                tier: placed.tier,
                tone:
                  downTag.kind === 'news' || downTag.kind === 'signal'
                    ? 'news'
                    : downTag.kind === 'break'
                      ? 'break'
                      : 'down',
                tag: placed.tag,
              },
            })
          }
        }
      }
    }
    return out
  }, [nodes, firstSeen, streakByNode])

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
          // 网格线按**本段**间距画（自适应后四段高度不同，用平均值会画到隔壁段里）
          <TimeGrid
            key={t.m}
            x={t.x}
            y={t.y}
            rowHeight={layout.laneGaps[t.row] ?? layout.rowHeight}
            label={t.label}
          />
        ))}

        {/* ── 行标签（固定四段的墙上时钟范围）── */}
        {layout.lanes.map((lane) => (
          <span
            key={`lane-${lane.row}`}
            className="absolute text-11 text-txt whitespace-nowrap pointer-events-none"
            style={{
              left: lane.reversed ? layout.x1 : layout.x0,
              // 段末标签贴在**本段**底边（行高自适应后不能再用统一 rowHeight）
              top: lane.y + (layout.laneGaps[lane.row] ?? layout.rowHeight) / 2 - 12,
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
            <span className="text-11 font-semibold tracking-[0.14em] text-lead whitespace-nowrap">黄金分割线</span>
            <span className="h-3 w-px bg-line" />
            <span className="max-w-[360px] truncate text-12 text-sub">AI短线语录 · {aiQuote}</span>
          </span>
        </div>

        {/* ── 节点（小标记：细竖条，高度编码活跃度；明细走 hover）── */}
        {nodes.map(({ block, point, summary }) => {
          const isOpen = block.key === openKey
          const firstSeenNames = firstSeen.get(block.key)
          const isFirstBurst = !!firstSeenNames?.length
          /** 该节点在上下两侧各自占到的位置（可能同时有，也可能都没有） */
          const slots = labelSlots.get(block.key)
          // ⛔ 把**已定的标签类型**传给形状判定：标题写「首爆」时图标也必须是星（统一口径）
          const visual = barVisual(summary, block, isFirstBurst, slots?.up?.tag?.kind)
          const shape = SIGNAL_SHAPE[visual.kind].shape
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
           * 文案由 `labelSlots` 里带出来（与挑位置时**同一份**，避免「算着放得下、渲染却压字」）。
           * 上区：首爆紫加粗 / 续强紫半档 / 轮动紫 / 走强红 / 纯时刻灰；
           * 下区：板块走弱绿。
           */
          const upSlot = slots?.up
          const downSlot = slots?.down
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
                height: HIT_H,
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
              {/*
                展开态高亮（⛔ 只作视觉强调，不改命中区尺寸 → 不会造成 hover 抖动）。

                ⚠️ 2026-10-20 用户：「hover 的边框那一部分样式，修改一下」。
                原实现是 `ring-2 rounded-[4px]`，尺寸 26 × 56 的**细长方框**，
                套在一个 11–14px 的小图标上 —— 看起来像选中了一个空单元格，不是「选中这个点」；
                而且标记自身还叠了第二圈 `ring-2`，两层方框重影，越看越脏。
                现在改为：单一 **圆形细环**（22px，1.5px），贴合图标轮廓，不再有第二层。
              */}
              {isOpen && (
                <span
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[1.5px] ring-txt/35 pointer-events-none"
                  style={{ width: HOVER_RING, height: HOVER_RING }}
                />
              )}
              {/* 竖条：高度 = 活跃度，形状 = 性质 */}
              {/*
                形状 = 信号性质（2026-10-18 用户：不再全部用椭圆柱体）：
                ✦首爆 ✕风险 ◆联动 ●走强 ○轮动 ■记录 │普通。
                图标**等大**（不随活跃度缩放，2026-10-18 用户：「不要忽大忽小」）；
                活跃度只由细竖线的高度表达 —— 见 `lib/snake.ts` 的 SHAPE_ICON_SIZE。
                ⚠️ 2026-10-20 用户：「红绿三角不好看」→ 首爆改四角星、风险改叉（见 ShapeMark）。
                ⛔ 标记自身**不加** ring：SVG/span 的 ring 是方形 box-shadow，会和上面的圆环重影。
              */}
              <ShapeMark
                shape={shape}
                height={barHeight(summary)}
                tone={visual.className}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                nodeKind={visual.kind}
                title={visual.title}
                glow={isFirstBurst}
              />
              {/* 上区标签：走强 / 首爆 / 续强 / 轮动（紫或红） */}
              {upSlot && (
                <LabelChip slot={upSlot} dir="up" clock={minToClock(block.at)} outside={point.outside} />
              )}
              {/* 下区标签：板块走弱（绿）。与上区**独立** —— 一个节点可以同时挂两条 */}
              {downSlot && (
                <LabelChip slot={downSlot} dir="down" clock={minToClock(block.at)} outside={point.outside} />
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
