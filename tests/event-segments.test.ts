import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  buildTimelineSlots,
  emotionState,
  eventTier,
  severityNote,
  splitEventText,
} from '@/features/analytics'

/**
 * `splitEventText` / `severityNote` 的回归锁（用户 2026-09-17）。
 *
 * 背景：卡片里「系统观测」是饱和青绿 + 加粗的来源标注，且出现在**每一张**有事件的卡上；
 * 事件原文整条渲染成灰字 → 题材名与个股名被埋掉，整屏读起来「全部处于系统观测状态」。
 * 修法是**标注退灰 + 正文分段高亮**，而分段一旦吞字就是**静默丢数据**，故此处钉死。
 *
 * ⛔ 本文件的第一优先级是 **无损**：`join('') === 原文`，一条都不能少、不能多。
 */
describe('splitEventText · 无损性（最高优先级）', () => {
  /** 覆盖全部真实形态 + 边角（2026-09-16/17 归档原文取样） */
  const REAL = [
    '新主线崛起：光通信 涨停7只，龙头 华脉科技',
    '新主线崛起：福建自贸/海西概念 涨停3只，龙头 漳州发展',
    '国产芯片 龙头切换：中晶科技 → 西陇科学',
    '福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力',
    '关注板块集体重挫：通信线缆及配套、印制电路板',
    '市场情绪由「分歧」转为「亢奋」',
    '市场情绪由「亢奋」转为「分歧」',
    '涨停广度骤变 89 → 0',
    '光通信 龙头切换：华脉科技>华脉科技',
    '没有冒号的普通一句话',
    '带 数字 与 空格 的 文本 12.5%',
    '「单独一个引号状态」',
    '',
  ]

  it('★ 任意原文：分段拼接后与原文**逐字符相等**（不吞字、不重复）', () => {
    for (const t of REAL) {
      const segs = splitEventText(t)
      expect(segs.map((s) => s.text).join(''), `原文被改动：${t}`).toBe(t)
    }
  })

  it('★ 分段不重叠、不空段（位移严格递增）', () => {
    for (const t of REAL) {
      let at = 0
      for (const s of splitEventText(t)) {
        expect(s.text.length).toBeGreaterThan(0)
        at += s.text.length
      }
      expect(at).toBe(t.length)
    }
  })

  it('空 / null / undefined → 空数组（不抛错）', () => {
    expect(splitEventText('')).toEqual([])
    expect(splitEventText(null)).toEqual([])
    expect(splitEventText(undefined)).toEqual([])
  })

  it('无任何可高亮内容的文本 → 退化为单段 plain（⛔ 不硬造高亮）', () => {
    expect(splitEventText('没有冒号的普通一句话')).toEqual([
      { text: '没有冒号的普通一句话', kind: 'plain' },
    ])
  })
})

describe('splitEventText · 分级正确', () => {
  const kinds = (t: string, kind: string) =>
    splitEventText(t)
      .filter((s) => s.kind === kind)
      .map((s) => s.text)

  it('「新主线崛起」→ 题材(theme) / 家数(value) / 龙头(stock) 各归其位', () => {
    const t = '新主线崛起：光通信 涨停7只，龙头 华脉科技'
    expect(kinds(t, 'theme')).toEqual(['光通信'])
    expect(kinds(t, 'value')).toEqual(['7'])
    expect(kinds(t, 'stock')).toEqual(['华脉科技'])
    // 连接词退灰
    expect(kinds(t, 'plain').join('')).toBe('新主线崛起： 涨停只，龙头 ')
  })

  it('「龙头切换」→ 题材 + **两个个股名都算个股**（旧/新）', () => {
    const t = '国产芯片 龙头切换：中晶科技 → 西陇科学'
    expect(kinds(t, 'theme')).toEqual(['国产芯片'])
    expect(kinds(t, 'stock')).toEqual(['中晶科技', '西陇科学'])
  })

  it('题材名与个股名相同时（同名/包含关系）→ 各就各位，不串位', () => {
    // 「西陇科学」既是题材尾字又是个股：必须定位到各自首次出现的正确位置
    const t = '西陇科学 龙头切换：中晶科技 → 西陇科学'
    const segs = splitEventText(t)
    expect(segs.map((s) => s.text).join('')).toBe(t)
    expect(kinds(t, 'theme')).toEqual(['西陇科学'])
    expect(kinds(t, 'stock')).toEqual(['中晶科技', '西陇科学'])
  })

  it('「集体重挫」→ 逐个板块名标跌色(down)，顿号分隔', () => {
    const t = '关注板块集体重挫：通信线缆及配套、印制电路板'
    expect(kinds(t, 'down')).toEqual(['通信线缆及配套', '印制电路板'])
    expect(kinds(t, 'theme')).toEqual([])
  })

  it('兜底：`「」`内的状态词 → value（情绪转变）', () => {
    const t = '市场情绪由「分歧」转为「亢奋」'
    expect(kinds(t, 'value')).toEqual(['分歧', '亢奋'])
    expect(kinds(t, 'plain').join('')).toBe('市场情绪由「」转为「」')
  })

  it('兜底：数字 → value（广度骤变）', () => {
    const t = '涨停广度骤变 89 → 0'
    expect(kinds(t, 'value')).toEqual(['89', '0'])
  })
})

