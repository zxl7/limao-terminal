import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExtremeCard, FeedbackCard, SectorFlowCard, SignalRail, marketQueries } from '@/features/market'
import { IntradayMoodCard, analyticsQueries } from '@/features/analytics'
import { api, queryClient } from '@/shared/api'
import { loader } from '@/pages/intraday/IntradayPage'

function mount(children: ReactNode, key: readonly string[], data?: unknown, failed = false) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, gcTime: 0 } } })
  if (data !== undefined) client.setQueryData(key, data)
  if (failed) {
    const query = client.getQueryCache().build(client, { queryKey: key })
    query.setState({ status: 'error', error: new Error('网络不可用'), fetchStatus: 'idle' })
  }
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

/**
 * 夹具入缓存 —— 与 `mount` 同口径：key 走宽松的 `readonly string[]`，
 * 让 `setQueryData` 的数据参数退化为 `unknown`。
 *
 * 本文件所有夹具都**只提供被测字段**（如 极值卡只关心 limit_down/broken），
 * 若直接用 `client.setQueryData(具体 queryKey, {...})`，TS 会按 queryKey 推导出
 * 完整契约类型（`MarketSnapshot` 20+ 必填字段）而报缺字段 —— 那是**夹具写法**的问题，
 * 不是被测组件的问题。故统一走此助手。
 */
function seed(client: QueryClient, key: readonly string[], data: unknown) {
  client.setQueryData(key, data)
}

describe('首页数据状态不能伪装成无风险', () => {
  it('板块采集失败时仅显示原始更新时间，保留数据可用性判断', () => {
    const stale = mount(<SectorFlowCard />, marketQueries.latest().queryKey, {
      sector_risk: { ok: false, stale: true, asof: '2026-09-28T14:20:00+08:00',
        inflow_top: [{ name: '机器人', pct: 1, flow_yi: 3 }], outflow_top: [], declining: [], count: 0 },
    })
    expect(screen.getByText('板块资金更新：09-28 14:20:00')).toBeInTheDocument()
    expect(screen.queryByText(/采集不完整|快照年龄|过期|参考/)).not.toBeInTheDocument()
    expect(screen.getByText('机器人')).toBeInTheDocument()
    stale.unmount()

    mount(<SectorFlowCard />, marketQueries.latest().queryKey, {
      sector_risk: { ok: false, stale: false, inflow_top: [], outflow_top: [], declining: [] },
    })
    expect(screen.getByText('板块资金更新：未更新')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('主力流入数据暂不可用')).toBeInTheDocument()
    expect(screen.getByText('弱势板块数据暂不可用')).toBeInTheDocument()
  })

  it('极值字段缺失不能显示无跌停、无炸板', () => {
    mount(<ExtremeCard />, marketQueries.latest().queryKey, {})
    expect(screen.getByText('跌停数据未提供')).toBeInTheDocument()
    expect(screen.getByText('炸板数据未提供')).toBeInTheDocument()
    expect(screen.queryByText(/当前数据无/)).not.toBeInTheDocument()
  })

  it('明确的零值可以显示无风险；非零但缺名单必须提示缺名单', () => {
    mount(<ExtremeCard />, marketQueries.latest().queryKey, {
      limit_down: { count: 0, names: [] }, broken: { count: 3, names: [] },
    })
    expect(screen.getByText('当前数据无跌停')).toBeInTheDocument()
    expect(screen.getByText('炸板名单未提供')).toBeInTheDocument()
  })

  it('加载中与首次请求失败分别提示，不能显示无风险', () => {
    const view = mount(<ExtremeCard />, marketQueries.latest().queryKey)
    expect(screen.getByText('正在加载跌停数据…')).toBeInTheDocument()
    view.unmount()
    mount(<ExtremeCard />, marketQueries.latest().queryKey, undefined, true)
    expect(screen.getByText('极值数据加载失败')).toBeInTheDocument()
    expect(screen.getByText('暂无法确认跌停状态')).toBeInTheDocument()
  })

  it('更新失败保留已有极值名单并提示，不能安静展示旧数据', () => {
    mount(<ExtremeCard />, marketQueries.latest().queryKey, {
      limit_down: { count: 1, names: ['风险股'] }, broken: { count: 0, names: [] },
    }, true)
    expect(screen.getByText('风险股')).toBeInTheDocument()
    expect(screen.getByText('极值数据更新失败，保留上次数据')).toBeInTheDocument()
  })

  it('极值名单保留核按钮逐票价格、均线和破位信息，并区分总数与明细数', () => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
    seed(client, marketQueries.latest().queryKey, {
      limit_down: { count: 1, names: ['跌停票'] }, broken: { count: 1, names: ['炸板票'] },
    })
    seed(client, marketQueries.feedback().queryKey, {
      generated_ts: '2026-09-28 10:30:00', nuke_count: 2, broken_rate: 20,
      nuke_list: [{ code: '000001', name: '核按钮票', pct: -7, price: 8.5, prev_boards: 3,
        tag: '昨连板', ma5: 9, ma10: 9.2, breakdown: true }],
    })
    render(<QueryClientProvider client={client}><ExtremeCard /></QueryClientProvider>)
    expect(screen.getByText('核按钮票')).toBeInTheDocument()
    expect(screen.getByText('1/2 只已列出')).toBeInTheDocument()
    expect(screen.getByText(/现价/)).toBeInTheDocument()
    expect(screen.getByText('破位（5/10 日线）')).toBeInTheDocument()
    expect(screen.getByText('跌停票')).toBeInTheDocument()
    expect(screen.getByText('炸板票')).toBeInTheDocument()
  })

  it('反馈请求失败不再永久显示等待', () => {
    mount(<FeedbackCard />, marketQueries.feedback().queryKey, undefined, true)
    expect(screen.getByText('反馈加载失败')).toBeInTheDocument()
    expect(screen.getByText('暂无法确认反馈状态')).toBeInTheDocument()
  })

  it('缺失反馈指标不能标成高度维持', () => {
    mount(<FeedbackCard />, marketQueries.feedback().queryKey, {})
    expect(screen.getByText('高度趋势未提供')).toBeInTheDocument()
    expect(screen.queryByText('高度维持')).not.toBeInTheDocument()
  })

  it('主快照首次失败不使首页 loader 抛出整页异常', async () => {
    const defaults = queryClient.getDefaultOptions()
    queryClient.clear()
    queryClient.setDefaultOptions({ queries: { retry: false } })
    const fetch = vi.spyOn(api, 'latest').mockRejectedValue(new Error('快照不可用'))
    try {
      await expect(loader()).resolves.toBeNull()
      expect(queryClient.getQueryState(marketQueries.latest().queryKey)?.status).toBe('error')
    } finally {
      fetch.mockRestore()
      queryClient.clear()
      queryClient.setDefaultOptions(defaults)
    }
  })
})

