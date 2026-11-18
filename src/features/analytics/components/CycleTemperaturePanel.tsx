import { useMemo, useState, type ReactNode } from 'react'
import type { CycleTemperatureResult, CyclePhase, HeatSignal, HeatLevel } from '../lib/cycle-temperature'
import { CYCLE_PHASE_LABEL, CYCLE_PHASE_TONE, HEAT_LABEL } from '../lib/cycle-temperature'
import { BarChart, Card, CardBadge, EmptyState, LineChart, type ChartMarker } from '@/shared/ui'
import { SegTabs } from './Table'
import { n1 } from '../lib/format'

/** 观察窗口档位（2026-11-18）：只切展示区间，⛔ 不重算指标 */
const CYCLE_RANGES = [
  { key: '20', label: '20日' },
  { key: '60', label: '60日' },
  { key: '120', label: '120日' },
  { key: '0', label: '全部' },
] as const

function pct(value: number | null): string {
  return value == null ? '—' : `${n1(value)}%`
}

function yi(value: number | null): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${n1(value)}亿`
}

function bjTime(value: string | undefined): string {
  if (!value) return '更新'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function phaseOf(result: CycleTemperatureResult): {
  label: string
  tone: 'down' | 'warn' | 'mid' | 'up' | 'rec' | 'neutral'
  phase: CyclePhase | null
} {
  const phase = result.latest.cycle?.phase ?? null
  return phase
    ? { label: CYCLE_PHASE_LABEL[phase], tone: CYCLE_PHASE_TONE[phase], phase }
    : { label: '待确认', tone: 'neutral', phase: null }
}

const HEAT_CLASS: Record<HeatLevel, string> = {
  cold: 'text-down border-down bg-down-soft',
  cool: 'text-warn border-warn bg-warn-soft',
  neutral: 'text-mid border-line bg-line-faint',
  warm: 'text-up border-up bg-up-soft',
  hot: 'text-rec border-rec bg-rec-soft',
  unknown: 'text-sub border-line bg-line-faint',
}

const HEAT_SURFACE: Record<HeatLevel, string> = {
  cold: 'border-down/30 bg-down-soft/35',
  cool: 'border-warn/30 bg-warn-soft/35',
  neutral: 'border-line bg-line-faint/35',
  warm: 'border-up/30 bg-up-soft/35',
  hot: 'border-rec/30 bg-rec-soft/35',
  unknown: 'border-line bg-line-faint/35',
}

const PHASE_SURFACE: Record<'down' | 'warn' | 'mid' | 'up' | 'rec' | 'neutral', string> = {
  down: 'border-down/35 bg-down-soft/45',
  warn: 'border-warn/35 bg-warn-soft/45',
  mid: 'border-line bg-line-faint/50',
  up: 'border-up/35 bg-up-soft/45',
  rec: 'border-rec/35 bg-rec-soft/45',
  neutral: 'border-line bg-line-faint/50',
}

function HeatBadge({ signal, risk = false }: { signal: HeatSignal; risk?: boolean }) {
  const text = signal.level === 'unknown' ? '待确认' : `${HEAT_LABEL[signal.level]}${risk ? '·风险' : ''}`
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-10 leading-none ${HEAT_CLASS[signal.level]}`}>{text}</span>
}

