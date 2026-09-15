/**
 * 分析域数值格式化 —— 原系统落盘数据大量使用 `null` 表达「无样本/无数据」，
 * 与真实的 0 有本质区别（如「晋级率 0%」和「还没统计」不是一回事）。
 *
 * 因此本域所有格式化函数遵守同一条规则：
 *   **null / NaN → 「—」，绝不渲染成 0 或空白。**
 * 空白会让人以为渲染坏了，而 0 会直接导致错误判断。
 *
 * ⚠️ 不直接用 shared/lib 的 fmtNum/fmtPct：那两个是行情域口径（默认 2 位小数、
 *    带 + 号），而分析域的比率类字段（晋级率/炸板率）多为 0–1 的小数或
 *    一位小数的百分数，混用会让同一列出现两种精度。
 */

/** 数值保留 1 位小数；整数不补 `.0`；null → 「—」 */
export function n1(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/** 数值保留 2 位小数 */
export function n2(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(2)
}

/** 百分比（入参已是百分数值，如 34.3 → 「34.30%」） */
export function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

/** 比率（入参为 0–1 或 0–100 的百分数值，统一按百分数值输出，不带 + 号） */
export function rate(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${v.toFixed(digits)}%`
}

/**
 * 二元区间 `[下沿, 上沿]` → `0.0~2.0`（可带单位）。
 *
 * ⚠️ 存在的理由：原系统多处把区间写成**二元数组**（`expected_range = [0.0, 2.0]`）。
 *    直接丢给 React 渲染不会报错 —— 数组子元素会被**无分隔符拼接**成 `"02"`，
 *    静默显示一个错误数字。这类错误最难发现，故强制走本函数格式化。
 *
 * 非二元数组 / 含非数值 → 「—」。
 */
export function range(v: number[] | null | undefined, digits = 1, unit = ''): string {
  if (!Array.isArray(v) || v.length < 2) return '—'
  const [lo, hi] = v
  if (lo == null || hi == null || Number.isNaN(lo) || Number.isNaN(hi)) return '—'
  return `${lo.toFixed(digits)}~${hi.toFixed(digits)}${unit}`
}

/** 取二元区间的下沿（用于「量能≥X亿」这类门槛文案）；非法 → null */
export function rangeLow(v: number[] | null | undefined): number | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const lo = v[0]
  return typeof lo === 'number' && !Number.isNaN(lo) ? lo : null
}

/** 区间（带 % 号）—— 语义糖，等价 `range(v, digits, '%')` */
export function rangePct(v: number[] | null | undefined, digits = 1): string {
  return range(v, digits, '%')
}

/**
 * 涨跌语义色 class（A 股口径：涨红跌绿）。
 *
 * ⚠️ 与 shared/lib 的 `upcls` 的区别：`upcls` 返回裸标识（'up' | 'down' | ''），
 *    由调用方自行拼 `text-${x}` —— 那是为了支持深色顶栏换载体。分析域全在
 *    浅底卡片内，直接返回现成 class 更省事，且不可复用到顶栏（会被误用）。
 */
export function tone(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v) || v === 0) return 'text-txt'
  return v > 0 ? 'text-up' : 'text-down'
}

/** 「改善红 / 恶化绿」语义 —— 用于晋级率、封板率这类「越高越好」的指标 */
export function better(v: number | null | undefined, threshold: number): string {
  if (v == null || Number.isNaN(v)) return 'text-sub'
  return v >= threshold ? 'text-up' : 'text-sub'
}

/** 连板天梯 key（'1' | '2' | ...）→ 板数文案 */
export function boardsLabel(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 5 ? `${n}板+` : `${n}板`
}

/** 首封时间 '092500' / '09:25' → '09:25' */
export function fmtFbt(v: string | null | undefined): string {
  if (!v) return '—'
  const digits = v.replace(/\D/g, '')
  if (digits.length >= 4) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
  return v
}

/** 文件名的日期部分（'board_core_20260914.json' → '2026-09-14'） */
export function fileDate(file: string): string {
  const m = file.match(/(\d{4})-?(\d{2})-?(\d{2})/)
  if (!m) return file
  return `${m[1]}-${m[2]}-${m[3]}`
}
