import { useSyncExternalStore } from 'react'
import { contractIssues, getContractVersion, subscribeContractIssues } from '@/shared/api'

/**
 * 读取当前的数据契约异常。
 *
 * React 消费外部可变状态的**正确方式**是 `useSyncExternalStore` ——
 * 它保证并发渲染下不会读到撕裂的中间状态（自己写 useState + useEffect 订阅会）。
 *
 * 返回的 Map 引用不变，但版本号变化会触发重渲染，因此调用方总能读到最新内容。
 */
export function useContractIssues(): ReadonlyMap<string, { path: string; message: string }[]> {
  useSyncExternalStore(subscribeContractIssues, getContractVersion, () => 0)
  return contractIssues
}

/** 契约异常的路由数量（0 = 全部符合契约） */
export function useContractIssueCount(): number {
  return useContractIssues().size
}
