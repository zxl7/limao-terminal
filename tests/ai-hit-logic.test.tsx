import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AiHitLogic, buildThemeStrength, isMarketOnlyBlock } from '@/features/analytics'
import type { PoolCallFile, PoolCallView } from '@/shared/api'

/**
 * 「竞价命中逻辑」契约。
 *
 * 用户 2026-11-04 两次纠偏：
 * ① 「不是选股逻辑，而是叫竞价命中的个股逻辑……**不是说你选出来那些个股都要给原因**」
 * ② 「今日其实命中了紫竹和东方海洋，但是因为某种原因，大盘情绪没有买？所以可以将这两个个股放在这里」
 *
 * 故锁七点：
 * ① 只渲染命中的票（已参与 + 仅缺市场级条件）；
 * ② 缺个股级条件的票**不进本页**；
 * ③ 四步链齐；
 * ④ 方向强度按池内口径；
 * ⑤ 空仓但无冻结票时明说无命中；
 * ⑥ 缺字段「—」不补 0；
 * ⑦ "冻结"与"否决"措辞分开，不混。
 */

function view(code: string, patch: Partial<PoolCallView> = {}): PoolCallView {
  return {
    code,
    name: `票${code}`,
    gap_pct: 2.1,
    zone: 'ok',
    bias: 'normal',
    amount_yi: 1.2,
    need_yi: 0.9,
    theme_name: '传媒',
    boards: 3,
    line_is_core: false,
    line_rank: 1,
    view: 'participate',
    quota_rank: 1,
    reason: '落区间且量能达标',
    ...patch,
  } as PoolCallView
}

function file(views: Record<string, PoolCallView>, participate: string[], patch: Partial<PoolCallFile['meta']> = {}): PoolCallFile {
  return {
    trade_date: '2026-11-04',
    enabled: true,
    stance: 'defend',
    quota: 1,
    views,
    meta: {
      caliber: 'test',
      stance: 'defend',
      quota: 1,
      effective_quota: 0,
      pool_size: Object.keys(views).length,
      participate,
      call_at: '2026-11-04 09:25:03',
      market_open: {
        enabled: true,
        pool_size: 48,
        quoted: 48,
        coverage: 1,
        red_open_count: 26,
        red_open_ratio: 0.5417,
        leader_count: 15,
        leader_red_open_count: 10,
        leader_red_open_ratio: 0.6667,
        ready: false,
        reason: '昨涨停竞价没有同时达到红开与量能要求，维持原有名额',
      },
      ...patch,
    },
  } as PoolCallFile
}

describe('isMarketOnlyBlock · 冻结 vs 否决', () => {
  it('只缺「情绪」⇒ 冻结（个股成立）', () => {
    expect(isMarketOnlyBlock(view('a', { view: 'watch', high_win_gate: ['情绪'] }))).toBe(true)
  })

  it('掺个股级条件 ⇒ 不是冻结，不许进命中', () => {
    for (const hw of [['情绪', '量能'], ['量能'], ['梯队'], ['题材龙']]) {
      expect(isMarketOnlyBlock(view('a', { view: 'watch', high_win_gate: hw }))).toBe(false)
    }
  })

  it('view 不是 watch ⇒ 不算冻结', () => {
    expect(isMarketOnlyBlock(view('a', { view: 'skip', high_win_gate: ['情绪'] }))).toBe(false)
    expect(isMarketOnlyBlock(view('a', { view: 'participate', high_win_gate: ['情绪'] }))).toBe(false)
  })

  it('空/缺 high_win_gate ⇒ 不算冻结', () => {
    expect(isMarketOnlyBlock(view('a', { view: 'watch', high_win_gate: [] }))).toBe(false)
    expect(isMarketOnlyBlock(view('a', { view: 'watch', high_win_gate: null }))).toBe(false)
    expect(isMarketOnlyBlock(view('a', { view: 'watch' }))).toBe(false)
  })
})

describe('buildThemeStrength · 池内方向强度', () => {
  it('红开家数、中位涨幅、竞价涨停幅按池内聚合', () => {
    const out = buildThemeStrength({
      a: view('a', { gap_pct: 10.0, theme_name: '传媒' }),
      b: view('b', { gap_pct: 3.0, theme_name: '传媒' }),
      c: view('c', { gap_pct: -1.0, theme_name: '传媒' }),
      d: view('d', { gap_pct: 8.0, theme_name: '新能源' }),
    })
    const media = out.find((s) => s.theme === '传媒')!
    expect(media.total).toBe(3)
    expect(media.red).toBe(2)
    expect(media.medianGap).toBe(3)
    expect(media.atLimit).toBe(1)
    expect(out[0].theme).toBe('传媒')
  })

  it('20cm 用 20% 阈值，不拿 10% 误判', () => {
    const out = buildThemeStrength({
      x: view('x', { gap_pct: 12.0, is_20cm: true }),
      y: view('y', { gap_pct: 12.0, is_20cm: false }),
    })
    expect(out[0].atLimit).toBe(1)
  })
})

