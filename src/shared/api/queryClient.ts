import { QueryClient } from '@tanstack/react-query'
import { APP_CONFIG } from '../config/env'

/**
 * 全局 QueryClient —— 服务端状态的基础设施。
 *
 * 放在 `shared` 层而非 `app`：**页面级的路由 loader 需要它**，
 * 而 pages 不允许 import app 层（分层铁律）。基础设施放 shared 是唯一自洽的位置。
 *
 * ## 默认策略的取舍
 *
 * - `retry: 1` —— 数据源是本机文件/内网 API，失败通常是「文件还没生成」，
 *   重试 3 次只是在浪费轮询窗口。1 次足够。
 * - `refetchOnWindowFocus: false` —— 默认开启会让「切回标签页」触发一轮全量请求，
 *   与本项目的固定轮询节拍叠加造成突发流量。轮询已保证新鲜度，关掉更可控。
 * - `gcTime: 5min` —— 离开页面 5 分钟内回来仍命中缓存，切 Tab 不闪白。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      gcTime: 5 * 60_000,
      staleTime: APP_CONFIG.pollIntradayMs / 2,
    },
  },
})
