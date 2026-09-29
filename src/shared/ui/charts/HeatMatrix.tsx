import { useRef, useState } from 'react'
import { cn, isNum, type MaybeNum } from '@/shared/lib'
import { ChartTooltip, pointerToPx, type TipAnchor } from './Tooltip'

/** 热力行 */
export interface HeatRow {
  label: string
  /** 左侧次要说明（如代码 / 板块） */
  sub?: string
  values: MaybeNum[]
  /** 右侧附注 */
  note?: string
}

/**
 * 默认格值文本化 —— 提到模块作用域而非写在参数默认值里。
 *
 * 写在 `format = (v) => …` 的位置会让**每次渲染都新建一个函数**：
 * 父组件任何一次 setState 都会让它变引用，进而击穿本组件的 memo 化，
 * 在 20×30 的矩阵上就是 600 次无谓的单元格重算。
 */
function heatDefaultFormat(v: MaybeNum): string {
  return isNum(v) ? String(v) : ''
}

/**
 * 热力矩阵 —— 二维强度数据（题材 × 交易日）的最佳形态。
 *
 * ## 为什么表格换成热力矩阵
 *
 * 原实现是 `DataTable` 逐格填数字。这类数据的使用场景是「扫一眼看哪条线在升温」，
 * 数字表格要求逐格阅读并心算比较，正好把「模式识别」这件人脑最擅长的事交给
 * 了最不擅长的路径。热力色块把强度映射为颜色深浅后，**升温/降温一眼可见**。
 *
 * ## ⚠️ 三态不可混淆：`null` ≠ `0` ≠「有值但很小」
 *
 *   · `null`  —— 该日无样本，画**斜纹灰格**（明确「不知道」，不是「没有」）
 *   · `0`     —— 有样本且为零，画**极浅底但显示数字 0**
 *   · `>0`    —— 按强度着色
 *
 * 若把 null 也画成浅色，读者会把「缺数据」误读为「当日零涨停」——
 * 这正是「null 必须是断点」同一条铁律在二维图上的形态。
 */
