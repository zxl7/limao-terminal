/**
 * 周期温度数据钩子（2026-11-17）
 *
 * 用户要求把「情绪周期」页的四个维度接进复盘页：
 *   · 投机情绪 · 周期相位
 *   · 昨日涨停反馈 · 涨停家数 · 炸板率
 *   · 资金温度 · 主力净额
 *   · 接力质量
 *
 * 这些数据同源于 `buildCycleTemperature`。为避免两页各写一份（口径漂移），
 * 这里把「取数 + 拼装」收敛成一个 hook；⛔ 不改任何计算，只是搬运。
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { analyticsQueries } from '@/features/analytics/api/queries'
import { marketQueries } from '@/features/market'
import type { EmotionDailySnapshot } from '@/shared/api'
import { buildCycleTemperature, type CycleTemperatureResult } from './cycle-temperature'
import type { FeedbackMatrix, FlowHistoryDay, SectorFundPool, ZtHistoryDay } from '@/shared/api'

export function useCycleTemperature(): CycleTemperatureResult {
  const daily = useQuery(analyticsQueries.emotionDaily())
  const ztHist = useQuery(analyticsQueries.emotionZtHistory())
  const flowHist = useQuery(analyticsQueries.flowHistory())
  const flowLive = useQuery(analyticsQueries.flowLive())
  const latest = useQuery(marketQueries.latest())
  const feedback = useQuery(marketQueries.feedback())

  return useMemo(() => {
    const today = latest.data?.ts?.slice(0, 10) ?? feedback.data?.date ?? null
    const dailyRows = (daily.data ?? []).flatMap((file) => (file.data ? [file.data] : [])) as EmotionDailySnapshot[]
    const ztRows = [...(ztHist.data ?? [])]
    const todayZt = ztRows.find((file) => file.data?.date === today)?.data
    const liveZt = todayZt?.intraday_points?.at(-1)
    const current = latest.data
    // 盘中：把「今天」这一行用实时快照补齐（与情绪周期页同口径）
    if (today && current && current.ts.slice(0, 10) === today) {
      const existingIndex = dailyRows.findIndex((row) => row.date === today)
      const liveRow = {
        ...(existingIndex >= 0 ? dailyRows[existingIndex] : { date: today }),
        date: today,
        sentiment_score: current.sentiment_detail?.source === 'feedback_matrix' ? current.sentiment_detail.score : null,
        sentiment_label: current.sentiment_detail?.source === 'feedback_matrix' ? current.sentiment_detail.label : null,
        zt_count: liveZt?.total ?? current.total_zt ?? null,
        sentiment_model: current.sentiment_detail?.model ?? undefined,
        nuke_count: feedback.data?.date === today ? feedback.data.nuke_count : null,
        generated_ts: current.ts,
      }
      if (existingIndex >= 0) dailyRows[existingIndex] = liveRow
      else dailyRows.push(liveRow)
      if (!todayZt) {
        ztRows.push({
          file: `zt_${today}.json`,
          data: { date: today, intraday_points: liveZt ? [liveZt] : [] } as ZtHistoryDay,
        })
      }
    }
    return buildCycleTemperature(
      dailyRows,
      ztRows,
      (feedback.data ?? null) as FeedbackMatrix | null,
      (flowHist.data ?? []) as FlowHistoryDay[],
      (flowLive.data ?? null) as SectorFundPool | null,
      today,
    )
  }, [daily.data, feedback.data, flowHist.data, flowLive.data, latest.data, ztHist.data])
}
