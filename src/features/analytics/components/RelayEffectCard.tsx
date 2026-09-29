import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RelayStock } from '@/shared/api'
import { marketQueries } from '@/features/market'
import { Card, LineChart, StockLink } from '@/shared/ui'
import { cn } from '@/shared/lib'
import { DataTable, StatPair } from './Table'
import { relayExpired, selectRelay, type RelayView } from '../lib/relayEffect'

const fmt = (v: number | null, unit = '') => v == null ? '—' : `${v.toFixed(2)}${unit}`
const tone = (v: number | null) => v == null || v === 0 ? 'text-sub' : v > 0 ? 'text-up' : 'text-down'
const labels: Record<string, string> = { relay: '昨日连板', '2': '昨2板 → 3板', '3': '昨3板 → 4板', '4+': '昨4板及以上', '1': '昨首板 · 低位对照' }
const views: [RelayView, string][] = [['strong', '活跃走强'], ['sealed', '封板维持'], ['weak', '活跃走弱'], ['all', '全部股票']]
const state = (s: RelayStock) => s.stale ? '行情过期' : s.sealed === true ? '当前封板' : s.sealed === false ? '当前未封板' : '状态未知'
const button = 'rounded-sm border px-2 py-1 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-up'

export function RelayEffectCard() {
  const query = useQuery(marketQueries.relayEffect())
  const [group, setGroup] = useState('relay')
  const [view, setView] = useState<RelayView | 'default'>('default')
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer) }, [])
  const data = query.data
  const bjNow = new Date(now + 8 * 3600_000)
  const afterClose = data?.date === bjNow.toISOString().slice(0, 10) && bjNow.getUTCHours() >= 15
  const historical = data?.historical === true
  const activeView = view === 'default' ? historical ? 'all' : 'strong' : view
  const expired = data && !historical ? relayExpired(data.date, data.generated_ts, now) : false
  const stocks = data?.stocks.map(s => expired ? { ...s, stale: true } : s) ?? []
  const rows = selectRelay(stocks, group, activeView)
  const scope = selectRelay(stocks, group, 'all')
  const detail = scope.find(s => s.code === selected)
  const chooseGroup = (key: string) => { setGroup(key); setSelected(null) }
  return <Card className="min-w-0 w-full" title="连板量能与承接" extra={<span className="text-[11px] text-sub">{data ? `${historical ? '历史回放 · ' : ''}${data.prev_date} → ${data.date}` : '等待数据'}</span>}>
    {!data ? <p role="status" className="text-sub text-xs py-4">{query.isPending ? '正在读取连板观察数据…' : '连板观察快照尚未提供，等待数据层发布。'}</p> : <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <StatPair label="昨日连板" value={`${data.overview.count} 只`} />
        <StatPair label="涨幅中位数" value={fmt(data.overview.median_pct, '%')} />
        <StatPair label="上涨占比" value={fmt(data.overview.up_rate, '%')} />
        <StatPair label="当前封板率" value={fmt(data.overview.seal_rate, '%')} />
        <StatPair label={data.overview.amount_count < data.overview.count ? '已覆盖成交额' : '累计成交额'} value={fmt(data.overview.amount_yi, '亿')} />
        <StatPair label="行情覆盖" value={`${data.overview.quote_count}/${data.overview.count}`} />
      </div>
      <p role="status" className={cn('text-[11px]', expired || query.isError ? 'text-warn' : 'text-sub')}>
        {historical ? data.source_note : expired ? '快照已过期，保留最后读数并暂停承接排名。' : query.isError ? '更新失败，保留最后快照。' : '固定昨日样本，失败股仍保留。'}
        {' '}更新于 {data.generated_ts.replace('T', ' ').slice(0, 19)} · {data.phase === 'closed' ? '收盘快照' : afterClose ? '盘后最后快照' : '盘中快照'}。涨幅为相对昨收表现，成交额表示交易规模。
      </p>
      <DataTable dense rows={data.groups} rowKey={g => g.key} rowClass={g => g.key === group ? 'bg-up-soft/40' : undefined} columns={[
        { label: '昨日梯队', cell: g => <button type="button" className="text-txt underline decoration-line underline-offset-4" onClick={() => chooseGroup(g.key)}>{labels[g.key]}</button> },
        { label: '样本 / 行情', num: true, cell: g => `${g.count} / ${g.quote_count}` },
        { label: '均涨幅', num: true, cell: g => <span className={tone(g.avg_pct)}>{fmt(g.avg_pct, '%')}</span> },
        { label: '中位涨幅', num: true, cell: g => <span className={tone(g.median_pct)}>{fmt(g.median_pct, '%')}</span> },
        { label: '上涨占比', num: true, cell: g => fmt(g.up_rate, '%') },
        { label: '当前封板率', num: true, cell: g => <span title={`封板状态覆盖 ${g.state_count}/${g.count}`}>{fmt(g.seal_rate, '%')} ({g.state_count}/{g.count})</span> },
        { label: '累计成交额', num: true, cell: g => <span>{fmt(g.amount_yi, '亿')}{g.amount_count < g.count && <small className="block text-sub">已覆盖 {g.amount_count}/{g.count}</small>}</span> },
        { label: '近15分钟成交额', num: true, cell: g => <span>{fmt(g.window_amount_yi, '亿')}<small className="block text-sub">有效 {g.window_count}/{g.count}</small></span> },
        { label: '涨幅变化中位数', num: true, cell: g => <span className={tone(g.window_pct_change)}>{fmt(g.window_pct_change, '百分点')}</span> },
      ]} />
      <div className="flex flex-wrap gap-1.5">{Object.entries(labels).map(([key, text]) => <button type="button" key={key} aria-pressed={group === key} className={cn(button, group === key ? 'border-up/30 bg-up-soft text-up' : 'border-line text-sub')} onClick={() => chooseGroup(key)}>{text}</button>)}</div>
      <RelayScatter historical={historical} stocks={scope} selected={selected} onSelect={code => { setSelected(code); setView('all') }} />
      <div className="flex flex-wrap gap-1.5">{views.filter(([key]) => !historical || key === 'all' || key === 'sealed').map(([key, text]) => <button type="button" key={key} aria-pressed={activeView === key} className={cn(button, activeView === key ? 'bg-txt text-card border-txt' : 'border-line text-sub')} onClick={() => { setView(key); setSelected(null) }}>{text}</button>)}</div>
      <p className="text-[11px] text-sub">{historical ? '历史回放保留全部昨日样本；缺少成交额的股票仍列出，15分钟指标显示未归档。' : '按近15分钟成交额降序；同额按涨幅变化排序。窗口不足或行情失效不进入走强/走弱排名。'}</p>
      <DataTable dense rows={rows} rowKey={s => s.code} empty="当前没有符合条件的股票" rowClass={s => s.code === selected ? 'bg-up-soft/40' : undefined} columns={[
        { label: '股票', cell: s => <button type="button" onClick={() => setSelected(selected === s.code ? null : s.code)} aria-expanded={s.code === selected} className="text-txt text-left">{s.name}<small className="block text-sub">{s.code} · 昨{s.prev_boards}板</small></button> },
        { label: '今日涨幅', num: true, cell: s => <span className={tone(s.pct)}>{fmt(s.pct, '%')}</span> },
        { label: '累计成交额', num: true, cell: s => fmt(s.amount_yi, '亿') },
        { label: '近15分钟成交额', num: true, cell: s => s.window ? <span title={`${s.window.start} — ${s.window.end}`}>{fmt(s.window.amount_yi, '亿')}</span> : <span className="text-sub">{historical ? '未归档' : s.stale ? '—' : '积累中 / 无有效窗口'}</span> },
        { label: '涨幅变化', num: true, cell: s => <span className={tone(s.window?.pct_change ?? null)}>{fmt(s.window?.pct_change ?? null, '百分点')}</span> },
        { label: '状态', cell: s => <span className={s.sealed && !s.stale ? 'text-up' : 'text-sub'}>{state(s)}<small className="block">{s.at?.slice(11, 19) ?? '无行情'}</small></span> },
        { label: '封单', num: true, cell: s => fmt(s.seal_yi, '亿') },
        { label: '首封', num: true, cell: s => s.today_fbt?.replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3') ?? '—' },
      ]} />
      {detail && (historical ? <p className="text-xs text-sub">{detail.name}：历史快照时间 {detail.at?.replace('T', ' ').slice(0, 19) ?? '未提供'}。未归档逐分钟记录，无法还原日内曲线。</p> : <RelayDetail stock={detail} />)}
    </div>}
  </Card>
}

