import type { IntradayTimelineEvent, ZtPoolStock } from '@/shared/api'
import {
  sortIntradaySectorEvents,
  sortSlotSectors,
  type TimelineBlock,
  type TimelineSlot,
} from './timeline'
import { slotThemeMarks } from './theme-burst'

/**
 * 把一个**展示分块**（`TimelineBlock`）压成**紧凑摘要** —— 蛇形轴的 hover 浮层用。
 *
 * ## 为什么单独成文件
 *
 * `timeline.ts` 不能 import `theme-burst.ts`（后者已 import 前者的 `clockMin`，会成环）。
 * 本模块同时需要两者的能力，故独立存在、由组件引用 —— 无环。
 *
 * ## ⛔ 两条口径
 *
 * 1. **一律走既有排序/解析内核**（`sortSlotSectors` / `sortIntradaySectorEvents` / `slotThemeMarks`），
 *    ⛔ 不在摘要里重写一份「什么算强」的判断 —— 否则浮层与卡面会给出**不一致的名次**。
 * 2. **列表一律截断到 `cap`**（默认 3），但**同时给出总数**（`xxxCount`）——
 *    浮层只解释「最强的是谁」，⛔ 不得让读者以为「只有这么多」（详情面板才是全量）。
 */

/** 摘要里每一项列表的默认截断长度（与卡面 `SLOT_VISIBLE_SECTORS` 同值口径） */
export const SUMMARY_CAP = 3

type Marks = ReturnType<typeof slotThemeMarks>

