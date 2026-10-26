/**
 * 路由懒加载的**稳定性外壳** —— 重试 / 缓存 / 自愈。
 *
 * ## 要解决的问题（真实故障，不是理论风险）
 *
 * 全站 29 个页面都是 `lazy: () => import(...)`。浏览器在以下场景会让这次
 * `import()` **失败**，而失败时的原生报错是同一句：
 *
 *   · Safari / WebKit  → `TypeError: Importing a module script failed.`
 *   · Chrome           → `TypeError: Failed to fetch dynamically imported module`
 *   · Firefox          → `TypeError: error loading dynamically imported module`
 *
 * 触发条件（都可复现、且都是**瞬时**的）：
 *   1. **dev · Vite 依赖重新预构建** —— 新增了未预构建的依赖时 Vite 会重算
 *      `node_modules/.vite/deps` 并让旧 `?v=` hash 失效，浏览器侧表现为
 *      `504 (Outdated Optimize Dep)` 或直接模块请求失败。
 *   2. **dev · HMR 打断** —— 文件保存的瞬间正在加载模块，或中间态语法错误让
 *      transform 返回 500；被多个页面共享的 barrel（`features/market/index.ts`、
 *      `shared/ui/index.ts`）一旦 transform 失败，**所有依赖它的页面一起失败**。
 *   3. **dev · 多个 dev server 共用同一份 `.vite` 缓存**（本机实测 5181/5182
 *      两个实例同时监听），谁触发预构建都会让另一个的模块图失效。
 *   4. **生产 · 部署换版本** —— `vite build` 会清空 `dist/assets`，旧 HTML 里
 *      引用的旧 hash chunk 变成 404。这是「切个 tab 就报错」最常见的生产成因。
 *   5. **网络抖动 / 穿透隧道中断**（本项目 `server.host = true` 且放行全部 host，
 *      出网链路不稳定时模块请求会批量失败）。
 *
 * ## 三条对策（缺一不可）
 *
 * 1. **重试**：只对「模块请求失败」重试（`isChunkLoadError`）。页面模块**顶层
 *    抛错**（真正的代码 bug）不重试 —— 重试三次只是把同一个 bug 跑三遍，还会
 *    让用户多等 1.2s。
 * 2. **失败后清缓存**：这是最容易写错的一处。若把 rejected promise 留在缓存里，
 *    用户点「重试」拿到的是同一个已经失败的 promise，永远好不了。
 * 3. **整页自愈**：重试耗尽后自动 `location.reload()` 一次（60s 内同页只自动刷
 *    一次，防止「刷新→又失败→再刷新」的死循环）。部署换版这类场景，刷新后拿到
 *    新 HTML 即彻底恢复；刷新仍不行才交给 `PageError` 让用户看见。
 */

import type { RouteObject } from 'react-router'
import { PAGE_LOADERS, type PagePath } from './pages'

/** 浏览器把「模块请求失败」包装成的几种文案（跨内核差别很大，必须全列） */
const CHUNK_ERROR_HINTS = [
  'Importing a module script failed', // Safari / WebKit
  'Failed to fetch dynamically imported module', // Chrome
  'error loading dynamically imported module', // Firefox
  'Unable to preload CSS', // Vite 注入的 CSS 预加载失败
  'Outdated Optimize Dep', // dev · 依赖重新预构建
  'dynamically imported module',
] as const

/** 重试间隔（毫秒）—— 首次立即重试，之后退避。总等待 1.15s 封顶。 */
const RETRY_DELAYS_MS = [250, 900] as const

/** 同一页面两次自动刷新之间的最小间隔（防止刷新死循环） */
const AUTO_RELOAD_COOLDOWN_MS = 60_000

/** 自动刷新标记的 sessionStorage 前缀 */
const RELOAD_KEY_PREFIX = 'limao:chunk-autoreload:'

/** 页面模块加载失败（重试与自愈都用尽后抛出，交给 `PageError` 展示） */
export class PageLoadError extends Error {
  readonly path: string
  readonly attempts: number

