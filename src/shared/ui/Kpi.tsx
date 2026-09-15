import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'
import { toneClass, type ToneToken } from './tone'

/**
 * KpiStrip / Kpi —— 首屏「指挥条」的数值块。
 *
 * ## 为什么不是普通表格
 *
 * 盘中扫视时眼睛先抓**数字**再读文字。原来的情绪条把 8 个指标塞成一串
 * 13px 小字（`涨停 <b>32</b> 跌停 <b>33</b> …`），在 4K 上等于一行蚂蚁：
 * 数字与标签同号，视线必须逐个解析。
 *
 * KPI 块把**数字放大到标签的 2 倍以上**（标签 10.5px / 数值 21–30px），
 * 眼睛先看到「32」和「33」，需要确认含义时才读上面那行小字 —— 与
 * Bloomberg 终端的层次策略一致。
 *
 * ## 宽度自适应（PC 优先）
 *
 * 用 `auto-fit + minmax` 而非固定列数：4K 下自动排到 6–8 列，
 * 1366 笔记本上自动折到 3 列，**同一个组件不需要任何断点类**。
 * 这是本项目唯一接受 `style={{gridTemplateColumns}}` 的场景 ——
 * 因为列数由内容最小宽度决定，无法用 Tailwind 的离散断点表达。
 */
export function KpiStrip({
  children,
  /** 单块最小宽度（px）—— 决定换行时机，不是固定列宽 */
  min = 120,
  className,
}: {
  children: ReactNode
  min?: number
  className?: string
}) {
  return (
    <div
      className={cn('grid gap-x-5 gap-y-2.5', className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}
    >
      {children}
    </div>
  )
}

const VALUE_SIZE = {
  lg: 'text-[30px]',
  md: 'text-[21px]',
  sm: 'text-[15px]',
} as const

/**
 * 单个 KPI 块。
 *
 * ⚠️ `value` 用 `ReactNode` 而非 `string`：格式化职责在调用方
 * （`fmtPct` / `fmtYi` / 自定义组合），本组件只负责排版。
 * 若在此处做格式化，调一次就要动公共组件。
 *
 * ⚠️ 缺数据一律传 `'—'`（em dash），**不要传 0** —— 0 是「真的没有」，
 * `—` 是「没有样本」。这个区分在本项目里是硬约定（见 CLAUDE.md 的不变量）。
 */
export function Kpi({
  label,
  value,
  /** 数值后缀单位（"只" / "%" / "亿"），小字跟在数值右侧 */
  unit,
  /** 数值下方的一行补充（对比值、阈值、状态词） */
  sub,
  tone = 'txt',
  size = 'md',
  className,
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  tone?: ToneToken
  size?: keyof typeof VALUE_SIZE
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[10.5px] text-sub leading-tight truncate">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={cn('num font-semibold leading-none', VALUE_SIZE[size], toneClass(tone))}>
          {value}
        </span>
        {unit !== undefined && <span className="text-[11px] text-sub">{unit}</span>}
      </div>
      {sub !== undefined && (
        <div className="text-[11px] text-sub mt-0.5 truncate">{sub}</div>
      )}
    </div>
  )
}
