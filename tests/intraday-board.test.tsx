/**
 * 盘中实时页 —— **PC 大屏布局与内容覆盖**回归锁。
 *
 * ## 为什么需要这个测试（它锁的是「以前根本测不到」的一类问题）
 *
 * 2026-09-15 用户反馈：「放到 4K PC 屏幕上，整体布局非常空洞」。
 * 根因有两层，**两层都没有任何测试覆盖**：
 *
 *   ① 布局层：21 个页面一律 `flex flex-col`（单列铺满）。4K 下一张卡横跨
 *      3800px 而内容只占左侧 500–800px → 单卡横向空洞约 80%。
 *   ② 内容层：首屏只用了主快照 20 个字段里的 5–8 个。`ebb`（退潮预警）、
 *      `index`（三大指数）、`top5`（主线热度）、`early`（早鸟埋伏）、
 *      `sector_risk`、`sector_delta`、`em_expect` 全部**已落盘但零渲染** ——
 *      空洞有一半是内容没上屏。
 *
 * 这两层都不会被「页面能渲染、不抛错」这类冒烟测试发现：单列布局渲染得
 * 完美，只是很空；缺失的模块更不会报错，它只是不存在。
 *
 * ## 断言策略：锁「不变量」而不是锁「像素」
 *
 *   1. PC 密度 —— 网格断点类必须存在，且 `theme.css` 必须定义对应的断点令牌
 *   2. 模块覆盖 —— 新增的每张卡都必须真的渲染出来（锁住「内容不上屏」回归）
 *   3. 数据卫生 —— 不出现 `undefined` / `NaN` / `[object Object]`（真实数据
 *      字段可空性的一大类 bug 就表现成这些字面量直接印在屏幕上）
 *
 * ## ⚠️ 为什么断言 `theme.css` 的令牌而不只断言类名
 *
 * Tailwind 只对**已定义的断点**生成 CSS。若有人删掉 `--breakpoint-3xl`，
 * `3xl:grid-cols-4` 这个**类名依然会留在 DOM 的 class 属性里**（它只是字符串），
 * 但产物里不会生成任何对应规则 —— 页面静默退回 2 列，而只查 class 的测试
 * 会一路绿灯。所以令牌与类名都要锁。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { ROUTES, FILE_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, healthPayload, resolveDataRoot, type RouteDefLike } from '../scripts/lib/read-route.mjs'

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

/** 真实数据的 fetch 替身 —— 与 dev 中间件同一实现（`read-route.mjs`） */
function installDataFetch() {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url).split('?')[0]

    if (url === '/api/health') {
      return new Response(JSON.stringify(healthPayload(DATA_ROOT, FILE_ROUTES)), { status: 200 })
    }

    const def = (ROUTES as Record<string, RouteDefLike>)[url]
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

/** 读真实快照 —— 用于「数据驱动」的断言（有则必须渲染，无则必须不渲染） */
function readSnapshot(): Record<string, unknown> | null {
  const def = (ROUTES as Record<string, RouteDefLike>)['/api/market/latest']
  try {
    return readRoute(DATA_ROOT, def) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 读真实短线精灵文件 —— 用于「当日沉淀」的数据驱动断言 */
function readSignals(): { signals?: unknown[]; signals_today?: unknown[] } | null {
  const def = (ROUTES as Record<string, RouteDefLike>)['/api/market/signals']
  try {
    return readRoute(DATA_ROOT, def) as { signals?: unknown[]; signals_today?: unknown[] }
  } catch {
    return null
  }
}

let restore: () => void
beforeAll(() => {
  restore = installDataFetch()
})
afterAll(() => {
  restore?.()
})

/** 渲染盘中实时页并等查询落定 */
async function renderIntraday() {
  const mod = (await import('@/pages/intraday/IntradayPage')) as { Component?: ComponentType }
  expect(mod.Component, 'IntradayPage 缺少 Component 导出').toBeTypeOf('function')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
  })
  const Page = mod.Component!
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { container } = render(<Page />, { wrapper })
  await waitFor(() => {
    expect(client.isFetching()).toBe(0)
  })
  return container
}

