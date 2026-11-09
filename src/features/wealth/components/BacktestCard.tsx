import type { BacktestLayer, BacktestRecord, BacktestSummary } from '@/shared/api'
import { Card, CardBadge, EmptyState, LineChart, KpiStrip } from '@/shared/ui'
import { DataTable, type Column } from '@/features/analytics'
import { cn } from '@/shared/lib'
import { num, signedPct } from '../lib/format'

/**
 * 回测战绩 —— **「这套打法在历史上到底赚不赚、赚得稳不稳」**。
 *
 * ## 三套口径并列，⛔ 不混账（2026-11-06 用户拍板）
 *
 * 同一批买入名单，只换卖出时点：
 *
 * | 口径 | 卖出 | 用途 |
 * |---|---|---|
 * | **策略口径** | 当日收盘 | 判据迭代的现行主口径（与每日台账同源） |
 * | **T+1 口径** | 次日收盘 | A 股真实可下单 —— 「真做能拿到多少」 |
 * | T+1 最保守 | 次日开盘 | 不吃次日日内波动 |
 *
 * 差额来自 **A 股 T+1 制度**（当天买的当天不能卖），⛔ 不是策略退化，
 * 也⛔ 禁止把三个数字相加或互相换算。所以本卡把它们并排放在**同一行**，
 * 而不是折成一个「综合收益」——折成一个数就必然要挑一个当真，那就回到了混账。
 *
 * ## 指标全部后端算好
 *
 * `sharpe` / `t` / `mdd` / `pl_ratio` 由 `scripts/build_backtest_summary.py` 在 Python 侧算，
 * 前端只显示。⛔ 不在这里重算 —— 前端重算就是第二套口径，迟早与账本对不上。
 */

/**
 * 净值前向填充：某口径当天没出仓，就沿用上一次净值（起点 1.0）。
 *
 * ⛔ 为什么不是 `null` 断线：三条口径出仓天数天生不同（T+1 少一天、某些日子空仓），
 *    断线会让「谁在什么时候拉开」这件事看不见；而回撤/复利本来就是按「持有到最后已知净值」算的。
 * ⛔ 也不能补 0 —— 0 是「归零」，会在图上造出不存在的暴跌。
 * 放在组件外：组件内改 `let` 会被 React Compiler 的 immutability 规则拦下。
 */
function forwardFill(
  dates: string[],
  pts: { date: string; nav: number }[],
): number[] {
  const map = new Map(pts.map((p) => [p.date, p.nav]))
  const out: number[] = []
  let last = 1
  for (const d of dates) {
    const v = map.get(d)
    if (v !== undefined) last = v
    out.push(last)
  }
  return out
}

/** 指标格：数值 + 一行说明。`null` 一律「—」，⛔ 不回退成 0。 */
function Metric({
  label, value, sub, tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'txt' | 'up' | 'down' | 'sub' | 'warn'
}) {
  const toneClass = {
    txt: 'text-txt', up: 'text-up', down: 'text-down', sub: 'text-sub', warn: 'text-warn',
  }[tone ?? 'txt']
  return (
    <div className="min-w-0">
      <div className="truncate text-11 leading-tight text-sub">{label}</div>
      <div className={cn('num mt-0.5 text-15 font-semibold leading-none', toneClass)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-11 text-sub">{sub}</div>}
    </div>
  )
}

/** 单口径面板：主指标 + 该口径的净值曲线 */
function CaliberPanel({ rec }: { rec: BacktestRecord }) {
  const m = rec.metrics
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-sm border px-2.5 py-2',
        rec.primary ? 'border-rec/50 bg-hover' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-13 font-semibold text-txt">{rec.label}</span>
        <span className="text-11 text-sub">{rec.sub}</span>
        {rec.primary && <span className="badge border-rec text-rec">现行</span>}
      </div>
      <KpiStrip min={86}>
        <Metric
          label="期末复利"
          value={signedPct(m.compound, 1)}
          sub={`日均 ${signedPct(m.day_avg)}`}
          tone={m.compound >= 0 ? 'up' : 'down'}
        />
        <Metric
          label="最大回撤"
          value={signedPct(m.mdd, 1)}
          sub={`${m.days} 天 · ${m.picks} 笔`}
          tone="down"
        />
        <Metric label="日胜率" value={`${num(m.day_win, 1)}%`} sub={`单笔 ${num(m.pick_win, 1)}%`} />
        <Metric
          label="t 值"
          value={m.t === null ? '—' : num(m.t, 2)}
          sub={m.t !== null && Math.abs(m.t) < 2 ? '不显著' : '显著'}
          tone={m.t !== null && Math.abs(m.t) < 2 ? 'warn' : 'txt'}
        />
        <Metric
          label="Sharpe"
          value={m.sharpe === null ? '—' : num(m.sharpe, 2)}
          sub="年化 252 日"
        />
        <Metric
          label="盈亏比"
          value={m.pl_ratio === null ? '—' : num(m.pl_ratio, 2)}
          sub={m.gain_avg === null ? '—' : `赚 ${num(m.gain_avg, 2)} / 亏 ${num(m.loss_avg, 2)}`}
        />
      </KpiStrip>
    </div>
  )
}

