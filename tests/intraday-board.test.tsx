/**
 * 盘中实时页 —— **PC 大屏布局与内容覆盖**回归锁。
 *
 * ## 为什么需要这个测试（它锁的是「以前根本测不到」的一类问题）
 *
 * 2026-09-15 用户反馈：「放到 4K PC 屏幕上，整体布局非常空洞」。
 * 根因有两层，**两层都没有任何测试覆盖**：
 *
 *   ① 布局层：21 个页面一律 `flex flex-col`（单列铺满）。4K 下一张卡横跨
 *      3800px 而内容只占左侧 500–800px → 单卡横向空洞约 80%。
 *   ② 内容层：首屏只用了主快照 20 个字段里的 5–8 个。`ebb`（退潮预警）、
 *      `index`（三大指数）、`top5`（主线热度）、`early`（早鸟埋伏）、
 *      `sector_risk`、`sector_delta`、`em_expect` 全部**已落盘但零渲染** ——
 *      空洞有一半是内容没上屏。
 *
 * 这两层都不会被「页面能渲染、不抛错」这类冒烟测试发现：单列布局渲染得
 * 完美，只是很空；缺失的模块更不会报错，它只是不存在。
 *
 * ## 断言策略：锁「不变量」而不是锁「像素」
 *
 *   1. PC 密度 —— 网格断点类必须存在，且 `theme.css` 必须定义对应的断点令牌
 *   2. 模块覆盖 —— 新增的每张卡都必须真的渲染出来（锁住「内容不上屏」回归）
 *   3. 数据卫生 —— 不出现 `undefined` / `NaN` / `[object Object]`（真实数据
 *      字段可空性的一大类 bug 就表现成这些字面量直接印在屏幕上）
 *
 * ## ⚠️ 为什么断言 `theme.css` 的令牌而不只断言类名
 *
 * Tailwind 只对**已定义的断点**生成 CSS。若有人删掉 `--breakpoint-3xl`，
 * `3xl:grid-cols-4` 这个**类名依然会留在 DOM 的 class 属性里**（它只是字符串），
 * 但产物里不会生成任何对应规则 —— 页面静默退回 2 列，而只查 class 的测试
 * 会一路绿灯。所以令牌与类名都要锁。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import fs from 'node:fs'
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

/** 读真实快照 —— 用于「数据驱动」的断言（有则必须渲染，无则必须不渲染） */
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

/** 渲染盘中实时页并等查询落定 */
async function renderIntraday() {
  const mod = (await import('@/pages/intraday/IntradayPage')) as { Component?: ComponentType }
  expect(mod.Component, 'IntradayPage 缺少 Component 导出').toBeTypeOf('function')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
  })
  const Page = mod.Component!
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { container } = render(<Page />, { wrapper })
  await waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
  return container
}

describe('盘中实时页 · PC 大屏布局不变量', () => {
  it('实时页采用任务导向三栏分区，xl 断点升起多栏布局', async () => {
    const c = await renderIntraday()
    const zones = c.querySelector('.intraday-zones') as HTMLElement | null
    expect(zones, '未找到三栏分区容器 `.intraday-zones` —— 退回单列 = 4K 空洞成因').toBeTruthy()
    expect(
      zones?.className,
      '三栏分区未在 xl 断点升起（窄屏强塞三栏会挤压主区）',
    ).toContain('xl:flex-row')
  })

  it('theme.css 定义了 3xl / 4xl 断点令牌（否则上面的类名不会生成 CSS）', () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/styles/theme.css'), 'utf8')
    expect(css, '缺少 --breakpoint-3xl —— 3xl: 前缀的类全部静默失效').toContain('--breakpoint-3xl')
    expect(css, '缺少 --breakpoint-4xl —— 4xl: 前缀的类全部静默失效').toContain('--breakpoint-4xl')
  })

  it('三栏主体位于首屏，情绪通栏不再占用盘中页首行', async () => {
    const c = await renderIntraday()
    const root = c.firstElementChild as HTMLElement
    expect(root.className, '根容器应是纵向 flex（通栏由 flex 自然铺满）').toContain('flex-col')
    // 情绪指挥条已上移顶栏 header，盘中页首屏主体应直接是三栏工作内容
    const zones = root.querySelector('.intraday-zones') as HTMLElement | null
    expect(zones, '首屏缺少三栏分区 —— 工作内容不是首屏主体').toBeTruthy()
  })
})

