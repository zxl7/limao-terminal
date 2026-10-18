/**
 * 数据源清单 —— 前端**唯一**的取数入口。
 *
 * 组件内禁止直接写 fetch / 拼接 URL。新增数据源时：
 *   1. 在 `routes.ts` 注册路由（后端随之开放）；
 *   2. 在 `types.ts` 补对应接口；
 *   3. 在 `schemas.ts` 补结构守卫（可选，仅关键契约）；
 *   4. 在下方 `RouteTypeMap` 建立「路由 → 类型」绑定。
 *
 * `RouteTypeMap` 的价值：调用 `fetchRoute('/api/market/latest')` 自动得到
 * `MarketSnapshot`，路由字符串与类型**编译期绑定** —— 写错路由直接编译失败。
 */

import { DataUnavailableError, getJson } from './client'
import { SCHEMAS } from './schemas'
import type {
  AccountNavEntry,
  AmbushPullbackSettlementEntry,
  AmbushPullbackSignalEntry,
  AmbushWeightedPnlEntry,
  AiDecisionEntry,
  AiNavEntry,
  AiViewFile,
  ArchiveIndexEntry,
  AuctionLive,
  AuditEntry,
  BacktestReport,
  BoardCoreFile,
  CandidatesFile,
  CardArchiveFile,
  CarrierState,
  DatedFile,
  DecisionManifest,
  DecisionDossier,
  EmotionDailySnapshot,
  EmotionSummary5D,
  ExecutionAudit,
  EngineStateFile,
  EruptionDay,
  FeedbackMatrix,
  RelayEffect,
  LearningConfig,
  PoolCallFile,
  PromoBacktest,
  RuleConfigFile,
  ShortSpiritConfig,
  FlowHistoryDay,
  SectorFundPool,
  GeneHistory,
  GenePoolFile,
  GeneProfile,
  GeneSummary,
  HealthPayload,
  HithinkAnomalyFile,
  HithinkAuctionFile,
  HithinkLadderFile,
  HithinkLhbFile,
  HithinkValuationFile,
  HithinkZtDiffFile,
  HithinkZtFile,
  InstitutionPoolFile,
  LhbTencentFile,
  Ma5Status,
  MarketMemory,
  MarketSnapshot,
  NewsflashHistoryDay,
  PromoDaily,
  PromoSummary,
  PulseWindow,
  PushedSignals,
  RelayShadow,
  RiskWatchFile,
  RotationData,
  SelectionEffect,
  ShortSpiritSignals,
  StrategyMetricsFile,
  ThemeSequence,
  ThemeSeries,
  WeeklyZtMap,
  ZtHistoryDay,
  ZtPoolSnapshot,
  IntradayTimelineEvent,
} from './types'

/**
 * 路由 → 返回类型。新增数据源时在此登记。
 *
 * ⚠️ 目录型路由（一个数据源 = 一组文件）统一返回 `DatedFile<T>[]`，
 *    即「文件名 + 内容」的数组，内容损坏时为 null。
 */
export interface RouteTypeMap {
  // ── 一、行情主链路 · 盘中实时 ──
  '/api/market/latest': MarketSnapshot
  '/api/market/prev': MarketSnapshot
  '/api/market/auction': AuctionLive
  '/api/market/signals': ShortSpiritSignals

  // ── 二、反馈与题材 ──
  '/api/market/relay-effect': RelayEffect
  '/api/market/feedback': FeedbackMatrix
  '/api/market/selection-effect': SelectionEffect
  '/api/market/candidates': CandidatesFile
  '/api/theme/rotation': RotationData
  '/api/theme/series': ThemeSeries
  '/api/theme/sequence': ThemeSequence
  '/api/flow/history': FlowHistoryDay[]
  '/api/flow/live': SectorFundPool

  // ── 三、板块核心票 ──
  '/api/board/core': DatedFile<BoardCoreFile>[]

  // ── 四、连板晋级量化 ──
  '/api/promotion/summary': PromoSummary
  '/api/promotion/daily': DatedFile<PromoDaily>[]

  // ── 五、股性基因 ──
  '/api/gene/summary': GeneSummary
  '/api/gene/detail': DatedFile<GeneProfile>[]
  '/api/gene/hist': DatedFile<GeneHistory>[]
  '/api/gene/pool': GenePoolFile

