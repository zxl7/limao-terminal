/**
 * 图表数学内核 —— **纯函数，无框架依赖**（shared/lib 铁律：禁 import react）。
 *
 * 放在 lib 而非 ui 的原因：比例尺、刻度和路径生成都是可被 Node 脚本/单测直接
 * 调用的纯计算；把它们写进组件里会导致「只有渲染才能验证」，而这正是本项目
 * 上一轮踩过的坑（区间数组被静默拼成 "02"，测试通过但显示错值）。
 *
 * ## ⚠️ 本文件最重要的一条规则：`null` 是**断点**，不是 0
 *
 * 原系统大量用 `null` 表达「该日无样本 / 该点未采集」。若把 null 当 0 画进折线：
 *   · 折线会**垂直砸到基线再弹回** —— 图上出现一个不存在的「暴跌」形态；
 *   · 看的人会据此判断「那天情绪崩了」，而事实是「那天没数据」。
 *
 * 因此所有路径生成函数遇到 null 一律**切断线段**（`lineSegments` 返回多段），
 * 而不是补 0。这条与 shared/lib/semantic 里「null 不着色」是同一原则。
 */

/** 一个可空的数据点：`null` / `undefined` / `NaN` 统一视为「无样本」 */
export type MaybeNum = number | null | undefined

/** 判定是否为有效数值（过滤 null / undefined / NaN） */
export function isNum(v: MaybeNum): v is number {
  return typeof v === 'number' && !Number.isNaN(v)
}

/**
 * 取一维序列的有效极值。全为 null → `null`（调用方据此渲染空态，
 * 而不是拿 [0,0] 画一条压在基线上的假线）。
 */
export function extentOf(values: MaybeNum[]): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const v of values) {
    if (!isNum(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return lo === Number.POSITIVE_INFINITY ? null : [lo, hi]
}

/** 多序列联合极值 —— 多线共用一个 Y 轴时用（如情绪分 + MA3） */
export function extentOfMany(series: MaybeNum[][]): [number, number] | null {
  return extentOf(series.flat())
}

/**
 * 生成「好看」的刻度 —— 把 [13, 47] 变成 [10, 50] 配 10/20/30/40/50。
 *
 * 为什么必须做：直接用原始极值当轴端点，会出现 13.7 / 31.4 这类读数，
 * 看图的人无法快速估算量级。nice 化后刻度落在 1/2/5×10ⁿ 上。
 *
 * 算法：先按步长把极值向外取整到步长倍数，再用「两倍步长」迭代修正 ——
 * 单次取整会因浮点误差多出一格（如 0.1 步长出现 4.999999999）。
 */
export function niceScale(
  min: number,
  max: number,
  tickCount = 4,
): { min: number; max: number; ticks: number[]; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, ticks: [0, 1], step: 1 }
  }

  // 退化情形：单点或全平序列 —— 上下各撑开一点，避免线贴在轴线上
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1
    min -= pad
    max += pad
  }

  const span = max - min
  const rawStep = span / Math.max(1, tickCount)
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / mag
  // 1 / 2 / 2.5 / 5 / 10 五档，能在「刻度太密」与「跨度过大」间取平衡
  const stepNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = stepNorm * mag

  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step

  // 用 round 消除浮点累积误差（0.1 步长会攒出 4.999999999）
  const ticks: number[] = []
  const count = Math.round((niceMax - niceMin) / step)
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  for (let i = 0; i <= count; i++) {
    ticks.push(Number((niceMin + i * step).toFixed(decimals + 2)))
  }
  return { min: niceMin, max: niceMax, ticks, step }
}

/**
 * 让 Y 轴把 0 包含进来 —— 柱状图的**硬要求**。
 *
 * 柱状图靠「长度」表达大小，缺了零基线就没有可比性（[3,5] 的两根柱子在
 * 非零轴上会画成 3:5 与 0:2 的差异，视觉上却是 1:5）。折线图不需要，
 * 强行过 0 会把细微波动的信息压平。
 */
export function withZero(ext: [number, number]): [number, number] {
  return [Math.min(0, ext[0]), Math.max(0, ext[1])]
}

/**
 * 双向轴 —— 正负柱状图（资金净流入/流出）专用。
 *
 * 返回的 `ticks` 已按「0 必须落在某条刻度上」对齐：0 不在刻度里时，零基线
 * 会落在两条刻度之间，读图的人无法判断柱子到底是正是负。
 */
export function bipolarScale(
  ext: [number, number],
  tickCount = 4,
): { min: number; max: number; ticks: number[]; step: number } {
  const { min, max, ticks } = niceScale(ext[0], ext[1], tickCount)
  if (ticks.includes(0)) return { min, max, ticks, step: ticks[1] - ticks[0] }

  // 0 不在刻度上：补进去，并把超出的一端截掉以保持刻度数不变
  const withZ = [...ticks, 0].sort((a, b) => a - b)
  const step = withZ.length > 1 ? Math.min(...withZ.slice(1).map((v, i) => v - withZ[i])) : 1
  return { min: withZ[0], max: withZ[withZ.length - 1], ticks: withZ, step: Math.abs(step) }
}

