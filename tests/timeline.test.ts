import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  buildTimelineSlots,
  BURST_MIN_STOCKS,
  BURST_WINDOW_MIN,
  clockMin,
  cumulativeByMarks,
  fbtMin,
  MARK_LABELS,
  MARKS,
  minToClock,
  timelineNodeKey,
} from '@/features/analytics'
import type { ZtPoolStock } from '@/shared/api'

/**
 * 日内炒作时间轴的纯计算内核 —— 板块聚类与时序的回归锁。
 *
 * ## 为什么这个测试非写不可
 *
 * 聚类/排序错了**不会报任何错**：页面照常渲染，只是把票归到了错误的板块、
 * 或把顺序排乱 —— 而「哪个板块几点开始成型」恰恰是这页存在的唯一理由。
 * 这是典型的**静默错值**，只有不变量测试能发现。
 *
 * 两条核心不变量：
 *   1. **不丢不重** —— Σ节点股票数 + looseStocks === 输入总数
 *   2. **时间升序** —— nodes[i].at 单调不减
 */

function mk(code: string, fbt: string, boards = 1, sector = '测试板块'): ZtPoolStock {
  return {
    code,
    name: `票${code}`,
    pct: 10,
    price: 10,
    boards,
    fbt,
    zbc: 0,
    hs: 1,
    sector,
    seal: 1,
    cje_yi: 1,
    zsz_yi: 10,
  }
}

const NO_EVENTS: never[] = []
const NO_PUSHES: never[] = []

/** 取所有节点里出现的股票数（含单票节点） */
function countStocks(nodes: ReturnType<typeof buildTimeline>['nodes']): number {
  return nodes.reduce(
    (n, x) => n + (x.kind === 'sector' ? x.stocks.length : x.kind === 'single' ? 1 : 0),
    0,
  )
}

describe('时间解析', () => {
  it('fbt：`092500` 形态 → 分钟；非法输入一律 null 而不是 0', () => {
    expect(fbtMin('092500')).toBe(565)
    expect(fbtMin('145959')).toBe(899)
    // ⛔ 关键：非法值必须 null。返回 0 会被当成「00:00 首封」，直接造出一条假数据
    expect(fbtMin('')).toBeNull()
    expect(fbtMin(null)).toBeNull()
    expect(fbtMin('abc')).toBeNull()
    expect(fbtMin('930')).toBeNull()
  })

  it('minToClock / clockMin 互逆（含补零与单位数小时容错）', () => {
    expect(minToClock(565)).toBe('09:25')
    expect(minToClock(900)).toBe('15:00')
    expect(clockMin('10:30')).toBe(630)
    expect(clockMin('9:05')).toBe(545)
    expect(clockMin('bad')).toBeNull()
    expect(clockMin(minToClock(849))).toBe(849)
  })
})

