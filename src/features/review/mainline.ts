/**
 * 「主线复盘」段落解析（2026-11-15 用户：个股与逻辑改成小卡片）。
 *
 * 输入是复盘卡里的原始文本行，形态大致是：
 * ```
 * ⭐ 最强  **影视与 AI 短剧**（8 只 · 全部首板 · 板块逆势 +4.39%）
 * · **文投控股** 封 2.46 亿·成交 10.45 亿 ／ **凯撒文化** 1.50 亿 ／ …
 * · 由头是 11-12 抖音短剧版权中心开放互动剧…
 * ⚠️ 8 只合计封单 6.56 亿…
 * 🔹 次强  **机器人标签**（6 只 · 票在封、板块在跌）
 * ```
 *
 * 本模块只做**结构化切分**，不改写任何文字；解析不出的部分原样留在 `text` 里，
 * 由渲染层退化为普通段落（⛔ 不丢内容）。
 */

export interface MainlineStock {
  name: string
  detail: string
}

export interface MainlineBlock {
  /** 最强 / 次强 / 第三 / 支线 … */
  rank: string
  /** 题材名（解析不出时为空） */
  name: string
  /** 括号里的体量描述 */
  meta: string
  stocks: MainlineStock[]
  /** 由头/解释类文本（原样） */
  logic: string[]
  /** ⚠️ 风险类文本（原样） */
  risk: string[]
  /** 无法归类的原文（渲染时并入 logic 之后） */
  text: string[]
}

const HEAD_RE = /(?:\*\*支线\*\*)|(?:(⭐|🔹|🔸|✨|◆)\s*(最强|次强|第三|第四|第五))/

/** 去掉 lark_md 的 `<text_tag …>` 包装，只留文字。 */
function stripTags(s: string): string {
  return s.replace(/<text_tag[^>]*>/g, '').replace(/<\/text_tag>/g, '')
}

/** 拆一行里的多只票：`· **A** 1 亿 ／ **B** 2 亿`。 */
function parseStocks(line: string): MainlineStock[] {
  const body = line.replace(/^·\s*/, '')
  if (!/\*\*.+?\*\*/.test(body)) return []
  return body
    .split('／')
    .map((part) => part.trim())
    .map((part) => {
      const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(part)
      if (!m) return { name: '', detail: part }
      return { name: m[1].trim(), detail: m[2].trim() }
    })
    .filter((x) => x.name || x.detail)
}

/** 解析主线复盘段落。 */
export function parseMainline(lines: string[]): MainlineBlock[] {
  const blocks: MainlineBlock[] = []
  let cur: MainlineBlock | null = null

  const push = () => {
    if (cur && (cur.name || cur.stocks.length || cur.logic.length || cur.risk.length || cur.text.length)) blocks.push(cur)
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const head = HEAD_RE.exec(stripTags(line))
    if (head) {
      push()
      const plain = stripTags(line)
      const isBranch = /\*\*支线\*\*/.test(plain)
      const nameMatch = /\*\*(.+?)\*\*/.exec(plain)
      const metaMatch = /（(.+?)）\s*$/.exec(plain)
      cur = {
        rank: isBranch ? '支线' : (head[2] || ''),
        name: nameMatch ? nameMatch[1].trim() : plain.replace(HEAD_RE, '').trim(),
        meta: metaMatch ? metaMatch[1].trim() : '',
        stocks: [],
        logic: [],
        risk: [],
        text: [],
      }
      continue
    }
    if (!cur) {
      cur = { rank: '', name: '', meta: '', stocks: [], logic: [], risk: [], text: [] }
    }

    if (line.startsWith('⚠️')) {
      cur.risk.push(line)
      continue
    }
    if (line.startsWith('·')) {
      const stocks = parseStocks(line)
      // 「由头是…」这类解释也可能以 · 开头，但没有加粗票名
      if (stocks.length > 0) cur.stocks.push(...stocks)
      else cur.logic.push(line.replace(/^·\s*/, ''))
      continue
    }
    cur.text.push(line)
  }
  push()
  return blocks
}
