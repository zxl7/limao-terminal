/**
 * 数据契约 —— 原系统（狸猫猎手）落盘 JSON 的 TypeScript 映射。
 *
 * ⚠️ 这些接口是**对现有结构的描述，不是设计**。原系统已冻结不做改造，
 *    因此当原系统字段变化时，本文件是唯一需要同步的地方 —— 编译期即暴露。
 *
 * 每个接口的字段均来自对真实落盘文件的实测（2026-09-15 样本），
 * 可选标记 `?` / `| null` 反映真实可空性，不做乐观假设。
 */

// ════════════════════════════════════════════════════════════════
// 通用
// ════════════════════════════════════════════════════════════════

export interface ParticipationQuotes {
  date: string
  ts: string
  call_available: boolean
  quotes: Record<string, { pct: number; ts: string; source: string }>
  missing: string[]
}

/** 数据不可用（文件缺失/解析失败）—— 原系统大量空态降级依赖此语义 */
export interface ApiError {
  error: 'data_unavailable'
  route: string
  target?: string
  desc?: string
  message?: string
}

/** 数据底座受限查询的非法参数响应（仅代码与条数校验失败）。 */
export interface ApiRequestError {
  error: 'invalid_request'
  route?: string
  message: string
}

/** 盘中封单峰值档案：只记录观察事实，不表达任何交易结论。 */
export interface ExitPeakStock {
  name: string
  current_seal_yi: number | null
  current_sealed: boolean
  current_observed_at: string | null
  quote_at: string | null
  seal_yi_peak?: number
  seal_yi_peak_at?: string
}

export interface ExitPeakSector {
  current_zt_count: number | null
  zt_count_peak?: number
  zt_count_peak_at?: string
}

export interface ExitPeaksFile {
  schema: string
  date: string
  updated_at: string
  stock_scope?: string
  sector_scope?: string
  stocks: Record<string, ExitPeakStock>
  sectors: Record<string, ExitPeakSector>
}

/** 一个交易日冻结的题材映射。历史解释只能使用同交易日的这份档案。 */
export interface ThemeSnapshotItem {
  name?: string
  theme?: string
  logic?: string
  plates?: string[]
  desc?: string
}

export interface ThemeSnapshotFile {
  schema: string
  date: string
  mapping: Record<string, ThemeSnapshotItem>
}

/** 每日Top5题材原始归档（非派生趋势结论）。 */
export interface Top5HistoryTheme {
  name: string
  zt_count?: number | null
  leader?: string | null
  leader_code?: string | null
  [key: string]: unknown
}

export interface Top5HistoryFile {
  date: string
  source?: string
  archived_at?: string
  themes: Top5HistoryTheme[]
}

/** 全市场近月日K的受限单票查询返回。价格为原始未复权OHLCV。 */
export interface MarketDailyBar {
  code: string
  thscode: string | null
  trade_date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  amount: number | null
  currency: string | null
  source: string | null
  ingested_at: string | null
}

export interface RsiEvidence {
  schema: 'rsi_evidence_v1'
  code: string
  asof: string
  bar_date: string | null
  method: 'wilder'
  adjustment: 'none'
  sample_count: number
  dates: string[]
  quality: string
  readings: Record<string, { period: number; value: number | null; previous: number | null; change: number | null; status: string; series: Array<number | null> }>
  warnings: string[]
}

export interface MarketDailyResponse {
  rsi_evidence?: RsiEvidence
  code: string
  limit: number
  bars: MarketDailyBar[]
}

/** 系统已经实际观测到的单票事实；未命中不等于该票不存在或未发生异动。 */
export interface StockRegistryTechnical {
  bar_date: string | null
  source: string | null
  status: string | null
  close: number | null
  high: number | null
  low: number | null
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ret_3d: number | null
  ret_5d: number | null
  ret_10d: number | null
  high_20d: number | null
  high_60d: number | null
  new_high_20d: number | null
  new_high_60d: number | null
  ma_bullish: number | null
  volume_ratio_5: number | null
  data_quality: string[] | null
}

export interface StockRegistryProfile {
  code: string
  name: string | null
  market: string | null
  is_20cm: number | boolean | null
  industry: string | null
  themes: string[]
  is_limit_up_today: number | null
  is_limit_up_basis: string | null
  limit_up_now: number | null
  limit_up_touched: number | null
  limit_up_close: number | null
  boards: number | null
  pct: number | null
  price: number | null
  daily_asof_date: string | null
  daily_is_latest_trading_day: boolean
  first_seen_date: string | null
  last_seen_ts: string | null
  source: string | null
  data_quality_flags: string[]
  technical: StockRegistryTechnical | null
}

export interface StockRegistryResponse {
  code: string
  found: boolean
  stock: StockRegistryProfile | null
}

/** 计数 + 名单（跌停/炸板共用） */
export interface CountNames {
  count: number
  names: string[]
  /**
   * 明细（含跌幅）。**仅当上游能给出涨跌幅时才存在**。
   *
   * ⚠️ 2026-10-31 起生产端（`intraday_pulse.parse_pool`）开始透传 `items`；
   * 更早的快照只有 `names`。所以**消费方必须两者都能渲染**：
   * 有 items 就上跌幅，没有就退回纯名单，⛔ 不得用 0 或推算值补位。
   */
  items?: PoolNameItem[]
}

/**
 * 本轮完整涨停名单（`intraday_pulse.build_limit_up_stocks` 落盘）。
 *
 * 为什么要暴露它：题材卡里同一批票要**按首封时间排序**（2026-10-31 用户口径），
 * 而 `top5[].zt_stocks` 只有名字与涨幅、没有时间。`fbt` 是首封时间的唯一盘中实时来源
 * （盘后归档走 `zt_pool`，两者同口径）。
 */
export interface LimitUpStock {
  code: string
  name: string
  pct?: number | null
  /** 连板文案，如 `3天3板` */
  boards?: string | null
  /** 所属题材（上游用「、」拼接） */
  sector?: string | null
  /**
   * 首封时间 `HH:MM`。
   * ⚠️ 2026-10-31 前落盘的快照**没有该字段**（当时只写 code/name/pct/boards/sector），
   * 故必须 optional；缺失时前端退回「盘后归档 zt_pool」或排到最后。
   */
  fbt?: string | null
}

/** 跌停/炸板池里的单只票 —— `pct` 缺失表示上游没给，不是 0 */
export interface PoolNameItem {
  code?: string
  name: string
  pct?: number | null
}

// ════════════════════════════════════════════════════════════════
// /api/market/latest  &  /api/market/prev   —— MarketSnapshot
// ════════════════════════════════════════════════════════════════

export interface SentimentDetail {
  label: string
  score: number | null
  source?: string
  status?: string
  model?: string | null
  source_at?: string
  quality?: string | null
  inputs_missing?: string[]
  /** 封板率（%） */
  seal_rate: number
}

export interface IndexQuote {
  name: string
  pct: number
  price: number
  /** 成交额（亿元）· 仅 prev 快照携带 */
  amount_yi?: number
}

/**
 * 弱板块聚焦命中（`latest.weak_sectors.focus_hits` 元素）。
 *
 * ⚠️ 2026-10-14 修正：本字段**曾是 `string[]`**（旧类型声明），但生产侧
 *    `scripts/intraday_pulse.py:622` 实际写的是对象
 *    `{"sector": ..., "ld": [...], "broken": [...], "total": N}`（四个键恒存在），
 *    后端自用方 `wealth_code/pipelines/build_cards.py:964-967` 也按 dict 读取。
 *    旧声明只存在于前端类型/schema，导致契约守卫长期打印
 *    `focus_hits.0: expected string, received object`（不阻断但噪声）。
 */
export interface WeakSectorFocusHit {
  /** 板块名（如「锂电池」） */
  sector: string
  /** 该板块内跌停股名 */
  ld: string[]
  /** 该板块内炸板股名 */
  broken: string[]
  /** 命中数 = ld + broken 长度（生产侧据此降序排序） */
  total: number
}

export interface WeakSectors {
  focus_hits: WeakSectorFocusHit[]
  ld_count: number
  broken_count: number
  ld_names: string[]
  broken_names: string[]
}

/**
 * 板块资金流（轻量版 · latest.sector_risk 内）。
 *
 * ⚠️ `main_inflow` 在实测中**两种形态都出现过**：早先的脚本写字符串（带单位文案），
 *    当前脚本写原始数字（如 -382685064）。故类型为联合 —— 不要假设单一形态，
 *    渲染时必须走 `String()` / 数值判空，不能直接做数值运算。
 *
 * ⚠️ 同一数组内**字段并不齐**：`declining` 只有 name/pct/main_inflow/is_focus；
 *    而 `inflow_top` / `outflow_top` 额外带 `flow_yi`（主力净额亿元）与四档资金
 *    拆解。故额外字段一律标可选 —— 按必填写会在渲染 `declining` 时拿到 undefined。
 */
export interface SectorFlowLite {
  name: string
  pct: number
  main_inflow: string | number
  is_focus: boolean
  /** 东财板块代码（仅 inflow_top / outflow_top 携带） */
  code?: string
  /** 主力净额（亿元）· 已由脚本换算 */
  flow_yi?: number
  /** 四档资金拆解（亿元）· 仅 inflow_top / outflow_top 携带 */
  super_large_yi?: number
  large_yi?: number
  mid_yi?: number
  small_yi?: number
  /** 资金数据源时间戳（秒） */
  source_ts?: number
}

export interface SectorRiskSourceState {
  ok?: boolean | null
  complete?: boolean | null
  stale?: boolean | null
  status?: string | null
  asof?: string | null
  error?: string | null
  reference_only?: boolean | null
  age_seconds?: number | null
}

export interface SectorRiskState extends SectorRiskSourceState {
  sources?: {
    breadth?: SectorRiskSourceState | null
    flow?: SectorRiskSourceState | null
  } | null
}

export interface SectorRisk extends SectorRiskState {
  /** 弱势板块判定阈值（如 -2.5） */
  threshold: number
  declining: SectorFlowLite[]
  focus_declining: SectorFlowLite[]
  count: number | null
  inflow_top: SectorFlowLite[]
  outflow_top: SectorFlowLite[]
}

/** 连板天梯：一组同板数的股票（⚠️ 仅股票名，非对象） */
export interface LadderGroup {
  boards: number
  stocks: string[]
}

export interface Newsflash {
  title: string
  plates: string[]
  stocks: string[]
}

export interface EmExpectStock {
  code: string
  name: string
  pct: number
  cap_yi: number
  /** 是否龙头 */
  dragon: boolean
}

export interface EmExpect {
  name: string
  themeCode: string
  pct: number
  zt: number
  cum_pct: number
  title: string
  stocks: EmExpectStock[]
}

/** 爆发前夜 · 关注标的 */
export interface EarlyBuy {
  name: string
  code: string
  pct: number
  /** ⚠️ 实测 buy 内还带 price / is_20cm / limit_up_days，非仅 name+code+pct */
  price?: number
  is_20cm?: boolean
  limit_up_days?: number
}

/**
 * 爆发前夜 · 池内成员。
 *
 * ⚠️ **实测是对象数组**（`{name, pct}`），不是字符串数组 ——
 *    早期类型写的 `string[]` 是错的，直接渲染会抛
 *    「Objects are not valid as a React child」。
 */
export interface EarlyMember {
  name: string
  pct: number
}

export interface EarlyItem {
  type: string
  sector: string
  desc: string
  buy: EarlyBuy
  count: number
  zt_in_sector: number
  members: EarlyMember[]
}

/** 辨识度标的 / 可买个股 */
export interface Leader {
  sector: string
  name: string
  code: string
  pct: number
  price: number
  buyable: boolean
  is_20cm: boolean
  /** 连板文案（如 "4天4板"），可为空串 */
  boards: string
  limit_up_days: number
}

/** 退潮/情绪转弱信号 */
export interface EbbInfo {
  risk_scope?: 'market' | 'relay' | 'mixed'
  risk_level?: 'weak' | 'warning'
  market_effect?: 'strong' | 'positive' | 'neutral' | 'weak' | 'unknown'
  severity: string
  signals: string[]
  max_board: number
  total_zt: number
  sentiment_score: number | null
  sentiment_label: string
}

export interface ThemeLeaderDetail {
  name: string
  code: string
  pct: number
  price: number
  /** 连板文案（如 "4天4板"） */
  boards: string
  turn: number
  cap_yi: number
  desc: string
  /** 封板质量（如 "🔥 秒封板"） */
  seal: string
}

export interface ThemeFollower {
  name: string
  pct: number
  turn: number
}

export interface ThemeZtStock {
  name: string
  code: string
  pct: number
}

/**
 * 主线题材 Top。
 *
 * ⚠️ `delta` 是**状态枚举字符串**（实测取值 `'new'` / `'ongoing'`），
 *    **不是**涨停数环比数字。要算环比请用 `zt_count - zt_prev`。
 *    早期把它当 number 会导致 `delta > 0` 恒为 false —— 题材永远被渲染成「持平」。
 *
 * ⚠️ 实测 `leader` 与 `zt_prev` **都可能为 null**：盘面早段（或题材刚建立）
 *    top5 会有占位条目，除 name/zt_count 外全为空。渲染必须判空。
 */
export interface ThemeTop {
  rank: number
  name: string
  desc: string
  zt_count: number
  turn_avg: number
  total_stocks: number
  leader: ThemeLeaderDetail | null
  followers: ThemeFollower[]
  zt_stocks: ThemeZtStock[]
  diffusion: string
  risks: string[]
  positives: string[]
  /** 题材状态：'new' 新晋 / 'ongoing' 持续 —— 非数字 */
  delta: string
  /** 前一交易日该题材涨停数（环比基数）· 早段可能为 null */
  zt_prev: number | null
}

export interface DataScope {
  breadth: string
  amount: string
  asof: string
}

/** 题材增减（新增/升温/持续） */
export interface SectorDelta {
  new: string[]
  surging: string[]
  ongoing: string[]
}

/** 盘中异动题材（来自 latest.hot_spots）：结构为 {sector, stocks[]}，非 ThemeTop */
export interface HotSpotStock {
  name: string
  code: string
  pct: number
  price: number
  buyable: boolean
  is_20cm: boolean
  /** 连板文案（如 "4天4板"），可为空串 */
  boards: string
}
export interface HotSpot {
  sector: string
  stocks: HotSpotStock[]
}

/** 主快照（latest.json / prev.json 结构一致；盘中早段部分字段为 null） */
export interface MarketSnapshot {
  ts: string
  total_zt: number
  sentiment: string
  sentiment_detail: SentimentDetail
  index: IndexQuote[]
  limit_down: CountNames
  broken: CountNames
  /** 本轮完整涨停名单（含首封时间）· 早段可能不给 */
  limit_up_stocks?: LimitUpStock[] | null
  weak_sectors: WeakSectors
  sector_risk: SectorRisk
  ladder: LadderGroup[]
  newsflash: Newsflash[]
  em_expect: EmExpect[]
  early: EarlyItem[]
  leaders: Leader[]
  rising: unknown[]
  hot_spots: HotSpot[]
  /** 两市成交额（亿元）· 盘前/早段可能为 null */
  market: number | null
  breadth: { up: number | null; down: number | null; flat: number | null }
  data_scope: DataScope
  /**
   * 退潮/情绪转弱检测。
   *
   * ⚠️ **可能为 null**（脚本 `detect_ebb` 在加权总分 < 3 时 `return None`），
   *    即「无预警」是一个合法的正常态，不是数据缺失。渲染必须判空。
   */
  ebb: EbbInfo | null
  top5: ThemeTop[]
  sector_delta: SectorDelta
}

