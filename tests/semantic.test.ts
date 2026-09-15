/**
 * A股语义判定测试 —— 这是本项目**最该被测试覆盖**的部分。
 *
 * 理由：涨跌/涨停/情绪的判定口径一旦漂移，整个终端的所有配色与结论都会错，
 * 而这种错误不会抛异常、不会白屏，只会**安静地给出相反的结论**。
 * 这正是「快准狠」要求下最不能接受的一类缺陷。
 */

import { describe, expect, it } from 'vitest'
import {
  feedbackClass,
  fmtPct,
  fmtYi,
  isLimitUp,
  sentimentClass,
  sortLadderDesc,
  upcls,
} from '@/shared/lib'

describe('upcls —— 涨红跌绿方向', () => {
  it('正数判涨（红），负数判跌（绿）', () => {
    expect(upcls(3.2)).toBe('up')
    expect(upcls(-1.4)).toBe('down')
  })

  it('零与缺失值归为中性（不误着色）', () => {
    expect(upcls(0)).toBe('')
    expect(upcls(null)).toBe('')
    expect(upcls(undefined)).toBe('')
    expect(upcls(Number.NaN)).toBe('')
  })
})

describe('fmtPct —— 百分比格式化', () => {
  it('正数显式带 + 号', () => {
    expect(fmtPct(9.99)).toBe('+9.99%')
  })

  it('负数保留自身符号', () => {
    expect(fmtPct(-3.5)).toBe('-3.50%')
  })

  it('缺失值渲染为破折号（不显示 NaN）', () => {
    expect(fmtPct(null)).toBe('—')
    expect(fmtPct(undefined)).toBe('—')
  })

  it('0 不显示 + 号', () => {
    expect(fmtPct(0)).toBe('0.00%')
  })
})

describe('fmtYi —— 金额格式化', () => {
  it('数字与字符串两种入参口径一致', () => {
    expect(fmtYi(12.34)).toBe('+12.3亿')
    expect(fmtYi('12.34')).toBe('+12.3亿')
  })

  it('负值（净流出）带负号', () => {
    expect(fmtYi(-8.6)).toBe('-8.6亿')
  })
})

describe('isLimitUp —— 涨停判定（原系统口径）', () => {
  it('主板阈值 9.9%', () => {
    expect(isLimitUp(10)).toBe(true)
    expect(isLimitUp(9.9)).toBe(true)
    expect(isLimitUp(9.89)).toBe(false)
  })

  it('20cm（创业板/科创板）阈值 19.9%', () => {
    expect(isLimitUp(20, true)).toBe(true)
    expect(isLimitUp(19.9, true)).toBe(true)
    expect(isLimitUp(10, true)).toBe(false)
  })

  it('已有连板数（数字）直接视为在板', () => {
    expect(isLimitUp(3.2, false, 2)).toBe(true)
  })

  it('连板数为「8天4板」这类文案同样视为在板', () => {
    expect(isLimitUp(3.2, false, '8天4板')).toBe(true)
    expect(isLimitUp(3.2, false, '')).toBe(false)
  })

  it('涨幅缺失但连板数存在时，仍判为在板', () => {
    expect(isLimitUp(null, false, 3)).toBe(true)
  })
})

describe('sentimentClass —— 情绪分着色（原 dashboard 口径）', () => {
  it('≥6 红（up）', () => {
    expect(sentimentClass(7)).toBe('up')
    expect(sentimentClass(6)).toBe('up')
  })

  it('≤2 绿（down）—— 冰点期', () => {
    expect(sentimentClass(2)).toBe('down')
    expect(sentimentClass(0)).toBe('down')
  })

  it('3–5 蓝（mid）', () => {
    expect(sentimentClass(3)).toBe('mid')
    expect(sentimentClass(5)).toBe('mid')
  })

  it('缺失值不着色', () => {
    expect(sentimentClass(null)).toBe('')
  })
})

describe('feedbackClass —— 改善红 / 恶化绿（与涨跌方向无关）', () => {
  it('改善 → 红', () => expect(feedbackClass(true)).toBe('up'))
  it('恶化 → 绿', () => expect(feedbackClass(false)).toBe('down'))
})

describe('sortLadderDesc —— 连板天梯降序', () => {
  it('按板数从高到低排序，且不修改原数组', () => {
    const src = [{ boards: 2 }, { boards: 5 }, { boards: 3 }]
    const sorted = sortLadderDesc(src)
    expect(sorted.map((g) => g.boards)).toEqual([5, 3, 2])
    expect(src.map((g) => g.boards)).toEqual([2, 5, 3]) // 原数组未被就地排序
  })

  it('空数组安全', () => {
    expect(sortLadderDesc([])).toEqual([])
  })
})
