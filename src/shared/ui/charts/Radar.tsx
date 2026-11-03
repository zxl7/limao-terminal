import { useRef, useState } from 'react'
import { cn, evenAngles, isNum, polar, type MaybeNum } from '@/shared/lib'
import { toneVar, type Tone } from './util'
import { ChartTooltip, viewToPx, type TipAnchor } from './Tooltip'

/** 雷达图的单个维度 */
export interface RadarAxis {
  label: string
  value: MaybeNum
  /** 该维度满分（用于归一化） */
  max: number
  /** 维度说明（悬浮/图例） */
  hint?: string
}

/**
 * 雷达图 —— 多维等权评分的形状化表达（板块四维 / 个股多维打分）。
 *
 * ## 为什么多维打分适合雷达图
 *
 * 雷达图的强项不是精确读数，而是**形状**：四边形越接近正方形，说明四个维度越均衡；
 * 某一角塌陷则一眼看出短板。横向柱状图需要读四段长度再心算比较，雷达图把这步
 * 交给视觉。
 *
 * ## ⚠️ 维度顺序会改变形状，必须固定
 *
 * 同一组指标换个排列顺序，多边形形状就变了。`evenAngles` 固定从 12 点方向起、
 * 顺时针等分，保证同一组指标在任何页面/任何时间点画的图形位置一致 —— 否则
 * 两次截图无法对比。
 *
 * ## 缺维度如实呈现
 *
 * 某维度为 `null` 时该顶点落到圆心（不外插、不借平均值填补），并在图例标「—」。
 * 落圆心会让多边形塌陷一角，这是**正确的信号**：「这一维没测到」。
 */
