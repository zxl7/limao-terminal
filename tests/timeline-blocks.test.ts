import { describe, expect, it } from 'vitest'
import {
  BURST_MIN_STOCKS,
  buildTimelineSlots,
  groupTimelineSlots,
  isLowStrengthSlot,
  LINKAGE_MIN_SECTORS,
  SLOT_VISIBLE_SECTORS,
  sortIntradaySectorEvents,
  sortSlotSectors,
  type TimelineSlot,
  type TimelineSlotSector,
} from '@/features/analytics'
import type { MarketMemory, ZtPoolStock } from '@/shared/api'

/**
 * 三类展示分块（`groupTimelineSlots`）的回归锁。
 *
 * 分类错了**不报错**：页面照常渲染，只是把「多板块联动」画成普通卡（漏掉爆发），
 * 或把一条孤立消息画成独立卡（碎片化），都是典型的**静默错值**。
 *
 * 四条不变量：
 *  ① **不丢不重** —— 每个输入槽恰好出现在一个分块里；
 *  ② **顺序** —— 分块 `at` 单调不减；
 *  ③ **块键唯一**；
 *  ④ **优先级** —— 联动块绝不被低频合并吞并（`linkage` > `normal` > `merged`）。
 */

function stk(code: string, fbt = '100000'): ZtPoolStock {
  return { code, name: `票${code}`, fbt } as unknown as ZtPoolStock
}

function sec(sector: string, count: number): TimelineSlotSector {
  return {
    sector,
    stocks: Array.from({ length: count }, (_, i) => stk(`${sector}${i}`)),
    count,
    dayShape: count >= BURST_MIN_STOCKS ? 'burst' : 'pair',
    daySpan: 5,
    dayTotal: count,
  }
}

function ev(text: string): MarketMemory['event_log'][number] {
  return { time: '10:00', event: text, severity: 'high' } as unknown as MarketMemory['event_log'][number]
}

function push(name: string): MarketMemory['pushed_topics'][number] {
  return {
    name,
    push_count: 1,
    context: '',
    first_pushed: '10:00',
    last_pushed: '10:00',
  } as unknown as MarketMemory['pushed_topics'][number]
}

function slot(at: number, opts: Partial<TimelineSlot> = {}): TimelineSlot {
  return {
    at,
    sectors: [],
    singles: [],
    events: null,
    pushes: null,
    pushTo: null,
    intradayUp: [],
    intradayDown: [],
    key: `slot:${at}`,
    ...opts,
  }
}

describe('⛔ 盘中逐事件并入主时间轴（2026-09-17 用户「合进我的时间轴里面」）', () => {
  const itev = (at: string, kind: string, extra: Record<string, unknown> = {}) =>
    ({ at, kind, ...extra }) as unknown as import('@/shared/api').IntradayTimelineEvent

  it('按分钟并入：无节点的分钟也会生成槽', () => {
    const slots = buildTimelineSlots([], [
      itev('2026-09-17 13:10:05', 'stock_up', { code: '603626' }),
      itev('2026-09-17 13:12:40', 'broken_new', { name: '中材科技' }),
    ])
    expect(slots.map((s) => s.at)).toEqual([13 * 60 + 10, 13 * 60 + 12])
    expect(slots[0].intradayUp).toHaveLength(1)
    expect(slots[1].intradayDown).toHaveLength(1)
  })

  it('同分钟涨跌各自归位（⛔ 跌侧不得混进涨侧）', () => {
    const slots = buildTimelineSlots([], [
      itev('2026-09-17 13:10:05', 'stock_up'),
      itev('2026-09-17 13:10:20', 'sector_down', { name: '白银' }),
      itev('2026-09-17 13:10:40', 'limit_down_new', { name: '海南发展' }),
    ])
    expect(slots).toHaveLength(1)
    expect(slots[0].intradayUp.map((e) => e.kind)).toEqual(['stock_up'])
    expect(slots[0].intradayDown.map((e) => e.kind).sort()).toEqual(['limit_down_new', 'sector_down'])
  })

  it('非法时刻被跳过（不丢整批、不抛错）', () => {
    const slots = buildTimelineSlots([], [
      itev('', 'stock_up'),
      itev('坏时间', 'stock_up'),
      itev('2026-09-17 13:20:00', 'stock_up'),
    ])
    expect(slots).toHaveLength(1)
    expect(slots[0].at).toBe(13 * 60 + 20)
  })

  it('⛔ 含盘中事件的槽不得被低频合并吞掉', () => {
    const slots = buildTimelineSlots([], [itev('2026-09-17 13:10:05', 'broken_new', { name: 'X' })])
    const blocks = groupTimelineSlots(slots, isLowStrengthSlot)
    expect(blocks.map((b) => b.kind)).toEqual(['normal'])
  })
})

