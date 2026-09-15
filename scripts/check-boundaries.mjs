#!/usr/bin/env node
/**
 * 分层边界校验器 —— 把「架构约定」变成**可执行的检查**。
 *
 * ## 为什么需要它
 *
 * 分层的敌人不是「不知道怎么分」，而是「分完之后慢慢腐化」：某天有人为了省事
 * 在 `shared/lib` 里 `import { useQuery }`，在 `features` 里 `import ... from '@/pages/...'`。
 * 没有机器检查时，这种违规会一路累积，直到分层名存实亡。
 *
 * 本脚本只做一件事：扫描 import 语句，比对层级规则，违规就退出码 1。
 *
 * ## 规则（违反即失败）
 *
 *   1. shared/**        不得依赖 features / pages / app
 *   2. shared/lib/**    不得依赖 react（保持框架无关，可被 Node 脚本复用）
 *   3. features/**      不得依赖 pages / app
 *   4. pages/**         不得依赖 app
 *   5. 上层访问 shared 必须走 barrel：禁止 `@/shared/api/client` 这类深路径
 *
 * 用法：node scripts/check-boundaries.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

/** 收集 src 下全部 ts/tsx */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, out)
    else if (/\.tsx?$/.test(e.name)) out.push(abs)
  }
  return out
}

/** 抽出文件里的全部 import 来源 */
function importsOf(code) {
  const out = []
  // import ... from '...'   /   import '...'   /   export ... from '...'
  const re = /(?:^\s*import[\s\S]*?\sfrom\s*|^\s*import\s*|^\s*export[\s\S]*?\sfrom\s*)['"]([^'"]+)['"]/gm
  let m
  while ((m = re.exec(code)) !== null) out.push(m[1])
  return out
}

/** '@/shared/api/client' → ['shared','api']；'@/features/x' → ['features','x'] */
function layerOf(spec) {
  if (spec === 'react' || spec.startsWith('react/') || spec.startsWith('react-dom')) return ['react']
  if (!spec.startsWith('@/')) return []
  return spec.slice(2).split('/')
}

const LAYERS = ['shared', 'features', 'pages', 'app']
const violations = []

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file)
  const parts = rel.split(path.sep)
  const selfLayer = parts[0]
  if (!LAYERS.includes(selfLayer)) continue

  const code = fs.readFileSync(file, 'utf-8')

  for (const spec of importsOf(code)) {
    const target = layerOf(spec)
    if (target.length === 0) continue

    const at = (msg) => violations.push({ file: rel, spec, msg })

    // 规则 2：shared/lib 保持框架无关
    if (selfLayer === 'shared' && parts[1] === 'lib' && target[0] === 'react') {
      at('shared/lib 必须框架无关：禁止依赖 react（它要能被 Node 脚本 / 测试直接复用）')
      continue
    }

    // 规则 1：shared 不得依赖上层
    if (selfLayer === 'shared' && ['features', 'pages', 'app'].includes(target[0])) {
      at(`shared 不得依赖 ${target[0]}（依赖倒置）`)
      continue
    }

    // 规则 3：features 不得依赖 pages / app
    if (selfLayer === 'features' && ['pages', 'app'].includes(target[0])) {
      at(`features 不得依赖 ${target[0]}（依赖倒置）`)
      continue
    }

    // 规则 4：pages 不得依赖 app
    if (selfLayer === 'pages' && target[0] === 'app') {
      at('pages 不得依赖 app（app 是装配层，依赖方向必须向下）')
      continue
    }

    // 规则 5：上层访问 shared 须走 barrel
    if (selfLayer !== 'shared' && target[0] === 'shared') {
      // 允许 @/shared/<domain> 与 @/shared/<domain>/index
      const rest = target.slice(2)
      if (rest.length > 0 && rest[rest.length - 1] !== 'index') {
        at(
          `访问 shared 必须走 barrel（用 '@/${target.slice(0, 2).join('/')}'，` +
            `而不是 '${spec}'）。barrel 是契约边界，深路径导入会让内部重构引发全项目雪崩`,
        )
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✓ 分层边界校验通过（shared ← features ← pages ← app，无跨层反向依赖）')
  process.exit(0)
}

console.error(`✗ 发现 ${violations.length} 处分层违规：\n`)
for (const v of violations) {
  console.error(`  ${v.file}`)
  console.error(`    import '${v.spec}'`)
  console.error(`    → ${v.msg}\n`)
}
process.exit(1)
