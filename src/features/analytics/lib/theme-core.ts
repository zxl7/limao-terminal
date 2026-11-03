import type { GeneHistory, MarketSnapshot } from '@/shared/api'

/**
 * 主线题材 × 核心辨识度个股 × 资金流
 *
 * ## 为什么可以按 `leaders[].sector` 直接归队
 *
 * 实测（2026-10-26）：`latest.leaders` 28 只，其 `sector` 取值与 `top5[].name`
 * **完全同一套词表**（机器人 / 大消费 / 数据要素 / …），10 个题材全部能对上 1~3 只。
 * 这与龙虎榜不同 —— 榜单靠「概念标签」拼，需要近似匹配；这里字段本身就是题材名，
 * 直接用，不做模糊推断。
 *
 * ## 资金流为什么要「只认更具体的板块名」
 *
 * 板块资金表（`sector_fund_pool.boards`）是**行业+概念混排**的 352 个名字，与题材词表不同源：
 *   · `人形机器人`、`机器人概念` 含 `机器人` ⇒ 同一战线，可用
 *   · `电池` 被 `固态电池` 包含 ⇒ **不可用**（口径更大，会把整个电池板块算给固态电池）
 * 因此只接受「板块名包含题材名且更长」的方向，并取**最长命中**的一个，
 * 而不是把 `人形机器人 + 机器人概念 + 机器人执行器` 相加 —— 成分股高度重叠，相加会重复计额。
 */
export interface ThemeCoreStock {
  code: string
  name: string
  pct: number | null
  /** 连板文案（如 `4天4板`），无则空串 */
  boards: string
  is20cm: boolean
  /** null = 该源未给可买标记（不是「不可买」） */
  buyable: boolean | null
  /** 换手率（%），仅当日题材快照里有的票才给 */
  turn: number | null
  /** 辨识度地位：题材龙头 > 核心标的 > 早鸟埋伏 */
  role: CoreRole
  /** 连板高度（从 `6天4板` 里取 4）；无连板为 0 */
  boardHeight: number
}

export type CoreRole = 'theme-leader' | 'leader' | 'early'

const ROLE_RANK: Record<CoreRole, number> = { 'theme-leader': 0, leader: 1, early: 2 }

/** `6天4板` → 4；纯数字 `4` → 4；无 → 0。⛔ 不用它推断其它含义，只用于排序与展示 */
export function boardHeightOf(boards: string | null | undefined): number {
  if (!boards) return 0
  const m = /(\d+)\s*板/.exec(boards)
  if (m) return Number(m[1])
  const n = /^(\d+)$/.exec(boards.trim())
  return n ? Number(n[1]) : 0
}

export interface ThemeCoreFund {
  /** 命中的板块名，必须原样展示 —— 用户要能判断这是哪个口径的资金 */
  board: string
  pct: number | null
  flowYi: number | null
}

export interface ThemeCoreFacts {
  stocks: ThemeCoreStock[]
  fund: ThemeCoreFund | null
  /** 有核心标的但一只都没配上资金流时，页面要明说「无同名板块资金」 */
  fundMatched: boolean
}

type FundBoards = Record<string, { pct?: number | null; flow_yi?: number | null }>

