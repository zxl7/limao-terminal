import { cn } from '@/shared/lib'
import { toneVar, type Tone } from './util'

/**
 * 图表悬浮读数（tooltip）—— 全部图表共用的**唯一**实现。
 *
 * ## 为什么要抽成公共件而不是各图自己画一行文字
 *
 * 早期实现是把读数渲染在图表**下方的一行静态文字**里。它有三个硬伤：
 *   1. **视线要来回跑** —— 鼠标在图上、数字在图下，读数时眼睛离开数据点；
 *   2. **无法对应到具体数据点** —— 一条折线有 10 个点，横排文字只说「值是多少」，
 *      不说「哪个点」；
 *   3. **多处实现必然分叉** —— 折线图有十字线、柱图有热区、矩阵只有原生 `title`，
 *      同一个交互三种体感，用户学不会。
 *
 * 因此统一为「锚定数据点的浮层」：光标停在哪个点/柱/格上，读数就贴在它旁边。
 *
 * ## 定位：用自身百分比位移翻转，**不做尺寸测量**
 *
 * 常见做法是先渲染再 `getBoundingClientRect` 量宽度、然后 `setState` 重新定位。
 * 这条路有三个代价：多一帧闪烁、`useLayoutEffect` 里 setState 触发
 * React Compiler 的无限更新告警、以及首帧位置错误。
 *
 * 这里的做法是：**翻转只用 `transform: translate(-100%)` 表达** ——
 * 百分比位移参照的是元素**自身**尺寸，天然不需要测量。
 * 只有「是否该翻转」这个*判断*需要预估尺寸（见 `EST_W` / `EST_H`），
 * 预估偏差最坏情况是提前翻转几个像素，不影响可读性，却是**确定性**的。
 *
 * 另一个经典坑：气泡必须 `pointer-events: none`。否则它一出现就抢走 hover，
 * 触发原元素 `mouseleave` → 气泡消失 → 又重新 hover，形成闪烁死循环。
 */

/** 仅用于「是否翻转」的尺寸预估（非精确测量，见文件头说明） */
const EST_W = 186
const ROW_H = 17
const TITLE_H = 20
const PAD_H = 14

/** 一行读数 */
export interface TipRow {
  label: string
  value: string
  /** 值的语义色；缺省用正文色 —— 不染色的读数是「无好坏」的事实 */
  tone?: Tone
}

/** 气泡内容 */
export interface TipPayload {
  title?: string
  rows: TipRow[]
}

/**
 * 锚点：相对「定位容器」的像素坐标 + 容器宽度。
 *
 * ⚠️ `containerW` **在事件回调里取**，不在渲染期读 `ref.current`。
 *    React Compiler 的 refs 规则会拦下「渲染期访问 ref」——
 *    而且这确实是个真问题（ref 变化不触发重渲染，读到的可能是旧值）。
 *    交互产生的锚点天然来自事件回调，顺手把容器宽度一起量掉，
 *    渲染期就完全不碰 DOM。
 */
export interface TipAnchor {
  x: number
  y: number
  /** 定位容器的 clientWidth —— 翻转判断的边界 */
  containerW: number
}

/**
 * 视图坐标 → 容器像素坐标。
 *
 * SVG 用 `viewBox` 定义坐标系，而工具提示用 CSS 像素定位，两者差一个缩放系数。
 * 该系数由 SVG 实际渲染宽度 ÷ viewBox 宽度得出（`w-full h-auto` 保证等比缩放，
 * 故宽高同系数）。**不能用容器的宽度**：容器可能带 padding，或 SVG 未铺满。
 */
export function viewToPx(
  container: HTMLElement,
  svg: SVGSVGElement,
  vx: number,
  vy: number,
  viewBoxWidth: number,
): TipAnchor {
  const c = container.getBoundingClientRect()
  const s = svg.getBoundingClientRect()
  // jsdom / 未布局：rect 全 0，此时退化为「按视图坐标直接当像素」而不是产生 NaN
  const k = s.width > 0 && viewBoxWidth > 0 ? s.width / viewBoxWidth : 1
  return {
    x: s.left - c.left + vx * k,
    y: s.top - c.top + vy * k,
    containerW: container.clientWidth,
  }
}

/** 指针坐标 → 容器像素坐标（HTML 类图表用，无 viewBox 换算） */
export function pointerToPx(container: HTMLElement, e: { clientX: number; clientY: number }): TipAnchor {
  const c = container.getBoundingClientRect()
  return { x: e.clientX - c.left, y: e.clientY - c.top, containerW: container.clientWidth }
}

export function ChartTooltip({
  anchor,
  payload,
  className,
  /** 锚点到气泡边缘的距离（px） */
  offset = 12,
}: {
  anchor: TipAnchor
  payload: TipPayload
  className?: string
  offset?: number
}) {
  const estH = PAD_H + payload.rows.length * ROW_H + (payload.title ? TITLE_H : 0)

  // 右侧放不下 → 翻到左侧；上方放不下 → 翻到下方。容器宽度为 0 时（未布局）默认不翻转
  const flipX = anchor.containerW > 0 && anchor.x + offset + EST_W > anchor.containerW
  const flipY = anchor.y - offset - estH < 0

  return (
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-20 rounded-sm border border-line-strong bg-card',
        'px-2 py-1.5 shadow-md w-max max-w-[220px]',
        className,
      )}
      style={{
        left: flipX ? anchor.x - offset : anchor.x + offset,
        top: flipY ? anchor.y + offset : anchor.y - offset,
        // 关键在于百分比位移参照自身尺寸 —— 于是无需测量即可完成翻转对齐
        transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '0' : '-100%'})`,
      }}
    >
      {payload.title && (
        <div className="text-[11.5px] font-semibold text-txt mb-1 whitespace-nowrap">{payload.title}</div>
      )}
      <div className="flex flex-col gap-0.5">
        {payload.rows.map((r, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- 同一读数可含重复 label（如多序列同名），索引是唯一稳定身份
          <div key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 text-[11.5px]">
            <span className="text-sub whitespace-nowrap">{r.label}</span>
            <span
              className="num font-semibold whitespace-nowrap"
              style={{ color: r.tone ? toneVar(r.tone) : 'var(--color-txt)' }}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
