import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type {
  DecisionDossier,
  DossierStock,
  PoolCallFile,
  PoolLedger,
  ScreenFile,
} from '@/shared/api'
import {
  BuyPlan,
  DecisionBoard,
  EnvPanel,
  PickCard,
  PoolLedgerCard,
  ScreenFunnel,
  TodayVerdict,
} from '@/features/wealth'

/**
 * 财富密码「今日决策」契约。
 *
 * ## 2026-11-06 用户定的四个问题（本文件的断言全部服务于它）
 *
 * 「不要那些看不懂的指标，目的方便我看 **买什么、赚没赚、为什么买、为什么没买**」
 *
 * | 块 | 回答 | 锁什么 |
 * |---|---|---|
 * | `TodayVerdict` | 买了没有 / 为什么 | 空仓 ≠ 没票；原因用白话 hits，不是比率 |
 * | `PoolLedgerCard` | **赚没赚** | 口径＝竞价价买→收盘卖；买不进的**不计入** |
 * | `EnvPanel` | 昨天涨停今早还有人接吗 | 只留两个红开计数 |
 * | `BuyPlan` | 买什么 | 六列：标的/池别/板/方向/竞价区间/竞价额/结论 |
 * | `PickCard` | 为什么是它 | 四维：方向/身位/封板/晋级率 |
 *
 * ⛔ 反向断言同样重要：被砍掉的指标（情绪校准 / 三问 / 主力净流入 / 获利盘 /
 *    买不到概率 / 该档真买到 / 高标竞价量 / 量能达标 / 报价覆盖）**不得回到界面**。
 *    这些词出现在页面上就等于「又变回那堆看不懂的指标」。
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
    carry_cnt: 5,
    history_relay_prob: 0.0932,
    history_relay_samples: 1305,
    history_relay_stock_samples: 0,
    history_relay_note: '同高度1305次·个股0次·情绪校准-7.5pp',
    main_flow_yi: 3.95,
    main_flow_5d_yi: -0.19,
    chip_profit_rate: 80.56,
    seal_ratio_pct: 3.04,
    line_top: 2,
    dragon_rank: 2,
    line_tier_why: '这条线最高 2 板、池内有紫竹高科兜着',
    leader_role: '准龙头',
    relay_stage: 'one_to_two',
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
      indices: [{ name: '上证指数', pct: -0.95, price: 3603.5 }],
      avg_index_pct: -1.63,
      sentiment: '分歧',
      sentiment_score: -1,
      total_zt: 49,
      limit_down: { count: 16, names: ['世纪恒通'] },
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
    trade_date: '2026-11-06',
    stance: 'defend',
    quota: 1,
    views: {},
    meta: {
      caliber: 'test',
      stance: 'defend',
      quota: 1,
      effective_quota: 0,
      pool_size: 31,
      participate: [],
      call_at: '2026-11-06 09:26:43',
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
      defense: {
        enabled: true,
        env: {
          level: 'block',
          hits: [
            '昨天涨停的票今天还在板的只有 17.8%',
            '今天开盘昨天涨停的票只有 27% 红开',
            '其中连板的只有 33% 红开',
          ],
          hit_count: 3,
          notes: [],
        },
      },
      recheck: { enabled: true, state_full_required: true, observed: 30, state_entered: 3, participated: [] },
    },
    ...patch,
  } as PoolCallFile
}

function ledger(patch: Partial<PoolLedger> = {}): PoolLedger {
  return {
    date: '2026-11-06',
    generated_at: '2026-11-06 15:39:43',
    source: {},
    coverage: { pool: 3, quoted: 3, kline: 3, missing_quotes: [], missing_kline: [] },
    stance: 'defend',
    quota: 1,
    effective_quota: 0,
    summary: {
      pool: 3,
      tradable: 2,
      one_word: 0,
      sealed_auction: 1,
      sealed: 1,
      auction_buy_close_sell: { n: 2, avg: 3.2, med: 3.2, win: 50, max: 16, min: -9.6 },
      by_view: {
        watch: { n: 1, avg: 16, med: 16, win: 100, max: 16, min: 16 },
        skip: { n: 1, avg: -9.6, med: -9.6, win: 0, max: -9.6, min: -9.6 },
      },
      by_gap_band: {
        '−5~−2%': { n: 1, avg: 16, med: 16, win: 100, max: 16, min: 16 },
        '2~5%': { n: 1, avg: -9.6, med: -9.6, win: 0, max: -9.6, min: -9.6 },
      },
    },
    rows: [
      {
        code: '002388',
        name: '新亚制程',
        boards: 2,
        limit_up_pct: 10,
        gap_pct: -5.12,
        auction_price: 5.75,
        prev_close: 6.06,
        open: 5.75,
        high: 6.67,
        low: 5.71,
        close: 6.67,
        amount_yi: 0.2,
        need_yi: 0.24,
        theme: '机器人',
        view: 'watch',
        recheck_class: 'restricted',
        reason: '今早开 -5.12%、竞价 0.20 亿、量足 → 盘后没过接力准入，今天只看不买',
        chg_pct: 10.07,
        au_ret: 16,
        oc_ret: 16,
        one_word: false,
        sealed_auction: false,
        sealed: true,
        tradable: true,
        price_mismatch: 0,
      },
      {
        code: '000995',
        name: '皇台酒业',
        boards: 1,
        limit_up_pct: 10,
        gap_pct: 2.17,
        auction_price: 18,
        prev_close: 17.62,
        open: 18,
        high: 18,
        low: 16,
        close: 16.27,
        amount_yi: 0.5,
        need_yi: 0.4,
        theme: '大消费',
        view: 'skip',
        recheck_class: 'hard',
        reason: '今早开 +2.17% → 过闸但盘后预案＝回避',
        chg_pct: -7.7,
        au_ret: -9.6,
        oc_ret: -9.6,
        one_word: false,
        sealed_auction: false,
        sealed: false,
        tradable: true,
        price_mismatch: 0,
      },
      {
        code: '600766',
        name: '园城黄金',
        boards: 3,
        limit_up_pct: 10,
        gap_pct: 10,
        auction_price: 12,
        prev_close: 10.91,
        open: 12,
        high: 12,
        low: 12,
        close: 12,
        amount_yi: 1.2,
        need_yi: 0.5,
        theme: '黄金',
        view: 'watch',
        recheck_class: 'hard',
        reason: '竞价直接封死，买不进',
        chg_pct: 10,
        au_ret: null,
        oc_ret: null,
        one_word: false,
        sealed_auction: true,
        sealed: true,
        tradable: false,
        price_mismatch: 0,
      },
    ],
    ...patch,
  }
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
    },
    screened: [],
    ...patch,
  }
}

describe('TodayVerdict 今天买没买', () => {
  it('空仓时给出「为什么没买」的原话，而不是比率', () => {
    const { container } = render(<TodayVerdict dossier={dossier()} callFile={poolCall()} ledger={ledger()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('今天空仓')
    expect(txt).toContain('为什么没买')
    // 名额压到 0 是「环境不允」，与「没票」必须分开
    expect(txt).toContain('1 →')
    expect(txt).toContain('环境防守')
    // 白话 hits 原样展示
    expect(txt).toContain('只有 17.8%')
    expect(txt).toContain('只有 27% 红开')
    // 空仓也要给出机会成本（躲没躲对，看这一个数）
    expect(txt).toContain('机会成本')
    expect(txt).toContain('+3.20%')
  })

  it('未落账本仍优先显示冻结名称与代码', () => {
    const call = poolCall({ meta: { ...poolCall().meta, participate: ['002388'] }, views: { '002388': { ...poolCall().views['002388'], code: '002388', name: '冻结名称' } } as PoolCallFile['views'] })
    const { container } = render(<TodayVerdict callFile={call} />)
    expect(container.textContent).toContain('冻结名称')
    expect(container.textContent).toContain('002388')
    expect(container.textContent).toContain('非券商成交')
  })

  it('盘中名单展示同日行情，缺价不是零', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
    const call = poolCall({ trade_date: today, meta: { ...poolCall().meta, participate: ['002388', '000995'] } })
    const { container } = render(<PoolLedgerCard callFile={call} quotes={{ date: today, ts: `${today}T10:00:00+08:00`, call_available: true, missing: ['000995'], quotes: { '002388': { pct: -2.3, ts: `${today}T10:00:00+08:00`, source: '主快照' } } }} />)
    expect(container.textContent).toContain('-2.30%')
    expect(container.textContent).toContain('暂无报价')
    expect(container.textContent).toContain('快照')
    expect(container.textContent).toContain('未生成')
  })

  it('DecisionBoard 无档案也透传冻结名单和行情', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
    const call = poolCall({ trade_date: today, meta: { ...poolCall().meta, participate: ['002388'] } })
    const { container } = render(<DecisionBoard callFile={call} quotes={{ date: today, ts: `${today}T10:00:00+08:00`, call_available: true, missing: [], quotes: { '002388': { pct: 1.25, ts: `${today}T10:00:00+08:00`, source: 'market/latest' } } }} />)
    expect(container.textContent).toContain('+1.25%')
    expect(container.textContent).toContain('002388')
    expect(container.textContent).toContain('本期决策档案未生成')
  })

  it('竞价涨幅与异日行时间不得充当当前行情', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
    const call = poolCall({ trade_date: today, meta: { ...poolCall().meta, participate: ['002388', '000995'] } })
    const { container } = render(<PoolLedgerCard callFile={call} quotes={{ date: today, ts: `${today}T10:00:00+08:00`, call_available: true, missing: [], quotes: {
      '002388': { pct: 8.88, ts: `${today}T09:25:00+08:00`, source: 'market/latest' },
      '000995': { pct: 9.99, ts: '2020-01-01T15:00:00+08:00', source: 'market/latest' },
    } }} />)
    expect(container.textContent?.match(/暂无报价/g)).toHaveLength(2)
    expect(container.textContent).not.toContain('+8.88%')
    expect(container.textContent).not.toContain('+9.99%')
  })

  it('冻结名称优先于同日账本且不同日账本不渲染收益', () => {
    const call = poolCall({ meta: { ...poolCall().meta, participate: ['002388'] }, views: { '002388': { ...poolCall().views['002388'], name: '冻结名称' } } })
    const verdict = render(<TodayVerdict callFile={call} ledger={ledger()} />)
    expect(verdict.container.textContent).toContain('冻结名称')
    expect(verdict.container.textContent).not.toContain('新亚制程')
    const card = render(<PoolLedgerCard callFile={call} ledger={{ ...ledger(), date: '2020-01-01' }} />)
    expect(card.container.textContent).toContain('冻结名称')
    expect(card.container.textContent).toContain('今日收盘结算未生成')
    expect(card.container.textContent).not.toContain('+16.00%')
  })

  it('历史执行日不使用今日行情', () => {
    const call = poolCall({ trade_date: '2020-01-01', meta: { ...poolCall().meta, participate: ['002388'] } })
    const { container } = render(<PoolLedgerCard callFile={call} />)
    expect(container.textContent).toContain('历史执行日不套用今日行情')
    expect(container.textContent).toContain('暂无报价')
  })

  it('买到票时列出名称与当日结算', () => {
    const call = poolCall({ meta: { ...poolCall().meta, participate: ['002388'], effective_quota: 1 } })
    const { container } = render(<TodayVerdict dossier={dossier()} callFile={call} ledger={ledger()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('系统买入 1 只（非券商成交）')
    expect(txt).toContain('新亚制程')
    expect(txt).toContain('+16.00%')
  })

  it('裁决未生成时明说，不猜', () => {
    const { container } = render(<TodayVerdict dossier={dossier()} />)
    expect(container.textContent).toContain('今晨裁决未生成')
  })
})

describe('PoolLedgerCard 赚没赚', () => {
  it('口径写死「09:25 竞价价买 → 当日收盘卖」', () => {
    const { container } = render(<PoolLedgerCard ledger={ledger()} />)
    expect(container.textContent).toContain('09:25 竞价价买 → 当日收盘卖')
  })

  it('买不进的票不计入统计，且标注出来', () => {
    const { container } = render(<PoolLedgerCard ledger={ledger()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('不计入统计')
    expect(txt).toContain('封死')
    // 竞价封死那只：标注「封死」，且「竞价→收盘」列必须是 —（⛔ 不能算成 0% 或 +10%）。
    // 注意它「当日」列是真实的 +10.00%（确实封了涨停），⛔ 别把那一列当收益列。
    const row = [...container.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('园城黄金'))
    expect(row?.textContent).toContain('封死')
    // 列序锁（2026-11-06 新增 DEV / T+1 两列）：0 标的 · 1 板 · 2 方向 · 3 今开 · 4 DEV
    // · 5 裁决 · 6 竞价→收盘 · 7 当日 · 8 为什么（T+1 全空时按需隐藏）
    // ⛔ 这里同时断表头文字：以后再插列会直接红，而不是静默断言到错的列。
    const head = container.querySelector('thead')?.textContent ?? ''
    expect(head).toContain('DEV')
    // 2026-11-10：T+1 整列全空（次日未生成）→ 整列不渲染；空列既占宽度又误导「今天是 0」
    expect(head).not.toContain('T+1')
    // ⛔ 按表头定位列，不写死下标：2026-11-10 起 T+1 空列会按需隐藏，下标会漂。
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '')
    const col = (name: string) => heads.indexOf(name)
    expect(col('竞价→收盘')).toBeGreaterThanOrEqual(0)
    expect(row?.children[col('竞价→收盘')]?.textContent).toBe('—')
    expect(row?.children[col('当日')]?.textContent).toBe('+10.00%')
  })

  it('逐票带裁决与拒因 —— 「赚没赚」和「为什么」在同一行', () => {
    const { container } = render(<PoolLedgerCard ledger={ledger()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('新亚制程')
    expect(txt).toContain('只看')
    expect(txt).toContain('放弃')
    expect(txt).toContain('没过接力准入')
  })

  it('未生成时说清是「收盘未到」，不是 0 收益', () => {
    const { container } = render(<PoolLedgerCard />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('未生成')
    expect(txt).toContain('不是')
  })
})

describe('EnvPanel 今晨竞价（只留两个能读出结论的计数）', () => {
  it('两个红开计数 + 未达标原话', () => {
    const { container } = render(<EnvPanel callFile={poolCall()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('今晨竞价')
    expect(txt).toContain('26/48')
    expect(txt).toContain('10/15')
    expect(txt).toContain('未达标')
    expect(txt).toContain('没有同时达到红开与量能要求')
  })

  it('⛔ 比率型指标已删（高标竞价量 / 量能达标 / 报价覆盖）', () => {
    const { container } = render(<EnvPanel callFile={poolCall()} />)
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('高标竞价量')
    expect(txt).not.toContain('量能达标')
    expect(txt).not.toContain('报价覆盖')
  })

  it('出手结论不再重复（已归 TodayVerdict）', () => {
    const { container } = render(<EnvPanel callFile={poolCall()} />)
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('取向')
    expect(txt).not.toContain('实际买入')
  })

  it('缺数据降级为破折号，不抛错', () => {
    const { container } = render(<EnvPanel />)
    expect(container.textContent).toContain('—')
  })
})

describe('PickCard 四维（2026-11-06 砍掉推导量）', () => {
  it('四维标签齐全', () => {
    const { container } = render(<PickCard stock={stock()} bucket="watch" rank={1} marketMaxBoards={4} />)
    const txt = container.textContent ?? ''
    for (const label of ['方向', '身位', '封板', '晋级率']) {
      expect(txt).toContain(label)
    }
  })

  it('保留盘面事实：题材家数 / 身位差 / 成交额 / 换手封单 / 晋级率', () => {
    const { container } = render(<PickCard stock={stock()} bucket="watch" rank={1} marketMaxBoards={4} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('锂电池')
    expect(txt).toContain('同题材 7 家')
    expect(txt).toContain('第 2')
    expect(txt).toContain('7.25 亿')
    expect(txt).toContain('换手8.8%')
    expect(txt).toContain('38.9%')
    expect(txt).toContain('差 3 板')
  })

  it('⛔ 已删指标不得回到界面（资金/三问/情绪校准）', () => {
    const { container } = render(<PickCard stock={stock()} bucket="watch" rank={1} marketMaxBoards={4} />)
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('获利盘')
    expect(txt).not.toContain('主力')
    expect(txt).not.toContain('情绪校准')
    expect(txt).not.toContain('三问')
    expect(txt).not.toContain('2/3')
    expect(txt).not.toContain('win_rate')
  })

  it('明日推测翻成人话：预计开多少 + 买不买得到', () => {
    const { container } = render(<PickCard stock={stock()} bucket="watch" rank={1} marketMaxBoards={4} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('明早')
    expect(txt).toContain('预计开')
    expect(txt).toContain('9.8%')
    expect(txt).toContain('多半买不进') // p_over5=66
    expect(txt).toContain('放弃')
    // ⛔ 「该档真买到胜率 / n=」这种条件概率不再上卡
    expect(txt).not.toContain('该档买到胜率')
    expect(txt).not.toContain('n=')
  })

  it('⛔ 缺字段渲染「—」而不是 0', () => {
    const bare = stock({
      cje_yi: null as unknown as number,
      forecast: undefined,
      promotion_quiz: undefined,
      seal_ratio_pct: undefined,
      seal_amt: null as unknown as number,
    })
    const { container } = render(<PickCard stock={bare} bucket="watch" />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('—')
    expect(txt).toContain('封板—')
    expect(txt).not.toContain('0.00 亿')
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

describe('BuyPlan 明日买点（10 列 → 6 列）', () => {
  it('留下的是下单要用的：区间 / 竞价额 / 什么情况下买', () => {
    const { container } = render(<BuyPlan relay={[]} watch={[stock()]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('竞价落在')
    expect(txt).toContain('0.0% ~ 1.2%')
    expect(txt).toContain('竞价额要够')
    expect(txt).toContain('0.22 亿')
    // 2026-11-16 用户选 A：删掉「预案倾向」整列，只留「什么情况下买」（结论等 09:25 才定）
    expect(txt).toContain('什么情况下买')
    expect(txt).not.toContain('预案倾向')
    // 删列后「身位差 3 板」这类理由不再渲染（它原属被删的那一列）
    expect(txt).not.toContain('身位差 3 板')
  })

  it('⛔ 统计推导列不再出现（买不到 / 该档真买到 / 明早中位 / 超预期线）', () => {
    const { container } = render(<BuyPlan relay={[]} watch={[stock()]} />)
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('买不到')
    expect(txt).not.toContain('该档真买到')
    expect(txt).not.toContain('明早中位')
    expect(txt).not.toContain('超预期线')
  })
})

describe('ScreenFunnel 全量过筛（诊断层）', () => {
  it('三段计数与全量涨停数都在', () => {
    const { container } = render(<ScreenFunnel screen={screenFile()} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('48')
    expect(txt).toContain('通过')
    expect(txt).toContain('排除')
    expect(txt).toContain('45')
  })

  it('未生成时明说，不伪造数字', () => {
    const { container } = render(<ScreenFunnel />)
    expect(container.textContent).toContain('未生成')
  })
})

describe('DecisionBoard 版面顺序对回四个问题', () => {
  it('今日 / 明日 分两个 tab：今日 = 今天 → 账本 → 今晨竞价；明日 = 明日标的 → 接力池 → 观察', async () => {
    // 2026-11-16 用户：「今日策略和明日分隔开，新开一个明日 tab」。
    // 默认 tab 取决于当前小时（≥12 点默认「明日」），所以这里把两个 tab 都点一遍。
    const { container } = render(
      <DecisionBoard dossier={dossier()} callFile={poolCall()} ledger={ledger()} screen={screenFile()} />,
    )
    const clickTab = async (label: string) => {
      const btn = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label))
      expect(btn, `找不到 tab：${label}`).toBeTruthy()
      btn!.click()
      await new Promise((r) => setTimeout(r, 0))
    }

    await clickTab('今日策略')
    let txt = container.textContent ?? ''
    const today = ['今天', '今日账本', '今晨竞价']
    const ti = today.map((k) => txt.indexOf(k))
    for (const [i, v] of ti.entries()) expect(v, `缺块：${today[i]}`).toBeGreaterThanOrEqual(0)
    expect(ti).toEqual([...ti].sort((a, b) => a - b))
    // 明日内容不能在「今日」tab 里出现
    expect(txt).not.toContain('接力池')

    await clickTab('明日标的')
    txt = container.textContent ?? ''
    const tomorrow = ['明日标的', '接力池', '观察（明早竞价判）']
    const mi = tomorrow.map((k) => txt.indexOf(k))
    for (const [i, v] of mi.entries()) expect(v, `缺块：${tomorrow[i]}`).toBeGreaterThanOrEqual(0)
    expect(mi).toEqual([...mi].sort((a, b) => a - b))
  })

  it('接力池为空时明说「留空是允许的结论」，不说没数据', () => {
    const { container } = render(
      <DecisionBoard dossier={dossier()} callFile={poolCall()} ledger={ledger()} screen={screenFile()} />,
    )
    const txt = container.textContent ?? ''
    expect(txt).toContain('今日无可接力标的')
    expect(txt).not.toContain('暂无数据')
  })

  it('无档案时提示未生成', () => {
    const { container } = render(<DecisionBoard />)
    expect(container.textContent).toContain('未生成')
  })

  it('⛔ 全量过筛不得出现在决策页（调参诊断层）', () => {
    const { container } = render(
      <DecisionBoard dossier={dossier()} callFile={poolCall()} ledger={ledger()} screen={screenFile()} />,
    )
    const txt = container.textContent ?? ''
    expect(txt).not.toContain('全量过筛')
    expect(txt).not.toContain('通过 3')
  })
})
