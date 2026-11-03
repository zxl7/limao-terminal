/** RSI 纯计算内核：按 Wilder 平滑计算单票收盘动能。 */

export type RsiValue = number | null

/**
 * 计算一条 Wilder RSI 序列。
 * 前 period 个价格变化用于初始化，样本不足或价格缺失时保留 null。
 */
export function rsiWilder(closes: Array<number | null | undefined>, period: number): RsiValue[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('RSI period must be a positive integer')
  }

  const values: RsiValue[] = Array.from({ length: closes.length }, () => null)
  if (closes.length <= period) return values

  let previous: number | null = null
  let count = 0
  let averageGain = 0
  let averageLoss = 0
  for (let index = 0; index < closes.length; index += 1) {
    const close = closes[index]
    if (typeof close !== 'number' || !Number.isFinite(close)) {
      previous = null
      count = 0
      averageGain = 0
      averageLoss = 0
      continue
    }
    if (previous === null) {
      previous = close
      continue
    }
    const change = close - previous
    previous = close
    if (!Number.isFinite(change)) {
      count = 0
      averageGain = 0
      averageLoss = 0
      continue
    }
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    if (count < period) {
      averageGain += gain / period
      averageLoss += loss / period
      count += 1
      if (count < period) continue
    } else {
      averageGain = averageGain * ((period - 1) / period) + gain / period
      averageLoss = averageLoss * ((period - 1) / period) + loss / period
    }
    values[index] = rsiFromAverages(averageGain, averageLoss)
  }

  return values
}

function rsiFromAverages(averageGain: number, averageLoss: number): number {
  if (averageGain === 0 && averageLoss === 0) return 50
  if (averageLoss === 0) return 100
  if (averageGain === 0) return 0
  const relativeStrength = averageGain / averageLoss
  return 100 - 100 / (1 + relativeStrength)
}