export interface BlockSummary {
  kind: TimelineBlock['kind']
  /** 起 / 止分钟（合并卡与联动卡是区间） */
  at: number
  to: number
  slotCount: number
  /** 收盘口径：当刻封板个股数（Σ行业家数 + 单票） */
  stockCount: number
  /** 行业分组总数 */
  sectorCount: number
  /** 行业分组（强度降序，截断） */
  topSectors: Array<{ sector: string; count: number }>
  /** 个股（板数降序，截断） */
  topStocks: Array<Pick<ZtPoolStock, 'code' | 'name' | 'boards'>>
  /** 盘中板块走强（强度降序，截断）+ 总数 */
  upSectors: IntradayTimelineEvent[]
  upSectorCount: number
  /**
   * 盘中走强板块的**全部名字**（强度降序、去重、**不截断**）。
   *
   * ⛔ 为什么必须单列：`upSectors` 只留最强的 3 个，而「首爆」判定要求
   *    「这条线今天第一次出现」—— 若拿截断后的 3 个去判，某个当刻排第 4 的板块
   *    不会被记为「已出现」，它下一次冒头时就会被**错标成首爆**。
   *    实测 2026-10-22：机器人一天被标了 3 次「首爆」。
   */
  upSectorNames: string[]
  /** 盘中**个股**走强（涨幅降序，截断）—— 没有板块异动时的最弱一档标签 */
  upStocks: IntradayTimelineEvent[]
  /** 短线精灵信号（强度降序，截断）—— 消息面通道的最弱一档，不参与形状判定 */
  signals: IntradayTimelineEvent[]
  /**
   * 外部快讯（`newsflash_new`，来自 `intraday_timeline_<date>.jsonl`）。
   *
   * ⚠️ 2026-10-20 用户：「消息面呢？这边是否介入快讯【短线精灵+终端！！】」
   *    快讯由 `scripts/intraday_timeline.py` 按 id 去重后 append-only 记账，
   *    时刻取快讯自己的 `ctime` —— 故它是**真能落到分钟轴**的消息面第一档。
   * ⛔ 与 `pushed`（系统推送台账）不是一个东西：前者是外部消息，后者是我们的动作。
   */
  news: IntradayTimelineEvent[]
  /** 盘中杀跌板块（强度降序，截断）+ 总数 */
  downSectors: IntradayTimelineEvent[]
  downSectorCount: number
  /** 盘中非板块事件条数（涨停总数 / 个股 / 炸板 / 跌停） */
  otherUpCount: number
  otherDownCount: number
  /**
   * 当刻**炸板**（涨停被打开）条数 —— `broken_new`。
   *
   * ⚠️ 2026-10-20 用户：「打开涨停可以提示为黄色节点」。
   * 炸板原本被并进 `otherDownCount`，只能靠绿色叉表达，与「板块走弱」混在一起；
   * 但它是**涨停被打断**，性质和板块下跌不同，需要单独的黄色标识。
   *
   * ⛔ 同日晚些时候用户再改口：「炸板不需要权重，你这全是炸板了」——
   *    黄环只做**兜底显示**（同节点有首爆/走弱/走强/轮动时一律让位），
   *    但 `brokenCount` 本身要继续算：hover 明细与「涨停打开 ×N」标题靠它。
   */
  brokenCount: number
  /** 当刻**新跌停**条数 —— `limit_down_new`（⛔ 与「打开跌停」不是一回事） */
  limitDownCount: number
  /**
   * 当刻炸板 / 跌停的**名字**（去重、按出现顺序）。
   *
   * ⚠️ 2026-10-22 用户拿着截图问「这些点位的描述呢？」—— 截图上有一长串只有图标、
   *    没有任何文字的 × 点位。根因之一是 `downTagOf` 只给「板块走弱/快讯/消息/异动」
   *    四类出标签，而**炸板、跌停、个股回落、涨停总数变化**一律不给 → 那些点位彻底沉默。
   *    下区三层平时只用 0–1 层，空位大量闲置，正好放这些「有名字的事实」。
   */
  brokenNames: string[]
  limitDownNames: string[]
  /**
   * 当刻 `zt_total` 的净变化（无完整个股差分时后端不写 `zt_total`，故 0 是「无事实」而非「有事实但为 0」）。
   * 用于「涨停+1 / 涨停-1」这类没有名字可标的兜底描述。
   */
  ztDelta: number
  /**
   * `zt_total` 差分里的**新增封板 / 打开涨停**名字。
   *
   * ⛔ 为什么需要：`zt_total` 的 `added/removed` 是全市场涨停池的**唯一完整名单**
   *    （`stock_up` 只覆盖「板块领涨精选」那 20%）。只写「涨停+1」等于把已知的名字丢掉。
   *    2026-10-22 实测 09:38 的 `added=[博汇股份]` —— 轴上却只显示「涨停+1」。
   */
  ztAdded: string[]
  ztRemoved: string[]
  /** 题材标记（各自截断） */
  burst: Marks['burst']
  /** 该时刻仅发生**龙头轮动**的题材（弱标记 · 见 `SlotThemeMarks.rotated` 头注） */
  rotated: Marks['rotated']
  fade: Marks['fade']
  pushed: Marks['pushed']
  /** 系统观测 / 题材推送的条数 */
  eventCount: number
  pushCount: number
}

/** 取分块内的全部槽（三种分块形态统一） */
function slotsOf(block: TimelineBlock): TimelineSlot[] {
  return block.kind === 'normal' ? [block.slot] : block.slots
}

/**
 * 从 `zt_total` 事件里抽名字（`added` / `removed`）。
 *
 * ⛔ 只认 `IntradayLimitUpStock` 形状的条目（有 `code`）—— 旧日志可能只写计数，
 *    那种情况下宁可不给名字（返回空）也不要瞎猜。
 */
function ztNames(events: IntradayTimelineEvent[], ...fields: Array<'added' | 'removed'>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of events) {
    if (String(e.kind) !== 'zt_total') continue
    for (const f of fields) {
      const rows = e[f]
      if (!Array.isArray(rows)) continue
      for (const r of rows) {
        const name = typeof r?.name === 'string' ? r.name.trim() : ''
        if (!name || seen.has(name)) continue
        seen.add(name)
        out.push(name)
      }
    }
  }
  return out
}