/** 逐层阶梯：每加一条判据，两个口径各自变成多少 —— 「到底是谁在贡献」只能从这里看 */
const LAYER_COLUMNS: Column<BacktestLayer>[] = [
  {
    label: '版本 / 本层改动',
    className: 'whitespace-normal min-w-[220px]',
    cell: (l) => (
      <span className="flex flex-col">
        <span className="text-12 text-txt">{l.label}</span>
        <span className="text-11 text-sub">{l.note}</span>
      </span>
    ),
  },
  {
    label: '策略 · 复利',
    num: true,
    cell: (l) => (
      <span className={cn('font-semibold', (l.close.compound ?? 0) >= 0 ? 'text-up' : 'text-down')}>
        {signedPct(l.close.compound, 1)}
      </span>
    ),
  },
  {
    label: '策略 · 日均',
    num: true,
    cell: (l) => <span className="text-sub">{signedPct(l.close.day_avg)}</span>,
  },
  {
    label: '策略 · 日胜',
    num: true,
    cell: (l) => <span className="text-sub">{num(l.close.day_win, 1)}%</span>,
  },
  {
    label: 'T+1 · 复利',
    num: true,
    cell: (l) => (
      <span className={cn('font-semibold', (l.t1.compound ?? 0) >= 0 ? 'text-up' : 'text-down')}>
        {signedPct(l.t1.compound, 1)}
      </span>
    ),
  },
  {
    label: 'T+1 · 回撤',
    num: true,
    cell: (l) => <span className="text-sub">{signedPct(l.t1.mdd, 1)}</span>,
  },
  {
    label: '本层增量',
    num: true,
    cell: (l) =>
      l.delta_close === null ? (
        <span className="text-sub">—</span>
      ) : (
        <span className={l.delta_close >= 0 ? 'text-up' : 'text-down'}>
          {signedPct(l.delta_close, 1)}
        </span>
      ),
  },
  { label: '天', num: true, cell: (l) => <span className="text-sub">{l.close.days ?? '—'}</span> },
  { label: '笔', num: true, cell: (l) => <span className="text-sub">{l.close.picks ?? '—'}</span> },
]

/** 真实台账逐日：池内全买（「照单全收」对照），⛔ 不是策略业绩 */
const LIVE_COLUMNS: Column<BacktestSummary['live']['rows'][number]>[] = [
  { label: '日期', cell: (r) => <span className="num text-11 text-sub">{r.date}</span> },
  { label: '池', num: true, cell: (r) => <span className="text-sub">{r.pool ?? '—'}</span> },
  { label: '可成交', num: true, cell: (r) => <span className="text-sub">{r.tradable ?? '—'}</span> },
  { label: '实际买', num: true, cell: (r) => <span className="text-sub">{r.participate}</span> },
  {
    label: '全买当日',
    num: true,
    cell: (r) => (
      <span className={cn('font-semibold', (r.avg ?? 0) >= 0 ? 'text-up' : 'text-down')}>
        {signedPct(r.avg)}
      </span>
    ),
  },
  {
    label: '全买 T+1',
    num: true,
    cell: (r) => <span className="text-sub">{signedPct(r.t1_avg)}</span>,
  },
  { label: '胜', num: true, cell: (r) => <span className="text-sub">{num(r.win, 0)}%</span> },
]

