/**
 * 语义色调 → Tailwind 类名 —— **展示层的唯一映射表**。
 *
 * ## 为什么单独一个文件
 *
 * 色调的「判定」属于领域逻辑（`shared/lib/semantic.ts`：涨红跌绿、改善红恶化绿、
 * 情绪分分档），而「判定结果如何落到 CSS 类」属于展示适配。两者混在一起时，
 * 同一个判定会在多处各写一遍 `p > 0 ? 'text-up' : 'text-down'` —— 原系统
 * 正是这样漂移出 4 套口径的。
 *
 * 因此：`shared/lib` 只返回**语义标识**（`'up' | 'down' | …`），本文件把语义标识
 * 映射到类名，组件两者都只读不写。
 *
 * ## ⚠️ Tailwind 必须看到字面量类名
 *
 * 这是**穷举映射表而非拼接函数**的原因 —— `text-${tone}` 这种写法不会被
 * Tailwind 的静态扫描识别，产物里不会生成对应 CSS，运行时静默无样式。
 *
 * ## ⚠️ `warn` / `mid` / `down` 三者不可互换
 *
 *   `down` = 下跌 / 恶化（A 股语义：绿）
 *   `warn` = 退潮 / 风险预警（青绿，独立色）—— 与「今天跌了多少」区分得开
 *   `mid`  = 有信息但方向中性（如快照情绪判「分歧」）
 *   `sub`  = 不适用 / 无数据
 *
 * ## ⚠️ 为什么同时存在 `sub` 与 `neutral`
 *
 * `sub` 是**载体名**（中性灰文字），`neutral` 是**语义名**（不适用）。
 * 域内代码（`features/market/model/labels.ts` 的 `Tone`）说的是语义，
 * 展示层说的是载体。为免调用方到处手写转换，这里把 `neutral` 也收进表里
 * 作为 `sub` 的别名 —— 代价是多一个键，收益是「Tone 可以直接喂给组件」。
 */
export const TONE_CLASS = {
  txt: 'text-txt',
  sub: 'text-sub',
  up: 'text-up',
  down: 'text-down',
  mid: 'text-mid',
  warn: 'text-warn',
  rec: 'text-rec',
  lead: 'text-lead',
  neutral: 'text-sub',
} as const

/** 语义色调标识（= TONE_CLASS 的键）· 组件的 `tone` 入参就用它 */
export type ToneToken = keyof typeof TONE_CLASS

/** 语义色调 → 浅底背景色（与 TONE_CLASS 配对，保证前景/背景同一语义） */
export const TONE_BG_SOFT = {
  txt: 'bg-line-faint',
  sub: 'bg-line-faint',
  up: 'bg-up-soft',
  down: 'bg-down-soft',
  mid: 'bg-mid-soft',
  warn: 'bg-warn-soft',
  rec: 'bg-rec-soft',
  lead: 'bg-lead-soft',
  neutral: 'bg-line-faint',
} as const

/** 取前景色类名（收窄查询，未登记的键回落中性灰） */
export function toneClass(t: ToneToken): string {
  return TONE_CLASS[t] ?? TONE_CLASS.sub
}

/** 取浅底类名 */
export function toneSoft(t: ToneToken): string {
  return TONE_BG_SOFT[t] ?? TONE_BG_SOFT.sub
}
