import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { RootError } from './RootError'

/**
 * 路由表 —— React Router 8 的 Data Router。
 *
 * ## 三个设计决策
 *
 * 1. **懒加载即代码分割**：每个页面用 `lazy` 动态导入，Vite 自动为每个页面
 *    产出独立 chunk。首屏只加载「盘中实时」，其余按访问加载。
 *
 * 2. **`loader` 与组件同文件**：React Router 的 `lazy` 会同时取模块的
 *    `Component` 与 `loader`，所以页面级数据预取写在页面文件里，就近维护 ——
 *    不需要一个集中的「路由配置 + 数据层」双文件来回跳。
 *
 * 3. **`errorElement` 分层**：根级兜底 + 数据层在卡片内降级（见 RootError 注释）。
 *
 * ⚠️ 与 Vue 版的对应关系：
 *    vue-router 5 的 `defineBasicLoader` ↔ React Router 8 的 `loader`
 *    两者都做「导航完成前数据就绪」，但 React 侧走 `queryClient.ensureQueryData`,
 *    因此缓存由 TanStack Query 统一管理，loader 只管「确保有数据」。
 */

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RootError />,
    children: [
      // ── 盘面定性 ──
      { index: true, lazy: () => import('@/pages/intraday/IntradayPage') },
      // 日内炒作时间轴 —— 盘中产物（zt_history/audit 盘中持续写），不过要等收盘才有完整 zt_list
      { path: 'timeline', lazy: () => import('@/pages/timeline/TimelinePage') },
      // 赚钱/亏钱效应研判 —— 当日双轴走实时（30s），历史与推演走日频
      { path: 'effect', lazy: () => import('@/pages/effect/EffectPage') },
      { path: 'emotion', lazy: () => import('@/pages/emotion/EmotionPage') },
      { path: 'board-core', lazy: () => import('@/pages/board-core/BoardCorePage') },
      { path: 'promotion', lazy: () => import('@/pages/promotion/PromotionPage') },
      { path: 'gene', lazy: () => import('@/pages/gene/GenePage') },

      // ── 题材与资金 ──
      { path: 'rotation', lazy: () => import('@/pages/rotation/RotationPage') },
      { path: 'mainline', lazy: () => import('@/pages/mainline/MainlinePage') },
      { path: 'reflow', lazy: () => import('@/pages/reflow/ReflowPage') },
      { path: 'eruption', lazy: () => import('@/pages/eruption/EruptionPage') },
      { path: 'flow', lazy: () => import('@/pages/flow/FlowPage') },
      { path: 'lhb', lazy: () => import('@/pages/lhb/LhbPage') },
      { path: 'carrier', lazy: () => import('@/pages/carrier/CarrierPage') },
      { path: 'risk', lazy: () => import('@/pages/risk/RiskPage') },
      { path: 'hithink', lazy: () => import('@/pages/hithink/HithinkPage') },

      // ── 决策与战绩 ──
      { path: 'ai', lazy: () => import('@/pages/ai/AiPage') },
      { path: 'ambush', lazy: () => import('@/pages/ambush/AmbushPage') },
      { path: 'trade', lazy: () => import('@/pages/trade/TradePage') },
      { path: 'backtest', lazy: () => import('@/pages/backtest/BacktestPage') },
      { path: 'institution', lazy: () => import('@/pages/institution/InstitutionPage') },
      { path: 'auction', lazy: () => import('@/pages/auction/AuctionPage') },
      { path: 'execution-audit', lazy: () => import('@/pages/execution-audit/ExecutionAuditPage') },

      // ── 数据与运维 ──
      { path: 'record', lazy: () => import('@/pages/record/RecordPage') },
      { path: 'stack', lazy: () => import('@/pages/stack/StackPage') },
      { path: 'archive', lazy: () => import('@/pages/archive/ArchivePage') },
      { path: 'cards', lazy: () => import('@/pages/cards/CardsPage') },
      { path: 'system', lazy: () => import('@/pages/system/SystemPage') },
      { path: 'ops', lazy: () => import('@/pages/ops/OpsPage') },
    ],
  },
])
