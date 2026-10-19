/** 固定四段（上午两段、下午两段）的日内蛇形时间轴布局内核。 */
export const SESSION_OPEN = 9 * 60 + 25
export const SESSION_AM_END = 11 * 60 + 30
export const SESSION_PM_START = 13 * 60
export const SESSION_CLOSE = 15 * 60
export const SEAM_AXIS = SESSION_AM_END - SESSION_OPEN
export const SESSION_TOTAL_MIN = SEAM_AXIS + (SESSION_CLOSE - SESSION_PM_START)

export const SNAKE_ROW_HEIGHT = 128
export const SNAKE_PAD_X = 10
export const SNAKE_PAD_Y = 20
export const SNAKE_MIN_GAP = 22
export const SNAKE_NODE_W = 26
export const SNAKE_BAR_W = 10
export const SNAKE_BAR_MAX_H = 46
/**
 * 节点**形状**语义（2026-10-18 用户定调）。
 *
 * 原实现所有节点都是同一根 10 × 高 的**椭圆柱体**（`rounded-full`），只用颜色区分性质 ——
 * 用户原话：「不用全部用椭圆柱体，可以用一些三角形、圆形等来标示不同的信号」。
 *
 * 形状比颜色更抗干扰：色盲、强光屏、缩放后色相都会失真，但「三角朝上 / 朝下」不会看错。
 * 故这里把**形状当第一编码、颜色当第二编码**：
 *
 * | 形状 | 信号 | 含义 |
 * |---|---|---|
 * | ▲ 上三角 | 首爆 / 续强 | 资金一次性打进来（最强信号） |
 * | ▼ 下三角 | 风险 / 杀跌 | 炸板、负反馈、板块杀跌 |
 * | ◆ 菱形   | 多板块联动 | 同刻多条线共振 |
 * | ● 实心圆 | 盘中走强 | 有走强，但未构成爆发 |
 * | ○ 空心圆 | 题材轮动 | 旧线回流 / 龙头切换，**不是**新爆发 |
 * | ■ 方块   | 系统记录 | 低频系统观测合并 |
 * | │ 细竖线 | 普通事实 | 单个封板 / 推送点 |
 *
 * ⛔ 尺寸仍表示**活跃度**（高度），形状只表示**性质** —— 两者正交，不要互相替代。
 */
export type SignalKind = 'linkage' | 'risk' | 'burst' | 'rotation' | 'up' | 'system' | 'normal'

export type SignalShape = 'triangle-up' | 'triangle-down' | 'diamond' | 'circle' | 'ring' | 'square' | 'bar'

/**
 * 图标边长（2026-10-18 用户：「三角符号还是一样大吧，不要忽大忽小……就不要控制 icon 的大小了」）。
 *
 * ⛔ 形状图标**尺寸恒定**，不再随活跃度缩放：同一根轴上出现 9px 和 20px 两种三角，
 *    看起来像两种不同的信号，实际只是活跃度不同 —— 这是纯噪声。
 *    活跃度改由**细竖线（普通事实）的高度**表达，其它形状只表达「是什么」。
 */
export const SHAPE_ICON_SIZE = 14

export interface SignalShapeSpec {
  shape: SignalShape
  /** 图例上的名字（≤4 字） */
  label: string
  /** 悬停解释 */
  desc: string
}

export const SIGNAL_SHAPE: Record<SignalKind, SignalShapeSpec> = {
  burst: { shape: 'triangle-up', label: '首爆', desc: '题材首次爆发或续强：大红三角朝上' },
  risk: { shape: 'triangle-down', label: '风险', desc: '炸板 / 负反馈 / 板块杀跌：绿色倒三角' },
  linkage: { shape: 'diamond', label: '联动', desc: '同刻多个板块共振：菱形' },
  up: { shape: 'circle', label: '走强', desc: '板块或个股走强，但未构成爆发：实心圆' },
  rotation: { shape: 'ring', label: '轮动', desc: '旧题材回流或龙头切换，不是新爆发：紫色空心圆' },
  system: { shape: 'square', label: '记录', desc: '低频系统观测合并：灰色小方块' },
  normal: { shape: 'bar', label: '事实', desc: '单个封板 / 推送事实点：灰色细竖线' },
}