describe('盘中实时页 · PC 大屏布局不变量', () => {
  it('左 60% / 中 30% / 右 10% 三栏：左首行通栏最强题材 + 次行 2 列，中 3 张纵向，右为信号 rail', async () => {
    const c = await renderIntraday()
    const zones = c.querySelector('.intraday-zones') as HTMLElement | null
    expect(zones, '未找到三栏容器 `.intraday-zones` —— 退回单列会让表格挤成两行').toBeTruthy()
    // ⛔⛔ 窄屏单栏必须是 `max-xl:flex-col`（与 `xl` 媒体查询互斥）。
    //    裸 `flex-col` 在同层同权下**排在宽屏规则之后** → 所有宽度都竖排（真实事故）。
    expect(zones?.className, '窄屏单栏应用 max-xl:flex-col').toContain('max-xl:flex-col')
    expect(zones?.className, '宽屏横排').toContain('flex')
    expect(
      zones?.className.split(/\s+/),
      '⛔ 不得出现裸 flex-col —— 它会让三栏永远堆叠',
    ).not.toContain('flex-col')

    const cols = [...zones!.children] as HTMLElement[]
    expect(cols, '三栏 = 左 + 中 + 右').toHaveLength(3)
    expect(cols[0].className, '左栏应占 60%').toContain('xl:w-[60%]')
    expect(cols[1].className, '中栏应占 30%').toContain('xl:w-[30%]')
    expect(cols[2].className, '右栏应占 10%').toContain('xl:w-[10%]')

    // 左栏：2 列网格。首行是**通栏**的「今天最强题材」（展开后要铺一条线的全部个股），
    // 次行才是情绪走势 + 板块资金。⛔ 不能用 Board：它按视口给列数。
    const leftGrid = cols[0].querySelector('div[class*="grid"]') as HTMLElement | null
    expect(leftGrid, '左栏内部应是均分网格（⛔ 不能用 Board：它按视口给列数）').toBeTruthy()
    expect(leftGrid!.className).toContain('xl:grid-cols-2')
    const cells = [...leftGrid!.children] as HTMLElement[]
    expect(cells, '左栏 = 通栏题材卡 + 情绪 + 资金').toHaveLength(3)
    expect(cells[0].className, '最强题材应占满整行').toContain('xl:col-span-2')
    expect(cells[0].querySelector('.panel-title')?.textContent, '首行应是最强题材卡').toContain('最强题材')
    expect(cells[0].querySelector('.panel-title')?.textContent, '⛔ 旧的题材强度表已并入').not.toContain('题材强度')

    // 中栏：纵向堆叠的 2 张（顺序 = 用户实际调定的顺序；测试跟随，⛔ 不反向覆盖用户的调整）
    // ⚠️ 2026-10-30 校正：`昨日涨停反馈` 早已并入天梯与极值（见 IntradayPage 注释），
    //    本条此前仍按 3 张断言 → 长期红着。这里按**实际 DOM** 锁 2 张。
    const midTitles = [...cols[1].querySelectorAll('.panel-title')].map((e) => e.textContent ?? '')
    expect(midTitles).toHaveLength(2)
    for (const [i, t] of ['连板天梯', '极值名单'].entries()) {
      expect(midTitles[i], `中栏第 ${i + 1} 张应是「${t}」`).toContain(t)
    }
    expect(midTitles.some((t) => t.includes('昨日涨停反馈')), '反馈已并入天梯/极值，不应再单独成卡').toBe(false)

    // 右栏**本身**即信号 rail（`SignalRail` 根节点带 `.signal-rail`，非 Card → 不计入 panel-title）
    expect(cols[2].classList.contains('signal-rail'), '右栏应是信号 rail').toBe(true)

    // 全页共 5 张 Card：左 3 + 中 2（信号 rail 不是 Card）
    expect(c.querySelectorAll('.panel-title')).toHaveLength(5)
  })

  it('⚡ 短线精灵渲染「当日沉淀」（signals_today）—— 刷新后列表不空，且剔除科创板', async () => {
    const c = await renderIntraday()
    // 2026-09-22：短线精灵已迁入右栏 `SignalRail`（非 Card → 无 `.panel-title`）
    const panel = c.querySelector('.signal-rail') as HTMLElement | null
    expect(panel, '未找到信号 rail（`.signal-rail`）').toBeTruthy()
    /* ⛔ 代码只渲染在 `title` 属性里（紧凑窄列不铺代码）—— 断言必须把 title 一并纳入，
       否则「只在沉淀里的信号是否渲染」这条硬锁永远落空（文本里根本没有代码）。 */
    const txt =
      (panel!.textContent ?? '') +
      ' ' +
      [...panel!.querySelectorAll('[title]')].map((e) => e.getAttribute('title') ?? '').join(' ')

    /* 数据与渲染**同真同假**：当日有沉淀 → 必须渲染出条目；
       ⛔ 不得退回「本轮 signals 为空 ⇒ 空态」——那正是用户抓包的「一刷新就空」。
       存量为空时（如全新交易日盘前）才允许空态。 */
    const sig = readSignals()
    const deposit = (sig?.signals_today ?? []) as { code?: string }[]
    if (deposit.length > 0) {
      expect(txt, '有当日沉淀却没渲染出列表（读回「本轮」会导致空态）').not.toContain('暂无短线信号')
      /* ⛔ 硬锁（弱断言会被「此刻本轮恰好非空」蒙过去，2026-09-21 实测踩到）：
         「只在沉淀里、不在本轮里」的信号**必须**渲染出来 —— 只有真的读了
         `signals_today` 才可能满足这一点。 */
      const curCodes = new Set(((sig?.signals ?? []) as { code?: string }[]).map((s) => s.code))
      const onlyDeposit = deposit
        .map((d) => d.code)
        .filter((code): code is string => !!code && !curCodes.has(code))
      if (onlyDeposit.length > 0) {
        expect(
          onlyDeposit.some((code) => txt.includes(code)),
          '只在沉淀里的信号未渲染 → 读的是「本轮 signals」而非「当日沉淀」',
        ).toBe(true)
      }
    } else {
      expect(txt).toContain('暂无短线信号')
    }

    // ⛔ 科创板（688/689）无交易权限 —— 全卡剔除（后端未滤，前端兜底）
    expect(txt.match(/68[89]\d{3}/g), '短线精灵出现科创板代码').toBeNull()
  })

  it('theme.css 定义了 3xl / 4xl 断点令牌（否则上面的类名不会生成 CSS）', () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/styles/theme.css'), 'utf8')
    expect(css, '缺少 --breakpoint-3xl —— 3xl: 前缀的类全部静默失效').toContain('--breakpoint-3xl')
    expect(css, '缺少 --breakpoint-4xl —— 4xl: 前缀的类全部静默失效').toContain('--breakpoint-4xl')
  })

  it('三栏主体位于首屏，情绪通栏不再占用盘中页首行', async () => {
    const c = await renderIntraday()
    const root = c.firstElementChild as HTMLElement
    expect(root.className, '根容器应是纵向 flex（通栏由 flex 自然铺满）').toContain('flex-col')
    // 情绪指挥条已上移顶栏 header，盘中页首屏主体应直接是三栏工作内容
    expect(
      root.querySelector('.intraday-zones'),
      '首屏缺少三栏分区 —— 工作内容不是首屏主体',
    ).toBeTruthy()
  })
})

