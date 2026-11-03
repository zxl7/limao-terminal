import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EarlyItem, IntradayTimelineEvent, Leader, MarketSnapshot, ThemeTop } from '@/shared/api'
import { ExtremeCard, TopThemeCard, marketQueries } from '@/features/market'
import { IntradayMoodCard, analyticsQueries } from '@/features/analytics'

/**
 * 盘中实时页 · 精简后的内容契约。
 *
 * 用户 2026-09-20 定调：本页**不要日内时间轴**（那是 `/timeline` 的职责），
 * 只要一张「涨停 + 炸板率」的情绪波动折线图。此前上的四张独立卡
 * （早鸟埋伏 / 主线热度 / 次日预期 / 板块增减）也已撤除 —— 本文件锁住：
 *
 *   1. **不重复** —— 同一只票不因跨 `leaders` / `early` / 涨停名单而重复上屏；
 *   2. **不虚标** —— 未封板只说「未封板强势」，⛔ 不说「可买」；题材表不宣称「主线」；
 *   3. **不假实时** —— 走势图标**真实基准日**与**最后观测时刻**，
 *      非交易时段 ⛔ 不标「盘中记录」；无逐事件时明确空态，⛔ 不退化成假 0。
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
  return render(<QueryClientProvider client={client}><TopThemeCard /><IntradayMoodCard /></QueryClientProvider>)
}

/** 题材夹具：默认 3 涨停 / 6 家数，可按需覆盖 */
const theme = (name: string, extra: Partial<ThemeTop> = {}): ThemeTop => ({
  rank: 1, name, desc: '', zt_count: 3, turn_avg: 5, total_stocks: 6,
  leader: null, followers: [], zt_stocks: [], diffusion: '', risks: [], positives: [],
  delta: 'ongoing', zt_prev: 2, ...extra,
})

