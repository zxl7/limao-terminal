import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AppProviders } from './app/providers'
import { router } from './app/router'

// 样式加载顺序有硬约束：
//   1. theme.css  —— @import "tailwindcss" + @theme 令牌（必须最先，它会建立 @layer 体系）
//   2. base.css   —— reset 与全局排版（覆盖 Tailwind preflight 中需要调整的部分）
//   3. skyroc UI  —— 组件库样式（放最后，避免其组件样式被通用工具类意外压制）
import './styles/theme.css'
import './styles/base.css'
import '@skyroc/web-ui/style.css'

/**
 * 应用入口 —— 只做三件事：挂载、套 Provider、接路由。
 *
 * ⚠️ `StrictMode` 在开发环境会**故意双调用** effect 与 reducer，
 *    用来暴露「没写清理函数」的副作用。如果某个 hook 在开发期看起来
 *    「请求发了两次」，先确认它的 cleanup 是否正确，不要直接关掉 StrictMode。
 */
const container = document.getElementById('root')
if (!container) throw new Error('找不到挂载点 #root')

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
