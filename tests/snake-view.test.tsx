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
    // ⛔ 行高固定为 3+3 预留（2026-10-20 用户：「还是把高度预留出来吧」）——path 必须逐字相等
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
   * 节点标记（细竖线 / 圆 / 菱形 / 四角星 / 叉…）。
   * ⛔ 两处不能省：
   *    ① 不能按「宽度 = SNAKE_BAR_W」筛 —— 形状化后宽度不再统一，用宽度选择器会漏掉一半节点；
   *    ② 不能写 `span[data-node-kind]` —— 首爆/风险是 `<svg>`（尖角形状走 SVG 才不糊）。
   */
  const barsOf = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[data-node-kind]')) as HTMLElement[]

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

  it('④ 同层相邻时刻标签互不挤（间距 ≥ MIN_LABEL_GAP），挤不下就升一层', () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      normalBlock(
        10 * 60 + i,
        slot(10 * 60 + i, { sectors: [sec(`板块A${i}`, 3), sec(`板块B${i}`, 3), sec(`板块C${i}`, 3)] }),
      ),
    )
    const { container } = render(<TimelineSnake blocks={blocks} {...props} width={800} {...instant} />)
    // ⛔ 2026-10-20 起标签分三层（data-label-tier），必须**按层**比间距，不能全局比
    const labels = Array.from(container.querySelectorAll('[data-label-tier]')) as HTMLElement[]
    expect(labels.length).toBeGreaterThan(0)
    const byTier = new Map<string, number[]>()
    for (const el of labels) {
      const tier = el.getAttribute('data-label-tier') ?? '0'
      const btn = el.closest('button') as HTMLElement | null
      const x = Number.parseFloat(btn?.style.left ?? '0')
      const list = byTier.get(tier) ?? []
      list.push(x)
      byTier.set(tier, list)
    }
    for (const xs of byTier.values()) {
      xs.sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(48)
    }
    // 分层确实被用上了（否则这条测试等于没测到错位机制）
    expect(byTier.size, '密集段落应自动错开到多层').toBeGreaterThan(1)
  })

  it('④-b 两个长题材标签放不下时**错开到不同层**，都保留（不再二选一）', () => {
    /**
     * 两个题材爆发相隔 3 分钟（≈75px）：两个字号 11.5 的「首爆·XXX」各约 118px，
     * 半宽之和 122px > 75px —— 同层必然压字，旧实现只能丢掉一个。
     * 现在应该一个留层 0、一个升到层 1，**两个都看得见**。
     */
    const burstAt = (m: number, topic: string) =>
      normalBlock(
        m,
        slot(m, {
          events: [
            {
              time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
              event: `新主线崛起：${topic} 涨停8只，龙头 某某股份`,
              severity: 'high',
              topic,
            },
          ],
        }),
      )
    const { container } = render(
      <TimelineSnake
        blocks={[burstAt(10 * 60, '低空经济'), burstAt(10 * 60 + 3, '国产芯片')]}
        {...props}
        {...instant}
        width={W}
      />,
    )
    const labels = Array.from(container.querySelectorAll('[data-label-tier]')) as HTMLElement[]
    const tiers = labels.map((el) => el.getAttribute('data-label-tier'))
    expect(labels.length, '两个长标签都应保留').toBe(2)
    expect(new Set(tiers).size, '必须错开到不同层，否则就是压字').toBe(2)
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
 *      ⇒ 首爆 = 满色红四角星；同题材再次爆发 = 续强（红 60%）；轮动仍是紫。
 *
 * ⚠️ 2026-10-20 用户：「首爆和风险换一个 icon，这个红绿三角不好看」→ 三角改星/叉。
 *    首爆与续强的区分从「加宽 3px」改为**颜色浓度**（图标已强制等大）。
 *
 * ⛔ 为什么必须钉住：颜色错了、名字漏了、催化没渲染，**页面都照常工作、不报错** ——
 * 典型的静默退化，只有渲染断言能发现。
 */
describe('TimelineSnake · 题材爆发节点（紫四角星首爆 + 光晕 + 板块名 + 详情含催化）', () => {
  /**
   * 节点标记 —— 按 `data-node-kind` 定位。
   * ⛔ 不能用 `span[data-node-kind]`：首爆/风险现在是 `<svg>`（尖角形状走 SVG 才不糊）。
   */
  const markAt = (c: HTMLElement, clock: string) =>
    nodeAt(c, clock).querySelector('[data-node-kind]') as Element

  /** 标记的 class 文本 —— ⛔ SVG 的 `.className` 是 `SVGAnimatedString`，直接 toContain 会永远失败 */
  const clsAt = (c: HTMLElement, clock: string) => markAt(c, clock).getAttribute('class') ?? ''

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

  it('① 题材**首爆**是满色紫四角星 + 同色光晕（2026-10-20 用户：「首爆改为紫色，加一圈很淡的同色光晕」）', () => {
    const { container } = render(<TimelineSnake blocks={[burstBlock()]} {...props} {...instant} width={W} />)
    const burstMark = markAt(container, '11:00')
    expect(burstMark.tagName.toLowerCase(), '尖角形状应走 SVG（14px 的 clip-path 三角会糊）').toBe('svg')
    expect(burstMark.getAttribute('data-node-shape')).toBe('sparkle')
    expect(clsAt(container, '11:00'), '题材首爆应为紫（regime=semantic: 紫=题材）').toContain('text-rec')
    expect(clsAt(container, '11:00'), '首爆是满色，不是续强那档 60%').not.toContain('/60')
    // 光晕 = 同形状外扩两层（1.42x / 1.85x）+ 主体 → 共 3 条 path
    expect(burstMark.querySelectorAll('path').length, '首爆必须有 2 层同色光晕').toBe(3)
    expect(burstMark.querySelectorAll('path[opacity]').length, '光晕层靠透明度区分').toBe(2)
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
    expect(clsAt(c2, '14:00')).toContain('bg-sub')
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
    expect(clsAt(container, '11:00'), '首爆：满色紫').toContain('text-rec')
    expect(clsAt(container, '11:00'), '首爆不是半档').not.toContain('/60')
    expect(clsAt(container, '13:00'), '续强：紫但弱半档').toContain('text-rec/60')
    // ⛔ 光晕只给首爆：续强也加的话，密集段落会连成一片紫雾，把首爆淹掉
    const followMark = container.querySelectorAll('button')[1]?.querySelector('[data-node-shape="sparkle"]')
    expect(followMark?.querySelectorAll('path').length, '续强只有主体一条 path，无光晕').toBe(1)
    expect(nodeAt(container, '13:00').textContent, '第二次爆发应写「续强」而不是「首爆」').toContain(
      '续强·光通信',
    )
  })

  it('② 同一分钟既有首爆又有杀跌板块 → **图标跟标题走**（星），风险降到下方绿字', () => {
    const mixed = normalBlock(
      11 * 60,
      slot(11 * 60, { events: [RISE], intradayDown: [ie('sector_down', '白银', { pct: -6.49 })] }),
    )
    const { container } = render(<TimelineSnake blocks={[mixed]} {...props} {...instant} width={W} />)
    /**
     * ⛔ 2026-10-20 用户：「如果标题写的是首爆，那么这 icon 也改成首爆，不要显示为其他的 icon，
     *    那样子的话不统一！」
     *   旧口径是「风险 > 题材」（形状画叉、标题却写首爆）；现在一律以**标题**为准。
     *   风险并没有丢：它在下区以「白银走弱」绿字 + 绿线呈现。
     */
    const mark = nodeAt(container, '11:00').querySelector('[data-node-shape]') as Element
    expect(mark.getAttribute('data-node-shape'), '标题是首爆 → 图标必须是星').toBe('sparkle')
    expect(mark.getAttribute('class') ?? '').toContain('text-rec')
    const down = nodeAt(container, '11:00').querySelector('[data-label-tier][data-label-dir="down"]')
    expect(down?.textContent ?? '').toContain('白银走弱')
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

  it('④ hover 详情展开该题材的催化 / 涨停成员 / 观测时刻，且浮层足够宽', () => {
    const { container } = render(
      <TimelineSnake blocks={threeBlocks()} {...props} themeInfo={themeInfo} {...instant} width={W} />,
    )
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    const dlg = dialogOf(container)!
    expect(dlg.textContent, '详情缺催化原文').toContain('催化：黄仁勋产能翻倍 + 光刻胶涨价')
    expect(dlg.textContent, '详情缺当日涨停成员（个股）').toContain('当日涨停成员：中天科技')
    expect(dlg.textContent, '详情缺观测时刻序列').toContain('观测 11:00 → 14:53')
    /**
     * ⚠️ 2026-10-22 用户两次纠正后，宽度语义已变：
     *   ① 写死 980 → ② 容器×0.82（仍是固定值，`14:30` 那种 4 行内容也 1052px，留白太大）
     *   → ③ **按内容量估宽**（`DETAIL_BASE_W + 行数×24 + 长句加成`，夹在 [340, 1180] 与容器内）。
     * ⛔ 所以这里**不能**再断言「≥ 某固定宽度」—— 该节点内容不多，估出来就该窄。
     *    改锁两件真正的不变量：宽度在合法区间内 + zoom 生效。
     */
    const w = Number.parseFloat(dlg.style.width) * Number.parseFloat(dlg.style.zoom || '1')
    expect(w, '浮层宽度不得窄于可读下限').toBeGreaterThanOrEqual(340)
    expect(w, '浮层宽度不得超过上限').toBeLessThanOrEqual(1180)
    expect(dlg.style.zoom, '字体放大走 zoom').toBeTruthy()
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
    const bar = nodeAt(container, '14:00').querySelector('[data-node-kind]') as Element
    const cls = bar.getAttribute('class') ?? ''
    expect(cls, '仅轮动 = 空心紫弱标记（不是爆发的实心紫）').toContain('border-rec')
    expect(cls.split(' '), '⛔ 不得与爆发同色').not.toContain('bg-rec')
    const node = nodeAt(container, '14:00')
    expect(node.textContent, '轴上必须看得到题材名').toContain('PCB板')
    expect(node.textContent, '⛔ 轮动不是爆发，不带 🚀').not.toContain('🚀')
    expect(node.getAttribute('aria-label')).toContain('题材轮动PCB板')
  })

  it('⑦ 题材名**占最低层**（离节点最近最显眼），普通时刻标签被让到高层', () => {
    // 10:00 普通显著节点（3 个板块）与 10:01 仅轮动节点相隔 1 分钟 → 同层放不下
    const plain = normalBlock(
      10 * 60,
      slot(10 * 60, { sectors: [sec('电力', 3), sec('半导体', 3), sec('医药', 3)] }),
    )
    const { container } = render(
      <TimelineSnake blocks={[plain, rotatedBlock(10 * 60 + 1)]} {...props} {...instant} width={W} />,
    )
    const tierOf = (clock: string) =>
      nodeAt(container, clock).querySelector('[data-label-tier]')?.getAttribute('data-label-tier') ?? null
    expect(nodeAt(container, '10:01').textContent, '题材名必须上轴').toContain('PCB板')
    expect(tierOf('10:01'), '题材名必须占最低层（层 0）').toBe('0')
    expect(tierOf('10:00'), '普通时刻标签让到高层，而不是被丢掉').toBe('1')
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
    nodeAt(c, clock).querySelector('[data-node-shape]') as Element

  it('题材爆发 = 四角星（SVG）；普通事实 = 细竖线', () => {
    const { container } = render(
      <TimelineSnake blocks={[burstBlock()]} {...props} {...instant} width={W} />,
    )
    const burst = shapeOf(container, '11:00')
    expect(burst.getAttribute('data-node-shape')).toBe('sparkle')
    // 尖角形状走 SVG：14px 下 CSS clip-path 的尖角抗锯齿会糊成一坨
    expect(burst.tagName.toLowerCase()).toBe('svg')
    expect(burst.querySelector('path')?.getAttribute('fill')).toBe('currentColor')
    // ⛔ 三角不得回流
    expect(burst.getAttribute('data-node-shape')).not.toContain('triangle')

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
    expect((plain as HTMLElement).style.width).toBe(`${SNAKE_BAR_W}px`)
  })

  it('风险节点 = 叉（与爆发轮廓完全不同，不靠颜色/方向区分）', () => {
    // ⛔ 不带 RISE：一旦标题成为「首爆」，图标就必须跟标题走（见上一条②）
    const mixed = normalBlock(
      11 * 60,
      slot(11 * 60, { intradayDown: [ie('sector_down', '白银', { pct: -6.49 })] }),
    )
    const { container } = render(<TimelineSnake blocks={[mixed]} {...props} {...instant} width={W} />)
    const risk = shapeOf(container, '11:00')
    expect(risk.getAttribute('data-node-shape')).toBe('cross')
    expect(risk.tagName.toLowerCase()).toBe('svg')
    // 叉是描边路径（stroke），星是填充路径（fill）—— 两者渲染方式也必须不同
    const path = risk.querySelector('path')
    expect(path?.getAttribute('stroke')).toBe('currentColor')
    expect(path?.getAttribute('fill')).toBe('none')
  })

  it('图例把 8 种形状全部解释清楚（顺序 = 实际优先级，炸板垫底）', () => {
    const { container } = render(<ShapeLegend />)
    const items = Array.from(container.querySelectorAll('[data-legend-kind]'))
    expect(items).toHaveLength(8)
    // 首爆居首、炸板垫底（2026-10-20 用户：「还是首爆优先，炸板不需要权重」）
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      '首爆',
      '风险',
      '联动',
      '走强',
      '轮动',
      '记录',
      '炸板',
      '事实',
    ])
    // 每个图例项都带解释（title），不是只有个图形
    for (const el of items) expect(el.getAttribute('title')).toBeTruthy()
  })
})

/**
 * 走强序号累加（2026-10-20 用户：「走强可以设置为 +1，然后无限叠，
 * 比如机器人走强可以改为：机器人+1，机器人+2」）。
 *
 * ⛔ 这里锁的是「同一条线第 N 次走强」的**事实序号**，不是「图上第 N 个标签」——
 *    标签可能因为放不下被省略（序号会跳），但序号本身不能重排，否则就是在撒谎。
 */
describe('TimelineSnake · 走强序号 +N 累加', () => {
  const upAt = (m: number, name = '机器人') =>
    normalBlock(m, slot(m, { intradayUp: [ie('sector_up', name)] }))

  it('同一板块第一次=首爆、第二次=+2（首次触发即首爆，不再从 +1 起跳）', () => {
    const { container } = render(
      <TimelineSnake blocks={[upAt(10 * 60), upAt(10 * 60 + 20)]} {...props} {...instant} width={W} />,
    )
    const texts = Array.from(container.querySelectorAll('[data-label-tier]')).map((el) =>
      el.textContent?.trim() ?? '',
    )
    // 2026-10-20 用户：「9:43 国产芯片就已经触发了，为什么还是首爆」→ 首次触发即首爆
    expect(texts.some((t) => t.endsWith('首爆·机器人')), `实际：${texts.join(' | ')}`).toBe(true)
    expect(texts.some((t) => t.endsWith('机器人+2')), `实际：${texts.join(' | ')}`).toBe(true)
  })

  it('不同板块各自从 +1 起算（计数键是板块名）', () => {
    const { container } = render(
      <TimelineSnake
        blocks={[upAt(10 * 60, '机器人'), upAt(10 * 60 + 20, '低空经济')]}
        {...props}
        {...instant}
        width={W}
      />,
    )
    const texts = Array.from(container.querySelectorAll('[data-label-tier]')).map((el) =>
      el.textContent?.trim() ?? '',
    )
    // 两条线各自「第一次」→ 各自都是首爆，互不干扰
    expect(texts.some((t) => t.endsWith('首爆·机器人'))).toBe(true)
    expect(texts.some((t) => t.endsWith('首爆·低空经济'))).toBe(true)
  })

  /**
   * ⛔⛔ 2026-10-22 用户抓包：「09:26 / 09:31 / 09:32」三个节点全写「首爆·机器人」。
   *
   * 根因：`isFirst` 是**节点级**布尔值（「这一刻引入了新名字」），而标签名固定取
   * `upSectors[0].name`（最强板块）—— 两者不同源。09:31 真正新出现的是
   * 「云计算数据中心」（排第 2），最强的机器人只是又涨一只，却被写成「首爆·机器人」。
   *
   * 口径：**首爆按名字判**。一条线一天只能首爆一次；最强板块是旧线时，
   * 标签要让位给该节点真正的新线（否则那条新线今天就永远没有首爆点）。
   */
  it('⛔ 同一板块一天只能首爆一次；旧线走强不得顶掉新线的首爆', () => {
    const rich = (m: number, names: string[]) =>
      normalBlock(m, slot(m, { intradayUp: names.map((n) => ie('sector_up', n)) }))
    const { container } = render(
      <TimelineSnake
        blocks={[
          // 09:26 机器人首爆
          rich(10 * 60, ['机器人']),
          // 09:31 机器人（旧）继续走强 + 云计算数据中心（新）
          rich(10 * 60 + 20, ['机器人', '云计算数据中心']),
          // 09:32 机器人（旧）+ 业绩增长（新）
          rich(10 * 60 + 40, ['机器人', '业绩增长']),
        ]}
        {...props}
        {...instant}
        width={W}
      />,
    )
    const texts = Array.from(container.querySelectorAll('[data-label-tier]')).map((el) =>
      el.textContent?.trim() ?? '',
    )
    const firsts = texts.filter((t) => t.endsWith('首爆·机器人'))
    expect(firsts.length, `机器人被标了 ${firsts.length} 次首爆：${texts.join(' | ')}`).toBe(1)
    // 新线各自拿到首爆点，不被旧线吞掉
    expect(texts.some((t) => t.endsWith('首爆·云计算数据中心')), texts.join(' | ')).toBe(true)
    expect(texts.some((t) => t.endsWith('首爆·业绩增长')), texts.join(' | ')).toBe(true)
  })

  /**
   * ⛔ 首爆判定必须看**全量**板块名，不是截断后的前 3 个。
   *
   * `upSectors` 只留最强的 3 个；若拿它判重，当刻排第 4 的板块不会被记「已出现」，
   * 它下次冒头时就会被误标成首爆（「次次都首爆」的另一种成因）。
   */
  it('⛔ 当刻排第 4 的板块也算「已出现」，下次冒头不得标首爆', () => {
    const many = (m: number, names: Array<[string, number]>) =>
      normalBlock(
        m,
        slot(m, {
          intradayUp: names.map(([n, zc]) => ie('sector_up', n, { zt_count: zc })),
        }),
      )
    const { container } = render(
      <TimelineSnake
        blocks={[
          // 甲最多 → 前 3 是甲/乙/丙，丁排第 4（截断之外）
          many(10 * 60, [['甲板块', 5], ['乙板块', 4], ['丙板块', 3], ['丁板块', 1]]),
          // 20 分钟后丁板块独走强 → 它早已出现过，只能是 +2
          many(10 * 60 + 20, [['丁板块', 2]]),
        ]}
        {...props}
        {...instant}
        width={W}
      />,
    )
    const texts = Array.from(container.querySelectorAll('[data-label-tier]')).map((el) =>
      el.textContent?.trim() ?? '',
    )
    expect(texts.some((t) => t.endsWith('首爆·丁板块')), texts.join(' | ')).toBe(false)
    expect(texts.some((t) => t.endsWith('丁板块+2')), texts.join(' | ')).toBe(true)
  })
})

/**
 * 一个节点同挂上下两条标签（2026-10-20 用户：「一个节点可以同时显示上下两条线路数据！」）。
 *
 * ⛔ 旧实现是 `themeTagOf` 返回单个 tag，走强分支直接 return ——
 *    「某板块走强的同一分钟恰好有另一个板块走弱」时，走弱那条被整条吞掉，
 *    页面照常渲染、不报错，只有肉眼能发现少了一行。
 */
describe('TimelineSnake · 同一节点上下双标签', () => {
  it('同时有板块走强 + 板块走弱 → 上下各出一条，互不吞并', () => {
    const both = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayUp: [ie('sector_up', '机器人')],
        intradayDown: [ie('sector_down', '医药', { pct: -3.2 })],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[both]} {...props} {...instant} width={W} />)
    const labels = Array.from(nodeAt(container, '10:00').querySelectorAll('[data-label-tier]'))
    expect(labels).toHaveLength(2)
    const up = labels.find((el) => el.getAttribute('data-label-dir') === 'up')
    const down = labels.find((el) => el.getAttribute('data-label-dir') === 'down')
    expect(up?.textContent ?? '', '上区 = 走强').toContain('机器人')
    expect(down?.textContent ?? '', '下区 = 走弱').toContain('医药走弱')
    // 上下各一条引导线
    const leaders = Array.from(nodeAt(container, '10:00').querySelectorAll('[data-label-leader]'))
    expect(leaders).toHaveLength(2)
  })

  it('只有个股回落（非板块）→ 下区不出标签（个股降权）', () => {
    const stockOnly = normalBlock(
      10 * 60,
      slot(10 * 60, { intradayUp: [ie('sector_up', '机器人')], otherDownCount: 3 } as never),
    )
    const { container } = render(<TimelineSnake blocks={[stockOnly]} {...props} {...instant} width={W} />)
    const downs = nodeAt(container, '10:00').querySelectorAll('[data-label-dir="down"]')
    expect(downs).toHaveLength(0)
  })

  /**
   * 消息面（2026-10-20 用户：「消息面也要提示，目前还是很多空白」）。
   *
   * `pushed_topics` 早已建成独立 push 节点，但轴上不给标签 → 每个推送时刻只剩一个灰点。
   * 现规则：落在**下区空位**（有走弱时让位），灰色引导线 + 「消息·」前缀。
   */
  it('只有推送的节点 → 下区出「消息·题材」标签，且引导线不是走弱的绿线', () => {
    const pushed = normalBlock(
      10 * 60,
      slot(10 * 60, {
        pushes: [
          {
            name: '机器人',
            type: 'sector',
            first_pushed: '10:00',
            last_pushed: '10:00',
            push_count: 2,
            context: '特斯拉Optimus催化',
            last_catalyst: '',
          },
        ] as never,
      }),
    )
    const { container } = render(<TimelineSnake blocks={[pushed]} {...props} {...instant} width={W} />)
    const node = nodeAt(container, '10:00')
    // ⛔ 必须带 `[data-label-tier]`：引导线也有 `data-label-dir`，只用 dir 会选到没有文字的那根线
    const down = node.querySelector('[data-label-tier][data-label-dir="down"]')
    expect(down?.textContent ?? '').toContain('消息·机器人')
    // 引导线走中性灰，⛔ 不能沿用它所在下半区的绿线
    const leader = node.querySelector('[data-label-leader][data-label-dir="down"]') as Element
    expect(leader.getAttribute('class') ?? '').toContain('bg-line-strong/70')
    expect(leader.getAttribute('class') ?? '').not.toContain('bg-down')
  })

  it('同时有板块走弱 + 推送 → 走弱优先，消息不抢位置', () => {
    const both = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayDown: [ie('sector_down', '医药', { pct: -3 })],
        pushes: [{ name: '机器人', type: 'sector', first_pushed: '10:00', last_pushed: '10:00', push_count: 1, context: '', last_catalyst: '' }] as never,
      }),
    )
    const { container } = render(<TimelineSnake blocks={[both]} {...props} {...instant} width={W} />)
    const down = nodeAt(container, '10:00').querySelector('[data-label-tier][data-label-dir="down"]')
    expect(down?.textContent ?? '').toContain('医药走弱')
    expect(down?.textContent ?? '').not.toContain('消息·')
  })

  /**
   * 短线精灵（消息面第二档 · 2026-10-20 用户：「消息面呢？这边是否介入快讯
   * 【短线精灵 + 终端！！】」）。
   *
   * 数据来自 `short_spirit_signals.json` 的 `signals_today[].first_seen`，
   * 在页面层转成 `signal_new` 事件并入分钟槽。轴上的规则：
   *   · 下区第三顺位（板块走弱 > 消息·推送 > 异动·个股）；
   *   · 文案前缀「异动·」，文字半档紫（机会向但未经题材归类）；
   *   · 引导线走中性灰 —— ⛔ 不能因为它落在下半区就画绿线（会被读成「在跌」）。
   */
  it('只有短线精灵信号的节点 → 下区出「异动·个股」标签，引导线是中性灰不是绿', () => {
    const sig = normalBlock(
      10 * 60,
      slot(10 * 60, { intradayUp: [ie('signal_new', '博汇股份', { code: '300839', pct: 16.02, type: '接近涨停', strength: 0.46 })] }),
    )
    const { container } = render(<TimelineSnake blocks={[sig]} {...props} {...instant} width={W} />)
    const node = nodeAt(container, '10:00')
    const down = node.querySelector('[data-label-tier][data-label-dir="down"]')
    expect(down?.textContent ?? '').toContain('异动·博汇股份')
    const leader = node.querySelector('[data-label-leader][data-label-dir="down"]') as Element
    expect(leader.getAttribute('class') ?? '').toContain('bg-line-strong/70')
    expect(leader.getAttribute('class') ?? '', '异动不是走弱，禁绿线').not.toContain('bg-down')
    // 消息面第一档优先：推送在时，异动让位
  })

  it('推送与短线精灵同刻 → 「消息·」优先，「异动·」让位（⛔ 不叠两条消息）', () => {
    const both = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayUp: [ie('signal_new', '博汇股份', { code: '300839' })],
        pushes: [{ name: '机器人', type: 'sector', first_pushed: '10:00', last_pushed: '10:00', push_count: 1, context: '', last_catalyst: '' }] as never,
      }),
    )
    const { container } = render(<TimelineSnake blocks={[both]} {...props} {...instant} width={W} />)
    const down = nodeAt(container, '10:00').querySelector('[data-label-tier][data-label-dir="down"]')
    expect(down?.textContent ?? '').toContain('消息·机器人')
    expect(down?.textContent ?? '').not.toContain('异动·')
  })

  it('⛔ 短线精灵不得把节点染成「个股走强」红圆（它是消息面，不是走强）', () => {
    const sig = normalBlock(
      10 * 60,
      slot(10 * 60, { intradayUp: [ie('signal_new', '博汇股份', { code: '300839' })] }),
    )
    const { container } = render(<TimelineSnake blocks={[sig]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind'), '消息面节点应保持中性').not.toBe('up')
  })

  /**
   * ⛔ 同一时刻只标一次（用户反复强调「同一件事实全卡只说一次」）。
   *
   * 下区标签自带时钟 → 上区再挂一根「纯时刻」标签会让 10:00 在节点上下各出现一次，
   * 看上去像两个不同的时刻。
   */
  it('下区已有标签时，上区不再重复标同一时刻（只留一条）', () => {
    const pushed = normalBlock(
      10 * 60,
      slot(10 * 60, {
        pushes: [{ name: '机器人', type: 'sector', first_pushed: '10:00', last_pushed: '10:00', push_count: 1, context: '', last_catalyst: '' }] as never,
      }),
    )
    const { container } = render(<TimelineSnake blocks={[pushed]} {...props} {...instant} width={W} />)
    const labels = Array.from(nodeAt(container, '10:00').querySelectorAll('[data-label-tier]'))
    expect(labels, '同一时刻不能上下各标一次').toHaveLength(1)
    expect(labels[0].getAttribute('data-label-dir')).toBe('down')
  })

  /**
   * 外部快讯（`newsflash_new`）—— 消息面**第一档**。
   *
   * 落盘在 `intraday_timeline_<date>.jsonl`（`scripts/intraday_timeline.py` 按 id 去重、
   * 时刻取快讯自己的 `ctime`），故它是真能落到分钟轴的「消息本身」。
   * 轴上只留前半句（快讯标题 30+ 字会横跨好几个节点），全文进 hover 明细。
   */
  it('外部快讯 → 下区「快讯·」标签；长标题在轴上截断，全文留在明细', () => {
    const title = '工信部：加快推进人形机器人产业创新发展与场景落地'
    const nf = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayUp: [
          ie('newsflash_new', title, { title, plates: ['机器人'], stocks: ['科森科技'], id: '1300001' }),
        ],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[nf]} {...props} {...instant} width={W} />)
    const node = nodeAt(container, '10:00')
    const down = node.querySelector('[data-label-tier][data-label-dir="down"]')
    const text = down?.textContent ?? ''
    expect(text).toContain('快讯·工信部：加快推进人')
    expect(text, '轴上不得出现整条 30+ 字标题').not.toContain('场景落地')
    expect(text).toContain('…')
    // 全文必须能在明细里读到（截断只在轴上，不在数据里）
    fireEvent.mouseEnter(node)
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent ?? '').toContain('场景落地')
    /**
     * ⛔ 明细里消息面必须**单列一段**：塞进「盘中走强与涨停变化」的红框，
     * 会让「有条消息」被读成「这个板块在涨」。文案上「消息面」段要出现在标题之前。
     */
    const detail = dialog.textContent ?? ''
    expect(detail).toContain('消息面')
    expect(detail.indexOf('消息面'), '快讯应归入消息面段，而不是走强段').toBeLessThan(detail.indexOf('场景落地'))
  })

  it('⛔ 快讯与板块走弱同刻 → 走弱优先（风险在前，消息让位）', () => {
    const both = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayUp: [ie('newsflash_new', '某快讯标题很长很长', { title: '某快讯标题很长很长' })],
        intradayDown: [ie('sector_down', '医药', { pct: -3 })],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[both]} {...props} {...instant} width={W} />)
    const down = nodeAt(container, '10:00').querySelector('[data-label-tier][data-label-dir="down"]')
    expect(down?.textContent ?? '').toContain('医药走弱')
    expect(down?.textContent ?? '').not.toContain('快讯·')
  })
})