/** 图例顺序 = 重要度降序（用户要求「时间轴顶部给每个图形做解释」） */
export const SHAPE_LEGEND_ORDER: readonly SignalKind[] = [
  'burst',
  'risk',
  'linkage',
  'up',
  'rotation',
  'system',
  'normal',
] as const

/**
 * 形状 → 盒子尺寸 + CSS 形状声明（纯函数，便于单测）。
 *
 * `height` 仍由活跃度决定；这里只负责「这个高度下，三角形的底边应该多宽」——
 * 三角/菱形/圆必须是**近似等宽高**才不失真，而细竖线（普通事实）保持窄条，
 * 否则满屏粗条会把真正的信号淹没。
 */
export function shapeBox(
  shape: SignalShape,
  height: number,
  baseWidth = SNAKE_BAR_W,
): { width: number; height: number; clipPath?: string; borderRadius?: number; borderWidth?: number } {
  // 细竖线（普通事实）保留活跃度编码：它是「线」，高度本身就是信息。
  if (shape === 'bar') {
    return { width: baseWidth, height: Math.max(6, Math.round(height)), borderRadius: 9999 }
  }
  // 其余是「图标」：尺寸恒定，只表示性质，不表示强度（见 SHAPE_ICON_SIZE 注释）。
  const S = SHAPE_ICON_SIZE
  switch (shape) {
    case 'triangle-up':
      return { width: S, height: S, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }
    case 'triangle-down':
      return { width: S, height: S, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }
    case 'diamond':
      return { width: S - 2, height: S, clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }
    case 'circle':
      return { width: S - 2, height: S - 2, borderRadius: 9999 }
    case 'ring':
      return { width: S - 3, height: S - 3, borderRadius: 9999, borderWidth: 1.5 }
    case 'square':
      return { width: S - 5, height: S - 5, borderRadius: 2 }
  }
}

/** 版式固定为四根时间轴，不再随节点密度改变行数。 */
export const SNAKE_MIN_ROWS = 4
export const SNAKE_MAX_ROWS = 4

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v * 100) / 100

export function axisOf(wallMin: number): number {
  if (!Number.isFinite(wallMin)) return 0
  if (wallMin <= SESSION_AM_END) return clamp(wallMin - SESSION_OPEN, 0, SEAM_AXIS)
  if (wallMin < SESSION_PM_START) return SEAM_AXIS
  return clamp(wallMin - SESSION_PM_START + SEAM_AXIS, SEAM_AXIS, SESSION_TOTAL_MIN)
}

export function clockOfAxis(axis: number): number {
  const a = clamp(axis, 0, SESSION_TOTAL_MIN)
  return a <= SEAM_AXIS ? SESSION_OPEN + a : SESSION_PM_START + (a - SEAM_AXIS)
}

/** 09:25–10:30、10:30–11:30、13:00–14:00、14:00–15:00。 */
const LANE_RANGES = [
  { fromAxis: 0, toAxis: 65, fromClock: SESSION_OPEN, toClock: 630 },
  { fromAxis: 65, toAxis: SEAM_AXIS, fromClock: 630, toClock: SESSION_AM_END },
  { fromAxis: SEAM_AXIS, toAxis: SEAM_AXIS + 60, fromClock: SESSION_PM_START, toClock: 840 },
  { fromAxis: SEAM_AXIS + 60, toAxis: SESSION_TOTAL_MIN, fromClock: 840, toClock: SESSION_CLOSE },
] as const

export interface SnakeLane {
  row: number
  fromAxis: number
  toAxis: number
  reversed: boolean
  y: number
  fromClock: number
  toClock: number
}

export interface SnakePoint {
  at: number
  axis: number
  row: number
  reversed: boolean
  x: number
  y: number
  outside: 'pre' | 'post' | null
  stack: number
}

export interface SnakeLayout {
  width: number
  height: number
  rows: number
  rowHeight: number
  /** 兼容字段；实际定位使用 lanes 的显式时间范围。 */
  laneAxis: number
  nodeTop: number
  nodeBottom: number
  x0: number
  x1: number
  lanes: SnakeLane[]
  points: SnakePoint[]
  path: string
  minLaneGap: number | null
  overcrowded: boolean
}

