/**
 * 「路由 → 落盘文件」读取逻辑 —— **单一真源**。
 *
 * 为什么单独抽出来：同一段语义要被两个执行者使用 ——
 *   · 开发期：`vite.config.ts` 的中间件（前端本地跑）
 *   · 校验期：`scripts/check-data-routes.mjs`（命令行体检）
 * 若各写一份，一旦原系统调整落盘路径或命名，两份实现会漂移，
 * 出现「页面能看、体检说没数据」这类互相矛盾的现象。
 *
 * ⚠️ 本模块只做**读取与透传**，不做任何字段改写。原系统（狸猫猎手）的数据结构
 *    是契约，改造数据结构是后续独立议题，不能藏在这一层里悄悄做。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 安全读取目录（不存在时返回空数组，不抛异常 —— 数据缺失是正常状态） */
function safeReaddir(abs) {
  try {
    return fs.readdirSync(abs)
  } catch {
    return null
  }
}

/** JSONL 尾部行数上限（**默认**）—— 账本类文件 append-only，全量会无限增长 */
const JSONL_DEFAULT_TAIL = 500

/**
 * 按行解析 JSONL（单行损坏不影响其余行）。
 *
 * ⚠️ `lines` 与路由的 `limit` 是**两个维度**，不要混用：
 *    · `limit` = 取**几个文件**（`mode: 'all'`）；
 *    · `lines` = 每个文件取**尾部几行**。
 *
 * ⛔ 2026-09-19 修：此前本函数直接拿 `limit` 当行数用，于是给「目录型 JSONL」路由
 *    加 `limit` 会**顺带截断每个文件** —— 盘中情绪时间轴因此每天只剩最后 5 行，
 *    曲线退化成一条水平线（用户抓包「K 线上只看得到涨停」）。
 *
 * @param {string} raw 文件原文
 * @param {number} [lines] 尾部行数上限；缺省 = `JSONL_DEFAULT_TAIL`
 */
function parseJsonl(raw, lines) {
  const rows = raw.split('\n')
  const tail = lines && lines > 0 ? rows.slice(-lines) : rows.slice(-JSONL_DEFAULT_TAIL)
  const out = []
  for (const line of tail) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      // 尾部可能正在被写入（读到半行）—— 跳过而非整批失败
    }
  }
  return out
}

/**
 * 按路由定义读取数据。
 *
 * 支持四种形态：
 *   ① 单文件          { file }                          cache/pulse_snapshots/latest.json
 *   ② 目录 + 文件名   { dir, pattern }                  cache/zt_genes 下 hist_*.json
 *   ③ 两层目录        { dir, dirPattern, file }         cache/decision_log/<日期>/candidates.json
 *   ④ 数量截断        { ..., limit }                    只取**最新** N 个（防止历史无限增长撑爆响应）
 *
 * @param {string} dataRoot 数据根目录（绝对路径）
 * @param {{file?: string, dir?: string, pattern?: string, dirPattern?: string, mode?: 'latest'|'all', limit?: number, lines?: number, format?: 'json'|'jsonl'|'text'}} def
 * @returns {unknown} 解析后的 JSON；目录型按 mode 返回单个或数组
 */
