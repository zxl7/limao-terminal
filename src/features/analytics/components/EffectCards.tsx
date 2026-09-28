import { cn } from '@/shared/lib'
import { LineChart, type LineSeries } from '@/shared/ui'
import type {
  EffectAxes,
  EffectAxis,
  EffectHistoryPoint,
  EffectScenario,
  NextDayProjection,
  Tier,
} from '../lib/effect'
import { STAGE_MIN_SAMPLE } from '../lib/effect'
import { DataTable, StatPair, Tag } from './Table'

/**
 * 赚钱效应 / 亏钱效应 的四张展示件（2026-09-23 立项）。
 *
 * 权威设计：`狸猫猎手/config/design_赚钱效应亏钱效应_EffectEngine.md`。
 * 计算全部在 `lib/effect.ts`（纯函数、可单测）；本文件**只做渲染**，⛔ 不含业务阈值。
 *
 * ⛔ **语义配色铁律（A 股）**：赚钱 / 上行 = **红**；亏钱 / 下行 = **绿**。
 *    亏钱轴 tier 高（亏钱效应强）= 绿（危险），tier 低 = 红（安全）。
 */

const TONE_TEXT = { up: 'text-up', down: 'text-down', rec: 'text-rec', sub: 'text-sub' } as const
const TONE_BG = { up: 'bg-up', down: 'bg-down', rec: 'bg-rec', sub: 'bg-sub' } as const

/**
 * 轴定性 → 语义色。
 * ⚠️ 两轴**方向相反**：赚钱轴「强」= 红（好），亏钱轴「强」= 绿（危险）。
 */
function axisTone(axis: 'gain' | 'loss', tier: Tier): keyof typeof TONE_TEXT {
  const hi = tier === 't5' || tier === 't4'
  const lo = tier === 't2' || tier === 't1'
  if (axis === 'gain') return hi ? 'up' : lo ? 'down' : 'sub'
  return hi ? 'down' : lo ? 'up' : 'sub'
}

