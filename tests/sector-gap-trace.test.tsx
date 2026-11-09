/**
 * 竞价三环影子 · 逐日留痕页专属锁（2026-11-05 A 档）
 *
 * 这个页面最容易被改坏的地方不是渲染，而是**语义**：
 * 有人以后看到「会砍」两个字，顺手把它接进 09:25 的 view/zone/quota，
 * 影子就变成了硬闸 —— 而历史窗口的证据只够描述（23 只 / 11 个对照日），
 * 用户明确拍板「先并行记账，攒够 T+1 再决定」。
 *
 * 因此这里锁三件事：
 *   ① 页面顶部必须白话讲清影子不改裁决，且挂「只观察 · 不下单」；
 *   ② 两套收益口径必须分列，⛔ 不许把当日收盘当 T+1 可执行收益；
 *   ③ 数据源里根本没有裁决字段（view/participate/quota），从数据层堵死接错线。
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SectorGapRow, SectorGapStat, SectorGapTrace } from '@/shared/api'
import { DEFAULT_DATA_ROOT, DATA_ROOT_ENV, ROUTES } from '@/shared/api'
import { analyticsQueries } from '@/features/analytics'
import { Component as SectorGapPage } from '@/pages/sector-gap/SectorGapPage'
// eslint-disable-next-line
import { readRoute, resolveDataRoot, type RouteDefLike } from '../scripts/lib/read-route.mjs'

const stat = (n: number, mean: number | null): SectorGapStat => ({
  n, covered: mean == null ? 0 : n, mean, median: mean, win_rate: mean == null ? null : 40,
  zt: 1,
})
const pair = (n: number, same: number | null, t1: number | null) => ({
  same_close: stat(n, same), t1_close: stat(n, t1),
})

const row = (over: Partial<SectorGapRow> = {}): SectorGapRow => ({
  date: '2026-11-04', code: '600001', name: '测试票', gap: 7.2, E: 2.1, DEV: 5.1,
  zone: 'ok', theme: '测试题材', theme_src: 'plates', gap_vs_theme: 3.1,
  theme_gap_med: 4.1, upper_gap_med: 4.5, credits_n: 1, credits_known: 3,
  veto: false, status: 'ok', isolated: false, would_cut: false, R_pct: 12.4,
  ret_same_close: -3.2, ret_t1_close: -5.1, t1_date: '2026-11-05', zt_today: false,
  ...over,
})

const payload: SectorGapTrace = {
  schema: 'sector_gap_daily_trace_v1',
  generated_at: '2026-11-05T20:55:10+08:00',
  window: {
    start: '2026-10-09', end: '2026-11-05', nominal_days: 20, active_days: 18,
    dropped: [{ date: '2026-10-23', reason: 'coverage 7/33=0.21' }],
  },
  caliber: {
    strategy: 'ai_judgement_next_day_close',
    same_close: '竞价价→当日收盘（系统决策评估代理）',
    t1_close: '竞价价→次一交易日收盘（账本结算口径代理）',
    excluded: '竞价封死买不进 / 688 / ST',
    warning: '晋级率 ≠ 买入胜率 ≠ 可执行收益；影子 only 留痕，恒不改裁决。',
    shadow: 'linked_would_cut = 若开 LC 守卫会被砍的平行标记，不是已执行动作',
  },
  summary: {
    n_tradable: 900, n_v0: 621, n_cut: 23, n_keep: 598,
    n_veto: 21, n_veto_strict: 5, n_abstain: 437,
    v0: pair(621, -0.76, -1.47), cut: pair(23, -4.27, -5.53), keep: pair(598, -0.63, -1.31),
    veto: pair(21, -0.99, -1.6), veto_strict: pair(5, -9.3, -12.64), abstain: pair(437, -0.91, -1.49),
    cut_better_days: 8, cut_worse_days: 3,
    cut_better_dates: ['2026-10-19'], cut_worse_dates: ['2026-10-20'],
  },
  days: [{
    date: '2026-11-04', prev: '2026-11-03', n_quotes: 43, n_prev_zt: 44, coverage: 0.977,
    theme_src: 'plates', n_tradable: 43, n_v0: 25, price_mismatch: 0,
    cut_codes: ['600001', '600002', '600003'],
    v0: pair(25, -0.8, -1.2), cut: pair(3, -10.46, -11.0), keep: pair(22, 0.5, 1.87),
    veto: pair(2, -1, -2), veto_strict: pair(1, -9, -12), abstain: pair(10, -1, -1.5),
    delta_t1_pct: 1.48,
  }],
  rows: [
    row({ code: '600001', name: '被标记票', would_cut: true, ret_t1_close: -11.0 }),
    row({ code: '600002', name: '量能证伪票', would_cut: false, veto: true, status: 'volume_veto' }),
    row({ code: '600003', name: '普通票', would_cut: false }),
  ],
}

function mount(data?: SectorGapTrace, failed = false) {
  const client = new QueryClient({
    // failed：模拟「文件未生成 → 404 已落定、不再取数」。用 enabled:false 而不是
    // 手工 setState —— useQuery 挂载时的首次取数会把手工状态覆盖掉。
    defaultOptions: { queries: { retry: false, gcTime: 0, enabled: !failed } },
  })
  if (data) client.setQueryData(analyticsQueries.sectorGapTrace().queryKey, data)
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<SectorGapPage />, { wrapper: wrap })
}

describe('竞价留痕页 · 影子语义锁', () => {
  it('顶部讲清「影子不改裁决」，并明确标示只观察不下单', () => {
    const { container } = mount(payload)
    const text = container.textContent ?? ''
    expect(text).toContain('「影子」是什么')
    expect(text).toContain('从不参与买不买')
    expect(text).toContain('只观察 · 不下单')
    // ⛔ 不许把研究口径包装成策略成绩（白话门禁同样不允许露出内部口径）
    expect(text).not.toContain('ai_judgement_next_day_close')
  })

  it('两套收益分列，T+1 与当日收盘各自独立表头', () => {
    const { container } = mount(payload)
    const headers = Array.from(container.querySelectorAll('th')).map((h) => h.textContent)
    expect(headers).toContain('当日均值')
    expect(headers).toContain('当日胜率')
    expect(headers).toContain('T+1 均值')
    expect(headers).toContain('T+1 胜率')
    expect(container.textContent).toContain('晋级率 ≠ 买入胜率 ≠ 可执行收益')
  })

  it('逐票明细默认只看标记票，切到全部票才展开', () => {
    const { container } = mount(payload)
    const count = () => container.querySelectorAll('tbody tr').length
    // 前两张表（累计对照 6 行 + 逐日 1 行）不参与切换
    const before = count()
    fireEvent.click(screen.getByText('全部票'))
    expect(count()).toBeGreaterThan(before)
    expect(container.textContent).toContain('普通票')
  })

  it('数据源缺失时优雅降级为空态，不抛错', () => {
    const { container } = mount(undefined, true)
    expect(container.textContent).toContain('竞价留痕尚未生成')
  })
})

describe('竞价留痕 · 真实落盘数据契约', () => {
  it('影子字段齐全，且数据源里⛔不含任何裁决字段', () => {
    const root = resolveDataRoot(
      path.resolve(import.meta.dirname, '..'), DEFAULT_DATA_ROOT, DATA_ROOT_ENV,
    )
    const def = (ROUTES as Record<string, unknown>)['/api/decision/sector-gap-trace'] as RouteDefLike
    const data = readRoute(root, def) as SectorGapTrace
    expect(data.schema).toBe('sector_gap_daily_trace_v1')
    expect(data.caliber.shadow).toContain('不是已执行动作')
    expect(data.summary.n_cut).toBeGreaterThan(0)
    expect(data.days.length).toBeGreaterThan(0)

    // 这是「影子恒不改裁决」的数据层保证：逐票明细只有影子标记与事后收益，
    // 没有 view / participate / quota —— 页面拿不到裁决数据，也就无从改裁决。
    const forbidden = ['view', 'participate', 'quota', 'buyable', 'effective_view']
    for (const r of data.rows) {
      expect(r.zone).toBeDefined()
      expect(typeof r.would_cut).toBe('boolean')
      for (const k of forbidden) expect(k in r, `逐票明细不该含裁决字段 ${k}`).toBe(false)
    }
    // T+1 允许为 null（最新交易日次日未到），但必须保留键，不能整列消失
    for (const r of data.rows) expect('ret_t1_close' in r).toBe(true)
  })
})