  // ── 六、情绪周期 ──
  '/api/emotion/summary5d': EmotionSummary5D
  '/api/emotion/daily': DatedFile<EmotionDailySnapshot>[]
  '/api/emotion/zt-history': DatedFile<ZtHistoryDay>[]
  '/api/emotion/memory': DatedFile<MarketMemory>[]
  '/api/zt/yesterday': ZtPoolSnapshot
  /** ⚠️ 目录型（近 5 个交易日）—— 原始响应是 `[{file, data}]`，
   *  `api.intradayTimeline()` 会摊平成事件数组再交给消费端。 */
  '/api/intraday/timeline': DatedFile<IntradayTimelineEvent>[]
  // ── 七、财富密码决策链 ──
  // ⚠️ 这三条返回的都是**每日决策档案**（wealth_code_candidates_v1），
  //    不是「候选池」—— 曾因文件名含 candidates 而误绑 CandidatesFile，
  //    实际结构里没有 `candidates` 数组，渲染会直接读到 undefined。
  '/api/decision/candidates': DatedFile<DecisionDossier>[]
  '/api/decision/latest': DecisionDossier
  '/api/decision/execution-audit': ExecutionAudit
  '/api/decision/auction-history': DatedFile<Record<string, unknown>>[]
  '/api/decision/archive': DatedFile<DecisionDossier>[]
  '/api/decision/zt-pool': ZtPoolSnapshot
  '/api/decision/manifest': DecisionManifest
  /** 09:25 池内裁决终态（`view` 定音 + 买入名额序 · ⛔ 非昨日预案 `bias`） */
  '/api/decision/pool-call': DatedFile<PoolCallFile>[]

  // ── 八、AI 判断平行台账 ──
  '/api/ai/view': DatedFile<AiViewFile>[]
  '/api/ai/decisions': AiDecisionEntry[]
  '/api/ai/nav': AiNavEntry[]

  // ── 九、尾盘潜伏研究账本 ──
  '/api/ambush/pullback/signals': AmbushPullbackSignalEntry[]
  '/api/ambush/pullback/settlements': AmbushPullbackSettlementEntry[]
  '/api/ambush/pullback/weighted-pnl': AmbushWeightedPnlEntry[]

  // ── 十、净值与战绩（脚本轨）──
  '/api/account/nav': AccountNavEntry[]
  '/api/account/metrics': StrategyMetricsFile

  // ── 十、龙虎榜 ──
  '/api/lhb/tencent': DatedFile<LhbTencentFile>[]
  '/api/lhb/hithink': DatedFile<HithinkLhbFile>[]

  // ── 十一、同花顺专业数据 ──
  '/api/hithink/ladder': HithinkLadderFile
  '/api/hithink/zt': DatedFile<HithinkZtFile>[]
  '/api/hithink/zt-diff': DatedFile<HithinkZtDiffFile>[]
  '/api/hithink/auction': DatedFile<HithinkAuctionFile>[]
  '/api/hithink/anomaly': HithinkAnomalyFile
  '/api/hithink/valuation': HithinkValuationFile

  // ── 十二、机构投研 ──
  '/api/institution/pool': DatedFile<InstitutionPoolFile>[]
  '/api/institution/morning': CardArchiveFile
  '/api/institution/evening': CardArchiveFile
  '/api/institution/weekend': CardArchiveFile

  // ── 十三、题材与消息史 ──
  '/api/eruption/history': DatedFile<EruptionDay>[]
  '/api/newsflash/history': DatedFile<NewsflashHistoryDay>[]
  '/api/theme/weekly-map': WeeklyZtMap

  // ── 十四、载体 / 五日线 / 影子 ──
  '/api/carrier/state': CarrierState
  '/api/ma5/status': Ma5Status
  '/api/shadow/relay': RelayShadow

  // ── 十五、风险监控 ──
  '/api/risk/watch': DatedFile<RiskWatchFile>[]

  // ── 十六、推测回测 ──
  '/api/backtest/report': DatedFile<BacktestReport>[]

  // ── 十七、卡片存档 ──
  '/api/card/fupan': DatedFile<CardArchiveFile>[]
  '/api/card/panqian': DatedFile<CardArchiveFile>[]
  '/api/card/ambush': DatedFile<CardArchiveFile>[]
  '/api/card/lhb': DatedFile<CardArchiveFile>[]
  '/api/card/mixed': DatedFile<CardArchiveFile>[]

  // ── 十八、盘中脉冲存档 ──
  '/api/pulse/windows': DatedFile<PulseWindow>[]
  '/api/pulse/pushed-signals': DatedFile<PushedSignals>[]

  // ── 十九、推送审计 ──
  '/api/audit/log': AuditEntry[]
  '/api/push/dedup': Record<string, unknown>,

