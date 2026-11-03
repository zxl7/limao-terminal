import { useRef, useState } from 'react'
import { cn, isNum, polar } from '@/shared/lib'
import { toneVar, type Tone } from './util'
import { ChartTooltip, viewToPx, type TipAnchor } from './Tooltip'

/** 空分档的稳定引用 —— 避免默认值数组每次渲染换引用（同 LineChart 的 NO_REF_LINES） */
const NO_BANDS: { min: number; tone: Tone; name?: string }[] = []

/**
 * 弧表（仪表）—— 单个 0–N 标量的语义化呈现（情绪分 / 晋级率 / 封板率）。
 *
 * ## 与「一个大号数字」的差别
 *
 * 情绪分这类指标的价值主要在**所处档位**（≥7 偏强 / ≤2 退潮），而不是第三位小数。
 * 弧表把「当前值在量程里的位置」和「阈值分档」画进同一图形，省去读数字再对照
 * 阈值的两步心算 —— 而这一步心算正是「强普涨被误读为分歧」的历史来源。
 *
 * ## ⚠️ `null` 不画弧、不装 0
 *
 * 缺数据时弧长置零并显式标注「—」，色用中性灰。若按 0 渲染，情绪分会显示成
 * 「退潮 0 分」这类**与事实相反的结论**（实际是「该时点没采到情绪分」）。
 */
export function Gauge({
  value,
  max = 10,
  label,
  /** 阈值分档：按升序给出，用于着色与档位标注（如情绪分 2 / 4.5 / 7 / 9） */
  bands = NO_BANDS,
  size = 128,
  /** 弧线粗细 */
  thickness = 10,
  /** 弧的圆心角（度）。180 = 半圆，270 = 四分之三圆 */
  sweep = 240,
  showValue = true,
  className,
}: {
  value: number | null | undefined
  max?: number
  label?: string
  bands?: { min: number; tone: Tone; name?: string }[]
  size?: number
  thickness?: number
  sweep?: number
  showValue?: boolean
  className?: string
}) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - thickness
  // 起始角：把弧摆正（如 240° 弧则从 -120° 起，对称跨过 12 点）
  const start = -sweep / 2

  const arcPath = (fromDeg: number, toDeg: number) => {
    const [x0, y0] = polar(cx, cy, r, fromDeg)
    const [x1, y1] = polar(cx, cy, r, toDeg)
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`
  }

  const has = isNum(value)
  const ratio = has ? Math.max(0, Math.min(1, value / max)) : 0
  const endAngle = start + sweep * ratio

  /** 依阈值分档取语义色 —— 与全站情绪分着色口径一致 */
  const tone: Tone = !has
    ? 'sub'
    : bands.length
      ? ([...bands].reverse().find((b) => value >= b.min)?.tone ?? 'sub')
      : 'mid'

  const bandName = has && bands.length ? [...bands].reverse().find((b) => value >= b.min)?.name : undefined

  /** 悬浮态：弧表只有一个标量，锚点取弧的末端（「当前落在哪」的那个点） */
  const [hover, setHover] = useState<TipAnchor | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tipX, tipY] = polar(cx, cy, r, has && ratio > 0 ? endAngle : start)

  return (
    <div ref={wrapRef} className={cn('relative inline-flex flex-col items-center', className)} style={{ width: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${label ?? '指标'} ${has ? value : '无数据'}`}
        onMouseMove={(e) => {
          const wrap = wrapRef.current
          if (!wrap) return
          setHover(viewToPx(wrap, e.currentTarget, tipX, tipY, size))
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* 底弧 */}
        <path
          d={arcPath(start, start + sweep)}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={thickness}
          strokeLinecap="round"
        />

        {/* 阈值分档刻痕 —— 让「7 分是偏强线」这类边界可见 */}
        {bands.map((b) => {
          const a = start + sweep * Math.max(0, Math.min(1, b.min / max))
          const [x0, y0] = polar(cx, cy, r - thickness / 2, a)
          const [x1, y1] = polar(cx, cy, r + thickness / 2, a)
          return (
            <line
              key={`band-${b.min}`}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke="var(--color-card)"
              strokeWidth={1.5}
            />
          )
        })}

        {/* 数值弧 */}
        {has && ratio > 0 && (
          <path
            d={arcPath(start, endAngle)}
            fill="none"
            stroke={toneVar(tone)}
            strokeWidth={thickness}
            strokeLinecap="round"
          />
        )}

        {/* 指针端点（小圆点，强调「当前落在哪」） */}
        {has && ratio > 0 && (
          <circle cx={polar(cx, cy, r, endAngle)[0]} cy={polar(cx, cy, r, endAngle)[1]} r={thickness / 2 + 1} fill={toneVar(tone)} />
        )}

        {/* 中心读数 */}
        {showValue && (
          <>
            <text
              x={cx}
              y={cy + 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={size * 0.2}
              fontWeight={700}
              fill={toneVar(tone)}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {has ? value : '—'}
            </text>
            <text x={cx} y={cy + size * 0.19} textAnchor="middle" fontSize={size * 0.085} fill="var(--color-sub)">
              {bandName ?? (label ? '' : `满分 ${max}`)}
            </text>
          </>
        )}
      </svg>

      {label && <div className="text-12 text-sub -mt-1">{label}</div>}

      {hover && (
        <ChartTooltip
          anchor={hover}
          payload={{
            title: label ?? '指标',
            rows: [
              {
                label: '取值',
                value: has ? `${value} / ${max}` : '—',
                tone: has ? tone : ('sub' as const),
              },
              ...(bandName ? [{ label: '档位', value: bandName, tone: tone }] : []),
            ],
          }}
        />
      )}
    </div>
  )
}