/** 按 key 去重合并（保留首次顺序；数值取**最大**，如题材家数） */function mergeBy<T>(items: T[], key: (t: T) => string, better?: (a: T, b: T) => T): T[] {
  const idx = new Map<string, number>()
  const out: T[] = []
  for (const it of items) {
    const k = key(it)
    const at = idx.get(k)
    if (at == null) {
      idx.set(k, out.length)
      out.push(it)
    } else if (better) {
      out[at] = better(out[at], it)
    }
  }
  return out
}

/**
 * 生成分块摘要。
 *
 * ⚠️ **纯函数**：不改动入参；所有列表都**有界**（≤ cap），但总数单独给出。
 */
export function summarizeBlock(block: TimelineBlock, cap: number = SUMMARY_CAP): BlockSummary {
  const slots = slotsOf(block)

  // ── 收盘口径：行业分组 + 个股 ──
  const sectorGroups = slots.flatMap((s) => s.sectors)
  const sortedGroups = sortSlotSectors(sectorGroups)
  const topSectors = sortedGroups.slice(0, cap).map((g) => ({ sector: g.sector, count: g.count }))

  const allStocks = [...sectorGroups.flatMap((g) => g.stocks), ...slots.flatMap((s) => s.singles)]
  const topStocks = [...allStocks]
    .sort(
      (a, b) =>
        (Number(b.boards) || 0) - (Number(a.boards) || 0) ||
        (Number(b.seal) || 0) - (Number(a.seal) || 0) ||
        String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'),
    )
    .slice(0, cap)
    .map((s) => ({ code: s.code, name: s.name, boards: s.boards }))

  const stockCount =
    slots.reduce((n, s) => n + s.sectors.reduce((m, g) => m + g.count, 0) + s.singles.length, 0)

  // ── 盘中逐事件：板块走强 / 杀跌板块（各自强度降序后截断） ──
  const upEvents = slots.flatMap((s) => s.intradayUp)
  const downEvents = slots.flatMap((s) => s.intradayDown)
  const upSectorAll = upEvents.filter((e) => String(e.kind) === 'sector_up')
  /**
   * 个股级走强（`stock_up`）—— 2026-10-20 用户：「单一个股信息还是可以显示的」。
   *
   * 没有板块异动的时刻，轴上原本连名字都没有（只剩一个点）；现在作为**最弱一档**
   * 的标签兜底（`upTagOf` 里排在板块之后），让这些空位至少能读出「谁在动」。
   */
  const upStockAll = upEvents.filter((e) => String(e.kind) === 'stock_up')
  /**
   * 短线精灵信号（`signal_new`，来自 `short_spirit_signals.json` 的 `signals_today`）。
   * 它们是**消息面**而不是「个股走强」——必须从 `otherUpCount` 里单列，
   * 否则会把节点染成红圆、并顶掉真正的板块走强。
   */
  const signalAll = upEvents.filter((e) => String(e.kind) === 'signal_new')
  /** 外部快讯（`newsflash_new`）—— 消息面第一档，同样必须从 `otherUpCount` 里单列 */
  const newsAll = upEvents.filter((e) => String(e.kind) === 'newsflash_new')
  const downSectorAll = downEvents.filter((e) => String(e.kind) === 'sector_down')
  const brokenAll = downEvents.filter((e) => String(e.kind) === 'broken_new')
  const limitDownAll = downEvents.filter((e) => String(e.kind) === 'limit_down_new')

  // ── 题材标记：逐槽解析后合并去重（题材家数取最大） ──
  const marksList = slots.map((s) => slotThemeMarks(s.events, s.pushes))
  const burst = mergeBy(
    marksList.flatMap((m) => m.burst),
    (b) => b.theme,
    (a, b) => ((b.count ?? 0) > (a.count ?? 0) ? b : a),
  ).slice(0, cap)
  const rotated = mergeBy(
    marksList.flatMap((m) => m.rotated),
    (r) => r.theme,
    // 同名题材优先保留**带龙头**的那条（信息更多）
    (a, b) => (b.leader ? b : a),
  ).slice(0, cap)
  const fade = mergeBy(
    marksList.flatMap((m) => m.fade),
    (f) => f.label,
  ).slice(0, cap)
  const pushed = mergeBy(
    marksList.flatMap((m) => m.pushed),
    (p) => p.name,
    (a, b) => ((b.pushCount ?? 0) > (a.pushCount ?? 0) ? b : a),
  ).slice(0, cap)

  const to = block.kind === 'normal' ? block.at : block.to

  return {
    kind: block.kind,
    at: block.at,
    to,
    slotCount: slots.length,
    stockCount,
    sectorCount: sectorGroups.length,
    topSectors,
    topStocks,
    upSectors: sortIntradaySectorEvents(upSectorAll, 'up').slice(0, cap),
    upSectorCount: upSectorAll.length,
    // 首爆判定用**全量**名字（⛔ 不能用上面截断后的 3 个，否则会误判首爆）
    upSectorNames: [
      ...new Set(
        sortIntradaySectorEvents(upSectorAll, 'up')
          .map((e) => (e.name == null ? '' : String(e.name)))
          .filter((n) => n !== ''),
      ),
    ],
    /** 个股级走强（按涨幅降序，截断） */
    upStocks: [...upStockAll]
      .sort((a, b) => Number(b.pct ?? -Infinity) - Number(a.pct ?? -Infinity))
      .slice(0, cap),
    signals: [...signalAll]
      .sort((a, b) => Number(b.strength ?? -Infinity) - Number(a.strength ?? -Infinity))
      .slice(0, cap),
    // 快讯按发布时刻升序（同一分钟内保持「先说的在前」）
    news: [...newsAll]
      .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
      .slice(0, cap),
    downSectors: sortIntradaySectorEvents(downSectorAll, 'down').slice(0, cap),
    downSectorCount: downSectorAll.length,
    // ⛔ 短线精灵信号（signal_new）与外部快讯（newsflash_new）都不是「个股走强」，
    //    必须扣掉，否则节点会被染成红圆、并顶掉真正的板块走强
    otherUpCount: upEvents.length - upSectorAll.length - signalAll.length - newsAll.length,
    /**
     * 个股级回落 = 下跌事件 **减去** 已单列的板块走弱与炸板。
     *
     * ⛔ 2026-10-20：原式只减了 `downSectorAll`，于是 `broken_new` 同时算进 `otherDownCount`
     *    → `barVisual` 里「个股走弱」的绿叉总会先命中，炸板黄环**永远出不来**（移到末位后更明显）。
     *    各类信号必须互斥拆分，否则「降权」会变成「删除」，图例里还留着一条永远不出现的项。
     *
     * ⛔ 只扣炸板，**不扣 `limit_down_new`**：跌停是硬风险，仍要走「绿叉」那条
     *    （上一版把跌停也扣掉后，跌停节点会掉成灰色细线 —— 那是降权降过头了）。
     */
    otherDownCount: downEvents.length - downSectorAll.length - brokenAll.length,
    brokenCount: brokenAll.length,
    limitDownCount: limitDownAll.length,
    brokenNames: [
      ...new Set(brokenAll.map((e) => String(e.name ?? '')).filter((n) => n !== '')),
    ],
    limitDownNames: [
      ...new Set(limitDownAll.map((e) => String(e.name ?? '')).filter((n) => n !== '')),
    ],
    // ⛔ 只累加「已验证」的 zt_total（后端只在个股集合差分校验通过时才写 added/removed）
    ztDelta: [...upEvents, ...downEvents]
      .filter((e) => String(e.kind) === 'zt_total' && typeof e.delta === 'number')
      .reduce((n, e) => n + Number(e.delta), 0),
    ztAdded: ztNames(upEvents, 'added'),
    ztRemoved: ztNames(downEvents, 'added', 'removed'),
    burst,
    rotated,
    fade,
    pushed,
    eventCount: slots.reduce((n, s) => n + (s.events?.length ?? 0), 0),
    pushCount: slots.reduce((n, s) => n + (s.pushes?.length ?? 0), 0),
  }
}
