/**
 * `event_log` **原始事件文本的分段**（纯函数，可单测）。
 *
 * ## 为什么需要它（用户 2026-09-17）
 *
 * 时间轴卡片里原本把事件原文整条渲染成灰色小字：
 * 题材名、个股名、关键数值**全被埋在同一片灰里**，读者一眼只能看到
 * 「系统观测」这个**来源标注**（还是饱和青绿 + 加粗），于是整屏看起来
 * 「全部处于系统观测状态」，而**节点实际发生了什么反而看不见**。
 *
 * 本模块只做一件事：把原文切成若干段并给出**语义类别**，由渲染层配色，
 * 使「涉及的个股与题材」跳出来、连接词退到灰色。
 *
 * ## ⛔ 铁律：**无损**
 *
 * `splitEventText(t).map(s => s.text).join('') === t` 恒成立（回归测试锁死）。
 * 任何解析失败的分支都必须**原样退回**为一段 `plain`，**不允许吞掉字符** ——
 * 否则就是「静默丢数据」。
 *
 * ## 支持的形态（与原系统 `memory_lib` 产出对齐）
 *
 * | 原文形态 | 分段 |
 * |---|---|
 * | `新主线崛起：{题材} 涨停{N}只，龙头 {个股}` | 题材 / 数值 / **个股** |
 * | `{题材} 龙头切换：{旧} → {新}` | 题材 / **个股** / **个股** |
 * | `关注板块集体重挫：{板块}、{板块}` | 逐个板块（跌色） |
 * | 其它（`市场情绪由「分歧」转为「亢奋」`／`涨停广度骤变 89 → 0` …） | `「」`内的状态词与数字 |
 */

/** 分段语义类别 —— 决定渲染配色，⛔ 不含任何业务判断 */
export type EventSegKind =
  /** 题材名（紫） */
  | 'theme'
  /** 个股名（加粗深色） */
  | 'stock'
  /** 关键数值 / 状态词（加粗深色） */
  | 'value'
  /** 转弱板块名（跌色） */
  | 'down'
  /** 连接词与其余文字（退灰） */
  | 'plain'

export interface EventSeg {
  text: string
  kind: EventSegKind
}

/** 一条命中：起始下标 + 长度 + 类别 */
interface Hit {
  at: number
  len: number
  kind: EventSegKind
}

/** 形态①：新主线崛起（「初次爆发」的原始记录） */
const RE_RISE = /^新主线崛起[：:]\s*(.+?)\s*涨停\s*(\d+)\s*只[，,]\s*龙头\s*(.+?)\s*$/
/** 形态②：龙头切换（机械换人的原始记录 —— ⛔ 不再作为题材层标记展示） */
const RE_SWITCH = /^(.+?)\s*龙头切换[：:]\s*(.+?)\s*[→>]\s*(.+?)\s*$/
/** 形态③：关注板块集体重挫 */
const RE_PLUNGE = /^关注板块集体重挫[：:]\s*(.+?)\s*$/
/** 兜底：`「」`内的状态词 */
const RE_QUOTED = /「([^」]*)」/g
/** 兜底：数字（可带小数） */
const RE_NUMBER = /\d+(?:\.\d+)?/g

/**
 * 把命中区间拼回分段。
 *
 * ⛔ 守恒保证：命中按位置排序、**与前一段重叠的命中直接丢弃**（宁可少高亮一段，
 * 也不能因为重叠而复制或跳过字符），最后把尾部余量补成 `plain`。
 */
function build(text: string, hits: Hit[]): EventSeg[] {
  const sorted = hits
    .filter((h) => h.len > 0 && h.at >= 0)
    .sort((a, b) => a.at - b.at)
  const out: EventSeg[] = []
  let cur = 0
  for (const h of sorted) {
    if (h.at < cur) continue
    if (h.at > cur) out.push({ text: text.slice(cur, h.at), kind: 'plain' })
    const end = Math.min(text.length, h.at + h.len)
    out.push({ text: text.slice(h.at, end), kind: h.kind })
    cur = end
  }
  if (cur < text.length) out.push({ text: text.slice(cur), kind: 'plain' })
  return out
}

/** 在 `text` 中**从 `from` 起**定位 `value`（找不到 → -1；⛔ 不使用全局 indexOf，避免同名词命错位置） */
function find(text: string, value: string, from: number): number {
  if (!value) return -1
  return text.indexOf(value, from)
}

/**
 * 事件原文 → 分段。⛔ **无损**（见文件头「铁律」）。
 */
