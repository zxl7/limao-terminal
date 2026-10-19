import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import {
  layoutSnake,
  minToClock,
  SESSION_CLOSE,
  SESSION_OPEN,
  SNAKE_BAR_MAX_H,
  SNAKE_BAR_W,
  SNAKE_MIN_GAP,
  SNAKE_MIN_ROWS,
  SNAKE_NODE_W,
  ShapeLegend,
  TimelineSnake,
  type ThemeBurst,
  type TimelineBlock,
  type TimelineSlot,
  type TimelineSlotSector,
} from '@/features/analytics'
import type { IntradayTimelineEvent, ZtPoolStock } from '@/shared/api'

/**
 * 蛇形时间轴的**交互契约**。
 *
 * ⛔ 2026-09-17 用户定稿：「**不要点击显示明细了，直接 hover 显示明细**」——
 * 故这里**不测任何点击路径**，全部以悬停 / 聚焦驱动。
 *
 * ⚠️ 测试里显式传 `width` —— jsdom 没有真实布局（`clientWidth` 恒 0），
 * 让它走 `useChartWidth` 的 fallback 会让断言依赖「兜底常数」而非布局逻辑。
 * ⚠️ 悬停用 `hoverOpenDelayMs={0} / hoverCloseDelayMs={0}`（同步触发，断言不用等定时器）；
 * **只测防抖本身**的那条才用假定时器。
 */

function mk(code: string, fbt: string, sector: string, extra: Partial<ZtPoolStock> = {}): ZtPoolStock {
  return {
    code,
    name: `票${code}`,
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
    ...extra,
  }
}

function sec(sector: string, n: number): TimelineSlotSector {
  return {
    sector,
    stocks: Array.from({ length: n }, (_, i) => mk(`${sector}${i}`, '100000', sector, { boards: i + 1 })),
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

function normalBlock(at: number, s: TimelineSlot): TimelineBlock {
  return { kind: 'normal', at, slot: s, key: `normal:${at}` }
}

const ie = (kind: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ at: '2026-09-17 10:00:01', kind, name, ...extra }) as unknown as IntradayTimelineEvent

/** 三个分钟槽：10:00（5 个行业）· 11:00（含盘中涨跌 + 题材爆发）· 13:30（单票） */
function threeBlocks(): TimelineBlock[] {
  return [
    normalBlock(
      10 * 60,
      slot(10 * 60, {
        sectors: [sec('电力', 5), sec('半导体', 4), sec('医药', 3), sec('农业', 2), sec('钢铁', 2)],
      }),
    ),
    normalBlock(
      11 * 60,
      slot(11 * 60, {
        sectors: [sec('光通信', 3)],
        intradayUp: [ie('sector_up', '机器人', { zt_count: 6 }), ie('sector_up', '医药', { zt_count: 3 })],
        intradayDown: [ie('sector_down', '白银', { pct: -6.49 })],
        events: [
          {
            time: '11:00',
            event: '新主线崛起：光通信 涨停7只，龙头 华脉科技',
            severity: 'high',
            topic: '光通信',
          },
        ],
      }),
    ),
    normalBlock(13 * 60 + 30, slot(13 * 60 + 30, { singles: [mk('a', '133000', '黄酒')] })),
  ]
}

const W = 1600
const props = { topBoard: 5, tags: new Map(), reasonByCode: new Map() }
/** 关掉防抖，断言同步可判（防抖本身另有用例） */
const instant = { hoverOpenDelayMs: 0, hoverCloseDelayMs: 0 }

/** 节点按钮（`aria-haspopup="dialog"` 标识「会弹明细的节点」） */
const nodesOf = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('button[aria-haspopup="dialog"]')) as HTMLElement[]

/**
 * 按**时刻**找节点。
 * ⛔ 必须走 `aria-label` 而非 `textContent` —— 节点是**小标记**（不携带文字），
 * 只有「显著节点」才渲染可见时刻标签。
 */
const nodeAt = (c: HTMLElement, clock: string) =>
  nodesOf(c).find((n) => n.getAttribute('aria-label')?.startsWith(clock))!

/** 悬停明细浮层 */
const dialogOf = (c: HTMLElement) => c.querySelector('[role="dialog"]') as HTMLElement | null

