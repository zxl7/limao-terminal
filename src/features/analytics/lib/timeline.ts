import type { IntradayTimelineEvent, MarketMemory, ZtPoolStock } from '@/shared/api'
import { round2, type MaybeNum } from '@/shared/lib'
import { emotionState, eventTier } from './event-text'

/**
 * 日内炒作时间轴的**纯计算内核** —— 与 React 无关，可单测。
 *
 * ## 这一版的核心变化：从「时段分桶」改为「板块聚类 + 严格时序」
 *
 * 上一版把一天切成 5 个时段、每段一列。问题有两个：
 *   ① 时段是**人为切分**，同一波行情会被切断在 11:30 两侧；
 *   ② 只列个股，读者要自己从 86 行里看出「哪个板块在成型」。
 *
 * 现在改为：**先按板块聚类，再把节点（板块块 / 单票 / 事件 / 推送）按时间排序**。
 * 节点数从 86 行降到 ~42 个（今日实测），且顺序就是真实的推进顺序。
 *
 * ## ⛔ 只处理盘面事实，不碰工程自检
 *
 * 刻意不含（用户 2026-09-16 明确「不需要采样和留痕」）：
 *   · `intraday_points`（盘中题材采样）—— 采样不稳，且它说的是「系统采样到了什么」
 *   · `audit.jsonl`（推送留痕）—— 运维视角（哪张卡推进哪个群），属 `/ops` 职责
 *
 * ## 为什么必须抽成纯函数
 *
 * 聚类与排序错了**不报错、不告警**，只是把票归到错误的板块或排错顺序 ——
 * 典型的静默错值。抽出来才能在单测里锁住「不丢不重」与「时间升序」两条不变量。
 */

