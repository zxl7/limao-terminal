/**
 * 白话层 —— 后端**内部枚举** → 屏幕直接可读的中文。
 *
 * ## ⛔ 铁律（2026-09-23 审计确立）
 *
 * **枚举字段必须命中映射表，缺省分支不得直出原 token。**
 * 后端枚举是**英文内部标识**（`inflow_rising` / `boom` / `dragon` …），漏到屏幕就是
 * 「面向机器的输出」。已实测 6 处违规（详见下），一律禁止 `?? raw` / `|| raw` 这类回落。
 *
 * ## ⚠️ 后端的枚举值**不是干净的单值**，有三种形态（实测取证，别只按裸 token 写表）
 *
 * | 形态 | 实例 | 来源 |
 * |---|---|---|
 * | 裸 token | `inflow_rising` / `outflow_widening` | `theme_rotation.py::_confidence` |
 * | **带中文后缀** | `inflow_fading(流入转弱)` / `no_data(无资金流)` / `neutral(无趋势)` | 同上（同一函数内混用） |
 * | **已是中文** | `分歧`（`phase` 候选值之一） | 同上 |
 *
 * 所以解析顺序必须是：**查表 → 剥 `token(后缀)` 取裸 token 查表 → 后缀已含中文则用后缀
 * → 原值已含中文则原样 → 否则「未识别」**。
 * ⛔ 只用「含中文就原样返回」是**不够的** —— `weak_outflow(无趋势)` 会带着英文前缀漏出去。
 *
 * ## 与其他层的关系
 *
 * 后端 `scripts/card_copy_rules.py` 是**飞书卡**的白话门禁单一源，**不覆盖前端消费的 JSON**；
 * 本文件补上前端这一侧。两边词表应保持一致，改词只改这两处。
 *
 * ⚠️ 分层：本层是 `shared/lib`，**纯函数、零依赖**（⛔ 不得 import react / 上层模块），
 * 以便被 Node 脚本与测试直接复用。
 */

/** 中文（CJK 统一表意文字）—— 用于判断「该值是否已经可读」 */
const CJK = /[\u4e00-\u9fff]/

/** 未知枚举的**固定中文**回落 —— ⛔ 绝不回落成原 token */
export const PLAIN_UNKNOWN = '未识别'

/** `token(中文后缀)` 形态 */
const DECORATED = /^([A-Za-z0-9_]+)\s*[（(]([^)）]*)[)）]$/

/**
 * 通用解析。⛔ 这是本文件唯一的解析入口 —— 任何映射都走它，保证回落行为一致
 * （各自写一套回落 = 迟早有一处又变成「直出原 token」）。
 */
function resolve(v: unknown, table: Readonly<Record<string, string>>): string {
  const raw = String(v ?? '').trim()
  if (!raw) return '—' // 空 → 项目统一口径：显示「—」（⛔ 不退化成 0 或空白）
  const exact = table[raw]
  if (exact) return exact
  const m = DECORATED.exec(raw)
  if (m) {
    const bare = table[m[1]]
    if (bare) return bare // `inflow_fading(流入转弱)` → 表里按裸 token 命中
    const suffix = m[2].trim()
    if (CJK.test(suffix)) return suffix // `weak_outflow(无趋势)` → 直接用中文后缀
  }
  if (CJK.test(raw)) return raw // 后端本身就给的中文（如 `分歧`）
  return PLAIN_UNKNOWN
}

const makeMapper =
  (table: Readonly<Record<string, string>>) =>
  (v: unknown): string =>
    resolve(v, table)

/**
 * 资金趋势 `confidence_factors.capital`。
 * 取值源：`scripts/theme_rotation.py::_confidence`（8 种，含带后缀形态）。
 */
export const CAPITAL_PLAIN: Readonly<Record<string, string>> = {
  inflow_rising: '资金转入', // 五日转流入 / 持续流入 —— 回流最强证据
  inflow_fading: '流入转弱', // 窗口内曾有净流入但最近 2 日连续净流出
  outflow_shrinking: '流出收窄', // 全负但幅度收窄 —— 资金止跌迹象
  outflow_widening: '流出放大', // 全负且恶化 —— 最差
  weak_outflow: '小幅流出',
  outflow: '持续流出',
  neutral: '资金无趋势',
  no_data: '无资金数据',
}