describe('TimelineSnake · 蛇形骨架', () => {
  it('① 画出一条蛇形折线：横走 + 每次转弯一个半圆弧（0 个 NaN）', () => {
    const blocks = threeBlocks()
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    const path = container.querySelector('svg path') as SVGPathElement
    const layout = layoutSnake({ marks: blocks.map((b) => b.at), width: W })
    expect(path.getAttribute('d')).toBe(layout.path)
    expect(layout.path.includes('NaN')).toBe(false)
    expect(layout.path.match(/A /g)?.length).toBe(layout.rows - 1)
    expect(layout.rows).toBe(SNAKE_MIN_ROWS)
  })

  it('② 节点数 === 分块数，落点与布局内核一致（⛔ 不自己另算一套坐标）', () => {
    const blocks = threeBlocks()
    const layout = layoutSnake({ marks: blocks.map((b) => b.at), width: W })
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    expect(nodesOf(container)).toHaveLength(blocks.length)
    for (const p of layout.points) {
      const node = nodeAt(container, minToClock(p.at))
      expect(node).toBeTruthy()
      expect(node.style.left).toBe(`${p.x}px`)
      expect(node.style.top).toBe(`${p.y}px`)
    }
  })

  it('③ 轴覆盖 09:25–15:00：首尾节点分别落在首行起点与末行终点', () => {
    const blocks = [
      normalBlock(SESSION_OPEN, slot(SESSION_OPEN)),
      normalBlock(SESSION_CLOSE, slot(SESSION_CLOSE)),
    ]
    const layout = layoutSnake({ marks: blocks.map((b) => b.at), width: W })
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    expect(nodeAt(container, '09:25').style.left).toBe(`${layout.x0}px`)
    expect(nodeAt(container, '15:00').style.left).toBe(`${layout.x0}px`)
  })

  it('④ 空数据：轴骨架照画（⛔ 不留白板、也不加解释文案）', () => {
    const { container } = render(<TimelineSnake blocks={[]} {...props} width={W} {...instant} />)
    expect(container.querySelector('svg path')).not.toBeNull()
    expect(nodesOf(container)).toHaveLength(0)
  })

  it('⑤ 上午与下午之间有“黄金分割线”分隔带，且不属于行情节点', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    const seam = container.querySelector('[aria-label="黄金分割线 · AI短线语录"]')
    expect(seam).not.toBeNull()
    expect(seam?.textContent).toContain('AI短线语录')
    expect(nodesOf(container)).toHaveLength(threeBlocks().length)
  })
})

