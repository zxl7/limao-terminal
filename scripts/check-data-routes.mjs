#!/usr/bin/env node
/**
 * 数据链路体检 —— 命令行版的 `/api/health`。
 *
 * ## 为什么不直接 curl 页面
 *
 * 体检要能在**没有前端进程**的情况下跑：迁移服务器后、守护进程出问题后、
 * CI 里，都需要一条「只依赖文件系统」的命令回答同一个问题：
 * **原系统的数据，前端现在能不能拿到？**
 *
 * ## 判定方式：真实调用读取逻辑，而不是「文件是否存在」
 *
 * 早期版本只 `statSync` 检查文件是否存在，结果对**目录型 / 两层目录型 / JSONL**
 * 三类路由全部误报（拼出假路径 → 报缺失，而页面其实读得到）。现在一律调用
 * `readRoute()` 走**与运行时完全相同的代码路径**，并回报：
 *   · 可用性（读取成功且非空）
 *   · **实际响应体积**（序列化后的字节数 —— 判断某条路由是否会撑爆响应）
 *   · 记录条数（目录型 = 匹配到的文件数）
 *
 * 用法：
 *   node scripts/check-data-routes.mjs           # 摘要
 *   node scripts/check-data-routes.mjs --verbose # 附每条路由的顶层字段与体积
 *   node scripts/check-data-routes.mjs --json    # 机器可读
 *   node scripts/check-data-routes.mjs --big     # 只列出体积偏大的路由
 *
 * 退出码：0 = 至少一半路由可用；1 = 数据源整体不可用（通常是数据根配错）
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from '../src/shared/api/routes.ts'
import { readRoute, resolveDataRoot } from './lib/read-route.mjs'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_ROOT = resolveDataRoot(PROJECT_ROOT, DEFAULT_DATA_ROOT, DATA_ROOT_ENV)

const args = new Set(process.argv.slice(2))
const VERBOSE = args.has('--verbose') || args.has('-v')
const AS_JSON = args.has('--json')
const ONLY_BIG = args.has('--big')

/** 响应体积警戒线：单条路由超过此值需考虑加入 limit 或改 latest */
const BIG_BYTES = 300 * 1024

// ── 采集：对每条路由真实执行读取 ──

const rows = []

for (const [route, def] of Object.entries(ROUTES)) {
  const row = { route, desc: def.desc, target: def.file ?? def.dir ?? '—', cadence: def.cadence ?? '—' }
  try {
    const data = readRoute(DATA_ROOT, def)
    const isArr = Array.isArray(data)
    // 目录型：数组里每项形如 {file, data}；统计其中真正有内容的条数
    let count = 0
    if (isArr) {
      count = data.filter((x) => x && typeof x === 'object' && 'data' in x ? x.data != null : true).length
    } else if (data != null) {
      count = 1
    }
    const bytes = data == null ? 0 : Buffer.byteLength(JSON.stringify(data), 'utf-8')

    row.exists = count > 0
    row.count = count
    row.bytes = bytes
    row.empty = isArr && isArr.length === 0

    if (VERBOSE && row.exists) {
      const probe = isArr ? data.at(-1)?.data ?? data.at(-1) : data
      row.keys = probe && typeof probe === 'object' ? Object.keys(probe).slice(0, 14) : []
    }

    // 新鲜度取路由实际匹配的文件；cache 目录里其他归档不能代表时间轴的更新时间。
    const abs = path.join(DATA_ROOT, def.file ?? def.dir ?? '')
    let probeAbs = abs
    if (def.dir && def.dirPattern && def.file) {
      try {
        const dirs = fs.readdirSync(path.join(DATA_ROOT, def.dir))
          .filter((name) => new RegExp(def.dirPattern).test(name))
          .sort()
        if (dirs.length) probeAbs = path.join(DATA_ROOT, def.dir, dirs.at(-1), def.file)
      } catch {
        /* 日期目录不存在：mtime 留空 */
      }
    } else if (!def.file) {
      try {
        const pattern = new RegExp(def.pattern)
        const names = fs.readdirSync(abs).filter((name) => pattern.test(name)).sort()
        if (names.length) probeAbs = path.join(abs, names.at(-1))
      } catch {
        /* 目录不存在：mtime 留空 */
      }
    }
    try {
      const st = fs.statSync(probeAbs)
      row.age_sec = Math.round((Date.now() - st.mtimeMs) / 1000)
    } catch {
      row.age_sec = null
    }
  } catch (e) {
    Object.assign(row, { exists: false, count: 0, bytes: 0, age_sec: null, error: e instanceof Error ? e.message : String(e) })
  }
  rows.push(row)
}

// ── 输出 ──

if (AS_JSON) {
  console.log(JSON.stringify({ data_root: DATA_ROOT, ts: new Date().toISOString(), rows }, null, 2))
  process.exit(0)
}

const ok = rows.filter((r) => r.exists)
const missing = rows.filter((r) => !r.exists)

const fmtAge = (s) =>
  s == null ? '—' : s < 60 ? `${s}秒前` : s < 3600 ? `${Math.round(s / 60)}分前` : `${Math.round(s / 3600)}时前`

const fmtSize = (b) => (b === 0 ? '—' : b < 1024 ? `${b}B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`)

console.log(`数据根: ${DATA_ROOT}`)
console.log(`体检时间: ${new Date().toISOString()}`)
console.log('')

const W = 28
console.log('路由'.padEnd(W), '状态'.padEnd(5), '新鲜度'.padEnd(9), '体积'.padEnd(10), '条数'.padEnd(7), '目标')
console.log('─'.repeat(112))

for (const r of rows) {
  const status = r.exists ? '✓' : '✗'
  console.log(
    r.route.padEnd(W),
    status.padEnd(5),
    (r.exists ? fmtAge(r.age_sec) : '—').padEnd(9),
    (r.exists ? fmtSize(r.bytes) : '—').padEnd(10),
    (r.exists ? String(r.count) : '—').padEnd(7),
    r.target,
  )
  if (VERBOSE && r.exists && r.keys?.length) {
    console.log(' '.repeat(W), `└ ${r.keys.join(', ')}`)
  }
  if (r.error) console.log(' '.repeat(W), `└ 读取失败: ${r.error}`)
}

console.log('')
console.log(`可用 ${ok.length}/${rows.length}　缺失 ${missing.length}`)

// 体积警戒：单条路由过大会拖慢首屏
const big = ok.filter((r) => r.bytes > BIG_BYTES).sort((a, b) => b.bytes - a.bytes)
if (big.length && !ONLY_BIG) {
  console.log('')
  console.log(`⚠️ 响应体积 > ${BIG_BYTES / 1024}KB 的路由（考虑 limit / latest / 分页）：`)
  for (const r of big) console.log(`  · ${r.route.padEnd(W)} ${fmtSize(r.bytes)}  (${r.target})`)
}

if (missing.length > 0) {
  console.log('')
  console.log('缺失明细（盘前属正常；交易日盘中缺失需排查守护进程）：')
  for (const r of missing) {
    console.log(`  · ${r.route}  →  ${r.target}  (${r.desc})`)
  }
}

const totalBytes = ok.reduce((s, r) => s + r.bytes, 0)
console.log('')
console.log(`全部可用路由合计体积: ${fmtSize(totalBytes)}`)

// 多数路由不可用 → 数据根几乎肯定配错了，让 CI / 脚本能感知
process.exit(ok.length * 2 >= rows.length ? 0 : 1)