  // ── 二十、系统台账与运维 ──
  /** ⚠️ 返回**原始 YAML 字符串**（路由 format: 'text'），解析在前端做 */
  '/api/system/tasks': string
  '/api/system/learning': LearningConfig
  '/api/system/short-spirit': ShortSpiritConfig
  '/api/system/rules': DatedFile<RuleConfigFile>[]
  '/api/system/engine': DatedFile<EngineStateFile>[]
  '/api/system/backups': DatedFile<Record<string, unknown>>[]
  '/api/system/archive-index': ArchiveIndexEntry[]
  '/api/promo/backtest': DatedFile<PromoBacktest>[]

  // ── 体检 ──
  '/api/health': HealthPayload
}

export type ApiRoute = keyof RouteTypeMap

/**
 * 统一取数：类型自动推导 + 自动套用结构守卫。
 * 这是唯一允许出现在 feature 层 / hooks 里的取数方式。
 */
export function fetchRoute<K extends ApiRoute>(route: K, timeoutMs?: number) {
  return getJson<RouteTypeMap[K]>(route, { guard: SCHEMAS[route], timeoutMs })
}

/**
 * 按分组组织的取数函数。
 *
 * 每个函数都只是 `fetchRoute` 的具名包装 —— 这样调用点有可跳转的目标，
 * 且路由字符串只在本文件出现一次（改路由名只需改一处）。
 */