describe('TimelineSnake · 悬停即明细（⛔ 无需点击）', () => {
  it('① hover 节点 → 直接浮出明细（role=dialog），无需任何点击', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    expect(dialogOf(container)).toBeNull()
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    const dlg = dialogOf(container)
    expect(dlg).not.toBeNull()
    expect(dlg!.getAttribute('aria-label')).toContain('11:00')
    // 节点同时如实标记为「已展开」
    expect(nodeAt(container, '11:00').getAttribute('aria-expanded')).toBe('true')
  })

  it('② 明细是**全量**：5 个行业全出现，且没有「其余 N 个板块」这种截断标注', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    fireEvent.mouseEnter(nodeAt(container, '10:00'))
    const dlg = dialogOf(container)!
    for (const name of ['电力', '半导体', '医药', '农业', '钢铁']) {
      expect(dlg.textContent).toContain(name)
    }
    expect(dlg.textContent).not.toContain('其余')
  })

  it('③ ⛔ 2026-09-22 起：详情完整展示盘中板块明细', () => {
    const many = Array.from({ length: 6 }, (_, i) => ie('sector_up', `板块${i}`, { zt_count: 6 - i }))
    const blocks = [normalBlock(10 * 60, slot(10 * 60, { intradayUp: many }))]
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    fireEvent.mouseEnter(nodeAt(container, '10:00'))
    const dlg = dialogOf(container)!
    // 用户原话：「我不喜欢看到现在什么的爆发走强，杀跌这些数量」
    expect(dlg.textContent).not.toContain('爆发 / 走强')
    expect(dlg.textContent).not.toContain('杀跌')
    for (let i = 0; i < 6; i++) expect(dlg.textContent).toContain(`板块${i}`)
    expect(dlg.textContent).not.toContain('下拉查看')
  })

  it('④ 详情含该刻**全部个股**；题材爆发原样解析出来（题材主轴）', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    fireEvent.mouseEnter(nodeAt(container, '10:00'))
    const dlg10 = dialogOf(container)!
    // 头部统计改走题材维度（⛔ 不再是「行业 N · ↑N/↓N」）
    expect(dlg10.textContent).toContain('封板 16')
    expect(dlg10.textContent).not.toContain('↑')
    // 该刻个股仍**全量**在详情里（本 fixture 无题材标记 → 走「无题材标记」段）
    expect(dlg10.textContent).toContain('票电力0')
    fireEvent.mouseLeave(nodeAt(container, '10:00'))
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    const dlg = dialogOf(container)!
    // 题材爆发仍原样解析（🚀 首爆 + 题材名 + 龙头）
    expect(dlg.textContent).toContain('🚀 首爆')
    expect(dlg.textContent).toContain('光通信')
    expect(dlg.textContent).toContain('华脉科技')
    // ⛔ 但该刻的**盘中板块事件**（机器人走强 / 白银杀跌）不再出现在详情里
    expect(dlg.textContent).toContain('机器人')
    expect(dlg.textContent).toContain('白银')
  })

  it('⑤ 移开鼠标 → 自动收起', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    const node = nodeAt(container, '10:00')
    fireEvent.mouseEnter(node)
    expect(dialogOf(container)).not.toBeNull()
    fireEvent.mouseLeave(node)
    expect(dialogOf(container)).toBeNull()
    expect(nodeAt(container, '10:00').getAttribute('aria-expanded')).toBe('false')
  })

  it('⑥ 悬停**另一个**节点 → 明细切换，不会同时开两个', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    const a = nodeAt(container, '10:00')
    const b = nodeAt(container, '13:30')
    fireEvent.mouseEnter(a)
    expect(dialogOf(container)!.textContent).toContain('电力')
    fireEvent.mouseLeave(a)
    fireEvent.mouseEnter(b)
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(dialogOf(container)!.textContent).toContain('票a')
    expect(dialogOf(container)!.textContent).not.toContain('当刻 5 只')
  })

  it('⑦ 键盘聚焦 = 悬停（可访问性）：Tab 到节点也弹明细，失焦收起', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    const node = nodeAt(container, '11:00')
    fireEvent.focus(node)
    expect(dialogOf(container)).not.toBeNull()
    fireEvent.blur(node)
    expect(dialogOf(container)).toBeNull()
  })

  it('⑧ 浮层自身**可滚动**（长内容能读全，不靠点击展开）', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    fireEvent.mouseEnter(nodeAt(container, '10:00'))
    const dlg = dialogOf(container)!
    const scroller = dlg.querySelector('[class*="overflow-y-auto"]') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.className).toContain('min-h-0')
    expect(dlg.style.maxHeight).toContain('vh')
  })

  it('⑨ ⛔ 防抖：延迟开启 + 移入浮层不关闭 + 移出浮层才关闭', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <TimelineSnake
          blocks={threeBlocks()}
          {...props}
          width={W}
          hoverOpenDelayMs={100}
          hoverCloseDelayMs={150}
        />,
      )
      const node = nodeAt(container, '10:00')
      // 未到开启延迟 → 不弹（扫过密集节点时不闪）
      fireEvent.mouseEnter(node)
      expect(dialogOf(container)).toBeNull()
      act(() => void vi.advanceTimersByTime(100))
      expect(dialogOf(container)).not.toBeNull()
      // 离开节点 → 宽限期内仍开（给「移进浮层」留时间）
      fireEvent.mouseLeave(node)
      act(() => void vi.advanceTimersByTime(50))
      expect(dialogOf(container)).not.toBeNull()
      // 移进浮层 → 撤销关闭预约
      fireEvent.mouseEnter(dialogOf(container)!)
      act(() => void vi.advanceTimersByTime(1000))
      expect(dialogOf(container)).not.toBeNull()
      // 移出浮层 → 关闭
      fireEvent.mouseLeave(dialogOf(container)!)
      act(() => void vi.advanceTimersByTime(150))
      expect(dialogOf(container)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * ⛔ 盘外 / 夹位记录在**像素层**的两条契约：
 *   ① 盘后（17:42 之类）**必须标注** —— 它被夹到收盘位置，光看时刻会误读成盘中；
 *   ② 多条夹到同一轴点 → **坐标必须互不相同**（否则像素级完全重叠，肉眼只看到 1 个）。
 */
describe('TimelineSnake · 盘外与夹位记录', () => {
  const POST = 17 * 60 + 42

  it('① 盘后记录：节点带「盘后」标注，浮层如实说明夹位', () => {
    const blocks = [normalBlock(POST, slot(POST))]
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    const node = nodeAt(container, '17:42')
    expect(node.getAttribute('aria-label')).toContain('（盘后）')
    expect(node.textContent).toContain('17:42')
    expect(node.textContent).toContain('盘后')
    fireEvent.mouseEnter(node)
    const dlg = dialogOf(container)!
    expect(dlg.textContent).toContain('17:42 盘后记录')
  })

  it('② 同一位置多条夹位（15:00 + 盘后）→ 节点 top 互不相同，一个都没少', () => {
    const blocks = [
      normalBlock(SESSION_CLOSE, slot(SESSION_CLOSE)),
      normalBlock(POST, slot(POST)),
      normalBlock(POST + 8, slot(POST + 8)),
    ]
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    const nodes = nodesOf(container)
    expect(nodes).toHaveLength(3)
    expect(new Set(nodes.map((n) => n.style.top)).size).toBe(3)
    expect(new Set(nodes.map((n) => n.style.left)).size).toBe(1)
  })

  it('③ 盘中记录**不**带盘别标注（⛔ 不给正常节点加噪声）', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    for (const n of nodesOf(container)) {
      expect(n.textContent).not.toContain('盘后')
      expect(n.textContent).not.toContain('盘前')
    }
  })
})

