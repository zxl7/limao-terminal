import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type {
  AiDecisionEntry,
  AiViewFile,
  DecisionDossier,
  DossierStock,
  PoolCallFile,
} from '@/shared/api'
import {
  AiJudgeDetail,
  analyticsQueries,
  compareJudgeRows,
  DataTable,
  SegTabs,
  StatPair,
  Tag,
  type JudgeRow,
  n1,
  n2,
  pct,
} from '@/features/analytics'
import { Card, CardBadge, EmptyState, LineChart, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, stanceText, viewText } from '@/shared/lib'

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
  // 判断明细要关联「尾盘财富密码接力卡」的真实字段（区间/量能/指标/标签）
  await queryClient.ensureQueryData(analyticsQueries.decisionCandidates())
  // 「判断」一栏取**今晨 09:25 裁决终态**（实际怎么做），而非昨日盘后预案
  await queryClient.ensureQueryData(analyticsQueries.decisionPoolCall())
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

const ROLE_TONE: Record<string, 'warn' | 'rec' | 'sub'> = {
  龙头: 'warn',
  准龙头: 'rec',
  跟风: 'sub',
}

function roleOf(row: JudgeRow): '龙头' | '准龙头' | '跟风' | undefined {
  const role = row.call?.leaderRole ?? row.stock?.leader_role
  return role === '龙头' || role === '准龙头' || role === '跟风' ? role : undefined
}

function shortReason(text?: string | null): string | undefined {
  const line = text?.split(/[；\n]/).map((x) => x.trim()).find(Boolean)
  return line || undefined
}

