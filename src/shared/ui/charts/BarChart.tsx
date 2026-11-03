import { useMemo, useState } from 'react'
import {
  axisLabel,
  bipolarScale,
  cn,
  extentOf,
  isNum,
  round2,
  scaleLinear,
  withZero,
  type MaybeNum,
} from '@/shared/lib'
import { plotBox, sampleTicks, toneSoftVar, toneVar, valueTone, type Tone } from './util'
import { ChartTooltip, viewToPx, type TipAnchor } from './Tooltip'
import { useChartWidth } from './useChartWidth'

/** 一根柱子 */
export interface Bar {
  label: string
  value: MaybeNum
  /** 强制指定语义色；缺省按数值正负自动判（正红负绿） */
  tone?: Tone
  /** 对比值（如「昨日」）—— 画成相邻的描边空心柱，用于同维度前后对照 */
  compare?: MaybeNum
  /** 对比值的说明（图例/悬浮文案用） */
  compareLabel?: string
}

/**
 * 柱状图 —— 数量/金额类数据的主力图。
 *
 * ## 与折线图的根本差别：**必须过零基线**
 *
 * 柱子靠「长度」表达数量，跨零基线就没有可比性：`[3, 5]` 若画在 `[3, 5]` 轴上，
 * 两根柱子几乎等高（视觉 1:1），而真实比例是 3:5。因此这里一律走
 * `withZero`（单向）或 `bipolarScale`（双向）。
 *
 * ## 双向轴（资金净流入/流出）
 *
 * 检测到有负值时自动切成双向：零基线居中，**正值向上且红、负值向下且绿**
 * （A 股口径，非欧美）。零基线必须落在刻度上，否则读图的人无从判断正负。
 *
 * ## null 不画成 0 高柱
 *
 * 缺数据时画一个贴基线的**虚线短横**，明确表达「此处无样本」。
 * 若按 0 画，会得到一根看不见的柱子 —— 与「值恰好为 0」在视觉上无法区分。
 */
