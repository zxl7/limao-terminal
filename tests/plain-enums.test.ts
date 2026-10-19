import { describe, expect, it } from 'vitest'
import {
  PLAIN_UNKNOWN,
  backtestFieldText,
  bucketText,
  caliberText,
  regimeText,
  roleText,
  stageText,
} from '@/shared/lib'

/**
 * 枚举表收口守卫（2026-10-18 第二批）。
 *
 * 这批词表的取值全部来自**真实落盘文件实测**（见各表注释里的“取值源”），
 * ⛔ 不允许凭命名推测。测试锁两件事：
 *   ① 已登记的 token 必须翻译成人话；
 *   ② 未知 token **不得原样漏出**（回落固定中文），否则等于把内部字段名印在屏幕上。
 */
describe('plain 词表 · 实测取值必须命中', () => {
  it('晋级档 stage：1to2…4to5+ 与字符串 "None"', () => {
    expect(stageText('1to2')).toBe('1进2')
    expect(stageText('2to3')).toBe('2进3')
    expect(stageText('3to4')).toBe('3进4')
    expect(stageText('4to5+')).toBe('4进5及以上')
    expect(stageText('None')).toBe('—')
  })

  it('市场环境 regime：ice 不能裸奔', () => {
    expect(regimeText('ice')).toBe('冰点')
    expect(regimeText('risk_on')).toBe('进攻')
    expect(regimeText('risk_off')).toBe('防守')
  })

  it('存档角色 role / 口径 caliber / 名额 bucket', () => {
    expect(roleText('zt_pool_data')).toBe('涨停池')
    expect(roleText('ai_view')).toBe('AI 观点')
    expect(caliberText('ai')).toBe('AI 口径')
    expect(caliberText('')).toBe('—')
    expect(bucketText('relay')).toBe('接力位')
    expect(bucketText('watch')).toBe('观察位')
  })

  it('未知 token 一律回落「未识别」，不原样输出', () => {
    for (const out of [stageText('5to6'), regimeText('euphoria'), roleText('weird')]) {
      expect(out).toBe(PLAIN_UNKNOWN)
    }
  })
})

describe('plain 词表 · 回测动态表头', () => {
  it('已登记字段给中文', () => {
    expect(backtestFieldText('candidate_hit')).toBe('候选命中')
    expect(backtestFieldText('range_hit_rate')).toBe('区间命中率')
  })

  it('未登记字段显式标注，不静默直出', () => {
    expect(backtestFieldText('some_new_metric')).toBe('未登记字段(some_new_metric)')
  })
})
