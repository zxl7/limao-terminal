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

// 飞书卡片存档阅读器（复盘/盘前/机构/脉冲卡共用）
export { CardArchiveView, cardDate, type ArchiveCard } from './components/CardArchiveView'

// 财富密码每日决策档案（`wealth_code_candidates_v1`）
export { DossierView } from './components/DossierView'

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
