import type { MarketMemory } from '@/shared/api'
import { clockMin } from './timeline'

/**
 * 题材级「爆发」的**纯计算内核** —— 把原系统 `event_log` 里那句人话解析成结构化事实。
 *
 * ## 为什么需要这一层
 *
 * `zt_list[].sector` 是**行业**（通信设备 / 化学制品），而 A 股的炒作单位是**题材**
 * （光通信 / PCB板 / 福建自贸）。行业口径今天把 86 只摊进 42 个行业，30 分钟窗口
 * 只能归纳出 2 次爆发 —— 因为**炒作从来不在行业层面发生**。
 *
 * 而原系统其实**早就算好了题材级结论**，只是从来没被展示过：
 *
 * ```
 * 新主线崛起：光通信 涨停7只，龙头 华脉科技        ← 题材名 + 家数 + 龙头
 * 福建自贸/海西概念 龙头切换：漳州发展 → 闽东电力    ← 龙头易主链
 * 关注板块集体重挫：通信线缆及配套、印制电路板…      ← 题材级风险
 * ```
 *
 * 本模块只做一件事：**解析**。不新增判断、不改口径、不猜。
 *
 * ## ⛔ 时间戳语义（已实测，必须如实标注）
 *
 * `event_log[].time` 是**卡片生成时刻**，不是事件发生时刻 ——
 * 实测 2026-09-16 的 19 条里 6 条全标 `10:57`（一张卡一口气报了 6 件事）。
 * 故本模块产出的 `at` 一律按「系统观测时点」使用，界面必须标明。
 *
 * ## 为什么必须抽成纯函数
 *
 * 解析错了**不报错、不告警** —— 只是安静地把题材名读错、把「重挫」当成「崛起」、
 * 或者把龙头认成上一任。典型的静默错值，只能靠单测锁住。
 */

// ── 形态定义（实测自 5 个交易日的 75 条事件，共 5 种形态）──

/** `新主线崛起：{题材} 涨停{n}只，龙头 {名}` */
const RISE_RE = /^新主线崛起[：:]\s*(.+?)\s*涨停(\d+)只[，,]\s*龙头\s*(.+?)\s*$/
/** `{题材} 龙头切换：{旧} → {新}` */
const SWITCH_RE = /^(.+?)\s*龙头切换[：:]\s*(.+?)\s*[→>]\s*(.+?)\s*$/
/** `关注板块集体重挫：{板块列表}` */
const PLUNGE_RE = /^关注板块集体重挫[：:]\s*(.+?)\s*$/

export type ThemeEventKind = 'rise' | 'switch' | 'plunge'

export interface ThemeEvent {
  kind: ThemeEventKind
  /** 系统观测时点（分钟）—— ⚠️ 卡片时刻，非事件时刻 */
  at: number
  /** 题材名。⚠️ 取 `topic` 字段，**不从文案里正则抠** —— 文案是给人读的，字段才是契约 */
  theme: string
  /** rise：涨停家数 */
  count: number | null
  /** rise：龙头；switch：切换后的**新**龙头 */
  leader: string | null
  /** switch：切换前的龙头 */
  from: string | null
  /** plunge：重挫的板块列表原文 */
  detail: string | null
  /** 原系统严重度（信号强度，与涨跌方向无关），透传以保留信息 */
  severity: string
}

/** 名称归一 —— 实测存在 `南 京 港` 这类带空格的写法 */
export function normName(v: string): string {
  return v.replace(/\s+/g, '')
}

/**
 * 题材名归一，用于跨源匹配（`event_log.topic` ↔ `pushed_topics.name` ↔ `hot_spots.sector`）。
 *
 * 三源对同一题材的写法并不一致：`福建自贸/海西概念` / `福建自贸/海西` / `PCB板`。
 * 归一后按「互相包含」匹配。⛔ 归一结果为空串时**不得参与匹配** —— 否则会匹配上一切。
 */
export function normTheme(v: string): string {
  return v
    .replace(/[\s（）()·]/g, '')
    .replace(/(概念|板块|板)$/, '')
}

