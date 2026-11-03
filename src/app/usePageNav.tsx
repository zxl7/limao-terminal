import { useCallback, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { loadPage } from './lazyRoute'
import type { PagePath } from './pages'

/**
 * 侧栏 / 顶栏 tab 的**显式导航** —— 先确保页面模块到位，再跳转。
 *
 * ## 为什么不能只靠 `<NavLink>`
 *
 * 实测（2026-10-22，CDP 拦截 `SystemPage.tsx` 请求）：React Router 的 `lazy`
 * 失败时**不会**渲染目标路由的 `errorElement` —— 它会把整次导航 cancel 掉，
 * URL 回退到原页面。用户看到的是「点了没反应」，只有控制台里躺着一句
 * `Importing a module script failed`。
 *
 * 也就是说：`errorElement` 只能兜住「页面已经开始渲染之后」的错误
 * （直接访问 URL、loader 抛错、组件渲染抛错），**兜不住「模块没下载下来」**。
 * 这一层必须自己控。
 *
 * ## 做法
 *
 * 拦截点击 → `await loadPage(to)` → 成功才 `navigate(to)`；失败就地弹一条提示，
 * 页面不动。好处有三个：
 *   · 失败时用户看见的是「某某页面加载失败 + 重试」，而不是无声无息
 *   · 不在失败后跳到一个空白路由，原页面内容不丢
 *   · 模块已在缓存的正常情况只多一个微任务，点击体感无差别
 *
 * ## 不能拦的情况
 *
 * 带修饰键（⌘/Ctrl/Shift/Alt）或非左键时直接放行 —— 那是「新标签打开」的意图，
 * 必须交给浏览器处理，否则会破坏用户习惯。
 */

export interface NavFailure {
  path: PagePath
  label: string
  message: string
}

/**
 * `navigate()` 在 React Router 里返回 `void | Promise<void>`（取决于是否 data router）。
 * loader 抛错时 RR 已经把它交给 `errorElement` 渲染，这里的 catch 只是防止
 * 控制台多出一条 unhandled rejection —— 不吞掉界面上的错误展示。
 */
function navigateQuietly(navigate: ReturnType<typeof useNavigate>, to: PagePath): void {
  void Promise.resolve(navigate(to)).catch(() => {})
}

export function usePageNav() {
  const navigate = useNavigate()
  const [failure, setFailure] = useState<NavFailure | null>(null)

  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, to: PagePath, label: string) => {
      // 新窗口/新标签/中键：交回浏览器
      if (event.defaultPrevented) return
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      event.preventDefault()
      setFailure(null)

      // autoReload: 用户明确点了这页，重试耗尽后允许整页刷新自救
      loadPage(to, { autoReload: true })
        .then(() => navigateQuietly(navigate, to))
        .catch((error: unknown) => {
          setFailure({
            path: to,
            label,
            message: error instanceof Error ? error.message : String(error),
          })
        })
    },
    [navigate],
  )

  const retry = useCallback(() => {
    if (!failure) return
    const { path, label } = failure
    setFailure(null)
    loadPage(path, { autoReload: true })
      .then(() => navigateQuietly(navigate, path))
      .catch((error: unknown) => {
        setFailure({
          path,
          label,
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }, [failure, navigate])

  const dismiss = useCallback(() => setFailure(null), [])

  return { onClick, retry, dismiss, failure }
}

/**
 * 导航失败提示条 —— 浮在顶栏下方居中，不占布局、不遮挡内容。
 *
 * 用 `role="alert"` 让读屏软件也能播报；深底沿用顶栏配色，与浅色主区分层。
 */
export function NavErrorBanner({
  failure,
  onRetry,
  onDismiss,
}: {
  failure: NavFailure | null
  onRetry: () => void
  onDismiss: () => void
}) {
  if (!failure) return null

  return (
    <div
      role="alert"
      className="fixed left-1/2 -translate-x-1/2 top-[56px] z-50 flex items-center gap-2.5 px-3 py-2 text-12 text-head-txt shadow-[0_6px_20px_rgba(0,0,0,0.28)]"
      style={{ background: '#1c2130', borderRadius: 'var(--radius-sm)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-up flex-none" aria-hidden />
      <span>
        <b className="font-semibold">「{failure.label}」</b>加载失败 · 网络抖动或版本已更新
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="px-2 py-0.5 rounded-[3px] bg-white/15 text-white text-12 border-0 cursor-pointer hover:bg-white/25"
      >
        重试
      </button>
      {/*
        「刷新」是最后一道出口：模块图彻底失效时（换版 / 依赖重构建），
        重取同一个 URL 一定还是失败，只有重新拿 HTML 才能恢复。
        60 秒内的自动自愈已经用过一次，这里给用户一个手动兜底。
      */}
      <button
        type="button"
        onClick={() => globalThis.location.reload()}
        className="px-2 py-0.5 rounded-[3px] bg-white/15 text-white text-12 border-0 cursor-pointer hover:bg-white/25"
      >
        刷新
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭提示"
        className="px-1 text-head-soft text-13 leading-none bg-transparent border-0 cursor-pointer hover:text-white"
      >
        ×
      </button>
    </div>
  )
}
