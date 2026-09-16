import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { AiDecisionEntry, AiViewFile, AiViewItem } from '@/shared/api'
import { analyticsQueries, DataTable, SegTabs, StatPair, Tag, n2, pct } from '@/features/analytics'
import { Card, CardBadge, EmptyState, Zone, ZoneRow } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * AI 台账 —— 数据源 `wealth_code/cache/ai_view/` + `ai_decisions.jsonl` + `ai_nav_history.jsonl`。
 *
 * ## 这一页回答的核心问题
 *
 * 「AI 当时怎么判断的，和系统机械口径差在哪，最后谁对？」
 * 三份数据各管一段：
 *   · `ai_view`      —— 决策**前**下的判断（participate / watch / skip + 理由）
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
  return null
}

/** 判断语义 —— 只做三值映射，不给参与/观望加奖惩式措辞 */
const VIEW_META: Record<string, { label: string; tone: 'up' | 'rec' | 'sub' }> = {
  participate: { label: '参与', tone: 'up' },
  watch: { label: '观察', tone: 'rec' },
  skip: { label: '放弃', tone: 'sub' },
}

export function Component() {
  const view = useQuery(analyticsQueries.aiView())
  const decisions = useQuery(analyticsQueries.aiDecisions())
  const nav = useQuery(analyticsQueries.aiNav())
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

  const participateCount = viewRows.filter((r) => r.view === 'participate').length

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
              <div className="text-sub text-[12px] mb-2">
                决策日 <span className="num text-txt">{activeView.decision_date}</span> · 落盘日{' '}
                <span className="num text-txt">{activeView.date}</span> · 参与{' '}
                <span className="num text-up font-semibold">{participateCount}</span> / 共{' '}
                <span className="num">{viewRows.length}</span>
              </div>
            )}
            <DataTable<(AiViewItem & { code: string })>
              rows={viewRows}
              rowKey={(r) => r.code}
              rowClass={(r) => (r.view === 'participate' ? 'bg-rec/5' : undefined)}
              empty="该日无 AI 判断记录"
              columns={[
                { label: '代码', cell: (r) => <span className="num text-sub">{r.code}</span> },
                {
                  label: '判断',
                  cell: (r) => {
                    const m = VIEW_META[r.view] ?? { label: r.view, tone: 'sub' as const }
                    return (
                      <span
                        className={cn(
                          'font-semibold text-[12.5px]',
                          m.tone === 'up' ? 'text-up' : m.tone === 'rec' ? 'text-rec' : 'text-sub',
                        )}
                      >
                        {m.label}
                      </span>
                    )
                  },
                },
                {
                  label: 'AI 自定高开上限',
                  num: true,
                  cell: (r) => <span className="text-sub">{pct(r.entry_max_gap, 1)}</span>,
                },
                {
                  label: '理由',
                  className: 'whitespace-normal min-w-[320px]',
                  cell: (r) => <span className="text-[12px] leading-relaxed">{r.reason || '—'}</span>,
                },
              ]}
            />
            <p className="text-sub text-[11.5px] mt-2 leading-relaxed">
              「AI 自定高开上限」仅作留痕 —— 实际生效值恒为用户纪律 5%，不随 AI 自定值放宽。
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