/**
 * `severityNote` —— 只标例外。
 *
 * ⛔ 实测 severity 分布：2026-09-16 = **18 high / 1 mid**，2026-09-17 = **33 high / 1 mid**。
 * 逐行挂一个英文 `high` 徽标 = 零信息量噪声，故**最高档一律不显示**（缺省即最高档）。
 */
describe('severityNote · 只标例外', () => {
  it('最高档 / 空 → 不显示（返回 null）', () => {
    expect(severityNote('high')).toBeNull()
    expect(severityNote('高')).toBeNull()
    expect(severityNote('严重')).toBeNull()
    expect(severityNote('')).toBeNull()
    expect(severityNote(null)).toBeNull()
    expect(severityNote(undefined)).toBeNull()
    expect(severityNote('  ')).toBeNull()
  })

  it('非最高档 → 映射为中文档位（⛔ 不出英文内部枚举）', () => {
    expect(severityNote('mid')).toBe('中')
    expect(severityNote('low')).toBe('低')
    expect(severityNote(' mid ')).toBe('中')
  })

  it('未知档位 → 原样兜底（⛔ 不吞、不猜）', () => {
    expect(severityNote('urgent')).toBe('urgent')
  })
})

/**
 * 展示闸门（`eventTier` / `buildTimelineSlots` 的 `foldNoise`）。
 *
 * 实测依据（5 个交易日 109 条）：真信号仅 **13.8%**，噪声 86%
 * （龙头切换 51.4% / 情绪回摆 31.2% / 广度归零 3.7%）。
 * ⛔ 闸门一旦判错，**页面照常工作、不报任何错** —— 要么噪声又铺满、要么真信号被藏，
 * 属典型静默错值，必须钉住。
 */
describe('展示闸门 · eventTier（真信号 vs 机器噪声）', () => {
  const ev = (event: string, topic: string | null = null) => ({ event, topic })

  it('题材类三种形态 → noise（均已在卡顶题材区表达，此处是重复）', () => {
    expect(eventTier(ev('新主线崛起：光通信 涨停7只，龙头 华脉科技', '光通信'))).toBe('noise')
    expect(eventTier(ev('国产芯片 龙头切换：中晶科技 → 西陇科学', '国产芯片'))).toBe('noise')
    expect(eventTier(ev('关注板块集体重挫：通信线缆及配套、印制电路板', '通信线缆及配套'))).toBe('noise')
  })

  it('情绪类：转入状态**本日首次出现** → signal；已出现过 → noise（回摆）', () => {
    const e = ev('市场情绪由「分歧」转为「修复」', '情绪')
    expect(eventTier(e, new Set())).toBe('signal') // 首次
    expect(eventTier(e, new Set(['修复']))).toBe('noise') // 回摆
    // ⛔ 只看「转入后」的状态：转入「分歧」是新的，即便「分歧」曾在**转出位**出现
    expect(eventTier(ev('市场情绪由「修复」转为「分歧」', '情绪'), new Set(['修复']))).toBe('signal')
  })

  it('情绪类形态不符（无「…转为…」）→ 保守展示 signal（⛔ 不因看不懂而藏）', () => {
    expect(eventTier(ev('情绪转暖', '情绪'))).toBe('signal')
  })

  it('广度类：归零 = 计数器重置 → noise；真实变化 → signal', () => {
    expect(eventTier(ev('涨停广度骤变 89 → 0', '广度'))).toBe('noise')
    expect(eventTier(ev('涨停广度骤变 32 → 50', '广度'))).toBe('signal')
  })

  it('⛔ 未识别形态 / 缺失 topic → 保守展示 signal', () => {
    expect(eventTier(ev('某种将来才会出现的新事件'))).toBe('signal')
    expect(eventTier(ev('', null))).toBe('signal')
  })

  it('emotionState 只取转入后的状态；形态不符 → null', () => {
    expect(emotionState('市场情绪由「3.9」转为「退潮」')).toBe('退潮')
    expect(emotionState('市场情绪由「亢奋」转为「分歧」')).toBe('分歧')
    expect(emotionState('情绪转暖')).toBeNull()
    expect(emotionState(null)).toBeNull()
  })
})

