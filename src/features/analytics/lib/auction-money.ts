/**
 * 竞价资金榜（2026-10-19）—— 把「09:25 竞价这一刻，钱往哪些票去」算成一张可排序的表。
 *
 * ## 为什么不用截图里的「竞价净额」
 *
 * 参考产品（截图）的「竞价净额 / 净额占比」需要**逐笔委托的方向**（主动买 vs 主动卖），
 * 我们的落盘文件 `auction_quotes-<date>.json` 只有四个字段：
 * `prev_close / auction_price / auction_amount_yi / time`。
 * 没有方向数据就**算不出净额** —— 用涨幅乘金额去「凑」一个净额，是把猜测当事实，
 * 这条红线不能破（比少一列更危险）。
 *
 * ## 所以这张排行榜只呈现**能证实的三个事实**
 *
 * 1. **竞价涨幅** = auction_price / prev_close − 1（高开=愿意溢价抢，低开=愿意折价跑）；
 * 2. **竞额** = auction_amount_yi（这一票在竞价里真金白银成交了多少）；
 * 3. **占榜内比** = 该票竞额 / 榜内所有票竞额合计（钱在候选池内部的集中度）。
 *
 * ⛔ 「占榜内比」不是全市场占比：全市场竞价总额我们没有落盘，故文案必须写「榜内」。
 *
 * ## 高亮规则（暖黄底）
 *
 * `竞价涨幅 ≥ 5% 且 竞额 ≥ 榜内中位数` —— 即「高开 + 钱够多」。只有涨幅没有钱的，
 * 是几手撮合的假高开；只有钱没有涨幅的，是承接盘不是抢筹盘。
 *
 * ⚠️ 纯函数、零依赖：排序 / 阈值 / 占比都可单测，不依赖 React。
 */

/** 落盘原文（`auction_quotes-<date>.json` 的单个 value） */
export interface AuctionQuoteRaw {
  prev_close: number | null
  auction_price: number | null
  auction_amount_yi: number | null
  time?: string
}

/**
 * 池内裁决（`pool_call-<执行日>.json` 的单个 view）—— 只取榜单要用的最小子集。
 *
 * ⛔ 刻意不 import `shared/api/types` 的完整 `PoolCallView`：这个内核是纯计算，
 *    绑死 30 个字段的 DTO 会让它在别处（回测/离线校验）无法复用。
 */
export interface AuctionPoolView {
  view: string
  theme_name?: string
  amount_yi?: number | null
  need_yi?: number | null
  line_rank?: number
  line_is_core?: boolean
}

/** 池内角色（已经是中文，⛔ 页面不要再直出 `participate` 这类内部 token） */
export type PoolRole = '参与' | '观察' | '放弃' | '池外'

const POOL_ROLE: Readonly<Record<string, PoolRole>> = {
  participate: '参与',
  watch: '观察',
  skip: '放弃',
}

/** 一行榜（已算好，可直接渲染） */
export interface AuctionRow {
  code: string
  name: string
  /** 竞价涨幅（%），正=高开 */
  pct: number
  /** 竞价成交额（亿元） */
  amountYi: number
  /** 占榜内比（%） */
  sharePct: number
  /** 该票竞价撮合时刻（原文，通常 09:25:0x） */
  time: string
  /** 高开 + 钱够多 → 暖黄高亮 */
  hot: boolean
  /** 是否在当日 09:25 池内裁决名单里 */
  inPool: boolean
  /** 池内角色；⛔ 池外不是「放弃」—— 没被评估过 ≠ 被否决 */
  poolRole: PoolRole
  /** 所属题材（池内才有） */
  theme: string | null
  /** 该票要求的量能线（亿）；池外/缺失为 null */
  needYi: number | null
  /** 竞价额是否达标：true 达标 / false 未达标 / null 无门槛判据 */
  amountPass: boolean | null
  /** 自身方向内排名（1 = 龙一），池外为 null */
  lineRank: number | null
  /** 是否为所在方向的核心票 */
  isCore: boolean
}

/** 中位数（空数组 → 0） */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * 原始 quotes → 排行榜行（按竞额降序）。
 *
 * @param quotes   `auction_quotes-*.json` 的 `data`
 * @param nameByCode 代码 → 名称（竞价文件只有代码，名称要从接力池/候选池补）
 * @param opts.pool 当日 `pool_call.views`（**必须与竞价文件同一交易日**，日期不符就不要传）
 * @param opts.hotPct  高亮所需的涨幅下限（默认 5%）
 * @param opts.keepNegative 是否保留低开票（默认保留；低开也能看出资金出逃）
 */
