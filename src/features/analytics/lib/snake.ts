/** 固定四段（上午两段、下午两段）的日内蛇形时间轴布局内核。 */
export const SESSION_OPEN = 9 * 60 + 25
export const SESSION_AM_END = 11 * 60 + 30
export const SESSION_PM_START = 13 * 60
export const SESSION_CLOSE = 15 * 60
export const SEAM_AXIS = SESSION_AM_END - SESSION_OPEN
export const SESSION_TOTAL_MIN = SEAM_AXIS + (SESSION_CLOSE - SESSION_PM_START)

/**
 * 行高（两根轴线之间的纵向间距）。
 *
 * ⚠️ 2026-10-20 用户：「中间两根轴线之间高度高一点，不然中间一共要显示 6 排提示，可能显示不了」。
 *
 * 6 排 = 节点上方三层（走强/爆发/轮动 · 红线）+ 下方三层（走弱 · 绿线）。
 * 每侧需要 `2 × LABEL_STEP(20) + 标签行高(16) = 56px`，两侧 112px，再加节点命中区 68px
 * 已经是 **180px** 硬需求 —— 旧的 128 只够一行标签，6 排必然压到相邻行的节点上。
 *
 * 现取 196：180 + 上下各 8px 呼吸。⛔ 不要再按 128 时代的「能省则省」思路往下调，
 * 一旦低于 180，第 2 层的标签就会顶到上一行的图标上（页面不报错，只是看起来「乱了」）。
 */
export const SNAKE_ROW_HEIGHT = 196
/** 蛇形转弯半径上限（见 `layoutSnake` 里的注释：跟着行高走会吃掉横向节点空间） */
export const SNAKE_TURN_RADIUS = 40
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
 * 形状比颜色更抗干扰：色盲、强光屏、缩放后色相都会失真，轮廓不会看错。
 * 故这里把**形状当第一编码、颜色当第二编码**：
 *
 * | 形状 | 信号 | 含义 |
 * |---|---|---|
 * | ✦ 四角星 | 首爆 / 续强 | 资金一次性打进来（最强信号） |
 * | ✕ 叉     | 风险 / 杀跌 | 炸板、负反馈、板块杀跌 |
 * | ◆ 菱形   | 多板块联动 | 同刻多条线共振 |
 * | ● 实心圆 | 盘中走强 | 有走强，但未构成爆发 |
 * | ○ 空心圆 | 题材轮动 | 旧线回流 / 龙头切换，**不是**新爆发 |
 * | ■ 方块   | 系统记录 | 低频系统观测合并 |
 * | │ 细竖线 | 普通事实 | 单个封板 / 推送点 |
 *
 * ⚠️ 2026-10-20：首爆/风险由「上/下三角」改为「四角星/叉」。
 *    三角在 14px 下尖角抗锯齿会糊，且 ▲▼ 远看几乎同形 —— 方向这个唯一区分维度直接失效。
 *
 * ⛔ 尺寸仍表示**活跃度**（高度），形状只表示**性质** —— 两者正交，不要互相替代。
 */
export type SignalKind = 'linkage' | 'broken' | 'risk' | 'burst' | 'rotation' | 'up' | 'system' | 'normal'

export type SignalShape =
  | 'sparkle'
  | 'ring-gap'
  | 'cross'
  | 'diamond'
  | 'circle'
  | 'ring'
  | 'square'
  | 'bar'

/**
 * 需要用 SVG 精确绘制的形状（其余用 CSS `clip-path` / `border-radius` 就够）。
 *
 * ⛔ 2026-10-20 用户：「首爆和风险换一个 icon，这个红绿三角不好看」。
 *    三角改掉不只是审美 —— 14px 的尖角在非 Retina 屏上抗锯齿会糊成一团，
 *    「▲」和「▼」远看几乎一样，方向这个唯一的区分维度直接失效。
 *    现改为：首爆 = **四角星**（亮点炸开），风险 = **叉**（否定）。两者轮廓差异极大，
 *    且都不靠「朝上/朝下」表达语义。
 */