describe('groupTimelineSlots · 三类展示分块', () => {
  it('①不丢不重 ②顺序 ③块键唯一', () => {
    const slots = [
      slot(600, { events: [ev('情绪转弱')] }),
      slot(601, { singles: [stk('000001')] }),
      slot(602, { sectors: [sec('光通信', 3), sec('PCB板', 3)] }),
      slot(603, { pushes: [push('锂电')] }),
      slot(604, { sectors: [sec('化工', 1)] }),
    ]
    const blocks = groupTimelineSlots(slots)

    const covered: string[] = []
    for (const b of blocks) {
      if (b.kind === 'normal') covered.push(b.slot.key)
      else for (const s of b.slots) covered.push(s.key)
    }
    expect(covered.slice().sort()).toEqual(slots.map((s) => s.key).sort())
    expect(new Set(covered).size).toBe(slots.length)

    const ats = blocks.map((b) => b.at)
    expect(ats).toEqual(ats.slice().sort((a, b) => a - b))
    expect(new Set(blocks.map((b) => b.key)).size).toBe(blocks.length)
  })

  it('连续纯消息分钟 → 合并成一张 · 标明板块数与名称', () => {
    const slots = [
      slot(600, { events: [ev('情绪转弱')] }),
      slot(601, { pushes: [push('光通信')] }),
      slot(602, { pushes: [push('PCB板')] }),
    ]
    const blocks = groupTimelineSlots(slots)
    expect(blocks).toHaveLength(1)
    const b = blocks[0]
    expect(b.kind).toBe('merged')
    if (b.kind === 'merged') {
      expect(b.at).toBe(600)
      expect(b.to).toBe(602)
      expect(b.slots).toHaveLength(3)
      expect(b.sectors).toEqual(['光通信', 'PCB板'])
    }
  })

  it('一条孤立消息也走合并（不单独成卡）', () => {
    const blocks = groupTimelineSlots([slot(600, { pushes: [push('锂电')] })])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('merged')
  })

  it('④同刻多板块达标 → 联动卡，且不吞并相邻低频消息', () => {
    const slots = [
      slot(600, { events: [ev('x')] }),
      slot(601, { sectors: [sec('光通信', BURST_MIN_STOCKS), sec('PCB板', BURST_MIN_STOCKS)] }),
      slot(602, { pushes: [push('锂电')] }),
    ]
    const blocks = groupTimelineSlots(slots)
    expect(blocks.map((b) => b.kind)).toEqual(['merged', 'linkage', 'merged'])
    const lk = blocks.find((b) => b.kind === 'linkage')
    expect(lk).toBeTruthy()
    if (lk && lk.kind === 'linkage') {
      expect(lk.at).toBe(601)
      expect(lk.sectors.sort()).toEqual(['PCB板', '光通信'])
    }
  })

  it('仅 1 个板块达标 → 仍是普通卡（联动需「多」板块）', () => {
    const blocks = groupTimelineSlots([slot(600, { sectors: [sec('光通信', BURST_MIN_STOCKS)] })])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('normal')
  })

  it('含个股但未达门槛 → 普通卡（不冠爆发）', () => {
    const slots = [
      slot(600, { singles: [stk('000001')] }),
      slot(601, { sectors: [sec('化工', 1)] }),
    ]
    const blocks = groupTimelineSlots(slots)
    expect(blocks.map((b) => b.kind)).toEqual(['normal', 'normal'])
  })

  it('门槛常量与判定一致（守住「多板块」下限）', () => {
    expect(LINKAGE_MIN_SECTORS).toBeGreaterThanOrEqual(2)
    const one = groupTimelineSlots([
      slot(600, { sectors: [sec('A', BURST_MIN_STOCKS), sec('B', BURST_MIN_STOCKS - 1)] }),
    ])
    expect(one[0].kind).toBe('normal')
    const two = groupTimelineSlots([
      slot(600, { sectors: [sec('A', BURST_MIN_STOCKS), sec('B', BURST_MIN_STOCKS)] }),
    ])
    expect(two[0].kind).toBe('linkage')
  })
})