const fmtPct = (v: number | null, digits = 1): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`

/** 轴位刻度条：把 `level ∈ [-2, +2]` 画成一条带游标的横条（⛔ 不显示「分」，避免伪精确） */
function AxisMeter({ level, axis, tier }: { level: number | null; axis: 'gain' | 'loss'; tier: Tier }) {
  const tone = axisTone(axis, tier)
  // 赚钱侧看强弱，亏钱侧看压力高低；同一端点不能都写「强」，会把风险读反。
  const edge = axis === 'gain' ? ['弱', '强'] : ['低', '高']
  /** `[-2,2]` → `[0,100]%` 的横向位置 */
  const pos = level == null ? 50 : ((Math.max(-2, Math.min(2, level)) + 2) / 4) * 100
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] text-sub flex-none">{edge[0]}</span>
      <div className="relative h-1.5 flex-1 min-w-[80px] rounded-full bg-line-faint">
        {/* 中位（0 轴）刻度 */}
        <span className="absolute top-[-2px] h-[10px] w-px bg-line" style={{ left: '50%' }} />
        <span
          className={cn('absolute top-[-3px] h-3 w-1 rounded-full', TONE_BG[tone])}
          style={{ left: `calc(${pos}% - 2px)` }}
        />
      </div>
      <span className="text-[10px] text-sub flex-none">{edge[1]}</span>
    </div>
  )
}

/** 亏钱轴的相同档位改用“压力”语义，避免“亏钱效应强”造成歧义。 */
function axisWord(kind: 'gain' | 'loss', word: string): string {
  if (kind === 'gain') return word
  return ({ 强: '高', 偏强: '偏高', 中性: '中等', 偏弱: '偏低', 弱: '低' } as Record<string, string>)[word] ?? '—'
}

/** 单轴（赚钱 / 亏钱）：大定性词 + 轴位条 + 原始读数表 */
function AxisBlock({
  axis,
  kind,
  title,
  hint,
}: {
  axis: EffectAxis
  /** 轴种别（决定配色方向）—— ⛔ 不从标题文字猜 */
  kind: 'gain' | 'loss'
  title: string
  hint: string
}) {
  const tone = axisTone(kind, axis.tier)
  return (
    <div className="min-w-0 flex flex-col gap-1.5" data-effect-axis={kind}>
      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
        <span className="text-[12.5px] font-semibold text-txt flex-none">{title}</span>
        <span className={cn('text-[20px] font-semibold leading-none flex-none', TONE_TEXT[tone])}>
          {axisWord(kind, axis.word)}
        </span>
        <span className="text-sub text-[10.5px] min-w-0 break-all">{hint}</span>
      </div>
      <AxisMeter level={axis.level} axis={kind} tier={axis.tier} />
      <DataTable
        rows={axis.readings}
        rowKey={(r) => r.key}
        dense
        empty="无可用读数"
        columns={[
          {
            label: '指标',
            cell: (r) => (
              <span className="text-txt" title={r.hint}>
                {r.label}
              </span>
            ),
          },
          {
            label: '当前读数',
            num: true,
            cell: (r) => (
              <span
                className={cn(
                  'num font-semibold',
                  r.raw == null ? 'text-sub' : TONE_TEXT[tone],
                )}
              >
                {r.value}
              </span>
            ),
          },
        ]}
      />
      {axis.missing > 0 && (
        <div className="text-[10.5px] text-warn">{axis.missing} 项读数缺料（已显示「—」，未计入轴位）</div>
      )}
    </div>
  )
}

/** ── 卡 1：当日双轴（页面主视觉）── */
export function EffectAxesCard({ axes }: { axes: EffectAxes }) {
  const b = axes.basis
  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11.5px] text-sub">
        <span>
          昨涨停池 <span className="num text-txt font-semibold">{b.prevZtCount ?? '—'}</span> 只
          <span className="num ml-1">({b.prevDate || '—'})</span>
        </span>
        <span>
          → 今日涨停 <span className="num text-txt font-semibold">{b.nowZtCount ?? '—'}</span> 只
        </span>
        <span>
          晋级 <span className="num text-txt font-semibold">{b.promoteCount ?? '—'}</span> 只
        </span>
        <span className="text-[10.5px]">两轴共用同一池子，按今日涨跌分组</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <AxisBlock
          axis={axes.gain}
          kind="gain"
          title="赚钱回报"
          hint="昨天涨停票今天能否给出上行回报"
        />
        <AxisBlock
          axis={axes.loss}
          kind="loss"
          title="亏钱压力"
          hint="昨天涨停票今天的核按钮、破位与炸板风险"
        />
      </div>

      {axes.caveats.length > 0 && (
        <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-warn-soft px-2 py-1 text-[11px] text-warn">
          {axes.caveats.join(' · ')}
        </div>
      )}
    </div>
  )
}

/** ── 卡 2：T-3..T 历史窗口（纯聚合，零推断）── */
export function EffectTrendCard({ points }: { points: EffectHistoryPoint[] }) {
  if (points.length === 0) {
    return <div className="text-sub text-[12px] py-2">历史窗口不可用（trend.history 缺失）</div>
  }
  /** ⛔ 资金/情绪两轴同图但**量纲不同**：轴位是 -2..+2，情绪分是 1..10 → 情绪分改走副轴 */
  const series: LineSeries[] = [
    { name: '赚钱轴位', values: points.map((p) => p.gainLevel), tone: 'up' },
    { name: '亏钱轴位', values: points.map((p) => p.lossLevel), tone: 'down' },
    {
      name: '情绪分(1-10)',
      values: points.map((p) => p.sentiment),
      tone: 'rec',
      dashed: true,
      axis: 'right',
      format: (v) => v.toFixed(1),
    },
  ]
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <LineChart
        series={series}
        labels={points.map((p) => p.date.slice(5))}
        height={190}
        yMin={-2}
        yMax={2}
        refLines={[{ value: 0, label: '中性', dashed: true }]}
        format={(v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
      />
      <DataTable
        rows={points}
        rowKey={(p) => p.date}
        dense
        empty="无历史窗口"
        columns={[
          { label: '日期', num: true, cell: (p) => <span className="text-sub">{p.date.slice(5)}</span> },
          { label: '晋级率', num: true, cell: (p) => <span className="num">{p.pr == null ? '—' : `${p.pr.toFixed(1)}%`}</span> },
          { label: '昨涨停今均涨', num: true, cell: (p) => <span className="num">{fmtPct(p.ap)}</span> },
          { label: '核按钮', num: true, cell: (p) => <span className="num">{p.nuke ?? '—'}</span> },
          { label: '情绪分', num: true, cell: (p) => <span className="num">{p.sentiment ?? '—'}</span> },
          { label: '涨停', num: true, cell: (p) => <span className="num">{p.ztCount ?? '—'}</span> },
        ]}
      />
      <p className="text-[10.5px] text-sub leading-relaxed">
        轴位 = 该日「晋级率 / 反转率」同一套阶梯的均值；缺口显示「—」（⛔ 不以 0 代替）。
      </p>
    </div>
  )
}

/** ── 卡 3：T+1 条件期望 ── */
export function NextDayProjectionCard({ projection: p }: { projection: NextDayProjection }) {
  const decisiveStages = p.stages.filter((s) => s.decisive)
  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <StatPair
          label="期望晋级"
          value={p.expPromoteCount == null ? '—' : `${p.expPromoteCount} 只`}
          tone="up"
          title={`今日池 ${p.poolTotal} 只，按各阶段历史成功率加权`}
        />
        <StatPair
          label="赚钱侧开盘"
          value={fmtPct(p.gainPremMed)}
          tone="up"
          title="晋级成功组的开盘溢价中位数（按 家数×成功率 加权）"
        />
        <StatPair
          label="亏钱侧开盘"
          value={fmtPct(p.lossFailMed)}
          tone="down"
          title="晋级失败组的开盘溢价中位数（按 家数×失败率 加权）"
        />
        <StatPair label="今日池" value={`${p.poolTotal} 只`} />
      </div>

      <DataTable
        rows={p.stages}
        rowKey={(s) => s.stage}
        dense
        empty="板数分布不可用"
        rowClass={(s) => (s.decisive ? undefined : 'opacity-60')}
        columns={[
          { label: '阶段', cell: (s) => <span className="text-txt">{s.stage}</span> },
          { label: '今日家数', num: true, cell: (s) => <span className="num">{s.count}</span> },
          {
            label: '历史样本',
            num: true,
            cell: (s) => (
              <span className={cn('num', s.decisive ? 'text-sub' : 'text-warn')} title={s.decisive ? undefined : `样本 <${STAGE_MIN_SAMPLE}，只呈现不裁决`}>
                {s.n || '—'}
              </span>
            ),
          },
          { label: '成功率', num: true, cell: (s) => <span className="num">{s.succRate == null ? '—' : `${(s.succRate * 100).toFixed(1)}%`}</span> },
          { label: '期望晋级', num: true, cell: (s) => <span className="num font-semibold text-up">{s.expPromote == null ? '—' : s.expPromote.toFixed(1)}</span> },
          { label: '成功组中位', num: true, cell: (s) => <span className="num">{fmtPct(s.premOpenMed)}</span> },
          { label: '失败组中位', num: true, cell: (s) => <span className="num">{fmtPct(s.failOpenMed)}</span> },
        ]}
      />

      {p.uncovered.length > 0 && (
        <div className="text-[10.5px] text-warn">历史无样本的阶段（未计入期望）：{p.uncovered.join(' · ')}</div>
      )}
      <div className="flex flex-col gap-0.5">
        {p.caveats.map((c) => (
          <div key={c} className="text-[10.5px] text-warn">
            {c}
          </div>
        ))}
        <div className="text-[10.5px] text-sub leading-relaxed">
          基于全历史阶段统计（{decisiveStages.length} 个阶段样本 ≥{STAGE_MIN_SAMPLE}）的**条件期望**，非预测；
          展示中位数（均值受尾部极值影响）。
        </div>
      </div>
    </div>
  )
}

/** ── 卡 4：T+2~T+4 三情景（纵向排列）── */export function EffectScenarioCard({ scenarios }: { scenarios: EffectScenario[] }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {scenarios.map((s) => (
        <div
          key={s.key}
          className={cn(
            'rounded-[var(--radius-sm)] border px-2.5 py-2 min-w-0 flex flex-col gap-1',
            s.live ? 'border-line-strong bg-line-faint' : 'border-line',
          )}
        >
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={cn('text-[12.5px] font-semibold flex-none', TONE_TEXT[s.tone])}>{s.label}</span>
            {s.live ? (
              <Tag tone={s.tone}>条件已成立</Tag>
            ) : (
              <Tag tone="neutral">
                条件 {s.met.hit}/{s.met.total}
              </Tag>
            )}
            <span className="text-sub text-[11px] min-w-0 break-all">{s.outlook}</span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {s.conditions.map((c) => (
              <li key={c} className="text-[11px] text-sub leading-relaxed">
                <span className={cn('mr-1', s.live ? TONE_TEXT[s.tone] : 'text-sub')}>
                  {s.live ? '✓' : '·'}
                </span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[10.5px] text-sub leading-relaxed">
        只给机械可判的触发条件，⛔ 不给概率、不做点预测 —— 请自行盯条件是否成立。
      </p>
    </div>
  )
}

/** ── 卡 0：8 日窗口条（T-3 .. T+4）—— 全页的「时间坐标」── */
export function EffectWindowCard({
  history,
  axes,
}: {
  history: EffectHistoryPoint[]
  axes: EffectAxes
}) {
  const past = history.slice(-3)
  const future = ['T+1', 'T+2', 'T+3', 'T+4']
  const cellTone = (axis: 'gain' | 'loss', level: number | null): keyof typeof TONE_TEXT =>
    axisTone(axis, level == null ? 't3' : level >= 1.5 ? 't5' : level >= 0.5 ? 't4' : level > -0.5 ? 't3' : level > -1.5 ? 't2' : 't1')
  const words = (level: number | null) =>
    level == null ? '—' : level >= 1.5 ? '强' : level >= 0.5 ? '偏强' : level > -0.5 ? '中' : level > -1.5 ? '偏弱' : '弱'

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-stretch gap-1.5 max-xl:flex-wrap min-w-0">
        {past.map((p) => (
          <div
            key={p.date}
            className="flex-1 min-w-[74px] rounded-[var(--radius-sm)] border border-line px-2 py-1.5 flex flex-col gap-0.5"
          >
            <span className="num text-[10.5px] text-sub">{p.date.slice(5)}</span>
            <span className={cn('num text-[12px] font-semibold', cellTone('gain', p.gainLevel))}>
              赚 {words(p.gainLevel)}
            </span>
            <span className={cn('num text-[12px] font-semibold', cellTone('loss', p.lossLevel))}>
              亏 {words(p.lossLevel)}
            </span>
          </div>
        ))}

        <div className="flex-1 min-w-[86px] rounded-[var(--radius-sm)] border border-line-strong bg-line-faint px-2 py-1.5 flex flex-col gap-0.5">
          <span className="num text-[10.5px] text-txt font-semibold">
            {axes.basis.date.slice(5) || '今日'}
          </span>
          <span className={cn('num text-[12px] font-semibold', cellTone('gain', axes.gain.level))}>
            赚 {axes.gain.word}
          </span>
          <span className={cn('num text-[12px] font-semibold', cellTone('loss', axes.loss.level))}>
            亏 {axes.loss.word}
          </span>
        </div>

        {future.map((f) => (
          <div
            key={f}
            className="flex-1 min-w-[64px] rounded-[var(--radius-sm)] border border-dashed border-line px-2 py-1.5 flex flex-col gap-0.5"
          >
            <span className="num text-[10.5px] text-sub">{f}</span>
            <span className="text-[11px] text-sub">推演</span>
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-sub leading-relaxed">
        实线格 = 已落盘事实（T-3~T）；虚线格 = 推演（T+1 条件期望 / T+2~T+4 三情景）。
      </p>
    </div>
  )
}
