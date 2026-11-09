import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { BacktestSummary } from '@/shared/api'
import { BacktestCard } from '@/features/wealth'

/**
 * 回测战绩卡契约（2026-11-06 用户「回测模块最好可以显示我们的各项指标和战绩」）。
 *
 * ## 本文件锁的三件事
 *
 * 1. **三套口径必须并列出现**，且各自带自己的复利/回撤 —— ⛔ 不允许折成一个「综合收益」。
 *    A 股 T+1 使「当日卖」不可执行，两者差 2.4 倍；折成一个数就必然要挑一个当真，那就是混账。
 * 2. **显著性必须可见**：`|t| < 2` 时要写「不显著」，⛔ 不能只放一个好看的复利。
 * 3. **缺数据不伪造**：无快照 → 「未生成」；指标为 `null` → `—`（⛔ 不是 0）。
 */

const summary: BacktestSummary = {
  generated_at: '2026-11-06 22:00:00',
  version: 'v1.1',
  window: { start: '2026-09-11', end: '2026-11-06', days: 35 },
  records: [
    {
      id: 'close',
      label: '策略口径',
      sub: '竞价买 → 当日收盘',
      note: '与每日台账同源，用于判据迭代',
      primary: true,
      metrics: {
        days: 25, picks: 83, day_win: 72.0, pick_win: 57.8, day_avg: 1.97,
        pick_avg: 1.82, pick_med: 1.93, compound: 61.05, mdd: -4.7,
        sharpe: 10.13, t: 3.19, gain_avg: 3.38, loss_avg: -1.65, pl_ratio: 2.04,
      },
      equity: [
        { date: '2026-09-14', ret: 3.68, nav: 1.0368, n: 2 },
        { date: '2026-09-15', ret: 2.51, nav: 1.0629, n: 5 },
      ],
    },
    {
      id: 't1',
      label: 'T+1 口径',
      sub: '竞价买 → 次日收盘',
      note: 'A 股真实可下单，用于评估可执行性',
      primary: false,
      metrics: {
        days: 24, picks: 81, day_win: 54.2, pick_win: 48.1, day_avg: 1.05,
        pick_avg: 0.95, pick_med: -0.46, compound: 25.22, mdd: -13.5,
        sharpe: 3.43, t: 1.06, gain_avg: 4.76, loss_avg: -3.33, pl_ratio: 1.43,
      },
      equity: [{ date: '2026-09-14', ret: 1.2, nav: 1.012, n: 2 }],
    },
    {
      id: 't1open',
      label: 'T+1 最保守',
      sub: '竞价买 → 次日开盘',
      note: '不承担次日日内波动',
      primary: false,
      metrics: {
        days: 24, picks: 81, day_win: 62.5, pick_win: 51.9, day_avg: 0.14,
        pick_avg: -0.1, pick_med: 0.09, compound: 1.14, mdd: -19.98,
        sharpe: 0.51, t: 0.16, gain_avg: 2.84, loss_avg: -4.36, pl_ratio: 0.65,
      },
      equity: [],
    },
  ],
  layers: [
    {
      key: 'L0_v10',
      label: 'v1.0 旧口径',
      note: '读盘后预案的回避否决',
      close: { days: 18, picks: 52, day_win: 55.6, pick_win: 53.8, day_avg: -0.13, compound: -4.48, mdd: -22.9 },
      t1: { days: 17, picks: 51, day_win: 52.9, pick_win: 43.1, day_avg: -0.7, compound: -14.81, mdd: -33.83 },
      delta_close: null,
    },
    {
      key: 'L4_v11',
      label: '④ +关盘后预案',
      note: '预案整链不读，名额走缺省 2 只',
      close: { days: 25, picks: 83, day_win: 72.0, pick_win: 57.8, day_avg: 1.97, compound: 61.05, mdd: -4.7 },
      t1: { days: 24, picks: 81, day_win: 54.2, pick_win: 48.1, day_avg: 1.05, compound: 25.22, mdd: -13.5 },
      delta_close: 21.06,
    },
  ],
  live: {
    days: 12,
    day_win: 50.0,
    day_avg: -0.32,
    cum: -3.8,
    traded: 1,
    rows: [
      { date: '2026-11-06', pool: 31, tradable: 27, avg: 0.62, win: 51.9, n: 27, t1_avg: null, participate: 0 },
    ],
  },
  caveats: ['策略口径违反 A 股 T+1'],
}

describe('BacktestCard 回测战绩', () => {
  it('三套口径并列出现，各自带复利与回撤', () => {
    const { container } = render(<BacktestCard data={summary} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('策略口径')
    expect(txt).toContain('T+1 口径')
    expect(txt).toContain('T+1 最保守')
    // 三个复利都要在，⛔ 不能只显示其中一个
    expect(txt).toContain('+61.0%')
    expect(txt).toContain('+25.2%')
    expect(txt).toContain('+1.1%')
    // 回撤也要在：T+1 的回撤显著大于当日口径，这是 1 与 2 差额的来源
    expect(txt).toContain('-13.5%')
  })

  it('|t| < 2 的口径必须标「不显著」', () => {
    const { container } = render(<BacktestCard data={summary} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('不显著')
    expect(txt).toContain('显著')
  })

  it('逐层阶梯给出「本层增量」而不是只给最终数', () => {
    const { container } = render(<BacktestCard data={summary} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('v1.0 旧口径')
    expect(txt).toContain('本层增量')
    expect(txt).toContain('+21.1%')
  })

  it('真实台账作为对照出现，并写明是池内全买', () => {
    const { container } = render(<BacktestCard data={summary} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('真实台账')
    expect(txt).toContain('池内全买')
  })

  it('无快照时明确「未生成」，⛔ 不渲染空表冒充 0', () => {
    const { container } = render(<BacktestCard />)
    expect(container.textContent).toContain('未生成')
    expect(container.textContent).toContain('回测快照未生成')
  })

  it('指标为 null 时渲染 — ，不渲染 0', () => {
    const empty: BacktestSummary = {
      ...summary,
      records: [
        {
          ...summary.records[0],
          metrics: { ...summary.records[0].metrics, sharpe: null, t: null, pl_ratio: null },
        },
      ],
      layers: [],
      live: { days: 0, rows: [] },
    }
    const { container } = render(<BacktestCard data={empty} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('—')
    expect(txt).not.toContain('Sharpe0')
  })
})