describe('⛔ 形态一致性：含题材信号的时刻不得被低频合并（2026-09-17 用户抓包）', () => {
  it('题材爆发 → 高强度 → 单独成普通卡（不塌成合并卡）', () => {
    const slots = [
      slot(600, { events: [ev('新主线崛起：光通信 涨停7只，龙头 华脉科技')] }),
      slot(601, { events: [ev('关注板块集体重挫：橡胶、化学制品')] }),
    ]
    // ⛔ 必须传题材感知判定，否则会全部塌成一张合并卡
    const blocks = groupTimelineSlots(slots, isLowStrengthSlot)
    expect(blocks.map((b) => b.kind)).toEqual(['normal', 'normal'])
  })

  it('无题材层的弱消息 → 仍走合并（保留低频合并能力）', () => {
    const slots = [
      slot(600, { events: [ev('某条普通快讯')] }),
      slot(601, { pushes: [push('某弱题材')] }),
    ]
    const blocks = groupTimelineSlots(slots, isLowStrengthSlot)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('merged')
  })

  it('盘中当日（无个股、只有题材事件）→ 每个时刻一张普通卡（与有股日子同一形态）', () => {
    const slots = [
      slot(592, { events: [ev('新主线崛起：玻璃基板封装 涨停3只，龙头 三峡新材')] }),
      slot(600, { events: [ev('PCB板 龙头切换：中岩大地 → 中材科技')] }),
      slot(622, { events: [ev('机器人 龙头切换：A → B')] }),
    ]
    const blocks = groupTimelineSlots(slots, isLowStrengthSlot)
    expect(blocks.every((b) => b.kind === 'normal')).toBe(true)
    expect(blocks).toHaveLength(3)
  })
})

/**
 * 板块**强度排序**（`sortSlotSectors`）的回归锁 —— 用户 2026-09-17：
 * 「卡片内的各板块做好强度的排序，比如说这个板块很强，那么它就排第一个」。
 *
 * ⛔ 排序错了**不报错**：页面照常渲染，只是把弱板块排在强板块前面，
 * 让读者第一眼看到的是次要方向 —— 典型的**静默错值**，必须用测试钉住。
 */
