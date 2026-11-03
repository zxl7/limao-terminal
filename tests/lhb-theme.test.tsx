import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { HithinkLhbFile, HithinkLhbStock, ZtHistoryDay } from '@/shared/api'
import { boardHeightOf, buildGeneIndex, buildThemeCoreIndex, matchFundBoard } from '@/features/analytics'
import { Component as LhbPage } from '@/pages/lhb/LhbPage'
import { Component as MainlinePage } from '@/pages/mainline/MainlinePage'

const date = '2026-10-19'
const stock = (ticker: string, overrides: Partial<HithinkLhbStock> = {}): HithinkLhbStock => ({
  ticker, name: `样本${ticker}`, range_days: 1, concept_list: [{ name: '题材甲' }], net_value: 100_000_000, ...overrides,
})
const file = (stocks: HithinkLhbStock[]): HithinkLhbFile => ({
  date, source: 'hithink', generated_ts: `${date}T17:22:04+08:00`, stock_count: stocks.length,
  stocks, org_top5: [], hotmoney_top5: [],
})

afterEach(() => vi.unstubAllGlobals())

describe('核心辨识度个股 × 资金流：归属与匹配', () => {
  const snap = (leaders: unknown[], early: unknown[] = []) => ({
    leaders, early, top5: [],
  }) as unknown as Parameters<typeof buildThemeCoreIndex>[0]['snapshot']

  it('按 sector 精确归队，不把别人的票算进本题材', () => {
    const index = buildThemeCoreIndex({
      snapshot: snap([
        { sector: '机器人', name: 'A', code: '000001', pct: 10, buyable: true, is_20cm: false, boards: '' },
        { sector: '医药', name: 'B', code: '000002', pct: 5, buyable: true, is_20cm: false, boards: '' },
      ]),
      themeNames: ['机器人', '医药'],
    })
    expect(index.get('机器人')!.stocks.map((s) => s.name)).toEqual(['A'])
    expect(index.get('医药')!.stocks.map((s) => s.name)).toEqual(['B'])
  })

  it('资金流只认「更具体的同名板块」，且取最长命中而非相加', () => {
    const boards = {
      '人形机器人': { pct: 0.11, flow_yi: 17.5 },
      '机器人概念': { pct: 0.06, flow_yi: 1.3 },
      '机器人执行器': { pct: -0.7, flow_yi: 3.3 },
    }
    expect(matchFundBoard('机器人', boards)).toEqual({ board: '人形机器人', pct: 0.11, flowYi: 17.5 })
    // 精确命中优先
    expect(matchFundBoard('机器人概念', boards)).toEqual({ board: '机器人概念', pct: 0.06, flowYi: 1.3 })
  })

  it('板块口径比题材更宽时必须拒绝（电池 ≠ 固态电池）', () => {
    expect(matchFundBoard('固态电池', { 电池: { pct: 0.4, flow_yi: 1.6 } })).toBeNull()
    expect(matchFundBoard('大消费', { 消费: { pct: 1, flow_yi: 9 } })).toBeNull()
    expect(matchFundBoard('机器人', {})).toBeNull()
  })

  it('按辨识度地位排序：连板高者先，其次才看涨幅；缺失涨幅排最后', () => {
    const index = buildThemeCoreIndex({
      snapshot: snap([
        { sector: '机器人', name: '低板', code: '000001', pct: 20, buyable: true, is_20cm: true, boards: '1天1板' },
        { sector: '机器人', name: '高板', code: '000002', pct: 10, buyable: true, is_20cm: false, boards: '6天4板' },
        { sector: '机器人', name: '无板无涨幅', code: '000003', pct: null, buyable: true, is_20cm: false, boards: '' },
      ]),
      themeNames: ['机器人'],
    })
    expect(index.get('机器人')!.stocks.map((s) => s.name)).toEqual(['高板', '低板', '无板无涨幅'])
    expect(index.get('机器人')!.stocks[0].boardHeight).toBe(4)
  })

  it('连板高度解析：`6天4板`→4、纯数字→该数字、无板→0', () => {
    expect(boardHeightOf('6天4板')).toBe(4)
    expect(boardHeightOf('4')).toBe(4)
    expect(boardHeightOf('')).toBe(0)
    expect(boardHeightOf(null)).toBe(0)
    expect(boardHeightOf('首板')).toBe(0)
  })

  it('同代码去重：leaders 与题材龙头重复只留一条', () => {
    const index = buildThemeCoreIndex({
      snapshot: {
        leaders: [{ sector: '机器人', name: '大业股份', code: '603278', pct: 10, buyable: true, is_20cm: false, boards: '7天7板' }],
        early: [],
        top5: [{ name: '机器人', leader: { name: '大业股份', code: '603278', pct: 10, turn: 12.3, boards: '7天7板' } }],
      } as unknown as Parameters<typeof buildThemeCoreIndex>[0]['snapshot'],
      themeNames: ['机器人'],
    })
    const facts = index.get('机器人')!
    expect(facts.stocks).toHaveLength(1)
    expect(facts.stocks[0].turn).toBe(12.3)
    // 地位取更强者：题材龙头身份不能被 leaders 覆盖掉
    expect(facts.stocks[0].role).toBe('theme-leader')
    expect(facts.stocks[0].boardHeight).toBe(7)
  })

  it('换手率按名字从题材快照回填，找不到就留 null', () => {
    const index = buildThemeCoreIndex({
      snapshot: {
        leaders: [
          { sector: '机器人', name: '大业股份', code: '603278', pct: 10, buyable: true, is_20cm: false, boards: '' },
          { sector: '机器人', name: '陌生票', code: '000009', pct: 2, buyable: true, is_20cm: false, boards: '' },
        ],
        early: [],
        top5: [{ name: '机器人', leader: { name: '大业股份', code: '603278', pct: 10, turn: 12.3, boards: '' }, followers: [{ name: '陌生票', pct: 2, turn: 30 }] }],
      } as unknown as Parameters<typeof buildThemeCoreIndex>[0]['snapshot'],
      themeNames: ['机器人'],
    })
    const stocks = index.get('机器人')!.stocks
    expect(stocks.find((s) => s.name === '大业股份')!.turn).toBe(12.3)
    expect(stocks.find((s) => s.name === '陌生票')!.turn).toBe(30)
  })

  it('无快照或无板块资金时安全返回空，不伪造', () => {
    const index = buildThemeCoreIndex({ snapshot: null, themeNames: ['机器人'] })
    expect(index.get('机器人')).toEqual({ stocks: [], fund: null, fundMatched: false })
  })
})

