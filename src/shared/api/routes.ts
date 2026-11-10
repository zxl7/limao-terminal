/**
 * 数据路由表 —— 开发服务器与后续 serve.py 共享的唯一真源。
 *
 * 设计约束（对应「原系统不改造」的决策）：
 *   1. 全部条目为**只读**映射，指向原系统（狸猫猎手）的落盘文件；
 *   2. 原系统的 JSON 结构**原样透传**，本层不做任何字段改写或聚合；
 *   3. 文件缺失时返回 `data_unavailable`，由前端降级渲染。
 *
 * 后期若要改造数据结构，只改这一张表 + 后端，前端消费端无需改动。
 *
 * ── 路由形态（四种）────────────────────────────────────────────
 *   ① 单文件          { file }
 *   ② 目录 + 文件名   { dir, pattern }
 *   ③ 两层目录        { dir, dirPattern, file }   如 decision_log/<日期>/candidates.json
 *   ④ 数量截断        { ..., limit }              只取**最新** N 个
 *
 * ⚠️ 大文件（>100KB/份）一律用 `limit` 限制历史份数或 `mode: 'latest'`，
 *    否则一次响应会到 MB 级 —— 前端一次拉全量历史并非本层职责。
 */

/** 覆写数据根目录的环境变量名（迁移服务器时用） */
export const DATA_ROOT_ENV = 'LIMAO_DATA_ROOT'

/** 默认数据根目录（相对项目根）—— 原系统所在位置 */
export const DEFAULT_DATA_ROOT = '../狸猫猎手'

export interface RouteDef {
  /** 固定文件路径（相对 DATA_ROOT） */
  file?: string
  /** 目录（相对 DATA_ROOT），配合 pattern 使用 */
  dir?: string
  /** 目录内文件名匹配正则（字符串形式，便于跨语言共享） */
  pattern?: string
  /** 两层目录时，**外层目录名**的匹配正则（如 `^\d{4}-\d{2}-\d{2}$`） */
  dirPattern?: string
  /** latest = 取文件名倒序最新的一个；all = 全部合并为数组 */
  mode?: 'latest' | 'all'
  /** all 模式下只取**最新** N 个文件（防止历史无限增长撑爆响应） */
  limit?: number
  /**
   * `format: 'jsonl'` 时，每个文件只取**尾部** N 行（append-only 账本会无限增长）。
   *
   * ⚠️ 与 `limit` 是**两个维度**：`limit` 管「取几个文件」，本字段管「每个文件取几行」。
   *    ⛔ 2026-09-19 前实现把两者混为一谈 —— 给目录型 JSONL 路由设 `limit`
   *    会**顺带把每个文件截断**成 N 行（盘中时间轴每天只剩 5 行 → 曲线变水平线）。
   */
  lines?: number
  /**
   * 落盘格式。默认 json；
   * `jsonl` 按行解析为数组（原系统账本类文件用）；
   * `text` 原样返回**字符串**（YAML 等非 JSON 格式，解析交给消费方）。
   */
  format?: 'json' | 'jsonl' | 'text'
  /** 刷新节拍：intraday=盘中 30s；daily=日频不轮询；manual=仅手动刷新 */
  cadence?: 'intraday' | 'daily' | 'manual'
  /**
   * ⚠️ 已停更（**2026-10-14 审计新增**）。
   *
   * 语义 = 「这条链路**在产侧已无写入方**，文件只是留档」——区别于「今天恰好没数据」。
   * 与 `cadence: 'manual'` 配对使用：既不参与轮询，也不再被算进
   * `/record` 的「龄期 > 1 天」告警（否则它会天天误报，把真异常淹掉）。
   *
   * 判定依据必须可复现：全仓 grep 产物文件名，**确认无写入方**才可打此标。
   * 已标：`/api/market/auction`（auction_live.json 无写入方）、
   * `/api/theme/sequence`（theme_sequence.json 停在 09-03、已被 theme/series 取代）。
   */
  retired?: boolean
  /** 用途说明 */
  desc: string
}

