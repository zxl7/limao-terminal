import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import {
  buildTimeline,
  buildTimelineSlots,
  TimelineSlotCard,
  SLOT_WIDTH,
  SLOT_HEIGHT,
  SLOT_VISIBLE_SECTORS,
  type StockThemeTag,
} from '@/features/analytics'
import type { IntradayTimelineEvent, ZtPoolStock } from '@/shared/api'

/**
 * `TimelineSlotCard` 的**布局与投影**测试 —— 专门锁住「未来记录提前」被纠正后，
 * 卡片在视觉上**不溢出、固定宽、同刻分区、题材紫色**这几条页面级契约。
 *
 * 这些是逻辑测试盖不到的：网格宽度、截断、长名/长原因不撑破卡片，只有在渲染层才看得到。
 */

const NO_EVENTS: never[] = []
const NO_PUSHES: never[] = []

function mk(code: string, fbt: string, sector: string, name = `票${code}`): ZtPoolStock {
  return {
    code,
    name,
    pct: 10,
    price: 10,
    boards: 1,
    fbt,
    zbc: 0,
    hs: 1,
    sector,
    seal: 1,
    cje_yi: 1,
    zsz_yi: 10,
  }
}

describe('TimelineSlotCard 布局契约', () => {
  it('卡片固定宽 440px、内部用固定 CSS grid（名称/标记/行业/原因）且不溢出', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('a', '100000', '电力'), mk('b', '100000', '电力'), mk('c', '100000', '半导体')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const slots = buildTimelineSlots(nodes)
    const { container } = render(
      <TimelineSlotCard slot={slots[0]} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    // ① 固定宽卡
    const card = container.querySelector('section') as HTMLElement
    expect(card.style.width).toBe(`${SLOT_WIDTH}px`)
    // ② 每个个股行都有固定四列 grid（含 84px 行业列），不随内容伸缩
    const rows = container.querySelectorAll('[style*="grid-template-columns"]')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of Array.from(rows)) {
      const el = r as HTMLElement
      expect(el.style.gridTemplateColumns).toContain('84px')
    }
  })

  it('同刻多个行业 → 卡片内出现两个行业分组块（不吞并）', () => {
    const { nodes } = buildTimeline({
      stocks: [
        mk('a', '100000', '电力'),
        mk('b', '100000', '电力'),
        mk('c', '100000', '半导体'),
        mk('d', '100000', '半导体'),
      ],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const slots = buildTimelineSlots(nodes)
    const { container } = render(
      <TimelineSlotCard slot={slots[0]} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    expect(container.textContent).toContain('电力')
    expect(container.textContent).toContain('半导体')
    // 两个「当刻 2 只」分组小计
    expect(container.textContent?.match(/当刻 2 只/g)?.length).toBe(2)
  })

  it('长名 / 长原因不撑破卡片：原因单元格 ellipsis + title，主题保持紫色加粗', () => {
    const LONG_NAME = '这是一只名字长得离谱的票用来验证网格不溢出'
    const LONG_REASON = '炭黑加行业龙头加绿色低碳加对外出口加机器人概念加芯片国产替代这一串很长的原因'
    const { nodes } = buildTimeline({
      stocks: [mk('f', '100000', '黄酒', LONG_NAME)],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const tags = new Map<string, StockThemeTag>([['f', { themes: ['黄酒·大消费'], leaderOf: [] }]])
    const reasonByCode = new Map<string, string>([['f', LONG_REASON]])
    const { container } = render(
      <TimelineSlotCard slot={buildTimelineSlots(nodes)[0]} topBoard={1} tags={tags} reasonByCode={reasonByCode} />,
    )
    // 长名原样出现
    expect(container.textContent).toContain(LONG_NAME)
    // 长原因：带 title（完整原文），且单元格有 truncate 约束（不溢出）
    const reasonEl = container.querySelector('[title^="涨停原因："]') as HTMLElement | null
    expect(reasonEl).not.toBeNull()
    expect(reasonEl?.getAttribute('title')).toContain(LONG_REASON)
    expect(reasonEl?.className).toContain('truncate')
    // 题材保持紫色加粗（text-rec + font-medium）
    const themeEl = Array.from(container.querySelectorAll('span')).find((s) =>
      s.textContent === '黄酒·大消费',
    )
    expect(themeEl?.className).toContain('text-rec')
    expect(themeEl?.className).toContain('font-medium')
  })

  it('事件/推送同刻合并进卡片（⛔ 不带系统口径注解）', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('a', '100000', '电力'), mk('b', '100000', '电力')],
      events: [{ time: '10:00', event: '情绪由分歧转亢奋', severity: 'high', topic: '情绪' }],
      pushes: [
        {
          name: '光通信',
          type: 'sector',
          first_pushed: '10:00',
          last_pushed: '10:00',
          push_count: 3,
          context: '',
          last_catalyst: '',
        },
      ],
    })
    const slots = buildTimelineSlots(nodes)
    const { container } = render(
      <TimelineSlotCard slot={slots[0]} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    expect(container.textContent).toContain('题材推送 1 条')
    // ⛔ 「卡片时刻，非事件时刻」这类系统注解已按用户要求从页面删除
    expect(container.textContent).not.toContain('非事件时刻')
  })

  it('固定列宽：不同标记组合（仅板数 / +20cm / +20cm+炸板）每行 grid 完全一致，标记列不撑宽', () => {
    const base = (code: string, sector: string, extra: Partial<ZtPoolStock>): ZtPoolStock => ({
      ...mk(code, '100000', sector),
      ...extra,
    })
    const stocks: ZtPoolStock[] = [
      base('a', '电力', {}), // 仅板数
      base('b', '半导体', { is_20cm: true }), // + 20cm
      base('c', '黄酒', { is_20cm: true, zbc: 3 }), // + 20cm + 炸板
    ]
    const { nodes } = buildTimeline({ stocks, events: NO_EVENTS, pushes: NO_PUSHES })
    const slots = buildTimelineSlots(nodes)
    // 三个不同行业各 1 只（<2 不成板块集群）→ 全落为单票，同分钟进同一分钟槽
    expect(slots).toHaveLength(1)
    expect(slots[0].singles).toHaveLength(3)
    const { container } = render(
      <TimelineSlotCard slot={slots[0]} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    // 三行个股，每行都是固定四列：名称 100px / 标记 84px / 行业 84px / 原因自适应；标记再多也不把列撑宽
    const rows = container.querySelectorAll('[style*="100px 84px 84px"]')
    expect(rows.length).toBe(3)
    for (const r of Array.from(rows)) {
      const el = r as HTMLElement
      // 固定列：前三列均为固定 px，第四列 minmax(0,1fr)；容忍 jsdom 对 minmax 的序列化（空格/px）
      expect(el.style.gridTemplateColumns).toMatch(/^100px 84px 84px minmax\(0/)
    }
  })

  it('超长题材：chip 截断不撑破卡片（卡宽仍 440px），含题材长链换行', () => {
    const LONG_THEME = '这是一个长到离谱的题材名称用来验证chip截断而不是把整行撑宽导致溢出'
    // 用同行业两票成「行业分组块」，含题材长链才会在 SectorSlotGroup 内渲染
    const { nodes } = buildTimeline({
      stocks: [mk('f', '100000', '黄酒', '黄酒股'), mk('g', '100000', '黄酒', '黄酒股2')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const tags = new Map<string, StockThemeTag>([
      ['f', { themes: [LONG_THEME], leaderOf: [] }],
      ['g', { themes: [LONG_THEME], leaderOf: [] }],
    ])
    const { container } = render(
      <TimelineSlotCard slot={buildTimelineSlots(nodes)[0]} topBoard={1} tags={tags} reasonByCode={new Map()} />,
    )
    // 卡片宽固定 440px，超长题材不撑破
    const card = container.querySelector('section') as HTMLElement
    expect(card.style.width).toBe('440px')
    // 题材 chip：紫色加粗 + truncate + 完整原文在 title（用 bg-rec-soft 精确定位题材 chip，避开「含题材」内层 span）
    const chip = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent === LONG_THEME && s.className.includes('bg-rec-soft'),
    )
    expect(chip).not.toBeUndefined()
    expect(chip?.className).toContain('text-rec')
    expect(chip?.className).toContain('font-medium')
    expect(chip?.className).toContain('truncate')
    expect(chip?.getAttribute('title')).toContain(LONG_THEME)
    // 含题材长链存在（换行不溢出，文本仍在）
    expect(container.textContent).toContain('含题材')
  })

  it('同刻同股多条有效记录：相同代码同分钟不丢、不撞键（内容签名+出现序号）', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { nodes } = buildTimeline({
        stocks: [
          { ...mk('a', '100000', '电力'), name: '早封票' },
          { ...mk('a', '100000', '电力'), name: '晚封票' }, // 同代码、同行业、同分钟
        ],
        events: NO_EVENTS,
        pushes: NO_PUSHES,
      })
      const slots = buildTimelineSlots(nodes)
      // 合并进同一行业组的同一分钟槽
      expect(slots).toHaveLength(1)
      expect(slots[0].sectors[0].stocks).toHaveLength(2)
      const { container } = render(
        <TimelineSlotCard slot={slots[0]} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
      )
      // 两条记录都渲染（未因同 key 被吞）
      const rows = container.querySelectorAll('[style*="100px 84px 84px"]')
      expect(rows.length).toBe(2)
      expect(container.textContent).toContain('早封票')
      expect(container.textContent).toContain('晚封票')
      // 无 React 同 key 告警（内容签名+出现序号保证 key 唯一）
      const dupKey = errorSpy.mock.calls.some(
        (c) => c.some((a) => typeof a === 'string' && a.includes('same key')),
      )
      expect(dupKey).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

/**
 * 卡片**形态**的三条硬契约（用户 2026-09-17 第三轮）：
 *   ① **固定高 240px + 卡体滚动** —— 长内容不撑高卡片，换行后行列整齐；
 *   ② **卡头（时刻）固定在滚动区之外** —— 内容再长也永远知道这是几点；
 *   ③ **板块按强度降序 + 卡面直接展示最强 3 个**，其余在标注后下拉可见（⛔ 不丢数据）。
 */
describe('TimelineSlotCard 固定高 / 滚动 / 板块强度排序', () => {
  /**
   * 一个「同刻多板块」的槽：四个行业各 2 只以上（同板块 ≥2 只才会成组）。
   *
   * ⛔ **故意把输入打乱**（弱 → 强）—— 否则「按输入顺序渲染」也会让断言通过，
   * 测试就**证明不了排序真的生效**（变异验证：去掉 `sortSlotSectors` 必红）。
   */
  function fourSectors() {
    const mkN = (sector: string, n: number, boards = 1): ZtPoolStock[] =>
      Array.from({ length: n }, (_, i) => ({
        ...mk(`${sector}${i}`, '100000', sector, `${sector}股${i}`),
        boards,
      }))
    return buildTimeline({
      stocks: [
        ...mkN('农业', 2, 1), // 最弱：2 只（输入第一位）
        ...mkN('医药', 3, 1), // 第三：3 只
        ...mkN('半导体', 4, 2), // 次强：4 只
        ...mkN('电力', 5, 3), // 最强：5 只（输入最后一位）
      ],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
  }

  it('① 卡片固定高 240px，卡体可滚动（长内容不撑高）', () => {
    const { nodes } = buildTimeline({
      stocks: [mk('a', '100000', '电力'), mk('b', '100000', '电力')],
      events: NO_EVENTS,
      pushes: NO_PUSHES,
    })
    const { container } = render(
      <TimelineSlotCard slot={buildTimelineSlots(nodes)[0]} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    const card = container.querySelector('section') as HTMLElement
    expect(card.style.height).toBe(`${SLOT_HEIGHT}px`)
    expect(SLOT_HEIGHT).toBe(240)
    // 卡体：flex 内滚动（min-h-0 + overflow-y-auto 缺一不可）
    const body = card.lastElementChild as HTMLElement
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).toContain('min-h-0')
    expect(body.className).toContain('flex-1')
  })

  it('② 卡头（时刻）在滚动区**之外**，内容再长也不丢时间锚点', () => {
    const { nodes } = fourSectors()
    const { container } = render(
      <TimelineSlotCard slot={buildTimelineSlots(nodes)[0]} topBoard={3} tags={new Map()} reasonByCode={new Map()} />,
    )
    const card = container.querySelector('section') as HTMLElement
    const head = card.firstElementChild as HTMLElement
    const body = card.lastElementChild as HTMLElement
    // 卡头不滚动
    expect(head.className).toContain('flex-none')
    expect(head.className).not.toContain('overflow-y-auto')
    // 「10:00」只出现在卡头，不出现在滚动区（否则会被滚走）
    expect(head.textContent).toContain('10:00')
    expect(body.textContent).not.toContain('10:00')
  })

  it('③ 板块按强度降序：⑤5只 → ④4只 → ③3只 → ②2只，`#1` 落在最强板块', () => {
    const { nodes } = fourSectors()
    const { container } = render(
      <TimelineSlotCard slot={buildTimelineSlots(nodes)[0]} topBoard={3} tags={new Map()} reasonByCode={new Map()} />,
    )
    // 分组头（12.5px 加粗）在 DOM 中出现的顺序 = 强度降序
    const heads = Array.from(container.querySelectorAll('span')).filter(
      (s) => s.className.includes('text-[12.5px]') && s.className.includes('font-semibold'),
    )
    expect(heads.map((h) => h.textContent)).toEqual(['电力', '半导体', '医药', '农业'])
    // 排名徽标 #1 与最强板块同组
    const badge1 = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === '#1')
    expect(badge1).toBeTruthy()
    expect((badge1 as HTMLElement).parentElement?.textContent).toContain('电力')
    // 卡头只留数量，⛔ 不再写「按强度排序」这类口径注解
    expect(container.textContent).toContain('板块 4 个')
    expect(container.textContent).not.toContain('按强度排序')
  })

  it('④ 卡面直接展示最强 3 个板块，其余在标注后仍渲染（⛔ 不丢数据）', () => {
    const { nodes } = fourSectors()
    const { container } = render(
      <TimelineSlotCard slot={buildTimelineSlots(nodes)[0]} topBoard={3} tags={new Map()} reasonByCode={new Map()} />,
    )
    expect(SLOT_VISIBLE_SECTORS).toBe(3)
    // 最弱的「农业」不在「前三个」里，但**必须仍在 DOM**（下拉可见，不是被删）
    expect(container.textContent).toContain('农业')
    expect(container.textContent).toContain('其余 1 个板块')
    // ⛔ 卡头不再写「下拉看其余 N 个」；只保留「其余 N 个板块」这一条事实标注
    expect(container.textContent).not.toContain('下拉看其余')
    // ④ 号的排名徽标存在（说明它只是被排到后面，没有被丢弃）
    const badge4 = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === '#4')
    expect(badge4).toBeTruthy()
    expect((badge4 as HTMLElement).parentElement?.textContent).toContain('农业')
    // 守恒：四组全部渲染（每组 1 个汇总头 + 若干个股行）
    const heads = Array.from(container.querySelectorAll('span')).filter(
      (s) => s.className.includes('text-[12.5px]') && s.className.includes('font-semibold'),
    )
    expect(heads).toHaveLength(4)
  })
})

/**
 * 盘中**板块条目**的「按强度排序 + 最多 3 个」（用户 2026-09-17）。
 *
 * 实测病灶：单卡可含 9 个板块走强 + 6 个杀跌板块。本组测试锁三件事：
 *   ① **排序** —— 最强的板块排第一（弱→强的乱序输入必须被纠正）；
 *   ② **上限** —— 卡面直接展示 3 个，其余走「其余 N 个板块」标注；
 *   ③ **不丢** —— 超出的板块**仍在 DOM**（下拉可见），非板块条目不受上限影响。
 */
describe('卡片内板块条目：强度排序 + 最多 3 个', () => {
  /** 造一个含多板块事件的槽（乱序输入） */
  function busySlot() {
    const ev = (kind: string, name: string, extra: Record<string, unknown>) =>
      ({ at: '2026-09-17 12:06:01', kind, name, ...extra }) as unknown as IntradayTimelineEvent
    const slots = buildTimelineSlots([], [
      // 涨侧：故意乱序输入
      ev('sector_up', '强E', { zt_count: 1 }),
      ev('sector_up', '强A', { zt_count: 9 }),
      ev('sector_up', '强D', { zt_count: 3 }),
      ev('sector_up', '强B', { zt_count: 7 }),
      ev('sector_up', '强C', { zt_count: 5 }),
      // 跌侧：故意乱序输入
      ev('sector_down', '跌D', { pct: -2 }),
      ev('sector_down', '跌A', { pct: -9 }),
      ev('sector_down', '跌E', { pct: -1 }),
      ev('sector_down', '跌B', { pct: -5 }),
      ev('sector_down', '跌C', { pct: -3 }),
      // 非板块条目：⛔ 不受「最多 3 个」影响
      ev('zt_total', '', { total: 33, delta: 2 }),
    ])
    return slots[0]
  }

  /** 板块名 span（`font-medium` 在本槽内只用于盘中板块条目） */
  function sectorNames(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('span'))
      .filter((s) => s.className === 'font-medium')
      .map((s) => s.textContent ?? '')
  }

  it('① 板块按强度降序：涨侧按家数、跌侧按跌幅最负在前', () => {
    const { container } = render(
      <TimelineSlotCard slot={busySlot()} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    // DOM 顺序 = 强度降序（涨侧的 3 个 + 其余 2 个，再跌侧同理）
    expect(sectorNames(container)).toEqual([
      '强A', '强B', '强C', '强D', '强E',
      '跌A', '跌B', '跌C', '跌D', '跌E',
    ])
  })

  it('② 卡面直接展示 3 个：3 个之后出现「其余 N 个板块」标注', () => {
    const { container } = render(
      <TimelineSlotCard slot={busySlot()} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    expect(SLOT_VISIBLE_SECTORS).toBe(3)
    // 涨 / 跌各 5 个 → 各 2 个超出
    expect(container.textContent?.match(/其余 2 个板块/g)?.length).toBe(2)
    expect(container.textContent).toContain('板块 5 个')
    expect(container.textContent).not.toContain('按强度排序')
  })

  it('③ ⛔ 不丢数据：超出 3 个的板块仍在 DOM（下拉可见），非板块条目不受影响', () => {
    const { container } = render(
      <TimelineSlotCard slot={busySlot()} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
    )
    // 全部 10 个板块名都在
    for (const n of ['强A', '强B', '强C', '强D', '强E', '跌A', '跌B', '跌C', '跌D', '跌E']) {
      expect(container.textContent).toContain(n)
    }
    // 非板块条目照常（⛔ 不被「板块上限」波及）
    expect(container.textContent).toContain('涨停总数')
    expect(container.textContent).toContain('33')
  })
})

/**
 * 题材区自 2026-09-17 起**只有三类**：`🚀 首爆` / `⚠️ 衰竭` / `📤 推送`。
 *
 * ⛔ `↻ 反复` 已**整类撤除**（用户「干脆撤掉这一行」）：
 *   它的数据源是「每轮重算板块领涨股」的机械换人 —— 源头已用**龙头锁定**治掉
 *   （`intraday_pulse.diagnose_dragon`），且它既不是爆发也不是衰竭，不该在题材区占位。
 */
describe('卡片题材区：只有首爆 / 衰竭 / 推送（⛔ 反复已撤除）', () => {
  const evt = (text: string, time: string, topic: string) =>
    ({ time, event: text, severity: 'high', topic }) as never
  const mkSlot = (at: number, events: never[]) => ({
    at, sectors: [], singles: [], events, pushes: null, pushTo: null,
    intradayUp: [], intradayDown: [], key: `slot:${at}`,
  })

  it('⛔ 任何情况下都不再出现「↻ 反复」这一行', () => {
    for (const events of [
      // ① 混合：首爆 + 龙头切换
      [evt('新主线崛起：光通信 涨停7只，龙头 华脉科技', '10:00', '光通信'),
       evt('福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力', '10:00', '福建自贸/海西概念')],
      // ② 只有龙头切换（旧版会渲染「反复」行）
      [evt('PCB板 龙头切换：中岩大地 → 中材科技', '10:00', 'PCB板')],
    ] as never[][]) {
      const { container } = render(
        <TimelineSlotCard slot={mkSlot(600, events) as never} topBoard={1} tags={new Map()} reasonByCode={new Map()} />,
      )
      const txt = container.textContent ?? ''
      expect(txt).not.toContain('反复')
      expect(txt).not.toContain('易主')
      expect(txt).not.toContain('换将')
    }
  })

  it('首爆仍照常渲染（撤除的是「反复」不是「首爆」）', () => {
    const { container } = render(
      <TimelineSlotCard
        slot={mkSlot(600, [evt('新主线崛起：光通信 涨停7只，龙头 华脉科技', '10:00', '光通信')]) as never}
        topBoard={1}
        tags={new Map()}
        reasonByCode={new Map()}
      />,
    )
    const txt = container.textContent ?? ''
    expect(txt).toContain('🚀 首爆')
    expect(txt).toContain('光通信')
  })
})
