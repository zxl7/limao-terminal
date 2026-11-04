/**
 * 数据请求封装。
 *
 * 设计要点：
 *   1. **全链路 no-store** —— 盘中数据每 30s 变化，任何缓存都会导致看到过期盘面；
 *   2. **超时保护** —— 原系统用 os.replace 原子写文件，读取不会拿到半截内容，
 *      但守护进程重启窗口内文件可能短暂缺失，故必须有超时与降级；
 *   3. **数据缺失是一等状态，不是异常** —— 盘前大量字段为空是正常的，
 *      调用方通过捕获 DataUnavailableError 决定降级渲染，而非崩溃；
 *   4. **结构守卫（可选）** —— 传入 zod schema 时校验响应体结构。
 *      校验失败**不阻塞、不改写数据**，只记录 + dev 期告警：
 *      宁可显示可疑数据，也不白屏（与原系统空态降级哲学一致）。
 */

import type { ZodType } from 'zod'

export class DataUnavailableError extends Error {
  constructor(
    public readonly route: string,
    public readonly target?: string,
    public readonly detail?: string,
  ) {
    super(`数据不可用: ${route}${detail ? ` (${detail})` : ''}`)
    this.name = 'DataUnavailableError'
  }
}

const DEFAULT_TIMEOUT_MS = 8000

// ────────────────────────────────────────────────────────────────
// 契约守卫
// ────────────────────────────────────────────────────────────────

export interface ContractIssue {
  /** 出问题的字段路径，如 `sentiment_detail.seal_rate` */
  path: string
  /** 期望与实际不符的说明 */
  message: string
  /** 记录时间 */
  at: string
}

/**
 * 各路由最近一次的契约问题（key = 路由）。
 * 覆盖式写入，不累积 —— 只需要知道「当前有没有问题」。
 */
export const contractIssues = new Map<string, ContractIssue[]>()

// ── 订阅机制（供 React 的 useSyncExternalStore 消费） ──
// Map 本身不是响应式的；用一个自增版本号作为「快照」，
// 使 UI 能在契约状态变化时精确重渲染，而不是靠轮询去猜。
let contractVersion = 0
const contractListeners = new Set<() => void>()

function bumpContractVersion(): void {
  contractVersion += 1
  for (const l of contractListeners) l()
}

/** 订阅契约状态变化；返回取消订阅函数 */
export function subscribeContractIssues(listener: () => void): () => void {
  contractListeners.add(listener)
  return () => {
    contractListeners.delete(listener)
  }
}

/** 当前契约状态版本（作为 useSyncExternalStore 的 snapshot） */
export function getContractVersion(): number {
  return contractVersion
}

/** 路由 → 该路由采样到的第一个坏值（用于告警文案） */
function describe(data: unknown, path: (PropertyKey | number)[]): string {
  let cur: unknown = data
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') break
    cur = (cur as Record<PropertyKey, unknown>)[k as PropertyKey]
  }
  if (cur === undefined) return 'undefined'
  if (cur === null) return 'null'
  if (typeof cur === 'object') return Array.isArray(cur) ? 'array' : 'object'
  return `${typeof cur} ${String(cur).slice(0, 40)}`
}

function inspect(route: string, schema: ZodType, data: unknown): void {
  const result = schema.safeParse(data)

  if (result.success) {
    if (contractIssues.has(route)) {
      contractIssues.delete(route)
      bumpContractVersion()
    }
    return
  }

  const issues: ContractIssue[] = result.error.issues.slice(0, 12).map((i) => {
    const path = i.path.map(String).join('.')
    return {
      path: path || '(root)',
      message: `${i.message}｜实际拿到 ${describe(data, i.path)}`,
      at: new Date().toISOString(),
    }
  })

  contractIssues.set(route, issues)
  bumpContractVersion()

  // 只在开发期告警：生产环境静默记录，避免刷屏
  if (import.meta.env.DEV) {
    console.warn(
      `[契约守卫] ${route} 结构不符（数据仍按原样使用）\n` +
        issues.map((i) => `  · ${i.path}: ${i.message}`).join('\n'),
    )
  }
}

// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// 数据新鲜度副作用通道（数据基座 · 工件 F）
//
// serve.py / vite 插件在响应头注入 X-Data-*；本通道把这些信息收集起来，
// 供 <AgeBadge> / 数据新鲜度面板订阅，不改动 getJson 的返回类型
// （对所有调用方零侵入，契约守卫用同一套机制）。
// ────────────────────────────────────────────────────────────────

/** 某路由产物的新鲜度快照 */
export interface RouteFreshness {
  /** 是否过期（null=不检查：retired / manual / on-demand） */
  stale: boolean | null
  /** 距文件 mtime 的秒数 */
  ageSec: number | null
  /** 是否已停更（无写入方） */
  retired: boolean | null
  /** 数据写入方（ASCII，可能为空） */
  producer: string | null
  /** 最近请求失败时不得沿用上次健康状态 */
  error?: boolean
  /** 采集时间戳 */
  at: number
}

export const freshnessByRoute = new Map<string, RouteFreshness>()
let freshnessVersion = 0
const freshnessListeners = new Set<() => void>()

function bumpFreshnessVersion(): void {
  freshnessVersion += 1
  for (const l of freshnessListeners) l()
}