/**
 * 节点是**小标记**而不是卡片（由真实数据倒逼的设计）：
 * 实测节点相邻间隔**中位 2 分钟**，若按卡片宽度（58px）排需 **12 行** —— 不可接受。
 * 故节点 = 细竖条（高度编码活跃度、颜色编码性质），文字交给 hover。
 */
describe('TimelineSnake · 节点标记形态', () => {
  /**
   * 节点标记（竖条/三角/圆…）。
   * ⛔ 2026-10-18 起不能再按「宽度 = SNAKE_BAR_W」筛 —— 形状化后三角/圆的宽度随高度变化，
   *    用宽度选择器会漏掉一半节点（表现为「bars 数量对不上」，而不是形状断言失败）。
   */
  const barsOf = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('span[data-node-kind]')) as HTMLElement[]

  it('① 节点命中区宽 = SNAKE_NODE_W（26px），不是卡片宽度', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    expect(SNAKE_NODE_W).toBe(26)
    for (const n of nodesOf(container)) expect(n.style.width).toBe(`${SNAKE_NODE_W}px`)
    expect(barsOf(container)).toHaveLength(nodesOf(container).length)
  })

  it('①b 相邻分钟收窄命中区，不能由后一个节点遮住前一个', () => {
    const blocks = [
      normalBlock(10 * 60, slot(10 * 60)),
      normalBlock(10 * 60 + 1, slot(10 * 60 + 1)),
    ]
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    const a = nodeAt(container, '10:00')
    const b = nodeAt(container, '10:01')
    const gap = Math.abs(Number.parseFloat(a.style.left) - Number.parseFloat(b.style.left))
    expect(Number.parseFloat(a.style.width)).toBeLessThanOrEqual(gap)
    expect(Number.parseFloat(b.style.width)).toBeLessThanOrEqual(gap)
  })

  it('② 只有细竖线编码活跃度（图标等大，不随活跃度缩放）', () => {
    const busy = normalBlock(
      10 * 60,
      slot(10 * 60, { singles: [mk('a', '100000', '甲'), mk('b', '100001', '乙'), mk('c', '100002', '丙')] }),
    )
    const quiet = normalBlock(14 * 60, slot(14 * 60, { singles: [mk('x', '140000', '黄酒')] }))
    const { container } = render(<TimelineSnake blocks={[busy, quiet]} {...props} width={W} {...instant} />)
    const barH = (clock: string) => {
      const bar = nodeAt(container, clock).querySelector('[data-node-shape="bar"]') as HTMLElement
      return Number.parseFloat(bar.style.height)
    }
    expect(barH('10:00')).toBeGreaterThan(barH('14:00'))
    for (const b of barsOf(container)) {
      const h = Number.parseFloat(b.style.height)
      expect(h).toBeGreaterThanOrEqual(8)
      expect(h).toBeLessThanOrEqual(SNAKE_BAR_MAX_H)
    }
  })

  it('③ 只有**显著节点**才渲染时刻标签（⛔ 防止 1–2 分钟间隔下叠字）', () => {
    const notable = normalBlock(
      10 * 60,
      slot(10 * 60, { sectors: [sec('电力', 5), sec('半导体', 4), sec('医药', 3)] }),
    )
    const plain = normalBlock(15 * 60, slot(15 * 60, { singles: [mk('p', '150000', '黄酒')] }))
    const { container } = render(<TimelineSnake blocks={[notable, plain]} {...props} width={W} {...instant} />)
    expect(nodeAt(container, '10:00').textContent).toContain('10:00')
    expect(nodeAt(container, '15:00').textContent).toBe('')
  })

  it('④ 同层相邻时刻标签互不挤（间距 ≥ MIN_LABEL_GAP）', () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      normalBlock(
        10 * 60 + i,
        slot(10 * 60 + i, { sectors: [sec(`板块A${i}`, 3), sec(`板块B${i}`, 3), sec(`板块C${i}`, 3)] }),
      ),
    )
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={800} {...instant} />)
    const labeledNodes = nodesOf(container).filter((n) => (n.textContent ?? '').trim() !== '')
    expect(labeledNodes.length).toBeGreaterThan(0)
    expect(labeledNodes.length).toBeLessThan(blocks.length)
    const byLane = new Map<string, number[]>()
    for (const n of labeledNodes) {
      const list = byLane.get(n.style.top) ?? []
      list.push(Number.parseFloat(n.style.left))
      byLane.set(n.style.top, list)
    }
    for (const xs of byLane.values()) {
      xs.sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(48)
    }
  })

  it('⑤ **整段**分钟级密集保持固定四段，并如实标记拥挤', () => {
    const marks = Array.from({ length: 255 }, (_, i) => 9 * 60 + 15 + i)
    const blocks = marks.map((m) => normalBlock(m, slot(m)))
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    const layout = layoutSnake({ marks, width: W })
    expect(layout.rows).toBe(SNAKE_MIN_ROWS)
    expect(layout.overcrowded).toBe(false)
    expect(layout.minLaneGap!).toBeGreaterThanOrEqual(SNAKE_MIN_GAP)
    expect(nodesOf(container)).toHaveLength(255)
  })

  it('⑥ 稀疏日（节点间隔 5 分钟）→ 压在下限行数，不无谓增行', () => {
    const marks = Array.from({ length: 51 }, (_, i) => 9 * 60 + 15 + i * 5)
    const blocks = marks.map((m) => normalBlock(m, slot(m)))
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={W} {...instant} />)
    const layout = layoutSnake({ marks, width: W })
    expect(layout.rows).toBe(SNAKE_MIN_ROWS)
    expect(layout.overcrowded).toBe(false)
    expect(nodesOf(container)).toHaveLength(51)
  })
})