export function Radar({
  axes,
  size = 200,
  tone = 'up',
  /** 对比多边形（如全市场均值作为背景参照） */
  compare,
  compareTone = 'sub',
  className,
}: {
  axes: RadarAxis[]
  size?: number
  tone?: Tone
  compare?: MaybeNum[]
  compareTone?: Tone
  className?: string
}) {
  /* Hook 必须在「维度 < 3」的空态提前返回之前 —— 两条渲染路径 Hook 数须一致 */
  const [hover, setHover] = useState<{ i: number; anchor: TipAnchor } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  if (axes.length < 3) {
    // 少于 3 个维度构不成面 —— 退回文字列表，不强行画
    return (
      <div className={cn('text-sub text-12', className)}>
        {axes.map((a) => (
          <span key={a.label} className="mr-3">
            {a.label} <span className="num text-txt">{isNum(a.value) ? a.value : '—'}</span>
          </span>
        ))}
      </div>
    )
  }

  const cx = size / 2
  const cy = size / 2
  // 留出标签空间
  const radius = size / 2 - 26
  const angles = evenAngles(axes.length)

  /** 逐维归一化（各维满分不同的关键：不能共用一个 max） */
  const norm = (i: number, v: MaybeNum) => {
    const m = axes[i]?.max ?? 0
    if (!isNum(v) || m <= 0) return 0
    return Math.max(0, Math.min(1, v / m))
  }

  const values = axes.map((a, i) => norm(i, a.value))
  const dataPts = values
    .map((r, i) => {
      const [x, y] = polar(cx, cy, r * radius, angles[i])
      return `${x},${y}`
    })
    .join(' ')

  // 蛛网刻度环（25% / 50% / 75% / 100%）
  const rings = [0.25, 0.5, 0.75, 1]

  return (
    <div ref={wrapRef} className={cn('relative inline-flex flex-col items-center gap-2', className)}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} role="img" aria-label="多维雷达图">
        {/* ── 蛛网环 ── */}
        {rings.map((r) => (
          <polygon
            key={`ring-${r}`}
            points={angles
              .map((a) => {
                const [x, y] = polar(cx, cy, r * radius, a)
                return `${x},${y}`
              })
              .join(' ')}
            fill={r === 1 ? 'var(--color-card)' : 'none'}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
        ))}

        {/* ── 轴线 ── */}
        {angles.map((a, i) => {
          const [x, y] = polar(cx, cy, radius, a)
          return (
            <line
              key={`axis-${axes[i].label}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          )
        })}

        {/* ── 对比多边形（背景参照） ── */}
        {compare && compare.length === axes.length && (
          <polygon
            /* 逐维各自归一（各维满分不同），不共用单一 max —— 共用会把
               「满分 25 的维度」和「满分 100 的维度」画成同一量级 */
            points={compare
              .map((v, i) => {
                const [x, y] = polar(cx, cy, norm(i, v) * radius, angles[i])
                return `${x},${y}`
              })
              .join(' ')}
            fill="none"
            stroke={toneVar(compareTone)}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* ── 数据多边形 ── */}
        <polygon points={dataPts} fill={toneVar(tone)} fillOpacity={0.16} stroke={toneVar(tone)} strokeWidth={2} />

        {/* ── 数据顶点（缺维度落圆心，如实呈现） ── */}
        {values.map((r, i) => {
          const [x, y] = polar(cx, cy, r * radius, angles[i])
          const missing = !isNum(axes[i].value)
          return (
            <circle
              key={`pt-${axes[i].label}`}
              cx={x}
              cy={y}
              r={missing ? 2 : 3}
              fill={missing ? 'var(--color-card)' : toneVar(tone)}
              stroke={missing ? 'var(--color-line-strong)' : undefined}
              strokeWidth={missing ? 1.5 : undefined}
              /* 顶点本身也是悬浮热区：命中面积小，故补一个透明大圆兜住 */
            />
          )
        })}

        {/* ── 悬浮热区（整条轴线都可命中，避免只点到 3px 圆点）── */}
        {axes.map((a, i) => {
          const [x, y] = polar(cx, cy, radius, angles[i])
          return (
            <line
              key={`hit-${a.label}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="transparent"
              strokeWidth={16}
              strokeLinecap="round"
              onMouseEnter={(e) => {
                const wrap = wrapRef.current
                if (!wrap) return
                /* 锚点取该维**顶点**位置（贴着数据，而不是贴着光标）——
                   四根轴线都从圆心出发，若锚到光标，靠内侧的会全挤在圆心附近 */
                const [px, py] = polar(cx, cy, values[i] * radius, angles[i])
                setHover({ i, anchor: viewToPx(wrap, e.currentTarget.ownerSVGElement!, px, py, size) })
              }}
              onMouseLeave={() => setHover(null)}
            />
          )
        })}

        {/* ── 维度标签 ── */}
        {axes.map((a, i) => {
          const [x, y] = polar(cx, cy, radius + 15, angles[i])
          return (
            <text
              key={`lb-${a.label}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10.5}
              fill={hover?.i === i ? toneVar(tone) : 'var(--color-sub)'}
            >
              {a.label}
            </text>
          )
        })}
      </svg>

      {/* ── 悬浮读数：维度 + 取值/满分 + 口径说明（hint）── */}
      {hover && (
        <ChartTooltip
          anchor={hover.anchor}
          payload={{
            title: axes[hover.i].label,
            rows: [
              {
                label: '取值',
                value: isNum(axes[hover.i].value) ? `${axes[hover.i].value} / ${axes[hover.i].max}` : '—',
                tone: isNum(axes[hover.i].value) ? tone : ('sub' as const),
              },
              ...(axes[hover.i].hint
                ? [{ label: '口径', value: axes[hover.i].hint!, tone: 'sub' as const }]
                : []),
            ],
          }}
        />
      )}

      {/* ── 读数表（雷达图不擅长精确读数，用表格补齐） ── */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-12">
        {axes.map((a) => (
          <span key={`rd-${a.label}`} className="text-sub">
            {a.label}{' '}
            <span className="num" style={{ color: toneVar(tone), fontWeight: 600 }}>
              {isNum(a.value) ? a.value : '—'}
            </span>
            <span className="num text-sub">/{a.max}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