/** `fbt`（'092500'）→ 自 00:00 起算的分钟数；非法返回 null */
export function fbtMin(v: string | null | undefined): number | null {
  if (!v) return null
  const d = String(v).replace(/\D/g, '')
  if (d.length < 4) return null
  const h = Number(d.slice(0, 2))
  const m = Number(d.slice(2, 4))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/** `'HH:MM'` → 分钟；非法返回 null */
export function clockMin(v: string | null | undefined): number | null {
  if (!v) return null
  const m = String(v).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 分钟 → `HH:MM`（**不做交易日范围校验**，超出 0–1439 会输出越界时刻） */
export function minToClock(v: number): string {
  const h = Math.floor(v / 60)
  const m = Math.round(v % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * 「爆发」判定口径 —— **公开、可调、页面上要写出来**。
 *
 * ⚠️ 为什么不干脆用「同板块 ≥3 只」就当爆发：实测这样会把**扩散**误判成爆发 ——
 *    今日「通信设备」6 只，但首封时刻横跨 217 分钟（09:35 → 13:12），
 *    那是**全天反复有人来打**，不是一次性爆发。故必须同时约束时间跨度。
 */
export const BURST_WINDOW_MIN = 30
export const BURST_MIN_STOCKS = 3

/** 板块块形态：爆发 / 扩散 / 成对 */
export type SectorShape = 'burst' | 'spread' | 'pair'

/**
 * 板块形态 → 展示元信息（图标 / 文案 / 语义色）。
 *
 * ⚠️ 这是「全天汇总口径」的语义：一个板块若全天首末跨度 ≤ 30 分且 ≥3 只，
 * 才算 🚀 爆发。**绝不能**把它当成「某一分钟当刻爆发」—— 投影到分钟槽时，
 * 同一板块每一分钟只封了其中几只，burst 图标只能作为「该板块全天形态」的小注，
 * 冒充当刻爆发会误导读者以为「这一分钟资金一次性打了全板块」。
 */
export const SHAPE_META = {
  burst: { icon: '🚀', label: '爆发', cls: 'text-up', badge: 'bg-up-soft text-up' },
  spread: { icon: '〰', label: '扩散', cls: 'text-rec', badge: 'bg-rec-soft text-rec' },
  pair: { icon: '·', label: '成对', cls: 'text-sub', badge: 'bg-line-faint text-sub' },
} as const

export interface SectorNode {
  kind: 'sector'
  /** 板块名（来自 `zt_list[].sector`，**行业口径**，不是炒作题材 —— 见文件末尾注释） */
  sector: string
  /** 该板块**首次**封板时刻（分钟）—— 时间轴的排序键 */
  at: number
  /** 该板块**末次**封板时刻（分钟） */
  to: number
  stocks: ZtPoolStock[]
  shape: SectorShape
}

export interface SingleNode {
  kind: 'single'
  at: number
  stock: ZtPoolStock
}

/**
 * 事件节点 —— **同一时刻的观测合并为一行**。
 *
 * ⚠️ 为什么必须合并：原系统的 `event_log` 时间戳是**卡片生成时刻**，不是事件发生时刻。
 *    实测 2026-09-16 的 19 条里前 6 条**全是 10:57**（情绪转亢奋 / 国产芯片龙头切换 /
 *    新主线光通信7只 / 智能电网龙头切换 / 风电龙头切换 …）——
 *    那是「10:57 这张卡一口气报了 6 件事」，不是「10:57 同时发生了 6 件事」。
 *    逐条铺开会让读者以为市场在同一分钟做了 6 个动作。
 *
 * ⚠️ 界面上必须标注这是**系统时点**（系统何时说的），不是严格的事件发生时刻。
 */
export interface EventNode {
  kind: 'event'
  at: number
  events: MarketMemory['event_log']
}

/**
 * 推送节点 —— 同样按时刻合并（实测 5 条题材共享同一个 `first_pushed`，
 * 因为它们是同一批卡一起推的）。
 *
 * `to` 取组内最大末推时刻，用于展示区间。
 */
export interface PushNode {
  kind: 'push'
  at: number
  to: number
  pushes: MarketMemory['pushed_topics']
}

export type TimelineNode = SectorNode | SingleNode | EventNode | PushNode

/** 同一分钟内的呈现次序：板块块 > 单票 > 事件 > 推送（先事实，后消息） */
const KIND_ORDER: Record<TimelineNode['kind'], number> = {
  sector: 0,
  single: 1,
  event: 2,
  push: 3,
}

function shapeOf(count: number, spanMin: number): SectorShape {
  if (count < BURST_MIN_STOCKS) return 'pair'
  return spanMin <= BURST_WINDOW_MIN ? 'burst' : 'spread'
}

/**
 * 构建时间轴节点序列。
 *
 * ## 不变量（单测锁的就是这两条）
 *
 * 1. **不丢不重** —— `Σ 各节点股票数 + looseStocks.length === 输入股票数`；
 *    且事件与推送的**条目总数**也一条不少（只是按时刻合并进同一节点）
 * 2. **时间升序** —— `nodes[i].at` 单调不减
 *
 * `looseStocks` = `fbt` 缺失因而**无法定位到时间轴**上的票。
 * 单独返回而不是丢弃 —— 丢弃会让页面显示的涨停数与原系统对不上。
 */
export function buildTimeline(input: {
  stocks: ZtPoolStock[]
  events: MarketMemory['event_log']
  pushes: MarketMemory['pushed_topics']
}): { nodes: TimelineNode[]; looseStocks: ZtPoolStock[] } {
  const { stocks, events, pushes } = input

  /** 有 fbt 的才有时间坐标；没有的进 looseStocks */
  const placed: Array<{ t: number; s: ZtPoolStock }> = []
  const looseStocks: ZtPoolStock[] = []
  for (const s of stocks) {
    const t = fbtMin(s.fbt)
    if (t == null) looseStocks.push(s)
    else placed.push({ t, s })
  }

  // ── 按板块聚类（同名板块归一块；块内按首封时刻升序）──
  const bySector = new Map<string, Array<{ t: number; s: ZtPoolStock }>>()
  for (const it of placed) {
    const k = it.s.sector || '未分类'
    const list = bySector.get(k)
    if (list) list.push(it)
    else bySector.set(k, [it])
  }

  const nodes: TimelineNode[] = []
  for (const [sector, list] of bySector) {
    list.sort((a, b) => a.t - b.t || b.s.boards - a.s.boards)
    const first = list[0]
    const last = list[list.length - 1]
    if (list.length === 1) {
      nodes.push({ kind: 'single', at: first.t, stock: first.s })
    } else {
      nodes.push({
        kind: 'sector',
        sector,
        at: first.t,
        to: last.t,
        stocks: list.map((x) => x.s),
        shape: shapeOf(list.length, last.t - first.t),
      })
    }
  }

  // ── 事件 / 推送：按时刻合并后并入同一条轴 ──
  const evByMin = new Map<number, MarketMemory['event_log']>()
  for (const e of events) {
    const at = clockMin(e.time)
    if (at == null) continue
    const g = evByMin.get(at)
    if (g) g.push(e)
    else evByMin.set(at, [e])
  }
  for (const [at, list] of evByMin) nodes.push({ kind: 'event', at, events: list })

  const puByMin = new Map<number, MarketMemory['pushed_topics']>()
  const puTo = new Map<number, number>()
  for (const p of pushes) {
    const at = clockMin(p.first_pushed)
    if (at == null) continue
    const to = clockMin(p.last_pushed) ?? at
    const g = puByMin.get(at)
    if (g) g.push(p)
    else puByMin.set(at, [p])
    puTo.set(at, Math.max(puTo.get(at) ?? at, to))
  }
  for (const [at, list] of puByMin) {
    nodes.push({ kind: 'push', at, to: puTo.get(at) ?? at, pushes: list })
  }

  nodes.sort(
    (a, b) =>
      a.at - b.at ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.kind === 'sector' && b.kind === 'sector' ? a.sector.localeCompare(b.sector) : 0),
  )

  return { nodes, looseStocks }
}

/**
 * 节点的**稳定身份键** —— 用内容而非数组索引。
 *
 * 索引不能当身份：同一分钟可以并存多个节点（板块块 / 事件 / 推送），
 * 切换日期后节点集合变化，索引不变而内容全变 → React 会复用错位的 DOM。
 * 各形态的身份天然唯一：板块名 / 股票代码 / 分钟数。
 */
export function timelineNodeKey(n: TimelineNode): string {
  switch (n.kind) {
    case 'sector':
      return `sector:${n.sector}`
    case 'single':
      return `single:${n.stock.code}`
    case 'event':
      return `event:${n.at}`
    case 'push':
      return `push:${n.at}`
  }
}

/**
 * 分块 key → **稳定 DOM 锚点 id**（2026-09-22）。
 *
 * 左栏详情列表与右侧蛇形轴共用同一实现（⛔ 两处各写一份必然错位）。
 * `block.key` 含 `:`（如 `normal:600`）在 HTML5 id 里合法，但会被 CSS 选择器误解析，
 * 故统一替换为 `_` —— 取值一律走 `getElementById`（不做选择器拼接）。
 */
export function timelineAnchorId(blockKey: string): string {
  return `tl-${blockKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

// ════════════════════════════════════════════════════════════════
// 展示投影：把「板块聚类」重投到「分钟槽」
//
// ## 为什么需要这一层（本页最关键的一次纠错）
//
// `buildTimeline` 把**整个行业全天**的票归成一个 `SectorNode`，锚点在「最早首封」
// （`at = first.t`）。这导致一个跨 217 分钟的行业（如「通信设备」6 只，09:35→13:12）
// 被画成**一条 09:35 的记录**——它后面 13:12 才封的票，被提前到了 09:35，
// 「未来记录提前」就这样发生了。`SingleNode` 同理被页面全日合并进一张卡。
//
// `buildTimelineSlots` 是**只读的展示投影**：它不改 `buildTimeline` 的任何业务口径
// （聚类 / 形态判定 / 事件合并都在前者里），只是把每只票**按自己的首封分钟**重新落点，
// 让时间轴真正成为「按分钟推进」的事实轴。
//
// ## 投影规则（每条都可单测）
//
// 1. 行业块里的票 → 各自 `fbtMin` 落到对应分钟；**同刻相同行业合并成一组**
//    （同一分钟里该行业封了几只，`count` 就是几，不一定是全天总数）。
// 2. `single` → 仅**同一分钟**合并，绝不跨分钟（否则又是「未来提前」）。
// 3. `event` / `push` → 同刻放同一个槽（与 buildTimeline 的同刻合并一致）。
// 4. 稳定键 `slot:${at}`：**类型 + 时间 + 内容身份**，且**禁止按代码全局去重**——
//    每只票按「自己的首封分钟」落点，同一代码若在不同分钟出现（病态输入）会自然分到
//    不同槽、键也不同，**保留同股不同时间的记录**，不会因共享代码被吞掉。
// ════════════════════════════════════════════════════════════════

/** 一个槽内「某行业当刻封板」的分组 */
export interface TimelineSlotSector {
  sector: string
  /** 该分钟内该行业封板的票（已按首封时刻，但同分钟内不重排） */
  stocks: ZtPoolStock[]
  /** 该分钟内该行业封板数（≤ 全天总数；跨多分钟时只算本分钟这部分） */
  count: number
  /** 该行业**全天**形态（来自 buildTimeline 的 SectorNode）—— 仅作小注，不冒充当刻爆发 */
  dayShape: SectorShape | null
  /** 该行业全天首末跨度（分钟） */
  daySpan: number | null
  /** 该行业全天封板总数 */
  dayTotal: number | null
}

/**
 * 槽内「行业分组块」按**强度降序**排列 —— 用户 2026-09-17：
 * 「卡片内的各板块做好强度的排序，比如说这个板块很强，那么它就排第一个」。
 *
 * ## 强度口径 = **既有字段的排序**，⛔ 不新造阈值 / 不引入权重系数
 *
 * | 序 | 依据 | 理由 |
 * |---|---|---|
 * | ① | `count` 当刻封板家数 降序 | 该分钟最直接的板块强度 |
 * | ② | 组内 `max(boards)` 降序 | 板块高度（有无高板龙头） |
 * | ③ | `dayTotal` 全天总数 降序 | 广度兜底 |
 * | ④ | `sector` 名 升序 | 稳定 tie-break（同输入必同输出） |
 *
 * ⚠️ **纯函数**：返回**新数组**、不改动入参；排序**不丢不重**（守恒，测试锁）。
 * 强、弱两端都保留 —— 弱板块只是排在后面，**不因排序被删**。
 */
export function sortSlotSectors(
  groups: readonly TimelineSlotSector[],
): TimelineSlotSector[] {
  // ⚠️ 对缺失字段健壮：`boards` / `count` 理论上必有，但投影数据可能缺 →
  // 用 `Number(x) || 0` 兜底，⛔ 绝不让 NaN 进入比较（NaN 比较恒 false → 排序退化为不稳定）
  const maxBoards = (g: TimelineSlotSector) =>
    g.stocks.reduce((m, s) => Math.max(m, Number(s.boards) || 0), 0)
  return [...groups].sort(
    (a, b) =>
      (b.count || 0) - (a.count || 0) ||
      maxBoards(b) - maxBoards(a) ||
      (b.dayTotal ?? 0) - (a.dayTotal ?? 0) ||
      a.sector.localeCompare(b.sector, 'zh-Hans-CN'),
  )
}

/**
 * 卡内**直接展示**的「板块」条目上限 —— 用户 2026-09-17：
 * 「卡片给我做成显示最多显示 3 个板块，高度 240px，可以滚动」。
 *
 * 适用于**两类板块条目**（各自独立计数上限）：
 *   ① 行业分组块（`TimelineSlotSector`）；
 *   ② 盘中**板块级**事件（`sector_up` 板块走强 / `sector_down` 杀跌板块）。
 *
 * ⛔ 超出部分**不删除**：在标注「其余 N 个板块」之后照常渲染（下拉可见）——
 * 遵守系统铁律「不丢不重」。
 */
export const SLOT_VISIBLE_SECTORS = 3

/**
 * 盘中**板块级**事件（`sector_up` / `sector_down`）按**强度降序**排序。
 *
 * | 方向 | 强度口径（⛔ 全用既有字段，不新造阈值） |
 * |---|---|
 * | `up`（板块走强） | `zt_count` 当刻板块涨停家数 降序 → `delta` 环比增量 降序 |
 * | `down`（杀跌板块） | `pct` 跌幅**最负在前** → `inflow` 主力净流出**最负在前** |
 *
 * 末尾一律以 `name` 升序做**稳定 tie-break**（同输入必同输出、不依赖 V8 排序稳定性）。
 * ⚠️ 纯函数：返回**新数组**，不改动入参、**不丢元素**（数量守恒，测试锁）。
 */
export function sortIntradaySectorEvents(
  events: readonly IntradayTimelineEvent[],
  dir: 'up' | 'down',
): IntradayTimelineEvent[] {
  const nm = (e: IntradayTimelineEvent) => String(e.name ?? '')
  return [...events].sort((a, b) =>
    dir === 'up'
      ? (Number(b.zt_count) || 0) - (Number(a.zt_count) || 0) ||
        (Number(b.delta) || 0) - (Number(a.delta) || 0) ||
        nm(a).localeCompare(nm(b), 'zh-Hans-CN')
      : (Number(a.pct) || 0) - (Number(b.pct) || 0) ||
        (Number(a.inflow) || 0) - (Number(b.inflow) || 0) ||
        nm(a).localeCompare(nm(b), 'zh-Hans-CN'),
  )
}

/**
 * 时间轴的一个「分钟槽」—— 页面的一个固定宽卡。
 *
 * ⛔ 注意 `.at` 只是**排序键与槽键**：槽内每条记录（个股 / 事件）各有自己的发生时刻，
 * 「同槽」= 同一分钟，不代表同一时刻。
 */
export interface TimelineSlot {
  /** 分钟（槽的排序键，也是稳定键的一部分） */
  at: number
  /** 按行业分组的当刻封板（同名行业同分钟合并一组） */
  sectors: TimelineSlotSector[]
  /** 当刻单票（同一分钟合并，不跨分钟） */
  singles: ZtPoolStock[]
  /** 当刻事件（同刻已合并）；无则 null */
  events: MarketMemory['event_log'] | null
  /** 当刻推送（同刻已合并）；无则 null */
  pushes: MarketMemory['pushed_topics'] | null
  /** 推送区间末刻（取组内最大末推时刻） */
  pushTo: number | null
  /** 稳定身份键：类型 + 时间 + 内容身份（板块/单票/事件/推送）+ 必要重复序号 */
  key: string
  /**
   * **盘中逐事件 · 涨侧**（来自 `intraday_timeline_<date>.jsonl`）。
   * ⛔ 与 `sectors`/`singles` 不同：那是**收盘口径**（首封时刻），这里是**盘中真实时刻**。
   * 二者**按同一分钟合并进同一张卡**（2026-09-17 用户「合进我的时间轴里面」）。
   */
  intradayUp: IntradayTimelineEvent[]
  /** **盘中逐事件 · 跌侧**（杀跌板块 / 新跌停 / 新炸板） */
  intradayDown: IntradayTimelineEvent[]
  /**
   * `events` 中**默认折叠**的下标（升序）—— 机器噪声，见 `event-text.ts` 的 `eventTier`。
   *
   * ⛔ **折叠 ≠ 删除**：`events` 数组**一条不改**，被折叠的仍渲染在「另有 N 条」的展开区里，
   * 悬停明细中**一律全量展开**。
   * ⛔ 判定必须按**全日时间顺序**累积（「情绪状态本日首次出现」要跨分钟才知道），
   * 故在 `buildTimelineSlots` 里算好；缺失 = 不折叠（测试 fixture 的默认态）。
   */
  foldedIdx?: number[]
}

/**
 * 把 `buildTimeline` 的节点序列投影成「分钟槽」序列。
 *
 * ⚠️ 纯函数、可单测。不修改输入，不触碰后端。
 * 不变量（测试锁）：
 *   · **守恒** —— Σ槽(Σ行业票 + 单票) === 输入里带 fbt 的票总数（与 buildTimeline 一致）；
 *   · **顺序** —— slots 按 `at` 升序；
 *   · **唯一键** —— 槽键 `slot:${at}` 互不重复（每分钟至多一个槽）。
 */
export function buildTimelineSlots(
  nodes: TimelineNode[],
  /**
   * **盘中逐事件**（`intraday_timeline_<date>.jsonl`）—— 2026-09-17 用户
   * 「合进我的时间轴里面」：按 `at` 的**分钟**并入同一批槽（同分钟合并）。
   * ⛔ 调用方须**只传与所选日期同一天**的事件（跨日并入会造成串线）。
   */
  intraday: IntradayTimelineEvent[] = [],
  /**
   * 展示闸门开关（⛔ 可逆，默认开）。
   *
   * `foldNoise: true` → 按 `eventTier` 标出 `foldedIdx`（默认折叠机器噪声）；
   * `false` → **完全不折叠**（回到「逐条全列」的旧行为，用于对照与回退）。
   */
  opts: { foldNoise?: boolean } = {},
): TimelineSlot[] {
  const slots = new Map<number, TimelineSlot>()
  /** 行业名 → 全天形态（来自 SectorNode），用于小注，不冒充当刻爆发 */
  const dayShapeBySector = new Map<string, { shape: SectorShape; span: number; total: number }>()

  const ensure = (at: number): TimelineSlot => {
    let s = slots.get(at)
    if (!s) {
      s = {
        at, sectors: [], singles: [], events: null, pushes: null, pushTo: null,
        intradayUp: [], intradayDown: [], key: `slot:${at}`,
      }
      slots.set(at, s)
    }
    return s
  }

  // 先收全天形态（来自 SectorNode）
  for (const n of nodes) {
    if (n.kind === 'sector') {
      dayShapeBySector.set(n.sector, { shape: n.shape, span: n.to - n.at, total: n.stocks.length })
    }
  }

  for (const n of nodes) {
    if (n.kind === 'sector') {
      // 行业块内的票，各自按真实首封分钟落点（这是纠正「未来提前」的关键一步）
      for (const s of n.stocks) {
        const t = fbtMin(s.fbt)
        if (t == null) continue // 无 fbt 的票不会进节点，这里只是防御
        const slot = ensure(t)
        let g = slot.sectors.find((x) => x.sector === n.sector)
        if (!g) {
          const info = dayShapeBySector.get(n.sector)
          g = {
            sector: n.sector,
            stocks: [],
            count: 0,
            dayShape: info?.shape ?? null,
            daySpan: info?.span ?? null,
            dayTotal: info?.total ?? null,
          }
          slot.sectors.push(g)
        }
        g.stocks.push(s)
        g.count = g.stocks.length
      }
    } else if (n.kind === 'single') {
      // 单票仅按自己的首封分钟落点，绝不跨分钟合并
      const t = fbtMin(n.stock.fbt)
      if (t == null) continue
      ensure(t).singles.push(n.stock)
    } else if (n.kind === 'event') {
      const slot = ensure(n.at)
      slot.events = (slot.events ?? []).concat(n.events)
    } else if (n.kind === 'push') {
      const slot = ensure(n.at)
      slot.pushes = (slot.pushes ?? []).concat(n.pushes)
      slot.pushTo = Math.max(slot.pushTo ?? n.at, n.to)
    }
  }

  // ── 盘中逐事件：按分钟并入同一批槽（2026-09-17 用户「合进我的时间轴里面」）──
  const DOWN = new Set(['sector_down', 'limit_down_new', 'broken_new'])
  for (const e of intraday ?? []) {
    const t = clockMin(String(e.at ?? '').slice(11, 16))
    if (t == null) continue
    const s = ensure(t)
    ;(DOWN.has(String(e.kind)) ? s.intradayDown : s.intradayUp).push(e)
  }

  const sorted = [...slots.values()].sort((a, b) => a.at - b.at)

  // ── 展示闸门：标出「默认折叠」的机器噪声事件（⛔ 折叠 ≠ 删除，`events` 一条不改）──
  // ⛔ 必须按**全日时间顺序**累积情绪状态：实测一天最多 14 条情绪转移、分散在不同分钟，
  //    「本日首次出现」只有在扫完整天之后才判得准；单卡内去重等于没去重。
  if (opts.foldNoise !== false) {
    const seenStates = new Set<string>()
    for (const slot of sorted) {
      const events = slot.events ?? []
      if (events.length > 0) {
        const folded: number[] = []
        events.forEach((e, i) => {
          if (eventTier(e, seenStates) === 'noise') folded.push(i)
          const st = emotionState(e.event)
          if (st != null) seenStates.add(st)
        })
        if (folded.length > 0) slot.foldedIdx = folded
      }
    }
  }
  return sorted
}

/**
 * ⚠️⚠️ **待用户确认的业务阈值**（2026-09-17）—— 不要擅自当作已定规则。
 *
 * 「多板块联动」缺少权威定义。这里只做了**最保守的可推导口径**：
 *   · 同一分钟；
 *   · 每个行业当刻封板数 ≥ 既有爆发门槛 `BURST_MIN_STOCKS`（复用，不新造）；
 *   · 达标行业数 ≥ 本常量 = 「多个」的字面最小读法。
 *
 * ⛔ 时间窗口（是否允许相邻分钟）、板块数下限、是否要求共同题材/产业链关系，
 *    均由用户确认后调整；确认前**不得**据此把它当作交易信号或推送依据。
 */
export const LINKAGE_MIN_SECTORS = 2

/**
 * 展示分块 —— 三类展示模型的载体（页面按此渲染，**不再是「每分钟一张卡」**）。
 *
 * | 类别 | 判定 | 展示 |
 * |---|---|---|
 * | `linkage` | 同刻 ≥`LINKAGE_MIN_SECTORS` 个行业各达爆发门槛 | 聚合成一张、底色更深 |
 * | `normal` | 含个股但未达联动门槛 | 普通平卡（不冠「爆发」） |
 * | `merged` | 连续若干分钟**纯消息**（无个股，仅事件/推送） | 合并成一张、标明板块数与名称 |
 *
 * ⛔ 优先级：`linkage` > `normal` > `merged`。联动块**绝不**被低频合并吞掉，
 *    以满足「不因低频合并策略延迟」。
 */
export type TimelineBlock =
  | { kind: 'linkage'; at: number; to: number; slots: TimelineSlot[]; sectors: string[]; key: string }
  | { kind: 'normal'; at: number; slot: TimelineSlot; key: string }
  | { kind: 'merged'; at: number; to: number; slots: TimelineSlot[]; sectors: string[]; key: string }

/** 槽内「当刻封板」达既有爆发门槛的行业名 */
function slotLinkageSectors(s: TimelineSlot): string[] {
  return s.sectors.filter((g) => g.count >= BURST_MIN_STOCKS).map((g) => g.sector)
}

/** 纯消息槽：无任何个股，仅有事件/推送 —— 低频合并的**默认**候选（页面会用题材感知版覆盖） */
function isMessageOnly(s: TimelineSlot): boolean {
  return s.sectors.length === 0 && s.singles.length === 0 && (!!s.events?.length || !!s.pushes?.length)
}

/** 合并块要标注的「板块名称」——取当刻推送的题材名（事件文案不参与命名） */
function mergedNames(s: TimelineSlot): string[] {
  return (s.pushes ?? []).map((p) => p.name).filter((n): n is string => !!n)
}

/**
 * 把分钟槽序列折叠成展示分块序列。
 *
 * @param isLowStrength 判定「**低强度槽**」—— 只有低强度槽才允许低频合并。
 *   默认 = 纯消息槽（无个股即算）。⚠️ 页面会传入**题材感知**判定 `isLowStrengthSlot`：
 *   **含题材爆发/龙头易主/衰竭的槽 = 高强度，不得合并** ——
 *   否则「题材爆发」会被吞进「📎 低频合并」卡里，且**无个股的日子（如盘中当日）
 *   会整日塌成一张合并卡**，与有股的日子长得完全不一样（用户 2026-09-17 抓包「盘中一个样式、收盘一个样式」）。
 *
 * 不变量（测试锁）：
 *  ① **不丢不重** —— 每个输入槽恰好出现在**一个** block 里；
 *  ② **顺序** —— blocks 的 `at` 单调不减；
 *  ③ **块键唯一**。
 */
export function groupTimelineSlots(
  slots: TimelineSlot[],
  isLowStrength: (s: TimelineSlot) => boolean = isMessageOnly,
): TimelineBlock[] {
  const blocks: TimelineBlock[] = []
  let mergeRun: TimelineSlot[] = []
  let linkRun: TimelineSlot[] = []

  const flushMerged = () => {
    if (mergeRun.length === 0) return
    const first = mergeRun[0]
    const last = mergeRun[mergeRun.length - 1]
    blocks.push({
      kind: 'merged',
      at: first.at,
      to: last.at,
      slots: mergeRun,
      sectors: [...new Set(mergeRun.flatMap(mergedNames))],
      key: `merged:${first.at}-${last.at}`,
    })
    mergeRun = []
  }
  const flushLinkage = () => {
    if (linkRun.length === 0) return
    const first = linkRun[0]
    const last = linkRun[linkRun.length - 1]
    blocks.push({
      kind: 'linkage',
      at: first.at,
      to: last.at,
      slots: linkRun,
      sectors: [...new Set(linkRun.flatMap(slotLinkageSectors))],
      key: `linkage:${first.at}-${last.at}`,
    })
    linkRun = []
  }

  for (const slot of slots) {
    if (slotLinkageSectors(slot).length >= LINKAGE_MIN_SECTORS) {
      flushMerged()
      linkRun.push(slot)
      continue
    }
    flushLinkage()
    if (isLowStrength(slot)) {
      mergeRun.push(slot)
      continue
    }
    flushMerged()
    blocks.push({ kind: 'normal', at: slot.at, slot, key: `normal:${slot.key}` })
  }
  flushLinkage()
  flushMerged()
  return blocks
}

/** 推进曲线的时间刻度（跳过午休：11:30 → 13:00 之间不插刻度） */export const MARKS: number[] = [
  570, 585, 600, 615, 630, 645, 660, 675, 690, // 09:30 → 11:30
  780, 795, 810, 825, 840, 855, 870, 885, 900, // 13:00 → 15:00
]

export const MARK_LABELS: string[] = MARKS.map(minToClock)

/** 按首封时刻累计的涨停家数（推进曲线主干） */
export function cumulativeByMarks(mins: number[], marks: number[] = MARKS): number[] {
  return marks.map((mk) => mins.filter((m) => m <= mk).length)
}

/**
 * 实时「涨停 / 跌停 / 炸板率」时间序列 —— 由盘中情绪时间轴
 *（`intraday_timeline_<date>.jsonl`）的逐事件推导，供时间轴页「动态监听」折线图。
 *
 * ## 为什么这是实时数据（而非盘后）
 * `intraday_timeline.py` 每轮把「本轮新发生的情绪事件」追加写入 JSONL：
 *   · `zt_total` —— 全市场涨停总数（`latest.json.total_zt`），盘中随封板/开板实时变化；
 *   · `limit_down_new` —— 每出现一只**新跌停**记一条（累计即跌停家数）；
 *   · `broken_new` —— 每出现一只**新炸板**记一条（累计即炸板家数）。
 * 前端 `intradayTimeline()` 查询盘中轮询 → 序列**随交易推进自动增长**，即「动态监听」。
 *
 * ## 口径
 *   · 涨停 = 封板家数 = 最新一条 `zt_total.total` 的**前向沿用**（盘中震荡取最近已知值）；
 *   · 跌停 = `limit_down_new` 累计条数；
 *   · 炸板率(%) = 炸板累计 / (封板 + 炸板累计) × 100
 *     （「曾触及涨停」= 当前封板 + 已炸板；炸板率 = 炸板占曾触涨停的比例，A 股标准口径）。
 *
 * ## 时间窗
 * 仅取交易时段（09:15–11:30、13:00–15:00，午休剔除）内事件；盘前残留
 * （上一交易日 `00:02` 旧值、开盘 `09:06` 清零）一律排除，避免污染首点。
 * 首个 `zt_total` 出现之前（非交易日 / 数据未开始）序列为 `null`（图上断线，不画假 0）。
 * ## ⛔ 不画未来（`untilWm`）
 * 涨停数是**状态量**：盘中最后一个已知值会一直「保持」到收盘。若无条件填到 15:00，
 * 10:03 打开页面就会看到一条**平推到收盘**的线 —— 读起来像「今天已定型」，是假信息。
 * 故调用方在**盘中**必须传 `untilWm` = 当前分钟，超过它的刻度一律 `null`（图上断线）。
 * 收盘后的完整交易日不需要传（缺省 `Infinity` = 全天填满，此时最后一个观测值就是收盘值）。
 */
export interface LimitSeriesResult {
  /** X 轴时钟标签（与 `MARKS` 对齐） */
  labels: string[]
  /** 涨停（封板）家数 · 与 `labels` 等长 */
  zt: MaybeNum[]
  /** 跌停家数（累计） */
  ld: MaybeNum[]
  /** 炸板率 %（0–100） */
  brokenRate: MaybeNum[]
}

/** 交易时段（墙钟分钟）：午休 11:30–13:00 之间事件不参与序列 */
function inTradingWindow(wm: number): boolean {
  if (wm < 555 || wm > 900) return false // 09:15–15:00
  if (wm > 690 && wm < 780) return false // 午休 11:30–13:00
  return true
}

export function buildLimitSeries(
  events: IntradayTimelineEvent[],
  /**
   * 截止墙钟分钟（**含**）—— 大于它的刻度一律 `null`。
   * 缺省 `Infinity` = 填满全天（收盘后语义）；
   * 盘中传「当前分钟」，曲线只画到此刻（见上方「不画未来」）。
   */
  untilWm: number = Number.POSITIVE_INFINITY,
): LimitSeriesResult {
  type SeqItem = { wm: number; kind: 'zt_total' | 'limit_down_new' | 'broken_new'; total: number | null }
  const seq: SeqItem[] = []
  for (const e of events) {
    const wm = clockMin(String(e.at ?? '').slice(11, 16))
    if (wm == null || !inTradingWindow(wm)) continue
    if (e.kind === 'zt_total') {
      seq.push({ wm, kind: 'zt_total', total: typeof e.total === 'number' ? e.total : null })
    } else if (e.kind === 'limit_down_new' || e.kind === 'broken_new') {
      seq.push({ wm, kind: e.kind, total: null })
    }
  }
  seq.sort((a, b) => a.wm - b.wm)

  let lastZt = 0
  let ldCum = 0
  let brokenCum = 0
  let seen = false
  let idx = 0
  const zt: MaybeNum[] = []
  const ld: MaybeNum[] = []
  const brokenRate: MaybeNum[] = []

  for (const m of MARKS) {
    while (idx < seq.length && seq[idx].wm <= m) {
      const cur = seq[idx]
      if (cur.kind === 'zt_total' && cur.total != null) {
        lastZt = cur.total
        seen = true
      } else if (cur.kind === 'limit_down_new') {
        ldCum += 1
      } else if (cur.kind === 'broken_new') {
        brokenCum += 1
      }
      idx += 1
    }
    // 尚未开始（首个 zt_total 之前）或已超出截止分钟 → 断线，⛔ 不画假 0、也不平推未来
    if (!seen || m > untilWm) {
      zt.push(null)
      ld.push(null)
      brokenRate.push(null)
      continue
    }
    zt.push(lastZt)
    ld.push(ldCum)
    const denom = lastZt + brokenCum
    brokenRate.push(denom > 0 ? round2((brokenCum / denom) * 100) : 0)
  }

  return { labels: MARK_LABELS, zt, ld, brokenRate }
}

/**
 * 从「近若干交易日」的逐事件里挑出**曲线基准日** —— 最近一个「盘中窗口内有事件」的交易日。
 *
 * ## 为什么独立挑，而不是直接用页面选中的日期
 * 盘中当日归档**没有涨停池**（`zt_list` 收盘后才写），页面默认选中日会退到
 * 「上一个有池的交易日」= **昨天**。曲线若跟着选中日走，盘中看到的永远是昨天的曲线，
 * 与「实时」相悖（用户 2026-09-19 明确要求实时）。
 *
 * 语义：
 *   · 交易时段 → 返回**今天**（JSONL 每轮追加 → 曲线向右生长，即「实时」）；
 *   · 当日收盘后 → 返回**今天**（完整盘中）；
 *   · 非交易日（周末/节前）→ 返回**最近一个交易日**（调用方须标注基准日）。
 *
 * 返回 `null` = 近端数据里**没有任何盘中窗口事件**（日志尚未产生）→ 调用方走盘后回退。
 */
export function pickLiveBasis(
  events: IntradayTimelineEvent[],
): { date: string; lastAt: string; events: IntradayTimelineEvent[] } | null {
  const byDate = new Map<string, IntradayTimelineEvent[]>()
  for (const e of events) {
    const d = String(e.at ?? '').slice(0, 10)
    if (!d) continue
    const list = byDate.get(d)
    if (list) list.push(e)
    else byDate.set(d, [e])
  }
  for (const d of [...byDate.keys()].sort((a, b) => b.localeCompare(a))) {
    const dayEvents = byDate.get(d) ?? []
    if (buildLimitSeries(dayEvents).zt.some((v) => v != null)) {
      return { date: d, lastAt: lastObservedAt(dayEvents) ?? `${d} 00:00:00`, events: dayEvents }
    }
  }
  return null
}

/**
 * 该日**最后一个盘中窗口内**事件时刻（`YYYY-MM-DD HH:MM:SS`）—— 曲线的「最后观测」。
 *
 * ⚠️ 只认窗口内事件：盘后复盘卡（17:4x）与盘前残留（00:0x）都不算观测，
 * 否则会把「17:42 那批事件」说成曲线最后一个点。
 */
function lastObservedAt(events: IntradayTimelineEvent[]): string | null {
  let out: string | null = null
  for (const e of events) {
    const at = String(e.at ?? '').replace('T', ' ')
    const wm = clockMin(at.slice(11, 16))
    if (wm == null || !inTradingWindow(wm)) continue
    if (out == null || at > out) out = at
  }
  return out
}

/**
 * ⚠️ 板块口径说明（**不要在 UI 上把它说成「炒作题材」**）
 *
 * `zt_list[].sector` 是**行业板块**（通信设备 / 元件 / 化学制品），
 * 而 A 股的炒作单位是**题材**（光通信 / CPO / 半导体）。
 * 两者不是一回事：今天 86 只涨停摊在 **42 个行业**里，单个行业往往只有 1–2 只。
 *
 * 更接近题材的源是 `candidates-<日期>.json` 的 `real_env.hot_spots`
 * （题材 → 成员），但实测**只覆盖约 18% 的涨停票**（每日仅 12 条题材、成员有限），
 * 用作主口径会把 80%+ 的票打成「未归题材」。
 *
 * 故本模块**只用 `sector`**，并在界面上如实标注「行业板块」。
 * 若将来拿到全量的题材归属（选股宝 plates 按日落盘），只需换掉聚类键。
 */