/** 一行事实标签：样本量 / 显著性 / 集中度 —— 只放读数，⛔ 不写「系统怎么做的」 */
function Facts({ d }: { d: BacktestSummary }) {
  const t1 = d.records.find((r) => r.id === 't1')?.metrics
  const items = [
    `样本 ${d.window.days} 个交易日`,
    `${d.window.start} ~ ${d.window.end}`,
    t1?.t !== null && t1?.t !== undefined ? `T+1 t=${num(t1.t, 2)}` : 'T+1 t=—',
    t1?.mdd !== null && t1?.mdd !== undefined ? `T+1 回撤 ${signedPct(t1.mdd, 1)}` : null,
  ].filter(Boolean) as string[]
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-11 text-sub">
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  )
}

export function BacktestCard({ data }: { data?: BacktestSummary }) {
  if (!data || !data.records?.length) {
    return (
      <Card title="回测战绩" extra={<CardBadge tone="warn">未生成</CardBadge>}>
        <EmptyState
          text="回测快照未生成"
          hint="由 scripts/build_backtest_summary.py 产出 cache/research/backtest_summary.json"
        />
      </Card>
    )
  }

  const primary = data.records.find((r) => r.primary) ?? data.records[0]
  // 净值曲线：三条并列画在同一张图上，横轴取并集（各口径出仓天数不同）
  const dates = Array.from(new Set(data.records.flatMap((r) => r.equity.map((e) => e.date)))).sort()
  const series = data.records.map((r) => {
    const values = forwardFill(dates, r.equity)
    return {
      name: `${r.label} ${signedPct(r.metrics.compound, 1)}`,
      values,
      tone: (r.primary ? 'up' : r.id === 't1' ? 'rec' : 'sub') as 'up' | 'rec' | 'sub',
      readable: true,
    }
  })

  return (
    <Card
      title="回测战绩"
      extra={
        <span className="flex items-center gap-2">
          <CardBadge>{data.version || '—'}</CardBadge>
          <CardBadge tone="neutral">{data.generated_at}</CardBadge>
        </span>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Facts d={data} />

        {/* ① 三口径并列：同一批名单，只换卖出时点 */}
        <div className="grid gap-2 lg:grid-cols-3">
          {data.records.map((r) => (
            <CaliberPanel key={r.id} rec={r} />
          ))}
        </div>

        {/* ② 净值曲线：三条叠在一张图上，谁在什么时候拉开一眼看得出 */}
        <div className="rounded-sm border border-line px-2 py-1.5">
          <LineChart
            series={series}
            labels={dates}
            height={196}
            format={(v) => `${((v - 1) * 100).toFixed(0)}%`}
            refLines={[{ value: 1, label: '本金', dashed: true }]}
          />
        </div>

        {/* ③ 逐层阶梯：改动的边际贡献摊开，⛔ 不看这一张就无法判断「是谁在赚」 */}
        <DataTable<BacktestLayer>
          rows={data.layers}
          rowKey={(l) => l.key}
          dense
          columns={LAYER_COLUMNS}
          rowClass={(l) =>
            l.key === data.layers[data.layers.length - 1]?.key ? 'bg-hover' : undefined
          }
        />

        {/* ④ 真实台账：池内全买逐日（照单全收对照） */}
        {data.live?.rows?.length ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-11 text-sub">
              <span className="text-12 text-txt">真实台账 · 池内全买</span>
              <span>
                <b className="num text-txt">{data.live.days}</b> 天
              </span>
              <span>
                日均{' '}
                <b
                  className={cn(
                    'num',
                    (data.live.day_avg ?? 0) >= 0 ? 'text-up' : 'text-down',
                  )}
                >
                  {signedPct(data.live.day_avg)}
                </b>
              </span>
              <span>
                日胜 <b className="num text-txt">{num(data.live.day_win, 1)}%</b>
              </span>
              <span>
                算术累计 <b className="num text-txt">{signedPct(data.live.cum)}</b>
              </span>
              <span>
                实际成交 <b className="num text-txt">{data.live.traded ?? 0}</b> 笔
              </span>
            </div>
            <DataTable
              rows={[...data.live.rows].reverse()}
              rowKey={(r) => r.date}
              dense
              columns={LIVE_COLUMNS}
            />
          </div>
        ) : null}

        {/* ⑤ 口径提示：只放读数，不解释系统 */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-11 text-sub">
          <span>现行主口径：{primary.sub}</span>
          <span className="text-line">|</span>
          <span>T+1 回撤普遍大于当日口径，差额来自 T+1 制度</span>
        </div>
      </div>
    </Card>
  )
}
