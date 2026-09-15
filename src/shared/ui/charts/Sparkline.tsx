import { useId, useRef, useState } from 'react'
import { areaSegments, cn, extentOf, isNum, lineSegments, round2, scaleLinear, type MaybeNum } from '@/shared/lib'
import { toneSoftVar, toneVar, type Tone } from './util'
import { ChartTooltip, viewToPx, type TipAnchor } from './Tooltip'

/**
 * 迷你趋势线 —— 嵌在表格单元格 / 指标行里的极简折线。
 *
 * ## 设计取舍
 *
 * 没有坐标轴、没有刻度、没有网格：它的职责是「一眼看出走势方向」，
 * 精确读数交给旁边的数字列。因此内部坐标空间固定为 `100 × h`，
 * 用 `preserveAspectRatio="none"` 横向拉伸填满容器 —— **不画文字**，
 * 所以拉伸不会造成字体变形。
 *
 * `vector-effect="non-scaling-stroke"` 是关键：没有它，横向拉伸会把
 * 线宽也一起拉扁（1px 变成 0.3px 或 3px），曲线看上去忽粗忽细。
 *
 * ## ⚠️ 全为 null 时不画线
 *
 * 而是画一条**虚线的中性基线**。若画成实线，读者会以为「这条线有数据且是平的」；
 * 虚线 + 灰色明确表达「这段时间没有采集到样本」。
 *
 * ## 悬浮读数为什么必须带 `labels`
 *
 * 折线本身不含时间轴。没有 `labels` 时悬浮只能报「第 4 个点 = 37」——
 * 而人真正要问的是「**哪一天**是 37」。因此 `labels` 是可选但强烈建议传的：
 * 传了才有日期，没传则退化为序号（明确标注为「序号」而不是假装是日期）。
 */
export function Sparkline({
  points,
  tone = 'mid',
  area = false,
  height = 26,
  className,
  /** 末点加圆点 —— 用于强调「最新值」 */
  showLast = true,
  /** 与 `points` 等长的横轴标签（日期等）—— 悬浮读数用 */
  labels,
  /** 值的文本化（如加 % / 亿）—— 悬浮读数用 */
  format,
}: {
  points: MaybeNum[]
  tone?: Tone
  area?: boolean
  height?: number
  className?: string
  showLast?: boolean
  labels?: string[]
  format?: (v: number) => string
}) {
  // ⚠️ `useId` 在 SSR/并发下可能含 `:` 或 `«»`，直接拼进 `url(#…)` 会失效
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [hover, setHover] = useState<{ i: number; anchor: TipAnchor } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  /**
   * 内部坐标空间固定 `W × H`，配合 `preserveAspectRatio="none"` 横向铺满容器。
   *
   * ⚠️ `W` 不是随手取的：`none` 会**非等比**拉伸，任何近圆形元素都会被压成椭圆
   *    （`vector-effect` 只作用于描边，救不了几何形状）。因此取 W=120 使
   *    viewBox 宽高比 ≈ 4.6，贴近表格单元格里 sparkline 的实际渲染比例
   *    （约 120–160px 宽 × 26px 高），把末点圆点的形变压到可忽略。
   */
  const W = 120
  const H = height
  const pad = 2
  const ext = extentOf(points)

  // 无任何有效样本：虚线基线 + 中性色
  if (!ext) {
    return (
      <span ref={wrapRef} className={cn('relative inline-block w-full align-middle', className)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: H }}
          role="img"
          aria-label="无数据"
        >
          <line
            x1={0}
            y1={H / 2}
            x2={W}
            y2={H / 2}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
    )
  }

  // 单点或全平：撑开一点域，避免把线画在贴边位置
  const lo = ext[0] === ext[1] ? ext[0] - 1 : ext[0]
  const hi = ext[0] === ext[1] ? ext[1] + 1 : ext[1]

  const sx = scaleLinear([0, Math.max(1, points.length - 1)], [pad, W - pad])
  const sy = scaleLinear([lo, hi], [H - pad, pad])
  const at = (i: number, v: number) => [sx(i), sy(v)] as const

  const segs = lineSegments(points, at)
  const areas = area ? areaSegments(points, at, H - pad) : []

  const lastIdx = points.reduce<number>((acc, v, i) => (isNum(v) ? i : acc), -1)
  const lastVal = lastIdx >= 0 ? points[lastIdx] : null

  const stroke = toneVar(tone)

  return (
    <span ref={wrapRef} className={cn('relative inline-block w-full align-middle', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: H }}
        role="img"
        aria-label={`趋势：${segs.length > 0 ? '有数据' : '无数据'}`}
        onMouseMove={(e) => {
          const wrap = wrapRef.current
          if (!wrap) return
          const r = e.currentTarget.getBoundingClientRect()
          if (!r.width) return // jsdom / 未布局：不猜测
          const ratio = (e.clientX - r.left) / r.width
          const i = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))))
          // 锚点贴住该点的实际 y（可能有 null，退回中线）
          const v = points[i]
          const vy = isNum(v) ? sy(v) : H / 2
          setHover({ i, anchor: viewToPx(wrap, e.currentTarget, sx(i), vy, W) })
        }}
        onMouseLeave={() => setHover(null)}
      >
      {area && (
        <defs>
          <linearGradient id={`sg-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={toneSoftVar(tone)} stopOpacity={0.9} />
            <stop offset="100%" stopColor={toneSoftVar(tone)} stopOpacity={0.15} />
          </linearGradient>
        </defs>
      )}

      {areas.map((d, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- 断线段序号即身份：分段由 null 位置决定，段本身无 id
        <path key={`a${i}`} d={d} fill={`url(#sg-${gid})`} />
      ))}

      {segs.map((d, i) => (
        <path
          // oxlint-disable-next-line react/no-array-index-key -- 断线段序号即身份：段由 null 位置决定，段本身没有可用的内容标识
          key={`l${i}`}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {showLast && isNum(lastVal) && (
        <circle cx={round2(sx(lastIdx))} cy={round2(sy(lastVal))} r={2} fill={stroke} vectorEffect="non-scaling-stroke" />
      )}

      {/* ── 悬浮准星 + 命中点 ── */}
      {hover && isNum(points[hover.i]) && (
        <>
          <line
            x1={round2(sx(hover.i))}
            y1={0}
            x2={round2(sx(hover.i))}
            y2={H}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={round2(sx(hover.i))}
            cy={round2(sy(points[hover.i] as number))}
            r={2.4}
            fill="var(--color-card)"
            stroke={stroke}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      </svg>

      {/* ── 悬浮读数：有 labels 报日期，没有则明说「序号」（不假装是日期）── */}
      {hover && (
        <ChartTooltip
          anchor={hover.anchor}
          payload={{
            title: labels?.[hover.i] ?? `序号 ${hover.i + 1}`,
            rows: [
              {
                label: labels ? '数值' : '数值（按序号定位）',
                value: isNum(points[hover.i])
                  ? (format?.(points[hover.i] as number) ?? String(points[hover.i]))
                  : '无样本',
                tone: isNum(points[hover.i]) ? tone : ('sub' as const),
              },
            ],
          }}
        />
      )}
    </span>
  )
}
