import type {
  EmotionSummary5D,
  FeedbackMatrix,
  LadderGroup,
  PromoSummary,
  ZtPoolStock,
} from '@/shared/api'

/**
 * **赚钱效应 / 亏钱效应 的纯计算内核**（2026-09-23 立项 · 与 React 无关 · 可单测）。
 *
 * 权威设计：`狸猫猎手/config/design_赚钱效应亏钱效应_EffectEngine.md`。
 *
 * ## 理论根基（决定了本模块的一切结构）
 *
 * 短线语境下「赚钱效应 / 亏钱效应」 = **昨日出手的人今天赚了还是亏了**。
 * 因此两轴**共用同一个池子**（昨涨停池 `prev_zt_count`），按今日涨跌**分组**：
 * 上行侧 = 赚钱效应，下行侧 = 亏钱效应 —— 这是天然正交的分解，
 * ⛔ 不是「同一批因子拆成两半」的硬凑。
 *
 * ## ⛔ 三条硬规则
 *
 * 1. **档位阈值一律复用** `feedback_matrix.sentiment_score` 的既有 if/elif 档
 *    （宪法「不重复造规则」）。本模块只做**映射与聚合**，⛔ 不新立阈值。
 * 2. **⛔ 不产出 0-100 的「效应分」** —— 那是伪精确（看着像概率却不是）。
 *    轴位一律用 `level ∈ [-2, +2]` 的**阶梯位置**（原始读数的均值）。
 * 3. **缺料 → `null`**，⛔ 永不退化成 0（「没数据」和「数据是 0」是两件事）。
 */

// ════════════════════════════════════════════════════════════════
// 档位
// ════════════════════════════════════════════════════════════════

/** 五档定性（t5 最高 → t1 最低）。⚠️ 语义随轴而定：赚钱轴 t5=最强，亏钱轴 t5=最危险。 */
export type Tier = 't5' | 't4' | 't3' | 't2' | 't1'

/** 轴位 = 该轴全部读数阶梯位置的均值（∈ [-2, +2]）；`null` = 全部读数都缺料 */
export type AxisLevel = number | null

const TIER_OF_LEVEL = (level: AxisLevel): Tier => {
  if (level == null) return 't3'
  if (level >= 1.5) return 't5'
  if (level >= 0.5) return 't4'
  if (level > -0.5) return 't3'
  if (level > -1.5) return 't2'
  return 't1'
}

/**
 * 五档 → 中文定性词。
 *
 * ⚠️ **两轴共用一个词表**：`level` 在两轴上都是**「本轴强度」**
 * （赚钱轴的 level 高 = 赚钱强；亏钱轴的 level 高 = 亏钱强）。
 * 因此「亏钱效应 强」是**坏消息** —— 差异体现在**配色**而非用词，
 * ⛔ 不要给亏钱轴套反向词表（会得到「亏钱效应 弱」这种读反的结论）。
 */
const TIER_WORD: Record<Tier, string> = {
  t5: '强',
  t4: '偏强',
  t3: '中性',
  t2: '偏弱',
  t1: '弱',
}

// ════════════════════════════════════════════════════════════════
// 第一层：当日双轴
// ════════════════════════════════════════════════════════════════

/** 单条读数（一个原始指标 + 它在轴上的阶梯位置） */
export interface EffectReading {
  /** 稳定键（测试与 React key 用） */
  key: string
  label: string
  /** 展示值，已格式化；缺料为 `'—'` */
  value: string
  /** 原始数值；缺料 `null` */
  raw: number | null
  /** 阶梯位置 ∈ [-2, +2]；缺料 `null` */
  level: number | null
  /** 口径小注（阈值出处） */
  hint: string
}

export interface EffectAxis {
  /** 轴位：读数阶梯位置均值；全缺料 → `null` */
  level: AxisLevel
  tier: Tier
  /** 定性词（两轴同一词表 —— 描述的是「本轴强度」；差异在配色，见 `TIER_WORD` 注释） */
  word: string
  readings: EffectReading[]
  /** 本轴缺料的读数量（用于「数据不足」提示） */
  missing: number
}

export interface EffectAxes {
  gain: EffectAxis
  loss: EffectAxis
  /** 基准信息（⛔ 页面必须展示池子大小，否则「占比类」读数无从解读） */
  basis: {
    date: string
    prevDate: string
    /** 昨涨停池家数（两轴共同分母） */
    prevZtCount: number | null
    nowZtCount: number | null
    promoteCount: number | null
  }
  /** 数据可信度提示（如盘面量能/广度缺失） */
  caveats: string[]
}