/** 边界点按下一段落位；11:30 保持上午末段，13:00 从下午首段起。 */
function rowOf(wallMin: number): number {
  if (wallMin < SESSION_OPEN || wallMin < 630) return 0
  if (wallMin <= SESSION_AM_END || wallMin < SESSION_PM_START) return 1
  if (wallMin < 840) return 2
  return 3
}

function positionOf(lanes: SnakeLane[], x0: number, x1: number, wallMin: number) {
  const axis = axisOf(wallMin)
  const row = rowOf(wallMin)
  const lane = lanes[row]
  const frac = clamp((axis - lane.fromAxis) / Math.max(1e-6, lane.toAxis - lane.fromAxis), 0, 1)
  const x = lane.reversed ? x1 - frac * (x1 - x0) : x0 + frac * (x1 - x0)
  return { axis, row, x: round(x), y: lane.y }
}

export function layoutSnake(opts: {
  marks: number[]
  width: number
  rowHeight?: number
  minGap?: number
  padY?: number
}): SnakeLayout {
  const rowHeight = opts.rowHeight ?? SNAKE_ROW_HEIGHT
  const minGap = opts.minGap ?? SNAKE_MIN_GAP
  const padY = opts.padY ?? SNAKE_PAD_Y
  const width = Number.isFinite(opts.width) && opts.width > 0 ? opts.width : 640
  const radius = rowHeight / 2
  const x0 = round(SNAKE_PAD_X + radius)
  const x1 = round(Math.max(x0 + 1, width - SNAKE_PAD_X - radius))
  const rows = LANE_RANGES.length
  const lanes: SnakeLane[] = LANE_RANGES.map((range, row) => ({
    ...range,
    row,
    reversed: row % 2 === 1,
    y: round(padY + row * rowHeight + rowHeight / 2),
  }))
  const marks = [...new Set(opts.marks.filter(Number.isFinite))].sort((a, b) => a - b)
  const points: SnakePoint[] = marks.map((at) => {
    const p = positionOf(lanes, x0, x1, at)
    return {
      at,
      ...p,
      reversed: lanes[p.row].reversed,
      outside: at > SESSION_CLOSE ? 'post' : at < SESSION_OPEN ? 'pre' : null,
      stack: 0,
    }
  })

  // 同一夹位纵向错开，防止多条记录被视觉上吞并。
  const groups = new Map<string, number[]>()
  points.forEach((point, index) => {
    const key = point.row + ':' + point.axis
    const group = groups.get(key)
    if (group) group.push(index)
    else groups.set(key, [index])
  })
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue
    const step = Math.min(34, (rowHeight - 40) / (indexes.length - 1))
    indexes.forEach((pointIndex, stack) => {
      const point = points[pointIndex]
      points[pointIndex] = { ...point, y: round(point.y + (stack - (indexes.length - 1) / 2) * step), stack }
    })
  }

  let minLaneGap: number | null = null
  for (const lane of lanes) {
    const xs = [...new Set(points.filter((point) => point.row === lane.row).map((point) => point.x))].sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1]
      if (minLaneGap == null || gap < minLaneGap) minLaneGap = gap
    }
  }

  let path = 'M ' + x0 + ' ' + lanes[0].y
  for (const lane of lanes) {
    const endX = lane.reversed ? x0 : x1
    path += ' L ' + endX + ' ' + lane.y
    if (lane.row < rows - 1) {
      path += ' A ' + radius + ' ' + radius + ' 0 0 ' + (lane.reversed ? 0 : 1) + ' ' + endX + ' ' + lanes[lane.row + 1].y
    }
  }

  return {
    width,
    height: padY * 2 + rows * rowHeight,
    rows,
    rowHeight,
    laneAxis: SESSION_TOTAL_MIN / rows,
    nodeTop: round(padY + rowHeight / 2),
    nodeBottom: round(padY + (rows - 1) * rowHeight + rowHeight / 2),
    x0,
    x1,
    lanes,
    points,
    path,
    minLaneGap,
    overcrowded: minLaneGap != null && minLaneGap < minGap,
  }
}

export function snakePos(L: SnakeLayout, wallMin: number): { axis: number; row: number; x: number; y: number } {
  return positionOf(L.lanes, L.x0, L.x1, wallMin)
}
