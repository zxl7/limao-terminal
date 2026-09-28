/**
 * 组件级测试 —— 连板天梯（**昨日梯队 × 今日晋级**）。
 *
 * 覆盖五件事：
 *   1. 基线取 `yesterday_zt`（昨日收盘梯队），⛔ 不取 `latest.ladder`（当日 · 09:00 后被覆盖成空）；
 *   2. **涨停整行红** 这条 A股展示规则仍生效（最高板梯队标红）；
 *   3. 梯位只按同日逐票封单额 > 0 上移，不用涨停池晋级名单替代；
 *   4. 反馈矩阵对照日 ≠ 梯队基线日时**不上移**（防张冠李戴）；
 *   5. 同梯位只按今日首封时间排序，缺今日时间排后；缺数据时降级为空态。
 *
 * ⚠️ 第 3 条锁定本卡的封单判定：涨停池名单与盘口封单口径不能混用。
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
function fb(prevDate: string, promoteCodes: string[], sealedCodes = promoteCodes) {
  return {
    generated_ts: '2026-09-21 10:30:00',
    date: '2026-09-21',
    prev_date: prevDate,
    promote_codes: promoteCodes,
    promote_list: promoteCodes.slice(0, 1).map((c) => ({ code: c, name: c, prev_boards: 2, pct: 10 })),
    promote_count: promoteCodes.length,
    promote_rate: 50,
    quotes: Object.fromEntries(sealedCodes.map((code) => [code, { pct: 10, seal_yi: 1 }])),
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

  it('按封单移至晋级后的高度，最高梯位标红', async () => {
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
      expect(screen.getByText('5板')).toBeInTheDocument()
    })

    // 最高梯位（5板）整行获得红色底；原 4 板未上移者仍在 4 板行
    const topRow = screen.getByText('5板').closest('div') as HTMLElement
    expect(topRow.className).toContain('bg-up-soft')
    const lowerRow = screen.getByText('4板').closest('div') as HTMLElement
    expect(lowerRow.className).not.toContain('bg-up-soft')

    // 头部：基线日 + 按封单上移数
    const text = document.body.textContent ?? ''
    expect(text).toContain('2026-09-18 梯队')
    expect(text).toContain('封单上移 2 只')
    expect(topRow.textContent).toContain('华瓷股份')
    expect(lowerRow.textContent).toContain('锡华科技')
    expect(screen.getByText('3板').closest('div')?.textContent).toContain('华软科技')
  })

  it('只按封单大于零上移，涨停池晋级名单不能单独触发移动', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [
        { code: '001', name: '有封单票', boards: 2 },
        { code: '002', name: '仅池内晋级票', boards: 2 },
        { code: '003', name: '零封单票', boards: 2 },
      ]),
      [FEEDBACK]: {
        ...fb('2026-09-18', ['002'], ['001']),
        quotes: {
          '001': { pct: 10, seal_yi: 1 },
          '002': { pct: 10, seal_yi: null },
          '003': { pct: 10, seal_yi: 0 },
        },
      },
    })

    const { container } = render(<LadderCard />, { wrapper: wrapper() })
    await waitFor(() => expect(container.textContent).toContain('封单上移 1 只'))
    expect(screen.getByText('3板').closest('div')?.textContent).toContain('有封单票')
    expect(screen.getByText('2板').closest('div')?.textContent).toContain('仅池内晋级票')
    expect(screen.getByText('2板').closest('div')?.textContent).toContain('零封单票')
  })

  it('缺少封单行情时保持昨日梯位', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [{ code: '001', name: '待确认票', boards: 2 }]),
      [FEEDBACK]: { ...fb('2026-09-18', ['001']), quotes: undefined },
    })

    const { container } = render(<LadderCard />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('待确认票')).toBeInTheDocument())
    expect(screen.getByText('2板').closest('div')?.textContent).toContain('待确认票')
    expect(container.textContent).not.toContain('封单上移 1 只')
  })

  it('收盘后当前封单消失，仍保留当日已确认晋级的梯位', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-25', [{ code: '001', name: '收盘晋级票', boards: 3 }]),
      [FEEDBACK]: {
        ...fb('2026-09-25', ['001']),
        quotes: { '001': { pct: 10, seal_yi: null, sealed_today: true, today_fbt: '093002' } },
      },
    })

    render(<LadderCard />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('收盘晋级票')).toBeInTheDocument())
    expect(screen.getByText('4板').closest('div')?.textContent).toContain('收盘晋级票')
    expect(screen.queryByText('封0亿')).not.toBeInTheDocument()
  })

  it('⛔ 对照日与梯队基线日不同 → 不依据旧封单上移（防张冠李戴）', async () => {
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
    expect(screen.getByText('4板').closest('div')?.textContent).toContain('华瓷股份')
    expect(container.textContent).not.toContain('封单上移')
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

  it('昨首板封单大于零时进入同一张天梯的 2 板行', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [
        { code: '001', name: '连板票', boards: 3 },
        { code: '002', name: '首板晋级票', boards: 1 },
      ]),
      [FEEDBACK]: fb('2026-09-18', ['002']),
    })

    render(<LadderCard />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('首板晋级票')).toBeInTheDocument())
    expect(screen.getByText('2板').closest('div')?.textContent).toContain('首板晋级票')
  })

  it('同梯位按今日首封时间升序，昨日票没有今日时间则排后', async () => {
    mockRoutes({
      [ZT]: yzt('2026-09-18', [
        { code: '001', name: '晚封票', boards: 2 },
        { code: '002', name: '昨日三板未晋级', boards: 3 },
        { code: '003', name: '早封票', boards: 2 },
        { code: '004', name: '今日时间缺失票', boards: 2 },
      ]),
      [FEEDBACK]: {
        ...fb('2026-09-18', []),
        quotes: {
          '001': { pct: 10, seal_yi: 1, today_fbt: '100105' },
          '003': { pct: 10, seal_yi: 1, today_fbt: '092503' },
          '004': { pct: 10, seal_yi: 1, today_fbt: null },
        },
      },
    })

    render(<LadderCard />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('早封票')).toBeInTheDocument())
    const row = screen.getByText('3板').closest('div')?.textContent ?? ''
    expect(row.indexOf('早封票')).toBeLessThan(row.indexOf('晚封票'))
    expect(row.indexOf('晚封票')).toBeLessThan(row.indexOf('昨日三板未晋级'))
    expect(row.indexOf('昨日三板未晋级')).toBeLessThan(row.indexOf('今日时间缺失票'))
    expect(row).toContain('09:25:03')
    expect(row).toContain('10:01:05')
    expect(row).not.toContain('09:30:00')
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
