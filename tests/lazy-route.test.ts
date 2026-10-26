/**
 * 页面加载稳定性测试 —— 锁住「重试 / 缓存 / 失败清缓存」三条语义。
 *
 * ## 为什么这些细节必须有测试
 *
 * 这三条里最容易写错的是**失败清缓存**：把 rejected promise 留在缓存里，
 * 用户点「重试」拿到的是同一个已经失败的 promise，永远好不了 —— 而这条路径
 * 只在故障时走，手测几乎发现不了，线上却会变成「必须手动刷新整个浏览器」。
 *
 * 同样容易写错的是**重试范围**：无脑重试会把「页面模块顶层抛错」这种真 bug
 * 连跑三遍，让用户多等一秒多还看到同一句报错。
 */

import { describe, expect, it, vi } from 'vitest'
import { createPageLoader, isChunkLoadError, PageLoadError } from '@/app/lazyRoute'
import { isPagePath } from '@/app/pages'

/** 各内核的原始文案（Safari / Chrome / Firefox 各不相同，必须都认得） */
const CHUNK_ERRORS = [
  new TypeError('Importing a module script failed.'),
  new TypeError('Failed to fetch dynamically imported module: /src/pages/ai/AiPage.tsx'),
  new TypeError('error loading dynamically imported module'),
]

const chunkError = () => CHUNK_ERRORS[0] as Error
const ok = () => ({ Component: () => null, loader: async () => null })

/** 测试一律关掉整页自愈（jsdom 没有真实的 location.reload）并去掉退避等待 */
const FAST = { autoReload: false, retryDelaysMs: [0, 0] } as const

describe('isChunkLoadError', () => {
  it('认得三个内核的模块加载失败文案', () => {
    for (const error of CHUNK_ERRORS) expect(isChunkLoadError(error)).toBe(true)
  })

  it('不把页面自身的 TypeError 误判为模块加载失败', () => {
    // 这条是「重试范围」的护栏：认错了就会把真 bug 重跑三遍
    expect(isChunkLoadError(new TypeError("Cannot read properties of null (reading 'price')"))).toBe(
      false,
    )
    expect(isChunkLoadError(new Error('Request failed with status 500'))).toBe(false)
    expect(isChunkLoadError('Importing a module script failed')).toBe(false)
  })
})

describe('createPageLoader · 缓存', () => {
  it('同一页面并发/重复加载只真正 import 一次', async () => {
    // StrictMode 双调用 + 悬停预取 + 连续点击会同时打进来，必须收敛成一次请求
    const importer = vi.fn(async (): Promise<unknown> => ok())
    const loader = createPageLoader('/x', importer, FAST)

    const [a, b, c] = await Promise.all([loader.load(), loader.load(), loader.load()])
    const d = await loader.load()

    expect(importer).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(d).toBe(a)
    expect(loader.isLoaded()).toBe(true)
  })

  it('预取成功后，真正加载不再发请求', async () => {
    const importer = vi.fn(async (): Promise<unknown> => ok())
    const loader = createPageLoader('/x', importer, FAST)

    loader.preload()
    await loader.load()

    expect(importer).toHaveBeenCalledTimes(1)
  })
})

describe('createPageLoader · 重试', () => {
  it('模块请求失败会重试，第二次成功即返回', async () => {
    let calls = 0
    const importer = vi.fn(async (): Promise<unknown> => {
      calls += 1
      if (calls < 2) throw chunkError()
      return ok()
    })
    const loader = createPageLoader('/x', importer, FAST)

    await expect(loader.load()).resolves.toMatchObject({ Component: expect.any(Function) })
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('全部尝试失败后抛出 PageLoadError，且错误带原始 cause', async () => {
    const importer = vi.fn(async (): Promise<unknown> => {
      throw chunkError()
    })
    const loader = createPageLoader('/x', importer, FAST)

    const error = await loader.load().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PageLoadError)
    expect((error as PageLoadError).attempts).toBe(3) // 1 次首发 + 2 次重试
    expect((error as PageLoadError).path).toBe('/x')
    // cause 让控制台能展开原始堆栈
    expect((error as Error).cause).toBe(CHUNK_ERRORS[0])
    expect(importer).toHaveBeenCalledTimes(3)
  })

  it('失败后缓存被清掉 —— 下一次加载会真的重新 import（「重试」能生效）', async () => {
    const importer = vi.fn(async (): Promise<unknown> => {
      throw chunkError()
    })
    const loader = createPageLoader('/x', importer, FAST)

    await expect(loader.load()).rejects.toBeInstanceOf(PageLoadError)
    const callsAfterFail = importer.mock.calls.length

    // 网络恢复：下一次必须真的再请求一次，而不是复用那个已失败的 promise
    importer.mockImplementationOnce(async () => ok())
    await expect(loader.load()).resolves.toBeTruthy()
    expect(importer).toHaveBeenCalledTimes(callsAfterFail + 1)
    expect(loader.isLoaded()).toBe(true)
  })

  it('页面模块顶层抛错不重试（重试也修不好真 bug）', async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'length')")
    const importer = vi.fn(async (): Promise<unknown> => {
      throw bug
    })
    const loader = createPageLoader('/x', importer, FAST)

    await expect(loader.load()).rejects.toBe(bug)
    expect(importer).toHaveBeenCalledTimes(1)
  })
})

describe('createPageLoader · 预取', () => {
  it('预取失败静默，不产生未处理拒绝', async () => {
    const importer = vi.fn(async (): Promise<unknown> => {
      throw chunkError()
    })
    const loader = createPageLoader('/x', importer, FAST)

    expect(() => loader.preload()).not.toThrow()
    // 等两轮重试跑完；若 promise 未挂 catch，vitest 会把 unhandled rejection 记为失败
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(importer.mock.calls.length).toBeGreaterThan(1)
    expect(loader.isLoaded()).toBe(false)
  })
})

describe('createPageLoader · 整页自愈的触发范围', () => {
  /**
   * 这条语义最容易被写坏，且写坏的代价极大：预取也自愈的话，鼠标沿侧栏
   * 划过去一次（29 个 tab）就可能连续刷新十几次页面，比报错难受得多。
   */
  it('导航加载（autoReload: true）失败会触发整页自愈', async () => {
    const reload = vi.fn(() => true)
    const importer = vi.fn(async (): Promise<unknown> => {
      throw chunkError()
    })
    const loader = createPageLoader('/x', importer, { retryDelaysMs: [0], reload })

    // 触发自愈时 promise 故意永不 settle（页面马上要刷新），所以不能 await
    loader.load({ autoReload: true }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(reload).toHaveBeenCalledWith('/x')
  })

  it('预取失败**不**触发整页自愈', async () => {
    const reload = vi.fn(() => true)
    const importer = vi.fn(async (): Promise<unknown> => {
      throw chunkError()
    })
    // 即使构造时允许自愈，预取也必须压住
    const loader = createPageLoader('/y', importer, { autoReload: true, retryDelaysMs: [0], reload })

    loader.preload()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(reload).not.toHaveBeenCalled()
  })
})

describe('isPagePath', () => {
  it('只认已登记的页面路径', () => {
    expect(isPagePath('/')).toBe(true)
    expect(isPagePath('/timeline')).toBe(true)
    expect(isPagePath('/execution-audit')).toBe(true)
    expect(isPagePath('/not-a-page')).toBe(false)
    // 防止 prototype 上的键被当成路径（Object.hasOwn 而非 in）
    expect(isPagePath('toString')).toBe(false)
  })
})