// ════════════════════════════════════════════════════════════════
// /api/market/auction   —— 竞价实时报价
// ════════════════════════════════════════════════════════════════

export interface AuctionLive {
  /** 形如 "09:29:14" */
  ts: string
  /** 股票代码(6位) → 竞价涨幅%；无可用报价时保留 null，不得伪造为 0 */
  quotes: Record<string, number | null>
}

// ════════════════════════════════════════════════════════════════
// /api/market/signals   —— 短线精灵
// ════════════════════════════════════════════════════════════════

export interface SignalThresholds {
  min_pct: number
  min_market_cap_yi: number
  amount_morning_yi: number
  amount_afternoon_yi: number
}

export interface ShortSpiritSignal {
  name: string
  code: string
  sector: string
  market_cap_yi: number
  amount_yi: number
  pct: number
  /** 信号类型（如 "涨停"） */
  type: string
  tags: string[]
  /** 板块共振度 */
  resonance: number
  /** 资金净流入（亿元） */
  flow_yi: number
  /** 强度评分 */
  strength: number
  reason: string
}

/**
 * 当日信号沉淀条目（2026-09-21）——「今天在什么时刻发现过什么票」。
 *
 * ⛔ 为什么需要它：`signals` 是**本轮触发**的信号，文件每轮覆盖写；而后端 `_timeliness_gate`
 * 会剔掉「存量涨停」（上一轮已观测为涨停的票）→ 大部分轮次 `signals` 为空 →
 * 前端一刷新列表就消失（用户抓包「我这一刷新，列表那里就空了」）。
 *
 * ⚠️ 字段**全部可缺**：历史条目由事件流（`short_spirit_events_<date>.jsonl`）回填，
 * 那里只有身份与时刻，没有 pct / 资金 / 理由 → 渲染必须 `—` 兜底，⛔ 不得退化成 0。
 */
export interface ShortSpiritDeposit {
  code: string
  name?: string
  sector?: string
  type?: string
  strength?: number
  /** 首次触发时刻（`HH:MM:SS`）—— 沉淀的核心，⛔ 一经确定不再改写 */
  first_seen?: string
  /** 最近一次触发时刻（`HH:MM:SS`） */
  last_seen?: string
  /** 当日出现过几轮（>1 = 反复触发） */
  seen_count?: number
  pct?: number
  tags?: string[]
  reason?: string
  resonance?: number
  flow_yi?: number
  market_cap_yi?: number
  amount_yi?: number
}

export interface ShortSpiritSignals {
  ts: string
  /** 数据日期（后端 2026-09-21 新增；旧数据缺 → 沉淀按同日判定，缺失即视为不可用） */
  date?: string
  session: 'morning' | 'afternoon' | string
  thresholds: SignalThresholds
  pool_total: number
  after_filter: number
  /** **本轮**触发的信号（推送口径） */
  signals: ShortSpiritSignal[]
  /** **当日沉淀**（展示口径）· 按 `first_seen` 倒序 · 旧数据缺该字段 */
  signals_today?: ShortSpiritDeposit[]
}

// ════════════════════════════════════════════════════════════════
// /api/market/feedback   —— 昨日涨停反馈矩阵
// ════════════════════════════════════════════════════════════════

export interface PromoteItem {
  name: string
  code: string
  prev_boards: number
  pct: number
}

/**
 * 逐票实时行情（`feedback.quotes` · 全量不截断）—— 供「连板天梯」显示每只票的
 * 今日实时涨幅与封单（2026-09-21 用户「连板天梯上面显示涨幅和封单」）。
 *
 * ⚠️ `seal_yi` **只在真封板时非空**：判据是盘口「卖一量为 0」（无卖盘）。
 * 未涨停的票买一也有挂单，但那不是封单 → 后端给 `null`，⛔ 前端不得退化成 0。
 */
export interface QuoteItem {
  /** 当日累计成交额（亿元），缺失保持为空。 */
  amount_yi?: number | null
  quote_at?: string | null
  prev_boards?: number
  sealed?: boolean | null
  name?: string
  /** 今日实时涨跌幅 % */
  pct?: number | null
  price?: number | null
  /** 封单额（亿）· 仅真封板时非空 */
  seal_yi?: number | null
  /** 当日曾确认封板；收盘后盘口封单消失时仍保留该事实。 */
  sealed_today?: boolean
  /** 今日涨停池首封时间，HHMMSS；无今日涨停记录时为空。 */
  today_fbt?: string | null
}

export interface TrendHistoryItem {
  /** 交易日 */
  date: string
  /** promote rate 晋级率 */
  pr: number
  /** avg pct 均涨幅 */
  ap: number
}

export interface FeedbackTrend {
  promote_downtrend: boolean
  avg_pct_weak: boolean
  /** 防御等级 */
  defense_level: number
  history: TrendHistoryItem[]
  /** 晋级率动态阀门（前 10 交易日截尾均值，缺失时回退 25） */
  promotion_gate_10d: number
}

/**
 * 核按钮（昨涨停/昨连板今日大幅下挫）· `feedback_matrix.nuke_list` 元素。
 *
 * ⚠️ 该字段长期被标为 `unknown[]` 而无人渲染 —— 实测每条都带**均线破位信息**
 *    （`break_ma5` / `break_ma10` / `breakdown`），这正是「核按钮」里最该看的
 *    一栏：跌停 + 同时跌破 5/10 日线 = 结构性走坏，与单纯跌停不是一回事。
 */
export interface NukeItem {
  name: string
  code: string
  pct: number
  price: number
  /** 昨日板数（1 = 昨首板，3 = 昨 3 板） */
  prev_boards: number
  /** 标签（"昨涨停" / "昨连板"） */
  tag: string
  ma5: number
  ma10: number
  break_ma5: boolean
  break_ma10: boolean
  /** 是否已跌破关键支撑 */
  breakdown: boolean
}

/** 单个情绪评分因子（诊断用，不是买卖信号）。 */
export interface SentimentFactor {
  key: string
  label: string
  /** 对总强度的贡献（已带方向：正=支撑，负=拖累） */
  value: number
  /** false = 未取到该输入，⛔ 不等于「观测到 0」 */
  observed: boolean
  source?: string
}

/** 一个评分维度及其下属因子。 */
export interface SentimentDimension {
  key: string
  label: string
  value: number
  observed: boolean
  factors: SentimentFactor[]
}

/** 支撑 / 拖累摘要。 */
export interface SentimentDimensionRef {
  key: string
  label: string
  value: number
}

/**
 * 情绪分维度诊断。
 *
 * 回答「这个分是被什么撑起、被什么拖住」；⛔ 不构成排序或买卖依据。
 */
export interface SentimentBreakdown {
  model?: string
  /** false = 该模型是整段独立公式，不做因子分解（如 legacy_v2） */
  decomposable?: boolean
  score?: number | null
  label?: string
  strength?: number | null
  dimensions?: SentimentDimension[]
  observed_dimensions?: number
  observed_factors?: number
  total_factors?: number
  /** 观测因子 / 总因子；只是覆盖度描述，不是置信度概率 */
  coverage?: number | null
  /** high ≥0.85 / medium ≥0.6 / low / none = 完全无观测 */
  coverage_grade?: string
  missing_factors?: string[]
  support?: SentimentDimensionRef | null
  drag?: SentimentDimensionRef | null
  /** decomposable=false 时的说明 */
  reason?: string
}

export interface FeedbackMatrix {
  generated_ts: string
  date: string
  prev_date: string
  prev_zt_count: number
  now_zt_count: number
  promote_count: number
  /** 晋级率（%） */
  promote_rate: number
  lb_prev_count: number
  lb_promote_count: number
  /** 连板晋级率（%） */
  lb_promote_rate: number
  avg_pct: number
  quote_fail_count: number
  /** 上涨占比（%） */
  up_rate: number
  strong_count: number
  /** 核按钮数量（≥3 视为恶化） */
  nuke_count: number
  break_count: number
  market_missing: boolean
  /** 核按钮明细（带均线破位信息）· 实测条数 ≤ nuke_count */
  nuke_list: NukeItem[]
  big_loss_count: number
  broken_rate: number
  prev_max_boards: number
  now_max_boards: number
  max_trend: number
  zt_expand: number
  idx_avg: number
  market_amount_yi: number
  breadth: { up: number; down: number }
  promote_list: PromoteItem[]
  /**
   * **全量**晋级代码（6 位）—— 与 `promote_list` 的区别是**不截断**。
   *
   * ⛔ 判「某票今天晋级了吗」必须用这个集合，**不能**用 `promote_list`：
   * 后者是 `[:8]` 的展示用截断名单，拿它做集合判定会把第 9 只之后的晋级票
   * 误判成「未晋级」（假阴性 —— 不报错、只是标错）。
   */
  promote_codes: string[]
  /** 逐票实时行情（code → 涨幅/封单）· 全量不截断 · 旧快照可能缺该字段 */
  quotes?: Record<string, QuoteItem>
  sentiment_score: number | null
  sentiment_label: string
  sentiment_model?: string
  sentiment_quality?: string
  sentiment_inputs_missing?: string[]
  /**
   * 分维度诊断：哪个维度撑起 / 拖住本分。
   *
   * 只解释、不裁决 —— ⛔ 不得据此排序或放宽纪律。
   * `observed=false` 表示该因子**未取到**，不是「观测到 0 的中性证据」。
   * `legacy_v2` 模型下 `decomposable=false`，本字段无 `dimensions`。
   */
  sentiment_breakdown?: SentimentBreakdown | null
  source_snapshot_ts?: string | null
  regulatory_pressure: number
  trend: FeedbackTrend
  /** 原系统异常态标记（存在时该文件不可用） */
  error?: string
  /** 异常态的中文说明（后端 `msg` 字段，如「9:26 竞价定价后首轮生效」） */
  msg?: string
}

// ════════════════════════════════════════════════════════════════
// /api/market/selection-effect —— 盘后候选的次日反馈
// ════════════════════════════════════════════════════════════════

/** 按昨日板数分段的晋级与竞价事实。小样本只展示，不转成买入门控。 */
export interface SelectionEffectStage {
  sample_count: number
  promote_count: number
  promote_rate: number | null
  auction_quoted: number
  auction_premium_avg: number | null
  failed_count: number
  failed_nuke_count: number
  mood: string
}

/** N+N 断板回补事实，与连板晋级分段结构不同。 */
export interface SelectionEffectRepairStage {
  sample_count: number | null
  repair_count: number | null
  repair_rate: number | null
  mood: string
}

export interface SelectionEffectMarket {
  sample_count: number
  promote_count: number
  promote_rate: number | null
  auction_quoted: number
  auction_premium_avg: number | null
  auction_premium_median: number | null
  promoted_auction_premium_avg: number | null
  failed_auction_premium_avg: number | null
  failed_count: number
  failed_nuke_count: number
  failed_nuke_codes: string[]
  repair_sample_count: number | null
  repair_count: number | null
  repair_codes: string[] | null
  confirmed_limit_down_count: number | null
  stages: {
    one_to_two: SelectionEffectStage
    two_to_three: SelectionEffectStage
    high_relay: SelectionEffectStage
    n_plus_n: SelectionEffectRepairStage
  }
  pressure: boolean
}

/** 猎手原样发布的候选次日反馈，不在终端重新计算晋级或核按钮。 */
export interface SelectionEffectCandidate {
  code: string
  name: string
  bucket: string
  rank: number | null
  boards: number
  raw_score: number | null
  auction_gap_pct: number | null
  current_pct: number | null
  quote_at: string | null
  promoted: boolean
  nuke: boolean
}

export interface SelectionEffect {
  date: string
  prev_date: string
  generated_ts: string
  market: SelectionEffectMarket
  candidates: SelectionEffectCandidate[]
}

// ════════════════════════════════════════════════════════════════
// /api/market/candidates   —— 候选池
// ════════════════════════════════════════════════════════════════

export interface Candidate {
  name: string
  code: string
  pct: number
  sector: string
  is_20cm: boolean
  boards: number
  /** 是否已封板 */
  sealed: boolean
  buyable: boolean
  price: number
  turnover: number | null
  reason: string
}

export interface CandidatesFile {
  generated_at: string
  /** 阶段（如 "intraday"） */
  phase: string
  count: number
  candidates: Candidate[]
}

// ════════════════════════════════════════════════════════════════
// /api/decision/*   —— 财富密码每日决策档案
//
// ⚠️ 曾把 `candidates-<日期>.json` 误当成「候选池」（沿用 CandidatesFile）。
//    实测其 schema 为 `wealth_code_candidates_v1`，是**当日完整决策档案**：
//    情绪环境 + 真实盘面 + 接力池 + 观察池 + 早鸟埋伏 + 诊断计数 + 全局旁白。
//    两者唯一的共同点只是文件名里有 candidates。
// ════════════════════════════════════════════════════════════════

/** 决策时点的情绪环境（选股脚本用的输入，与 feedback_matrix 同源） */
export interface DossierEnvironment {
  sentiment_score: number
  sentiment_label: string
  promote_rate: number
  nuke_count: number
  broken_rate: number
  break_count: number
  up_rate: number
  avg_pct: number
  now_zt_count: number
  regime: string
  /** 决策时点的东财题材预期榜（与 real_env.em_expect 同源，此处为脚本口径） */
  em_expect: EmExpect[]
}

/** 执行审计：只认账户已入场且有收盘收益的主口径，缺件不补零。 */
export interface ExecutionAudit {
  schema: 'execution_audit_v1'
  generated_at_bj: string
  main_metric: { label: string; formula: string; includes_costs: boolean; includes_slippage: boolean }
  calendar: { source: string; days: string[]; count: number }
  summary: {
    batches: number; stocks: number; entered: number; covered_returns: number
    mechanical_fallback_entries: number; ai_rejected_entries: number; ai_plan_missing_candidates: number
    ice_ai_entries: number; incomplete_batches: number
  }
  batches: Array<{
    recommendation_date: string; trade_date: string | null; candidate_file: string
    candidate_generated_at?: string; regime?: string | null
    source: { candidate_frozen: boolean; auction_frozen: boolean; ai_plan_count: number; pool_call_frozen: boolean; account_entries: number }
    caliber: { expected: string; actual: string[]; mechanical_fallback: boolean }
    integrity: { complete: boolean; issues: string[] }
    stocks: Array<{
      code: string; name: string; bucket: string; candidate_rank?: number
      mechanical: { status?: string | null; can_enter: boolean; ice_ban: boolean }
      ai: {
        status: string; can_enter: boolean | null; final_can_enter?: boolean | null
        ice_conflict?: boolean; view?: string | null; gap_zone?: string | null
      }
      execution: { entered: boolean; caliber?: string | null; gross_return_label: string; gross_return_pct?: number | null }
      integrity: { complete: boolean; issues: string[] }
    }>
  }>
}