describe('盘中实时页 · 实时字段覆盖（此前零渲染）', () => {
  it('指挥条维度已上移顶栏：盘中页不重复渲染情绪 KPI 与指数', async () => {
    // 「这些维度必须上屏」的覆盖已迁移到 tests/topbar-header.test.tsx（载体 = 顶栏）。
    // 这里锁的是迁移后的**新不变量**：同一维度不应在顶栏与盘中页各显示一次。
    const c = await renderIntraday()
    const text = c.textContent ?? ''

    // 「快照情绪」是指挥条专属定性标签，现已归顶栏 header；盘中页再出现即为重复
    expect(text, '盘中页仍在渲染「快照情绪」—— 该维度已上移顶栏 header').not.toContain('快照情绪')

    // 三大指数同理，只在顶栏出现一次
    const snap = readSnapshot()
    const idx = (snap?.index as { name: string }[] | undefined) ?? []
    for (const ix of idx) {
      expect(text, `盘中页仍渲染指数「${ix.name}」—— 指数维度已上移顶栏`).not.toContain(ix.name)
    }
  })

  it('退潮预警与数据同真同假（ebb 非空必上屏，为空必不占位）', async () => {
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    const snap = readSnapshot()
    const ebb = snap?.ebb as { severity?: string; signals?: string[] } | null | undefined

    if (ebb?.severity) {
      expect(text, `ebb.severity=${ebb.severity} 但预警未渲染`).toContain(ebb.severity)
      for (const sig of ebb.signals ?? []) {
        expect(text, `退潮信号「${sig}」未渲染`).toContain(sig)
      }
    } else {
      expect(text, 'ebb 为空却渲染了预警 —— 正常态不该占位').not.toContain('退潮预警')
    }
  })

  it('移除四张旧独立卡；题材与个股合并为「今天最强题材」一张，不再各占一张', async () => {
    const c = await renderIntraday()
    const titles = [...c.querySelectorAll('.panel-title')].map((el) => el.textContent ?? '')
    for (const old of ['早鸟埋伏', '主线热度', '次日预期', '板块增减']) {
      expect(titles.some((title) => title.includes(old))).toBe(false)
    }
    // 5 张 Card 各恰好一次（短线精灵 2026-09-22 起迁入右栏 rail，非 Card → 不在此列）
    for (const title of ['盘中情绪走势', '最强题材', '板块资金', '连板天梯', '极值名单']) {
      expect(titles.filter((text) => text.includes(title)), `「${title}」应恰好出现一次`).toHaveLength(1)
    }
    // 2026-10-30：题材强度表与核心标的表已并成一张可折叠卡，⛔ 不得再单独出现
    for (const gone of ['题材强度', '核心标的']) {
      expect(titles.some((text) => text.includes(gone)), `「${gone}」应已并入最强题材卡`).toBe(false)
    }
    // 短线精灵 = 右栏 rail（承载短线精灵，非 Card）
    expect(c.querySelector('.signal-rail'), '短线精灵应迁入右栏 rail').toBeTruthy()
    // ⛔ 盘中实时页不放日内时间轴（用户 2026-09-20 定调：时间轴归 /timeline）
    expect(titles.some((title) => title.includes('时间轴'))).toBe(false)
    /* 题材行：数据与渲染**同真同假** —— 盘前约 09:06 后端会把 `market/latest` 重置
       （`top5` 清空，实测 2026-09-21 09:06:58），此刻最强题材卡本该渲染空态。
       ⛔ 不能把「盘前无数据」误判成「没渲染」。 */
    const top5 = ((readSnapshot()?.top5 as unknown[] | undefined) ?? [])
    if (top5.length > 0) {
      expect(c.querySelector('button[aria-label^="题材 "]'), 'top5 非空却没渲染题材行').not.toBeNull()
      // 默认展开第一名 —— 打开页面就能看到最强那条线里是谁
      const opened = c.querySelector('button[aria-expanded="true"]')
      expect(opened, '应默认展开最强题材').not.toBeNull()
    } else {
      expect(c.textContent, 'top5 为空时应给明确空态').toContain('暂无题材强度数据')
    }
    /** 左栏 3 张 —— 顺序即阅读顺序 */
    const zones = c.querySelector('.intraday-zones')!
    const leftGrid = zones.children[0].querySelector('div[class*="grid"]')!
    const leftTitles = [...leftGrid.children].map((el) => el.querySelector('.panel-title')?.textContent ?? '')
    expect(leftTitles).toHaveLength(3)
    for (const [i, t] of ['最强题材', '盘中情绪走势', '板块资金'].entries()) {
      expect(leftTitles[i], `左栏第 ${i + 1} 张应是「${t}」`).toContain(t)
    }
    /* 同一只票全页只出现一次（题材卡是唯一承载个股的地方）。 */
    const codes = [...c.querySelectorAll('[data-stock-code]')].map((el) => el.getAttribute('data-stock-code'))
    if (codes.length > 0) {
      // 同一只票可能同时是多个题材的核心（如上海沪工：业绩增长 + 航天），跨题材重复是事实，
      // 但**同一题材内**不得重复铺行 —— 这里按「题材行内」校验。
      const perTheme = [...c.querySelectorAll('button[aria-expanded]')].map((btn) =>
        [...(btn.parentElement?.querySelectorAll('[data-stock-code]') ?? [])].map((el) => el.getAttribute('data-stock-code')),
      )
      for (const list of perTheme) {
        expect(new Set(list).size, '同一题材内同一只票不得重复上屏').toBe(list.length)
      }
    } else if (top5.length > 0) {
      expect(c.textContent, '有题材却一个个股都没渲染').not.toContain('undefined')
    }
  })
})