/**
 * ⛔ **悬停明细不折叠**（2026-09-17）。
 *
 * 卡面为「安静」而默认折叠机器噪声；但**悬停浮层是「完整明细」的落点**，
 * 一条都不能藏 —— 否则用户想深看时反而看不全。
 * 两者共用 `SlotBody`，差别只在 `showAllEvents`：漏传这个 prop 页面**照常工作**、不报错，
 * 只是明细悄悄变残缺 → 必须用渲染断言钉住。
 */
describe('TimelineSnake · 悬停明细必须全量（不折叠）', () => {
  const e1 = { time: '10:00', event: '市场情绪由「分歧」转为「修复」', severity: 'high', topic: '情绪' }
  const e2 = { time: '10:00', event: '国产芯片 龙头切换：中晶科技 → 西陇科学', severity: 'high', topic: '国产芯片' }

  /** 手工造一个**带 `foldedIdx`** 的槽（模拟卡面默认折叠了第 2 条） */
  const foldedBlock = normalBlock(
    10 * 60,
    slot(10 * 60, { events: [e1, e2], foldedIdx: [1] } as never),
  )

  it('★ 明细浮层里两条都在，且**没有** details 折叠区', () => {
    const { container } = render(<TimelineSnake blocks={[foldedBlock]} {...props} {...instant} width={W} />)
    fireEvent.mouseEnter(nodeAt(container, '10:00'))
    const dlg = container.querySelector('[role="dialog"]') as HTMLElement
    expect(dlg).not.toBeNull()
    expect(dlg.querySelector('details')).toBeNull() // ⛔ 明细里不得折叠
    expect(dlg.textContent).toContain('市场情绪由「分歧」转为「修复」')
    expect(dlg.textContent).toContain('国产芯片 龙头切换：中晶科技 → 西陇科学')
  })

  it('★ 明细浮层不显示「另有 N 条系统观测」这类折叠文案', () => {
    const { container } = render(<TimelineSnake blocks={[foldedBlock]} {...props} {...instant} width={W} />)
    fireEvent.mouseEnter(nodeAt(container, '10:00'))
    const dlg = container.querySelector('[role="dialog"]') as HTMLElement
    expect(dlg.textContent).not.toContain('另有')
  })
})