/** 线性比例尺：把数据域映射到像素域（Y 轴需传入反向 range） */
export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const dSpan = d1 - d0
  // 域退化成一点：映射到 range 中点，避免除零产生 Infinity 坐标
  if (dSpan === 0) return () => (r0 + r1) / 2
  const k = (r1 - r0) / dSpan
  return (v: number) => r0 + (v - d0) * k
}

/**
 * 折线路径 —— **遇 null 切段**。
 *
 * 返回字符串数组（可能多段）。单段时调用方可以把它当一个 `<path>`；
 * 多段时必须逐段渲染，否则 SVG 会把两段用一条直线连起来 ——
 * 那就等于把「无数据」画成了「直线插值」，凭空造出一段不存在的走势。
 *
 * `at(x, y)` 返回该点的像素坐标；第 i 个点对应 `xs[i]`。
 */
export function lineSegments(
  values: MaybeNum[],
  at: (xIndex: number, yValue: number) => readonly [number, number],
): string[] {
  const out: string[] = []
  let cur: string[] = []
  values.forEach((v, i) => {
    if (!isNum(v)) {
      // 断点：收束当前段，下一有效点另起一段
      if (cur.length) out.push(cur.join(' '))
      cur = []
      return
    }
    const [x, y] = at(i, v)
    cur.push(`${cur.length === 0 ? 'M' : 'L'}${round2(x)},${round2(y)}`)
  })
  if (cur.length) out.push(cur.join(' '))
  return out
}

/**
 * 面积路径 —— 折线下方填充。
 *
 * 与 `lineSegments` 同规则：遇 null 切段，每段独立闭合到基线。
 * ⚠️ 若整段都按到基线闭合，跨 null 的填充会把「无数据区间」也涂上颜色，
 *    视觉上等于宣称「这段有数据」。
 */
export function areaSegments(
  values: MaybeNum[],
  at: (xIndex: number, yValue: number) => readonly [number, number],
  baselineY: number,
): string[] {
  const out: string[] = []
  let pts: Array<readonly [number, number]> = []
  const flush = () => {
    if (pts.length < 2) {
      pts = []
      return
    }
    const head = pts[0]
    const tail = pts[pts.length - 1]
    const d =
      `M${round2(head[0])},${round2(baselineY)} ` +
      pts.map(([x, y]) => `L${round2(x)},${round2(y)}`).join(' ') +
      ` L${round2(tail[0])},${round2(baselineY)} Z`
    out.push(d)
    pts = []
  }
  values.forEach((v, i) => {
    if (!isNum(v)) return flush()
    pts.push(at(i, v))
  })
  flush()
  return out
}

/**
 * 移动平均（null 感知）—— MA3 / MA5 拐点判定的基础。
 *
 * ⚠️ 窗口内**任一点缺失即返回 null**，不做「有几个算几个」的降级：
 *    用 2 个样本冒充 3 日平均，会让拐点提前出现，而拐点正是本系统
 *    「3 日=方向层」的全部意义所在。宁可断线，不可造假。
 */
export function movingAverage(values: MaybeNum[], window: number): (number | null)[] {
  if (window <= 0) return values.map((v) => (isNum(v) ? v : null))
  return values.map((_, i) => {
    if (i < window - 1) return null
    const win = values.slice(i - window + 1, i + 1)
    if (win.some((v) => !isNum(v))) return null
    const sum = win.reduce<number>((a, v) => a + (v as number), 0)
    return sum / window
  })
}

/**
 * 拐点检测 —— 找出移动平均的方向变化位置。
 *
 * 用于情绪周期页标注「修复转退潮」「退潮转修复」这类**方向层**信号
 * （原系统 trajectory.turn_signal 的前端可视化）。只比较相邻有效值，
 * null 处不产生信号（无数据不等于方向改变）。
 *
 * @returns 每个有效点的方向：1 上行 / -1 下行 / 0 持平 / null 不可判定
 */
export function directions(values: MaybeNum[]): (1 | -1 | 0 | null)[] {
  return values.map((v, i) => {
    if (!isNum(v)) return null
    // 向前找最近的有效值作为比较基准
    for (let j = i - 1; j >= 0; j--) {
      const prev = values[j]
      if (!isNum(prev)) continue
      const d = v - prev
      return d > 0 ? 1 : d < 0 ? -1 : 0
    }
    return null
  })
}

