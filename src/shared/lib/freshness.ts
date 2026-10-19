/**
 * 数据新鲜度（纯函数）—— 「这条数据是哪天的、落后了几天」的唯一判定入口。
 *
 * ## 为什么需要它（2026-10-18 全站扫描）
 *
 * 29 个页面里有 20+ 个只显示「最新 2026-09-10」这类**裸日期**，没有龄期：
 * 读者必须自己心算今天是几号、差几天，才能判断「这是今天的还是一个月前的」。
 * 实测最严重的几处：
 *   · `/hithink` 估值卡停在 2026-08-26（53 天）
 *   · `/stack` 周涨停地图停在 09-11 却仍写「本周」（5 周）
 *   · `/system` 把 09-03 的引擎件挂在「60s 刷新」下（45 天）
 *   · `/cards` 复盘卡 38 天、龙虎榜卡 19 天
 *
 * ## 口径
 *
 * 业务日期按**北京时间当日 23:59:59** 计：「今天的数据」龄期为 0，不是 1。
 * 这样 `staleDays('2026-10-16')` 在 10-18 返回 2，与人的直觉一致。
 *
 * ⚠️ 本文件是 `shared/lib`，纯函数、零依赖、零副作用（⛔ 不 import react）。
 */

/** 一天的毫秒数 */
const DAY_MS = 86_400_000
/** 北京时区偏移（+08:00）—— 龄期必须按**北京自然日**算，不能按 UTC */
const BJ_OFFSET_MS = 8 * 3_600_000

/**
 * 业务日期字符串（`YYYY-MM-DD`，允许带时间后缀）→ 落后自然日数。
 *
 * 返回 `null` 表示**无法判定**（空值/格式不认识）—— ⛔ 不要回落成 0，
 * 「不知道」和「今天」必须区分开。
 */
export function staleDays(date: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!date) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date).trim())
  if (!m) return null
  // 两端都换算成「北京自然日序号」再相减：今天=0、昨天=1。
  // ⛔ 不要用「业务日 23:59:59 的时间差再 floor」—— 当天 14:00 只能差出 3.58 天，
  //    会把「4 天前」算成 3 天（本轮实测踩到）。
  const nowDay = Math.floor((nowMs + BJ_OFFSET_MS) / DAY_MS)
  const dateDay = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS)
  const diff = nowDay - dateDay
  return diff > 0 ? diff : 0
}

/**
 * 龄期 → 一句话短标签。`null` = 不需要提示（新鲜或无法判定由调用方决定）。
 *
 * @param date 业务日期
 * @param freshDays 多少天内算「新鲜」（默认 3：覆盖周末与长假首日）
 */
export function staleLabel(
  date: string | null | undefined,
  freshDays = 3,
  nowMs: number = Date.now(),
): string | null {
  const days = staleDays(date, nowMs)
  if (days == null || days <= freshDays) return null
  if (days >= 30) return `已停更 ${Math.floor(days / 30)} 个月`
  if (days >= 14) return `已停更 ${Math.floor(days / 7)} 周`
  return `已停更 ${days} 天`
}
