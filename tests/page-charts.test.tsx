/**
 * 页面级图表验收测试 —— 用**真实落盘数据**确认「图画出来了」而不是「降级成空态」。
 *
 * ## 为什么不能只靠 `chart-render.test.tsx`
 *
 * 那个文件喂的是手写的理想数据（4 个点、干净的正负数）。而页面层会引入
 * 一整类新问题：**数据到了、组件也对了，但中间那根管子接错了**。
 * 实证过的坑：`trajectory.zt_seq` 在真实数据里**全是 null**，
 * 组件层测试全绿、页面渲染也不报错，但图表是一条空线 —— 因为
 * 「全 null」在组件里的正确行为就是空态。**空态不是 bug，是数据接错了。**
 *
 * 所以本文件锁的是「页面 → 数据源」这条链路：
 *   · 卡片标题存在（说明走的是实体分支，不是 EmptyState）
 *   · 有带 `M`/`L` 的 `<path>`（说明折线真的落了 DOM）
 *   · 有非透明 `<rect>`（说明柱状真的落了 DOM）
 *   · 热力格数量 = 行 × 列，且「无样本」格**必须留空文字**（不得伪造 0）
 *
 * 数据来源与 `all-pages-render.test.tsx` 完全一致（同一份 `read-route.mjs`），
 * 保证「测试看到的」与「浏览器看到的」是同一份真实数据。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import path from 'node:path'
import { ROUTES, FILE_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, healthPayload, resolveDataRoot } from '../scripts/lib/read-route.mjs'

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

/**
 * 当前 `market/latest` 的题材行数。
 *
 * ⚠️ 后端在**盘前约 09:06** 会把这份快照重置（`top5` / `leaders` / `early` / `ladder` 全空，
 * 实测 2026-09-21 09:06:58，`ts` = 当日 09:06:42）→ 此时一切「依赖 latest 的图表」都应走空态。
 * 数据依赖型断言必须按这个事实分支，否则每个交易日盘前都会误报失败。
 */
function top5Count(): number {
  try {
    const d = readRoute(DATA_ROOT, ROUTES['/api/market/latest']) as { top5?: unknown[] } | null
    return d?.top5?.length ?? 0
  } catch {
    return 0
  }
}

function installDataFetch() {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url).split('?')[0]
    if (url === '/api/health') {
      return new Response(JSON.stringify(healthPayload(DATA_ROOT, FILE_ROUTES)), { status: 200 })
    }
    const def = (ROUTES as Record<string, unknown>)[url]
    if (!def) return new Response('{}', { status: 404 })
    try {
      return new Response(JSON.stringify(readRoute(DATA_ROOT, def)), { status: 200 })
    } catch {
      return new Response('{"error":"data_unavailable"}', { status: 404 })
    }
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

let restore: () => void
beforeAll(() => {
  restore = installDataFetch()
})
afterAll(() => {
  restore?.()
})

/** 渲染一个页面并等所有查询落定，返回容器与查询客户端 */
async function renderPage(mod: { Component?: ComponentType }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
  })
  const Page = mod.Component!
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { container } = render(<Page />, { wrapper: wrap })
  await waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
  return container
}

/** 所有非空 path 的 d 值 */
function pathDs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('path')]
    .map((p) => p.getAttribute('d') ?? '')
    .filter((d) => d.length > 0)
}

/** 只取「数据柱」矩形 —— 排除悬浮热区（fill=transparent） */
function dataRects(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('rect')].filter(
    (r) => (r.getAttribute('fill') ?? '') !== 'transparent',
  )
}