/**
 * 逐点回撤序列 —— 每点相对**历史最高值**的跌幅（小数，≤0）。
 *
 * 与 `maxDrawdownOf` 共用同一口径，二者的差别只在**呈现粒度**：
 *   · 单值 → 只回答「最惨到什么程度」
 *   · 序列 → 回答「现在离最惨还有多远」（正在回撤中 / 已修复）
 *
 * ⚠️ 三点口径约定，缺一不可：
 *   1. **前向峰值**（peak 只升不降）—— 这是「距历史最高」而非「距昨收」，
 *      后者衡量的是日波动、不是回撤，两者常被混为一谈；
 *   2. 峰值 ≤ 0 时返回 `null` 而非 `NaN`/`-Infinity` —— 非法净值（未建仓 /
 *      数据缺失）必须走断线，不能画进曲线；
 *   3. 首点恒为 0（自身即峰值）—— 若过滤掉，曲线起点会凭空出现在负区间。
 *
 * @param values 净值序列（可含 null，缺失点不参与峰值累积但自身仍返回 null）
 * @returns 与入参等长的回撤序列（小数），缺失点为 null
 */
export function drawdownSeries(values: MaybeNum[]): (number | null)[] {
  // 用 reduce 携带「峰值」这一状态，而非在外层 `let` 上闭包重赋值 ——
  // React Compiler 的 immutability 检查会判定后者为「渲染期变量被重赋」。
  return values.reduce<{ out: (number | null)[]; peak: number }>(
    (acc, v) => {
      if (!isNum(v)) {
        acc.out.push(null)
        return acc
      }
      const peak = Math.max(acc.peak, v)
      acc.out.push(peak > 0 ? v / peak - 1 : null)
      acc.peak = peak
      return acc
    },
    { out: [], peak: -Infinity },
  ).out
}

/**
 * 最大回撤（单值，小数 ≤0）—— `drawdownSeries` 的最小值。
 *
 * 序列为空或全为 null 时返回 `null`（**不是 0**）：无样本 ≠ 无回撤，
 * 返回 0 会让「没有数据」被读成「完美无回撤」，是反向误导。
 */
export function maxDrawdownOf(values: MaybeNum[]): number | null {
  const dd = drawdownSeries(values).filter(isNum)
  if (!dd.length) return null
  return Math.min(...dd)
}

/**
 * 保留 2 位小数 —— SVG 路径字符串里塞 15 位浮点是纯浪费（体积可差 3 倍）。
 *
 * ⚠️ 显式把 `-0` 归一成 `0`：`Math.round(-0.5)` 在 JS 里返回 `-0`，而
 *    `Object.is(-0, 0) === false`。虽然模板字符串里 `-0` 会渲染成 `"0"`、
 *    不造成视觉问题，但 `-0` 一旦流进下游比较（如 `=== 0` 判零基线）就会
 *    静默走向另一分支 —— 同属「看得见却想不通」的一类缺陷，在此掐断。
 */
export function round2(v: number): number {
  const r = Math.round(v * 100) / 100
  return r === 0 ? 0 : r
}

/**
 * 极坐标 → 直角坐标。雷达图 / 环形图共用的底座。
 *
 * `angle` 以「12 点方向为 0，顺时针递增」计（数学坐标系里减 90°）。
 */
export function polar(cx: number, cy: number, radius: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [round2(cx + radius * Math.cos(rad)), round2(cy + radius * Math.sin(rad))]
}

/**
 * 等分角度序列 —— N 边形顶点的角度（雷达图/蛛网图）。
 * 起点固定 12 点方向，保证同一组指标在不同图表里位置一致（可比性）。
 */
export function evenAngles(n: number): number[] {
  if (n <= 0) return []
  return Array.from({ length: n }, (_, i) => (360 / n) * i)
}

/**
 * 折线多边形的点串（雷达图数据面）。
 * 返回 `"x1,y1 x2,y2 …"`，可直接给 `<polygon points>`。
 */
export function polygonPoints(
  values: MaybeNum[],
  max: number,
  cx: number,
  cy: number,
  radius: number,
): string {
  const angles = evenAngles(values.length)
  return values
    .map((v, i) => {
      const r = max > 0 ? (Math.max(0, Math.min(v ?? 0, max)) / max) * radius : 0
      const [x, y] = polar(cx, cy, r, angles[i])
      return `${x},${y}`
    })
    .join(' ')
}

/**
 * 坐标轴刻度标签的显示文本 —— 大数自动降位。
 *
 * 成交额/资金流动辄 8~10 位（如 -382685064），直接把原始数字印在轴上是
 * 不可读的。按量级降到「亿 / 万」，保留必要精度。
 */
export function axisLabel(v: number, digits = 1): string {
  const a = Math.abs(v)
  if (a >= 1e8) return `${(v / 1e8).toFixed(digits)}亿`
  if (a >= 1e4) return `${(v / 1e4).toFixed(digits)}万`
  if (a >= 100) return v.toFixed(0)
  if (a >= 1) return v.toFixed(digits)
  return String(Number(v.toFixed(3)))
}
