import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 页面文案闸：界面文字里不得出现工程词（2026-11-16 用户「可以」）。
 *
 * ## 为什么用 AST 而不是 grep
 * 注释里写「快照/兜底」是正常的（那是给我们自己看的）。grep 会把注释也算进去，
 * 天天误报；AST 只取**字符串字面量 / JSX 文本**，正好等于「用户会看到的字」。
 *
 * ## 规则来源
 * `狸猫猎手/架构/界面用语.md`：交易术语（涨停/连板/晋级率/回撤…）**保留**，
 * 只清工程词。禁用词与卡片侧的 `tests/test_card_lint_no_jargon.py` 同源。
 */

const BANNED = ['快照', '落盘', '兜底', '降级', '阈值', '产物', '字段', '接口', '路由']

/**
 * 刻意保留技术措辞的页面：这些是**排障用**的界面，翻成大白话反而查不了问题。
 * 新增例外必须写理由。
 */
const TECHNICAL_BY_DESIGN = [
  'src/pages/record/RecordPage.tsx', // 数据记录：诊断"文件龄期/契约"
  'src/pages/system/SystemPage.tsx', // 系统台账：配置项原名（阈值/备份/路由）
  'src/pages/data/DataPage.tsx', // 数据底座：数据契约本身
  'src/pages/archive/ArchivePage.tsx', // 决策存档：冻结件原文
  'src/pages/ops/OpsPage.tsx', // 运维审计
  'src/pages/rules/RulesPage.tsx', // 判据登记：判据原文
]

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) collectFiles(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p.split(path.sep).join('/'))
  }
  return out
}

interface Hit {
  file: string
  line: number
  word: string
  text: string
}

function scan(files: string[]): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      const isText = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
      if (isText) {
        const raw = node.getText(sf)
        for (const word of BANNED) {
          if (raw.includes(word)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
            hits.push({ file, line: line + 1, word, text: raw.replace(/\s+/g, ' ').slice(0, 60) })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return hits
}

describe('页面文案不得出现工程词', () => {
  it('交易类页面（排除排障页）', () => {
    const files = collectFiles('src/pages').filter((f) => !TECHNICAL_BY_DESIGN.includes(f))
    const hits = scan(files)
    const report = hits.map((h) => `${h.file}:${h.line} 用了「${h.word}」→ ${h.text}`)
    expect(report, `工程词要改成人话（或写进注释）：\n${report.join('\n')}`).toEqual([])
  })

  it('共享组件（features/analytics 等）同规则', () => {
    // 只扫 features：系统级组件（app/）里的"数据新鲜度"本身就是诊断信息，不在此列
    const hits = scan(collectFiles('src/features'))
    const report = hits.map((h) => `${h.file}:${h.line} 用了「${h.word}」→ ${h.text}`)
    expect(report, `共享组件里的工程词：\n${report.join('\n')}`).toEqual([])
  })
})
