import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Tailwind 类名「同属性竞争」守卫 —— 防的是一类**测试全绿、页面却明显不对**的静默失效。
 *
 * ## 真实事故（2026-09-21 用户抓包「左右结构呀！」）
 *
 * 盘中实时页两栏本该左右并排，实际上下堆叠。根因在**构建产物**里：
 *
 * | 规则 | 位置 | 媒体查询 |
 * |---|---|---|
 * | `.xl\:flex-row{flex-direction:row}` | 49365 | `@media (width>=80rem)` |
 * | `.flex-col{flex-direction:column}` | 66037 | **无**（裸工具类） |
 *
 * 同层（`@layer utilities`）、同权（单类选择器）⇒ **源码顺序决定**，而裸 `flex-col` 排在后面
 * → 它在**所有宽度**都赢 → `flex-col + xl:flex-row` 组合永远竖排。
 *
 * ⛔ **安全写法 = 两个互斥的媒体查询**：`max-xl:flex-col`（`@media not all and (width>=80rem)`）
 * ＋ `xl:flex-row`（`@media (width>=80rem)`）—— 互斥 ⇒ 不存在同属性竞争。
 *
 * ## 本文件锁三件事
 *
 * 1. 共享原语 `ZoneRow` **不得**再输出裸 `flex-col`（否则所有页面一起坏）；
 * 2. 全仓 `className` 字面量里**不得**同时出现「裸 flex-row/flex-col」与「响应式 flex-col/flex-row」；
 * 3. `src/styles/theme.css` 必须仍定义断点令牌（`max-xl:` 依赖它）。
 *
 * ⚠️ **已知同类问题（未修 · 待用户拍板，⛔ 本守卫暂不覆盖）**：
 * `src/app/Sidebar.tsx` 的 `hidden lg:flex`、`src/app/RightRail.tsx` 的 `hidden 3xl:flex`
 * —— `hidden`（display）与 `lg:flex` 同为「裸排在响应式之后」的同一机制，
 * 实际表现是侧栏恒隐藏、窄屏兜底导航恒显示。修法同上：`max-lg:hidden lg:flex`。
 * 因为这会**改变整个外壳的可见布局**，需用户确认后再动，故未纳入本次守卫。
 */

const SRC = path.resolve(import.meta.dirname, '../src')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, out)
    else if (/\.tsx?$/.test(e.name)) out.push(abs)
  }
  return out
}

/** 裸工具类（无 `xx:` 前缀）—— 只认「整个 token 就是它」 */
const BARE = new Set(['flex-row', 'flex-col'])
/** 响应式变体（`sm:`…`4xl:` 前缀） */
const VARIANT = /^(?:sm|md|lg|xl|2xl|3xl|4xl):flex-(?:row|col)$/

/** 从 className 字面量里抽 token（够用的近似：按空白切开，去掉内嵌条件拼接） */
function tokensOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

describe('Tailwind 同属性竞争守卫（flex-direction）', () => {
  it('共享原语 `ZoneRow` 不得输出裸 `flex-col`，且必须用互斥的 max-xl / xl', () => {
    const board = readFileSync(path.join(SRC, 'shared/ui/Board.tsx'), 'utf8')
    const m = /function ZoneRow[\s\S]*?className=\{cn\((.*?)\)\}/.exec(board)
    expect(m, '未能从 Board.tsx 解析出 ZoneRow 的 className —— 守卫失效，请同步本测试').toBeTruthy()
    const cls = m![1]
    const tokens = tokensOf(cls.replace(/['",]/g, ' '))
    expect(tokens, 'ZoneRow 不得出现裸 flex-col（它会覆盖 xl:flex-row，使所有页面两栏堆叠）').not.toContain('flex-col')
    expect(tokens, 'ZoneRow 不得出现裸 flex-row').not.toContain('flex-row')
    expect(cls, '窄屏单栏必须走 max-xl:flex-col（与 xl:flex-row 媒体互斥）').toContain('max-xl:flex-col')
    expect(cls, '宽屏横排').toContain('xl:flex-row')
  })

  it('全仓 className 字面量：裸 flex-row/col 与响应式 flex-col/row 不得同现', () => {
    const bad: string[] = []
    for (const file of walk(SRC)) {
      const code = readFileSync(file, 'utf8')
      // 只扫引号内的 className 字面量（含 cn() 里的分段字符串，逐段判即可）
      for (const lit of code.match(/(?:'|"|`)([^'"`\n]*(?:flex-row|flex-col)[^'"`\n]*)(?:'|"|`)/g) ?? []) {
        const tokens = tokensOf(lit.slice(1, -1))
        const hasBare = tokens.some((t) => BARE.has(t))
        const hasVariant = tokens.some((t) => VARIANT.test(t))
        if (hasBare && hasVariant) {
          bad.push(`${path.relative(SRC, file)} → ${lit.trim()}`)
        }
      }
    }
    expect(
      bad,
      '同一 className 里同时出现裸 flex-row/col 与响应式 flex-col/row：'
        + '裸的那条在构建产物里排在响应式之后，会在所有宽度生效 → 用 max-<bp>: 改写',
    ).toEqual([])
  })

  it('自定义断点令牌仍在（`max-xl:` 走的是 Tailwind 默认 xl=80rem，3xl/4xl 是项目自定义）', () => {
    const css = readFileSync(path.join(SRC, 'styles/theme.css'), 'utf8')
    // ⚠️ `lg`(64rem) / `xl`(80rem) 是 Tailwind 默认断点，theme.css 里刻意不重复定义；
    //    这里只锁项目自己加的两个（缺了会让 `3xl:`/`4xl:` 前缀的类静默失效）。
    for (const token of ['--breakpoint-3xl', '--breakpoint-4xl']) {
      expect(css, `缺少 ${token} —— 对应前缀的类会静默失效`).toContain(token)
    }
  })
})
