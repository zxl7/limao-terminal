import { Link, useRouteError } from 'react-router'
import { DataUnavailableError } from '@/shared/api'
import { PageLoadError, isPageLoaded, loadPage } from './lazyRoute'
import type { PagePath } from './pages'

/**
 * **页面级**错误边界 —— 挂在每个子路由的 `errorElement` 上。
 *
 * ## 为什么这一层必须有（原来的最大稳定性缺口）
 *
 * 改造前只有根级 `errorElement: <RootError />`，而它挂在 `/` 路由上 ——
 * 一旦某个页面的 chunk 加载失败，React Router 会用错误页**替换整个 AppShell**：
 * 侧栏、顶栏、导航全部消失，用户被困在一页报错里，只能手动刷新。
 * 一次瞬时的模块请求失败，代价是「整个终端不可用」。
 *
 * 挂在子路由上之后，`errorElement` 只在 `AppShell` 的 `<Outlet />` 位置渲染 ——
 * **外壳保留，用户可以直接点别的 tab**，故障被限制在单页范围内。
 *
 * ## 设计取舍：为什么主按钮是「重新加载页面」而不是「重试」
 *
 * 模块加载失败意味着**模块图本身**已不可信（换版 / 依赖失效 / HMR 打断），
 * 重新 import 同一 URL 大概率还是失败，只有重新取 HTML 才能拿到新的模块地址。
 * 所以主按钮走 `location.reload()`；而「回到盘中实时」是 SPA 导航 ——
 * 它加载的是**另一个**页面模块，通常能成功，是「不想刷新」时的退路。
 */
export function PageError({ path }: { path: PagePath }) {
  const error = useRouteError()

  const isLoadError = error instanceof PageLoadError
  const triedBefore = isPageLoaded(path)
  // 数据层失败（接口 404/超时/被分享中转页拦成 HTML）也是一种「可解释原因」，
  // 不该和「组件渲染 bug」共用同一句含糊的「代码执行时抛出了异常」。
  const isDataError = error instanceof DataUnavailableError

  const title = isLoadError ? '页面模块加载失败' : isDataError ? '页面数据未取到' : '页面渲染出错'
  const hint = isLoadError
    ? triedBefore
      ? '这个页面之前在本次会话里加载成功过，说明是**瞬时中断**（网络抖动、版本更新或开发服务器重启）。重新加载即可恢复。'
      : '页面代码没能下载下来。通常是网络中断、开发服务器重启，或刚发布了新版本。'
    : isDataError
      ? '页面代码正常，是取数那一步失败了。可能是该路数据当日尚未生成，或分享通道（中转/警告页）把接口响应换成了 HTML。'
      : '页面代码执行时抛出了异常。其他页面不受影响。'

  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)

  /**
   * 不刷新的退路：先试着把模块重新取一次（清过缓存，所以是**真的重新请求**）。
   * 成功说明只是瞬时抖动，直接 `reload` 会丢掉当前页面状态 —— 但错误边界已经
   * 把内容卸载了，没有状态可丢，这里只是为了让「重新加载」在视觉上更确定。
   */
  const retryInPlace = () => {
    void loadPage(path, { autoReload: true })
      .then(() => globalThis.location.reload())
      .catch(() => globalThis.location.reload())
  }

  return (
    <div className="max-w-[720px] mx-auto mt-10 bg-card border border-line-strong rounded-[var(--radius-sm)] p-5">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-up flex-none" aria-hidden />
        <h1 className="text-15 font-semibold text-txt m-0">{title}</h1>
        <code className="ml-auto text-11 text-sub head-num">{path}</code>
      </div>

      <p className="text-13 text-sub mt-2 mb-0 leading-relaxed">{hint}</p>

      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={retryInPlace}
          className="px-3 py-1.5 text-13 font-medium rounded-[var(--radius-sm)] bg-up text-white border-0 cursor-pointer hover:opacity-90"
        >
          重新加载页面
        </button>
        <Link
          to="/"
          className="px-3 py-1.5 text-13 rounded-[var(--radius-sm)] bg-line-faint text-txt no-underline border border-line hover:bg-line"
        >
          回到盘中实时
        </Link>
        <span className="text-11 text-sub ml-1">左侧其他页面仍可正常访问</span>
      </div>

      <details className="mt-4">
        <summary className="text-12 text-sub cursor-pointer select-none">
          错误详情（排查用）
        </summary>
        <pre className="mt-2 p-3 bg-line-faint border border-line rounded-[var(--radius-sm)] text-11 leading-relaxed overflow-auto max-h-[240px] whitespace-pre-wrap text-sub m-0">
          {detail}
        </pre>
      </details>
    </div>
  )
}