/** 题材相位 `candidate.phase`。取值源：`theme_rotation.py::build`（7 种，`分歧` 已是中文） */
export const PHASE_PLAIN: Readonly<Record<string, string>> = {
  boom: '当日爆发',
  watch: '观察期',
  cooling: '降温',
  dead: '已沉寂',
  're-entry-candidate': '待回流',
  'no-reentry': '无回流迹象',
  分歧: '分歧',
}

/** 涨停方向 `candidate.zt_dir`。取值源：`theme_rotation.py`（4 种） */
export const ZT_DIR_PLAIN: Readonly<Record<string, string>> = {
  new: '新启动',
  rising: '走强',
  flat: '走平',
  falling: '转弱',
}

/** 攻守基调 `pool_call.stance`。取值源：`wealth_code/core/pool_call.py`（4 种） */
export const STANCE_PLAIN: Readonly<Record<string, string>> = {
  attack: '进攻',
  selective: '精选',
  defend: '防守',
  hibernate: '空仓观察', // ⚠️ 曾漏此值 —— AiPage 的旧表只有前 3 项，实测出现过 hibernate
}

/** 板块地位 `expectation.sector_tier`。取值源：接力卡（实测 `dragon` / `capacity`） */
export const SECTOR_TIER_PLAIN: Readonly<Record<string, string>> = {
  dragon: '板块龙',
  follower: '跟随',
  lone: '独立',
  capacity: '容量票', // ⚠️ 曾漏此值（旧表只有前 3 项）
}

/** 板块情绪 `expectation.sector_sentiment`。取值源：接力卡（实测 `mid`） */
export const SECTOR_SENTIMENT_PLAIN: Readonly<Record<string, string>> = {
  high: '情绪高',
  mid: '情绪中',
  low: '情绪低',
}

/** 判断终态 `pool_call.views[code].view` / `ai_view.views[code].view`（3 种） */
export const VIEW_PLAIN: Readonly<Record<string, string>> = {
  participate: '参与',
  watch: '观察',
  skip: '放弃',
}

/** 昨日盘后预案档 `views[code].bias`（3 种） */
export const BIAS_PLAIN: Readonly<Record<string, string>> = {
  focus: '重点看',
  normal: '一般',
  avoid: '回避',
}

/** K 线止跌状态 `confidence_factors.kline`。取值源：`theme_rotation.py::_kline_stop_fall` */
export const KLINE_PLAIN: Readonly<Record<string, string>> = {
  stop_fall: '止跌成立',
  not_yet: '尚未止跌',
  no_data: '无K线数据',
}

/**
 * 晋级档 `promotion.stage`。取值源：`cache/promo/promo_summary.json` 实测
 * `1to2 / 2to3 / 3to4 / 4to5+`，另有字符串 `"None"`（无样本）。
 */
export const STAGE_PLAIN: Readonly<Record<string, string>> = {
  '1to2': '1进2',
  '2to3': '2进3',
  '3to4': '3进4',
  '4to5+': '4进5及以上',
  None: '—',
  null: '—',
}

/**
 * 市场环境 `decision.regime`。取值源：`wealth_code/cache/candidates*.json` 实测 `ice`，
 * 同族还有 ebb / repair / boom 与风险偏好三档。
 */
export const REGIME_PLAIN: Readonly<Record<string, string>> = {
  ice: '冰点',
  ebb: '退潮',
  repair: '修复',
  boom: '亢奋',
  risk_on: '进攻',
  neutral: '中性',
  risk_off: '防守',
  hibernate: '空仓',
}

/**
 * 决策存档件角色 `manifest.role`。取值源：`cache/decision_log/<日期>/manifest.json` 实测
 * `card / candidates / ai_view / zt_pool_data`。
 */
export const ROLE_PLAIN: Readonly<Record<string, string>> = {
  card: '卡片原文',
  candidates: '候选原件',
  ai_view: 'AI 观点',
  zt_pool_data: '涨停池',
  auction: '竞价原件',
  manifest: '清单',
}

/**
 * 账户账本口径 `account_nav.caliber`。取值源：`wealth_code/cache/execution_audit.json` 实测
 * `ai` 与空串（空 = 未标注，⛔ 不要回落成「机械」—— 那是把新口径误标成旧口径）。
 */
export const CALIBER_PLAIN: Readonly<Record<string, string>> = {
  ai: 'AI 口径',
  mechanical: '机械口径',
  manual: '手工口径',
}

/** 名额归属 `execution_audit.bucket`。取值源：同上实测 `relay / watch` */
export const BUCKET_PLAIN: Readonly<Record<string, string>> = {
  relay: '接力位',
  watch: '观察位',
}