/**
 * 题材爆发节点（2026-09-20 用户三条定调，全部锁在这里）。
 *
 *   ① 「将题材爆发的时间节点，按照**板块和时间节点**添加到时间轴上」→ 轴上直接标板块名；
 *   ② 「hover 详情…**板块、个股、催化**都可以显示」→ 详情里展开催化 / 成员 / 观测时刻；
 *   ③ 「这种题材爆发的节点，可以标**紫色**显示」→ 2026-10-18 **用户改口**：
 *      「低空经济首次爆发……跟紫色区分，变**大红色**……后面继续走强也保持红色，字体大一点」
 *      ⇒ 首爆 = 实心大红 `bg-up` + 竖条加宽；同题材再次爆发 = 续强 `bg-up/80`；轮动仍是紫。
 *
 * ⛔ 为什么必须钉住：颜色错了、名字漏了、催化没渲染，**页面都照常工作、不报错** ——
 * 典型的静默退化，只有渲染断言能发现。
 */
describe('TimelineSnake · 题材爆发节点（大红首爆 + 板块名 + 详情含催化）', () => {
  /**
   * 竖条 —— 按 `data-node-kind` 定位（⛔ 不再按宽度找：首爆竖条比常态宽 3px，
   * 用固定宽度选择器会在改造后直接选不到，表现为「test 崩了而不是断言失败」）。
   */
  const barAt = (c: HTMLElement, clock: string) =>
    nodeAt(c, clock).querySelector('span[data-node-kind]') as HTMLElement

  const themeInfo = new Map<string, ThemeBurst>([
    [
      '光通信',
      {
        theme: '光通信',
        at: 11 * 60,
        to: 14 * 60 + 53,
        isNewMainline: true,
        riseCount: 7,
        leaders: ['华脉科技'],
        currentLeader: '华脉科技',
        points: [
          { at: 11 * 60, kind: 'rise' },
          { at: 14 * 60 + 53, kind: 'rise' },
        ],
        catalyst: '黄仁勋产能翻倍 + 光刻胶涨价',
        pushCount: 2,
        members: [{ code: '600522', name: '中天科技' }],
      },
    ],
  ])

  const RISE = {
    time: '11:00',
    event: '新主线崛起：光通信 涨停7只，龙头 华脉科技',
    severity: 'high',
    topic: '光通信',
  }

  /**
   * 纯题材爆发槽（**无**杀跌板块）。
   * ⚠️ 实测取证（2026-09-17/18 共 5 次 rise）：**从不**与 `sector_down` 同分钟，
   * 故「紫」在真实数据里就是这类节点的常态颜色。
   */
  const burstBlock = () => normalBlock(11 * 60, slot(11 * 60, { events: [RISE] }))

  it('① 题材**首爆**竖条为实心大红（与「轮动紫」分家），且不泛化到普通节点', () => {
    const { container } = render(<TimelineSnake blocks={[burstBlock()]} {...props} {...instant} width={W} />)
    const burstBar = barAt(container, '11:00')
    expect(burstBar.className, '题材首爆应为大红').toContain('bg-up')
    expect(burstBar.className, '⛔ 不得再用紫色（紫=轮动/回流）').not.toContain('bg-rec')
    expect(burstBar.className, '首爆是实心红，不是续强那档半透明').not.toContain('bg-up/80')
    // 轴上标签：带「首爆·」，且文字放大（用户「字体稍微大一点，突出这个题材牛逼」）
    const node = nodeAt(container, '11:00')
    expect(node.textContent).toContain('首爆·光通信')
    const tag = node.querySelector('[data-burst="first"]') as HTMLElement
    expect(tag, '首爆标签应带 data-burst=first（供样式与测试定位）').toBeTruthy()
    expect(tag.className).toContain('text-[11.5px]')

    // 反例：普通节点仍是灰 —— 红色是爆发专用色，不能处处红
    const { container: c2 } = render(
      <TimelineSnake
        blocks={[normalBlock(14 * 60, slot(14 * 60, { singles: [mk('z', '140000', '黄酒')] }))]}
        {...props}
        {...instant}
        width={W}
      />,
    )
    expect(barAt(c2, '14:00').className).toContain('bg-sub')
  })

  it('② 同一题材再次爆发 = 续强（仍是红，弱半档，文案「续强·」）', () => {
    const { container } = render(
      <TimelineSnake
        blocks={[
          normalBlock(11 * 60, slot(11 * 60, { events: [RISE] })),
          normalBlock(13 * 60, slot(13 * 60, { events: [{ ...RISE, time: '13:00' }] })),
        ]}
        {...props}
        {...instant}
        width={W}
      />,
    )
    expect(barAt(container, '11:00').className, '首爆：实心大红').toContain('bg-up')
    expect(barAt(container, '13:00').className, '续强：红但弱半档').toContain('bg-up/80')
    expect(nodeAt(container, '13:00').textContent, '第二次爆发应写「续强」而不是「首爆」').toContain(
      '续强·光通信',
    )
  })

  it('② 同一分钟既有题材爆发又有杀跌板块 → **风险优先**（绿），这是刻意的优先级', () => {
    const mixed = normalBlock(
      11 * 60,
      slot(11 * 60, { events: [RISE], intradayDown: [ie('sector_down', '白银', { pct: -6.49 })] }),
    )
    const { container } = render(<TimelineSnake blocks={[mixed]} {...props} {...instant} width={W} />)
    // 文档既定顺序：联动 > 杀跌 > 题材 > 合并 > 普通（与卡片流同源）
    expect(barAt(container, '11:00').className).toContain('bg-down')
  })

  it('③ 轴上直接标出板块名，无障碍名字里也带题材（非题材节点不带）', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} {...instant} width={W} />)
    const burstNode = nodeAt(container, '11:00')
    expect(burstNode.textContent, '轴上应标出爆发题材名').toContain('光通信')
    expect(burstNode.getAttribute('aria-label')).toContain('题材光通信')
    const plainNode = nodeAt(container, '13:30')
    expect(plainNode.getAttribute('aria-label')).not.toContain('题材')
    expect(plainNode.textContent).not.toContain('🚀')
  })

  it('④ hover 详情展开该题材的催化 / 涨停成员 / 观测时刻，且浮层已放大', () => {
    const { container } = render(
      <TimelineSnake blocks={threeBlocks()} {...props} themeInfo={themeInfo} {...instant} width={W} />,
    )
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    const dlg = dialogOf(container)!
    expect(dlg.textContent, '详情缺催化原文').toContain('催化：黄仁勋产能翻倍 + 光刻胶涨价')
    expect(dlg.textContent, '详情缺当日涨停成员（个股）').toContain('当日涨停成员：中天科技')
    expect(dlg.textContent, '详情缺观测时刻序列').toContain('观测 11:00 → 14:53')
    // 用户 2026-09-20「卡片 hover 可以显示大一点」：700 → 980
    expect(dlg.style.width).toBe('980px')
  })

  it('⑤ ⛔ 不传 `themeInfo` 时详情不出现催化行（卡面/默认保持紧凑）', () => {
    const { container } = render(<TimelineSnake blocks={threeBlocks()} {...props} {...instant} width={W} />)
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    const dlg = dialogOf(container)!
    expect(dlg.textContent).toContain('光通信')
    expect(dlg.textContent).not.toContain('催化：')
    expect(dlg.textContent).not.toContain('当日涨停成员：')
  })

  /**
   * ⑥⑦ 锁 2026-09-20 用户「全部题材上轴」（删掉题材爆发大卡后，题材可见性从 8 个掉到 3 个，
   * 用户抓包「其他的题材全部都没看到了」→ 仅龙头轮动的题材也要在轴上可见）。
   */
  const ROTATED = {
    time: '14:00',
    event: 'PCB板 龙头切换：中岩大地 → 中材科技',
    severity: 'high',
    topic: 'PCB板',
  }
  const rotatedBlock = (at: number) => normalBlock(at, slot(at, { events: [ROTATED] }))

  it('⑥ 仅龙头轮动的题材也上轴：淡紫弱标记 + 题材名（⛔ 不带 🚀）', () => {
    const { container } = render(<TimelineSnake blocks={[rotatedBlock(14 * 60)]} {...props} {...instant} width={W} />)
    const bar = barAt(container, '14:00')
    expect(bar.className, '仅轮动 = 空心紫弱标记（不是爆发的实心紫）').toContain('border-rec')
    expect(bar.className.split(' '), '⛔ 不得与爆发同色').not.toContain('bg-rec')
    const node = nodeAt(container, '14:00')
    expect(node.textContent, '轴上必须看得到题材名').toContain('PCB板')
    expect(node.textContent, '⛔ 轮动不是爆发，不带 🚀').not.toContain('🚀')
    expect(node.getAttribute('aria-label')).toContain('题材轮动PCB板')
  })

  it('⑦ 同层标签放不下时**题材名优先**于普通时刻标签（否则题材等于不可见）', () => {
    // 10:00 普通显著节点（3 个板块）与 10:01 仅轮动节点相隔 1 分钟 → 两个标签放不下
    const plain = normalBlock(
      10 * 60,
      slot(10 * 60, { sectors: [sec('电力', 3), sec('半导体', 3), sec('医药', 3)] }),
    )
    const { container } = render(
      <TimelineSnake blocks={[plain, rotatedBlock(10 * 60 + 1)]} {...props} {...instant} width={W} />,
    )
    expect(nodeAt(container, '10:01').textContent, '题材名必须赢得空间').toContain('PCB板')
    expect(nodeAt(container, '10:00').textContent, '普通时刻标签让位').toBe('')
  })
})

