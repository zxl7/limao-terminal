/**
 * 组件级测试 —— 连板天梯（**昨日梯队 × 今日晋级**）。
 *
 * 覆盖五件事：
 *   1. 基线取 `yesterday_zt`（昨日收盘梯队），⛔ 不取 `latest.ladder`（当日 · 09:00 后被覆盖成空）；
 *   2. **涨停整行红** 这条 A股展示规则仍生效（最高板梯队标红）；
 *   3. 晋级标记走 `promote_codes`（**全量**）—— `promote_list` 截断前 8 不得影响判定；
 *   4. 反馈矩阵对照日 ≠ 梯队基线日时**不标晋级**（防张冠李戴）；
 *   5. 数据缺失 / 404 时降级为空态而非崩溃（盘前真实场景）。
 *
 * ⚠️ 第 3 条是**假阴性回归锁**：`promote_list` 是展示用的 `[:8]` 截断名单，
 *    一旦有人把判定改回用它，第 9 只之后的晋级票会被静默标成「未晋级」——
 *    不报错、不告警，只有这个断言能发现。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LadderCard } from '@/features/market'

/** 每个用例独立的 QueryClient：避免缓存跨用例污染 */
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** 昨日涨停池（/api/zt/yesterday）—— `zt_list` 为对象数组，带 code/boards */
function yzt(date: string, rows: { code: string; name: string; boards: number }[]) {
  return {
    date,
    date_raw: date.replace(/-/g, ''),
    generated_ts: `${date} 17:30:00`,
    zt_count: rows.length,
    tc: rows.length,
    max_boards: rows.length ? Math.max(...rows.map((r) => r.boards)) : 0,
    ladder: {},
    top_codes: [],
    zt_list: rows.map((r) => ({
      ...r,
      pct: 10,
      price: 10,
      fbt: '093000',
      zbc: 0,
      hs: 3,
      sector: '测试',
      seal: 1,
      cje_yi: 1,
      zsz_yi: 10,
      lt_yi: 5,
      is_20cm: false,
    })),
  }
}

/** 昨日涨停反馈矩阵（/api/market/feedback）—— `promote_list` 故意只留 1 条（截断模拟） */
function fb(prevDate: string, promoteCodes: string[]) {
  return {
    generated_ts: '2026-09-21 10:30:00',
    date: '2026-09-21',
    prev_date: prevDate,
    promote_codes: promoteCodes,
    promote_list: promoteCodes.slice(0, 1).map((c) => ({ code: c, name: c, prev_boards: 2, pct: 10 })),
    promote_count: promoteCodes.length,
    promote_rate: 50,
    nuke_list: [],
  }
}

/** 按 URL 分发的 fetch 桩（三条路由各自返回自己的夹具） */
function mockRoutes(map: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const key = Object.keys(map).find((k) => String(url).includes(k))
      if (!key) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => map[key] }
    }),
  )
}

const ZT = '/api/zt/yesterday'
const FEEDBACK = '/api/market/feedback'

describe('LadderCard · 昨日梯队 × 今日晋级', () => {
  beforeEach(() => {
    // 契约守卫在结构不符时会 console.warn —— 测试里静音，避免噪声淹没真实失败
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('渲染昨日梯队，最高板整行标红，头部给出「基线日 + 晋级 N/M」', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [
        { code: '001', name: '华瓷股份', boards: 4 },
        { code: '002', name: '锡华科技', boards: 4 },
        { code: '003', name: '世联行', boards: 2 },
        { code: '004', name: '华软科技', boards: 2 },
      ]),
      [FEEDBACK]: fb('2026-09-18', ['001', '004']),
    })

    render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(screen.getByText('4板')).toBeInTheDocument()
    })

    // 最高板（4板）整行获得红色底；2 板行不标红
    const topRow = screen.getByText('4板').closest('div') as HTMLElement
    expect(topRow.className).toContain('bg-up-soft')
    const lowerRow = screen.getByText('2板').closest('div') as HTMLElement
    expect(lowerRow.className).not.toContain('bg-up-soft')

    // 头部：基线日 + 晋级统计（晋级 2 / 共 4）
    const text = document.body.textContent ?? ''
    expect(text).toContain('2026-09-18 梯队')
    expect(text).toContain('晋级 2/4')
  })

  it('⛔ 晋级判定走全量 promote_codes —— promote_list 截断不影响（假阴性回归锁）', async () => {
    const rows = ['01', '02', '03', '04', '05', '06'].map((k, i) => ({
      code: `00000${k}`,
      name: `票${i + 1}`,
      boards: 2,
    }))
    // 6 只昨日 2 板票，今日 5 只晋级 —— 而 promote_list 只带第 1 只（[:8] 之外的模拟）
    mockRoutes({
      [ZT]: yzt('2026-09-18', rows),
      [FEEDBACK]: fb('2026-09-18', rows.slice(0, 5).map((r) => r.code)),
    })

    const { container } = render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(container.textContent).toContain('晋级 5/6')
    })

    // 5 个 ✓ 标记（若误用截断的 promote_list，这里只会是 1 个）
    const ticks = [...container.querySelectorAll('span')].filter((el) => el.textContent === '✓')
    expect(ticks, '✓ 数量应等于全量晋级数（用 promote_list 判定会退化成 1）').toHaveLength(5)
  })

  it('⛔ 对照日与梯队基线日不同 → 一个晋级标记都不标（防张冠李戴）', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [
        { code: '001', name: '华瓷股份', boards: 4 },
        { code: '002', name: '世联行', boards: 2 },
      ]),
      // 反馈矩阵停在前一份快照（09-17），与梯队基线（09-18）不是同一天
      [FEEDBACK]: fb('2026-09-17', ['001', '002']),
    })

    const { container } = render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(container.textContent).toContain('2026-09-18 梯队')
    })
    expect(container.textContent).not.toContain('晋级')
    expect([...container.querySelectorAll('span')].some((el) => el.textContent === '✓')).toBe(false)
  })

  it('首板不进天梯（连板梯队的口径是 ≥2 板）', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [
        { code: '001', name: '连板票', boards: 3 },
        { code: '002', name: '首板票', boards: 1 },
      ]),
      [FEEDBACK]: fb('2026-09-18', []),
    })

    const { container } = render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(container.textContent).toContain('3板')
    })
    expect(container.textContent).not.toContain('首板票')
    expect(container.textContent).not.toContain('1板')
  })

  it('梯队降序：板数高的在前', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [
        { code: '001', name: '低板', boards: 2 },
        { code: '002', name: '高板', boards: 5 },
        { code: '003', name: '中板', boards: 3 },
      ]),
      [FEEDBACK]: fb('2026-09-18', []),
    })

    const { container } = render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(container.textContent).toContain('5板')
    })
    const text = container.textContent ?? ''
    expect(text.indexOf('5板')).toBeLessThan(text.indexOf('3板'))
    expect(text.indexOf('3板')).toBeLessThan(text.indexOf('2板'))
  })

  it('昨日池里没有连板 → 空态，不崩溃', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [{ code: '001', name: '首板票', boards: 1 }]),
      [FEEDBACK]: fb('2026-09-18', []),
    })

    render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(screen.getByText('暂无连板梯队')).toBeInTheDocument()
    })
  })

  it('接口 404（盘前数据未生成）时同样降级为空态', async () => {
    mockRoutes({})

    render(<LadderCard />, { wrapper: wrapper() })

    await waitFor(() => {
      expect(screen.getByText('暂无连板梯队')).toBeInTheDocument()
    })
  })
})
