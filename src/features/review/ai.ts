/**
 * 「AI 综合判断」段落解析（2026-11-15 用户：文字太多，想优化展示）。
 *
 * 原文形态（每行一条）：
 * ```
 * **盘面状态**  权重护指数、老票集体清算
 * **判断**  1.8 分不是「还在退潮」，是「清算到底、新方向刚点着」
 * **第一个事实 · 分数没动，两头走反**  正文…
 * <text_tag color='green'>风险 A</text_tag>  **结论句。** 正文…
 * **是不是换了主线**  结论… 正文…
 * ```
 *
 * 只做切分，⛔ 不改写、不摘要；渲染层据此排成「判断条 + 事实卡 + 风险卡 + 结论条」。
 */

export interface AiFact {
  /** 事实/风险编号，如「事实 1」「风险 A」 */
  tag: string
  /** 加粗标题（解析不到时为空） */
  title: string
  /** 正文（原样，可能含 lark_md） */
  body: string
}

export interface AiJudgment {
  status: string
  verdict: string
  facts: AiFact[]
  risks: AiFact[]
  conclusion: { title: string; body: string } | null
}

function strip(s: string): string {
  return s.replace(/<text_tag[^>]*>/g, '').replace(/<\/text_tag>/g, '').trim()
}

/** 一行 `**标题**  正文` → {title, body}；无加粗标题时 title 为空。 */
export function splitLabel(line: string): { title: string; body: string } {
  const m = /^\*\*(.+?)\*\*[\u3000\s]*(.*)$/s.exec(line.trim())
  if (!m) return { title: '', body: line.trim() }
  return { title: m[1].trim(), body: m[2].trim() }
}

export function parseAi(lines: string[]): AiJudgment {
  const out: AiJudgment = { status: '', verdict: '', facts: [], risks: [], conclusion: null }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // 风险 A/B/C/D（原文用 text_tag 着色）
    const risk = /^风险\s*([A-Z])/.exec(strip(line))
    if (risk) {
      const { title, body } = splitLabel(line.replace(/<text_tag[^>]*>风险\s*[A-Z]<\/text_tag>/, ''))
      out.risks.push({ tag: `风险 ${risk[1]}`, title, body: body || title })
      continue
    }

    // 四个事实
    const fact = /^\*\*(第[一二三四五六七八九十]+个事实)(?:\s*·\s*(.+?))?\*\*[\u3000\s]*(.*)$/s.exec(line)
    if (fact) {
      out.facts.push({ tag: fact[1], title: fact[2] || '', body: fact[3] || '' })
      continue
    }

    // 「是不是换了主线」结论
    if (/^\*\*是不是换了主线\*\*/.test(line)) {
      const { title, body } = splitLabel(line)
      out.conclusion = { title: title.replace(/^是不是/, ''), body }
      continue
    }

    // 盘面状态 / 判断（可能同一行用换行分隔）
    for (const part of line.split('\n')) {
      const { title, body } = splitLabel(part)
      if (/^盘面状态$/.test(title)) out.status = body
      else if (/^判断$/.test(title)) out.verdict = body
      else if (title) out.conclusion = out.conclusion ?? { title, body }
      else if (!out.verdict) out.verdict = body
    }
  }
  return out
}
