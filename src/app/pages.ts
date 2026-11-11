/**
 * 页面加载器 —— **「URL 路径 ↔ 动态导入」的唯一真源**。
 *
 * ## 为什么单独一个文件（而不是写在 router.tsx 里）
 *
 * 同一个 `import()` 现在有三个调用方：
 *   1. `router.tsx`  —— 导航到该页时真正加载
 *   2. `Sidebar.tsx` —— 鼠标悬停 / 键盘聚焦时**预取**（把加载窗口提前到点击之前）
 *   3. `AppShell.tsx`—— 空闲时预取「重点盯盘」页面
 *
 * 如果三处各写一份 `() => import('@/pages/xxx/XxxPage')`，浏览器会把它们当成
 * **三个不同的模块请求**（Vite dev 下 URL 相同可复用，但 build 后会各自产生
 * 独立的预加载链接，且缓存 promise 无法共享）。更要命的是：路径写错只会在
 * 运行时报 `404 / Importing a module script failed`，编译期发现不了。
 *
 * 集中在这里之后：
 *   · `PagePath` 是**字面量联合类型** —— `TABS` 里写错一个路径名，`tsc` 直接报错
 *   · 加载 promise 的缓存在 `lazyRoute.ts` 里按路径只存一份，三处共享
 *
 * ## ⚠️ 新增页面时必须同时做两件事
 *
 *   1. 在此文件加一行（否则路由不存在、侧栏也没有入口）
 *   2. 在 `AppShell.tsx` 的 `TABS` 加一行（否则 URL 可达但导航里看不到）
 *
 * 两者由 `TABS: readonly TabDef[]` 中 `to: PagePath` 的约束串起来 ——
 * 漏了第 1 步，第 2 步的 `to` 会类型报错，漏不了。
 */

/** 页面模块的形状（React Router 的 `lazy` 认这两个导出） */
export interface PageModule {
  Component?: unknown
  loader?: unknown
}

/**
 * 声明顺序 = **侧栏渲染顺序的依据**（`AppShell` 的 `TABS` 与之一致）。
 * 这里只需要「存在」，排序与展示由 `TABS` 负责 —— 两者职责不重叠：
 * 本文件回答「这页从哪个文件来」，`TABS` 回答「用户在哪看到它」。
 */
export const PAGE_LOADERS = {
  // ── 实时（盘中数据，30s 轮询）──
  '/': () => import('@/pages/intraday/IntradayPage'),
  '/timeline': () => import('@/pages/timeline/TimelinePage'),
  '/mainline': () => import('@/pages/mainline/MainlinePage'),
  '/effect': () => import('@/pages/effect/EffectPage'),
  '/flow': () => import('@/pages/flow/FlowPage'),
  '/reflow': () => import('@/pages/reflow/ReflowPage'),
  '/rotation': () => import('@/pages/rotation/RotationPage'),

  // ── 盘面定性（日频）──
  '/emotion': () => import('@/pages/emotion/EmotionPage'),
  '/board-core': () => import('@/pages/board-core/BoardCorePage'),
  '/leader-daily': () => import('@/pages/leader-daily/LeaderDailyPage'),
  '/promotion': () => import('@/pages/promotion/PromotionPage'),
  '/gene': () => import('@/pages/gene/GenePage'),
  '/dragon-gene': () => import('@/pages/dragon-gene/DragonGenePage'),
  '/rules': () => import('@/pages/rules/RulesPage'),

  // ── 决策与战绩 ──
  '/ai': () => import('@/pages/ai/AiPage'),
  '/ambush': () => import('@/pages/ambush/AmbushPage'),
  '/trade': () => import('@/pages/trade/TradePage'),
  '/backtest': () => import('@/pages/backtest/BacktestPage'),
  '/institution': () => import('@/pages/institution/InstitutionPage'),
  '/auction': () => import('@/pages/auction/AuctionPage'),
  '/execution-audit': () => import('@/pages/execution-audit/ExecutionAuditPage'),
  '/sector-gap': () => import('@/pages/sector-gap/SectorGapPage'),

  // ── 题材与资金（日频）──
  '/eruption': () => import('@/pages/eruption/EruptionPage'),
  '/lhb': () => import('@/pages/lhb/LhbPage'),
  '/carrier': () => import('@/pages/carrier/CarrierPage'),
  '/risk': () => import('@/pages/risk/RiskPage'),

  // ── 数据与运维 ──
  '/data': () => import('@/pages/data/DataPage'),
  '/record': () => import('@/pages/record/RecordPage'),
  '/ops': () => import('@/pages/ops/OpsPage'),
  '/hithink': () => import('@/pages/hithink/HithinkPage'),
  '/stack': () => import('@/pages/stack/StackPage'),
  '/archive': () => import('@/pages/archive/ArchivePage'),
  '/cards': () => import('@/pages/cards/CardsPage'),
  '/system': () => import('@/pages/system/SystemPage'),
} satisfies Record<string, () => Promise<unknown>>

/** 全部合法页面路径（`'/' | '/timeline' | …`） */
export type PagePath = keyof typeof PAGE_LOADERS

/** 运行时校验用（预取只接受已登记路径，防止拼错路径发起无效请求） */
export function isPagePath(value: string): value is PagePath {
  return Object.hasOwn(PAGE_LOADERS, value)
}
