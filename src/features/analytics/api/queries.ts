import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/api'
import { APP_CONFIG } from '@/shared/config'

/**
 * 分析域数据源 —— 承载「原系统已落盘、但原 dashboard 从未展示」的全部维度。
 *
 * ## 刷新策略（与行情域的关键差异）
 *
 * 这些源**绝大多数是日频**：原系统在盘后链（17:18）或盘前生成一次，
 * 盘中不会变化。因此这里**一律不设 `refetchInterval`**，只保留合理 `staleTime`：
 *   · 手动刷新即可拿到最新（用户切页面时若超 staleTime 会自动重取）
 *   · 若沿用行情域的 30s 轮询，等于每 30 秒把 3.4MB 的日频数据白拉一遍
 *
 * 例外标记 `intraday: true` 的少数源（涨停时序、情绪快照）在盘中确实会变，
 * 给它们 5 分钟节拍 —— 既跟得上又不至于像行情那样高频。
 */

/** 日频数据的 staleTime：5 分钟。原系统一天只写 1~2 次，再短没有意义 */
const DAILY_STALE = 300_000

/** 盘中会变的日频类数据：5 分钟轮询 */
const intradayPollMs = () => (APP_CONFIG.pollIntradayMs ? 300_000 : undefined)

/**
 * **真·盘中实时**源：与后端守护（`intraday_timeline.py` 每轮追加）**同节拍**。
 *
 * ⛔ 不要与上面那个 5 分钟的 `intradayPollMs` 混用 —— 那条是「日频、只是盘中偶尔会变」
 *    的兜底节拍（避免把 3.4MB 日频数据每 30 秒白拉一遍）。而情绪时间轴是**逐事件
 *    流式账本**，5 分钟明显滞后（2026-09-19 用户明确要求「必须实时」）。
 */
const livePollMs = () => APP_CONFIG.pollIntradayMs