/** 决策时点的真实盘面反馈（与脚本 environment 的对照项，用于发现脚本失真） */
export interface DossierFeedback {
  sentiment_score: number
  nuke_count: number
  break_count: number
  broken_rate: number
  promote_rate: number
  up_rate: number
  avg_pct: number
  [k: string]: unknown
}

/** 板块级热点：板块名 + 该板块领涨标的（结构同 Leader） */
export interface DossierHotSpot {
  sector: string
  stocks: Leader[]
}

/**
 * 决策时点的真实盘面（指数 / 涨跌 / 板块风险），用于核对脚本环境是否失真。
 *
 * ⚠️ 这里的 `feedback` 是**独立于 `environment` 的第二套情绪读数**：
 *    `environment` 由选股脚本自己算，`feedback` 取自盘中快照。两者不一致
 *    恰恰是「脚本环境失真」的证据 —— 故并列保留，不可只留一套。
 */
export interface DossierRealEnv {
  ts: string
  indices: IndexQuote[]
  avg_index_pct: number
  sentiment: string
  sentiment_score: number
  total_zt: number
  market?: number | null
  breadth?: { up: number | null; down: number | null; flat: number | null }
  /** 炸板池（家数 + 名单） */
  broken?: CountNames
  /** 跌停池（家数 + 名单） */
  limit_down?: CountNames
  /** 弱势板块名单（含跌停/炸板构成） */
  weak_sectors?: WeakSectors
  /** 板块级风险：跌幅榜 / 资金流出榜 */
  sector_risk?: SectorRisk
  /** 决策时点的东财题材预期榜 */
  em_expect?: EmExpect[]
  /** 决策时点的板块级热点（板块 → 领涨标的） */
  hot_spots?: DossierHotSpot[]
  /** 决策时点的爆发前夜形态 */
  early?: EarlyItem[]
  /** 真实盘面情绪读数（收盘反馈口径） */
  feedback?: DossierFeedback
  [k: string]: unknown
}

/** 龙头三要素诊断（带领性 / 突破性 / 唯一性）—— 原系统龙头战法打分卡 */
export interface DragonDiagnosis {
  /** 带领性：几颗星 + 星级文案 */
  leadership: { stars: number; text: string }
  /** 突破性 */
  breakthrough: { stars: number; text: string }
  /** 唯一性 */
  uniqueness: { stars: number; text: string }
  /** 三要素综合分（如 4.0） */
  composite: number
  /** 身份判定，如「准龙头」 */
  identity: string
}

/**
 * 期望区间 —— 决定「竞价涨到多少算超预期」。
 *
 * ## ⚠️ 三个区间字段都是**二元数组** `[下沿, 上沿]`，不是标量
 *
 * 实测 `expected_range = [0.0, 2.0]`。这一点极易踩坑：若按字符串渲染，
 * React 会把数组子元素**无分隔符拼接**成 `"02"` —— 不报错、不抛异常，
 * 只是静默显示一个错误数字。必须显式按 `[低, 高]` 格式化。
 *
 * ## 展示优先用 `expected_text`
 *
 * `expected_text` / `super_text` / `low_text` 是脚本**已排好版的完整买入条件原文**
 * （含板块身份、高开预期、量能门槛）。原系统卡片直接展示这段文字，而不是
 * 让前端二次拼装 —— 二次拼装会丢掉量能条件等关键约束。故本视图优先渲染原文，
 * 数值区间仅作为紧凑列的辅助展示。
 */
export interface DossierExpectation {
  /** 预期开盘涨幅区间 `[下沿, 上沿]`（%）；部分归档为 null */
  expected_range: number[] | null
  /** 超预期门槛涨幅（%） */
  super_gap_min: number | null
  /** 竞价成交额下限（亿） */
  auction_amount_min_yi: number
  /** 竞价成交额超预期线（亿） */
  auction_amount_super_yi: number
  /** 竞价量能相对昨日成交的区间 `[低, 高]`（%，如 [4, 8]） */
  auction_amount_range: number[]
  /** 竞价量能比区间 `[低, 高]`（小数，如 [0.035, 0.085]） */
  amount_ratio: number[]
  /** 爆量成交额线（亿） */
  auction_boom_yi: number
  /** 量能形态标签，如「🔺爆量高开」 */
  boom_label: string
  /** 高开强度档位（weak / mid / strong） */
  gap_strength: string
  /** 高开强度中文提示 */
  gap_strength_hint: string
  /** 封板形态，如「放量板」 */
  seal_form: string
  /** 该股炸板次数（用于形态判定） */
  seal_zbc: number
  /** 板块地位（dragon / follower / lone） */
  sector_tier: string
  /** 板块情绪（low / mid / high） */
  sector_sentiment: string
  /** 计划买入条件原文（脚本排版，直接展示） */
  expected_text: string
  /** 超预期买入条件原文 */
  super_text: string
  /** 不及预期放弃条件原文 */
  low_text: string
  /** 情绪阶段，如「分歧」 */
  phase: string
  /** 阶段说明（含情绪分与核按钮数） */
  phase_note: string
  /** 题材阶段 */
  theme_phase: string
  /** 置信度 0–1 */
  confidence: number
  /** 龙头三要素诊断 */
  dragon_diagnosis: DragonDiagnosis
  /** 脚本生成的该股预期摘要（含情绪/形态/板块/龙头/东财预期） */
  ai_note: string
  /** 该预期是否由 AI 覆写 */
  is_ai: boolean
  /** 不可交易标记（如一字板无法买入） */
  non_tradeable?: boolean
  /** AI 覆写了脚本结论 */
  ai_override?: boolean
  /** 量价形态四维（部分归档携带） */
  vpa_path?: string
  vpa_path_label?: string
  vpa_broken_tier?: string
  vpa_seal_speed?: string
  vpa_turnover_tier?: string
  [k: string]: unknown
}

/**
 * 接力池 / 观察池个股。
 *
 * ⚠️ 真实字段有 70 余个，此处**只声明会被渲染的核心项**，其余经索引签名透传。
 *    刻意不做全量映射：原系统仍在演进该结构，全量声明会让「字段增删」
 *    误报成契约破坏，而实际并不影响展示。
 */
export interface LeaderEvidence {
  asof?: string
  continuous_days?: number
  note?: string
}

/**
 * 次日开盘推测（`relay_forecast_v1` · `wealth_code/core/relay_forecast.py`）。
 *
 * ⛔ 口径：模型只承诺「明早大概怎么开、这一档历史真买到的胜率」，
 *    **不承诺「买哪只赚」**。`by_band` 的样本数（`n`）必须一并展示，
 *    否则小样本档位会被当成确定结论。
 */
export interface DossierForecastBand {
  n: number
  win: number
  win_lb: number
  avg: number
}

export interface DossierForecast {
  schema?: string
  /** 该票当前板数 */
  boards?: number
  /** 距全市场最高板 */
  gap_to_top?: number
  factor_count?: number
  /** 历史分组名，如「差≥2板·封板强(≥3)」 */
  group?: string
  group_n?: number
  /** 同组历史开盘幅度中位 / 四分位（%） */
  gap_median?: number
  gap_p25?: number
  gap_p75?: number
  /** 历史同组高开 >5% 的占比（%）= 买不到的概率 */
  p_over5?: number
  /** 晋级率（%） */
  promo_rate?: number
  /** 可成交样本数与真买到时的胜率/均值 */
  buy_n?: number
  buy_win?: number
  buy_win_lb?: number
  buy_avg?: number
  /** 各开盘档位的真实胜率（键为「低开>3%」等档名） */
  by_band?: Record<string, DossierForecastBand>
  /** 建议档：可等 / 只观察 / 放弃 */
  verdict?: string
  reasons?: string[]
  note?: string
}

/**
 * 晋级三问（`promotion_quiz_v1`）—— 「这只票明天凭什么能连板」的三条硬判据。
 * ⛔ 只作判定，不改评分/顺序/名额/仓位。
 */
export interface DossierPromotionQuizItem {
  ok: boolean
  why: string
  [k: string]: unknown
}

export interface DossierPromotionQuiz {
  schema?: string
  /** 通过几问（0–3） */
  passed: number
  label?: string
  items?: Record<string, DossierPromotionQuizItem>
  unknown?: string[]
  /** 卡在哪一问 */
  blocked_by?: string[]
  note?: string
}

/** 封板强度闸（`seal_gate_v1`）—— 成交额门槛与封板分档的判定留痕 */
export interface DossierSealGate {
  schema?: string
  grade?: string
  score?: number | null
  /** 实际生效的成交额门槛（亿） */
  floor_used?: number
  /** 一字 / 换手 / unknown —— 换手板量小＝做局风险 */
  style?: string
  theme_mates?: number
  source?: string
  reason?: string
}

export interface DossierStock {
  leader_role?: '龙头' | '准龙头' | '跟风' | null
  /**
   * 昨日已在池 ∧ 今日板数更高 → 观察池优先占位（2026-11-04 用户「b 占位」）。
   * ⛔ 只影响排序先后，不代表买入资格。
   * （`watch_group` / `watch_reason` 已有定义，此处不重复声明）
   */
  carryover_promoted?: boolean
  leader_evidence?: LeaderEvidence
  status_rank?: number
  code: string
  name: string
  /** 东财题材名 */
  theme: string
  /** 总分（驱动排名） */
  score: number
  ign_score: number
  exp_score: number
  lead_score: number
  cap_score: number
  raw_score: number
  themeTier: number
  /** 命中标签，如 ['带动板块', '先发'] */
  tags: string[]
  /** ⚠️ 实测为 null（该字段在部分阶段未回填），不是缺失 */
  price: number | null
  pct: number
  boards: number
  /** 换手率 */
  hs: number
  /** 炸板次数 */
  zbc: number
  /** 首封时间 '094048' */
  fbt: string
  /** 封单（亿） */
  seal_amt: number
  /** 流通市值（亿） */
  lt_mktcap: number
  zsz_yi: number
  /** 成交额（亿） */
  cje_yi: number
  sector: string
  /** 主轴题材（⚠️ 可能与本行 `theme` 不同轴，按真实主轴判断） */
  core_theme: string
  core_theme_logic: string
  core_theme_heat: string
  /** 梯队健康度分 */
  ladder_health: number
  ladder_has_complete: boolean
  /** 梯队等级 A/B/C/D */
  ladder_grade: string
  is_sector_dragon: boolean
  /** 龙头优先排序名次：板块龙→连板高度→带动性→题材广度→综合分 */
  leader_preference_rank?: number
  leader_preference_note?: string
  sector_mates_cnt: number
  theme_mates_cnt: number
  theme_name: string
  theme_is_lone: boolean
  theme_has_sector_effect: boolean
  sector_is_lone: boolean
  /** 带动家数 */
  carry_cnt: number
  carry_time: string
  carry_score: number
  /** 历史同高度接力成功概率（0–1） */
  history_relay_prob: number
  history_relay_samples: number
  history_relay_stock_samples: number
  history_relay_factor: number
  history_relay_note: string
  is_capacity_core: boolean
  style_tag: string
  is_20cm: boolean
  is_st: boolean
  is_one_word: boolean
  expectation: DossierExpectation
  /** 逐维打分面板（中文键） */
  dim_panel: Record<string, unknown>
  quant_dims: Record<string, number | null>
  /** 该股当日点评（分段文本） */
  narrative?: string
  /** 主力资金（亿元，当日 / 5日 / 10日 / 20日） */
  main_flow_yi: number
  main_flow_5d_yi: number
  main_flow_10d_yi: number
  main_flow_20d_yi: number
  /** 筹码：获利比例 / 平均成本 / 90% 集中度 */
  chip_profit_rate: number
  chip_avg_cost: number
  chip_conc90: number
  // ── 决策档案用的补充维度（真实存在于候选中，此前未声明类型）────────────────
  /** 封单占流通市值（%）—— 与 `seal_amt / lt_mktcap` 同源，已由脚本算好 */
  seal_ratio_pct?: number
  /** 封板强度闸判定留痕（含一字/换手形态、生效门槛） */
  seal_gate?: DossierSealGate
  /** 该方向（炒作题材）内最高板数 */
  line_top?: number
  /** 该方向内达到最高板的票名 */
  line_tops?: string[]
  /** 身位解释：为什么在这条线上排这个位置 */
  line_tier_why?: string
  /** 方向梯队档位（outpool 口径） */
  line_tier_outpool?: string
  /** 方向内部排名（1 = 龙一） */
  dragon_rank?: number
  /** 该方向龙头名（用于「跟着谁涨」） */
  dragon_leader_name?: string
  dragon_leader_boards?: number
  /** 接力阶段：one_to_two / two_to_three */
  relay_stage?: string
  /** 接力情绪：sufficient / insufficient */
  relay_mood?: string
  /** 次日开盘推测（含分档真实胜率） */
  forecast?: DossierForecast
  /** 晋级三问 */
  promotion_quiz?: DossierPromotionQuiz
  relay_rank?: number
  watch_rank?: number
  bucket?: string
  bucket_label?: string
  watch_group?: string
  [k: string]: unknown
}

/** 选股诊断计数 —— 回答「为什么只选出这几只」 */
export interface DossierDiagnostics {
  scored: number
  strict_pool: number
  height_breakout_eligible: number
  high_mark_eligible: number
  core_eligible: number
  one_to_two_eligible: number
  relay_count: number
  watch_count: number
  selection_mode: string
  mean_raw_score: number
  early_buy_hits: number
  early_buy_signals: Array<{ code: string; type: string }>
  weak2strong_hits: number
  weak2strong_codes: string[]
  tx_enriched: number
  regulatory_enriched: number
  excluded_low_turnover: number
  excluded_688: number
  data_source: string
  pulse_ts: string
  /** 历史同高度接力概率统计的覆盖情况 */
  historical_relay?: {
    enabled: boolean
    history_days: number
    candidates_with_history: number
    [k: string]: unknown
  }
  /** 环境分量得分（部分归档携带） */
  env_component?: number
  /** 剔除一字板家数（部分归档携带） */
  excluded_one_word?: number
  /** 剔除 ST 家数（部分归档携带） */
  excluded_st?: number
  /** 该次决策的 regime（部分归档携带，与顶层 `regime` 冗余留痕） */
  regime?: string
  /** 强板块持续性名单（部分归档携带） */
  strong_sector_persistent?: string[]
  /** 因「强板块外在野」被扣分的家数（部分归档携带） */
  strong_sector_outside_penalized?: number
  /** 当日定调核对命中数（部分归档携带） */
  daily_verdict_matched?: number
  /** 定调来源（部分归档携带） */
  daily_verdict_source?: string
  [k: string]: unknown
}

/**
 * 财富密码每日决策档案（`wealth_code_candidates_v1`）。
 * 这是财富密码选股链的**单一产出物**，也是「当时凭什么这么选」的唯一原件。
 */
