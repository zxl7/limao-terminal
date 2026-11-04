/**
 * 财富密码决策档案的取值与文案工具。
 *
 * ⛔ 铁律：缺字段一律渲染 `—`，**不回退成 0**。
 *    0 是有效数值（如「炸板 0 次」），把缺失写成 0 会把「没数据」伪装成「很干净」。
 */

/** 数值或破折号。`null/undefined/NaN` 全归 `—`。 */
export function num(v: unknown, digits = 1, suffix = ''): string {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `${n.toFixed(digits)}${suffix}`
}

/** 百分比：入参已是百分数（如 38.9 → 38.9%）。 */
export function pctText(v: unknown, digits = 1): string {
  return num(v, digits, '%')
}

/** 比例 0–1 → 百分数。用于 `history_relay_prob`。 */
export function ratioText(v: unknown, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(digits)}%`
}

/**
 * 金额（亿）：≤0 视为**未算出**而不是「零门槛」。
 *
 * ⛔ 竞价成交额下限为 0 在业务上不成立（不可能「零成交也算达标」），
 *    脚本用 0 表示该档未计算。写成「0.00 亿」会被读成「随便买都行」。
 */
export function yiText(v: unknown, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(Number(v)) || Number(v) <= 0) return '—'
  return `${Number(v).toFixed(digits)} 亿`
}

/** 首封时刻 `094048` → `09:40`。长度不足返回 `—`。 */
export function fbtText(fbt?: string | null): string {
  const s = String(fbt ?? '')
  if (s.length < 4) return '—'
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`
}

/** 板数 + 中文后缀。0/缺失 → `—`。 */
export function boardsText(v?: number | null): string {
  if (!v || v <= 0) return '—'
  return `${v}板`
}

/** 封板形态：一字 / 换手 / 未知。 */
export function styleText(style?: string | null): string {
  if (style === 'yizi') return '一字板'
  if (style === 'turnover') return '换手板'
  return '形态未知'
}

/** 三档过筛结论 → 展示文案与语义色。 */
export const VERDICT_META: Record<
  string,
  { label: string; tone: 'up' | 'rec' | 'sub' | 'warn'; hint: string }
> = {
  pass: { label: '通过', tone: 'up', hint: '各维都过，可进入后续选池' },
  watch_only: { label: '只能看', tone: 'rec', hint: '能看但买不到（如一字厚封），不是坏票' },
  reject: { label: '排除', tone: 'sub', hint: '有硬伤，今天不选；次日重新过筛' },
}

/** 情绪环境 → 展示文案与语义色（红＝进攻，绿＝退潮）。 */
export const REGIME_META: Record<
  string,
  { label: string; tone: 'up' | 'down' | 'warn' | 'sub'; note: string }
> = {
  risk_on: { label: '进攻', tone: 'up', note: '情绪回暖，可正常参与' },
  neutral: { label: '中性', tone: 'sub', note: '挑着做，不硬贴风格' },
  risk_off: { label: '防守', tone: 'warn', note: '情绪转弱，降低预期' },
  ice: { label: '冰点', tone: 'down', note: '空仓优先，标注只看不买' },
}

/** 市场风格标签（`market_style.style`）。 */
export const MARKET_STYLE_META: Record<string, { label: string; rule: string }> = {
  core: { label: '核心主导', rule: '主线明确，做核心' },
  follow: { label: '跟风主导', rule: '主线不明，做强势跟风' },
  hedge: { label: '避险主导', rule: '只做低吸，不追高' },
  caution: { label: '谨慎', rule: '控制仓位，宁缺勿滥' },
  none: { label: '无风格', rule: '没有明确方向' },
  neutral: { label: '没方向', rule: '挑着做，按分数排序' },
}

/**
 * 观察池分组 → 白话（仅显示层别名，数据键 `watch_group` 不动）。
 *
 * ⛔ 必须与后端 `build_cards._WATCH_GROUP_PLAIN` 保持同一套措辞 ——
 *    后端出卡面、前端出页面，两边说法不一致会让同一天的同一只票「两种身份」。
 */
export const WATCH_GROUP_META: Record<string, string> = {
  容量核心: '板块大票',
  '高标/题材核心': '高连板·题材领头',
  最高板封单过薄: '封单太薄·只看',
  补充观察: '补充观察',
  一字核心: '一字封死·厚封单',
  一字龙头: '一字封死·买不进',
  已降级: '风控降级·只看',
  '过筛未过·只观察': '接力资格没过·只看',
}

export function watchGroupText(group: string | null | undefined): string {
  if (!group) return ''
  return WATCH_GROUP_META[group] ?? group
}
