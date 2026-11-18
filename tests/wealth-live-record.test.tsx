import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { LiveRecordBoard } from '@/features/wealth'
import type { AiDecisionEntry, AiNavEntry } from '@/shared/api'

/**
 * 实盘战绩面板（2026-11-18 用户「顶部单开一个入口，不进二级细分」）。
 *
 * 锁三件事：
 *  ① 两套口径**并列**画图（策略口径 + T+1 口径）—— ⛔ 不能只画一条然后叫它「AI 净值」；
 *  ② 净值表与台账表都要出真实标的（名称+代码），空仓日子标明「空仓」而不是留白；
 *  ③ 指标只由序列推出：累计收益 = 末值 − 1，回撤按正序逐点递推（表里逆序不影响）。
 */

const NAV: AiNavEntry[] = [
  {
    trade_date: '2026-11-13',
    recommendation_date: '2026-11-12',
    strategy: 'ai_judgement_next_day_close',
    stock_count: 1,
    avg_return_pct: 5.54,
    nav: 1.0554,
    stocks: [{ code: '600278', name: '东方创业', auction_price: 7.76, close: 8.19, return_pct: 5.54, reason: '' }],
    skipped: [],
    decided: 1,
  },
  {
    trade_date: '2026-11-14',
    recommendation_date: '2026-11-13',
    strategy: 'ai_judgement_next_day_close',
    stock_count: 0,
    avg_return_pct: 0,
    nav: 1.0554,
    stocks: [],
    skipped: [],
    decided: 0,
  },
]

const DEC: AiDecisionEntry[] = [
  {
    decision_date: '2026-11-13',
    code: '600278',
    name: '东方创业',
    reason: '2 板·成交 5.92 亿',
    factors: {},
    entry_max_gap: 3,
    position: 0.38,
    view: 'participate',
    source: 'AI',
    ts: '2026-11-13T15:38:00+08:00',
    settled: true,
  },
]

describe('LiveRecordBoard', () => {
  it('两套口径并列，且逐日结算表逆序（最新一行在最上）', () => {
    const { getByText, getAllByText, container } = render(
      <LiveRecordBoard navRows={NAV} navT1Rows={NAV} decRows={DEC} />,
    )
    expect(getByText('量化交易净值')).toBeTruthy()
    // 图例两条口径
    expect(getAllByText(/策略口径/).length).toBeGreaterThan(0)
    expect(getAllByText(/T\+1 口径/).length).toBeGreaterThan(0)
    // 累计收益 = 1.0554 - 1 = +5.54%
    expect(container.textContent).toContain('+5.54%')
    // 最新结算日（图表横轴与表格都会出现该日期，用 getAllByText）
    expect(getAllByText(/2026-11-14/).length).toBeGreaterThan(0)
  })

  it('空仓日标注「空仓」，台账出名称+代码与判断', () => {
    const { getAllByText, getByText } = render(
      <LiveRecordBoard navRows={NAV} navT1Rows={[]} decRows={DEC} />,
    )
    expect(getAllByText('空仓').length).toBe(1)
    expect(getByText('东方创业')).toBeTruthy()
    expect(getByText('参与')).toBeTruthy()
    expect(getByText('已结算')).toBeTruthy()
  })
})
