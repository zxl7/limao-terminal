import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from '@/shared/api'
import type { ExitPeaksFile, ThemeSnapshotFile, Top5HistoryFile } from '@/shared/api'
// eslint-disable-next-line
import { readRoute, resolveDataRoot } from '../scripts/lib/read-route.mjs'
// eslint-disable-next-line
import { MARKET_DAILY_LIMIT_MAX, parseDataQuery, readDataQuery } from '../scripts/lib/data-query.mjs'

const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

const readData = <T>(route: '/api/data/exit-peaks' | '/api/data/theme-snapshot' | '/api/data/top5-history') =>
  readRoute(DATA_ROOT, ROUTES[route]) as T

describe('数据底座 API 契约', () => {
  it('静态事实档只暴露命名白名单，不暴露数据库或目录树', () => {
    const peaks = ROUTES['/api/data/exit-peaks']
    const themes = ROUTES['/api/data/theme-snapshot']
    const top5 = ROUTES['/api/data/top5-history']

    expect(peaks.dir).toBe('cache')
    expect(peaks.pattern).toBe('^intraday_exit_peaks_\\d{8}\\.json$')
    expect(peaks.mode).toBe('latest')
    expect(themes.dir).toBe('cache/theme_snapshot')
    expect(themes.limit).toBe(20)
    expect(top5.dir).toBe('cache/top5_history')
    expect(top5.limit).toBe(20)
  })

  it('真实峰值档保留 null 语义：当前未封不能被伪造为 0', () => {
    const data = readData<ExitPeaksFile>('/api/data/exit-peaks')
    expect(data.schema).toBe('intraday_exit_peaks_v1')
    const values = Object.values(data.stocks)
    expect(values.length).toBeGreaterThan(0)
    expect(values.some((row) => row.current_seal_yi === null && row.current_sealed === false)).toBe(true)
  })

  it('题材冻结和Top5原始档均按交易日返回有限历史', () => {
    const themes = readData<Array<{ file: string; data: ThemeSnapshotFile | null }>>('/api/data/theme-snapshot')
    const top5 = readData<Array<{ file: string; data: Top5HistoryFile | null }>>('/api/data/top5-history')

    expect(themes.length).toBeGreaterThan(0)
    expect(themes.length).toBeLessThanOrEqual(20)
    expect(themes.every((row) => /^theme_\d{4}-\d{2}-\d{2}\.json$/.test(row.file))).toBe(true)
    expect(themes.some((row) => Object.keys(row.data?.mapping ?? {}).length > 0)).toBe(true)
    expect(top5.length).toBeGreaterThan(0)
    expect(top5.length).toBeLessThanOrEqual(20)
    expect(top5.every((row) => /^top5_\d{4}-\d{2}-\d{2}\.json$/.test(row.file))).toBe(true)
  })

  it('受限查询只接受固定端点、6位代码及20日内的条数', () => {
    expect(parseDataQuery('/api/data/market-daily', new URLSearchParams('code=002724&limit=20'))).toEqual({
      command: 'market-daily', code: '002724', limit: 20,
    })
    expect(parseDataQuery('/api/data/market-daily', new URLSearchParams('code=002724&limit=21'))).toMatchObject({
      error: 'invalid_request',
    })
    expect(parseDataQuery('/api/data/market-daily', new URLSearchParams('code=abc'))).toMatchObject({
      error: 'invalid_request',
    })
    expect(parseDataQuery('/api/data/stock-registry', new URLSearchParams('code=002724&sql=select'))).toMatchObject({
      error: 'invalid_request',
    })
    expect(parseDataQuery('/api/data/market-daily', new URLSearchParams(`code=002724&limit=${MARKET_DAILY_LIMIT_MAX + 1}`))).toMatchObject({
      error: 'invalid_request',
    })
  })

  it('真实单票查询只返回固定投影字段，日K条数不超过20', () => {
    const registry = parseDataQuery('/api/data/stock-registry', new URLSearchParams('code=002724'))
    const daily = parseDataQuery('/api/data/market-daily', new URLSearchParams('code=002724&limit=20'))
    expect(registry).not.toBeNull()
    expect(daily).not.toBeNull()
    if (!registry || !daily || 'error' in registry || 'error' in daily) {
      throw new Error('合法单票查询不应被拒绝')
    }

    const profile = readDataQuery(DATA_ROOT, registry) as { found: boolean; stock: Record<string, unknown> | null }
    const bars = readDataQuery(DATA_ROOT, daily) as { limit: number; bars: Array<Record<string, unknown>> }
    expect(profile.found).toBe(true)
    expect(profile.stock?.code).toBe('002724')
    expect(profile.stock).not.toHaveProperty('ext')
    expect(profile.stock).not.toHaveProperty('db_path')
    expect(bars.limit).toBe(20)
    expect(bars.bars.length).toBeGreaterThan(0)
    expect(bars.bars.length).toBeLessThanOrEqual(20)
    expect(bars.bars[0]).toHaveProperty('trade_date')
    expect(bars.bars[0]).not.toHaveProperty('theme')
    expect(bars.bars[0]).not.toHaveProperty('sector')
  })
})
