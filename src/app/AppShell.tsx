import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { TideAlgorithmStrip } from '@/features/market'
import { TopBar } from './TopBar'
import { RightRail } from './RightRail'
import { Sidebar, TopNavFallback } from './Sidebar'
import { preloadPage } from './lazyRoute'
import type { PagePath } from './pages'

/**
 * 应用外壳 —— 布局与导航。
 *
 * ## 分层说明
 *
 * AppShell 属于 **app 层**：它知道路由表、知道全局布局，是「应用如何组装」的答案。
 * 它**不包含任何业务逻辑** —— 顶栏数据订阅在 `TopBar`，业务卡片在 `features/market`。
 *
 * ## Tab 定义 = 导航顺序的唯一真源
 *
 * 路由本身由 `app/router.tsx` 声明，此处只决定「显示哪些、按什么顺序」。
 * 两者分离的原因：路由是**可达性**（URL 必须能直接打开），导航是**引导性**
 * （用户视线扫过的顺序）。它们经常不同步，混在一起会互相牵制。
 */

/**
 * 导航分段。**「实时」段必须在最前** —— 见 TABS 的排序依据。
 * 用联合类型而非 string，防止后续新增 Tab 时把段名写错、静默多出一段。
 */
export type TabGroup = '实时' | '盘面' | '题材' | '决策' | '数据'

interface TabDef {
  /** 必须来自 `pages.ts` 的 `PAGE_LOADERS` —— 类型层保证「导航项都有对应页面模块」 */
  to: PagePath
  label: string
  /** 是否精确匹配（首页 `/` 需要，否则永远高亮） */
  end?: boolean
  /** 分组 —— 渲染时每段起首插入段名标签，段间加细分隔线 */
  group: TabGroup
  /** 交易时段优先入口：即使未激活也保持可见高亮。 */
  priority?: boolean
}

/**
 * Tab 定义 = 导航顺序的唯一真源。
 *
 * ## 排序依据（两条准则，均为硬约束）
 *
 * 1. **实时性优先** —— 盘中实时数据（`routes.ts` 中 `cadence: 'intraday'`）的页面
 *    统一提到最前，独立成「实时」段。
 * 2. **短线交易优先级次之** —— 「实时」段内按「一天里什么时候会用到」排：
 *    先看盘面总览 → 再定位题材与资金 → 最后才是数据/运维类旁支。
 *
 * ## ⚠️ 实时性 ≠ 印象，必须回 `routes.ts` 核 `cadence`
 *
 * 实测（2026-09-15，脚本遍历「页面 → query → endpoint → 路由」全链路）：
 * 全站 **61 条路由中仅 8 条是 `intraday`**，其余 52 条 `daily` + 1 条 `manual`。
 * 这 8 条落在 **7 个页面**上 —— 也就是本数组的「实时」段；
 * 剩下 14 个页面全是日频/历史档，无论名字多像实时（如「盘中实时」以外的情绪周期、
 * 龙虎榜）都属历史性数据。
 *
 * ⛔ 不要凭页面标题判断实时性 —— 「情绪周期」听着像实时，实际是日频 5 日汇总；
 * 「数据记录 / 运维审计 / 同花顺数据」听着像实时/外部源，实际已归「数据」段（日频存档类）。
 *
 * ## 历史段的相对顺序保持不变
 *
 * 「盘面 → 决策 → 题材 → 数据」四段内部的先后一律沿用原顺序，
 * 只把其中属于实时的成员**摘出去**前置，不重排其余成员。
 * （如原「题材」段 8 项摘走轮动/主线/回流/资金后，剩爆发史→龙虎榜→载体→风险，
 * 相对次序与原先一致。）
 */
export const TABS: readonly TabDef[] = [
  // ── 段1 · 实时（cadence=intraday）· 按短线交易优先级 ──
  { to: '/', label: '盘中实时', end: true, group: '实时', priority: true },
  { to: '/timeline', label: '日内时间轴', group: '实时', priority: true },
  { to: '/mainline', label: '主线题材', group: '实时', priority: true },
  { to: '/effect', label: '赚钱效应', group: '实时' },
  { to: '/flow', label: '资金流向', group: '实时' },
  { to: '/reflow', label: '题材回流', group: '实时' },
  { to: '/rotation', label: '题材轮动', group: '实时' },

  // ── 段2 · 盘面定性（日频）──
  { to: '/emotion', label: '情绪周期', group: '盘面', priority: true },
  { to: '/board-core', label: '板块核心', group: '盘面' },
  { to: '/promotion', label: '连板晋级', group: '盘面' },
  { to: '/gene', label: '股性基因', group: '盘面' },

  // ── 段3 · 决策与战绩（日频）──
  { to: '/ai', label: 'AI竞价', group: '决策', priority: true },
  { to: '/ambush', label: 'AI尾盘潜伏', group: '决策', priority: true },
  { to: '/trade', label: '交易战绩', group: '决策' },
  { to: '/backtest', label: '回测', group: '决策' },
  { to: '/institution', label: '机构投研', group: '决策' },
  { to: '/auction', label: '竞价决策', group: '决策' },
  { to: '/execution-audit', label: '执行审计', group: '决策' },

  // ── 段4 · 题材与资金（日频）──
  { to: '/eruption', label: '题材爆发史', group: '题材' },
  { to: '/lhb', label: '龙虎榜', group: '题材' },
  { to: '/carrier', label: '载体追踪', group: '题材' },
  { to: '/risk', label: '风险监控', group: '题材' },

  // ── 段5 · 数据与运维（日频）──
  { to: '/data', label: '数据底座', group: '数据', priority: true },
  { to: '/record', label: '数据记录', group: '数据' },
  { to: '/ops', label: '运维审计', group: '数据' },
  { to: '/hithink', label: '同花顺数据', group: '数据' },
  { to: '/stack', label: '数据堆叠', group: '数据' },
  { to: '/archive', label: '决策存档', group: '数据' },
  { to: '/cards', label: '卡片原文', group: '数据' },
  { to: '/system', label: '系统台账', group: '数据' },
] as const