  constructor(path: string, attempts: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    // `cause` 让浏览器控制台能展开原始堆栈（ES2022 ErrorOptions）
    super(`页面模块加载失败（${path}，已尝试 ${attempts} 次）：${detail}`, { cause })
    this.name = 'PageLoadError'
    this.path = path
    this.attempts = attempts
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 判断是否为「模块请求本身失败」。
 *
 * ⚠️ 反向判断（`e instanceof TypeError`）不可靠：Safari 抛的是 `TypeError`，
 * 但页面模块顶层抛出的 `Cannot read properties of null` 同样是 `TypeError`。
 * 只能按文案认。
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.name}: ${error.message}`
  return CHUNK_ERROR_HINTS.some((hint) => text.includes(hint))
}

/** 从缓存里读上次自动刷新的时间（sessionStorage 不可用时静默降级） */
function lastAutoReloadAt(path: string): number {
  try {
    return Number(globalThis.sessionStorage?.getItem(RELOAD_KEY_PREFIX + path) ?? 0) || 0
  } catch {
    return 0
  }
}

function markAutoReload(path: string): void {
  try {
    globalThis.sessionStorage?.setItem(RELOAD_KEY_PREFIX + path, String(Date.now()))
  } catch {
    // 隐私模式 / 存储禁用：放弃节流，宁可刷新一次也不要白屏
  }
}

/**
 * 整页自愈 —— 换版或依赖失效时，只有重新取 HTML 才能拿到新的模块图。
 * 返回 `true` 表示已触发刷新（调用方不必再抛错，页面马上就要卸载了）。
 */
export function autoReloadOnce(path: string): boolean {
  const now = Date.now()
  if (now - lastAutoReloadAt(path) < AUTO_RELOAD_COOLDOWN_MS) return false
  markAutoReload(path)
  // jsdom / 测试环境没有真实 reload，避免抛 "Not implemented"
  if (typeof globalThis.location?.reload !== 'function') return false
  globalThis.location.reload()
  return true
}

export interface PageLoader {
  /**
   * 加载（带缓存 + 重试）；失败时抛出 `PageLoadError` 并清空缓存，下次可重试。
   *
   * `autoReload` 决定「重试耗尽后要不要整页刷新」：
   *   · **导航 / 直接访问 URL** → `true`（用户明确要看这页，刷新是最后的自救）
   *   · **悬停预取**           → `false`（鼠标划过 10 个 tab 就可能刷 10 次页，绝不能这么干）
   */
  load: (options?: { autoReload?: boolean }) => Promise<unknown>
  /** 预取：失败静默，**永不触发整页刷新** */
  preload: () => void
  /** 是否已成功加载过（用于「重试」按钮判断要不要换文案） */
  isLoaded: () => boolean
}

export interface PageLoaderOptions {
  /** 未显式传 `load({ autoReload })` 时的默认值（默认 false = 不自动刷新） */
  autoReload?: boolean
  /** 覆盖重试间隔（测试用） */
  retryDelaysMs?: readonly number[]
  /** 整页自愈实现（测试注入用；默认走 60s 节流的 `autoReloadOnce`） */
  reload?: (path: string) => boolean
}

/**
 * 把一个 `() => import(...)` 包装成**幂等、可重试**的加载器。
 *
 * 幂等很关键：`React.StrictMode` 双调用、快速连点两个 tab、悬停预取与点击
 * 同时发生，都会让同一个页面被请求多次。缓存 promise 后，浏览器只会真正
 * `import()` 一次，其余全部复用同一个结果。
 */
export function createPageLoader(
  path: string,
  importer: () => Promise<unknown>,
  options: PageLoaderOptions = {},
): PageLoader {
  const {
    autoReload: defaultAutoReload = false,
    retryDelaysMs = RETRY_DELAYS_MS,
    reload = autoReloadOnce,
  } = options
  const maxAttempts = retryDelaysMs.length + 1

  let cache: Promise<unknown> | null = null
  let loaded = false

  /* oxlint-disable no-await-in-loop -- 重试必须按退避间隔**串行**等待，并行重试会同时打出多次请求 */
  const attempt = async (): Promise<unknown> => {
    let lastError: unknown
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) await sleep(retryDelaysMs[i - 1] ?? 0)
      try {
        const mod = await importer()
        loaded = true
        return mod
      } catch (error) {
        lastError = error
        // 模块顶层抛错 = 真 bug，重试只会把同一个 bug 跑多遍
        if (!isChunkLoadError(error)) throw error
      }
    }
    throw new PageLoadError(path, maxAttempts, lastError)
  }

  const load = (overrides: { autoReload?: boolean } = {}): Promise<unknown> => {
    if (cache) return cache
    const allowReload = overrides.autoReload ?? defaultAutoReload
    const next = attempt().catch((error: unknown) => {
      // ⛔ 必须清缓存：否则「重试」永远拿到这个已失败的 promise
      cache = null
      if (error instanceof PageLoadError && allowReload && reload(path)) {
        // 已触发整页刷新，返回一个永不 settle 的 promise，
        // 避免刷新前的一瞬间把错误闪给用户
        return new Promise<never>(() => {})
      }
      throw error
    })
    // 预取与点击可能同时持有同一个 promise：先挂一个空 catch，
    // 避免预取场景下产生 unhandledrejection 噪音（真正的错误仍会被上层收到）
    next.catch(() => {})
    cache = next
    return next
  }

  return {
    load,
    preload: () => {
      // 预取永远不自愈刷新 —— 见 `PageLoader.load` 的说明
      void load({ autoReload: false }).catch(() => {})
    },
    isLoaded: () => loaded,
  }
}

/**
 * 全部页面的加载器注册表 —— **按路径只建一次**。
 *
 * `router.tsx`（导航时加载）、`Sidebar.tsx`（悬停预取）、`AppShell.tsx`
 * （空闲预取重点页）共用这一份，因此三处共享同一个 promise 与同一份缓存。
 */
const registry = new Map<string, PageLoader>()

function loaderFor(path: PagePath): PageLoader {
  const hit = registry.get(path)
  if (hit) return hit
  const created = createPageLoader(path, PAGE_LOADERS[path])
  registry.set(path, created)
  return created
}

/** 加载页面模块（`autoReload` 透传给 `PageLoader.load`，默认不自动刷新） */
export function loadPage(path: PagePath, options?: { autoReload?: boolean }): Promise<unknown> {
  return loaderFor(path).load(options)
}

/**
 * React Router 认可的 `lazy` 回调类型（从 `RouteObject` 推导，不手抄内部类型名）
 */
export type PageLazyFunction = NonNullable<RouteObject['lazy']>

/** 供 `router.tsx` 直接使用的 `lazy` 回调 */
export function lazyPage(path: PagePath): PageLazyFunction {
  /**
   * 页面模块的导出形状（`Component` / `loader`）**就是** React Router 的 `lazy`
   * 返回值要求，运行时不需要任何转换。但 `import()` 返回的是模块命名空间类型，
   * TS 无法自动收敛到 `RouteObject` 的联合类型（`Component` 的 props 逆变），
   * 所以这里做一次类型适配 —— 是「告诉编译器形状已经对齐」，不是绕过检查。
   */
  return (() => loaderFor(path).load({ autoReload: true })) as PageLazyFunction
}

/** 预取（悬停 / 聚焦 / 空闲）—— 失败静默，绝不打断交互 */
export function preloadPage(path: PagePath): void {
  loaderFor(path).preload()
}

/** 该页是否至少成功加载过一次（`PageError` 用它区分「从没加载成功」与「后来失败」） */
export function isPageLoaded(path: PagePath): boolean {
  return registry.get(path)?.isLoaded() ?? false
}