function ChangeBlock({
  label,
  empty,
  tone,
  summary,
  children,
}: {
  label: string
  empty: string
  tone: 'warn' | 'rec' | 'sub'
  summary?: ReactNode
  children: ReactNode
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []
  return (
    <section className="min-w-0 rounded-sm border border-line bg-card px-2.5 py-2">
      <div className={cn('mb-1.5 text-12 font-semibold', tone === 'warn' ? 'text-warn' : tone === 'rec' ? 'text-rec' : 'text-sub')}>
        {label}
      </div>
      {summary && <div className="mb-1.5 text-11 text-sub">{summary}</div>}
      {items.length ? <div className="flex flex-col gap-1.5">{children}</div> : <div className="text-11 text-sub">{empty}</div>}
    </section>
  )
}

function ChangeRow({
  title,
  titleText,
  tone,
  pct: pctVal,
  children,
}: {
  title: ReactNode
  titleText?: string
  tone: 'warn' | 'rec' | 'sub'
  /** 个股涨跌幅度（今晨竞价涨幅 %）—— 缺数据时留空，不退化成 0 */
  pct?: number | null
  children: ReactNode
}) {
  return (
    <div className="min-w-0 border-l-2 border-line pl-2">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span
          className={cn('truncate text-12 font-medium', tone === 'warn' ? 'text-warn' : tone === 'rec' ? 'text-rec' : 'text-txt')}
          title={titleText}
        >
          {title}
        </span>
        {pctVal != null && (
          <span
            className={cn(
              'num flex-none text-11 font-semibold',
              pctVal > 0 ? 'text-up' : pctVal < 0 ? 'text-down' : 'text-sub',
            )}
          >
            {pctVal > 0 ? '+' : ''}
            {pctVal.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="line-clamp-2 text-11 leading-relaxed text-sub" title={typeof children === 'string' ? children : undefined}>
        {children}
      </div>
    </div>
  )
}

export function Component() {
  const view = useQuery(analyticsQueries.aiView())
  const decisions = useQuery(analyticsQueries.aiDecisions())
  const nav = useQuery(analyticsQueries.aiNav())
  /** 尾盘财富密码接力卡存档（近 3 期）—— 判断明细的「真实字段」来源 */
  const dossiers = useQuery(analyticsQueries.decisionCandidates())
  /** 09:25 池内裁决终态（近 3 期）—— 判断明细的「实际怎么做」来源 */
  const poolCalls = useQuery(analyticsQueries.decisionPoolCall())
  const [tab, setTab] = useState<'view' | 'decisions' | 'nav'>('view')
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
  const activeView = viewFiles.find((f) => f.date === viewDate) ?? viewFiles[0]

  /** 判断条目展开为行（code 是 Record 的 key，需要提上来） */
  const viewRows = useMemo(
    () =>
      Object.entries(activeView?.views ?? {}).map(([code, item]) => ({ code, ...item })),
    [activeView],
  )

  /**
   * 与所选判断日**同一天**的接力卡（`date === activeView.decision_date`）。
   *
   * ⚠️ 口径：接力卡是**尾盘生成、次日执行** —— `candidates-<D>.json` 里的 `D` 正是
   *    ai_view 的 `decision_date`（判断日），**不是** `date`（落盘/执行日）。
   *    对不上时回落到最近一期；个股仍缺失则该行只渲染 AI 判断那一半（⛔ 不编造）。
   */
  const dossier = useMemo<DecisionDossier | undefined>(() => {
    const list = (dossiers.data ?? [])
      .map((f) => f.data)
      .filter((x): x is DecisionDossier => !!x)
    if (!list.length) return undefined
    return (
      list.find((d) => d.date === activeView?.decision_date) ??
      [...list].sort((a, b) => b.date.localeCompare(a.date))[0]
    )
  }, [dossiers.data, activeView])

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
   * ⛔ **无 fallback**：配不上就该显示「今晨裁决未落盘」——用最近一期顶上会把
   *    别天的成交结论安到本日头上（用户 2026-09-22 明确要求显示「今天 9:25 的这个」）。
   */
  const callFile = useMemo<PoolCallFile | undefined>(() => {
    if (!activeView?.date) return undefined
    const list = (poolCalls.data ?? [])
      .map((f) => f.data)
      .filter((x): x is PoolCallFile => !!x)
    return list.find((p) => p.trade_date === activeView.date)
  }, [poolCalls.data, activeView])

  /**
   * 判断明细行 = **今晨 09:25 终态**（结论）× 接力卡真实字段（依据）+ bias 越权兜底留痕。
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

  /** 今日变化只取已落盘预案、09:25裁决与竞价字段；页面不自行推断交易结论。 */
  const decisionChanges = useMemo(() => {
    const finalViewOf = (row: JudgeRow) => row.call?.view ?? row.view ?? 'pending'
    const plannedViewOf = (bias?: string) => ({ focus: 'participate', normal: 'watch', avoid: 'skip' }[bias ?? ''])
    const roleRows = judgeRows
      .map((row) => ({ row, role: roleOf(row) }))
      .filter((item): item is { row: JudgeRow; role: '龙头' | '准龙头' | '跟风' } => !!item.role)
      .sort((a, b) => compareJudgeRows(a.row, b.row))

    const finalRows = [...judgeRows].sort(compareJudgeRows)
    const finalCounts = finalRows.reduce<Record<string, number>>((counts, row) => {
      const finalView = finalViewOf(row)
      counts[finalView] = (counts[finalView] ?? 0) + 1
      return counts
    }, {})
    const changed = finalRows.filter((row) => {
      const planned = plannedViewOf(row.bias)
      return !!row.call && !!planned && planned !== finalViewOf(row)
    })

    const competition = roleRows.filter(({ row }) => {
      const note = row.call?.leaderEvidenceNote ?? row.stock?.leader_evidence?.note ?? ''
      return note.includes('二板') || note.includes('晋级')
    })
    const succession = roleRows.filter(({ row }) => {
      const note = row.call?.leaderEvidenceNote ?? row.stock?.leader_evidence?.note ?? ''
      return note.includes('断板') || note.includes('接力')
    })
    // 竞争与接力证据可能指向同一只票，只保留一次，避免把同一结论重复展示成两条。
    const competitionRows = [...competition, ...succession].filter(
      ({ row }, index, list) => list.findIndex((item) => item.row.code === row.code) === index,
    )
    const risks = finalRows
      .map((row) => {
        const reasons: string[] = []
        const planned = plannedViewOf(row.bias)
        const finalView = finalViewOf(row)
        if (!row.call) reasons.push('今晨裁决冻结件未落盘')
        if (row.call?.zone === 'above') reasons.push('竞价高于预期区间')
        if (row.call?.zone === 'below') reasons.push('竞价低于预期区间')
        if (row.call?.amountYi != null && row.call?.needYi != null && row.call.amountYi < row.call.needYi) reasons.push('竞价量能不足')
        if (row.call?.mechanicalLeader && planned && planned !== finalView) reasons.push('AI预案与最终裁决不同')
        return { row, reasons }
      })
      .filter((item) => item.reasons.length > 0)
    return { finalRows, finalCounts, changed, competitionRows, risks, finalViewOf, plannedViewOf }
  }, [judgeRows])

  return (
    <div className="flex flex-col gap-3">
      {tab === 'view' && activeView && (
        <Card
          title="竞价后决策变化"
          extra={<CardBadge tone={callFile ? 'rec' : 'neutral'}>执行日 {activeView.date}</CardBadge>}
        >
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-4">
            <ChangeBlock
              label="竞价后最终结论"
              empty="暂无参与标的"
              tone="warn"
              summary={<>参与 {decisionChanges.finalCounts.participate ?? 0} · 观察 {decisionChanges.finalCounts.watch ?? 0} · 放弃 {decisionChanges.finalCounts.skip ?? 0} · 待裁决 {decisionChanges.finalCounts.pending ?? 0}</>}
            >
              {decisionChanges.finalRows.filter((row) => decisionChanges.finalViewOf(row) === 'participate').slice(0, 3).map((row) => (
                <ChangeRow
                  key={row.code}
                  title={<StockLink code={row.code}>{row.stock?.name ?? row.code}</StockLink>}
                  titleText={row.stock?.name ?? row.code}
                  tone="warn"
                  pct={row.call?.gapPct}
                >
                  {row.stock?.score == null ? '排序评分缺失' : `排序评分 ${n1(row.stock.score)}`}
                </ChangeRow>
              ))}
            </ChangeBlock>
            <ChangeBlock label="预案发生变化" empty="预案与今晨裁决一致" tone="rec">
              {decisionChanges.changed.slice(0, 3).map((row) => {
                const planned = decisionChanges.plannedViewOf(row.bias)
                const final = decisionChanges.finalViewOf(row)
                return (
                  <ChangeRow
                    key={row.code}
                    title={<StockLink code={row.code}>{row.stock?.name ?? row.code}</StockLink>}
                    titleText={row.stock?.name ?? row.code}
                    tone="rec"
                    pct={row.call?.gapPct}
                  >
                    {`${viewText(planned)} → ${viewText(final)}${row.call?.reason ? ` · ${shortReason(row.call.reason)}` : ''}`}
                  </ChangeRow>
                )
              })}
            </ChangeBlock>
            <ChangeBlock label="龙头竞争" empty="暂无二进三或接力竞争证据" tone="rec">
              {decisionChanges.competitionRows.slice(0, 3).map(({ row, role }) => (
                <ChangeRow
                  key={row.code}
                  title={<StockLink code={row.code}>{`${row.stock?.name ?? row.code} · ${role}`}</StockLink>}
                  titleText={`${row.stock?.name ?? row.code} · ${role}`}
                  tone={ROLE_TONE[role]}
                  pct={row.call?.gapPct}
                >
                  {shortReason(row.call?.leaderEvidenceNote ?? row.stock?.leader_evidence?.note) ?? '竞争证据待积累'}
                </ChangeRow>
              ))}
            </ChangeBlock>
            <ChangeBlock label="风险与分歧" empty="暂无竞价或裁决异常" tone="sub">
              {decisionChanges.risks.slice(0, 3).map(({ row, reasons }) => (
                <ChangeRow
                  key={row.code}
                  title={<StockLink code={row.code}>{row.stock?.name ?? row.code}</StockLink>}
                  titleText={row.stock?.name ?? row.code}
                  tone="sub"
                  pct={row.call?.gapPct}
                >
                  {reasons.join(' · ')}
                </ChangeRow>
              ))}
            </ChangeBlock>
          </div>
        </Card>
      )}
      {/* 概览窄栏（两轨口径提示） + 明细宽栏（逐笔判断记录，多列需横向空间）。
          ⛔ 旧版概览通栏独占一整行、明细被压到下方。 */}
      <ZoneRow className="ai-ledger-layout">
        <Zone label="台账总览" dot="bg-rec" className="xl:w-[24%] xl:order-1 xl:sticky xl:top-3">
          <Card
            title="🤖 AI 独立台账"
        extra={
          <CardBadge tone={lastNav && lastNav.nav >= 1 ? 'up' : 'down'}>
            AI 轨净值 {lastNav ? n2(lastNav.nav) : '—'}
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair
            label="累计收益"
            value={lastNav ? pct((lastNav.nav - 1) * 100) : '—'}
            tone={lastNav && lastNav.nav >= 1 ? 'up' : 'down'}
          />
          <StatPair
            label="最大回撤"
            value={navRows.length ? pct(maxDrawdown * 100) : '—'}
            tone="down"
          />
          <StatPair label="结算日数" value={navRows.length} />
          <StatPair label="最新结算日" value={lastNav?.trade_date ?? '—'} />
          <StatPair label="判断日数" value={viewFiles.length} />
        </div>
        <div className="border border-line rounded-sm p-2.5 mb-2.5">
          <div className="text-13 font-semibold mb-2">🤖 AI 轨净值走势</div>
          {navRows.length ? (
            <LineChart
              series={[{ name: '净值', values: navRows.map((r) => r.nav), tone: 'up', area: true }]}
              labels={navRows.map((r) => r.trade_date)}
              height={200}
              format={(v) => n2(v)}
              refLines={NAV_BASELINE}
            />
          ) : (
            <div className="text-sub text-12 py-6 text-center">暂无结算记录（每日 15:30 后落盘）</div>
          )}
        </div>
      </Card>
        </Zone>

        <Zone label="判断明细" dot="bg-lead" className="xl:w-[76%] xl:order-2">
          <Card
            title="判断明细"
        extra={
          <div className="flex items-center gap-2">
            {viewFiles.length > 1 && (
              <select
                value={activeView?.date ?? ''}
                onChange={(e) => setViewDate(e.target.value)}
                className="text-12 px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
              >
                {viewFiles.map((f) => (
                  <option key={f.date} value={f.date}>
                    {f.date}
                  </option>
                ))}
              </select>
            )}
            <SegTabs
              items={[
                { key: 'view', label: `判断 (${viewRows.length})` },
                { key: 'decisions', label: `台账 (${decRows.length})` },
                { key: 'nav', label: `净值 (${navRows.length})` },
              ]}
              value={tab}
              onChange={(k) => setTab(k as typeof tab)}
            />
          </div>
        }
      >
        {tab === 'view' && (
          <>
            {activeView && (
              <div className="text-sub text-12 mb-2 flex flex-col gap-0.5">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span>预案</span>
                  <span className="num text-txt">{activeView.decision_date}</span>
                  <span>（AI 盘后写）</span>
                  <span className="text-sub">|</span>
                  <span>执行日</span>
                  <span className="num text-txt">{activeView.date}</span>
                  <span className="text-sub">|</span>
                  <span>
                    预案参与 <span className="num text-txt">{planCount}</span> / 共{' '}
                    <span className="num text-txt">{viewRows.length}</span>
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span>今晨 09:25 裁决</span>
                  {callFile ? (
                    <>
                      <span className="text-sub">|</span>
                      <span>
                        取向{' '}
                        <span className="text-txt">
                          {stanceText(callFile.stance)}
                        </span>
                      </span>
                      <span className="text-sub">|</span>
                      <span>
                        名额 <span className="num text-txt">{callFile.quota}</span>
                      </span>
                      <span className="text-sub">|</span>
                      <span>
                        实际买入{' '}
                        <span className="num text-up font-semibold">{callCount}</span> 只
                      </span>
                      {callFile.meta?.call_at && (
                        <span className="num text-sub">· {callFile.meta.call_at}</span>
                      )}
                    </>
                  ) : (
                    <span>未落盘（当日 09:25 后生成）</span>
                  )}
                </div>
              </div>
            )}
            {/* 判断明细 = **今晨 09:25 裁决终态** × 尾盘财富密码接力卡真实字段。
                ⛔ 不显示「统一 5%」；⛔ 不可把「判断」退回成昨日预案（那是输入，非结论）。 */}
            <AiJudgeDetail rows={judgeRows} decisionDate={activeView?.decision_date} />
          </>
        )}

        {tab === 'decisions' && (
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
                    <StockLink code={r.code} className="text-txt">{r.name || r.code}</StockLink>
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
                cell: (r) => (
                  <Tag tone={r.settled ? 'up' : 'neutral'}>{r.settled ? '已结算' : '未结算'}</Tag>
                ),
              },
              { label: '来源', cell: (r) => <span className="text-sub text-12">{r.source || '—'}</span> },
              {
                label: '理由',
                className: 'whitespace-normal min-w-[300px]',
                cell: (r) => <span className="text-12 leading-relaxed">{r.reason || '—'}</span>,
              },
            ]}
          />
        )}

        {tab === 'nav' && (
          <>
          <div className="border border-line rounded-sm p-2.5 mb-3">
            <div className="text-13 font-semibold mb-2">🤖 AI 轨净值走势</div>
            <LineChart
              series={[{ name: '净值', values: navRows.map((r) => r.nav), tone: 'up', area: true }]}
              labels={navRows.map((r) => r.trade_date)}
              height={220}
              format={(v) => n2(v)}
              refLines={NAV_BASELINE}
            />
            <p className="text-sub text-11 mt-1.5 leading-relaxed">
              净值起点 1.0，由每日 15:30 结算落盘；当前 {navRows.length} 个结算日，点数增多后趋势更清晰。虚线为盈亏分界。
            </p>
          </div>
          <DataTable
            rows={navRows}
            rowKey={(r) => r.trade_date}
            empty="尚无结算记录（15:30 后落盘）"
            columns={[
              { label: '结算日', cell: (r) => <span className="num">{r.trade_date}</span> },
              { label: '决策日', cell: (r) => <span className="num text-sub">{r.recommendation_date}</span> },
              { label: '口径', cell: (r) => <Tag>{r.strategy || '—'}</Tag> },
              {
                label: '成交数',
                num: true,
                cell: (r) => (
                  <span className={r.stock_count === 0 ? 'text-sub' : 'text-txt'}>{r.stock_count}</span>
                ),
              },
              {
                label: '当日均收益',
                num: true,
                cell: (r) => (
                  <span className={r.avg_return_pct >= 0 ? 'text-up' : 'text-down'}>
                    {pct(r.avg_return_pct)}
                  </span>
                ),
              },
              {
                label: '净值',
                num: true,
                cell: (r) => (
                  <span className={cn('font-semibold num', r.nav >= 1 ? 'text-up' : 'text-down')}>
                    {n2(r.nav)}
                  </span>
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
                          <StockLink code={s.code}>{s.name || s.code} {pct(s.return_pct, 1)}</StockLink>
                        </Tag>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sub">空仓</span>
                  ),
              },
            ]}
          />
          </>
        )}

        {!view.isLoading && !viewRows.length && !decRows.length && !navRows.length && (
          <EmptyState
            text="财富密码尚无数据"
            hint="wealth_code/cache/ai_view/ 与 ai_decisions.jsonl 未生成"
          />
        )}
      </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
