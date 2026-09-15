/**
 * 分析域格式化测试 —— 重点覆盖「**静默渲染错值**」这一类缺陷。
 *
 * ## 为什么这类函数值得单测
 *
 * 格式化函数全部是 `any → string`：类型系统看不见内部逻辑，渲染层不会抛异常，
 * 页面也不会白屏。一旦出错，结果是**安静地显示一个错误数字** —— 这比崩溃危险得多，
 * 因为使用者会拿它做交易决策。
 *
 * ## 本文件锁定两个已实证的陷阱
 *
 * 1. **二元区间被静默拼接**：原系统 `expected_range = [0.0, 2.0]` 是数组。
 *    直接 `{v}` 丢给 React，数组子元素会**无分隔符拼接**成 `"02"`，
 *    不报错、不警告，只是显示了一个错误区间。
 * 2. **null 不得退化成 0 或空串**：`null` = 「无样本」，`0` = 「样本为零」，
 *    两者语义相反（「晋级率未统计」≠「晋级率 0%」），且空串会让人以为渲染坏了。
 */

import { describe, expect, it } from 'vitest'
import { boardsLabel, fileDate, fmtFbt, n1, n2, pct, range, rangeLow, rangePct, rate } from '@/features/analytics'

describe('range —— 二元区间（防静默拼接）', () => {
  it('把 [0, 2] 渲染成 0.0~2.0，而不是 React 默认拼接出的 "02"', () => {
    // 这条断言就是本次修复的核心：修复前 {v} 得到的是 "02"
    expect(range([0, 2])).toBe('0.0~2.0')
    expect(range([0, 2])).not.toBe('02')
  })

  it('保留一位小数（与原系统排版文案一致）', () => {
    expect(range([4, 8])).toBe('4.0~8.0')
    expect(range([0.035, 0.085], 3)).toBe('0.035~0.085')
  })

  it('支持单位后缀', () => {
    expect(rangePct([0, 2])).toBe('0.0~2.0%')
    expect(range([1, 3], 1, '亿')).toBe('1.0~3.0亿')
  })

  it('缺失/畸形输入一律返回「—」，不退化成 0', () => {
    expect(range(null)).toBe('—')
    expect(range(undefined)).toBe('—')
    expect(range([])).toBe('—')
    expect(range([5])).toBe('—')
  })

  it('区间内含 null 视为无数据（而非按 0 计算）', () => {
    expect(range([null as unknown as number, 2])).toBe('—')
    expect(range([0, null as unknown as number])).toBe('—')
  })
})

describe('rangeLow —— 取区间下沿作门槛', () => {
  it('取出下沿数值', () => {
    expect(rangeLow([4, 8])).toBe(4)
    expect(rangeLow([0, 2])).toBe(0)
  })

  it('非法输入返回 null（调用方据此省略文案，而不是显示 0）', () => {
    expect(rangeLow(null)).toBeNull()
    expect(rangeLow(undefined)).toBeNull()
    expect(rangeLow([8])).toBeNull()
  })
})

describe('null 与 0 必须可区分', () => {
  it('null / undefined / NaN 一律「—」', () => {
    expect(n1(null)).toBe('—')
    expect(n1(undefined)).toBe('—')
    expect(n1(Number.NaN)).toBe('—')
    expect(n2(null)).toBe('—')
    expect(rate(null)).toBe('—')
    expect(pct(null)).toBe('—')
    expect(boardsLabel(null)).toBe('—')
  })

  it('真实的 0 必须显示为 0，不能被当成缺失吞掉', () => {
    expect(n1(0)).toBe('0')
    expect(n2(0)).toBe('0.00')
    expect(rate(0)).toBe('0.0%')
    expect(boardsLabel(0)).toBe('0板')
  })
})

describe('n1 / n2 —— 精度', () => {
  it('整数不补 .0，小数保留指定位数', () => {
    expect(n1(8)).toBe('8')
    expect(n1(8.25)).toBe('8.3')
    expect(n2(8.2)).toBe('8.20')
  })
})

describe('pct —— 百分比带方向号', () => {
  it('正数带 +，负数带 -，零不带符号', () => {
    expect(pct(3.21)).toBe('+3.21%')
    expect(pct(-1.5)).toBe('-1.50%')
    expect(pct(0)).toBe('0.00%')
  })
})

describe('boardsLabel —— 连板文案', () => {
  it('5 板及以上折叠为「N板+」以避免尾部过长', () => {
    expect(boardsLabel(1)).toBe('1板')
    expect(boardsLabel(4)).toBe('4板')
    expect(boardsLabel(5)).toBe('5板+')
    expect(boardsLabel(9)).toBe('9板+')
  })
})

describe('fmtFbt —— 首封时间收敛为 HH:MM', () => {
  it('兼容无分隔符与已带分隔符两种归档形态', () => {
    expect(fmtFbt('094048')).toBe('09:40')
    expect(fmtFbt('09:40:48')).toBe('09:40')
    expect(fmtFbt('09:40')).toBe('09:40')
  })

  it('空值「—」，过短则原样返回（不猜）', () => {
    expect(fmtFbt('')).toBe('—')
    expect(fmtFbt(null)).toBe('—')
    expect(fmtFbt('9')).toBe('9')
  })
})

describe('fileDate —— 文件名提日期', () => {
  it('兼容带分隔符与紧凑两种命名', () => {
    expect(fileDate('board_core_20260914.json')).toBe('2026-09-14')
    expect(fileDate('candidates-2026-09-14.json')).toBe('2026-09-14')
  })

  it('提取不到则原样返回（便于发现命名漂移，而不是显示空）', () => {
    expect(fileDate('latest.json')).toBe('latest.json')
  })
})