export function buildAuctionRows(
  quotes: Record<string, AuctionQuoteRaw> | null | undefined,
  nameByCode: ReadonlyMap<string, string>,
  opts: {
    hotPct?: number
    keepNegative?: boolean
    pool?: Record<string, AuctionPoolView> | null
  } = {},
): AuctionRow[] {
  const { hotPct = 5, keepNegative = true, pool = null } = opts
  const entries = Object.entries(quotes ?? {})
  const valid: Array<{ code: string; raw: AuctionQuoteRaw; pct: number; amountYi: number }> = []

  for (const [code, raw] of entries) {
    const prev = raw?.prev_close
    const price = raw?.auction_price
    const amount = raw?.auction_amount_yi
    // ⛔ 三要素缺一不出行：缺 prev_close 算不出涨幅、缺金额算不出占比
    if (typeof prev !== 'number' || typeof price !== 'number' || typeof amount !== 'number') continue
    if (prev <= 0) continue
    const pct = (price / prev - 1) * 100
    if (!keepNegative && pct < 0) continue
    valid.push({ code, raw, pct, amountYi: amount })
  }

  const total = valid.reduce((sum, r) => sum + r.amountYi, 0)
  const amountMedian = median(valid.map((r) => r.amountYi))

  return valid
    .map(({ code, raw, pct, amountYi }) => {
      const view = pool?.[code]
      const needYi = typeof view?.need_yi === 'number' ? view.need_yi : null
      return {
        code,
        name: nameByCode.get(code) ?? code,
        pct: Math.round(pct * 100) / 100,
        amountYi: Math.round(amountYi * 100) / 100,
        sharePct: total > 0 ? Math.round((amountYi / total) * 1000) / 10 : 0,
        time: raw.time ?? '—',
        // 高开必须有量配合：只看涨幅会把「几手撮合的假高开」也标红
        hot: pct >= hotPct && amountYi >= amountMedian,
        inPool: !!view,
        // ⛔ 池外 ≠ 放弃：没进池是「没被评估」，放弃是「评估后否决」，两者语义相反
        poolRole: view ? (POOL_ROLE[view.view] ?? '观察') : '池外',
        theme: view?.theme_name || null,
        needYi,
        // needYi 缺省时给 null（无门槛判据），⛔ 不回填成「达标」
        amountPass: needYi == null ? null : amountYi >= needYi,
        lineRank: typeof view?.line_rank === 'number' ? view.line_rank : null,
        isCore: !!view?.line_is_core,
      }
    })
    .sort((a, b) => b.amountYi - a.amountYi || b.pct - a.pct)
}

export type AuctionSortKey = 'amount' | 'pct' | 'share' | 'pool'

/** 池内角色的排序权重（参与 → 观察 → 放弃 → 池外） */
const ROLE_ORDER: Readonly<Record<PoolRole, number>> = { 参与: 0, 观察: 1, 放弃: 2, 池外: 3 }

/** 按列排序（稳定：同值保持竞额序） */
export function sortAuctionRows(rows: readonly AuctionRow[], key: AuctionSortKey): AuctionRow[] {
  const copy = [...rows]
  if (key === 'pct') return copy.sort((a, b) => b.pct - a.pct || b.amountYi - a.amountYi)
  if (key === 'share') return copy.sort((a, b) => b.sharePct - a.sharePct || b.amountYi - a.amountYi)
  if (key === 'pool') {
    // 池内优先：角色序 → 龙一优先 → 竞额降序（同角色内钱多的在前）
    return copy.sort(
      (a, b) =>
        ROLE_ORDER[a.poolRole] - ROLE_ORDER[b.poolRole] ||
        (a.lineRank ?? 99) - (b.lineRank ?? 99) ||
        b.amountYi - a.amountYi,
    )
  }
  return copy
}

/** 题材级聚合行（钱往哪条线去） */
export interface AuctionThemeAgg {
  theme: string
  /** 该题材在榜内的票数 */
  count: number
  /** 该题材竞额合计（亿） */
  amountYi: number
  /** 榜内竞额占比（%） */
  sharePct: number
  /** 该题材最高竞价涨幅（%） */
  maxPct: number
  /** 其中有几只属于池内参与 */
  participate: number
}

/**
 * 按题材聚合竞价资金 —— 回答「09:25 的钱集中在哪几条线」。
 *
 * ⛔ 只聚合有题材的票：池外票没有题材归属（我们没有全市场题材映射）。
 *    给它们编一个「其他」会把整张榜的比例稀释掉，看起来像「资金发散」。
 * ⚠️ 但后端 `theme_name` 自身就写了「其他」的票，**如实保留**（那是数据，不是我们编的）。
 */
export function buildAuctionThemeAgg(rows: readonly AuctionRow[]): AuctionThemeAgg[] {
  const map = new Map<string, AuctionThemeAgg>()
  const total = rows.reduce((sum, r) => sum + r.amountYi, 0)
  for (const r of rows) {
    if (!r.theme) continue
    const cur = map.get(r.theme) ?? {
      theme: r.theme,
      count: 0,
      amountYi: 0,
      sharePct: 0,
      maxPct: r.pct,
      participate: 0,
    }
    cur.count += 1
    cur.amountYi += r.amountYi
    cur.maxPct = Math.max(cur.maxPct, r.pct)
    if (r.poolRole === '参与') cur.participate += 1
    map.set(r.theme, cur)
  }
  return [...map.values()]
    .map((t) => ({
      ...t,
      amountYi: Math.round(t.amountYi * 100) / 100,
      sharePct: total > 0 ? Math.round((t.amountYi / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amountYi - a.amountYi || a.theme.localeCompare(b.theme))
}
