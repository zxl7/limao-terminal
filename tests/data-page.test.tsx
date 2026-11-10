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
  it('读取后端统一RSI证据并显示来源口径', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('/api/data/market-daily')) return fetchSpy(input)
      return new Response(JSON.stringify({ code: '002724', limit: 20,
        bars: [{ code: '002724', trade_date: '2026-10-22', close: 10 }],
        rsi_evidence: { schema: 'rsi_evidence_v1', code: '002724', asof: '2026-10-22',
          dates: ['2026-10-22'], sample_count: 1,
          readings: { '6': { series: [61] }, '12': { series: [52] }, '24': { series: [null] } } },
      }), { status: 200 })
    }))
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('输入股票代码，例如 002724'), {
      target: { value: '002724' },
    })
    expect(await screen.findByText(/统一研究证据 · 截至2026-10-22/)).toBeTruthy()
    const chart = screen.getByRole('img', { name: '折线图：RSI6、RSI12、RSI24' })
    expect(chart.querySelectorAll('circle')).toHaveLength(2)
  })

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
    // ⛔ 2026-11-10：整列为空时该列不渲染（当前状态/当前封单在收盘后常全空），
    //    所以按表头定位，不写死列下标。
    const table = row.closest('table') as HTMLElement
    const head = within(table).getAllByRole('columnheader')
    const col = (name: string) => head.findIndex((th) => th.textContent?.includes(name))
    const cells = within(row).getAllByRole('cell')
    // 夹具里全部「未封」且封单全空 ⇒ 两列都不渲染（空列既占宽又像「有数据只是没显示」）；
    // 盘中峰值 / 峰值时刻 / 报价时刻 必须原样保留。
    expect(col('当前状态')).toBe(-1)
    expect(col('当前封单')).toBe(-1)
    expect(cells[col('盘中峰值')].textContent).toBe('4.3')
    expect(cells[col('峰值时刻')].textContent).toBe('09:32:08')
    expect(cells[col('报价时刻')].textContent).toBe('14:59:10')
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

  it('日K区显示RSI训练曲线，并按正序计算短中长周期', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes('/api/data/market-daily')) return fetchSpy(input)
      const closes = [10, 11, 10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19, 18, 20]
      return new Response(JSON.stringify({
        code: '002724', limit: 20,
        bars: closes.map((close, index) => ({
          code: '002724', thscode: null, trade_date: `2026-10-${String(index + 1).padStart(2, '0')}`,
          open: close, high: close, low: close, close, volume: null, amount: null,
          currency: 'CNY', source: 'fixture', ingested_at: null,
        })).reverse(),
      }), { status: 200 })
    }))
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('输入股票代码，例如 002724'), { target: { value: '002724' } })
    expect(await screen.findByRole('img', { name: '折线图：RSI6、RSI12、RSI24' })).toBeTruthy()
    expect(screen.getByText('RSI6')).toBeTruthy()
    expect(screen.getByText('RSI12')).toBeTruthy()
    expect(screen.getByText('RSI24')).toBeTruthy()
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
