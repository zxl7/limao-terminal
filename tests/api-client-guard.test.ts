import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataUnavailableError, fetchRoute } from '@/shared/api'

/**
 * 分享通道的「HTML 伪装成数据」必须显式失败。
 *
 * 实测（2026-10-26）：ngrok 免费隧道对未通过警告页的浏览器，会把
 * `/api/xxx` 也回成 `200 text/html` 的中转页。`res.ok` 为真，
 * 但 `res.json()` 抛错，最终在页面上表现为「页面渲染出错」——
 * 排查时会误以为是组件 bug 或后端没数据。
 *
 * 这里锁两件事：
 *   ① 非 JSON 响应 → DataUnavailableError，且消息点名「不是 JSON」
 *   ② 正常 JSON → 原样返回，不因新增守卫被误伤
 */
describe('取数层 · 响应形态守卫', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('200 + text/html（分享中转页）→ 抛 DataUnavailableError，而不是把 HTML 当数据', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>warning page</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })),
    )

    await expect(fetchRoute('/api/decision/latest')).rejects.toBeInstanceOf(DataUnavailableError)
    await expect(fetchRoute('/api/decision/latest')).rejects.toThrow(/不是 JSON/)
  })

  it('200 + application/json 正常返回原始对象（守卫不误伤）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ date: '2026-10-23', rows: [1] }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })),
    )

    await expect(fetchRoute('/api/decision/latest')).resolves.toEqual({
      date: '2026-10-23',
      rows: [1],
    })
  })

  it('text/plain 但正文是 JSON → 放行（不少服务/桩就这么回）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":1}', {
      status: 200,
      headers: { 'content-type': 'text/plain;charset=utf-8' },
    })))

    await expect(fetchRoute('/api/decision/latest')).resolves.toEqual({ ok: 1 })
  })

  it('无 Content-Type 且正文是 HTML → 仍然失败（解析兜底）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })))

    await expect(fetchRoute('/api/decision/latest')).rejects.toBeInstanceOf(DataUnavailableError)
  })
})
