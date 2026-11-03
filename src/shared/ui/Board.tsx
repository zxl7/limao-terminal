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

/**
 * ZoneRow —— **任务导向分区容器**（PC 桌面布局的主工作区骨架）。
 *
 * ## 与 `Board` 的分工（两者解决不同的问题，不可互相替代）
 *
 * `Board` 是**等权网格**：所有卡片同一优先级，适合「并列卡片很多、没有明显主次」
 * 的页面。`ZoneRow` 是**主次分区**：每一栏有语义（主工作区 / 辅助区 / 风险区），
 * 宽度按重要性分配，适合需要引导视线的页面 —— 盘中实时页用的就是这一层。
 *
 * ## 两个不可省的细节
 *
 * 1. **`xl:items-start`**：默认 `stretch` 会把最短的一栏拉到与最高栏等高，
 *    栏内于是出现一整块空白 —— 空洞只是从「页级」被搬到了「栏级」。
 * 2. **各栏内部独立纵向堆叠**：栏与栏之间不共享网格行高，最长的一栏不会把
 *    旁边的栏拖出空白。这正是「任务导向分区」相对「等权网格」的核心收益。
 *
 * `<xl` 退化为纵向单栏（窄屏不强塞多栏），`xl`(≥1280px) 起横向分栏。
 *
 * ⛔⛔ **「窄屏单栏」必须写成 `max-xl:flex-col`，⛔ 绝不能写裸 `flex-col`**（2026-09-21 实测事故）：
 * Tailwind v4 产物里 `.flex-col{flex-direction:column}`（无媒体查询）**排在**
 * `.xl\:flex-row{...}`（`@media (width>=80rem)`）**之后**，同层同权 ⇒ **裸 `flex-col` 在所有宽度都赢**
 * → 两栏永远上下堆叠，用户看到的是「说好的左右结构呢」。
 * `max-xl:flex-col`（`@media (width<80rem)`）与 `xl:flex-row`（`width>=80rem`）**媒体查询互斥**，
 * 不存在同属性竞争 —— 这是本项目里表达「窄屏竖排 / 宽屏横排」的**唯一安全写法**。
 */
export function ZoneRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3 max-xl:flex-col xl:flex-row xl:items-start xl:gap-3', className)}>
      {children}
    </div>
  )
}

/**
 * Zone —— 分区中的一栏。
 *
 * 顶部的语义标签（色点 + 小字）只表达「这一栏是干什么的」，**不与卡片标题重复**；
 * 栏内纵向堆叠，`min-w-0` 防长内容溢出。宽度由 `className` 给（如 `xl:w-[50%]`），
 * 页面侧不写断点字面量以外的魔法数字。
 */
export function Zone({
  label,
  dot = 'bg-mid',
  className,
  children,
}: {
  label: string
  dot?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('flex flex-col gap-2.5 min-w-0', className)}>
      {/* 分区头 = 短色条 + 标签 + 延伸细线。
          色条宽度 3px 而非 1px 圆点：在 4K 下圆点几乎看不见，「这一栏是什么」
          就退化成一行灰色小字。延伸线把标签变成「区域标题」，一眼可辨栏界。 */}
      <div className="flex items-center gap-2 px-0.5 pt-0.5">
        <span className={cn('w-[3px] h-3.5 rounded-[2px] flex-none', dot)} aria-hidden />
        <span className="text-11 font-semibold tracking-[0.12em] text-sub uppercase whitespace-nowrap">
          {label}
        </span>
        <span className="flex-1 h-px bg-line min-w-2" aria-hidden />
      </div>
      {children}
    </section>
  )
}
