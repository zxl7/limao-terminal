import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import {
  analyticsQueries,
  boardsDistributionFromLadder,
  buildEffectAxes,
  buildEffectHistory,
  buildScenarios,
  EffectAxesCard,
  EffectScenarioCard,
  EffectTrendCard,
  NextDayProjectionCard,
  projectNextDay,
  DataTable,
  StatPair,
} from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { APP_CONFIG } from '@/shared/config'
import { inTrading } from '@/shared/lib'
import { Card, CardBadge, StockLink } from '@/shared/ui'
import type { FeedbackMatrix, MarketSnapshot } from '@/shared/api'

const pctTone = (value: number | null | undefined) => value == null ? 'text-sub' : value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-txt'

function premium(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function ratio(num: number | null | undefined, den: number | null | undefined, digits = 1): string {
  return num == null || den == null || den <= 0 ? '—' : `${num}/${den} · ${(num / den * 100).toFixed(digits)}%`
}

function SelectionLogicSection({ feedback, snapshot }: { feedback: FeedbackMatrix | null; snapshot?: MarketSnapshot }) {
  // 选股文件是盘后产物，但页面继续轮询，保证脚本重算后能自动同步最新结果。
  const planQ = useQuery({ ...analyticsQueries.decisionLatest(), refetchInterval: () => inTrading() ? APP_CONFIG.pollIntradayMs : APP_CONFIG.pollOfflineMs })
  const plan = planQ.data
  // 旧版反馈快照可能尚无逐票 quotes；缺字段按无可用样本处理，不调用 Object.entries(undefined)。
  const quotes = feedback?.quotes ?? {}
  const relayEntries = Object.entries(quotes).filter(([, quote]) => (quote.prev_boards ?? 0) >= 2)
  const relay = relayEntries.map(([, quote]) => quote)
  const promoted = new Set(feedback?.promote_codes ?? [])
  const failedRelay = relayEntries.filter(([code]) => !promoted.has(code)).map(([, quote]) => quote)
  // 失败后的形态只在同一批“昨连板”样本内统计：上涨视为修复，跌幅≤-5%视为核按钮，避免混入首板。
  const repairCount = failedRelay.filter((quote) => quote.pct != null && quote.pct > 0).length
  const nukeCount = failedRelay.filter((quote) => quote.pct != null && quote.pct <= -5).length
  // 跌停只认 latest 的跌停名单；单靠 -10% 涨幅不能证明可靠跌停事实。
  const limitDownNames = new Set(snapshot?.limit_down?.names ?? [])
  const limitDownCount = failedRelay.filter((quote) => quote.name != null && limitDownNames.has(quote.name)).length
  const failureRatio = (count: number) => feedback == null || failedRelay.length === 0 ? '—' : `${count}/${failedRelay.length}`
  const limitDownRatio = feedback == null || snapshot == null || failedRelay.length === 0 ? '—' : `${limitDownCount}/${failedRelay.length}`
  // 溢价直接取反馈矩阵的昨连板逐票涨幅；均值和中位数都只排除缺失行情，不补 0。
  const relayPcts = relay.map((quote) => quote.pct).filter((value): value is number => value != null)
  const relayAvg = relayPcts.length ? relayPcts.reduce((sum, value) => sum + value, 0) / relayPcts.length : null
  const relayMedian = relayPcts.length ? [...relayPcts].sort((a, b) => a - b)[Math.floor(relayPcts.length / 2)] : null
  const rows = [...(plan?.relay ?? []), ...(plan?.watch ?? [])]

  return <Card title="选股逻辑同步｜晋级 · 溢价 · 失败反馈" extra={<CardBadge>{plan?.date ? `${plan.date} 选股结果` : '等待选股结果'}</CardBadge>}>
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <StatPair label="连板晋级率" value={ratio(feedback?.lb_promote_count, feedback?.lb_prev_count)} tone="up" />
        <StatPair label="昨连板今均涨" value={premium(relayAvg)} tone={relayAvg != null && relayAvg < 0 ? 'down' : 'up'} />
        <StatPair label="昨连板今中位" value={premium(relayMedian)} tone={relayMedian != null && relayMedian < 0 ? 'down' : 'up'} />
        <StatPair label="失败后修复" value={failureRatio(repairCount)} tone="up" />
        <StatPair label="失败后核按钮" value={failureRatio(nukeCount)} tone="down" />
        <StatPair label="确认跌停" value={limitDownRatio} tone="down" />
      </div>
      <p className="text-[11px] text-sub">{feedback?.prev_date ?? '—'} → {feedback?.date ?? '—'} · 溢价按昨连板样本的当日涨幅计算；失败形态仅统计未进入 `promote_codes` 的昨连板。</p>

      <div>
        <p className="mb-1 text-[12px] font-medium text-txt">当前选股结果 · 接力池优先，观察池待确认</p>
        {!plan ? <p role="status" className="text-[12px] text-sub">{planQ.isPending ? '正在读取选股结果…' : '选股结果尚未发布。'}</p> : <DataTable dense rows={rows} rowKey={(row) => `${row.code}-${row.bucket ?? 'pool'}`} columns={[
          { label: '池位 / 标的', cell: (row) => <span><StockLink code={row.code}>{row.name}</StockLink><span className="ml-1 text-sub">{row.bucket === 'relay' ? `接力 ${row.relay_rank ?? '—'}` : `观察 ${row.watch_rank ?? '—'}`}</span></span> },
          { label: '板数', num: true, cell: (row) => row.boards == null ? '—' : `${row.boards}板` },
          { label: '同高度历史晋级', num: true, cell: (row) => <span>{row.history_relay_prob == null ? '—' : `${(row.history_relay_prob * 100).toFixed(1)}%`}<small className="block text-sub">样本 {row.history_relay_samples ?? '—'}</small></span> },
          { label: '预期开盘区间', num: true, cell: (row) => row.expectation?.expected_range?.length === 2 ? `${row.expectation.expected_range[0].toFixed(1)}% ~ ${row.expectation.expected_range[1].toFixed(1)}%` : '—' },
          { label: '实时涨幅', num: true, cell: (row) => <span className={pctTone(quotes[row.code]?.pct)}>{premium(quotes[row.code]?.pct)}<small className="block text-sub">选股快照 {premium(row.pct)}</small></span> },
          { label: '候选阶段 / 形态', cell: (row) => <span className="text-sub">{row.expectation?.phase ?? '—'} · {row.expectation?.seal_form ?? '—'}</span> },
        ]} />}
      </div>
      <p className="text-[10.5px] text-sub">实时反馈 {feedback?.generated_ts?.replace('T', ' ').slice(0, 19) ?? '—'}{plan ? ` · 选股文件 ${plan.generated_at_bj} · 环境晋级率 ${plan.environment?.promote_rate == null ? '—' : `${plan.environment.promote_rate.toFixed(1)}%`} · 核按钮 ${plan.environment?.nuke_count ?? '—'}` : ''}。候选未被当前反馈矩阵覆盖时实时涨幅显示“—”；历史成功率与成功/失败组溢价见下方“下一交易日”基线，避免重复占位。</p>
    </div>
  </Card>
}

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
 * ## 四份数据各管一段（⛔ 不要混读）
 *
 * | 段 | 来源 | 性质 |
 * |---|---|---|
 * | **T 当日双轴** | `marketQueries.feedback()`（30s 实时） | **事实** —— 昨涨停池今日的实际表现 |
 * | **T-3~T 历史** | `feedback.trend.history` + `emotionSummary5d`（日频 17:19） | **事实** —— 已落盘记录的聚合，零推断 |
 * | **T+1~T+4 推演** | 历史 `promotionSummary` + 决策时点 `latest.ladder` 快照 | **条件期望 / 情景** —— ⛔ 不是预测 |
 * | **选股结果** | `decisionLatest`（盘后档案，页面按行情节拍重新读取） | **原系统选股原件** —— 展示同高度晋级率与候选预期开盘区间 |
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
  // 选股结果文件盘后生成，先读入缓存，组件内继续按行情节拍发现重算结果。
  await queryClient.ensureQueryData(analyticsQueries.decisionLatest())
  // 决策时点市场快照（只取 ladder 板数分布作为 T+1 推演输入）
  await queryClient.ensureQueryData(marketQueries.latest())
  return null
}

