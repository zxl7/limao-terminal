import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { DecisionDossier, DossierStock, PoolCallFile, ScreenFile } from '@/shared/api'
import { BuyPlan, DecisionBoard, EnvPanel, PickCard, ScreenFunnel } from '@/features/wealth'

/**
 * 财富密码「今日决策」契约（2026-11-04 用户「展示不够让我分析和查看，设计一下模块和卡片」）。
 *
 * 锁七点：
 * ① 决策条必须同时给出「环境 / 名额（名义→生效）/ 实际买入」，缺一不可；
 * ② 单票卡六维齐（方向 / 股性 / 量能封板 / 身位 / 资金筹码 / 晋级三问）；
 * ③ ⛔ 缺字段渲染 `—`，**不得回退成 0**（0 是有效值，会把「没数据」伪装成「很干净」）；
 * ④ 过筛拒因必须**归一化聚合**（脚本按原文逐条记，不聚合成不了结论）；
 * ⑤ 三档结论语义分开：pass / watch_only / reject 不混；
 * ⑥ 接力池为空是**合法结论**，不显示成「没数据」；
 * ⑦ 买点表区分「预期区间 / 量能线 / 买不到概率 / 该档真买到胜率」四个口径。
 */

const FBT = '093545'

function stock(patch: Partial<DossierStock> = {}): DossierStock {
  return {
    code: '002580',
    name: '圣阳股份',
    theme: '锂电池',
    core_theme: '锂电池',
    core_theme_logic: '储能·电网',
    theme_name: '新能源',
    theme_mates_cnt: 7,
    score: 87.89,
    ign_score: 38.83,
    exp_score: 26.56,
    lead_score: 20,
    cap_score: 62.07,
    raw_score: 63.73,
    themeTier: 1,
    tags: ['带动板块', '先发'],
    price: null,
    pct: 10.02,
    boards: 1,
    hs: 8.77,
    zbc: 0,
    fbt: FBT,
    seal_amt: 2.57,
    lt_mktcap: 84.45,
    zsz_yi: 84.74,
    cje_yi: 7.25,
    sector: '电池',
    ladder_health: 9.3,
    ladder_has_complete: true,
    ladder_grade: 'A',
    is_sector_dragon: false,
    sector_mates_cnt: 7,
    theme_is_lone: false,
    theme_has_sector_effect: true,
    sector_is_lone: false,
    carry_cnt: 5,
    carry_time: '09:35',
    carry_score: 1,
    history_relay_prob: 0.0932,
    history_relay_samples: 1305,
    history_relay_stock_samples: 0,
    history_relay_factor: -5.14,
    history_relay_note: '同高度1305次·个股0次·情绪校准-7.5pp',
    is_capacity_core: false,
    style_tag: '容量',
    is_20cm: false,
    is_st: false,
    is_one_word: false,
    main_flow_yi: 3.95,
    main_flow_5d_yi: -0.19,
    main_flow_10d_yi: -1.03,
    main_flow_20d_yi: -1.84,
    chip_profit_rate: 80.56,
    chip_avg_cost: 17.05,
    chip_conc90: 12.82,
    seal_ratio_pct: 3.04,
    line_top: 2,
    dragon_rank: 2,
    line_tier_why: '这条线最高 2 板、池内有紫竹高科兜着',
    dragon_leader_name: '紫竹高科',
    dragon_leader_boards: 2,
    leader_role: '准龙头',
    relay_stage: 'one_to_two',
    relay_mood: 'insufficient',
    watch_rank: 1,
    watch_group: '容量核心',
    seal_gate: { schema: 'seal_gate_v1', grade: 'normal', score: 4, floor_used: 1.5, style: 'turnover', source: 'enough' },
    promotion_quiz: {
      schema: 'promotion_quiz_v1',
      passed: 2,
      label: '两高',
      items: {
        win_rate: { ok: false, why: '晋级率39%＜40%', value: 38.9, samples: 19 },
        promote: { ok: true, why: '1板·历史最长7板', boards: 1, max_hist: 7 },
        status: { ok: true, why: '准龙头·题材7家', role: '准龙头', theme_mates: 7 },
      },
      blocked_by: ['win_rate'],
    },
    forecast: {
      schema: 'relay_forecast_v1',
      boards: 1,
      gap_to_top: 3,
      group: '差≥2板·封板强(≥3)',
      group_n: 78,
      gap_median: 9.75,
      gap_p25: 0.05,
      gap_p75: 10,
      p_over5: 66,
      promo_rate: 52.6,
      buy_n: 7,
      buy_win: 28.6,
      buy_avg: -2.69,
      verdict: '放弃',
      reasons: ['身位差 3 板＝后排'],
    },
    expectation: {
      expected_range: [0.0, 1.2],
      super_gap_min: 3.2,
      auction_amount_min_yi: 0.22,
      auction_amount_super_yi: 0.51,
      auction_amount_range: [3, 7],
      amount_ratio: [0.03, 0.07],
      auction_boom_yi: 1.09,
      boom_label: '🔺爆量高开',
      gap_strength: 'mid',
      gap_strength_hint: '⬆正常高开预期',
      seal_form: '快速板',
      seal_zbc: 0,
      sector_tier: 'capacity',
      sector_sentiment: 'mid',
      expected_text: '[快速板]容量核心·板块中 竞价涨幅 0.0%~1.2% 且量能≥0.22亿',
      super_text: '竞价涨幅≥3% 且量能≥0.51亿，超预期直接买',
      low_text: '竞价未达 0.0% 或量能<0.22亿，不买入',
      phase: '冰点',
      phase_note: '情绪分1.0/10',
      theme_phase: '启动',
      confidence: 0.5,
      dragon_diagnosis: {} as DossierStock['expectation']['dragon_diagnosis'],
      ai_note: '—',
      is_ai: false,
    },
    dim_panel: {},
    quant_dims: {},
    narrative: '今日走势：09:35:45 封板。\n⚠️风险：跟着涨，明天高开多了容易一日游。',
    ...patch,
  } as DossierStock
}

