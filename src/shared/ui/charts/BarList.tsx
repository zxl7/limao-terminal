import { useRef, useState } from 'react'
import { cn, isNum, type MaybeNum } from '@/shared/lib'
import { toneSoftVar, toneVar, valueTone, type Tone } from './util'
import { ChartTooltip, pointerToPx, type TipAnchor } from './Tooltip'

/** 横向条目的数据 */
export interface BarListItem {
  label: string
  value: MaybeNum
  /** 强制语义色；缺省按正负自动判 */
  tone?: Tone
  /** 右侧附注（如「3天3板」「板块龙」） */
  note?: string
  /** 左侧次要说明（如代码） */
  sub?: string
}

/**
 * 横向排名条 —— 榜单类数据的标准形态（板块资金流 / 股性榜 / 四维得分）。
 *
 * ## 为什么用 HTML/CSS 而不是 SVG
 *
 * 横向条本质是「一个宽度百分比 + 一行文字」。用 SVG 画要把文字也塞进
 * `<text>`，于是字体随容器缩放、换行困难、可选中性差。用 div + `width:%`
 * 则天然响应式、文字清晰、可直接被浏览器朗读与选中。**能不用 SVG 就不用。**
 *
 * ## 双向模式（`bipolar`）
 *
 * 用于资金净流入/流出这类有正负的榜单：零线居中，正条向右、负条向左，
 * 使「流入」与「流出」在视觉上形成对冲感 —— 这是单项列表无法表达的信息。
 *
 * ## ⚠️ 宽度按传入的 `max` 归一，而不是按本批数据的最大值
 *
 * 若按本批最大值归一，榜单里只要有一个「巨无霸」，其余全被压成小短条，
 * 看似「都没量」；而且**不同时间点的两张榜长度不可比**。调用方应传入
 * 稳定的业务上限（如全市场最大净额），或显式接受「仅本批相对比较」的语义。
 */
export function BarList({
  items,
  format,
  max,
  bipolar = false,
  className,
  /** 条高（px），紧凑表格里可调小 */
  barHeight = 14,
  labelWidth = 96,
  emptyText = '无数据',
}: {
  items: BarListItem[]
  format: (v: MaybeNum) => string
  /** 归一上限（绝对值）；缺省取本批绝对值最大值 */
  max?: number
  bipolar?: boolean
  className?: string
  barHeight?: number
  labelWidth?: number
  emptyText?: string
}) {
  /**
   * 悬浮行 —— 锚点跟随光标（榜单是 HTML 行，没有「数据点坐标」可锚）。
   *
   * 榜单里标签会被 `truncate` 截断、附注会被 `max-w` 截断，悬浮浮层给出**完整原文**，
   * 这正是它不可替代的地方 —— 否则长题材名永远看不全。
   *
   * ⚠️ Hook 必须放在 `items.length` 空态提前返回**之前**：放在后面会让
   *    「有数据/无数据」两条渲染路径的 Hook 数量不一致（React 直接报错）。
   */
  const [hover, setHover] = useState<{ i: number; anchor: TipAnchor } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  if (!items.length) {
    return <div className="text-sub text-[12px] py-2 text-center">{emptyText}</div>
  }

  const autoMax = Math.max(
    0,
    ...items.map((it) => (isNum(it.value) ? Math.abs(it.value) : 0)),
  )
  const norm = max && max > 0 ? max : autoMax
  // 全 0（或全 null）时避免除零 → 所有条长按 0 渲染，而不是 NaN 宽度
  const safe = norm > 0 ? norm : 1

  return (
    <div ref={wrapRef} className={cn('relative flex flex-col gap-1', className)}>
      {items.map((it, i) => {
        const v = it.value
        const tone = it.tone ?? valueTone(v)
        const w = isNum(v) ? Math.min(100, (Math.abs(v) / safe) * 100) : 0
        const active = hover?.i === i

        return (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- 同名条目去重：榜单可能含同名（如 ST 摘帽前后同名），索引是唯一稳定身份
            key={`${it.label}-${i}`}
            className={cn(
              'flex items-center gap-2 text-[12px] rounded-sm transition-colors',
              active && 'bg-line-faint',
            )}
            style={{ minHeight: barHeight + 2 }}
            onMouseMove={(e) => {
              const wrap = wrapRef.current
              if (!wrap) return
              setHover({ i, anchor: pointerToPx(wrap, e) })
            }}
            onMouseLeave={() => setHover(null)}
          >
            <span className="shrink-0 truncate text-txt" style={{ width: labelWidth }}>
              {it.label}
              {it.sub && <span className="num text-sub text-[11px] ml-1">{it.sub}</span>}
            </span>

            {bipolar ? (
              // 零线居中：左半负、右半正
              <span className="relative flex-1 shrink-0" style={{ height: barHeight }}>
                <span
                  className="absolute top-0 bottom-0 w-px"
                  style={{ left: '50%', background: 'var(--color-line-strong)' }}
                />
                {isNum(v) && v !== 0 && (
                  <span
                    className="absolute rounded-sm"
                    style={{
                      top: 2,
                      bottom: 2,
                      background: toneVar(tone),
                      left: v > 0 ? '50%' : `${50 - w / 2}%`,
                      width: `${w / 2}%`,
                    }}
                  />
                )}
                {!isNum(v) && (
                  <span
                    className="absolute text-sub text-[10px]"
                    style={{ left: '50%', top: 0, transform: 'translateX(4px)' }}
                  >
                    无样本
                  </span>
                )}
              </span>
            ) : (
              <span
                className="relative flex-1 shrink-0 rounded-sm overflow-hidden"
                style={{ height: barHeight, background: toneSoftVar(tone) }}
              >
                {isNum(v) && (
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{ width: `${w}%`, background: toneVar(tone) }}
                  />
                )}
                {!isNum(v) && (
                  <span className="absolute inset-0 flex items-center pl-1.5 text-sub text-[10px]">无样本</span>
                )}
              </span>
            )}

            <span
              className="num shrink-0 text-right tabular-nums"
              style={{ width: 66, color: toneVar(tone), fontWeight: 600 }}
            >
              {format(v)}
            </span>

            {it.note && <span className="shrink-0 text-sub text-[11px] max-w-[120px] truncate">{it.note}</span>}
          </div>
        )
      })}

      {hover && (
        <ChartTooltip
          anchor={hover.anchor}
          payload={{
            title: items[hover.i].label,
            rows: [
              {
                label: items[hover.i].sub ?? '数值',
                value: format(items[hover.i].value),
                tone: items[hover.i].tone ?? valueTone(items[hover.i].value),
              },
              ...(items[hover.i].note ? [{ label: '附注', value: items[hover.i].note!, tone: 'sub' as const }] : []),
            ],
          }}
        />
      )}
    </div>
  )
}
