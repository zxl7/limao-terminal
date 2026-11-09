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
import { isFrozenSnapshot } from '@/shared/lib'
import { MarketSnapshotSchema } from '@/shared/api/schemas'
import { EbbBanner } from '@/features/market/components/EbbBanner'
import { TideCard } from '@/features/market/components/TideCard'
import { buildTideState } from '@/features/market/lib/tide'
import { ebbTone } from '@/features/market/model/labels'
import type { EbbInfo } from '@/shared/api/types'
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

describe('风险口径 · 全市场与接力分离', () => {
  const legacy: EbbInfo = {
    severity: '情绪转弱', signals: ['晋级率偏低'], max_board: 3, total_zt: 60,
    sentiment_score: null, sentiment_label: '分歧',
  }

  it.each(['market', 'relay', 'mixed'] as const)('契约接受 %s 范围与空情绪分，保留新旧字段', (scope) => {
    const ebb = { ...legacy, risk_scope: scope, risk_level: 'warning', market_effect: 'strong' }
    expect(MarketSnapshotSchema.parse({ ebb }).ebb).toEqual(ebb)
    expect(MarketSnapshotSchema.parse({ ebb: legacy }).ebb).toEqual(legacy)
  })

  it.each([
    ['接力转弱', 'mid'], ['接力风险预警', 'warn'],
    ['大盘承压', 'mid'], ['大盘风险预警', 'warn'],
    ['情绪转弱', 'mid'], ['退潮预警', 'warn'],
    ['high', 'down'], ['severe', 'down'], ['medium', 'warn'], ['mid', 'warn'],
  ] as const)('新旧 severity「%s」判色兼容', (severity, tone) => {
    expect(ebbTone(severity)).toBe(tone)
  })

  it.each(['strong', 'positive', 'neutral', 'weak', 'unknown'] as const)('赚钱效应 %s 可解析，非法枚举不放行', (effect) => {
    expect(MarketSnapshotSchema.safeParse({ ebb: { ...legacy, market_effect: effect } }).success).toBe(true)
    for (const field of ['market_effect', 'risk_scope', 'risk_level']) {
      expect(MarketSnapshotSchema.safeParse({ ebb: { ...legacy, [field]: 'invalid' } }).success).toBe(false)
    }
  })

  it('结构化风险等级优先于文案', () => {
    expect(ebbTone('旧文案', 'warning')).toBe('warn')
    expect(ebbTone('退潮预警', 'weak')).toBe('mid')
  })

  it.each([
    ['relay', 'weak', '接力转弱', 'text-head-mid'],
    ['relay', 'warning', '接力风险预警', 'text-head-warn'],
    ['market', 'weak', '大盘承压', 'text-head-mid'],
    ['mixed', 'warning', '大盘风险预警', 'text-head-warn'],
    [undefined, undefined, '情绪转弱', 'text-head-mid'],
    [undefined, undefined, '退潮预警', 'text-head-warn'],
  ] as const)('顶栏与通栏按 %s / %s 独立展示风险', async (scope, level, severity, color) => {
    const original = globalThis.fetch
    const ebb = { ...legacy, severity, risk_scope: scope, risk_level: level, market_effect: 'strong' }
    globalThis.fetch = (async () => new Response(JSON.stringify({ ebb }), {
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    try {
      const c = await renderTopBar()
      expect(c.querySelector('header')?.textContent).toContain(severity)
      expect([...c.querySelectorAll('span')].find((s) => s.textContent === severity)?.className).toContain(color)
      const banner = render(<QueryClientProvider client={client}><EbbBanner /></QueryClientProvider>)
      await waitFor(() => expect(banner.container.textContent).toContain(severity))
      const text = banner.container.textContent ?? ''
      expect(text).toContain('全市场赚钱效应：强')
      expect(text).toContain('接力情绪分—')
      expect(text).toContain('判断依据：1 项')
      expect(text).not.toMatch(/负反馈|全局情绪|\/10/)
      if (scope === 'relay') expect(text).toContain('风险范围：接力')
    } finally {
      client.clear()
      globalThis.fetch = original
    }
  })

  it('无预警不占位，旧数据缺少市场效应时不伪造结论', async () => {
    const client = new QueryClient()
    client.setQueryData(['market', 'latest'], { ebb: null })
    const view = render(<QueryClientProvider client={client}><EbbBanner /></QueryClientProvider>)
    expect(view.container.textContent).toBe('')
    client.setQueryData(['market', 'latest'], { ebb: legacy })
    await waitFor(() => expect(view.container.textContent).toContain(legacy.severity))
    expect(view.container.textContent).not.toContain('全市场赚钱效应')
    expect(view.container.textContent).toContain('判断依据：1 项')
    view.unmount()
    client.clear()
  })

  it('潮位文案限定接力而不改变周期算法', () => {
    const tide = buildTideState(null)
    const view = render(<TideCard tide={tide} window={[]} />)
    expect(view.container.textContent).toContain('接力情绪周期，不代表全市场赚钱效应')
    expect(view.container.textContent).toContain('接力环境处理')
    expect(view.getByLabelText('接力情绪周期多日样本')).toBeTruthy()
  })
})

describe('顶栏 · 定格态（周末/节假日/盘后不报延迟）', () => {
  /**
   * 用户 2026-10-31（周六）：「今天休息日的嘛，数据定格」。
   *
   * 不变量：**数据基准日不是今天** ⇒ 显示「定格」，且**不得**出现 `+N s` 的延迟告警。
   * 反之，同日数据（盘中）必须仍然显示延迟秒数 —— 那是真监控。
   * 断言按真实数据推导，不写死日期（否则换一天就红）。
   */
  it('非当日快照 → 显示「定格」且没有 +Ns；同日快照 → 仍有延迟秒数', async () => {
    const c = await renderTopBar()
    const snap = readSnapshot()
    const asof = String((snap?.data_scope as { asof?: string } | undefined)?.asof ?? snap?.ts ?? '')
    // ⚠️ 不能只比日期：收盘后 >1h 也算定格（11-02 22:29 实测把这条测红了）。
    //    直接复用生产判定，测的就是「页面与规则一致」。
    const frozen = isFrozenSnapshot(asof, new Date())
    const text = c.textContent ?? ''

    if (frozen) {
      expect(text, '非当日数据应标「定格」').toContain('定格')
      expect(text, '⛔ 定格态不该再报「落后 N 秒」').not.toMatch(/\+\d+s/)
    } else {
      expect(text, '同日数据不该被误标定格').not.toContain('定格')
      expect(text, '同日数据必须显示延迟秒数').toMatch(/\+\d+s/)
    }
  })
})