export type GlyphShape = 'sparkle' | 'ring-gap' | 'cross'

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
  burst: { shape: 'sparkle', label: '首爆', desc: '题材首次爆发或续强：紫色四角星' },
  broken: { shape: 'ring-gap', label: '炸板', desc: '涨停被打开：黄色缺口环（单只淡、成批满色）' },
  risk: { shape: 'cross', label: '风险', desc: '负反馈 / 板块杀跌：绿色叉' },
  linkage: { shape: 'diamond', label: '联动', desc: '同刻多个板块共振：菱形' },
  up: { shape: 'circle', label: '走强', desc: '板块或个股走强，但未构成爆发：实心圆' },
  rotation: { shape: 'ring', label: '轮动', desc: '旧题材回流或龙头切换，不是新爆发：紫色空心圆' },
  system: { shape: 'square', label: '记录', desc: '低频系统观测合并：灰色小方块' },
  normal: { shape: 'bar', label: '事实', desc: '单个封板 / 推送事实点：灰色细竖线' },
}

/**
 * 图例顺序 = 重要度降序（用户要求「时间轴顶部给每个图形做解释」）。
 *
 * ⛔ 2026-10-20 用户：「炸板不需要权重，你这全是炸板了」——炸板从第 2 位降到**末位**
 *    （只压在兜底的「事实」之上），与 `barVisual` 里「炸板最后判」保持一致；
 *    图例顺序读出来就是真实优先级，否则图例在说谎。
 */
export const SHAPE_LEGEND_ORDER: readonly SignalKind[] = [
  'burst',
  'risk',
  'linkage',
  'up',
  'rotation',
  'system',
  'broken',
  'normal',
] as const

/**
 * 形状 → 盒子尺寸 + 绘制声明（纯函数，便于单测）。
 *
 * - `glyph` 有值 → 渲染 `<SignalGlyph>`（SVG，精确轮廓，抗锯齿友好）；
 * - `clipPath` / `borderRadius` → 渲染纯 CSS 色块（圆/方/菱形这类几何体 CSS 更省）。
 * - 细竖线（普通事实）保留**活跃度高度**，其余图标尺寸恒定（见 SHAPE_ICON_SIZE）。
 */
