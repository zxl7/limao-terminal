/**
 * 蛇形时间轴（boustrophedon）的**布局内核** —— 纯函数、无 React 依赖、可单测。
 *
 * ## 它解决什么
 *
 * A 股一天有 **255 个交易分钟**（09:15–11:30 共 135 ＋ 13:00–15:00 共 120）。
 * 摊成一条直线需要极宽，塞进固定列宽又会挤成一坨。蛇形折线的做法是：
 * **从 09:15 向右横走 → 到边画半圆弯下来 → 反向向左横走 → 再弯**，
 * 于是「一天的形状」在一屏内可读，节点密度也可控。
 *
 * ## ⛔ 两条口径（改前先读）
 *
 * 1. **午休 90 分钟被压缩掉**（`axisOf` 把 11:30–13:00 夹到接缝）。
 *    理由：午休无任何盘面事件，留出 1/4 屏的死白只会把真正有信息的两头压扁。
 *    ⇒ 横轴坐标是**交易分钟轴**（0–255），不是墙上时钟；贴标签一律走 `clockOfAxis`。
 * 2. **行数由「节点密度」决定，不由时间决定**：`rows = clamp(ceil(节点数 / 每行容量), 3, 6)`。
 *    容量 = `floor(行宽 / minGap) + 1`。⇒ 同一天不同窗口宽度下行数可能不同（最多 3–6 行），
 *    高度因此是**有界**的（`rows × rowHeight + 2×padY`），不会无限长高。
 *
 * ## 行方向（穿行方向交替）
 *
 * | 行号 | 方向 | 转弯位置 |
 * |---|---|---|
 * | 0 | 左 → 右 | 右边半圆（sweep=1） |
 * | 1 | 右 → 左 | 左边半圆（sweep=0） |
 * | 2 | 左 → 右 | 右边半圆 |
 * | … | … | … |
 *
 * ⚠️ SVG 里 `y` 向下，故「从上往下、经右侧到底」= **顺时针** = `sweep=1`；
 * 「经左侧到底」= 逆时针 = `sweep=0`。写反了弯道会朝内翻（视觉上变成打结）。
 */

/** 轴起点：开盘集合竞价开始（09:15） */
export const SESSION_OPEN = 9 * 60 + 15
/** 上午收盘 */
export const SESSION_AM_END = 11 * 60 + 30
/** 下午开盘 */
export const SESSION_PM_START = 13 * 60
/** 轴终点：收盘（15:00） */
export const SESSION_CLOSE = 15 * 60
/** 午休被压缩后的接缝坐标（= 上午的 135 分钟） */
export const SEAM_AXIS = SESSION_AM_END - SESSION_OPEN
/** 交易分钟总数（不含午休） */
export const SESSION_TOTAL_MIN = SEAM_AXIS + (SESSION_CLOSE - SESSION_PM_START)

/** 每行高度（px）：节点的两行胶囊 + 上下留白 */
export const SNAKE_ROW_HEIGHT = 128
/** 左右外边距（px）：转弯半圆在此之内，保证不溢出容器 */
export const SNAKE_PAD_X = 10
/** 上下外边距（px） */
export const SNAKE_PAD_Y = 20
/**
 * 相邻节点的**最小水平间距**（px）：不足则增行。
 *
 * ## ⛔ 它按「**视觉不重叠**」定，不按「命中区不重叠」定
 *
 * 判据是**竖条的可见宽度**（`SNAKE_BAR_W` + 一点空隙），**不是命中区宽度**。
 * 用命中区宽度当判据会把行数白抬：实测真实数据节点相邻间隔 **min=1 / p10=1 / 中位=2 分钟**
 * （轴几乎是分钟级），若按 58px 的**卡片式**节点算需要 **12 行**（不可接受）；
 * 按 26px 命中区算要 5 行；按 10px 竖条算只要 **4 行**。
 * 命中区在分钟级密集处轻微重叠是可接受的 UX 代价，不该用「多长几行」来换。
 *
 * | 判据（节点可见宽度） | 真实数据所需行数（width 1600） |
 * |---|---|
 * | 58px（卡片式） | **12 行** —— 不可接受 |
 * | 26px（命中区） | 5 行 |
 * | **10px（竖条 · 现用）** | **4 行** |
 */
export const SNAKE_MIN_GAP = 22
/**
 * 节点**命中区**宽度（px）。
 * ⚠️ 分钟级密集时相邻命中区会轻微重叠（后渲染者优先）—— 这是**已知且接受**的取舍；
 * ⛔ 不要为了消除重叠去抬 `SNAKE_MIN_GAP`（会白白多出好几行）。
 */
