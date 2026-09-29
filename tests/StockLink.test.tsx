import { describe, expect, it } from 'vitest'
import { xueqiuStockUrl } from '@/shared/ui'

describe('xueqiuStockUrl', () => {
  it('将沪深北交易所代码归一为雪球详情路径', () => {
    expect(xueqiuStockUrl('600664')).toBe('https://www.xueqiu.com/S/SH600664')
    expect(xueqiuStockUrl('600664.SS')).toBe('https://www.xueqiu.com/S/SH600664')
    expect(xueqiuStockUrl('000001.SZ')).toBe('https://www.xueqiu.com/S/SZ000001')
    expect(xueqiuStockUrl('430047.BJ')).toBe('https://www.xueqiu.com/S/BJ430047')
  })

  it('拒绝非股票代码，避免把板块或第三方编号链接出去', () => {
    expect(xueqiuStockUrl('BK0475')).toBeNull()
    expect(xueqiuStockUrl('000001,600664')).toBeNull()
  })
})
