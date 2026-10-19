import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'
import { useMeasuredHeight, useVirtualRows } from '@/shared/ui'

/**
 * 通用数据表 —— 分析域全部「榜单 / 明细」类视图的唯一样式来源。
 *
 * ## 为什么不用 skyroc 的 Table
 *
 * skyroc 的 Table 面向「带排序/分页/选择的管理后台」，需要传入列定义、数据源、
 * 状态管理器。但本域这些表是**只读快照**（原系统写盘 → 我们展示），
 * 既不分页（数据量 10~110 行）也不排序（顺序本身就是原系统的排序结果，
 * 比如 core_score 降序、涨停池按板数降序）—— 顺序即结论，重排会破坏语义。
 *
 * 所以这里要的是一张**朴素表格**：行数少、列固定、顺序即语义。
 * 引入带交互的表格反而会让「顺序是原系统算好的」这件事变得可疑。
 */

export interface Column<T> {
  /** 列标题 */
  label: string
  /** 单元格内容 */
  cell: (row: T, index: number) => ReactNode
  /**
   * 数值列右对齐。
   *
   * ⚠️ 数值列一律右对齐不是审美选择：位数不同的数字左对齐时，个位/十位对不齐，
   *    纵向扫读时无法一眼比较大小。这是数据表的可读性硬要求。
   */
  num?: boolean
  /** 额外类名（固定宽度、隐藏等） */
  className?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  /** 行 key（缺失时退化为索引） */
  rowKey?: (row: T, index: number) => string
  /** 空态文案 */
  empty?: string
  /** 紧凑行距（明细类表格用） */
  dense?: boolean
  /** 整行高亮判定（如最高板、命中项） */
  rowClass?: (row: T, index: number) => string | undefined
  /**
   * 虚拟滚动（2026-10-18）。
   *
   * 只渲染视口内的行 + 上下占位，长表（200+ 行）不再把几千个 DOM 节点塞进页面。
   * ⛔ 前置条件：**行高必须固定**（列内容不得 `whitespace-normal` 换行），
   *    否则占位高度与真实行高不一致，会出现空白缝或跳行。
   */
  virtual?: boolean
  /** 虚拟滚动容器的高度上限（默认「视口 − 顶栏」，保证不超屏） */
  heightClass?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = '暂无数据',
  dense,
  rowClass,
  virtual = false,
  heightClass = 'max-h-[var(--panel-max-h)]',
}: DataTableProps<T>) {
  /**
   * 行高常量必须与真实渲染一致：实测 dense 行为 32px（py-1 + 12.5px 正文 + border）。
   * 虚拟化时会给每行**强制** `height: ROW_H`，保证占位高度与内容严格对齐。
   */
  const ROW_H = 32
  const [scrollRef, viewportH] = useMeasuredHeight<HTMLDivElement>()
  const win = useVirtualRows({
    count: rows.length,
    rowHeight: ROW_H,
    viewportHeight: viewportH,
  })

  if (!rows.length) {
    return <div className="text-center text-sub text-xs py-4">{empty}</div>
  }

  const bodyRows = virtual ? rows.slice(win.start, win.end) : rows

  return (
    <div
      ref={virtual ? scrollRef : undefined}
      onScroll={virtual ? win.onScroll : undefined}
      className={virtual ? cn('overflow-auto overscroll-contain', heightClass) : 'overflow-x-auto'}
    >
      <table className="w-full border-collapse text-[12.5px]">
        <thead className={virtual ? 'sticky top-0 z-10' : undefined}>
          <tr className="border-b border-line bg-line-faint">
            {columns.map((c) => (
              <th
                key={c.label}
                className={cn(
                  // 表头 ≠ 数据行：浅底 + medium 字重把它钉成视觉锚点。
                  // 密集宽表里没有这一层，观众会横着串行读错列。
                  'font-medium text-sub py-1.5 px-2 whitespace-nowrap',
                  c.num ? 'text-right' : 'text-left',
                  c.className,
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 上占位：模拟已滚过的高度，aria-hidden 且不参与行样式 */}
          {virtual && win.padTop > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length} style={{ height: win.padTop, padding: 0, border: 0 }} />
            </tr>
          )}
          {bodyRows.map((row, idx) => {
            const i = virtual ? win.start + idx : idx
            return (
            <tr
              key={rowKey?.(row, i) ?? i}
              style={virtual ? { height: ROW_H } : undefined}
              className={cn(
                // hover 高亮：多列宽表横向扫读时，行背景是最便宜的「防串行」手段
                'border-b border-line-faint transition-colors hover:bg-line-faint',
                rowClass?.(row, i),
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.label}
                  className={cn(
                    dense ? 'py-1' : 'py-1.5',
                    'px-2 whitespace-nowrap',
                    c.num && 'text-right num',
                    c.className,
                  )}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
            )
          })}
          {virtual && win.padBottom > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length} style={{ height: win.padBottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 指标对（标签 + 值）—— 用于卡片顶部的汇总行。
 * 值缺失时统一渲染「—」而非空白，让「没有数据」和「渲染失败」可区分。
 */
export function StatPair({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: ReactNode
  /** 语义色（涨红/跌绿/机会紫/预警青） */
  tone?: 'up' | 'down' | 'rec' | 'warn' | 'sub'
  title?: string
}) {
  const toneClass =
    tone === 'up'
      ? 'text-up'
      : tone === 'down'
        ? 'text-down'
        : tone === 'rec'
          ? 'text-rec'
          : tone === 'warn'
            ? 'text-warn'
            : 'text-sub'

  return (
    <span className="inline-flex items-baseline gap-1" title={title}>
      <span className="text-sub text-[12px]">{label}</span>
      <b className={cn('num text-[13px] font-semibold', toneClass)}>{value ?? '—'}</b>
    </span>
  )
}

/** 小标签（题材、板块、状态） */
export function Tag({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode
  tone?: 'neutral' | 'up' | 'down' | 'rec' | 'warn'
  title?: string
}) {
  const toneClass = {
    neutral: 'text-sub border-line',
    up: 'text-up border-up',
    down: 'text-down border-down',
    rec: 'text-rec border-rec',
    warn: 'text-warn border-warn',
  }[tone]
  return (
    <span className={cn('badge border', toneClass)} title={title}>
      {children}
    </span>
  )
}

/** 分段切换（同一数据源的多个视图，如「汇总 / 明细」） */
export function SegTabs({
  items,
  value,
  onChange,
}: {
  items: ReadonlyArray<{ key: string; label: string }>
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="inline-flex gap-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={cn(
            'px-2.5 py-1 text-[12px] rounded-sm border cursor-pointer bg-transparent transition-colors',
            it.key === value
              ? 'border-line-strong text-txt font-semibold'
              : 'border-line text-sub hover:text-txt',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