/**
 * ## 兜底描述：每个点位都要读得出「发生了什么」（2026-10-22 用户：「这些点位的描述呢？」）
 *
 * 用户截图上有一长串**只有图标、没有任何文字**的 × 点位。两个成因：
 *   ① `downTagOf` 到 `return null` 为止只覆盖「板块走弱/快讯/消息/异动」四类，
 *      **炸板、跌停、打开涨停、新封板**一律不给标签 → 那些点位彻底沉默；
 *   ② 密集段三层一满，上区标签被直接丢弃 —— 不是没数据，是排版吞了。
 *
 * ⛔ 兜底顺序按信息量：有名字的（炸板/跌停/打开/涨停·名字）＞ 只有数字的（涨停-1）＞ 只有只数的（回落·N只）。
 * ⛔ 炸板仍是 70% 琥珀（「炸板降权」，弱化 ≠ 隐藏）。
 */
describe('TimelineSnake · 每个点位都有描述（兜底标签）', () => {
  const downOf = (c: HTMLElement) =>
    nodeAt(c, '10:00').querySelector('[data-label-tier][data-label-dir="down"]')
  const upOf = (c: HTMLElement) =>
    nodeAt(c, '10:00').querySelector('[data-label-tier][data-label-dir="up"]')

  it('只有炸板 → 下区「炸板·个股名」，引导线琥珀（不是走弱绿）', () => {
    const b = normalBlock(10 * 60, slot(10 * 60, { intradayDown: [ie('broken_new', '天马科技')] }))
    const { container } = render(<TimelineSnake blocks={[b]} {...props} {...instant} width={W} />)
    expect(downOf(container)?.textContent ?? '').toContain('炸板·天马科技')
    const leader = nodeAt(container, '10:00').querySelector('[data-label-leader][data-label-dir="down"]') as Element
    expect(leader.getAttribute('class') ?? '').toContain('bg-break/45')
    expect(leader.getAttribute('class') ?? '', '炸板不是走弱').not.toContain('bg-down')
  })

  it('只有跌停 → 下区「跌停·个股名」', () => {
    const b = normalBlock(10 * 60, slot(10 * 60, { intradayDown: [ie('limit_down_new', '德才股份')] }))
    const { container } = render(<TimelineSnake blocks={[b]} {...props} {...instant} width={W} />)
    expect(downOf(container)?.textContent ?? '').toContain('跌停·德才股份')
  })

  it('新封板（zt_total.added 带名字）→ 上区「涨停·个股名」，不是干巴巴的「涨停+1」', () => {
    const b = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayUp: [
          ie('zt_total', '', {
            total: 31,
            delta: 1,
            added: [{ code: '300839', name: '博汇股份' }],
            removed: [],
          }),
        ],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[b]} {...props} {...instant} width={W} />)
    const text = upOf(container)?.textContent ?? ''
    expect(text).toContain('涨停·博汇股份')
    expect(text, '有名字就不该只写数字').not.toContain('涨停+1')
  })

  it('打开涨停（zt_total.removed 带名字）→ 下区「打开·个股名」', () => {
    const b = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayDown: [
          ie('zt_total', '', {
            total: 30,
            delta: -1,
            added: [],
            removed: [{ code: '600551', name: '出版传媒' }],
          }),
        ],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[b]} {...props} {...instant} width={W} />)
    const text = downOf(container)?.textContent ?? ''
    expect(text).toContain('打开·出版传媒')
    expect(text, '有名字就不该退化成「涨停-1」').not.toContain('涨停-1')
  })

  it('⛔ 兜底不得顶掉更重要的标签：同刻有板块走弱 → 仍显示走弱', () => {
    const b = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayDown: [ie('sector_down', '医药', { pct: -3 }), ie('broken_new', '天马科技')],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[b]} {...props} {...instant} width={W} />)
    const text = downOf(container)?.textContent ?? ''
    expect(text).toContain('医药走弱')
    expect(text, '炸板兜底只能填空位，不能抢板块走弱的位').not.toContain('炸板·')
  })
})

