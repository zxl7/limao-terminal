import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { RelayEffect, RelayStock } from '@/shared/api'
import { RelayEffectCard } from '@/features/analytics'
import { relayExpired, selectRelay } from '@/features/analytics/lib/relayEffect'

const at = '2026-09-29T10:00:00+08:00'
const stock = (code: string, boards: number, pct: number, delta: number, amount: number): RelayStock => ({
  code, name: `股票${code}`, prev_boards: boards, pct, amount_yi: amount, at,
  sealed: false, seal_yi: null, today_fbt: null, stale: false, series: [],
  window: { start: '2026-09-29T09:45:00+08:00', end: at, amount_yi: amount, pct_change: delta },
})
const stocks = [stock('a', 2, 6, 2, 3), stock('b', 3, -5, -3, 8), stock('c', 1, 8, 3, 9)]
const summary = { key: 'relay', count: 2, quote_count: 2, amount_count: 2, state_count: 2, window_count: 2, avg_pct: 0.5, median_pct: 0.5, up_rate: 50, seal_rate: 0, amount_yi: 11, window_amount_yi: 11, window_pct_change: -0.5 }
const data: RelayEffect = { date: '2026-09-29', prev_date: '2026-09-28', generated_ts: at, phase: 'live', overview: summary, stocks, groups: [{ ...summary, key: '2' }, { ...summary, key: '1' }] }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function mount(value?: RelayEffect) {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at))
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  if (value) client.setQueryData(['market', 'relay-effect'], value)
  return render(<MemoryRouter><QueryClientProvider client={client}><RelayEffectCard /></QueryClientProvider></MemoryRouter>)
}
describe('连板量价观察', () => {
  it('固定昨日梯队，首板不混入主榜，失败股仍可查看', () => {
    expect(selectRelay(stocks, 'relay', 'strong').map(s => s.code)).toEqual(['a'])
    expect(selectRelay(stocks, 'relay', 'weak').map(s => s.code)).toEqual(['b'])
    expect(selectRelay(stocks, 'relay', 'all')).toHaveLength(2)
    expect(selectRelay(stocks, '1', 'strong').map(s => s.code)).toEqual(['c'])
  })
  it('旧行情退出排名，缩量封板仍单列展示', () => {
    expect(selectRelay([{ ...stocks[0], stale: true }], 'relay', 'strong')).toEqual([])
    expect(selectRelay([{ ...stocks[0], sealed: true, window: null, amount_yi: 0 }], 'relay', 'sealed')).toHaveLength(1)
  })
  it('午休收盘冻结有效时间，跨日不能冒充实时', () => {
    expect(relayExpired('2026-09-29', '2026-09-29T15:00:00+08:00', Date.parse('2026-09-29T19:00:00+08:00'))).toBe(false)
    expect(relayExpired('2026-09-29', at, Date.parse('2026-09-30T10:00:00+08:00'))).toBe(true)
  })
  it('矩阵筛选、榜单切换和股票展开联动', () => {
    mount(data)
    fireEvent.click(screen.getByRole('button', { name: '活跃走弱' }))
    expect(screen.getByText('股票b')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '全部股票' }))
    fireEvent.click(screen.getByRole('button', { name: '查看股票a' }))
    expect(screen.getByText(/当日观察记录/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '昨首板 · 低位对照' })[0])
    expect(screen.getByText('股票c')).toBeInTheDocument()
    expect(screen.queryByText('股票b')).not.toBeInTheDocument()
  })
  it('历史回放默认显示完整连板名单并区分累计量价', () => {
    mount({ ...data, historical: true, source_note: '历史回放：真实归档', stocks: stocks.map(s => ({ ...s, window: null })) })
    expect(screen.getByText('股票a')).toBeInTheDocument()
    expect(screen.getByText('股票b')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '活跃走强' })).not.toBeInTheDocument()
    expect(screen.getByText(/历史截面 · 横轴/)).toBeInTheDocument()
    expect(screen.getAllByText('未归档')).toHaveLength(2)
  })
  it('缺新接口时仅显示模块等待状态', () => {
    mount()
    expect(screen.getByText('正在读取连板观察数据…')).toBeInTheDocument()
  })
})