describe('sortSlotSectors · 板块强度降序', () => {
  /** 带 `boards` 的行业分组块（用于验证二级排序：组内最高板） */
  function secBoards(sector: string, boards: number[], dayTotal?: number): TimelineSlotSector {
    return {
      sector,
      stocks: boards.map((b, i) => ({ ...stk(`${sector}${i}`), boards: b }) as ZtPoolStock),
      count: boards.length,
      dayShape: null,
      daySpan: 5,
      dayTotal: dayTotal ?? boards.length,
    }
  }

  it('① 当刻封板家数多的排前（强度第一口径）', () => {
    const sorted = sortSlotSectors([sec('弱', 1), sec('强', 4), sec('中', 2)])
    expect(sorted.map((g) => g.sector)).toEqual(['强', '中', '弱'])
  })

  it('② 家数相同 → 组内最高板高的排前（板块高度）', () => {
    const sorted = sortSlotSectors([
      secBoards('低板', [1, 1, 1]),
      secBoards('高板', [5, 1, 1]),
    ])
    expect(sorted.map((g) => g.sector)).toEqual(['高板', '低板'])
  })

  it('③ 家数与最高板都相同 → 全天总数多的排前（广度兜底）', () => {
    const sorted = sortSlotSectors([
      secBoards('窄', [1, 1], 2),
      secBoards('广', [1, 1], 9),
    ])
    expect(sorted.map((g) => g.sector)).toEqual(['广', '窄'])
  })

  it('④ 完全同强度 → 按名称升序（稳定 tie-break，同输入必同输出）', () => {
    const a = sortSlotSectors([sec('B', 2), sec('A', 2), sec('C', 2)])
    const b = sortSlotSectors([sec('C', 2), sec('A', 2), sec('B', 2)])
    expect(a.map((g) => g.sector)).toEqual(['A', 'B', 'C'])
    expect(b.map((g) => g.sector)).toEqual(['A', 'B', 'C']) // 与输入顺序无关
  })

  it('⛔ 不丢不重：排序后元素集合与数量完全守恒（弱板块只排后，不被删）', () => {
    const input = [sec('A', 1), sec('B', 5), sec('C', 3), sec('D', 1), sec('E', 2)]
    const sorted = sortSlotSectors(input)
    expect(sorted).toHaveLength(input.length)
    expect(new Set(sorted.map((g) => g.sector))).toEqual(new Set(['A', 'B', 'C', 'D', 'E']))
    // 家数单调不减
    const counts = sorted.map((g) => g.count)
    expect(counts).toEqual([...counts].sort((x, y) => y - x))
  })

  it('⛔ 纯函数：不改动入参（返回新数组）', () => {
    const input = [sec('A', 1), sec('B', 5)]
    const before = input.map((g) => g.sector)
    const out = sortSlotSectors(input)
    expect(out).not.toBe(input)
    expect(input.map((g) => g.sector)).toEqual(before) // 原数组顺序不变
  })

  it('⚠️ 缺字段健壮：票缺 `boards` 时不得产出 NaN（否则排序退化）', () => {
    // `sec()` 造的票没有 boards 字段 —— 必须仍能稳定排序
    const sorted = sortSlotSectors([sec('A', 1), sec('B', 3), sec('C', 2)])
    expect(sorted.map((g) => g.sector)).toEqual(['B', 'C', 'A'])
  })

  it('空输入 → 空输出（不抛错）', () => {
    expect(sortSlotSectors([])).toEqual([])
  })
})

/**
 * 盘中**板块级事件**的强度排序（`sortIntradaySectorEvents`）+ 卡面「最多 3 个板块」上限。
 *
 * 实测病灶（2026-09-17 真实日志）：单张卡最多挤进 **9 个板块走强 + 6 个杀跌板块**。
 * 排序或上限错了**不报错** —— 只是把弱板块排在最前 / 板块数再次爆表，属静默错值。
 */