export const api = {
  // ── 一、行情主链路 · 盘中实时 ──
  /** 主快照（实时） */
  latest: () => fetchRoute('/api/market/latest'),
  /** 上一版快照（环比对比） */
  prev: () => fetchRoute('/api/market/prev'),
  /** 竞价实时报价 */
  auction: () => fetchRoute('/api/market/auction'),
  /** 短线精灵信号 */
  signals: () => fetchRoute('/api/market/signals'),

  // ── 二、反馈与题材 ──
  /** 昨日涨停反馈矩阵 */
  feedback: () => fetchRoute('/api/market/feedback'),
  /** 盘后候选的次日反馈（猎手原样发布） */
  selectionEffect: () => fetchRoute('/api/market/selection-effect'),
  relayEffect: () => fetchRoute('/api/market/relay-effect'),
  /** 候选池 */
  candidates: () => fetchRoute('/api/market/candidates'),
  /** 题材轮动 · 回流预测 · 5日资金 */
  rotation: () => fetchRoute('/api/theme/rotation'),
  /** 题材多日序列 */
  series: () => fetchRoute('/api/theme/series'),
  sequence: () => fetchRoute('/api/theme/sequence'),
  /** 板块资金历史（多日合并） */
  flowHistory: () => fetchRoute('/api/flow/history'),
  /** 板块资金盘中全量快照（今日） */
  flowLive: () => fetchRoute('/api/flow/live'),

  // ── 三、板块核心票 ──
  /** 板块核心度（四维加权 core_score）· 板块异动先查 core 票动不动 */
  boardCore: () => fetchRoute('/api/board/core'),

  // ── 四、连板晋级量化 ──
  /** 晋级率汇总（分段成功率 + 次日溢价） */
  promotionSummary: () => fetchRoute('/api/promotion/summary'),
  /** 每日晋级事件明细（逐票） */
  promotionDaily: () => fetchRoute('/api/promotion/daily'),

  // ── 五、股性基因 ──
  /** 涨停池股性榜 */
  geneSummary: () => fetchRoute('/api/gene/summary'),
  /** 个股股性档案（全量） */
  geneDetail: () => fetchRoute('/api/gene/detail'),
  /** 个股历史涨停基因（近 250 日） */
  geneHist: () => fetchRoute('/api/gene/hist'),
  /** 涨停基因池（最近一期） */
  genePool: () => fetchRoute('/api/gene/pool'),

  // ── 六、情绪周期 ──
  /** 5 日情绪摘要（含 3 日 MA 与转折信号） */
  emotionSummary5d: () => fetchRoute('/api/emotion/summary5d'),
  /** 情绪日档历史（周期温度总览） */
  emotionDaily: () => fetchRoute('/api/emotion/daily'),
  /** 盘中涨停时序 */
  emotionZtHistory: () => fetchRoute('/api/emotion/zt-history'),
  /** 情绪快照（情绪联动） */
  emotionMemory: () => fetchRoute('/api/emotion/memory'),
  /** 昨日涨停池（唯一涨停权威） */
  ztYesterday: () => fetchRoute('/api/zt/yesterday'),
  /**
   * 盘中情绪时间轴（近 5 个交易日逐事件 · append-only · up/down 双向）。
   *
   * 路由是**目录型**（一天一个 JSONL）→ 原始响应为 `[{file, data}]`；
   * 此处**摊平成事件数组**：消费端只关心「某时刻发生了什么」，
   * 不关心文件外壳（2026-09-19 用户要求曲线可切日 / 实时）。
   */
  intradayTimeline: async () => {
    const files = await fetchRoute('/api/intraday/timeline')
    return files.flatMap((f) => f.data ?? [])
  },

  // ── 七、财富密码决策链 ──
  /** 每日决策档案存档（近 3 期 · 单份约 100KB） */
  decisionCandidates: () => fetchRoute('/api/decision/candidates'),
  /** 最新一期决策档案（完整字段：环境 / 接力池 / 观察池 / 早鸟 / 旁白） */
  decisionLatest: () => fetchRoute('/api/decision/latest'),
  /** 实际执行证据链：候选、竞价、裁决与账户收益分开留存。 */
  decisionExecutionAudit: () => fetchRoute('/api/decision/execution-audit'),
  /** 竞价报价存档 */
  decisionAuctionHistory: () => fetchRoute('/api/decision/auction-history'),
  /** 决策黑匣子存档 */
  decisionArchive: () => fetchRoute('/api/decision/archive'),
  /** 决策时点涨停池明细 */
  decisionZtPool: () => fetchRoute('/api/decision/zt-pool'),
  /** 存档清单（完整性 / gaps） */
  decisionManifest: () => fetchRoute('/api/decision/manifest'),
  /**
   * 09:25 池内裁决**终态**（近 3 期）。
   *
   * ⛔ 与 `aiView` 不可互换：`aiView` 是**前一交易日盘后**的预案（输入），
   *    本路由是**当日 09:25 竞价后**的定音（结论：view + 买入名额序）。
   *    展示「今晨实际怎么做的」必须用本路由。
   */
  decisionPoolCall: () => fetchRoute('/api/decision/pool-call'),

  // ── 八、AI 判断平行台账 ──
  /** AI 判断（参与/放弃/观察 + 理由） */
  aiView: () => fetchRoute('/api/ai/view'),
  /** AI 判断台账 */
  aiDecisions: () => fetchRoute('/api/ai/decisions'),
  /** AI 轨净值（首行由当日 15:30 settle 落，早于该时点为空属正常） */
  aiNav: () => fetchRoute('/api/ai/nav'),

  // ── 九、尾盘潜伏研究账本（独立于接力账户）──
  // 账本首次在 14:30 研究扫描落盘前不存在是正常空态，不应让整个交易页 loader 失败。
  // 其他读取/契约错误仍向上抛出，避免吞掉真实故障。
  ambushPullbackSignals: async () => {
    try {
      return await fetchRoute('/api/ambush/pullback/signals')
    } catch (error) {
      if (error instanceof DataUnavailableError) return []
      throw error
    }
  },
  ambushPullbackSettlements: async () => {
    try {
      return await fetchRoute('/api/ambush/pullback/settlements')
    } catch (error) {
      if (error instanceof DataUnavailableError) return []
      throw error
    }
  },
  /** 尾盘潜伏「账户当日收益」（动态仓位加权后）；缺文件=空态，不阻断交易页。 */
  ambushWeightedPnl: async () => {
    try {
      return await fetchRoute('/api/ambush/pullback/weighted-pnl')
    } catch (error) {
      if (error instanceof DataUnavailableError) return []
      throw error
    }
  },

  // ── 十、净值与战绩（脚本轨）──
  /** 净值账本 */
  accountNav: () => fetchRoute('/api/account/nav'),
  /** 策略指标（逐日样本数/可交易数） */
  accountMetrics: () => fetchRoute('/api/account/metrics'),

  // ── 十、龙虎榜 ──
  /** 龙虎榜（腾讯自选股源 · 盘后 18:00+ 披露） */
  lhbTencent: () => fetchRoute('/api/lhb/tencent'),
  /** 同花顺龙虎榜（机构/游资席交叉校验） */
  lhbHithink: () => fetchRoute('/api/lhb/hithink'),

  // ── 十一、同花顺专业数据 ──
  /** 连板天梯 30 日 */
  hithinkLadder: () => fetchRoute('/api/hithink/ladder'),
  /** 同花顺涨停池（含涨停原因） */
  hithinkZt: () => fetchRoute('/api/hithink/zt'),
  /** 涨停池双源校验差异 */
  hithinkZtDiff: () => fetchRoute('/api/hithink/zt-diff'),
  /** 竞价风向标 */
  hithinkAuction: () => fetchRoute('/api/hithink/auction'),
  /** 异动原因（最新一期） */
  hithinkAnomaly: () => fetchRoute('/api/hithink/anomaly'),
  /** 估值 */
  hithinkValuation: () => fetchRoute('/api/hithink/valuation'),

  // ── 十二、机构投研 ──
  /** 机构池 */
  institutionPool: () => fetchRoute('/api/institution/pool'),
  /** 机构研报·早盘卡 */
  institutionMorning: () => fetchRoute('/api/institution/morning'),
  /** 机构晚报速览 */
  institutionEvening: () => fetchRoute('/api/institution/evening'),
  /** 机构周末研究 */
  institutionWeekend: () => fetchRoute('/api/institution/weekend'),

  // ── 十三、题材与消息史 ──
  /** 题材爆发史 */
  eruptionHistory: () => fetchRoute('/api/eruption/history'),
  /** 快讯→题材→个股映射 */
  newsflashHistory: () => fetchRoute('/api/newsflash/history'),
  /** 周涨停地图 */
  weeklyZtMap: () => fetchRoute('/api/theme/weekly-map'),

  // ── 十四、载体 / 五日线 / 影子 ──
  /** 载体证伪追踪 */
  carrierState: () => fetchRoute('/api/carrier/state'),
  /** 五日线状态 */
  ma5Status: () => fetchRoute('/api/ma5/status'),
  /** 接力权重影子模式 */
  shadowRelay: () => fetchRoute('/api/shadow/relay'),

  // ── 十五、风险监控 ──
  /** 高标风险面（质押/公告） */
  riskWatch: () => fetchRoute('/api/risk/watch'),

  // ── 十六、推测回测 ──
  /** 回测报告（三类命中率） */
  backtestReport: () => fetchRoute('/api/backtest/report'),

  // ── 十七、卡片存档 ──
  /** 复盘卡存档 */
  cardFupan: () => fetchRoute('/api/card/fupan'),
  /** 盘前卡存档 */
  cardPanqian: () => fetchRoute('/api/card/panqian'),
  /** 早鸟埋伏卡存档 */
  cardAmbush: () => fetchRoute('/api/card/ambush'),
  /** 龙虎榜卡存档 */
  cardLhb: () => fetchRoute('/api/card/lhb'),
  /** 竞价验证卡存档 */
  cardMixed: () => fetchRoute('/api/card/mixed'),

  // ── 十八、盘中脉冲存档 ──
  /** 脉冲窗口存档 */
  pulseWindows: () => fetchRoute('/api/pulse/windows'),
  /** 当日推送信号状态（极小/为空 = 事件链零产出） */
  pulsePushedSignals: () => fetchRoute('/api/pulse/pushed-signals'),

  // ── 十九、推送审计 ──
  /** 推送审计日志 */
  auditLog: () => fetchRoute('/api/audit/log'),
  /** 推送去重状态（同内容 10min 去重 · 排查重复推送用） */
  pushDedup: () => fetchRoute('/api/push/dedup'),

  // ── 二十、系统台账与运维 ──
  /** 自动化任务台账（**原始 YAML 文本** · 前端解析子集） */
  systemTasks: () => fetchRoute('/api/system/tasks'),
  /** 自学习阈值配置 */
  systemLearning: () => fetchRoute('/api/system/learning'),
  /** 短线精灵阈值配置 */
  systemShortSpirit: () => fetchRoute('/api/system/short-spirit'),
  /** 策略规则配置（预期区间/接力权重/监管三份） */
  systemRules: () => fetchRoute('/api/system/rules'),
  /** 盘中引擎状态（加速/待推/板块风险/资金池） */
  systemEngine: () => fetchRoute('/api/system/engine'),
  /** 系统备份快照（白名单：净值/持仓/AI决策/学习回滚） */
  systemBackups: () => fetchRoute('/api/system/backups'),
  /** 决策存档索引（黑匣子总目录） */
  systemArchiveIndex: () => fetchRoute('/api/system/archive-index'),
  /** 晋级量化回测报告 */
  promoBacktest: () => fetchRoute('/api/promo/backtest'),

  // ── 体检 ──
  /** 数据新鲜度体检 */
  health: () => fetchRoute('/api/health'),
} as const

/**
 * 盘中轮询所需的数据源（按原系统 30s 节拍）。
 *
 * ⚠️ 只列 `cadence: 'intraday'` 的源 —— 日频数据（板块核心 / 晋级 / 基因 / 龙虎榜等）
 *    在盘中不会变化，把它们放进轮询只是白白消耗原系统磁盘与网络。
 */
export const INTRADAY_POLLERS = [
  ['latest', api.latest],
  ['signals', api.signals],
  ['feedback', api.feedback],
  ['selectionEffect', api.selectionEffect],
  ['candidates', api.candidates],
] as const
