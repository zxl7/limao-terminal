import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { windowRange } from '@/shared/ui/VirtualList'
import { DataTable } from '@/features/analytics'
import type { Column } from '@/features/analytics'

/**
 * 虚拟列表守卫（2026-10-18 用户硬要求：长列表一律虚拟化 + 高度不得超屏）。
 *
 * 两件事一旦回退就是**静默**的：
 *   · 窗口算错 → 滚动到底部出现空白，或首屏只渲染 3 行；
 *   · 行高常量与真实行高不一致 → 占位高度偏移，滚动时行会「跳」。
 * 所以纯计算部分与渲染条数都要锁。
 */

describe('windowRange · 可见区间计算', () => {
  it('顶部：从 0 开始，按视口高度算可见条数（含 overscan）', () => {
    const r = windowRange(0, 1000, 32, 320, 2)
    expect(r.start).toBe(0)
    // 320/32 = 10 条 + 上下各 2 条 overscan
    expect(r.end).toBe(14)
    expect(r.padTop).toBe(0)
    expect(r.padBottom).toBe((1000 - 14) * 32)
  })

  it('中部：占位高度 = 已滚过行数 × 行高', () => {
    const r = windowRange(3200, 1000, 32, 320, 2)
    expect(r.start).toBe(98) // 3200/32 - 2
    expect(r.padTop).toBe(98 * 32)
    expect(r.end).toBe(112)
  })

  it('底部：end 不越界，padBottom 归零', () => {
    const r = windowRange(9_999_999, 50, 32, 320, 2)
    expect(r.end).toBe(50)
    expect(r.padBottom).toBe(0)
    // 50 行、可见 14 行 ⇒ 最后一屏起点 = 36（越界滚动被夹住，不会渲染空白）
    expect(r.start).toBe(36)
  })

  it('空列表 / 非法行高不抛异常', () => {
    expect(windowRange(0, 0, 32, 320)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
    expect(windowRange(0, 10, 0, 320)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })
})

describe('DataTable · 虚拟化只渲染视口内的行', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ code: String(i), pct: i }))
  const columns: Column<(typeof rows)[number]>[] = [
    { label: '代码', cell: (r) => r.code },
    { label: '涨幅', num: true, cell: (r) => r.pct },
  ]

  it('开启 virtual 后 tbody 行数远少于总行数，且保留占位', () => {
    const { container } = render(<DataTable rows={rows} columns={columns} virtual />)
    const trs = container.querySelectorAll('tbody tr')
    expect(trs.length).toBeGreaterThan(0)
    expect(trs.length).toBeLessThan(60)
    // 底部占位存在（未滚动时 start=0，只有下占位）
    const spacers = container.querySelectorAll('tbody tr[aria-hidden]')
    expect(spacers.length).toBeGreaterThanOrEqual(1)
  })

  it('未开启 virtual 时全量渲染（行为不变）', () => {
    const { container } = render(<DataTable rows={rows} columns={columns} />)
    expect(container.querySelectorAll('tbody tr').length).toBe(500)
  })
})