export const SNAKE_NODE_W = 26
/** 节点内细竖条宽度（px）—— `SNAKE_MIN_GAP` 的判据就是它 */
export const SNAKE_BAR_W = 10
/** 竖条最大高度（px）—— 高度编码「该刻活跃度」 */
export const SNAKE_BAR_MAX_H = 46
/** 行数下限 */
export const SNAKE_MIN_ROWS = 3
/**
 * 行数上限。⚠️ 行数由「**实际最小同层间距**」递增试探决定（见 `layoutSnake`），
 * 密集的一天会自动用到更多行，而不是把节点挤成一坨。
 */
export const SNAKE_MAX_ROWS = 9

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * **墙上时钟分钟 → 轴坐标**（0–255，午休被折叠到接缝）。
 *
 * ⛔ 11:30–13:00 的输入（例如记录器在午休时段补录的内容）**夹到接缝 135**，
 * 不丢弃、也不铺开成 90 分钟的空白。
 */
export function axisOf(wallMin: number): number {
  if (!Number.isFinite(wallMin)) return 0
  if (wallMin <= SESSION_AM_END) return clamp(wallMin - SESSION_OPEN, 0, SEAM_AXIS)
  if (wallMin < SESSION_PM_START) return SEAM_AXIS
  return clamp(wallMin - SESSION_PM_START + SEAM_AXIS, SEAM_AXIS, SESSION_TOTAL_MIN)
}

/** **轴坐标 → 墙上时钟分钟**（`axisOf` 的逆，用于刻度与标签） */
export function clockOfAxis(axis: number): number {
  const a = clamp(axis, 0, SESSION_TOTAL_MIN)
  return a <= SEAM_AXIS ? SESSION_OPEN + a : SESSION_PM_START + (a - SEAM_AXIS)
}

/** 一行（穿行段） */
export interface SnakeLane {
  row: number
  /** 该行的轴起点 / 终点（轴坐标） */
  fromAxis: number
  toAxis: number
  /** 该行是否**反向**（右 → 左）。行号偶数 = false */
  reversed: boolean
  /** 行中线 y（容器坐标） */
  y: number
  /** 行起点 / 终点的墙上时钟（贴标签用，⛔ 不要拿 axis 直接当时钟） */
  fromClock: number
  toClock: number
}

/** 一个节点在容器内的落点 */
export interface SnakePoint {
  /** 墙上时钟分钟（输入的原始值，供组件显示） */
  at: number
  /** 轴坐标 */
  axis: number
  row: number
  reversed: boolean
  /** 容器内绝对坐标（px）—— 节点**中心** */
  x: number
  y: number
  /**
   * 该记录是否落在**交易时段之外**（`null` = 盘中）。
   *
   * ⛔ 盘外记录（如盘后 17:42 复盘卡生成的 `event_log`）轴坐标被夹到边界，
   * **必须在节点上如实标注** —— 否则「17:42 的节点坐在 15:00 的位置」会被读成盘中记录。
   */
  outside: 'pre' | 'post' | null
  /** 同位置堆叠序号（0 起，居中）；仅当多条记录夹到**同一轴点**时 > 0 */
  stack: number
}

export interface SnakeLayout {
  width: number
  height: number
  rows: number
  rowHeight: number
  /** 每行覆盖的轴跨度（`SESSION_TOTAL_MIN / rows`）—— `snakePos` 依赖它，⛔ 别改完 layout 忘了它 */
  laneAxis: number
  /** 节点中心的 y 边界（节点应保证中心落在 [nodeTop, nodeBottom] 内才不溢出） */
  nodeTop: number
  nodeBottom: number
  /** 横向轨道端点（转弯半圆的切点） */
  x0: number
  x1: number
  lanes: SnakeLane[]
  points: SnakePoint[]
  /** SVG 路径（`<path d>`）：横走 + 转弯半圆 */
  path: string
  /**
   * **实际达到的最小「同层相邻节点水平间距」**（px）。
   * `null` = 每个有节点的行都只有 1 个节点、不存在相邻对。
   * ⚠️ 计算时**排除同 x 的堆叠点**（它们靠竖直堆叠错开，不需要水平间距）。
   */
  minLaneGap: number | null
  /**
   * ⚠️ **行数已用满仍装不下**：某个时间窗内节点过密，`minLaneGap < minGap`（视觉偏挤）。
   * 加行解不开这个 —— 加行只是细分时间轴，密集簇整体仍落在同一行。
   * UI 应**如实提示**，⛔ 不得假装排得下，也**不得因此丢节点**。
   */
  overcrowded: boolean
}