export function readRoute(dataRoot, def) {
  // ── 形态 ③：两层目录（<dir>/<日期目录>/<file>）──
  // 必须先于形态 ① 判断：该类定义同时含 dir 与 file，若先命中「单文件」会把
  // `<dirPattern>` 当字面路径拼接，得到必然 ENOENT 的假路径（且错误会被吞成 404）。
  if (def.dir && def.dirPattern && def.file) {
    const base = path.join(dataRoot, def.dir)
    const names = safeReaddir(base)
    if (names === null) return def.mode === 'all' ? [] : null

    const dre = new RegExp(def.dirPattern)
    const dirs = names
      .filter((n) => dre.test(n) && fs.statSync(path.join(base, n)).isDirectory())
      .sort()

    const readOne = (d) => {
      const rel = `${d}/${def.file}`
      try {
        return { file: rel, data: JSON.parse(fs.readFileSync(path.join(base, d, def.file), 'utf-8')) }
      } catch {
        // 单日文件损坏不应让整条历史链路失败 —— 标记为 null 继续
        return { file: rel, data: null }
      }
    }

    if (def.mode === 'all') {
      return (def.limit ? dirs.slice(-def.limit) : dirs).map(readOne)
    }
    const last = dirs.at(-1)
    return last ? readOne(last).data : null
  }

  // ── 形态 ①：单文件 ──
  if (def.file) {
    const raw = fs.readFileSync(path.join(dataRoot, def.file), 'utf-8')
    // JSONL（账本类 append-only）按行解析为数组，否则常规 JSON 解析
    if (def.format === 'jsonl') return parseJsonl(raw, def.lines)
    /**
     * `text` = **原样返回字符串**，不在本层解析。
     *
     * 用途：YAML 等 JSON 之外的格式（如 `config/tasks.yaml` 任务台账）。
     * 为什么不在本层解析成对象：本项目的依赖是刻意收敛的（无 yaml 包），
     * 而为了一个结构高度规整的配置文件引入 YAML 解析器不划算；
     * 且中间件统一走 `JSON.stringify`，返回字符串会被序列化成 JSON 字符串，
     * 前端 `res.json()` 拿到的就是原文 —— 语义无损。
     * 解析职责交给消费方，并**只解析它需要的子集**。
     */
    if (def.format === 'text') return raw
    return JSON.parse(raw)
  }

  // ── 形态 ②：目录 + 文件名 glob ──
  if (def.dir && def.pattern) {
    const dir = path.join(dataRoot, def.dir)
    const names = safeReaddir(dir)
    if (names === null) return def.mode === 'all' ? [] : null

    const re = new RegExp(def.pattern)
    const files = names.filter((f) => re.test(f)).sort()

    /**
     * ⛔ 2026-09-17 修：形态②（目录 + pattern）此前**忽略 `format`**，对 JSONL 文件直接
     * `JSON.parse` 必然抛错 → 路由被判「缺失」（实测 `/api/intraday/timeline`）。
     * 现与形态① 对齐：`jsonl` 按行解析；`text` 原样返回。
     */
    const readOne = (f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
      if (def.format === 'jsonl') return parseJsonl(raw, def.lines)
      if (def.format === 'text') return raw
      return JSON.parse(raw)
    }

    if (def.mode === 'all') {
      return (def.limit ? files.slice(-def.limit) : files).map((f) => {
        try {
          return { file: f, data: readOne(f) }
        } catch {
          return { file: f, data: null }
        }
      })
    }
    const last = files.at(-1)
    return last ? readOne(last) : null
  }

  return null
}

/**
 * 数据新鲜度体检载荷。
 * 与前端 `HealthPayload` 类型对应（`src/shared/api/types.ts`）。
 * @param {string} dataRoot 数据根目录（绝对路径）
 * @param {Array<[string, object]>} fileRoutes 形如 [['/api/market/latest', {file, desc}], ...]
 */
/** 与 readRoute 的名称排序和 limit 选择一致；只探测匹配的实际文件，绝不使用目录 mtime。 */
function routeProbe(dataRoot, def) {
  const base = path.join(dataRoot, def.dir ?? '')
  let candidates = []
  if (def.dir && def.dirPattern && def.file) {
    const re = new RegExp(def.dirPattern)
    const dirs = (safeReaddir(base) ?? []).filter((name) => {
      try { return re.test(name) && fs.statSync(path.join(base, name)).isDirectory() } catch { return false }
    }).sort()
    candidates = (def.mode === 'all' ? (def.limit ? dirs.slice(-def.limit) : dirs) : dirs.slice(-1))
      .map((name) => path.join(base, name, def.file))
  } else if (def.file) {
    candidates = [path.join(dataRoot, def.file)]
  } else if (def.dir && def.pattern) {
    const re = new RegExp(def.pattern)
    const files = (safeReaddir(base) ?? []).filter((name) => re.test(name)).sort()
    candidates = (def.mode === 'all' ? (def.limit ? files.slice(-def.limit) : files) : files.slice(-1))
      .map((name) => path.join(base, name))
  }
  const file = candidates.at(-1)
  if (!file) return null
  try { return fs.statSync(file).isFile() ? file : null } catch { return null }
}

