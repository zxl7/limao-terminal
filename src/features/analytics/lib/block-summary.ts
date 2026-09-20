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
  /** 盘中杀跌板块（强度降序，截断）+ 总数 */
  downSectors: IntradayTimelineEvent[]
  downSectorCount: number
  /** 盘中非板块事件条数（涨停总数 / 个股 / 炸板 / 跌停） */
  otherUpCount: number
  otherDownCount: number
  /** 题材标记（各自截断） */
  burst: Marks['burst']
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

/** 按 key 去重合并（保留首次顺序；数值取**最大**，如题材家数） */
function mergeBy<T>(items: T[], key: (t: T) => string, better?: (a: T, b: T) => T): T[] {
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
  const downSectorAll = downEvents.filter((e) => String(e.kind) === 'sector_down')

  // ── 题材标记：逐槽解析后合并去重（题材家数取最大） ──
  const marksList = slots.map((s) => slotThemeMarks(s.events, s.pushes))
  const burst = mergeBy(
    marksList.flatMap((m) => m.burst),
    (b) => b.theme,
    (a, b) => ((b.count ?? 0) > (a.count ?? 0) ? b : a),
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
    downSectors: sortIntradaySectorEvents(downSectorAll, 'down').slice(0, cap),
    downSectorCount: downSectorAll.length,
    otherUpCount: upEvents.length - upSectorAll.length,
    otherDownCount: downEvents.length - downSectorAll.length,
    burst,
    fade,
    pushed,
    eventCount: slots.reduce((n, s) => n + (s.events?.length ?? 0), 0),
    pushCount: slots.reduce((n, s) => n + (s.pushes?.length ?? 0), 0),
  }
}
