/**
 * 运行时数据契约守卫（zod 4）。
 *
 * ## 为什么需要这一层
 *
 * `types.ts` 的接口只在**编译期**存在。原系统（狸猫猎手）是冻结的、由 launchd
 * 驱动的一堆脚本在写 JSON —— 某次脚本改动把 `seal_rate` 从 number 改成 string，
 * TypeScript **一无所知**，前端会静默渲染出空白或 `NaN`，而且没有任何报错。
 * 盘中发现数据不对时，你无法区分「今天真是这个盘面」和「字段口径变了」。
 *
 * 这一层把「结构不符」从**静默**变成**显式**。
 *
 * ## 设计原则（关键，决定了误报率）
 *
 * 1. **只校验「若存在则类型必须正确」，不要求字段必须存在。**
 *    盘前大量字段天然为空，`required` 会造成持续误报，最终被忽略 → 守卫失效。
 *    故统一 `.optional()` / `.nullish()`：缺失 = 通过，类型错 = 失败。
 *
 * 2. **schema 只做检查，不做转换。**
 *    `client.ts` 校验通过后仍然返回**原始对象**，绝对不用 `parse()` 的结果。
 *    原因：zod 默认 strip 未知键，一旦用解析结果，原系统新增字段会被静默丢弃。
 *    这里 schema 是「安检门」，不是「加工机」。
 *
 * 3. **失败不阻塞渲染。** 校验失败只记录 + dev 期告警，数据照常返回。
 *    与原系统「空态优雅降级」的哲学一致 —— 宁可显示可疑数据，不可白屏。
 *
 * 4. **字段级 `.catch()` 只用于「坏了也不影响判断」的展示字段**，
 *    绝不用在结构性字段上（否则守卫形同虚设）。
 */

import { z } from 'zod'

// ════════════════════════════════════════════════════════════════
// 基础片段
// ════════════════════════════════════════════════════════════════

const n = z.number()
const s = z.string()
const b = z.boolean()
const nOrNull = z.number().nullable()

/** 计数器 + 名单（跌停/炸板） */
const CountNames = z.object({
  // ⚠️ 必须 nullable：盘前/早段跌停与炸板计数为 null 是合法态（数据未产出），
  // 只用 `.optional()` 会把「今天真是 0 家」与「尚未统计」混为一谈。
  count: nOrNull.optional(),
  names: z.array(s).optional(),
})

// ════════════════════════════════════════════════════════════════
// MarketSnapshot —— /api/market/latest & /api/market/prev
// ════════════════════════════════════════════════════════════════

const SentimentDetail = z.object({
  label: s.optional(),
  score: n.optional(),
  // ⚠️ 必须 nullable：早段封板率未统计时为 null（与「0%」是两回事）
  seal_rate: nOrNull.optional(),
})

const IndexQuote = z.object({
  name: s.optional(),
  pct: n.optional(),
  price: n.optional(),
  amount_yi: n.optional(),
})

/**
 * 板块资金流（轻量版）。
 *
 * ⚠️ `main_inflow` 实测**两种形态都存在**：旧脚本写字符串文案，当前脚本写原始数字
 *    （如 -382685064）。两种都合法，故用联合 —— 收紧成单一形态会产生持续误报，
 *    而持续误报的守卫最终一定会被忽略（见本文件头部设计原则第 1 条）。
 */
const SectorFlowLite = z.object({
  name: s.optional(),
  pct: n.optional(),
  main_inflow: z.union([s, n]).optional(),
  is_focus: b.optional(),
})

const SectorRisk = z.object({
  threshold: n.optional(),
  declining: z.array(SectorFlowLite).optional(),
  focus_declining: z.array(SectorFlowLite).optional(),
  count: n.optional(),
  inflow_top: z.array(SectorFlowLite).optional(),
  outflow_top: z.array(SectorFlowLite).optional(),
  ok: b.optional(),
})

/** ⚠️ stocks 是**字符串数组**（实测），不是对象数组 —— 曾是最容易写错的一处 */
const LadderGroup = z.object({
  boards: n.optional(),
  stocks: z.array(s).optional(),
})