export interface DecisionDossier {
  schema: string
  date: string
  generated_at_bj: string
  regime: string
  environment: DossierEnvironment
  real_env: DossierRealEnv
  ai_env: Record<string, unknown>
  data_source: string
  /** 接力池（可执行） */
  relay: DossierStock[]
  /** 观察池（待确认） */
  watch: DossierStock[]
  /** 早鸟埋伏层 */
  early_ambush: EarlyItem[]
  diagnostics: DossierDiagnostics
  /** 全局旁白（账户 + 盘面 + 结论，分段文本） */
  global_narrative: string
  /** 全市场最高板（当日） */
  market_max_boards?: number | null
  /**
   * 市场风格判定（`market_style`）—— 决定「今天该做什么类型」。
   * `style` 取值：core / follow / hedge / caution / none / neutral。
   */
  market_style?: {
    style?: string
    label?: string
    rule?: string
    trading_rule?: string
    /** 冰点判定（此时标注只看不买） */
    ice?: boolean
    ice_note?: string
    enabled?: boolean
    [k: string]: unknown
  } | null
}

/**
 * 全量涨停逐票过筛结论（`daily_screen_v1` · `wealth_code/core/daily_screen.py`）。
 *
 * ## 与 `DecisionDossier` 的根本区别
 *
 * `DecisionDossier` 是**选股卡产物** —— 只有最终入选的 7 只票。
 * 本结构是**全市场涨停逐票**的判定台账 —— 回答「48 只涨停里另外 41 只为什么被排除」。
 * 没有这份数据，「为什么只剩这几只」只能靠反推。
 *
 * ⛔ 三档语义不可混：
 *   · `pass`        —— 各维都过，可以进入后续选池
 *   · `watch_only`  —— 能看但买不到（如一字厚封），不是坏票
 *   · `reject`      —— 有硬伤，今天不选（**不是黑名单**，次日重新过筛）
 */
export interface ScreenFacts {
  /** 封板形态：yizi 一字 / turnover 换手 / unknown */
  style?: string
  seal_grade?: string
  seal_score?: number | null
  seal_ratio_pct?: number | null
  cje_yi?: number
  /** 实际生效的成交额门槛（亿） */
  floor_yi?: number
  hs?: number | null
  fbt?: string | null
  zbc?: number | null
  carry_cnt?: number | null
  gene_grade?: string | null
  promo_rate_hist?: number | null
  zt_250?: number | null
  [k: string]: unknown
}

export interface ScreenStock {
  code: string
  name: string
  boards: number
  theme: string
  /** 同题材涨停家数 */
  theme_members: number
  verdict: 'pass' | 'watch_only' | 'reject'
  /** 硬伤（导致 reject） */
  rejects: string[]
  /** 只能看不能买的原因 */
  watch_reasons: string[]
  /** 支持项 */
  supports: string[]
  /** 判不了的维度（缺失数据，⛔ 不当成负面） */
  unknown: string[]
  /** 看多细：2 = ≥2 板主看对象，1 = 首板 */
  priority: number
  facts: ScreenFacts
}

export interface ScreenFile {
  schema?: string
  date: string
  /** 当日全量涨停家数 */
  zt_count: number
  market_max_boards: number | null
  counts: { pass: number; watch_only: number; reject: number }
  /** 拒因 → 家数（按理由原文聚合） */
  reject_reasons: Record<string, number>
  screened: ScreenStock[]
}

// ════════════════════════════════════════════════════════════════
// /api/theme/rotation   —— 题材轮动 / 回流预测 / 5日资金
// ════════════════════════════════════════════════════════════════

export interface PoolStock {
  code: string
  name: string
  /** 是否龙头 */
  dragon: boolean
  pct: number
  /** 当日实时涨幅；行情源未覆盖时为 null，不能回退到历史建池涨幅。 */
  live_pct?: number | null
  /** 当日实时价；与 live_pct 同一批快照。 */
  live_price?: number | null
  cap_yi: number
  /** 板块归属："main" = 主板 */
  board: string
  from_zt: boolean
  risk: string
}

export interface ConfidenceFactors {
  catalyst: boolean
  market: boolean | null
  /** 资金因子（如 "inflow_rising"） */
  capital: string
  /** 阶段因子（如 "boom"） */
  phase: string
  /**
   * **K线止跌**（2026-09-22 新增·第 5 维）—— 龙头个股日K四条判据命中数，如
   * `"stop_fall(止跌2/4)"` / `"not_yet(未止跌1/4)"` / `"no_data(无K线)"`。
   *
   * ⚠️ 可选：该维度上线前的历史归档没有这个字段（⛔ 别当 `''` 或 `'not_yet'` 处理）。
   * 判据见 `scripts/theme_rotation._kline_stop_fall`（①站上MA5 ②近2日不创新低 ③跌幅收窄 ④缩量）。
   */
  kline?: string
}

/** 回流候选题材 */
export interface RotationCandidate {
  theme: string
  phase: string
  /**
   * 爆发日。⚠️ 实测存在 null（该题材在本窗口内未完成一次完整爆发）——
   * 与空串语义不同：空串 = 有字段但未填，null = 该日无记录。
   */
  boom_day: string | null
  cooled_days: number
  catalyst: string
  catalyst_fresh: boolean
  confidence: number
  confidence_factors: ConfidenceFactors
  trigger: string
  watch_pool: PoolStock[]
  main_board_pool: PoolStock[]
  board_mix: { main: number; cyb: number }
  pool_note: string
  flow_trend: string
  flow_vals: (number | null)[]
  /** ⚠️ 同花顺口径资金，早于该口径上线日期的归档为 null */
  tx_10d_yi: number | null
  tx_5d_yi: number | null
  /** ⚠️ 爆发日涨停数 / 爆发涨幅，未爆发时为 null */
  boom_zt: number | null
  boom_pct: number | null
  zt_series: (number | null)[]
  zt_dir: string
  zt_filled: Record<string, number>
  zt_valid_days: number
  today_hot: boolean
  /**
   * 周期相位（theme_phase_v1 · 2026-11-03）。
   *
   * 与上面的 `phase` 是**两个不同问题**：
   *   · `phase` = 跨周期回流候选（这题材冷了很久，现在资金可能回来）
   *   · `phase_v2` = **这波线走到第几天**（启动/发酵/高潮/分歧/回流/退潮/沉寂）
   *
   * ⚠️ null = 数据不足（今日家数缺失或成分股为空）。⛔ 前端不得把 null
   * 渲染成任一相位 —— 那是「不知道」，不是「没线」。
   */
  phase_v2?: ThemePhase | null
}

/** 题材周期相位判定结果（后端 `wealth_code/core/theme_phase.py` · schema=theme_phase_v1） */
export interface ThemePhase {
  schema: string
  /** start / ferment / climax / diverge / reflow / ebb / dormant */
  phase: string
  phase_cn: string
  /** 这波线走到第几天（从峰值所在那一波的起点算） */
  day_n: number | null
  /** 窗口内峰值家数 */
  peak: number | null
  peak_idx: number | null
  /** 前一日家数 */
  prev: number | null
  /** 今日家数 */
  cur: number | null
  /** 有效天数 */
  days: number | null
  /** full = 有效数据 ≥8 天；weak = 样本不足，只作方向参考 */
  quality: string | null
  /** 判定依据（人话，可直接展示） */
  reason: string
  /** 该相位默认允许做什么 —— ⛔ 不是买卖建议 */
  action: string
  /** 弱回流：回到前高六成以下，别当第二轮 */
  is_retrace_fail?: boolean
  /**
   * 家数口径来源（2026-11-03 起可追溯）：
   * - `snapshot_plates` = 选股宝题材快照的当日归属 ∩ 涨停池（**主口径**，准）
   * - `pool_codes`      = 对不上快照时退回「历史成员今天有几只涨停」（偏高，只作参考）
   */
  src?: string | null
  /** 判定依据的家数序列（升序，末项=今日；null = 那天没数据，⛔ 不是 0） */
  series?: (number | null)[]
  /** 实际匹配到的选股宝板块名（如 `['机器人']`），便于人工复核 */
  plates?: string[]
}

export interface SectorZtTrend {
  theme: string
  zt_series: (number | null)[]
  latest: number
  delta: number
  /** 方向（rising / flat / falling） */
  dir: string
  zt_filled: Record<string, number>
}

/** 板块资金（完整版 · 比 latest.sector_risk 的轻量版字段更全） */
export interface SectorFlowFull {
  name: string
  code: string
  pct: number
  main_inflow: number
  flow_yi: number
  is_focus: boolean
  super_large_yi: number
  large_yi: number
  mid_yi: number
  small_yi: number
  source_ts: number
}

export interface Flow5DItem {
  name: string
  /** 区间累计净额（亿元） */
  total_yi: number
  days: number
  inflow_days: number
  last_yi: number
  trend: string
}

export interface AvoidanceItem {
  name: string
  total_5d_yi: number
  last_yi: number
  inflow_days: number
  trigger: string
  tier: string
  stance: string
  upgrade_hint: string
}

export interface RotationMarketContext extends SectorRiskState {
  sentiment_score: number
  nuke_count: number
  promote_rate: number
  outflow_top: SectorFlowFull[]
  inflow_top: SectorFlowFull[]
  zt_count_today: number
}

export interface RotationData {
  /** 数据日期（收盘日，可能早于当前交易日） */
  date: string
  generated_ts: string
  data_days: string[]
  candidates: RotationCandidate[]
  sector_zt_trends: SectorZtTrend[]
  market_context: RotationMarketContext
  flow_5d: {
    inflow_top: Flow5DItem[]
    outflow_top: Flow5DItem[]
    data_days: string[]
  }
  avoidance_sweep: AvoidanceItem[]
  data_meta: {
    zt_source: string
    flow_source: string
    window: string
    aligned_days: number
    zt_filled_themes: number
  }
  note: string
}

// ════════════════════════════════════════════════════════════════
// /api/theme/series   —— 题材多日序列（数据堆叠）
// ════════════════════════════════════════════════════════════════

export interface SeriesDailyDetail {
  total: number
  max_boards: number
  count_20cm: number | null
  boards_2plus: number | null
  boards_4plus: number | null
  sentiment: number
  seal_rate: number
  broken: number
}

export interface SeriesLeader {
  name: string
  code: string
  boards: number
  pct: number
}

export interface SeriesTableRow {
  theme: string
  values: (number | null)[]
  delta: number
  delta_str: string
  trend: string
  leader_today: SeriesLeader | null
}

export interface ThemeSeries {
  generated_ts: string
  dates: string[]
  daily_totals: number[]
  max_boards: number[]
  daily_details: SeriesDailyDetail[]
  /** 题材名 → 5 日涨停数序列 */
  themes: Record<string, (number | null)[]>
  /** 题材名 → 5 日龙头序列 */
  theme_leaders: Record<string, (SeriesLeader | null)[]>
  theme_labels: string[]
  table_rows: SeriesTableRow[]
}

// ════════════════════════════════════════════════════════════════
// /api/theme/sequence
// ════════════════════════════════════════════════════════════════

export interface ThemeSequence {
  date: string
  themes: string[]
  updated: string
}

// ════════════════════════════════════════════════════════════════
// /api/flow/history   —— 板块资金历史（多日合并）
// ════════════════════════════════════════════════════════════════

export interface FlowHistoryDay {
  /** 源文件名（含日期） */
  file: string
  data: Record<string, unknown> | null
}

/** `/api/flow/live`：猎手盘中层发布的全量板块资金快照。 */
export interface SectorFundPool {
  date: string
  /** Unix 秒级时间戳 */
  ts: number
  boards: Record<string, {
    pct: number | null
    flow_yi: number | null
  }>
}

// ════════════════════════════════════════════════════════════════
// /api/health
// ════════════════════════════════════════════════════════════════

export interface HealthFile {
  route: string
  file: string | undefined
  desc: string
  /** 路由形态：单文件 / 目录（取目录内 mtime 最新一份做探针） */
  kind?: 'file' | 'dir'
  /** 刷新节拍（透传 routes.ts）—— 龄期告警阈值按它分档 */
  cadence?: 'intraday' | 'daily' | 'manual'
  /** ⚠️ 该链路在产侧已无写入方（`routes.ts` 的 `retired` 标记透传），文件仅留档 */
  retired?: boolean
  /** 业务日期（文件内容 date/generated_ts/ts 优先，取不到退回文件名日期） */
  asof?: string | null
  exists: boolean
  mtime: string | null
  age_sec: number | null
  size: number
}

export interface HealthPayload {
  data_root: string
  ts: string
  files: HealthFile[]
}

// ════════════════════════════════════════════════════════════════
// 以下为「原系统已落盘、前端此前从未展示」的数据维度
//
// ⚠️ 全部字段**逐项对照真实落盘文件实测**得出，不得凭命名推测。
//    复核方法：node scripts/check-data-routes.mjs --verbose
//
// ⚠️ 原系统存在两套日期命名：`YYYYMMDD`（较新脚本）与 `YYYY-MM-DD`（较早脚本）。
//    路由表已用 `\d{4}-?\d{2}-?\d{2}` 兼容两者，前端不要假设单一格式。
// ════════════════════════════════════════════════════════════════

/**
 * 目录型路由的统一外壳 —— 一个数据源 = 一组按日期/代码命名的文件。
 *
 * 返回形如 `[{ file: 'board_core_饲料.json', data: {...} }, ...]`。
 * 单份文件损坏时 `data` 为 null（不连累其余条目）。
 */
export interface DatedFile<T> {
  file: string
  data: T | null
}

// ── 涨停池快照（cache/yesterday_zt.json 与 decision_log/<日期>/zt_pool.json 同构）──

/**
 * 连板天梯。
 *
 * ⚠️ 值是**股票名数组**（`string[]`），不是对象数组 —— 要拿板数只能读 key，
 *    或从 `top_codes` 反查。这是原系统最容易误判的一处。
 */
export interface ZtPoolLadder {
  [boards: string]: string[]
}

export interface ZtPoolTopCode {
  name: string
  code: string
  boards: number
}

export interface ZtPoolStock {
  code: string
  name: string
  pct: number
  price: number
  boards: number
  /** 首封时间，形如 '092500' */
  fbt: string
  /** 炸板次数 */
  zbc: number
  /** 换手率 */
  hs: number
  sector: string
  /**
   * 封单资金（亿）。
   *
   * ⚠️ 2026-09-16 实测更正：原注释写「封板描述文案，如 '🔥 秒封板'」并把类型标为
   *    `string`，**是错的** —— 实测 `zt_history` / `yesterday_zt` /
   *    `decision_log/<日期>/zt_pool` 三处共 1700+ 条记录，`seal` **100% 是 float**
   *    （如 1.34 = 1.34 亿封单）。
   *    带文案的 `seal` 属于**另一个接口** `ThemeLeaderDetail`（题材龙头），不要混。
   *    该错标已实际导致 `/archive` 把封单资金渲染成「封板质量」。
   */
  seal: number
  /** 成交额（亿） */
  cje_yi: number
  /** 总市值（亿） */
  zsz_yi: number
  /**
   * 是否 20cm 标的（创业板/科创板）。
   *
   * ⚠️ 2026-09-16 实测补录：该字段**原系统一直在写**，但类型里从未声明，
   *    导致想标「20cm 波动大·紧止损」时无字段可读（只能靠代码前缀自己判，
   *    而前缀判断在 300/301 之外还会误判）。
   */
  is_20cm?: boolean
  /** 流通市值（亿）—— 同样是一直在写、类型缺失的字段 */
  lt_yi?: number
}

