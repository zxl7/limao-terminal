/**
 * A股时间与交易日工具 —— 精确移植自原系统 `common/market_time.py`（原系统的唯一实现）。
 *
 * ⚠️ 原系统的教训（market_time.py 文件头原文）：时区常量曾在 13 个文件各自定义，
 *    漂移导致推送时点错乱。新系统同样集中为单一实现，禁止在组件内自行判断时段。
 *
 * 口径（与原系统逐字一致）：
 *   · 交易日 = 周一至周五（法定节假日由「数据为空」自然兜底，不做日历判断）
 *   · 交易时段 = 早盘 540–690 分钟（09:00–11:30）｜下午 780–900 分钟（13:00–15:00）
 */

/** 北京时间与 UTC 的分钟偏移 */
const BJ_OFFSET_MIN = 8 * 60

interface BjClock {
  /** 当日分钟数 0–1439 */
  minutes: number
  /** 周日=0 … 周六=6（JS 口径） */
  jsWeekday: number
}

function bjClock(d: Date = new Date()): BjClock {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const bj = new Date(utcMs + BJ_OFFSET_MIN * 60_000)
  return {
    minutes: bj.getHours() * 60 + bj.getMinutes(),
    jsWeekday: bj.getDay(),
  }
}

/** 是否交易日（周一至周五） */
export function isTradingDay(d: Date = new Date()): boolean {
  const { jsWeekday } = bjClock(d)
  return jsWeekday >= 1 && jsWeekday <= 5
}

/**
 * 是否交易时段。
 * @param asof 可选的 "HH:MM" 触发时间；不传则用当前时间（与原系统 `in_trading(asof)` 语义一致）
 */
export function inTrading(asof?: string, d: Date = new Date()): boolean {
  const { minutes, jsWeekday } = bjClock(d)
  if (jsWeekday < 1 || jsWeekday > 5) return false

  let t = minutes
  if (asof) {
    const m = asof.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (m) t = Number(m[1]) * 60 + Number(m[2])
  }
  return (t >= 540 && t <= 690) || (t >= 780 && t <= 900)
}

/** 当前时段名称（用于顶栏状态显示） */
export function sessionName(d: Date = new Date()): '盘前' | '早盘' | '午休' | '尾盘' | '盘后' | '休市' {
  const { minutes, jsWeekday } = bjClock(d)
  if (jsWeekday < 1 || jsWeekday > 5) return '休市'
  if (minutes < 540) return '盘前'
  if (minutes <= 690) return '早盘'
  if (minutes < 780) return '午休'
  if (minutes <= 900) return '尾盘'
  return '盘后'
}

/** 北京时间 "HH:MM:SS" */
export function bjTimeString(d: Date = new Date()): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const bj = new Date(utcMs + BJ_OFFSET_MIN * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(bj.getHours())}:${p(bj.getMinutes())}:${p(bj.getSeconds())}`
}

/** 北京时间 "YYYY-MM-DD"（用于判断某个数据基准日是不是「今天」） */
export function bjDateString(d: Date = new Date()): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const bj = new Date(utcMs + BJ_OFFSET_MIN * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${bj.getFullYear()}-${p(bj.getMonth() + 1)}-${p(bj.getDate())}`
}

/** 距离某时间戳的秒数（正 = 过去） */
export function ageSeconds(isoish: string | number | null | undefined): number | null {
  if (isoish == null) return null
  const t = typeof isoish === 'number' ? isoish : Date.parse(isoish)
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 1000
}