export function splitEventText(raw: string | null | undefined): EventSeg[] {
  const text = raw ?? ''
  if (!text) return []

  // ── 形态① 新主线崛起：题材 / 家数 / 龙头个股 ──
  const rise = RE_RISE.exec(text)
  if (rise) {
    const [, theme, count, leader] = rise
    const hits: Hit[] = []
    const themeAt = find(text, theme, 0)
    if (themeAt >= 0) hits.push({ at: themeAt, len: theme.length, kind: 'theme' })
    const countAt = find(text, count, themeAt + theme.length)
    if (countAt >= 0) hits.push({ at: countAt, len: count.length, kind: 'value' })
    const leaderAt = find(text, leader, countAt + count.length)
    if (leaderAt >= 0) hits.push({ at: leaderAt, len: leader.length, kind: 'stock' })
    return build(text, hits)
  }

  // ── 形态② 龙头切换：题材 / 旧 / 新（两个名字都是**个股**）──
  const sw = RE_SWITCH.exec(text)
  if (sw) {
    const [, theme, from, to] = sw
    const hits: Hit[] = []
    const themeAt = find(text, theme, 0)
    if (themeAt >= 0) hits.push({ at: themeAt, len: theme.length, kind: 'theme' })
    const fromAt = find(text, from, themeAt + theme.length)
    if (fromAt >= 0) hits.push({ at: fromAt, len: from.length, kind: 'stock' })
    const toAt = find(text, to, fromAt + from.length)
    if (toAt >= 0) hits.push({ at: toAt, len: to.length, kind: 'stock' })
    return build(text, hits)
  }

  // ── 形态③ 集体重挫：逐个板块名（跌色）──
  const plunge = RE_PLUNGE.exec(text)
  if (plunge) {
    const hits: Hit[] = []
    let cur = 0
    for (const name of plunge[1].split(/[、,，]/).map((x) => x.trim())) {
      const at = find(text, name, cur)
      if (at < 0) continue
      hits.push({ at, len: name.length, kind: 'down' })
      cur = at + name.length
    }
    return build(text, hits)
  }

  // ── 兜底：`「」`内的状态词 + 数字（情绪转变 / 广度骤变等）──
  const hits: Hit[] = []
  for (const m of text.matchAll(RE_QUOTED)) {
    const inner = m[1]
    if (inner) hits.push({ at: (m.index ?? 0) + 1, len: inner.length, kind: 'value' })
  }
  for (const m of text.matchAll(RE_NUMBER)) {
    hits.push({ at: m.index ?? 0, len: m[0].length, kind: 'value' })
  }
  return build(text, hits)
}

/**
 * severity 的**例外标注**。
 *
 * ⛔ 实测（2026-09-16 / 09-17 真实归档）：`severity` 为 `high` 的占 **18/19、33/34**
 * —— 逐行都挂一个英文枚举 `high` 等于**零信息量的噪声**，正是「整屏像系统观测」的帮凶之一。
 * 故只在**非最高档**时标注（缺省不显示 = 最高档），信息不丢。
 *
 * ⛔ 且**不出英文枚举**：`mid` / `low` 是内部字段值，直接上屏等于把内部字段名暴露给读者
 * （实测曾渲染成「涨停广度骤变 32 → 50mid」）。统一映射为档位字，未知值原样兜底（不吞）。
 */
const SEVERITY_TOP = new Set(['high', '高', '严重'])
const SEVERITY_LABEL: Record<string, string> = { high: '高', mid: '中', low: '低' }

export function severityNote(severity: string | null | undefined): string | null {
  const s = (severity ?? '').trim()
  if (!s || SEVERITY_TOP.has(s)) return null
  return SEVERITY_LABEL[s] ?? s
}

/**
 * 分段 + **内容派生的稳定键**（该段在原文中的**起始字符位移** + 类别）。
 *
 * ⛔ 键在**内核**里算，⛔ 不要在组件里跨段累加 —— 位移唯一（`splitEventText` 的分段不重叠且
 * 逐段累积），故可安全用作 React key，且**不必**用数组索引（`no-array-index-key`）
 * 也不必抑制规则。
 */
export function splitEventTextKeyed(
  raw: string | null | undefined,
): Array<EventSeg & { key: string }> {
  const out: Array<EventSeg & { key: string }> = []
  let at = 0
  for (const seg of splitEventText(raw)) {
    out.push({ ...seg, key: `${at}:${seg.kind}` })
    at += seg.text.length
  }
  return out
}

