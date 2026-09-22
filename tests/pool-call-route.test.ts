import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV, type PoolCallFile } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, resolveDataRoot } from '../scripts/lib/read-route.mjs'

/**
 * `/api/decision/pool-call` 的**口径回归锁**。
 *
 * ## 为什么单独锁这一条路由
 *
 * 2026-09-22 用户抓包：「数据对，所以我这边这个交易应该更新呀，不应该显示昨天的，
 * 应该显示今天 9:25 的这个。」
 *
 * 根因：AI 台账「判断明细」当时读的是 `/api/ai/view` —— 那是**前一交易日盘后**写的
 * **预案**（`bias`：focus/normal/avoid）。于是出现「真龙被判一般、跟风票被判重点看」，
 * 与今晨实际成交完全相反。**真正代表「今晨实际怎么做的」是 `pool_call`（09:25 竞价后定音）**，
 * 而它此前在 `routes.ts` 里**根本没有出口** → 前端无从取到。
 *
 * 本组锁四件事：
 *   ① 路由存在且必须是**多期**形态（`mode: 'all'` + `limit`）—— 单期会让历史日无法回看；
 *   ② 真实落盘可读，且 `trade_date` 与文件名一致；
 *   ③ 结构不变量：`view` 三值 / `quota_rank` 只给成交票 / `meta.participate` 与名额序自洽；
 *   ④ **日期口径**：`pool_call.trade_date === ai_view.date`（同为执行日）
 *      —— ⛔ 若有人误接成 `decision_date`（预案写作日），这里立刻红。
 */

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

const POOL_DIR = path.join(DATA_ROOT, 'wealth_code', 'cache')

const matchingFiles = () =>
  readdirSync(POOL_DIR)
    .filter((n) => /^pool_call-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()

const readFiles = () =>
  readRoute(DATA_ROOT, ROUTES['/api/decision/pool-call']) as Array<{
    file: string
    data: PoolCallFile | null
  }>

describe('/api/decision/pool-call 路由', () => {
  it('① 多期形态 + 落在 wealth_code/cache（回归锁：曾完全无出口）', () => {
    const def = ROUTES['/api/decision/pool-call']
    expect(def, 'pool_call 路由必须存在 —— 否则页面只能读到昨日预案').toBeTruthy()
    expect(def.mode).toBe('all')
    expect(def.limit ?? 0).toBeGreaterThan(0)
    expect(def.dir).toBe('wealth_code/cache')
    expect(def.pattern).toBe('^pool_call-\\d{4}-\\d{2}-\\d{2}\\.json$')
  })

  it('② 真实数据：交出所有匹配文件（上限 limit），文件名日期 == trade_date', () => {
    const def = ROUTES['/api/decision/pool-call']
    const matching = matchingFiles()
    expect(matching.length, '无 pool_call-*.json 落盘').toBeGreaterThan(0)

    const files = readFiles()
    expect(Array.isArray(files), '目录型路由应返回 [{file, data}] 数组').toBe(true)
    expect(files.length).toBe(Math.min(def.limit ?? 0, matching.length))
    expect(files.map((f) => f.file)).toEqual(matching.slice(-(def.limit ?? 0)))

    for (const f of files) {
      const dateInName = f.file.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
      expect(f.data?.trade_date, `${f.file} 的 trade_date 与文件名不符`).toBe(dateInName)
    }
  })

  it('③ 结构不变量：view 三值 / 名额只给成交票 / meta.participate 与名额序自洽', () => {
    const withViews = readFiles().filter((f) => (f.data?.views ?? undefined))
    expect(withViews.length).toBeGreaterThan(0)

    for (const f of withViews) {
      const d = f.data!
      const entries = Object.entries(d.views)

      for (const [code, v] of entries) {
        expect(v.code, `${code} 的 code 字段应与 key 一致`).toBe(code)
        expect(['participate', 'watch', 'skip']).toContain(v.view)
        // 竞价区间落点：只允许这四种（unknown = 无量价/停牌）
        expect(['ok', 'above', 'below', 'unknown']).toContain(v.zone)
        if (v.view === 'participate') {
          expect(typeof v.quota_rank, `${v.name} 判定参与却无名额序`).toBe('number')
        } else {
          expect(v.quota_rank ?? null, `${v.name} 未参与却占着名额序`).toBeNull()
        }
      }

      // 名额序必须从 1 起连续，且与 meta.participate 的顺序一致
      const ranked = entries
        .filter(([, v]) => v.quota_rank != null)
        .sort((a, b) => (a[1].quota_rank ?? 0) - (b[1].quota_rank ?? 0))
      expect(ranked.map(([code]) => code)).toEqual(d.meta.participate)
      expect(ranked.map(([, v]) => v.quota_rank)).toEqual(
        ranked.map((_, i) => i + 1),
      )
      expect(ranked.length).toBeLessThanOrEqual(d.quota)
    }
  })

  it('④ 日期口径：pool_call.trade_date 必须等于同日 ai_view.date（⛔ 不是 decision_date）', () => {
    const files = readFiles()
    let checked = 0
    for (const f of files) {
      const d = f.data!
      const aiViewPath = path.join(DATA_ROOT, 'cache', `ai_view_${d.trade_date}.json`)
      if (!existsSync(aiViewPath)) continue
      const av = JSON.parse(readFileSync(aiViewPath, 'utf-8')) as {
        date: string
        decision_date: string
        views: Record<string, unknown>
      }
      expect(av.date, 'ai_view.date 应为执行日（= pool_call.trade_date）').toBe(d.trade_date)
      expect(
        av.decision_date,
        'decision_date 是预案写作日，必须早于执行日',
      ).not.toBe(d.trade_date)
      // 两份数据的标的集合应当有交集（同一池子：预案 → 裁决）
      const shared = Object.keys(av.views).filter((c) => c in d.views)
      expect(shared.length, 'pool_call 与 ai_view 无任何共同标的 —— 日期大概率接错了').toBeGreaterThan(0)
      checked += 1
    }
    expect(checked, '无同日的 ai_view 可比对 —— 数据链路疑似断档').toBeGreaterThan(0)
  })
})
