import { describe, expect, it } from 'vitest'
import { buildCycleTemperature, phaseOfScore } from '@/features/analytics'

const zt = (date: string, total: number, zbc: number) => ({
  data: {
    date,
    zt_count: total,
    zt_list: [{
      code: '000001', name: '样本', pct: 10, price: 1, boards: 1,
      zbc, fbt: '093000', hs: 1, sector: '样本', seal: 1,
      cje_yi: 1, zsz_yi: 1, lt_yi: 1, is_20cm: false,
    }],
  },
})

describe('周期温度总览内核', () => {
  it('按日期对齐情绪、涨停反馈和资金历史，不用缺失字段补零', () => {
    const result = buildCycleTemperature(
      [
        { date: '2026-10-13', sentiment_score: 3.6, promote_rate: 21.7 },
        { date: '2026-10-14', sentiment_score: 1, promote_rate: 19.4 },
      ],
      [zt('2026-10-13', 67, 54), zt('2026-10-14', 36, 65)],
      {
        trend: { history: [{ date: '2026-10-13', pr: 21.7, ap: 1.1 }, { date: '2026-10-14', pr: 19.4, ap: 0.04 }] },
      } as never,
      [
        { data: { date: '2026-10-13', boards: { A: { flow_yi: -8 }, B: { flow_yi: 3 } } } },
        { data: { date: '2026-10-14', boards: { A: { flow_yi: null } } } },
      ],
    )

    expect(result.cycle).toHaveLength(2)
    expect(result.latest.cycle?.phase).toBe('ice')
    expect(result.feedback.map((row) => row.date)).toEqual(['2026-10-13', '2026-10-14'])
    expect(result.cycle[1].brokenRate).toBeCloseTo((65 / 101) * 100)
    expect(result.funds).toHaveLength(1)
    expect(result.funds[0].mainNetYi).toBe(-5)
    expect(result.funds[0].temperature).toBe(50)
    expect(result.heat.sentiment.level).toBe('cold')
    expect(result.heat.promoteRate.level).toBe('cold')
    expect(result.heat.brokenRate.level).toBe('hot')
    expect(result.heat.ztCount.level).toBe('cold')
    expect(result.heat.fundTemperature.level).toBe('neutral')
    expect(result.heat.mainNetYi.level).toBe('neutral')
  })

  it('盘中资金快照覆盖同日历史，并标记为当日实时数据', () => {
    const result = buildCycleTemperature(
      [
        { date: '2026-10-14', sentiment_score: 1, promote_rate: 19.4 },
        { date: '2026-10-15', sentiment_score: 1, promote_rate: 16.7 },
      ],
      [],
      {
        generated_ts: '2026-10-15T15:00:00+08:00',
        date: '2026-10-15',
        prev_date: '2026-10-14',
        promote_rate: 16.7,
        now_zt_count: 36,
        trend: { history: [] },
      } as never,
      [{ data: { date: '2026-10-14', boards: { A: { flow_yi: -8 } } } }],
      { date: '2026-10-15', ts: 1792047623, boards: { A: { pct: -1.2, flow_yi: -12 } } },
      '2026-10-15',
    )
    expect(result.funds.at(-1)?.date).toBe('2026-10-15')
    expect(result.funds.at(-1)?.mainNetYi).toBe(-12)
    expect(result.funds.at(-1)?.live).toBe(true)
    expect(result.live?.date).toBe('2026-10-15')
    expect(result.latest.feedback?.ztCount).toBe(36)
  })

  it('缺少当前维度时标记待确认，不把缺失伪造成中性或零值', () => {
    const result = buildCycleTemperature(
      [{ date: '2026-10-14', sentiment_score: null, promote_rate: null }],
      [],
      null,
      [],
    )
    expect(result.heat.sentiment.level).toBe('unknown')
    expect(result.heat.promoteRate.level).toBe('unknown')
    expect(result.heat.brokenRate.level).toBe('unknown')
    expect(result.heat.fundTemperature.level).toBe('unknown')
  })

  it('feedback 缺少 trend 时安全返回空反馈序列，不白屏', () => {
    expect(() => buildCycleTemperature(
      [{ date: '2026-10-14', sentiment_score: 5, promote_rate: 20 }],
      [],
      { date: '2026-10-14' } as never,
      [],
    )).not.toThrow()
  })

  it('阶段映射保持冰点、退潮、修复、升温、高潮顺序', () => {
    expect(phaseOfScore(1)).toBe('ice')
    expect(phaseOfScore(3)).toBe('ebb')
    expect(phaseOfScore(5)).toBe('repair')
    expect(phaseOfScore(7)).toBe('warming')
    expect(phaseOfScore(9)).toBe('high')
    expect(phaseOfScore(null)).toBeNull()
  })
})
