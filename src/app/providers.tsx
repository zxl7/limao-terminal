import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'

/**
 * 全局 Provider 装配 —— **app 层的核心职责**。
 *
 * 这里是唯一「允许知道所有基础设施」的地方。新增 Provider（主题、i18n、
 * 错误上报）都在此叠加，业务组件完全无感。
 *
 * 顺序有讲究：QueryClientProvider 必须在 RouterProvider 外层，
 * 否则路由 loader 取不到同一个 client（会导致缓存分裂成两份）。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
