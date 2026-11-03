import { cn } from '@/shared/lib'

/**
 * 空态占位。
 *
 * ⚠️ **数据缺失是可预期状态，不是错误**：盘前大量字段为 null，
 *    组件必须能优雅表达「这里暂时没数据」，而不是抛错或渲染 undefined。
 *    这与原系统（狸猫猎手）的空态降级哲学一致。
 */
export function EmptyState({
  text = '暂无数据',
  hint,
  className,
}: {
  text?: string
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('text-center text-sub text-xs py-4', className)}>
      <div>{text}</div>
      {hint && <div className="text-11 mt-1 opacity-70">{hint}</div>}
    </div>
  )
}

/** 未迁移页占位 —— 标明它在原系统里的渲染函数，使「页面 → 原实现」对应关系不靠记忆 */
export function StagePlaceholder({
  title,
  source,
  routes,
  note,
}: {
  title: string
  source: string
  routes?: string[]
  note?: string
}) {
  return (
    <div className="max-w-[560px] mx-auto mt-16 panel text-center">
      <h3 className="text-15 font-semibold text-txt">{title}</h3>
      <p className="txt-sub mt-2">
        待迁移 · 原系统实现 <code className="bg-line px-1.5 py-0.5 rounded-sm text-12">{source}</code>
      </p>

      {routes && routes.length > 0 && (
        <div className="mt-4 text-left border border-line rounded p-2.5">
          <div className="txt-sub mb-1.5">数据源（后端已就绪）</div>
          {routes.map((r) => (
            <div key={r} className="num text-11 text-sub leading-relaxed">
              {r}
            </div>
          ))}
        </div>
      )}

      {note && <p className="txt-sub mt-3">{note}</p>}
    </div>
  )
}