/**
 * 阶梯表：`[阈值, 档位]`，从高到低，**末项必须是 `-Infinity` 兜底** ——
 * ⛔ 不用「fallback 参数」代替末项：那种写法一旦漏掉一档就静默取到错误值。
 */
type Ladder = ReadonlyArray<readonly [number, number]>
const NEG_INF = Number.NEGATIVE_INFINITY

const ladderLevel = (v: number | null, l: Ladder): number | null => {
  if (v == null || !Number.isFinite(v)) return null
  for (const [min, lvl] of l) if (v >= min) return lvl
  return null
}

/**
 * 阈值**照抄** `scripts/feedback_matrix.py::sentiment_score`；档位已线性归一化到 `±2`
 * （注释里的「原」= 系统原始 addend，**阈值与档序完全一致，只换量纲**）。
 *
 * ⛔ 改阈值只改上面那份脚本，本文件跟着抄 —— 不得在此处另立数值。
 * ⚠️ 例外（已在 `hint` 里向使用者明示）：`strong`（强势家数占比）与 `big_loss`（大面占比）
 *    是**本页新增的比例派生量**（系统算了这两个数但没拿它们打分），其档位由本页定义。
 */
const L_UP_RATE: Ladder = [
  [70, 2], [60, 1.33], [50, 0.67], [45, 0], [35, -0.67], [NEG_INF, -1.33],
  // 原 +1.5 / +1.0 / +0.5 / 0 / −0.5 / −1.0
]
const L_AVG_PCT: Ladder = [
  [3, 2], [1, 1], [-1, 0], [-3, -1], [NEG_INF, -2],
  // 原 +1.0 / +0.5 / 0 / −0.5 / −1.0
]
const L_ZT_EXPAND: Ladder = [
  [0.6, 2], [0.3, 1.5], [0.1, 1], [0, 0.5], [-0.1, -0.5], [-0.3, -1], [NEG_INF, -1.5],
  // 原 +2.0 / +1.5 / +1.0 / +0.5 / −0.5 / −1.5（自身已是 ±2 量纲，不再缩放）
]
const L_PROMOTE: Ladder = [
  [50, 2], [35, 1], [25, 0], [15, -1], [NEG_INF, -2],
  // 原 +1.0 / +0.5 / 0 / −1.0
]
const L_LB_PROMOTE: Ladder = [
  [50, 2], [30, 0], [NEG_INF, -2],
  // 原 +0.5 / 0 / −0.5
]

/** 亏钱轴：把系统 addend **取反**（系统里「坏」是负分，本轴「坏」是正档） */
const L_NUKE: Ladder = [
  [5, 2], [3, 1], [1, 0.5], [NEG_INF, -1],
  // 原 ≥5→−2.0 / ≥3→−1.0 / ≥1→−0.5 / 0 家→**+0.5（正分项）** ⇒ 取反后 0 家是最强的负档
]
const L_BREAK: Ladder = [
  [3, 2], [1, 1], [NEG_INF, -1],
  // 原 ≥3→−1.0 / ≥1→−0.5 / 0→0（0 家给 −1：没有真破位是干净的好）
]

/** 炸板率：系统是**两端判定**（高要罚、低要奖），单调阶梯表达不了 —— 用显式分支 */
const BROKEN_HI = 0.4
const BROKEN_MID = 0.25
const BROKEN_LOW = 0.15
function brokenLevel(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if (v > BROKEN_HI) return 2 // 原 −1.0
  if (v > BROKEN_MID) return 1 // 原 −0.5
  if (v < BROKEN_LOW) return -2 // 原 +0.5（低炸板率是正分项 ⇒ 取反为强负档）
  return 0
}

/** 指数强度：同样两端判定；亏钱轴取反（指数越弱亏钱越重） */
function idxLevel(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if (v <= -2.5) return 2 // 原 −1.0
  if (v <= -1.0) return 1 // 原 −0.5
  if (v >= 2.5) return -2 // 原 +1.0
  if (v >= 1.5) return -1 // 原 +0.5
  return 0
}