describe('展示闸门 · buildTimelineSlots 的折叠标注', () => {
  const EV = (time: string, event: string, topic: string, severity = 'high') =>
    ({ time, event, topic, severity }) as never

  /**
   * 造一份含「跨分钟情绪回摆」的事件流（⛔ 单卡内去重是无效的，必须跨槽累积）。
   *
   * ⚠️ 2026-11-09 对齐：首两条原为 **09:19**，而时间轴时段起点是
   *    `SESSION_OPEN = 09:25`（`snake.ts`，竞价结束才算开盘），`inTimelineSession` 会把
   *    早于它的事件整条丢掉 —— 于是 `events` 只剩 4 条、`foldedIdx` 全 undefined，
   *    三条断言一起红。这是**测试数据越界**，不是折叠功能坏了（`foldNoise:false` 那条一直绿）。
   *    这里把整条情绪链平移到时段内，**保持原有先后顺序**（分歧→修复→分歧 的回摆语义不变）。
   */
  const RAW = [
    EV('09:25', '市场情绪由「亢奋」转为「分歧」', '情绪'), // 分歧 首次 → signal
    EV('09:25', '涨停广度骤变 89 → 0', '广度'), // 归零 → noise（与上一条同分钟）
    EV('09:31', '市场情绪由「分歧」转为「修复」', '情绪'), // 修复 首次 → signal
    EV('09:38', '市场情绪由「修复」转为「分歧」', '情绪'), // 回摆 → noise
    EV('09:47', '新主线崛起：玻璃基板封装 涨停3只，龙头 三峡新材', '玻璃基板封装'), // 题材 → noise
    EV('10:02', '市场情绪由「1/10·退潮」转为「修复」', '情绪'), // 回摆 → noise
  ]

  const build = (foldNoise?: boolean) => {
    const { nodes } = buildTimeline({ stocks: [], events: RAW, pushes: [] })
    return buildTimelineSlots(nodes, [], foldNoise === undefined ? {} : { foldNoise })
  }

  it('★ 跨槽按时间累积：同一状态第二次出现即折叠（⛔ 卡内去重做不到这件事）', () => {
    const slots = build()
    const at = (m: number) => slots.find((s) => s.at === m)
    // 09:25：「分歧」是首次出现 → **保留**；广度归零 → 折叠（只有第 2 条）
    expect(at(9 * 60 + 25)?.foldedIdx).toEqual([1])
    expect(at(9 * 60 + 25)?.events).toHaveLength(2) // ⛔ 保留的那条不被删除
    expect(at(9 * 60 + 31)?.foldedIdx, '修复首次 → 不折叠').toBeUndefined()
    expect(at(9 * 60 + 38)?.foldedIdx, '分歧回摆 → 折叠').toEqual([0])
    expect(at(9 * 60 + 47)?.foldedIdx, '题材类 → 折叠').toEqual([0])
    expect(at(10 * 60 + 2)?.foldedIdx, '修复回摆 → 折叠').toEqual([0])
  })

  it('★ 折叠 ≠ 删除：`events` 数组一条不改（下标只作标注）', () => {
    const slots = build()
    expect(slots.flatMap((s) => s.events ?? [])).toHaveLength(RAW.length)
    // 被折叠的那些仍在数组里
    const s0925 = slots.find((s) => s.at === 9 * 60 + 25)!
    expect(s0925.events).toHaveLength(2)
  })

  it('★ 全局守恒：signal 数 + 折叠数 === 总条数（不丢不重）', () => {
    const slots = build()
    const folded = slots.reduce((n, s) => n + (s.foldedIdx?.length ?? 0), 0)
    const total = slots.reduce((n, s) => n + (s.events?.length ?? 0), 0)
    expect(folded).toBe(4) // 广度归零 + 分歧回摆 + 题材首爆 + 修复回摆
    expect(total - folded).toBe(2) // 情绪「分歧」「修复」各一次
  })

  it('⛔ 开关可回退：`foldNoise: false` → 一条都不折叠（回到逐条全列）', () => {
    for (const s of build(false)) expect(s.foldedIdx).toBeUndefined()
  })

  it('无事件的槽不产生空的 `foldedIdx`（⛔ 不留噪声字段）', () => {
    const { nodes } = buildTimeline({ stocks: [], events: [], pushes: [] })
    for (const s of buildTimelineSlots(nodes)) expect(s.foldedIdx).toBeUndefined()
  })
})