describe('盘中实时页 · 实时字段覆盖（此前零渲染）', () => {
  it('指挥条维度已上移顶栏：盘中页不重复渲染情绪 KPI 与指数', async () => {
    // 「这些维度必须上屏」的覆盖已迁移到 tests/topbar-header.test.tsx（载体 = 顶栏）。
    // 这里锁的是迁移后的**新不变量**：同一维度不应在顶栏与盘中页各显示一次。
    const c = await renderIntraday()
    const text = c.textContent ?? ''

    // 「快照情绪」是指挥条专属定性标签，现已归顶栏 header；盘中页再出现即为重复
    expect(text, '盘中页仍在渲染「快照情绪」—— 该维度已上移顶栏 header').not.toContain('快照情绪')

    // 三大指数同理，只在顶栏出现一次
    const snap = readSnapshot()
    const idx = (snap?.index as { name: string }[] | undefined) ?? []
    for (const ix of idx) {
      expect(text, `盘中页仍渲染指数「${ix.name}」—— 指数维度已上移顶栏`).not.toContain(ix.name)
    }
  })

  it('退潮预警与数据同真同假（ebb 非空必上屏，为空必不占位）', async () => {
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    const snap = readSnapshot()
    const ebb = snap?.ebb as { severity?: string; signals?: string[] } | null | undefined

    if (ebb?.severity) {
      expect(text, `ebb.severity=${ebb.severity} 但预警未渲染`).toContain(ebb.severity)
      for (const sig of ebb.signals ?? []) {
        expect(text, `退潮信号「${sig}」未渲染`).toContain(sig)
      }
    } else {
      expect(text, 'ebb 为空却渲染了预警 —— 正常态不该占位').not.toContain('退潮预警')
    }
  })

  it('新增的 6 张实时卡全部上屏', async () => {
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    const titles = [
      '🚀 早鸟埋伏',
      '🔥 主线热度',
      '💰 板块资金与弱势',
      '🧭 次日预期',
      '🔀 板块增减',
      '🧊 极值名单',
    ]
    for (const t of titles) {
      expect(text, `卡片「${t}」未渲染 —— 该模块内容未上屏`).toContain(t)
    }
  })
})

describe('盘中实时页 · 数据卫生', () => {
  it('不把 undefined / NaN / [object Object] 印到屏幕上', async () => {
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    for (const bad of ['undefined', 'NaN', '[object Object]']) {
      expect(text, `页面出现「${bad}」—— 字段可空性处理有漏`).not.toContain(bad)
    }
  })

  it('⛔ 不出现科创板（688/689）标的 —— 用户无交易权限', async () => {
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    const snap = readSnapshot()

    /**
     * ⚠️ 断言必须落在**名称**上，不能只查代码。
     *
     * 「次日预期」卡只渲染标的**名称**（东财榜不带本系统口径的代码），
     * 所以「页面文本里没有 688313」这种断言永远成立 —— 它测不到任何东西。
     * 实测教训：去掉 688 过滤后该断言依然全绿。
     *
     * 正确做法是从真实数据里取出所有 688 标的的名称，逐个断言未出现。
     */
    const starNames: string[] = []
    const emExpect = (snap?.em_expect as { stocks?: { code?: string; name?: string }[] }[]) ?? []
    for (const e of emExpect) {
      for (const s of e.stocks ?? []) {
        if (/^68[89]/.test(s.code ?? '')) starNames.push(s.name ?? '')
      }
    }
    expect(starNames.length, '样本里没有 688 标的 —— 本断言当前测不到东西，需换样本').toBeGreaterThan(0)

    for (const name of starNames) {
      expect(text, `科创板「${name}」被渲染到页面上 —— 无权限标的不得展示`).not.toContain(name)
    }

    // 兜底：若将来有卡片连代码一起渲染，这条会拦住（两种形态都拦）
    expect(text, '页面出现 688/689 代码').not.toMatch(/\b68[89]\d{3}\b/)
  })

  it('广度/量能维度已上移顶栏：盘中页不再承载这些 KPI', async () => {
    // 「缺失数据显示 — 而不是 0」的强覆盖已迁移到 tests/topbar-header.test.tsx
    // —— 那里用**构造的缺失样本**验证，不再依赖真实数据恰好缺失。
    // 这里锁的是迁移后的新不变量：这些维度只应出现在顶栏。
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    for (const label of ['封板率', '上涨家数']) {
      expect(text, `盘中页仍渲染「${label}」—— 该 KPI 已上移顶栏 header`).not.toContain(label)
    }
  })
})