/** 强势家数占比（本页派生）：昨涨停池中今日涨 ≥5% 的家数 / 池子 */
function strongLevel(ratio: number | null): number | null {
  if (ratio == null || !Number.isFinite(ratio)) return null
  if (ratio >= 0.3) return 2
  if (ratio >= 0.2) return 1
  if (ratio >= 0.12) return 0
  return -1
}

/** 大面家数占比（本页派生）：昨涨停池中今日跌 ∈[−5%,−3%) 的家数 / 池子 */
function bigLossLevel(ratio: number | null): number | null {
  if (ratio == null || !Number.isFinite(ratio)) return null
  if (ratio >= 0.15) return 1
  if (ratio >= 0.08) return 0.5
  if (ratio < 0.05) return -1
  return 0
}

const fmtPct1 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

const fmtRatio = (num: number | null, den: number | null): string => {
  if (num == null || den == null || den <= 0) return '—'
  return `${num}/${den}`
}

/** 由 `feedback_matrix.json` 算出双轴（纯函数）。`fb` 为空/error → 两轴皆缺料但结构完整。 */
export function buildEffectAxes(fb: FeedbackMatrix | null | undefined): EffectAxes {
  const empty: EffectAxes = {
    gain: { level: null, tier: 't3', word: TIER_WORD.t3, readings: [], missing: 0 },
    loss: { level: null, tier: 't3', word: TIER_WORD.t3, readings: [], missing: 0 },
    basis: { date: '', prevDate: '', prevZtCount: null, nowZtCount: null, promoteCount: null },
    caveats: ['反馈矩阵不可用'],
  }
  if (!fb || fb.error) return empty

  const prevN = fb.prev_zt_count ?? null
  const caveats: string[] = []
  if (fb.market_missing) caveats.push('量能 / 涨跌广度缺失（两轴修正项按中性计）')
  if ((fb.quote_fail_count ?? 0) > 0) {
    caveats.push(`${fb.quote_fail_count} 只行情缺失，未计入均值/占比`)
  }

  // ── 赚钱轴（上行侧）──
  const strongRatio = prevN && prevN > 0 && fb.strong_count != null ? fb.strong_count / prevN : null
  const gainReadings: EffectReading[] = [
    {
      key: 'up_rate',
      label: '上涨广度',
      value: fb.up_rate == null ? '—' : `${fb.up_rate.toFixed(1)}%`,
      raw: fb.up_rate ?? null,
      level: ladderLevel(fb.up_rate ?? null, L_UP_RATE),
      hint: '昨涨停池今日上涨占比（系统档位 ≥70/≥60/≥50/45~50 中性/<45/<35）',
    },
    {
      key: 'avg_pct',
      label: '赚钱质量',
      value: fmtPct1(fb.avg_pct),
      raw: fb.avg_pct ?? null,
      level: ladderLevel(fb.avg_pct ?? null, L_AVG_PCT),
      hint: '昨涨停池今日平均涨幅（系统档位 >3/>1/−1~1 中性/>−3/≤−3）',
    },
    {
      key: 'strong',
      label: '强势家数',
      value: fmtRatio(fb.strong_count ?? null, prevN),
      raw: fb.strong_count ?? null,
      level: strongLevel(strongRatio),
      hint: '昨日涨停票中今日涨 ≥5% 的家数 / 昨池家数（本页派生的比例档：≥30%/≥20%/≥12%）',
    },
    {
      key: 'zt_expand',
      label: '涨停扩张',
      value: fb.zt_expand == null ? '—' : `${fb.zt_expand > 0 ? '+' : ''}${(fb.zt_expand * 100).toFixed(0)}%`,
      raw: fb.zt_expand ?? null,
      level: ladderLevel(fb.zt_expand ?? null, L_ZT_EXPAND),
      hint: '今日涨停家数 / 昨日 − 1（系统档位 ≥+60%/≥+30%/≥+10%/≥0/≤−10%/≤−30%）',
    },
    {
      key: 'promote_rate',
      label: '晋级率',
      value: fb.promote_rate == null ? '—' : `${fb.promote_rate.toFixed(1)}%`,
      raw: fb.promote_rate ?? null,
      level: ladderLevel(fb.promote_rate ?? null, L_PROMOTE),
      hint: '昨涨停→今涨停（系统档位 ≥50/≥35/≥25/<15）',
    },
    {
      key: 'lb_promote_rate',
      label: '连板晋级',
      value: fb.lb_promote_rate == null ? '—' : `${fb.lb_promote_rate.toFixed(1)}%`,
      raw: fb.lb_promote_rate ?? null,
      level: ladderLevel(fb.lb_promote_rate ?? null, L_LB_PROMOTE),
      hint: `昨 ≥2 板→今仍涨停（${fmtRatio(fb.lb_promote_count ?? null, fb.lb_prev_count ?? null)}·系统档位 ≥50/<30）`,
    },
  ]

  // ── 亏钱轴（下行侧）── 档位为正 = 亏钱更强
  const nukes = fb.nuke_count ?? null
  const bigLossRatio = prevN && prevN > 0 && fb.big_loss_count != null ? fb.big_loss_count / prevN : null
  const lossReadings: EffectReading[] = [
    {
      key: 'nuke',
      label: '核按钮',
      value: `${fmtRatio(nukes, prevN)}`,
      raw: nukes,
      level: ladderLevel(nukes, L_NUKE),
      hint: '昨涨停池中今日跌 <−5% 的家数 / 昨池家数（系统档位 ≥5/≥3/≥1/0 家）',
    },
    {
      key: 'big_loss',
      label: '大面家数',
      value: `${fmtRatio(fb.big_loss_count ?? null, prevN)}`,
      raw: fb.big_loss_count ?? null,
      level: bigLossLevel(bigLossRatio),
      hint: '昨涨停池中今日跌 ∈[−5%,−3%) 的家数 / 昨池家数（本页派生的比例档：≥15%/≥8%/<5%）',
    },
    {
      key: 'breakdown',
      label: '真破位',
      value: fb.break_count == null ? '—' : `${fb.break_count} 家`,
      raw: fb.break_count ?? null,
      level: ladderLevel(fb.break_count ?? null, L_BREAK),
      hint: '核按钮中**同时**跌破 MA5+MA10 的家数（系统档位 ≥3/≥1）',
    },
    {
      key: 'broken_rate',
      label: '炸板率',
      value: fb.broken_rate == null ? '—' : `${(fb.broken_rate * 100).toFixed(1)}%`,
      raw: fb.broken_rate ?? null,
      level: brokenLevel(fb.broken_rate ?? null),
      hint: `炸板 /(炸板+涨停)（系统档位 >${BROKEN_HI}/>${BROKEN_MID}/<${BROKEN_LOW}）`,
    },
    {
      key: 'idx_avg',
      label: '指数强度',
      value: fmtPct1(fb.idx_avg),
      raw: fb.idx_avg ?? null,
      level: idxLevel(fb.idx_avg ?? null),
      hint: '三大指数平均涨幅（系统档位 ≥2.5/≥1.5/≤−1.0/≤−2.5；本轴取反 —— 指数越弱亏钱越重）',
    },
  ]

  const mean = (rs: EffectReading[]): AxisLevel => {
    const vals = rs.map((r) => r.level).filter((v): v is number => v != null)
    if (vals.length === 0) return null
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
  }

  const build = (readings: EffectReading[]): EffectAxis => {
    const level = mean(readings)
    const tier = TIER_OF_LEVEL(level)
    return { level, tier, word: TIER_WORD[tier], readings, missing: readings.filter((r) => r.level == null).length }
  }

  return {
    gain: build(gainReadings),
    loss: build(lossReadings),
    basis: {
      date: fb.date ?? '',
      prevDate: fb.prev_date ?? '',
      prevZtCount: prevN,
      nowZtCount: fb.now_zt_count ?? null,
      promoteCount: fb.promote_count ?? null,
    },
    caveats,
  }
}