/**
 * 计算蛇形布局。
 *
 * @param marks 需要落点的**墙上时钟分钟**（任意顺序、可重复；内部去重升序）
 * @param width 可用宽度（px）。⚠️ 调用方负责测量，jsdom 下传 fallback。
 *
 * 不变量（测试锁）：
 *  ① **不丢不重** —— `points.length === 去重后的 marks 数`，且 `at` 集合一致；
 *  ② **时间单调** —— `points` 的 `row` 单调不减，且同一行内沿穿行方向的 `axis` 单调不减；
 *  ③ **行交替** —— `lanes[k].reversed === (k % 2 === 1)`；
 *  ④ **坐标在界内** —— 所有节点 `0 ≤ x ≤ width`、`nodeTop ≤ y ≤ nodeBottom`；
 *  ⑤ **路径合法** —— 起点在首行起点、转弯数 === `rows - 1`、无 `NaN`。
 */
export function layoutSnake(opts: {
  marks: number[]
  width: number
  rowHeight?: number
  minGap?: number
  minRows?: number
  maxRows?: number
  padY?: number
}): SnakeLayout {
  const rowHeight = opts.rowHeight ?? SNAKE_ROW_HEIGHT
  const minGap = opts.minGap ?? SNAKE_MIN_GAP
  const padY = opts.padY ?? SNAKE_PAD_Y
  const minRows = opts.minRows ?? SNAKE_MIN_ROWS
  const maxRows = opts.maxRows ?? SNAKE_MAX_ROWS
  // 转弯半径 = 半个行高 → 弯道正好把相邻两行接起来
  const R = rowHeight / 2
  const padX = SNAKE_PAD_X
  // ⛔ 宽度兜底：jsdom / 未布局时可能是 0，绝不能算出 NaN 坐标
  const width = Number.isFinite(opts.width) && opts.width > 0 ? opts.width : 640
  // ⚠️ 统一取整到 2 位：路径、节点 style、行标签**共用同一批数值**
  // （不取整会在 DOM 里留下 `842.7058823529412px` 这类长浮点串，且与路径的取整值有亚像素差）
  const x0 = round(padX + R)
  const x1 = round(Math.max(x0 + 1, width - padX - R))
  const laneW = x1 - x0

  const marks = [...new Set(opts.marks.filter((m) => Number.isFinite(m)))].sort((a, b) => a - b)
  const axes = marks.map(axisOf)

  // ── 行数：按**真实的最小同层间距**决定 ──
  // ⛔ 不能用「节点数 / 行数」的平均值，也不能用「每行节点数 ≤ 行宽/minGap」——
  //    后者错判：同一行内的节点可能只占该行一小段时间，数虽少但全挤在一小段里。
  //    唯一正确的判据是**实际算出来的相邻 x 间距**（见 laneMinGap）。
  const lo = Math.max(1, minRows)
  const hi = Math.max(lo, maxRows)
  const laneMinGap = (r: number): number | null => {
    const la = SESSION_TOTAL_MIN / r
    const sets: Set<number>[] = Array.from({ length: r }, () => new Set<number>())
    for (const a of axes) {
      const row = clamp(Math.floor(a / la), 0, r - 1)
      const from = row * la
      const to = row === r - 1 ? SESSION_TOTAL_MIN : (row + 1) * la
      const frac = clamp((a - from) / Math.max(1e-6, to - from), 0, 1)
      // ⚠️ 同 x 的点会被竖直堆叠错开，**不参与**水平间距判定（去重）
      sets[row].add(round(row % 2 === 1 ? x1 - frac * laneW : x0 + frac * laneW))
    }
    let g: number | null = null
    for (const set of sets) {
      const xs = [...set].sort((p, q) => p - q)
      for (let i = 1; i < xs.length; i++) {
        const d = xs[i] - xs[i - 1]
        if (g == null || d < g) g = d
      }
    }
    return g
  }
  let rows = hi
  let feasible = false
  for (let r = lo; r <= hi; r++) {
    rows = r
    const g = laneMinGap(r)
    if (g == null || g >= minGap) {
      feasible = true
      break
    }
  }
  const laneAxis = SESSION_TOTAL_MIN / rows

  const lanes: SnakeLane[] = Array.from({ length: rows }, (_, k) => {
    const fromAxis = k * laneAxis
    const toAxis = k === rows - 1 ? SESSION_TOTAL_MIN : (k + 1) * laneAxis
    return {
      row: k,
      fromAxis,
      toAxis,
      reversed: k % 2 === 1,
      y: round(padY + k * rowHeight + rowHeight / 2),
      fromClock: clockOfAxis(fromAxis),
      toClock: clockOfAxis(toAxis),
    }
  })

  const points: SnakePoint[] = marks.map((at, i) => {
    const axis = axes[i]
    // ⚠️ 用 floor 落行，末端（axis === TOTAL）夹到最后一行
    const row = clamp(Math.floor(axis / laneAxis), 0, rows - 1)
    const lane = lanes[row]
    const span = Math.max(1e-6, lane.toAxis - lane.fromAxis)
    const frac = clamp((axis - lane.fromAxis) / span, 0, 1)
    const x = lane.reversed ? x1 - frac * laneW : x0 + frac * laneW
    return {
      at,
      axis,
      row,
      reversed: lane.reversed,
      x: round(x),
      y: lane.y,
      outside: at > SESSION_CLOSE ? 'post' : at < SESSION_OPEN ? 'pre' : null,
      stack: 0,
    }
  })

  // ── 同位置堆叠 ──
  // ⛔ 不同时刻可能被**夹到同一轴点**（盘后 → 收盘 / 午休 → 接缝 / 盘前 → 开盘），
  // 若不管，节点会像素级完全重叠 → 肉眼只看到 1 个，实际有 N 条（静默丢数据）。
  // 处理：同 (row, axis) 的记录在该行中线上下**居中堆叠**，步长受行高约束（绝不越到邻行）。
  const groups = new Map<string, number[]>()
  points.forEach((p, i) => {
    const k = `${p.row}:${p.axis}`
    const list = groups.get(k)
    if (list) list.push(i)
    else groups.set(k, [i])
  })
  for (const idx of groups.values()) {
    const n = idx.length
    if (n < 2) continue
    // 总堆叠高度 ≤ 行高 − 40（给节点自身留出空间），故步长随条数自适应收缩
    const step = Math.min(34, (rowHeight - 40) / (n - 1))
    idx.forEach((pi, k) => {
      const p = points[pi]
      points[pi] = { ...p, y: round(p.y + (k - (n - 1) / 2) * step), stack: k }
    })
  }

  // ── 路径：横走 + 每次到边画半圆弯到下一行 ──
  let d = `M ${round(x0)} ${round(lanes[0].y)}`
  for (let k = 0; k < rows; k++) {
    const y = lanes[k].y
    const even = k % 2 === 0
    const endX = even ? x1 : x0
    d += ` L ${round(endX)} ${round(y)}`
    if (k < rows - 1) {
      // 右端顺时针（sweep=1）/ 左端逆时针（sweep=0）
      const sweep = even ? 1 : 0
      d += ` A ${round(R)} ${round(R)} 0 0 ${sweep} ${round(endX)} ${round(lanes[k + 1].y)}`
    }
  }

  return {
    width,
    height: padY * 2 + rows * rowHeight,
    rows,
    rowHeight,
    laneAxis,
    nodeTop: round(padY + rowHeight / 2),
    nodeBottom: round(padY + (rows - 1) * rowHeight + rowHeight / 2),
    x0,
    x1,
    lanes,
    points,
    path: d,
    minLaneGap: laneMinGap(rows),
    overcrowded: !feasible,
  }
}

