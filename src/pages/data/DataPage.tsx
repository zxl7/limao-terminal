import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { ExitPeakSector, ExitPeakStock, ThemeSnapshotItem, Top5HistoryTheme } from '@/shared/api'
import { analyticsQueries, DataTable, n1, n2, pct } from '@/features/analytics'
import { Card, CardBadge, EmptyState, LineChart, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, rsiWilder } from '@/shared/lib'

export async function loader() {
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.dataExitPeaks()),
    queryClient.ensureQueryData(analyticsQueries.dataThemeSnapshot()),
    queryClient.ensureQueryData(analyticsQueries.dataTop5History()),
  ])
  return null
}

type StockPeakRow = ExitPeakStock & { code: string }
type SectorPeakRow = ExitPeakSector & { name: string }
type FrozenThemeRow = ThemeSnapshotItem & { code: string }
type Top5Row = Top5HistoryTheme & { key: string }

export function Component() {
  const peaks = useQuery(analyticsQueries.dataExitPeaks())
  const snapshots = useQuery(analyticsQueries.dataThemeSnapshot())
  const top5History = useQuery(analyticsQueries.dataTop5History())
  const [codeInput, setCodeInput] = useState('')
  const code = codeInput.trim()
  const validCode = /^\d{6}$/.test(code)

  const registry = useQuery({ ...analyticsQueries.stockRegistry(code), enabled: validCode })
  const daily = useQuery({ ...analyticsQueries.marketDaily(code, 20), enabled: validCode })

  const stockRows = useMemo<StockPeakRow[]>(() => {
    const stocks = peaks.data?.stocks ?? {}
    return Object.entries(stocks)
      .map(([stockCode, item]) => ({ code: stockCode, ...item }))
      .sort((a, b) => (b.seal_yi_peak ?? -1) - (a.seal_yi_peak ?? -1) || a.code.localeCompare(b.code))
  }, [peaks.data])

  const sectorRows = useMemo<SectorPeakRow[]>(() => {
    const sectors = peaks.data?.sectors ?? {}
    return Object.entries(sectors)
      .map(([name, item]) => ({ name, ...item }))
      .sort((a, b) => (b.zt_count_peak ?? -1) - (a.zt_count_peak ?? -1) || a.name.localeCompare(b.name))
  }, [peaks.data])

  const latestSnapshot = useMemo(
    () =>
      [...(snapshots.data ?? [])]
        .filter((row) => row.data)
        .sort((a, b) => (b.data?.date ?? '').localeCompare(a.data?.date ?? ''))[0]?.data ?? null,
    [snapshots.data],
  )

  const frozenThemeRows = useMemo<FrozenThemeRow[]>(() => {
    const mapping = latestSnapshot?.mapping ?? {}
    return Object.entries(mapping)
      .map(([stockCode, item]) => ({ code: stockCode, ...item }))
      .sort((a, b) => (a.theme ?? '其他').localeCompare(b.theme ?? '其他') || a.code.localeCompare(b.code))
  }, [latestSnapshot])

  const latestTop5 = useMemo(
    () =>
      (top5History.data ?? [])
        .filter((row) => row.data)
        .sort((a, b) => (b.data?.date ?? '').localeCompare(a.data?.date ?? ''))[0]?.data ?? null,
    [top5History.data],
  )

  const top5Rows = useMemo<Top5Row[]>(
    () =>
      (latestTop5?.themes ?? []).map((theme) => ({
        ...theme,
        key: `${theme.name}-${theme.leader_code ?? ''}`,
      })),
    [latestTop5],
  )

  const stock = registry.data?.stock ?? null
  const bars = daily.data?.bars ?? []
  // 接口按最新在前返回；指标计算必须按交易日正序，避免 RSI 方向倒置。
  const chartBars = [...bars].reverse()
  const closeValues = chartBars.map((bar) => bar.close)
  const evidence = daily.data?.rsi_evidence
  const serverRsi = evidence?.schema === 'rsi_evidence_v1' && evidence.code === code
    && evidence.dates.join(',') === chartBars.map((bar) => bar.trade_date).join(',')
    ? evidence : undefined
  const rsi6 = serverRsi?.readings['6']?.series ?? rsiWilder(closeValues, 6)
  const rsi12 = serverRsi?.readings['12']?.series ?? rsiWilder(closeValues, 12)
  const rsi24 = serverRsi?.readings['24']?.series ?? rsiWilder(closeValues, 24)
  const rsiLabels = chartBars.map((bar) => bar.trade_date)

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🗃️ 数据底座"
        extra={<CardBadge tone="neutral">只读核验 · 不构成交易指令</CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <Fact label="封单观察" value={peaks.data ? `${stockRows.length} 只` : '—'} />
          <Fact label="题材峰值" value={peaks.data ? `${sectorRows.length} 条` : '—'} />
          <Fact label="冻结映射" value={latestSnapshot ? `${frozenThemeRows.length} 只` : '—'} />
          <Fact label="Top5归档" value={latestTop5 ? `${top5Rows.length} 条` : '—'} />
          <Fact label="峰值日期" value={peaks.data?.date ?? '—'} />
          <Fact label="更新时间" value={clockText(peaks.data?.updated_at)} />
          <Fact label="封单“—”" value="未封 / 无可用值" />
        </div>
      </Card>

      <ZoneRow>
        <Zone label="封单变化证据" dot="bg-up" className="xl:w-[63%]">
          <Card
            title="昨日涨停池 · 封单观察"
            extra={<CardBadge>{peaks.data?.date ?? '—'}</CardBadge>}
          >
            {peaks.isLoading ? (
              <EmptyState text="加载封单观察…" />
            ) : peaks.isError && !peaks.data ? (
              <EmptyState text="封单观察读取失败" />
            ) : stockRows.length === 0 ? (
              <EmptyState text="暂无封单观察" />
            ) : (
              <DataTable
                rows={stockRows}
                rowKey={(row) => row.code}
                dense
                heightClass="max-h-[420px]"
                virtual
                columns={[
                  {
                    label: '个股',
                    cell: (row) => (
                      <span className="text-txt">
                        <StockLink code={row.code}>{row.name}</StockLink>
                        <span className="num text-sub ml-1">{row.code}</span>
                      </span>
                    ),
                  },
                  {
                    label: '当前状态',
                    cell: (row) => (
                      <span className={row.current_sealed ? 'text-up font-semibold' : 'text-sub'}>
                        {row.current_sealed ? '封板' : '未封'}
                      </span>
                    ),
                  },
                  {
                    label: '当前封单(亿)',
                    num: true,
                    cell: (row) => <span className="num">{n1(row.current_seal_yi)}</span>,
                  },
                  {
                    label: '盘中峰值(亿)',
                    num: true,
                    cell: (row) => <span className="num text-txt">{n1(row.seal_yi_peak)}</span>,
                  },
                  {
                    label: '峰值时刻',
                    num: true,
                    cell: (row) => <span className="num text-sub">{clockText(row.seal_yi_peak_at)}</span>,
                  },
                  {
                    label: '报价时刻',
                    num: true,
                    cell: (row) => <span className="num text-sub">{clockText(row.quote_at)}</span>,
                  },
                ]}
              />
            )}
          </Card>
        </Zone>

        <Zone label="题材峰值" dot="bg-rec" className="xl:w-[37%]">
          <Card title="Top5题材 · 涨停观察" extra={<CardBadge>{sectorRows.length} 条</CardBadge>}>
            {peaks.isLoading ? (
              <EmptyState text="加载题材峰值…" />
            ) : peaks.isError && !peaks.data ? (
              <EmptyState text="题材峰值读取失败" />
            ) : sectorRows.length === 0 ? (
              <EmptyState text="暂无题材峰值" />
            ) : (
              <DataTable
                rows={sectorRows}
                rowKey={(row) => row.name}
                dense
                columns={[
                  { label: '题材', cell: (row) => <span className="text-txt">{row.name}</span> },
                  {
                    label: '当前',
                    num: true,
                    cell: (row) => <span className="num">{n1(row.current_zt_count)}</span>,
                  },
                  {
                    label: '峰值',
                    num: true,
                    cell: (row) => <span className="num text-txt">{n1(row.zt_count_peak)}</span>,
                  },
                  {
                    label: '时刻',
                    num: true,
                    cell: (row) => <span className="num text-sub">{clockText(row.zt_count_peak_at)}</span>,
                  },
                ]}
              />
            )}
          </Card>
        </Zone>
      </ZoneRow>

      <ZoneRow>
        <Zone label="题材冻结" dot="bg-rec" className="xl:w-[50%]">
          <Card
            title="题材映射快照"
            extra={<CardBadge>{latestSnapshot?.date ?? '—'}</CardBadge>}
          >
            {snapshots.isLoading ? (
              <EmptyState text="加载题材快照…" />
            ) : snapshots.isError && !snapshots.data ? (
              <EmptyState text="题材快照读取失败" />
            ) : frozenThemeRows.length === 0 ? (
              <EmptyState text="暂无题材映射快照" />
            ) : (
              <DataTable
                rows={frozenThemeRows}
                rowKey={(row) => row.code}
                dense
                heightClass="max-h-[360px]"
                virtual
                columns={[
                  {
                    label: '个股',
                    cell: (row) => (
                      <span className="text-txt">
                        <StockLink code={row.code}>{row.name ?? row.code}</StockLink>
                        <span className="num text-sub ml-1">{row.code}</span>
                      </span>
                    ),
                  },
                  { label: '主题', cell: (row) => <span className="text-rec">{row.theme ?? '—'}</span> },
                  { label: '逻辑', cell: (row) => <span className="text-sub">{row.logic || '—'}</span> },
                ]}
              />
            )}
          </Card>
        </Zone>

        <Zone label="Top5原始档" dot="bg-lead" className="xl:w-[50%]">
          <Card title="每日Top5题材" extra={<CardBadge>{latestTop5?.date ?? '—'}</CardBadge>}>
            {top5History.isLoading ? (
              <EmptyState text="加载Top5原始档…" />
            ) : top5History.isError && !top5History.data ? (
              <EmptyState text="Top5原始档读取失败" />
            ) : top5Rows.length === 0 ? (
              <EmptyState text="暂无Top5原始档" />
            ) : (
              <DataTable
                rows={top5Rows}
                rowKey={(row) => row.key}
                dense
                columns={[
                  { label: '题材', cell: (row) => <span className="text-txt">{row.name}</span> },
                  {
                    label: '涨停数',
                    num: true,
                    cell: (row) => <span className="num text-up">{n1(row.zt_count)}</span>,
                  },
                  {
                    label: '龙头',
                    cell: (row) => (
                      <StockLink code={row.leader_code} className="text-txt">
                        {row.leader ?? '—'}
                      </StockLink>
                    ),
                  },
                  {
                    label: '代码',
                    cell: (row) => <span className="num text-sub">{row.leader_code ?? '—'}</span>,
                  },
                ]}
              />
            )}
          </Card>
        </Zone>
      </ZoneRow>

      <Card title="单票事实查询" extra={<CardBadge>{validCode ? code : '输入6位代码'}</CardBadge>}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={codeInput}
            onChange={(event) => setCodeInput(event.target.value.replace(/\s/g, ''))}
            inputMode="numeric"
            maxLength={6}
            placeholder="输入股票代码，例如 002724"
            className={cn(
              'w-[260px] max-w-full px-2.5 py-1.5 text-13 rounded-sm',
              'bg-transparent border border-line text-txt placeholder:text-sub',
              'focus:outline-none focus:border-line-strong',
            )}
          />
          {code && !validCode && <span className="text-12 text-warn">请输入6位数字代码</span>}
          {validCode && <span className="text-12 text-sub">查询近20个交易日原始日K与系统事实档</span>}
        </div>
      </Card>

      <ZoneRow>
        <Zone label="个股事实" dot="bg-lead" className="xl:w-[44%]">
          <Card title="系统事实档" extra={<CardBadge>{validCode ? code : '—'}</CardBadge>}>
            {!validCode ? (
              <EmptyState text="输入6位代码查看事实档" />
            ) : registry.isLoading ? (
              <EmptyState text="查询系统事实档…" />
            ) : registry.isError ? (
              <EmptyState text="系统事实档查询失败" />
            ) : !registry.data?.found || !stock ? (
              <EmptyState text="系统事实库未命中" hint="未命中不等于市场中不存在该股票" />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
                  <Fact label="名称" value={stock.name ?? '—'} />
                  <Fact label="行业" value={stock.industry ?? '—'} />
                  <Fact label="最新价" value={n2(stock.price)} />
                  <Fact label="涨幅" value={pct(stock.pct)} tone={stock.pct == null || stock.pct === 0 ? undefined : stock.pct > 0 ? 'text-up' : 'text-down'} />
                  <Fact label="板数" value={n1(stock.boards)} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(stock.themes ?? []).map((theme) => (
                    <span key={theme} className="badge border border-rec text-rec">{theme}</span>
                  ))}
                  {(stock.themes ?? []).length === 0 && <span className="text-sub text-12">题材 —</span>}
                </div>
                <DataTable
                  rows={technicalRows(stock.technical)}
                  rowKey={(row) => row.key}
                  dense
                  columns={[
                    { label: '技术事实', cell: (row) => <span className="text-sub">{row.label}</span> },
                    { label: '数值', num: true, cell: (row) => <span className="num text-txt">{row.value}</span> },
                  ]}
                />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-12 text-sub">
                  <span>首次观察 {stock.first_seen_date ?? '—'}</span>
                  <span>最近观察 {stock.last_seen_ts ?? '—'}</span>
                  <span>日线日期 {stock.daily_asof_date ?? '—'}</span>
                </div>
              </div>
            )}
          </Card>
        </Zone>

        <Zone label="近月日K" dot="bg-up" className="xl:w-[56%]">
          <Card title="原始未复权 OHLCV" extra={<CardBadge>{validCode ? `${bars.length} / 20 日` : '—'}</CardBadge>}>
            {!validCode ? (
              <EmptyState text="输入6位代码查看近月日K" />
            ) : daily.isLoading ? (
              <EmptyState text="查询近月日K…" />
            ) : daily.isError ? (
              <EmptyState text="近月日K查询失败" />
            ) : bars.length === 0 ? (
              <EmptyState text="近月日K未入库" hint="该查询只读取本地近20个交易日的原始OHLCV" />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="border border-line rounded-sm p-2">
                  <div className="text-sub text-12">
                    {serverRsi ? `统一研究证据 · 截至${serverRsi.asof} · ${serverRsi.sample_count}根 · Wilder · 未复权` : '本地计算预览 · 后端研究证据未提供'}
                  </div>
                  <LineChart
                    labels={rsiLabels}
                    series={[
                      { name: 'RSI6', values: rsi6, tone: 'up' },
                      { name: 'RSI12', values: rsi12, tone: 'mid' },
                      { name: 'RSI24', values: rsi24, tone: 'lead' },
                    ]}
                    height={210}
                    yMin={0}
                    yMax={100}
                    format={(value) => value.toFixed(1)}
                    refLines={[
                      { value: 70, label: '70', tone: 'down', dashed: true },
                      { value: 30, label: '30', tone: 'down', dashed: true },
                    ]}
                  />
                </div>
                <DataTable
                  rows={bars}
                  rowKey={(row) => `${row.code}-${row.trade_date}`}
                  dense
                  columns={[
                    { label: '交易日', cell: (row) => <span className="num text-sub">{row.trade_date}</span> },
                    { label: '开', num: true, cell: (row) => <span className="num">{n2(row.open)}</span> },
                    { label: '高', num: true, cell: (row) => <span className="num text-up">{n2(row.high)}</span> },
                    { label: '低', num: true, cell: (row) => <span className="num text-down">{n2(row.low)}</span> },
                    { label: '收', num: true, cell: (row) => <span className="num text-txt">{n2(row.close)}</span> },
                    { label: '成交量(万股)', num: true, cell: (row) => <span className="num text-sub">{scaled(row.volume, 10_000)}</span> },
                    { label: '成交额(亿)', num: true, cell: (row) => <span className="num text-sub">{scaled(row.amount, 100_000_000)}</span> },
                  ]}
                />
              </div>
            )}
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-sub text-12">{label}</span>
      <b className={cn('text-13 font-semibold', tone ?? 'text-txt')}>{value}</b>
    </span>
  )
}

function clockText(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

function scaled(value: number | null | undefined, divisor: number): string {
  if (value == null || Number.isNaN(value)) return '—'
  return n1(value / divisor)
}

function technicalRows(technical: {
  close: number | null
  high: number | null
  low: number | null
  ma5: number | null
  ma10: number | null
  ma20: number | null
  volume_ratio_5: number | null
} | null) {
  if (!technical) return []
  return [
    { key: 'close', label: '收盘价', value: n2(technical.close) },
    { key: 'high', label: '日内高点', value: n2(technical.high) },
    { key: 'low', label: '日内低点', value: n2(technical.low) },
    { key: 'ma5', label: 'MA5', value: n2(technical.ma5) },
    { key: 'ma10', label: 'MA10', value: n2(technical.ma10) },
    { key: 'ma20', label: 'MA20', value: n2(technical.ma20) },
    { key: 'volume-ratio-5', label: '量比(5日)', value: n1(technical.volume_ratio_5) },
  ]
}