// ════════════════════════════════════════════════════════════════
// 第二层：历史窗口（T-3 .. T）—— 纯聚合，零推断
// ════════════════════════════════════════════════════════════════

export interface EffectHistoryPoint {
  date: string
  /** 赚钱轴阶梯位置（由 pr/ap 两读数均值；两者皆缺 → null） */
  gainLevel: AxisLevel
  /** 亏钱轴阶梯位置（由 nuke 数；缺 → null） */
  lossLevel: AxisLevel
  /** 晋级率 % */
  pr: number | null
  /** 昨涨停今均涨 % */
  ap: number | null
  /** 情绪分 1-10 */
  sentiment: number | null
  /** 核按钮家数 */
  nuke: number | null
  /** 涨停家数（`summary_5d` 该日常为 null —— 盘前口径） */
  ztCount: number | null
}

/**
 * 历史窗口（T-3..T）。
 *
 * 数据源**双拼并按日期对齐**（⛔ 不对齐就丢弃，不用别日顶替）：
 *   · `feedback.trend.history[]` = `{date, pr, ap}` —— 系统已现成的 5 日双指标序列
 *   · `summary5d.days[]` + `trajectory` —— 情绪分 / 核按钮 / 涨停家数
 */
export function buildEffectHistory(
  fb: FeedbackMatrix | null | undefined,
  summary: EmotionSummary5D | null | undefined,
): EffectHistoryPoint[] {
  const hist = fb?.trend?.history ?? []
  if (hist.length === 0) return []

  const days = summary?.days ?? []
  const traj = summary?.trajectory
  const byDate = <T extends { date?: string }>(arr: T[] | undefined) =>
    new Map((arr ?? []).filter((d) => !!d.date).map((d) => [String(d.date), d]))
  const dayOf = byDate(days)
  const nukeSeq = traj?.nuke_seq ?? []
  const sentSeq = traj?.sentiment_seq ?? []
  // `trajectory` 的序列与 `days` 一一对应（同日序）；越界即缺料
  const seqIndex = (date: string) => days.findIndex((d) => d.date === date)

  return hist.map((h) => {
    const i = seqIndex(h.date)
    const inRange = i >= 0 && i < nukeSeq.length
    const d = dayOf.get(h.date)
    const pr = Number.isFinite(h.pr) ? h.pr : null
    const ap = Number.isFinite(h.ap) ? h.ap : null
    return {
      date: h.date,
      gainLevel: (() => {
        const lv = [ladderLevel(pr, L_PROMOTE), ladderLevel(ap, L_AVG_PCT)].filter(
          (v): v is number => v != null,
        )
        if (lv.length === 0) return null
        return Math.round((lv.reduce((a, b) => a + b, 0) / lv.length) * 100) / 100
      })(),
      lossLevel: (() => {
        const n = inRange ? nukeSeq[i] : null
        return ladderLevel(n ?? null, L_NUKE)
      })(),
      pr,
      ap,
      sentiment: inRange ? (sentSeq[i] ?? d?.sentiment_score ?? null) : (d?.sentiment_score ?? null),
      nuke: inRange ? (nukeSeq[i] ?? null) : null,
      ztCount: d?.zt_count ?? null,
    }
  })
}

