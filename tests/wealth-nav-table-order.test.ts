/**
 * 净值表**展示顺序**的回归锁（2026-11-09 用户「净值 tab 表格按时间逆序，最新在第一行」）。
 *
 * ## 为什么这件事值得一个测试
 *
 * 同一份净值数组在页面里有四个消费者，要求**相反**的顺序：
 *
 * | 消费者 | 要的顺序 | 逆序会怎样 |
 * |---|---|---|
 * | 折线图 | 正序 | 曲线左右翻转 |
 * | 最大回撤 | 正序 | 逐点递推的 peak 失真，回撤算错 |
 * | 末值徽章 `at(-1)` | 正序 | 取到最早那天 |
 * | 明细表格 | 逆序 | 读者要先滚过 30 行历史才看到今天 |
 *
 * 所以「逆序」只能发生在表格这一处。最容易犯的错是有人图快写
 * `navRows.reverse()` —— 那是**原地修改**，会让上面三个正序消费者一起错，
 * 而且界面上的症状是「图表莫名反了」，很难联想到是一次排序。
 *
 * 本文件锁三件事：结果降序、**输入数组不被就地修改**、乱序输入也能排对。
 */

import { describe, expect, it } from 'vitest'
import { navRowsDesc } from '@/features/wealth'

type Row = { trade_date: string; nav: number }
const row = (d: string, nav = 1): Row => ({ trade_date: d, nav })

describe('navRowsDesc · 净值表逆序', () => {
  it('升序输入 → 降序输出，最新在第一行', () => {
    const rows = [row('2026-10-30'), row('2026-11-02'), row('2026-11-06')]
    const out = navRowsDesc(rows)
    expect(out.map((r) => r.trade_date)).toEqual(['2026-11-06', '2026-11-02', '2026-10-30'])
    expect(out[0].trade_date).toBe('2026-11-06')
  })

  it('⛔ 不得就地修改输入（否则折线图/最大回撤/末值会一起错）', () => {
    const rows = [row('2026-10-30'), row('2026-11-02'), row('2026-11-06')]
    const before = rows.map((r) => r.trade_date)
    navRowsDesc(rows)
    expect(rows.map((r) => r.trade_date)).toEqual(before)
    expect(rows[0].trade_date).toBe('2026-10-30')       // 原数组首位仍是旧的那天
  })

  it('乱序输入也能排成严格降序（不依赖上游已排序）', () => {
    const rows = [row('2026-11-02'), row('2026-10-30'), row('2026-11-06')]
    const ds = navRowsDesc(rows).map((r) => r.trade_date)
    expect(ds).toEqual([...ds].sort().reverse())
  })

  it('空数组 / 单行不炸', () => {
    expect(navRowsDesc([])).toEqual([])
    expect(navRowsDesc([row('2026-11-06')]).map((r) => r.trade_date)).toEqual(['2026-11-06'])
  })

  it('跨月跨年按字符串比较仍然正确（YYYY-MM-DD 定长格式）', () => {
    const rows = [row('2025-12-31'), row('2026-01-05'), row('2026-11-09')]
    expect(navRowsDesc(rows)[0].trade_date).toBe('2026-11-09')
    expect(navRowsDesc(rows).at(-1)?.trade_date).toBe('2025-12-31')
  })

  it('不丢行、不改内容（只换顺序）', () => {
    const rows = [row('2026-10-30', 0.82), row('2026-11-06', 0.812131)]
    const out = navRowsDesc(rows)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.nav)).toEqual([0.812131, 0.82])
  })
})
