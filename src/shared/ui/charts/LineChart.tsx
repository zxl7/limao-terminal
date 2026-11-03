import { useMemo, useState } from 'react'
import {
  axisLabel,
  cn,
  extentOfMany,
  isNum,
  lineSegments,
  areaSegments,
  movingAverage,
  niceScale,
  round2,
  scaleLinear,
  type MaybeNum,
} from '@/shared/lib'
import { plotBox, sampleTicks, toneSoftVar, toneVar, type Tone } from './util'
import { ChartTooltip, viewToPx, type TipAnchor } from './Tooltip'
import { useChartWidth } from './useChartWidth'

/** 一条折线序列 */
export interface LineSeries {
  name: string
  values: MaybeNum[]
  tone?: Tone
  /** 折线下方填充面积（单序列时用，多序列叠面积会互相遮挡） */
  area?: boolean
  /** 虚线（用于均线/参考序列，与实体主序列区分） */
  dashed?: boolean
  /** 参与悬浮读数展示（默认 true；纯装饰序列可置 false 避免干扰） */
  readable?: boolean
  /**
   * 坐标轴归属：默认 `'left'`。置 `'right'` 走**副轴** —— 用于与左轴不同量纲的序列
   *（如 炸板率 % 与 涨停/跌停 家数同图）。左轴行为不受影响，向后兼容。
   */
  axis?: 'left' | 'right'
  /** 该序列专属数值格式（覆盖全局 `format`）—— 副轴序列用它输出 `%` 等单位 */
  format?: (v: number) => string
}

/** 横向参考线（如情绪分 7 分「偏强」阈值、2 分「退潮」阈值） */
export interface RefLine {
  value: number
  label?: string
  tone?: Tone
  dashed?: boolean
}

/**
 * 空参考线的**稳定引用** —— 不写在参数默认值里。
 *
 * `refLines = []` 每次渲染都会新建数组，引用一变，`useMemo` 里的
 * `scaleInfo` 就必然重算（明明没有任何一条参考线）。同理适用于所有
 * 以数组/对象为默认值的 props。
 */
const NO_REF_LINES: RefLine[] = []

/**
 * 折线图 —— 时序类数据的主力图。
 *
 * ## 与柱状图的根本差别：**不需要零基线**
 *
 * 折线靠「形状」表达变化，靠「绝对高度」表达量级。若强行把 Y 轴拉到 0，
 * 情绪分 [7.4, 8.1] 这种窄幅波动会被压成一条几乎水平的线，趋势完全消失。
 * 所以这里用 `niceScale` 就近取整，**不**经过 `withZero`。
 * 需要零基线的场合是柱状图（长度即数量）——见 `BarChart`。
 *
 * ## null 处理
 *
 * 交给 `lineSegments` / `areaSegments`，遇 null 断段。悬浮读数为 null 时
 * 显示「—」而不是 0，与全站一致。
 */
