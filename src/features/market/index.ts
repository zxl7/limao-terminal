/**
 * 行情业务域 —— **公开出口**。
 *
 * ⚠️ 分层铁律：pages / app 只允许从这里 import，不得深入 `./components/xxx`。
 *
 *    好处：域内重构（拆组件、换 state 库、调 query 键）不会波及页面层。
 *    一个 feature 的「对外契约」应当小到一眼看完 —— 就是下面这几行。
 */

// 数据查询（页面级预取用）
export { marketQueries } from './api/queries'

// 展示组件
export { EbbBanner } from './components/EbbBanner'
export { FeedbackCard } from './components/FeedbackCard'
export { LadderCard } from './components/LadderCard'
export { LeadersCard } from './components/LeadersCard'
export { SignalsCard } from './components/SignalsCard'
export { SignalRail } from './components/SignalRail'
export { ThemeTopCard } from './components/ThemeTopCard'
export { AmbushCard } from './components/AmbushCard'
export { SectorFlowCard } from './components/SectorFlowCard'
export { SectorDeltaCard } from './components/SectorDeltaCard'
export { ExpectCard } from './components/ExpectCard'
export { ExtremeCard } from './components/ExtremeCard'
export { TideCard } from './components/TideCard'
export { TideAlgorithmStrip } from './components/TideAlgorithmStrip'

// 情绪周期之潮汐算法（候选链路环境门控的终端唯一映射）
export { buildTideState, type TidePhase, type TideRegime, type TideState, type TideWindowDay } from './lib/tide'

// 域内标签工具（页面组装时可能用到）
export {
  ebbTone,
  defenseTone,
  pctTone,
  sentimentLabelTone,
  type Tone,
} from './model/labels'
