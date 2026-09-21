/**
 * 分析业务域 —— **公开出口**。
 *
 * 承载「原系统已落盘、但原 dashboard 从未展示」的全部维度：
 * 情绪周期 / 板块核心 / 连板晋级 / 股性基因 / 龙虎榜 / AI 台账 / 净值战绩 /
 * 机构投研 / 题材史 / 载体追踪 / 风险面 / 回测 / 卡片存档 / 脉冲与审计。
 *
 * ⚠️ 分层铁律：pages / app 只允许从这里 import，不得深入 `./api/xxx`。
 *    域内重构（改 query 键、拆表组件）不应波及页面层。
 */

// 数据查询（页面 loader 预取 + 组件订阅）
export { analyticsQueries } from './api/queries'

// 展示原语（分析域通用表格与指标行）
export { DataTable, StatPair, Tag, SegTabs, type Column } from './components/Table'

// 时间轴分钟槽卡片（固定宽卡 + 固定 CSS grid · 与 React 无关，可单测）
export {
  TimelineSlotCard,
  TimelineLinkageCard,
  TimelineMergedCard,
  SLOT_WIDTH,
  SLOT_HEIGHT,
  SLOT_GAP,
} from './components/TimelineSlotCard'

// 飞书卡片存档阅读器（复盘/盘前/机构/脉冲卡共用）
export { CardArchiveView, cardDate, type ArchiveCard } from './components/CardArchiveView'

// 财富密码每日决策档案（`wealth_code_candidates_v1`）
export { DossierView } from './components/DossierView'

// 自动化任务台账解析（`config/tasks.yaml` 原文 → 条目 · 只解析所需子集）
export { parseTaskLedger } from './lib/task-ledger'

// 日内时间轴的纯计算内核（板块聚类 + 严格时序 · 与 React 无关，可单测）
export {
  buildTimeline,
  buildTimelineSlots,
  buildLimitSeries,
  BURST_MIN_STOCKS,
  BURST_WINDOW_MIN,
  clockMin,
  cumulativeByMarks,
  fbtMin,
  groupTimelineSlots,
  LINKAGE_MIN_SECTORS,
  MARK_LABELS,
  MARKS,
  minToClock,
  pickLiveBasis,
  SHAPE_META,
  SLOT_VISIBLE_SECTORS,
  sortIntradaySectorEvents,
  sortSlotSectors,
  timelineNodeKey,
  type EventNode,
  type PushNode,
  type SectorNode,
  type SectorShape,
  type SingleNode,
  type TimelineBlock,
  type TimelineNode,
  type TimelineSlot,
  type TimelineSlotSector,
  type LimitSeriesResult,
} from './lib/timeline'

// 题材级爆发内核（解析原系统 event_log 的题材结论 · 纯函数，可单测）
export {
  buildThemeBursts,
  isLowStrengthSlot,
  normName,
  normTheme,
  parseThemeEvents,
  sameTheme,
  slotThemeMarks,
  type SlotThemeMarks,
  type StockThemeTag,
  type ThemeBurst,
  type ThemeBurstResult,
  type ThemeEvent,
  type ThemeEventKind,
  type ThemeRisk,
} from './lib/theme-burst'

// 数值格式化（null 一律渲染为「—」；二元区间必须走 range，禁止直接渲染数组）
export {
  n1,
  n2,
  pct,
  rate,
  range,
  rangePct,
  rangeLow,
  tone,
  better,
  boardsLabel,
  fmtFbt,
  fileDate,
} from './lib/format'

// 蛇形时间轴布局内核（纯函数：轴坐标换算 + 穿行分行 + SVG 路径 · 与 React 无关，可单测）
export {
  axisOf,
  clockOfAxis,
  layoutSnake,
  snakePos,
  SEAM_AXIS,
  SESSION_AM_END,
  SESSION_CLOSE,
  SESSION_OPEN,
  SESSION_PM_START,
  SESSION_TOTAL_MIN,
  SNAKE_BAR_MAX_H,
  SNAKE_BAR_W,
  SNAKE_MAX_ROWS,
  SNAKE_MIN_GAP,
  SNAKE_MIN_ROWS,
  SNAKE_NODE_W,
  SNAKE_PAD_X,
  SNAKE_PAD_Y,
  SNAKE_ROW_HEIGHT,
  type SnakeLane,
  type SnakeLayout,
  type SnakePoint,
} from './lib/snake'

// 分块摘要（hover 浮层用 · 纯函数：全部走既有排序内核，列表有界但总数单列）
export { summarizeBlock, SUMMARY_CAP, type BlockSummary } from './lib/block-summary'

// 蛇形时间轴（一条线横走→弯→反向 · hover 浮层 + 点击详情）
export { TimelineSnake } from './components/TimelineSnake'

// 盘中情绪走势（涨停 / 炸板率两条实时曲线 · 30s 轮询）
export { IntradayMoodCard } from './components/IntradayMoodCard'

// 事件原文分段（纯函数 · 无损：拼接恒等于原文 · 供卡片高亮题材/个股）
export {
  emotionState,
  eventTier,
  severityNote,
  splitEventText,
  splitEventTextKeyed,
  type EventSeg,
  type EventSegKind,
  type EventTier,
} from './lib/event-text'