describe('板块聚类 —— 不丢不重（本测试的核心理由）', () => {
  it('每只票恰好出现在一个节点里，总数守恒；无 fbt 的进 looseStocks 而不是被丢掉', () => {
    const stocks = [
      mk('000001', '092500', 2, '电力'),
      mk('000002', '093000', 1, '电力'),
      mk('000003', '093200', 1, '电力'),
      mk('000004', '103000', 1, '半导体'),
      mk('000005', '103100', 3, '半导体'),
      mk('000006', '133000', 1, '黄酒'),
      mk('000007', ''), // 无 fbt → looseStocks
      mk('000008', null as unknown as string), // 同上
    ]
    const { nodes, looseStocks } = buildTimeline({
      stocks,
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    expect(countStocks(nodes) + looseStocks.length).toBe(stocks.length)
    expect(countStocks(nodes)).toBe(6)
    expect(looseStocks.map((s) => s.code)).toEqual(['000007', '000008'])
  })

  it('同板块 ≥2 只合成一个板块块；单只自成一个单票节点', () => {
    const { nodes } = buildTimeline({
      stocks: [
        mk('a', '100000', 1, '电力'),
        mk('b', '100500', 1, '电力'),
        mk('c', '110000', 1, '黄酒'),
      ],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const sectorNodes = nodes.filter((n) => n.kind === 'sector')
    const singleNodes = nodes.filter((n) => n.kind === 'single')
    expect(sectorNodes.map((n) => (n as { sector: string }).sector)).toEqual(['电力'])
    expect(singleNodes.map((n) => (n as { stock: ZtPoolStock }).stock.code)).toEqual(['c'])
  })

  it('板块块的 at = 首次封板时刻、to = 末次；块内按首封时刻升序', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('late', '103000', 1, '电力'), mk('early', '093000', 1, '电力'), mk('mid', '100000', 1, '电力')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const n = nodes.find((x) => x.kind === 'sector') as {
      at: number
      to: number
      stocks: ZtPoolStock[]
    }
    expect(n.at).toBe(570) // 09:30
    expect(n.to).toBe(630) // 10:30
    expect(n.stocks.map((s) => s.code)).toEqual(['early', 'mid', 'late'])
  })
})

describe('形态判定 —— 爆发 vs 扩散（⛔ 只按家数判会把扩散误判成爆发）', () => {
  it('≥3 只且跨度 ≤ 窗口 → burst', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('a', '100000', 1, '电力'), mk('b', '100002', 1, '电力'), mk('c', '100004', 1, '电力')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const n = nodes.find((x) => x.kind === 'sector') as { shape: string; to: number; at: number }
    expect(n.to - n.at).toBeLessThanOrEqual(BURST_WINDOW_MIN)
    expect(n.shape).toBe('burst')
  })

  it('≥3 只但跨度 > 窗口 → spread（全天反复有人来打，不是一次性爆发）', () => {
    const { nodes } = buildTimeline({
      stocks: [
        mk('a', '093500', 1, '通信设备'),
        mk('b', '110000', 1, '通信设备'),
        mk('c', '131200', 1, '通信设备'),
      ],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const n = nodes.find((x) => x.kind === 'sector') as { shape: string; to: number; at: number }
    expect(n.to - n.at).toBeGreaterThan(BURST_WINDOW_MIN)
    expect(n.shape).toBe('spread')
  })

  it('2 只 → pair（不足爆发门槛，不冒充爆发）', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('a', '100000', 1, '橡胶'), mk('b', '100100', 1, '橡胶')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const n = nodes.find((x) => x.kind === 'sector') as { shape: string }
    expect(n.shape).toBe('pair')
    expect(BURST_MIN_STOCKS).toBe(3)
  })
})

describe('时序 —— 事件与推送并入同一条轴，且同刻合并', () => {
  it('所有节点按 at 升序；同一分钟先事实（板块/单票）后消息（事件/推送）', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('a', '100000', 1, '电力'), mk('b', '100100', 1, '电力'), mk('c', '110000', 1, '黄酒')],
      events: [
        { time: '10:00', event: '情绪转暖', severity: 'high', topic: '情绪' },
        { time: '14:10', event: '尾盘回落', severity: 'mid', topic: '情绪' },
      ],
      pushes: [
        {
          name: '光通信',
          type: 'sector',
          first_pushed: '10:00',
          last_pushed: '14:13',
          push_count: 3,
          context: '',
          last_catalyst: '',
        },
      ],
    })
    for (let i = 1; i < nodes.length; i += 1) {
      expect(nodes[i].at).toBeGreaterThanOrEqual(nodes[i - 1].at)
    }
    // 10:00 = 600 那一分钟：板块块 → 事件 → 推送
    expect(nodes.filter((n) => n.at === 600).map((n) => n.kind)).toEqual([
      'sector',
      'event',
      'push',
    ])
  })

  it('同一时刻的多条事件合并为**一个节点**（原系统的时间戳是卡片生成时刻，不是事件时刻）', () => {
    const { nodes } = buildTimeline({
      stocks: [],
      events: [
        { time: '10:57', event: '情绪由分歧转亢奋', severity: 'high', topic: '情绪' },
        { time: '10:57', event: '国产芯片龙头切换', severity: 'high', topic: '国产芯片' },
        { time: '10:57', event: '新主线崛起：光通信', severity: 'high', topic: '光通信' },
      ],
      pushes: NO_PUSHES,
    })
    const ev = nodes.filter((n) => n.kind === 'event') as Array<{ at: number; events: unknown[] }>
    // 一个节点，而不是三条 —— 逐条铺开会让读者以为市场同一分钟做了三个动作
    expect(ev.length).toBe(1)
    expect(ev[0].at).toBe(657)
    expect(ev[0].events.length).toBe(3)
  })

  it('同一时刻的多条推送合并为一行，区间取组内最大末推时刻', () => {
    const { nodes } = buildTimeline({
      stocks: [],
      events: NO_EVENTS,
      pushes: [
        {
          name: '光通信',
          type: 'sector',
          first_pushed: '11:14',
          last_pushed: '14:13',
          push_count: 3,
          context: '',
          last_catalyst: '',
        },
        {
          name: '国产芯片',
          type: 'sector',
          first_pushed: '11:14',
          last_pushed: '11:20',
          push_count: 1,
          context: '',
          last_catalyst: '',
        },
      ],
    })
    const pu = nodes.filter((n) => n.kind === 'push') as Array<{
      at: number
      to: number
      pushes: unknown[]
    }>
    expect(pu.length).toBe(1)
    expect(pu[0].at).toBe(674) // 11:14
    expect(pu[0].to).toBe(853) // 组内最大末推 14:13
    expect(pu[0].pushes.length).toBe(2)
  })

  it('事件与推送**条目总数一条不少**（只是合并进同一节点）', () => {
    const events = [
      { time: '10:57', event: 'a', severity: 'high', topic: '情绪' },
      { time: '10:57', event: 'b', severity: 'high', topic: '情绪' },
      { time: '14:10', event: 'c', severity: 'mid', topic: '情绪' },
    ]
    const pushes = [
      {
        name: 'x',
        type: 'sector',
        first_pushed: '11:14',
        last_pushed: '11:14',
        push_count: 1,
        context: '',
        last_catalyst: '',
      },
      {
        name: 'y',
        type: 'sector',
        first_pushed: '11:14',
        last_pushed: '11:14',
        push_count: 1,
        context: '',
        last_catalyst: '',
      },
    ]
    const { nodes } = buildTimeline({ stocks: [], events, pushes })
    const evCount = nodes
      .filter((n) => n.kind === 'event')
      .reduce((s, n) => s + (n as { events: unknown[] }).events.length, 0)
    const puCount = nodes
      .filter((n) => n.kind === 'push')
      .reduce((s, n) => s + (n as { pushes: unknown[] }).pushes.length, 0)
    expect(evCount).toBe(events.length)
    expect(puCount).toBe(pushes.length)
  })

  it('时间非法的事件/推送被跳过，不产生 at 为空的节点', () => {
    const { nodes } = buildTimeline({
      stocks: [],
      events: [{ time: '', event: '无时间', severity: 'low', topic: '情绪' }],
      pushes: [
        {
          name: 'x',
          type: 'sector',
          first_pushed: '',
          last_pushed: '',
          push_count: 1,
          context: '',
          last_catalyst: '',
        },
      ],
    })
    expect(nodes).toEqual([])
  })
})