/**
 * 回测明细的动态列名 → 中文。⛔ 表头不得直接打印 `Object.keys()`。
 * 取值源：`cache/backtest_report_*.json` 的 `metrics` / `summary` 实测字段。
 */
export const BACKTEST_FIELD_PLAIN: Readonly<Record<string, string>> = {
  date: '日期',
  settle_date: '结算日',
  rec_date: '推荐日',
  candidates: '候选数',
  candidate_hit: '候选命中',
  candidate_hit_rate: '候选命中率',
  range_hit: '区间命中',
  range_hit_rate: '区间命中率',
  sentiment_gap: '情绪差',
  sentiment: '情绪分',
  nav: '净值',
  return_pct: '收益率',
  avg_return: '平均收益',
  win_rate: '胜率',
  samples: '样本数',
  stage: '晋级档',
  success_rate: '成功率',
  promote_rate: '晋级率',
  count: '数量',
  skipped: '跳过',
  reason: '说明',
}

export const stageText = makeMapper(STAGE_PLAIN)
export const regimeText = makeMapper(REGIME_PLAIN)
export const roleText = makeMapper(ROLE_PLAIN)
export const caliberText = makeMapper(CALIBER_PLAIN)
export const bucketText = makeMapper(BUCKET_PLAIN)

/** 回测动态列名 → 中文；未登记字段保留原 key 但加「未知字段」标记，⛔ 不静默直出 */
export function backtestFieldText(key: string): string {
  return BACKTEST_FIELD_PLAIN[key] ?? `未登记字段(${key})`
}

export const capitalText = makeMapper(CAPITAL_PLAIN)
export const phaseText = makeMapper(PHASE_PLAIN)
export const ztDirText = makeMapper(ZT_DIR_PLAIN)
export const stanceText = makeMapper(STANCE_PLAIN)
export const sectorTierText = makeMapper(SECTOR_TIER_PLAIN)
export const sectorSentimentText = makeMapper(SECTOR_SENTIMENT_PLAIN)
export const viewText = makeMapper(VIEW_PLAIN)
export const biasText = makeMapper(BIAS_PLAIN)

/** `stop_fall(止跌3/4)` / `not_yet(未止跌1/4)` 里那个「命中几条判据」的数字 */
const KLINE_HITS = /[（(]\s*(?:未?止跌)\s*(\d)\s*\/\s*4\s*[)）]/

/**
 * K 线止跌状态 —— ⚠️ **专用解析，不走通用表**：通用表会把 `stop_fall(止跌3/4)` 收敛成
 * 「止跌成立」，丢掉 `3/4` 这个**判据命中数**（它才是「止跌程度」的信息量所在：
 * 4 条判据命中 2 条 = 勉强止跌，命中 4 条 = 明确止跌）。
 */
export function klineText(v: unknown): string {
  const raw = String(v ?? '').trim()
  if (!raw) return '—'
  const hits = KLINE_HITS.exec(raw)
  if (hits) return `${Number(hits[1]) >= 2 ? '止跌' : '未止跌'} ${hits[1]}/4`
  if (raw.includes('无K线')) return KLINE_PLAIN.no_data
  const bare = raw.replace(DECORATED, '$1')
  if (KLINE_PLAIN[bare]) return KLINE_PLAIN[bare]
  return PLAIN_UNKNOWN
}

/**
 * 题材相位 ↔ 接力卡相位是**两套词**，别混用：
 * `candidate.phase` 走 `phaseText`（英文枚举）；接力卡 `expectation.phase` 实测已是中文
 * （`亢奋` / `分歧` / `冰点`），直接用 `resolve` 的「原值已含中文」分支即可 ——
 * 但为防后端改回英文，统一走这里（英文出现时也不会漏出去）。
 */
export const CARD_PHASE_PLAIN: Readonly<Record<string, string>> = {
  ...PHASE_PLAIN,
  boom: '亢奋', // 接力卡语境下 boom = 情绪/题材亢奋
  ebbing: '退潮',
  repair: '修复',
  ice: '冰点',
}
export const cardPhaseText = makeMapper(CARD_PHASE_PLAIN)

/** 供契约测试遍历用：`字段名 → 映射函数` */
export const PLAIN_MAPPERS = {
  capital: capitalText,
  phase: phaseText,
  zt_dir: ztDirText,
  stance: stanceText,
  sector_tier: sectorTierText,
  sector_sentiment: sectorSentimentText,
  kline: klineText,
  view: viewText,
  bias: biasText,
} as const
