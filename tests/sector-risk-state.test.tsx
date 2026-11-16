import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { marketQueries, SectorFlowCard, SectorRiskStatus } from '@/features/market'
import { analyticsQueries } from '@/features/analytics'
import { MarketSnapshotSchema, RotationDataSchema } from '@/shared/api/schemas'
import { Component as FlowPage } from '@/pages/flow/FlowPage'

const asof = '2026-11-05T10:00:00+08:00'
const fresh = { ok: true, complete: true, stale: false, reference_only: false, age_seconds: 0, status: 'fresh', asof, error: null }
const reference = { ...fresh, ok: false, stale: true, reference_only: true, age_seconds: 611, status: 'reference', error: '资金源超时' }
const rows = { inflow_top: [{ name: '本轮流入', flow_yi: 3, pct: 1 }], outflow_top: [], declining: [] }

function mount(flow = false, risk?: unknown, failed = false, fetching = false) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, gcTime: 0 } } })
  const key: readonly string[] = flow ? marketQueries.rotation().queryKey : marketQueries.latest().queryKey
  if (risk !== undefined) client.setQueryData(key, flow ? { market_context: risk } : { sector_risk: risk })
  if (flow) {
    client.setQueryData(analyticsQueries.flowHistory().queryKey as readonly string[], [])
    client.setQueryData(analyticsQueries.flowLive().queryKey as readonly string[], {})
  }
  if (failed || fetching) client.getQueryCache().build(client, { queryKey: key }).setState({
    ...(failed ? { status: 'error' as const, error: new Error('网络不可用') } : {}),
    fetchStatus: fetching ? 'fetching' : 'idle',
  })
  return { client, key, ...render(<QueryClientProvider client={client}>{flow ? <FlowPage /> : <SectorFlowCard />}</QueryClientProvider>) }
}

describe('板块状态契约', () => {
  it('兼容旧字段缺失，并保留完整、参考和子路状态', () => {
    expect(MarketSnapshotSchema.parse({ sector_risk: {} }).sector_risk).toEqual({})
    expect(RotationDataSchema.parse({ market_context: {} }).market_context).toEqual({})
    const state = { ...reference, sources: { breadth: fresh, flow: reference } }
    expect(MarketSnapshotSchema.parse({ sector_risk: { ...state, count: null } }).sector_risk).toMatchObject({ ...state, count: null })
    expect(RotationDataSchema.parse({ market_context: state }).market_context).toEqual(state)
    expect(RotationDataSchema.parse({ market_context: { status: null, asof: null, sources: null, age_seconds: null } }).market_context).toMatchObject({ asof: null })
  })

  it('拒绝参考标记和年龄的错误类型', () => {
    expect(MarketSnapshotSchema.safeParse({ sector_risk: { reference_only: 'true' } }).success).toBe(false)
    expect(RotationDataSchema.safeParse({ market_context: { age_seconds: '611' } }).success).toBe(false)
  })
})

describe('板块状态时间格式', () => {
  it('将原始 UTC 时间转换为上海时区，重渲染不会刷新时间', () => {
    const state = { ...reference, asof: '2026-11-04T16:03:04Z' }
    const view = render(<SectorRiskStatus label="板块资金" state={state} />)
    expect(view.container.textContent).toBe('板块资金更新：11-05 00:03:04')
    expect(view.container.children).toHaveLength(1)
    view.rerender(<SectorRiskStatus label="板块资金" state={{ ...state, age_seconds: 9999 }} />)
    expect(view.container.textContent).toBe('板块资金更新：11-05 00:03:04')
  })

  it.each([undefined, null, '', 'invalid'])('缺少或无效时间 %s 显示未更新', (badAsof) => {
    const view = render(<SectorRiskStatus label="板块资金" state={{ ...fresh, asof: badAsof }} />)
    expect(view.container.textContent).toBe('板块资金更新：未更新')
  })
})

describe('板块资金与跌幅榜状态', () => {
  it('分别展示子路更新时间，不展示过期说明和源错误', () => {
    mount(false, { ...rows, ...reference, sources: { flow: reference, breadth: { ...fresh, asof: '2026-11-05T10:10:00+08:00' } } })
    expect(screen.getByText('本轮流入')).toBeInTheDocument()
    expect(screen.getByText('板块资金更新：11-05 10:00:00')).toBeInTheDocument()
    expect(screen.getByText('弱势板块更新：11-05 10:10:00')).toBeInTheDocument()
    expect(screen.queryByText(/快照年龄|过期|参考|采集提示|资金源超时/)).not.toBeInTheDocument()
    expect(screen.getByText('该时点暂无达到门槛的弱势板块')).toBeInTheDocument()
  })

  it.each([600, 601])('旧契约年龄 %i 秒不影响更新时间展示', (age) => {
    mount(false, { ...rows, ...fresh, age_seconds: age })
    expect(screen.getByText('板块资金更新：11-05 10:00:00')).toBeInTheDocument()
    expect(screen.queryByText(/快照年龄|过期|参考/)).not.toBeInTheDocument()
  })

  it('首次加载及首次请求失败均不伪装成空榜', () => {
    const view = mount()
    expect(screen.getByText('板块资金更新：未更新')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    view.unmount()
    mount(false, undefined, true)
    expect(screen.getByText('板块资金更新：未更新')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('该时点暂无达到门槛的弱势板块')).not.toBeInTheDocument()
  })

  it.each([false, true])('刷新期间或请求失败时保留整份上次数据（失败=%s）', (failed) => {
    mount(false, { ...rows, ...fresh }, failed, !failed)
    expect(screen.getByText('本轮流入')).toBeInTheDocument()
    expect(screen.getByText('板块资金更新：11-05 10:00:00')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('新响应整体替换旧榜，不跨轮补榜，也不从 weak_sectors 补跌幅榜', async () => {
    const view = mount(false, { ...rows, ...fresh, declining: [{ name: '旧跌幅', pct: -3 }] })
    await act(async () => {
      view.client.setQueryData(view.key, {
        sector_risk: { ...fresh, ...rows, inflow_top: [], outflow_top: [{ name: '新流出', flow_yi: -2 }], declining: [] },
        weak_sectors: { sectors: [{ name: '跌停归因板块', pct: -9 }] },
      })
    })
    expect(await screen.findByText('新流出')).toBeInTheDocument()
    expect(screen.queryByText('本轮流入')).not.toBeInTheDocument()
    expect(screen.queryByText('旧跌幅')).not.toBeInTheDocument()
    expect(screen.queryByText('跌停归因板块')).not.toBeInTheDocument()
  })
})

describe('资金页更新时间展示', () => {
  it('仅使用 flow 子路时间，不展示过期警告和源错误', () => {
    mount(true, { ...rows, sources: { flow: reference, breadth: fresh } })
    expect(screen.getAllByText('板块资金更新：11-05 10:00:00')).toHaveLength(1)
    expect(screen.queryByText(/快照年龄|过期|参考|采集提示|资金源超时/)).not.toBeInTheDocument()
    expect(screen.getAllByText('本轮流入').length).toBeGreaterThan(0)
  })

  it.each(['reference', 'stale', 'partial', 'unavailable'])('兼容 market_context 顶层状态 %s', (status) => {
    mount(true, { ...rows, status, asof })
    expect(screen.getByText('板块资金更新：11-05 10:00:00')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('请求失败仍保留已有榜单和原始更新时间，不重复提示', () => {
    mount(true, { ...rows, ...fresh }, true)
    expect(screen.getAllByText('板块资金更新：11-05 10:00:00')).toHaveLength(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getAllByText('本轮流入').length).toBeGreaterThan(0)
  })
})
