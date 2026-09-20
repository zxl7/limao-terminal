import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type {
  DecisionDossier,
  HithinkZtFile,
  IntradayTimelineEvent,
  MarketMemory,
  ZtHistoryDay,
} from '@/shared/api'
import {
  analyticsQueries,
  buildThemeBursts,
  buildTimeline,
  buildTimelineSlots,
  buildLimitSeries,
  cumulativeByMarks,
  fbtMin,
  fileDate,
  groupTimelineSlots,
  isLowStrengthSlot,
  MARKS,
  minToClock,
  pickLiveBasis,
  SegTabs,
  SHAPE_META,
  StatPair,
  TimelineLinkageCard,
  TimelineMergedCard,
  TimelineSlotCard,
  TimelineSnake,
  type SectorNode,
  type ThemeBurstResult,
  type TimelineSlot,
} from '@/features/analytics'
import { Card, CardBadge, LineChart, type LineSeries } from '@/shared/ui'
import { cn, inTrading, isStarMarket, round2 } from '@/shared/lib'
import { useNow } from '@/shared/hooks'

/**
 * 日内炒作时间轴 —— **严格按时间顺序**的一条轴，节点是「板块块 / 单票 / 事件 / 推送」。
 *
 * ## 两套口径，主次分明（本页最重要的设计决定）
 *
 * | 口径 | 来源 | 覆盖 | 角色 |
 * |---|---|---|---|
 * | **题材级** | 原系统 `event_log` 的现成结论（题材名 + 家数 + 龙头） | 少而准 | **主** —— 回答「哪几条线在爆发」 |
 * | 行业级 | `zt_list.sector` | 100% | 辅 —— 给每只票一个坐标 |
 *
 * **为什么题材级为主**：A 股的炒作单位是**题材**（光通信 / PCB板 / 福建自贸），不是行业。
 * 行业口径今天把 86 只摊进 42 个行业，30 分钟窗口只归纳出 2 次爆发 —— 因为炒作从不在行业层面发生。
 * 而原系统其实**早就算好了题材级结论**（`新主线崛起：光通信 涨停7只，龙头 华脉科技`），只是从没被展示。
 *
 * ## ⛔ 三处必须如实说明的边界
 *
 * 1. **时点是卡片生成时刻**，不是事件发生时刻（实测 19 条里 6 条同标 10:57 = 一张卡一口气报 6 件事）
 * 2. **题材成员覆盖不全** —— `hot_spots` 只命中约 20% 涨停票，**无标记 ≠ 无题材**
 * 3. **行业 ≠ 题材** —— 板块块上标的是行业，不得说成炒作题材
 *
 * ## 只放盘面事实
 *
 * 不含 `intraday_points`（采样）与 `audit.jsonl`（留痕）—— 用户 2026-09-16 明确不要。
 * 逻辑在 `features/analytics/lib/{timeline,theme-burst}.ts`（纯函数 · 均有回归锁）。
 */

/** 节点标记与语义色（已上移到分析域 barrel，统一来源） */

/** 取序列最后一个非 null 值（实时指标卡的「最新值」） */
function lastNum(a: Array<number | null | undefined>): number | null {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i] as number
  return null
}

export async function loader() {
  await Promise.all([
    queryClient.ensureQueryData(analyticsQueries.emotionZtHistory()),
    queryClient.ensureQueryData(analyticsQueries.emotionMemory()),
    queryClient.ensureQueryData(analyticsQueries.ztYesterday()),
    queryClient.ensureQueryData(analyticsQueries.decisionLatest()),
    queryClient.ensureQueryData(analyticsQueries.hithinkZt()),
  ])
  return null
}

