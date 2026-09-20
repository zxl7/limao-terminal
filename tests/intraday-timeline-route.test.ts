import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV, type IntradayTimelineEvent } from '@/shared/api'
import { buildLimitSeries, pickLiveBasis } from '@/features/analytics'
// eslint-disable-next-line
import { readRoute, resolveDataRoot } from '../scripts/lib/read-route.mjs'

/**
 * `/api/intraday/timeline` 的**形态回归锁**。
 *
 * ⛔ 曾经的缺陷（2026-09-19 用户抓包「K 线上只看得到涨停 / 是不是实时的」）：
 *    该路由是 `mode: 'latest'` —— **只吐文件名最新的那一天**。
 *    而消费方（时间轴页）要的是「近几个交易日里**任一天**」的逐事件，
 *    摊平后按所选日期过滤 → 必然空集 → 曲线退化成盘后「累计涨停」单线
 *    （跌停、炸板率整条消失，用户看不到）。
 *
 * ⛔ 修复过程中暴露的**第二层**缺陷（同一次冒烟测试抓到）：
 *    `read-route.mjs` 把路由的 `limit` 当成「**每个 JSONL 文件**取尾部几行」，
 *    于是一旦给它设 `limit` 限文件数，就**顺带把每天截断**——曲线变水平线。
 *    现拆为两个维度：`limit`（文件数）/ `lines`（每文件行数）。
 *
 * 本组锁三件事：① 多日形态；② 每文件是**整日**（不被截断）；③ 基准日三序列非空。
 *
 * ⚠️ 与 `limit-series.test.ts` 的分工：那边锁**算法不变量**（合成数据），
 *    这边锁**路由形态 + 数据链路**（真实落盘数据，同 `page-charts.test.tsx` 风格）。
 */

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

const CACHE_DIR = path.join(DATA_ROOT, 'cache')

const matchingFiles = () =>
  readdirSync(CACHE_DIR)
    .filter((n) => /^intraday_timeline_\d{8}\.jsonl$/.test(n))
    .sort()

const readFiles = () =>
  readRoute(DATA_ROOT, ROUTES['/api/intraday/timeline']) as Array<{
    file: string
    data: IntradayTimelineEvent[] | null
  }>

describe('/api/intraday/timeline 路由', () => {
  it('必须是多日形态（回归锁：曾为 latest，只吐最新一天）', () => {
    const def = ROUTES['/api/intraday/timeline']
    expect(def.mode).toBe('all')
    expect(def.limit ?? 0).toBeGreaterThan(0)
    expect(def.format).toBe('jsonl')
    expect(def.cadence).toBe('intraday')
  })

  it('真实数据：交出所有匹配文件（上限 limit）—— 这正是 latest 做不到的', () => {
    const def = ROUTES['/api/intraday/timeline']
    const matching = matchingFiles()
    expect(matching.length, '无 intraday_timeline_*.jsonl 落盘').toBeGreaterThan(0)

    const files = readFiles()
    expect(Array.isArray(files), '目录型路由应返回 [{file, data}] 数组').toBe(true)
    // ⛔ 核心断言：匹配到的文件**全部**在响应里（而不是只有最新那个）
    expect(files.length).toBe(Math.min(def.limit ?? 0, matching.length))
    expect(files.map((f) => f.file)).toEqual(matching.slice(-(def.limit ?? 0)))
  })

  it('⛔ 每个文件都必须是「整日」逐事件 —— 不得被行数上限截断', () => {
    const files = readFiles()
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const rows = readFileSync(path.join(CACHE_DIR, f.file), 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
      // 允许 ±1 行容差：守护进程可能正在追加，读到半行会被 `parseJsonl` 跳过
      expect(
        f.data?.length ?? 0,
        `${f.file} 被截断（尾部行数上限 < 实际行数）—— 曲线会缺掉早盘`,
      ).toBeGreaterThanOrEqual(rows.length - 1)
    }
  })

  it('真实数据：摊平后基准日能算出「涨停 / 跌停 / 炸板率」三序列', () => {
    const events = readFiles().flatMap((f) => f.data ?? [])
    expect(events.length).toBeGreaterThan(0)

    const basis = pickLiveBasis(events)
    expect(basis, '近端无「盘中窗口事件」→ 曲线会退化成盘后单线').not.toBeNull()

    const s = buildLimitSeries(basis!.events)
    expect(s.zt.length).toBe(s.labels.length)
    expect(s.zt.some((v) => v != null), '基准日涨停序列全 null').toBe(true)
    expect(s.ld.some((v) => v != null), '基准日跌停序列全 null').toBe(true)
    expect(s.brokenRate.some((v) => v != null), '基准日炸板率序列全 null').toBe(true)
    // ⛔ 点数锁：曲线若只剩 1~2 个点，说明事件被截断（只剩收盘附近几条）
    expect(
      s.zt.filter((v) => v != null).length,
      '基准日曲线点数过少 —— 事件疑似被截断',
    ).toBeGreaterThan(5)
  })
})
