import { describe, expect, it } from 'vitest'
import { buildAuctionRows, buildAuctionThemeAgg, median, sortAuctionRows } from '@/features/analytics'

/**
 * 竞价资金榜（2026-10-19）。
 *
 * 这张表的价值全在「口径诚实」：只算 prev_close / auction_price / auction_amount_yi
 * 三个真实字段。测试锁的就是这条边界 —— 缺字段不出行、不补零、不拿涨幅凑净额。
 */

const names = new Map([
  ['300581', '晨曦航空'],
  ['600668', '尖峰集团'],
  ['000420', '吉林化纤'],
  ['000001', '平安银行'],
])

describe('buildAuctionRows · 口径与排序', () => {
  it('涨幅 / 竞额 / 榜内占比 都按真实字段算', () => {
    const rows = buildAuctionRows(
      {
        '300581': { prev_close: 10, auction_price: 11, auction_amount_yi: 2 },
        '600668': { prev_close: 20, auction_price: 19, auction_amount_yi: 1 },
      },
      names,
    )
    expect(rows[0]).toMatchObject({ code: '300581', name: '晨曦航空', pct: 10, amountYi: 2 })
    expect(rows[0].sharePct).toBeCloseTo(66.7, 1) // 2 / 3
    expect(rows[1]).toMatchObject({ code: '600668', pct: -5, amountYi: 1 })
    expect(rows[1].sharePct).toBeCloseTo(33.3, 1)
  })

  it('默认按竞额降序；同额时高开在前', () => {
    const rows = buildAuctionRows(
      {
        a: { prev_close: 10, auction_price: 9.5, auction_amount_yi: 1 }, // -5%，1 亿
        b: { prev_close: 10, auction_price: 11, auction_amount_yi: 1 }, // +10%，1 亿
        c: { prev_close: 10, auction_price: 10, auction_amount_yi: 3 }, // 0%，3 亿
      },
      new Map(),
    )
    expect(rows.map((r) => r.code)).toEqual(['c', 'b', 'a'])
  })

  it('缺任一字段不出行（不补 0、不猜）', () => {
    const rows = buildAuctionRows(
      {
        ok: { prev_close: 10, auction_price: 11, auction_amount_yi: 1 },
        noAmount: { prev_close: 10, auction_price: 11, auction_amount_yi: null },
        noPrev: { prev_close: null, auction_price: 11, auction_amount_yi: 1 },
        zeroPrev: { prev_close: 0, auction_price: 11, auction_amount_yi: 1 },
      },
      new Map(),
    )
    expect(rows.map((r) => r.code)).toEqual(['ok'])
  })

  it('高亮 = 高开 ≥5% 且竞额 ≥ 榜内中位数（只有涨幅没有量不算）', () => {
    const rows = buildAuctionRows(
      {
        big: { prev_close: 10, auction_price: 10.6, auction_amount_yi: 5 }, // +6%，5 亿
        smallHot: { prev_close: 10, auction_price: 10.6, auction_amount_yi: 0.1 }, // +6%，但没量
        bigCold: { prev_close: 10, auction_price: 10, auction_amount_yi: 6 }, // 有钱但没高开
      },
      new Map(),
    )
    const byCode = new Map(rows.map((r) => [r.code, r]))
    expect(byCode.get('big')?.hot).toBe(true)
    // 0.1 亿 < 中位数（5）→ 不算抢筹
    expect(byCode.get('smallHot')?.hot).toBe(false)
    expect(byCode.get('bigCold')?.hot).toBe(false)
  })

  it('keepNegative=false 时剔除低开票', () => {
    const rows = buildAuctionRows(
      {
        up: { prev_close: 10, auction_price: 11, auction_amount_yi: 1 },
        down: { prev_close: 10, auction_price: 9, auction_amount_yi: 1 },
      },
      new Map(),
      { keepNegative: false },
    )
    expect(rows.map((r) => r.code)).toEqual(['up'])
  })

  it('空输入返回空数组（不抛异常）', () => {
    expect(buildAuctionRows(null, names)).toEqual([])
    expect(buildAuctionRows({}, names)).toEqual([])
  })
})