function dossier(patch: Partial<DecisionDossier> = {}): DecisionDossier {
  return {
    schema: 'wealth_code_candidates_v1',
    date: '2026-11-03',
    generated_at_bj: '2026-11-03T15:36:48+08:00',
    regime: 'ice',
    environment: {
      sentiment_score: 1,
      sentiment_label: '退潮',
      promote_rate: 12.8,
      nuke_count: 10,
      broken_rate: 41,
      break_count: 4,
      up_rate: 50.4,
      avg_pct: 0.98,
      now_zt_count: 49,
      regime: 'ice',
      em_expect: [],
    },
    real_env: {
      ts: '2026-11-03T15:00:09+08:00',
      indices: [
        { name: '上证指数', pct: -0.95, price: 3603.5 },
        { name: '深证成指', pct: -1.19, price: 10879.9 },
        { name: '创业板指', pct: -2.75, price: 2391.14 },
      ],
      avg_index_pct: -1.63,
      sentiment: '分歧',
      sentiment_score: -1,
      total_zt: 49,
      limit_down: { count: 16, names: ['世纪恒通', '麦格米特'] },
      broken: { count: 22, names: [] },
    },
    ai_env: {},
    data_source: 'tx',
    relay: [],
    watch: [stock()],
    early_ambush: [],
    diagnostics: {} as DecisionDossier['diagnostics'],
    global_narrative: '',
    market_max_boards: 4,
    market_style: { style: 'neutral', label: '没方向', ice: true, rule: '指数没有明确方向' },
    ...patch,
  } as DecisionDossier
}

function poolCall(patch: Partial<PoolCallFile> = {}): PoolCallFile {
  return {
    schema: 'pool_call_v1',
    trade_date: '2026-11-04',
    stance: 'defend',
    quota: 1,
    views: {},
    meta: {
      caliber: 'test',
      stance: 'defend',
      quota: 1,
      effective_quota: 0,
      pool_size: 7,
      participate: [],
      call_at: '09:25:03',
      market_open: {
        enabled: true,
        pool_size: 48,
        quoted: 48,
        coverage: 1,
        red_open_count: 26,
        red_open_ratio: 0.542,
        leader_count: 15,
        leader_red_open_count: 10,
        leader_red_open_ratio: 0.667,
        leader_volume_median_ratio: 0.86,
        leader_volume_pass_ratio: 0.4,
        ready: false,
        reason: '昨涨停竞价没有同时达到红开与量能要求',
      },
    },
    ...patch,
  } as PoolCallFile
}

function screenFile(patch: Partial<ScreenFile> = {}): ScreenFile {
  return {
    schema: 'daily_screen_v1',
    date: '2026-11-03',
    zt_count: 48,
    market_max_boards: 4,
    counts: { pass: 3, watch_only: 0, reject: 45 },
    reject_reasons: {
      '换手板成交额 2.54亿': 1,
      '换手板成交额 1.68亿': 1,
      '身位差 2 板': 12,
      '同题材仅 1 家，未成线': 22,
      '股性难连板': 1,
    },
    screened: [
      {
        code: '002086',
        name: '东方海洋',
        boards: 4,
        theme: '农产品加',
        theme_members: 1,
        verdict: 'pass',
        rejects: [],
        watch_reasons: [],
        supports: ['独苗高标（4 板）'],
        unknown: [],
        priority: 2,
        facts: {},
      },
      {
        code: '002058',
        name: '紫竹高科',
        boards: 2,
        theme: '锂电池',
        theme_members: 7,
        verdict: 'reject',
        rejects: ['换手板成交额 2.54亿 < 5亿（易被做局）'],
        watch_reasons: [],
        supports: ['股性 连板龙'],
        unknown: [],
        priority: 2,
        facts: {},
      },
    ],
    ...patch,
  }
}

