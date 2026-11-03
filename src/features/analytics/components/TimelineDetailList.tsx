import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib'
import { useViewportFill } from '@/shared/ui'
import { BlockDetail } from './BlockDetail'
import { timelineAnchorId, type TimelineBlock } from '../lib/timeline'
import type { StockThemeTag, ThemeBurst } from '../lib/theme-burst'

/**
 * 左栏「**节点详情**」列表（2026-09-22 用户定）。
 *
 * ## 它是什么（与右侧蛇形轴的分工）
 *
 * · 右侧 = **完整蛇形时间线**（轴 + hover 明细）；
 * · 左侧 = **每个节点的完整详情**，逐条纵向铺开（⛔ 不是「时间轴导航」，也不是卡片墙）——
 *   用户原话「左侧就是显示每一个节点 hover 的详情，要具体详情打满」。
 * · 详情内容与右侧 hover 浮层**同源**（都走 `BlockDetail`，全量不截断）——
 *   ⛔ 两处各写一份必然漂移。
 *
 * ## ⛔ 虚拟列表（用户明确要求「记得做好虚拟列表渲染」）
 *
 * 一天可达上百个分块、每个分块详情又是几十行 → 全量渲染会卡死首屏。
 * 故只渲染**窗口内 + overscan** 的条目，其余用「撑高的占位 + 绝对定位」表达。
 *
 * ## 为什么**自研**而不是引第三方虚拟列表库
 *
 * 实测 `@tanstack/react-virtual` 在本项目的 jsdom 环境下**首帧拿不到窗口**（量不到视口矩形
 * → `getVirtualItems()` 返回空 → 一条都不渲染），且其 API 触发 `react-hooks/incompatible-library`
 * （React Compiler 无法记忆化）。本实现改用**确定性回退**：
 *   视口高未测到（jsdom / 首帧）→ `FALLBACK_VIEWPORT_H`；单项高未测到 → `ESTIMATE_H`。
 * ⇒ 窗口**在任何环境都可预测**（这也是它能被单测锁住的前提）。
 *
 * ## 排序
 *
 * **`at` 降序**（最新时刻在最上）—— ⛔ 与右侧轴的**时间升序**相反是刻意的：
 * 盯盘先看「刚刚发生了什么」，历史往下翻。
 */

/**
 * 单项高度估算（真实高度由条目挂载时实测回填）。
 *
 * ⚠️ 2026-09-22 由 300 → 420：详情改走**题材主轴**后每条会多出
 * 「该题材当日全部涨停成员」一行，实测条目普遍变高；估算偏小会让
 * 首帧的占位总高偏矮、滚动条跳变。
 */
const ESTIMATE_H = 420
/** 窗口外多渲染几条（滚动时不留白） */
const OVERSCAN = 4
/** 视口高回退值（jsdom / 首帧尚未量到时的兜底） */
const FALLBACK_VIEWPORT_H = 720

