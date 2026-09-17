import { describe, expect, it } from 'vitest'
import { slotThemeMarks } from '@/features/analytics'
import type { MarketMemory } from '@/shared/api'

/**
 * 「时间节点上的题材爆发/衰竭」回归锁（2026-09-17 用户核心诉求）。
 *
 * 解析错了**不报错**：只是把「重挫」当成「崛起」、或让某条题材凭空消失 —— 典型静默错值。
 */

function ev(text: string, time = '10:00', topic?: string): MarketMemory['event_log'][number] {
  return { time, event: text, severity: '高', topic } as unknown as MarketMemory['event_log'][number]
}

function push(name: string, n = 1): MarketMemory['pushed_topics'][number] {
  return {
    name,
    push_count: n,
    context: '',
    first_pushed: '10:00',
    last_pushed: '10:00',
  } as unknown as MarketMemory['pushed_topics'][number]
}

describe('slotThemeMarks · 每刻题材爆发/衰竭', () => {
  it('新主线崛起 → 爆发（题材+家数+龙头）', () => {
    const m = slotThemeMarks([ev('新主线崛起：光通信 涨停7只，龙头 华脉科技', '10:00', '光通信')], null)
    expect(m.burst).toHaveLength(1)
    expect(m.burst[0]).toEqual({ theme: '光通信', count: 7, leader: '华脉科技' })
    expect(m.fade).toEqual([])
    expect(m.switched).toEqual([])
  })

  it('板块集体重挫 → 衰竭（逐个板块）', () => {
    const m = slotThemeMarks(
      [ev('关注板块集体重挫：通信线缆及配套、印制电路板', '11:00', '风险')],
      null,
    )
    expect(m.burst).toEqual([])
    expect(m.fade.map((f) => f.label)).toEqual(['通信线缆及配套', '印制电路板'])
    expect(m.switched).toEqual([])
  })

  it('⛔ 龙头切换 ≠ 衰竭：单列「龙头易主」（中性）', () => {
    const m = slotThemeMarks(
      [ev('福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力', '10:57', '福建自贸/海西概念')],
      null,
    )
    expect(m.fade).toEqual([])   // ⛔ 不得污染衰竭
    expect(m.burst).toEqual([])
    expect(m.switched).toEqual([
      { theme: '福建自贸/海西概念', from: '漳州发展', to: '闽东电力' },
    ])
  })

  it('推送台账 → 推送题材（活跃证据·不带方向）', () => {
    const m = slotThemeMarks(null, [push('光通信', 3), push('锂电')])
    expect(m.pushed).toEqual([
      { name: '光通信', pushCount: 3 },
      { name: '锂电', pushCount: 1 },
    ])
    expect(m.burst).toEqual([])
    expect(m.fade).toEqual([])
  })

  it('情绪/广度类事件不进题材层', () => {
    const m = slotThemeMarks(
      [
        ev('市场情绪由「冰点」转为「修复」', '10:57', '情绪'),
        ev('涨停广度骤变 20 → 45', '10:57', '广度'),
      ],
      null,
    )
    expect(m).toEqual({ burst: [], switched: [], fade: [], pushed: [] })
  })

  it('守恒：每条题材事件恰好出现一次（不丢不重）', () => {
    const events = [
      ev('新主线崛起：光通信 涨停7只，龙头 华脉科技', '10:00', '光通信'),
      ev('PCB板 龙头切换：A → B', '10:30', 'PCB板'),
      ev('关注板块集体重挫：化学制品、橡胶', '11:00', '风险'),
      ev('市场情绪由「修复」转为「亢奋」', '10:57', '情绪'),
    ]
    const m = slotThemeMarks(events, null)
    // rise=1 → burst 1；plunge 拆 2 板块 → fade 2；switch 1 → switched 1
    expect(m.burst).toHaveLength(1)
    expect(m.fade).toHaveLength(2)
    expect(m.switched).toHaveLength(1)
  })

  it('空/缺省输入安全', () => {
    expect(slotThemeMarks(null, null)).toEqual({ burst: [], switched: [], fade: [], pushed: [] })
    expect(slotThemeMarks([], [])).toEqual({ burst: [], switched: [], fade: [], pushed: [] })
    // 无有效的板块名（只有顿号）→ 不产出空标签
    const m = slotThemeMarks([ev('关注板块集体重挫：、', '11:00', '风险')], null)
    expect(m.fade).toEqual([])
  })
})
