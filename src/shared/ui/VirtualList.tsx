import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject, UIEvent } from 'react'
import { cn } from '@/shared/lib'

/**
 * 虚拟列表原语（2026-10-18）—— 长列表只渲染**视口内**的若干行，其余用上下占位撑开。
 *
 * ## 为什么必须自己写（不引第三方）
 *
 * 项目里最长的几处列表是**固定行高的紧凑表**（短线精灵、股性主表、题材堆叠、资金逐日），
 * 引入 `react-window` 这类库要多背 10KB+ 且要改所有表格结构。这里只需要「按 scrollTop
 * 算可见区间」这一件事，30 行内解决，还能直接单测纯计算部分。
 *
 * ## 三个必须遵守的前提（否则会出现「滚动跳动 / 空白行」）
 *
 * 1. **行高固定**：`rowHeight` 必须与真实渲染行高一致（见 `--row-h` / `--row-h-dense`）。
 *    行内容换行（`whitespace-normal`）的表格**不能**虚拟化。
 * 2. **容器高度确定**：外层必须有确定高度（`h-*` 或 `max-h-*`），由 `useMeasuredHeight` 读取。
 * 3. **占位不参与样式**：上下 spacer 用 `height` + `aria-hidden`，不要让它们触发行 hover/斑马纹。
 */

/** 滚动位置 → 可见区间（纯函数，便于单测） */
export function windowRange(
  scrollTop: number,
  count: number,
  rowHeight: number,
  viewportHeight: number,
  overscan = 6,
): { start: number; end: number; padTop: number; padBottom: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }
  const safeTop = Math.max(0, scrollTop)
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + overscan * 2
  /**
   * ⛔ start 必须夹在「最后一屏的起点」以内。
   * 旧实现只做 `Math.max(0, …)`：切换筛选/日期后 `scrollTop` 仍是旧值（例如 999 万），
   * start 会算到 312497 —— 远超 count，`slice(start, end)` 空数组 → 表格整块空白
   * （用户只会看到「数据没了」，其实是滚动位置越界）。
   */
  const start = Math.min(Math.max(0, Math.floor(safeTop / rowHeight) - overscan), Math.max(0, count - visible))
  const end = Math.min(count, start + visible)
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  }
}

/** 元素高度测量（含窗口尺寸变化）—— 不测量就无法算可见条数 */
export function useMeasuredHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setHeight(el.clientHeight)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, height]
}

/**
 * 把元素高度限制在「当前视口剩余空间」内 —— **永不超屏**的唯一可靠做法。
 *
 * ⛔ 为什么不能用 `100vh` / `calc(100vh - 84px)` 硬算：
 *    面板上方还有顶栏(46) + 提示条(0~40) + 退潮横幅(0~40) + 卡片间距，
 *    起始位置实测可以从 70 变到 172。写死公式要么溢出、要么留一大块空白。
 *    `100dvh` 只解决「视口是多少」，解决不了「这块面板从哪开始」。
 *
 * 实现：量 `getBoundingClientRect().top`，高度 = innerHeight − top − gap；
 * 同时监听 resize 与 body 尺寸变化（提示条/横幅出现会让 top 变化）。
 */
export function useViewportFill<T extends HTMLElement>(
  gap = 8,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const top = el.getBoundingClientRect().top
      // 240 下限：极端窄屏（横屏手机）也不至于被压成一条线
      setHeight(Math.max(240, Math.round(window.innerHeight - top - gap)))
    }
    read()
    window.addEventListener('resize', read)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    ro?.observe(document.body)
    return () => {
      window.removeEventListener('resize', read)
      ro?.disconnect()
    }
  }, [gap])

  return [ref, height]
}

/** 虚拟滚动状态：返回可见区间与绑定到滚动容器的 onScroll */
export function useVirtualRows(opts: {
  count: number
  rowHeight: number
  viewportHeight: number
  overscan?: number
}) {
  const { count, rowHeight, viewportHeight, overscan } = opts
  const [scrollTop, setScrollTop] = useState(0)

  /*
   * ⛔ 不再用 effect 把越界 scrollTop 归零：
   *    `windowRange` 已把 start 夹在「最后一屏起点」以内（见下方注释），
   *    在 effect 里 setState 只会多一轮渲染，且被 React Compiler 判为反模式。
   *    DOM 的 scrollTop 会由浏览器在内容变短时自动收敛，无需我们纠正。
   */

  const onScroll = useCallback((e: UIEvent<HTMLElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  return { ...windowRange(scrollTop, count, rowHeight, viewportHeight, overscan), onScroll }
}

/**
 * 虚拟列表容器。
 *
 * `heightClass` 默认 `h-[var(--panel-max-h)]`：任何纵向滚动区都不得超过「视口 − 顶栏」，
 * 保证整页永远不超屏（用户 2026-10-18 明确的硬要求）。
 */
export function VirtualList<T>({
  items,
  itemHeight,
  render,
  className,
  heightClass = 'h-[var(--panel-max-h)]',
  overscan = 6,
  empty,
}: {
  items: readonly T[]
  itemHeight: number
  render: (item: T, index: number) => ReactNode
  className?: string
  heightClass?: string
  overscan?: number
  empty?: ReactNode
}) {
  const [ref, height] = useMeasuredHeight<HTMLDivElement>()
  const { start, end, padTop, padBottom, onScroll } = useVirtualRows({
    count: items.length,
    rowHeight: itemHeight,
    viewportHeight: height,
    overscan,
  })

  if (items.length === 0) return <>{empty ?? null}</>

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn('overflow-y-auto overscroll-contain min-h-0', heightClass, className)}
    >
      {/* 上占位：把它当成「已滚过区域」的高度，不参与任何样式 */}
      {padTop > 0 && <div aria-hidden style={{ height: padTop }} />}
      {items.slice(start, end).map((item, i) => render(item, start + i))}
      {padBottom > 0 && <div aria-hidden style={{ height: padBottom }} />}
    </div>
  )
}