export function TimelineDetailList({
  blocks,
  topBoard,
  tags,
  reasonByCode,
  themeInfo,
  activeKey,
  onPick,
  className,
}: {
  blocks: TimelineBlock[]
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  themeInfo?: Map<string, ThemeBurst>
  activeKey?: string
  onPick: (key: string) => void
  className?: string
}) {
  /** 倒序（`at` 降序）—— 见文件头注 */
  const ordered = [...blocks].sort((a, b) => b.at - a.at)
  /**
   * 面板高度 = 视口剩余空间（2026-10-18 用户：「现在的滚动把高度顶开了」）。
   *
   * ⛔ 之前视口容器只写了 `min-w-0`（没有高度上限）→ 内容有多高它就长多高，
   *    整页被顶出屏幕，滚动条落在**页面**而不是这块面板上。
   *    现在高度由 `useViewportFill` 实测 top 算出来（同 `SignalRail`），
   *    面板内部滚动，页面不再被撑高。
   */
  const [sectionRef, sectionH] = useViewportFill<HTMLElement>(10)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(FALLBACK_VIEWPORT_H)
  /** 条目实测高（index → px）。只存**测到的**；未测到的走 `ESTIMATE_H` */
  const [heights, setHeights] = useState<Record<number, number>>({})

  /**
   * 视口高回填：由 `ResizeObserver` / window `resize` 驱动。
   * ⛔ **不在 effect 体内同步 `setState`**（React Compiler 的 `set-state-in-effect` 会拦）——
   *    这里只在**异步回调**里更新；量不到时保持回退值（jsdom 即此路径）。
   */
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const sync = () => {
      const h = el.clientHeight
      setViewportH((prev) => (h > 0 && h !== prev ? h : prev))
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    ro?.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  /**
   * 条目挂载即实测高度并回写。`setState` 走**函数式更新且值未变时返回原引用** →
   * 不会自激重渲染（收敛）。jsdom 量到 0 → 直接跳过，保持估算。
   */
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const idx = Number(el.dataset.index)
    const h = el.getBoundingClientRect().height
    if (h <= 0) return
    setHeights((prev) => (prev[idx] === h ? prev : { ...prev, [idx]: h }))
  }, [])

  // 前缀和：每条目的绝对纵向偏移（条目量级 ≤ 数百，每渲染重算的成本可忽略）
  const offsets: number[] = [0]
  for (let i = 0; i < ordered.length; i++) {
    offsets.push(offsets[i] + (heights[i] ?? ESTIMATE_H))
  }
  const total = offsets[ordered.length]

  // 窗口：从 scrollTop 起、覆盖到 scrollTop + viewportH，再各外扩 OVERSCAN 条
  let first = 0
  while (first < ordered.length && offsets[first + 1] <= scrollTop) first++
  let last = first
  while (last < ordered.length && offsets[last] < scrollTop + viewportH) last++
  const winStart = Math.max(0, first - OVERSCAN)
  const winEnd = Math.min(ordered.length, last + 1 + OVERSCAN)
  const rows: Array<{ i: number; top: number; block: TimelineBlock }> = []
  for (let i = winStart; i < winEnd; i++) rows.push({ i, top: offsets[i], block: ordered[i] })

  return (
    <section
      ref={sectionRef}
      style={sectionH ? { height: sectionH } : undefined}
      className={cn(
        'timeline-detail-list flex flex-col gap-1.5 min-w-0 min-h-0',
        sectionH ? 'overflow-hidden' : 'max-h-[var(--panel-max-h)]',
        className,
      )}
    >
      {/* 栏头：色条 + 标题 + 延伸线 + 节点数 */}
      <div className="flex items-center gap-2 px-0.5 pt-0.5">
        <span className="w-[3px] h-3.5 rounded-[2px] bg-rec flex-none" aria-hidden />
        <span className="text-11 font-semibold tracking-[0.12em] text-sub uppercase whitespace-nowrap">
          节点详情
        </span>
        <span className="flex-1 h-px bg-line min-w-2" aria-hidden />
        <span className="num text-11 text-sub flex-none">{ordered.length}</span>
      </div>

      {/* 虚拟滚动视口：只渲染窗口内的条目 */}
      <div
        ref={viewportRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain"
      >
        {ordered.length === 0 ? (
          <div className="text-sub text-11 px-1.5 py-2">当日无可定位到分钟的记录</div>
        ) : (
          <div className="relative w-full" style={{ height: total }}>
            {rows.map(({ i, top, block }) => {
              const active = block.key === activeKey
              return (
                <div
                  key={block.key}
                  id={timelineAnchorId(block.key)}
                  data-index={i}
                  ref={measure}
                  className="absolute left-0 top-0 w-full pb-2"
                  style={{ transform: `translateY(${top}px)` }}
                >
                  <div
                    className={cn(
                      'rounded-[var(--radius-sm)] border bg-card min-w-0 overflow-hidden',
                      active ? 'border-rec' : 'border-line',
                    )}
                  >
                    <BlockDetail
                      block={block}
                      topBoard={topBoard}
                      tags={tags}
                      reasonByCode={reasonByCode}
                      themeInfo={themeInfo}
                      onSelect={() => onPick(block.key)}
                      active={active}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
