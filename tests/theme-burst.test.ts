import { describe, expect, it } from 'vitest'
import {
  buildThemeBursts,
  firstBurstByKey,
  normName,
  normTheme,
  parseThemeEvents,
  sameTheme,
} from '@/features/analytics'
import type { MarketMemory } from '@/shared/api'

/**
 * 题材级爆发内核的回归锁。
 *
 * ## 为什么非写不可
 *
 * 解析错了**不报错、不告警**：
 *   · 把「重挫」当成「崛起」→ 风险被当成机会展示（方向性错误）
 *   · 龙头取成第一个而不是最后一个 → 反复易主的题材会指向**上一任**龙头
 *   · 题材名从文案里正则抠 → 文案一改就静默读空
 * 三者都是静默错值，只有不变量测试能拦住。
 *
 * 核心不变量：**每条题材事件恰好归入一处**（题材层 or 风险层），一条不多一条不少。
 */

type Ev = MarketMemory['event_log'][number]

function ev(time: string, event: string, topic: string, severity = 'high'): Ev {
  return { time, event, topic, severity }
}

/** 实测自真实数据的五种形态各一条 */
const RISE = ev('10:57', '新主线崛起：光通信 涨停7只，龙头 华脉科技', '光通信')
const SWITCH = ev('10:57', '福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力', '福建自贸/海西概念')
const PLUNGE = ev('10:57', '关注板块集体重挫：通信线缆及配套、印制电路板', '风险')
const SENTIMENT = ev('10:57', '市场情绪由「分歧」转为「亢奋」', '情绪')
const BREADTH = ev('10:57', '涨停广度骤变 32 → 50', '广度')

const NO_PUSHES: never[] = []
const NO_SPOTS: never[] = []
const NO_STOCKS: never[] = []

describe('题材名归一与同题材判定', () => {
  it('去掉「概念/板块/板」后缀并忽略空白，跨源写法能对齐', () => {
    expect(normTheme('福建自贸/海西概念')).toBe('福建自贸/海西')
    expect(normTheme('PCB板')).toBe('PCB')
    expect(normTheme(' 光通信 ')).toBe('光通信')
  })

  it('归一为空串时**绝不参与匹配** —— 否则会匹配上一切', () => {
    expect(sameTheme('板', '光通信')).toBe(false)
    expect(sameTheme('概念', '光通信')).toBe(false)
    expect(sameTheme('', '光通信')).toBe(false)
  })

  it('同一题材的跨源写法判定为同一题材；不同题材不误判', () => {
    expect(sameTheme('福建自贸/海西概念', '福建自贸/海西')).toBe(true)
    expect(sameTheme('PCB板', 'PCB板')).toBe(true)
    expect(sameTheme('光通信', '国产芯片')).toBe(false)
  })

  it('名称归一去掉内部空格（实测存在 `南 京 港` 这类写法）', () => {
    expect(normName('南 京 港')).toBe('南京港')
    expect(normName('华脉科技')).toBe('华脉科技')
  })
})