describe('盘中精简内容', () => {
  it('题材行：涨停/家数、环比、状态齐全，且⛔ 不把缺失的前值写成 0', () => {
    const { container } = mount({
      top5: [
        theme('增长', { zt_count: 7, zt_prev: 4, total_stocks: 9, delta: 'surging' }),
        theme('缺基数', { rank: 2, zt_count: 5, zt_prev: null, delta: 'new' }),
      ],
    })
    const grow = within(container).getByRole('button', { name: '题材 增长' })
    expect(grow.textContent).toContain('7')
    expect(grow.textContent).toContain('7/9') // 涨停 7 只 / 该题材共 9 只
    expect(grow.textContent).toContain('+3')
    expect(grow.textContent).toContain('升温')
    // 前值缺失 → 显示「—」，不是 0，也不给一个假的环比
    const missing = within(container).getByRole('button', { name: '题材 缺基数' })
    expect(missing.textContent).toContain('前值 —')
    expect(missing.textContent).not.toContain('+0')
    expect(container.textContent).not.toMatch(/主线|共振/)
  })

  it('最强 = 涨停家数最多，而不是上游给的顺序；默认只展开它', () => {
    const { container } = mount({
      top5: [
        theme('上游第一但只有2只', { rank: 1, zt_count: 2, zt_prev: 1 }),
        theme('真最强', { rank: 2, zt_count: 20, zt_prev: 4 }),
      ],
    })
    const buttons = [...container.querySelectorAll('button[aria-label^="题材 "]')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['题材 真最强', '题材 上游第一但只有2只'])
    expect(buttons[0].textContent).toContain('最强')
    expect(buttons[1].textContent).not.toContain('最强')
    // 默认态：只展开第一名
    expect(buttons[0].getAttribute('aria-expanded')).toBe('true')
    expect(buttons[1].getAttribute('aria-expanded')).toBe('false')
  })

  it('点击折叠：再点收起，点另一条则换展开（同时只开一条）', () => {
    const { container } = mount({
      top5: [
        theme('甲', { zt_count: 9, zt_stocks: [{ name: '甲票', code: '000001', pct: 10 }] }),
        theme('乙', { rank: 2, zt_count: 5, zt_stocks: [{ name: '乙票', code: '000002', pct: 10 }] }),
      ],
    })
    const pick = (name: string) => within(container).getByRole('button', { name: `题材 ${name}` })

    // 默认展开甲 → 只有甲的个股在屏上
    expect(container.textContent).toContain('甲票')
    expect(container.textContent).not.toContain('乙票')

    // 点乙：乙开，甲关
    fireEvent.click(pick('乙'))
    expect(pick('乙').getAttribute('aria-expanded')).toBe('true')
    expect(pick('甲').getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('乙票')
    expect(container.textContent).not.toContain('甲票')

    // 再点乙：全部收起
    fireEvent.click(pick('乙'))
    expect(pick('乙').getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('乙票')
  })

  it('个股跨来源按代码去重（leaders 与涨停名单与早期埋伏同票只留一行）', () => {
    const a = stock('000001', '重复股', { pct: 10, boards: '2天2板', limit_up_days: 2 })
    const { container } = mount(
      { top5: [theme('题材甲', { zt_stocks: [{ name: '重复股', code: '000001', pct: 10 }] })], leaders: [a], early: [early({ ...a, code: '000001.SZ' })] },
    )
    expect(container.querySelectorAll('[data-stock-code]')).toHaveLength(1)
    expect(within(container).getAllByText('重复股')).toHaveLength(1)
    // 板数来自 leaders，不因为涨停名单只有涨幅就丢掉
    expect(container.textContent).toContain('2天2板')
  })

  it('剔除 688/689；已封板的票不标「未封板」', () => {
    const missing = early(stock('000009', '状态缺失'))
    delete missing.buy.limit_up_days
    const { container } = mount({
      top5: [theme('题材甲', { zt_stocks: [{ name: '科创丙', code: '688002', pct: 20 }] })],
      leaders: [
        stock('688001', '科创甲', { pct: 20, boards: '2天2板', limit_up_days: 2 }),
        stock('000003', '已封板', { pct: 10, boards: '1天1板', limit_up_days: 1 }),
        stock('300001', '二十厘米', { pct: 15, is_20cm: true }),
      ],
      early: [early(stock('688002', '科创丙')), missing],
    })
    for (const name of ['科创甲', '科创乙', '科创丙', '状态缺失']) {
      expect(container.textContent, `${name} 不该出现`).not.toContain(name)
    }
    expect(container.textContent).toContain('二十厘米')
    expect(container.textContent).toContain('20cm')
    // 已封板 = 事实，不能被「早期埋伏」的未封板口径降级
    const sealed = within(container).getByText('已封板').closest('li')!
    expect(sealed.textContent).not.toContain('未封板')
  })

  it('⏱ 有首封时间时按**封板先后**排：09:25 的首板压过 10:30 的三板', () => {
    // 3 板但 10:30 才封 vs 首板 09:25 秒封 —— 用户 2026-10-31 口径：先封的在前
    const snap = {
      top5: [theme('题材甲')],
      leaders: [
        stock('600111', '晚封三板', { pct: 10, boards: '3天3板', limit_up_days: 3 }),
        stock('600222', '早封首板', { pct: 10, boards: '1天1板', limit_up_days: 1 }),
        stock('600333', '没封住', { pct: 6, buyable: true, limit_up_days: 0 }),
      ],
      // 首封时间：只有涨停的两只有（未封板没有时间）
      limit_up_stocks: [
        { code: '600111.SS', name: '晚封三板', fbt: '10:30' },
        { code: '600222.SS', name: '早封首板', fbt: '09:25' },
      ],
    } as unknown as Partial<MarketSnapshot>
    const { container } = mount(snap)
    const rows = [...container.querySelectorAll('[data-stock-code]')]
    expect(rows.map((el) => el.getAttribute('data-stock-code'))).toEqual(['600222', '600111', '600333'])
    // 时间要露在名字旁边，否则「为什么它排第一」无法自证
    expect(rows[0].textContent).toContain('09:25')
    expect(rows[1].textContent).toContain('10:30')
    expect(rows[2].textContent).not.toContain(':')
  })

  it('无首封时间的票一律排最后，不冒充最早（⛔ 不写 00:00）', () => {
    const snap = {
      top5: [theme('题材甲')],
      leaders: [stock('600444', '没时间高涨幅', { pct: 19.9 }), stock('600555', '有时间', { pct: 10, limit_up_days: 1, boards: '1天1板' })],
      limit_up_stocks: [{ code: '600555.SS', name: '有时间', fbt: '14:05' }],
    } as unknown as Partial<MarketSnapshot>
    const { container } = mount(snap)
    const rows = [...container.querySelectorAll('[data-stock-code]')].map((el) => el.getAttribute('data-stock-code'))
    expect(rows).toEqual(['600555', '600444'])
    expect(container.textContent).not.toContain('00:00')
  })

  it('同一题材内按辨识度地位排序：连板高者先、已封板先于未封板', () => {
    const { container } = mount({
      top5: [theme('题材甲')],
      leaders: [
        stock('300001', '二十厘米', { pct: 20, is_20cm: true }),
        stock('603278', '三板龙', { pct: 10, boards: '3天3板', limit_up_days: 3 }),
      ],
    })
    const names = [...container.querySelectorAll('[data-stock-code]')].map((el) => el.textContent)
    expect(names[0]).toContain('三板龙')
    expect(names[1]).toContain('二十厘米')
  })

  it('⛔ 未封板的高涨幅不得排在已封板前面（封住比涨得多硬）', () => {
    const { container } = mount({
      top5: [theme('题材甲')],
      leaders: [
        // +11.4% 但没封住（20cm 未涨停）
        stock('300901', '没封住', { pct: 11.4, is_20cm: true, buyable: true, limit_up_days: 0 }),
        // +10.0% 已封板（10cm 涨停）
        stock('600901', '已封板', { pct: 10, buyable: false, limit_up_days: 1, boards: '1天1板' }),
      ],
    })
    const names = [...container.querySelectorAll('[data-stock-code]')].map((el) => el.textContent)
    expect(names[0]).toContain('已封板')
    expect(names[1]).toContain('没封住')
  })

  it('风险/催化里的科创板条目剔除；无个股时给明确空态', () => {
    const { container } = mount({
      top5: [theme('题材甲', {
        risks: ['必易微(688045)(拟减持)', '永安药业(002365)(拟减持)'],
        positives: ['上海沪工(扭亏)'],
      })],
    })
    expect(container.textContent).toContain('永安药业')
    expect(container.textContent).not.toContain('688045')
    expect(container.textContent).toContain('上海沪工(扭亏)')
    expect(container.textContent).toContain('该题材暂无个股明细')
  })
})

describe('盘中情绪走势（涨停 + 跌停 + 炸板率）', () => {
  /** 一个「过去的交易日」—— 无论测试在何时跑都不会变成今天，故断言与运行时刻无关 */
  const PAST = [
    ev('2020-01-02 09:31:00', 'zt_total', { total: 20 }),
    ev('2020-01-02 11:20:00', 'broken_new', { name: 'X' }),
    ev('2020-01-02 14:57:28', 'zt_total', { total: 79 }),
  ]

  it('画涨停 / 跌停（左轴 · 同量纲）与炸板累计比（右轴），并标出真实基准日与最后观测', () => {
    const { container } = mount({}, PAST)
    expect(container.textContent).toContain('最近交易日 · 01-02')
    expect(container.textContent).toContain('最后观测 14:57:28')
    // 图例：涨停 ＋ 跌停（左轴 · 同为家数）· 炸板率（右轴 · 百分比量纲）
    expect(container.textContent).toContain('涨停')
    expect(container.textContent).toContain('跌停')
    expect(container.textContent).toContain('炸板累计比（右轴）')
    // ⛔ 跌停必须留在**左轴**（与涨停同量纲）：挪到右轴会与百分比造出「跌停 3 只 vs 炸板 40%」的伪对比
    expect(container.textContent).not.toContain('跌停（右轴）')
    // 走势图已渲染
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('⛔ 不假实时：过去的基准日不得标「盘中记录」，也不含未来刻度读数', () => {
    const { container } = mount({}, PAST)
    expect(container.textContent).not.toContain('盘中记录')
    expect(container.textContent).not.toContain('30s')
  })

  it('⛔ 无逐事件时明确空态，不退化成假 0 也不留白', () => {
    const { container } = mount()
    expect(container.textContent).toContain('无盘中逐事件')
    expect(container.textContent).toContain('暂无盘中逐事件记录')
    // 没有序列就不得画图（图上任何一条线都意味着有数据）
    expect(container.textContent).not.toContain('炸板累计比（右轴）')
    expect(container.textContent).not.toContain('0%')
  })

  it('盘前残留（00:06 清零零值批次）不足以撑起曲线 → 仍是空态', () => {
    const { container } = mount({}, [ev('2026-09-19 00:06:13', 'zt_total', { total: 79 })])
    expect(container.textContent).toContain('暂无盘中逐事件记录')
  })

  /**
   * 「盘中记录」标注口径（2026-09-21 实测踩到 · ⛔ 别再只判时段）。
   *
   * 事故：卡片原来只判「此刻在交易时段」→ 周一早盘打开页面时，**往日基准日**
   * （今天的首轮 JSONL 还没落盘 → 基准日 = 昨天）被标成「盘中实时」，与用户
   * 反复强调的「不假实时」相悖。正确口径 = **基准日是今天** ∧ **正在交易时段**。
   */
  const bjAt = (h: number, mi: number) => new Date(Date.UTC(2026, 8, 21, h - 8, mi))

  it('⛔ 交易时段内但基准日是往日 → 只标「最近交易日」，不得标「盘中记录」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(bjAt(10, 30)) // 周一 10:30 · 正在交易时段
    try {
      const { container } = mount({}, PAST)
      expect(container.textContent).toContain('最近交易日 · 01-02')
      expect(container.textContent).not.toContain('盘中记录')
    } finally {
      vi.useRealTimers()
    }
  })

  it('✅ 基准日=今天 且 在交易时段 → 才标「盘中记录」', () => {
    vi.useFakeTimers()
    vi.setSystemTime(bjAt(10, 30))
    try {
      const { container } = mount({}, [
        ev('2026-09-21 09:31:00', 'zt_total', { total: 20 }),
        ev('2026-09-21 10:00:00', 'broken_new', { name: 'X' }),
      ])
      expect(container.textContent).toContain('盘中记录')
      expect(container.textContent).toContain('09-21')
      expect(container.textContent).toContain('最后观测 10:00:00')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('极值名单 · 跌幅（有就上、没有就不编）', () => {
  function mountExtreme(snapshot: Partial<MarketSnapshot>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false, gcTime: 0 } } })
    client.setQueryData(marketQueries.latest().queryKey, snapshot as MarketSnapshot)
    return render(<QueryClientProvider client={client}><ExtremeCard /></QueryClientProvider>)
  }

  it('items 带跌幅 → 每只票后面显示跌幅', () => {
    const { container } = mountExtreme({
      limit_down: { count: 2, names: ['甲', '乙'], items: [{ code: '600001', name: '甲', pct: -9.98 }, { code: '600002', name: '乙', pct: -10 }] },
      broken: { count: 1, names: ['丙'], items: [{ code: '600003', name: '丙', pct: 6.4 }] },
    } as unknown as Partial<MarketSnapshot>)
    const chips = [...container.querySelectorAll('.badge')].map((b) => b.textContent ?? '')
    expect(chips.some((t) => t.includes('甲') && t.includes('-9.98%'))).toBe(true)
    expect(chips.some((t) => t.includes('丙') && t.includes('+6.40%'))).toBe(true)
  })

  it('⛔ |跌幅| < 1 视为单位不明 → 不显示（宁可缺，不可错）', () => {
    const { container } = mountExtreme({
      limit_down: { count: 1, names: ['甲'], items: [{ code: '600001', name: '甲', pct: -0.0999 }] },
    } as unknown as Partial<MarketSnapshot>)
    const chip = [...container.querySelectorAll('.badge')].find((b) => (b.textContent ?? '').includes('甲'))!
    expect(chip.textContent).toBe('甲')
  })

  it('旧快照只有 names → 退回纯名单，不伪造 0.00%', () => {
    const { container } = mountExtreme({
      limit_down: { count: 1, names: ['甲'] },
    } as unknown as Partial<MarketSnapshot>)
    expect(container.textContent).toContain('甲')
    expect(container.textContent).not.toContain('0.00%')
  })
})