describe('median / sortAuctionRows', () => {
  it('中位数：奇偶都正确，空数组为 0', () => {
    expect(median([])).toBe(0)
    expect(median([3])).toBe(3)
    expect(median([1, 3, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('按涨幅 / 占比切换排序（不改原数组）', () => {
    const base = buildAuctionRows(
      {
        a: { prev_close: 10, auction_price: 10.1, auction_amount_yi: 5 },
        b: { prev_close: 10, auction_price: 11, auction_amount_yi: 1 },
        c: { prev_close: 10, auction_price: 10.5, auction_amount_yi: 3 },
      },
      new Map(),
    )
    expect(sortAuctionRows(base, 'pct').map((r) => r.code)).toEqual(['b', 'c', 'a'])
    expect(sortAuctionRows(base, 'share').map((r) => r.code)).toEqual(['a', 'c', 'b'])
    // 原数组未被就地修改
    expect(base.map((r) => r.code)).toEqual(['a', 'c', 'b'])
  })
})

/**
 * 池内裁决关联（2026-10-19 追加）。
 *
 * 参考产品的榜只回答「钱多不多」，我们的榜首还要回答「这钱该不该跟」。
 * 锁三条最容易被写错、且错了也不会报错的边界：
 *   ① **池外 ≠ 放弃**（没被评估 vs 评估后否决，语义相反）；
 *   ② 量能门槛缺失时给 `null`，⛔ 不回填「达标」；
 *   ③ 池内排序里「参与」必须整体排在「池外」之前。
 */
describe('buildAuctionRows · 池内裁决关联', () => {
  const quotes = {
    '300581': { prev_close: 10, auction_price: 11, auction_amount_yi: 3 }, // +10%，3 亿
    '600668': { prev_close: 10, auction_price: 9.8, auction_amount_yi: 1 }, // -2%，1 亿
    '000420': { prev_close: 10, auction_price: 10.2, auction_amount_yi: 2 }, // +2%，2 亿
  }
  const pool = {
    // 参与 + 龙一 + 核心，门槛 5 亿 → 3 亿未达
    '300581': { view: 'participate', theme_name: '低空经济', amount_yi: 3, need_yi: 5, line_rank: 1, line_is_core: true },
    // 放弃
    '600668': { view: 'skip', theme_name: '水泥', amount_yi: 1, need_yi: 0.5, line_rank: 3 },
  }

  it('池内票带角色 / 题材 / 量能判定；池外票如实标「池外」而不是「放弃」', () => {
    const rows = buildAuctionRows(quotes, names, { pool })
    const byCode = new Map(rows.map((r) => [r.code, r]))

    expect(byCode.get('300581')).toMatchObject({
      inPool: true,
      poolRole: '参与',
      theme: '低空经济',
      needYi: 5,
      amountPass: false, // 3 亿 < 5 亿门槛
      lineRank: 1,
      isCore: true,
    })
    expect(byCode.get('600668')).toMatchObject({
      inPool: true,
      poolRole: '放弃',
      theme: '水泥',
      amountPass: true, // 1 亿 ≥ 0.5 亿
    })
    // ⛔ 池外票绝不能显示为「放弃」—— 那是把「没看过」说成「否决了」
    expect(byCode.get('000420')).toMatchObject({
      inPool: false,
      poolRole: '池外',
      theme: null,
      needYi: null,
      amountPass: null,
      lineRank: null,
    })
  })

  it('不传池内裁决时全部为池外（不抛异常、不伪造角色）', () => {
    const rows = buildAuctionRows(quotes, names)
    expect(rows.every((r) => r.poolRole === '池外' && r.inPool === false)).toBe(true)
    expect(rows.every((r) => r.amountPass === null)).toBe(true)
  })

  it('未知 view token 兜底为「观察」（⛔ 不直出英文内部值）', () => {
    const rows = buildAuctionRows(
      { x: { prev_close: 10, auction_price: 10.5, auction_amount_yi: 1 } },
      new Map(),
      { pool: { x: { view: 'participate_pending' } } },
    )
    expect(rows[0].poolRole).toBe('观察')
  })

  it('池内排序：参与 → 观察 → 放弃 → 池外，同角色内龙一在前', () => {
    const rows = buildAuctionRows(quotes, names, {
      pool: {
        '000420': { view: 'watch', line_rank: 2 },
        '600668': { view: 'skip', line_rank: 1 },
      },
    })
    // 300581 是池外（quotes 里有、pool 里没有）
    expect(sortAuctionRows(rows, 'pool').map((r) => r.poolRole)).toEqual([
      '观察',
      '放弃',
      '池外',
    ])
  })
})

describe('buildAuctionThemeAgg · 题材级聚合', () => {
  const rows = buildAuctionRows(
    {
      a: { prev_close: 10, auction_price: 11, auction_amount_yi: 4 },
      b: { prev_close: 10, auction_price: 10.2, auction_amount_yi: 2 },
      c: { prev_close: 10, auction_price: 9, auction_amount_yi: 1 },
      d: { prev_close: 10, auction_price: 10, auction_amount_yi: 3 }, // 池外，无题材
    },
    new Map(),
    {
      pool: {
        a: { view: 'participate', theme_name: '低空经济' },
        b: { view: 'watch', theme_name: '低空经济' },
        c: { view: 'skip', theme_name: '水泥' },
      },
    },
  )

  it('按题材汇总竞额 / 只数 / 最高涨幅 / 参与数，并按竞额降序', () => {
    const agg = buildAuctionThemeAgg(rows)
    expect(agg.map((t) => t.theme)).toEqual(['低空经济', '水泥'])
    expect(agg[0]).toMatchObject({ count: 2, amountYi: 6, maxPct: 10, participate: 1 })
    expect(agg[1]).toMatchObject({ count: 1, amountYi: 1, maxPct: -10, participate: 0 })
  })

  it('占比按全榜竞额算（含无题材的池外票），⛔ 不只在池内票之间分摊', () => {
    const agg = buildAuctionThemeAgg(rows)
    // 全榜合计 = 4+2+1+3 = 10 亿；低空经济 6 亿 → 60%
    expect(agg[0].sharePct).toBeCloseTo(60, 1)
  })

  it('无题材票不进聚合（不编「其他」稀释比例）', () => {
    const agg = buildAuctionThemeAgg(rows)
    expect(agg.some((t) => t.theme === '其他')).toBe(false)
    expect(agg.reduce((s, t) => s + t.count, 0)).toBe(3) // 4 行里 1 行无题材
  })

  it('空输入返回空数组', () => {
    expect(buildAuctionThemeAgg([])).toEqual([])
  })
})