describe('解析 —— 事件形态分流', () => {
  it('「新主线崛起」解析出 题材 / 家数 / 龙头', () => {
    const [e] = parseThemeEvents([RISE])
    expect(e).toMatchObject({ kind: 'rise', theme: '光通信', count: 7, leader: '华脉科技', at: 657 })
  })

  it('「龙头切换」解析出 旧龙头 → 新龙头', () => {
    const [e] = parseThemeEvents([SWITCH])
    expect(e).toMatchObject({
      kind: 'switch',
      theme: '福建自贸/海西概念',
      from: '漳州发展',
      leader: '闽东电力',
    })
  })

  it('「板块集体重挫」归入 plunge 并带出板块列表原文（**不得当成题材崛起**）', () => {
    const [e] = parseThemeEvents([PLUNGE])
    expect(e.kind).toBe('plunge')
    expect(e.detail).toBe('通信线缆及配套、印制电路板')
  })

  it('情绪 / 广度事件**不进题材层** —— 它们不属于题材', () => {
    expect(parseThemeEvents([SENTIMENT, BREADTH])).toEqual([])
  })

  it('题材名取 `topic` 字段而非从文案正则抠 —— 文案改了也不会静默读空', () => {
    // 文案被改成完全不含题材名的写法，topic 仍然给出题材
    const weird = ev('11:00', '新主线崛起：某题材 涨停3只，龙头 某某', '光通信')
    const [e] = parseThemeEvents([weird])
    expect(e.theme, '题材名必须来自 topic 字段').toBe('光通信')
  })

  it('无时间坐标的事件被丢弃，不产生 at 为空的记录', () => {
    expect(parseThemeEvents([ev('', '新主线崛起：光通信 涨停7只，龙头 华脉科技', '光通信')])).toEqual(
      [],
    )
  })

  it('空输入与未识别的文案不崩、不产出', () => {
    expect(parseThemeEvents([])).toEqual([])
    expect(parseThemeEvents([ev('10:00', '一句没见过的系统文案', '未知')])).toEqual([])
  })
})