// ── 页面级：融合后的真实呈现 ────────────────────────────────

const mainlineStub = (lhb: HithinkLhbFile, opts: {
  asof?: string
  ztList?: Array<{ file: string; data: ZtHistoryDay }>
  leaders?: Array<Record<string, unknown>>
  boards?: Record<string, { pct: number; flow_yi: number }>
  genes?: Array<{ file: string; data: Record<string, unknown> }>
} = {}) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input).split('?')[0]
    const body = url === '/api/market/latest'
      ? {
        ts: '2026-10-26T14:02:07+08:00', total_zt: 42, sentiment: '分歧', data_scope: { asof: opts.asof ?? '2026-10-26' },
        leaders: opts.leaders ?? [],
        top5: [
          {
            rank: 1, name: '机器人', desc: '', zt_count: 29, turn_avg: 8, total_stocks: 120,
            leader: { name: '大业股份', code: '603278', pct: 10, boards: '7天7板', turn: 12.3, cap_yi: 80, desc: '', seal: '🔥 秒封板' },
            followers: [{ name: '海洋王', pct: -9.9, turn: 25.1 }],
            zt_stocks: [], diffusion: '', risks: [], positives: [], delta: 'ongoing', zt_prev: 17,
          },
          {
            rank: 2, name: '医药', desc: '', zt_count: 2, turn_avg: 5, total_stocks: 60,
            leader: null, followers: [], zt_stocks: [], diffusion: '', risks: [], positives: [],
            delta: 'new', zt_prev: null,
          },
        ],
      }
      : url === '/api/lhb/hithink' ? [{ file: 'hithink_lhb_20261019.json', data: lhb }]
        : url === '/api/flow/live' ? { date: '2026-10-26', ts: 1, boards: opts.boards ?? {} }
          : url === '/api/gene/hist' ? (opts.genes ?? [])
            : url === '/api/emotion/zt-history' ? (opts.ztList ?? [])
              : []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

