/**
 * 全页面渲染冒烟测试 —— 用**真实落盘数据**把 21 个页面各渲染一遍。
 *
 * ## 为什么值得单独写这一个测试
 *
 * 其余测试（语义函数、单卡片）都只覆盖局部。而本项目的失效模式集中在
 * 「21 个新页面 × 19 类数据源 × 真实字段可空性」的交叉点：
 *   · 把 `zt_count` 读成 `zt_count.length`（盘前为 null 时崩）
 *   · 把可选字段（`tx_5d_yi` / `pledge_pct` / `carrier_migr?`）当成必填
 *   · 路由名写错（类型层已挡，但运行时 404 会静默成空态）
 *
 * 这类问题**编译期与 lint 都发现不了**，只有真渲染一次才会暴露。
 *
 * ## 数据来源：与 dev 中间件**同一份实现**
 *
 * `read-route.mjs` 就是 vite 中间件与 `npm run data` 体检共用的读取器。
 * 测试里直接把 `fetch` 接到它上面，等价于「页面在真实数据下渲染」，
 * 且不需要起服务、不需要 mock 数据形状 —— mock 出来的数据永远比真实数据干净，
 * 也就永远发现不了真实数据里的坑。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import path from 'node:path'
import { ROUTES, FILE_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, healthPayload, resolveDataRoot } from '../scripts/lib/read-route.mjs'

/** ⚠️ 用 `import.meta.dirname`（Node ≥20.11）而非 `__dirname` —— 后者在 ESM 下不存在，
 *  只能靠 `fileURLToPath(import.meta.url)` 手工重建；前者是原生等价物，少一层转换。 */
const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

/** 真实数据的 fetch 替身：走 readRoute 与 dev 中间件同一条路径 */
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
      const body = readRoute(DATA_ROOT, def)
      return new Response(JSON.stringify(body), { status: 200 })
    } catch {
      // 数据缺失是**可预期状态**（盘前大量文件未生成）——此处如实返回 404，
      // 让页面走它自己的空态降级分支，这也正是要测的一条路径。
      return new Response('{"error":"data_unavailable"}', { status: 404 })
    }
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

/**
 * 页面清单 = `app/router.tsx` 的 children 一一对应。
 *
 * ⚠️ 新增页面时**必须同步此处** —— 否则新页面永远不进冒烟覆盖，
 *    而它恰恰是最可能出问题的那一个。
 */
const PAGES: ReadonlyArray<[name: string, importer: () => Promise<unknown>]> = [
  ['intraday', () => import('@/pages/intraday/IntradayPage')],
  ['timeline', () => import('@/pages/timeline/TimelinePage')],
  ['emotion', () => import('@/pages/emotion/EmotionPage')],
  ['board-core', () => import('@/pages/board-core/BoardCorePage')],
  ['promotion', () => import('@/pages/promotion/PromotionPage')],
  ['gene', () => import('@/pages/gene/GenePage')],
  ['rotation', () => import('@/pages/rotation/RotationPage')],
  ['mainline', () => import('@/pages/mainline/MainlinePage')],
  ['reflow', () => import('@/pages/reflow/ReflowPage')],
  ['eruption', () => import('@/pages/eruption/EruptionPage')],
  ['flow', () => import('@/pages/flow/FlowPage')],
  ['lhb', () => import('@/pages/lhb/LhbPage')],
  ['carrier', () => import('@/pages/carrier/CarrierPage')],
  ['risk', () => import('@/pages/risk/RiskPage')],
  ['hithink', () => import('@/pages/hithink/HithinkPage')],
  ['ai', () => import('@/pages/ai/AiPage')],
  ['trade', () => import('@/pages/trade/TradePage')],
  ['backtest', () => import('@/pages/backtest/BacktestPage')],
  ['institution', () => import('@/pages/institution/InstitutionPage')],
  ['auction', () => import('@/pages/auction/AuctionPage')],
  ['record', () => import('@/pages/record/RecordPage')],
  ['stack', () => import('@/pages/stack/StackPage')],
  ['archive', () => import('@/pages/archive/ArchivePage')],
  ['cards', () => import('@/pages/cards/CardsPage')],
  ['system', () => import('@/pages/system/SystemPage')],
  ['ops', () => import('@/pages/ops/OpsPage')],
]

let restore: () => void
beforeAll(() => {
  restore = installDataFetch()
})
afterAll(() => {
  restore?.()
})

describe('全页面真实数据渲染', () => {
  for (const [name, importer] of PAGES) {
    it(`${name} 页面可渲染且不抛错`, async () => {
      const mod = (await importer()) as { Component?: ComponentType }
      expect(mod.Component, `${name} 缺少 Component 导出`).toBeTypeOf('function')

      const client = new QueryClient({
        // 真实数据下不重试、不轮询：一次渲染即可暴露崩溃
        defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
      })
      const Page = mod.Component!

      const wrap = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )

      const { container } = render(<Page />, { wrapper: wrap })

      // 等查询落定（成功或失败都行 —— 失败也必须能优雅降级为空态）
      await waitFor(() => {
        expect(client.isFetching()).toBe(0)
      })

      // 关键断言：渲染出了实体内容，而不是白屏
      expect(container.textContent?.trim().length).toBeGreaterThan(0)

      /**
       * 逐个点开页面内的按钮 —— 这一步是**必要的**，不是补充。
       *
       * 分段切换（SegTabs）把大部分视图藏在 tab 之后，只渲染默认 tab 等于
       * 只测了 1/N 的渲染路径。实测教训：龙虎榜页默认 tab（机构）正常，
       * 而「游资席位」tab 里把 `stocks`（对象数组）当字符串数组渲染会直接抛错，
       * 不点开就永远发现不了。
       */
      const buttons = Array.from(container.querySelectorAll('button')).slice(0, 12)
      for (const btn of buttons) {
        fireEvent.click(btn)
        expect(container.textContent?.trim().length).toBeGreaterThan(0)
      }

      client.clear()
    })
  }
})