export interface ZtPoolSnapshot {
  date: string
  date_raw: string
  generated_ts: string
  zt_count: number
  tc: number
  max_boards: number
  ladder: ZtPoolLadder
  top_codes: ZtPoolTopCode[]
  /**
   * 涨停全量明细。
   *
   * ⚠️ 2026-09-16 实测更正：此处原注「yesterday_zt.json 不带」**是错的** ——
   * `cache/yesterday_zt.json` 同样带 `zt_list`（当日 89 条，含 code/name/pct/
   * price/boards/fbt/zbc/hs 等）。两者都带，仅落盘时点不同：
   *   · `yesterday_zt.json`     —— 盘后 17:2x 由 record_zt_snapshot 固化（唯一权威）
   *   · `decision_log/<日期>/zt_pool.json` —— 决策时点冻结（黑匣子口径）
   * 保留 `.optional()` 是为了兼容早期无明细的旧归档，不是因为它常态缺失。
   */
  zt_list?: ZtPoolStock[]
}

// ── 板块核心票（scripts/board_core.py）──
//
// 用途（中枢原文）：板块异动先查 core 票动不动 —— 不动而只有杂毛涨 = 假启动。
// 四维权重：时效 0.25 / 封板硬度 0.20 / 连板领先 0.25 / 带动+参与 0.30
export interface BoardCoreStock {
  code: string
  name: string
  /** 近 window 日内参与天数 */
  join_days: number
  total_days: number
  join_rate: number
  /** 平均封板次序（越小越早） */
  avg_order: number
  seal_score: number
  strength_score: number
  /** 平均封单资金（亿） */
  fund_avg_yi: number
  broken_avg: number
  lead_score: number
  drive_score: number
  /** 四维加权总分 */
  core_score: number
}

export interface BoardCoreFile {
  board: string
  days: number
  top: BoardCoreStock[]
  ts: string
}

// ── 连板日观察（scripts/board_leader_daily.py · 2026-10-27）──
//
// 每条板块线 × 每个交易日：当天谁是龙一、几板、封单多厚、换没换人、
// 昨日龙一今天还在不在涨停池（断板 = 这条线换挡/熄火）。
//
// 龙一判据与选股**同源**（wealth_code/core/sector_leader.py）：
// 板数 → 封板时刻 ±5 分钟算同一档 → 封单/流通% → 带动家数 → 更早封板 → 代码稳定。

/** 某板块某日的龙一 */
export interface BoardLeaderPick {
  code: string
  name: string
  boards: number
  /** 首次封板时刻 HHMMSS */
  fbt: string
  /** 封单 / 流通市值（%）；缺失 = 拿不到流通市值，不是 0 */
  seal_ratio_pct: number | null
  /** 买不进的情形：'one_word' 一字 / 'st' / '' 正常 */
  block: string
}

/** 组内身位（dragon_rank=1 即龙一） */
export interface BoardDragonRank {
  code: string
  name: string
  boards: number
  fbt: string
  seal_ratio_pct: number | null
  dragon_rank: number
}

/**
 * 相对上一交易日的变化。
 * `same` 还是同一只 ｜ `switch` 换人 ｜ `new` 昨日这条线没记录 ｜ `gone` 今日整条线没涨停
 */
export interface BoardLeaderChange {
  kind: 'same' | 'switch' | 'new' | 'gone' | string
  prev: BoardLeaderPick | null
  /** 板数变化（同一只时） */
  boards_step?: number
  /** 昨日龙一今天还在涨停池时给板数；null/缺失 = 今天没涨停（断板） */
  prev_today?: { boards: number } | null
  note?: string
}

export interface BoardLeaderRow {
  theme: string
  /** 该条线当日涨停家数（0 = 今日整条线没涨停） */
  mates: number
  leader: BoardLeaderPick
  dragon_ranks: BoardDragonRank[]
  change?: BoardLeaderChange
}

export interface BoardLeaderDailyFile {
  schema: string
  date: string
  generated_at: string
  /**
   * 题材来源：
   * · `snapshot`         = 当日题材冻结映射（与选股同源，可比）
   * · `sector_fallback`  = 题材快照上线前，降级用申万行业分组（**口径不同**，不可与前者横比）
   * · `missing`          = 两份都拿不到（该日无有效板块线）
   */
  theme_source: 'snapshot' | 'sector_fallback' | 'missing' | string
  degraded: boolean
  zt_count: number
  max_boards: number
  window_min: number
  mates_min: number
  boards: BoardLeaderRow[]
}

// ── 连板晋级量化（scripts/promo_quant.py · 冷启动矩阵 1进2 15.4% / 2进3 34.3% / 3进4 51.6% / 4to5+ 51.7%）──

export interface PromoSummaryRow {
  /** '1to2' | '2to3' | '3to4' | '4to5+' */
  stage: string
  /** 样本数 */
  n: number
  ok: number
  fail: number
  /** 成功率 % */
  succ_rate: number
  /** 有竞价溢价数据的样本数 */
  n_prem: number
  prem_open_avg: number | null
  prem_open_med: number | null
  prem_close_avg: number | null
  prem_close_med: number | null
  /** 失败组的次日开盘均值（负值 = 亏损） */
  fail_open_avg: number | null
  fail_open_med: number | null
}

export interface PromoSummary {
  filter: { stage: string | null; board: string | null; start: string | null; end: string | null }
  date_range: string
  rows: PromoSummaryRow[]
  ts: string
}

/** 单条晋级事件（逐票） */
export interface PromoEvent {
  date: string
  prev_date: string
  code: string
  name: string
  /** 前一交易日板数 */
  prev_boards: number
  /** 当日板数（0 = 断板） */
  boards: number
  /** 晋级阶段，如 '3to4' */
  stage: string
  /** 是否晋级成功 */
  ok: boolean
  sector: string
  seal_min: number | null
  broken: number | null
  seal_fund_yi: number | null
  /** 次日竞价开盘涨幅 */
  prem_open1: number | null
  prem_close1: number | null
  prem_close2: number | null
  prem_ok: boolean
}

export interface PromoDaily {
  date: string
  prev_date: string
  events: PromoEvent[]
}

// ── 股性基因层（scripts/zt_genes.py · 统计窗口统一近 250 交易日）──

/** gene_{code}.json —— 个股股性档案 */
export interface GeneProfile {
  code: string
  name: string
  industry: string
  /** 涨停次数 */
  zt_n: number
  /** 最高连板 */
  max_lbc: number
  /** 平均首封时间（分钟数，越小越早） */
  seal_avg_min: number | null
  /** 炸板率 */
  broken_rate: number | null
  /** 晋级成功率 */
  promo_rate: number | null
  prem_open_avg: number | null
  prem_close_avg: number | null
  hi_open_zt_ratio: number | null
  low_open_zt_ratio: number | null
  /** 股性分 0-100 */
  gene_score: number
}

/** hist_{code}.json —— 历史涨停基因（新浪不复权日K自算，1500 根） */
export interface GeneHistory {
  code: string
  first_day: string
  last_day: string
  zt_total: number
  /** 近 250 日涨停次数 */
  zt_250: number
  /** 近 500 日涨停次数 */
  zt_500: number
  max_boards_hist: number
  /** 连板序列 */
  board_seq: number[]
  promo_rate_hist: number | null
  prem_open_hist: number | null
  prem_close_hist: number | null
  first_prem_open_hist: number | null
  /** 样本 K 线根数 */
  sample_n: number
}

export interface GeneSummaryItem {
  code: string
  name: string
  industry: string
  gene_score: number
  zt_n: number
  max_lbc: number
  promo_rate: number | null
  prem_close_avg: number | null
  broken_rate: number | null
  zt_boards: number
  seal_min: number | null
}

export interface GeneSummary {
  date: string
  count: number
  top: GeneSummaryItem[]
}

export interface GenePoolItem {
  code: string
  name: string
  zt_boards: number
  zt_days: number
  zt_times: number
  seal_min: number | null
  last_seal_min: number | null
  broken: number | null
  seal_fund_yi: number | null
  pct: number
  /** 换手率 */
  hs: number
  industry: string
}

export interface GenePoolFile {
  date: string
  pool: GenePoolItem[]
  ts: string
}

// ── 情绪周期（窗口分层：当日=执行层 / 3日=方向层 / 5日=纪律层 / 10日=归纳层）──

export interface EmotionDay {
  date: string
  sentiment_score: number
  sentiment_label: string
  /** ⚠️ 盘前可能为 null */
  zt_count: number | null
  promote_rate: number
  nuke_count: number
  /** ⚠️ 盘前可能为 null */
  max_boards: number | null
  /** 是否冰点种子日 */
  seed: boolean
  /**
   * 日频归档早期记录可能未生成题材聚合；缺失表示无可用归因，不能当作空题材或 0。
   */
  main_themes?: string[]
}

/** 情绪日档（`cache/short_term/daily/emotion_*.json`）· 周期温度历史原始事实。 */
export interface EmotionDailySnapshot {
  sentiment_model?: string
  date: string
  prev_date?: string
  prev_zt_count?: number | null
  zt_count?: number | null
  promote_rate?: number | null
  lb_promote_rate?: number | null
  avg_pct?: number | null
  up_rate?: number | null
  nuke_count?: number | null
  break_count?: number | null
  max_boards?: number | null
  prev_max_boards?: number | null
  sentiment_score?: number | null
  sentiment_label?: string | null
  generated_ts?: string
}

/** 3 日窗转折信号 —— `ebb_warn` = 假修复，`repair_warn` = 修复前兆 */
export interface EmotionTurnSignal {
  /** 'repair' | 'ebb' | 'flat' */
  dir: string
  label: string
  ma3_last: number
  sentiment_seq_last3: number[]
  /** 当日 vs 3日窗的背离描述 */
  divergence: string
}

export interface EmotionTrajectory {
  sentiment_seq: number[]
  promote_seq: number[]
  nuke_seq: number[]
  zt_seq: (number | null)[]
  /** 3 日移动均（拐点确认用，噪声最少、滞后 1 日） */
  sentiment_ma3: number[]
  ma3_window: number
  turn_signal: EmotionTurnSignal
}

export interface EmotionNewsBlock {
  date: string
  count: number
  titles: string[]
}

export interface EmotionSummary5D {
  generated_ts: string
  window_days: number
  days: EmotionDay[]
  trajectory: EmotionTrajectory
  /** 周期提示，如「修复/升温（近3日回升）」 */
  cycle_hint: string
  news: EmotionNewsBlock[]
  rotation: Record<string, unknown>
  cycle_why: Record<string, unknown>
  summary10: Record<string, unknown>
}

/** 盘中涨停时序的单个窗口 */
export interface ZtIntradayPoint {
  /** 窗口标签，如 '09:00' */
  window: string
  /** 快照时间戳文案 */
  ts: string
  /** 板块 → 家数 */
  themes: Record<string, number>
  total: number
  max_boards: number
}

/**
 * 盘中涨停时序。
 *
 * ⚠️ **实测 `cache/zt_history/` 里存在两套形态**（归档脚本迭代导致）：
 *   · 新形态：带 `intraday_points`（逐窗口盘中点）+ `intraday_only` 标记
 *   · 旧形态：与 `ZtPoolSnapshot` 同构 —— 有 `zt_count` / `ladder` / `top_codes` /
 *     `zt_list`，但**完全没有 `intraday_points`**
 *
 * 因此下方字段全部为可选：调用方必须先判 `intraday_points` 是否存在，
 * 不能假设「这是时序文件就一定有点」。旧形态虽然画不出节奏图，
 * 但带来了 `zt_list` 全量明细 —— 反而比新形态信息更多。
 */
export interface ZtHistoryDay {
  date: string
  date_raw?: string
  generated_ts?: string
  /** true = 该文件仅有盘中点、无盘后 zt_list（当日归档残缺） */
  intraday_only?: boolean
  /** ⚠️ 旧形态归档没有此字段 */
  intraday_points?: ZtIntradayPoint[]
  /** 以下为旧形态（= 涨停池快照）字段 */
  zt_count?: number
  tc?: number
  max_boards?: number
  ladder?: ZtPoolLadder
  top_codes?: ZtPoolTopCode[]
  zt_list?: ZtPoolStock[]
}

/** 情绪快照（memory_lib 情绪联动唯一数据源） */
export interface MarketMemoryState {
  sentiment: string
  total_zt: number
  sentiment_change_at: string
  dominant_sector: string
  index_trend: string
}

/**
 * 当日被推送过的题材 —— 「今天系统推过什么」的客观台账。
 *
 * ⚠️ 实测（2026-09-16）为**对象数组**，不是 `string[]`。
 *    早期定义写成 `string[]` 会让 `{t}` 渲染出 `[object Object]`，
 *    且因类型宽松而无人察觉。
 */
export interface MarketMemoryPushedTopic {
  name: string
  /** 'sector' 等 —— 推送对象的类型标签 */
  type: string
  first_pushed: string
  last_pushed: string
  push_count: number
  context: string
  last_catalyst: string
}

/** 情绪事件流条目 —— 盘中情绪生变的逐条留痕 */
export interface MarketMemoryEvent {
  time: string
  event: string
  /** 'high' 等严重度；原系统未枚举，故保持 string */
  severity: string
  topic: string
}

/**
 * 前一日题材 Top —— 实测与 `ThemeTop` 同构（含 leader / followers / zt_stocks）。
 *
 * 此处**保持可选**而非直接复用 `ThemeTop`：该字段在早期归档里可能只有
 * `rank/name/desc` 三项，直接复用会把「旧归档」判成类型错误。
 */
export interface MarketMemoryTop5 {
  rank: number
  name: string
  desc: string
  zt_count?: number | null
  turn_avg?: number | null
  total_stocks?: number | null
  leader?: ThemeLeaderDetail | null
  followers?: ThemeFollower[]
  zt_stocks?: ThemeZtStock[]
  diffusion?: string
  risks?: string[]
  positives?: string[]
  delta?: string
  zt_prev?: number | null
}

export interface MarketMemory {
  date: string
  updated_at: string
  market_state: MarketMemoryState
  pushed_topics: MarketMemoryPushedTopic[]
  event_log: MarketMemoryEvent[]
  last_push_by_task: Record<string, string>
  prev_top5: MarketMemoryTop5[]
}

// ── AI 判断平行台账（两本独立账：脚本轨 account_nav_history / AI 轨 ai_nav_history）──