export function Component() {
  /** 当日双轴主源 · 盘中 30s / 非交易 180s（节拍来自 `marketQueries` 的统一实现） */
  const fbQ = useQuery(marketQueries.feedback())
  /** 日频：5 日/10 日序列与拐点信号（当日 17:19 才更新） */
  const sumQ = useQuery(analyticsQueries.emotionSummary5d())
  /** 日频：分阶段成功率与溢价（T+1 条件期望的基线） */
  const promoQ = useQuery(analyticsQueries.promotionSummary())
  /** 决策时点快照：只读取连板梯队家数，不读取逐票实时量价。 */
  const latestQ = useQuery(marketQueries.latest())

  const fb = fbQ.data ?? null
  const summary = sumQ.data ?? null
  const promo = promoQ.data ?? null

  const axes = useMemo(() => buildEffectAxes(fb), [fb])
  const history = useMemo(() => buildEffectHistory(fb, summary), [fb, summary])
  const scenarios = useMemo(() => buildScenarios(fb, summary), [fb, summary])

  /** 决策时点快照只输入当前各板数家数，统计回报仍完全来自历史晋级样本。 */
  const dist = useMemo(() => boardsDistributionFromLadder(latestQ.data?.ladder), [latestQ.data?.ladder])
  const snapshot = useMemo(() => {
    const ladder = latestQ.data?.ladder ?? []
    return {
      ts: latestQ.data?.ts ?? null,
      highestBoards: ladder.length ? Math.max(...ladder.map((group) => group.boards)) : null,
    }
  }, [latestQ.data?.ladder, latestQ.data?.ts])

  const projection = useMemo(() => projectNextDay(dist, promo), [dist, promo])

  /** 情绪快照（当日定性，来自 `market_memory`）—— 只作背景，⛔ 不重算 */
  const sentiment = useMemo(() => {
    const m = fb?.sentiment_score
    return typeof m === 'number' ? `${m}/10 · ${fb?.sentiment_label ?? '—'}` : '—'
  }, [fb])

  // 快照缺失只影响条件期望；既有反馈和历史模块仍可照常展示。
  const err = fbQ.error ?? sumQ.error ?? promoQ.error

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

      <SelectionLogicSection feedback={fb} snapshot={latestQ.data} />

      {/* 第一步是今日事实，第二步用决策时点快照与历史基线形成条件期望。 */}
      <div className="flex gap-3 items-start max-xl:flex-col">
        <div className="xl:w-[60%] xl:flex-none min-w-0 flex flex-col gap-3">
          <Card title="① 今天：赚钱回报与亏钱压力" extra={<CardBadge>实时反馈</CardBadge>}>
            <EffectAxesCard axes={axes} />
          </Card>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <Card
            title="② 下一交易日：当前连板结构的历史条件期望"
            extra={<CardBadge>条件期望 · 非预测</CardBadge>}
          >
            <NextDayProjectionCard projection={projection} snapshot={snapshot} />
          </Card>
        </div>
      </div>

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
