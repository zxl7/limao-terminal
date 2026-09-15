/**
 * 运行时配置 —— 所有「魔法数字」的唯一出口。
 *
 * 不要在组件里散落 `30_000`、`180_000` 这类字面量：它们一旦要调，
 * 你会在十几个文件里找。集中在这里，调一处即全局生效。
 */

export const APP_CONFIG = {
  /** 盘中轮询节拍（与原系统守护循环一致） */
  pollIntradayMs: 30_000,
  /** 非盘中轮询节拍（兜底观察） */
  pollOfflineMs: 180_000,
  /** 数据陈旧阈值：超过则顶栏指示灯变灰 */
  staleAfterMs: 180_000,
  /** 单次请求超时 */
  requestTimeoutMs: 8_000,
  /** 顶栏时钟刷新间隔 */
  clockTickMs: 1_000,
} as const

export type AppConfig = typeof APP_CONFIG