/* ────────────────────────────────────────────────────────────────
 * 信息层级闸门（2026-09-17 · 用户「如果是你你会怎么做」→ 拍板「可以」）
 *
 * ## ⛔ 实测依据（5 个交易日 `event_log` 共 **109 条**）
 *
 * | 类型 | 条数 | 占比 | 性质 |
 * |---|---|---|---|
 * | `{题材} 龙头切换` | **56** | **51.4%** | `memory_lib` 每轮重算板块领涨股 = **机械换人** |
 * | `市场情绪由「X」转为「Y」` | **34** | **31.2%** | 分类器**来回翻**（09-14 一天 **14 次**：分歧→偏强→退潮→分歧→退潮→修复…） |
 * | `涨停广度骤变` | 4 | 3.7% | **3/4 是 `→ 0`**（09:10 / 14:15 / 09:09）＝ **计数器重置，非市场事件** |
 * | `新主线崛起` | 9 | 8.3% | ✅ 真信号 |
 * | `关注板块集体重挫` | 6 | 5.5% | ✅ 真信号 |
 *
 * ⇒ **真信号仅 13.8%，噪声 86%**。这就是「调完颜色/上限/固定高之后卡片仍然吵」的根因 ——
 * 样式层已无余量，必须**先设闸**。
 *
 * ## 判据（⛔ 零新阈值；且**只折叠已确认是机器噪声的形态**，未识别形态一律照常展示）
 *
 * | 事件 | 层级 | 理由 |
 * |---|---|---|
 * | `新主线崛起` / `龙头切换` / `关注板块集体重挫` | `noise` | 题材区已表达（🚀首爆 / ⚠️衰竭）；`龙头切换` 是**机械换人**（源头已治），题材区已不再展示 |
 * | 情绪类 · **转入状态本日首次出现** | `signal` | 状态**真的翻了**，是本节点的核心变化 |
 * | 情绪类 · 转入状态**已出现过** | `noise` | 回摆（分歧↔修复 振荡），不是新信息 |
 * | 广度类 · 目标值为 **0** | `noise` | 计数器重置（盘前/盘后归零），非市场事件 |
 * | 广度类 · 其它 | `signal` | 真实广度变化（如 `32 → 50`） |
 * | **未识别形态**（含缺失 topic） | `signal` | ⛔ **保守兜底：宁多勿少**，⛔ 绝不因「看不懂」而藏掉 |
 *
 * ⚠️ 闸门只决定**默认是否折叠**；被折叠的事件**仍在 `slot.events` 里、仍会被渲染进 `<details>`**，
 * 且在悬停明细（`showAllEvents`）中**一律全量展开** → **折叠 ≠ 删除**（守「不丢不重」铁律）。
 */

/** 事件的信息层级 */
export type EventTier =
  /** 真信号：默认展示 */
  | 'signal'
  /** 机器噪声：默认折叠（仍可展开） */
  | 'noise'

/** `市场情绪由「X」转为「Y」` → 转入状态 `Y`（⛔ 只取**转入后**的状态；形态不符 → `null`） */
const RE_EMOTION = /^市场情绪由「.+?」转为「(.+?)」/

export function emotionState(raw: string | null | undefined): string | null {
  const m = RE_EMOTION.exec(raw ?? '')
  return m ? m[1] : null
}

/** 广度事件是否「归零」（`涨停广度骤变 89 → 0`）—— 计数器重置，非市场事件 */
const RE_BREADTH_RESET = /→\s*0\s*$/

/**
 * 判定一条系统观测事件的层级。
 *
 * @param seen 该日中**此前已经出现过**的情绪状态集合（由调用方按**时间顺序**累积，
 *   ⛔ 不能只看单张卡 —— 实测一天最多 14 条情绪转移、分散在不同分钟，
 *   卡内去重等于没去重）。
 */
export function eventTier(
  e: { event?: string | null; topic?: string | null },
  seen: ReadonlySet<string> = new Set(),
): EventTier {
  const text = e.event ?? ''

  // ① 题材类：已在卡顶题材区表达 → 不在此处重复
  //    ⚠️ `switch`（龙头切换）情况稍特殊：题材区已于 2026-09-17 **整类撤除**（用户「干脆撤掉这一行」），
  //       故「已表达」这条理由对它在题材区**不再成立**；此处仍折叠，是因为**已落盘的历史数据**
  //       里它是「每轮重算板块领涨股」的机械换人（占 5 天事件 51.4%，PCB板一天来回 6 次）。
  //       ⛔ 源头已用**龙头锁定**治掉（`intraday_pulse.diagnose_dragon`）→ 之后它会变稀有且**是真事件**
  //       （原龙头退位、新人接棒）→ 届时应改判为 `signal`（⏳ 待用户拍板，见 memory 2026-09-17）。
  if (RE_RISE.test(text) || RE_SWITCH.test(text) || RE_PLUNGE.test(text)) return 'noise'

  // ② 情绪类：只有「状态本日首次出现」才算新信息
  if ((e.topic ?? '') === '情绪') {
    const st = emotionState(text)
    if (st == null) return 'signal' // 形态不符 → 保守展示
    return seen.has(st) ? 'noise' : 'signal'
  }

  // ③ 广度类：归零 = 计数器重置
  if ((e.topic ?? '') === '广度') {
    return RE_BREADTH_RESET.test(text) ? 'noise' : 'signal'
  }

  // ④ 未识别形态 → 保守展示
  return 'signal'
}