export function LineChart({
  series,
  labels,
  height = 200,
  /** 首帧兜底宽度（未测到容器宽度前用它）—— 最终以容器实测宽度为准，高度恒定 */
  width: widthHint = 720,
  format = axisLabel,
  yTickCount = 4,
  refLines = NO_REF_LINES,
  yMin,
  yMax,
  /** Y 轴最小值强制取 0（如涨停家数这类计数，0 有实际意义） */
  zeroBased = false,
  showLegend = true,
  className,
  /** 数据点少于该数量时直接画点，不画线（2 个点连线无意义） */
  dotThreshold = 12,
}: {
  series: LineSeries[]
  labels: string[]
  height?: number
  width?: number
  format?: (v: number) => string
  yTickCount?: number
  refLines?: RefLine[]
  yMin?: number
  yMax?: number
  zeroBased?: boolean
  showLegend?: boolean
  className?: string
  dotThreshold?: number
}) {
  /** 悬浮态：索引 + 像素锚点（锚点给 tooltip 定位用） */
  const [hover, setHover] = useState<{ i: number; anchor: TipAnchor } | null>(null)
  /* 容器实测宽度 —— 宽屏下保证「图变宽而不变高」，见 useChartWidth 头注 */
  const { width, el, setEl } = useChartWidth(widthHint)

  // 副轴：显式声明 axis:'right' 的序列走右轴（炸板率 % 这类与计数不同量纲的指标）
  const leftSeries = useMemo(() => series.filter((s) => (s.axis ?? 'left') === 'left'), [series])
  const rightSeries = useMemo(() => series.filter((s) => s.axis === 'right'), [series])

  // 副轴存在时右侧留出刻度区，避免右轴标签被裁切（左轴行为不变）
  const box = plotBox(width, height, rightSeries.length ? { padRight: 46 } : {})

  const scaleInfo = useMemo(() => {
    const ext = extentOfMany(leftSeries.map((s) => s.values))
    if (!ext) return null
    const lo = yMin ?? (zeroBased ? Math.min(0, ext[0]) : ext[0])
    const hi = yMax ?? Math.max(ext[1], ...refLines.map((r) => r.value))
    return niceScale(lo, hi, yTickCount)
  }, [leftSeries, yMin, yMax, yTickCount, refLines, zeroBased])

  const rightScaleInfo = useMemo(() => {
    if (rightSeries.length === 0) return null
    const ext = extentOfMany(rightSeries.map((s) => s.values))
    if (!ext) return null
    return niceScale(ext[0], ext[1], yTickCount)
  }, [rightSeries, yTickCount])

  const sx = useMemo(
    () => scaleLinear([0, Math.max(1, labels.length - 1)], [box.x0, box.x1]),
    [labels.length, box.x0, box.x1],
  )
  const syLeft = useMemo(
    () => (scaleInfo ? scaleLinear([scaleInfo.min, scaleInfo.max], [box.y1, box.y0]) : null),
    [scaleInfo, box.y1, box.y0],
  )
  const syRight = useMemo(
    () => (rightScaleInfo ? scaleLinear([rightScaleInfo.min, rightScaleInfo.max], [box.y1, box.y0]) : null),
    [rightScaleInfo, box.y1, box.y0],
  )

  const hasLeft = !!scaleInfo && !!syLeft && leftSeries.some((s) => s.values.some(isNum))
  const hasRight = !!rightScaleInfo && !!syRight && rightSeries.some((s) => s.values.some(isNum))
  const hasData = hasLeft || hasRight

  /** 空态：全序列无有效样本 —— 不画假线 */
  if (!hasData) {
    return (
      <div className={cn('flex items-center justify-center text-sub text-12', className)} style={{ height }}>
        无可用序列数据
      </div>
    )
  }

  const tickIdx = sampleTicks(labels.length, 8)

  /** 客户端坐标 → 数据点索引 */
  const pickIndex = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return null // jsdom / 未布局：不猜测
    const ratio = (e.clientX - rect.left) / rect.width
    const i = Math.round(ratio * (labels.length - 1))
    return Math.max(0, Math.min(labels.length - 1, i))
  }

  /**
   * 悬浮：同时记录**索引**与**像素锚点**。
   *
   * 锚点的 Y 取该索引上**最高的有效点**（折线里通常紧贴视线焦点），
   * 而非光标位置 —— 光标可能落在两序列之间的空白，锚到光标会让气泡飘在
   * 没有数据的地方，反而找不到对应读数。该索引全为 null 时退回绘图区顶部。
   */
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!el) return
    const i = pickIndex(e)
    if (i == null) {
      setHover(null)
      return
    }
    const ys = series
      .map((s) => {
        const v = s.values[i]
        return isNum(v) ? (s.axis === 'right' ? syRight : syLeft)?.(v) : null
      })
      .filter((y): y is number => y != null)
    const vy = ys.length ? Math.min(...ys) : box.y0
    setHover({ i, anchor: viewToPx(el, e.currentTarget, sx(i), vy, width) })
  }

  const tip = hover
    ? {
        title: labels[hover.i],
        rows: series
          .filter((s) => s.readable !== false)
          .map((s) => {
            const v = s.values[hover.i]
            return {
              label: s.name,
              value: isNum(v) ? (s.format ?? format)(v) : '—',
              tone: isNum(v) ? (s.tone ?? 'mid') : ('sub' as const),
            }
          }),
      }
    : null

  return (
    <div ref={setEl} className={cn('relative flex flex-col gap-1.5', className)}>
      {showLegend && series.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 text-12 text-sub">
              <span
                className="inline-block w-3.5"
                style={{
                  height: 2,
                  background: toneVar(s.tone ?? 'mid'),
                  opacity: s.dashed ? 0.7 : 1,
                  // 虚线图例：用重复渐变模拟，避免引入额外 SVG
                  backgroundImage: s.dashed
                    ? `repeating-linear-gradient(to right, ${toneVar(s.tone ?? 'mid')} 0 4px, transparent 4px 7px)`
                    : undefined,
                }}
              />
              {s.name}
              {s.axis === 'right' ? '（右轴）' : ''}
            </span>
          ))}
        </div>
      )}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`折线图：${series.map((s) => s.name).join('、')}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* ── 网格与左轴刻度 ── */}
        {scaleInfo &&
          scaleInfo.ticks.map((t) => {
            const y = round2(syLeft!(t))
          return (
            <g key={`yt-${t}`}>
              <line
                x1={box.x0}
                y1={y}
                x2={box.x1}
                y2={y}
                stroke="var(--color-line-faint)"
                strokeWidth={1}
              />
              <text
                x={box.x0 - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-sub)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {format(t)}
              </text>
            </g>
          )
        })}

        {/* ── 参考线（阈值线：情绪分 7 / 2 这类判定边界 · 左轴） ── */}
        {scaleInfo && refLines.map((r) => {
          const y = round2(syLeft!(r.value))
          return (
            <g key={`ref-${r.value}-${r.label ?? ''}`}>
              <line
                x1={box.x0}
                y1={y}
                x2={box.x1}
                y2={y}
                stroke={toneVar(r.tone ?? 'sub')}
                strokeWidth={1}
                strokeDasharray={r.dashed === false ? undefined : '4 3'}
                opacity={0.55}
              />
              {r.label && (
                <text x={box.x1 - 2} y={y - 3} textAnchor="end" fontSize={9.5} fill={toneVar(r.tone ?? 'sub')}>
                  {r.label}
                </text>
              )}
            </g>
          )
        })}

        {/* ── 右轴刻度（副轴序列：炸板率 % 这类不同量纲指标）── */}
        {rightScaleInfo &&
          rightScaleInfo.ticks.map((t) => {
            const y = round2(syRight!(t))
            return (
              <g key={`ryt-${t}`}>
                <line x1={box.x1} y1={y} x2={box.x1 + 3} y2={y} stroke="var(--color-line-faint)" strokeWidth={1} />
                <text
                  x={box.x1 + 5}
                  y={y + 3}
                  textAnchor="start"
                  fontSize={10}
                  fill="var(--color-sub)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {(rightSeries[0]?.format ?? format)(t)}
                </text>
              </g>
            )
          })}

        {/* ── X 轴标签（抽稀，恒保首尾） ── */}
        {tickIdx.map((i) => (
          <text
            key={`xt-${labels[i]}-${i}`}
            x={round2(sx(i))}
            y={box.y1 + 14}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-sub)"
          >
            {labels[i]}
          </text>
        ))}

        {/* ── 序列本体 ── */}
        {series.map((s) => {
          const tone = s.tone ?? 'mid'
          const scale = s.axis === 'right' ? syRight : syLeft
          const at = (i: number, v: number): [number, number] =>
            scale ? [sx(i), scale(v)] : [box.x0, box.y0]
          const areas = s.area ? areaSegments(s.values, at, box.y1) : []
          const segs = lineSegments(s.values, at)
          return (
            <g key={s.name}>
              {areas.map((d, i) => (
                <path
                  // oxlint-disable-next-line react/no-array-index-key -- 断线段序号即身份：同上
                  key={`${s.name}-a${i}`}
                  d={d}
                  fill={toneSoftVar(tone)}
                  opacity={0.75}
                />
              ))}
              {segs.map((d, i) => (
                <path
                  // oxlint-disable-next-line react/no-array-index-key -- 断线段序号即身份：段由 null 位置决定，段本身无内容标识
                  key={`${s.name}-l${i}`}
                  d={d}
                  fill="none"
                  stroke={toneVar(tone)}
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                />
              ))}
              {/* 点少时直接画点：两个点连线的「趋势」是伪信息 */}
              {labels.length <= dotThreshold &&
                s.values.map((v, i) =>
                  isNum(v) ? (
                    <circle
                      // oxlint-disable-next-line react/no-array-index-key -- 与序列索引严格对齐
                      key={`${s.name}-d${i}`}
                      cx={round2(sx(i))}
                      cy={scale ? round2(scale(v)) : 0}
                      r={2.6}
                      fill={toneVar(tone)}
                    />
                  ) : null,
                )}
            </g>
          )
        })}

        {/* ── 悬浮十字（竖向准星）+ 命中点高亮 ── */}
        {hover && (
          <>
            <line
              x1={round2(sx(hover.i))}
              y1={box.y0}
              x2={round2(sx(hover.i))}
              y2={box.y1}
              stroke="var(--color-line-strong)"
              strokeWidth={1}
            />
            {series.map((s) => {
              const v = s.values[hover.i]
              if (!isNum(v)) return null
              const scale = s.axis === 'right' ? syRight : syLeft
              return (
                <circle
                  key={`hv-${s.name}`}
                  cx={round2(sx(hover.i))}
                  cy={scale ? round2(scale(v)) : 0}
                  r={3.2}
                  fill="var(--color-card)"
                  stroke={toneVar(s.tone ?? 'mid')}
                  strokeWidth={2}
                />
              )
            })}
          </>
        )}
      </svg>

      {/* ── 悬浮读数：浮层锚定在数据点旁（不是图表下方的静态行）── */}
      {tip && hover && <ChartTooltip anchor={hover.anchor} payload={tip} />}
    </div>
  )
}

/**
 * 移动平均序列构造器 —— 情绪分 MA3 这类「方向层」曲线的标准做法。
 *
 * 单独导出而非内联，是为了让调用方与 `movingAverage` 的 null 语义保持一致：
 * 窗口内缺样本 → null → 图上断线，不用少量样本冒充均线。
 */
export function maLine(name: string, values: MaybeNum[], window: number, tone: Tone = 'sub'): LineSeries {
  return { name, values: movingAverage(values, window), tone, dashed: true }
}
