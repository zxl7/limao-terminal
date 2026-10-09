import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { AccountNavEntry } from '@/shared/api'
import { analyticsQueries, DataTable, Tag, n1, n2, pct } from '@/features/analytics'
import { BarChart, Card, CardBadge, EmptyState, LineChart } from '@/shared/ui'
import { cn } from '@/shared/lib'

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.accountNav())
  return null
}

const CALIBER_LABEL: Record<string, { text: string; tone: 'up' | 'rec' | 'warn' }> = {
  ai: { text: 'AI口径', tone: 'up' },
  mechanical_fallback: { text: '机械回退', tone: 'warn' },
}

export function Component() {
  const nav = useQuery(analyticsQueries.accountNav())
  return <RelayPerformance rows={nav.data ?? []} loading={nav.isLoading} />
}

function RelayPerformance({ rows: sourceRows, loading }: { rows: AccountNavEntry[]; loading: boolean }) {
  const rows = useMemo(
    () => [...sourceRows].sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    [sourceRows],
  )
  const last = rows.at(-1)
  const winRate = useMemo(() => {
    const traded = rows.filter((row) => row.stock_count > 0)
    if (!traded.length) return null
    return (traded.filter((row) => row.avg_return_pct > 0).length / traded.length) * 100
  }, [rows])
  const firstAiIdx = rows.findIndex((row) => row.caliber === 'ai')
  const tradeChart = useMemo(() => {
    const result = rows.reduce(
      (total, day) => {
        const stocks = day.stocks?.length
          ? day.stocks.map((stock) => ({ label: `${day.trade_date.slice(5)} ${stock.name || stock.code}`, returnPct: stock.return_pct }))
          : Array.from({ length: day.stock_count }, (_, index) => ({
              label: `${day.trade_date.slice(5)} ${day.names[index] || day.codes[index] || `交易${index + 1}`}`,
              returnPct: undefined,
            }))
        return stocks.reduce(
          (dayTotal, stock) => {
            const hasStockReturn = Number.isFinite(stock.returnPct)
            const returnPct = hasStockReturn ? Number(stock.returnPct) : day.avg_return_pct
            return {
              nav: dayTotal.nav * (1 + returnPct / 100),
              fallbackCount: dayTotal.fallbackCount + (hasStockReturn ? 0 : 1),
              points: [...dayTotal.points, { label: stock.label, nav: dayTotal.nav * (1 + returnPct / 100) }],
            }
          },
          { nav: total.nav, fallbackCount: total.fallbackCount, points: total.points },
        )
      },
      { nav: 1, fallbackCount: 0, points: [] as Array<{ label: string; nav: number }> },
    )
    const tail = result.points.at(-1)?.nav
    return {
      labels: result.points.map((point) => point.label),
      navs: result.points.map((point) => point.nav),
      tone: tail == null ? ('sub' as const) : tail >= 1 ? ('up' as const) : ('down' as const),
      fallbackCount: result.fallbackCount,
    }
  }, [rows])

  return (
    <>
      <Card title="📈 净值闭环（接力脚本轨）" extra={<CardBadge tone={last && last.nav >= 1 ? 'up' : 'down'}>净值 {last ? n2(last.nav) : '—'}</CardBadge>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-2 mb-2 text-[12.5px]">
          <Metric label="累计收益" value={last ? pct((last.nav - 1) * 100) : '—'} cls={last && last.nav >= 1 ? 'text-up' : 'text-down'} />
          <Metric label="胜率（有成交日）" value={winRate == null ? '—' : `${winRate.toFixed(0)}%`} cls={winRate != null && winRate >= 50 ? 'text-up' : 'text-txt'} />
          <Metric label="结算日数" value={String(rows.length)} />
          <Metric label="最新结算日" value={last?.trade_date ?? '—'} />
          <Metric label="最新决策日" value={last?.recommendation_date ?? '—'} />
          <Metric label="最新成交" value={last ? `${last.stock_count}只` : '—'} cls={last && last.stock_count > 0 ? 'text-txt' : 'text-sub'} />
        </div>
        {firstAiIdx > 0 && <p className="text-warn text-[11.5px] leading-relaxed border-l-2 border-warn pl-2.5 mb-2">口径分界：自 <span className="num font-semibold">{rows[firstAiIdx].trade_date}</span> 起采用AI口径，此前为机械口径。</p>}
      </Card>

      <Card title="📈 全部交易走势" extra={<CardBadge tone={tradeChart.tone === 'up' ? 'up' : tradeChart.tone === 'down' ? 'down' : 'neutral'}>{tradeChart.navs.length}笔实际交易</CardBadge>}>
        {tradeChart.navs.length ? <><LineChart labels={tradeChart.labels} series={[{ name: '逐笔净值', values: tradeChart.navs, tone: tradeChart.tone, area: true }]} height={260} showLegend={false} format={(value) => value.toFixed(3)} yTickCount={5} refLines={[{ value: 1, label: '本金线 1.00', tone: 'sub' }]} />
          <p className="text-sub text-[11.5px] mt-1.5 leading-relaxed">每个点对应一笔实际成交。{tradeChart.fallbackCount > 0 && `其中${tradeChart.fallbackCount}笔旧记录缺逐票收益，按当日平均收益绘制。`}</p></> : <EmptyState text={loading ? '正在读取交易账本' : '交易账本为空'} />}
      </Card>

      <Card title="📊 逐日收益分布" extra={<CardBadge tone={winRate != null && winRate >= 50 ? 'up' : 'neutral'}>胜率 {winRate == null ? '—' : `${winRate.toFixed(0)}%`}</CardBadge>}>
        {rows.length ? <BarChart bars={rows.map((row) => ({ label: row.trade_date.slice(5), value: row.avg_return_pct, tone: row.stock_count === 0 ? ('sub' as const) : undefined }))} height={170} format={(value) => `${n1(value)}%`} maxBarWidth={26} /> : <EmptyState text="无逐日收益记录" />}
      </Card>

      <Card title="结算流水" extra={<CardBadge>{rows.length}日</CardBadge>}>
        <DataTable<AccountNavEntry> rows={[...rows].reverse()} rowKey={(row) => row.trade_date} empty="尚无结算记录" columns={[
          { label: '结算日', cell: (row) => <span className="num">{row.trade_date}</span> },
          { label: '决策日', cell: (row) => <span className="num text-sub">{row.recommendation_date}</span> },
          { label: '口径', cell: (row) => { const caliber = row.caliber ? CALIBER_LABEL[row.caliber] : null; return caliber ? <Tag tone={caliber.tone} title={row.note}>{caliber.text}</Tag> : <span className="text-sub text-[11.5px]">机械</span> } },
          { label: '成交', num: true, cell: (row) => <span className={row.stock_count === 0 ? 'text-sub' : 'text-txt'}>{row.stock_count}</span> },
          { label: '均收益', num: true, cell: (row) => <ReturnText value={row.avg_return_pct} /> },
          { label: '净值', num: true, cell: (row) => <span className={cn('num font-semibold', row.nav >= 1 ? 'text-up' : 'text-down')}>{n2(row.nav)}</span> },
          { label: '成交标的', className: 'whitespace-normal min-w-[240px]', cell: (row) => row.names?.length ? <span className="flex flex-wrap gap-1">{row.names.map((name) => <Tag key={`${name}-${row.trade_date}`}>{name}</Tag>)}</span> : <span className="text-sub">空仓</span> },
        ]} />
      </Card>
    </>
  )
}

function ReturnText({ value }: { value: number }) {
  return <span className={cn(value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-txt')}>{pct(value)}</span>
}

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return <div className="flex flex-col"><span className="text-sub text-[11.5px]">{label}</span><span className={cn('num text-[15px] font-semibold', cls ?? 'text-txt')}>{value}</span></div>
}