export function healthPayload(dataRoot, fileRoutes) {
  const now = Date.now()
  return {
    data_root: dataRoot,
    ts: new Date().toISOString(),
    files: fileRoutes.map(([route, def]) => {
      // 与生产代理一致：探测返回范围中按名称排序的最后一期，缺失不回退旧文件。
      const target = def.file ?? def.dir
      const probe = routeProbe(dataRoot, def)
      try {
        const st = fs.statSync(probe)
        return {
          route,
          file: target,
          desc: def.desc,
          kind: def.file ? 'file' : 'dir',
          cadence: def.cadence ?? 'daily',
          retired: !!def.retired,
          asof: asofOf(probe),
          exists: true,
          mtime: st.mtime.toISOString(),
          age_sec: Math.round((now - st.mtimeMs) / 1000),
          size: st.size,
        }
      } catch {
        // 文件未生成是**可预期状态**（盘前），不是异常
        return {
          route, file: target, desc: def.desc,
          kind: def.file ? 'file' : 'dir',
          cadence: def.cadence ?? 'daily',
          retired: !!def.retired,
          asof: null,
          exists: false, mtime: null, age_sec: null, size: 0,
        }
      }
    }),
  }
}

/**
 * cadence → 过期阈值（秒）。与 `common/data_catalog.py::STALE_SEC` 保持一致。
 * null = 不检查（retired / manual / on-demand）。
 */
const STALE_SEC = { intraday: 1800, daily: 172800, manual: null, 'on-demand': null }

/**
 * 计算某路由产物的新鲜度响应头（与 serve.py `route_freshness` 对齐）。
 *
 * 开发期由 vite 中间件注入，使前端 <AgeBadge> / 数据新鲜度面板在本地也能工作，
 * 与生产（serve.py 注入 X-Data-*）行为一致。命名刻意对齐：
 *   X-Data-Age / X-Data-Stale / X-Data-Retired / X-Data-Producer
 *
 * @param {object} def 路由定义（routes.ts 的 RouteDef）
 * @param {string} dataRoot 数据根目录（绝对路径）
 * @returns {Record<string,string>} 要注入的响应头
 */
export function freshnessHeaders(def, dataRoot) {
  const target = def.file ?? def.dir
  if (!target) return {}
  const probe = routeProbe(dataRoot, def)
  try {
    const st = fs.statSync(probe)
    const age = Math.round((Date.now() - st.mtimeMs) / 1000)
    const staleSec = def.retired ? null : STALE_SEC[def.cadence] ?? null
    const isStale = staleSec == null ? null : age > staleSec
    return {
      'X-Data-Age': String(age),
      'X-Data-Stale': isStale == null ? '' : isStale ? '1' : '0',
      'X-Data-Retired': def.retired ? '1' : '0',
      'X-Data-Producer': '',
    }
  } catch {
    return {
      'X-Data-Age': '',
      'X-Data-Stale': '',
      'X-Data-Retired': def.retired ? '1' : '0',
      'X-Data-Producer': '',
    }
  }
}

/**
 * 业务日期探测：从文件内容头部取 `date/asof/generated_ts/ts`，取不到再退回文件名里的日期。
 * 只读前 8KB —— 健康检查不能把 800KB 的决策文件整个读进内存。
 */
function asofOf(probe) {
  try {
    const fd = fs.openSync(probe, 'r')
    const buf = Buffer.alloc(8192)
    const n = fs.readSync(fd, buf, 0, 8192, 0)
    fs.closeSync(fd)
    const head = buf.subarray(0, n).toString('utf8')
    const m = /"(?:date|asof|as_of|generated_ts|generated_at|updated_at|ts)"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(head)
    if (m) return m[1]
  } catch {
    /* 读不到就走文件名兜底 */
  }
  const fname = /(\d{4})-?(\d{2})-?(\d{2})/.exec(path.basename(probe))
  return fname ? `${fname[1]}-${fname[2]}-${fname[3]}` : null
}

/**
 * 解析数据根目录。
 * 环境变量 `LIMAO_DATA_ROOT` 优先 —— 迁移服务器时无需改代码。
 * @param {string} projectRoot 项目根目录（绝对路径）
 * @param {string} defaultRelative 默认相对路径（来自 routes.ts）
 * @param {string} envName 环境变量名（来自 routes.ts）
 */
export function resolveDataRoot(projectRoot, defaultRelative, envName) {
  const fromEnv = process.env[envName]
  return path.isAbsolute(fromEnv ?? '')
    ? fromEnv
    : path.resolve(projectRoot, fromEnv ?? defaultRelative)
}
