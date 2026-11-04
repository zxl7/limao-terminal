import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { getJson, recordFreshness, freshnessByRoute } from '../src/shared/api/client'
import { AgeBadge } from '@/shared/ui'
import { DataFreshnessPanel } from '../src/app/DataFreshnessPanel'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { freshnessHeaders, healthPayload } from '../scripts/lib/read-route.mjs'

const route = '/api/market/latest'
const healthy = { stale: '0', age: '1', retired: '0', producer: 'test' }
afterEach(() => { vi.unstubAllGlobals(); freshnessByRoute.clear() })

describe('数据健康元信息', () => {
  it('重复采样刷新龄期基准且样式类真实透传', () => {
    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValue(1000)
    recordFreshness(route, healthy)
    clock.mockReturnValue(3000)
    recordFreshness(route, healthy)
    expect(freshnessByRoute.get(route)?.at).toBe(3000)
    clock.mockRestore()
    expect(renderToStaticMarkup(<AgeBadge className="custom-age" />)).toContain('custom-age')
  })
  it.each([null, '', ' ', '-1', 'NaN', 'Infinity', 'junk'])('非法 age %s 不显示已更新', (age) => {
    recordFreshness(route, { ...healthy, age })
    expect(renderToStaticMarkup(<AgeBadge freshness={freshnessByRoute.get(route)} />)).toContain('新鲜度未知')
  })
  it('无头未知，正常头显示时间，停更明确标记', () => {
    recordFreshness(route, { stale: null, age: null, retired: null, producer: null })
    expect(renderToStaticMarkup(<AgeBadge freshness={freshnessByRoute.get(route)} />)).toContain('未知')
    recordFreshness(route, healthy)
    expect(renderToStaticMarkup(<AgeBadge freshness={freshnessByRoute.get(route)} />)).toContain('更新于')
    recordFreshness(route, { ...healthy, retired: '1' })
    expect(renderToStaticMarkup(<AgeBadge freshness={freshnessByRoute.get(route)} />)).toContain('已停更')
  })
  it.each(['html', '404', 'json', 'network'])('%s 失败覆盖旧健康状态', async (kind) => {
    recordFreshness(route, healthy)
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (kind === 'network') throw new Error('offline')
      return new Response(kind === 'html' ? '<html/>' : kind === 'json' ? '{' : '{}', {
        status: kind === '404' ? 404 : 200,
        headers: { 'Content-Type': kind === 'html' ? 'text/html' : 'application/json', 'X-Data-Age': '1', 'X-Data-Stale': '0', 'X-Data-Retired': '0' },
      })
    }))
    await expect(getJson(route)).rejects.toThrow()
    expect(freshnessByRoute.get(route)?.error).toBe(true)
    expect(renderToStaticMarkup(<AgeBadge freshness={freshnessByRoute.get(route)} />)).toContain('请求失败')
  })
  it('面板无额外取数且未知不能称全部在产', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const html = renderToStaticMarkup(<DataFreshnessPanel />)
    expect(html).toContain('8 路未知')
    expect(html).not.toContain('全部在产')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('dev 探针匹配文件与嵌套目录，不使用无关文件和目录 mtime', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freshness-'))
    try {
      fs.mkdirSync(path.join(root, 'daily', '2026-01-01'), { recursive: true })
      fs.writeFileSync(path.join(root, 'daily', 'snap_1.json'), '{}')
      fs.utimesSync(path.join(root, 'daily', 'snap_1.json'), new Date(0), new Date(0))
      fs.writeFileSync(path.join(root, 'daily', 'unrelated.json'), '{}')
      const def = { dir: 'daily', pattern: '^snap_.*\\.json$', cadence: 'intraday' as const }
      expect(freshnessHeaders(def, root)['X-Data-Stale']).toBe('1')
      expect(healthPayload(root, [[route, def]]).files[0]?.age_sec).toBeGreaterThan(1800)
      const nested = { dir: 'daily', dirPattern: '^2026-', file: 'data.json', cadence: 'daily' as const }
      expect(freshnessHeaders(nested, root)['X-Data-Age']).toBe('')
      expect(healthPayload(root, [[route, nested]]).files[0]?.exists).toBe(false)
      fs.writeFileSync(path.join(root, 'daily', '2026-01-01', 'data.json'), '{}')
      expect(freshnessHeaders(nested, root)['X-Data-Stale']).toBe('0')
      expect(healthPayload(root, [[route, nested]]).files[0]?.exists).toBe(true)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
