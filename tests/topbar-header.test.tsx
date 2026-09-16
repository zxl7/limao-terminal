/**
 * 顶栏 header —— **盘中情绪维度的唯一载体**回归锁。
 *
 * ## 为什么单独一个测试
 *
 * 2026-09-15 用户要求：盘中实时页的 `MoodBar` 指挥条「直接移除，数据维度都放到
 * 顶部 header」。于是原先由盘中页指挥条承载的维度（情绪分、三大指数、涨停/跌停/
 * 炸板/封板率/最高板/涨跌家数/成交额）全部迁到全局顶栏 `TopBar`。
 *
 * 迁移后，**「这些维度必须上屏」这条不变量不能丢** —— 只是载体从盘中页指挥条
 * 换成了顶栏。本文件就是把 `intraday-board.test.tsx` 里那两条「首屏指挥条渲染
 * 三大指数与七项 KPI」的断言**平移**过来（不是删除），并补充顶栏专属不变量。
 *
 * ## 断言策略
 *
 *   1. 维度覆盖 —— 原指挥条的每一类指标都必须在顶栏出现（锁「迁丢了」）
 *   2. 指数上屏 —— 三大指数逐个渲染（名称来自真实落盘，不写死）
 *   3. sticky 常驻 —— 顶栏必须吸附，否则滚动后盘面定性不可见
 *   4. 数据卫生 —— 不出现 undefined / NaN / [object Object]
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import path from 'node:path'
import { ROUTES, FILE_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, healthPayload, resolveDataRoot, type RouteDefLike } from '../scripts/lib/read-route.mjs'

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

/** 真实数据的 fetch 替身 —— 与 dev 中间件同一实现（`read-route.mjs`） */
function installDataFetch() {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url).split('?')[0]

    if (url === '/api/health') {
      return new Response(JSON.stringify(healthPayload(DATA_ROOT, FILE_ROUTES)), { status: 200 })
    }

    const def = (ROUTES as Record<string, RouteDefLike>)[url]
    if (!def) return new Response('{}', { status: 404 })

    try {
      return new Response(JSON.stringify(readRoute(DATA_ROOT, def)), { status: 200 })
    } catch {
      return new Response('{"error":"data_unavailable"}', { status: 404 })
    }
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

function readSnapshot(): Record<string, unknown> | null {
  const def = (ROUTES as Record<string, RouteDefLike>)['/api/market/latest']
  try {
    return readRoute(DATA_ROOT, def) as Record<string, unknown>
  } catch {
    return null
  }
}

let restore: () => void
beforeAll(() => {
  restore = installDataFetch()
})
afterAll(() => {
  restore?.()
})

/** 渲染顶栏并等查询落定 */
async function renderTopBar() {
  const mod = (await import('@/app/TopBar')) as { TopBar?: ComponentType }
  expect(mod.TopBar, 'TopBar 缺少 TopBar 导出').toBeTypeOf('function')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
  })
  const C = mod.TopBar!
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { container } = render(<C />, { wrapper })
  await waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
  return container
}

describe('顶栏 header · 盘中情绪维度承载（原盘中页指挥条迁移而来）', () => {
  it('顶栏承载原指挥条的全部数据维度', async () => {
    const c = await renderTopBar()
    const text = c.textContent ?? ''

    for (const label of [
      '快照情绪',
      '涨停',
      '跌停',
      '炸板',
      '封板率',
      '最高板',
      '上涨家数',
      '成交额',
    ]) {
      expect(text, `顶栏缺少「${label}」—— 该维度从盘中页迁移时丢失`).toContain(label)
    }
  })

  it('三大指数逐个上屏（名称来自真实落盘，不写死指数名）', async () => {
    const c = await renderTopBar()
    const text = c.textContent ?? ''

    const snap = readSnapshot()
    const idx = (snap?.index as { name: string }[] | undefined) ?? []
    expect(idx.length, '样本里没有指数 —— 本断言当前测不到东西').toBeGreaterThan(0)

    for (const x of idx) {
      expect(text, `顶栏缺少指数「${x.name}」`).toContain(x.name)
    }
  })

  it('顶栏 sticky 常驻（滚动后盘面定性仍可见）', async () => {
    const c = await renderTopBar()
    const header = c.querySelector('header') as HTMLElement | null
    expect(header, '未找到顶栏 header 元素').toBeTruthy()
    expect(
      header?.className,
      '顶栏未 sticky —— 向下滚动后情绪维度与指数不再可见',
    ).toContain('sticky')
  })

  it('数据卫生：不出现 undefined / NaN / [object Object]', async () => {
    const c = await renderTopBar()
    const text = c.textContent ?? ''

    for (const bad of ['undefined', 'NaN', '[object Object]']) {
      expect(text, `顶栏印出了脏值 ${bad} —— 缺数据应显示 — 而不是原始空值`).not.toContain(bad)
    }
  })

  /**
   * 「缺失数据渲染为 — 而不是 0」—— 从盘中页迁移而来，并**加强**。
   *
   * 原断言依赖真实数据恰好缺失（`breadth.up == null` 才检查），样本一变就
   * 静默失效。这里改为**构造缺失样本**：把广度 / 成交额 / 封板率 / 跌停 /
   * 炸板全部置空，确保断言在任何一天都真的在执行。
   */
  it('缺失数据显示 — 占位，而不是 0（构造缺失样本）', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url).split('?')[0]
      if (url === '/api/market/latest') {
        const snap = readSnapshot() ?? {}
        const sd = (snap.sentiment_detail as Record<string, unknown>) ?? {}
        return new Response(
          JSON.stringify({
            ...snap,
            breadth: { up: null, down: null, flat: null },
            market: null,
            limit_down: { count: null, names: [] },
            broken: { count: null, names: [] },
            sentiment_detail: { ...sd, seal_rate: null },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return original(input)
    }) as typeof fetch

    try {
      const c = await renderTopBar()
      const text = c.textContent ?? ''
      expect(text, '缺失数据未显示 — 占位').toContain('—')
    } finally {
      globalThis.fetch = original
    }
  })
})
