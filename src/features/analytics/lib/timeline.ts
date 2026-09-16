import type { MarketMemory, ZtPoolStock } from '@/shared/api'

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

/** 时间轴的一个「分钟槽」—— 页面的一个固定宽卡 */
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
export function buildTimelineSlots(nodes: TimelineNode[]): TimelineSlot[] {
  const slots = new Map<number, TimelineSlot>()
  /** 行业名 → 全天形态（来自 SectorNode），用于小注，不冒充当刻爆发 */
  const dayShapeBySector = new Map<string, { shape: SectorShape; span: number; total: number }>()

  const ensure = (at: number): TimelineSlot => {
    let s = slots.get(at)
    if (!s) {
      s = { at, sectors: [], singles: [], events: null, pushes: null, pushTo: null, key: `slot:${at}` }
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

  return [...slots.values()].sort((a, b) => a.at - b.at)
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
