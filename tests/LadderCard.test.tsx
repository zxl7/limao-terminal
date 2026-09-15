/**
 * 组件级测试 —— 演示「数据层 → 展示层」的完整接线是否成立。
 *
 * 覆盖三件事：
 *   1. QueryClientProvider 与 useQuery 能正确取到数据并渲染；
 *   2. **涨停整行红** 这条 A股展示规则确实生效（最高板梯队标红）；
 *   3. 数据缺失时**降级为空态而非崩溃**（盘前大量字段为空的真实场景）。
 *
 * ⚠️ 这类测试的价值不在「覆盖率」，而在**钉住契约**：一旦谁把 `ladder` 的
 *    `stocks: string[]` 误当成对象数组，这个测试会立刻失败。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LadderCard } from '@/features/market'

/** 每个用例独立的 QueryClient：避免缓存跨用例污染 */
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** 造一个只含被测字段的最小快照 */
function snapshot(ladder: { boards: number; stocks: string[] }[]) {
  return {
    ts: new Date().toISOString(),
    total_zt: 42,
    sentiment: '中性',
    sentiment_detail: { label: '中性', score: 5, seal_rate: 71.4 },
    index: [],
    limit_down: { count: 3, names: [] },
    broken: { count: 5, names: [] },
    weak_sectors: { focus_hits: [], ld_count: 0, broken_count: 0, ld_names: [], broken_names: [] },
    sector_risk: { threshold: -2.5, declining: [], focus_declining: [], count: 0, inflow_top: [], outflow_top: [], ok: true },
    ladder,
    newsflash: [],
    em_expect: [],
    early: [],
    leaders: [],
    rising: [],
    hot_spots: [],
    market: null,
    breadth: { up: null, down: null, flat: null },
    data_scope: { asof: '10:30', source: 'test' },
    ebb: { severity: null },
    top5: [],
    sector_delta: {},
  }
}

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 404,
      json: async () => body,
    })),
  )
}

describe('LadderCard', () => {
  beforeEach(() => {
    // 契约守卫在结构不符时会 console.warn —— 测试里静音，避免噪声淹没真实失败
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('渲染连板天梯，且最高板梯队标红（涨停整行红规则）', async () => {
    mockFetch(
      snapshot([
        { boards: 2, stocks: ['甲股份'] },
        { boards: 5, stocks: ['龙一科技', '龙二科技'] },
      ]),
    )

    const { container } = render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(screen.getByText('5板')).toBeInTheDocument()
    })

    // 最高板（5板）整行获得红色底
    const topRow = screen.getByText('5板').closest('div') as HTMLElement
    expect(topRow.className).toContain('bg-up-soft')

    // 非最高板（2板）不标红
    const secondRow = screen.getByText('2板').closest('div') as HTMLElement
    expect(secondRow.className).not.toContain('bg-up-soft')

    // 统计文案：3 只 / 2 个梯队
    expect(container.textContent).toContain('3 只')
    expect(container.textContent).toContain('2 个梯队')
  })

  it('阶梯为空时降级为空态，不崩溃', async () => {
    mockFetch(snapshot([]))

    render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(screen.getByText('暂无连板梯队')).toBeInTheDocument()
    })
  })

  it('接口 404（盘前数据未生成）时同样降级为空态', async () => {
    mockFetch({ error: 'data_unavailable' }, false)

    render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(screen.getByText('暂无连板梯队')).toBeInTheDocument()
    })
  })

  it('天梯乱序输入时按板数降序展示（最高板必在首位）', async () => {
    mockFetch(
      snapshot([
        { boards: 1, stocks: ['低板'] },
        { boards: 4, stocks: ['高板'] },
        { boards: 2, stocks: ['中板'] },
      ]),
    )

    const { container } = render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(container.textContent).toContain('4板')
    })

    const text = container.textContent ?? ''
    expect(text.indexOf('4板')).toBeLessThan(text.indexOf('2板'))
    expect(text.indexOf('2板')).toBeLessThan(text.indexOf('1板'))
  })
})
