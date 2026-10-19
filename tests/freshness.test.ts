import { describe, expect, it } from 'vitest'
import { staleDays, staleLabel, isStarMarket, tradableStocks } from '@/shared/lib'

/**
 * 新鲜度与「可交易标的」口径守卫（2026-10-18 全站扫描新增）。
 *
 * 这两类判定漂移的后果都是**静默**的：
 *   · 龄期算错 → 旧数据被当成今天（/hithink 估值停更 53 天、/stack 周地图停 5 周）
 *   · 科创过滤写错 → 用户看到 688 票却买不了；用 `includes('688')` 又会误杀 600688
 * 所以必须把口径钉死在测试里。
 */

describe('staleDays · 业务日期龄期', () => {
  const now = Date.parse('2026-10-18T14:00:00+08:00')

  it('当日数据龄期为 0（不是 1）', () => {
    expect(staleDays('2026-10-18', now)).toBe(0)
  })

  it('昨天为 1 天、一个月前按自然日计', () => {
    expect(staleDays('2026-10-17', now)).toBe(1)
    expect(staleDays('2026-09-18', now)).toBe(30)
  })

  it('带时间后缀也能解析（generated_ts 常见形态）', () => {
    expect(staleDays('2026-10-16 15:00:30', now)).toBe(2)
    expect(staleDays('2026-10-16T15:00:30+08:00', now)).toBe(2)
  })

  it('空值/坏格式返回 null —— 「不知道」不能当成「今天」', () => {
    expect(staleDays(null, now)).toBeNull()
    expect(staleDays('', now)).toBeNull()
    expect(staleDays('10-16', now)).toBeNull()
  })
})

describe('staleLabel · 停更话术', () => {
  const now = Date.parse('2026-10-18T14:00:00+08:00')

  it('新鲜数据不给标签', () => {
    expect(staleLabel('2026-10-17', 3, now)).toBeNull()
    expect(staleLabel('2026-10-16', 3, now)).toBeNull()
  })

  it('超过阈值按天/周/月三档表达', () => {
    expect(staleLabel('2026-10-14', 3, now)).toBe('已停更 4 天')
    expect(staleLabel('2026-09-30', 3, now)).toBe('已停更 2 周')
    expect(staleLabel('2026-08-26', 3, now)).toBe('已停更 1 个月')
  })
})

describe('tradableStocks · 科创板剔除口径', () => {
  it('剔除 688/689（含带后缀形态），保留主板与创业板', () => {
    const rows = [
      { code: '600519', name: '贵州茅台' },
      { code: '688592', name: '司南导航' },
      { code: '689009', name: '九号公司' },
      { code: '300750', name: '宁德时代' },
      { code: '688313.SH', name: '仕佳光子' },
    ]
    expect(tradableStocks(rows).map((r) => r.code)).toEqual(['600519', '300750'])
  })

  it('600688（上海石化）/ 000688（国城矿业）不是科创板，禁止误杀', () => {
    expect(isStarMarket('600688')).toBe(false)
    expect(isStarMarket('000688')).toBe(false)
    expect(tradableStocks([{ code: '600688' }, { code: '000688' }])).toHaveLength(2)
  })

  it('空输入返回空数组（不抛异常）', () => {
    expect(tradableStocks(null)).toEqual([])
    expect(tradableStocks(undefined)).toEqual([])
    expect(tradableStocks([])).toEqual([])
  })
})