describe('AiHitLogic · 今日命中', () => {
  it('已参与的票展示四步判断链', () => {
    const f = file(
      {
        a: view('a', {
          name: '龙板传媒',
          boards: 4,
          line_is_core: true,
          carry_cnt: 5,
          line_max_boards: 4,
          line_tops: ['龙板传媒'],
          gap_to_top: 0,
          market_max_boards: 6,
        }),
      },
      ['a'],
    )
    const { container } = render(<AiHitLogic file={f} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('龙板传媒')
    expect(txt).toContain('命中·已参与')
    expect(txt).toContain('①')
    expect(txt).toContain('为什么先聚焦「传媒」')
    expect(txt).toContain('②')
    expect(txt).toContain('为什么落到这一只')
    expect(txt).toContain('③')
    expect(txt).toContain('量能与封板')
    expect(txt).toContain('④')
    expect(txt).toContain('竞价落点与裁决')
  })

  it('⛔ 11-04 真实形态：命中但情绪压住 → 进"命中但未买"，并说明名额被压到 0', () => {
    const f = file(
      {
        '002058': view('002058', {
          name: '紫竹高科', theme_name: '新能源', boards: 2, view: 'watch',
          high_win_gate: ['情绪'], line_is_core: true, line_max_boards: 2,
          gap_to_top: 2, market_max_boards: 4, carry_cnt: 3, gap_pct: 0.33,
          reason: '四条件缺 情绪 —— 今天不推',
        }),
        '002086': view('002086', {
          name: '东方海洋', theme_name: '大消费', boards: 4, view: 'watch',
          high_win_gate: ['情绪'], line_max_boards: 4, gap_to_top: 0,
          market_max_boards: 4, carry_cnt: 2, gap_pct: 4.68,
          reason: '四条件缺 情绪 —— 今天不推',
        }),
        '999999': view('999999', { name: '缺量能的陪跑', view: 'watch', high_win_gate: ['情绪', '量能'] }),
      },
      [],
    )
    const { container } = render(<AiHitLogic file={f} />)
    const txt = container.textContent ?? ''
    // 两只命中都在
    expect(txt).toContain('紫竹高科')
    expect(txt).toContain('东方海洋')
    expect(txt).toContain('命中·未买')
    expect(txt).toContain('命中但未买')
    // 冻结≠否决
    expect(txt).toContain('冻结')
    expect(txt).not.toContain('否决。')
    // 情绪体检解释为什么没买
    expect(txt).toContain('今晨情绪体检')
    expect(txt).toContain('名义名额')
    expect(txt).toContain('未达放行条件')
    expect(txt).toContain('昨涨停竞价没有同时达到红开与量能要求')
    // 掺个股级的票不进本页
    expect(txt).not.toContain('缺量能的陪跑')
  })

  it('已参与与命中未买分两块，各自计数', () => {
    const f = file(
      {
        a: view('a', { name: '已买票' }),
        b: view('b', { name: '冻结票', view: 'watch', high_win_gate: ['情绪'] }),
      },
      ['a'],
    )
    const { container } = render(<AiHitLogic file={f} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('已参与')
    expect(txt).toContain('命中但未买')
    expect(txt.indexOf('已买票')).toBeLessThan(txt.indexOf('冻结票'))
  })

  it('方向强度带"池内"限定，不冒充全市场', () => {
    const f = file({ a: view('a'), b: view('b') }, ['a'])
    expect(render(<AiHitLogic file={f} />).container.textContent).toContain('池内该方向')
  })

  it('空仓且无冻结票 → 明说无命中，只列方向强度，不解释个股', () => {
    const f = file(
      { a: view('a', { name: '甲', view: 'skip' }), b: view('b', { name: '乙', gap_pct: -2, view: 'skip' }) },
      [],
    )
    const { container } = render(<AiHitLogic file={f} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('今日无命中')
    expect(txt).toContain('空仓日不编个股理由')
    expect(txt).toContain('传媒')
    expect(txt).not.toContain('甲')
    expect(txt).not.toContain('乙')
  })

  it('缺字段渲染「—」，不补 0', () => {
    const f = file({ a: view('a', { seal_quality: null, amount_yi: null, need_yi: null }) }, ['a'])
    const txt = render(<AiHitLogic file={f} />).container.textContent ?? ''
    expect(txt).toContain('—')
    expect(txt).not.toContain('0.00%')
  })

  it('无裁决文件时不崩：显示空态', () => {
    const txt = render(<AiHitLogic />).container.textContent ?? ''
    expect(txt).toContain('今日无命中')
  })

  it('不使用旧口径措辞', () => {
    const f = file({ a: view('a') }, ['a'])
    const txt = render(<AiHitLogic file={f} />).container.textContent ?? ''
    for (const w of ['选股逻辑', '今日选中', '板块辨识度', '竞价后决策变化']) expect(txt).not.toContain(w)
  })
})
