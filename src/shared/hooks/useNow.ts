import { useEffect, useState } from 'react'

/**
 * 响应式时钟。
 *
 * React 里没有 VueUse 那种现成的 `useNow`，这里手写一个 ——
 * 关键是**清理函数必须存在**，否则组件卸载后定时器继续跑（经典内存泄漏）。
 *
 * @param intervalMs 刷新间隔
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
