import { Outlet } from 'react-router'
import { TopBar } from './TopBar'
import { RightRail } from './RightRail'
import { Sidebar, TopNavFallback } from './Sidebar'

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
  to: string
  label: string
  /** 是否精确匹配（首页 `/` 需要，否则永远高亮） */
  end?: boolean
  /** 分组 —— 渲染时每段起首插入段名标签，段间加细分隔线 */
  group: TabGroup
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
 * 「盘面 → 题材 → 决策 → 数据」四段内部的先后一律沿用原顺序，
 * 只把其中属于实时的成员**摘出去**前置，不重排其余成员。
 * （如原「题材」段 8 项摘走轮动/主线/回流/资金后，剩爆发史→龙虎榜→载体→风险，
 * 相对次序与原先一致。）
 */
export const TABS: readonly TabDef[] = [
  // ── 段1 · 实时（cadence=intraday）· 按短线交易优先级 ──
  { to: '/', label: '盘中实时', end: true, group: '实时' },
  { to: '/timeline', label: '日内时间轴', group: '实时' },
  { to: '/rotation', label: '题材轮动', group: '实时' },
  { to: '/mainline', label: '主线题材', group: '实时' },
  { to: '/reflow', label: '题材回流', group: '实时' },
  { to: '/flow', label: '资金流向', group: '实时' },

  // ── 段2 · 盘面定性（日频）──
  { to: '/emotion', label: '情绪周期', group: '盘面' },
  { to: '/board-core', label: '板块核心', group: '盘面' },
  { to: '/promotion', label: '连板晋级', group: '盘面' },
  { to: '/gene', label: '股性基因', group: '盘面' },

  // ── 段3 · 题材与资金（日频）──
  { to: '/eruption', label: '题材爆发史', group: '题材' },
  { to: '/lhb', label: '龙虎榜', group: '题材' },
  { to: '/carrier', label: '载体追踪', group: '题材' },
  { to: '/risk', label: '风险监控', group: '题材' },

  // ── 段4 · 决策与战绩（日频）──
  { to: '/ai', label: 'AI台账', group: '决策' },
  { to: '/trade', label: '交易战绩', group: '决策' },
  { to: '/backtest', label: '回测', group: '决策' },
  { to: '/institution', label: '机构投研', group: '决策' },
  { to: '/auction', label: '竞价决策', group: '决策' },

  // ── 段5 · 数据与运维（日频）──
  { to: '/record', label: '数据记录', group: '数据' },
  { to: '/ops', label: '运维审计', group: '数据' },
  { to: '/hithink', label: '同花顺数据', group: '数据' },
  { to: '/stack', label: '数据堆叠', group: '数据' },
  { to: '/archive', label: '决策存档', group: '数据' },
  { to: '/cards', label: '卡片原文', group: '数据' },
  { to: '/system', label: '系统台账', group: '数据' },
] as const

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />

      {/* 中间区域：顶栏 + 主内容 +（可选）右侧 rail */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <TopNavFallback />

        {/* 主内容区：≥3xl 与 RightRail 并排 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 min-w-0 overflow-y-auto px-4 lg:px-5 py-3">
            <Outlet />
          </main>
          <RightRail />
        </div>
      </div>
    </div>
  )
}
