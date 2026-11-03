/**
 * 「今天最强题材」的行数据 —— **纯函数**，把三份已有数据拼成一张表。
 *
 * ## 三份输入，各管一段，不重算
 *
 * | 来源 | 字段 | 用途 |
 * |---|---|---|
 * | `top5`（题材接口） | `zt_count` / `zt_prev` / `total_stocks` / `leader` / `delta` | 题材强度与横向对比 |
 * | `top5[].zt_stocks` | 该题材**今日涨停**的个股（name/code/pct） | 涨停名单（最硬的「这条线有几只」） |
 * | `leaders` / `early`（个股汇总） | `sector` / `pct` / `boards` / `is_20cm` / `buyable` | 核心辨识度个股的报价与板数 |
 *
 * ⚠️ 三份都不在这里被「修正」：缺失就保持缺失（`null`），⛔ 不拿 0 顶替。
 * 页面靠 `null` 决定显示「—」，而不是显示一个看起来像真数据的 0。
 *
 * ## 为什么合并去重而不是分开两块
 *
 * 2026-10-30 用户口径：同一只票不要在页面出现两次。`leaders` 里已封板的票
 * 往往同时出现在 `zt_stocks` 里（一个带 board，一个只有涨幅），合并后取信息更全的一份。
 */

import { isStarMarket } from '@/shared/lib'
import type { EarlyItem, Leader, ThemeTop } from '@/shared/api'
import { mergeCoreStocks } from './filters'

/** 题材内的一只票（已合并去重） */
export interface ThemeRowStock {
  /** 6 位代码（去重主键） */
  code: string
  name: string
  pct: number | null
  /** 连板文案，如 `3天3板`；无则为空串 */
  boards: string
  /** 连板高度（`3天3板` → 3）；无连板为 0 */
  boardHeight: number
  /** 换手率，仅题材龙头自带该字段 */
  turn: number | null
  /** 20cm 标的（波动大，须紧止损） */
  is20cm: boolean
  /** true = 未封板强势（有报价、没封住）；false = 已封板 */
  unsealed: boolean
  /** 是否本题材龙头（`top5[].leader`） */
  isThemeLeader: boolean
  /**
   * 首封时间 `HH:MM`（当日）。`null` = 没有涨停或当日没记到时间。
   *
   * 排序主键（用户 2026-10-31 口径：**按涨停时间先后**）。
   * `zt_stocks` 只有名字涨幅、没有时间，所以要靠 `limit_up_stocks.fbt`
   * 或盘后归档 `zt_pool.zt_list.fbt` 回填。
   */
  fbt: string | null
}

/** 一个题材 = 一行（可展开看 `stocks`） */
export interface ThemeRow {
  rank: number
  name: string
  desc: string
  ztCount: number
  ztPrev: number | null
  /** `ztCount - ztPrev`；任一缺失为 null（⛔ 不当作 0） */
  change: number | null
  totalStocks: number
  turnAvg: number
  delta: string
  leaderName: string
  leaderBoards: string
  leaderPct: number | null
  diffusion: string
  risks: string[]
  positives: string[]
  /** 按辨识度排序后的个股（高度 → 龙头身份 → 涨幅） */
  stocks: ThemeRowStock[]
  /** 涨幅降序里「未封板」的只数，用于行内提示 */
  unsealedCount: number
}

/** `3天3板` → 3；`首板` → 1（靠 limit_up_days 兜底）；无 → 0 */
export function boardHeightOf(boards: string | null | undefined, limitUpDays = 0): number {
  const m = /(\d+)\s*板/.exec(boards ?? '')
  const fromText = m ? Number(m[1]) : 0
  const days = Number.isFinite(limitUpDays) ? limitUpDays : 0
  return Math.max(fromText, days)
}

/**
 * 首封时间归一化：`092500` → `09:25`；`09:25` → `09:25`；其它 → null。
 *
 * 两个源头格式不一致（涨停池 `fbt` 是 6 位数字、快照 `fbt` 是 HH:MM），
 * 不归一化会导致「同一天两个格式」的比较结果完全错乱。
 */