function RelayScatter({ historical, stocks, selected, onSelect }: { historical: boolean; stocks: RelayStock[]; selected: string | null; onSelect: (code: string) => void }) {
  const points = stocks.filter(s => !s.stale && (historical ? s.amount_yi != null && s.pct != null : s.window))
  const x = (s: RelayStock) => historical ? s.amount_yi! : s.window!.amount_yi
  const y = (s: RelayStock) => historical ? s.pct! : s.window!.pct_change
  const xmax = Math.max(0.01, ...points.map(x))
  const ymax = Math.max(1, ...points.map(s => Math.abs(y(s))))
  const amax = Math.max(0.01, ...points.map(s => s.amount_yi ?? 0))
  return <div className="rounded-sm border border-line-faint p-2">
    <p className="text-xs text-txt">量价分布 <span className="text-[10px] text-sub">{historical ? '历史截面 · 横轴：归档成交额 · 纵轴：归档涨幅' : '横轴：近15分钟成交额 · 纵轴：涨幅变化 · 点面积：累计成交额'}</span></p>
    {!points.length ? <p className="text-xs text-sub py-6 text-center">等待同一交易时段内的有效15分钟窗口</p> : <svg viewBox="0 0 800 230" className="w-full" aria-label="量价分布图">
      <line x1="64" x2="764" y1="105" y2="105" stroke="var(--color-line)" /><line x1="64" x2="64" y1="20" y2="190" stroke="var(--color-line)" />
      <text x="4" y="24" fontSize="10" fill="var(--color-sub)">+{ymax.toFixed(1)} {historical ? '%' : 'pp'}</text><text x="4" y="108" fontSize="10" fill="var(--color-sub)">0</text><text x="4" y="192" fontSize="10" fill="var(--color-sub)">−{ymax.toFixed(1)} {historical ? '%' : 'pp'}</text>
      <text x="64" y="216" fontSize="10" fill="var(--color-sub)">0亿</text><text x="710" y="216" fontSize="10" fill="var(--color-sub)">{xmax.toFixed(2)}亿</text>
      {points.map(s => <circle key={s.code} cx={78 + x(s) / xmax * 660} cy={105 - y(s) / ymax * 72} r={4 + Math.sqrt((s.amount_yi ?? 0) / amax) * 10} fill={s.sealed === true ? 'var(--color-up)' : s.sealed === false ? 'var(--color-sub)' : 'var(--color-line-strong)'} fillOpacity="0.65" stroke={selected === s.code ? 'var(--color-txt)' : 'var(--color-card)'} strokeWidth="2" role="button" tabIndex={0} aria-label={`查看${s.name}`} onClick={() => onSelect(s.code)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.code) } }}><title>{s.name} · {fmt(x(s), '亿')} · {fmt(y(s), historical ? '%' : '百分点')} · {state(s)}</title></circle>)}
    </svg>}
    <p className="text-[10px] text-sub">红：当前封板 · 灰：当前未封板 · 浅灰：状态未知。可点击圆点查看股票。</p>
  </div>
}

