import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import {
  timelineAnchorId,
  TimelineDetailList,
  type TimelineBlock,
  type TimelineSlot,
  type TimelineSlotSector,
} from '@/features/analytics'
import type { ZtPoolStock } from '@/shared/api'

/**
 * 左栏「节点详情」列表（2026-09-22 用户定 · 「左侧显示每一个节点 hover 的详情，要具体详情打满」）
 * 的交互与**虚拟列表**契约。
 *
 * 锁四件事：
 *   ① **倒序**（最新 `at` 在最上）—— ⛔ 与右侧轴的时间升序相反是刻意的；
 *   ② 点击条目卡头 → 回传该节点 key（页面据此让右侧轴上对应节点弹明细）；
 *   ③ **虚拟列表生效**：条目数 **远小于** 总数（⛔ 防有人改回全量渲染卡死首屏）；
 *   ④ 详情**全量**（不沿用卡面「最强 3 个板块」的截断）。
 */

function mkStock(code: string, name: string, sector: string): ZtPoolStock {
  return {
    code,
    name,
    pct: 10,
    price: 10,
    boards: 1,
    fbt: '100000',
    zbc: 0,
    hs: 1,
    sector,
    seal: 1,
    cje_yi: 1,
    zsz_yi: 10,
  }
}

function sec(sector: string, n: number): TimelineSlotSector {
  return {
    sector,
    stocks: Array.from({ length: n }, (_, i) => mkStock(`${sector}${i}`, `${sector}${i}`, sector)),
    count: n,
    dayShape: null,
    daySpan: 5,
    dayTotal: n,
  }
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

function normalBlock(at: number, sectors: TimelineSlotSector[] = []): TimelineBlock {
  return { kind: 'normal', at, slot: slot(at, { sectors }), key: `normal:${at}` }
}

const props = { topBoard: 3, tags: new Map(), reasonByCode: new Map() }

/**
 * ⛔ 本测试**不需要**给 jsdom 打布局桩：组件的虚拟化器对「量不到」有**确定性回退**
 * （视口高 → `FALLBACK_VIEWPORT_H`、单项高 → `ESTIMATE_H`）——
 * 这正是自研而不用第三方库的原因（第三方在 jsdom 首帧拿不到窗口 → 一条都不渲染）。
 */

describe('TimelineDetailList · 左栏节点详情', () => {
  it('① 倒序：最新节点在最上，首条即最大 at（11:00）', () => {
    const blocks = [normalBlock(600), normalBlock(660), normalBlock(630)]
    const { container } = render(
      <TimelineDetailList blocks={blocks} {...props} onPick={() => {}} />,
    )
    const first = container.querySelector('[data-index="0"]')
    expect(first, '未渲染首条').toBeTruthy()
    expect(first!.textContent).toContain('11:00')
  })

  it('② 点击条目卡头 → 回传该节点 key（联动右侧蛇形轴）', () => {
    const onPick = vi.fn()
    const { container } = render(
      <TimelineDetailList blocks={[normalBlock(600), normalBlock(660)]} {...props} onPick={onPick} />,
    )
    const firstBtn = container.querySelector('[data-index="0"] button') as HTMLElement | null
    expect(firstBtn, '卡头应是可点按钮').toBeTruthy()
    fireEvent.click(firstBtn!)
    expect(onPick).toHaveBeenCalledWith('normal:660')
  })

  it('③ ⛔ 虚拟列表：60 条只渲染窗口内的一小部分（不得全量渲染）', () => {
    const blocks = Array.from({ length: 60 }, (_, i) => normalBlock(570 + i))
    const { container } = render(
      <TimelineDetailList blocks={blocks} {...props} onPick={() => {}} />,
    )
    const rendered = container.querySelectorAll('[data-index]')
    expect(rendered.length, '窗口内至少渲染首条').toBeGreaterThan(0)
    expect(rendered.length, '⛔ 全量渲染 60 条 = 虚拟列表失效').toBeLessThan(60)
    // 栏头计数仍显示**总数**（虚拟化只影响渲染，不改口径）
    expect(container.textContent).toContain('60')
  })

  it('④ 详情全量：8 只票全部渲染（不沿用卡面「最强 3 板块」截断）', () => {
    const { container } = render(
      <TimelineDetailList
        blocks={[normalBlock(600, [sec('电力', 8)])]}
        {...props}
        onPick={() => {}}
      />,
    )
    const txt = container.textContent ?? ''
    expect(txt, '第 8 只票被截断 → 详情不是全量').toContain('电力7')
  })

  it('⑤ 条目 id = timelineAnchorId(key)（与右侧轴共用同一锚点实现）', () => {
    const { container } = render(
      <TimelineDetailList blocks={[normalBlock(600)]} {...props} onPick={() => {}} />,
    )
    expect(container.querySelector(`#${timelineAnchorId('normal:600')}`)).toBeTruthy()
  })

  it('⑥ 空态：无节点时给提示且不渲染条目', () => {
    const { container } = render(<TimelineDetailList blocks={[]} {...props} onPick={() => {}} />)
    expect(container.querySelectorAll('[data-index]')).toHaveLength(0)
    expect(container.textContent).toContain('当日无可定位到分钟的记录')
  })
})