export function normalizeFbt(v: string | null | undefined): string | null {
  const raw = String(v ?? '').trim()
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`
  if (/^\d{2}:\d{2}$/.test(raw)) return raw
  return null
}

/** `002708.SZ` / `sh600000` → `002708`：全局身份统一成 6 位，否则同票会被当成两只 */
export function codeKey(code: string | null | undefined): string {
  return (code ?? '').match(/\d{6}/)?.[0] ?? (code ?? '').trim()
}

/** 风险/催化文案里带 688/689 的条目要剔除 —— 用户无科创板权限，列出来只会误导 */
function dropStarMarket(items: string[] | null | undefined): string[] {
  return (items ?? []).filter((t) => !/(68[89]\d{3})/.test(t))
}

/**
 * 题材行排序的依据。
 *
 * 为什么不是「按涨幅」或「按龙头板数」：用户要的是**当天最强题材**，
 * 而题材的强弱首先体现在**有多少只涨停**（宽度），其次才是「比昨天多了几只」（变化）。
 * 龙头高度是单票信息，一个 5 连板的孤军题材不该排在 20 只涨停的主线前面。
 */
function compareThemes(a: ThemeRow, b: ThemeRow): number {
  return (
    b.ztCount - a.ztCount
    || (b.change ?? -Infinity) - (a.change ?? -Infinity)
    || b.turnAvg - a.turnAvg
    || a.rank - b.rank
  )
}

/**
 * 个股排序：**辨识度地位**优先，不是涨幅。
 *
 * ① **首封时间升序**（用户 2026-10-31 定：按涨停时间先后）
 * ② 没有时间的（未封板 / 当日没记到）一律排最后
 * ③ 同一时刻 → 连板高者先 → 涨幅高者先
 *
 * ## 为什么时间压在「高度」前面
 *
 * 2026-10-28 定的是「更信已经走出来的高度」，那条仍成立 —— 但它解决的是
 * 「2 板严龙要不要插到 4 板前面」。而**同一题材内部**看的是另一件事：
 * 这条线今天是**谁先被资金锁死**的。09:25 竞价秒板的票和 14:30 才上板的票，
 * 板数可能一样，含义完全不同 —— 前者是决心，后者是跟风。
 * 所以题材内改按时间排，高度退为「同一时刻」的次级键。
 */
function compareStocks(a: ThemeRowStock, b: ThemeRowStock): number {
  if (a.fbt && b.fbt && a.fbt !== b.fbt) return a.fbt < b.fbt ? -1 : 1
  if (a.fbt && !b.fbt) return -1
  if (!a.fbt && b.fbt) return 1
  return (
    b.boardHeight - a.boardHeight
    || Number(b.isThemeLeader) - Number(a.isThemeLeader)
    || (b.pct ?? -Infinity) - (a.pct ?? -Infinity)
  )
}

/** 把同一只票的多条来源合并成一条：信息互补，不铺两行 */
function upsert(map: Map<string, ThemeRowStock>, next: ThemeRowStock): void {
  const key = next.code
  if (!key) return
  const cur = map.get(key)
  if (!cur) {
    map.set(key, next)
    return
  }
  cur.pct = cur.pct ?? next.pct
  cur.turn = cur.turn ?? next.turn
  if (!cur.boards && next.boards) cur.boards = next.boards
  cur.boardHeight = Math.max(cur.boardHeight, next.boardHeight)
  cur.fbt = cur.fbt ?? next.fbt
  cur.is20cm = cur.is20cm || next.is20cm
  // 任一路径说它已封板，就以「已封板」为准：封板是事实，未封板只是「还没封」
  cur.unsealed = cur.unsealed && next.unsealed
  cur.isThemeLeader = cur.isThemeLeader || next.isThemeLeader
}

export function buildThemeRows(
  top5: ThemeTop[] | null | undefined,
  leaders: Leader[] | null | undefined,
  early: EarlyItem[] | null | undefined,
  fbtByCode?: ReadonlyMap<string, string> | null,
): ThemeRow[] {
  const core = mergeCoreStocks(leaders ?? [], early ?? [])
  /** 6 位码 → `HH:MM`；没有就是 null（⛔ 不编一个 00:00 冒充「最早封板」） */
  const fbtOf = (code: string): string | null => normalizeFbt(fbtByCode?.get(code))

  const rows = (top5 ?? []).map((t): ThemeRow => {
    const stocks = new Map<string, ThemeRowStock>()

    // ① 核心辨识度（leaders / early 里 sector 归属于本题材的票）
    for (const s of core) {
      if (!s.themes.includes(t.name)) continue
      if (isStarMarket(s.code)) continue
      const code = codeKey(s.code)
      if (!code) continue
      upsert(stocks, {
        code,
        name: s.name,
        pct: Number.isFinite(s.pct) ? s.pct : null,
        boards: s.boards ?? '',
        boardHeight: boardHeightOf(s.boards, s.limit_up_days ?? 0),
        turn: null,
        is20cm: !!s.is_20cm,
        unsealed: s.unsealed,
        isThemeLeader: false,
        fbt: fbtOf(code),
      })
    }

    // ② 今日涨停名单（只有 name / code / pct）—— 它回答「这条线有几只封住」
    for (const z of t.zt_stocks ?? []) {
      if (isStarMarket(z.code)) continue
      const code = codeKey(z.code)
      if (!code) continue
      upsert(stocks, {
        code,
        name: z.name,
        pct: Number.isFinite(z.pct) ? z.pct : null,
        boards: '',
        boardHeight: 0,
        turn: null,
        is20cm: false,
        unsealed: false,
        isThemeLeader: false,
        fbt: fbtOf(code),
      })
    }

    // ③ 题材龙头（信息最全：板数 / 换手 / 封板质量）
    const ld = t.leader
    if (ld && !isStarMarket(ld.code)) {
      const code = codeKey(ld.code)
      if (code) {
        upsert(stocks, {
          code,
          name: ld.name,
          pct: Number.isFinite(ld.pct) ? ld.pct : null,
          boards: ld.boards ?? '',
          boardHeight: boardHeightOf(ld.boards),
          turn: Number.isFinite(ld.turn) ? ld.turn : null,
          is20cm: false,
          unsealed: false,
          isThemeLeader: true,
          fbt: fbtOf(code),
        })
      }
    }

    const list = [...stocks.values()].sort(compareStocks)
    const ztPrev = typeof t.zt_prev === 'number' ? t.zt_prev : null

    return {
      rank: t.rank,
      name: t.name,
      desc: t.desc ?? '',
      ztCount: t.zt_count,
      ztPrev,
      change: ztPrev === null || t.zt_count == null ? null : t.zt_count - ztPrev,
      totalStocks: t.total_stocks,
      turnAvg: t.turn_avg,
      delta: t.delta ?? '',
      leaderName: ld?.name ?? '',
      leaderBoards: ld?.boards ?? '',
      leaderPct: ld && Number.isFinite(ld.pct) ? ld.pct : null,
      diffusion: t.diffusion ?? '',
      risks: dropStarMarket(t.risks),
      positives: dropStarMarket(t.positives),
      stocks: list,
      unsealedCount: list.filter((s) => s.unsealed).length,
    }
  })

  return rows.sort(compareThemes)
}
