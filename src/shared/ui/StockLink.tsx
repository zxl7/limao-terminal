import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'

/** 将终端各数据源的代码格式统一为雪球市场前缀。非 A 股六位代码返回 null。 */
export function xueqiuStockUrl(code: string | null | undefined): string | null {
  const raw = String(code ?? '').trim().toUpperCase()
  const matched = raw.match(/^(\d{6})(?:[.](SH|SS|SZ|BJ))?$/)
  if (!matched) return null
  const [, symbol, suffix] = matched
  const market = suffix === 'SS' ? 'SH' : suffix ?? (symbol.startsWith('6') || symbol.startsWith('5') || symbol.startsWith('9') ? 'SH' : symbol.startsWith('4') || symbol.startsWith('8') ? 'BJ' : 'SZ')
  return `https://www.xueqiu.com/S/${market}${symbol}`
}

/** 股票代码的统一外链。未识别为 A 股时退化为原文本，避免把板块/指数编号误链。 */
export function StockLink({ code, children, className }: { code: string | null | undefined; children?: ReactNode; className?: string }) {
  const href = xueqiuStockUrl(code)
  const label = children ?? code ?? '—'
  if (!href) return <>{label}</>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`在雪球查看 ${code} 详情`}
      className={cn('hover:text-rec hover:underline underline-offset-2', className)}
    >
      {label}
    </a>
  )
}
