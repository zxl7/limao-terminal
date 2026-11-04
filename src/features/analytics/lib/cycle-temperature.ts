import type { EmotionDailySnapshot, FeedbackMatrix, SectorFundPool, ZtHistoryDay } from '@/shared/api'

export type CyclePhase = 'ice' | 'ebb' | 'repair' | 'warming' | 'high'
export type HeatLevel = 'unknown' | 'cold' | 'cool' | 'neutral' | 'warm' | 'hot'

export interface HeatSignal {
  level: HeatLevel
  label: string
  sampleCount: number
}

export interface CycleTemperaturePoint {
  date: string
  sentiment: number | null
  sentimentMa3: number | null
  phase: CyclePhase | null
  promoteRate: number | null
  ztCount: number | null
  brokenRate: number | null
}

export interface FundTemperaturePoint {
  date: string
  temperature: number | null
  mainNetYi: number | null
  live: boolean
  generatedTs?: string
}

export interface LiveCycleSnapshot {
  date: string
  sentimentScore?: number | null
  ztCount?: number | null
  promoteRate?: number | null
  brokenRate?: number | null
  nukeCount?: number | null
  upRate?: number | null
  maxBoards?: number | null
  generatedTs?: string
}

export interface CycleDimensionHeat {
  sentiment: HeatSignal
  promoteRate: HeatSignal
  brokenRate: HeatSignal
  ztCount: HeatSignal
  fundTemperature: HeatSignal
  mainNetYi: HeatSignal
}

export interface CycleTemperatureResult {
  cycle: CycleTemperaturePoint[]
  feedback: CycleTemperaturePoint[]
  funds: FundTemperaturePoint[]
  live: LiveCycleSnapshot | null
  latest: {
    cycle: CycleTemperaturePoint | null
    feedback: CycleTemperaturePoint | null
    fund: FundTemperaturePoint | null
  }
  heat: CycleDimensionHeat
}

export const CYCLE_PHASE_LABEL: Record<CyclePhase, string> = {
  ice: '冰点',
  ebb: '退潮',
  repair: '修复',
  warming: '升温',
  high: '高潮',
}

export const CYCLE_PHASE_TONE: Record<CyclePhase, 'down' | 'warn' | 'mid' | 'up' | 'rec'> = {
  ice: 'down',
  ebb: 'warn',
  repair: 'mid',
  warming: 'up',
  high: 'rec',
}

export function phaseOfScore(score: number | null): CyclePhase | null {
  if (score == null || !Number.isFinite(score)) return null
  if (score <= 2) return 'ice'
  if (score <= 4.5) return 'ebb'
  if (score <= 6.5) return 'repair'
  if (score <= 8) return 'warming'
  return 'high'
}

export const HEAT_LABEL: Record<HeatLevel, string> = {
  unknown: '待确认',
  cold: '冷',
  cool: '偏冷',
  neutral: '中性',
  warm: '偏热',
  hot: '热',
}

function heatLevel(normalized: number | null): HeatLevel | null {
  if (normalized == null || !Number.isFinite(normalized)) return null
  if (normalized < 0.2) return 'cold'
  if (normalized < 0.4) return 'cool'
  if (normalized < 0.6) return 'neutral'
  if (normalized < 0.8) return 'warm'
  return 'hot'
}

function relativeHeat(value: number | null, values: Array<number | null>, higherIsHotter = true): HeatSignal {
  const valid = values.filter((item): item is number => item != null && Number.isFinite(item))
  if (value == null || !Number.isFinite(value) || valid.length === 0) {
    return { level: 'unknown', label: '待确认', sampleCount: valid.length }
  }
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const normalized = max === min ? 0.5 : (value - min) / (max - min)
  const level = heatLevel(higherIsHotter ? normalized : 1 - normalized) ?? 'unknown'
  return { level, label: HEAT_LABEL[level], sampleCount: valid.length }
}