export interface AiViewItem {
  /** 'participate' | 'watch' | 'skip' */
  view: string
  reason: string
  factors: Record<string, unknown>
  /** AI 自定高开上限。⚠️ 生效值恒取用户纪律 5%（见 ai_caliber.USER_ENTRY_MAX_GAP_PCT） */
  entry_max_gap: number
  /** 盘后预案档：focus 重点看 / normal 一般 / avoid 回避（09:25 池内裁决据此排序与否决） */
  bias?: string
  /**
   * ⛔ 硬否决兜底留痕：仅 `avoid` 无四类硬伤而被降级为 `normal` 时非空。
   * `normal` 与机械强龙的差异已由 09:25 融合排序处理，只在原始预案、机械事实与最终裁决中留痕，不告警。
   */
  bias_warning?: string | null
}

export interface AiViewFile {
  date: string
  decision_date: string
  /** code → 判断 */
  views: Record<string, AiViewItem>
}

// ── 09:25 池内裁决终态（wealth_code/core/pool_call.py · `pool_call-<执行日>.json`）──

/**
 * 单个标的的**今晨裁决结果**。
 *
 * ⚠️ 与 `AiViewItem` 的关键区别：本结构的 `view` 是**竞价后定音**（实际怎么做），
 * 而 `bias` 只是**昨日盘后预案档**（输入）。展示「这笔交易到底做没做」必须读 `view`。
 */
export interface PoolCallView {
  leader_role?: '龙头' | '准龙头' | '跟风' | null
  leader_evidence?: LeaderEvidence
  status_rank?: number
  code: string
  name: string
  /** 今晨竞价涨幅 %（缺竞价数据时为 null） */
  gap_pct: number | null
  /** 竞价落在哪：ok 区间内 / above 超上限 / below 低于下沿 / unknown 无量价 */
  zone: string
  /** 昨日盘后预案档（focus 重点看 / normal 一般 / avoid 回避）—— **输入**，非结论 */
  bias: string
  /** 今晨竞价成交额（亿） */
  amount_yi: number | null
  /** 该票要求的量能线（亿） */
  need_yi: number | null
  theme_name: string
  boards: number
  /** 该票是否为所在方向的核心（核心不受跟风闸限制） */
  line_is_core: boolean
  /** 机械强龙事实（接力池第1或09:30前封板，且未命中四类硬伤） */
  mechanical_leader?: boolean
  /** 机械强龙依据，供预案与09:25排序背离复核 */
  mechanical_leader_note?: string | null
  /** 同方向核心票（用于判断龙头/跟风），无则为 null */
  line_core: { code: string; name: string; boards: number; broken: boolean } | null
  /** 在自身方向内的排名（1 = 龙一） */
  line_rank: number
  /** 该方向最高板数（用于判断身位差） */
  line_max_boards?: number
  /** 该票相对方向最高板的身位差（0 = 就是最高） */
  gap_to_top?: number
  /** 全市场最高板 */
  market_max_boards?: number
  /** 该方向最高板的票名列表 */
  line_tops?: string[]
  /** 方向梯队一句话解释（为何这条线还站得住） */
  line_tier_why?: string
  /** 带动家数 */
  carry_cnt?: number
  /** 接力阶段：one_to_two / two_to_three / high … */
  relay_stage?: string
  /** 该阶段的情绪判断（insufficient / ok …） */
  relay_mood?: string
  /** 昨日封板质量（换手 / 封单占流通 / 首封时刻） */
  seal_quality?: {
    hs_pct?: number | null
    seal_ratio_pct?: number | null
    fbt_hm?: number | null
    pos10_pct?: number | null
  } | null
  /** 是否 20cm 标的（判断竞价涨停幅阈值用） */
  is_20cm?: boolean
  /** 题材联动事实（昨日该题材涨停家数、数据完整性） */
  linkage_facts?: {
    schema?: string
    theme?: string
    eod_status?: string
    theme_pool_zt_count?: number | null
    theme_effective_zt_count?: number | null
    data_quality?: string
    source_conflict?: boolean
  } | null
  /**
   * 四条件闸缺项（`pipeline_eod.apply_high_win_gate` 的留痕）。
   * 只含「情绪」= **纯市场级**被压住（个股与方向成立，属冻结非否决）；
   * 掺入题材龙/量能/梯队等 = 个股级，不在「命中」范畴。
   */
  high_win_gate?: string[] | null
  /** 终态：participate 参与 / watch 观察 / skip 放弃 */
  view: string
  /** 买入名额序（1 起；仅 participate 有，其余为 null） */
  quota_rank: number | null
  /** 裁决理由（短句，含竞价涨幅与区间判定） */
  reason: string
}

export interface PoolCallFile {
  /** 执行日（= `ai_view.date`；前一交易日盘后写的预案在这天执行） */
  trade_date: string
  enabled: boolean
  /** 当日取向：attack / selective / defend … */
  stance: string
  /** 买入名额上限 */
  quota: number
  /** code → 裁决终态 */
  views: Record<string, PoolCallView>
  meta: {
    caliber: string
    stance: string
    /** 名义名额 */
    quota: number
    /** 生效名额（被市场环境压过之后，可能是 0） */
    effective_quota?: number
    pool_size: number
    /** 实际成交（名额内）的 code 列表 */
    participate: string[]
    /** 裁决执行时刻 */
    call_at: string
    /** 今晨情绪体检（昨涨停池竞价红开与量能），用于解释「为什么没买」 */
    market_open?: {
      enabled?: boolean
      pool_size?: number
      quoted?: number
      coverage?: number
      red_open_count?: number
      red_open_ratio?: number
      leader_count?: number
      leader_red_open_count?: number
      leader_red_open_ratio?: number
      leader_volume_median_ratio?: number
      leader_volume_pass_ratio?: number
      ready?: boolean
      reason?: string
    }
    market_open_relief?: boolean
    /**
     * 环境防守腿（`wealth_code/core/defense_gate.py`）。
     *
     * ⛔ `env.hits` 是**已排版好的白话句子**（如「今天开盘昨天涨停的票只有 27% 红开」），
     *    「今天为什么没买」在 meta 层只有一个权威来源就是它 ——
     *    ⛔ 不要用 `hit_count` 或阈值数字二次拼装，拼出来的是指标，不是原因。
     *    命中 ≥5 条 → 名额压到 0；≥3 条 → 压到 1 只。
     */
    defense?: {
      enabled?: boolean
      env?: {
        level?: string
        hits?: string[]
        hit_count?: number
        notes?: string[]
      }
      /** 各条防守腿拦下的票（有值说明是「个股级」拦，不是环境级） */
      distribution_blocked?: Array<{ code: string; name?: string; note?: string }>
      distribution_thin_late_blocked?: Array<{ code: string; name?: string; note?: string }>
      sector_drain_blocked?: Array<{ code: string; name?: string; note?: string }>
      position_blocked?: Array<{ code: string; name?: string; note?: string }>
      /** 每条题材线的锚点态度 + 状态标签 + 一句话判词。
          ⚠️ 2026-11-10 晚文案定稿：label 只给**状态**（超预期 / 符合预期 / 略低于预期 /
          错杀 / 低于预期 / 未达预期 / 一字 / 大高开），**动作**由后端 `ATT_ACTION` 给
          （观察接力 / 可低吸 / 不买，看跟风 / 放弃…），前端⛔ 不自己拼结论。 */
      anchor?: {
        enabled?: boolean
        lines?: Record<
          string,
          {
            code: string
            name: string
            boards: number
            attitude: string
            label: string
            /** 后端给的**动作**（观察接力 / 可低吸 / 不买，看跟风 / 放弃）；`符合预期` 时为空串。 */
            action?: string
            gap: number
            note: string
          }
        >
      }
    }
    /**
     * 复核通道统计（`two_pool.recheck_class`）：观察票里有多少进了可完整裁决的 state。
     */
    recheck?: {
      enabled?: boolean
      state_full_required?: boolean
      observed?: number
      state_entered?: number
      participated?: string[]
    }
    /** 名额策略留痕：名义 → 生效、均分上限。⛔ 展示只读，不重算。 */
    slot_policy?: {
      min_two_slots?: boolean
      min_two_slots_applied?: boolean
      requested_quota?: number
      effective_quota?: number
      participate_count?: number
      even_cap?: number | null
      allocation_count?: number
    }
    /**
     * 昨日连板 · 今晨竞价溢价榜（2026-11-04 用户）。
     *
     * ⛔ 纯读数：不参与名额裁断。只回答「昨天连板那批票，今早是溢价接还是折价跑」。
     * ⛔ 首板不入榜 —— 首板次日没有获利盘兑现压力，溢价说明不了连板情绪。
     */
    premium_board?: AuctionPremiumBoard
  }
}

/** 竞价溢价单票读数 */
export interface AuctionPremiumRow {
  code: string
  name: string
  boards: number
  theme: string
  /** 同题材昨日涨停家数（含首板，线宽本身就是强度） */
  theme_hot: number
  amount_yi: number | null
  /** 竞价涨幅（%）· 缺报价为 null，不拿 0 冒充 */
  gap_pct: number
  verdict: 'premium' | 'flat' | 'discount'
}

/** 昨日连板 · 今晨竞价溢价榜 */
export interface AuctionPremiumBoard {
  schema: string
  prev_date: string
  trade_date: string
  min_boards: number
  count: number
  premium_count: number
  flat_count: number
  discount_count: number
  premium_ratio: number | null
  avg_gap: number | null
  median_gap: number | null
  by_boards: Record<
    string,
    { count: number; premium_count: number; avg_gap: number | null; median_gap: number | null; names: string[] }
  >
  rows: AuctionPremiumRow[]
  /** 报价缺失的票名（⛔ 不是平开，是没数据） */
  no_quote: string[]
}

/**
 * 池内台账 · 当日收盘结算（`cache/pool_ledger/<date>.json` · `scripts/pool_ledger.py`）。
 *
 * ## 这份数据唯一要回答的事
 *
 * 「**今天这些票，09:25 买了、拿到收盘，到底赚没赚**」——全系统唯一一处把
 * 「事前裁决」和「事后结算」放在同一行里的数据。
 *
 * ⛔ 三条不可误读的口径：
 *   1. `au_ret` = **09:25 竞价价买 → 当日收盘卖**。这才是「照单全买会怎样」；
 *      `oc_ret`（开盘价买）与 `chg_pct`（昨收→收盘）只是对照，三者不可混用。
 *   2. `one_word`（一字板）与 `sealed_auction`（竞价已封死）**买不进**，
 *      `tradable=false` 且**不计入任何汇总** —— 把买不进的涨停算成收益是虚报。
 *   3. 文件缺失 = **当日收盘 K 线尚未落盘**（脚本 `exit 2` 不写半截文件），
 *      不是「今天没票」，更不是 0 收益。
 */
export interface PoolLedger {
  date: string
  generated_at: string
  source: Record<string, string>
  coverage: {
    pool: number
    quoted: number
    kline: number
    /** 池内票在竞价快照里查不到（采集漏采，⛔ 与「没竞价」不是一回事） */
    missing_quotes: string[]
    missing_kline: string[]
  }
  stance: string
  quota: number
  effective_quota: number
  summary: {
    pool: number
    /** 可成交只数（剔除一字与竞价封死） */
    tradable: number
    one_word: number
    sealed_auction: number
    /** 当日封板的只数 */
    sealed: number
    /** 主口径：竞价价买 → 当日收盘卖 */
    auction_buy_close_sell: PoolLedgerAgg
    /** T+1 口径：竞价价买 → **次日**收盘卖（次日 K 线未落盘时 n=0） */
    auction_buy_next_close_sell?: PoolLedgerAgg
    by_view: Record<string, PoolLedgerAgg>
    by_gap_band: Record<string, PoolLedgerAgg>
    /** 按 DEV（今开 − 该票自身质量预期）分档；旧冻结件无 DEV 字段时为空 */
    by_dev_band?: Record<string, PoolLedgerAgg>
  }
  rows: PoolLedgerRow[]
}

/** 一组票的收益汇总（均值为百分数） */
export interface PoolLedgerAgg {
  n: number
  avg: number
  med: number
  /** 胜率（%） */
  win: number
  max: number
  min: number
}

/** 台账单票结算行 */
export interface PoolLedgerRow {
  code: string
  name: string
  boards: number
  /** 涨停幅度：10 / 20（判「竞价封死」用） */
  limit_up_pct: number
  /** 今开幅度（%），由竞价价 / 昨收算出 */
  gap_pct: number | null
  auction_price: number | null
  prev_close: number | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  /** 竞价成交额（亿） */
  amount_yi: number | null
  /** 当日所需竞价额下限（亿） */
  need_yi: number | null
  theme: string
  /** 09:25 裁决：participate / watch / skip */
  view: string
  /** 复核等级：state / restricted / hard */
  recheck_class: string
  /** 裁决理由原文（已是白话，直接展示，⛔ 不要二次拼装） */
  reason: string
  /** 当日涨幅（昨收→收盘，%） */
  chg_pct: number | null
  /** ⭐ 竞价价买 → 收盘卖（%）＝ 这份数据的主口径 */
  au_ret: number | null
  /** 开盘价买 → 收盘卖（%） */
  oc_ret: number | null
  /** T+1 口径：竞价价买 → **次日**收盘卖（%）；次日未落盘 → null，⛔ 不用当日收盘顶 */
  t1_ret?: number | null
  /** T+1 卖出的那一天（YYYY-MM-DD） */
  t1_date?: string | null
  /** DEV = 今开 − 该票自身质量预期（09:25 冻结件里的 gap_vs_expected）；旧件无此字段 → null */
  dev?: number | null
  one_word: boolean
  sealed_auction: boolean
  sealed: boolean
  /** 是否可成交（一字/竞价封死为 false，不计入汇总） */
  tradable: boolean
  /** 竞价价与开盘价的偏离（pct）；>0.5 值得怀疑数据错配 */
  price_mismatch: number | null
}

export interface AiDecisionEntry {
  decision_date: string
  code: string
  name: string
  reason: string
  factors: Record<string, unknown>
  /** 盘后候选冻结时的排序评分，满分 100；缺失表示历史台账未保存且候选档案不可用。 */
  ranking_score?: number
  entry_max_gap: number
  position: number
  /** 'participate' | 'watch' | 'skip' */
  view: string
  source: string
  ts: string
  settled: boolean
}

export interface AiNavStock {
  code: string
  name: string
  auction_price: number
  close: number
  return_pct: number
  reason: string
}

export interface AiNavEntry {
  trade_date: string
  recommendation_date: string
  strategy: string
  stock_count: number
  avg_return_pct: number
  /** 净值，起点 1.0 */
  nav: number
  stocks: AiNavStock[]
  skipped: unknown[]
  decided: number
}

export interface AccountNavStock {
  code: string
  name: string
  /** 该票从系统成交价到当日结算价的实际收益（%）；旧账本可缺失 */
  return_pct?: number
  [k: string]: unknown
}

export interface AmbushPullbackSnapshot {
  hot_date?: string
  sector_zt_count?: number
  max_boards?: number
  close?: number
  ma10?: number
  ma10_gap_pct?: number
  volume_ratio?: number
  score?: number
  [k: string]: unknown
}