const mountMainline = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><MainlinePage /></QueryClientProvider>)
}

describe('主线题材页面：个股优先、按辨识度地位、不重复', () => {
  const leaders = [
    { sector: '机器人', name: '达瑞电子', code: '300976', pct: 20, price: 30, buyable: false, is_20cm: true, boards: '', limit_up_days: 1 },
    { sector: '机器人', name: '朗特智能', code: '300916', pct: 20, price: 25, buyable: false, is_20cm: true, boards: '', limit_up_days: 1 },
    { sector: '机器人', name: '大业股份', code: '603278', pct: 10, price: 20, buyable: false, is_20cm: false, boards: '6天4板', limit_up_days: 4 },
    { sector: '医药', name: '塞力医疗', code: '603716', pct: 10, price: 12, buyable: true, is_20cm: false, boards: '', limit_up_days: 1 },
  ]
  const boards = { '人形机器人': { pct: 0.11, flow_yi: 17.5 }, '机器人概念': { pct: 0.06, flow_yi: 1.3 } }

  it('折叠状态不重复面板数据：行内不再出现核心只数与资金额', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    const panel = robot.parentElement!
    // 行按钮本身不出现资金/核心统计（只在展开面板里出现一次）
    expect(within(robot).queryByText('核心')).not.toBeInTheDocument()
    expect(within(robot).queryByText('+17.50亿')).not.toBeInTheDocument()
    expect(within(panel).getAllByText('+17.50亿')).toHaveLength(1)
    expect(within(panel).getAllByText('人形机器人')).toHaveLength(1)
  })

  it('个股按辨识度地位排序：连板龙头排第一，涨幅更大的 20cm 排其后', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    const items = within(robot.parentElement!).getAllByRole('listitem')
    const names = items.map((li) => li.textContent)
    expect(names[0]).toContain('大业股份') // 题材龙头排第一
    expect(names[0]).toContain('7天7板') // 连板文案以题材龙头自带为准（比 leaders 更新）
    // ⛔ 不再重复「龙头」标签：行里已经写了龙头是谁
    expect(names[0]).not.toContain('龙头')
    // 20cm 但无连板 → 排在 4 板之后
    expect(names.slice(1).join()).toContain('达瑞电子')
  })

  it('个股在前、资金流在后：DOM 顺序即阅读顺序', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    const panel = robot.parentElement!
    const list = within(panel).getAllByRole('list')[0]
    const fund = within(panel).getByText('资金流')
    expect(list.compareDocumentPosition(fund)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('无同名板块资金时明说口径缺失，不写 0', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders }))
    mountMainline()
    fireEvent.click(await screen.findByRole('button', { name: '题材 医药' }))
    expect(await screen.findByText('该题材无同名板块资金口径')).toBeInTheDocument()
  })

  it('同一只票只在列表出现一次（leaders 与题材龙头不重复成两行）', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    expect(within(robot.parentElement!).getAllByText('大业股份')).toHaveLength(1)
  })
})

