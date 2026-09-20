import { describe, expect, it } from 'vitest'
import { buildLimitSeries, MARKS, pickLiveBasis } from '@/features/analytics'
import type { IntradayTimelineEvent } from '@/shared/api'

/**
 * 实时「涨停 / 跌停 / 炸板率」时间序列的纯计算内核回归锁。
 *
 * 这条序列驱动时间轴页的「动态监听」折线图，由盘中情绪时间轴 JSONL 的逐事件推导。
 * 错算**不报错**：页面照常画三条线，只是数值或口径不对 —— 只有不变量测试能发现。
 *
 * 不变量：
 *   1. 长度与 `MARKS` 对齐，首个 in-window `zt_total` 出现之前全为 null（不画假 0）；
 *   2. 涨停封板数前向沿用（盘中震荡取最近已知值）；
 *   3. 跌停 = `limit_down_new` 累计；炸板率 = 炸板累计 / (封板 + 炸板累计) × 100；
 *   4. 盘前残留与午休事件一律排除。
 *
 * 另含 `pickLiveBasis`（曲线**基准日**选取）—— 见文件下半部分说明。
 */

function ev(at: string, kind: IntradayTimelineEvent['kind'], extra: Partial<IntradayTimelineEvent> = {}): IntradayTimelineEvent {
  return { at, kind, ...extra } as IntradayTimelineEvent
}

