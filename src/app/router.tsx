import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from './AppShell'
import { RootError } from './RootError'
import { PageError } from './PageError'
import { lazyPage } from './lazyRoute'
import { PAGE_LOADERS, type PagePath } from './pages'

/**
 * 路由表 —— React Router 8 的 Data Router。
 *
 * ## 四个设计决策
 *
 * 1. **路由表从 `pages.ts` 生成，不手写**。
 *    改造前这里是 29 行 `{ path: 'xxx', lazy: () => import('@/pages/xxx/XxxPage') }`，
 *    路径与文件位置要人工对齐；现在 `PAGE_LOADERS` 是唯一真源，路由只做
 *    「路径 → 形状」的机械转换（`'/'` 是 index，其余去掉前导斜杠）。
 *    新增页面时漏配路由**在类型层就报错**，不需要靠人眼比对两张清单。
 *
 * 2. **懒加载即代码分割**：每个页面用 `lazy` 动态导入，Vite 自动为每个页面
 *    产出独立 chunk。首屏只加载「盘中实时」，其余按访问加载。
 *    加载过程包了 `lazyPage`（重试 / 缓存 / 换版自愈），见 `lazyRoute.ts`。
 *
 * 3. **`loader` 与组件同文件**：React Router 的 `lazy` 会同时取模块的
 *    `Component` 与 `loader`，所以页面级数据预取写在页面文件里，就近维护 ——
 *    不需要一个集中的「路由配置 + 数据层」双文件来回跳。
 *
 * 4. **`errorElement` 分层**（稳定性关键，2026-10-22 补）：
 *    · 根级 `<RootError />` —— 外壳自己崩了才用，最后一道兜底
 *    · **每页 `<PageError />`** —— 模块加载失败 / 页面渲染抛错时只替换 `<Outlet />`，
 *      侧栏与顶栏保留，用户能直接切到别的 tab。此前缺失这一层，一次瞬时
 *      的 `Importing a module script failed` 会让整个终端变成一页报错。
 *    · 数据层 —— `DataUnavailableError` 由 useQuery 的 error 状态在卡片内降级
 *    · 契约层 —— 结构异常由 `contractIssues` 记录并在顶栏提示，不中断渲染
 *
 * ⚠️ 与 Vue 版的对应关系：
 *    vue-router 5 的 `defineBasicLoader` ↔ React Router 8 的 `loader`
 *    两者都做「导航完成前数据就绪」，但 React 侧走 `queryClient.ensureQueryData`，
 *    因此缓存由 TanStack Query 统一管理，loader 只管「确保有数据」。
 */
const pageRoutes: RouteObject[] = (Object.keys(PAGE_LOADERS) as PagePath[]).map(
  (to): RouteObject => {
    const errorElement = <PageError path={to} />
    // `'/'` 必须是 index route —— 否则与父级的 `path: '/'` 冲突
    return to === '/'
      ? { index: true, lazy: lazyPage(to), errorElement }
      : { path: to.slice(1), lazy: lazyPage(to), errorElement }
  },
)

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RootError />,
    children: pageRoutes,
  },
])
