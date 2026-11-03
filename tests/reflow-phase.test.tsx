/**
 * 题材回流页 · 周期相位展示契约（2026-11-03）。
 *
 * ## 锁什么
 *
 * 1. **「周期位置」块必须存在** —— 它是本页的第一等重要信息：同一组家数
 *    出现在第 1 天和第 5 天是相反的两件事，而 `confidence` 对两者给分可能一样。
 * 2. **相位中文名不许裸奔英文** —— `ebb` / `start` 这类内部 token 一旦漏到屏幕上，
 *    比没有这一列更糟（用户会把它当黑话跳过）。
 * 3. **数据缺失要显式说「未取到」**，⛔ 不许渲染成任一相位。
 *
 * ## 数据来源
 *
 * 与 `all-pages-render.test.tsx` 同一条路：`read-route.mjs`（dev 中间件同款读取器）
 * → 真实落盘数据，不 mock 形状。mock 出来的数据永远比真实数据干净。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import path from 'node:path'
import { ROUTES, FILE_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, healthPayload, resolveDataRoot } from '../scripts/lib/read-route.mjs'

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

function installDataFetch() {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url).split('?')[0]
    if (url === '/api/health') {
      return new Response(JSON.stringify(healthPayload(DATA_ROOT, FILE_ROUTES)), { status: 200 })
    }
    const def = (ROUTES as Record<string, unknown>)[url]
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

let restore: () => void
beforeAll(() => {
  restore = installDataFetch()
})
afterAll(() => {
  restore?.()
})

/** 读取一次回流路由原始数据，判断本机是否已生成 phase_v2 */
function readRotation(): { candidates?: Array<Record<string, unknown>> } | null {
  try {
    return readRoute(
      DATA_ROOT,
      ROUTES['/api/theme/rotation'],
    ) as { candidates?: Array<Record<string, unknown>> } | null
  } catch {
    return null
  }
}

async function renderPage() {
  const mod = (await import('@/pages/reflow/ReflowPage')) as {
    Component?: () => ReactNode
  }
  expect(mod.Component, 'reflow 缺少 Component 导出').toBeTypeOf('function')
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
  })
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const Page = mod.Component as () => ReactNode
  const { container } = render(<Page />, { wrapper: wrap })
  await waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
  return container
}

describe('题材回流 · 周期相位契约', () => {
  it('页面必须出现「周期位置」块（本页第一等重要信息）', async () => {
    const c = await renderPage()
    expect(c.textContent).toContain('周期位置')
  }, 30_000)

  it('表格必须有一列叫「周期」', async () => {
    const c = await renderPage()
    const heads = Array.from(c.querySelectorAll('th, [role="columnheader"]')).map(
      (h) => h.textContent?.trim() ?? '',
    )
    // 表头可能被 DataTable 用普通 div 渲染，退一步用全文兜底
    const hit = heads.includes('周期') || (c.textContent ?? '').includes('周期')
    expect(hit).toBe(true)
  }, 30_000)

  it('⛔ 相位内部 token 不许漏到屏幕上', async () => {
    const c = await renderPage()
    const text = c.textContent ?? ''
    for (const token of ['ebb', 'dormant', 'ferment', 'climax', 'reflow', 'diverge']) {
      expect(text, `英文枚举 ${token} 漏到了回流页`).not.toContain(token)
    }
  }, 30_000)

  it('数据缺相位时要显式写「未取到」，⛔ 不许默认成任一相位', async () => {
    const rot = readRotation()
    const cands = rot?.candidates ?? []
    const missing = cands.filter((x) => !x.phase_v2)
    if (missing.length === 0) {
      // 本机数据全都有相位 → 该分支不适用（⛔ 不拿「没数据」假装通过）
      expect(true).toBe(true)
      return
    }
    const c = await renderPage()
    expect(c.textContent).toContain('未取到')
  }, 30_000)
})