export function Component() {
  const hist = useQuery(analyticsQueries.emotionZtHistory())
  const memQ = useQuery(analyticsQueries.emotionMemory())
  const yztQ = useQuery(analyticsQueries.ztYesterday())
  const dosQ = useQuery(analyticsQueries.decisionLatest())
  const hzQ = useQuery(analyticsQueries.hithinkZt())
  /** 📡 盘中情绪时间轴（当日逐事件 · 双向 · 实时轮询） */
  const itQ = useQuery(analyticsQueries.intradayTimeline())
  const [dayFile, setDayFile] = useState('')
  /**
   * 时间轴排版（2026-09-17）：`snake` = 蛇形折线（默认，一条线横走→弯→反向）；
   * `cards` = 卡片流（原版）。⛔ 两视图共用同一批分块与排序内核，切换不改结论。
   */
  const [view, setView] = useState<'snake' | 'cards'>('snake')

  const days = useMemo(
    () =>
      (hist.data ?? [])
        .filter((f) => !!f.data)
        .slice()
        .sort((a, b) => b.file.localeCompare(a.file)),
    [hist.data],
  )
  /**
   * ⛔⛔ 日期选择：**包含今天**，但区分「完整交易日」与「盘中当日」。
   *
   * 实测（2026-09-17 盘中）：
   *   · 今日归档 `zt_history/zt_<今日>.json` **只有 `intraday_points`，没有 `zt_list`**
   *     → **个股没有首封时刻 `fbt`**，无法做分钟定位（`zt_list` 收盘后才落盘）；
   *   · 但今日的 **题材/事件/推送是实时的**（`market_memory_<今日>.json` 当日即写）。
   *
   * 所以**不能因为「没有涨停池」就把今天整条挡掉** —— 那会把用户最想看的
   * 「今天每个时间节点哪些题材爆发/衰竭」一起藏起来（用户 2026-09-17 抓包「9月17的都不见了」）。
   * 正确做法：**今天照常可选**，个股/板块部分缺 `fbt` 就如实标注为「待收盘落盘」。
   */
  /** 有涨停池 = 该日个股才**有首封时刻、可做时间定位** */
  const hasPool = (d?: ZtHistoryDay | null): boolean => (d?.zt_list?.length ?? 0) > 0

  /**
   * 默认选中：优先「**有个股数据**的最近一天」，其次才是最新一天。
   *
   * ⛔ 盘中当日的归档没有涨停池（`zt_list` 收盘后才写）→ 若默认就选它，
   * 用户打开页面会看到**一整片没有个股**的时间轴，误以为「个股数据不见了」
   * （2026-09-17 用户两次抓包）。今天仍**照常可选**（标 `·盘`），只是不作为默认。
   */
  const day: ZtHistoryDay | null | undefined =
    days.find((f) => f.file === dayFile)?.data ??
    days.find((f) => hasPool(f.data))?.data ??
    days[0]?.data

  /** 该日是否「完整交易日」（含涨停池 → 个股有首封时刻可定位） */
  const isFullDay = hasPool(day)

  /**
   * 全部盘中逐事件（近 5 个交易日 · 路由已摊平为事件数组）。
   *
   * ⚠️ 2026-09-19 前该路由是 `mode:'latest'`（只吐**最新一天**的文件），
   *    下面「按所选日期过滤」必然得到空集 → 曲线永远退化成盘后单线（用户抓包「只看到涨停」）。
   */
  const itAll = useMemo<IntradayTimelineEvent[]>(() => itQ.data ?? [], [itQ.data])

  /**
   * 选中日的逐事件（**时间轴本体**用）—— ⛔ 只取与所选日期同一天：
   * 跨日并入会让历史日混进今天的盘中记录（串线）。历史日没有该日志 → 自然为空。
   */
  const itEvents = useMemo(() => {
    if (!day?.date) return []
    const d = String(day.date).replace(/-/g, '')
    return itAll.filter((e) => String(e.at ?? '').slice(0, 10).replace(/-/g, '') === d)
  }, [itAll, day])

  /**
   * 📈 推进曲线基准日 = 最近一个「盘中窗口内有事件」的交易日（纯函数 · 有回归锁）。
   *
   * ⛔ 为什么不跟「选中日」联动：盘中当日归档**没有涨停池**（`zt_list` 收盘后才写），
   *    页面默认选中日会退到「上一个有池的交易日」= 昨天。曲线若跟着选中日走，
   *    盘中看到的永远是**昨天**的曲线 —— 与「实时」相悖（用户 2026-09-19 要求实时）。
   *    故曲线独立取「最近的盘中日」：交易时段 = 今天（30s 轮询 · 实时）；
   *    非交易时段 = 最近一个交易日的完整盘中（并标注基准日）。
   */
  const chartBasis = useMemo(() => pickLiveBasis(itAll), [itAll])

  /**
   * 涨停全量：优先本日归档的 `zt_list`；归档残缺且恰是「今天」时，
   * 回落到 `yesterday_zt.json` —— 它写的是**当日收盘**全量
   * （命名里的 yesterday 指「给下一个交易日用」）。
   */
  const stocks = useMemo(() => {
    const own = day?.zt_list ?? []
    if (own.length > 0) return own
    const y = yztQ.data
    if (y && day && (y.date === day.date || y.date_raw === day.date?.replace(/-/g, ''))) {
      return y.zt_list ?? []
    }
    return []
  }, [day, yztQ.data])

  /** ⛔ 科创板无交易权限 —— 全页统一剔除 */
  const visible = useMemo(() => stocks.filter((s) => !isStarMarket(s.code)), [stocks])

  const mem: MarketMemory | null | undefined = useMemo(() => {
    const list = (memQ.data ?? []).filter((f) => !!f.data)
    // ⛔ 只取与选中日期一致的记忆；**不再 fallback 到其他日期**——
    // 否则切换历史天会被「最新一天」的 event_log / 推送台账污染（串线）。
    return list.find((f) => f.data?.date === day?.date)?.data ?? undefined
  }, [memQ.data, day])

  /** 决策档案里按日落盘的题材成员表（`real_env.hot_spots`） */
  const hotSpots = useMemo(() => {
    const f: DecisionDossier | undefined = dosQ.data
    // ⛔ 仅当决策档案的日期 == 选中日期才采用，避免历史天被「今日」的题材成员表污染
    if (!f || !day?.date || f.date !== day.date) return []
    return f.real_env?.hot_spots ?? []
  }, [dosQ.data, day])

  /**
   * 逐票「涨停原因」（同花顺）。
   * ⚠️ 自由文本 —— 只作逐票说明，**不作聚类键**（实测 86 只里 78 个不同首 token，91% 仅出现一次）。
   */
  const reasonByCode = useMemo(() => {
    const map = new Map<string, string>()
    const files = (hzQ.data ?? []) as Array<{ data?: HithinkZtFile }>
    const f = files.find((x) => x.data?.date === day?.date)?.data
    for (const it of f?.items ?? []) {
      if (it.code && it.reason) map.set(String(it.code).padStart(6, '0'), it.reason)
    }
    return map
  }, [hzQ.data, day])

  /** 时间轴节点（纯函数 · 单测锁「不丢不重」+「时间升序」） */
  const { nodes, looseStocks } = useMemo(
    () =>
      buildTimeline({
        stocks: visible,
        events: mem?.event_log ?? [],
        pushes: mem?.pushed_topics ?? [],
      }),
    [visible, mem],
  )

  /**
   * 展示投影：把「整个行业全天」的聚类**重投到分钟槽**——
   * 每只票按自己的首封分钟落点，纠正「后封的票被提前到最早时刻」的串线。
   * 不改 `buildTimeline` 的任何业务口径。
   */
  const slots: TimelineSlot[] = useMemo(
    () => buildTimelineSlots(nodes, itEvents),
    [nodes, itEvents],
  )

  /**
   * 三类展示分块（2026-09-17）：联动聚合 / 普通独立 / 低频合并。
   * ⚠️ 传入**题材感知**的低强度判定：含题材爆发/易主/衰竭的槽**不得合并** ——
   * 否则「盘中无个股的日子」会整日塌成一张合并卡，与有股的日子看着像两套设计。
   */
  const blocks = useMemo(() => groupTimelineSlots(slots, isLowStrengthSlot), [slots])

  /** 题材级爆发 + 个股题材标记（纯函数 · 单测锁「每条事件恰好归入一处」） */
  const bursts: ThemeBurstResult = useMemo(
    () =>
      buildThemeBursts({
        events: mem?.event_log ?? [],
        pushes: mem?.pushed_topics ?? [],
        hotSpots,
        stocks: visible,
      }),
    [mem, hotSpots, visible],
  )

  /** 题材层事件条数（rise + switch + plunge）—— 用于计数与空态判断 */
  const themeEventCount = bursts.themedCount + bursts.riskCount

  /** 题材级风险：同板块可能在多条事件里重复出现，合并后展示 */
  const riskSectors = useMemo(() => {
    const tally = new Map<string, number>()
    for (const r of bursts.risks) {
      for (const s of r.sectors) tally.set(s, (tally.get(s) ?? 0) + 1)
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [bursts.risks])

  /** 实时「涨停 / 跌停 / 炸板率」时间序列（盘中情绪时间轴 · 30s 轮询 → 动态） */
  const limitSeries = useMemo(() => buildLimitSeries(chartBasis?.events ?? []), [chartBasis])
  const hasLive = limitSeries.zt.some((v) => v != null)
  /**
   * 是否正处交易时段 —— 决定曲线标「🔴 盘中实时」还是「最近交易日」。
   *
   * ⚠️ 时段判定走 `shared/lib/marketTime` 单一实现；用 `useNow` 驱动而不是直接
   *    `inTrading()`：React Compiler 会把**无参纯调用**当常量折叠，直接调会永远停在首帧。
   */
  const now = useNow(30_000)
  const liveNow = inTrading(undefined, now)
  const curve = useMemo<LineSeries[]>(() => {
    if (hasLive) {
      return [
        { name: '涨停', values: limitSeries.zt, tone: 'up' },
        { name: '跌停', values: limitSeries.ld, tone: 'down' },
        { name: '炸板率', values: limitSeries.brokenRate, tone: 'rec', axis: 'right', format: (v) => `${round2(v)}%` },
      ]
    }
    // 回退：无实时数据但有盘后涨停池 → 累计涨停单线（旧行为，避免旧交易日图表退化）
    const mins = visible.map((s) => fbtMin(s.fbt)).filter((x): x is number => x != null)
    return [{ name: '累计涨停', values: cumulativeByMarks(mins, MARKS), tone: 'up', area: true }]
  }, [hasLive, limitSeries, visible])

  /** 行业级集群（辅口径）—— 各栏保留，但明确标为辅助 */
  const tally = useMemo(() => {
    const sectors = nodes.filter((n): n is SectorNode => n.kind === 'sector')
    return {
      burst: sectors.filter((s) => s.shape === 'burst'),
      spread: sectors.filter((s) => s.shape === 'spread'),
      pair: sectors.filter((s) => s.shape === 'pair'),
      single: nodes.filter((n) => n.kind === 'single').length,
      sectorTotal: sectors.length,
    }
  }, [nodes])

  /** 单票不再做全日合并：投影后每只单票按自己的首封分钟落到对应槽，
   *  由 `buildTimelineSlots` + `TimelineSlotCard` 负责「仅同分钟合并」。 */

  const topBoard = visible.reduce((m, s) => Math.max(m, s.boards), 0)
  const firstMin = visible
    .map((s) => fbtMin(s.fbt))
    .filter((x): x is number => x != null)
    .reduce<number | null>((m, v) => (m == null || v < m ? v : m), null)

  return (
    <div className="flex flex-col gap-3">
      {/* ── ⛔ 数据基准声明：顶部曲线 = 盘中实时（最近盘中日 · 30s 刷新）；下方时间轴 = **所选日**盘面，非实时 ── */}
      {/* ── 通栏：当日定性 + 推进曲线 ── */}
      <Card
        title="🕒 日内炒作时间轴"
        extra={
          <div className="flex items-center gap-2">
            {days.length > 1 && (
              <SegTabs
                items={days
                  .slice(0, 8)
                  .map((f) => ({
                    key: f.file,
                    // 盘中当日尚无涨停池 → 加「·盘」标记，提示该日个股待收盘
                    label:
                      (f.data?.zt_list?.length ?? 0) > 0
                        ? fileDate(f.file).slice(5)
                        : `${fileDate(f.file).slice(5)}·盘`,
                  }))}
                value={days.find((f) => f.data === day)?.file ?? ''}
                onChange={setDayFile}
              />
            )}
            <CardBadge>{day?.date ?? '—'}</CardBadge>
          </div>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <StatPair
            label="涨停家数"
            value={
              hasLive && lastNum(limitSeries.zt) != null
                ? `${lastNum(limitSeries.zt)} 只`
                : isFullDay
                  ? `${visible.length} 只`
                  : '待收盘'
            }
            tone={hasLive && lastNum(limitSeries.zt) != null ? 'up' : isFullDay ? 'up' : undefined}
          />
          <StatPair
            label="跌停家数"
            value={hasLive && lastNum(limitSeries.ld) != null ? `${lastNum(limitSeries.ld)} 只` : '—'}
            tone={hasLive && lastNum(limitSeries.ld) != null ? 'down' : undefined}
          />
          <StatPair
            label="炸板率"
            value={hasLive && lastNum(limitSeries.brokenRate) != null ? `${round2(lastNum(limitSeries.brokenRate)!)}%` : '—'}
            tone="rec"
          />
          <StatPair label="最高板" value={isFullDay ? `${topBoard} 板` : '—'} tone="rec" />
          <StatPair
            label="最早首封"
            value={isFullDay && firstMin != null ? minToClock(firstMin) : '—'}
            tone="rec"
          />
          <StatPair label="题材线" value={`${bursts.themes.length} 条`} tone="up" />
          <StatPair label="时刻槽" value={`${slots.length} 个`} />
          <StatPair label="题材事件" value={`${themeEventCount} 条`} />
        </div>

        <div className="mt-3 border-t border-line-faint pt-2">
          {/* 📈 曲线基准声明 —— 用户 2026-09-19 抓包「不知道是不是实时的、只看到涨停」 */}
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[10.5px] text-sub">📈 情绪推进 · 涨停 / 跌停 / 炸板率</span>
            {hasLive && chartBasis && (
              <span className={cn('text-[10.5px]', liveNow ? 'text-txt font-semibold' : 'text-sub')}>
                {liveNow ? '🔴 盘中实时' : '最近交易日'} · {chartBasis.date.slice(5)} 盘中
                {liveNow ? ' · 30s 刷新' : ''}
              </span>
            )}
            {!hasLive && (
              <span className="text-[10.5px] text-sub">无盘中逐事件 → 回退「盘后累计涨停」单线</span>
            )}
          </div>
          <LineChart
            series={curve}
            labels={limitSeries.labels}
            height={160}
            zeroBased
            format={(v) => String(Math.round(v))}
            dotThreshold={20}
          />
        </div>
      </Card>

      {/* ── 🚀 题材爆发（主口径）：直接回答「哪几条题材线在爆发」── */}
      <Card
        title="🚀 题材爆发"
        extra={<CardBadge tone="up">{bursts.themes.length} 条题材线</CardBadge>}
      >

        {bursts.themes.length === 0 ? (
          <div className="text-sub text-[12px] py-2">
            当日 `event_log` 里没有题材级事件
          </div>
        ) : (
          <div className="flex flex-row">
            {bursts.themes.map((t) => (
              <div
                key={t.theme}
                className="flex flex-col gap-0.5 py-1.5 border-b border-line-faint last:border-0"
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-txt">{t.theme}</span>
                  {t.isNewMainline && (
                    <span className="text-[10.5px] px-1 rounded-sm bg-up-soft text-up">
                      🚀 新主线崛起
                    </span>
                  )}
                  {t.riseCount != null && (
                    <span className="num text-[12px] text-up">{t.riseCount} 只涨停</span>
                  )}
                  {/* ⛔ 观测**时刻序列**，不用「at~to 区间」—— 区间说不清几点爆的、后面几点又动过 */}
                  <span className="text-[10.5px] text-sub flex-none">观测</span>
                  <span className="text-[11.5px] flex items-baseline gap-1 flex-wrap">
                    {t.points.map((pt, i) => (
                      <span
                        // eslint-disable-next-line react/no-array-index-key -- 同题材同一分钟可有多条，索引即身份
                        key={`${pt.at}#${i}`}
                        className={cn('num', pt.kind === 'rise' ? 'text-up font-semibold' : 'text-txt')}
                      >
                        {i > 0 && <span className="text-sub">→ </span>}
                        {minToClock(pt.at)}
                        {pt.kind === 'rise' && ' 🚀'}
                      </span>
                    ))}
                  </span>
                  <span className="num text-[10.5px] text-sub">共 {t.points.length} 次</span>
                  {t.pushCount != null && (
                    <span className="num text-[11px] text-sub">推送 {t.pushCount} 次</span>
                  )}
                </div>

                {/* ⛔ 只显示**当前**龙头 —— 不显示「A → B → C」链条：
                    那个链条表达的是「龙头易主」这一概念，而系统那条事件只是
                    「每轮重算板块领涨股导致的机械换人」（实测会在同一小撮票之间来回跳）。 */}
                {t.currentLeader && (
                  <div className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-[10.5px] text-sub flex-none">龙头</span>
                    <span className="text-lead font-semibold">👑 {t.currentLeader}</span>
                  </div>
                )}

                {t.catalyst && <div className="text-[11.5px] text-txt">催化：{t.catalyst}</div>}
                {t.members.length > 0 && (
                  <div className="text-[11.5px] text-sub">
                    当日涨停成员：{t.members.map((m) => m.name).join('、')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {riskSectors.length > 0 && (
          <div className="mt-2 pt-2 border-t border-line-faint">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[10.5px] text-sub flex-none">
                ⚠️ 题材级风险
              </span>
              {riskSectors.map(([s, n]) => (
                <span key={s} className="text-[11.5px] text-down">
                  {s}
                  {n > 1 && <span className="num text-[10px] text-sub ml-0.5">×{n}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── 主体：三类展示分块（联动聚合 / 普通独立 / 低频合并）
          ⚠️ 两种排版（2026-09-17）：🐍 蛇形轴（默认 · 一条线横走→弯→反向）｜🃏 卡片流（原版）
          ⛔ 两者**同一批分块、同一批排序内核** —— 切视图只改呈现，不改任何结论。── */}
      <Card
        title="时间轴"
        extra={
          <div className="flex items-center gap-2">
            <SegTabs
              items={[
                { key: 'snake', label: '时间轴' },
                { key: 'cards', label: '卡片流' },
              ]}
              value={view}
              onChange={(k) => setView(k as 'snake' | 'cards')}
            />
            <CardBadge>
              {blocks.length} 张卡 · {slots.length} 个时刻槽
            </CardBadge>
          </div>
        }
      >
        {/* ── 🐍 蛇形轴（默认）：一条线横走 → 弯 → 反向横走；悬停节点即出完整明细（无需点击）── */}
        {view === 'snake' ? (
          <TimelineSnake
            blocks={blocks}
            topBoard={topBoard}
            tags={bursts.tags}
            reasonByCode={reasonByCode}
          />
        ) : (
          <>
            {/* ── 🃏 卡片流（原版 · 保留为可逆视图）：左→右铺开、满了自动换行
                （⛔ 不用 grid —— grid 会把同一行的卡片拉成等高，短卡下方留大片空白）
                ⚠️ 卡片**固定高 240px** → 即便用 flex 也天然等高，换行后行列整齐。 */}
            <div className="flex flex-wrap items-start content-start gap-3 min-w-0">
              {blocks.map((b) =>
                b.kind === 'linkage' ? (
                  <TimelineLinkageCard
                    key={b.key}
                    block={b}
                    topBoard={topBoard}
                    tags={bursts.tags}
                    reasonByCode={reasonByCode}
                  />
                ) : b.kind === 'merged' ? (
                  <TimelineMergedCard
                    key={b.key}
                    block={b}
                    topBoard={topBoard}
                    tags={bursts.tags}
                    reasonByCode={reasonByCode}
                  />
                ) : (
                  <TimelineSlotCard
                    key={b.key}
                    slot={b.slot}
                    topBoard={topBoard}
                    tags={bursts.tags}
                    reasonByCode={reasonByCode}
                  />
                ),
              )}
            </div>
            {blocks.length === 0 && (
              <div className="text-sub text-[12px] py-2">当日无可定位到分钟的记录</div>
            )}
          </>
        )}
      </Card>

      {/* ── 行业级集群（辅口径）：题材榜之外的完整视角 · ⛔ 全天汇总，非时间定位 ── */}
      <Card
        title="行业级集群"
        extra={<CardBadge>{tally.sectorTotal} 个行业</CardBadge>}
      >
        <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
          <span className={cn('text-[12.5px]', SHAPE_META.burst.cls)}>
            🚀 爆发 {tally.burst.length}
          </span>
          <span className={cn('text-[12.5px]', SHAPE_META.spread.cls)}>
            〰 扩散 {tally.spread.length}
          </span>
          <span className="text-[12.5px] text-sub">· 成对 {tally.pair.length}</span>
          <span className="text-[12.5px] text-sub">单票 {tally.single} 只</span>
        </div>
        {tally.burst.length + tally.spread.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {[...tally.burst, ...tally.spread].map((s) => (
              <div key={s.sector} className="flex items-baseline gap-2 text-[12px]">
                <span className={cn('flex-none', SHAPE_META[s.shape].cls)}>
                  {SHAPE_META[s.shape].icon}
                </span>
                <span className="text-txt font-semibold flex-none">{s.sector}</span>
                <span className="num text-sub flex-none">{s.stocks.length} 只</span>
                <span className="num text-sub flex-none">
                  {minToClock(s.at)}→{minToClock(s.to)}
                </span>
                <span className="num text-sub flex-none">跨 {s.to - s.at} 分</span>
                <span className="text-sub truncate">
                  {s.shape === 'burst' ? '短时集群封板' : '全天持续有新票加入'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {looseStocks.length > 0 && (
        <Card title="无时间坐标" extra={<CardBadge tone="warn">{looseStocks.length} 只</CardBadge>}>
          <div className="flex flex-wrap gap-x-2.5 gap-y-1">
            {looseStocks.map((s) => (
              <span key={s.code} className="text-[12px] text-txt">
                {s.name}
                <span className="num text-sub ml-1">{s.boards}板</span>
                <span className="text-sub ml-1">{s.sector}</span>
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
