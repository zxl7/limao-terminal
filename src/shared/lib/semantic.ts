/**
 * 领域语义工具 —— A股涨红跌绿相关的**全部判定逻辑集中于此**。
 *
 * ⚠️ 组件内禁止内联这些规则。原系统的教训：同一判定（如涨停判定）散落在
 *    `zt_genes` / `feedback_matrix` / `board_core` / dashboard 渲染层多处，口径漂移。
 *    新系统从第一天起就集中单一真源。
 */

/** 涨跌方向 → 语义 class（涨红跌绿） */
export function upcls(p: number | null | undefined): '' | 'up' | 'down' {
  if (p == null || Number.isNaN(p)) return ''
  if (p > 0) return 'up'
  if (p < 0) return 'down'
  return ''
}

/** 百分比格式化（带符号，正数显式 +） */
export function fmtPct(p: number | null | undefined, digits = 2): string {
  if (p == null || Number.isNaN(p)) return '—'
  const v = p.toFixed(digits)
  return p > 0 ? `+${v}%` : `${v}%`
}

/** 金额格式化（亿元，带符号） */
export function fmtYi(v: number | string | null | undefined, digits = 1): string {
  if (v == null || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isNaN(n)) return String(v)
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}亿`
}

/** 普通数字（不带符号） */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(digits)
}

/** ISO 时间串 → HH:MM:SS */
export function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const m = ts.match(/(\d{2}:\d{2}(?::\d{2})?)/)
  return m ? m[1] : ts
}

/**
 * 涨停判定 —— 与原系统口径一致：
 *   阈值 = 20cm ? 19.9 : 9.9（留出浮点余量）
 *   或已有连板数（boards 兼容数字与文案，如 "8天4板" 视为在板）
 */
export function isLimitUp(
  pct: number | null | undefined,
  is20cm = false,
  boards?: number | string | null,
): boolean {
  const p = typeof pct === 'number' ? pct : 0
  if (p >= (is20cm ? 19.9 : 9.9)) return true
  if (typeof boards === 'number') return boards > 0
  return typeof boards === 'string' && boards.trim().length > 0
}

/**
 * 情绪分着色 —— 原 dashboard 口径：
 *   ≥ 6 红 ｜ ≤ 2 绿 ｜ 其间蓝（mid）
 *
 * 返回**语义标识**而非类名：调用方（浅底 / 深底顶栏）各自映射到自己的载体，
 * 避免把「判定」和「配色」绑死在一处。
 */
export function sentimentClass(score: number | null | undefined): '' | 'up' | 'down' | 'mid' {
  if (score == null || Number.isNaN(score)) return ''
  if (score >= 6) return 'up'
  if (score <= 2) return 'down'
  return 'mid'
}

/**
 * 反馈类指标的「改善红 / 恶化绿」语义。
 * 注意：这与涨跌方向无关，是原系统为反馈矩阵专门定义的规范 ——
 * 改善用红（利好），恶化用绿（利空）。
 */
export function feedbackClass(positive: boolean): 'up' | 'down' {
  return positive ? 'up' : 'down'
}

/**
 * 是否科创板 —— `688` / `689` 开头。
 *
 * ## 为什么是一条**硬规则**而不是普通分类
 *
 * 用户**没有开通科创板交易权限**，因此科创板标的在本系统里不是「优先级低」，
 * 而是**不可交易** —— 出现在早鸟埋伏、核心标的、次日预期里都毫无意义，
 * 且会稀释注意力。全部展示层与推送层一律剔除。
 *
 * ⚠️ 判定必须用**代码前缀**，不能用字符串包含（`includes('688')`）：
 *    `600688`（上海石化）是主板股票，包含 '688' 但不是科创板 —— 用 includes
 *    会把主板票误杀。同理 `000688`（国城矿业）也不是。
 *
 * ⚠️ 代码可能是 `688313.SH` 这类带后缀形态，也可能是裸 6 位 —— 两种都要吃。
 */
export function isStarMarket(code: string | null | undefined): boolean {
  if (!code) return false
  const c = code.trim()
  return c.startsWith('688') || c.startsWith('689')
}

/** 梯队板数排序（从高到低） */
export function sortLadderDesc<T extends { boards: number }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => b.boards - a.boards)
}