/** 尾盘潜伏 14:30 冻结信号；研究记录，不等于真实成交。 */
export interface AmbushPullbackSignalEntry {
  strategy: string
  decision_date: string
  code: string
  name: string
  status: string
  planned_entry_time: string
  planned_exit_time: string
  entry_price: number | null
  exit_price: number | null
  return_pct: number | null
  candidate_snapshot: AmbushPullbackSnapshot
  recorded_at: string
}

/** 尾盘潜伏 14:50 至次交易日 10:00 的研究结算。 */
export interface AmbushPullbackSettlementEntry {
  strategy: string
  decision_date: string
  trade_date: string
  code: string
  name: string
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  return_pct: number
  status: string
}

/** 尾盘潜伏「账户当日收益」（动态仓位加权后）。2026-10-15 起取代满仓连乘口径。 */
export interface AmbushWeightedPnlEntry {
  decision_date: string
  trade_date: string | null
  /** 账户当日收益（动态仓位加权后，%） */
  weighted_return_pct: number
  /** 截至该决策日的复利净值（base 1.0） */
  nav: number
  stock_count: number
  plan: {
    tier: string | null
    per_pick_cap: number
    total_cap: number
    /** 缺当日 relay 动态仓位方案 → 走中性档兜底（诚实降级） */
    missing: boolean
  }
  stocks: Array<{
    code: string | null
    name: string | null
    return_pct: number
    weight: number
  }>
}

export interface AccountNavEntry {
  trade_date: string
  recommendation_date: string
  strategy: string
  /** 口径标记：'ai' | 'mechanical_fallback' */
  caliber?: string
  note?: string
  stock_count: number
  avg_return_pct: number
  nav: number
  codes: string[]
  names: string[]
  stocks: AccountNavStock[]
}

export interface StrategyMetricsRecord {
  recommendation_date: string
  trade_date: string
  sample_count: number
  tradable_count: number
  metrics: Record<string, number | null>
}

export interface StrategyMetricsFile {
  schema: string
  generated_at_bj: string
  records: StrategyMetricsRecord[]
  latest_recommendation_date: string
  latest_trade_date: string
}

// ── 决策黑匣子存档清单 ──

export interface DecisionManifestSource {
  role: string
  src: string
  dst: string
  bytes: number
  sha256: string
}

export interface DecisionManifest {
  date: string
  schema: string
  archived_at: string
  sources: DecisionManifestSource[]
  summary: Record<string, unknown>
  /** 存档缺口（该日缺了哪些来源） */
  gaps: unknown[]
}

// ── 龙虎榜（资金性质：机构 vs 游资）──

export interface LhbInstitutionItem {
  code: string
  name: string
  days_on_board: string
  /** 机构买入（亿） */
  inst_buy_yi: number
  net_yi: number
}

export interface LhbHotmoneySeat {
  seat: string
  /** ⚠️ **对象数组**（`{code, name}`）—— 早期类型写的 `string[]` 是错的 */
  stocks: LhbHotmoneyStock[]
  amount_yi: number
}

export interface LhbHotmoneyStock {
  code: string
  name: string
}

export interface LhbTencentFile {
  date: string
  institution: LhbInstitutionItem[]
  hotmoney: LhbHotmoneySeat[]
  generated_ts: string
}

export interface HithinkLhbConcept {
  name: string
}

export interface HithinkLhbOrg {
  code: string
  name: string
  org_net_yi: number
  net_yi: number
  /** ⚠️ **对象数组**（`{name}`），不是字符串数组 */
  concepts: HithinkLhbConcept[]
}

export interface HithinkLhbHotmoney {
  seat: string
  buy_yi: number
  /** ⚠️ **对象数组**（`{code, name}`），不是字符串数组 */
  stocks: LhbHotmoneyStock[]
}

export interface HithinkLhbStock {
  ticker: string
  name: string
  concept_list?: HithinkLhbConcept[] | null
  /** 同花顺原始金额单位为元；缺失不能当作零。 */
  net_value?: number | null
  range_days: 1 | 3
  /** 小数比例，展示百分比时需乘以100。 */
  change?: number | null
  org_net_value?: number | null
  hot_money_net_value?: number | null
  /** 以下字段实测存在于 `stocks[]`（2026-10-19 归档逐字段核对），全部按元计。 */
  buy_value?: number | null
  sell_value?: number | null
  net_rate?: number | null
  hot_rank?: number | null
  thscode?: string | null
  /** 涨停原因原文（只有当日涨停的上榜股才有）。 */
  limit_reason?: string | null
}

export interface HithinkLhbFile {
  source: string
  date: string
  generated_ts: string
  stock_count: number
  org_top5: HithinkLhbOrg[]
  hotmoney_top5: HithinkLhbHotmoney[]
  stocks: HithinkLhbStock[]
}

// ── 同花顺专业数据（scripts/hithink_fetch.py · 盘前/盘后第二权威）──

export interface HithinkZtItem {
  code: string
  name: string
  boards: number
  /** 首封时间，如 '09:25' */
  fbt: string
  /** 封单（亿） */
  seal_yi: number
  pct: number
  /** 涨停原因（必盈注入） */
  reason: string
  is_st: boolean
}

export interface HithinkZtFile {
  source: string
  date: string
  generated_ts: string
  total: number
  zt_count: number
  excluded_688: number
  excluded_st: number
  items: HithinkZtItem[]
  items_raw: Array<Record<string, unknown>>
}

/**
 * 涨停池双源校验差异（同花顺 vs 必盈）。
 *
 * ⚠️ **实测纠错（2026-09-16）**：`only_biying` / `only_hithink` 是**股票代码字符串数组**，
 *    不是对象数组 —— 类型标的 `Record<string, unknown>[]` 虽宽松但会误导渲染层。
 */
export interface HithinkZtDiffFile {
  date: string
  /** 必盈口径涨停家数 */
  biying_count: number
  /** 同花顺口径涨停家数 */
  hithink_count: number
  /** 两源一致家数 */
  both: number
  /** 仅必盈有的代码 */
  only_biying: string[]
  /** 仅同花顺有的代码 */
  only_hithink: string[]
}

export interface HithinkLadderWindow {
  length: number
  date_list: string[]
  /** 各板高的家数上限 */
  board_caps: Record<string, number>
}

/** 天梯单票（同花顺连板天梯 · 仅 2 板以上） */
export interface HithinkLadderStock {
  thscode: string
  ticker: string
  name: string
  board_num: number
  /** 次日是否封板（窗口内历史回溯字段，最新日多为 null） */
  seal_nextday: boolean | null
  sign_level: number
}

export interface HithinkLadderItem {
  date: string
  /** 板高档位 → 该档票列表。档位键实测为 two_board…seven_over */
  boards: Record<string, HithinkLadderStock[]>
}

export interface HithinkLadderFile {
  source: string
  generated_ts: string
  window: HithinkLadderWindow
  items: HithinkLadderItem[]
}

export interface HithinkAuctionBenchmark {
  thscode: string
  ticker: string
  name: string
  auction_pct: number
  tags: string[]
}

export interface HithinkAuctionFile {
  source: string
  date: string
  generated_ts: string
  benchmark: HithinkAuctionBenchmark[]
}

/** 同花顺异动原因条目（2026-09-16 读真实文件确认字段） */
export interface HithinkAnomalyItem {
  code: string
  name: string
  /** 异动标签：'涨停' | '跌停' | '大涨' | '大跌' */
  tag: string
  /** AI 生成的异动说明原文 */
  content: string
  keywords: string[]
}

/** 同花顺异动原因（单份 250-300KB，路由只取最新一期） */
export interface HithinkAnomalyFile {
  source: string
  date: string
  generated_ts: string
  /** 抓取总数 */
  total: number
  /** 过滤后条数（剔除 688 / ST 后） */
  filtered: number
  excluded_688: number
  excluded_st: number
  /** 按标签计数：{涨停, 跌停, 大涨, 大跌} */
  stats: Record<string, number>
  items: HithinkAnomalyItem[]
}

/** 同花顺估值单票（任一指标可为 null） */
export interface HithinkValuationItem {
  pe?: number | null
  pb?: number | null
  ps?: number | null
  pcf?: number | null
}

/**
 * 同花顺估值。
 *
 * ⚠️ **实测纠错（2026-09-16）**：此前类型写 `items: Array<...>`，真实结构是
 *    **`values`：code → 估值对象**。按 `items` 渲染会静默读空 —— 这类
 *    「类型与数据反向」的错，只能靠读真实文件发现。
 */
export interface HithinkValuationFile {
  source: string
  date: string
  generated_ts: string
  requested: number
  got: number
  values: Record<string, HithinkValuationItem>
}

// ── 机构投研 ──

export interface InstitutionPoolItem {
  code: string
  name: string
  /** 机构关注逻辑（一句话） */
  theme: string
}

export interface InstitutionPoolFile {
  date: string
  count: number
  items: InstitutionPoolItem[]
}

// ── 题材与消息史 ──

export interface EruptionStock {
  code: string
  name: string
  pct: number
  /** 市值（亿） */
  cap_yi: number
  /** 是否龙头 */
  dragon: boolean
}

export interface EruptionTheme {
  name: string
  themeCode: string
  zt: number
  pct: number
  /** 区间累计涨幅 */
  cum_pct: number
  /** 催化标题 —— 这是题材的「为什么」 */
  title: string
  stocks: EruptionStock[]
}

export interface EruptionDay {
  date: string
  generated_ts: string
  themes: EruptionTheme[]
}

/** 单条快讯及其题材/个股映射 */
export interface NewsflashHistoryItem {
  title: string
  plates: string[]
  stocks: string[]
}

export interface NewsflashHistoryDay {
  date: string
  generated_ts: string
  newsflash: NewsflashHistoryItem[]
}

export interface WeeklyZtMapEntry {
  name: string
  max_boards: number
  /** 本周涨停日 */
  dates: string[]
  reasons: string[]
}

export interface WeeklyZtMap {
  /** 日期 → 当日涨停家数 */
  day_totals: Record<string, number>
  /** code → 该股本周涨停轨迹 */
  map: Record<string, WeeklyZtMapEntry>
}

// ── 载体证伪 / 五日线 / 影子模式 ──

export interface CarrierItem {
  name: string
  code: string
  boards: number
  zbc: number
  sector: string
  fbt: string
  /** 当日是否确认（封板质量 + 带动性） */
  confirmed?: boolean
  /** 带动家数 */
  carry_cnt?: number
  /** 今日断板（证伪迁移） */
  dead?: boolean
}

export interface CarrierState {
  date: string
  prev_date: string
  carriers_today: CarrierItem[]
  carriers_dead: CarrierItem[]
  /** 迁移叙述，如「瑞尔特(4板·家居用品)承接资金 → 老载体(6家)证伪迁移」 */
  carrier_migration: string
}

export interface Ma5Item {
  code: string
  name: string
  price: number
  ma5: number
  above_ma5: boolean
  /** 相对 MA5 的偏离 % */
  pct_vs_ma5: number
  closes: number[]
  checked_at: string
}

export interface Ma5Status {
  ts: string
  items: Ma5Item[]
  total: number
  above_count: number
  broken_count: number
  broken_list: Ma5Item[]
}

export interface RelayEodItem {
  code: string
  name: string
  theme: string
  boards: number
  /** 分档，null = 未分档 */
  band: string | null
  /** 是否通过入池闸门 */
  pass: boolean
  exclude_reason: string | null
  score_eod: number
}

export interface RelayShadowRanked {
  code: string
  name: string
  theme: string
  boards: number
  score: number
  /** 分档，如 '不入池' */
  band: string
  /** 是否通过入池闸门（与 eod_relay 同义，但打分口径不同） */
  pass?: boolean
  exclude_reason?: string | null
}

export interface RelayShadowEnvDigest {
  regime: string
  sentiment_score: number
  sentiment_label: string
  promote_rate: number
  nuke_count: number
  now_zt_count: number
  max_boards: number
}

/** 影子排序与实际入池的差异 —— 影子模式要回答的核心问题 */
export interface RelayShadowDiff {
  /** 前 3 名中有几只一致 */
  top3_same: number
  /** 参与比对的前 N 名 */
  top_n_compared: number
  /** 影子会推、实际没推的代码 */
  shadow_promoted: string[]
  /** 实际推了、影子没进的代码 */
  eod_only: string[]
}

/** 接力权重影子模式（只观察·不改产池）—— 实际入池 vs 影子排序对照 */
export interface RelayShadow {
  date: string
  generated_ts: string
  source_file: string
  env_digest: RelayShadowEnvDigest
  mode: string
  eod_relay: RelayEodItem[]
  shadow_ranked: RelayShadowRanked[]
  /** 影子分档计数：分档名 → 只数（**不是数组**，早期类型漏了此字段） */
  bands: Record<string, number>
  diff: RelayShadowDiff
}

// ── 风险监控 ──

export interface RiskWatchItem {
  code: string
  name: string
  boards: number
  sector: string
  checked: boolean
  risk_labels: string[]
  pledge_pct: number | null
  notice_count: number
  notices: Array<Record<string, unknown>>
}

export interface RiskWatchFile {
  date: string
  generated_ts: string
  /** 口径说明，如「涨停池板数 Top8（高标风险面）」 */
  scope: string
  items: RiskWatchItem[]
}

// ── 推测回测报告（三类指标唯一口径：候选命中 / 区间命中 / 情绪对齐）──

export interface BacktestMetricBlock {
  available: boolean
  /** 不可用时说明原因（如样本不足） */
  reason?: string
  evaluable?: number
  hit_count?: number
  hit_rate?: number | null
  rows?: Array<Record<string, unknown>>
}

export interface BacktestReport {
  schema: string
  generated_at: string
  /** 结算日 */
  settle_date: string
  /** 推荐日 */
  rec_date: string
  metrics: {
    candidate_hit: BacktestMetricBlock
    range_hit: BacktestMetricBlock
    sentiment_align: BacktestMetricBlock
  }
  summary: {
    candidate_hit_rate: number | null
    range_hit_rate: number | null
    sentiment_diff: number | null
  }
}

// ── 卡片存档（决策过程的可追溯原件）──

export interface CardArchiveFile {
  /** 各卡结构不同，此处保留宽松形状；渲染时按实际字段取用 */
  title?: string
  [k: string]: unknown
}

// ── 盘中脉冲窗口存档 ──

export interface PulseWindowElement {
  /** 飞书元素类型，如 'div' */
  tag: string
  /** 元素内容（div 时为对象） */
  text: Record<string, unknown> | string
}

export interface PulseWindow {
  /** 卡标题，含窗口时间与题材 */
  title: string
  /** 色标：'red' | 'grey' 等 */
  color: string
  elements: PulseWindowElement[]
  /** 页脚说明 */
  note: string
}

// ── 推送状态与审计 ──

/** 当日推送信号状态。⚠️ 文件极小/为空 = 该日事件链零产出的故障信号 */
export interface PushedSignals {
  zt_codes: string[]
  /** code → 推送时间戳（限频用） */
  surge_codes: Record<string, string>
  nf_titles: string[]
  sector_pushed: string[]
  strong_codes: string[]
  charge_codes: string[]
}

