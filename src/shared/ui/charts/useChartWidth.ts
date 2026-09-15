import { useEffect, useState } from 'react'

/**
 * 容器宽度自适应 —— 图表的**尺寸**与**坐标**解耦。
 *
 * ## 为什么必须有它（这是 PC 端的核心问题）
 *
 * 早期写法是 `className="w-full h-auto"`：SVG 按 `viewBox` 等比放大。
 * 后果在宽屏上极其明显 —— `720 × 200` 的图放到 1500px 宽的卡片里，
 * 高度被同比例拉到 **417px**，且 SVG 里的字号也跟着放大（10px → 21px）。
 * 一页三张图就是 1200px 的滚动，用户真正要看的表格被挤到屏幕外。
 * **「等比放大」在小屏看起来正常，在 PC 上就是灾难。**
 *
 * 正确做法：宽度跟随容器，**高度恒定**。于是需要知道容器的真实像素宽度，
 * 并把它作为 `viewBox` 的宽度 —— 这样 `viewBox` 与渲染尺寸 1:1，
 * SVG 内的文字既不会被拉伸也不会被放大。
 *
 * ## 为什么用 `useEffect` 而不是 `useLayoutEffect`
 *
 * 首帧用 `fallback` 宽度渲染，再在 effect 里校正。差一帧的代价是：
 * 极窄场景下图上元素会「跳一下」。换来的是**没有 SSR/水合不一致**，
 * 也不触发 React Compiler 对「layout effect 内 setState」的告警。
 * 对本项目（纯客户端渲染、数据本就异步到达）一帧抖动不可见。
 *
 * ## jsdom 下必须优雅退化
 *
 * `ResizeObserver` 与 `getBoundingClientRect` 在 jsdom 里都不工作
 * （宽度恒为 0）。此时保持 `fallback` —— 图仍然按设计尺寸渲染，
 * 测试断言的是**结构**（有没有 path / rect），不依赖真实像素。
 * 若不做这层退化，测试环境会拿到 0 宽度并算出 NaN 坐标。
 */
export function useChartWidth(fallback: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      // 0 宽度 = 未挂载 / 未布局（jsdom、display:none）→ 保持 fallback，不写 0
      if (w > 0) setWidth(w)
    }
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  return { width, el, setEl }
}
