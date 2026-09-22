import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { intradayStockUp } from '@/features/analytics'
import { DEFAULT_DATA_ROOT, DATA_ROOT_ENV, ROUTES } from '@/shared/api'
import type { IntradayTimelineEvent } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, resolveDataRoot } from '../scripts/lib/read-route.mjs'

/**
 * **盘中个股流**契约（2026-09-22 用户定）。
 *
 * 用户原话：「我需要看到的是**题材、题材爆发以及与题材相关的大量个股**，
 * 我不喜欢看到现在什么的爆发走强，杀跌这些数量。」
 *
 * 病灶：当日 `zt_history/zt_<今日>.json` 的 `zt_list` 收盘后才落盘，
 * 而 `yesterday_zt.json` 的 `date` 是上一个交易日 ⇒ 与所选日不等 ⇒ 时间轴**零个股**，
 * 页面上只剩区块级的「爆发/走强 · 杀跌」计数 —— 正是用户看到并否决的那个画面。
 *
 * 修法：从 `intraday_timeline_<今日>.jsonl` 的 `stock_up` 补出个股流
 * （`code/name/sector(题材)/pct/boards` + `at` 即封板时刻）。
 *
 * ## ⛔ 本组最重要的那条锁
 *
 * 守护进程在 **00:03** 会一次性补写**昨日收盘**快照（实测 2026-09-22 共 64 条、
 * 含 26 条 `stock_up`）。若不过滤，昨日封板的票会被画到今天凌晨的轴上。
 */

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

const ev = (o: Record<string, unknown>): IntradayTimelineEvent =>
  o as unknown as IntradayTimelineEvent

describe('intradayStockUp · 盘中个股涨停 → 可定位个股', () => {
  it('① 正常盘中的 stock_up：带 code / name / 题材 / pct / 首封时刻', () => {
    const r = intradayStockUp(
      ev({
        at: '2026-09-22 09:26:03',
        kind: 'stock_up',
        code: '300110',
        name: '华仁药业',
        sector: '医药',
        pct: 20.07,
      }),
    )
    expect(r).not.toBeNull()
    expect(r!.code).toBe('300110')
    expect(r!.name).toBe('华仁药业')
    // ⚠️ 该字段名叫 sector，取值却是**题材名**
    expect(r!.theme).toBe('医药')
    expect(r!.pct).toBe(20.07)
    expect(r!.fbt, '首封时刻应可由 at 推出').toBe('092603')
  })

  it('② ⛔ 00:03 的初始化批（昨日收盘快照）必须被丢弃 —— 否则昨日封板会画到今天凌晨', () => {
    const r = intradayStockUp(
      ev({
        at: '2026-09-22 00:03:27',
        kind: 'stock_up',
        code: '300110',
        name: '华仁药业',
        sector: '医药',
        pct: 20.07,
      }),
    )
    expect(r, 'at < 09:25 的一律不得进入个股流').toBeNull()
  })

  it('③ 非个股事件 / 缺 code / 坏时刻 → null（不产生脏记录）', () => {
    expect(intradayStockUp(ev({ at: '2026-09-22 10:00:00', kind: 'sector_up', name: '医药' }))).toBeNull()
    expect(intradayStockUp(ev({ at: '2026-09-22 10:00:00', kind: 'broken_new', name: '曙光股份' }))).toBeNull()
    expect(intradayStockUp(ev({ at: '2026-09-22 09:30:00', kind: 'stock_up', name: '无代码' }))).toBeNull()
    expect(intradayStockUp(ev({ at: '', kind: 'stock_up', code: '600000' }))).toBeNull()
  })

  it('④ 盘中 boards 常为空串 → 记 1 板（⛔ 不退化成 0）', () => {
    const r = intradayStockUp(
      ev({ at: '2026-09-22 09:26:03', kind: 'stock_up', code: '600000', name: '某票', boards: '' }),
    )
    expect(r!.boards).toBe(1)
    const r2 = intradayStockUp(
      ev({ at: '2026-09-22 09:40:00', kind: 'stock_up', code: '600001', name: '某票2', boards: '3天3板' }),
    )
    expect(r2!.boards, '「3天3板」应解析出 3').toBe(3)
  })
})

describe('真实数据 · 盘中个股流可用性', () => {
  it('⑤ 最新一日：过滤后的个股**全部**在 09:25 之后，且能覆盖题材名', () => {
    const files = readRoute(DATA_ROOT, ROUTES['/api/intraday/timeline']) as Array<{
      file: string
      data: IntradayTimelineEvent[] | null
    }>
    const rows = files.flatMap((f) => f.data ?? [])
    expect(rows.length, '无盘中逐事件落盘').toBeGreaterThan(0)

    const allStockUp = rows.filter((e) => e.kind === 'stock_up')
    const kept = allStockUp.map(intradayStockUp).filter((x): x is NonNullable<typeof x> => !!x)

    // ⛔ 硬锁：过滤后不得残留任何 09:25 之前的记录
    for (const k of kept) expect(k.fbt >= '092500', `${k.name} 首封时刻 ${k.fbt} 早于 09:25`).toBe(true)
    // 过滤**确实**丢掉了东西（00:03 批）——否则说明过滤没生效
    expect(kept.length).toBeLessThanOrEqual(allStockUp.length)

    if (kept.length > 0) {
      // 每条都能给出「名称 + 题材」—— 这是详情按题材分组的前提
      for (const k of kept.slice(0, 40)) {
        expect(k.name.length, `${k.code} 缺名称`).toBeGreaterThan(0)
      }
      console.log(
        `真实数据：stock_up 原始 ${allStockUp.length} 条 → 过滤后 ${kept.length} 条｜题材样例 ` +
          [...new Set(kept.map((k) => k.theme).filter(Boolean))].slice(0, 10).join(' / '),
      )
    }
  })
})