describe('EmotionPage —— 情绪轨迹/接力质量/涨停家数', () => {
  it('三张图卡片都走实体分支，且折线与柱真的落了 DOM', async () => {
    const container = await renderPage(await import('@/pages/emotion/EmotionPage'))

    // 卡片标题存在 = 未被降级为空态（空态时 Card 仍渲染标题，但正文是提示语，
    // 所以下面还要用「有没有 path/rect」做二次确认）
    expect(screen.getByText(/周期温度总览/)).toBeInTheDocument()
    expect(screen.getByText(/数据维度冷热/)).toBeInTheDocument()
    expect(screen.getByText(/当前周期状态/)).toBeInTheDocument()
    expect(screen.getAllByText(/盘中/).length).toBeGreaterThan(0)
    expect(screen.getByText(/资金温度 · 主力净额/)).toBeInTheDocument()
    expect(screen.getByText(/周期冷热/)).toBeInTheDocument()
    expect(screen.getByText(/情绪轨迹/)).toBeInTheDocument()
    expect(screen.getByText(/收盘涨停家数/)).toBeInTheDocument()

    const ds = pathDs(container)
    const line = ds.find((d) => d.includes('M') && d.includes('L'))
    // 情绪分管线必须存在，且坐标不得是 NaN（NaN 会让整条线从画布上消失）
    expect(line, '情绪轨迹折线未生成 path').toBeTruthy()
    expect(line).not.toContain('NaN')

    // 柱状：收盘涨停家数（真实数据下有 21 天归档）
    expect(dataRects(container).length, '涨停家数柱未生成 rect').toBeGreaterThan(0)
  })
})

describe('TradePage —— 全部交易走势 / 逐日收益', () => {
  it('按全部结算交易画一条净值折线，不单列回撤，逐日收益柱仍保留', async () => {
    const container = await renderPage(await import('@/pages/trade/TradePage'))

    expect(screen.getByText(/全部交易走势/)).toBeInTheDocument()
    expect(screen.queryByText(/净值与回撤/)).not.toBeInTheDocument()
    expect(screen.queryByText(/最大回撤/)).not.toBeInTheDocument()
    expect(screen.queryByText(/回撤曲线/)).not.toBeInTheDocument()
    expect(screen.getByText(/逐日收益分布/)).toBeInTheDocument()

    const ds = pathDs(container)
    const lines = ds.filter((d) => d.includes('M') && d.includes('L'))
    expect(lines.length, '全部交易净值折线未生成 path').toBeGreaterThanOrEqual(1)
    for (const d of lines) expect(d).not.toContain('NaN')

    // 逐日收益柱：空仓日以中性色呈现，但仍应是实心柱而非透明热区
    expect(dataRects(container).length, '逐日收益柱未生成 rect').toBeGreaterThan(0)
  })

  it('不含尾盘潜伏页签 —— 该板块已独立为 AI尾盘潜伏页', async () => {
    await renderPage(await import('@/pages/trade/TradePage'))
    const tabs = screen.queryAllByRole('button').map((button) => button.textContent ?? '')
    expect(tabs.some((text) => /尾盘潜伏/.test(text)), '交易战绩页不应再内嵌尾盘潜伏页签').toBe(false)
    expect(screen.queryByText(/尾盘潜伏战绩/)).not.toBeInTheDocument()
  })
})

describe('AmbushPage —— AI尾盘潜伏研究结算', () => {
  it('独立展示研究结算流水、收益曲线与逐笔收益，缺账本时保持空态', async () => {
    const container = await renderPage(await import('@/pages/ambush/AmbushPage'))

    expect(screen.getByText(/^🎯 AI尾盘潜伏战绩$/)).toBeInTheDocument()
    expect(screen.getByText(/研究结算流水/)).toBeInTheDocument()
    // 收益曲线（净值折线）+ 逐笔收益（柱）已落 DOM
    expect(screen.getByText(/收益曲线/)).toBeInTheDocument()
    expect(screen.getByText(/逐笔收益/)).toBeInTheDocument()

    const ds = pathDs(container)
    const line = ds.find((d) => d.includes('M') && d.includes('L'))
    expect(line, '收益曲线折线未生成 path').toBeTruthy()
    expect(line).not.toContain('NaN')
    expect(dataRects(container).length, '逐笔收益柱未生成 rect').toBeGreaterThan(0)
  })
})