// ════════════════════════════════════════════════════════════════
// 第三层：T+1 条件期望
// ════════════════════════════════════════════════════════════════

/** ⛔ 样本线（沿用回测纪律 🔁-9）：低于此值的阶段**只呈现、不参与裁决** */
export const STAGE_MIN_SAMPLE = 30

export interface StageProjection {
  stage: string
  /** 今日池落在该阶段的家数（= 明日待晋级数） */
  count: number
  /** 历史样本量 */
  n: number
  /** 样本是否够裁决（`n >= STAGE_MIN_SAMPLE`） */
  decisive: boolean
  succRate: number | null
  /** 该阶段期望晋级家数 = count × succRate */
  expPromote: number | null
  /** 成功组开盘溢价**中位**（默认展示口径；均值右偏易误导） */
  premOpenMed: number | null
  /** 失败组开盘溢价中位 */
  failOpenMed: number | null
}

export interface NextDayProjection {
  stages: StageProjection[]
  /** 今日池（分布分母）家数 */
  poolTotal: number
  /** 明日期望晋级家数（只累加 `decisive` 阶段） */
  expPromoteCount: number | null
  /** 明日赚钱侧溢价（按 `count×succ` 加权的**中位**期望） */
  gainPremMed: number | null
  /** 明日亏钱侧开盘（按 `count×(1−succ)` 加权的**中位**期望） */
  lossFailMed: number | null
  /** 落进 `poolTotal` 但历史无样本的阶段名（如实列出） */
  uncovered: string[]
  caveats: string[]
}

/** 由「今日板数」推「明日阶段」：今日 N 板 → 明日冲击 N+1 板 */
export const stageOfBoards = (boards: number): string => {
  if (boards <= 1) return '1to2'
  if (boards === 2) return '2to3'
  if (boards === 3) return '3to4'
  return '4to5+'
}

/**
 * 今日涨停池的**板数分布**（T+1 推演的唯一输入）。
 *
 * 优先取当日 `zt_list`（收盘后是精确值）；盘中该文件尚无 `boards` 时，
 * **不编造** —— 返回 `null` 并让调用方走空态。
 */