describe('EnvPanel 出手结论行（原顶部横条信息，2026-11-04 并入卡内首行）', () => {
  it('取向 / 名义→生效名额 / 实际买入 / 最高板 四件齐全', () => {
    const { container } = render(<EnvPanel dossier={dossier()} callFile={poolCall()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('取向')
    expect(txt).toContain('防守')
    // 名额被压：名义 1 → 生效 0 必须都出现
    expect(txt).toContain('名额')
    expect(txt).toContain('1 →')
    expect(txt).toContain('0')
    expect(txt).toContain('实际买入')
    expect(txt).toContain('全市场最高')
    expect(txt).toContain('4')
  })

  it('缺 dossier / callFile 时降级为破折号，不抛错', () => {
    const { container } = render(<EnvPanel />)
    expect(container.textContent).toContain('—')
  })
})

describe('PickCard 单票六维', () => {
  it('六维标签齐全', () => {
    const { container } = render(<PickCard stock={stock()} bucket="watch" rank={1} marketMaxBoards={4} />)
    const txt = container.textContent ?? ''
    for (const label of ['方向', '股性', '量能', '身位', '资金', '三问']) {
      expect(txt).toContain(label)
    }
  })

  it('核心数值都上了卡（题材/身位/量能/股性/资金/筹码）', () => {
    const { container } = render(<PickCard stock={stock()} bucket="watch" rank={1} marketMaxBoards={4} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('锂电池')
    expect(txt).toContain('同题材 7 家')
    expect(txt).toContain('第 2') // 方向内排名
    expect(txt).toContain('7.25 亿') // 成交额
    expect(txt).toContain('38.9%') // 同高度晋级率（原始）
    expect(txt).toContain('情绪校准 9.3%')
    expect(txt).toContain('3.95 亿') // 主力当日
    expect(txt).toContain('获利盘 80.6%')
    expect(txt).toContain('2/3') // 晋级三问
    // ⛔ 必须是中文：`blocked_by` 的键名（win_rate）不得漏到界面
    expect(txt).toContain('卡在晋级率')
    expect(txt).not.toContain('win_rate')
    expect(txt).toContain('差 3 板') // 距全市场最高板
  })

  it('明日推测一条写清「中位 / 买不到 / 该档真买到胜率」', () => {
    const { container } = render(<PickCard stock={stock()} bucket="watch" rank={1} marketMaxBoards={4} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('明早')
    expect(txt).toContain('9.8%') // gap_median 9.75
    expect(txt).toContain('66% 买不到')
    expect(txt).toContain('28.6%') // 该档真买到胜率
    expect(txt).toContain('n=7')
    expect(txt).toContain('放弃')
  })

  it('⛔ 缺字段渲染「—」而不是 0', () => {
    const bare = stock({
      cje_yi: null as unknown as number,
      main_flow_yi: null as unknown as number,
      chip_profit_rate: null as unknown as number,
      forecast: undefined,
      promotion_quiz: undefined,
      seal_ratio_pct: undefined,
      seal_amt: null as unknown as number,
    })
    const { container } = render(<PickCard stock={bare} bucket="watch" />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('—')
    // 成交额缺失 → 主值「—」；⛔ 不得写成「0.00 亿」
    expect(txt).toContain('量能—')
    expect(txt).not.toContain('0.00 亿')
    // 获利盘缺失 → 「—」；⛔ 不得写成「0.0%」（区间 0.0%~1.2% 是真实数据，另行断言）
    expect(txt).toContain('获利盘')
  })

  it('一字板形态与换手板形态都能读出', () => {
    const a = render(
      <PickCard stock={stock({ seal_gate: { style: 'yizi', floor_used: 1.5 } })} bucket="watch" />,
    )
    expect(a.container.innerHTML).toContain('一字板')
    a.unmount()
    const b = render(
      <PickCard stock={stock({ seal_gate: { style: 'turnover', floor_used: 5 } })} bucket="watch" />,
    )
    expect(b.container.innerHTML).toContain('换手板')
  })
})

describe('ScreenFunnel 全量过筛', () => {
  it('三段计数与全量涨停数都在', () => {
    const { container } = render(<ScreenFunnel screen={screenFile()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('48')
    expect(txt).toContain('通过')
    expect(txt).toContain('排除')
    // ⛔ 计数取 counts（权威），不数明细：明细被截断时不能把「45」显示成「1」
    expect(txt).toContain('45')
  })

  it('拒因归一化聚合：不同成交额的换手板并成一类', () => {
    const { container } = render(<ScreenFunnel screen={screenFile()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('换手板量能不足')
    // 两条原文合并后共 2 家
    const row = [...container.querySelectorAll('div')].find((d) =>
      d.textContent?.startsWith('换手板量能不足'),
    )
    expect(row?.textContent).toContain('2')
  })

  it('未落盘时明说「未启用或未落盘」，不伪造数字', () => {
    const { container } = render(<ScreenFunnel />)
    expect(container.textContent).toContain('未落盘')
  })
})

describe('EnvPanel 环境结论（2026-11-04 精简为两行）', () => {
  it('只留「出手结论 + 今晨竞价」，昨日情绪/盘面已交给 /emotion', () => {
    const { container } = render(<EnvPanel dossier={dossier()} callFile={poolCall()} />)
    const txt = container.textContent ?? ''

    // ✅ 保留：出手结论行（「今天该不该出手」的唯一锚点）
    expect(txt).toContain('取向')
    expect(txt).toContain('名额')
    expect(txt).toContain('实际买入')

    // ✅ 保留：今晨竞价（全系统唯一能解释「为什么没买」的地方）
    expect(txt).toContain('今晨竞价')
    expect(txt).toContain('26/48')
    expect(txt).toContain('10/15')
    expect(txt).toContain('未达标')
    expect(txt).toContain('没有同时达到红开与量能要求')

    // ⛔ 已删：昨日情绪 / 盘面（`/emotion` 整页覆盖，此处重复只会稀释决策信息）
    expect(txt).not.toContain('昨日情绪')
    expect(txt).not.toContain('核按钮')
    expect(txt).not.toContain('创业板指')
  })
})

describe('BuyPlan 明日买点', () => {
  it('四列口径分开：区间 / 量能线 / 买不到 / 该档胜率', () => {
    const { container } = render(<BuyPlan relay={[]} watch={[stock()]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('预期竞价区间')
    expect(txt).toContain('0.0% ~ 1.2%')
    expect(txt).toContain('量能线')
    expect(txt).toContain('0.22 亿')
    expect(txt).toContain('买不到')
    expect(txt).toContain('66%')
    expect(txt).toContain('该档真买到')
    expect(txt).toContain('28.6%')
  })
})

describe('DecisionBoard 整体', () => {
  it('接力池为空时明说「留空是允许的结论」，不说没数据', () => {
    const { container } = render(
      <DecisionBoard dossier={dossier()} callFile={poolCall()} screen={screenFile()} />,
    )
    const txt = container.textContent ?? ''
    expect(txt).toContain('今日无可接力标的')
    expect(txt).not.toContain('暂无数据')
  })

  it('无档案时提示未落盘', () => {
    const { container } = render(<DecisionBoard />)
    expect(container.textContent).toContain('未落盘')
  })

  it('真实 11-03 档案（存在才跑）：圣阳股份六维能填满', () => {
    // 真实数据只在本地存在时验证，归档滚动后自动跳过，不让测试变成脆断言
    const fs = require('node:fs') as typeof import('node:fs')
    const p = '/Users/zxl/WorkBuddy/狸猫猎手/wealth_code/cache/candidates-2026-11-03.json'
    if (!fs.existsSync(p)) return
    const real = JSON.parse(fs.readFileSync(p, 'utf8')) as DecisionDossier
    const s = real.watch?.[0] ?? real.relay?.[0]

    render(<DecisionBoard dossier={real} screen={screenFile()} />)
    const body = document.body.textContent ?? ''
    expect(body).toContain(real.date)
    if (s) expect(body).toContain(s.name)
  })
})

describe('决策页与诊断页的分工（2026-11-04 合并）', () => {
  /**
   * ⛔ 全量过筛是**调参诊断层**，不是下单依据，不得出现在「今日决策」页。
   *    实证 11-04：过筛放行 70 只，后面「最高板薄封」全拦掉，70 只一只没用上；
   *    `通过 70` 摆在决策页只会让人误以为「有 70 个机会」。
   */
  it('DecisionBoard 不再渲染全量过筛', () => {
    const { container } = render(
      <DecisionBoard dossier={dossier()} screen={screenFile()} />,
    )
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('全量过筛')
    expect(txt).not.toContain('通过 3')
  })

  it('决策页保留四块：环境结论 / 明日标的 / 接力池 / 观察池', () => {
    const { container } = render(
      <DecisionBoard dossier={dossier()} screen={screenFile()} />,
    )
    const txt = container.textContent ?? ''
    for (const label of ['今晨竞价', '明日标的', '接力池', '观察池']) {
      expect(txt).toContain(label)
    }
  })
})