describe('FlowPage —— 跨日资金矩阵', () => {
  it('矩阵格数 = 行 × 列，且「无样本」格必须留空（不得伪造 0）', async () => {
    const container = await renderPage(await import('@/pages/flow/FlowPage'))

    expect(screen.getByText(/跨日资金矩阵/)).toBeInTheDocument()
    expect(screen.queryByText(/板块资金轨迹/)).not.toBeInTheDocument()

    /**
     * 热力格识别：每格 `aria-label` 形如「板块 · MM-DD：值 / 无样本」。
     * 用无障碍名而非 class 选择 —— class 是样式实现，会被重构；
     * 而 `aria-label` 是语义接口（读屏依赖它），动它就得同步改测试，属有意摩擦。
     */
    const cells = [...container.querySelectorAll('span[aria-label]')]
    expect(cells.length, '矩阵未渲染任何格子').toBeGreaterThan(0)

    let nullCells = 0
    for (const c of cells) {
      const title = c.getAttribute('aria-label') ?? ''
      const text = (c.textContent ?? '').trim()
      if (title.endsWith('无样本')) {
        nullCells++
        // ⚠️ 核心不变量：缺失格的文字必须是空的。
        //    渲染成 "0" 就等于宣称「该板块当日资金恰好为零」—— 这是伪造数据。
        expect(text, `缺失格不应有文字，实为「${text}」`).toBe('')
      } else {
        // 有值的格子必须有可见读数（否则是「有值却画成空」的反向缺陷）
        expect(text.length, `有值格未显示读数：${title}`).toBeGreaterThan(0)
      }
    }

    // 一张矩阵同时承载跨日方向、强度与逐日读数，不再重复渲染轨迹卡。
  })

  it('切到「逐日原始档」tab 后，当日进出两端双向榜可用', async () => {
    const container = await renderPage(await import('@/pages/flow/FlowPage'))

    /* SegTabs 的同一段文案可能被渲染多处（按钮内 + 无障碍标签），
       故按 role 取按钮，避免 getByText 命中歧义 */
    const tab = screen
      .getAllByRole('button')
      .find((b) => /逐日原始档/.test(b.textContent ?? ''))
    expect(tab, '未找到「逐日原始档」分段按钮').toBeTruthy()
    fireEvent.click(tab!)

    await waitFor(() => {
      expect(screen.getByText(/当日进出两端/)).toBeInTheDocument()
    })

    /*
     * 条的宽度是内联 `width:X%`（双向模式下为 `w/2`，零线居中）。
     * 用属性选择器而非 class —— class 是样式实现，会被重构。
     */
    const bars = [...container.querySelectorAll<HTMLElement>('[style*="width"]')].filter((el) =>
      el.style.width.endsWith('%'),
    )
    expect(bars.length, '逐日双向榜未渲染条').toBeGreaterThan(0)
    for (const b of bars) {
      const pctValue = Number.parseFloat(b.style.width)
      expect(pctValue).toBeGreaterThanOrEqual(0)
      expect(pctValue).toBeLessThanOrEqual(100)
      expect(Number.isNaN(pctValue), '条宽为 NaN（量纲归一除零）').toBe(false)
    }
  })
})

// ────────────────────────────────────────────────────────────────
// 第二梯队：其余 8 个接入图表的页面
// ────────────────────────────────────────────────────────────────

/**
 * 取 Sparkline —— 不能用属性选择器 `svg[preserveAspectRatio="none"]`。
 *
 * ⚠️ jsdom 的 CSS 选择器解析会按 HTML 规则把属性名小写化，而 SVG 属性名大小写敏感，
 *    于是 **两种写法都匹配不到**（实测：selector 与 filter 结果 0 vs 1）。
 *    必须绕开选择器引擎，用 `getAttribute` 逐个筛。
 */
function sparklines(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('svg')].filter(
    (s) => s.getAttribute('preserveAspectRatio') === 'none',
  )
}

/** 条状/柱状图的实心柱（BarList 用内联 width%，BarChart 用非透明 rect） */
function barWidths(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="width"]')]
    .map((el) => el.style.width)
    .filter((w) => w.endsWith('%'))
    .map((w) => Number.parseFloat(w))
}

/** 断言一组宽度百分比都是合法值（非 NaN、落在 0~100） */
function expectValidWidths(widths: number[]) {
  expect(widths.length).toBeGreaterThan(0)
  for (const w of widths) {
    expect(Number.isNaN(w), '条宽为 NaN（量纲归一除零）').toBe(false)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(w).toBeLessThanOrEqual(100)
  }
}

/** 命中折线路径（含 M 与 L 指令，且坐标不含 NaN） */
function linePath(container: HTMLElement): string | undefined {
  return pathDs(container).find((d) => d.includes('M') && d.includes('L') && !d.includes('NaN'))
}

