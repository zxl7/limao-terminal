import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRoute, queryClient } from '@/shared/api'
import { SectorGapView } from '@/pages/sector-gap/SectorGapPage'
import { ExecutionAuditView } from '@/pages/execution-audit/ExecutionAuditPage'
import { AmbushView } from '@/pages/ambush/AmbushPage'
import type {
  AiDecisionEntry,
  AiViewFile,
  DecisionDossier,
  DossierStock,
  PoolCallFile,
  PoolLedger,
  ScreenFile,
} from '@/shared/api'
import {
  AiHitLogic,
  AiJudgeDetail,
  isMarketOnlyBlock,
  analyticsQueries,
  DataTable,
  SegTabs,
  StatPair,
  Tag,
  type JudgeRow,
  n1,
  n2,
  pct,
} from '@/features/analytics'
import { BacktestCard, DecisionBoard, ExecutionPanel, ScreenFunnel, TomorrowBoard, navRowsDesc } from '@/features/wealth'
import { Card, CardBadge, EmptyState, LineChart, StockLink } from '@/shared/ui'
import { cn, stanceText } from '@/shared/lib'

/**
 * AI 台账 —— 数据源 `wealth_code/cache/ai_view/` + `ai_decisions.jsonl` + `ai_nav_history.jsonl`。
 *
 * ## 这一页回答的核心问题
 *
 * 「AI 当时怎么判断的，和系统机械口径差在哪，最后谁对？」
 * 四份数据各管一段（⛔ 时序不可混）：
 *   · `ai_view`      —— **前一交易日盘后**写的**预案**（`bias`：重点看/一般/回避 + 理由）
 *   · `pool_call`    —— **当日 09:25 竞价后**的**裁决终态**（`view` + 买入名额序）。
 *                       ⚠️ 「判断」一栏必须用它 —— 2026-09-22 用户抓包前，页面直接渲染
 *                       `ai_view.view`（＝昨日预案），于是真龙被判「一般」、跟风票被判「重点看」，
 *                       与今晨实际成交完全相反（见 `JudgeRow.call`）
 *   · `ai_decisions` —— 判断入账后的流转状态（是否已结算）
 *   · `ai_nav`       —— 按 AI 口径独立计分的净值曲线（起点 1.0）
 *
 * ## ⚠️ 三条不可误读的口径
 *
 * 1. **AI 轨与脚本轨是两本独立账**，起点都是 1.0，不可把两者净值放到同一
 *    坐标直接比大小 —— 它们各自的候选集合与成交口径不同。本页只展示 AI 轨，
 *    脚本轨在「交易战绩」页。
 * 2. `entry_max_gap` 是 AI 自定的高开上限，但**生效值恒取用户纪律 5%**
 *    （`ai_caliber.USER_ENTRY_MAX_GAP_PCT`）。展示 AI 自定值是留痕，不是可执行值。
 * 3. `ai_nav` 首行由**当日 15:30 settle** 落盘，因此 15:30 之前该行不存在 ——
 *    这是正常时序，不是数据缺失。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.aiView())
  await queryClient.ensureQueryData(analyticsQueries.aiDecisions())
  await queryClient.ensureQueryData(analyticsQueries.aiNav())
  // 判断明细要关联「尾盘财富密码接力卡」的真实项（区间/量能/指标/标签）
  await queryClient.ensureQueryData(analyticsQueries.decisionCandidates())
  // 「判断」一栏取**今晨 09:25 裁决终态**（实际怎么做），而非昨日盘后预案
  await queryClient.ensureQueryData(analyticsQueries.decisionPoolCall())
  // 收盘结算（竞价价买→收盘卖）—— 「今天到底赚没赚」的唯一来源
  await queryClient.ensureQueryData(analyticsQueries.decisionPoolLedger())
  // 回测战绩（三口径指标 + 逐层阶梯）—— 「这套打法历史上赚不赚、稳不稳」
  await queryClient.ensureQueryData(analyticsQueries.researchBacktest())
  return null
}

/** 判断语义 —— 只做三值映射，不给参与/观望加奖惩式措辞 */
const VIEW_META: Record<string, { label: string; tone: 'up' | 'rec' | 'sub' }> = {
  participate: { label: '参与', tone: 'up' },
  watch: { label: '观察', tone: 'rec' },
  skip: { label: '放弃', tone: 'sub' },
}

