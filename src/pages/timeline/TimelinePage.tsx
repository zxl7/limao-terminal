import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type {
  DecisionDossier,
  HithinkZtFile,
  MarketMemory,
  ZtHistoryDay,
} from '@/shared/api'
import {
  analyticsQueries,
  buildThemeBursts,
  buildTimeline,
  buildTimelineSlots,
  BURST_MIN_STOCKS,
  BURST_WINDOW_MIN,
  cumulativeByMarks,
  fbtMin,
  fileDate,
  groupTimelineSlots,
  isLowStrengthSlot,
  LINKAGE_MIN_SECTORS,
  SLOT_HEIGHT,
  SLOT_VISIBLE_SECTORS,
  MARKS,
  minToClock,
  SegTabs,
  SHAPE_META,
  StatPair,
  TimelineLinkageCard,
  TimelineMergedCard,
  TimelineSlotCard,
  type SectorNode,
  type ThemeBurstResult,
  type TimelineSlot,
} from '@/features/analytics'
import { Card, CardBadge, LineChart, type LineSeries } from '@/shared/ui'
import { cn, isStarMarket } from '@/shared/lib'

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
   * 盘中逐事件（`intraday_timeline_<date>.jsonl`）—— ⛔ 只取**与所选日期同一天**的事件：
   * 跨日并入会让历史日混进今天的盘中记录（串线）。历史日没有该日志 → 自然为空。
   */
  const itEvents = useMemo(() => {
    const all = itQ.data ?? []
    if (!day?.date) return []
    const d = String(day.date).replace(/-/g, '')
    return all.filter((e) => String(e.at ?? '').slice(0, 10).replace(/-/g, '') === d)
  }, [itQ.data, day])

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

  /** 题材层事件条数（rise + switch + plunge）—— 用于卡面「数据基准」说明 */
  const themeEventCount = bursts.themedCount + bursts.riskCount

  /** 题材级风险：同板块可能在多条事件里重复出现，合并后展示 */
  const riskSectors = useMemo(() => {
    const tally = new Map<string, number>()
    for (const r of bursts.risks) {
      for (const s of r.sectors) tally.set(s, (tally.get(s) ?? 0) + 1)
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [bursts.risks])

  const curve = useMemo<LineSeries[]>(() => {
    const mins = visible.map((s) => fbtMin(s.fbt)).filter((x): x is number => x != null)
    return [{ name: '累计涨停', values: cumulativeByMarks(mins, MARKS), tone: 'up', area: true }]
  }, [visible])

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
      {/* ── ⛔ 数据基准声明：本页**不是实时**，必须说清楚 ── */}
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
            value={isFullDay ? `${visible.length} 只` : '待收盘'}
            tone={isFullDay ? 'up' : undefined}
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

        {/* ── ⛔ 数据基准声明（用户 2026-09-17 两次核实「是不是实时 / 9-17 去哪了」）── */}
        <div className="mt-2 rounded-[var(--radius-sm)] border border-warn/40 bg-warn-soft px-2 py-1.5 text-[11.5px] leading-relaxed text-sub">
          {isFullDay ? (
            <>
              <span className="text-warn font-semibold">⚠️ 完整交易日数据（收盘口径）。</span>{' '}
              个股首封时刻 `fbt` 来自**完整涨停池**，只有收盘后才落盘 → 个股/板块的**分钟定位**是收盘数据，
              **盘中不刷新**。
            </>
          ) : (
            <>
              <span className="text-warn font-semibold">⚠️ 盘中当日：题材实时、个股待收盘。</span>{' '}
              今日归档**尚无涨停池**（`zt_list` 收盘后才写）→ 个股没有首封时刻 `fbt`，
              **个股/板块的分钟定位今日暂缺**；但**题材爆发/衰竭/推送是实时落盘的**
              （来自 `market_memory_{day?.date ?? '—'}.json`），下方时间轴按观测时刻如实呈现。
            </>
          )}
          <br />
          <span className="text-txt">
            数据源：`zt_history/{day?.date ?? '—'}.json`
            {isFullDay ? `（涨停 ${visible.length} 只）` : '（仅采样点·无涨停池）'}
            ＋ `market_memory_{day?.date ?? '—'}.json`（题材事件 {themeEventCount} 条 · 推送台账）
          </span>
        </div>

        <div className="mt-3 border-t border-line-faint pt-2">
          <LineChart
            series={curve}
            labels={MARKS.map(minToClock)}
            height={160}
            zeroBased
            format={(v) => String(Math.round(v))}
            dotThreshold={20}
          />
          <div className="text-sub text-[11px] mt-1 leading-relaxed">
            按首封时刻（`fbt`）累计的涨停推进曲线 —— 图上折点即「资金开始打」的时刻。科创板 688/689
            已按无权限剔除。盘中看它是**累积值**，不是当日最终值。
          </div>
        </div>
      </Card>

      {/* ── 🚀 题材爆发（主口径）：直接回答「哪几条题材线在爆发」── */}
      <Card
        title="🚀 题材爆发 · 题材级（主口径）"
        extra={<CardBadge tone="up">{bursts.themes.length} 条题材线</CardBadge>}
      >
        <div className="text-sub text-[11px] leading-relaxed mb-2">
          题材名 / 涨停家数 / 龙头**取自原系统 `event_log` 的现成结论**，本页只解析不重算。
          ⚠️ 时点是**卡片生成时刻**（系统何时说的），不是事件发生时刻。
          个股题材归属来自决策档案的 `hot_spots`，当日仅覆盖一部分涨停票 —— **无标记 ≠ 无题材**。
        </div>

        {bursts.themes.length === 0 ? (
          <div className="text-sub text-[12px] py-2">
            当日 `event_log` 里没有题材级事件（系统未识别出新主线或龙头易主）
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
                  {t.switchCount > 0 && (
                    <span className="text-[10.5px] px-1 rounded-sm bg-line-faint text-sub">
                      🔁 龙头易主 {t.switchCount} 次
                    </span>
                  )}
                  {t.riseCount != null && (
                    <span className="num text-[12px] text-up">{t.riseCount} 只涨停</span>
                  )}
                  <span className="num text-[11px] text-sub">
                    {minToClock(t.at)}~{minToClock(t.to)} 系统观测
                  </span>
                  {t.pushCount != null && (
                    <span className="num text-[11px] text-sub">推送 {t.pushCount} 次</span>
                  )}
                </div>

                {/* 龙头链 —— 反复易主是真实信息（题材内部分歧），当前龙头高亮 */}
                <div className="flex items-baseline gap-2 flex-wrap text-[12px]">
                  <span className="text-[10.5px] text-sub flex-none">龙头</span>
                  {t.leaders.map((l, i) => (
                    <span key={l} className="inline-flex items-baseline gap-1">
                      {i > 0 && <span className="text-sub">→</span>}
                      <span
                        className={cn(
                          l === t.currentLeader ? 'text-lead font-semibold' : 'text-sub',
                        )}
                      >
                        {l === t.currentLeader && '👑 '}
                        {l}
                      </span>
                    </span>
                  ))}
                </div>

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
                ⚠️ 题材级风险（原系统「关注板块集体重挫」）
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

      {/* ── 主体：三类展示分块（联动聚合 / 普通独立 / 低频合并 · 按时间左→右换行）── */}
      <Card
        title="时间轴（三类展示）"
        extra={<CardBadge>{blocks.length} 张卡 · {slots.length} 个时刻槽</CardBadge>}
      >
        <div className="text-sub text-[11px] leading-relaxed mb-2">
          按信号强度分三类展示，⛔ **不再每分钟一张卡**：
          <span className="text-up"> 🚀 板块联动</span>（同刻 ≥{LINKAGE_MIN_SECTORS} 个板块各达{' '}
          {BURST_MIN_STOCKS} 只封板 → 聚合成一张、底色更深、**不受低频合并延迟**）｜
          <span className="text-txt"> 普通卡</span>（含个股但未达联动门槛 → 逐个时刻平铺，不冠「爆发」）｜
          <span className="text-sub"> 📎 低频合并</span>（连续若干分钟仅有消息 → 合并一张，标明板块数与名称）。
          <br />
          卡面**固定高 {SLOT_HEIGHT}px**、内容超出**卡内下拉**（⛔ 不裁剪数据）；卡内板块**按强度降序**
          （当刻封板家数 → 组内最高板 → 全天总数），**直接展示最强 {SLOT_VISIBLE_SECTORS} 个**，
          其余在标注后下拉可见。时刻固定在卡头，不随滚动消失。
          ⚠️ 联动口径（时间窗口 / 板块数下限 / 是否要求同题材关系）**待确认**，暂按最保守的可推导口径。
        </div>
        {/* ⛔ 该日无个股数据（当日归档未落涨停池）→ 在轴内就地说明，避免误判「数据丢了」。
            ⚠️ 放在卡片流**之外**：它是说明块、不是时间轴卡，混进等高卡片会破坏规整。 */}
        {!isFullDay && (
          <div className="mb-2 rounded-[var(--radius-sm)] border border-warn/40 bg-warn-soft p-2.5 text-[11.5px] leading-relaxed text-sub">
            <div className="text-warn font-semibold">该日暂无个股数据（不是丢数据）</div>
            <div className="mt-1">
              `zt_list`（含个股**首封时刻**）**收盘后**才写入归档，因此盘中当日
              **没有个股、也没有板块的时间定位**；本轴此刻呈现的是**题材级事件**（实时落盘）。
            </div>
            <div className="mt-1 text-txt">
              想看**当日实时个股**（领涨/涨停清单）请到「**盘中实时**」页；
              本页在**收盘后**会自动补全当日的个股与板块时间定位。
            </div>
          </div>
        )}
        {/* ── 横向卡片流：左→右铺开、满了自动换行（⛔ 不用 grid —— grid 会把同一行的
            卡片拉成等高，短卡下方留大片空白，正是「看起来被拉长」的原因）──
            ⚠️ 卡片**固定高 240px**（2026-09-17）→ 即便用 flex 也天然等高，换行后行列整齐。 */}
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
      </Card>

      {/* ── 行业级集群（辅口径）：题材榜之外的完整视角 · ⛔ 全天汇总，非时间定位 ── */}
      <Card
        title="行业级集群（辅口径 · 全天汇总）"
        extra={<CardBadge>{tally.sectorTotal} 个行业</CardBadge>}
      >
        <div className="text-sub text-[11px] leading-relaxed">
          `zt_list.sector` 是**行业**（通信设备 / 化学制品），不是炒作题材 —— 只用来给每只票一个
          100% 覆盖的坐标。判定口径：同行业 **{BURST_WINDOW_MIN} 分钟**内 ≥ **{BURST_MIN_STOCKS} 只**
          封板 = 🚀 爆发；达家数但跨度更大 = 〰 扩散（全天反复有人来打）。
          ⛔ 行业口径**回答不了「哪条题材在爆发」**，故降为辅助。
          ⛔⛔ 这是**全天汇总**，不在时间轴上定位任何一只票；下面每行是该行业全天的首末跨度与总量，
          切勿把它当成「某一分钟当刻爆发」。
        </div>
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
          <div className="text-sub text-[11.5px] mb-1.5 leading-relaxed">
            这些票在涨停池里但 `fbt`（首封时刻）缺失，**无法定位到时间轴上**。
            如实列出而不是丢弃 —— 丢弃会让页面涨停数与原系统对不上。
          </div>
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