/** 按 role 取分段按钮并点击（SegTabs 同文案可能渲染多处，故不走 getByText） */
function clickTab(label: RegExp) {
  const btn = screen.getAllByRole('button').find((b) => label.test(b.textContent ?? ''))
  expect(btn, `未找到匹配 ${label} 的分段按钮`).toBeTruthy()
  fireEvent.click(btn!)
}

describe('PromotionPage —— 逐日晋级率 / 分阶段胜率 / 赔率对照', () => {
  it('晋级率折线、成功率条、赔率双向柱都画出来', async () => {
    const container = await renderPage(await import('@/pages/promotion/PromotionPage'))

    expect(screen.getAllByText(/逐日晋级率/).length, '未渲染晋级率趋势卡').toBeGreaterThan(0)
    expect(linePath(container), '晋级率折线未生成 path').toBeTruthy()

    // 分阶段成功率条（BarList 内联 width%）
    expectValidWidths(barWidths(container))

    // 赔率对照柱（BarChart 实心 rect）
    expect(dataRects(container).length, '赔率对照柱未生成 rect').toBeGreaterThan(0)
  })
})

describe('MainlinePage —— 题材涨停家数 今日 vs 昨日', () => {
  it('柱状图渲染，且存在昨日对比的空心柱', async () => {
    const container = await renderPage(await import('@/pages/mainline/MainlinePage'))

    expect(screen.getAllByText(/题材涨停家数/).length).toBeGreaterThan(0)

    /**
     * ⚠️ 盘前 09:06 后端会把 `market/latest` **重置**（`top5` 清空，实测 2026-09-21 09:06:58）
     * → 此刻**没有柱可画**，本图本该是空态。
     * 故按「数据与渲染**同真同假**」断言：有数据才要求有柱，无数据则必须是明确空态 ——
     * ⛔ 不能把「盘前数据缺失」误判成「渲染失败」（原写法每个交易日盘前都会红）。
     */
    if (top5Count() === 0) {
      expect(container.textContent, 'top5 为空却没给空态').toMatch(/暂无|未落盘|无题材/)
      return
    }

    expect(dataRects(container).length, '题材柱未生成 rect').toBeGreaterThan(0)

    /* 空心柱 = compare（昨日家数）：stroke 有值但 fill 为 none/transparent。
       ⚠️ 若昨日数据全缺，则不画空心柱 —— 此处只要求两者加起来不为零，
       即「要么有实心、要么有空心」，避免把数据缺失误判为渲染失败。 */
    const hollow = [...container.querySelectorAll('rect')].filter(
      (r) => (r.getAttribute('fill') ?? '') === 'none' || r.getAttribute('fill') === 'transparent',
    )
    expect(hollow.length).toBeGreaterThan(0)
  })
})

describe('BoardCorePage —— 四维雷达 / 核心度分布', () => {
  it('雷达画出蛛网环 + 数据多边形 + 均值对比多边形', async () => {
    const container = await renderPage(await import('@/pages/board-core/BoardCorePage'))

    expect(screen.getAllByText(/核心度结构/).length).toBeGreaterThan(0)

    const polys = [...container.querySelectorAll('polygon')]
    // 4 个蛛网环 + 数据多边形 + 均值对比多边形 = 6；少于该数说明某层没挂上
    expect(polys.length, '雷达多边形数量不足').toBeGreaterThanOrEqual(6)

    // 均值对比必须存在且为虚线 —— 虚线是「这是参照不是本体」的唯一视觉线索
    const dotted = polys.filter((p) => (p.getAttribute('stroke-dasharray') ?? '').length > 0)
    expect(dotted.length, '缺少均值对比多边形（虚线）').toBeGreaterThan(0)

    // 核心度分布柱
    expect(dataRects(container).length, '核心度分布柱未生成 rect').toBeGreaterThan(0)
  })
})

describe('GenePage —— 股性 Top15 条 / 股性分分布', () => {
  it('概览卡渲染出条与柱', async () => {
    const container = await renderPage(await import('@/pages/gene/GenePage'))

    expect(screen.getAllByText(/股性概览/).length).toBeGreaterThan(0)
    expectValidWidths(barWidths(container))
    expect(dataRects(container).length, '股性分分布柱未生成 rect').toBeGreaterThan(0)
  })
})

