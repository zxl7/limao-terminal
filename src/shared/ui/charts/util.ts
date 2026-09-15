/**
 * 图表公共原语 —— 语义色映射、坐标轴、悬浮读数。
 *
 * ## 为什么色值必须走 CSS 变量而不是写死十六进制
 *
 * 主题令牌集中在 `styles/theme.css` 的 `@theme` 块，改一处全局生效；
 * 写死 hex 会让「深色顶栏换一套提亮色」这类需求无处落地（本项目已为顶栏
 * 专门维护了一套 `--color-head-*`）。SVG 的 `fill` / `stroke` 支持
 * `var()`，所以这里统一返回变量名。
 *
 * ## ⚠️ tone 是**行情语义**，不是通用 UI 语义
 *
 *   up=涨/红  down=跌/绿  rec=可买/紫  lead=标杆龙/金  warn=退潮/青绿  mid=中性蓝
 *
 * 与 Skyroc 的 `destructive`（红=危险）语义**不可互换** —— 详见 theme.css 头注。
 */

import type { MaybeNum } from '@/shared/lib'

/** 图表可用的行情语义色键 */
export type Tone = 'up' | 'down' | 'rec' | 'lead' | 'warn' | 'mid' | 'sub' | 'txt'

const TONE_VAR: Record<Tone, string> = {
  up: 'var(--color-up)',
  down: 'var(--color-down)',
  rec: 'var(--color-rec)',
  lead: 'var(--color-lead)',
  warn: 'var(--color-warn)',
  mid: 'var(--color-mid)',
  sub: 'var(--color-sub)',
  txt: 'var(--color-txt)',
}

const TONE_SOFT_VAR: Record<Tone, string> = {
  up: 'var(--color-up-soft)',
  down: 'var(--color-down-soft)',
  rec: 'var(--color-rec-soft)',
  lead: 'var(--color-lead-soft)',
  // ⚠️ warn/mid 此前都错指向 --color-up-soft（红底）—— 退潮预警因此会拿到
  //    「上涨红」的浅底，与它的青绿前景互相打架，且语义完全相反。
  //    现已各自指向专属浅底令牌（theme.css）。
  warn: 'var(--color-warn-soft)',
  mid: 'var(--color-mid-soft)',
  sub: 'var(--color-line)',
  txt: 'var(--color-line)',
}

/** tone → CSS 变量（用于 SVG `fill` / `stroke`） */
export function toneVar(t: Tone): string {
  return TONE_VAR[t] ?? TONE_VAR.sub
}

/** tone → 淡色变量（面积填充、柱底纹） */
export function toneSoftVar(t: Tone): string {
  return TONE_SOFT_VAR[t] ?? TONE_SOFT_VAR.sub
}

/**
 * 数值 → 行情语义色。
 *
 * ⚠️ `null` 返回 `'sub'`（中性灰），**不返回 `'up'`** —— 把「无数据」画成红色
 * 等于宣称「上涨」，这是本项目最忌讳的一类静默误导。
 */
export function valueTone(v: MaybeNum): Tone {
  if (v == null || Number.isNaN(v)) return 'sub'
  if (v > 0) return 'up'
  if (v < 0) return 'down'
  return 'sub'
}

/** 默认坐标轴尺寸约定（各图表共用，保证并排图表基线对齐） */
export const AXIS = {
  /** 左侧 Y 轴标签区宽度 */
  padLeft: 44,
  /** 右侧留白 */
  padRight: 10,
  /** 顶部留白（给最高点留呼吸） */
  padTop: 12,
  /** 底部 X 轴标签区高度 */
  padBottom: 20,
} as const

/** 图表内部绘图区的像素尺寸（由 viewBox 宽高减去留白得到） */
export function plotBox(w: number, h: number, pad: Partial<typeof AXIS> = {}) {
  const p = { ...AXIS, ...pad }
  return {
    x0: p.padLeft,
    y0: p.padTop,
    x1: w - p.padRight,
    y1: h - p.padBottom,
    w: w - p.padLeft - p.padRight,
    h: h - p.padTop - p.padBottom,
  }
}

/**
 * X 轴刻度取样 —— 标签太密时抽稀。
 *
 * 逐点标 30 个日期会糊成一片；按「最多显示 maxLabels 个」均匀取样，
 * 且**恒保首尾**（首尾是「起止」信息，丢了两端就读不出时间跨度）。
 */
export function sampleTicks(count: number, maxLabels = 8): number[] {
  if (count <= 0) return []
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i)
  const out = new Set<number>([0, count - 1])
  const inner = maxLabels - 2
  for (let i = 1; i <= inner; i++) {
    out.add(Math.round((i * (count - 1)) / (inner + 1)))
  }
  return [...out].sort((a, b) => a - b)
}

/** 悬浮提示的定位：靠近左/右边界时翻转，避免被容器裁掉 */
export function tooltipAnchor(x: number, width: number): 'left' | 'right' | 'center' {
  if (x < width * 0.25) return 'left'
  if (x > width * 0.75) return 'right'
  return 'center'
}