const idx = (clock: string) => MARKS.indexOf(MARKS.find((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` === clock)!)

describe('buildLimitSeries', () => {
  it('空事件 → 全 null，长度与 MARKS 对齐', () => {
    const r = buildLimitSeries([])
    expect(r.labels.length).toBe(MARKS.length)
    expect(r.zt.length).toBe(MARKS.length)
    expect(r.zt.every((v) => v == null)).toBe(true)
    expect(r.ld.every((v) => v == null)).toBe(true)
    expect(r.brokenRate.every((v) => v == null)).toBe(true)
  })

  it('盘前残留（上一日 00:02 / 开盘 09:06 清零）一律排除，首个 in-window 值才生效', () => {
    const r = buildLimitSeries([
      ev('2026-09-18 00:02:06', 'zt_total', { total: 47 }),
      ev('2026-09-18 09:06:37', 'zt_total', { total: 0 }),
      ev('2026-09-18 09:26:04', 'zt_total', { total: 7 }),
    ])
    // 09:30 刻度应沿用 09:26 的 7（00:02 / 09:06 都被窗口过滤掉）
    expect(r.zt[idx('09:30')]).toBe(7)
  })

  it('涨停封板数前向沿用（盘中震荡取最近已知值）', () => {
    const r = buildLimitSeries([
      ev('2026-09-18 09:31:23', 'zt_total', { total: 11 }),
      ev('2026-09-18 09:33:20', 'zt_total', { total: 12 }),
      ev('2026-09-18 14:56:41', 'zt_total', { total: 77 }),
      ev('2026-09-18 14:57:28', 'zt_total', { total: 79 }),
    ])
    // 09:30 在首个 in-window 事件（09:31）之前 → null
    expect(r.zt[idx('09:30')]).toBeNull()
    // 09:45 沿用 09:33 的 12
    expect(r.zt[idx('09:45')]).toBe(12)
    // 收盘沿用 14:57 的 79
    expect(r.zt[idx('15:00')]).toBe(79)
  })

  it('跌停 = limit_down_new 累计', () => {
    const r = buildLimitSeries([
      ev('2026-09-18 09:31:23', 'zt_total', { total: 11 }),
      ev('2026-09-18 10:00:00', 'limit_down_new', { name: 'A' }),
      ev('2026-09-18 10:30:00', 'limit_down_new', { name: 'B' }),
    ])
    expect(r.ld[idx('10:30')]).toBe(2)
    expect(r.ld[idx('15:00')]).toBe(2)
  })

  it('炸板率 = 炸板累计 / (封板 + 炸板累计) × 100', () => {
    const r = buildLimitSeries([
      ev('2026-09-18 09:31:23', 'zt_total', { total: 10 }),
      ev('2026-09-18 10:00:00', 'broken_new', { name: 'X' }),
      ev('2026-09-18 10:15:00', 'broken_new', { name: 'Y' }),
      ev('2026-09-18 10:30:00', 'broken_new', { name: 'Z' }),
    ])
    // 3 炸板 / (10 封板 + 3 炸板) = 23.0769% → round2 = 23.08
    expect(r.brokenRate[idx('10:30')]).toBeCloseTo(23.08, 2)
    expect(r.brokenRate[idx('15:00')]).toBeCloseTo(23.08, 2)
  })

  it('午休（11:30–13:00）事件不参与序列', () => {
    const r = buildLimitSeries([
      ev('2026-09-18 09:31:23', 'zt_total', { total: 11 }),
      ev('2026-09-18 12:00:00', 'zt_total', { total: 999 }), // 午休，应被排除
    ])
    // 13:00 仍沿用 11（午休的 999 被丢弃）
    expect(r.zt[idx('13:00')]).toBe(11)
  })

  it('窗口前事件（09:06）被排除 → 仅有它时全 null', () => {
    const r = buildLimitSeries([ev('2026-09-18 09:06:37', 'zt_total', { total: 5 })])
    expect(r.zt.every((v) => v == null)).toBe(true)
  })
})

/**
 * `pickLiveBasis` —— 曲线「基准日」的选取内核。
 *
 * 背景（2026-09-19 用户抓包「K 线上只看得到涨停 / 不知道是不是实时的」）：
 * 页面默认选中日 = 「最近一个**有涨停池**的交易日」。盘中当日归档没有 `zt_list`
 * （收盘后才写）→ 默认会退到**昨天**。曲线若跟着选中日走，盘中看到的永远是昨天；
 * 而非交易日（周六）当日 JSONL 只剩 00:0x 的盘前残留 → 直接退化成盘后单线。
 *
 * 故曲线基准日**独立**取「最近一个盘中窗口内有事件的交易日」——本组测试锁住该口径。
 */
describe('pickLiveBasis', () => {
  it('空事件 → null（调用方应走盘后回退）', () => {
    expect(pickLiveBasis([])).toBeNull()
  })

  it('只有盘前残留（00:06 清零批次）→ null，不得把非交易日当成盘中日', () => {
    const r = pickLiveBasis([
      ev('2026-09-19 00:06:13', 'zt_total', { total: 79 }),
      ev('2026-09-19 00:06:13', 'limit_down_new', { name: 'X' }),
      ev('2026-09-19 00:06:13', 'broken_new', { name: 'Y' }),
    ])
    expect(r).toBeNull()
  })

  it('多日时取**最近**一个有盘中窗口事件的交易日', () => {
    const r = pickLiveBasis([
      ev('2026-09-17 13:10:00', 'zt_total', { total: 33 }),
      ev('2026-09-18 09:35:00', 'zt_total', { total: 30 }),
      ev('2026-09-18 14:57:00', 'zt_total', { total: 79 }),
    ])
    expect(r?.date).toBe('2026-09-18')
    expect(r?.events.length).toBe(2)
  })

  it('⛔ 现场场景：周六（仅残留）不覆盖周五（真实盘中）→ 基准日应为周五', () => {
    const r = pickLiveBasis([
      ev('2026-09-18 09:35:00', 'zt_total', { total: 30 }),
      ev('2026-09-18 14:57:00', 'zt_total', { total: 79 }),
      ev('2026-09-18 14:50:00', 'broken_new', { name: 'A' }),
      // 09-19 周六：只有 00:06 的残留批次
      ev('2026-09-19 00:06:13', 'zt_total', { total: 79 }),
      ev('2026-09-19 00:06:13', 'broken_new', { name: 'B' }),
    ])
    expect(r?.date).toBe('2026-09-18')
    // 基准日的序列必须是「活的」—— 三个指标都要能算出来（用户要看的正是这三条）
    const s = buildLimitSeries(r?.events ?? [])
    expect(s.zt.some((v) => v != null)).toBe(true)
    expect(s.zt[idx('15:00')]).toBe(79)
    // 注：窗口内首个 zt_total 之前三个序列都是 null（不画假 0），故用 some 而非 every
    expect(s.ld.some((v) => v != null)).toBe(true)
    expect(s.brokenRate.some((v) => v != null)).toBe(true)
  })

  it('最新那天只有盘前、更早那天有盘中 → 回退到更早那天', () => {
    const r = pickLiveBasis([
      ev('2026-09-18 10:00:00', 'zt_total', { total: 20 }),
      ev('2026-09-19 08:30:00', 'zt_total', { total: 3 }),
    ])
    expect(r?.date).toBe('2026-09-18')
  })
})
