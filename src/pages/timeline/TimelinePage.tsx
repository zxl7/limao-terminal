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
  MARKS,
  minToClock,
  SegTabs,
  SHAPE_META,
  SLOT_GAP,
  SLOT_WIDTH,
  StatPair,
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
  const [dayFile, setDayFile] = useState('')

  const days = useMemo(
    () =>
      (hist.data ?? [])
        .filter((f) => !!f.data)
        .slice()
        .sort((a, b) => b.file.localeCompare(a.file)),
    [hist.data],
  )
  const day: ZtHistoryDay | null | undefined =
    days.find((f) => f.file === dayFile)?.data ?? days[0]?.data

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
  const slots: TimelineSlot[] = useMemo(() => buildTimelineSlots(nodes), [nodes])

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
      {/* ── 通栏：当日定性 + 推进曲线 ── */}
      <Card
        title="🕒 日内炒作时间轴"
        extra={
          <div className="flex items-center gap-2">
            {days.length > 1 && (
              <SegTabs
                items={days
                  .slice(0, 8)
                  .map((f) => ({ key: f.file, label: fileDate(f.file).slice(5) }))}
                value={days.find((f) => f.data === day)?.file ?? ''}
                onChange={setDayFile}
              />
            )}
            <CardBadge>{day?.date ?? '—'}</CardBadge>
          </div>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <StatPair label="涨停家数" value={`${visible.length} 只`} tone="up" />
          <StatPair label="最高板" value={`${topBoard} 板`} tone="rec" />
          <StatPair label="最早首封" value={firstMin == null ? '—' : minToClock(firstMin)} tone="rec" />
          <StatPair label="题材线" value={`${bursts.themes.length} 条`} tone="up" />
          <StatPair label="时刻槽" value={`${slots.length} 个`} />
          <StatPair label="时间轴节点" value={`${nodes.length} 个（行业聚类口径）`} />
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

      {/* ── 主体：横向固定宽卡网格（按分钟排序·左→右·行优先自动换行）── */}
      <Card
        title="时间轴（分钟槽）"
        extra={
          <CardBadge>{slots.length} 个时刻槽 · 每张卡一个分钟 · 行优先换行</CardBadge>
        }
      >
        <div
          className="min-w-0"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, ${SLOT_WIDTH}px)`,
            gap: `${SLOT_GAP}px`,
            justifyContent: 'start',
          }}
        >
          {slots.map((slot) => (
            <TimelineSlotCard
              key={slot.key}
              slot={slot}
              topBoard={topBoard}
              tags={bursts.tags}
              reasonByCode={reasonByCode}
            />
          ))}
        </div>
        {slots.length === 0 && (
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