/**
 * ## 密集段不许「丢标签」，只许「缩形态」（2026-10-22）
 *
 * 18.8px/分钟的密集段，三层跑道很容易被邻座占满。上一版直接丢弃 → 用户看到一串
 * 没有任何描述的点位。现在退到**紧凑形态**（不渲染时刻，省 ~31px）再试一次。
 *
 * ⛔ 缩的是排版冗余（时刻在邻近标签上仍读得到），不是事实。
 */
describe('TimelineSnake · 密集段紧凑降级', () => {
  it('三层被占满时，标签退到紧凑形态而不是消失', () => {
    // 每分钟一个节点、全部带题材名 —— 宽度 900 下三层必定挤爆
    const blocks = Array.from({ length: 14 }, (_, i) =>
      normalBlock(
        10 * 60 + i,
        slot(10 * 60 + i, { intradayUp: [ie('sector_up', `板块名${i}`)] }),
      ),
    )
    const { container } = render(<TimelineSnake blocks={blocks} {...props} {...instant} width={900} />)
    const labels = Array.from(container.querySelectorAll('[data-label-tier][data-label-dir="up"]')).map(
      (el) => el.textContent?.trim() ?? '',
    )
    // 至少有一条紧凑形态（无时刻前缀）—— 这条是「降级生效」的直接证据
    expect(labels.some((t) => !/^\d\d:\d\d/.test(t)), `实际：${labels.join(' | ')}`).toBe(true)
    // 且不是只剩零星一两条（14 个密集节点至少要标出 6 条）
    expect(labels.length, `实际：${labels.join(' | ')}`).toBeGreaterThanOrEqual(6)
  })
})

