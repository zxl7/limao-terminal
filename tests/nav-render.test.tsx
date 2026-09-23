/**
 * 导航渲染测试 —— 结构层面「顺序对了」≠ 界面上「看得出来」。
 *
 * `nav-order.test.ts` 锁的是 `TABS` 数组；但数组对了、map 渲染时仍可能出错：
 * 段名标签漏渲、实时段的呼吸点没挂上、`isGroupStart` 判定写反导致段界错位……
 * 这类缺陷在界面上表现为「导航看起来还是一长条」，与本次改动要解决的问题**一模一样**，
 * 所以必须有渲染层断言。
 *
 * ## 为什么单独建这个文件而不是塞进 all-pages-render
 *
 * 那个文件用真实落盘数据逐个渲染 **页面**；本文件渲染的是**外壳**（AppShell），
 * 关注点是导航结构而非业务数据。两者失败原因完全不同，混在一起会让报错定位变慢。
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '@/app/AppShell'

/** 段名标签的合法取值 —— 与 `TabGroup` 联合类型同步 */
const GROUP_LABELS = /^(实时|盘面|题材|决策|数据)$/

function renderShell() {
  // TopBar 是 AppShell 的一部分且订阅 market/latest，故需要 QueryClient；
  // 但本测试只关心导航，fetch 给最小桩即可（空对象足以让 TopBar 走空态分支）。
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  globalThis.fetch = (async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [{ index: true, element: <div>页面占位</div> }],
      },
    ],
    { initialEntries: ['/'] },
  )

  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('AppShell 导航渲染', () => {
  it('段名标签按「实时 → 盘面 → 题材 → 决策 → 数据」出现', () => {
    renderShell()
    // 必须限定在「主导航」（PC 侧栏）内：AppShell 同时渲染了窄屏回退的
    // 「顶部导航」，全屏 getAllByText 会把两套导航的段名一起匹配进来。
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const labels = Array.from(nav.querySelectorAll('span'))
      .filter((s) => GROUP_LABELS.test((s.textContent ?? '').trim()))
      .map((s) => (s.textContent ?? '').trim())
    expect(labels).toEqual(['实时', '盘面', '题材', '决策', '数据'])
  })

  it('「实时」段名排在导航最前 —— 即排序结果肉眼可见', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const labels = Array.from(nav.querySelectorAll('span')).filter((s) =>
      GROUP_LABELS.test((s.textContent ?? '').trim()),
    )
    expect((labels[0]?.textContent ?? '').trim()).toBe('实时')
  })

  it('「实时」段名用强调色 + 呼吸点，与后续历史段在视觉上可区分', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const groupSpans = Array.from(nav.querySelectorAll('span')).filter((s) =>
      GROUP_LABELS.test((s.textContent ?? '').trim()),
    )
    const live = groupSpans.find((el) => (el.textContent ?? '').trim() === '实时')!
    // 强调色：侧栏是深底，必须用深底专用红 `text-head-up`；
    // 浅底用的 `text-up` 在 #1c2130 上对比度不足，属双套色（见 theme.css）
    expect(live.className).toContain('text-head-up')

    // 呼吸点：仅实时段有，且必须是装饰性元素（aria-hidden，不干扰读屏）
    const dots = Array.from(nav.querySelectorAll('.animate-pulse'))
    expect(dots.length, '实时段缺少实时指示呼吸点').toBe(1)
    expect(dots[0].getAttribute('aria-hidden')).toBe('true')

    // 历史段不得带呼吸点与强调色
    for (const g of ['盘面', '题材', '决策', '数据']) {
      const el = groupSpans.find((x) => (x.textContent ?? '').trim() === g)!
      expect(el.className, `${g} 段不应使用实时强调色`).not.toContain('text-head-up')
    }
  })

  it('导航渲染出全部 27 个 Tab（含实时段 7 个）', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const links = nav.querySelectorAll('a')
    expect(links.length).toBe(27)
    // 实时段前缀连续 —— /timeline 必须落在最前 7 个之内，不得漂到历史段
    // （/record·/ops 已迁「数据」段 2026-09-22；/effect 新增实时段 2026-09-23）
    const realtimeTo = ['/', '/timeline', '/effect', '/rotation', '/mainline', '/reflow', '/flow']
    const actual = Array.from(links)
      .slice(0, realtimeTo.length)
      .map((a) => a.getAttribute('href'))
    expect(actual).toEqual(realtimeTo)
  })
})
