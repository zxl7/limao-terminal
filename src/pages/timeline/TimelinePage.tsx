import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type {
  DecisionDossier,
  HithinkZtFile,
  IntradayTimelineEvent,
  MarketMemory,
  ZtHistoryDay,
  ZtPoolStock,
} from '@/shared/api'
import {
  analyticsQueries,
  buildThemeBursts,
  buildTimeline,
  buildTimelineSlots,
  fbtMin,
  fileDate,
  groupTimelineSlots,
  intradayStockUp,
  isLowStrengthSlot,
  minToClock,
  SegTabs,
  SHAPE_META,
  StatPair,
  TimelineDetailList,
  TimelineLinkageCard,
  TimelineMergedCard,
  TimelineSlotCard,
  TimelineSnake,
  type SectorNode,
  type StockThemeTag,
  type ThemeBurstResult,
  type TimelineSlot,
} from '@/features/analytics'
import { Card, CardBadge, StockLink } from '@/shared/ui'
import { APP_CONFIG } from '@/shared/config'
import { cn, inTrading, isStarMarket } from '@/shared/lib'
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
   * 左栏「时间轴」节点组件当前选中的节点（2026-09-22 用户定：左节点列表 / 右蛇形时间线）。
   * 点击左栏节点 → 右侧蛇形轴上对应节点**弹出明细**（`focusKey` 透传给 `TimelineSnake`）。
   */
  const [activeKey, setActiveKey] = useState('')
  /**
   * 右侧时间轴排版：`snake` = 蛇形折线（默认 · 一条线横走→弯→反向）；`cards` = 卡片流。
   * ⛔ 两视图共用同一批分块与排序内核，切视图不改结论。
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
  /** 30s 时钟 —— 驱动「盘中默认选今天」的判定（时段判定走 `shared/lib/marketTime` 单一实现） */
  const now = useNow(30_000)

  /**
   * 默认选中：**盘中选今天**，其余时段优先「有个股数据的最近一天」。
   *
   * ⛔ 为什么盘中要选今天：今日的题材事件（`market_memory_<今日>`）与盘中逐事件
   *    （`intraday_timeline_<今日>.jsonl`）都是**实时落盘**的，选今天 = 轴随交易推进生长。
   *    若默认停在「最近一个完整交易日」，盘中看到的永远是**静止的历史** ——
   *    用户 2026-09-21 抓包「时间轴没有动态更新」。
   * ⛔ 为什么不一路选今天：今日 `zt_list` 收盘后才落盘 → 个股没有首封时刻（`fbt`），
   *    非交易时段看今天只会得到一片没有个股的轴；故**只在盘中**这样做（该日同时标 `·盘`）。
   * ⛔ `inTrading` 必须传 `now`：React Compiler 会把无参纯调用当常量折叠，直接调会停在首帧。
   */
  const day: ZtHistoryDay | null | undefined =
    days.find((f) => f.file === dayFile)?.data ??
    (inTrading(undefined, now) ? days[0]?.data : undefined) ??
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
   * 盘中页同时消费逐事件账本与题材记忆；两者任一滞后都会造成“事实节点已到、题材标记未到”。
   * 以较旧的一侧作为页面水位，直接告诉用户当前画面是否仍可作为实时盘面使用。
   */
  const sourceUpdatedAt = useMemo(() => {
    const times = [itQ.dataUpdatedAt, memQ.dataUpdatedAt].filter((time) => time > 0)
    return times.length > 0 ? Math.min(...times) : 0
  }, [itQ.dataUpdatedAt, memQ.dataUpdatedAt])
  const sourceLagMs = sourceUpdatedAt > 0 ? Math.max(0, now.getTime() - sourceUpdatedAt) : null
  const isLiveDay = inTrading(undefined, now) && day?.date === days[0]?.data?.date
  const sourceFresh = sourceLagMs != null && sourceLagMs <= APP_CONFIG.staleAfterMs
  const sourceTime = sourceUpdatedAt > 0
    ? new Date(sourceUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '未获取'

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

  /**
   * **盘中当日的个股流** —— 来自盘中逐事件里的 `stock_up`（2026-09-22 用户
   * 「我需要看到的是题材、题材爆发以及与题材相关的大量个股」）。
   *
   * ## 为什么必须有这一层
   *
   * 实测（2026-09-22 盘中）：当日 `zt_history/zt_<今日>.json` 的 `zt_list` **为空**
   * （收盘后才落盘），而 `yesterday_zt.json` 的 `date` 是**上一个交易日** ⇒ 与所选日
   * 不相等 ⇒ `stocks` 返回空 ⇒ **时间轴上一个个股都没有**，只剩「爆发/走强·杀跌」这类
   * 板块级计数。这正是用户当时看到（并否决）的画面。
   *
   * 而 `intraday_timeline_<今日>.jsonl` 的 `stock_up` 事件**逐条带**
   * `code / name / sector(题材名) / pct / boards` —— 且 `at` 就是它的**封板时刻**，
   * 天然满足 `buildTimeline` 对首封时刻（`fbt`）的定位需求。
   *
   * ⛔ 必须排除 `at < 09:25` 的记录：守护进程会在 **00:03** 一次性补写**昨日收盘**快照
   *    （实测 64 条、含 26 条 `stock_up`）—— 若混入，昨日封板的票会被画到今天凌晨。
   * ⛔ 同 code 只取**首次**出现（首封即定位）。
   */
  const itStocks = useMemo<ZtPoolStock[]>(() => {
    const out: ZtPoolStock[] = []
    const seen = new Set<string>()
    for (const e of itEvents) {
      const r = intradayStockUp(e)
      if (!r || seen.has(r.code)) continue
      seen.add(r.code)
      out.push({
        code: r.code,
        name: r.name,
        pct: r.pct,
        price: 0,
        boards: r.boards,
        fbt: r.fbt,
        zbc: 0,
        hs: 0,
        // ⚠️ 来源字段叫 `sector`，但**取值是题材名**（医药/房地产/国产芯片…），
        //    不是 `zt_list` 里的行业（医疗服务/中药）。故同时写进题材归属 `themeTags`。
        sector: r.theme,
        seal: 0,
        cje_yi: 0,
        zsz_yi: 0,
        is_20cm: r.pct >= 19,
      })
    }
    return out
  }, [itEvents])

  /** ⛔ 科创板无交易权限 —— 全页统一剔除 */
  const visible = useMemo(() => {
    // 盘中当日无 `zt_list` → 回落到盘中逐事件的个股（否则整页无个股）
    const base = stocks.length > 0 ? stocks : itStocks
    return base.filter((s) => !isStarMarket(s.code))
  }, [stocks, itStocks])

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

  /**
   * 题材名 → 当日全貌（催化原文 / 涨停成员 / 观测时刻）。
   *
   * 2026-09-20：这些信息原先放在独立的「🚀 题材爆发」大卡里，与时间轴内容重复 → 撤卡，
   * 改为**挂到节点详情上**（卡面只留题材名 + 家数 + 龙头，详情里才展开）。
   * 2026-09-22：左栏成为常驻详情区 → 直接下传给详情卡（`themeInfo` prop），
   * 不再依赖 hover 面板（蛇形轴已撤出本页）。
   */
  const themeInfo = useMemo(
    () => new Map(bursts.themes.map((t) => [t.theme, t])),
    [bursts.themes],
  )

  /**
   * 个股 → 题材归属（Code → themes）—— 详情「题材主轴」的分组依据。
   *
   * 两个来源合并：
   *   ① `bursts.tags`（题材事件 + 决策档案 `hot_spots` 的成员表）—— 覆盖窄（实测 20/102）；
   *   ② **盘中逐事件的 `stock_up.sector`** —— 该字段取值是**题材名**（医药/房地产/国产芯片…），
   *      当日盘中封板的票几乎都有 → 这是「与题材相关的大量个股」的主要来源。
   *
   * ⚠️ 必须**复制** `bursts.tags` 的条目再改（那是一个共享 Map，直接 push 会污染上游）。
   */
  const themeTags = useMemo(() => {
    const m = new Map<string, StockThemeTag>()
    for (const [code, v] of bursts.tags) {
      m.set(code, { themes: [...v.themes], leaderOf: [...v.leaderOf] })
    }
    for (const e of itEvents) {
      const r = intradayStockUp(e)
      if (!r || !r.theme) continue
      const cur = m.get(r.code)
      if (!cur) {
        m.set(r.code, { themes: [r.theme], leaderOf: [] })
        continue
      }
      if (!cur.themes.includes(r.theme)) cur.themes.push(r.theme)
    }
    return m
  }, [bursts.tags, itEvents])

  /**
   * 所选日的**最近一个盘中采样点**（非完整交易日用）—— 提供涨停家数 / 最高板。
   *
   * ⛔ 不借「今天」的实时值：那是另一个日期的数据，混进来就是串线。
   *   实时情绪曲线归 `/intraday`（用户 2026-09-21：「已经放在实时页了」）。
   */
  const livePoint = useMemo(() => {
    const pts = day?.intraday_points ?? []
    return pts.length > 0 ? pts[pts.length - 1] : null
  }, [day])

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

  /** 点击左栏节点：置为选中 —— 透传给 `TimelineSnake` 的 `focusKey` → 右侧轴上对应节点弹明细。 */
  const pickNode = (key: string) => setActiveKey(key)

  return (
    <div className="flex flex-col gap-3">
      {/* ── 🕒 通栏：所选交易日的定性 + 日期切换。
          盘中默认选中**今天**（`day` 的选中逻辑），逐事件按所选日过滤 → 轴随实时推进生长；
          实时情绪曲线在 `/intraday`，⛔ 本页不再有折线图。 ── */}
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
            {isLiveDay && (
              <CardBadge tone={sourceFresh ? 'up' : 'warn'}>
                {itQ.isFetching || memQ.isFetching ? '实时刷新中' : sourceFresh ? `实时·${sourceTime}` : `数据延迟·${sourceTime}`}
              </CardBadge>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <StatPair
            label="涨停家数"
            value={isFullDay ? `${visible.length} 只` : livePoint ? `${livePoint.total} 只` : '待收盘'}
            tone={isFullDay || livePoint ? 'up' : undefined}
          />
          <StatPair
            label="最高板"
            value={isFullDay ? `${topBoard} 板` : livePoint ? `${livePoint.max_boards} 板` : '—'}
            tone="rec"
          />
          <StatPair
            label="最早首封"
            /* 2026-09-22：盘中个股流补上后（`itStocks`），`fbt` 已可用 —— 不再因「非完整交易日」显示「—」 */
            value={firstMin != null ? minToClock(firstMin) : '—'}
            tone="rec"
          />
          <StatPair label="题材线" value={`${bursts.themes.length} 条`} tone="up" />
          <StatPair label="时刻槽" value={`${slots.length} 个`} />
          <StatPair label="题材事件" value={`${themeEventCount} 条`} />
          <StatPair
            label="个股来源"
            value={isFullDay ? '收盘涨停池' : itStocks.length > 0 ? `盘中首封 ${itStocks.length} 只` : '待首封事件'}
            tone={isFullDay || itStocks.length > 0 ? 'sub' : undefined}
          />
        </div>

        {/* 📈 盘中「涨停 / 跌停 / 炸板率」实时曲线 **已移出本页**（2026-09-21 用户：
            「时间轴不需要涨跌的折线图，已经放在实时页了」）→ 现由 `/intraday` 的
            `IntradayMoodCard` 承担（30s 轮询 · 涨停 ＋ 跌停 ＋ 炸板率）。
            ⛔ 不要在本页重新长出折线图：本页的时间维度 = **所选交易日**的推进，不是实时情绪曲线。 */}
      </Card>

      {/* 🚀 题材爆发 —— 2026-09-20 用户定调：**这张独立大卡已删除**。
          题材信息一律挂到时间轴节点上：轴内节点标题材名（紫）+ hover 明细展开
          「催化原文 / 当日涨停成员 / 观测时刻」（数据经 `themeInfo` 注入）。
          ⛔ 不要在页面里重新长出一张题材清单卡。 */}

      {/* ── 主体：**左＝节点完整详情（15%·虚拟列表） / 右＝完整蛇形时间线**（2026-09-22 用户定稿）
          · 左（15%）：`TimelineDetailList` —— **每个节点一条完整详情**（倒序 · 虚拟列表窗口化渲染 ·
            自身滚动 · sticky）；内容与右侧 hover 浮层**同源**（都走 `BlockDetail`，全量不截断）；
          · 右（其余）：**完整「时间轴」卡**（🐍 蛇形轴默认 / 🃏 卡片流可切）+ 行业级集群 + 无时间坐标；
          · 点击左栏条目 → `activeKey` 透传 `TimelineSnake` 的 `focusKey` → 右侧轴上对应节点**弹出明细**。
          ⛔ 左栏是「详情」，⛔ 不是时间轴导航、也不是卡片墙。── */}
      <div className="flex gap-3 items-start max-xl:flex-col">
        {/* ── 左 15%：**每个节点的完整详情**（虚拟列表 · 倒序 · 点击联动右侧轴）── */}
        <div className="xl:w-[15%] xl:flex-none xl:sticky xl:top-3 max-xl:w-full min-w-0">
          <TimelineDetailList
            blocks={blocks}
            topBoard={topBoard}
            tags={themeTags}
            reasonByCode={reasonByCode}
            themeInfo={themeInfo}
            activeKey={activeKey}
            onPick={pickNode}
          />
        </div>

        {/* ── 右：完整蛇形时间线 + 行业集群 + 无时间坐标 ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
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
            {view === 'snake' ? (
              <TimelineSnake
                blocks={blocks}
                topBoard={topBoard}
                tags={themeTags}
                reasonByCode={reasonByCode}
                themeInfo={themeInfo}
                focusKey={activeKey}
              />
            ) : (
              <>
                {/* 🃏 卡片流：左→右铺开、满了自动换行（⛔ 不用 grid —— 会拉成等高留空白）
                    ⚠️ 卡片固定 240px 高 → flex 下天然等高，换行后行列整齐。 */}
                <div className="flex flex-wrap items-start content-start gap-3 min-w-0">
                  {blocks.map((b) =>
                    b.kind === 'linkage' ? (
                      <TimelineLinkageCard
                        key={b.key}
                        block={b}
                        topBoard={topBoard}
                        tags={themeTags}
                        reasonByCode={reasonByCode}
                        themeInfo={themeInfo}
                      />
                    ) : b.kind === 'merged' ? (
                      <TimelineMergedCard
                        key={b.key}
                        block={b}
                        topBoard={topBoard}
                        tags={themeTags}
                        reasonByCode={reasonByCode}
                        themeInfo={themeInfo}
                      />
                    ) : (
                      <TimelineSlotCard
                        key={b.key}
                        slot={b.slot}
                        topBoard={topBoard}
                        tags={themeTags}
                        reasonByCode={reasonByCode}
                        themeInfo={themeInfo}
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
          <Card title="行业级集群" extra={<CardBadge>{tally.sectorTotal} 个行业</CardBadge>}>
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
            <Card
              title="无时间坐标"
              extra={<CardBadge tone="warn">{looseStocks.length} 只</CardBadge>}
            >
              <div className="flex flex-wrap gap-x-2.5 gap-y-1">
                {looseStocks.map((s) => (
                  <span key={s.code} className="text-[12px] text-txt">
                    <StockLink code={s.code}>{s.name}</StockLink>
                    <span className="num text-sub ml-1">{s.boards}板</span>
                    <span className="text-sub ml-1">{s.sector}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
