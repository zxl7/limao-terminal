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
  /** all 模式下只取最新 N 个；jsonl 模式下取尾部 N 行 */
  limit?: number
  /** 落盘格式，默认 json */
  format?: 'json' | 'jsonl'
  cadence?: 'intraday' | 'daily' | 'manual'
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

/** 解析数据根目录：环境变量优先，其次相对 projectRoot 的默认路径 */
export declare function resolveDataRoot(
  projectRoot: string,
  defaultRelative: string,
  envName: string,
): string
