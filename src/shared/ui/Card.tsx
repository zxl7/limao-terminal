import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'

interface CardProps {
  /** 卡片标题（可选） */
  title?: ReactNode
  /** 标题右侧附加内容（徽标、计数等） */
  extra?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * 标准卡片容器 —— 全站唯一的面板样式来源。
 *
 * 组件化而非「到处写 div + class」：面板的边框/圆角/内距一旦要调，只改这里。
 */
export function Card({ title, extra, className, children }: CardProps) {
  return (
    <section className={cn('panel', className)}>
      {title !== undefined && (
        <div className="panel-title">
          <span>{title}</span>
          {extra}
        </div>
      )}
      {children}
    </section>
  )
}

/** 卡片标题右侧的计数/状态徽标 */
export function CardBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'up' | 'down' | 'warn' | 'rec'
}) {
  const toneClass = {
    neutral: 'text-sub border-line',
    up: 'text-up border-up',
    down: 'text-down border-down',
    warn: 'text-warn border-warn',
    rec: 'text-rec border-rec',
  }[tone]

  return <span className={cn('badge border', toneClass)}>{children}</span>
}
