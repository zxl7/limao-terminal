import { isRouteErrorResponse, useRouteError } from 'react-router'

/**
 * 根级错误边界 —— React Router 的 `errorElement`。
 *
 * ⚠️ 这是「分层架构」里容易漏掉的一层：**错误处理也是架构的一部分**。
 *    没有 errorElement 时，任何 loader/渲染异常都会让整个应用白屏，
 *    而盘中白屏意味着错过信号。
 *
 * 分工：
 *   · 根级（本组件）—— 兜住致命错误，保证还能导航到其他页
 *   · 数据层        —— `DataUnavailableError` 由 useQuery 的 error 状态在卡片内表达
 *   · 契约层        —— 结构异常由 `contractIssues` 记录并在顶栏提示，不中断渲染
 */
export function RootError() {
  const error = useRouteError()

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : '页面渲染出错'

  const detail =
    isRouteErrorResponse(error)
      ? typeof error.data === 'string'
        ? error.data
        : JSON.stringify(error.data, null, 2)
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error)

  return (
    <div className="max-w-[640px] mx-auto mt-20 panel">
      <h1 className="text-15 font-semibold text-txt m-0">{title}</h1>
      <p className="txt-sub mt-2">应用遇到了未预期的错误。其他页面仍可正常访问。</p>

      <pre className="mt-4 p-3 bg-line-faint border border-line rounded text-11 overflow-auto max-h-[320px] whitespace-pre-wrap">
        {detail}
      </pre>

      <a href="/" className="inline-block mt-4 text-13 text-rec no-underline">
        ← 返回盘中实时
      </a>
    </div>
  )
}