/** 净值盈亏分界（起点 1.0）—— 模块级稳定引用，避免每次渲染新建数组触发折线图无谓重算 */
const NAV_BASELINE: { value: number; label: string; tone: 'sub'; dashed: boolean }[] = [
  { value: 1, label: '盈亏分界 1.0', tone: 'sub', dashed: true },
]

export function AiWealthView() {
  const [today] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()))
  const quotes = useQuery({ queryKey: ['participation-quotes'], queryFn: () => fetchRoute('/api/decision/participation-quotes'), staleTime: 0, refetchInterval: 30_000 })
  const view = useQuery(analyticsQueries.aiView())
  const decisions = useQuery(analyticsQueries.aiDecisions())
  const nav = useQuery(analyticsQueries.aiNav())
  /** T+1 口径（竞价买→次日收盘卖）：独立序列，只用于并列对照 */
  const navT1 = useQuery(analyticsQueries.aiNavT1())
  /** 尾盘财富密码接力卡存档（近 3 期）—— 判断明细的「真实项」来源 */
  const dossiers = useQuery(analyticsQueries.decisionCandidates())
  /** 09:25 池内裁决终态（近 3 期）—— 判断明细的「实际怎么做」来源 */
  const poolCalls = useQuery({ ...analyticsQueries.decisionPoolCall(), refetchInterval: 30_000, staleTime: 0 })
  /** 池内台账（近 20 期）—— 「今天到底赚没赚」的唯一来源（09:25 竞价价买 → 收盘卖） */
  const poolLedgers = useQuery(analyticsQueries.decisionPoolLedger())
  /** 全量涨停逐票过筛（近 5 期）—— 回答「48 只涨停为什么只剩这几只」 */
  const screens = useQuery(analyticsQueries.decisionScreen())
  /** 回测战绩快照（研究产物，手工刷新；三口径并列，⛔ 不轮询） */
  const backtest = useQuery(analyticsQueries.researchBacktest())
  const [tab, setTab] = useState<'board' | 'judge' | 'record' | 'analysis'>('board')
  /** 战绩：曲线 / 明细（2026-11-11 合并 台账+净值） */
  const [recordView, setRecordView] = useState<'chart' | 'detail'>('chart')
  const [viewDate, setViewDate] = useState<string>('')

  /** 判断记录：按日期倒序，默认取最新 */
  const viewFiles = useMemo<AiViewFile[]>(
    () =>
      (view.data ?? [])
        .map((f) => f.data)
        .filter((x): x is AiViewFile => !!x)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [view.data],
  )
  /** 已有 09:25 裁决的执行日集合（近 3 期） */
  const callDates = useMemo(() => {
    const s = new Set<string>()
    for (const f of poolCalls.data ?? []) {
      const d = f.data?.trade_date
      if (d) s.add(d)
    }
    return s
  }, [poolCalls.data])

  /**
   * 当前展示的判断日。
   *
   * ## ⛔ 默认**不能**取「最新一期」—— 盘后会把次一交易日的预案提前写出来
   *
   * 实证 2026-11-06 16:30：`ai_view_2026-11-09.json` 已经存在（`decision_date = 11-06`），
   * 而 `pool_call` / `pool_ledger` 最新只到 11-06。若默认取最新：
   *   · 「今天买了没」→ 显示「今晨裁决未生成」
   *   · 「今日账本」→ 显示「未生成」
   * 用户收盘后打开页面，**今天的结算一个字都看不到**，看到的是一个还没到竞价时刻的未来日。
   *
   * ✅ 默认执行日固定北京时间今天；缺今日裁决就明说，不用昨日名单。
   *    用户主动选择历史日期才回看；预案展示仍独立选择已有预案。
   *    「明日标的」不受影响 —— 它单独取最新一期候选（`dossier`），即刚写的次日预案。
   */
  const activeView = useMemo(
    () =>
      viewDate
        ? (viewFiles.find((f) => f.date === viewDate) ?? viewFiles[0])
        : (viewFiles.find((f) => f.date === today) ?? viewFiles.find((f) => callDates.has(f.date)) ?? viewFiles[0]),
    [viewFiles, viewDate, callDates, today],
  )

  /** 判断条目展开为行（code 是 Record 的 key，需要提上来） */
  const viewRows = useMemo(
    () =>
      Object.entries(activeView?.views ?? {}).map(([code, item]) => ({ code, ...item })),
    [activeView],
  )

  /**
   * 接力卡（决策档案）——「今日决策」的主体。
   *
   * ## ⛔ 2026-11-04 修「终端还是显示昨天的推荐」
   *
   * 两套文件的**命名口径相反**，前端按 `decision_date` 匹配会永远落后一期：
   *
   * | 文件 | 文件名里的日期 | 实际含义 |
   * |---|---|---|
   * | `ai_view_<D>.json` | `D` = **执行日** | `decision_date = 前一交易日`（预案写作日） |
   * | `candidates-<D>.json` | `D` = **预案日** | 尾盘 15:31 生成，次日执行 |
   *
   * 实证 11-04：`ai_view_2026-11-04.decision_date = 11-03` →
   *   页面去匹配 `candidates-2026-11-03`（11-03 生成、**今天**执行的那份），
   *   而今天 15:31 刚落盘的 `candidates-2026-11-04`（**明天**执行）永远不显示。
   *   ⇒ 用户每天看到的都是「昨天的推荐」。
   *
   * ✅ 现口径：**默认取最新一期候选**（就是刚才盘后跑出来的预案）。
   *    只有当用户**主动**在上方日期下拉里选了某天（`viewDate` 非空）时，
   *    才回落到「与该判断日匹配」的那一期 —— 那时用户是在回看历史，语义正确。
   * ⛔ 不要反过来：反过来就又变成「最新一期永远看不到」。
   */
  const dossier = useMemo<DecisionDossier | undefined>(() => {
    const list = (dossiers.data ?? [])
      .map((f) => f.data)
      .filter((x): x is DecisionDossier => !!x)
    if (!list.length) return undefined
    const latest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0]
    if (!viewDate) return latest          // 默认：最新一期（今天盘后刚生成）
    return list.find((d) => d.date === activeView?.decision_date) ?? latest
  }, [dossiers.data, activeView, viewDate])

  /** code → 接力卡标的 + 池别（接力池后写，同 code 以接力池为准） */
  const stockMap = useMemo(() => {
    const m = new Map<string, { stock: DossierStock; bucketLabel: string }>()
    if (!dossier) return m
    for (const s of dossier.watch ?? []) {
      if (s.code) m.set(s.code, { stock: s, bucketLabel: '观察池' })
    }
    for (const s of dossier.relay ?? []) {
      if (s.code) m.set(s.code, { stock: s, bucketLabel: '接力池' })
    }
    return m
  }, [dossier])

  /**
   * 与所选执行日**同一天**的 09:25 池内裁决（`trade_date === activeView.date`）。
   *
   * ⚠️ 日期口径：`ai_view.date`（执行日）=== `ai_view.decision_date + 1 交易日`，
   *    而 `pool_call.trade_date` 正是**执行日** → 两者直接相等。
   *    ⛔ 不要用 `decision_date`（那是预案写作日）去匹配 `pool_call`，会整体错位一天。
   * ⛔ **无 fallback**：配不上就该显示「今晨裁决未生成」——用最近一期顶上会把
   *    别天的成交结论安到本日头上（用户 2026-09-22 明确要求显示「今天 9:25 的这个」）。
   */
  const executionDate = viewDate || today
  const callFile = useMemo<PoolCallFile | undefined>(() => {
    const list = (poolCalls.data ?? [])
      .map((f) => f.data)
      .filter((x): x is PoolCallFile => !!x)
    return list.find((p) => p.trade_date === executionDate)
  }, [poolCalls.data, executionDate])

  /**
   * 与所选执行日**同一天**的收盘结算（`pool_ledger.date`）。
   *
   * ⛔ 与 `callFile` 一样**无 fallback**：台账当日 16:00 才落盘，配不上就该显示「未生成」。
   *    用昨日结算顶替 = 把别天的收益安到今天头上，正是 11-06 那次
   *    「基线把 +2.56% 虚报成 +13.22%」的同型错误（缺的那笔往往就是当天唯一那笔）。
   */
  const ledger = useMemo<PoolLedger | undefined>(() => {
    const list = (poolLedgers.data ?? [])
      .map((f) => f.data)
      .filter((x): x is PoolLedger => !!x)
    return list.find((l) => l.date === executionDate)
  }, [poolLedgers.data, executionDate])

  /**
   * 与所选决策日同一天的全量过筛结论。
   *
   * ⚠️ 日期键：`screen.date` 与 `candidates.date` 同为**选股业务日**（如 2026-11-03），
   *    与 `pool_call.trade_date`（执行日）不是一回事，⛔ 不要用执行日去匹配。
   *    配不上时**不回落**到最近一期 —— 把别天的过筛结论安到今天会误导「为什么没选它」。
   */
  const screenFile = useMemo<ScreenFile | undefined>(() => {
    const list = (screens.data ?? [])
      .map((f) => f.data)
      .filter((x): x is ScreenFile => !!x)
    if (!dossier?.date) return undefined
    return list.find((s) => s.date === dossier.date)
  }, [screens.data, dossier])

  /**
   * 判断明细行 = **今晨 09:25 终态**（结论）× 接力卡真实项（依据）+ bias 越权兜底留痕。
   *
   * ⛔ 展示的「判断」取 `call.view`；`view`/`bias` 保留为「昨日预案」对照 —— 两者不一致
   *    时正是最该被看见的地方（AI 判反 vs 机械裁决救回）。
   */
  const judgeRows = useMemo<JudgeRow[]>(
    () =>
      viewRows.map((r) => {
        const cv = callFile?.views?.[r.code]
        return {
          code: r.code,
          view: r.view,
          reason: r.reason,
          bias: r.bias,
          biasWarning: r.bias_warning ?? undefined,
          ...(stockMap.get(r.code) ?? {}),
          ...(cv
            ? {
                call: {
                  view: cv.view,
                  quotaRank: cv.quota_rank,
                  gapPct: cv.gap_pct,
                  zone: cv.zone,
                  amountYi: cv.amount_yi,
                  needYi: cv.need_yi,
                  lineRank: cv.line_rank,
                  lineCoreName: cv.line_core?.name ?? null,
                  leaderRole: cv.leader_role,
              leaderEvidenceNote: cv.leader_evidence?.note,
              statusRank: cv.status_rank,
              mechanicalLeader: cv.mechanical_leader,
                  mechanicalLeaderNote: cv.mechanical_leader_note,
                  reason: cv.reason,
                },
              }
            : {}),
        }
      }),
    [viewRows, stockMap, callFile],
  )

  const decisionScoreByKey = useMemo(() => {
    const scores = new Map<string, number>()
    for (const file of dossiers.data ?? []) {
      const d = file.data
      if (!d) continue
      for (const stock of [...(d.relay ?? []), ...(d.watch ?? [])]) {
        if (stock.code && Number.isFinite(stock.score)) scores.set(`${d.date}-${stock.code}`, stock.score)
      }
    }
    return scores
  }, [dossiers.data])

  /** 新台账直接读冻结评分；历史行仅从同日候选档案补读，不自行重算评分。 */
  const decRows = useMemo(
    () =>
      [...(decisions.data ?? [])]
        .map((row) => ({
          ...row,
          ranking_score: row.ranking_score ?? decisionScoreByKey.get(`${row.decision_date}-${row.code}`),
        }))
        .sort((a, b) => b.decision_date.localeCompare(a.decision_date)),
    [decisions.data, decisionScoreByKey],
  )

  const navRows = useMemo(
    () => [...(nav.data ?? [])].sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    [nav.data],
  )
  /**
   * 净值**表格**用逆序（最新一行在最上面，2026-11-09 用户要求）。
   *
   * ⛔ 只给表格用：`navRows` 本身必须保持**正序** ——
   *    折线图时间轴只能从左到右；`lastNav` / 最大回撤都是按正序逐点递推算的。
   * 规则与理由集中在 `features/wealth/lib/nav.ts`（那里有完整的四消费者对照表）。
   */
  const navTableRows = useMemo(() => navRowsDesc(navRows), [navRows])
  /**
   * 两套口径并列（2026-11-11 用户「不混账」）：策略口径＝竞价买→当日收盘；
   * T+1 口径＝竞价买→**次日**收盘。日期集合不同 → 取并集，各自**前向填充**
   * （净值是阶梯序列，缺日沿用上一值），⛔ 不做插值）。
   */
  const navT1Rows = useMemo(
    () => [...(navT1.data ?? [])].sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    [navT1.data],
  )
  const navAxis = useMemo(() => {
    const ds = new Set<string>()
    for (const r of navRows) ds.add(r.trade_date)
    for (const r of navT1Rows) ds.add(r.trade_date)
    return [...ds].sort()
  }, [navRows, navT1Rows])
  const fillNav = (rows: { trade_date: string; nav: number }[], d: string) => {
    let v = 1
    for (const r of rows) {
      if (r.trade_date <= d) v = r.nav
      else break
    }
    return v
  }
  const navSeries = useMemo(() => {
    const out: Array<{ name: string; values: number[]; tone: 'up' | 'rec'; area?: boolean }> = [
      { name: '策略口径（当日收盘）', values: navAxis.map((d) => fillNav(navRows, d)), tone: 'up', area: true },
    ]
    if (navT1Rows.length) {
      out.push({ name: 'T+1 口径（次日收盘）', values: navAxis.map((d) => fillNav(navT1Rows, d)), tone: 'rec' })
    }
    return out
  }, [navAxis, navRows, navT1Rows])
  const lastNav = navRows.at(-1)

  /** 累计收益 = 末值 - 1；最大回撤按净值序列逐点计算 */
  const maxDrawdown = useMemo(() => {
    let peak = -Infinity
    let mdd = 0
    for (const r of navRows) {
      peak = Math.max(peak, r.nav)
      mdd = Math.min(mdd, r.nav / peak - 1)
    }
    return mdd
  }, [navRows])

  /** 预案档（AI 昨日盘后写）判参与的只数 */
  const planCount = viewRows.filter((r) => r.view === 'participate').length
  /** 今晨 09:25 实际买入只数（名额内成交） */
  const callCount = callFile?.meta?.participate?.length ?? 0
  /**
   * 「命中逻辑」页的数量 = 已参与 + 只缺市场级条件被压住的票。
   * ⛔ 与 `AiHitLogic` 内同一判据（`isMarketOnlyBlock`），两处必须一致，否则标签数与内容对不上。
   */
  const hitCount = useMemo(() => {
    const views = callFile?.views ?? {}
    const participated = new Set(callFile?.meta?.participate ?? [])
    return Object.values(views).filter((v) => participated.has(v.code) || isMarketOnlyBlock(v)).length
  }, [callFile])


  return (
    <div className="flex flex-col gap-3">
      {/* 页头：日期切换 + 视图切换。
          ⛔ 不把 tab 塞进卡片标题 —— 「今日决策」要独占整宽才能左右对照。 */}
      <section className="panel flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-13 font-semibold text-txt">财富密码</span>
        {viewFiles.length > 1 && (
          <select
            value={viewDate}
            onChange={(e) => setViewDate(e.target.value)}
            className="text-12 px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
          >
            <option value="">今天</option>
            {viewFiles.map((f) => (
              <option key={f.date} value={f.date}>
                {f.date}
              </option>
            ))}
          </select>
        )}
        <SegTabs
          items={[
            // 2026-11-11 精简：8 个 tab → 4 个（今天 / 判断 / 战绩 / 分析）
            // · 竞价现场 并入「今天」（DecisionBoard 里本就有今晨竞价块）
            // · 为什么选它 并入「判断」（它只是 4/41 的子集）
            // · 台账 + 净值 合成「战绩」
            // · 回测 + 诊断 合成「分析」
            { key: 'board', label: '今日决策' },
            {
              key: 'judge',
              label: `判断 · ${callFile ? Object.keys(callFile.views ?? {}).length : 0} 已判 / ${viewRows.length} 预案`,
            },
            { key: 'record', label: '战绩' },
            { key: 'analysis', label: '分析' },
          ]}
          value={tab}
          onChange={(k) => setTab(k as typeof tab)}
        />
        {activeView && (
          <span className="ml-auto num text-11 text-sub">
            预案 {activeView.decision_date} · 执行 {executionDate}
            {/* 盘后会提前写出次一交易日预案，那天还没到竞价时刻 → 明说，别让人以为系统坏了 */}
            {!callFile && <span className="ml-2 text-warn">该执行日尚无 09:25 裁决</span>}
          </span>
        )}
      </section>

      {/* ① 今日决策 = 一天的完整决策链（该不该做 → 什么环境 → 筛掉谁 → 选了什么 → 怎么买） */}
      {tab === 'board' && (
        <>
          <DecisionBoard dossier={dossier} callFile={callFile} ledger={ledger} quotes={quotes.data} screen={screenFile} />
          {/* 竞价现场（原独立 tab）——与 DecisionBoard 的「今晨竞价」同源，合到一处看 */}
          <Card
            title="竞价现场"
            extra={<CardBadge tone={callFile ? 'rec' : 'neutral'}>{callFile?.trade_date ?? '未生成'}</CardBadge>}
          >
            <ExecutionPanel dossier={dossier} callFile={callFile} />
          </Card>
        </>
      )}

      {/* ② 今日执行 = 09:25 竞价怎么走的（原 /auction 的独有视角，2026-11-04 合并）
          ⛔ 与「今日决策」分工：决策页回答「明天买什么」，本页回答「今天到底做了没有」。
            两页曾是同一份档案的两个副本（环境/接力/观察三块重复），现已合并到一处。 */}
      {tab === 'analysis' && (
        <div className="flex flex-col gap-3">
          {/* 回测：三套收益口径并列（⛔ 不混账） */}
          <BacktestCard data={backtest.data} />
          {/* 全量过筛：调参用，不是下单依据 */}
          <Card
            title="全量过筛"
            extra={
              <CardBadge tone={screenFile ? 'rec' : 'neutral'}>
                {screenFile ? `通过 ${screenFile.counts.pass} / 涨停 ${screenFile.zt_count}` : '未启用'}
              </CardBadge>
            }
          >
            <ScreenFunnel screen={screenFile} />
          </Card>
        </div>
      )}

      {tab === 'judge' && (
        <div className="flex flex-col gap-3">
          {/* 命中逻辑：只讲「买到的 4 只为什么被选中」 */}
          <Card
            title="命中逻辑"
            extra={<CardBadge tone={callFile ? 'rec' : 'neutral'}>{hitCount} 只 · {callFile?.trade_date ?? '未生成'}</CardBadge>}
          >
            <AiHitLogic file={callFile} tradeDate={callFile?.trade_date ?? activeView?.date} />
          </Card>

          {/* 判断明细 = 今晨 09:25 裁决终态 × 接力卡真实项 */}
          <Card title="判断明细">
            {activeView && (
              <div className="text-sub text-12 mb-2 flex flex-col gap-0.5">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span>预案参与</span>
                  <span className="num text-txt">{planCount}</span>
                  <span>/ 共</span>
                  <span className="num text-txt">{viewRows.length}</span>
                  <span className="text-sub">|</span>
                  <span>今晨 09:25 裁决</span>
                  {callFile ? (
                    <>
                      <span className="text-sub">|</span>
                      <span>取向 <span className="text-txt">{stanceText(callFile.stance)}</span></span>
                      <span className="text-sub">|</span>
                      <span>名额 <span className="num text-txt">{callFile.quota}</span></span>
                      <span className="text-sub">|</span>
                      <span>实际买入 <span className="num text-up font-semibold">{callCount}</span> 只</span>
                      {callFile.meta?.call_at && <span className="num text-sub">· {callFile.meta.call_at}</span>}
                    </>
                  ) : (
                    <span>未生成（当日 09:25 后生成）</span>
                  )}
                </div>
              </div>
            )}
            <AiJudgeDetail
              rows={judgeRows}
              decisionDate={activeView?.decision_date}
              hasCallFile={Boolean(callFile?.trade_date)}
            />
          </Card>
        </div>
      )}

      {tab === 'record' && (
        <div className="flex flex-col gap-3">
          <SegTabs
            items={[
              // 2026-11-11：台账 + 净值 合并为「战绩」；两套口径⛔ 不混成一条线
              { key: 'chart', label: '净值曲线' },
              { key: 'detail', label: `台账明细 (${decRows.length})` },
            ]}
            value={recordView}
            onChange={(k) => setRecordView(k as 'chart' | 'detail')}
          />
          {recordView === 'detail' && (
        <Card title="AI 台账" extra={<CardBadge>{decRows.length} 条</CardBadge>}>
          <DataTable<AiDecisionEntry>
            rows={decRows}
            rowKey={(r, i) => `${r.decision_date}-${r.code}-${i}`}
            empty="台账为空"
            columns={[
              { label: '决策日', cell: (r) => <span className="num">{r.decision_date}</span> },
              {
                label: '标的',
                cell: (r) => (
                  <span>
                    <StockLink code={r.code} className="text-txt">
                      {r.name || r.code}
                    </StockLink>
                  </span>
                ),
              },
              {
                label: '排序评分',
                num: true,
                cell: (r) => (
                  <span className={cn('num font-semibold', (r.ranking_score ?? 0) >= 80 ? 'text-up' : 'text-txt')}>
                    {r.ranking_score == null ? '—' : `${n1(r.ranking_score)} / 100`}
                  </span>
                ),
              },
              {
                label: '判断',
                cell: (r) => {
                  const m = VIEW_META[r.view] ?? { label: r.view, tone: 'sub' as const }
                  return (
                    <span className={m.tone === 'up' ? 'text-up' : m.tone === 'rec' ? 'text-rec' : 'text-sub'}>
                      {m.label}
                    </span>
                  )
                },
              },
              { label: '仓位', num: true, cell: (r) => (r.position ? r.position : '—') },
              {
                label: '结算',
                cell: (r) => <Tag tone={r.settled ? 'up' : 'neutral'}>{r.settled ? '已结算' : '未结算'}</Tag>,
              },
              { label: '来源', cell: (r) => <span className="text-sub text-12">{r.source || '—'}</span> },
              {
                label: '理由',
                className: 'whitespace-normal min-w-[300px]',
                cell: (r) => <span className="text-12 leading-relaxed">{r.reason || '—'}</span>,
              },
            ]}
          />
        </Card>
          )}
          {recordView === 'chart' && (
        <div className="flex flex-col gap-3">
          <Card title="AI 轨净值" extra={<CardBadge tone={lastNav && lastNav.nav >= 1 ? 'up' : 'down'}>{lastNav ? n2(lastNav.nav) : '—'}</CardBadge>}>
          {/* 概览指标：原「台账总览」侧栏合并进来的，别在精简时丢掉 */}
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
            <StatPair label="累计收益" value={lastNav ? pct((lastNav.nav - 1) * 100) : '—'}
                      tone={lastNav && lastNav.nav >= 1 ? 'up' : 'down'} />
            <StatPair label="最大回撤" value={navRows.length ? pct(maxDrawdown * 100) : '—'} tone="down" />
            <StatPair label="结算日数" value={navRows.length} />
            <StatPair label="最新结算日" value={lastNav?.trade_date ?? '—'} />
            <StatPair label="判断日数" value={viewFiles.length} />
          </div>
          <div className="border border-line rounded-sm p-2.5 mb-3">
            <LineChart
              series={navSeries}
              labels={navAxis}
              height={220}
              format={(v) => n2(v)}
              refLines={NAV_BASELINE}
            />
          </div>
          <DataTable
            rows={navTableRows}
            rowKey={(r) => r.trade_date}
            empty="尚无结算记录（15:30 后生成）"
            columns={[
              {
                label: '结算日',
                cell: (r, i) => (
                  <span className="num">
                    {r.trade_date}
                    {i === 0 && <span className="ml-1.5 text-10 text-sub">最新</span>}
                  </span>
                ),
              },
              { label: '决策日', cell: (r) => <span className="num text-sub">{r.recommendation_date}</span> },
              { label: '口径', cell: (r) => <Tag>{CALIBER_LABEL[r.strategy] ?? (r.strategy || '—')}</Tag> },
              {
                label: '成交数',
                num: true,
                cell: (r) => <span className={r.stock_count === 0 ? 'text-sub' : 'text-txt'}>{r.stock_count}</span>,
              },
              {
                label: '当日均收益',
                num: true,
                cell: (r) => (
                  <span className={r.avg_return_pct >= 0 ? 'text-up' : 'text-down'}>{pct(r.avg_return_pct)}</span>
                ),
              },
              {
                label: '净值',
                num: true,
                cell: (r) => (
                  <span className={cn('font-semibold num', r.nav >= 1 ? 'text-up' : 'text-down')}>{n2(r.nav)}</span>
                ),
              },
              { label: 'AI 已决策', num: true, cell: (r) => r.decided },
              {
                label: '成交标的',
                className: 'whitespace-normal min-w-[240px]',
                cell: (r) =>
                  r.stocks.length ? (
                    <span className="flex flex-wrap gap-1">
                      {r.stocks.map((s) => (
                        <Tag key={s.code} tone={s.return_pct >= 0 ? 'up' : 'down'}>
                          <StockLink code={s.code}>
                            {s.name || s.code} {pct(s.return_pct, 1)}
                          </StockLink>
                        </Tag>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sub">空仓</span>
                  ),
              },
            ]}
          />
          </Card>
        </div>
          )}
        </div>
      )}

      {!view.isLoading && !dossier && !viewRows.length && !decRows.length && !navRows.length && (
        <EmptyState
          text="财富密码尚无数据"
          hint="wealth_code/cache/candidates-<日期>.json 与 ai_decisions.jsonl 未生成"
        />
      )}
    </div>
  )
}

/**
 * 财富密码 · 单一入口（2026-11-10 终端精简）
 *
 * 原来侧栏有 4 个入口（财富密码 / 竞价留痕 / 执行审计 / 尾盘潜伏），但它们是同一条链路的
 * 不同切面：**预案 → 竞价 → 成交 → 结算**。分成 4 个入口的结果是「看今天这票为什么买」
 * 要在 4 页之间来回切（实测多数页面 8 天只被打开 1 次）。
 *
 * 现在收成一个入口 + 四个切面；⛔ 旧 URL 全部保留（各自仍是独立路由），只是不再占侧栏。
 */
const CALIBER_LABEL: Record<string, string> = {
  ai_judgement_next_day_close: '策略口径（竞价→当日收盘）',
  ai_judgement_t1_close: 'T+1 口径（竞价→次日收盘）',
}

// 2026-11-16 用户定的顺序：今日 → 明日 → 尾盘 → 竞价 → 执行（文案不变）
const WEALTH_SECTIONS = [
  { key: 'today', label: '今日' },
  { key: 'tomorrow', label: '明日' },
  { key: 'ambush', label: '尾盘' },
  { key: 'gap', label: '竞价' },
  { key: 'audit', label: '执行' },
] as const

type WealthSection = (typeof WEALTH_SECTIONS)[number]['key']

export function Component() {
  const [section, setSection] = useState<WealthSection>('today')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <span className="text-12 font-semibold text-txt">财富密码</span>
        <SegTabs
          items={WEALTH_SECTIONS as unknown as ReadonlyArray<{ key: string; label: string }>}
          value={section}
          onChange={(k) => setSection(k as WealthSection)}
        />
      </div>
      {section === 'today' && <AiWealthView />}
      {section === 'tomorrow' && <TomorrowView />}
      {section === 'ambush' && <AmbushView />}
      {section === 'gap' && <SectorGapView />}
      {section === 'audit' && <ExecutionAuditView />}
    </div>
  )
}

/**
 * 明日策略（2026-11-16 用户：顶部独立 tab「明日」，不再塞在今日链路里）。
 * 只读最新一期决策档案；⛔ 不在这里做任何判定。
 */
export function TomorrowView() {
  const dossiers = useQuery(analyticsQueries.decisionCandidates())
  const latest = useMemo(() => {
    const list = (dossiers.data ?? []).map((f) => f.data).filter((x): x is DecisionDossier => !!x)
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    return list[0]
  }, [dossiers.data])
  return <TomorrowBoard dossier={latest} />
}