export function AppShell() {
  usePrefetchPriorityPages()

  return (
    /**
     * ## 高度锁定在视口 —— 三个滚动区各自独立（2026-10-22 用户要求）
     *
     * 用户原话：「左边的 tab 侧边栏固定，不要跟着右边的内容一起上下滚动。
     * 狸猫终端固定在左上角，下面的 tab 可以上下滚动，右侧上下滚动，这两个是分开的」。
     *
     * ⛔ 原来这里写的是 **`min-h-screen`**（最小高度），它允许被内容**撑高** ——
     *    于是页面真实高度 = 内容高度，滚动的是 `document`：
     *    侧栏 `<nav overflow-y-auto>` 与 `main overflow-y-auto` 都因为「父级没有确定高度」
     *    而**永不触发**，侧栏跟着整页一起滚，正是用户看到的现象。
     *
     * 现改为 `h-screen overflow-hidden`：高度钉死为视口高，`document` 不再滚动，
     * 滚动权交回各自的容器 ——
     *   · 侧栏品牌区 `flex-none`（固定左上角）→ tab 列表 `flex-1 overflow-y-auto`（独立滚）
     *   · 主内容 `main overflow-y-auto`（独立滚）
     *   · 右侧 rail `overflow-y-auto`（独立滚）
     *
     * ⚠️ `min-h-0` 不能省：flex 子项默认 `min-height: auto`，内容超过容器时
     *    会**拒绝收缩**，把祖先一起撑高，`overflow-y-auto` 又退回失效状态。
     *    这条链上每一层（中间列 / 内容区）都要带。
     */
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />

      {/* 中间区域：顶栏 + 主内容 +（可选）右侧 rail */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar />
        <TopNavFallback />

        {/* 主内容区：≥3xl 与 RightRail 并排 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 lg:px-5 3xl:px-6 py-3">
            <TideAlgorithmLayer />
            <Outlet />
          </main>
          <RightRail />
        </div>
      </div>
    </div>
  )
}

/**
 * 实时与盘面全部 tab 共用同一份潮汐结果。
 *
 * 归属仍在市场 feature：AppShell 只根据导航分组决定是否挂载，绝不在页面层复制阈值。
 */
function TideAlgorithmLayer() {
  const { pathname } = useLocation()
  const group = TABS.find((tab) => tab.to === pathname)?.group
  if (group !== '实时' && group !== '盘面') return null
  return <TideAlgorithmStrip group={group} />
}

/** 相邻两个预取之间的间隔 —— 拉开一点，别和首屏数据请求抢带宽 */
const PREFETCH_GAP_MS = 150

/**
 * 重点页面的**空闲预取**。
 *
 * ## 为什么值得做
 *
 * 29 个页面全是懒加载，默认行为是「点了才开始下载」。dev 环境下单个页面的
 * 模块图有数百个请求，首次点击要等几百毫秒到数秒；这段时间里任何一次请求
 * 失败，用户看到的就是「页面加载失败」。把重点页的下载挪到浏览器空闲时，
 * 点击时直接命中已完成的 promise —— 既是秒开，也把失败窗口提前消化掉了。
 *
 * ## 为什么只预取 `priority` 的几页
 *
 * 全部 29 页预取会在 dev 下瞬间打出上万请求，把首屏和 HMR 一起拖慢
 * （生产 build 后每页一个 chunk，代价小很多，但也没有必要）。
 * 优先页是侧栏带 ★ 的那几个 —— 实际使用频率最高的就是它们。
 *
 * ## 为什么是串行 + 可取消
 *
 * `StrictMode` 会双调用 effect，卸载时要能停掉剩余定时器，否则会有一批
 * 预取请求在组件已经卸载后继续跑。
 */
function usePrefetchPriorityPages() {
  useEffect(() => {
    const targets = TABS.filter((t) => t.priority && t.to !== '/').map((t) => t.to)
    const timers: number[] = []
    let cancelled = false

    const run = () => {
      targets.forEach((to, index) => {
        timers.push(
          window.setTimeout(() => {
            if (!cancelled) preloadPage(to)
          }, index * PREFETCH_GAP_MS),
        )
      })
    }

    // requestIdleCallback 在 Safari 17+ 才稳定；缺失时退化为「挂载后立即排队」
    const idle = (
      globalThis as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      }
    ).requestIdleCallback

    const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void })
      .cancelIdleCallback

    const idleHandle = typeof idle === 'function' ? idle(run, { timeout: 4000 }) : null
    if (idleHandle === null) run()

    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
      if (idleHandle !== null) cancelIdle?.(idleHandle)
    }
  }, [])
}
