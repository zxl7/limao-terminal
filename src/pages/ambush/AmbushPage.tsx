/**
 * AI尾盘潜伏 —— 尾盘阴线回踩十日线研究策略的战绩页。
 *
 * ## 与「接力脚本轨」严格隔离
 *
 * 本页只读两份**研究**账本：
 *   · `cache/ambush_pullback_signal_log.jsonl`      14:30 冻结信号
 *   · `cache/ambush_pullback_settlement_log.jsonl`  当日买入 → 次交易日 10:00 卖出 结算
 *
 * ⛔ 不与 `account_nav_history.jsonl`（接力脚本轨净值）、`ai_nav_history.jsonl`
 *   （AI 竞价轨净值）混算；三套执行时点与账户口径互不相同。
 *
 * ## 空态是预期状态
 *
 * 首次 14:30 研究扫描落盘前账本不存在，接口层已降级为空数组 ——
 * 页面显示「暂无记录」，不视为故障。
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { AmbushPullbackSettlementEntry, AmbushPullbackSignalEntry, AmbushWeightedPnlEntry } from '@/shared/api'
import { analyticsQueries, DataTable, Tag, n1, n2, pct } from '@/features/analytics'
import { BarChart, Card, CardBadge, EmptyState, LineChart } from '@/shared/ui'
import { cn } from '@/shared/lib'

export async function loader() {
  // 单路失败不拖垮整页（与 /timeline 同口径）
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.ambushPullbackSignals()),
    queryClient.ensureQueryData(analyticsQueries.ambushPullbackSettlements()),
    queryClient.ensureQueryData(analyticsQueries.ambushWeightedPnl()),
  ])
  return null
}

export function AmbushView() {
  const signals = useQuery(analyticsQueries.ambushPullbackSignals())
  const settlements = useQuery(analyticsQueries.ambushPullbackSettlements())
  const weightedPnl = useQuery(analyticsQueries.ambushWeightedPnl())
  return <AmbushPerformance signals={signals.data ?? []} settlements={settlements.data ?? []} weightedPnl={weightedPnl.data ?? []} />
}

function AmbushPerformance({ signals: sourceSignals, settlements: sourceSettlements, weightedPnl: sourceWeightedPnl }: { signals: AmbushPullbackSignalEntry[]; settlements: AmbushPullbackSettlementEntry[]; weightedPnl: AmbushWeightedPnlEntry[] }) {
  const signals = useMemo(() => [...sourceSignals].sort((a, b) => b.decision_date.localeCompare(a.decision_date)), [sourceSignals])
  const settlements = useMemo(() => [...sourceSettlements].sort((a, b) => b.trade_date.localeCompare(a.trade_date)), [sourceSettlements])
  const weightedPnl = useMemo(() => [...sourceWeightedPnl].sort((a, b) => b.decision_date.localeCompare(a.decision_date)), [sourceWeightedPnl])
  const settledKeys = useMemo(() => new Set(settlements.map((row) => `${row.decision_date}:${row.code}`)), [settlements])
  const pending = useMemo(() => signals.filter((row) => !settledKeys.has(`${row.decision_date}:${row.code}`)), [signals, settledKeys])
  const summary = useMemo(() => {
    if (!settlements.length) return { winRate: null, avg: null, median: null, latest: null as string | null }
    const values = settlements.map((row) => row.return_pct).sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    return {
      winRate: (values.filter((value) => value > 0).length / values.length) * 100,
      avg: values.reduce((sum, value) => sum + value, 0) / values.length,
      median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
      latest: settlements[0]?.trade_date ?? null,
    }
  }, [settlements])

  const curve = useMemo(() => {
    const daily = [...weightedPnl].sort((a, b) => a.decision_date.localeCompare(b.decision_date))
    const points = daily.map((row) => ({ label: row.decision_date.slice(5), nav: row.nav }))
    const bars = daily.map((row) => ({ label: row.decision_date.slice(5), value: row.weighted_return_pct }))
    const finalNav = points.at(-1)?.nav
    return {
      labels: points.map((point) => point.label),
      navs: points.map((point) => point.nav),
      bars,
      tone: finalNav == null ? ('sub' as const) : finalNav >= 1 ? ('up' as const) : ('down' as const),
      finalNav,
    }
  }, [weightedPnl])

  const curveTone = curve.tone === 'up' ? 'up' : curve.tone === 'down' ? 'down' : 'neutral'

  return (
    <div className="flex flex-col gap-3">
      <Card title="🎯 AI尾盘潜伏战绩" extra={<CardBadge tone="rec">当日买入 → 次交易日10:00</CardBadge>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-2 text-13">
          <Metric label="已结算" value={`${settlements.length}笔`} />
          <Metric label="胜率" value={summary.winRate == null ? '—' : `${summary.winRate.toFixed(0)}%`} cls={summary.winRate != null && summary.winRate >= 50 ? 'text-up' : undefined} />
          <Metric label="平均收益" value={summary.avg == null ? '—' : pct(summary.avg)} cls={summary.avg != null && summary.avg > 0 ? 'text-up' : summary.avg != null && summary.avg < 0 ? 'text-down' : undefined} />
          <Metric label="中位收益" value={summary.median == null ? '—' : pct(summary.median)} cls={summary.median != null && summary.median > 0 ? 'text-up' : summary.median != null && summary.median < 0 ? 'text-down' : undefined} />
          <Metric label="累计收益" value={curve.finalNav == null ? '—' : pct((curve.finalNav - 1) * 100)} cls={curve.finalNav != null && curve.finalNav >= 1 ? 'text-up' : curve.finalNav != null ? 'text-down' : undefined} />
          <Metric label="最新当日收益" value={weightedPnl[0] == null ? '—' : pct(weightedPnl[0].weighted_return_pct)} cls={weightedPnl[0] == null ? undefined : weightedPnl[0].weighted_return_pct > 0 ? 'text-up' : weightedPnl[0].weighted_return_pct < 0 ? 'text-down' : undefined} />
          <Metric label="待结算" value={`${pending.length}笔`} cls={pending.length ? 'text-warn' : 'text-sub'} />
          <Metric label="最新结算日" value={summary.latest ?? '—'} />
        </div>
      </Card>

      <Card title="📈 账户收益曲线" extra={<CardBadge tone={curveTone}>动态仓位加权 · 净值 {curve.finalNav == null ? '—' : n2(curve.finalNav)}</CardBadge>}>
        {curve.navs.length ? (
          <LineChart
            labels={curve.labels}
            series={[{ name: '累计净值', values: curve.navs, tone: curve.tone, area: true }]}
            height={260}
            showLegend={false}
            format={(v) => v.toFixed(3)}
            yTickCount={5}
            refLines={[{ value: 1, label: '本金线 1.00', tone: 'sub' }]}
          />
        ) : (
          <EmptyState text="暂无结算收益" />
        )}
      </Card>

      <Card title="📊 逐笔收益分布" extra={<CardBadge tone={summary.winRate != null && summary.winRate >= 50 ? 'up' : 'neutral'}>胜率 {summary.winRate == null ? '—' : `${summary.winRate.toFixed(0)}%`}</CardBadge>}>
        {curve.bars.length ? (
          <BarChart
            bars={curve.bars}
            height={170}
            format={(v) => `${n1(v)}%`}
            maxBarWidth={26}
          />
        ) : (
          <EmptyState text="暂无逐笔收益" />
        )}
      </Card>

      <Card title="研究结算流水" extra={<CardBadge>{settlements.length}笔</CardBadge>}>
        <DataTable<AmbushPullbackSettlementEntry> rows={settlements} rowKey={(row) => `${row.decision_date}:${row.code}`} empty="暂无尾盘潜伏结算记录" columns={[
          { label: '决策日', cell: (row) => <span className="num">{row.decision_date}</span> },
          { label: '结算日', cell: (row) => <span className="num text-sub">{row.trade_date}</span> },
          { label: '标的', cell: (row) => <span>{row.name}<span className="num text-sub ml-1">{row.code}</span></span> },
          { label: '买入价(当日)', num: true, cell: (row) => <span className="num">{n2(row.entry_price)}</span> },
          { label: '10:00卖出', num: true, cell: (row) => <span className="num">{n2(row.exit_price)}</span> },
          { label: '收益', num: true, cell: (row) => <ReturnText value={row.return_pct} /> },
          { label: '状态', cell: () => <Tag tone="rec">已结算</Tag> },
        ]} />
      </Card>

      <Card title="待结算信号" extra={<CardBadge tone={pending.length ? 'warn' : 'neutral'}>{pending.length}笔</CardBadge>}>
        <DataTable<AmbushPullbackSignalEntry> rows={pending} rowKey={(row) => `${row.decision_date}:${row.code}`} empty="暂无待结算信号" columns={[
          { label: '冻结日', cell: (row) => <span className="num">{row.decision_date}</span> },
          { label: '标的', cell: (row) => <span>{row.name}<span className="num text-sub ml-1">{row.code}</span></span> },
          { label: '时点', cell: () => <span className="num text-sub">当日买入 → 次日10:00</span> },
          { label: '距十日线', num: true, cell: (row) => row.candidate_snapshot.ma10_gap_pct == null ? '—' : `${n1(row.candidate_snapshot.ma10_gap_pct)}%` },
          { label: '量比', num: true, cell: (row) => row.candidate_snapshot.volume_ratio == null ? '—' : n2(row.candidate_snapshot.volume_ratio) },
          { label: '形态分', num: true, cell: (row) => row.candidate_snapshot.score == null ? '—' : n1(row.candidate_snapshot.score) },
          { label: '状态', cell: () => <Tag tone="warn">14:30已冻结</Tag> },
        ]} />
      </Card>
    </div>
  )
}

function ReturnText({ value }: { value: number }) {
  return <span className={cn(value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-txt')}>{pct(value)}</span>
}

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return <div className="flex flex-col"><span className="text-sub text-12">{label}</span><span className={cn('num text-15 font-semibold', cls ?? 'text-txt')}>{value}</span></div>
}

/** 路由入口（保持 URL 兼容）：AmbushView 的薄包装 */
export function Component() {
  return <AmbushView />
}
