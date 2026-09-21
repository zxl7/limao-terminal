import { describe, expect, it, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EarlyItem, IntradayTimelineEvent, Leader, MarketSnapshot, ThemeTop } from '@/shared/api'
import { LeadersCard, ThemeTopCard, marketQueries } from '@/features/market'
import { IntradayMoodCard, analyticsQueries } from '@/features/analytics'

/**
 * 盘中实时页 · 精简后的内容契约。
 *
 * 用户 2026-09-20 定调：本页**不要日内时间轴**（那是 `/timeline` 的职责），
 * 只要一张「涨停 + 炸板率」的情绪波动折线图。此前上的四张独立卡
 * （早鸟埋伏 / 主线热度 / 次日预期 / 板块增减）也已撤除 —— 本文件锁住：
 *
 *   1. **不重复** —— 同一只票不因跨 `leaders` / `early` / 多题材而重复上屏；
 *   2. **不虚标** —— 未封板只说「未封板强势」，⛔ 不说「可买」；题材表不宣称「主线」；
 *   3. **不假实时** —— 走势图标**真实基准日**与**最后观测时刻**，
 *      非交易时段 ⛔ 不标「盘中实时」；无逐事件时明确空态，⛔ 不退化成假 0。
 */

const stock = (code: string, name: string, extra: Partial<Leader> = {}): Leader => ({
  code, name, pct: 5, sector: '题材甲', price: 10, buyable: true, is_20cm: false, boards: '', limit_up_days: 0, ...extra,
})
const early = (buy: Leader, sector = '题材乙'): EarlyItem => ({ buy, sector, desc: '催化原文', type: '爆发中', count: 1, zt_in_sector: 3, members: [] })
const ev = (at: string, kind: string, fields = {}): IntradayTimelineEvent => ({ at, kind, ...fields }) as IntradayTimelineEvent

function mount(snapshot: Partial<MarketSnapshot> = {}, events: IntradayTimelineEvent[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false, gcTime: 0 } } })
  // 夹具只给部分字段（页面按可选字段渲染）—— 断言在渲染结果上，故此处收窄为完整类型
  client.setQueryData(marketQueries.latest().queryKey, snapshot as MarketSnapshot)
  client.setQueryData(analyticsQueries.intradayTimeline().queryKey, events)
  return render(<QueryClientProvider client={client}><LeadersCard /><ThemeTopCard /><IntradayMoodCard /></QueryClientProvider>)
}

describe('盘中精简内容', () => {
  it('跨 leaders / early / 多题材按代码去重，保留归属但不标可买', () => {
    const a = stock('000001', '重复股')
    const { container } = mount({ leaders: [a, { ...a, sector: '题材丙' }], early: [early({ ...a, code: '000001.SZ' }), early(a), early(stock('000002', '新增股'))] })
    expect(container.querySelectorAll('[data-stock-code]')).toHaveLength(2)
    expect(within(container).getAllByText('重复股')).toHaveLength(1)
    expect(container.textContent).toContain('题材甲 / 题材丙 / 题材乙')
    expect(container.textContent).toContain('未封板强势')
    expect(container.textContent).not.toContain('可买')
    expect(within(container).getByText('新增股')).toBeTruthy()
  })
  it('过滤688/689，并且不把early已封板或状态缺失的票当未封板强势', () => {
    const missing = early(stock('000009', '状态缺失'))
    delete missing.buy.limit_up_days
    const { container } = mount({
      leaders: [stock('688001', '科创甲'), stock('689001', '科创乙')],
      early: [early(stock('688002', '科创丙')), early(stock('000003', '已封板', { pct: 10, limit_up_days: 1 })), missing, early(stock('300001', '二十厘米', { pct: 15, is_20cm: true }))],
    })
    expect(container.querySelectorAll('[data-stock-code]')).toHaveLength(1)
    for (const name of ['科创甲', '科创乙', '科创丙', '已封板', '状态缺失']) expect(container.textContent).not.toContain(name)
    expect(container.textContent).toContain('二十厘米')
    expect(container.textContent).toContain('20cm · 波动大')
  })
  it('核心报价优先：early重复票不能把已封板核心降级成未封板', () => {
    const { container } = mount({ leaders: [stock('000001', '核心', { buyable: false, pct: 10 })], early: [early(stock('000001', '核心'))] })
    expect(container.querySelectorAll('[data-stock-code]')).toHaveLength(1)
    expect(within(container).getByRole('region', { name: '核心辨识度' }).textContent).toContain('核心')
    expect(container.textContent).not.toContain('未封板强势')
  })
  it('题材表合并涨停、前值、增减和状态；缺失不填0也不宣称主线', () => {
    const rows = [
      { name: '缺基数', zt_count: 5, zt_prev: null, delta: 'new' },
      { name: '增长', zt_count: 7, zt_prev: 4, delta: 'surging' },
      { name: '真零', zt_count: 0, zt_prev: 0, delta: 'ongoing' },
    ] as ThemeTop[]
    const { container } = mount({ top5: rows })
    const table = within(container).getByRole('table', { name: '题材强度' })
    expect(within(table).getByRole('row', { name: '缺基数 5 — — 新晋' })).toBeTruthy()
    expect(within(table).getByRole('row', { name: '增长 7 4 +3 升温' })).toBeTruthy()
    expect(within(table).getByRole('row', { name: '真零 0 0 0 持续' })).toBeTruthy()
    expect(table.textContent).not.toMatch(/主线|共振/)
  })
})

