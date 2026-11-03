#!/usr/bin/env node
/**
 * 路由双源一致性校验 —— 防「前端 routes.ts 单一真源」与「猎手 serve.py PUBLIC_ROUTES」再次分叉。
 *
 * ## 为什么需要它
 *
 * 前端 `src/shared/api/routes.ts` 是数据路由的**唯一真源**（83 条，由 `npm run data` 实跑验证
 * 83/83 可用）。生产白名单 `serve.py` 的 `PUBLIC_ROUTES` 必须与之**逐键一致**；历史上曾因
 * 手工复制发生分叉（prod 漏登 `/api/board/leader-daily` → LeaderDailyPage 在 dev 有、prod 404）。
 *
 * 本脚本把「两份定义是否一致」变成**可执行的门禁**：
 *   · 真源侧：直接 `import { ROUTES }`（与 `npm run data` 同一份数据，含 retired / 两层目录型）。
 *   · 生产侧：文本解析 `serve.py` 的 `PUBLIC_ROUTES` 顶层 key 集合（只取 key，不求值 value）。
 *   · 比对：仅前端有 / 仅后端有 → 任一侧非空即视为漂移，退出码 1。
 *
 * ## 解析安全性说明
 *
 * `PUBLIC_ROUTES` 的 value 是单行 dict（无嵌套 dict），且 raw-string 正则里含 `{4}` 之类的字符，
 * 因此**不做脆弱的大括号配平**，而是：从 `PUBLIC_ROUTES = {` 行取到下一个**列 0 的 `}`**（块内所有
 * 条目均为缩进单行、`}` 只在行尾），再在该块内用 `/['"](\/api\/[^'"]+)['"]\s*:\s*\{/` 抽取顶层 key。
 * 该正则要求 `/api/...` 必须是「紧跟 `: {` 的字典键」，故 desc 文案里提到的其他路由（如
 * “真实竞价见 /api/decision/auction-history”）不会误命中。
 *
 * ## 用法
 *   node scripts/check-route-parity.mjs                # 严格：serve.py 缺失即失败（exit 1）
 *   node scripts/check-route-parity.mjs --no-serve    # 仅校验真源可解析（后端不在工作区时）
 *   SERVE_PY=/abs/path/serve.py node scripts/check-route-parity.mjs   # CI 布局不同时指定后端
 *
 * 退出码：0 = 双源一致；1 = 存在漂移（或后端缺失且非 --no-serve）；2 = serve.py 解析异常。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES } from '../src/shared/api/routes.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const NO_SERVE = args.has('--no-serve')

/**
 * 解析 serve.py 中 PUBLIC_ROUTES 的顶层 /api key 集合（仅取 key，不求值）。
 * @returns {Set<string>|null} 解析失败返回 null
 */
function extractPublicRouteKeys(text) {
  const lines = text.split('\n')
  const startIdx = lines.findIndex((l) => l.startsWith('PUBLIC_ROUTES'))
  if (startIdx < 0) return null

  // 从 `PUBLIC_ROUTES = {` 取到其列 0 闭合 `}` 之间的全部行。
  // 块内所有条目均为缩进单行（以 `},` 结尾），唯一列 0 的 `}` 即 PUBLIC_ROUTES 闭合。
  const block = []
  for (let k = startIdx; k < lines.length; k++) {
    block.push(lines[k])
    if (k > startIdx && lines[k].trim() === '}') break
  }
  const blockText = block.join('\n')

  // 仅「紧跟 : { 的 /api/... 引号串」才是 PUBLIC_ROUTES 的顶层 key（value 无嵌套 dict）。
  const re = /['"](\/api\/[^'"]+)['"]\s*:\s*\{/g
  const keys = new Set()
  let m
  while ((m = re.exec(blockText)) !== null) keys.add(m[1])
  return keys
}

// ── 真源侧（routes.ts，与 `npm run data` 同源）──
const frontendRoutes = new Set(Object.keys(ROUTES))

if (NO_SERVE) {
  console.log('ℹ️  --no-serve：跳过生产白名单校验，仅确认真源可解析。')
  console.log(`✓ 真源 routes.ts 可解析，共 ${frontendRoutes.size} 条路由（含 retired / 两层目录型）。`)
  process.exit(0)
}

// ── 生产侧（serve.py PUBLIC_ROUTES）──
const servePath =
  process.env.SERVE_PY || path.resolve(ROOT, '..', '狸猫猎手', 'serve.py')

let backendRoutes
if (!fs.existsSync(servePath)) {
  console.error(`✗ 未找到生产白名单文件：${servePath}`)
  console.error('   请确认后端仓库位置，或设置 SERVE_PY 环境变量指向 serve.py；')
  console.error('   若后端不在当前工作区，可用 --no-serve 仅校验真源。')
  process.exit(1)
}
try {
  backendRoutes = extractPublicRouteKeys(fs.readFileSync(servePath, 'utf-8'))
  if (!backendRoutes) {
    console.error('✗ 未能在 serve.py 中解析出 PUBLIC_ROUTES（结构可能已变更，请人工核对）。')
    process.exit(2)
  }
} catch (e) {
  console.error(`✗ 读取 / 解析 serve.py 失败：${e instanceof Error ? e.message : String(e)}`)
  process.exit(2)
}

// ── 比对 ──
const onlyFrontend = [...frontendRoutes].filter((r) => !backendRoutes.has(r))
const onlyBackend = [...backendRoutes].filter((r) => !frontendRoutes.has(r))

console.log(`真源 routes.ts 路由数：${frontendRoutes.size}`)
console.log(`生产 PUBLIC_ROUTES 路由数：${backendRoutes.size}（来源：${servePath}）`)

let ok = true
if (onlyFrontend.length) {
  ok = false
  console.error(`\n✗ 仅前端有、生产未登记（prod 会 404）：${onlyFrontend.length} 条`)
  for (const r of onlyFrontend) console.error(`    + ${r}`)
}
if (onlyBackend.length) {
  ok = false
  console.error(`\n✗ 仅生产有、前端无对应真源（疑似脏数据 / 拼写漂移）：${onlyBackend.length} 条`)
  for (const r of onlyBackend) console.error(`    - ${r}`)
}

if (ok) {
  console.log('\n✓ 路由双源一致：routes.ts 与 serve.py PUBLIC_ROUTES 逐键对齐，无漂移。')
  process.exit(0)
} else {
  console.error('\n✗ 检测到路由漂移，请同步两端后再合入。')
  process.exit(1)
}