describe('题材爆发归纳 —— 守恒不变量', () => {
  const all: Ev[] = [RISE, SWITCH, PLUNGE, SENTIMENT, BREADTH]

  it('每条题材事件恰好归入一处：题材层 + 风险层 === rise|switch|plunge 总数', () => {
    const parsed = parseThemeEvents(all)
    const expected = parsed.filter((e) => e.kind !== 'plunge').length
    const r = buildThemeBursts({
      events: all,
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.themedCount).toBe(expected)
    expect(r.riskCount).toBe(parsed.length - expected)
    expect(r.themedCount + r.riskCount, '有事件凭空消失或被重复归类').toBe(parsed.length)
  })

  it('情绪与广度事件既不进题材榜也不进风险榜', () => {
    const r = buildThemeBursts({
      events: [SENTIMENT, BREADTH, RISE],
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.themes.map((t) => t.theme)).toEqual(['光通信'])
    expect(r.risks).toEqual([])
  })
})

describe('龙头判定 —— 反复易主时必须取「最后一次」的落点', () => {
  const themes = ['福建自贸/海西概念']
  const events: Ev[] = [
    ev('10:57', '新主线崛起：福建自贸/海西概念 涨停3只，龙头 漳州发展', themes[0]),
    ev('11:02', '福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力', themes[0]),
    ev('13:00', '福建自贸/海西概念 龙头切换：闽东电力 → 福建金森', themes[0]),
    ev('13:01', '福建自贸/海西概念 龙头切换：福建金森 → 闽东电力', themes[0]),
  ]

  it('当前龙头 = 最后一条事件的落点，不是第一个 leader', () => {
    const r = buildThemeBursts({
      events,
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    const t = r.themes[0]
    expect(t.currentLeader, '取成了第一个 leader（上一任龙头）').toBe('闽东电力')
    expect(t.isNewMainline).toBe(true)
    expect(t.riseCount).toBe(3)
  })

  it('龙头链按首次出现顺序去重，当前龙头必在链上', () => {
    const r = buildThemeBursts({
      events,
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    const t = r.themes[0]
    expect(t.leaders).toEqual(['漳州发展', '闽东电力', '福建金森'])
    expect(t.leaders).toContain(t.currentLeader)
  })

  it('event_log 顺序被打乱时仍按时间取最新 —— 顺序不可信', () => {
    const shuffled = [events[3], events[0], events[2], events[1]]
    const r = buildThemeBursts({
      events: shuffled,
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.themes[0].currentLeader).toBe('闽东电力')
  })

  it('只有 rise 没有 switch 时，龙头即 rise 的龙头', () => {
    const r = buildThemeBursts({
      events: [RISE],
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.themes[0].currentLeader).toBe('华脉科技')
  })

  it('⛔ 「龙头切换」不再计入任何展示字段（概念已废弃）', () => {
    const r = buildThemeBursts({
      events,
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    // ⛔ 类型层已删除 `switchCount`（编译期即挡住回加）
    expect('switchCount' in r.themes[0]).toBe(false)
  })
})

describe('个股题材标记', () => {
  const stocks = [
    { code: '603042', name: '华脉科技' },
    { code: '000993', name: '闽东电力' },
    { code: '002679', name: '福建金森' },
  ]
  const hotSpots = [
    {
      sector: '福建自贸/海西概念',
      stocks: [
        { code: '002679', name: '福建金森' },
        { code: '000993', name: '闽东电力' },
      ],
    },
  ]

  it('成员股得到题材标签，当前龙头额外标记 leaderOf', () => {
    const r = buildThemeBursts({
      events: [
        ev('10:57', '新主线崛起：福建自贸/海西概念 涨停3只，龙头 漳州发展', '福建自贸/海西概念'),
        ev('11:02', '福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力', '福建自贸/海西概念'),
      ],
      pushes: NO_PUSHES,
      hotSpots,
      stocks,
    })
    expect(r.tags.get('002679')?.themes).toEqual(['福建自贸/海西概念'])
    expect(r.tags.get('000993')?.leaderOf).toEqual(['福建自贸/海西概念'])
    // 已不是龙头的历史龙头不得被标龙头
    expect(r.tags.get('002679')?.leaderOf ?? []).toEqual([])
  })

  it('龙头名不在当日涨停池时不产出标记，也不崩', () => {
    const r = buildThemeBursts({
      events: [RISE],
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks,
    })
    expect(r.tags.get('603042')?.leaderOf).toEqual(['光通信'])
    expect(r.tags.size).toBe(1)
  })

  it('带空格的龙头名也能匹配上（`南 京 港` 形态）', () => {
    const r = buildThemeBursts({
      events: [ev('10:00', '航运 龙头切换：甲 → 南 京 港', '航运')],
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: [{ code: '601018', name: '南京港' }],
    })
    expect(r.tags.get('601018')?.leaderOf).toEqual(['航运'])
  })

  it('题材成员表里的票不在当日涨停池时被剔除（不得凭题材表虚增涨停）', () => {
    const r = buildThemeBursts({
      events: [ev('10:00', '新主线崛起：光通信 涨停7只，龙头 华脉科技', '光通信')],
      pushes: NO_PUSHES,
      hotSpots: [{ sector: '光通信', stocks: [{ code: '999999', name: '不在池里' }] }],
      stocks,
    })
    expect(r.themes[0].members).toEqual([])
  })
})

describe('催化与排序', () => {
  const pushes: MarketMemory['pushed_topics'] = [
    {
      name: '福建自贸/海西',
      type: 'sector',
      first_pushed: '11:14',
      last_pushed: '14:13',
      push_count: 3,
      context: '《美丽中国先行区建设实施方案》印发',
      last_catalyst: '',
    },
  ]

  it('催化按「同题材」匹配（跨源写法不同也能配上）', () => {
    const r = buildThemeBursts({
      events: [SWITCH],
      pushes,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.themes[0].catalyst).toBe('《美丽中国先行区建设实施方案》印发')
    expect(r.themes[0].pushCount).toBe(3)
  })

  it('「新主线崛起」排在只有易主的题材之前', () => {
    const r = buildThemeBursts({
      events: [SWITCH, RISE],
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.themes[0].theme).toBe('光通信')
    expect(r.themes[0].isNewMainline).toBe(true)
    expect(r.themes[1].isNewMainline).toBe(false)
  })
})

describe('风险层', () => {
  it('同一条事件里的多个板块拆开，且按板块去重计数', () => {
    const r = buildThemeBursts({
      events: [
        ev('11:00', '关注板块集体重挫：通信线缆及配套、印制电路板', '风险'),
        ev('11:30', '关注板块集体重挫：印制电路板、CPO概念', '风险'),
      ],
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.risks).toHaveLength(2)
    expect(r.risks[0].sectors).toEqual(['通信线缆及配套', '印制电路板'])
    // 重挫**不得**混进题材榜
    expect(r.themes).toEqual([])
  })
})

/**
 * 「初次爆发」与「反复」的时刻序列（用户 2026-09-17：
 * 「题材的初次爆发，和反复加强也要显示在时间轴上呀，你放一个【题材爆发】时间区间没有意义」）。
 *
 * ⛔ 实测依据（4 个交易日）：`rise`（新主线崛起）**每题材每天只出现一次**
 *   （09-16 4 个题材 / 09-15 2 个 / 09-14 1 个，重复 0 次）→ 它就是「初次爆发」；
 *   同题材的后续带时刻记录只有 `switch` 类 → 那才是「反复」。
 *   ⛔ 故**不能用「at~to 区间」**表达：区间看不出几点爆的、后面几点又动过。
 */
describe('题材观测时刻序列（替代无意义的区间）', () => {
  const DAY: Ev[] = [
    ev('10:57', '新主线崛起：福建自贸/海西概念 涨停3只，龙头 漳州发展', '福建自贸/海西概念'),
    ev('11:02', '福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力', '福建自贸/海西概念'),
    ev('13:00', '福建自贸/海西概念 龙头切换：闽东电力 → 福建金森', '福建自贸/海西概念'),
    ev('13:01', '福建自贸/海西概念 龙头切换：福建金森 → 闽东电力', '福建自贸/海西概念'),
  ]

  it('points 按时间升序，且包含该题材当日每一条事件', () => {
    const r = buildThemeBursts({
      events: DAY,
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    const t = r.themes[0]
    expect(t.points).toHaveLength(DAY.length)
    const ats = t.points.map((p) => p.at)
    expect([...ats].sort((a, b) => a - b)).toEqual(ats) // 升序
    expect(t.points.some((p) => p.kind === 'rise')).toBe(true) // 含初次爆发
    expect(t.points.some((p) => p.kind === 'switch')).toBe(true) // 含反复
    // at / to 仍与序列首末一致（向后兼容）
    expect(t.at).toBe(ats[0])
    expect(t.to).toBe(ats[ats.length - 1])
  })

  it('⛔ 只有一条事件的题材：points 长度为 1（没有伪造「反复」）', () => {
    const r = buildThemeBursts({
      events: [RISE],
      pushes: NO_PUSHES,
      hotSpots: NO_SPOTS,
      stocks: NO_STOCKS,
    })
    expect(r.themes[0].points).toHaveLength(1)
    expect(r.themes[0].points[0].kind).toBe('rise')
  })
})

/**
 * 首爆判定（2026-10-18 用户：「低空经济首次爆发变大红，后续继续走强保持红色」）。
 *
 * ⛔ 关键不变式：**同一题材只在第一次出现的块上算首爆**，之后的块即使 `burst` 仍为真，
 *    也只能算续强。这条一旦写错，用户会看到「低空经济一天首爆三次」。
 */
describe('firstBurstByKey · 当日首爆只算第一次', () => {
  it('同题材跨块重复出现 → 只有第一块算首爆', () => {
    const map = firstBurstByKey([
      { key: 'a', burst: [{ theme: '低空经济' }, { theme: '军工' }] },
      { key: 'b', burst: [{ theme: '低空经济' }] },
      { key: 'c', burst: [{ theme: '低空经济' }, { theme: '机器人' }] },
    ])
    expect(map.get('a')).toEqual(['低空经济', '军工'])
    expect(map.has('b')).toBe(false)
    expect(map.get('c')).toEqual(['机器人'])
  })

  it('无爆发的块不产出条目', () => {
    const map = firstBurstByKey([{ key: 'x', burst: [] }])
    expect(map.size).toBe(0)
  })
})