export function HeatMatrix({
  rows,
  cols,
  /** 着色上限（绝对值）；缺省取全矩阵最大值，使「本图内最深 = 本图最大」 */
  max,
  /** 每格显示的文本化函数；返回空串则不显示 */
  format = heatDefaultFormat,
  /** 格宽 / 格高（px） */
  cellW = 30,
  cellH = 22,
  /** 左侧行标签宽度 */
  labelWidth = 128,
  /** 右侧附注的固定宽度；`fit` 时用于让日期列与数据格严格对齐。 */
  noteWidth = 0,
  /** 是否渲染色阶图例 */
  legend = true,
  /** `true` 时按正负值使用红绿双向色阶；资金净额等有方向的数据必须开启。 */
  signed = false,
  /** 在容器内均分日期列，取消横向滚动。 */
  fit = false,
  className,
}: {
  rows: HeatRow[]
  cols: string[]
  max?: number
  format?: (v: MaybeNum) => string
  cellW?: number
  cellH?: number
  labelWidth?: number
  noteWidth?: number
  legend?: boolean
  signed?: boolean
  fit?: boolean
  className?: string
}) {
  /**
   * 悬浮格 —— 锚点跟随光标。
   *
   * ⚠️ 这里是**替换**原生 `title` 属性，不是并存：两者同时存在会出现
   *    浏览器原生黄框 + 自定义浮层两个提示叠在一起，且原生框延迟 1s 才出。
   *
   * Hook 放在空态提前返回之前（理由同 BarList：两条渲染路径的 Hook 数必须一致）。
   */
  const [hover, setHover] = useState<{ row: string; col: string; text: string; filled: boolean; positive: boolean; anchor: TipAnchor } | null>(
    null,
  )
  const wrapRef = useRef<HTMLDivElement>(null)

  if (!rows.length || !cols.length) {
    return <div className="text-sub text-[12px] py-3 text-center">无矩阵数据</div>
  }

  const flatMax = Math.max(
    0,
    ...rows.flatMap((r) => r.values.map((v) => (isNum(v) ? Math.abs(v) : 0))),
  )
  const norm = max && max > 0 ? max : flatMax
  const safe = norm > 0 ? norm : 1
  const hasNotes = rows.some((r) => r.note)
  const cellClass = fit ? 'flex-1 min-w-0' : 'shrink-0'

  return (
    <div ref={wrapRef} className={cn('relative flex flex-col gap-1.5', className)}>
      <div className={fit ? 'overflow-hidden' : 'overflow-x-auto'}>
        <div className="inline-block min-w-full">
          {/* ── 列头（日期） ── */}
          <div className="flex items-center">
            <span className="shrink-0" style={{ width: labelWidth }} />
            {cols.map((c, i) => (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- 同一日期轴可能出现重复列标签，索引即身份
                key={`${c}-${i}`}
                className={`${cellClass} text-center text-[10.5px] text-sub num`}
                style={fit ? undefined : { width: cellW }}
              >
                {c}
              </span>
            ))}
            {hasNotes && <span className="shrink-0 ml-2" style={{ width: noteWidth }} />}
          </div>

          {/* ── 数据行 ── */}
          {rows.map((r, ri) => (
            // oxlint-disable-next-line react/no-array-index-key -- 同名题材去重：原系统题材名可重复出现（同一题材多口径），索引是唯一稳定身份
            <div key={`${r.label}-${ri}`} className="flex items-center">
              <span
                className="shrink-0 truncate text-[12px] text-txt pr-2"
                style={{ width: labelWidth }}
                title={r.label}
              >
                {r.label}
                {r.sub && <span className="num text-sub text-[11px] ml-1">{r.sub}</span>}
              </span>

              {cols.map((c, ci) => {
                const v = r.values[ci]
                const filled = isNum(v)
                const intensity = filled ? Math.min(1, Math.abs(v) / safe) : 0
                const text = format(v)
                const positive = !signed || !filled || v >= 0
                const toneVar = positive ? 'var(--color-up)' : 'var(--color-down)'

                return (
                  <span
                    // oxlint-disable-next-line react/no-array-index-key -- 与列轴严格对齐
                    key={`${r.label}-${c}-${ci}`}
                    /**
                     * 每格的**可读命名**：色块矩阵对视障用户是一堵无字墙，
                     * 补 `aria-label` 后整张矩阵可被读屏逐格朗读。
                     *
                     * 它同时是测试侧唯一稳定的语义选择器 —— 原先靠原生 `title`
                     * 定位，改用浮层后 `title` 被移除（并存会出现双提示），
                     * 遂以 `aria-label` 承接：**动它就必须同步改测试**，属有意摩擦。
                     */
                    aria-label={
                      filled
                        ? `${r.label} · ${c}：${text || String(v)}`
                        : `${r.label} · ${c}：无样本`
                    }
                    className={`${cellClass} flex items-center justify-center num text-[10.5px]`}
                    style={{
                      width: fit ? undefined : cellW,
                      height: cellH,
                      // 强度着色：资金矩阵按正负红绿区分；其余强度矩阵保持单色。
                      background: filled
                        ? `color-mix(in srgb, ${toneVar} ${Math.max(8, intensity * 88)}%, var(--color-card))`
                        : undefined,
                      // null：斜纹灰格（「不知道」而非「零」）
                      backgroundImage: filled
                        ? undefined
                        : 'repeating-linear-gradient(45deg, var(--color-line-faint) 0 3px, transparent 3px 6px)',
                      border: '1px solid var(--color-line-faint)',
                      color: filled
                        ? intensity > 0.55
                          ? '#fff'
                          : 'var(--color-txt)'
                        : 'var(--color-sub)',
                    }}
                    onMouseMove={(e) => {
                      const wrap = wrapRef.current
                      if (!wrap) return
                      setHover({
                        row: r.label,
                        col: c,
                        text: filled ? text || String(v) : '',
                        filled,
                        positive,
                        anchor: pointerToPx(wrap, e),
                      })
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    {filled ? text : ''}
                  </span>
                )
              })}

              {hasNotes && (
                <span className="shrink-0 ml-2 text-sub text-[11px]" style={{ width: noteWidth }}>
                  {r.note}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {legend && (
        <div className="flex items-center gap-2 text-[10.5px] text-sub">
          {signed ? (
            <>
              <span>净流入</span>
              <span className="flex" style={{ height: 8 }}>
                {[30, 55, 88].map((p) => (
                  <span key={`up-${p}`} className="w-4" style={{ background: `color-mix(in srgb, var(--color-up) ${p}%, var(--color-card))`, border: '1px solid var(--color-line-faint)' }} />
                ))}
              </span>
              <span>净流出</span>
              <span className="flex" style={{ height: 8 }}>
                {[30, 55, 88].map((p) => (
                  <span key={`down-${p}`} className="w-4" style={{ background: `color-mix(in srgb, var(--color-down) ${p}%, var(--color-card))`, border: '1px solid var(--color-line-faint)' }} />
                ))}
              </span>
            </>
          ) : (
            <>
              <span>弱</span>
              <span className="flex" style={{ height: 8 }}>
                {[8, 30, 55, 88].map((p) => (
                  <span key={p} className="w-4" style={{ background: `color-mix(in srgb, var(--color-up) ${p}%, var(--color-card))`, border: '1px solid var(--color-line-faint)' }} />
                ))}
              </span>
              <span>强</span>
            </>
          )}
          <span className="inline-flex items-center gap-1 ml-2">
            <span
              className="inline-block w-4 h-2"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, var(--color-line-faint) 0 3px, transparent 3px 6px)',
                border: '1px solid var(--color-line-faint)',
              }}
            />
            无样本（≠ 0）
          </span>
        </div>
      )}

      {/* ── 悬浮读数：把「行/列/值」三要素一次说全（原生 title 已被替换）── */}
      {hover && (
        <ChartTooltip
          anchor={hover.anchor}
          payload={{
            title: `${hover.row} · ${hover.col}`,
            rows: [
              hover.filled
                ? { label: '数值', value: hover.text || '—', tone: hover.positive ? 'up' as const : 'down' as const }
                : { label: '数值', value: '无样本', tone: 'sub' as const },
            ],
          }}
        />
      )}
    </div>
  )
}