describe('TimelineSnake · 外部聚焦（左栏节点列表点击联动 · 2026-09-22）', () => {
  it('① 传入 focusKey → 无需 hover 即弹出该节点明细', () => {
    // threeBlocks() 的第二块 at=11*60=660 → key `normal:660`
    const { container } = render(
      <TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} focusKey="normal:660" />,
    )
    const dlg = dialogOf(container)
    expect(dlg, 'focusKey 未打开明细').toBeTruthy()
    expect(dlg!.getAttribute('aria-label')).toContain('11:00')
  })

  it('② focusKey 不传 / 为空串 → 不空弹（行为与改动前完全一致）', () => {
    const a = render(<TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} />)
    expect(dialogOf(a.container)).toBeNull()
    const b = render(
      <TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} focusKey="" />,
    )
    expect(dialogOf(b.container)).toBeNull()
  })

  it('③ hover 优先于 focusKey：悬停别的节点即切到它', () => {
    const { container } = render(
      <TimelineSnake blocks={threeBlocks()} {...props} width={W} {...instant} focusKey="normal:600" />,
    )
    expect(dialogOf(container)?.getAttribute('aria-label')).toContain('10:00')
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    expect(dialogOf(container)?.getAttribute('aria-label')).toContain('11:00')
  })
})