describe('信号沉淀与本轮信号分开表达', () => {
  it('本轮为空仍展示当日沉淀，但明确记录属性与首次、末次时间', () => {
    mount(<SignalRail />, marketQueries.signals().queryKey, {
      date: '2026-09-21', ts: '2026-09-21 14:57:17', signals: [],
      signals_today: [{ code: '000001', name: '历史股', type: '涨停', pct: 10, first_seen: '09:30:00', last_seen: '10:45:00' }],
    })
    expect(screen.getByText('历史股')).toBeInTheDocument()
    expect(screen.getByText('当日信号记录 · 2026-09-21')).toBeInTheDocument()
    expect(screen.getByText('类型与涨幅为触发时记录，不代表当前状态。')).toBeInTheDocument()
    expect(screen.getByText('首 09:30')).toBeInTheDocument()
    expect(screen.getByText('末 10:45')).toBeInTheDocument()
  })

  it('当前接口未提供沉淀时仍保留原有本轮信号展示', () => {
    mount(<SignalRail />, marketQueries.signals().queryKey, {
      date: '2026-09-21', signals: [{ code: '000001', name: '本轮股', type: '快速拉升', pct: 4 }],
    })
    expect(screen.getByText('本轮信号 · 2026-09-21')).toBeInTheDocument()
    expect(screen.getByText('本轮股')).toBeInTheDocument()
    expect(screen.queryByText(/类型与涨幅为触发时记录/)).not.toBeInTheDocument()
  })

  it('信号加载失败不能显示暂无短线信号', () => {
    mount(<SignalRail />, marketQueries.signals().queryKey, undefined, true)
    expect(screen.getByText('信号加载失败')).toBeInTheDocument()
    expect(screen.queryByText('暂无短线信号')).not.toBeInTheDocument()
  })
})

describe('曲线累计口径与错误状态', () => {
  const events = [{ at: '2020-01-02 10:00:00', kind: 'zt_total', total: 20 }]

  it('累计曲线不再使用反馈炸板率的同名图例', () => {
    mount(<IntradayMoodCard />, analyticsQueries.intradayTimeline().queryKey, events)
    expect(screen.getByText('炸板累计比（右轴）')).toBeInTheDocument()
    expect(screen.getByText('跌停累计')).toBeInTheDocument()
    expect(screen.queryByText('炸板率（右轴）')).not.toBeInTheDocument()
  })

  it('有旧曲线时更新失败保留图表并提示', () => {
    const { container } = mount(<IntradayMoodCard />, analyticsQueries.intradayTimeline().queryKey, events, true)
    expect(screen.getByText('曲线更新失败，保留上次数据')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('首次失败不伪装成暂无记录', () => {
    mount(<IntradayMoodCard />, analyticsQueries.intradayTimeline().queryKey, undefined, true)
    expect(screen.getByText('盘中逐事件加载失败')).toBeInTheDocument()
    expect(screen.queryByText('暂无盘中逐事件记录')).not.toBeInTheDocument()
  })
})