export const ROUTES: Record<string, RouteDef> = {
  // ══════════════════════════════════════════════════════════════
  // 一、行情主链路（原 watch.html 已在消费的 4 个）· 盘中实时
  // ══════════════════════════════════════════════════════════════
  '/api/market/latest':     { file: 'cache/pulse_snapshots/latest.json',       cadence: 'intraday', desc: '主快照（实时·含梯队/核心标的/板块风险/情绪）' },
  '/api/market/prev':       { file: 'cache/pulse_snapshots/prev.json',         cadence: 'intraday', desc: '上一版快照（环比对比用）' },
  // ⚠️ 2026-10-14 审计（A3）：**全仓无任何写入方**产出 `auction_live.json`
  //    （最后内容 2026-09-25 15:30 · 46 B · 旧看板时代遗留件）。真实竞价数据在
  //    `wealth_code/cache/auction_quotes-<date>.json`（09:25 落盘），已由
  //    `/api/decision/auction-history` 暴露。
  //    故 cadence intraday→manual（**停止每 30s 轮询一个死文件**）+ retired：
  //    AuctionPage 的「竞价报价」卡按「已停更」降级，不把 19 天前的报价当今日。
  '/api/market/auction':    { file: 'cache/pulse_snapshots/auction_live.json', cadence: 'manual', retired: true, desc: '竞价实时报价（⚠️ 已停更 · 无写入方 · 真实竞价见 /api/decision/auction-history）' },
  '/api/market/signals':    { file: 'cache/short_spirit_signals.json',         cadence: 'intraday', desc: '短线精灵信号' },

  // ══════════════════════════════════════════════════════════════
  // 二、原 dashboard 内嵌、前端此前取不到的 5 个
  // ══════════════════════════════════════════════════════════════
  '/api/market/relay-effect': { file: 'cache/relay_effect.json', cadence: 'intraday', desc: '连板量能与承接观察' },
  '/api/market/feedback':   { file: 'cache/feedback_matrix.json',              cadence: 'intraday', desc: '昨日涨停反馈矩阵（晋级率/核按钮/情绪分 12 因子）' },
  '/api/market/selection-effect': { file: 'cache/selection_effect.json', cadence: 'intraday', desc: '盘后候选次日反馈（晋级/竞价溢价/失败核按钮）' },
  '/api/market/candidates': { file: 'cache/pulse_snapshots/candidates.json',   cadence: 'intraday', desc: '候选池' },
  '/api/theme/rotation':    { file: 'cache/theme_rotation.json',               cadence: 'intraday', desc: '题材轮动·回流预测·5日资金' },
  '/api/theme/series':      { file: 'cache/theme_series.json',                 cadence: 'daily',    desc: '题材多日序列（数据堆叠 Tab 数据源）' },
  // ⚠️ 2026-09-16 状态：**停更**（最后写入 2026-09-03 · 0 B），已被 `/api/theme/series`
  //    （theme_series.json，当日仍在更新）取代 —— 后者含 dates/daily_totals/
  //    daily_details/themes/theme_leaders/table_rows 完整结构，
  //    而本件只有 `{date, themes: string[], updated}` 三个键。
  //    刻意**不删也不接页面**：① 用户明确「先增量、后统一裁剪」；
  //    ② 它的停更状态由 `/record` 的「文件新鲜度」表暴露（逐路由列龄期）。
  //    2026-10-14 审计追加：cadence daily→manual + `retired: true` —— 它是**留档**，
  //    不是「日频在产」，不该再计入「龄期 > 1 天」告警（天天误报会把真异常淹掉）。
  //    裁剪决策点：若确认不再产出，连同 `sequence` endpoint 一并删除。
  '/api/theme/sequence':    { file: 'cache/theme_sequence.json',               cadence: 'manual', retired: true, desc: '题材序列（⚠️ 已停更 · 已被 theme/series 取代 · 仅留档）' },
  '/api/flow/history':      { dir: 'cache/sector_flow_history', pattern: '^sector_flow_\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', cadence: 'daily', desc: '板块资金历史（多日合并）' },
  // 盘中全量板块资金池：与收盘后逐日归档并列，终端只读此实时快照补齐今日。
  '/api/flow/live':         { file: 'cache/pulse_snapshots/sector_fund_pool.json', cadence: 'intraday', desc: '板块资金盘中全量快照（今日）' },

  // ══════════════════════════════════════════════════════════════
  // 三、板块核心票（scripts/board_core.py · 四维加权）
  //     用途：板块异动先查 core 票动不动 —— 不动而只有杂毛涨 = 假启动
  // ══════════════════════════════════════════════════════════════
  '/api/board/core': {
    dir: 'cache/board_core', pattern: '^board_core_.+\\.json$', mode: 'all', cadence: 'daily',
    desc: '板块核心票（时效0.25/封板硬度0.20/连板领先0.25/带动参与0.30 四维加权出 core_score）',
  },

  // ══════════════════════════════════════════════════════════════
  // 三·二、连板日观察（scripts/board_leader_daily.py · 2026-10-27）
  //   每条板块线 × 每个交易日 → 当天谁是龙一、几板、换没换人、昨日龙一今天断没断。
  //   龙一判据与选股同源（`wealth_code/core/sector_leader.py`），所以「台账里的龙一」
  //   与「那天推的票」是同一个答案。
  //   `theme_source`：snapshot（当日题材冻结映射）／sector_fallback（题材快照上线前，
  //   降级用申万行业分组 —— 口径不同，前端必须标出来，不能当成同一把尺子）。
  // ══════════════════════════════════════════════════════════════
  '/api/board/leader-daily': {
    dir: 'cache/board_leader_daily',
    pattern: '^leader_\\d{4}-\\d{2}-\\d{2}\\.json$',
    mode: 'all',
    limit: 30,
    cadence: 'daily',
    desc: '连板日观察（板块×交易日：龙一/板数/换人/熄火 + 昨日龙一今日状态）',
  },

  // ══════════════════════════════════════════════════════════════
  // 四、连板晋级量化（scripts/promo_quant.py · P1-P3 已落地）
  //     冷启动矩阵：1进2 15.4% / 2进3 34.3% / 3进4 51.6% / 4to5+ 51.7%
  // ══════════════════════════════════════════════════════════════
  '/api/promotion/summary': {
    file: 'cache/promo/promo_summary.json', cadence: 'daily',
    desc: '晋级率汇总（按 1to2/2to3/3to4/4to5+ 分段：成功率 + 晋级次日溢价均值/中位 + 失败组亏损）',
  },
  '/api/promotion/daily': {
    dir: 'cache/promo', pattern: '^promo_\\d{8}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '每日晋级事件明细（逐票 prev_boards→boards / stage / ok / prem_open1 / prem_close1,2）',
  },

  // ══════════════════════════════════════════════════════════════
  // 五、股性基因层（scripts/zt_genes.py · 2026-09-09 用户「股性很重要」）
  //     统计窗口统一近 250 交易日
  // ══════════════════════════════════════════════════════════════
  '/api/gene/summary': {
    file: 'cache/zt_genes/summary.json', cadence: 'daily',
    desc: '涨停池股性榜（gene_score Top：涨停频率/最高连板/首封时间/炸板率/晋级成功率）',
  },
  '/api/gene/detail': {
    dir: 'cache/zt_genes', pattern: '^gene_\\d{6}\\.json$', mode: 'all', cadence: 'daily',
    desc: '个股股性档案（涨停次数/最高连板/首封时间/炸板率/晋级成功率 + 次日溢价 + 股性分）',
  },
  '/api/gene/hist': {
    dir: 'cache/zt_genes', pattern: '^hist_\\d{6}\\.json$', mode: 'all', cadence: 'daily',
    desc: '个股历史涨停基因（新浪不复权日K自算：近250/500日涨停次数/最长连板/晋级率/首板次日溢价）',
  },
  '/api/gene/pool': {
    dir: 'cache/zt_genes', pattern: '^pool_\\d{8}\\.json$', mode: 'latest', cadence: 'daily',
    desc: '涨停基因池（最近一期·逐票 zt_boards/zt_days/zt_times/seal_min/broken/seal_fund_yi）',
  },
  '/api/dragon/gene': {
    file: 'cache/dragon_gene.json', cadence: 'daily',
    desc: '龙头基因沉淀池（≥4板入池 · 5板强票 · 断板两日跌幅≤−10% 判 A 杀淘汰）',
  },

  // ══════════════════════════════════════════════════════════════
  // 六、情绪周期（窗口分层：当日=执行层 / 3日=方向层 / 5日=纪律层 / 10日=归纳层）
  // ══════════════════════════════════════════════════════════════
  '/api/emotion/summary5d': {
    file: 'cache/short_term/summary_5d.json', cadence: 'daily',
    desc: '5日情绪摘要（含 sentiment_ma3 轨迹 + turn_signal 转折信号 repair/ebb/flat + cycle_hint）',
  },
  '/api/emotion/zt-history': {
    dir: 'cache/zt_history', pattern: '^zt_\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', cadence: 'daily',
    desc: '盘中涨停时序（按窗口记录题材分布与最高板 · 涨停池历史单一源）',
  },
  '/api/emotion/memory': {
    dir: 'cache', pattern: '^market_memory_\\d{4}-?\\d{2}-?\\d{2}\\.json$', mode: 'all', limit: 20, cadence: 'daily',
    desc: '情绪快照（memory_lib 情绪联动唯一数据源 market_state.sentiment）',
  },
  '/api/emotion/daily': {
    dir: 'cache/short_term/daily', pattern: '^emotion_\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', cadence: 'daily',
    desc: '情绪日档历史（周期温度）',
  },
  '/api/zt/yesterday': {
    file: 'cache/yesterday_zt.json', cadence: 'daily',
    desc: '昨日涨停池（**唯一涨停权威** · record_zt_snapshot 产出）',
  },
  /**
   * ⛔ 2026-09-19 修：原为 `mode: 'latest'` —— **只吐文件名最新的那一天**。
   *    而消费方（时间轴页）要的是「近几个交易日里任一天」的盘中逐事件，
   *    按所选日期过滤后必然空集 → 曲线退化成盘后累计单线（用户抓包「只看到涨停」）。
   *
   * 现在：`all` + `limit`（**文件数**，管历史不无限增长）+ `lines`（**每文件行数**，
   * 须足够覆盖一整个交易日 —— 实测一天约 380 行，留 3 倍余量防截断）。
   * 响应体积：4 × ≈60KB ≈ 240KB（体检 `--big` 阈值 300KB 内）。
   */
  '/api/intraday/timeline': {
    dir: 'cache', pattern: '^intraday_timeline_\\d{8}\\.jsonl$', mode: 'all', limit: 4, lines: 1200, format: 'jsonl', cadence: 'intraday',
    desc: '盘中情绪时间轴（**逐事件 append-only** · up/down 双向 · intraday_timeline.py 产出 · 近 4 个交易日）',
  },

  // ══════════════════════════════════════════════════════════════
  // 七、财富密码决策链（选股 → 竞价 → 净值闭环）
  // ══════════════════════════════════════════════════════════════
  '/api/decision/candidates': {
    dir: 'wealth_code/cache', pattern: '^candidates-\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 3, cadence: 'daily',
    desc: '选股候选存档（含 environment 情绪环境 / real_env 真实环境 / 候选明细）·单份约 100KB 故限 3 期',
  },
  '/api/decision/latest': {
    dir: 'wealth_code/cache', pattern: '^candidates-\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'latest', cadence: 'daily',
    desc: '最新一期选股候选（完整字段）',
  },
  '/api/decision/execution-audit': {
    file: 'wealth_code/cache/execution_audit.json', cadence: 'daily',
    desc: '执行审计（候选冻结、竞价、裁决、账户收益与缺口）',
  },
  '/api/decision/auction-history': {
    dir: 'wealth_code/cache', pattern: '^auction_quotes-\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '竞价报价存档（每票竞价涨幅/金额）',
  },
  '/api/decision/archive': {
    dir: 'cache/decision_log', dirPattern: '^\\d{4}-\\d{2}-\\d{2}$', file: 'candidates.json', mode: 'all', limit: 3, cadence: 'daily',
    desc: '决策黑匣子存档（scripts/archive_decision.py 按日落盘）·单份约 100KB 故限 3 期',
  },
  '/api/decision/zt-pool': {
    dir: 'cache/decision_log', dirPattern: '^\\d{4}-\\d{2}-\\d{2}$', file: 'zt_pool.json', mode: 'latest', cadence: 'daily',
    desc: '决策时点涨停池明细（ladder 天梯 / top_codes / zt_list 全字段）',
  },
  '/api/decision/manifest': {
    dir: 'cache/decision_log', dirPattern: '^\\d{4}-\\d{2}-\\d{2}$', file: 'manifest.json', mode: 'latest', cadence: 'daily',
    desc: '存档清单（来源清单 sources / 摘要 summary / 缺口 gaps）',
  },
  /**
   * 09:25 池内裁决**终态**（`wealth_code/core/pool_call.py` 产出）。
   *
   * ⚠️ 与 `/api/ai/view` 的区别（⛔ 两者不可混用）：
   *   · `ai_view`  = 前一交易日**盘后**写的预案（`bias`：focus/normal/avoid），是**输入**；
   *   · `pool_call`= 当日 **09:25 竞价后**的定音（`view`：participate/watch/skip + `quota_rank`），是**结论**。
   *   两者的日期键也不同：`ai_view.date` 与 `pool_call.trade_date` 同为**执行日**（对应关系成立）。
   *
   * 交易台账/判断明细展示**执行结果时必须读本路由**，否则会显示「昨天的预案」而非「今晨实际怎么做的」。
   */
  '/api/decision/pool-call': {
    dir: 'wealth_code/cache', pattern: '^pool_call-\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 3, cadence: 'daily',
    desc: '09:25 池内裁决终态（昨日预案 bias × 今晨竞价 → view 定音 + 买入名额序 + 竞价涨幅/量能）',
  },
  /**
   * 池内台账 · **当日收盘结算**（`scripts/pool_ledger.py` 每日 16:00 产出）。
   *
   * 这是全系统唯一直接回答「**今天这些票到底赚没赚**」的数据：
   * 口径 = 09:25 竞价价买 → 当日收盘卖，逐票一行，一字板与竞价封死**不计入统计**。
   *
   * ⚠️ 与 `pool-call` 的分工（都按执行日对齐）：
   *   · `pool-call` = 09:25 的**事前**裁决（买不买、为什么）；
   *   · `pool-ledger` = 收盘后的**事后**结算（买了会怎样、实际怎样）。
   *   ⛔ 台账缺当日 K 线时脚本 `exit 2` **不落盘**，所以「今天没有这份文件」= 收盘行情还没到，
   *      不是「今天没票」——前端必须按这个语义降级，不能显示成 0 收益。
   */
  '/api/decision/pool-ledger': {
    dir: 'cache/pool_ledger', pattern: '^\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 20, cadence: 'daily',
    desc: '池内台账（竞价价买→当日收盘卖的逐票结算 + 按裁决/今开分档汇总）',
  },
  /**
   * 全量过筛逐票结论（`wealth_code/core/daily_screen.py` 产出）。
   *
   * 与 `candidates` 的区别：`candidates` 只有**入选**的票（选股卡产物），
   * 本路由是**全市场涨停逐票**的 pass / watch_only / reject 结论 + 理由链 ——
   * 回答「今天 48 只涨停里，为什么只剩这几只」。
   * `ENABLE_DAILY_SCREEN=0` 时该文件不更新，前端按「未启用」降级。
   */
  '/api/decision/screen': {
    dir: 'cache/daily_screen', pattern: '^screen_\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 5, cadence: 'daily',
    desc: '全量涨停逐票过筛结论（pass/watch_only/reject + 理由链 + 拒因分布）',
  },
  /**
   * 竞价三环影子 · 逐日留痕对照表（2026-11-05 A 档落地）。
   *
   * 由 `scripts/sector_gap_daily_trace.py` 每天重算近 N 日窗口（幂等，无 append 状态）。
   * ⚠️ 这是**研究留痕**，不是裁决产物：`linked_would_cut` 只表示「若开守卫会被砍」，
   *    09:25 的 view/zone/quota/仓位从不读取它。页面必须把这一点写在最上面。
   * 两套收益并列：当日收盘（评估代理） / 次交易日收盘（账本 T+1 结算口径代理）。
   */
  '/api/decision/sector-gap-trace': {
    file: 'cache/sector_gap_trace/daily_trace.json', cadence: 'daily',
    desc: '竞价三环影子逐日留痕（影子标记 × T+1 结算对账 · 恒不改裁决）',
  },

  // ══════════════════════════════════════════════════════════════
  // 八、AI 判断平行台账（2026-09-10 用户定 · 两本独立账）
  //     脚本轨 = wealth_code/cache/account_nav_history.jsonl
  //     AI  轨 = wealth_code/cache/ai_nav_history.jsonl
  // ══════════════════════════════════════════════════════════════
  '/api/ai/view': {
    dir: 'cache', pattern: '^ai_view_\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 20, cadence: 'daily',
    desc: 'AI 判断（参与/放弃/观察 + 理由 + entry_max_gap）·盘后写、次日竞价卡对照',
  },
  '/api/ai/decisions': {
    file: 'wealth_code/cache/ai_decisions.jsonl', format: 'jsonl', cadence: 'daily',
    desc: 'AI 判断台账（append-only · reason 必填 · 幂等）',
  },
  '/api/ai/nav': {
    file: 'wealth_code/cache/ai_nav_history.jsonl', format: 'jsonl', cadence: 'daily',
    desc: 'AI 轨净值台账（首行由当日 15:30 接力卡 settle 落 · 早于该时点为空属正常）',
  },

  /**
   * 回测战绩快照（`scripts/build_backtest_summary.py` 合成，唯一出口）。
   *
   * 由三份回放产物压成一份稳定 schema，指标（胜率/日均/复利/回撤/Sharpe/t 值/盈亏比）
   * 全部在 Python 侧算好，前端只显示 —— ⛔ 不在前端重算，否则口径会双轨。
   *
   * ⚠️ 里面**并列**三套收益口径（策略=当日收盘 / T+1=次日收盘 / T+1 最保守=次日开盘）。
   *    ⛔ 禁止相加、相减或互相换算：差额来自 A 股 T+1 制度，不是策略退化。
   * ⚠️ 研究产物，**不是每日增量**：`generated_at` 是快照时刻，可能落后于当日台账。
   */
  '/api/research/backtest': {
    file: 'cache/research/backtest_summary.json', cadence: 'manual',
    desc: '回测战绩（三口径指标 + 逐层阶梯 + 逐日净值 + 真实台账战绩）',
  },

  // ══════════════════════════════════════════════════════════════
  // 九、尾盘潜伏研究账本（与接力账户严格隔离）
  // ══════════════════════════════════════════════════════════════
  '/api/ambush/pullback/signals': {
    file: 'cache/ambush_pullback_signal_log.jsonl', format: 'jsonl', cadence: 'daily',
    desc: '尾盘潜伏信号账本（14:30冻结、14:50计划买入；研究记录）',
  },
  '/api/ambush/pullback/settlements': {
    file: 'cache/ambush_pullback_settlement_log.jsonl', format: 'jsonl', cadence: 'daily',
    desc: '尾盘潜伏逐笔结算记录',
  },
  '/api/ambush/pullback/weighted-pnl': {
    file: 'cache/ambush_pullback_daily_pnl.jsonl', format: 'jsonl', cadence: 'daily',
    desc: '尾盘潜伏结算账本（14:50至下一交易日10:00；研究结算）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十、净值与战绩（脚本轨）
  // ══════════════════════════════════════════════════════════════
  '/api/account/nav': {
    file: 'wealth_code/cache/account_nav_history.jsonl', format: 'jsonl', cadence: 'daily',
    desc: '净值账本（脚本轨 · 口径 open_check.can_enter ∧ next_day.covered）',
  },
  '/api/account/metrics': {
    file: 'wealth_code/cache/account_strategy_metrics.json', cadence: 'daily',
    desc: '策略指标（胜率/盈亏比等聚合）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十、龙虎榜（资金性质：机构 vs 游资）
  // ══════════════════════════════════════════════════════════════
  '/api/lhb/tencent': {
    dir: 'cache', pattern: '^lhb_\\d{8}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '龙虎榜（腾讯自选股源 · 机构榜 + 游资席位 · 盘后 18:00+ 才披露）',
  },
  '/api/lhb/hithink': {
    dir: 'cache', pattern: '^hithink_lhb_\\d{8}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '同花顺龙虎榜（机构/游资席位交叉校验）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十一、同花顺专业数据（hithink_fetch.py · 盘前/盘后第二权威）
  // ══════════════════════════════════════════════════════════════
  '/api/hithink/ladder': {
    file: 'cache/hithink_ladder.json', cadence: 'daily',
    desc: '连板天梯 30 日（仅 2 板以上 · 无首板 · 作板数校验与窗口外兜底）',
  },
  '/api/hithink/zt': {
    dir: 'cache', pattern: '^hithink_zt_\\d{8}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '同花顺涨停池（含 reason 涨停原因注入）',
  },
  '/api/hithink/zt-diff': {
    dir: 'cache', pattern: '^hithink_zt_diff_\\d{8}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '涨停池双源校验差异（同花顺 vs 必盈 · 数据质量证据）',
  },
  '/api/hithink/auction': {
    dir: 'cache', pattern: '^hithink_auction_\\d{8}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '竞价风向标 + 快照（同花顺）',
  },
  '/api/hithink/anomaly': {
    dir: 'cache', pattern: '^hithink_anomaly_\\d{8}\\.json$', mode: 'latest', cadence: 'daily',
    desc: '异动原因（同花顺 · 单份 250-300KB 故只取最新一期）',
  },
  '/api/hithink/valuation': {
    dir: 'cache', pattern: '^hithink_valuation_\\d{4}-?\\d{2}-?\\d{2}\\.json$', mode: 'latest', cadence: 'daily',
    desc: '同花顺估值（-enrich-candidates --apply 回填候选 · 取最新一期）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十二、机构投研（Gangtise · 机构为主体）
  // ══════════════════════════════════════════════════════════════
  '/api/institution/pool': {
    dir: 'cache', pattern: '^institution_pool_\\d{4}-?\\d{2}-?\\d{2}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '机构池（机构关注标的）',
  },
  // ⚠️ 2026-10-14 审计（A2）：原指向 `gangtise_morning_full_v5.json` —— 那是**版式定版样本**
  //    （停在 2026-09-03），每日真实产物是 `gangtise_morning_research.json`（当日 07:54 更新）。
  '/api/institution/morning': {
    file: 'cache/gangtise_morning_research.json', cadence: 'daily',
    desc: '机构研报·早盘卡（每日真实产物）',
  },
  '/api/institution/evening': {
    file: 'cache/gangtise_evening_research.json', cadence: 'daily',
    desc: '机构晚报速览',
  },
  '/api/institution/weekend': {
    file: 'cache/gangtise_weekend_0913.json', cadence: 'manual',
    desc: '机构周末研究',
  },

  // ══════════════════════════════════════════════════════════════
  // 十三、题材与消息史
  // ══════════════════════════════════════════════════════════════
  '/api/eruption/history': {
    dir: 'cache/eruption_history', pattern: '^eruption_.+\\.json$', mode: 'all', cadence: 'daily',
    desc: '题材爆发史（题材/累计涨幅/催化标题/龙头股标记）',
  },
  '/api/newsflash/history': {
    dir: 'cache/newsflash_history', pattern: '^daily_.+\\.json$', mode: 'all', cadence: 'daily',
    desc: '每日快讯→题材→个股三层映射',
  },
  '/api/theme/weekly-map': {
    file: 'cache/weekly_zt_map.json', cadence: 'daily',
    desc: '周涨停地图（按周聚合的涨停分布）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十四、载体 / 五日线 / 影子模式
  // ══════════════════════════════════════════════════════════════
  '/api/carrier/state': {
    file: 'cache/carrier_state.json', cadence: 'daily',
    desc: '载体证伪追踪（昨日载体今日断板 = 证伪迁移 · 盘后链 6.5 步）',
  },
  '/api/ma5/status': {
    file: 'cache/ma5_status.json', cadence: 'daily',
    desc: '五日线状态（ma5_broken 标注供接力评分用）',
  },
  '/api/shadow/relay': {
    dir: 'cache/shadow', pattern: '^relay_shadow_.+\\.json$', mode: 'latest', cadence: 'daily',
    desc: '接力权重影子模式（eod_relay 实际入池 vs shadow_ranked 影子排序对照 · 只观察不改产池）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十五、风险监控
  // ══════════════════════════════════════════════════════════════
  '/api/risk/watch': {
    dir: 'cache', pattern: '^risk_watch_\\d{4}-?\\d{2}-?\\d{2}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '风险监控快照',
  },

  // ══════════════════════════════════════════════════════════════
  // 十六、推测回测 + 自我学习（财神-回测）
  // ══════════════════════════════════════════════════════════════
  '/api/backtest/report': {
    dir: 'cache', pattern: '^backtest_report_\\d{4}-?\\d{2}-?\\d{2}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '推测回测报告（候选命中率/预期区间命中率/情绪分对齐）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十七、卡片存档（决策过程的可追溯原件）
  // ══════════════════════════════════════════════════════════════
  '/api/card/fupan': {
    dir: 'cache', pattern: '^fupan_card_\\d{4}-?\\d{2}-?\\d{2}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '盘后复盘卡存档',
  },
  '/api/card/panqian': {
    dir: 'wealth_code/cache', pattern: '^panqian_card_\\d+\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '盘前预测卡存档',
  },
  '/api/card/ambush': {
    dir: 'wealth_code/cache', pattern: '^ambush_card_\\d+\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '早鸟埋伏卡存档',
  },
  '/api/card/lhb': {
    dir: 'cache', pattern: '^lhb_card_\\d{4}-?\\d{2}-?\\d{2}\\.json$', mode: 'all', limit: 10, cadence: 'daily',
    desc: '龙虎榜速览卡存档（18:20 独立任务）',
  },
  // ⚠️ 2026-09-16 修正：原 `/api/card/verify` 定义 `dir: 'cache'` + `^verify_card_*.json$`，
  //    但该目录下**从来没有** verify_card 文件（只有 demo），真身在 wealth_code/cache/ 下、
  //    名为 `card_YYYYMMDD_HHMMSS.json`，且**与盘后候选卡混存**，靠 title 前缀区分：
  //      ⚡ 财富密码·竞价验证·增量（09:26 / 盘中重推）
  //      📊 财富密码·盘后候选·全量（15:37）
  //    RouteDef 无内容谓词字段，无法按 title 过滤，故**如实命名为「混合卡」**，
  //    由页面按 title 前缀分组展示。修正后 `npm run data` 由 60/61 → 61/61。
  '/api/card/mixed': {
    dir: 'wealth_code/cache', pattern: '^card_\\d{8}_\\d{6}\\.json$', mode: 'all', limit: 12, cadence: 'daily',
    desc: '财富密码混合卡存档（竞价验证卡 + 盘后候选卡 · 按 title 前缀区分）',
  },

  // ══════════════════════════════════════════════════════════════
  // 十八、盘中脉冲窗口存档（事件层留痕）
  // ══════════════════════════════════════════════════════════════
  // ⚠️ 2026-10-14 审计（P2-⑪）：**产侧已无写入方** —— `window_*.json` 最新一份停在
  //    `20260903_1455`（mtime 2026-09-03 15:00），正是 `pulse_fetcher.sh` 的
  //    `close_window_step` 被注释停用（HIGH_FREQ_INTRADAY 高频模式）的那一天；
  //    `focus_buffer.json` 已不存在；`pulse_fetcher.sh` / launchd / tasks.yaml
  //    全仓零引用 `pulse_aggregator`（`live_signal.py` 仅保留一个未使用的防御性 import）。
  //    ⇒ 故 cadence daily→manual + `retired: true`：不再把 41 天前的窗口卡当「日频在产」，
  //    也不再计入 `/record` 的「龄期 > 1 天」告警（天天误报会把真异常淹掉）。
  //    目录与保留期仍在（`capture_daily.prune_history` 保留最新 60 份），**⛔ 不删文件**：
  //    用户明确「先增量、后统一裁剪」；若将来恢复 `close_window_step`，取消本标记即可。
  '/api/pulse/windows': {
    dir: 'cache/pulse_windows', pattern: '^window_\\d{8}_\\d{4}\\.json$', mode: 'all', limit: 40,
    cadence: 'manual', retired: true,
    desc: '盘中脉冲窗口存档（标题/色标/elements/note · 15min 节拍）（⚠️ 已停更 · 产侧无写入方 · 仅留档）',
  },
  '/api/pulse/pushed-signals': {
    dir: 'cache', pattern: '^pushed_signals_\\d+\\.json$', mode: 'all', limit: 5, cadence: 'daily',
    desc: '推送信号状态（当日文件极小/为空 = 该日事件链零产出的故障信号）',
  },

  // ══════════════════════════════════════════════════════════════
  // 二十、数据底座（盘中核验优先）
  //
  // 静态事实档只允许白名单命名；市场日K和个股事实走专用受限查询，
  // 不得把 DuckDB / SQLite / 原始目录暴露为文件路由。
  // ══════════════════════════════════════════════════════════════
  '/api/data/exit-peaks': {
    dir: 'cache', pattern: '^intraday_exit_peaks_\\d{8}\\.json$', mode: 'latest', cadence: 'intraday',
    desc: '昨日涨停池封单与Top5题材日内峰值（事实留存，不参与裁决）',
  },
  '/api/data/market-snapshot': {
    dir: 'cache/snapshot', pattern: '^\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'latest', cadence: 'daily',
    desc: '聚合市场快照（生产代理同源，只读）',
  },
  '/api/data/theme-snapshot': {
    dir: 'cache/theme_snapshot', pattern: '^theme_\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 20, cadence: 'daily',
    desc: '题材冻结快照（按交易日保存的 code→题材映射）',
  },
  '/api/data/top5-history': {
    dir: 'cache/top5_history', pattern: '^top5_\\d{4}-\\d{2}-\\d{2}\\.json$', mode: 'all', limit: 20, cadence: 'daily',
    desc: '每日Top5题材原始归档',
  },

  // ══════════════════════════════════════════════════════════════
  // 二十一、推送审计
  // ══════════════════════════════════════════════════════════════
  '/api/audit/log': {
    file: 'cache/audit.jsonl', format: 'jsonl', cadence: 'intraday',
    desc: '推送审计日志（append-only · 双推/镜像失败 19001 排查入口）',
  },
  '/api/push/dedup': {
    file: 'cache/push_dedup.json', cadence: 'daily',
    desc: '推送去重状态（10min 同内容去重）',
  },

  // ══════════════════════════════════════════════════════════════
  // 二十、系统台账与运维（2026-09-16 增量：补齐「后端有产出、前端无路由」的能力）
  //
  //     ⛔ 安全铁律 —— config/ 目录**不得整目录暴露**：
  //        `config/settings.json`（飞书 webhook 全键）与 `config/app_config.yaml`
  //        （feishu_webhook / BIYING_TOKEN）都含**明文密钥**。
  //        2026-09-16 实测扫词命中，故此处只加**显式单文件**路由；
  //        每新增一条前必须先对目标文件扫 webhook|secret|token|password|key。
  // ══════════════════════════════════════════════════════════════
  '/api/system/tasks': {
    file: 'config/tasks.yaml', format: 'text', cadence: 'daily',
    desc: '自动化任务台账（任务名/骨架/rrule/写回目标 · 原样 YAML 文本，前端只解析所需子集）',
  },
  '/api/system/learning': {
    file: 'config/learning_config.json', cadence: 'daily',
    desc: '自学习阈值配置（财神-回测的阈值自动调整基准）',
  },
  '/api/system/short-spirit': {
    file: 'config/short_spirit.json', cadence: 'daily',
    desc: '短线精灵配置（板块共振判定阈值）',
  },
  '/api/system/rules': {
    dir: 'wealth_code/config', pattern: '^.+[.]json$', mode: 'all', cadence: 'daily',
    desc: '策略规则配置（预期区间 expectation_rules / 接力权重 relay_score / 监管 regulatory）',
  },
  '/api/system/engine': {
    dir: 'cache/pulse_snapshots',
    pattern: '^(boost_state|pulse_pending|sector_risk_cache|sector_fund_pool)[.]json$',
    mode: 'all', cadence: 'intraday',
    desc: '盘中引擎状态（加速状态 / 待推队列 / 板块风险缓存 / 板块资金池）',
  },
  '/api/system/backups': {
    /**
     * ⛔ 用**前缀白名单**而不是 `^.+[.]json$` 通配 —— 实测该目录含
     *    `settings.json.bak_20260910_222833`（settings 的备份，**含飞书 webhook 明文**）。
     *    当前通配恰好不会命中它（结尾是数字），但「恰好安全」不是安全：
     *    哪天有人把一个 `xxx.json` 的密钥备份丢进来就会直接泄露。
     *    白名单只放行净值/持仓/AI 决策/学习回滚四类。
     */
    dir: 'cache/backups',
    pattern: '^(nav_|ai_decisions_|learning_rollback_)[^/]*[.](json|jsonl)$',
    mode: 'all', limit: 20, cadence: 'daily',
    desc: '系统备份快照（净值/持仓/AI 决策/学习回滚 · 白名单制 · 运维与回滚依据）',
  },
  '/api/system/archive-index': {
    file: 'cache/decision_log/index.jsonl', format: 'jsonl', cadence: 'daily',
    desc: '决策存档索引（逐日存档件清单 · 黑匣子总目录）',
  },
  '/api/promo/backtest': {
    dir: 'cache/promo', pattern: '^backtest_.+[.]json$', mode: 'all', cadence: 'daily',
    desc: '晋级量化回测报告（1进2 按板数/按日的历史表现）',
  },
}

/**
 * 单文件型路由（供健康检查与新鲜度展示用）。
 *
 * ⚠️ 必须排除「两层目录」型（`dirPattern` 型）—— 它们的 `file` 是**相对于日期目录**的
 *    文件名（如 `candidates.json`），不是相对 DATA_ROOT 的路径。若混入，
 *    `path.join(dataRoot, 'candidates.json')` 会拼出必然不存在的假路径，
 *    表现为「体检说没数据、页面其实能拿到」的互相矛盾。
 */
export const FILE_ROUTES = Object.entries(ROUTES).filter(([, d]) => d.file && !d.dirPattern)

/**
 * 健康检查路由（2026-10-18 扩充）。
 *
 * ⛔ 旧实现只喂 `FILE_ROUTES`（单文件型）→ 79 条路由里只有 37 条被体检，
 *  risk / hithink / decision / card / board-core 这些**目录型主数据从不体检**，
 *  于是「健康面板全绿」并不代表数据真的在。
 *
 * 现纳入「单文件 + 单层目录」两类；两层目录（`dirPattern`，其 `file` 是相对日期目录的
 * 文件名）仍排除 —— 拼出来的路径必然不存在，会产生假红。
 */
export const HEALTH_ROUTES = Object.entries(ROUTES).filter(([, d]) => !d.dirPattern)

/** 按刷新节拍分组（前端据此决定哪些源参与轮询） */
export const ROUTES_BY_CADENCE = {
  intraday: Object.entries(ROUTES).filter(([, d]) => d.cadence === 'intraday').map(([r]) => r),
  daily: Object.entries(ROUTES).filter(([, d]) => d.cadence === 'daily').map(([r]) => r),
  manual: Object.entries(ROUTES).filter(([, d]) => d.cadence === 'manual').map(([r]) => r),
}
