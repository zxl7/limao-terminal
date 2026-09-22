import { useMemo, useState } from 'react'
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
  DataTable,
  SegTabs,
  StatPair,
  Tag,
  type JudgeRow,
  n2,
  pct,
} from '@/features/analytics'
import { Card, CardBadge, EmptyState, LineChart, Zone, ZoneRow } from '@/shared/ui'
import { cn } from '@/shared/lib'

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

/** 当日取向（`pool_call.stance`）→ 中文 */
const STANCE_META: Record<string, string> = {
  attack: '进攻',
  selective: '精选',
  defend: '防守',
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
                  reason: cv.reason,
                },
              }
            : {}),
        }
      }),
    [viewRows, stockMap, callFile],
  )

  const decRows = useMemo(
    () => [...(decisions.data ?? [])].sort((a, b) => b.decision_date.localeCompare(a.decision_date)),
    [decisions.data],
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

  return (
    <div className="flex flex-col gap-3">
      {/* 概览窄栏（两轨口径提示） + 明细宽栏（逐笔判断记录，多列需横向空间）。
          ⛔ 旧版概览通栏独占一整行、明细被压到下方。 */}
      <ZoneRow>
        <Zone label="台账总览" dot="bg-rec" className="xl:w-[34%]">
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
          <div className="text-[12.5px] font-semibold mb-2">🤖 AI 轨净值走势</div>
          {navRows.length ? (
            <LineChart
              series={[{ name: '净值', values: navRows.map((r) => r.nav), tone: 'up', area: true }]}
              labels={navRows.map((r) => r.trade_date)}
              height={200}
              format={(v) => n2(v)}
              refLines={NAV_BASELINE}
            />
          ) : (
            <div className="text-sub text-[12px] py-6 text-center">暂无结算记录（每日 15:30 后落盘）</div>
          )}
          <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
            净值起点 1.0，虚线为盈亏分界；完整逐日明细见右侧「净值」标签。
          </p>
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          AI 轨与脚本轨是**两本独立账**（各自起点 1.0、候选集合不同），不可直接比大小 ——
          脚本轨见「交易战绩」。净值首行由当日 15:30 结算落盘，此前为空属正常时序。
        </p>
      </Card>
        </Zone>

        <Zone label="判断明细" dot="bg-lead" className="xl:w-[66%]">
          <Card
            title="判断明细"
        extra={
          <div className="flex items-center gap-2">
            {viewFiles.length > 1 && (
              <select
                value={activeView?.date ?? ''}
                onChange={(e) => setViewDate(e.target.value)}
                className="text-[12px] px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
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
              <div className="text-sub text-[12px] mb-2 flex flex-col gap-0.5">
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
                          {STANCE_META[callFile.stance] ?? callFile.stance}
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
            <AiJudgeDetail rows={judgeRows} />
            <p className="text-sub text-[11.5px] mt-2 leading-relaxed">
              「判断」取**今晨 09:25 竞价后的裁决终态**（实际做没做 + 买入名额序）；其下的
              预期开盘区间/竞价量能/维度指标/标签均取**昨日尾盘接力卡**原文（依据）。
              两段时点不同：接力卡是昨日 15:30 的预案输入，裁决是今晨 09:25 的结论。
            </p>
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
                    <span className="text-rec">{r.name || '—'}</span>
                    <span className="num text-sub ml-1.5">{r.code}</span>
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
              { label: '来源', cell: (r) => <span className="text-sub text-[11.5px]">{r.source || '—'}</span> },
              {
                label: '理由',
                className: 'whitespace-normal min-w-[300px]',
                cell: (r) => <span className="text-[12px] leading-relaxed">{r.reason || '—'}</span>,
              },
            ]}
          />
        )}

        {tab === 'nav' && (
          <>
          <div className="border border-line rounded-sm p-2.5 mb-3">
            <div className="text-[12.5px] font-semibold mb-2">🤖 AI 轨净值走势</div>
            <LineChart
              series={[{ name: '净值', values: navRows.map((r) => r.nav), tone: 'up', area: true }]}
              labels={navRows.map((r) => r.trade_date)}
              height={220}
              format={(v) => n2(v)}
              refLines={NAV_BASELINE}
            />
            <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
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
                          {s.name || s.code} {pct(s.return_pct, 1)}
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
            text="AI 台账尚无数据"
            hint="wealth_code/cache/ai_view/ 与 ai_decisions.jsonl 未生成"
          />
        )}
      </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
