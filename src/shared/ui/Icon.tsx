import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'

/**
 * 图标集 —— **零依赖内联 SVG**，不引入图标库。
 *
 * ## 为什么不用 lucide-react / @iconify
 *
 * `@skyroc/web-ui` 的传递依赖里确实有这两个包，但：
 *   ① 它们是**未声明的传递依赖** —— 直接 import 会在某次依赖树变动后静默失效；
 *   ② 本页需要的图标是**固定且封闭**的一组（导航 21 项 + 少量状态标记），
 *      全量图标库对本项目是纯粹的体积负担；
 *   ③ 图标是视觉语言的一部分，自持一份才能保证笔画粗细、端点风格完全统一。
 *
 * ## 统一规格（改一处全局生效）
 *
 *   · 24×24 网格，`stroke-width` 默认 1.8（比 lucide 默认的 2 更细，匹配本
 *     项目 13px 正文的视觉重量；粗笔画在密集表格里会显脏）
 *   · 圆角端点 / 圆角连接，与表格圆角 6px 的语汇一致
 *   · 一律 `currentColor` —— 颜色由父级 `text-*` 决定，图标自身不持有语义色
 *
 * ## 分层说明
 *
 * 图标**不含业务语义**：`Icon name="up"` 只表示「上行箭头」这个形状，
 * 「涨=红」的语义由调用方通过 `className="text-up"` 赋予。
 * 这样同一个形状能安全地复用到「净值上涨」与「数量增长」等不同语境。
 */

export type IconName =
  // 导航
  | 'pulse'
  | 'thermometer'
  | 'trophy'
  | 'stairs'
  | 'dna'
  | 'rotate'
  | 'target'
  | 'reflow'
  | 'flame'
  | 'flow'
  | 'bank'
  | 'compass'
  | 'shield'
  | 'robot'
  | 'trendUp'
  | 'flask'
  | 'building'
  | 'database'
  | 'layers'
  | 'archive'
  | 'terminal'
  // 状态与功能
  | 'alert'
  | 'info'
  | 'check'
  | 'cross'
  | 'clock'
  | 'calendar'
  | 'search'
  | 'refresh'
  | 'zap'
  | 'eye'
  | 'filter'
  | 'down'
  | 'right'
  | 'upRight'
  | 'downRight'
  | 'external'
  | 'scale'
  | 'dot'

const ICONS: Record<IconName, ReactNode> = {
  // ── 导航 ──
  pulse: <path d="M2 12h4l3 8 4-16 3 8h6" />,
  thermometer: (
    <>
      <path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4.5 4.5 0 1 0 4 0z" />
      <path d="M12 18v-4" />
    </>
  ),
  trophy: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M6 3h12v7a6 6 0 0 1-12 0z" />
      <path d="M10 16.5V19a2 2 0 0 0-2 2M14 16.5V19a2 2 0 0 1 2 2" />
      <path d="M8 21h8" />
    </>
  ),
  stairs: <path d="M2 21h4v-5h4v-5h4V6h6" />,
  dna: (
    <>
      <path d="M5 3c7 4 7 14 14 18" />
      <path d="M19 3c-7 4-7 14-14 18" />
      <path d="M7.5 8h9M7.5 16h9" />
    </>
  ),
  rotate: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  reflow: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h9a7 7 0 0 1 0 14H8" />
    </>
  ),
  flame: (
    <path d="M12 22c3.9 0 7-2.9 7-6.6 0-4.4-4.4-6.6-5.6-11.4C12.6 6.5 11 8.4 11 10.6c0-1.3-1-2.5-1.6-3.4C8.5 9.6 5 12 5 15.4 5 19.1 8.1 22 12 22z" />
  ),
  flow: (
    <>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="M16 21l4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  bank: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V10l7-5 7 5v11" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M16 8l-2 6-6 2 2-6z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  robot: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M12 4v4" />
      <path d="M9 13h.01M15 13h.01" />
      <path d="M9 16.5h6" />
    </>
  ),
  trendUp: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11" />
      <path d="M8 7h3M8 11h3M8 15h3" />
      <path d="M3 21h18" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  layers: (
    <>
      <path d="M12 2 2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </>
  ),
  archive: (
    <>
      <path d="M21 8v13H3V8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <path d="M10 12h4" />
    </>
  ),
  terminal: (
    <>
      <path d="M4 17l6-6-6-6" />
      <path d="M12 19h8" />
    </>
  ),

  // ── 状态与功能 ──
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  cross: <path d="M18 6 6 18M6 6l12 12" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  zap: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />,
  down: <path d="M6 9l6 6 6-6" />,
  right: <path d="M9 6l6 6-6 6" />,
  upRight: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  downRight: (
    <>
      <path d="M7 7l10 10" />
      <path d="M17 8v9H8" />
    </>
  ),
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M5 7 2 14h6L5 7z" />
      <path d="M19 7l-3 7h6l-3-7z" />
    </>
  ),
  /** 实心圆点 —— 状态指示灯（需 `fill`，故单独走 fill 分支） */
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
}

export function Icon({
  name,
  size = 15,
  className,
  strokeWidth = 1.8,
  /** 提供后图标进入可访问性树（默认装饰性，对屏幕阅读器隐藏，避免刷屏） */
  title,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
  title?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {ICONS[name]}
    </svg>
  )
}