function RelayDetail({ stock }: { stock: RelayStock }) {
  const points = stock.series
  // 仅在同一交易时段计算相邻快照成交增量，午休和累计额回退处断开。
  const deltas = points.map((p, i) => {
    const prev = points[i - 1]
    return prev && prev.at.slice(0, 10) === p.at.slice(0, 10) && (prev.at.slice(11, 13) < '12') === (p.at.slice(11, 13) < '12') && p.amount_yi != null && prev.amount_yi != null && p.amount_yi >= prev.amount_yi ? p.amount_yi - prev.amount_yi : null
  })
  const changes = points.filter((p, i) => p.sealed != null && (i === 0 || p.sealed !== points[i - 1].sealed))
  return <div className="border-t border-line pt-3">
    <StockLink code={stock.code}>{stock.name}</StockLink><span className="ml-2 text-xs text-sub">当日观察记录 · {points.length} 个快照</span>
    <div className="grid gap-3 lg:grid-cols-2">
      <LineChart labels={points.map(p => p.at.slice(11, 16))} series={[{ name: '涨幅', values: points.map(p => p.pct), tone: 'up' }]} height={170} format={v => `${v.toFixed(1)}%`} />
      <LineChart labels={points.map(p => p.at.slice(11, 16))} series={[{ name: '相邻快照成交额增量', values: deltas, tone: 'sub' }]} height={170} format={v => `${v.toFixed(2)}亿`} />
    </div>
    <p className="text-[10px] text-sub">成交增量按相邻采样区间展示，不等同于固定每分钟成交额；空档不补数据。</p>
    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{changes.map(p => <span key={p.at} className="rounded-sm bg-line-faint px-2 py-1">{p.at.slice(11, 19)} {p.sealed ? '观察到封板' : '观察到未封板'}</span>)}</div>
  </div>
}
