import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/api'
import { APP_CONFIG } from '@/shared/config'
import { inTrading } from '@/shared/lib'

/**
 * 行情数据源的 Query 定义 —— **服务端状态的唯一真源**。
 *
 * ## 为什么用 TanStack Query 而不是手写轮询
 *
 * 手写 `setInterval + fetch + setState` 需要自己解决：请求去重（两个组件同时挂载
 * 会发两次请求）、缓存、竞态（旧响应覆盖新响应）、后台标签页暂停、错误重试、
 * 卸载后 setState 警告。这些都是**已被解决过无数次的问题**，不该再写一遍。
 *
 * ## 三个设计要点
 *
 * 1. `queryKey` 用 `['域', '资源']` 分层 —— 失效时可按前缀批量失效
 *    （`queryClient.invalidateQueries({ queryKey: ['market'] })`）。
 * 2. `refetchInterval` 传**函数**：每次调度重新求值，跨交易时段自动切节拍。
 * 3. 后台标签页默认不轮询（`refetchIntervalInBackground` 默认 false）——
 *    盯盘页挂在后台时不会白白耗流量。
 */

/** 轮询节拍：盘中 30s / 非盘中 3min（与原系统脚本内按时段定节拍一致） */
const pollMs = () => (inTrading() ? APP_CONFIG.pollIntradayMs : APP_CONFIG.pollOfflineMs)

export const marketQueries = {
  /** 主快照（实时） */
  latest: () =>
    queryOptions({
      queryKey: ['market', 'latest'] as const,
      queryFn: api.latest,
      refetchInterval: pollMs,
      staleTime: 20_000,
    }),

  /** 上一版快照（环比对比） */
  prev: () =>
    queryOptions({
      queryKey: ['market', 'prev'] as const,
      queryFn: api.prev,
      refetchInterval: pollMs,
      staleTime: 20_000,
    }),

  /** 竞价实时报价 */
  auction: () =>
    queryOptions({
      queryKey: ['market', 'auction'] as const,
      queryFn: api.auction,
      refetchInterval: pollMs,
      staleTime: 20_000,
    }),

  /** 短线精灵信号 */
  signals: () =>
    queryOptions({
      queryKey: ['market', 'signals'] as const,
      queryFn: api.signals,
      refetchInterval: pollMs,
      staleTime: 20_000,
    }),

  /** 昨日涨停反馈矩阵 */
  feedback: () =>
    queryOptions({
      queryKey: ['market', 'feedback'] as const,
      queryFn: api.feedback,
      refetchInterval: pollMs,
      staleTime: 20_000,
    }),

  /** 候选池 */
  candidates: () =>
    queryOptions({
      queryKey: ['market', 'candidates'] as const,
      queryFn: api.candidates,
      refetchInterval: pollMs,
      staleTime: 20_000,
    }),

  /** 题材轮动 / 回流 / 5日资金（变化慢，节拍与行情一致但 staleTime 放宽） */
  rotation: () =>
    queryOptions({
      queryKey: ['theme', 'rotation'] as const,
      queryFn: api.rotation,
      refetchInterval: pollMs,
      staleTime: 60_000,
    }),

  /** 题材多日序列（日频） */
  series: () =>
    queryOptions({
      queryKey: ['theme', 'series'] as const,
      queryFn: api.series,
      staleTime: 300_000,
    }),

  /** 题材序列（当日题材词表 · 日频） */
  sequence: () =>
    queryOptions({
      queryKey: ['theme', 'sequence'] as const,
      queryFn: api.sequence,
      staleTime: 300_000,
    }),

  /** 数据新鲜度体检 */
  health: () =>
    queryOptions({
      queryKey: ['health'] as const,
      queryFn: api.health,
      refetchInterval: 60_000,
    }),
} as const
