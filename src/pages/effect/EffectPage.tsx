import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { ZtHistoryDay, ZtPoolStock } from '@/shared/api'
import {
  analyticsQueries,
  boardsDistribution,
  buildEffectAxes,
  buildEffectHistory,
  buildScenarios,
  EffectAxesCard,
  RelayEffectCard,
  EffectScenarioCard,
  EffectTrendCard,
  NextDayProjectionCard,
  projectNextDay,
  StatPair,
} from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { Card, CardBadge } from '@/shared/ui'

/** 亏钱轴用压力高低表达，避免“亏钱效应强”在总览中被误读成正向结论。 */
function lossWord(word: string): string {
  return ({ 强: '高', 偏强: '偏高', 中性: '中等', 偏弱: '偏低', 弱: '低' } as Record<string, string>)[word] ?? '—'
}

/**
 * 赚钱效应 / 亏钱效应 研判页（`/effect` · 2026-09-23 立项）。
 *
 * ## 这一页回答什么
 *
 * 昨天出手的人，今天赚了还是亏了；以及今天的涨停结构，明天能提供什么条件基线。
 *
 * ## 三份数据各管一段（⛔ 不要混读）
 *
 * | 段 | 来源 | 性质 |
 * |---|---|---|
 * | **T 当日双轴** | `marketQueries.feedback()`（30s 实时） | **事实** —— 昨涨停池今日的实际表现 |
 * | **T-3~T 历史** | `feedback.trend.history` + `emotionSummary5d`（日频 17:19） | **事实** —— 已落盘记录的聚合，零推断 |
 * | **T+1~T+4 推演** | `promotionSummary` 分阶段历史统计 + `turn_signal` | **条件期望 / 情景** —— ⛔ 不是预测 |
 *
 * ## ⛔ 口径铁律
 *
 * - 两轴**共用同一池子**（昨涨停池），按今日涨跌分组 —— 上行侧=赚钱、下行侧=亏钱。
 * - 阈值一律复用 `feedback_matrix.sentiment_score` 既有档（见 `lib/effect.ts` 头注）。
 * - ⛔ 不产出 0-100 的「效应分」（伪精确）；轴位用 `-2..+2` 阶梯位置。
 * - ⛔ 缺料显示「—」，**永不退化成 0**；⛔ 不用别日数据顶替。
 * - ⛔ 页面不放数据管道解释（宪法·渲染铁律）—— 口径写在 `lib/effect.ts` 与该设计文档里。
 */

export async function loader() {
  // 当日双轴（实时）
  await queryClient.ensureQueryData(marketQueries.feedback())
  // 历史窗口（日频）
  await queryClient.ensureQueryData(analyticsQueries.emotionSummary5d())
  // T+1 推演基线（日频）
  await queryClient.ensureQueryData(analyticsQueries.promotionSummary())
  // 当日涨停池（板数分布 → T+1 推演的输入）
  await queryClient.ensureQueryData(analyticsQueries.emotionZtHistory())
  return null
}