const Leader = z.object({
  sector: s.optional(),
  name: s.optional(),
  code: s.optional(),
  pct: n.optional(),
  price: n.optional(),
  buyable: b.optional(),
  is_20cm: b.optional(),
  boards: s.optional(),
  limit_up_days: n.optional(),
})

const EmExpectStock = z.object({
  code: s.optional(),
  name: s.optional(),
  pct: n.optional(),
  cap_yi: nOrNull.optional(),
  dragon: b.optional(),
})

const EmExpect = z.object({
  name: s.optional(),
  themeCode: s.optional(),
  pct: n.optional(),
  zt: n.optional(),
  cum_pct: n.optional(),
  title: s.optional(),
  stocks: z.array(EmExpectStock).optional(),
})

const EarlyItem = z.object({
  type: s.optional(),
  sector: s.optional(),
  desc: s.optional(),
  buy: z
    .object({
      name: s.optional(),
      code: s.optional(),
      pct: n.optional(),
      price: n.optional(),
      is_20cm: b.optional(),
      limit_up_days: n.optional(),
    })
    .optional(),
  count: n.optional(),
  zt_in_sector: n.optional(),
  /** ⚠️ 实测为对象数组 `{name, pct}`，不是字符串数组 */
  members: z.array(z.object({ name: s.optional(), pct: n.optional() })).optional(),
})

const ThemeLeaderDetail = z.object({
  name: s.optional(),
  code: s.optional(),
  pct: n.optional(),
  price: n.optional(),
  boards: s.optional(),
  turn: n.optional(),
  cap_yi: nOrNull.optional(),
  desc: s.optional(),
  seal: s.optional(),
})

const ThemeTop = z.object({
  rank: n.optional(),
  name: s.optional(),
  desc: s.optional(),
  zt_count: n.optional(),
  turn_avg: n.optional(),
  total_stocks: n.optional(),
  /** ⚠️ 盘面早段 top5 会出现占位条目，leader / zt_prev 实测为 null */
  leader: ThemeLeaderDetail.nullable().optional(),
  followers: z.array(z.object({ name: s.optional(), pct: n.optional(), turn: n.optional() })).optional(),
  zt_stocks: z.array(z.object({ name: s.optional(), code: s.optional(), pct: n.optional() })).optional(),
  diffusion: s.optional(),
  risks: z.array(s).optional(),
  positives: z.array(s).optional(),
  /** ⚠️ 题材状态枚举（'new' / 'ongoing'），**非**涨停数环比数字 */
  delta: s.optional(),
  zt_prev: nOrNull.optional(),
})

const EbbInfo = z.object({
  severity: s.optional(),
  signals: z.array(s).optional(),
  max_board: n.optional(),
  total_zt: n.optional(),
  sentiment_score: n.optional(),
  sentiment_label: s.optional(),
})