describe('sortIntradaySectorEvents · 盘中板块强度 + 展示上限', () => {
  const ie = (kind: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ at: '2026-09-17 13:10:05', kind, name, ...extra }) as unknown as import('@/shared/api').IntradayTimelineEvent

  it('上限常量 = 3（用户「最多显示 3 个板块」）', () => {
    expect(SLOT_VISIBLE_SECTORS).toBe(3)
  })

  it('涨侧：`zt_count` 家数多的排前（弱→强输入也必须被纠正）', () => {
    const out = sortIntradaySectorEvents(
      [
        ie('sector_up', '弱板块', { zt_count: 2 }),
        ie('sector_up', '强板块', { zt_count: 9 }),
        ie('sector_up', '中板块', { zt_count: 5 }),
      ],
      'up',
    )
    expect(out.map((e) => e.name)).toEqual(['强板块', '中板块', '弱板块'])
  })

  it('涨侧二级：家数相同 → 环比增量 `delta` 大的排前', () => {
    const out = sortIntradaySectorEvents(
      [
        ie('sector_up', '慢', { zt_count: 5, delta: 1 }),
        ie('sector_up', '快', { zt_count: 5, delta: 4 }),
      ],
      'up',
    )
    expect(out.map((e) => e.name)).toEqual(['快', '慢'])
  })

  it('跌侧：跌幅**最负的排前**（跌得最狠 = 最强负向信号）', () => {
    const out = sortIntradaySectorEvents(
      [
        ie('sector_down', '小跌', { pct: -0.8 }),
        ie('sector_down', '崩了', { pct: -6.49 }),
        ie('sector_down', '中跌', { pct: -2.5 }),
      ],
      'down',
    )
    expect(out.map((e) => e.name)).toEqual(['崩了', '中跌', '小跌'])
  })

  it('跌侧二级：跌幅相同 → 主力净流出更狠的排前', () => {
    const out = sortIntradaySectorEvents(
      [
        ie('sector_down', '流出少', { pct: -3, inflow: -1e8 }),
        ie('sector_down', '流出多', { pct: -3, inflow: -9e8 }),
      ],
      'down',
    )
    expect(out.map((e) => e.name)).toEqual(['流出多', '流出少'])
  })

  it('同强度 → 名称升序（稳定 tie-break，与输入顺序无关）', () => {
    const a = sortIntradaySectorEvents(
      [ie('sector_up', 'B', { zt_count: 3 }), ie('sector_up', 'A', { zt_count: 3 })],
      'up',
    )
    const b = sortIntradaySectorEvents(
      [ie('sector_up', 'A', { zt_count: 3 }), ie('sector_up', 'B', { zt_count: 3 })],
      'up',
    )
    expect(a.map((e) => e.name)).toEqual(['A', 'B'])
    expect(b.map((e) => e.name)).toEqual(['A', 'B'])
  })

  it('⛔ 不丢不重：数量与集合守恒（弱板块只排后，不被删）', () => {
    const input = [
      ie('sector_up', 'A', { zt_count: 1 }),
      ie('sector_up', 'B', { zt_count: 7 }),
      ie('sector_up', 'C', { zt_count: 4 }),
    ]
    const out = sortIntradaySectorEvents(input, 'up')
    expect(out).toHaveLength(3)
    expect(new Set(out.map((e) => e.name))).toEqual(new Set(['A', 'B', 'C']))
  })

  it('⛔ 纯函数：不改动入参（返回新数组）', () => {
    const input = [ie('sector_up', 'A', { zt_count: 1 }), ie('sector_up', 'B', { zt_count: 7 })]
    const before = input.map((e) => e.name)
    const out = sortIntradaySectorEvents(input, 'up')
    expect(out).not.toBe(input)
    expect(input.map((e) => e.name)).toEqual(before)
  })

  it('⚠️ 缺字段健壮：无 `zt_count` / `pct` 时不得产出 NaN 破坏排序', () => {
    const up = sortIntradaySectorEvents(
      [ie('sector_up', '无家数'), ie('sector_up', '有家数', { zt_count: 4 })],
      'up',
    )
    expect(up.map((e) => e.name)).toEqual(['有家数', '无家数'])
    const down = sortIntradaySectorEvents(
      [ie('sector_down', '无跌幅'), ie('sector_down', '有跌幅', { pct: -5 })],
      'down',
    )
    expect(down.map((e) => e.name)).toEqual(['有跌幅', '无跌幅'])
  })

  it('空输入 → 空输出（不抛错）', () => {
    expect(sortIntradaySectorEvents([], 'up')).toEqual([])
    expect(sortIntradaySectorEvents([], 'down')).toEqual([])
  })
})