describe('升级项：分层、股性、相对资金', () => {
  const leaders = [
    { sector: '机器人', name: '达瑞电子', code: '300976', pct: 20, price: 30, buyable: false, is_20cm: true, boards: '', limit_up_days: 1 },
    { sector: '机器人', name: '大业股份', code: '603278', pct: 10, price: 20, buyable: false, is_20cm: false, boards: '6天4板', limit_up_days: 4 },
    { sector: '机器人', name: '某首板', code: '000777', pct: 10, price: 10, buyable: true, is_20cm: false, boards: '1天1板', limit_up_days: 1 },
  ]
  const boards = { '人形机器人': { pct: 0.11, flow_yi: 17.5 } }
  const genes = [
    { file: 'hist_603278.json', data: { code: '603278', zt_250: 24, max_boards_hist: 6, promo_rate_hist: 60.9 } },
    { file: 'hist_300976.json', data: { code: '300976', zt_250: 4, max_boards_hist: 2, promo_rate_hist: null } },
  ]

  it('按 连板 / 首板 / 未封 三档分组，每档带只数', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards, genes }))
    mountMainline()
    await screen.findByRole('button', { name: '题材 机器人' })
    expect(await screen.findByRole('region', { name: '核心个股·连板' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '核心个股·首板' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '核心个股·未封·强势' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '核心个股·连板' })).getByText('1')).toBeInTheDocument()
  })

  it('严格连板龙打「严龙」标，无档案的票不打', async () => {
    const dragon = [
      { file: 'h1.json', data: { code: '603278', first_day: '20200101', last_day: '20261023', zt_total: 40, zt_250: 24, max_boards_hist: 6, promo_rate_hist: 61 } },
    ]
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards, genes: dragon }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    const panel = robot.parentElement!
    expect(within(panel).getAllByText('严龙')).toHaveLength(1)
    expect(within(panel).getByText('大业股份').closest('li')!.textContent).toContain('严龙')
    expect(within(panel).getByText('某首板').closest('li')!.textContent).not.toContain('严龙')
  })

  it('叠加股性：年涨停次数与晋级率；无档案的票不显示，更不写 0', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards, genes }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    const panel = robot.parentElement!
    const daye = within(panel).getByText('大业股份').closest('li')!
    expect(daye.textContent).toContain('年涨停')
    expect(daye.textContent).toContain('24')
    expect(daye.textContent).toContain('晋级')
    expect(daye.textContent).toContain('60.9%')
    // 某首板无基因档案 → 不出现「年涨停 0」
    const noGene = within(panel).getByText('某首板').closest('li')!
    expect(noGene.textContent).not.toContain('年涨停')
  })

  it('行内给涨停/家数，避免孤立的家数看不出扩散空间', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    expect(within(robot).getByText('29/120')).toBeInTheDocument()
  })

  it('资金流带「页内相对」强度条，宽度按本页最大净额归一', async () => {
    vi.stubGlobal('fetch', mainlineStub(file([]), { leaders, boards }))
    mountMainline()
    const robot = await screen.findByRole('button', { name: '题材 机器人' })
    const panel = robot.parentElement!
    expect(within(panel).getByText('页内相对')).toBeInTheDocument()
    const fill = panel.querySelector('[title="仅在本页题材之间相对比较"]')!.parentElement!.querySelector('span[style*="width"]')!
    expect((fill as HTMLElement).style.width).toBe('100%')
  })
})

describe('排序权重：高度优先于概率（2026-10-28 用户定）', () => {
  /**
   * 用户原话：「更信已经走出来的高度」。
   * 所以「严龙」只是**标记**，不参与排序 —— 一只 4 板但没严龙标的票，
   * 必须排在一只 2 板严龙前面。这条锁一旦被改，说明有人替用户改了权重。
   */
  const snap = {
    leaders: [
      { sector: '机器人', name: '二板严龙', code: '000001', pct: 10, buyable: true, is_20cm: false, boards: '1天2板' },
      { sector: '机器人', name: '四板普通', code: '000002', pct: 10, buyable: true, is_20cm: false, boards: '6天4板' },
    ],
    early: [],
    top5: [],
  } as unknown as Parameters<typeof buildThemeCoreIndex>[0]['snapshot']

  it('4 板无严龙标 排在 2 板严龙 之前', () => {
    const index = buildThemeCoreIndex({ snapshot: snap, themeNames: ['机器人'] })
    expect(index.get('机器人')!.stocks.map((s) => s.name)).toEqual(['四板普通', '二板严龙'])
  })

  it('只有连板高度相同时，才轮到龙头身份与涨幅', () => {
    const tie = {
      leaders: [
        { sector: '机器人', name: '四板低涨幅', code: '000003', pct: 2, buyable: true, is_20cm: false, boards: '6天4板' },
        { sector: '机器人', name: '四板高涨幅', code: '000004', pct: 19, buyable: true, is_20cm: false, boards: '5天4板' },
      ],
      early: [],
      top5: [],
    } as unknown as Parameters<typeof buildThemeCoreIndex>[0]['snapshot']
    const index = buildThemeCoreIndex({ snapshot: tie, themeNames: ['机器人'] })
    expect(index.get('机器人')!.stocks.map((s) => s.name)).toEqual(['四板高涨幅', '四板低涨幅'])
  })
})