export const MarketSnapshotSchema = z.object({
  ts: s.optional(),
  total_zt: n.optional(),
  sentiment: s.optional(),
  sentiment_detail: SentimentDetail.optional(),
  index: z.array(IndexQuote).optional(),
  limit_down: CountNames.optional(),
  broken: CountNames.optional(),
  weak_sectors: z
    .object({
      focus_hits: z.array(s).optional(),
      ld_count: n.optional(),
      broken_count: n.optional(),
      ld_names: z.array(s).optional(),
      broken_names: z.array(s).optional(),
    })
    .optional(),
  sector_risk: SectorRisk.optional(),
  ladder: z.array(LadderGroup).optional(),
  newsflash: z
    .array(z.object({ title: s.optional(), plates: z.array(s).optional(), stocks: z.array(s).optional() }))
    .optional(),
  em_expect: z.array(EmExpect).optional(),
  early: z.array(EarlyItem).optional(),
  leaders: z.array(Leader).optional(),
  rising: z.array(z.unknown()).optional(),
  hot_spots: z
    .array(
      z.object({
        sector: s.optional(),
        stocks: z
          .array(
            z.object({
              name: s.optional(),
              code: s.optional(),
              pct: n.optional(),
              price: n.optional(),
              buyable: b.optional(),
              is_20cm: b.optional(),
              boards: s.optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  /** 两市成交额（亿元）· 盘前/早段为 null */
  market: nOrNull.optional(),
  breadth: z
    .object({ up: nOrNull.optional(), down: nOrNull.optional(), flat: nOrNull.optional() })
    .optional(),
  data_scope: z.object({ breadth: s.optional(), amount: s.optional(), asof: s.optional() }).optional(),
  ebb: EbbInfo.nullable().optional(),
  top5: z.array(ThemeTop).optional(),
  sector_delta: z
    .object({ new: z.array(s).optional(), surging: z.array(s).optional(), ongoing: z.array(s).optional() })
    .optional(),
})

// ════════════════════════════════════════════════════════════════
// ShortSpiritSignals —— /api/market/signals
// ════════════════════════════════════════════════════════════════

export const ShortSpiritSignalsSchema = z.object({
  ts: s.optional(),
  session: s.optional(),
  thresholds: z
    .object({
      min_pct: n.optional(),
      min_market_cap_yi: nOrNull.optional(),
      amount_morning_yi: n.optional(),
      amount_afternoon_yi: n.optional(),
    })
    .optional(),
  pool_total: n.optional(),
  after_filter: n.optional(),
  signals: z
    .array(
      z.object({
        name: s.optional(),
        code: s.optional(),
        sector: s.optional(),
        market_cap_yi: nOrNull.optional(),
        amount_yi: n.optional(),
        pct: n.optional(),
        type: s.optional(),
        tags: z.array(s).optional(),
        resonance: n.optional(),
        flow_yi: n.optional(),
        strength: n.optional(),
        reason: s.optional(),
      }),
    )
    .optional(),
})

// ════════════════════════════════════════════════════════════════
// FeedbackMatrix —— /api/market/feedback
// ════════════════════════════════════════════════════════════════

export const FeedbackMatrixSchema = z.object({
  generated_ts: s.optional(),
  date: s.optional(),
  prev_date: s.optional(),
  prev_zt_count: n.optional(),
  now_zt_count: n.optional(),
  promote_count: n.optional(),
  promote_rate: n.optional(),
  lb_prev_count: n.optional(),
  lb_promote_count: n.optional(),
  lb_promote_rate: n.optional(),
  avg_pct: n.optional(),
  quote_fail_count: n.optional(),
  up_rate: n.optional(),
  strong_count: n.optional(),
  /** 核按钮数量（≥3 判恶化） */
  nuke_count: n.optional(),
  break_count: n.optional(),
  market_missing: b.optional(),
  nuke_list: z.array(z.unknown()).optional(),
  big_loss_count: n.optional(),
  broken_rate: n.optional(),
  prev_max_boards: n.optional(),
  now_max_boards: n.optional(),
  max_trend: n.optional(),
  zt_expand: n.optional(),
  idx_avg: n.optional(),
  market_amount_yi: n.optional(),
  breadth: z.object({ up: n.optional(), down: n.optional() }).optional(),
  promote_list: z
    .array(z.object({ name: s.optional(), code: s.optional(), prev_boards: n.optional(), pct: n.optional() }))
    .optional(),
  sentiment_score: n.optional(),
  sentiment_label: s.optional(),
  regulatory_pressure: n.optional(),
  trend: z
    .object({
      promote_downtrend: b.optional(),
      avg_pct_weak: b.optional(),
      defense_level: n.optional(),
      history: z.array(z.object({ date: s.optional(), pr: n.optional(), ap: n.optional() })).optional(),
      /** 晋级率动态阀门（前 10 交易日截尾均值，缺失回退 25） */
      promotion_gate_10d: n.optional(),
    })
    .optional(),
  /** 原系统异常态标记（存在时该文件不可用） */
  error: s.optional(),
})

// ════════════════════════════════════════════════════════════════
// AuctionLive —— /api/market/auction
// ════════════════════════════════════════════════════════════════

export const AuctionLiveSchema = z.object({
  /** 形如 "09:29:14" */
  ts: s.optional(),
  /** 股票代码(6位) → 竞价涨幅% */
  quotes: z.record(s, n).optional(),
})

// ════════════════════════════════════════════════════════════════
// CandidatesFile —— /api/market/candidates
// ════════════════════════════════════════════════════════════════

export const CandidatesFileSchema = z.object({
  generated_at: s.optional(),
  phase: s.optional(),
  count: n.optional(),
  candidates: z
    .array(
      z.object({
        name: s.optional(),
        code: s.optional(),
        pct: n.optional(),
        sector: s.optional(),
        is_20cm: b.optional(),
        boards: n.optional(),
        sealed: b.optional(),
        buyable: b.optional(),
        price: n.optional(),
        turnover: nOrNull.optional(),
        reason: s.optional(),
      }),
    )
    .optional(),
})

// ════════════════════════════════════════════════════════════════
// RotationData —— /api/theme/rotation
// ════════════════════════════════════════════════════════════════

const PoolStock = z.object({
  code: s.optional(),
  name: s.optional(),
  dragon: b.optional(),
  pct: n.optional(),
  cap_yi: nOrNull.optional(),
  board: s.optional(),
  from_zt: b.optional(),
  risk: s.optional(),
})

const SectorFlowFull = z.object({
  name: s.optional(),
  code: s.optional(),
  pct: n.optional(),
  main_inflow: n.optional(),
  flow_yi: n.optional(),
  is_focus: b.optional(),
  super_large_yi: n.optional(),
  large_yi: n.optional(),
  mid_yi: n.optional(),
  small_yi: n.optional(),
  source_ts: n.optional(),
})

export const RotationDataSchema = z.object({
  date: s.optional(),
  generated_ts: s.optional(),
  data_days: z.array(s).optional(),
  candidates: z
    .array(
      z.object({
        theme: s.optional(),
        phase: s.optional(),
        /** ⚠️ 实测存在 null（该题材窗口内未完成完整爆发），非空串 */
        boom_day: z.string().nullable().optional(),
        cooled_days: n.optional(),
        catalyst: s.optional(),
        catalyst_fresh: b.optional(),
        confidence: n.optional(),
        confidence_factors: z
          .object({
            catalyst: b.optional(),
            market: z.boolean().nullable().optional(),
            capital: s.optional(),
            phase: s.optional(),
          })
          .optional(),
        trigger: s.optional(),
        watch_pool: z.array(PoolStock).optional(),
        main_board_pool: z.array(PoolStock).optional(),
        board_mix: z.object({ main: n.optional(), cyb: n.optional() }).optional(),
        pool_note: s.optional(),
        flow_trend: s.optional(),
        flow_vals: z.array(nOrNull).optional(),
        /** ⚠️ 同花顺口径资金与爆发指标：早于口径上线 / 未爆发时为 null */
        tx_10d_yi: nOrNull.optional(),
        tx_5d_yi: nOrNull.optional(),
        boom_zt: nOrNull.optional(),
        boom_pct: nOrNull.optional(),
        zt_series: z.array(nOrNull).optional(),
        zt_dir: s.optional(),
        zt_filled: z.record(s, n).optional(),
        zt_valid_days: n.optional(),
        today_hot: b.optional(),
      }),
    )
    .optional(),
  sector_zt_trends: z
    .array(
      z.object({
        theme: s.optional(),
        zt_series: z.array(nOrNull).optional(),
        latest: n.optional(),
        delta: n.optional(),
        dir: s.optional(),
        zt_filled: z.record(s, n).optional(),
      }),
    )
    .optional(),
  market_context: z
    .object({
      sentiment_score: n.optional(),
      nuke_count: n.optional(),
      promote_rate: n.optional(),
      outflow_top: z.array(SectorFlowFull).optional(),
      inflow_top: z.array(SectorFlowFull).optional(),
      zt_count_today: n.optional(),
    })
    .optional(),
  flow_5d: z
    .object({
      inflow_top: z
        .array(
          z.object({
            name: s.optional(),
            total_yi: n.optional(),
            days: n.optional(),
            inflow_days: n.optional(),
            last_yi: n.optional(),
            trend: s.optional(),
          }),
        )
        .optional(),
      outflow_top: z
        .array(
          z.object({
            name: s.optional(),
            total_yi: n.optional(),
            days: n.optional(),
            inflow_days: n.optional(),
            last_yi: n.optional(),
            trend: s.optional(),
          }),
        )
        .optional(),
      data_days: z.array(s).optional(),
    })
    .optional(),
  avoidance_sweep: z
    .array(
      z.object({
        name: s.optional(),
        total_5d_yi: n.optional(),
        last_yi: n.optional(),
        inflow_days: n.optional(),
        trigger: s.optional(),
        tier: s.optional(),
        stance: s.optional(),
        upgrade_hint: s.optional(),
      }),
    )
    .optional(),
  data_meta: z
    .object({
      zt_source: s.optional(),
      flow_source: s.optional(),
      window: s.optional(),
      aligned_days: n.optional(),
      zt_filled_themes: n.optional(),
    })
    .optional(),
  note: s.optional(),
})

// ════════════════════════════════════════════════════════════════
// ThemeSeries —— /api/theme/series
// ════════════════════════════════════════════════════════════════

export const ThemeSeriesSchema = z.object({
  generated_ts: s.optional(),
  dates: z.array(s).optional(),
  daily_totals: z.array(n).optional(),
  max_boards: z.array(n).optional(),
  daily_details: z
    .array(
      z.object({
        total: n.optional(),
        max_boards: n.optional(),
        count_20cm: nOrNull.optional(),
        boards_2plus: nOrNull.optional(),
        boards_4plus: nOrNull.optional(),
        sentiment: n.optional(),
        seal_rate: n.optional(),
        broken: n.optional(),
      }),
    )
    .optional(),
  /** 题材名 → N 日涨停数序列 */
  themes: z.record(s, z.array(nOrNull)).optional(),
  /** 题材名 → N 日龙头序列 */
  theme_leaders: z
    .record(
      s,
      z.array(z.object({ name: s.optional(), code: s.optional(), boards: n.optional(), pct: n.optional() }).nullable()),
    )
    .optional(),
  theme_labels: z.array(s).optional(),
  table_rows: z
    .array(
      z.object({
        theme: s.optional(),
        values: z.array(nOrNull).optional(),
        delta: n.optional(),
        delta_str: s.optional(),
        trend: s.optional(),
        leader_today: z
          .object({ name: s.optional(), code: s.optional(), boards: n.optional(), pct: n.optional() })
          .nullable()
          .optional(),
      }),
    )
    .optional(),
})

// ════════════════════════════════════════════════════════════════
// DecisionDossier —— /api/decision/{candidates,latest,archive}
//
// ⚠️ 这是财富密码选股链的**唯一产出物**，也是「当时凭什么这么选」的原件。
//    它此前被误绑成 CandidatesFile（同名字段 `candidates` 实际不存在），
//    故这一层守卫特别值得写：结构一旦漂移，页面会静默读空。
//
// ⚠️ 个股对象实测有 70+ 字段且仍在演进，此处**只校验被渲染的核心字段**，
//    其余经 `catchall` 透传 —— 追求全量映射会让正常演进误报成契约破坏。
// ════════════════════════════════════════════════════════════════

const DossierExpectation = z
  .object({
    /**
     * ⚠️ 三个区间字段实测都是**二元数组** `[下沿, 上沿]`，不是标量。
     *    此前误标为 `s` / `n`，守卫每次都报「expected array, received string」
     *    之类的反向错误 —— 守卫报错方向反了，说明是类型定义错了，不是数据错了。
     */
    expected_range: z.array(n).nullable().optional(),
    super_gap_min: nOrNull.optional(),
    auction_amount_min_yi: n.optional(),
    auction_amount_super_yi: n.optional(),
    auction_amount_range: z.array(n).optional(),
    amount_ratio: z.array(n).optional(),
    auction_boom_yi: n.optional(),
    boom_label: s.optional(),
    gap_strength: s.optional(),
    gap_strength_hint: s.optional(),
    seal_form: s.optional(),
    seal_zbc: n.optional(),
    sector_tier: s.optional(),
    sector_sentiment: s.optional(),
    /** 计划买入条件原文（脚本排版，页面直接展示） */
    expected_text: s.optional(),
    super_text: s.optional(),
    low_text: s.optional(),
    phase: s.optional(),
    phase_note: s.optional(),
    theme_phase: s.optional(),
    confidence: n.optional(),
    ai_note: s.optional(),
    is_ai: b.optional(),
    non_tradeable: b.optional(),
    ai_override: b.optional(),
    /** 龙头三要素诊断：嵌套对象，只校验到 composite/identity 一层 */
    dragon_diagnosis: z
      .object({
        composite: n.optional(),
        identity: s.optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown())

const DossierStock = z
  .object({
    code: s.optional(),
    name: s.optional(),
    theme: s.optional(),
    score: n.optional(),
    ign_score: n.optional(),
    exp_score: n.optional(),
    lead_score: n.optional(),
    cap_score: n.optional(),
    raw_score: n.optional(),
    themeTier: n.optional(),
    tags: z.array(s).optional(),
    /** ⚠️ 实测为 null（部分阶段未回填），不是缺失 */
    price: nOrNull.optional(),
    pct: n.optional(),
    boards: n.optional(),
    hs: n.optional(),
    zbc: n.optional(),
    fbt: s.optional(),
    seal_amt: n.optional(),
    lt_mktcap: n.optional(),
    cje_yi: n.optional(),
    sector: s.optional(),
    core_theme: s.optional(),
    core_theme_logic: s.optional(),
    core_theme_heat: s.optional(),
    ladder_health: n.optional(),
    ladder_has_complete: b.optional(),
    ladder_grade: s.optional(),
    is_sector_dragon: b.optional(),
    sector_mates_cnt: n.optional(),
    theme_mates_cnt: n.optional(),
    theme_name: s.optional(),
    theme_is_lone: b.optional(),
    theme_has_sector_effect: b.optional(),
    sector_is_lone: b.optional(),
    carry_cnt: n.optional(),
    carry_time: s.optional(),
    carry_score: n.optional(),
    history_relay_prob: n.optional(),
    history_relay_samples: n.optional(),
    history_relay_stock_samples: n.optional(),
    history_relay_factor: n.optional(),
    history_relay_note: s.optional(),
    is_capacity_core: b.optional(),
    style_tag: s.optional(),
    is_20cm: b.optional(),
    is_st: b.optional(),
    is_one_word: b.optional(),
    expectation: DossierExpectation.optional(),
    dim_panel: z.record(s, z.unknown()).optional(),
    quant_dims: z.record(s, z.unknown()).optional(),
    narrative: s.optional(),
    main_flow_yi: n.optional(),
    main_flow_5d_yi: n.optional(),
    main_flow_10d_yi: n.optional(),
    main_flow_20d_yi: n.optional(),
    chip_profit_rate: n.optional(),
    chip_avg_cost: n.optional(),
    chip_conc90: n.optional(),
  })
  .catchall(z.unknown())

const DecisionDossierSchema = z.object({
  schema: s.optional(),
  date: s.optional(),
  generated_at_bj: s.optional(),
  regime: s.optional(),
  environment: z
    .object({
      sentiment_score: n.optional(),
      sentiment_label: s.optional(),
      promote_rate: n.optional(),
      nuke_count: n.optional(),
      broken_rate: n.optional(),
      break_count: n.optional(),
      up_rate: n.optional(),
      avg_pct: n.optional(),
      now_zt_count: n.optional(),
      regime: s.optional(),
    })
    .catchall(z.unknown())
    .optional(),
  real_env: z
    .object({
      ts: s.optional(),
      indices: z.array(IndexQuote).optional(),
      avg_index_pct: n.optional(),
      sentiment: s.optional(),
      sentiment_score: n.optional(),
      total_zt: n.optional(),
    })
    .catchall(z.unknown())
    .optional(),
  ai_env: z.record(s, z.unknown()).optional(),
  data_source: s.optional(),
  relay: z.array(DossierStock).optional(),
  watch: z.array(DossierStock).optional(),
  early_ambush: z.array(EarlyItem).optional(),
  diagnostics: z
    .object({
      scored: n.optional(),
      strict_pool: n.optional(),
      height_breakout_eligible: n.optional(),
      high_mark_eligible: n.optional(),
      core_eligible: n.optional(),
      one_to_two_eligible: n.optional(),
      relay_count: n.optional(),
      watch_count: n.optional(),
      selection_mode: s.optional(),
      mean_raw_score: n.optional(),
      early_buy_hits: n.optional(),
      early_buy_signals: z.array(z.object({ code: s.optional(), type: s.optional() })).optional(),
      weak2strong_hits: n.optional(),
      weak2strong_codes: z.array(s).optional(),
      tx_enriched: n.optional(),
      regulatory_enriched: n.optional(),
      excluded_low_turnover: n.optional(),
      excluded_688: n.optional(),
      data_source: s.optional(),
      pulse_ts: s.optional(),
    })
    .catchall(z.unknown())
    .optional(),
  /**
   * ⚠️ 必须 `.nullable()`：`decision_log/<日期>/candidates.json` 的**旧归档**里
   * 该字段实测为 `null`（旁白是后加的，早于它的归档没有内容）。
   * 只写 `.optional()` 会让「旧归档」被误判为结构不符。
   */
  global_narrative: s.nullable().optional(),
})

// ════════════════════════════════════════════════════════════════
// 其余（结构简单，只校验顶层类型）
// ════════════════════════════════════════════════════════════════

export const ThemeSequenceSchema = z.object({
  date: s.optional(),
  themes: z.array(s).optional(),
  updated: s.optional(),
})

export const FlowHistorySchema = z.array(
  z.object({ file: s.optional(), data: z.record(s, z.unknown()).nullable().optional() }),
)

export const HealthPayloadSchema = z.object({
  data_root: s.optional(),
  ts: s.optional(),
  files: z
    .array(
      z.object({
        route: s.optional(),
        file: s.optional(),
        desc: s.optional(),
        exists: b.optional(),
        mtime: s.nullable().optional(),
        age_sec: nOrNull.optional(),
        size: n.optional(),
      }),
    )
    .optional(),
})

// ════════════════════════════════════════════════════════════════
// 路由 → schema 绑定
// ════════════════════════════════════════════════════════════════
//
// ⚠️ 这是**可选**注册表，不是全量清单。60+ 条路由里只对少数关键契约写守卫，
//    其余走「无守卫」直通。理由（项目既定原则）：
//      数据缺失是正常状态 —— 守卫的作用是**暴露结构异常**，不是拦截数据。
//      为每条路由都硬写 schema，只会让新增数据源的成本高到没人愿意加。
//
// ⚠️ 对外导出为 `Record<string, ZodType | undefined>` 而非 `as const` 字面量对象：
//    `fetchRoute<K extends ApiRoute>` 需要用任意路由名索引它。若保持字面量类型，
//    TS 会因「K 可能是未登记的键」而报 TS2536。字面量类型由 GuardedRoute 保留。

const SCHEMA_MAP = {
  '/api/market/latest': MarketSnapshotSchema,
  '/api/market/prev': MarketSnapshotSchema,
  '/api/market/auction': AuctionLiveSchema,
  '/api/market/signals': ShortSpiritSignalsSchema,
  '/api/market/feedback': FeedbackMatrixSchema,
  '/api/market/candidates': CandidatesFileSchema,
  '/api/theme/rotation': RotationDataSchema,
  '/api/theme/series': ThemeSeriesSchema,
  '/api/theme/sequence': ThemeSequenceSchema,
  '/api/flow/history': FlowHistorySchema,
  // 财富密码决策档案：三态同构（存档数组 / 最新单份），守卫同一份结构
  '/api/decision/latest': DecisionDossierSchema,
  '/api/decision/candidates': z.array(z.object({ file: s.optional(), data: DecisionDossierSchema.nullable() })),
  '/api/decision/archive': z.array(z.object({ file: s.optional(), data: DecisionDossierSchema.nullable() })),
  '/api/health': HealthPayloadSchema,
} as const

/** 已登记结构守卫的路由（字面量联合，供需要穷举的场景用） */
export type GuardedRoute = keyof typeof SCHEMA_MAP

/** 可按任意路由名索引的守卫表；未登记的路由返回 undefined（= 不校验） */
export const SCHEMAS: Record<string, z.ZodType | undefined> = SCHEMA_MAP
