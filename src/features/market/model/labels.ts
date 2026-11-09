/**
 * 行情域的标签与色调映射 —— 域内知识，不外泄。
 *
 * ⚠️ 语义色铁律：改善 / 利好 = 红（up），恶化 / 利空 = 绿（down）。
 *    这与「涨红跌绿」同向，但**判定依据不同** —— 例如晋级率低于阀门是「恶化」
 *    （绿），即便昨日涨停股今天在涨。判定逻辑集中在 `shared/lib/semantic.ts`，
 *    此处只负责「语义 → 展示色调」的映射。
 *
 * ⚠️ 类名字面量一律取自 `@/shared/ui` 的 `TONE_CLASS`，本文件不写字面量 ——
 *    见 TONE_TEXT 的注释。
 */

import { TONE_BG_SOFT, TONE_CLASS } from '@/shared/ui'

/**
 * 卡片色调（对应 theme.css 的 text-* 语义类）。
 *
 * `mid`（中性蓝）与 `neutral`（中性灰）的区分：`mid` 表示「有信息但方向中性」
 * （如快照情绪判「分歧」），`neutral` 表示「不适用/未判定」。两者不可合并 ——
 * 合并后「分歧」会与「无数据」同色。
 */
export type Tone = 'up' | 'down' | 'warn' | 'rec' | 'mid' | 'neutral'

/**
 * 语气色 → Tailwind 类名。
 *
 * ⚠️ 类名字面量集中在 `shared/ui/tone.ts`（展示层唯一映射表），
 *    此处只做「域内 Tone → 载体」的**语义收窄**（neutral ⇒ sub），
 *    避免同一个 `text-up` 在两个文件里各写一份、各自漂移。
 */
export const TONE_TEXT: Record<Tone, string> = {
  up: TONE_CLASS.up,
  down: TONE_CLASS.down,
  warn: TONE_CLASS.warn,
  rec: TONE_CLASS.rec,
  mid: TONE_CLASS.mid,
  neutral: TONE_CLASS.sub,
}

/** 语气色 → 浅底（与 TONE_TEXT 配对使用，保证前后景同一语义） */
export const TONE_SOFT: Record<Tone, string> = {
  up: TONE_BG_SOFT.up,
  down: TONE_BG_SOFT.down,
  warn: TONE_BG_SOFT.warn,
  rec: TONE_BG_SOFT.rec,
  mid: TONE_BG_SOFT.mid,
  neutral: TONE_BG_SOFT.sub,
}

/** 语气色 → 顶栏用（深色底需提亮，见 App.tsx 的 .topbar 覆盖） */
export const TONE_TEXT_HEAD: Record<Tone, string> = {
  up: 'up',
  down: 'down',
  warn: 'warn',
  rec: 'rec',
  mid: 'mid',
  neutral: 'mid',
}

/**
 * 退潮预警等级 → 色调。
 *
 * ## ⚠️ 这是一处已修的哑映射（2026-09-15）
 *
 * 原实现按 `'high' | 'severe' | 'medium'` 英文枚举匹配，但**真实落盘值是展示文案**
 * （`scripts/intraday_pulse.py::detect_ebb` 写入 `"⚠ 退潮预警"` / `"⚡ 情绪转弱"`）。
 * 两个分支恒不命中 → 恒返回 `neutral`，退潮预警拿到的是最不显眼的灰色。
 * 更糟的是它「看起来像完成了」：函数存在、被导出、无报错。
 *
 * 教训：**字符串枚举类字段必须回数据源核实际取值**，不能照着「应该长什么样」写。
 * 英文分支保留是为了兼容早期归档快照，不是冗余。
 */
export function ebbTone(severity: string | null | undefined, riskLevel?: 'weak' | 'warning'): Tone {
  if (riskLevel === 'warning') return 'warn'
  if (riskLevel === 'weak') return 'mid'
  if (!severity) return 'neutral'
  // 当前及历史口径（显示文案）
  if (severity.includes('预警') || severity.includes('退潮')) return 'warn'
  if (severity.includes('转弱') || severity.includes('承压')) return 'mid'
  // 历史口径（英文枚举）
  switch (severity) {
    case 'high':
    case 'severe':
      return 'down'
    case 'medium':
    case 'mid':
      return 'warn'
    default:
      return 'neutral'
  }
}

/**
 * 快照情绪定性（`latest.sentiment_detail.label`）→ 色调。
 *
 * 新快照由 feedback_matrix 同轮回填 continuous_v3（1–10），采集未完成时分数为空。
 * 历史快照仍保留旧有符号分，禁止在展示层换算或覆盖历史。
 * 此处始终消费产侧标签，不在组件内重复评分阈值。
 */
export function sentimentLabelTone(label: string | null | undefined): Tone {
  if (!label) return 'neutral'
  if (label === '亢奋' || label === '偏强' || label === '修复') return 'up'
  if (label === '分歧') return 'mid'
  if (label === '退潮') return 'warn'
  return 'neutral'
}

/**
 * 反馈矩阵口径的「改善红 / 恶化绿」→ 域内 Tone。
 *
 * 这是 `shared/lib/semantic.ts::feedbackClass` 的**展示侧孪生**：那个返回
 * 中性的 `'up' | 'down'` 语义标识，这个原样返回域内 Tone，因而可以直接
 * 喂给 `<Kpi tone>` 这类收窄入参的组件 —— 不需要调用方把类名字符串再转回去。
 *
 * ⚠️ 注意判定方向：`worsened = true` → `down`（绿）。
 *    在 A 股语义里绿是「跌」，容易误以为「变差应该是绿所以没问题」——
 *    但本项目多数指标（如净值）的「变差」也是绿，方向一致，不必特判。
 */
export function feedbackTone(worsened: boolean): Tone {
  return worsened ? 'down' : 'up'
}

/** 防御等级（0–3）→ 色调 */
export function defenseTone(level: number | null | undefined): Tone {
  if (level == null) return 'neutral'
  if (level >= 3) return 'down'
  if (level === 2) return 'warn'
  if (level === 1) return 'rec'
  return 'up'
}

/**
 * 涨跌百分比 → 语义类。
 *
 * 与 `shared/lib/semantic.ts` 的 `upcls()` 区别：那个返回框架无关的语义标识
 * （`'up'`/`'down'`）；这个返回 Tailwind 工具类，属于**展示层适配**。
 * 之所以不复用：语义判定必须单一真源，但「语义 → 样式载体」的映射各层可以不同。
 *
 * ⚠️ 返回类型收窄为 `ToneClass` 而非 `string`：类名是**穷举**的，
 *    写成 string 会让 Tailwind 的静态扫描失去保证（拼接类名不会生成 CSS）。
 */
export function pctTone(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return TONE_CLASS.sub
  if (p > 0) return TONE_CLASS.up
  if (p < 0) return TONE_CLASS.down
  return TONE_CLASS.txt
}
