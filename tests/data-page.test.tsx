import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Component as DataPage } from '@/pages/data/DataPage'

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  const body = url.startsWith('/api/data/exit-peaks')
    ? {
        schema: 'intraday_exit_peaks_v1',
        date: '2026-10-22',
        updated_at: '2026-10-22T14:59:10+08:00',
        stocks: {
          '002724': {
            name: '海洋王',
            current_seal_yi: null,
            current_sealed: false,
            current_observed_at: '2026-10-22T14:59:10+08:00',
            quote_at: '2026-10-22T14:59:10+08:00',
            seal_yi_peak: 4.26,
            seal_yi_peak_at: '2026-10-22T09:32:08+08:00',
          },
        },
        sectors: {},
      }
    : url.startsWith('/api/data/theme-snapshot')
      ? []
      : url.startsWith('/api/data/top5-history')
        ? []
        : url.startsWith('/api/data/stock-registry')
          ? { code: '002724', found: false, stock: null }
          : url.startsWith('/api/data/market-daily')
            ? { code: '002724', limit: 20, bars: [] }
            : {}
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<DataPage />, { wrapper: wrap })
}

afterEach(() => {
  fetchSpy.mockClear()
  vi.unstubAllGlobals()
})

describe('数据底座页', () => {
  it('未输入合法代码时不请求单票接口', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    renderPage()

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })
    expect(screen.getByText('输入6位代码查看事实档')).toBeTruthy()
    expect(screen.getByText('输入6位代码查看近月日K')).toBeTruthy()

    const input = screen.getByPlaceholderText('输入股票代码，例如 002724')
    fireEvent.change(input, { target: { value: '00272' } })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('合法代码按需请求两类单票事实，未命中不表述成市场不存在', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    renderPage()
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    fireEvent.change(screen.getByPlaceholderText('输入股票代码，例如 002724'), {
      target: { value: '002724' },
    })

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(5)
    })
    const urls = fetchSpy.mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes('/api/data/stock-registry?code=002724'))).toBe(true)
    expect(urls.some((url) => url.includes('/api/data/market-daily?code=002724&limit=20'))).toBe(true)
    expect(await screen.findByText('系统事实库未命中')).toBeTruthy()
    expect(screen.getByText('未命中不等于市场中不存在该股票')).toBeTruthy()
  })

  it('题材映射超过24只仍可滚动查看末尾记录', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('/api/data/theme-snapshot')) return fetchSpy(input)
      const mapping = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [
        String(100000 + index), { name: `映射样本${index}`, theme: '测试题材' },
      ]))
      return new Response(JSON.stringify([{ file: 'theme_2026-10-22.json', data: {
        schema: 'theme_snapshot_v1', date: '2026-10-22', mapping,
      } }]), { status: 200 })
    }))
    renderPage()
    const first = await screen.findByText('映射样本0')
    const container = first.closest('table')!.parentElement!
    fireEvent.scroll(container, { target: { scrollTop: 1900 } })
    expect(await screen.findByText('映射样本59')).toBeTruthy()
  })

  it('空封单不填零，峰值时刻与报价时刻分别保留', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    renderPage()
    const row = (await screen.findByText('海洋王')).closest('tr')!
    const cells = within(row).getAllByRole('cell')
    expect(cells[1].textContent).toBe('未封')
    expect(cells[2].textContent).toBe('—')
    expect(cells[3].textContent).toBe('4.3')
    expect(cells[4].textContent).toBe('09:32:08')
    expect(cells[5].textContent).toBe('14:59:10')
  })

  it('接口失败不冒充未命中或未入库', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"data_unavailable"}', { status: 503 })))
    renderPage()
    expect(await screen.findByText('封单观察读取失败')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('输入股票代码，例如 002724'), {
      target: { value: '002724' },
    })
    expect(await screen.findByText('系统事实档查询失败')).toBeTruthy()
    expect(await screen.findByText('近月日K查询失败')).toBeTruthy()
    expect(screen.queryByText('系统事实库未命中')).toBeNull()
    expect(screen.queryByText('近月日K未入库')).toBeNull()
  })

  it('日K保留分位价格，成交量和成交额按声明单位换算', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('/api/data/market-daily')) return fetchSpy(input)
      return new Response(JSON.stringify({ code: '002724', limit: 20, bars: [{
        code: '002724', thscode: null, trade_date: '2026-10-22',
        open: 10.23, high: 10.89, low: 10.12, close: 10.56,
        volume: 1230000, amount: 230000000, currency: 'CNY', source: 'fixture', ingested_at: null,
      }] }), { status: 200 })
    }))
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('输入股票代码，例如 002724'), {
      target: { value: '002724' },
    })
    const row = (await screen.findByText('2026-10-22', { selector: 'td span' })).closest('tr')!
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '2026-10-22', '10.23', '10.89', '10.12', '10.56', '123', '2.3',
    ])
  })

  it('切换代码后不保留上一只股票的查询结论', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    renderPage()
    const input = screen.getByPlaceholderText('输入股票代码，例如 002724')
    fireEvent.change(input, { target: { value: '002724' } })
    expect(await screen.findByText('系统事实库未命中')).toBeTruthy()
    fireEvent.change(input, { target: { value: '00272' } })
    expect(screen.getByText('输入6位代码查看事实档')).toBeTruthy()
    expect(screen.queryByText('系统事实库未命中')).toBeNull()
  })
})