export const analyticsQueries = {
  // ══════════════ 板块核心票 ══════════════
  /** 板块核心度（108 个板块，四维加权 core_score） */
  boardCore: () =>
    queryOptions({
      queryKey: ['board', 'core'] as const,
      queryFn: api.boardCore,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 连板晋级量化 ══════════════
  /** 晋级率汇总（分段成功率 + 晋级次日溢价） */
  promotionSummary: () =>
    queryOptions({
      queryKey: ['promotion', 'summary'] as const,
      queryFn: api.promotionSummary,
      staleTime: DAILY_STALE,
    }),
  /** 每日晋级事件明细（近 10 个交易日） */
  promotionDaily: () =>
    queryOptions({
      queryKey: ['promotion', 'daily'] as const,
      queryFn: api.promotionDaily,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 股性基因 ══════════════
  /** 涨停池股性榜 */
  geneSummary: () =>
    queryOptions({
      queryKey: ['gene', 'summary'] as const,
      queryFn: api.geneSummary,
      staleTime: DAILY_STALE,
    }),
  /** 个股股性档案（全量） */
  geneDetail: () =>
    queryOptions({
      queryKey: ['gene', 'detail'] as const,
      queryFn: api.geneDetail,
      staleTime: DAILY_STALE,
    }),
  /** 个股历史涨停基因 */
  geneHist: () =>
    queryOptions({
      queryKey: ['gene', 'hist'] as const,
      queryFn: api.geneHist,
      staleTime: DAILY_STALE,
    }),
  /** 涨停基因池（最近一期） */
  genePool: () =>
    queryOptions({
      queryKey: ['gene', 'pool'] as const,
      queryFn: api.genePool,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 情绪周期 ══════════════
  /** 5 日情绪摘要（含 3 日 MA 与转折信号） */
  emotionSummary5d: () =>
    queryOptions({
      queryKey: ['emotion', 'summary5d'] as const,
      queryFn: api.emotionSummary5d,
      staleTime: DAILY_STALE,
    }),
  /** 盘中涨停时序（盘中会更新，给 5 分钟节拍） */
  emotionZtHistory: () =>
    queryOptions({
      queryKey: ['emotion', 'zt-history'] as const,
      queryFn: api.emotionZtHistory,
      refetchInterval: intradayPollMs,
      staleTime: 120_000,
    }),
  /** 情绪快照（情绪联动） */
  emotionMemory: () =>
    queryOptions({
      queryKey: ['emotion', 'memory'] as const,
      queryFn: api.emotionMemory,
      staleTime: DAILY_STALE,
    }),
  /** 昨日涨停池（唯一涨停权威） */
  ztYesterday: () =>
    queryOptions({
      queryKey: ['zt', 'yesterday'] as const,
      queryFn: api.ztYesterday,
      staleTime: 120_000,
    }),

  /**
   * 盘中情绪时间轴（近 5 个交易日逐事件 · **实时**）——
   * 30s 轮询（与后端守护同频）；收盘后数据不再变化，空转代价可忽略。
   */
  intradayTimeline: () =>
    queryOptions({
      queryKey: ['intraday', 'timeline'] as const,
      queryFn: api.intradayTimeline,
      refetchInterval: livePollMs,
      staleTime: 15_000,
    }),

  // ══════════════ 财富密码决策链 ══════════════
  /** 选股候选存档（近 3 期） */
  decisionCandidates: () =>
    queryOptions({
      queryKey: ['decision', 'candidates'] as const,
      queryFn: api.decisionCandidates,
      staleTime: DAILY_STALE,
    }),
  /** 最新一期选股候选 */
  decisionLatest: () =>
    queryOptions({
      queryKey: ['decision', 'latest'] as const,
      queryFn: api.decisionLatest,
      staleTime: DAILY_STALE,
    }),
  /** 竞价报价存档 */
  decisionAuctionHistory: () =>
    queryOptions({
      queryKey: ['decision', 'auction-history'] as const,
      queryFn: api.decisionAuctionHistory,
      staleTime: DAILY_STALE,
    }),
  /** 决策黑匣子存档 */
  decisionArchive: () =>
    queryOptions({
      queryKey: ['decision', 'archive'] as const,
      queryFn: api.decisionArchive,
      staleTime: DAILY_STALE,
    }),
  /** 决策时点涨停池 */
  decisionZtPool: () =>
    queryOptions({
      queryKey: ['decision', 'zt-pool'] as const,
      queryFn: api.decisionZtPool,
      staleTime: DAILY_STALE,
    }),
  /** 存档清单 */
  decisionManifest: () =>
    queryOptions({
      queryKey: ['decision', 'manifest'] as const,
      queryFn: api.decisionManifest,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ AI 判断平行台账 ══════════════
  /** AI 判断（参与/放弃/观察） */
  aiView: () =>
    queryOptions({
      queryKey: ['ai', 'view'] as const,
      queryFn: api.aiView,
      staleTime: DAILY_STALE,
    }),
  /** AI 判断台账 */
  aiDecisions: () =>
    queryOptions({
      queryKey: ['ai', 'decisions'] as const,
      queryFn: api.aiDecisions,
      staleTime: DAILY_STALE,
    }),
  /** AI 轨净值 */
  aiNav: () =>
    queryOptions({
      queryKey: ['ai', 'nav'] as const,
      queryFn: api.aiNav,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 净值与战绩 ══════════════
  /** 净值账本（脚本轨） */
  accountNav: () =>
    queryOptions({
      queryKey: ['account', 'nav'] as const,
      queryFn: api.accountNav,
      staleTime: DAILY_STALE,
    }),
  /** 策略指标 */
  accountMetrics: () =>
    queryOptions({
      queryKey: ['account', 'metrics'] as const,
      queryFn: api.accountMetrics,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 龙虎榜 ══════════════
  /** 龙虎榜（腾讯源） */
  lhbTencent: () =>
    queryOptions({
      queryKey: ['lhb', 'tencent'] as const,
      queryFn: api.lhbTencent,
      staleTime: DAILY_STALE,
    }),
  /** 同花顺龙虎榜 */
  lhbHithink: () =>
    queryOptions({
      queryKey: ['lhb', 'hithink'] as const,
      queryFn: api.lhbHithink,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 同花顺专业数据 ══════════════
  /** 连板天梯 30 日 */
  hithinkLadder: () =>
    queryOptions({
      queryKey: ['hithink', 'ladder'] as const,
      queryFn: api.hithinkLadder,
      staleTime: DAILY_STALE,
    }),
  /** 同花顺涨停池（含涨停原因） */
  hithinkZt: () =>
    queryOptions({
      queryKey: ['hithink', 'zt'] as const,
      queryFn: api.hithinkZt,
      staleTime: DAILY_STALE,
    }),
  /** 涨停池双源校验差异 */
  hithinkZtDiff: () =>
    queryOptions({
      queryKey: ['hithink', 'zt-diff'] as const,
      queryFn: api.hithinkZtDiff,
      staleTime: DAILY_STALE,
    }),
  /** 竞价风向标 */
  hithinkAuction: () =>
    queryOptions({
      queryKey: ['hithink', 'auction'] as const,
      queryFn: api.hithinkAuction,
      staleTime: DAILY_STALE,
    }),
  /** 异动原因（最新一期） */
  hithinkAnomaly: () =>
    queryOptions({
      queryKey: ['hithink', 'anomaly'] as const,
      queryFn: api.hithinkAnomaly,
      staleTime: DAILY_STALE,
    }),
  /** 同花顺估值（code → pe/pb/ps/pcf） */
  hithinkValuation: () =>
    queryOptions({
      queryKey: ['hithink', 'valuation'] as const,
      queryFn: api.hithinkValuation,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 资金流向历史 ══════════════
  /**
   * 板块资金逐日原始档（`cache/sector_flow_history/`）。
   *
   * ⚠️ 这是「全板块 + 滚动 5/10 日」的**原始**档，与 `theme/rotation` 里的
   *    `flow_5d`（已聚合 Top）不是同一层数据 —— 两者都需要，前者用于全量排查，
   *    后者用于直接读结论。
   */
  flowHistory: () =>
    queryOptions({
      queryKey: ['flow', 'history'] as const,
      queryFn: api.flowHistory,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 机构投研 ══════════════
  /** 机构池 */
  institutionPool: () =>
    queryOptions({
      queryKey: ['institution', 'pool'] as const,
      queryFn: api.institutionPool,
      staleTime: DAILY_STALE,
    }),
  /** 机构研报·早盘卡 */
  institutionMorning: () =>
    queryOptions({
      queryKey: ['institution', 'morning'] as const,
      queryFn: api.institutionMorning,
      staleTime: DAILY_STALE,
    }),
  /** 机构晚报 */
  institutionEvening: () =>
    queryOptions({
      queryKey: ['institution', 'evening'] as const,
      queryFn: api.institutionEvening,
      staleTime: DAILY_STALE,
    }),
  /** 机构周末研究（manual 节拍：按周产出，不参与日常轮询） */
  institutionWeekend: () =>
    queryOptions({
      queryKey: ['institution', 'weekend'] as const,
      queryFn: api.institutionWeekend,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 题材与消息史 ══════════════
  /** 题材爆发史 */
  eruptionHistory: () =>
    queryOptions({
      queryKey: ['eruption', 'history'] as const,
      queryFn: api.eruptionHistory,
      staleTime: DAILY_STALE,
    }),
  /** 快讯→题材→个股映射 */
  newsflashHistory: () =>
    queryOptions({
      queryKey: ['newsflash', 'history'] as const,
      queryFn: api.newsflashHistory,
      staleTime: DAILY_STALE,
    }),
  /** 周涨停地图 */
  weeklyZtMap: () =>
    queryOptions({
      queryKey: ['theme', 'weekly-map'] as const,
      queryFn: api.weeklyZtMap,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 载体 / 五日线 / 影子 ══════════════
  /** 载体证伪追踪 */
  carrierState: () =>
    queryOptions({
      queryKey: ['carrier', 'state'] as const,
      queryFn: api.carrierState,
      staleTime: 120_000,
    }),
  /** 五日线状态（盘中会更新） */
  ma5Status: () =>
    queryOptions({
      queryKey: ['ma5', 'status'] as const,
      queryFn: api.ma5Status,
      refetchInterval: intradayPollMs,
      staleTime: 120_000,
    }),
  /** 接力权重影子模式 */
  shadowRelay: () =>
    queryOptions({
      queryKey: ['shadow', 'relay'] as const,
      queryFn: api.shadowRelay,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 风险监控 ══════════════
  riskWatch: () =>
    queryOptions({
      queryKey: ['risk', 'watch'] as const,
      queryFn: api.riskWatch,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 推测回测 ══════════════
  backtestReport: () =>
    queryOptions({
      queryKey: ['backtest', 'report'] as const,
      queryFn: api.backtestReport,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 卡片存档 ══════════════
  cardFupan: () =>
    queryOptions({ queryKey: ['card', 'fupan'] as const, queryFn: api.cardFupan, staleTime: DAILY_STALE }),
  cardPanqian: () =>
    queryOptions({ queryKey: ['card', 'panqian'] as const, queryFn: api.cardPanqian, staleTime: DAILY_STALE }),
  cardAmbush: () =>
    queryOptions({ queryKey: ['card', 'ambush'] as const, queryFn: api.cardAmbush, staleTime: DAILY_STALE }),
  cardLhb: () =>
    queryOptions({ queryKey: ['card', 'lhb'] as const, queryFn: api.cardLhb, staleTime: DAILY_STALE }),
  /** 财富密码混合卡（竞价验证卡 + 盘后候选卡混存 · 页面按 title 前缀分组） */
  cardMixed: () =>
    queryOptions({ queryKey: ['card', 'mixed'] as const, queryFn: api.cardMixed, staleTime: DAILY_STALE }),

  // ══════════════ 盘中脉冲存档 ══════════════
  pulseWindows: () =>
    queryOptions({
      queryKey: ['pulse', 'windows'] as const,
      queryFn: api.pulseWindows,
      staleTime: DAILY_STALE,
    }),
  pulsePushedSignals: () =>
    queryOptions({
      queryKey: ['pulse', 'pushed-signals'] as const,
      queryFn: api.pulsePushedSignals,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 推送审计 ══════════════
  auditLog: () =>
    queryOptions({
      queryKey: ['audit', 'log'] as const,
      queryFn: api.auditLog,
      refetchInterval: 120_000,
      staleTime: 60_000,
    }),
  /** 推送去重状态（同内容 10min 去重 · 与 auditLog 同页消费） */
  pushDedup: () =>
    queryOptions({
      queryKey: ['push', 'dedup'] as const,
      queryFn: api.pushDedup,
      staleTime: DAILY_STALE,
    }),

  // ══════════════ 系统台账与运维 ══════════════
  /** 自动化任务台账（原始 YAML 文本） */
  systemTasks: () =>
    queryOptions({
      queryKey: ['system', 'tasks'] as const,
      queryFn: api.systemTasks,
      staleTime: DAILY_STALE,
    }),
  /** 自学习阈值配置 */
  systemLearning: () =>
    queryOptions({
      queryKey: ['system', 'learning'] as const,
      queryFn: api.systemLearning,
      staleTime: DAILY_STALE,
    }),
  /** 短线精灵阈值配置 */
  systemShortSpirit: () =>
    queryOptions({
      queryKey: ['system', 'short-spirit'] as const,
      queryFn: api.systemShortSpirit,
      staleTime: DAILY_STALE,
    }),
  /** 策略规则配置（3 份） */
  systemRules: () =>
    queryOptions({
      queryKey: ['system', 'rules'] as const,
      queryFn: api.systemRules,
      staleTime: DAILY_STALE,
    }),
  /**
   * 盘中引擎状态（4 件）—— ⚠️ 这几件是**盘中**30s 级刷新的，
   * 与同页其余日频配置不同，故单独给 intraday 节拍。
   */
  systemEngine: () =>
    queryOptions({
      queryKey: ['system', 'engine'] as const,
      queryFn: api.systemEngine,
      refetchInterval: 60_000,
      staleTime: 30_000,
    }),
  /** 系统备份快照（白名单） */
  systemBackups: () =>
    queryOptions({
      queryKey: ['system', 'backups'] as const,
      queryFn: api.systemBackups,
      staleTime: DAILY_STALE,
    }),
  /** 决策存档索引（黑匣子总目录） */
  systemArchiveIndex: () =>
    queryOptions({
      queryKey: ['system', 'archive-index'] as const,
      queryFn: api.systemArchiveIndex,
      staleTime: DAILY_STALE,
    }),
  /** 晋级量化回测报告 */
  promoBacktest: () =>
    queryOptions({
      queryKey: ['promo', 'backtest'] as const,
      queryFn: api.promoBacktest,
      staleTime: DAILY_STALE,
    }),
} as const