/** 推送审计条目。字段随 event 类型变化，故保留宽松形状 */
export interface AuditEntry {
  ts: string
  /** 'push' | 'config' 等 */
  event: string
  module?: string
  action?: string
  rule?: string
  target?: string
  before?: unknown
  after?: unknown
  snapshot?: string
  [k: string]: unknown
}

// ────────────────────────────────────────────────────────────────
// 系统台账与运维（2026-09-16 增量：补齐「后端有产出、前端无路由」的能力）
// ────────────────────────────────────────────────────────────────

/**
 * 自动化任务台账条目 —— 由 `config/tasks.yaml` **原文解析**而来。
 *
 * ⚠️ 它不是 JSON：该文件是 YAML，路由以 `format: 'text'` 原样返回字符串，
 *    前端只解析**自己需要的子集**（name/id/kind/rrule/webhook/writeback）。
 *    只解析子集是刻意的 —— 本文件未使用锚点、多行标量、嵌套映射等 YAML 特性，
 *    为它引入一个 YAML 解析依赖不划算（本项目依赖刻意收敛）。
 */
export interface TaskLedgerEntry {
  name: string
  /** automation id，与平台任务库对应（如 automation-1785767165508） */
  id: string
  /** 骨架类型：骨架A / 骨架B / pipeline / 脚本 / 机构投研 … */
  kind: string
  /** rrule 原文；PAUSED / 已删除任务可能没有 */
  rrule?: string
  /** 推送目标：auto / feishu_webhook_test … */
  webhook?: string
  /** 写回目标；`null` = 不回写 */
  writeback?: string
}

/** `config/learning_config.json` —— 自学习阈值配置 */
export interface LearningConfig {
  schema: string
  updated: string
  note: string
  /** ⚠️ 实测为布尔（Python True/False 序列化后即 true/false），非字符串 */
  auto_apply: boolean
  /** 单次最大调整步长 */
  max_adjust_step: number
  /** 统计窗口天数 */
  window_days: number
  /** 规则名 → 参数对象（各规则结构不同，保留原始键） */
  rules: Record<string, unknown>
}

/** `config/short_spirit.json` —— 短线精灵阈值（用户 2026-08-18 定的可调参数） */
export interface ShortSpiritConfig {
  note?: string
  min_pct: number
  min_market_cap_yi: number
  amount_morning_yi: number
  amount_afternoon_yi: number
  max_new_stock_days: number
  top_per_sector: number
  max_signals: number
  [k: string]: unknown
}

/** 通用规则配置文件（`wealth_code/config/*.json`）—— 三者 schema 各异，保留原始键 */
export interface RuleConfigFile {
  schema?: string
  updated?: string
  note?: string
  desc?: string
  version?: string
  [k: string]: unknown
}

/** 盘中引擎状态件外壳（4 件结构各异，按文件名区分：boost_state / pulse_pending / …） */
export interface EngineStateFile {
  ts?: number
  date?: string
  [k: string]: unknown
}

/** `cache/decision_log/index.jsonl` 单行 —— 黑匣子总目录 */
export interface ArchiveIndexEntry {
  date: string
  archived_at: string
  schema: string
  sources: number
  relay: number
  watch: number
  ai_view: string | null
  cards: number
  gaps: number
}

/** 晋级量化回测行（`cache/promo/backtest_*.json`） */
export interface PromoBacktestRow {
  /** 分组键（板块名 / 板数 / 日期，取决于该份报告的分组维度） */
  key: string
  n: number
  ok: number
  fail: number
  /** 成功率 % */
  succ_rate: number
  prem_open1?: number | null
  prem_close1?: number | null
  prem_close2?: number | null
  [k: string]: unknown
}

export interface PromoBacktest {
  title: string
  rows: PromoBacktestRow[]
  ts: string
}

/**
 * 盘中情绪时间轴事件（`cache/intraday_timeline_<YYYYMMDD>.jsonl` · `intraday_timeline.py` 产出）。
 *
 * ⛔ 这是**盘中逐事件**记录（append-only），与收盘口径的 `zt_list` 完全不同：
 *   它同时记录**上涨侧**（涨停总数 / 板块走强 / 个股涨停）与**下跌侧**
 *   （杀跌板块 / 新跌停 / 新炸板），用于还原「整个交易时间的情绪起落」。
 *
 * ⚠️ 诚实边界：`stock_up` 只覆盖「板块领涨精选」（非全量涨停池）；
 *   个股下跌目前**只有跌停**（系统未落盘个股跌幅榜）。
 */
export interface IntradayTimelineEvent {
  /** 记录时刻（真实交易时间 · `YYYY-MM-DD HH:MM:SS`） */
  at: string
  /** 事件类型 */
  kind:
    | 'zt_total'
    | 'sector_up'
    | 'stock_up'
    | 'broken_new'
    | 'limit_down_new'
    | 'sector_down'
    | string
  /** 板块 / 个股名称（`zt_total` 无） */
  name?: string | null
  /** 个股代码（`stock_up`） */
  code?: string | null
  /** 个股所属板块（`stock_up`） */
  sector?: string | null
  /** 涨幅 %（`stock_up` / `sector_down`） */
  pct?: number | null
  /** 板数（`stock_up` · 可能为空串/缺省） */
  boards?: string | number | null
  /** 板块当刻涨停家数（`sector_up`） */
  zt_count?: number | null
  /** 家数增量（`sector_up`）/ 涨停总数增量（`zt_total`） */
  delta?: number | null
  /** 涨停总数（`zt_total`） */
  total?: number | null
  /**
   * 涨停总数变化的完整归因名单。仅当上游两轮全量涨停集合可核对，且集合差分与 `delta` 完全一致时存在。
   * `added` 为新增封板，`removed` 为打开涨停；缺少任一方向明细的旧记录不进入时间轴展示。
   */
  added?: IntradayLimitUpStock[] | null
  removed?: IntradayLimitUpStock[] | null
  /** 主力净流入（元 · `sector_down`） */
  inflow?: number | null
  /** 板块龙头（`sector_up`） */
  leader?: unknown
  [k: string]: unknown
}

/** 涨停集合差分中的个股最小展示字段（来自上游全量涨停池）。 */
export interface IntradayLimitUpStock {
  code: string
  name: string
  pct?: number | null
  boards?: string | number | null
  sector?: string | null
}

/**
 * 竞价三环影子 · 逐日留痕（`scripts/sector_gap_daily_trace.py` 产出）。
 *
 * ⚠️ 这不是裁决产物：`would_cut` 只是「若开守卫会被砍」的平行标记，
 *    09:25 主链从不读取。两套收益并列，禁止混算进账户战绩。
 */
export interface SectorGapStat {
  n: number
  covered: number
  mean: number | null
  median: number | null
  win_rate: number | null
  zt: number
}
export interface SectorGapPair {
  same_close: SectorGapStat
  t1_close: SectorGapStat
}
export interface SectorGapSummary {
  n_tradable: number
  n_v0: number
  n_cut: number
  n_keep: number
  n_veto: number
  n_veto_strict: number
  n_abstain: number
  v0: SectorGapPair
  cut: SectorGapPair
  keep: SectorGapPair
  veto: SectorGapPair
  veto_strict: SectorGapPair
  abstain: SectorGapPair
  cut_better_days: number
  cut_worse_days: number
  cut_better_dates: string[]
  cut_worse_dates: string[]
}
export interface SectorGapDay {
  date: string
  prev: string
  n_quotes: number
  n_prev_zt: number
  coverage: number
  theme_src: string
  n_tradable: number
  n_v0: number
  price_mismatch: number
  cut_codes: string[]
  v0: SectorGapPair
  cut: SectorGapPair
  keep: SectorGapPair
  veto: SectorGapPair
  veto_strict: SectorGapPair
  abstain: SectorGapPair
  delta_t1_pct: number | null
}
export interface SectorGapRow {
  date: string
  code: string
  name: string
  gap: number
  E: number | null
  DEV: number | null
  zone: string
  theme: string | null
  theme_src: string | null
  gap_vs_theme: number | null
  theme_gap_med: number | null
  upper_gap_med: number | null
  credits_n: number | null
  credits_known: number | null
  veto: boolean
  status: string | null
  isolated: boolean
  would_cut: boolean
  R_pct: number | null
  ret_same_close: number
  ret_t1_close: number | null
  t1_date: string | null
  zt_today: boolean
}
export interface SectorGapTrace {
  schema: 'sector_gap_daily_trace_v1'
  generated_at: string
  window: {
    start: string | null
    end: string | null
    nominal_days: number
    active_days: number
    dropped: Array<{ date: string; reason: string }>
  }
  caliber: {
    strategy: string
    same_close: string
    t1_close: string
    excluded: string
    warning: string
    shadow: string
  }
  summary: SectorGapSummary
  days: SectorGapDay[]
  rows: SectorGapRow[]
}

export type { RelayEffect, RelayStock } from './relayEffect'

/**
 * 回测战绩（`scripts/build_backtest_summary.py` 合成 · `/api/research/backtest`）。
 *
 * ⛔ 三条不可误读：
 *   1. `records[]` 是**并列的三套收益口径**（策略=当日收盘 / T+1=次日收盘 / T+1 最保守=次日开盘）。
 *      差额来自 A 股 T+1 制度，⛔ 禁止相加、相减或互相换算。
 *   2. 全部指标由 Python 侧算好（`sharpe` / `t` / `mdd` / `pl_ratio`），前端**只显示不重算**，
 *      否则同一指标会出现两套口径。
 *   3. 快照是**研究产物**（`generated_at`），可能落后于当日台账；缺文件按「未生成」降级。
 */
export interface BacktestSummary {
  generated_at: string
  version: string
  window: { start: string; end: string; days: number }
  records: BacktestRecord[]
  layers: BacktestLayer[]
  live: BacktestLive
  caveats: string[]
}

/** 一套收益口径的完整指标 + 逐日净值 */
export interface BacktestRecord {
  id: string
  label: string
  /** 买入→卖出时点 */
  sub: string
  note: string
  /** 是否为现行主口径（策略口径＝当日收盘） */
  primary: boolean
  metrics: BacktestMetrics
  equity: { date: string; ret: number; nav: number; n: number }[]
}

export interface BacktestMetrics {
  days: number
  picks: number
  /** 日胜率（%） */
  day_win: number
  /** 单笔胜率（%） */
  pick_win: number
  /** 日均收益（%） */
  day_avg: number
  /** 单笔均收益（%） */
  pick_avg: number
  /** 单笔中位（%） */
  pick_med: number
  /** 期末复利（%） */
  compound: number
  /** 最大回撤（%，负数） */
  mdd: number
  /** 年化 Sharpe（252 日） */
  sharpe: number | null
  /** 日均的 t 值（df = days−1）；|t|<2 视为不显著 */
  t: number | null
  /** 盈利日/亏损日的均值 */
  gain_avg: number | null
  loss_avg: number | null
  /** 盈亏比 = |gain_avg / loss_avg| */
  pl_ratio: number | null
}

/** 逐层阶梯：每加一条判据，两个口径各变成多少 */
export interface BacktestLayer {
  key: string
  label: string
  note: string
  close: BacktestLayerCell
  t1: BacktestLayerCell
  /** 本层相对上一层的复利增量（策略口径，pct）；首层为 null */
  delta_close: number | null
}

export interface BacktestLayerCell {
  days: number | null
  picks: number | null
  day_win: number | null
  pick_win: number | null
  day_avg: number | null
  compound: number | null
  mdd: number | null
}

/** 真实台账战绩（池内全买逐日）—— ⛔ 不是策略业绩，是「照单全收」的对照 */
export interface BacktestLive {
  days: number
  day_win?: number | null
  day_avg?: number | null
  /** 算术累加（%，非复利） */
  cum?: number | null
  /** 这些天里真正成交的笔数 */
  traded?: number | null
  rows: {
    date: string
    pool: number | null
    tradable: number | null
    avg: number | null
    win: number | null
    n: number | null
    t1_avg: number | null
    participate: number
  }[]
}

// ────────────────────────────────────────────────────────────────
// 龙头基因沉淀池（`scripts/dragon_gene.py` · 2026-11-10 用户定义）
// ────────────────────────────────────────────────────────────────

/** 池内一只票的退潮跟踪状态 */
export interface DragonGeneRow {
  code: string
  name: string
  sector?: string
  /** tracking=还在涨停 / pending=已断板未满两日 / retained=温和撤退 / eliminated=A杀淘汰 */
  status: 'tracking' | 'pending' | 'retained' | 'eliminated'
  /** 首次达到 4 板那天 */
  entry_day: string | null
  entry_boards: number | null
  max_boards: number
  /** 最高板 ≥5：有望突破板块、成为市场情绪龙头 */
  strong: boolean
  break_day: string | null
  /** 断板当日相对最后涨停日收盘 */
  d1_pct: number | null
  /** 断板后第 2 个交易日累计 */
  d2_pct: number | null
  post_2d_pct: number | null
  a_kill: boolean | null
  /** 该票单日涨跌停幅度（10 / 20 / 5 / 30） */
  limit_pct?: number
  /** A 杀阈值 = −一个跌停板（如 −20） */
  a_kill_threshold?: number
  /** 绝对 −10% 口径的对照结论（与 a_kill 可能不同） */
  a_kill_abs10?: boolean | null
  current_boards?: number
  generation?: number
}

export interface DragonGeneFile {
  schema: string
  generated_at: string
  /** 最后一个**完整**归档日（盘中归档会被跳过） */
  data_as_of: string | null
  window: string[]
  rules: {
    entry_boards: number
    strong_boards: number
    a_kill_pct: number
    a_kill_mode?: string
    a_kill_ratio?: number
    a_kill_note?: string
  }
  summary: {
    entered: number
    strong: number
    tracking: number
    pending: number
    retained: number
    eliminated: number
    decided: number
    retain_rate: number | null
    a_kill_rate: number | null
  }
  pool: DragonGeneRow[]
}

/** 判据登记表（/api/rules · 2026-11-11）——新增判据必须先登记，不在表里的判据视为不存在。 */
export interface RuleEntry {
  id: string
  name: string
  /** gate=决定买不买 · rank=排序名额 · position=仓位 · data=数据语义 · display=展示口径 */
  kind: 'gate' | 'rank' | 'position' | 'data' | 'display'
  /** 环境变量开关名；'—' 表示没有开关（常开或结构性约束） */
  switch: string
  default: string
  status: 'active' | 'shadow' | 'off'
  since: string
  what: string
  source: string
  rollback: string
}

export interface RulesRegistryFile {
  schema: string
  updated: string
  note: string
  count: number
  groups: Array<{ name: string; rules: RuleEntry[] }>
}

/** 判据命中日报（/api/rules/fired · 2026-11-11）——只看「今天哪条判据真的在干活」。 */
export interface RulesFiredFile {
  schema: string
  date: string
  total_views: number
  bought: number
  fired: Array<{ id: string; name: string; hits: number; codes: string[] }>
  /** 今天一次都没命中的判据（⚠️ 待删候选，不是错误） */
  zero_hit: string[]
  unattributed: string[]
  by_state: Record<string, number>
  substitutes: string[]
  note: string
}