export function shapeBox(
  shape: SignalShape,
  height: number,
  baseWidth = SNAKE_BAR_W,
): {
  width: number
  height: number
  clipPath?: string
  borderRadius?: number
  borderWidth?: number
  glyph?: GlyphShape
} {
  // 细竖线（普通事实）保留活跃度编码：它是「线」，高度本身就是信息。
  if (shape === 'bar') {
    return { width: baseWidth, height: Math.max(6, Math.round(height)), borderRadius: 9999 }
  }
  // 其余是「图标」：尺寸恒定，只表示性质，不表示强度（见 SHAPE_ICON_SIZE 注释）。
  const S = SHAPE_ICON_SIZE
  switch (shape) {
    // 尖角形状交给 SVG：14px 的 CSS `clip-path` 三角在这个尺寸下边缘会毛
    case 'sparkle':
      return { width: S, height: S, glyph: 'sparkle' }
    case 'ring-gap':
      return { width: S, height: S, glyph: 'ring-gap' }
    /**
     * 叉比星**矮一档**（11 vs 14）。
     *
     * ⛔ 2026-10-20 实测：10-16 这种普跌日，`downSectorCount > 0` 几乎每分钟成立 →
     *    一天 92 个风险节点。叉和星等大时，满轴绿叉把 6 个首爆星完全压住，
     *    整条轴看起来像「一排报错按钮」。风险是**高频背景信息**，必须比「首爆」轻，
     *    否则最高优先级信号反而看不见（尺寸差异在这里是**层级**，不是强度编码）。
     */
    case 'cross':
      return { width: S - 3, height: S - 3, glyph: 'cross' }
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
  /** **平均**行距（四段高度自适应后不再是常数，仅供兼容/估算用） */
  rowHeight: number
  /**
   * 每段与下一段的中心距（px）—— 末段沿用上一段的值。
   *
   * ⛔ 时间网格线、段末时钟标签都按**本段**间距画，不能再用统一的 `rowHeight`：
   *    自适应后四段可能分别是 96 / 132 / 196 / 168，用平均值会把线画到隔壁段里。
   */
  laneGaps: number[]
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
  /**
   * 逐段自定义中心 y（px，从容器顶算）。
   *
   * ⚠️ **当前唯一调用方（`TimelineSnake`）不用它** —— 2026-10-20 上午试过「按当天实际
   * 标签层数收窄段距」（824→616），用户当天即要求回退：「高度压缩了，我有些线看不到了 …
   * 还是把高度预留出来吧」。现在四段一律 `SNAKE_ROW_HEIGHT(196)` = 3+3 排完整预留。
   *
   * 保留入口只为将来真要做自适应时不必改内核：
   * ⛔ 一旦启用，`x0/x1` 必须保持稳定（`radius` 封顶 40），否则调用方先用默认行高挑好的
   *    `labelSlots`（依赖 x）会和最终布局错位。
   */
  laneYs?: number[]
  /** 与 `laneYs` 配套的总高；缺省时退回 `padY*2 + rows*rowHeight` */
  height?: number
}): SnakeLayout {
  const rowHeight = opts.rowHeight ?? SNAKE_ROW_HEIGHT
  const minGap = opts.minGap ?? SNAKE_MIN_GAP
  const padY = opts.padY ?? SNAKE_PAD_Y
  const width = Number.isFinite(opts.width) && opts.width > 0 ? opts.width : 640
  const rows = LANE_RANGES.length
  const laneYs =
    opts.laneYs?.length === rows
      ? opts.laneYs.map((y) => round(y))
      : LANE_RANGES.map((_, row) => round(padY + row * rowHeight + rowHeight / 2))
  const laneGaps = LANE_RANGES.map((_, row) =>
    row < rows - 1
      ? Math.max(1, laneYs[row + 1] - laneYs[row])
      : row > 0
        ? Math.max(1, laneYs[row] - laneYs[row - 1])
        : rowHeight,
  )
  const avgGap = rows > 1 ? round((laneYs[rows - 1] - laneYs[0]) / (rows - 1)) : rowHeight
  /**
   * 转弯半径 = min(平均行距/2, 40)。
   *
   * ⛔ 不能直接用 `rowHeight / 2`：行高从 128 加到 196 后，半径会跟着从 64 变 98，
   *    而 `x0 = PAD_X + radius`、`x1 = width - PAD_X - radius` —— 左右各被吃掉 34px，
   *    横向可放节点的空间直接缩水 68px，密集日立刻判成 overcrowded（实测三种布局测试全红）。
   *    转弯只需「看起来是圆的」，不需要半个行高那么大，给个 40 的上限即可。
   *
   * ⛔ 自适应行高后仍必须**恒定**：`x0/x1` 一旦随行高变化，调用方先用默认行高算出的
   *    `labelSlots`（标签落位依赖 x）就会和最终布局错位，标签会整体偏移。
   */
  const radius = Math.min(avgGap / 2, SNAKE_TURN_RADIUS)
  const x0 = round(SNAKE_PAD_X + radius)
  const x1 = round(Math.max(x0 + 1, width - SNAKE_PAD_X - radius))
  const lanes: SnakeLane[] = LANE_RANGES.map((range, row) => ({
    ...range,
    row,
    reversed: row % 2 === 1,
    y: laneYs[row],
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
    // 错开步长按**本段**间距算：自适应后各段可能只有 96px，用平均值会让节点堆叠出界
    const gapOfRow = laneGaps[points[indexes[0]].row] ?? avgGap
    const step = Math.min(34, (gapOfRow - 40) / (indexes.length - 1))
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
    height: opts.height ?? padY * 2 + rows * rowHeight,
    rows,
    rowHeight: avgGap,
    laneGaps,
    laneAxis: SESSION_TOTAL_MIN / rows,
    nodeTop: round(laneYs[0]),
    nodeBottom: round(laneYs[rows - 1]),
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