export function matchFundBoard(theme: string, boards: FundBoards | null | undefined): ThemeCoreFund | null {
  if (!boards || !theme) return null
  const exact = boards[theme]
  if (exact) {
    return { board: theme, pct: num(exact.pct), flowYi: num(exact.flow_yi) }
  }
  let best: { name: string; def: { pct?: number | null; flow_yi?: number | null } } | null = null
  for (const [name, def] of Object.entries(boards)) {
    // 只接受「板块名更长且包含题材名」：更具体的口径才可代表该题材
    if (name.length > theme.length && name.includes(theme)) {
      if (!best || name.length < best.name.length) best = { name, def }
    }
  }
  if (!best) return null
  return { board: best.name, pct: num(best.def.pct), flowYi: num(best.def.flow_yi) }
}

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function buildThemeCoreIndex({ snapshot, fundBoards, themeNames }: {
  snapshot?: MarketSnapshot | null
  fundBoards?: FundBoards | null
  themeNames: readonly string[]
}): Map<string, ThemeCoreFacts> {
  const index = new Map<string, ThemeCoreFacts>()
  const names = themeNames.map((n) => n.trim()).filter(Boolean)
  for (const name of names) {
    const fund = matchFundBoard(name, fundBoards)
    index.set(name, { stocks: [], fund, fundMatched: !!fund })
  }
  if (!snapshot || !names.length) return index

  const leaders = snapshot.leaders ?? []
  const early = snapshot.early ?? []
  const top5 = new Map((snapshot.top5 ?? []).map((t) => [t.name, t] as const))

  for (const name of names) {
    const facts = index.get(name)!
    const theme = top5.get(name)
    const seen = new Set<string>()
    const push = (s: Omit<ThemeCoreStock, 'turn' | 'boardHeight'> & { turn?: number | null; boardHeight?: number }) => {
      if (!s.code) return
      s = { ...s, code: bareCode(s.code) }
      if (!s.code) return
      const boardHeight = s.boardHeight ?? boardHeightOf(s.boards)
      const existing = facts.stocks.find((x) => x.code === s.code)
      if (existing) {
        // 同一只票在 leaders 与题材龙头里各出现一次：地位取更强者，信息互补而非重复成两行
        if (ROLE_RANK[s.role] < ROLE_RANK[existing.role]) {
          existing.role = s.role
          if (s.boards) existing.boards = s.boards
          if (s.turn != null) existing.turn = s.turn
          existing.boardHeight = Math.max(existing.boardHeight, boardHeight)
        }
        return
      }
      seen.add(s.code)
      facts.stocks.push({ ...s, turn: s.turn ?? null, boardHeight })
    }

    for (const l of leaders) {
      if (l.sector !== name) continue
      push({
        code: l.code, name: l.name, pct: num(l.pct), boards: l.boards ?? '',
        is20cm: !!l.is_20cm, buyable: typeof l.buyable === 'boolean' ? l.buyable : null,
        role: 'leader',
      })
    }
    for (const e of early) {
      if (e.sector !== name) continue
      const buy = e.buy
      if (buy) {
        push({
          code: buy.code, name: buy.name, pct: num(buy.pct), boards: '',
          is20cm: !!buy.is_20cm, buyable: null, role: 'early',
        })
      }
    }
    // 题材自带龙头即便不在 leaders 里也要显示（它是这条线的定义者）
    if (theme?.leader?.code) {
      push({
        code: theme.leader.code, name: theme.leader.name, pct: num(theme.leader.pct),
        boards: theme.leader.boards ?? '', is20cm: false, buyable: null,
        turn: num(theme.leader.turn), role: 'theme-leader',
      })
    }

    // 换手率回填：题材快照的 leader / followers 有 turn，但 followers 只有名字
    const turnByName = new Map<string, number>()
    if (theme?.leader?.name && num(theme.leader.turn) !== null) {
      turnByName.set(theme.leader.name, num(theme.leader.turn)!)
    }
    for (const f of theme?.followers ?? []) {
      const t = num(f.turn)
      if (f.name && t !== null) turnByName.set(f.name, t)
    }
    for (const s of facts.stocks) {
      if (s.turn === null) s.turn = turnByName.get(s.name) ?? null
    }

    // 排序按**辨识度地位**，不是按涨幅：
    //   ① 题材龙头在前（这条线的定义者）② 连板更高者优先 ③ 涨幅 ④ 地位档位
    // 涨幅只是最后一层 —— 20cm 小票涨幅大，但辨识度不如 6 天 4 板的龙头。
    facts.stocks.sort((a, b) =>
      b.boardHeight - a.boardHeight
      || ROLE_RANK[a.role] - ROLE_RANK[b.role]
      || (b.pct ?? Number.NEGATIVE_INFINITY) - (a.pct ?? Number.NEGATIVE_INFINITY),
    )
  }
  return index
}



// ────────────────────────────────────────────────────────────────
// 股性档案（辨识度的客观依据）
// ────────────────────────────────────────────────────────────────