/** 订阅新鲜度变化；返回取消订阅函数 */
export function subscribeFreshness(listener: () => void): () => void {
  freshnessListeners.add(listener)
  return () => {
    freshnessListeners.delete(listener)
  }
}

/** 当前新鲜度版本（useSyncExternalStore 的 snapshot） */
export function getFreshnessVersion(): number {
  return freshnessVersion
}

function headerTri(v: string | null): boolean | null {
  if (v === '1') return true
  if (v === '0') return false
  return null
}

function headerNum(v: string | null): number | null {
  if (v == null || !/^\d+(?:\.\d+)?$/.test(v.trim())) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** getJson 内部调用：把响应新鲜度头收进副作用通道（仅变更时触发订阅） */
export function recordFreshness(
  route: string,
  raw: { stale: string | null; age: string | null; retired: string | null; producer: string | null },
): void {
  const next: RouteFreshness = {
    stale: headerTri(raw.stale),
    ageSec: headerNum(raw.age),
    retired: headerTri(raw.retired),
    producer: raw.producer || null,
    at: Date.now(),
  }
  const prev = freshnessByRoute.get(route)
  if (
    prev &&
    prev.stale === next.stale &&
    prev.ageSec === next.ageSec &&
    prev.retired === next.retired &&
    prev.producer === next.producer &&
    !prev.error
  ) {
    freshnessByRoute.set(route, next)
    bumpFreshnessVersion()
    return
  }
  freshnessByRoute.set(route, next)
  bumpFreshnessVersion()
}

export interface GetJsonOptions {
  timeoutMs?: number
  /** 传入则做结构守卫校验（失败不阻塞） */
  guard?: ZodType
}

export function withQuery(route: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `${route}?${encoded}` : route
}

export async function getJson<T>(route: string, options: GetJsonOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, guard } = options
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const res = await fetch(route, {
      // ⚠️ 2026-10-30：从 no-store 改成 no-cache。
      //    no-store 会让浏览器完全不缓存 → 每次都整包重下（decision.json 474KB 也是）。
      //    no-cache 语义仍是「必须回源校验」，但允许携带 If-None-Match：
      //    数据没变时服务端回 304，前端拿到 0 字节，行为不变而流量大降。
      cache: 'no-cache',
      signal: ctrl.signal,
      // ⚠️ 2026-10-26 实测：ngrok 免费隧道对**浏览器 UA**（含同源 XHR）会把
      //   `/api/*` 换成 `200 text/html` 的访问警告页，页面因此报「渲染出错」。
      //   带上此头即跳过警告页、拿回真 JSON；serve.py / vite 对未知头无副作用。
      headers: { 'ngrok-skip-browser-warning': '1' },
    })

    if (!res.ok) {
      let body: Record<string, unknown> = {}
      try {
        body = await res.json()
      } catch {
        /* 非 JSON 响应，忽略 */
      }
      throw new DataUnavailableError(
        route,
        typeof body.target === 'string' ? body.target : undefined,
        `HTTP ${res.status}`,
      )
    }

    // ⚠️ 2026-10-26 实测：ngrok 免费隧道会给**未过警告页的浏览器**返回
    //   `200 text/html`（中转警告页）。res.ok 为真却拿到 HTML，`res.json()` 抛错，
    //   最终表现为「页面渲染出错」。分享链路的中转页不是数据，必须显式识别，
    //   否则会把「通道被拦」误报成「后端没数据」。
    //
    // ⚠️ 只拦「**明确是页面**」的响应（html/xml）：中转警告页正是 HTML。
    //   `text/plain` 与缺失头一律按 JSON 试解析 —— 轻量服务、测试桩、
    //   甚至部分反向代理都会用 text/plain 回 JSON，一刀切会误杀正常数据。
    //   真的是 HTML 却漏判时，下面的 `res.json()` 也会抛错并统一兜底。
    const ctype = (res.headers?.get('content-type') || '').toLowerCase()
    if (ctype.includes('html') || ctype.includes('xml')) {
      throw new DataUnavailableError(
        route,
        undefined,
        `响应不是 JSON（${ctype}）——分享中转/警告页拦截了接口，请用正式域名或可信隧道`,
      )
    }

    const data: unknown = await res.json()
    // 只有成功解析 JSON 后才接受健康头；HTML/损坏 JSON 不得短暂点亮绿灯。
    recordFreshness(route, {
      stale: res.headers?.get('X-Data-Stale') ?? null,
      age: res.headers?.get('X-Data-Age') ?? null,
      retired: res.headers?.get('X-Data-Retired') ?? null,
      producer: res.headers?.get('X-Data-Producer') ?? null,
    })
    if (guard) inspect(route, guard, data)

    // ⚠️ 返回**原始对象**，绝不用 schema 解析结果：
    //    zod 默认 strip 未知键，用解析结果会静默丢弃原系统新增字段。
    return data as T
  } catch (e) {
    freshnessByRoute.set(route, {
      stale: null, ageSec: null, retired: null, producer: null, error: true, at: Date.now(),
    })
    bumpFreshnessVersion()
    if (e instanceof DataUnavailableError) throw e
    const detail =
      e instanceof DOMException && e.name === 'AbortError'
        ? `超时 ${timeoutMs}ms`
        : e instanceof Error
          ? e.message
          : String(e)
    throw new DataUnavailableError(route, undefined, detail)
  } finally {
    clearTimeout(timer)
  }
}