export function boardsDistribution(
  stocks: ZtPoolStock[] | null | undefined,
): Map<string, number> | null {
  if (!stocks || stocks.length === 0) return null
  const m = new Map<string, number>()
  let counted = 0
  for (const s of stocks) {
    const b = Number(s.boards)
    if (!Number.isFinite(b) || b <= 0) continue
    const st = stageOfBoards(b)
    m.set(st, (m.get(st) ?? 0) + 1)
    counted += 1
  }
  return counted > 0 ? m : null
}

/**
 * 决策时点快照的连板结构 → T+1 推演输入。
 * 快照只提供板数与各层股票数量；本页不读取逐票价格、成交额或封板状态。
 */
export function boardsDistributionFromLadder(
  ladder: LadderGroup[] | null | undefined,
): Map<string, number> | null {
  if (!ladder || ladder.length === 0) return null
  const m = new Map<string, number>()
  let counted = 0
  for (const group of ladder) {
    const boards = Number(group.boards)
    const count = Array.isArray(group.stocks) ? group.stocks.length : 0
    if (!Number.isFinite(boards) || boards <= 0 || count <= 0) continue
    const stage = stageOfBoards(boards)
    m.set(stage, (m.get(stage) ?? 0) + count)
    counted += count
  }
  return counted > 0 ? m : null
}

/**
 * T+1 **条件期望**（⛔ 不是预测）：
 *
 * ```
 * 期望晋级家数 = Σ_stage  N(stage) × succ_rate(stage)
 * 期望赚钱侧   = Σ_stage  N×succ × prem_open_med(stage) ÷ Σ N×succ
 * 期望亏钱侧   = Σ_stage  N×(1−succ) × fail_open_med(stage) ÷ Σ N×(1−succ)
 * ```
 * ⛔ 只累加 `n >= STAGE_MIN_SAMPLE` 的阶段 —— 高标阶段样本常年 <30（实测 4to5+ n=29），
 *    把它们算进期望等于用 29 个样本冒充统计规律。
 */
export function projectNextDay(
  dist: Map<string, number> | null,
  promo: PromoSummary | null | undefined,
): NextDayProjection {
  const rows = promo?.rows ?? []
  const caveats: string[] = []
  if (!dist) {
    return {
      stages: [], poolTotal: 0, expPromoteCount: null, gainPremMed: null, lossFailMed: null,
      uncovered: [], caveats: ['当前快照未提供有效连板梯队，无法生成条件期望'],
    }
  }
  if (rows.length === 0) {
    return {
      stages: [],
      poolTotal: [...dist.values()].reduce((a, b) => a + b, 0),
      expPromoteCount: null, gainPremMed: null, lossFailMed: null, uncovered: [],
      caveats: ['晋级基线不可用（promo_summary 缺失）'],
    }
  }

  const byStage = new Map(rows.map((r) => [r.stage, r]))
  const stages: StageProjection[] = []
  const uncovered: string[] = []
  let poolTotal = 0

  for (const [stage, count] of dist) {
    poolTotal += count
    const row = byStage.get(stage)
    if (!row) {
      uncovered.push(`${stage}(${count})`)
      stages.push({
        stage, count, n: 0, decisive: false,
        succRate: null, expPromote: null, premOpenMed: null, failOpenMed: null,
      })
      continue
    }
    const succ = Number.isFinite(row.succ_rate) ? row.succ_rate / 100 : null
    stages.push({
      stage,
      count,
      n: row.n,
      decisive: row.n >= STAGE_MIN_SAMPLE,
      succRate: succ,
      expPromote: succ == null ? null : count * succ,
      premOpenMed: row.prem_open_med ?? null,
      failOpenMed: row.fail_open_med ?? null,
    })
  }

  // 期望：只用够样本的阶段（⛔ 防小样本冒充规律）
  const use = stages.filter((s) => s.decisive && s.succRate != null)
  const dropped = stages.filter((s) => !s.decisive).reduce((a, s) => a + s.count, 0)
  if (dropped > 0) caveats.push(`${dropped} 只落在历史样本 <${STAGE_MIN_SAMPLE} 的阶段，未计入期望`)

  const expPromoteCount = use.length
    ? Math.round(use.reduce((a, s) => a + (s.expPromote ?? 0), 0) * 10) / 10
    : null

  const weightedMed = (pred: (s: StageProjection) => number | null): number | null => {
    let num = 0
    let den = 0
    for (const s of use) {
      const w = s.count * (s.succRate ?? 0)
      const v = pred(s)
      if (v == null) continue
      num += w * v
      den += w
    }
    return den > 0 ? Math.round((num / den) * 100) / 100 : null
  }
  const weightedMedLoss = (): number | null => {
    let num = 0
    let den = 0
    for (const s of use) {
      const w = s.count * (1 - (s.succRate ?? 0))
      const v = s.failOpenMed
      if (v == null) continue
      num += w * v
      den += w
    }
    return den > 0 ? Math.round((num / den) * 100) / 100 : null
  }

  return {
    stages,
    poolTotal,
    expPromoteCount,
    gainPremMed: weightedMed((s) => s.premOpenMed),
    lossFailMed: weightedMedLoss(),
    uncovered,
    caveats,
  }
}