describe('盘中实时页 · 数据卫生', () => {
  it('不把 undefined / NaN / [object Object] 印到屏幕上', async () => {
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    for (const bad of ['undefined', 'NaN', '[object Object]']) {
      expect(text, `页面出现「${bad}」—— 字段可空性处理有漏`).not.toContain(bad)
    }
  })

  it('⛔ 不出现科创板（688/689）标的 —— 用户无交易权限', async () => {
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    const snap = readSnapshot()

    /**
     * ⚠️ 断言必须落在**名称**上，不能只查代码。
     *
     * 「次日预期」卡只渲染标的**名称**（东财榜不带本系统口径的代码），
     * 所以「页面文本里没有 688313」这种断言永远成立 —— 它测不到任何东西。
     * 实测教训：去掉 688 过滤后该断言依然全绿。
     *
     * 正确做法是从真实数据里取出所有 688 标的的名称，逐个断言未出现。
     */
    const starNames: string[] = []
    const emExpect = (snap?.em_expect as { stocks?: { code?: string; name?: string }[] }[]) ?? []
    for (const e of emExpect) {
      for (const s of e.stocks ?? []) {
        if (/^68[89]/.test(s.code ?? '')) starNames.push(s.name ?? '')
      }
    }
    expect(starNames.length, '样本里没有 688 标的 —— 本断言当前测不到东西，需换样本').toBeGreaterThan(0)

    for (const name of starNames) {
      expect(text, `科创板「${name}」被渲染到页面上 —— 无权限标的不得展示`).not.toContain(name)
    }

    // 兜底：若将来有卡片连代码一起渲染，这条会拦住（两种形态都拦）
    expect(text, '页面出现 688/689 代码').not.toMatch(/\b68[89]\d{3}\b/)
  })

  it('广度/量能维度已上移顶栏：盘中页不再承载这些 KPI', async () => {
    // 「缺失数据显示 — 而不是 0」的强覆盖已迁移到 tests/topbar-header.test.tsx
    // —— 那里用**构造的缺失样本**验证，不再依赖真实数据恰好缺失。
    // 这里锁的是迁移后的新不变量：这些维度只应出现在顶栏。
    const c = await renderIntraday()
    const text = c.textContent ?? ''
    for (const label of ['封板率', '上涨家数']) {
      expect(text, `盘中页仍渲染「${label}」—— 该 KPI 已上移顶栏 header`).not.toContain(label)
    }
  })
})