function scoreHeat(value: number | null, values: Array<number | null>): HeatSignal {
  if (value == null || !Number.isFinite(value)) return { level: 'unknown', label: '待确认', sampleCount: values.filter((item) => item != null).length }
  const level = heatLevel(Math.max(0, Math.min(10, value)) / 10) ?? 'unknown'
  return { level, label: HEAT_LABEL[level], sampleCount: values.filter((item) => item != null).length }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function ztStats(row: ZtHistoryDay | null | undefined): { total: number | null; brokenRate: number | null } {
  if (!row) return { total: null, brokenRate: null }
  const point = row.intraday_points?.at(-1)
  const total = finite(point?.total ?? row.zt_count)
  const broken = row.zt_list?.reduce((sum, stock) => sum + (finite(stock.zbc) ?? 0), 0)
  if (broken == null || total == null) return { total, brokenRate: null }
  return { total, brokenRate: (broken / Math.max(1, broken + total)) * 100 }
}

function ma3(values: Array<number | null>, index: number): number | null {
  if (index < 2) return null
  const window = values.slice(index - 2, index + 1)
  return window.every((value) => value != null) ? window.reduce((sum, value) => sum + value!, 0) / 3 : null
}

export function buildCycleTemperature(
  daily: EmotionDailySnapshot[],
  ztFiles: Array<{ data: ZtHistoryDay | null }>,
  feedback: FeedbackMatrix | null | undefined,
  flowFiles: Array<{ data: { date?: string; boards?: Record<string, { flow_yi?: number | null }> } | null }>,
  liveFlow: SectorFundPool | null | undefined = null,
  liveDate: string | null = null,
): CycleTemperatureResult {
  const dailyRows = daily
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const ztByDate = new Map(ztFiles.flatMap((file) => (file.data?.date ? [[file.data.date, ztStats(file.data)] as const] : [])))
  const sentimentValues = dailyRows.map((row) => finite(row.sentiment_score))

  const cycle = dailyRows.map((row, index) => {
    const zt = ztByDate.get(row.date)
    return {
      date: row.date,
      sentiment: sentimentValues[index],
      sentimentMa3: dailyRows.slice(Math.max(0, index - 2), index + 1)
        .every((day) => (day.sentiment_model ?? 'legacy_v2') === (row.sentiment_model ?? 'legacy_v2'))
        ? ma3(sentimentValues, index) : null,
      phase: phaseOfScore(sentimentValues[index]),
      promoteRate: finite(row.promote_rate),
      ztCount: zt?.total ?? null,
      brokenRate: zt?.brokenRate ?? null,
    }
  })

  const historyRows = feedback?.trend?.history ?? []
  const feedbackDates = new Set(historyRows.map((row) => row.date))
  if (feedback?.date) feedbackDates.add(feedback.date)
  const feedbackRows = cycle.filter((row) => feedbackDates.has(row.date))
  const feedbackByDate = new Map(historyRows.map((row) => [row.date, row]))
  const feedbackSeries = feedbackRows.map((row) => ({
    ...row,
    promoteRate: row.date === feedback?.date
      ? finite(feedback?.promote_rate) ?? row.promoteRate
      : finite(feedbackByDate.get(row.date)?.pr) ?? row.promoteRate,
    ztCount: row.date === feedback?.date ? finite(feedback?.now_zt_count) ?? row.ztCount : row.ztCount,
    brokenRate: row.date === feedback?.date ? finite(feedback?.broken_rate) ?? row.brokenRate : row.brokenRate,
  }))

  const rawFunds = flowFiles
    .flatMap((file) => {
      const row = file.data
      if (!row?.date || !row.boards) return []
      const values = Object.values(row.boards).map((board) => finite(board.flow_yi)).filter((value): value is number => value != null)
      return values.length ? [{ date: row.date, mainNetYi: values.reduce((sum, value) => sum + value, 0), live: false as const }] : []
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  const liveFunds = liveFlow?.date && liveFlow.boards
    ? (() => {
        const values = Object.values(liveFlow.boards).map((board) => finite(board.flow_yi)).filter((value): value is number => value != null)
        return values.length
          ? [{ date: liveFlow.date, mainNetYi: values.reduce((sum, value) => sum + value, 0), live: true as const, generatedTs: new Date(liveFlow.ts * 1000).toISOString() }]
          : []
      })()
    : []
  const mergedFunds = [...rawFunds.filter((row) => row.date !== liveDate), ...liveFunds].sort((a, b) => a.date.localeCompare(b.date))
  const fundValues = mergedFunds.map((row) => row.mainNetYi)
  const min = Math.min(...fundValues)
  const max = Math.max(...fundValues)
  const funds = mergedFunds.map((row) => ({
    ...row,
    temperature: max === min ? 50 : ((row.mainNetYi - min) / (max - min)) * 100,
  }))

  const latestCycle = cycle.at(-1) ?? null
  const latestFeedback = feedbackSeries.at(-1) ?? null
  const latestFund = funds.at(-1) ?? null
  const live = liveDate && (liveFlow?.date === liveDate || feedback?.date === liveDate)
    ? {
        date: liveDate,
        sentimentScore: latestCycle?.sentiment ?? null,
        ztCount: latestFeedback?.ztCount ?? null,
        promoteRate: latestFeedback?.promoteRate ?? null,
        brokenRate: latestFeedback?.brokenRate ?? null,
        generatedTs: liveFlow?.ts ? new Date(liveFlow.ts * 1000).toISOString() : undefined,
      }
    : null
  const heat: CycleDimensionHeat = {
    sentiment: scoreHeat(latestCycle?.sentiment ?? null, cycle.map((row) => row.sentiment)),
    promoteRate: relativeHeat(latestFeedback?.promoteRate ?? null, feedbackSeries.map((row) => row.promoteRate)),
    brokenRate: relativeHeat(latestFeedback?.brokenRate ?? null, feedbackSeries.map((row) => row.brokenRate)),
    ztCount: relativeHeat(latestFeedback?.ztCount ?? null, feedbackSeries.map((row) => row.ztCount)),
    fundTemperature: relativeHeat(latestFund?.temperature ?? null, funds.map((row) => row.temperature)),
    mainNetYi: relativeHeat(latestFund?.mainNetYi ?? null, funds.map((row) => row.mainNetYi)),
  }

  return {
    cycle,
    feedback: feedbackSeries,
    funds,
    live,
    latest: {
      cycle: latestCycle,
      feedback: latestFeedback,
      fund: latestFund,
    },
    heat,
  }
}
