import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  buildTimeline,
  buildTimelineSlots,
  TimelineSlotCard,
  SLOT_WIDTH,
  type StockThemeTag,
} from '@/features/analytics'
import type { ZtPoolStock } from '@/shared/api'

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

  it('事件/推送同刻合并进卡片，并标注「卡片时刻，非事件时刻」', () => {
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
    expect(container.textContent).toContain('卡片时刻，非事件时刻')
    expect(container.textContent).toContain('题材推送 1 条')
  })
})
