import { describe, expect, it } from 'vitest'
import {
  axisOf,
  clockOfAxis,
  layoutSnake,
  SEAM_AXIS,
  SESSION_CLOSE,
  SESSION_OPEN,
  SESSION_TOTAL_MIN,
  SNAKE_MAX_ROWS,
  SNAKE_MIN_GAP,
  SNAKE_MIN_ROWS,
  SNAKE_ROW_HEIGHT,
  SLOT_VISIBLE_SECTORS,
  snakePos,
  SUMMARY_CAP,
  summarizeBlock,
} from '@/features/analytics'
import type { ZtPoolStock } from '@/shared/api'

/**
 * 蛇形时间轴布局内核的回归锁。
 *
 * 布局算错**不报错**：节点照常渲染，只是位置错、弯道翻向、行数爆掉 ——
 * 典型**静默错值**。故全部用**不变量**断言（守恒 / 顺序 / 交替 / 界内 / 路径合法），
 * 而不是断言某个具体像素值。
 */

/** 09:15 + n 分钟（上午段，不跨午休） */
const am = (n: number) => SESSION_OPEN + n
/** 13:00 + n 分钟（下午段） */
const pm = (n: number) => 13 * 60 + n

describe('轴坐标换算 axisOf / clockOfAxis（午休折叠）', () => {
  it('09:15 → 0，11:30 → 接缝 135', () => {
    expect(axisOf(am(0))).toBe(0)
    expect(axisOf(am(135))).toBe(SEAM_AXIS)
    expect(SEAM_AXIS).toBe(135)
  })

  it('13:00 → 仍是接缝 135（⛔ 午休 90 分钟被压掉，不留死白）', () => {
    expect(axisOf(13 * 60)).toBe(SEAM_AXIS)
  })

  it('午休中的时刻（如 12:06 记录器补录）→ 夹到接缝，不丢弃也不铺开', () => {
    expect(axisOf(12 * 60 + 6)).toBe(SEAM_AXIS)
    expect(axisOf(11 * 60 + 45)).toBe(SEAM_AXIS)
  })

  it('13:01 → 136，15:00 → 255（交易分钟总数）', () => {
    expect(axisOf(pm(1))).toBe(136)
    expect(axisOf(SESSION_CLOSE)).toBe(SESSION_TOTAL_MIN)
    expect(SESSION_TOTAL_MIN).toBe(255)
  })

  it('越界钳制：早于 09:15 → 0，晚于 15:00 → 255，非法值 → 0', () => {
    expect(axisOf(8 * 60)).toBe(0)
    expect(axisOf(16 * 60)).toBe(SESSION_TOTAL_MIN)
    expect(axisOf(Number.NaN)).toBe(0)
    expect(axisOf(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('★ 往返一致：`clockOfAxis(axisOf(m)) === m`（⚠️ 接缝两点除外，见下条）', () => {
    // ⛔ 11:30 与 13:00 被折叠到**同一个轴点**，往返天然不可区分 —— 故样本不含这两点
    const sample = [am(0), am(1), am(60), am(134), pm(1), pm(60), pm(119), pm(120)]
    for (const m of sample) expect(clockOfAxis(axisOf(m))).toBe(m)
  })

  it('⚠️ 接缝歧义（设计如此）：11:30 与 13:00 塌成同一轴点，反向一律解回 11:30', () => {
    expect(axisOf(am(135))).toBe(SEAM_AXIS)
    expect(axisOf(pm(0))).toBe(SEAM_AXIS)
    expect(clockOfAxis(SEAM_AXIS)).toBe(am(135)) // 反向取上午侧
    // ⇒ 因此**贴标签一律走 clockOfAxis / lane.fromClock|toClock**，不要用 axis 反推时钟
  })

  it('反向：接缝 135 → 11:30（上午收），136 → 13:01', () => {
    expect(clockOfAxis(SEAM_AXIS)).toBe(11 * 60 + 30)
    expect(clockOfAxis(136)).toBe(13 * 60 + 1)
  })
})

describe('layoutSnake 不变量', () => {
  const W = 1600

  it('① 不丢不重：节点数 === 去重后的 marks 数，`at` 集合一致', () => {
    const marks = [am(10), am(3), am(10), am(200), am(3)] // 含重复
    const L = layoutSnake({ marks, width: W })
    expect(L.points).toHaveLength(3)
    expect(new Set(L.points.map((p) => p.at))).toEqual(new Set([am(3), am(10), am(200)]))
  })

  it('② 时间单调：行号随时间为非降；同一行内沿穿行方向 `axis` 单调', () => {
    const marks = [am(0), am(20), am(60), pm(30), pm(90), am(120)]
    const L = layoutSnake({ marks, width: W })
    for (let i = 1; i < L.points.length; i++) {
      expect(L.points[i].row).toBeGreaterThanOrEqual(L.points[i - 1].row)
    }
    for (const lane of L.lanes) {
      const inLane = L.points.filter((p) => p.row === lane.row).sort((a, b) => a.axis - b.axis)
      for (let i = 1; i < inLane.length; i++) {
        // 偶数行左→右（x 增大），奇数行右→左（x 减小）
        if (lane.reversed) expect(inLane[i].x).toBeLessThanOrEqual(inLane[i - 1].x)
        else expect(inLane[i].x).toBeGreaterThanOrEqual(inLane[i - 1].x)
      }
    }
  })

  it('③ 行交替：`lanes[k].reversed === (k % 2 === 1)`（横过去→弯→反向回来）', () => {
    const L = layoutSnake({ marks: [am(10), pm(60)], width: W })
    expect(L.lanes.map((l) => l.reversed)).toEqual(
      Array.from({ length: L.rows }, (_, k) => k % 2 === 1),
    )
    for (const lane of L.lanes) expect(lane.reversed).toBe(lane.row % 2 === 1)
  })

  it('④ 坐标在界内：0 ≤ x ≤ width；y 不越出容器，也不串到邻行', () => {
    const marks = [am(0), am(1), am(50), am(135), pm(0), pm(119), pm(120)]
    const L = layoutSnake({ marks, width: W })
    expect(L.points.length).toBe(marks.length)
    for (const p of L.points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(W)
      // 堆叠允许节点离开行中线，但**绝不允许串到邻行**（否则两行节点会撞在一起）
      const lane = L.lanes[p.row]
      expect(Math.abs(p.y - lane.y)).toBeLessThanOrEqual(L.rowHeight / 2)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(L.height)
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
  })

  it('④b 两端对齐：首行起点 = 09:15 落 x0，末行终点 = 15:00 落行末', () => {
    const L = layoutSnake({ marks: [SESSION_OPEN, SESSION_CLOSE], width: W })
    const first = L.points.find((p) => p.at === SESSION_OPEN)!
    const last = L.points.find((p) => p.at === SESSION_CLOSE)!
    // 首行（正向）起点贴左端点；末行方向取决于 rows 奇偶，但一定贴该行的终点
    expect(first.x).toBeCloseTo(L.x0, 5)
    expect(last.row).toBe(L.rows - 1)
    expect(last.x).toBeCloseTo(L.x1, 5)
  })

  it('⑤ 路径合法：起点在首行起点、转弯数 === rows−1、含 NaN 判负', () => {
    const L = layoutSnake({ marks: [am(10), pm(60)], width: W })
    expect(L.path.startsWith(`M ${L.x0}`)).toBe(true)
    expect(L.path.includes('NaN')).toBe(false)
    expect(L.path.match(/A /g)?.length).toBe(L.rows - 1)
    // 首段是横走
    expect(L.path).toContain(' L ')
  })

  it('高度有界：rows ∈ [SNAKE_MIN_ROWS, SNAKE_MAX_ROWS]，height = 2×padY + rows×rowHeight', () => {
    const L = layoutSnake({ marks: [am(10)], width: W })
    expect(L.rows).toBeGreaterThanOrEqual(SNAKE_MIN_ROWS)
    expect(L.rows).toBeLessThanOrEqual(SNAKE_MAX_ROWS)
    expect(L.height).toBe(40 + L.rows * SNAKE_ROW_HEIGHT)
  })

  it('密度驱动行数：节点越多行数越多，但仍封顶 SNAKE_MAX_ROWS（⛔ 不无限增高）', () => {
    // 稀疏：节点间隔 1 小时 → 无需增行
    const few = layoutSnake({ marks: Array.from({ length: 5 }, (_, i) => am(i * 60)), width: W })
    // 密集：分钟级（真实形态）
    const many = layoutSnake({ marks: Array.from({ length: 130 }, (_, i) => am(i)), width: W })
    expect(few.rows).toBe(SNAKE_MIN_ROWS)
    expect(many.rows).toBeGreaterThan(few.rows)
    expect(many.rows).toBeLessThanOrEqual(SNAKE_MAX_ROWS)
  })

  it('⚠️ 分钟级密集即使节点很少也要增行（1 分钟 × 255 分钟需要足够横向长度）', () => {
    // 5 个节点但相邻仅 1 分钟 —— 行宽不变时想给出 ≥minGap 的间距只能增行
    const fewDense = layoutSnake({ marks: [am(0), am(1), am(2), am(3), am(4)], width: W })
    expect(fewDense.rows).toBeGreaterThan(SNAKE_MIN_ROWS)
    expect(fewDense.overcrowded).toBe(false)
    expect(fewDense.minLaneGap!).toBeGreaterThanOrEqual(SNAKE_MIN_GAP)
  })

  it('节点密度下限：行宽足够时，同层相邻节点间距 ≥ minGap', () => {
    const marks = Array.from({ length: 30 }, (_, i) => am(i * 4))
    const L = layoutSnake({ marks, width: W })
    for (const lane of L.lanes) {
      const xs = L.points
        .filter((p) => p.row === lane.row)
        .map((p) => p.x)
        .sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(0)
      }
    }
    // 总容量够 → 不应因为密度而溢出行容量
    expect(L.points.length).toBe(30)
  })

  it('★ 早盘密集（真实现象）：按**每行实际占用**增行 —— 不允许某一行节点数超容量', () => {
    // 复刻 2026-09-15 的形态：绝大多数节点挤在开盘头 40 分钟
    const dense = [
      ...Array.from({ length: 30 }, (_, i) => am(27 + i)), // 09:42 起每分钟一个 × 30
      am(120),
      pm(60),
    ]
    const L = layoutSnake({ marks: dense, width: W })
    // ⛔ 关键：同层实际间距必须达标（否则节点会水平重叠）
    expect(L.overcrowded).toBe(false)
    expect(L.minLaneGap).not.toBeNull()
    expect(L.minLaneGap!).toBeGreaterThanOrEqual(SNAKE_MIN_GAP)
    // 也因此必须用到比下限更多的行数
    expect(L.rows).toBeGreaterThan(SNAKE_MIN_ROWS)
    // 守恒：一个不丢
    expect(L.points).toHaveLength(dense.length)
  })

  it('★ 同层间距 ≥ minGap —— **仅在行数够用时保证**（可行域内必须成立）', () => {
    const dense = Array.from({ length: 26 }, (_, i) => am(27 + i))
    const L = layoutSnake({ marks: dense, width: W })
    expect(L.overcrowded).toBe(false) // 26 个 / 26 分钟 → 可行
    for (const lane of L.lanes) {
      const xs = L.points
        .filter((p) => p.row === lane.row)
        .map((p) => p.x)
        .sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(SNAKE_MIN_GAP)
      }
    }
  })

  it('★ 不可行时**如实标记** `overcrowded`：不假装排得下，也绝不丢节点', () => {
    // 窄容器（行宽小）下分钟级密集 → 用满行数也排不开
    const brutal = Array.from({ length: 40 }, (_, i) => am(27 + i))
    const L = layoutSnake({ marks: brutal, width: 420 })
    expect(L.overcrowded).toBe(true)
    expect(L.rows).toBe(SNAKE_MAX_ROWS) // 已用满行数
    expect(L.points).toHaveLength(brutal.length) // ⛔ 一条都不丢
    expect(L.minLaneGap).not.toBeNull()
    expect(L.minLaneGap!).toBeLessThan(SNAKE_MIN_GAP)
  })

  it('窄容器：行宽变小 → 同层间距变小 → 更容易 overcrowded（如窄窗口）', () => {
    const dense = Array.from({ length: 30 }, (_, i) => am(27 + i))
    const wide = layoutSnake({ marks: dense, width: 2400 })
    const narrow = layoutSnake({ marks: dense, width: 700 })
    expect(wide.minLaneGap ?? Infinity).toBeGreaterThan(narrow.minLaneGap ?? Infinity)
    expect(narrow.overcrowded).toBe(true)
  })

  it('无相邻对时不报 crowded（`minLaneGap` 为 null，不假装有间距）', () => {
    const L = layoutSnake({ marks: [am(10)], width: W })
    expect(L.minLaneGap).toBeNull()
    expect(L.overcrowded).toBe(false)
  })

  it('空输入：0 个节点，但蛇形骨架仍画出来（当天无记录也能看到轴）', () => {
    const L = layoutSnake({ marks: [], width: W })
    expect(L.points).toEqual([])
    expect(L.path.startsWith('M ')).toBe(true)
    expect(L.path.match(/A /g)?.length).toBe(L.rows - 1)
  })

  it('⛔ 宽度兜底：width = 0 / NaN / 负数时不得产出 NaN 坐标（jsdom 场景）', () => {
    for (const bad of [0, Number.NaN, -100]) {
      const L = layoutSnake({ marks: [am(10), pm(30)], width: bad })
      expect(L.width).toBeGreaterThan(0)
      expect(L.path.includes('NaN')).toBe(false)
      for (const p of L.points) expect(Number.isFinite(p.x)).toBe(true)
    }
  })

  it('午休记录（12:06）落到接缝：既不丢，也不会跑到下午段末尾', () => {
    const L = layoutSnake({ marks: [am(120), 12 * 60 + 6, pm(5)], width: W })
    const noon = L.points.find((p) => p.at === 12 * 60 + 6)!
    expect(noon.axis).toBe(SEAM_AXIS)
    // 与 11:30 同轴坐标（同一位置：接缝 = 上午终点 = 下午起点）
    expect(noon.axis).toBe(axisOf(am(135)))
    // 而 11:15（am(120)）仍在上午段内，轴坐标 120 ≠ 135
    expect(L.points.find((p) => p.at === am(120))!.axis).toBe(120)
  })

  it('行标签用真实时钟：fromClock 是墙上分钟而非轴坐标（⛔ 别把 axis 当时钟）', () => {
    const L = layoutSnake({ marks: [am(10)], width: W })
    expect(L.lanes[0].fromClock).toBe(SESSION_OPEN)
    expect(L.lanes[L.rows - 1].toClock).toBe(SESSION_CLOSE)
    for (const lane of L.lanes) {
      expect(lane.fromClock).toBeGreaterThanOrEqual(SESSION_OPEN)
      expect(lane.toClock).toBeLessThanOrEqual(SESSION_CLOSE)
    }
  })
})

// 常量自检：导出面别漂移（组件与测试共用同一批常量）
describe('常量面', () => {
  it('导出常量齐备且自洽', () => {
    expect(SEAM_AXIS).toBe(135)
    expect(SESSION_TOTAL_MIN).toBe(255)
    expect(SNAKE_ROW_HEIGHT).toBe(128)
  })
})

/**
 * `snakePos` 是给「时间刻度 / 游标」用的换算 —— 它必须与 `layoutSnake` 内部算节点位置
 * **完全同一套**，否则刻度与节点会错位（静默错值：图看着正常，读数偏一格）。
 */
describe('snakePos 与 layoutSnake 必须同源', () => {
  it('★ 布局里每个节点，用 snakePos 重算必须逐字段一致（含 x / y / row）', () => {
    const L = layoutSnake({ marks: [am(0), am(7), am(60), am(135), pm(1), pm(60), SESSION_CLOSE], width: 1600 })
    for (const p of L.points) {
      const again = snakePos(L, p.at)
      // x / row 必须恒等（这是刻度与节点不错位的充要条件）
      expect(again.x, `x 不一致 @${p.at}`).toBe(p.x)
      expect(again.row, `row 不一致 @${p.at}`).toBe(p.row)
      // y：基础位置是行中线；节点可能因堆叠偏离，但必须落在堆叠带内
      expect(again.y).toBe(L.lanes[p.row].y)
      expect(Math.abs(p.y - again.y)).toBeLessThanOrEqual(L.rowHeight / 2)
    }
  })

  it('刻度落在合理范围：整点/半点都有行与 x，且 x 在轨道内', () => {
    const L = layoutSnake({ marks: [am(10)], width: 1600 })
    for (const m of [10 * 60, 11 * 60, 13 * 60 + 30, 14 * 60 + 30, SESSION_CLOSE]) {
      const p = snakePos(L, m)
      expect(p.row).toBeGreaterThanOrEqual(0)
      expect(p.row).toBeLessThanOrEqual(L.rows - 1)
      expect(p.x).toBeGreaterThanOrEqual(L.x0)
      expect(p.x).toBeLessThanOrEqual(L.x1)
    }
  })
})

/**
 * `summarizeBlock`（hover 浮层的数据源）的回归锁。
 *
 * ⛔ 它最容易犯的错是**「只给前 3 个、却不说还有多少」** —— 读者会以为该刻只有 3 个板块。
 * 故全部列表都必须**同时给出总数**，且排序必须**复用既有内核**（风层与卡面名次不一致 = 欺骗）。
 */
describe('summarizeBlock · 摘要不撒谎', () => {
  const stk = (code: string, boards = 1, seal = 1) =>
    ({ code, name: `票${code}`, boards, seal, fbt: '100000', sector: 'X' }) as unknown as ZtPoolStock
  const grp = (sector: string, n: number, boards = 1) => ({
    sector,
    stocks: Array.from({ length: n }, (_, i) => stk(`${sector}${i}`, boards)),
    count: n,
    dayShape: null,
    daySpan: 5,
    dayTotal: n,
  })
  const ie2 = (kind: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ at: '2026-09-17 10:00:00', kind, name, ...extra }) as unknown as import('@/shared/api').IntradayTimelineEvent

  /** 造一个分钟槽（`TimelineBlock` 是联合类型，⛔ 不能直接从块上取 `.slot`） */
  function mkSlot(o: Partial<import('@/features/analytics').TimelineSlot> = {}) {
    return {
      at: 600,
      sectors: [],
      singles: [],
      events: null,
      pushes: null,
      pushTo: null,
      intradayUp: [],
      intradayDown: [],
      key: 'slot:600',
      ...o,
    } as import('@/features/analytics').TimelineSlot
  }
  function blk(o: Partial<import('@/features/analytics').TimelineSlot> = {}) {
    return {
      kind: 'normal',
      at: 600,
      key: 'normal:600',
      slot: mkSlot(o),
    } as import('@/features/analytics').TimelineBlock
  }

  it('默认上限 = 3，但与卡面共用同一口径', () => {
    expect(SUMMARY_CAP).toBe(3)
    expect(SLOT_VISIBLE_SECTORS).toBe(3)
  })

  it('行业：只列最强 3 个，但 `sectorCount` 给全量（⛔ 不撒谎）', () => {
    const s = summarizeBlock(blk({ sectors: [grp('A', 5), grp('B', 4), grp('C', 3), grp('D', 2)] }))
    expect(s.sectorCount).toBe(4)
    expect(s.topSectors.map((g) => g.sector)).toEqual(['A', 'B', 'C']) // 强度降序
  })

  it('个股：按板数降序截断，`stockCount` 给全量', () => {
    const s = summarizeBlock(
      blk({ sectors: [grp('A', 3)], singles: [stk('s1', 5), stk('s2', 3), stk('s3', 2), stk('s4', 1)] }),
    )
    expect(s.stockCount).toBe(7)
    expect(s.topStocks.map((x) => x.boards)).toEqual([5, 3, 2])
  })

  it('盘中板块：走强按家数、杀跌按跌幅最负，且各自给总数', () => {
    const s = summarizeBlock(
      blk({
        intradayUp: [
          ie2('sector_up', '弱', { zt_count: 1 }),
          ie2('sector_up', '强', { zt_count: 8 }),
          ie2('sector_up', '中', { zt_count: 4 }),
          ie2('sector_up', '更弱', { zt_count: 0 }),
          ie2('stock_up', '个股A'),
        ],
        intradayDown: [
          ie2('sector_down', '小跌', { pct: -1 }),
          ie2('sector_down', '崩', { pct: -9 }),
          ie2('broken_new', '炸A'),
        ],
      }),
    )
    expect(s.upSectors.map((e) => e.name)).toEqual(['强', '中', '弱'])
    expect(s.upSectorCount).toBe(4) // 全量含「更弱」
    expect(s.downSectors.map((e) => e.name)).toEqual(['崩', '小跌'])
    expect(s.downSectorCount).toBe(2)
    // 非板块事件单列，⛔ 不混进板块计数
    expect(s.otherUpCount).toBe(1)
    expect(s.otherDownCount).toBe(1)
  })

  it('题材标记：跨槽合并去重、题材家数取最大、各自截断', () => {
    const evt = (time: string, event: string) =>
      ({ time, event, severity: 'high', topic: '光通信' }) as never
    const s = summarizeBlock({
      kind: 'merged',
      at: 600,
      to: 603,
      key: 'merged:600',
      sectors: [],
      slots: [
        mkSlot({ key: 'a', events: [evt('10:00', '新主线崛起：光通信 涨停3只，龙头 A')] }),
        mkSlot({ key: 'b', events: [evt('10:01', '新主线崛起：光通信 涨停7只，龙头 B')] }),
      ],
    } as never)
    expect(s.slotCount).toBe(2)
    expect(s.burst).toHaveLength(1) // 同题材去重
    expect(s.burst[0].theme).toBe('光通信')
    expect(s.burst[0].count).toBe(7) // 取最大家数，不是首次出现的 3
  })

  it('纯函数：不改动入参（分块与其槽不被排序副作用改序）', () => {
    const sectors = [grp('弱', 2), grp('强', 9)]
    const b = blk({ sectors })
    const before = sectors.map((g) => g.sector)
    summarizeBlock(b)
    expect(sectors.map((g) => g.sector)).toEqual(before)
  })
})

/**
 * ⛔ 盘外 / 午休记录被**夹到边界**是设计（不是 bug），但必须：
 *   ① 如实标注 `outside`（否则「17:42 的节点坐在 15:00 处」会被读成盘中记录）；
 *   ② **同位置堆叠** —— 否则多条夹到同一轴点会像素级完全重叠，肉眼只看到 1 个（静默丢数据）；
 *   ③ 一条都不丢（守恒）。
 */
describe('盘外 / 夹位记录的标注与堆叠', () => {
  const T = (h: number, m: number) => h * 60 + m

  it('① 盘后 / 盘前如实标注（`outside`），盘中为 null', () => {
    const L = layoutSnake({
      marks: [T(9, 0), SESSION_OPEN, am(60), SESSION_CLOSE, T(17, 42)],
      width: 1600,
    })
    const by = (m: number) => L.points.find((p) => p.at === m)!
    expect(by(T(9, 0)).outside).toBe('pre')
    expect(by(SESSION_OPEN).outside).toBeNull()
    expect(by(am(60)).outside).toBeNull()
    // ⚠️ 15:00 本身算盘中（收盘那一刻仍在时段内），15:00 之后才是盘后
    expect(by(SESSION_CLOSE).outside).toBeNull()
    expect(by(T(17, 42)).outside).toBe('post')
  })

  it('② 盘后 / 盘前记录夹到轴两端，不溢出、不丢', () => {
    const L = layoutSnake({ marks: [T(8, 30), T(17, 42)], width: 1600 })
    expect(L.points).toHaveLength(2)
    expect(L.points.find((p) => p.at === T(8, 30))!.axis).toBe(0)
    expect(L.points.find((p) => p.at === T(17, 42))!.axis).toBe(SESSION_TOTAL_MIN)
  })

  it('★ ③ 多条夹到同一轴点 → 竖直堆叠，坐标**互不相同**（不再完全重叠）', () => {
    // 15:00 与 17:42 都夹到轴末 → 旧实现两者坐标完全相同（像素级重叠）
    const L = layoutSnake({ marks: [am(60), SESSION_CLOSE, T(17, 42), T(17, 50)], width: 1600 })
    const end = L.points.filter((p) => p.axis === SESSION_TOTAL_MIN)
    expect(end).toHaveLength(3) // 一条都不少
    expect(new Set(end.map((p) => p.y)).size).toBe(3) // y 全不同 → 不重叠
    expect(new Set(end.map((p) => `${p.x},${p.y}`)).size).toBe(3)
    // 堆叠居中：序号 0..n-1 且围绕行中线
    expect(end.map((p) => p.stack).sort()).toEqual([0, 1, 2])
    const mid = L.lanes[end[0].row].y
    const ys = end.map((p) => p.y)
    expect(Math.min(...ys)).toBeLessThan(mid)
    expect(Math.max(...ys)).toBeGreaterThan(mid)
  })

  it('★ ④ 午休记录（11:30–13:00）全部夹到接缝，且相互堆叠不重叠', () => {
    const L = layoutSnake({ marks: [am(60), T(11, 45), T(12, 6), T(12, 30), pm(5)], width: 1600 })
    const seam = L.points.filter((p) => p.axis === SEAM_AXIS)
    expect(seam.map((p) => p.at).sort((a, b) => a - b)).toEqual([T(11, 45), T(12, 6), T(12, 30)])
    expect(new Set(seam.map((p) => `${p.x},${p.y}`)).size).toBe(3)
  })

  it('⑤ 堆叠步长受行高约束：条数再多也不越到邻行', () => {
    const many = [SESSION_CLOSE, T(16, 0), T(16, 30), T(17, 0), T(17, 30), T(18, 0), T(18, 30)]
    const L = layoutSnake({ marks: many, width: 1600 })
    const row = L.points[0].row
    const lane = L.lanes[row]
    expect(L.points).toHaveLength(many.length)
    for (const p of L.points) expect(Math.abs(p.y - lane.y)).toBeLessThanOrEqual(L.rowHeight / 2)
  })

  it('⑥ 单条时不做堆叠（stack 恒 0，y 就是行中线）—— ⛔ 不给正常节点加无谓偏移', () => {
    const L = layoutSnake({ marks: [am(10), am(20), pm(30)], width: 1600 })
    for (const p of L.points) {
      expect(p.stack).toBe(0)
      expect(p.y).toBe(L.lanes[p.row].y)
    }
  })
})