// ════════════════════════════════════════════════════════════════
// 第四层：T+2 ~ T+4 三情景
// ════════════════════════════════════════════════════════════════

export interface EffectScenario {
  key: 'continue' | 'repair' | 'worsen'
  label: string
  /** 触发条件（机械可判 · ⛔ 不给概率数字） */
  conditions: string[]
  /** 该情景成立时的效应取向 */
  outlook: string
  tone: 'up' | 'rec' | 'down'
  /** 条件当前是否已成立 */
  live: boolean
  /** 已成立/未成立条数 */
  met: { hit: number; total: number }
}

/**
 * 三情景推演（T+2~T+4）。
 *
 * ⛔ **不给概率、不做点预测** —— 只给**机械可判的触发条件**，让使用者盯条件是否成立。
 * 锚点 = `summary_5d.trajectory.turn_signal.dir`（repair / ebb / flat）。
 */
export function buildScenarios(
  fb: FeedbackMatrix | null | undefined,
  summary: EmotionSummary5D | null | undefined,
): EffectScenario[] {
  const traj = summary?.trajectory
  const dir = traj?.turn_signal?.dir ?? ''
  const nukeSeq = traj?.nuke_seq ?? []
  const n = fb?.nuke_count ?? null
  const broken = fb?.broken_rate ?? null
  const ztExpand = fb?.zt_expand ?? null
  const promote = fb?.promote_rate ?? null
  const hist = fb?.trend?.history ?? []
  const prAvg3 = hist.length >= 3
    ? hist.slice(-3).reduce((a, h) => a + (Number(h.pr) || 0), 0) / 3
    : null
  /** 核按钮连续 2 日下降（末两值严格递减） */
  const nukeFalling2 = nukeSeq.length >= 2 && nukeSeq[nukeSeq.length - 1] < nukeSeq[nukeSeq.length - 2]

  const mk = (
    key: EffectScenario['key'],
    label: string,
    tone: EffectScenario['tone'],
    outlook: string,
    items: Array<[string, boolean]>,
  ): EffectScenario => {
    const total = items.length
    const hit = items.filter(([, ok]) => ok).length
    return { key, label, tone, outlook, conditions: items.map(([t]) => t), live: hit === total && total > 0, met: { hit, total } }
  }

  return [
    mk('continue', '延续', 'up', '赚钱/亏钱档位平移，不劣化', [
      [`晋级率 ≥ 前 3 日均值（${prAvg3 == null ? '—' : prAvg3.toFixed(1) + '%'}）`, promote != null && prAvg3 != null && promote >= prAvg3],
      ['核按钮 ≤ 1 家', n != null && n <= 1],
      [`炸板率 < ${BROKEN_MID * 100}%`, broken != null && broken < BROKEN_MID],
    ]),
    mk('repair', '修复', 'rec', '亏钱档位降 1~2 档', [
      [`3 日窗拐点为「修复」（当前 ${dir || '—'}）`, dir === 'repair'],
      ['核按钮连续 2 日下降', nukeFalling2],
    ]),
    mk('worsen', '恶化', 'down', '亏钱档位升 1~2 档', [
      ['核按钮 ≥ 3 家', n != null && n >= 3],
      [`炸板率 > ${BROKEN_HI * 100}%`, broken != null && broken > BROKEN_HI],
      ['涨停扩张 ≤ −30%', ztExpand != null && ztExpand <= -0.3],
    ]),
  ]
}