/**
 * 形状编码渲染（2026-10-18 用户：「用三角形、圆形标示不同信号，顶部加图例」）。
 *
 * ⛔ 为什么必须锁形状：形状全错时页面照常渲染、不报错，只有截图或断言能发现；
 *    而形状恰恰是用户区分「爆发 / 风险 / 轮动」的第一编码（颜色是第二编码）。
 */
describe('TimelineSnake · 形状编码与图例', () => {
  /** 本块自带最小夹具：上一个 describe 里的 RISE/burstBlock 是块级常量，这里取不到 */
  const RISE = {
    time: '11:00',
    event: '新主线崛起：光通信 涨停7只，龙头 华脉科技',
    severity: 'high',
    topic: '光通信',
  }
  const burstBlock = () => normalBlock(11 * 60, slot(11 * 60, { events: [RISE] }))

  const shapeOf = (c: HTMLElement, clock: string) =>
    nodeAt(c, clock).querySelector('span[data-node-shape]') as HTMLElement

  it('题材爆发 = 向上三角；普通事实 = 细竖线', () => {
    const { container } = render(
      <TimelineSnake blocks={[burstBlock()]} {...props} {...instant} width={W} />,
    )
    const burst = shapeOf(container, '11:00')
    expect(burst.getAttribute('data-node-shape')).toBe('triangle-up')
    expect(burst.style.clipPath).toContain('polygon(50% 0')

    const { container: c2 } = render(
      <TimelineSnake
        blocks={[normalBlock(14 * 60, slot(14 * 60, { singles: [mk('z', '140000', '黄酒')] }))]}
        {...props}
        {...instant}
        width={W}
      />,
    )
    const plain = shapeOf(c2, '14:00')
    expect(plain.getAttribute('data-node-shape')).toBe('bar')
    expect(plain.style.width).toBe(`${SNAKE_BAR_W}px`)
  })

  it('风险节点 = 向下三角（与爆发同为三角但方向相反，色盲也能分辨）', () => {
    const mixed = normalBlock(
      11 * 60,
      slot(11 * 60, { events: [RISE], intradayDown: [ie('sector_down', '白银', { pct: -6.49 })] }),
    )
    const { container } = render(<TimelineSnake blocks={[mixed]} {...props} {...instant} width={W} />)
    const risk = shapeOf(container, '11:00')
    expect(risk.getAttribute('data-node-shape')).toBe('triangle-down')
    expect(risk.style.clipPath).toContain('polygon(0 0')
  })

  it('图例把 7 种形状全部解释清楚（每个都有名字）', () => {
    const { container } = render(<ShapeLegend />)
    const items = Array.from(container.querySelectorAll('[data-legend-kind]'))
    expect(items).toHaveLength(7)
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      '首爆',
      '风险',
      '联动',
      '走强',
      '轮动',
      '记录',
      '事实',
    ])
    // 每个图例项都带解释（title），不是只有个图形
    for (const el of items) expect(el.getAttribute('title')).toBeTruthy()
  })
})