/**
 * 为什么要叠股性，而不是只看连板与涨幅
 *
 * 「辨识度」在盘口上表现为「这票以前涨停后有没有人接力」。同一个 2 板，
 * 有的票历史晋级率 60%、近一年 24 次涨停，有的票一年就冒头两次 —— 前者才是真核心。
 * 数据来自 `gene/hist`（`zt_250` 近 250 日涨停次数 / `promo_rate_hist` 晋级率 /
 * `max_boards_hist` 历史最高连板），是回测可复算的事实，不是本页推断。
 *
 * ⚠️ 没有档案的票返回 null，页面**不显示**，绝不写「0 次」——那是把「不知道」说成「没有」。
 */
export interface GeneFacts {
  zt250: number
  maxBoards: number
  promoRate: number | null
  /** 历史年均涨停次数 = zt_total / 上市至今整年数；样本不足为 null */
  annualAvg: number | null
  /**
   * 严格连板龙：**晋级率 ≥40%** 且 **近一年涨停次数高于历史年均**。
   *
   * 为什么是这两条而不是「某个固定次数」：涨停次数本身依赖上市年限与板块属性，
   * 用绝对阈值（例如 8 次）会把这几年才上市、但近期明显活跃的票判死；
   * 用「现在比它自己的历史更活跃」+「涨停后确实有人接力」才是可比的。
   * duration < 0.5 年或字段缺失时不判定 —— 不猜测，不默认 False 冒充判断。
   */
  strictDragon: boolean | null
}

/** 严格连板龙的晋级率门槛（与策略侧口径一致） */
export const STRICT_DRAGON_PROMO_MIN = 40

/**
 * `002708.SZ` → `002708`。
 *
 * ⚠️ 实测（2026-10-28）：`leaders[].code` 带交易所后缀（`002708.SZ`），而
 * `theme.top5[].leader.code` 与股性档案 `gene/hist` 都是 6 位纯数字。
 * 不归一化会出现两个后果：股性永远查不到（map 未命中）、同一只票被当成两只
 * （去重键不同）。故**所有内部身份统一用 6 位**，展示层仍可原样交给 StockLink。
 */
export function bareCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase().replace(/[.](SH|SS|SZ|BJ)$/, '')
}

/** `20200728` → Date；格式不符返回 null */
function parseYmd(v: string | null | undefined): Date | null {
  if (!v || !/^\d{8}$/.test(v)) return null
  const y = Number(v.slice(0, 4))
  const m = Number(v.slice(4, 6))
  const d = Number(v.slice(6, 8))
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

export function buildGeneIndex(
  files: ReadonlyArray<{ file?: string; data?: GeneHistory | null }> | null | undefined,
): Map<string, GeneFacts> {
  const index = new Map<string, GeneFacts>()
  for (const f of files ?? []) {
    const d = f?.data
    if (!d?.code) continue
    const zt250 = typeof d.zt_250 === 'number' && Number.isFinite(d.zt_250) ? d.zt_250 : null
    const maxBoards = typeof d.max_boards_hist === 'number' ? d.max_boards_hist : 0
    if (zt250 === null) continue
    const promoRate = typeof d.promo_rate_hist === 'number' && Number.isFinite(d.promo_rate_hist) ? d.promo_rate_hist : null
    const first = parseYmd(d.first_day)
    const last = parseYmd(d.last_day)
    let annualAvg: number | null = null
    if (first && last && typeof d.zt_total === 'number' && d.zt_total >= 0) {
      const years = (last.getTime() - first.getTime()) / (365.25 * 24 * 3600 * 1000)
      // 上市不足半年没有可比基数，宁可 null 也不给一个由两三个月外推出的「年均」
      if (years >= 0.5) annualAvg = d.zt_total / years
    }
    const strictDragon = annualAvg === null || promoRate === null
      ? null
      : promoRate >= STRICT_DRAGON_PROMO_MIN && zt250 > annualAvg
    index.set(bareCode(d.code), { zt250, maxBoards, promoRate, annualAvg, strictDragon })
  }
  return index
}

/** 辨识度分层：连板（≥2板）/ 首板 / 未封·强势 */
export type CoreTier = '连板' | '首板' | '未封·强势'

export function tierOf(stock: Pick<ThemeCoreStock, 'boardHeight'>): CoreTier {
  if (stock.boardHeight >= 2) return '连板'
  if (stock.boardHeight === 1) return '首板'
  return '未封·强势'
}