export function Component() {
  /** 当日双轴主源 · 盘中 30s / 非交易 180s（节拍来自 `marketQueries` 的统一实现） */
  const fbQ = useQuery(marketQueries.feedback())
  /** 日频：5 日/10 日序列与拐点信号（当日 17:19 才更新） */
  const sumQ = useQuery(analyticsQueries.emotionSummary5d())
  /** 日频：分阶段成功率与溢价（T+1 条件期望的基线） */
  const promoQ = useQuery(analyticsQueries.promotionSummary())
  /** 日频：涨停池历史（取当日池的板数分布） */
  const ztQ = useQuery(analyticsQueries.emotionZtHistory())

  const fb = fbQ.data ?? null
  const summary = sumQ.data ?? null
  const promo = promoQ.data ?? null

  const axes = useMemo(() => buildEffectAxes(fb), [fb])
  const history = useMemo(() => buildEffectHistory(fb, summary), [fb, summary])
  const scenarios = useMemo(() => buildScenarios(fb, summary), [fb, summary])

  /**
   * 当日涨停池的板数分布（T+1 推演的唯一输入）。
   *
   * ⛔ 只取 `date === feedback.date` 的那一期 —— 跨日取会把昨日结构当成今日的。
   * 盘中该日归档尚无 `zt_list`（收盘才落盘）→ `boardsDistribution` 返回 `null`，
   * 推演卡走空态，⛔ 不编造分布。
   */
  const dist = useMemo(() => {
    const files = (ztQ.data ?? []) as Array<{ data?: ZtHistoryDay | null }>
    const day = files.find((f) => f.data?.date && f.data.date === fb?.date)?.data
    const list = (day?.zt_list ?? []) as ZtPoolStock[]
    return boardsDistribution(list)
  }, [ztQ.data, fb?.date])

  const projection = useMemo(() => projectNextDay(dist, promo), [dist, promo])

  /** 情绪快照（当日定性，来自 `market_memory`）—— 只作背景，⛔ 不重算 */
  const sentiment = useMemo(() => {
    const m = fb?.sentiment_score
    return typeof m === 'number' ? `${m}/10 · ${fb?.sentiment_label ?? '—'}` : '—'
  }, [fb])

  const err = fbQ.error ?? sumQ.error ?? promoQ.error ?? ztQ.error

  return (
    <div className="flex flex-col gap-3">
      {/* ── 先定义统计对象：避免用户把赚钱效应误读成指数或预测 ── */}
      <Card
        title="💸 赚钱效应｜昨日涨停的今日反馈"
        extra={
          <div className="flex items-center gap-2">
            <CardBadge>
              {axes.basis.prevDate || '—'} → {axes.basis.date || '—'}
            </CardBadge>
          </div>
        }
      >
        {err ? (
          <div className="text-down text-[12px] py-2">数据不可用：{String((err as Error).message ?? err)}</div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              <StatPair label="昨日涨停池" value={`${axes.basis.prevZtCount ?? '—'} 只`} />
              <StatPair label="今日涨停" value={`${axes.basis.nowZtCount ?? '—'} 只`} tone="up" />
              <StatPair label="今日晋级" value={`${axes.basis.promoteCount ?? '—'} 只`} tone="up" />
              <StatPair label="赚钱回报" value={axes.gain.word} tone="up" />
              <StatPair label="亏钱压力" value={lossWord(axes.loss.word)} tone="down" />
            </div>
          </>
        )}
        <p className="mt-3 text-[11.5px] text-sub leading-relaxed">
          当前情绪 <span className="num text-txt">{sentiment}</span>。先读“赚钱回报”和“亏钱压力”是否同步恶化，再看历史与下一交易日的条件基线。
        </p>
      </Card>

      {/* 第一步是今日事实，第二步才是基于今日涨停结构的统计基线。 */}
      <div className="flex gap-3 items-start max-xl:flex-col">
        <div className="xl:w-[60%] xl:flex-none min-w-0 flex flex-col gap-3">
          <Card title="① 今天：赚钱回报与亏钱压力" extra={<CardBadge>实时反馈</CardBadge>}>
            <EffectAxesCard axes={axes} />
          </Card>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <Card
            title="② 下一交易日：今日结构的统计基线"
            extra={<CardBadge>条件期望 · 非预测</CardBadge>}
          >
            <NextDayProjectionCard projection={projection} />
          </Card>
        </div>
      </div>

      <RelayEffectCard />

      {/* 历史只回答“在改善还是恶化”；情景只列观察条件，避免与当日事实混读。 */}
      <div className="flex gap-3 items-start max-xl:flex-col">
        <div className="xl:w-[60%] xl:flex-none min-w-0">
          <Card title="③ 过去几日：赚钱环境在改善还是恶化" extra={<CardBadge>{history.length} 个已落盘交易日</CardBadge>}>
            <EffectTrendCard points={history} />
          </Card>
        </div>
        <div className="flex-1 min-w-0">
          <Card title="④ 后续只盯这三类条件" extra={<CardBadge>T+2 ~ T+4</CardBadge>}>
            <EffectScenarioCard scenarios={scenarios} />
          </Card>
        </div>
      </div>

      <p className="text-[11px] text-sub leading-relaxed">
        基于公开信息与历史统计，仅供参考，不构成投资建议。推演为条件期望与情景假设，非未来收益承诺。
      </p>
    </div>
  )
}
