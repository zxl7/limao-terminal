/**
 * 交易时段判定测试。
 *
 * 为什么值得测：时段判定错了会导致「盘中不刷新、盘后狂刷新」——
 * 表面上系统在跑，实际上错过全部信号。原系统的血泪教训（时区常量曾在 13 个文件
 * 各自定义，漂移导致推送时点错乱）就是这一类。
 */

import { describe, expect, it } from 'vitest'
import { bjTimeString, inTrading, isTradingDay, sessionName } from '@/shared/lib'

/**
 * 构造一个「北京时间为指定时刻」的 Date。
 * 本机时区无关 —— 这样测试在任何机器上结果一致。
 * BJ = UTC+8，故 UTC = BJ - 8h。
 */
function bjAt(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 8, mi))
}

describe('isTradingDay —— 交易日（周一至周五）', () => {
  it('2026-09-14 是周一 → 交易日', () => {
    expect(isTradingDay(bjAt(2026, 9, 14, 10, 0))).toBe(true)
  })

  it('2026-09-19 是周六 → 非交易日', () => {
    expect(isTradingDay(bjAt(2026, 9, 19, 10, 0))).toBe(false)
  })

  it('2026-09-20 是周日 → 非交易日', () => {
    expect(isTradingDay(bjAt(2026, 9, 20, 10, 0))).toBe(false)
  })
})

describe('inTrading —— 交易时段', () => {
  it('早盘 09:00–11:30 在时段内', () => {
    expect(inTrading(undefined, bjAt(2026, 9, 14, 9, 0))).toBe(true)
    expect(inTrading(undefined, bjAt(2026, 9, 14, 10, 30))).toBe(true)
    expect(inTrading(undefined, bjAt(2026, 9, 14, 11, 30))).toBe(true)
  })

  it('早盘边界外不在时段内', () => {
    expect(inTrading(undefined, bjAt(2026, 9, 14, 8, 59))).toBe(false)
    expect(inTrading(undefined, bjAt(2026, 9, 14, 11, 31))).toBe(false)
  })

  it('午休 11:31–12:59 不在时段内', () => {
    expect(inTrading(undefined, bjAt(2026, 9, 14, 12, 0))).toBe(false)
  })

  it('下午 13:00–15:00 在时段内', () => {
    expect(inTrading(undefined, bjAt(2026, 9, 14, 13, 0))).toBe(true)
    expect(inTrading(undefined, bjAt(2026, 9, 14, 15, 0))).toBe(true)
    expect(inTrading(undefined, bjAt(2026, 9, 14, 15, 1))).toBe(false)
  })

  it('周末任何时刻都不在时段内', () => {
    expect(inTrading(undefined, bjAt(2026, 9, 19, 10, 0))).toBe(false)
  })

  it('传入 asof 时以 asof 为准（与原系统 in_trading(asof) 语义一致）', () => {
    expect(inTrading('09:30', bjAt(2026, 9, 14, 20, 0))).toBe(true)
    expect(inTrading('20:00', bjAt(2026, 9, 14, 10, 0))).toBe(false)
  })

  it('asof 格式非法时回退到当前时间', () => {
    expect(inTrading('bad', bjAt(2026, 9, 14, 10, 0))).toBe(true)
  })
})

describe('sessionName —— 时段名称', () => {
  const cases: [number, number, string][] = [
    [8, 0, '盘前'],
    [9, 30, '早盘'],
    [12, 0, '午休'],
    [14, 0, '尾盘'],
    [16, 0, '盘后'],
  ]
  for (const [h, mi, want] of cases) {
    it(`${h}:${String(mi).padStart(2, '0')} → ${want}`, () => {
      expect(sessionName(bjAt(2026, 9, 14, h, mi))).toBe(want)
    })
  }

  it('周末 → 休市', () => {
    expect(sessionName(bjAt(2026, 9, 19, 10, 0))).toBe('休市')
  })
})

describe('bjTimeString —— 北京时间串', () => {
  it('按 UTC+8 渲染，与进程时区无关', () => {
    expect(bjTimeString(bjAt(2026, 9, 14, 9, 5))).toBe('09:05:00')
    expect(bjTimeString(bjAt(2026, 9, 14, 23, 59))).toBe('23:59:00')
  })

  it('跨日边界正确（BJ 00:00 对应 UTC 前一日 16:00）', () => {
    expect(bjTimeString(bjAt(2026, 9, 15, 0, 0))).toBe('00:00:00')
  })
})