describe('BacktestPage —— 指标走势 / 情绪偏差', () => {
  it('命中率折线与情绪偏差柱渲染', async () => {
    const container = await renderPage(await import('@/pages/backtest/BacktestPage'))

    /* 走势卡只在「历史期次 > 1」时出现。真实数据下 cache/backtest_report_*.json
       有多个期次，故此处**直接断言存在** —— 写成条件分支会让「数据没读到」
       伪装成「设计如此」，那是最坏的一种假绿。 */
    expect(screen.getAllByText(/推测回测/).length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/指标走势/).length,
      '未渲染「指标走势」卡 —— 检查 backtest_report_*.json 是否被路由读到',
    ).toBeGreaterThan(0)

    expect(linePath(container), '命中率折线未生成 path').toBeTruthy()

    /*
     * ⚠️ 2026-11-09 对齐：情绪偏差柱**不再无条件要求存在**。
     *
     * 实测 2026-10-27~11-06 共 8 期 `summary.sentiment_diff` 全部为 null：
     * 后端 `metrics.sentiment_align.status = contract_missing`，原因是
     * 「『情绪X/10』为昨日实际分（回顾语境），非明日预判，不采用」——
     * 盘前卡没有「明日预判情绪分」的结构化字段，这个指标根本算不出来。
     *
     * 于是页面有两条合法路径，这里必须**分别锁死**，⛔ 不允许「既没柱也没说明」蒙过去：
     *   · 有数据 → 必须有柱
     *   · 没数据 → 必须明确写「算不出来 + 为什么」，⛔ 不许画空图（空图 = 伪造「偏差为 0」）
     */
    const rects = dataRects(container).length
    const txt = container.textContent ?? ''
    if (rects === 0) {
      expect(
        txt,
        '情绪偏差既没有柱、也没有写明不可评 —— 空图会把「算不出来」伪装成「偏差为 0」',
      ).toMatch(/情绪偏差[\s\S]{0,80}(不可评|算不出来)/)
    } else {
      expect(rects, '有情绪偏差数据时必须画出柱子').toBeGreaterThan(0)
    }
  })
})

describe('RotationPage —— 涨停趋势形状 / 资金双向榜', () => {
  it('趋势 tab 的 sparkline 与资金 tab 的双向榜都可渲染', async () => {
    const container = await renderPage(await import('@/pages/rotation/RotationPage'))

    clickTab(/涨停趋势/)
    /* ⚠️ 不能直接数 `svg` —— Icon 也是 svg，任何页面都能让计数 > 0，
       这条断言就永远为真、失去意义。用 `sparklines()` 精确选择。 */
    expect(sparklines(container).length, '趋势 tab 未渲染 sparkline').toBeGreaterThan(0)

    clickTab(/5日资金/)
    expectValidWidths(barWidths(container))
  })
})

describe('ReflowPage —— 回流信号排序 / 四因子结构', () => {
  it('信号条与因子柱都画出来', async () => {
    const container = await renderPage(await import('@/pages/reflow/ReflowPage'))

    expect(screen.getAllByText(/回流信号排序/).length).toBeGreaterThan(0)
    expectValidWidths(barWidths(container))
    expect(dataRects(container).length, '四因子柱未生成 rect').toBeGreaterThan(0)
  })
})

describe('StackPage —— 热力矩阵 / 窗口脉搏', () => {
  it('脉搏折线与热力格渲染，且 null 格不伪造 0', async () => {
    const container = await renderPage(await import('@/pages/stack/StackPage'))

    expect(screen.getAllByText(/窗口热力矩阵/).length).toBeGreaterThan(0)
    expect(linePath(container), '窗口脉搏折线未生成 path').toBeTruthy()

    const cells = [...container.querySelectorAll('span[aria-label]')]
    expect(cells.length, '热力矩阵未渲染任何格子').toBeGreaterThan(0)

    for (const c of cells) {
      const title = c.getAttribute('aria-label') ?? ''
      if (title.endsWith('无样本')) {
        // 缺失格必须留空 —— 渲染成 0 就等于宣称「该题材当日零涨停」
        expect((c.textContent ?? '').trim()).toBe('')
      }
    }
  })
})