function HeatItem({
  label,
  value,
  unit,
  signal,
  risk = false,
}: {
  label: string
  value: string
  unit?: string
  signal: HeatSignal
  risk?: boolean
}) {
  return (
    <div className={`min-w-0 rounded border px-3 py-2.5 ${HEAT_SURFACE[signal.level]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-11 text-sub">{label}</span>
        <HeatBadge signal={signal} risk={risk} />
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="num text-20 font-semibold leading-none text-txt">{value}</span>
        {unit && <span className="text-11 text-sub">{unit}</span>}
      </div>
      <div className="mt-1 text-10 text-sub">
        {signal.sampleCount > 0 ? `当前有效窗口 ${signal.sampleCount} 日` : '暂无有效样本'}
      </div>
    </div>
  )
}

function HeatLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-faint pt-2 text-10 text-sub">
      <span className="font-medium text-txt">周期冷热</span>
      <span className="text-down">冷</span>
      <span className="text-warn">偏冷</span>
      <span className="text-mid">中性</span>
      <span className="text-up">偏热</span>
      <span className="text-rec">热</span>
      <span>按当前有效历史窗口相对比较，不等同于利好/利空。</span>
    </div>
  )
}

function PhaseTrack({ phase }: { phase: CyclePhase | null }) {
  const phases: CyclePhase[] = ['ice', 'ebb', 'repair', 'warming', 'high']
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between text-10 text-sub">
        <span>周期位置</span>
        <span>冷 → 热</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {phases.map((item) => {
          const tone = CYCLE_PHASE_TONE[item]
          const active = item === phase
          const surface = tone === 'down' ? 'bg-down-soft' : tone === 'warn' ? 'bg-warn-soft' : tone === 'mid' ? 'bg-line-faint' : tone === 'up' ? 'bg-up-soft' : 'bg-rec-soft'
          return (
            <div
              key={item}
              className={`rounded px-1 py-1.5 text-center text-10 ${surface} ${active ? 'font-semibold text-txt ring-1 ring-inset ring-line-strong' : 'text-sub'}`}
            >
              {CYCLE_PHASE_LABEL[item]}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ChartMeta({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>
}

export function CycleTemperaturePanel({
  result,
  chartsOnly = false,
}: {
  result: CycleTemperatureResult
  /**
   * `chartsOnly`（2026-11-17 用户最终口径）：
   * **保留三张图**（周期相位 / 昨日涨停反馈 / 资金温度·主力净额），
   * **删掉上面的「当前周期状态」和「数据维度冷热」两块**。
   */
  chartsOnly?: boolean
}) {
  const phase = phaseOf(result)
  // 2026-11-17：复盘页把三张图搬过去后，高度要收（用户：「图表缩小高度」）
  // 2026-11-18：极点标注要在曲线外占 7~13px，高度必须抬 —— 不然文字被裁
  const chartH = chartsOnly ? 160 : 236
  const fundH = chartsOnly ? 110 : 180
  const cycle = result.cycle
  const feedback = result.feedback
  const funds = result.funds
  const hasCycle = cycle.some((row) => row.sentiment != null)
  const hasFeedback = feedback.some((row) => row.promoteRate != null || row.brokenRate != null || row.ztCount != null)
  const hasFunds = funds.some((row) => row.temperature != null || row.mainNetYi != null)
  const latestSentiment = result.latest.cycle?.sentiment == null ? '—' : n1(result.latest.cycle.sentiment)
  const latestFundTemperature = result.latest.fund?.temperature == null ? '—' : n1(result.latest.fund.temperature)
  const latestZtCount = result.latest.feedback?.ztCount == null ? '—' : `${Math.round(result.latest.feedback.ztCount)}`
  /**
   * 周期相位的**观察窗口**（2026-11-18 借鉴外部情绪图）：
   * 全窗口 60 日上下时折线过密，极点和相位带都看不清；给 20/60/120/全部四档，
   * 默认 60 日。⛔ 只切展示窗口，不重算任何指标（极值仍在完整序列上判定）。
   */
  const [range, setRange] = useState<number>(60)
  const windowed = range > 0 ? cycle.slice(-range) : cycle
  const offset = cycle.length - windowed.length
  /** 极点在**完整序列**上找（切片只影响展示），再把下标平移进窗口 */
  /**
   * 极点识别（2026-11-18 对齐外部情绪图的四级标注）：
   *   · **高潮**：情绪分 ≥ 8 的局部高点（红）
   *   · **冰点**：情绪分 ≤ 2.5、且只冷 1 天（蓝）
   *   · **双冰**：连续 2~4 天 ≤ 2.5（紫）
   *   · **五冰**：连续 ≥5 天 ≤ 2.5（橙）—— 冷得越久，退潮越实
   * 冰点按「连续段」判，不再逐日判 —— 否则一段 5 天冰点会被写成 5 个冰点标。
   */
  const { peaks, troughs, markers } = useMemo(() => {
    const at = (i: number) => cycle[i]?.sentiment
    const peakIdx: number[] = []
    for (let i = 1; i < cycle.length - 1; i += 1) {
      const v = at(i)
      if (typeof v !== 'number' || v < 8) continue
      let hi = true
      for (let k = Math.max(0, i - 2); k <= Math.min(cycle.length - 1, i + 2); k += 1) {
        const w = at(k)
        if (typeof w === 'number' && k !== i && w > v) hi = false
      }
      if (hi) peakIdx.push(i)
    }
    // 极值日之间隔 ≥3 天，避免密集段刷屏（保留先出现的那次）
    const keepPeaks = peakIdx.filter((i, n) => n === 0 || i - peakIdx[n - 1] >= 3)

    /** 连续 ≤2.5 的「冷段」：取段内最低点做标注 */
    const runs: Array<{ start: number; end: number; low: number }> = []
    let cur: { start: number; end: number; low: number } | null = null
    for (let i = 0; i < cycle.length; i += 1) {
      const v = at(i)
      const cold = typeof v === 'number' && v <= 2.5
      if (cold) {
        if (!cur) cur = { start: i, end: i, low: i }
        else {
          cur.end = i
          if ((at(i) as number) <= (at(cur.low) as number)) cur.low = i
        }
      } else if (cur) {
        runs.push(cur)
        cur = null
      }
    }
    if (cur) runs.push(cur)

    // 冷段之间也做 ≥3 天抽稀：挨太近的两个标签必然叠字；保留更长（更实）的那段
    const keptRuns: typeof runs = []
    for (const r of runs) {
      const prev = keptRuns.at(-1)
      if (prev && r.low - prev.low < 3) {
        const lenR = r.end - r.start + 1
        const lenP = prev.end - prev.start + 1
        if (lenR > lenP) keptRuns[keptRuns.length - 1] = r
        continue
      }
      keptRuns.push(r)
    }
    const troughIdx = keptRuns.map((r) => r.low)
    const m: ChartMarker[] = []
    for (const i of keepPeaks) {
      if (i < offset) continue
      m.push({ index: i - offset, label: `高潮 ${cycle[i].date.slice(5)}`, tone: 'up' })
    }
    for (const r of keptRuns) {
      const i = r.low
      if (i < offset) continue
      const len = r.end - r.start + 1
      const meta =
        len >= 5
          ? { name: '五冰', tone: 'lead' as const }
          : len >= 2
            ? { name: '双冰', tone: 'rec' as const }
            : { name: '冰点', tone: 'mid' as const }
      m.push({ index: i - offset, label: `${meta.name} ${cycle[i].date.slice(5)}`, tone: meta.tone, place: 'below' })
    }
    // 错车道：相邻标注（<6 个交易日）交替抬高 11px，两行文字才不会压在一起
    m.sort((a, b) => a.index - b.index)
    let lastIdx = -99
    let lane = 0
    for (const item of m) {
      if (item.index - lastIdx < 6) {
        lane = lane === 0 ? 1 : 0
      } else {
        lane = 0
      }
      if (lane === 1) item.dy = 11
      lastIdx = item.index
    }
    return { peaks: keepPeaks, troughs: troughIdx, markers: m }
  }, [cycle, offset])
  const viewCycle = windowed

  return (
    <Card
      title="周期温度总览"
      extra={
        <div className="flex items-center gap-1.5">
          {result.live?.date && <CardBadge tone="up">盘中 {bjTime(result.live.generatedTs)}</CardBadge>}
          <HeatBadge signal={result.heat.sentiment} />
          <CardBadge tone={phase.tone === 'mid' ? 'neutral' : phase.tone}>{phase.label}</CardBadge>
        </div>
      }
    >
      <div className={chartsOnly ? 'hidden' : 'grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(270px,0.82fr)_minmax(0,2fr)]'}>
        <section className={`rounded border p-3 ${PHASE_SURFACE[phase.tone]}`} aria-label="当前周期状态">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-11 text-sub">当前周期状态</div>
              <div className="mt-1 text-25 font-semibold leading-none text-txt">{phase.label}</div>
            </div>
            <div className="text-right">
              <div className="text-10 text-sub">情绪分</div>
              <div className="num mt-1 text-25 font-semibold leading-none text-txt">{latestSentiment}<span className="ml-1 text-11 font-normal text-sub">/10</span></div>
            </div>
          </div>
          <p className="mt-2 text-11 leading-relaxed text-sub">情绪周期决定环境温度；下方各维度再看兑现、炸板、涨停和资金是否同步。</p>
          <PhaseTrack phase={phase.phase} />
        </section>

        <section className="rounded border border-line bg-panel/50 p-3" aria-label="周期冷热维度">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-12 font-medium text-txt">数据维度冷热</div>
              <div className="mt-0.5 text-10 text-sub">先看当前值，再看它在有效历史窗口中的相对位置。</div>
            </div>
            <span className="rounded border border-line px-1.5 py-0.5 text-10 text-sub">真实样本窗口</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 2xl:grid-cols-3">
            <HeatItem label="昨日涨停兑现" value={pct(result.latest.feedback?.promoteRate ?? null)} signal={result.heat.promoteRate} />
            <HeatItem label="炸板率" value={pct(result.latest.feedback?.brokenRate ?? null)} signal={result.heat.brokenRate} risk />
            <HeatItem label="涨停家数" value={latestZtCount} unit="只" signal={result.heat.ztCount} />
            <HeatItem label="资金温度" value={latestFundTemperature} unit="/100" signal={result.heat.fundTemperature} />
            <HeatItem label="主力净额" value={yi(result.latest.fund?.mainNetYi ?? null)} signal={result.heat.mainNetYi} />
            <HeatItem label="情绪分" value={latestSentiment} unit="/10" signal={result.heat.sentiment} />
          </div>
          <HeatLegend />
          {/* 🧾 2026-11-10 口径去重（截图审查）：顶栏与页面都在说「涨停/炸板/封板率」，
              但顶栏写封板率、页面写炸板率，读者会以为两个数打架。这里一次性把关系钉死。 */}
          <div className="mt-1.5 text-10 leading-relaxed text-sub">
            涨停 / 炸板 / 封板率与顶栏同源同口径：<b className="text-txt">封板率 = 涨停 ÷（涨停 + 炸板）</b>，
            此处「炸板率」= 100 − 封板率；后面的冷热标签是它在历史窗口中的相对位置，⛔ 不是另一个口径。
          </div>
        </section>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card
          title="投机情绪 · 周期相位"
          extra={<ChartMeta><HeatBadge signal={result.heat.sentiment} /><CardBadge>{cycle.length}日</CardBadge></ChartMeta>}
        >
          {hasCycle ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SegTabs
                  items={CYCLE_RANGES}
                  value={String(range)}
                  onChange={(k) => setRange(Number(k))}
                />
                <span className="text-10 text-sub">
                  极点自动标注：{peaks.length} 次高潮 · {troughs.length} 段冰点（{viewCycle.length} 日样本）
                </span>
              </div>
              <PhaseBands rows={viewCycle} />
              <LineChart
                labels={viewCycle.map((row) => row.date.slice(5))}
                series={[
                  { name: '情绪分', values: viewCycle.map((row) => row.sentiment), tone: 'mid', area: true },
                  { name: 'MA3', values: viewCycle.map((row) => row.sentimentMa3), tone: 'sub', dashed: true },
                ]}
                height={chartH}
                yMin={0}
                yMax={10}
                refLines={[
                  { value: 2, label: '冰点', tone: 'down' },
                  { value: 5, label: '中轴', tone: 'sub' },
                  { value: 8, label: '高潮', tone: 'rec' },
                ]}
                markers={markers}
                format={(value) => n1(value)}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-10 text-sub">
                <span><b className="text-up">●</b> 高潮（≥8）</span>
                <span><b className="text-mid">●</b> 冰点（≤2.5 · 1 天）</span>
                <span><b className="text-rec">●</b> 双冰（连续 2~4 天）</span>
                <span><b className="text-lead">●</b> 五冰（连续 ≥5 天）</span>
                <span>⛔ 标注只描述事实，不预测拐点</span>
              </div>
            </>
          ) : (
            <EmptyState text="无情绪周期数据" />
          )}
        </Card>

        <Card
          title="昨日涨停反馈 · 涨停家数 · 炸板率"
          extra={
            <ChartMeta>
              <HeatBadge signal={result.heat.promoteRate} />
              <HeatBadge signal={result.heat.brokenRate} risk />
              <CardBadge tone={result.heat.brokenRate.level === 'hot' ? 'warn' : 'neutral'}>{feedback.length}日</CardBadge>
            </ChartMeta>
          }
        >
          {hasFeedback ? (
            <LineChart
              labels={feedback.map((row) => row.date.slice(5))}
              series={[
                { name: '昨日涨停兑现', values: feedback.map((row) => row.promoteRate), tone: 'up', format: pct },
                { name: '炸板率', values: feedback.map((row) => row.brokenRate), tone: 'down', axis: 'right', format: pct },
                { name: '涨停家数', values: feedback.map((row) => row.ztCount), tone: 'lead', axis: 'right', format: (value) => `${Math.round(value)}只` },
              ]}
              height={190}
              yMin={0}
              yMax={100}
              refLines={[{ value: 50, label: '50%', tone: 'sub' }]}
              format={pct}
            />
          ) : (
            <EmptyState text="无涨停反馈历史" />
          )}
        </Card>

        <Card
          className="xl:col-span-2"
          title="资金温度 · 主力净额"
          extra={
            <ChartMeta>
              <HeatBadge signal={result.heat.fundTemperature} />
              <HeatBadge signal={result.heat.mainNetYi} />
              <CardBadge>{funds.length}日</CardBadge>
            </ChartMeta>
          }
        >
          {hasFunds ? (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              <div>
                <div className="mb-1 text-10 text-sub">资金温度（当前窗口相对值）</div>
                <LineChart
                  labels={funds.map((row) => row.date.slice(5))}
                  series={[{ name: '资金温度', values: funds.map((row) => row.temperature), tone: 'mid', area: true }]}
                  height={fundH}
                  yMin={0}
                  yMax={100}
                  refLines={[{ value: 50, label: '50', tone: 'sub' }]}
                  format={(value) => n1(value)}
                />
              </div>
              <div>
                <div className="mb-1 text-10 text-sub">主力净额（亿）</div>
                <BarChart
                  bars={funds.map((row) => ({ label: row.date.slice(5), value: row.mainNetYi, tone: (row.mainNetYi ?? 0) >= 0 ? 'up' : 'down' }))}
                  height={180}
                  format={(value) => `${n1(value)}亿`}
                  maxBarWidth={30}
                />
              </div>
            </div>
          ) : (
            <EmptyState text="无资金温度历史" />
          )}
        </Card>
      </div>
    </Card>
  )
}

function PhaseBands({ rows }: { rows: CycleTemperatureResult['cycle'] }) {
  return (
    <div className="mb-1 flex h-5 overflow-hidden rounded-sm border border-line-faint" aria-label="情绪周期阶段">
      {rows.map((row) => {
        const tone = row.phase ? CYCLE_PHASE_TONE[row.phase] : 'neutral'
        const cls = tone === 'up' ? 'bg-up-soft' : tone === 'down' ? 'bg-down-soft' : tone === 'warn' ? 'bg-warn-soft' : tone === 'rec' ? 'bg-rec-soft' : 'bg-line-faint'
        return <span key={row.date} className={cls} title={`${row.date} ${row.phase ? CYCLE_PHASE_LABEL[row.phase] : '待确认'}`} style={{ flex: 1 }} />
      })}
    </div>
  )
}