describe('推进曲线刻度', () => {
  it('刻度单调递增，首尾 = 09:30 / 15:00，且跳过午休', () => {
    expect(MARK_LABELS[0]).toBe('09:30')
    expect(MARK_LABELS.at(-1)).toBe('15:00')
    for (let i = 1; i < MARKS.length; i += 1) {
      expect(MARKS[i]).toBeGreaterThan(MARKS[i - 1])
    }
    expect(MARKS.filter((m) => m > 690 && m < 780)).toEqual([])
  })

  it('累计值单调不减，且末刻度等于全部样本数', () => {
    const mins = [565, 570, 630, 700, 800, 890]
    const cum = cumulativeByMarks(mins, MARKS)
    for (let i = 1; i < cum.length; i += 1) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1])
    expect(cum.at(-1)).toBe(mins.length)
    expect(cumulativeByMarks([], MARKS).at(-1)).toBe(0)
  })
})

describe('节点身份键', () => {
  it('同一时刻并存的多种节点互不撞键（索引当键会复用错位）', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('600000', '100000', 1, '电力'), mk('600001', '100000', 1, '电力')],
      events: [{ time: '10:00', event: '情绪转暖', severity: 'high', topic: '情绪' }],
      pushes: [
        {
          name: '光通信',
          type: 'sector',
          first_pushed: '10:00',
          last_pushed: '10:00',
          push_count: 1,
          context: '',
          last_catalyst: '',
        },
      ],
    })
    // 同一分钟里：板块块 + 事件 + 推送 三种节点并存
    const sameMin = nodes.filter((n) => n.at === 600)
    expect(sameMin).toHaveLength(3)
    const keys = nodes.map(timelineNodeKey)
    expect(new Set(keys).size, '存在重复身份键 —— 内容变了 React 会复用错的 DOM').toBe(keys.length)
  })

  it('键取内容而非位置：同一天的节点顺序变化不改变键', () => {
    const a = buildTimeline({
      stocks: [mk('600000', '100000', 1, '电力'), mk('600001', '110000', 1, '黄酒')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const b = buildTimeline({
      stocks: [mk('600001', '110000', 1, '黄酒'), mk('600000', '100000', 1, '电力')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    expect(a.nodes.map(timelineNodeKey).sort()).toEqual(b.nodes.map(timelineNodeKey).sort())
  })
})

describe('展示投影 buildTimelineSlots —— 纠正「未来记录提前」', () => {
  function mkLong(code: string, fbt: string, sector: string, name: string): ZtPoolStock {
    return { ...mk(code, fbt, 1, sector), name }
  }

  /** 槽内股票总数（行业票 + 单票） */
  function countSlotStocks(slots: ReturnType<typeof buildTimelineSlots>): number {
    return slots.reduce((n, s) => n + s.sectors.reduce((a, g) => a + g.count, 0) + s.singles.length, 0)
  }

  it('同刻多个行业：同一分钟的不同行业各成一组，每组当刻只算本分钟封板数', () => {
    const { nodes } = buildTimeline({
      stocks: [
        mk('a', '100000', 1, '电力'),
        mk('b', '100000', 1, '电力'),
        mk('c', '100000', 1, '半导体'),
        mk('d', '100000', 1, '半导体'),
      ],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const slots = buildTimelineSlots(nodes)
    // 同一分钟（10:00）只产生一个槽
    expect(slots).toHaveLength(1)
    const slot = slots[0]
    // 两个行业各成一组（同刻相同行业合并为一组）
    expect(slot.sectors.map((g) => g.sector).sort()).toEqual(['半导体', '电力'])
    for (const g of slot.sectors) expect(g.count).toBe(2) // 当刻 2 只，不是全天别的数字
  })

  it('同股不同刻：同一代码出现在不同分钟 → 分到不同槽、键不同、两条都保留（不被按代码去重吞掉）', () => {
    const { nodes } = buildTimeline({
      stocks: [
        mkLong('000001', '100000', '电力', '早封'),
        mkLong('000001', '110000', '黄酒', '晚封'), // 同代码、不同分钟、不同行业
      ],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const slots = buildTimelineSlots(nodes)
    expect(slots).toHaveLength(2) // 两个单票，分到两个不同槽
    expect(slots[0].at).toBe(600)
    expect(slots[1].at).toBe(660)
    const codes = slots.flatMap((s) => s.singles.map((x) => x.code))
    expect(codes).toEqual(['000001', '000001']) // 两条都保留
    expect(slots[0].key).not.toBe(slots[1].key) // 键含时间，不撞
  })

  it('同板块跨刻：全天一个行业（spread）被重投到多个分钟槽，每槽当刻仅 1 只，但全天汇总信息保留且不冒充当刻爆发', () => {
    const { nodes } = buildTimeline({
      stocks: [
        mk('a', '093000', 1, '电力'), // 09:30
        mk('b', '100000', 1, '电力'), // 10:00
        mk('c', '110000', 1, '电力'), // 11:00
      ],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    // 3 只同板块 → 一个 SectorNode，跨度 90 分 > 30 → spread
    const sn = nodes.find((n) => n.kind === 'sector') as { shape: string }
    expect(sn.shape).toBe('spread')
    const slots = buildTimelineSlots(nodes)
    // 重投成 3 个槽（而不是一条 09:30 记录把后两只提前）
    expect(slots.map((s) => s.at)).toEqual([570, 600, 660])
    for (const s of slots) {
      expect(s.sectors).toHaveLength(1)
      expect(s.sectors[0].sector).toBe('电力')
      expect(s.sectors[0].count).toBe(1) // 当刻 1 只
      expect(s.sectors[0].dayTotal).toBe(3) // 全天汇总保留
      expect(s.sectors[0].dayShape).toBe('spread') // 跨时形态仅作小注
    }
  })

  it('长名不丢：超长股票名原样透传，投影层不截断', () => {
    const long = '这是一只名字长得离谱的股票用来验证投影层不截断超长文本'
    const { nodes } = buildTimeline({
      stocks: [mkLong('a', '100000', '行业', long)],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const slots = buildTimelineSlots(nodes)
    const found = [
      ...slots[0].sectors.flatMap((g) => g.stocks),
      ...slots[0].singles,
    ].find((s) => s.code === 'a')
    expect(found?.name).toBe(long)
  })

  it('多量守恒：50 只同板块分散到不同分钟，重投后票数一条不少', () => {
    const stocks: ZtPoolStock[] = []
    for (let i = 0; i < 50; i += 1) {
      const m = 570 + i * 3 // 09:30 起每 3 分钟一只，互不重叠
      const hh = Math.floor(m / 60)
      const mm = m % 60
      const fbt = `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00`
      stocks.push(mk(String(i).padStart(6, '0'), fbt, 1, '电力'))
    }
    const { nodes } = buildTimeline({ stocks, events: NO_EVENTS, pushes: NO_PUSHES })
    const slots = buildTimelineSlots(nodes)
    // 不丢不重：槽内票数 === 输入有 fbt 的票数
    expect(countSlotStocks(slots)).toBe(50)
    // 50 个不同分钟 → 50 个槽
    expect(slots).toHaveLength(50)
  })

  it('不变量：守恒 / 顺序 / 唯一键（混合同板块+单票+事件+推送）', () => {
    const { nodes } = buildTimeline({
      stocks: [
        mk('a', '100000', 1, '电力'),
        mk('b', '100000', 1, '电力'),
        mk('c', '100500', 1, '半导体'),
        mk('d', '103000', 1, '黄酒'),
        mk('e', '110000', 1, '电力'),
      ],
      events: [
        { time: '10:00', event: '情绪转暖', severity: 'high', topic: '情绪' },
        { time: '11:00', event: '尾盘回落', severity: 'mid', topic: '情绪' },
      ],
      pushes: [
        {
          name: '光通信',
          type: 'sector',
          first_pushed: '10:00',
          last_pushed: '10:00',
          push_count: 1,
          context: '',
          last_catalyst: '',
        },
      ],
    })
    const inputCount = nodes.reduce(
      (n, x) => n + (x.kind === 'sector' ? x.stocks.length : x.kind === 'single' ? 1 : 0),
      0,
    )
    const slots = buildTimelineSlots(nodes)

    // ① 守恒
    expect(countSlotStocks(slots)).toBe(inputCount)
    // ② 顺序：槽按 at 升序
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].at).toBeGreaterThanOrEqual(slots[i - 1].at)
    }
    // ③ 唯一键：每分钟至多一个槽
    const keys = slots.map((s) => s.key)
    expect(new Set(keys).size, '槽键重复 —— 同分钟多节点会复用错的 DOM').toBe(keys.length)
    // 事件与推送按时刻落入对应槽（不丢）
    const evCount = slots.reduce((n, s) => n + (s.events?.length ?? 0), 0)
    const puCount = slots.reduce((n, s) => n + (s.pushes?.length ?? 0), 0)
    expect(evCount).toBe(2)
    expect(puCount).toBe(1)
  })

  it('单票仅同分钟合并，绝不跨分钟（两条不同分钟的单票不并成一条）', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('a', '100000', 1, '黄酒'), mk('b', '110000', 1, '半导体')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const slots = buildTimelineSlots(nodes)
    expect(slots).toHaveLength(2)
    expect(slots[0].singles).toHaveLength(1)
    expect(slots[1].singles).toHaveLength(1)
  })
})