describe('严格连板龙判定', () => {
  const mk = (over: Record<string, unknown>) => buildGeneIndex([{
    file: 'hist.json',
    data: { code: '603278', first_day: '20200101', last_day: '20261023', zt_total: 40, zt_250: 24, max_boards_hist: 6, promo_rate_hist: 60, ...over } as never,
  }]).get('603278')!

  it('晋级≥40% 且年涨停高于历史年均 → 标记为严格连板龙', () => {
    // 6.8 年 40 次 ≈ 年均 5.9 → 24 次远高于年均
    expect(mk({}).strictDragon).toBe(true)
  })

  it('晋级率不足 40% → 不标（哪怕涨停次数很高）', () => {
    expect(mk({ promo_rate_hist: 39.9 }).strictDragon).toBe(false)
  })

  it('近一年次数未超过自身历史年均 → 不标（吃老本的票不算）', () => {
    // 1.2 年 100 次 ≈ 年均 83 → 24 次低于年均
    expect(mk({ first_day: '20250801', zt_total: 100 }).strictDragon).toBe(false)
  })

  it('上市不足半年或字段缺失 → 不判定（null），不用 false 冒充', () => {
    expect(mk({ first_day: '20260601' }).strictDragon).toBeNull()
    expect(mk({ promo_rate_hist: null }).strictDragon).toBeNull()
    expect(mk({ last_day: 'bad' }).strictDragon).toBeNull()
  })

  it('年均由 zt_total / 上市年数推出，不是固定阈值', () => {
    const g = mk({})
    expect(g.annualAvg).toBeGreaterThan(5)
    expect(g.annualAvg).toBeLessThan(7)
  })
})

describe('龙虎榜页面：全量而非摘要', () => {
  it('上榜个股·全量给出全部行（含单日与三日），并剔除科创板', async () => {
    const source = file([
      ...Array.from({ length: 7 }, (_, i) => stock(String(300001 + i), { name: `全量单${i}`, net_value: (i + 1) * 100_000_000 })),
      ...Array.from({ length: 5 }, (_, i) => stock(String(600001 + i), { name: `全量三${i}`, range_days: 3 as const, net_value: (i + 1) * 50_000_000 })),
      stock('688001', { name: '科创不应出现' }),
    ])
    source.org_top5 = [{ code: '300001', name: '全量单0', org_net_yi: 1, net_yi: 1, concepts: [] }]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/api/lhb/hithink') ? [{ file: 'hithink_lhb_20261019.json', data: source }] : []
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const view = render(<QueryClientProvider client={client}><LhbPage /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '上榜个股·全量' }))
    await screen.findByText('全量单0')
    expect(view.container.textContent).toContain('共 12 行')
    expect(view.container.textContent).toContain('12 只')
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(screen.queryByText('科创不应出现')).not.toBeInTheDocument()
    expect(screen.getAllByText('三日')).toHaveLength(5)
    expect(screen.getAllByText('单日')).toHaveLength(7)
  })

  it('龙虎榜页只做榜单查询，不再承载题材聚合', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify([{ file: 'hithink_lhb_20261019.json', data: file([stock('000001')]) }]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><LhbPage /></QueryClientProvider>)
    await screen.findByRole('button', { name: '上榜个股·全量' })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})