/** 两段题材名是否指向同一题材 */
export function sameTheme(a: string, b: string): boolean {
  const x = normTheme(a)
  const y = normTheme(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * 解析题材相关事件。
 *
 * ⛔ 只返回 `rise` / `switch` / `plunge` 三类 —— `topic` 为 `情绪` / `广度` 的事件
 * **不属于题材层**（情绪与广度由时间轴上的事件节点原样呈现），在此明确跳过，
 * 保证「题材榜」里出现的每一条都是题材。
 *
 * 无时间坐标的事件直接丢弃（未产出，故计入调用方守恒校验的「未归」侧）。
 */
export function parseThemeEvents(events: MarketMemory['event_log']): ThemeEvent[] {
  const out: ThemeEvent[] = []
  for (const e of events) {
    const text = e.event ?? ''
    const at = clockMin(e.time)
    if (at == null) continue

    const base = { at, severity: e.severity ?? '' }

    const plunge = PLUNGE_RE.exec(text)
    if (plunge) {
      out.push({
        ...base,
        kind: 'plunge',
        theme: e.topic ?? '',
        count: null,
        leader: null,
        from: null,
        detail: plunge[1],
      })
      continue
    }

    const rise = RISE_RE.exec(text)
    if (rise) {
      out.push({
        ...base,
        kind: 'rise',
        theme: (e.topic ?? '').trim() || rise[1].trim(),
        count: Number(rise[2]),
        leader: rise[3].trim(),
        from: null,
        detail: null,
      })
      continue
    }

    const sw = SWITCH_RE.exec(text)
    if (sw) {
      out.push({
        ...base,
        kind: 'switch',
        theme: (e.topic ?? '').trim() || sw[1].trim(),
        count: null,
        leader: sw[3].trim(),
        from: sw[2].trim(),
        detail: null,
      })
    }
  }
  return out
}

/** 单个题材的爆发归纳 */
export interface ThemeBurst {
  theme: string
  /** 该题材首次被系统观测到的时点 */
  at: number
  /** 末次被观测到的时点 */
  to: number
  /** 是否出现过「新主线崛起」 */
  isNewMainline: boolean
  /** rise 事件里的涨停家数；无 rise 则为 null */
  riseCount: number | null
  /** 龙头链（按首次出现顺序去重），当前龙头在链中可能不是最后一个位置 */
  leaders: string[]
  /** **当前**龙头 —— 取最新一次事件的落点（rise 的龙头，或最后一次 switch 的新龙头） */
  currentLeader: string | null
  /** 龙头易主次数 */
  switchCount: number
  /** 催化原文（来自 `pushed_topics.context`） */
  catalyst: string | null
  /** 题材推文被推次数（来自 `pushed_topics.push_count`） */
  pushCount: number | null
  /** 命中当日涨停池的成员股（来自 `hot_spots`） */
  members: Array<{ code: string; name: string }>
}

/** 题材级风险（原系统「关注板块集体重挫」） */
export interface ThemeRisk {
  at: number
  sectors: string[]
}

/** 个股的题材标记 */
export interface StockThemeTag {
  /** 该股所属题材 */
  themes: string[]
  /** 该股是这些题材的**当前**龙头 */
  leaderOf: string[]
}

export interface ThemeBurstResult {
  themes: ThemeBurst[]
  risks: ThemeRisk[]
  /** 代码 → 题材标记（仅含有标记的票） */
  tags: Map<string, StockThemeTag>
  /** 落到题材层的题材事件条数（rise + switch） */
  themedCount: number
  /** 落到风险层的事件条数（plunge） */
  riskCount: number
}

/**
 * 把题材事件、推送台账、题材成员表汇成「题材爆发榜 + 个股题材标记」。
 *
 * ## 不变量（单测锁的就是它）
 *
 * **每条题材事件恰好归入一处**：`themedCount + riskCount === parseThemeEvents() 里 rise/switch/plunge 的总数`。
 * 归类错位不会报错，只会让某个题材凭空消失或让「重挫」冒充「崛起」。
 *
 * ## 龙的判定（易错点）
 *
 * 同一题材会**反复易主** —— 实测 `PCB板` 在 2026-09-15 一天内切换 5 次。
 * 故「当前龙头」必须取**时间上最后一次**事件的落点，不能取第一个 `leader`，
 * 也不能取「出现次数最多」的那个。链上其余名字只作为历史留痕展示。
 */
export function buildThemeBursts(input: {
  events: MarketMemory['event_log']
  pushes: MarketMemory['pushed_topics']
  hotSpots: Array<{ sector: string; stocks: Array<{ code?: string; name?: string }> }>
  /** 当日涨停池 —— 用于把龙头名解析成代码 */
  stocks: Array<{ code: string; name: string }>
}): ThemeBurstResult {
  const parsed = parseThemeEvents(input.events)
  const themed = parsed.filter((e) => e.kind !== 'plunge')
  const plunged = parsed.filter((e) => e.kind === 'plunge')

  /** 名称 → 代码（涨停池内） */
  const codeByName = new Map<string, string>()
  for (const s of input.stocks) {
    const k = normName(s.name)
    if (k && !codeByName.has(k)) codeByName.set(k, s.code)
  }

  // ── 按题材归并 ──
  const byTheme = new Map<string, ThemeEvent[]>()
  for (const e of themed) {
    const key = e.theme || '（未名题材）'
    const list = byTheme.get(key)
    if (list) list.push(e)
    else byTheme.set(key, [e])
  }

  const themes: ThemeBurst[] = []
  for (const [theme, list] of byTheme) {
    /** ⚠️ 必须按时间排序后再取「最后一次」 —— event_log 的顺序不保证等于时间顺序 */
    const sorted = list.slice().sort((a, b) => a.at - b.at)
    const lead: string[] = []
    let currentLeader: string | null = null
    let switchCount = 0
    let riseCount: number | null = null
    let isNewMainline = false

    for (const e of sorted) {
      if (e.kind === 'rise') {
        isNewMainline = true
        if (e.count != null) riseCount = Math.max(riseCount ?? 0, e.count)
        if (e.leader) currentLeader = e.leader
      } else {
        switchCount += 1
        if (e.leader) currentLeader = e.leader
      }
      if (e.leader && !lead.includes(e.leader)) lead.push(e.leader)
    }

    const push = input.pushes.find((p) => sameTheme(p.name, theme)) ?? null
    const spot = input.hotSpots.find((h) => sameTheme(h.sector, theme)) ?? null
    const members: Array<{ code: string; name: string }> = []
    for (const m of spot?.stocks ?? []) {
      const code = String(m.code ?? '').trim()
      if (!code) continue
      if (!input.stocks.some((s) => s.code === code)) continue
      members.push({ code, name: String(m.name ?? '').trim() })
    }

    themes.push({
      theme: theme === '（未名题材）' ? (push?.name ?? '（未名题材）') : theme,
      at: sorted[0].at,
      to: sorted[sorted.length - 1].at,
      isNewMainline,
      riseCount,
      leaders: lead,
      currentLeader,
      switchCount,
      catalyst: push?.context || null,
      pushCount: push ? push.push_count : null,
      members,
    })
  }

  /** 榜的排序：先「新主线崛起」（题材级最强信号），再按易主次数、观测时点 */
  themes.sort(
    (a, b) =>
      Number(b.isNewMainline) - Number(a.isNewMainline) ||
      b.switchCount - a.switchCount ||
      (b.riseCount ?? 0) - (a.riseCount ?? 0) ||
      a.at - b.at,
  )

  // ── 风险：同一条事件里的板块列表拆开 ──
  const risks: ThemeRisk[] = []
  for (const e of plunged) {
    const sectors = (e.detail ?? '')
      .split(/[、,，]/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (sectors.length === 0) continue
    risks.push({ at: e.at, sectors })
  }
  risks.sort((a, b) => a.at - b.at)

  // ── 个股题材标记 ──
  const tags = new Map<string, StockThemeTag>()
  const ensure = (code: string): StockThemeTag => {
    const t = tags.get(code)
    if (t) return t
    const fresh: StockThemeTag = { themes: [], leaderOf: [] }
    tags.set(code, fresh)
    return fresh
  }
  for (const h of input.hotSpots) {
    for (const m of h.stocks ?? []) {
      const code = String(m.code ?? '').trim()
      if (!code || !input.stocks.some((s) => s.code === code)) continue
      const t = ensure(code)
      if (!t.themes.includes(h.sector)) t.themes.push(h.sector)
    }
  }
  for (const t of themes) {
    if (!t.currentLeader) continue
    const code = codeByName.get(normName(t.currentLeader))
    if (!code) continue
    const tag = ensure(code)
    if (!tag.leaderOf.includes(t.theme)) tag.leaderOf.push(t.theme)
  }

  return {
    themes,
    risks,
    tags,
    themedCount: themed.length,
    riskCount: plunged.length,
  }
}

/**
 * ⛔ 口径边界（**界面上必须如实说明**）
 *
 * 「题材爆发榜」的题材名与家数**来自原系统 `event_log`**（系统自己算好的结论），
 * 本模块只解析、不重算。它回答的是「系统今天认定哪几条题材线在爆发」。
 *
 * 个股的**题材归属**只覆盖一部分：`hot_spots` 实测命中约 20% 的涨停票
 * （每日仅 12 条题材、成员有限）。故：
 *   · 有题材标记的票 = 系统明确归属的
 *   · 没有的 = **不等于没有题材**，只是当日成员表未覆盖
 * 界面上不得把「无标记」呈现成「无题材」。
 *
 * 逐票的「涨停原因」（同花顺 `reason`）是**自由文本**（实测 86 只里 78 个不同的
 * 首 token，91% 仅出现一次），**只能作逐票说明，不能作聚类键**。
 */
