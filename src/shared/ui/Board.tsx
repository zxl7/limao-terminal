import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'

/**
 * Board —— **PC 优先的响应式卡片网格**，全站页面级布局的唯一原语。
 *
 * ## 为什么需要它（以及为什么以前不需要）
 *
 * 迁移初期所有页面都是 `flex flex-col gap-3` —— 单列铺满。这个选择在 1440px
 * 笔记本上没问题，但本系统的主力视口是 **4K PC（有效 CSS 宽度 1920–3840px）**：
 * 一张卡片横跨 3800px，而卡片内部的内容（表格数字、标的名单）天然只占左侧
 * 500–800px，**单卡横向空洞约 80%**。页面越高、列越少，空洞越明显 —— 这就是
 * 「整体布局非常空洞」的直接成因，不是留白审美问题，是布局引擎缺了一层。
 *
 * ## 列数阶梯（与 `styles/theme.css` 的断点一一对应）
 *
 * | 视口宽度 | 列数 | 单卡宽（1920 参考） | 典型设备 |
 * |---|---|---|---|
 * | < 1024px | 1 | — | 竖屏 / 窄窗 |
 * | ≥ 1024px (`lg`) | 2 | 512–640px | 笔记本 |
 * | ≥ 1280px (`xl`) | 3 | 427–512px | 1080p 全屏 |
 * | ≥ 1920px (`3xl`) | 4 | 384–512px | 2K / 4K 半屏 |
 * | ≥ 2560px (`4xl`) | 5 | 427–640px | 4K 全屏 |
 *
 * 列数刻意选在「单卡 380–640px」区间：窄于此，13px 正文的表格会挤成两行；
 * 宽于此，又回到「内容只占左半边」的老问题。
 *
 * ## ⚠️ `items-start` 不是可选装饰
 *
 * 默认的 `align-items: stretch` 会把同一行里的短卡片拉成与最高卡片等高，
 * 卡片内部于是出现一整块空白 —— 空洞从「页级」被搬到了「卡级」。必须 `start`。
 *
 * ## ⚠️ 改动本文件即改动全部 21 个页面
 *
 * 页面侧只声明「我在网格里占几列」，不写任何断点字面量。这样将来若要整体
 * 调整密度（例如 4K 改用 6 列），只改这一个文件。
 */
export function Board({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 items-start',
        'gap-2.5 lg:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * 占多列的卡片 —— 给内容天然更宽的那些卡（榜单表、双列对照、图表）。
 *
 * `span` 语义 = **在 ≥1024px 时希望占的列数**（更窄的视口自动退化为单列，
 * 由断点阶梯决定），而非「永远占 N 列」。
 *
 *   span=2 → lg 起占 2 列（4K 5 列下占 2/5，约 1500px）
 *   span=3 → lg 占 2 列、≥1536px 起占 3 列
 *
 * 之所以不给 span=2 也加 `xl:col-span-2`：三列布局里再占两列会让列宽失衡，
 * 网格看起来像「一大两小」而不是等距网格。
 */
export function BoardItem({
  span = 1,
  children,
  className,
}: {
  span?: 1 | 2 | 3
  children: ReactNode
  className?: string
}) {
  const spanClass =
    span === 1 ? '' : span === 2 ? 'lg:col-span-2' : 'lg:col-span-2 2xl:col-span-3'
  return <div className={cn(spanClass, 'min-w-0', className)}>{children}</div>
}

/**
 * 通栏块 —— 横跨整行的带条（首屏指挥条、预警横幅）。
 *
 * 用 `col-span-full` 而非固定列数：通栏在任何列数下都是「整行」，
 * 这样新增断点时无须回归。
 */
export function BoardWide({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('col-span-full min-w-0', className)}>{children}</div>
}
