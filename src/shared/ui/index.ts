/**
 * 通用 UI —— 无业务语义的展示组件。
 *
 * 判断标准：如果这个组件换个业务域还能用，它属于 shared/ui；
 * 如果它只对「行情」有意义（如连板天梯卡），它属于 features/market/components。
 */
export { Card, CardBadge } from './Card'
export { EmptyState, StagePlaceholder } from './EmptyState'
export { Board, BoardItem, BoardWide, Zone, ZoneRow } from './Board'
export { Kpi, KpiStrip } from './Kpi'
export { TONE_BG_SOFT, TONE_CLASS, toneClass, toneSoft, type ToneToken } from './tone'

/** 图表库（零依赖 SVG/HTML）—— 纯展示原语，不含任何业务语义 */
export * from './charts'
/** 图标集（零依赖内联 SVG） */
export { Icon, type IconName } from './Icon'
export { StockLink, xueqiuStockUrl } from './StockLink'
export { VirtualList, useMeasuredHeight, useViewportFill, useVirtualRows, windowRange } from './VirtualList'