describe('盘中情绪走势（涨停 + 跌停 + 炸板率）', () => {
  /** 一个「过去的交易日」—— 无论测试在何时跑都不会变成今天，故断言与运行时刻无关 */
  const PAST = [
    ev('2020-01-02 09:31:00', 'zt_total', { total: 20 }),
    ev('2020-01-02 11:20:00', 'broken_new', { name: 'X' }),
    ev('2020-01-02 14:57:28', 'zt_total', { total: 79 }),
  ]

  it('画涨停 / 跌停（左轴 · 同量纲）与炸板率（右轴），并标出真实基准日与最后观测', () => {
    const { container } = mount({}, PAST)
    expect(container.textContent).toContain('最近交易日 · 01-02')
    expect(container.textContent).toContain('最后观测 14:57:28')
    // 图例：涨停 ＋ 跌停（左轴 · 同为家数）· 炸板率（右轴 · 百分比量纲）
    expect(container.textContent).toContain('涨停')
    expect(container.textContent).toContain('跌停')
    expect(container.textContent).toContain('炸板率（右轴）')
    // ⛔ 跌停必须留在**左轴**（与涨停同量纲）：挪到右轴会与百分比造出「跌停 3 只 vs 炸板 40%」的伪对比
    expect(container.textContent).not.toContain('跌停（右轴）')
    // 走势图已渲染
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('⛔ 不假实时：过去的基准日不得标「盘中实时」，也不含未来刻度读数', () => {
    const { container } = mount({}, PAST)
    expect(container.textContent).not.toContain('盘中实时')
    expect(container.textContent).not.toContain('30s')
  })

  it('⛔ 无逐事件时明确空态，不退化成假 0 也不留白', () => {
    const { container } = mount()
    expect(container.textContent).toContain('无盘中逐事件')
    expect(container.textContent).toContain('暂无盘中逐事件记录')
    // 没有序列就不得画图（图上任何一条线都意味着有数据）
    expect(container.textContent).not.toContain('炸板率（右轴）')
    expect(container.textContent).not.toContain('0%')
  })

  it('盘前残留（00:06 清零零值批次）不足以撑起曲线 → 仍是空态', () => {
    const { container } = mount({}, [ev('2026-09-19 00:06:13', 'zt_total', { total: 79 })])
    expect(container.textContent).toContain('暂无盘中逐事件记录')
  })

  /**
   * 「盘中实时」标注口径（2026-09-21 实测踩到 · ⛔ 别再只判时段）。
   *
   * 事故：卡片原来只判「此刻在交易时段」→ 周一早盘打开页面时，**往日基准日**
   * （今天的首轮 JSONL 还没落盘 → 基准日 = 昨天）被标成「盘中实时」，与用户
   * 反复强调的「不假实时」相悖。正确口径 = **基准日是今天** ∧ **正在交易时段**。
   */
  const bjAt = (h: number, mi: number) => new Date(Date.UTC(2026, 8, 21, h - 8, mi))

  it('⛔ 交易时段内但基准日是往日 → 只标「最近交易日」，不得标「盘中实时」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(bjAt(10, 30)) // 周一 10:30 · 正在交易时段
    try {
      const { container } = mount({}, PAST)
      expect(container.textContent).toContain('最近交易日 · 01-02')
      expect(container.textContent).not.toContain('盘中实时')
    } finally {
      vi.useRealTimers()
    }
  })

  it('✅ 基准日=今天 且 在交易时段 → 才标「盘中实时」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(bjAt(10, 30))
    try {
      const { container } = mount({}, [
        ev('2026-09-21 09:31:00', 'zt_total', { total: 20 }),
        ev('2026-09-21 10:00:00', 'broken_new', { name: 'X' }),
      ])
      expect(container.textContent).toContain('盘中实时')
      expect(container.textContent).toContain('09-21')
      expect(container.textContent).toContain('最后观测 10:00:00')
    } finally {
      vi.useRealTimers()
    }
  })
})
