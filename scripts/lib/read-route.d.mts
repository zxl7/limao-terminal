/**
 * `read-route.mjs` 的类型声明。
 *
 * 该模块用 .mjs 写（Node 脚本与 vite.config.ts 共用），但 vite.config.ts 是 TS，
 * 因此需要一份声明让类型检查通过。这里只声明对外契约，实现细节不重复。
 */

export interface RouteDefLike {
  file?: string
  dir?: string
  pattern?: string
  /** 两层目录时外层目录名的匹配正则（如 decision_log/<日期>/candidates.json） */
  dirPattern?: string
  mode?: 'latest' | 'all'
  /** all 模式下只取**最新 N 个文件**（⛔ 与 JSONL 行数无关，见 `lines`） */
  limit?: number
  /**
   * `format: 'jsonl'` 时，每个文件只取**尾部 N 行**（缺省 500）。
   *
   * ⛔ 2026-09-19 拆出的维度：此前 `limit` 被同时当作「文件数」与「JSONL 行数」，
   *    给目录型 JSONL 路由设 `limit` 会**顺带把每天截断**（实测每天只剩 4 条事件）。
   */
  lines?: number
  /**
   * 落盘格式，默认 json。
   * `jsonl` = 按行解析为数组；`text` = **原样返回字符串**（YAML 等非 JSON 格式，
   * 解析交给消费方 —— 见 `src/features/analytics/lib/task-ledger.ts`）。
   */
  format?: 'json' | 'jsonl' | 'text'
  retired?: boolean
  cadence?: 'intraday' | 'daily' | 'manual' | 'on-demand'
  desc?: string
}

/** 按路由定义读取数据（四种形态：单文件 / 目录glob / 两层目录 / JSONL） */
export declare function readRoute(dataRoot: string, def: RouteDefLike): unknown

/** 数据新鲜度体检载荷（对应 HealthPayload） */
export declare function healthPayload(
  dataRoot: string,
  fileRoutes: ReadonlyArray<readonly [string, RouteDefLike]>,
): {
  data_root: string
  ts: string
  files: Array<{
    route: string
    file: string | undefined
    desc: string | undefined
    exists: boolean
    mtime: string | null
    age_sec: number | null
    size: number
  }>
}

export declare function freshnessHeaders(def: RouteDefLike, dataRoot: string): Record<string, string>

/** 解析数据根目录：环境变量优先，其次相对 projectRoot 的默认路径 */
export declare function resolveDataRoot(
  projectRoot: string,
  defaultRelative: string,
  envName: string,
): string
