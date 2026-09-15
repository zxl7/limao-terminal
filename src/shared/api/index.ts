/**
 * 数据接入层 —— **唯一公开出口**。
 *
 * ⚠️ 分层铁律：上层（features / pages / app）只允许 `from '@/shared/api'`，
 *    禁止 `from '@/shared/api/client'` 这类深路径导入。
 *
 *    理由：barrel 是**契约边界**。只要公开接口不变，内部怎么改（换传输实现、
 *    加内存缓存、把 JSON 换成 SSE）都不会波及上层。没有 barrel 的「分层」
 *    只是文件夹分类，改一个内部文件路径就会引发全项目 import 雪崩。
 */

// 取数入口（唯一）
export { api, fetchRoute, type ApiRoute, type RouteTypeMap } from './endpoints'

// 服务端状态基础设施
export { queryClient } from './queryClient'

// 错误与诊断
export {
  DataUnavailableError,
  contractIssues,
  // 契约状态订阅（React 侧经 useSyncExternalStore 消费）
  subscribeContractIssues,
  getContractVersion,
  type ContractIssue,
} from './client'

// 契约守卫
export { SCHEMAS, type GuardedRoute } from './schemas'

// 后端路由真源（前端只读；vite 中间件与 serve.py 共享）
export { ROUTES, FILE_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV, type RouteDef } from './routes'

// 全部数据契约类型
export type * from './types'
