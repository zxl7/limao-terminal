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
      cache: 'no-store',
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
    const ctype = (res.headers.get('content-type') || '').toLowerCase()
    if (ctype.includes('html') || ctype.includes('xml')) {
      throw new DataUnavailableError(
        route,
        undefined,
        `响应不是 JSON（${ctype}）——分享中转/警告页拦截了接口，请用正式域名或可信隧道`,
      )
    }

    const data: unknown = await res.json()
    if (guard) inspect(route, guard, data)

    // ⚠️ 返回**原始对象**，绝不用 schema 解析结果：
    //    zod 默认 strip 未知键，用解析结果会静默丢弃原系统新增字段。
    return data as T
  } catch (e) {
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