/**
 * 任意**墙上时钟分钟** → 容器坐标（时间刻度 / 游标用）。
 *
 * ⛔ 必须与 `layoutSnake` 内部算节点位置用**同一套换算** —— 否则刻度与节点会错位。
 * ⚠️ 返回的是**未堆叠**的基础位置（行中线）；`layoutSnake` 的节点在「同轴点多条夹位」时
 * 还会做居中堆叠（`SnakePoint.stack`），故 `y` 可能与基础位置不同（已用不变量测试钉住 x 恒等）。
 */
export function snakePos(
  L: SnakeLayout,
  wallMin: number,
): { axis: number; row: number; x: number; y: number } {
  const axis = axisOf(wallMin)
  const row = clamp(Math.floor(axis / L.laneAxis), 0, L.rows - 1)
  const lane = L.lanes[row]
  const span = Math.max(1e-6, lane.toAxis - lane.fromAxis)
  const frac = clamp((axis - lane.fromAxis) / span, 0, 1)
  const laneW = L.x1 - L.x0
  return {
    axis,
    row,
    // ⚠️ 必须与 `layoutSnake` 一样取整，否则刻度与节点会有亚像素错位
    // （这条一致性由 `tests/snake.test.ts` 的「同源」用例钉住）
    x: round(lane.reversed ? L.x1 - frac * laneW : L.x0 + frac * laneW),
    y: lane.y,
  }
}

/** 坐标取 2 位小数 —— 路径字符串别塞一长串浮点噪声（可读 + diff 友好） */
function round(v: number): number {
  return Math.round(v * 100) / 100
}
