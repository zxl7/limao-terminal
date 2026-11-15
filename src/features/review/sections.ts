/**
 * 复盘末两段（核心演化史 / 明日展望）的结构化切分（2026-11-15）。
 *
 * 原文是「加粗小标题 + 正文/编号条目」的自由文本。这里只做**切分**：
 * 小标题独占一行 → 新的一段；`①②③` / `·` 开头 → 条目；其余 → 段落。
 * ⛔ 不改写、不摘要；解析不出来就退化为纯文本，渲染层照常显示。
 */

export interface Section {
  heading: string
  lines: string[]
}

/** 把 `**小标题**` 独占行切成若干段。 */
export function splitSections(lines: string[]): Section[] {
  const out: Section[] = []
  let cur: Section | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // 小标题两种形态：`**标题**`（独占一行）或 `**标题**` + 全角空格 + 正文
    const onlyBold = /^\*\*([^*]+)\*\*$/.exec(line)
    const boldLead = /^\*\*([^*]+)\*\*[\u3000\s]+(.+)$/s.exec(line)
    if (onlyBold || boldLead) {
      cur = { heading: (onlyBold ?? boldLead)![1].trim(), lines: [] }
      out.push(cur)
      if (boldLead) cur.lines.push(boldLead[2].trim())
      continue
    }
    if (!cur) {
      cur = { heading: '', lines: [] }
      out.push(cur)
    }
    cur.lines.push(line)
  }
  return out
}

/** `**标题**` + 全角空格 + 正文 → {title, body}；没有加粗标题时 title 为空。 */
export function splitLabeled(line: string): { title: string; body: string } {
  const m = /^\*\*(.+?)\*\*[\u3000\s]+(.*)$/s.exec(line.trim())
  if (!m) return { title: '', body: line.trim() }
  return { title: m[1].trim(), body: m[2].trim() }
}

const NUM = /^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.*)$/s

/** 编号条目（①②③）或 `· ` 条目 → [{no, title, body}]。 */
export function splitItems(lines: string[]): Array<{ no: string; title: string; body: string }> {
  const out: Array<{ no: string; title: string; body: string }> = []
  for (const raw of lines) {
    const line = raw.trim().replace(/^·\s*/, '')
    if (!line) continue
    const m = NUM.exec(line)
    const no = m ? m[1] : '·'
    const rest = m ? m[2] : line
    const { title, body } = splitLabeled(rest)
    out.push({ no, title, body })
  }
  return out
}

export interface EvolutionData {
  sections: Section[]
  /** 「明日推演」下的条目 */
  outlook: Array<{ no: string; title: string; body: string }>
}

/** 核心演化史：昨日命运 / 今日核心 / 走到哪步 / 明日推演。 */
export function parseEvolution(lines: string[]): EvolutionData {
  const sections = splitSections(lines)
  const push = sections.find((s) => s.heading.includes('明日推演'))
  return { sections: sections.filter((s) => s !== push), outlook: push ? splitItems(push.lines) : [] }
}

export interface OutlookData {
  /** 看点 ①…⑤ */
  points: Array<{ no: string; title: string; body: string }>
  repair: Section | null
  confirm: Section | null
  risk: Section | null
  follow: Array<{ no: string; title: string; body: string }>
  mantra: Section | null
}

/** 明日展望：看点 / 修好需要什么 / 明日确认点 / 风险 / 延续观察 / 心法。 */
export function parseOutlook(lines: string[]): OutlookData {
  const sections = splitSections(lines)
  const find = (kw: string) => sections.find((s) => s.heading.includes(kw)) ?? null
  const pointsSec = find('看点')
  const followSec = find('延续观察')
  return {
    points: pointsSec ? splitItems(pointsSec.lines) : [],
    repair: find('修好'),
    confirm: find('确认点'),
    risk: find('风险'),
    follow: followSec ? splitItems(followSec.lines) : [],
    mantra: find('心法'),
  }
}
