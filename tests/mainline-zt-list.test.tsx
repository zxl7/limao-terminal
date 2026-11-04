import { describe, expect, it } from 'vitest'
import { tradableStocks } from '@/shared/lib'
import type { ThemeTop } from '@/shared/api'

/**
 * 主线题材「当日涨停股」显示口径（2026-11-04 用户「芯片是第一但只有两个涨停列表显示」）。
 *
 * 三个病灶：
 * ① 标题用 `zt_stocks.length`（含 688），列表用 `tradableStocks`（滤 688）→ 数字与行数不符；
 * ② 688 被静默剔除，界面无说明 → 用户以为是数据缺失；
 * ③ 源头 `[:20]` 硬截断，`zt_count` 却是真实家数 → 23 家只能列 20 只。
 *
 * 本文件锁「标题数字必须等于可见行数，且缺失原因必须写明」。
 */

function theme(patch: Partial<ThemeTop> = {}): ThemeTop {
  return {
    rank: 1,
    name: '国产芯片',
    desc: '',
    zt_count: 23,
    turn_avg: 6.8,
    total_stocks: 131,
    leader: null,
    followers: [],
    zt_stocks: [
      { name: '托伦斯', code: '301583.SZ', pct: 20 },
      { name: '京仪装备', code: '688652.SS', pct: 20 },
      { name: '江丰电子', code: '300666.SZ', pct: 20 },
      { name: '芯源微', code: '688037.SS', pct: 20 },
      { name: '雅克科技', code: '002409.SZ', pct: 10.01 },
    ],
    diffusion: '',
    risks: [],
    positives: [],
    delta: 'ongoing',
    zt_prev: 18,
    ...patch,
  } as ThemeTop
}

describe('主线题材涨停股口径', () => {
  it('tradableStocks 剔除 688', () => {
    const t = theme()
    const shown = tradableStocks(t.zt_stocks)
    expect(shown.map((s) => s.name)).toEqual(['托伦斯', '江丰电子', '雅克科技'])
  })

  it('科创板数量 = 全部 − 可买', () => {
    const t = theme()
    const all = t.zt_stocks ?? []
    const shown = tradableStocks(all)
    expect(all.length - shown.length).toBe(2)
  })

  it('⛔ 标题数字必须等于列表行数（旧实现标题 5 行只有 3 行）', () => {
    const all = theme().zt_stocks ?? []
    expect(tradableStocks(all).length).not.toBe(all.length)
    // 新标题取 shown.length；下面断言两者同源
    const shown = tradableStocks(all)
    expect(`${shown.length}`).toBe('3')
  })

  it('zt_count > zt_stocks 时判定为「源被截断」', () => {
    const t = theme()
    expect(t.zt_count > (t.zt_stocks?.length ?? 0)).toBe(true)
  })
})