export function BarChart({
  bars,
  height = 200,
  /** 首帧兜底宽度 —— 最终以容器实测宽度为准，高度恒定（见 useChartWidth） */
  width: widthHint = 720,
  format = axisLabel,
  yTickCount = 4,
  showValue = true,
  /** 强制单向/双向；缺省按数据自动判 */
  bipolar,
  /** 柱宽上限（柱子很少时避免撑成巨型色块） */
  maxBarWidth = 46,
  className,
}: {
  bars: Bar[]
  height?: number
  width?: number
  format?: (v: number) => string
  yTickCount?: number
  showValue?: boolean
  bipolar?: boolean
  maxBarWidth?: number
  className?: string
}) {
  /** 悬浮态：索引 + 像素锚点 */
  const [hover, setHover] = useState<{ i: number; anchor: TipAnchor } | null>(null)
  const { width, el, setEl } = useChartWidth(widthHint)
  const box = plotBox(width, height)

  const hasCompare = bars.some((b) => isNum(b.compare))

  const scaleInfo = useMemo(() => {
    const all: MaybeNum[] = bars.flatMap((b) => [b.value, b.compare])
    const ext = extentOf(all)
    if (!ext) return null
    const isBipolar = bipolar ?? ext[0] < 0
    return isBipolar ? bipolarScale(ext, yTickCount) : niceZeroScale(ext, yTickCount)
  }, [bars, bipolar, yTickCount])

  const hasData = !!scaleInfo && bars.some((b) => isNum(b.value) || isNum(b.compare))

  if (!hasData || !scaleInfo) {
    return (
      <div className={cn('flex items-center justify-center text-sub text-12', className)} style={{ height }}>
        无可用柱状数据
      </div>
    )
  }

  const sy = scaleLinear([scaleInfo.min, scaleInfo.max], [box.y1, box.y0])

  // 槽位布局：对比柱占槽内两格之一
  const slot = box.w / Math.max(1, bars.length)
  const barW = Math.min(maxBarWidth, hasCompare ? slot * 0.34 : slot * 0.55)
  const zeroY = round2(sy(0))

  const showLabels = bars.length <= 14
  const tickIdx = sampleTicks(bars.length, 12)
  const active = hover != null ? bars[hover.i] : null

  return (
    <div ref={setEl} className={cn('relative flex flex-col gap-1.5', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="柱状图"
      >
        {/* ── 网格与 Y 轴刻度 ── */}
        {scaleInfo.ticks.map((t) => {
          const y = round2(sy(t))
          const isZero = t === 0
          return (
            <g key={`yt-${t}`}>
              <line
                x1={box.x0}
                y1={y}
                x2={box.x1}
                y2={y}
                stroke={isZero ? 'var(--color-line-strong)' : 'var(--color-line-faint)'}
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

        {/* ── 柱体 ── */}
        {bars.map((b, i) => {
          const cx = box.x0 + slot * (i + 0.5)
          const v = b.value
          const c = b.compare
          const tone = b.tone ?? valueTone(v)

          // 对比柱靠左、主柱靠右（视觉上「过去 → 现在」从左到右）
          const cmpX = cx - (hasCompare ? barW + 1 : 0)
          const mainX = cx - (hasCompare ? 0 : barW / 2)

          const draw = (val: MaybeNum, x: number, t: Tone, hollow: boolean) => {
            if (!isNum(val)) {
              // 无样本：贴基线的虚线短横（区别于「值为 0」）
              return (
                <line
                  key={`n-${x}`}
                  x1={round2(x)}
                  y1={zeroY}
                  x2={round2(x + barW)}
                  y2={zeroY}
                  stroke="var(--color-line-strong)"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                />
              )
            }
            const yv = round2(sy(val))
            const top = Math.min(yv, zeroY)
            const h = Math.max(1.5, Math.abs(zeroY - yv))
            return (
              <rect
                key={`b-${x}`}
                x={round2(x)}
                y={round2(top)}
                width={round2(barW)}
                height={round2(h)}
                rx={1.5}
                fill={hollow ? toneSoftVar(t) : toneVar(t)}
                stroke={hollow ? toneVar(t) : undefined}
                strokeWidth={hollow ? 1 : undefined}
                opacity={hover == null || hover.i === i ? 1 : 0.42}
              />
            )
          }

          return (
            // oxlint-disable-next-line react/no-array-index-key -- 同标签柱子去重：同一题材可能分「主板/创业板」两口径同名出现，索引是唯一稳定身份
            <g key={`bar-${b.label}-${i}`}>
              {/* 悬浮热区：整槽可点，避免柱子太细难以命中 */}
              <rect
                x={round2(box.x0 + slot * i)}
                y={box.y0}
                width={round2(slot)}
                height={round2(box.h)}
                fill="transparent"
                onMouseEnter={(e) => {
                  if (!el) return
                  /* 锚点取「槽中心 + 主柱顶端」—— 贴着柱子读数，而不是跟着光标跑；
                     光标常落在柱间的空白槽里，锚到光标会让气泡飘在无数据处。
                     主柱无值时退回该槽的对比柱顶端，两者都无值则退回零基线。 */
                  const ys = [v, c].filter(isNum).map((x) => sy(x))
                  const vy = ys.length ? Math.min(...ys) : zeroY
                  setHover({ i, anchor: viewToPx(el, e.currentTarget.ownerSVGElement!, box.x0 + slot * (i + 0.5), vy, width) })
                }}
                onMouseLeave={() => setHover(null)}
              />
              {hasCompare && draw(c, cmpX, 'sub', true)}
              {draw(v, mainX, tone, false)}

              {/* 数值标签：柱少时直标，多了会糊 */}
              {showValue && showLabels && isNum(v) && (
                <text
                  x={round2(hasCompare ? mainX + barW / 2 : cx)}
                  y={round2(v >= 0 ? sy(v) - 4 : sy(v) + 11)}
                  textAnchor="middle"
                  fontSize={10}
                  fill={toneVar(tone)}
                  style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                >
                  {format(v)}
                </text>
              )}
              {showValue && showLabels && isNum(c) && hasCompare && (
                <text
                  x={round2(cmpX + barW / 2)}
                  y={round2(c >= 0 ? sy(c) - 4 : sy(c) + 11)}
                  textAnchor="middle"
                  fontSize={9.5}
                  fill="var(--color-sub)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {format(c)}
                </text>
              )}
            </g>
          )
        })}

        {/* ── X 轴标签（抽稀） ── */}
        {tickIdx.map((i) => (
          <text
            key={`xt-${bars[i].label}-${i}`}
            x={round2(box.x0 + slot * (i + 0.5))}
            y={box.y1 + 14}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-sub)"
          >
            {bars[i].label}
          </text>
        ))}
      </svg>

      {/* ── 图例（对比柱的含义说明）── */}
      {hasCompare && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-sub">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-2.5 rounded-sm" style={{ background: 'var(--color-sub)' }} />
            {bars.find((b) => b.compareLabel)?.compareLabel ?? '对比值'}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block w-3 h-2.5 rounded-sm border"
              style={{ borderColor: 'var(--color-sub)', background: 'var(--color-line)' }}
            />
            本期
          </span>
        </div>
      )}

      {/* ── 悬浮读数：浮层锚定在柱旁，含「变化」这一最重要的派生量 ── */}
      {active && hover && (
        <ChartTooltip
          anchor={hover.anchor}
          payload={{
            title: active.label,
            rows: [
              {
                label: '本期',
                value: isNum(active.value) ? format(active.value) : '—',
                tone: active.tone ?? valueTone(active.value),
              },
              ...(isNum(active.compare)
                ? [{ label: active.compareLabel ?? '对比值', value: format(active.compare), tone: 'sub' as const }]
                : []),
              ...(isNum(active.value) && isNum(active.compare)
                ? [
                    {
                      label: '变化',
                      value: format(active.value - active.compare),
                      tone: valueTone(active.value - active.compare),
                    },
                  ]
                : []),
            ],
          }}
        />
      )}
    </div>
  )
}

/**
 * 单向轴：下限强制到 0（可能为负的极端情形也兜住）。
 *
 * 独立成函数是为了让「柱状图必须过零」这条规则**只有一处实现** ——
 * 之前 inline 写过两次，改一次漏一次。
 */
function niceZeroScale(ext: [number, number], tickCount: number) {
  const z = withZero(ext)
  return bipolarScale(z, tickCount)
}