/**
 * 炸板（打开涨停）→ 黄色缺口环（2026-10-20 用户：「打开涨停可以提示为黄色节点」）。
 *
 * ⛔ 必须与「板块走弱（绿叉）」分开：炸板是涨停被打断，不是板块普跌。
 *    旧实现里 broken_new 被并进 otherDownCount，只能画成绿叉，和走弱完全同形同色。
 *
 * ## ⛔⛔ 同日晚些时候用户两次修正，最终口径「降权 ≠ 不显示」
 *
 * ①「炸板炸板不需要……还是首爆优先，炸板不需要权重，你这全是炸板了！！」
 *   → 炸板降到**最低权重**：有首爆 / 走弱 / 走强 / 轮动一律让位。
 * ②「我说降低权重不是不显示哈，当节点没有更多重要信息的时候，单一个股信息还是可以显示的！！」
 *   → 上一版加的「≥2 只才显示」门槛把单票炸板整个藏掉了，属于把降权做成删除。
 *     现在单票照样画黄环，只是降到 70% 透明（成批才满色）。
 */
describe('TimelineSnake · 炸板黄环（最低权重，但单票也显示）', () => {
  it('成批炸板（≥2 只）且无其它信号 = 满色黄色缺口环', () => {
    const broken = normalBlock(
      10 * 60,
      slot(10 * 60, { intradayDown: [ie('broken_new', '慈文传媒'), ie('broken_new', '华脉科技')] }),
    )
    const { container } = render(<TimelineSnake blocks={[broken]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind')).toBe('broken')
    expect(mark.getAttribute('data-node-shape')).toBe('ring-gap')
    expect(mark.getAttribute('class') ?? '').toContain('text-break')
    expect(mark.getAttribute('class') ?? '', '成批炸板不该被弱化').not.toContain('text-break/70')
    // 缺口环：stroke-dasharray 留缺口（不是实心圆、也不是叉）
    const circle = mark.querySelector('circle')
    expect(circle?.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(circle?.getAttribute('fill')).toBe('none')
  })

  /**
   * ⛔ 2026-10-20 用户：「降低权重不是不显示，当节点没有更多重要信息的时候，
   *    单一个股信息还是可以显示的」—— 单票炸板必须还是个黄环，只是淡一档。
   */
  it('单票炸板 → 仍然是黄环，但降为 70% 透明（弱化 ≠ 隐藏）', () => {
    const broken = normalBlock(10 * 60, slot(10 * 60, { intradayDown: [ie('broken_new', '慈文传媒')] }))
    const { container } = render(<TimelineSnake blocks={[broken]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind'), '单票炸板不得退化成灰细线').toBe('broken')
    expect(mark.getAttribute('data-node-shape')).toBe('ring-gap')
    expect(mark.getAttribute('class') ?? '', '单票炸板弱化显示').toContain('text-break/70')
  })

  it('⛔ 炸板 + 板块走弱 → 让位给绿叉（炸板不抢风险）', () => {
    const broken = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayDown: [ie('broken_new', '慈文传媒'), ie('sector_down', '医药', { pct: -3 })],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[broken]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind'), '板块走弱应压过炸板').toBe('risk')
  })

  it('⛔ 炸板 + 首爆 → 首爆优先（用户：「还是首爆优先」）', () => {
    const burst = normalBlock(
      11 * 60,
      slot(11 * 60, {
        intradayDown: [ie('broken_new', '慈文传媒')],
        events: [
          {
            time: '11:00',
            event: '新主线崛起：光通信 涨停7只，龙头 华脉科技',
            severity: 'high',
            topic: '光通信',
          },
        ],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[burst]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '11:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind'), '首爆应压过炸板').toBe('burst')
    expect(mark.getAttribute('data-node-shape')).toBe('sparkle')
  })

  it('炸板 + 首次板块走强 → 让位（标题是「首爆」，图标就得是星）', () => {
    const broken = normalBlock(
      10 * 60,
      slot(10 * 60, {
        // 该板块当日第一次出现 → 标签首爆 → 图标必须跟标签一致
        intradayUp: [ie('sector_up', '机器人')],
        intradayDown: [ie('broken_new', '慈文传媒')],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[broken]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind')).toBe('burst')
  })

  it('炸板 + 非首次的板块走强 → 走强圆点（标题是 +N，图标是圆）', () => {
    const first = normalBlock(9 * 60 + 40, slot(9 * 60 + 40, { intradayUp: [ie('sector_up', '机器人')] }))
    const broken = normalBlock(
      10 * 60,
      slot(10 * 60, {
        intradayUp: [ie('sector_up', '机器人')],
        intradayDown: [ie('broken_new', '慈文传媒')],
      }),
    )
    const { container } = render(
      <TimelineSnake blocks={[first, broken]} {...props} {...instant} width={W} />,
    )
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind')).toBe('up')
  })

  it('⛔ 跌停节点仍是绿叉（只降炸板，别把跌停一起降成灰线）', () => {
    const ld = normalBlock(10 * 60, slot(10 * 60, { intradayDown: [ie('limit_down_new', '风险股')] }))
    const { container } = render(<TimelineSnake blocks={[ld]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind')).toBe('risk')
    expect(mark.getAttribute('data-node-shape')).toBe('cross')
  })

  it('无炸板时不会误标成黄环', () => {
    const normal = normalBlock(10 * 60, slot(10 * 60, { intradayUp: [ie('sector_up', '机器人')] }))
    const { container } = render(<TimelineSnake blocks={[normal]} {...props} {...instant} width={W} />)
    const mark = nodeAt(container, '10:00').querySelector('[data-node-kind]') as Element
    expect(mark.getAttribute('data-node-kind')).not.toBe('broken')
  })
})

/**
 * ## 弹窗宽度必须**跟着内容走**（2026-10-22 用户第二次纠正）
 *
 * 用户原话：「弹窗的宽度自适应啊。弹窗宽度没有自适应，现在宽度很宽，留白太大了！！」
 *
 * 演进：写死 `980` → `容器×0.82` → 本版「按内容量估宽」。
 * 中间那版之所以被否，是因为 `容器×0.82` **仍是个固定值**：
 * `14:30` 只有 4 行内容（涨停总数 / 新增封板 / 走弱板块 / 跌停）也照样 1052px，右侧全空。
 *
 * ⛔ 试过 CSS `width: max-content`，不行 —— 内部 `flex-wrap` + `grid(1fr)` 在
 *    `max-content` 下会被压塌（实测 37 行内容只算出 365px、高 548px，挤成一列）。
 */
describe('TimelineSnake · 弹窗宽度跟着内容走', () => {
  const dialogW = (c: HTMLElement) => {
    const dlg = dialogOf(c)!
    return Number.parseFloat(dlg.style.width) * Number.parseFloat(dlg.style.zoom || '1')
  }

  it('内容少的节点 → 弹窗窄（不再撑满容器，消除右侧留白）', () => {
    // 只有一个板块走弱 + 一只炸板：信息量很小
    const tiny = normalBlock(
      10 * 60,
      slot(10 * 60, { intradayDown: [ie('sector_down', '广告媒体', { pct: -2.6 }), ie('broken_new', '冰山冷热')] }),
    )
    const { container } = render(<TimelineSnake blocks={[tiny]} {...props} {...instant} width={W} />)
    fireEvent.mouseEnter(nodeAt(container, '10:00'))
    const w = dialogW(container)
    expect(w, `内容只有 2 条，弹窗不该撑到容器级宽度（实际 ${w}px）`).toBeLessThan(520)
  })

  it('内容多的节点 → 弹窗明显更宽（同一容器下对比，不是同一个固定值）', () => {
    const rich = normalBlock(
      11 * 60,
      slot(11 * 60, {
        sectors: [sec('光通信', 4), sec('半导体', 3), sec('医药', 2)],
        intradayUp: [
          ie('sector_up', '机器人', { zt_count: 6 }),
          ie('sector_up', '云计算数据中心', { zt_count: 3 }),
          ie('sector_up', '网络安全', { zt_count: 2 }),
        ],
        intradayDown: [ie('sector_down', '白银', { pct: -6.49 }), ie('broken_new', '慈文传媒'), ie('broken_new', '华脉科技')],
        events: [
          {
            time: '11:00',
            event: '新主线崛起：光通信 涨停7只，龙头 华脉科技（含光模块与光芯片两条支线）',
            severity: 'high',
            topic: '光通信',
          },
        ],
      }),
    )
    const { container } = render(<TimelineSnake blocks={[rich]} {...props} {...instant} width={W} />)
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    const w = dialogW(container)
    expect(w, `内容明显更多，弹窗应更宽（实际 ${w}px）`).toBeGreaterThan(560)
  })

  it('⛔ 宽度永不超过容器（自适应 ≠ 允许溢出）', () => {
    const rich = normalBlock(
      11 * 60,
      slot(11 * 60, {
        intradayUp: Array.from({ length: 20 }, (_, i) => ie('sector_up', `板块${i}`, { zt_count: 3 })),
        intradayDown: Array.from({ length: 12 }, (_, i) => ie('broken_new', `炸板股${i}`)),
      }),
    )
    const narrow = 600
    const { container } = render(
      <TimelineSnake blocks={[rich]} {...props} {...instant} width={narrow} />,
    )
    fireEvent.mouseEnter(nodeAt(container, '11:00'))
    expect(dialogW(container), '窄容器里弹窗必须收进来').toBeLessThanOrEqual(narrow - 16)
  })
})
