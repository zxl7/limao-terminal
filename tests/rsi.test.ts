import { describe, expect, it } from 'vitest'
import { rsiWilder } from '@/shared/lib'

describe('rsiWilder', () => {
  it('uses Wilder smoothing and keeps the warm-up window null', () => {
    const values = rsiWilder([1, 2, 3, 2, 2, 4, 3], 3)
    expect(values.slice(0, 3)).toEqual([null, null, null])
    expect(values[3]).toBeCloseTo(66.6667, 3)
    expect(values[4]).toBeCloseTo(66.6667, 3)
    expect(values[5]).toBeCloseTo(86.6667, 3)
    expect(values[6]).toBeCloseTo(59.7701, 3)
  })

  it('returns null when the input contains an unavailable price', () => {
    expect(rsiWilder([1, 2, null, 3, 4], 2)).toEqual([null, null, null, null, null])
  })

  it('warms up again after a gap and recovers after an initial gap', () => {
    expect(rsiWilder([null, 1, 2, 3, null, 5, 4, 3], 2))
      .toEqual([null, null, null, 100, null, null, null, 0])
  })

  it('treats non-finite prices as gaps', () => {
    for (const missing of [NaN, Infinity, -Infinity, undefined]) {
      expect(rsiWilder([1, 2, 3, missing, 4, 4, 4], 2))
        .toEqual([null, null, 100, null, null, null, 50])
    }
  })

  it('requires period plus one consecutive prices', () => {
    expect(rsiWilder(Array(20).fill(1), 24)).toEqual(Array(20).fill(null))
  })

  it('rejects an invalid period', () => {
    expect(() => rsiWilder([1, 2, 3], 0)).toThrow('positive integer')
  })
})
