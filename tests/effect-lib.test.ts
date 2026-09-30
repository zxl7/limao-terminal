import { describe, expect, it } from 'vitest'
import {
  boardsDistribution,
  boardsDistributionFromLadder,
  buildEffectAxes,
  buildEffectHistory,
  buildScenarios,
  projectNextDay,
  stageOfBoards,
  STAGE_MIN_SAMPLE,
} from '@/features/analytics'
import type { EmotionSummary5D, FeedbackMatrix, LadderGroup, PromoSummary, ZtPoolStock } from '@/shared/api'

/**
 * 赚钱效应 / 亏钱效应 纯计算内核的回归锁。
 *
 * 这些断言锁的是**口径**，不是实现细节 —— 口径错了页面会「看着很合理但在骗人」：
 *   · 两轴必须共用同一池子（否则「占比类」读数没有公共分母）
 *   · 缺料必须显示「—」，⛔ 不能退化成 0（「没数据」≠「数据是 0」）
 *   · T+1 期望 ⛔ 不得用小样本阶段冒充统计规律（沿用回测纪律 🔁-9）
 *   · 轴位是阶梯位置 ∈[-2,2]，⛔ 不是 0-100 的「效应分」
 */

/** 最小可用的反馈矩阵夹具（只填本模块读取的字段） */
function fb(patch: Partial<FeedbackMatrix> = {}): FeedbackMatrix {
  return {
    generated_ts: '2026-09-23T10:06:43',
    date: '2026-09-23',
    prev_date: '2026-09-22',
    prev_zt_count: 100,
    now_zt_count: 60,
    promote_count: 20,
    promote_rate: 20,
    lb_prev_count: 30,
    lb_promote_count: 10,
    lb_promote_rate: 33.3,
    avg_pct: 1.2,
    quote_fail_count: 0,
    up_rate: 62,
    strong_count: 18,
    nuke_count: 2,
    break_count: 0,
    market_missing: false,
    nuke_list: [],
    big_loss_count: 6,
    broken_rate: 0.2,
    prev_max_boards: 5,
    now_max_boards: 4,
    max_trend: -1,
    zt_expand: -0.4,
    idx_avg: -0.3,
    market_amount_yi: 18000,
    breadth: { up: 2600, down: 2400 },
    promote_list: [],
    promote_codes: [],
    quotes: {},
    sentiment_score: 5,
    sentiment_label: '分歧',
    regulatory_pressure: 0,
    trend: { promote_downtrend: false, avg_pct_weak: false, defense_level: 0, history: [] },
    ...patch,
  } as FeedbackMatrix
}

describe('双轴：共用同一池子 + 按涨跌分组', () => {
  it('① 两轴分母同为昨涨停池 —— 分组守恒（强势+大面+核按钮 ≤ 池子）', () => {
    const f = fb({ prev_zt_count: 64, strong_count: 17, big_loss_count: 9, nuke_count: 10 })
    const a = buildEffectAxes(f)
    expect(a.basis.prevZtCount).toBe(64)
    // 三组各自是池子的子集 —— 相加不得超出池子（越界说明分母用错）
    expect(f.strong_count + f.big_loss_count + f.nuke_count).toBeLessThanOrEqual(64)
    // 两轴读数里必须出现「/64」这种同分母写法
    const all = [...a.gain.readings, ...a.loss.readings].map((r) => r.value)
    expect(all.filter((v) => v.endsWith('/64')).length).toBeGreaterThanOrEqual(3)
  })

  it('② 阈值映射照抄系统既有档（up_rate 边界 · 归一化到 ±2）', () => {
    const lvl = (v: number) =>
      buildEffectAxes(fb({ up_rate: v })).gain.readings.find((r) => r.key === 'up_rate')?.level
    // 系统 addend ≥70→+1.5 / ≥60→+1.0 / ≥50→+0.5 / 45~50→**0** / 35~45→−0.5 / <35→−1.0
    // 本页线性归一化到 ±2（×2/1.5），档序与阈值完全一致
    expect(lvl(75)).toBe(2)
    expect(lvl(70)).toBe(2)
    expect(lvl(65)).toBe(1.33)
    expect(lvl(55)).toBe(0.67)
    expect(lvl(47)).toBe(0) // ⚠️ 45~50 这一段系统给 0 —— ⛔ 不得误判成负分
    expect(lvl(40)).toBe(-0.67)
    expect(lvl(30)).toBe(-1.33)
  })

  it('③ 核按钮档位（≥5 / ≥3 / ≥1 / 0）', () => {
    const lvl = (n: number) =>
      buildEffectAxes(fb({ nuke_count: n })).loss.readings.find((r) => r.key === 'nuke')?.level
    expect(lvl(5)).toBe(2)
    expect(lvl(3)).toBe(1)
    expect(lvl(1)).toBe(0.5)
    expect(lvl(0)).toBe(-1)
  })

  it('④ ⛔ 缺料显示「—」且不计入轴位（绝不退化成 0）', () => {
    const a = buildEffectAxes(fb({ avg_pct: null as unknown as number }))
    const r = a.gain.readings.find((x) => x.key === 'avg_pct')!
    expect(r.value).toBe('—')
    expect(r.raw).toBeNull()
    expect(r.level).toBeNull()
    expect(a.gain.missing).toBe(1)
    // 其余读数仍在 → 轴位照常算出（不是整轴塌成 0）
    expect(a.gain.level).not.toBeNull()
  })

  it('⑤ 轴位是阶梯位置（∈[-2,2]），⛔ 不是 0-100 分', () => {
    const a = buildEffectAxes(fb())
    for (const axis of [a.gain, a.loss]) {
      expect(axis.level).not.toBeNull()
      expect(Math.abs(axis.level as number)).toBeLessThanOrEqual(2)
      for (const r of axis.readings) {
        if (r.level != null) expect(Math.abs(r.level)).toBeLessThanOrEqual(2)
      }
    }
  })

  it('⑥ 两轴词表同一套（描述「本轴强度」）—— 亏钱强 ≠ 亏钱弱', () => {
    const strongLoss = buildEffectAxes(
      fb({ nuke_count: 9, break_count: 4, broken_rate: 0.5, big_loss_count: 20, idx_avg: -2.0 }),
    )
    const weakLoss = buildEffectAxes(
      fb({ nuke_count: 0, break_count: 0, broken_rate: 0.05, big_loss_count: 0, idx_avg: 1.8 }),
    )
    // 亏到尽头 → 顶部两档；干净无亏 → 底部两档（⛔ 「零核按钮」不得再读成中性）
    expect(['强', '偏强']).toContain(strongLoss.loss.word)
    expect(['弱', '偏弱']).toContain(weakLoss.loss.word)
    // 同一天的两轴可以**同时**偏高或偏低（结构性行情）—— 这里锁的是「同一池子的两侧」
    expect(strongLoss.loss.level).toBeGreaterThan(weakLoss.loss.level as number)
  })

  it('⑦ 矩阵不可用 → 结构完整 + 明确 caveat（⛔ 不崩）', () => {
    const a = buildEffectAxes(null)
    expect(a.gain.readings).toEqual([])
    expect(a.gain.level).toBeNull()
    expect(a.caveats.length).toBeGreaterThan(0)
  })

  it('⑧ 量能/广度缺失 → caveat 如实列出（不加分不隐瞒）', () => {
    const a = buildEffectAxes(fb({ market_missing: true, quote_fail_count: 3 }))
    expect(a.caveats.join(' ')).toContain('量能')
    expect(a.caveats.join(' ')).toContain('3 只行情缺失')
  })
})

describe('历史窗口：按日期对齐，缺口留空', () => {
  const summary = {
    days: [
      { date: '2026-09-17', sentiment_score: 1, zt_count: null },
      { date: '2026-09-18', sentiment_score: 8, zt_count: null },
      { date: '2026-09-22', sentiment_score: 6, zt_count: 64 },
    ],
    trajectory: {
      sentiment_seq: [1, 8, 6],
      promote_seq: [10.1, 25.5, 20.6],
      nuke_seq: [9, 1, 3],
      zt_seq: [null, null, 64],
      sentiment_ma3: [1, 4.5, 5],
      ma3_window: 3,
      turn_signal: { dir: 'flat', label: '方向未明', ma3_last: 5, sentiment_seq_last3: [1, 8, 6], divergence: null },
    },
  } as unknown as EmotionSummary5D

  it('① 按 date 对齐 trend.history 与 summary.days', () => {
    const f = fb({
      trend: {
        promote_downtrend: false,
        avg_pct_weak: false,
        defense_level: 0,
        promotion_gate_10d: 25,
        history: [
          { date: '2026-09-17', pr: 10.1, ap: 0.22 },
          { date: '2026-09-18', pr: 25.5, ap: 2.78 },
          { date: '2026-09-22', pr: 20.6, ap: 2.76 },
        ],
      },
    })
    const pts = buildEffectHistory(f, summary)
    expect(pts.map((p) => p.date)).toEqual(['2026-09-17', '2026-09-18', '2026-09-22'])
    expect(pts[2].nuke).toBe(3)
    expect(pts[2].sentiment).toBe(6)
    expect(pts[2].ztCount).toBe(64)
  })

  it('② trend.history 为空 → 返回空数组（页面走空态，⛔ 不编造）', () => {
    expect(buildEffectHistory(fb(), summary)).toEqual([])
  })

  it('③ 某日 pr/ap 缺失 → 该点轴位 null，⛔ 不是 0', () => {
    const f = fb({
      trend: {
        promote_downtrend: false,
        avg_pct_weak: false,
        defense_level: 0,
        promotion_gate_10d: 25,
        history: [{ date: '2026-09-17', pr: null as unknown as number, ap: null as unknown as number }],
      },
    })
    const pts = buildEffectHistory(f, summary)
    expect(pts[0].gainLevel).toBeNull()
    expect(pts[0].pr).toBeNull()
  })
})

describe('T+1 条件期望：小样本只呈现不裁决', () => {
  const promo = {
    filter: { stage: null, board: null, start: null, end: null },
    date_range: '最早~最新',
    rows: [
      { stage: '1to2', n: 695, ok: 107, fail: 588, succ_rate: 15.4, n_prem: 85, prem_open_avg: 3, prem_open_med: 1.79, prem_close_avg: 2.8, prem_close_med: 3.09, fail_open_avg: -0.71, fail_open_med: -0.44 },
      { stage: '2to3', n: 99, ok: 34, fail: 65, succ_rate: 34.3, n_prem: 30, prem_open_avg: 4.37, prem_open_med: 5.59, prem_close_avg: 3.7, prem_close_med: 4.53, fail_open_avg: -1.66, fail_open_med: -1.57 },
      { stage: '3to4', n: 31, ok: 16, fail: 15, succ_rate: 51.6, n_prem: 12, prem_open_avg: 3.65, prem_open_med: 3.46, prem_close_avg: 5.9, prem_close_med: 9.97, fail_open_avg: -3.36, fail_open_med: -3.68 },
      { stage: '4to5+', n: 29, ok: 15, fail: 14, succ_rate: 51.7, n_prem: 10, prem_open_avg: 4.03, prem_open_med: 4.11, prem_close_avg: 6.33, prem_close_med: 8.66, fail_open_avg: -2.77, fail_open_med: -2 },
    ],
    ts: '2026-09-18T17:19:55',
  } as PromoSummary

  it('① 阶段映射：今日 N 板 → 明日冲击 N+1 板', () => {
    expect(stageOfBoards(1)).toBe('1to2')
    expect(stageOfBoards(2)).toBe('2to3')
    expect(stageOfBoards(3)).toBe('3to4')
    expect(stageOfBoards(6)).toBe('4to5+')
  })

  it('② ⛔ 样本 <30 的阶段从期望里剔除（只呈现）', () => {
    const dist = new Map([['1to2', 40], ['4to5+', 5]])
    const p = projectNextDay(dist, promo)
    const hi = p.stages.find((s) => s.stage === '4to5+')!
    expect(hi.n).toBe(29)
    expect(hi.decisive).toBe(false)
    expect(STAGE_MIN_SAMPLE).toBe(30)
    // 期望只累加 1to2：40 × 0.154 = 6.16 → 6.2
    expect(p.expPromoteCount).toBeCloseTo(6.2, 1)
    expect(p.caveats.join(' ')).toContain('5 只')
  })

  it('③ 期望值按 家数×成功率 加权（⛔ 不是简单平均）', () => {
    const dist = new Map([['1to2', 100], ['2to3', 100]])
    const p = projectNextDay(dist, promo)
    // 100×0.154 + 100×0.343 = 15.4 + 34.3 = 49.7
    expect(p.expPromoteCount).toBeCloseTo(49.7, 1)
    // 赚钱侧 = (15.4×1.79 + 34.3×5.59) / 49.7 = (27.57+191.74)/49.7 = 4.41
    expect(p.gainPremMed).toBeCloseTo(4.41, 1)
    // 亏钱侧 = (84.6×(−0.44) + 65.7×(−1.57)) / 150.3 = (−37.2−103.1)/150.3 = −0.93
    expect(p.lossFailMed).toBeCloseTo(-0.93, 1)
  })

  it('④ 当前快照没有有效梯队 → 空态 + caveat（⛔ 不编造分布）', () => {
    const p = projectNextDay(null, promo)
    expect(p.expPromoteCount).toBeNull()
    expect(p.poolTotal).toBe(0)
    expect(p.caveats.join(' ')).toContain('当前快照')
  })

  it('⑤ 基线缺失 → 仍给出池子总数，期望为 null（⛔ 不伪造成功率）', () => {
    const p = projectNextDay(new Map([['1to2', 30]]), null)
    expect(p.poolTotal).toBe(30)
    expect(p.expPromoteCount).toBeNull()
    expect(p.caveats.join(' ')).toContain('晋级基线')
  })

  it('⑥ 历史无样本的阶段如实列出（uncovered）', () => {
    const p = projectNextDay(new Map([['9to10', 2]]), promo)
    expect(p.uncovered.join(' ')).toContain('9to10')
  })

  it('⑦ boardsDistribution：无有效板数 → null', () => {
    expect(boardsDistribution(null)).toBeNull()
    expect(boardsDistribution([])).toBeNull()
    const bad = [{ code: '600000', boards: 0 }] as unknown as ZtPoolStock[]
    expect(boardsDistribution(bad)).toBeNull()
    const ok = [
      { code: '600001', boards: 1 },
      { code: '600002', boards: 1 },
      { code: '600003', boards: 3 },
    ] as unknown as ZtPoolStock[]
    const d = boardsDistribution(ok)!
    expect(d.get('1to2')).toBe(2)
    expect(d.get('3to4')).toBe(1)
  })

  it('⑧ 决策时点快照只按板数和家数归并，不读取逐票行情', () => {
    expect(boardsDistributionFromLadder(null)).toBeNull()
    expect(boardsDistributionFromLadder([])).toBeNull()
    const dist = boardsDistributionFromLadder([
      { boards: 1, stocks: ['a', 'b'] },
      { boards: 3, stocks: ['c'] },
      { boards: 4, stocks: ['d', 'e', 'f'] },
    ] as LadderGroup[])!
    expect(dist.get('1to2')).toBe(2)
    expect(dist.get('3to4')).toBe(1)
    expect(dist.get('4to5+')).toBe(3)
  })
})

describe('三情景：条件判定', () => {
  const summaryFlat = {
    trajectory: {
      sentiment_seq: [1, 8, 6],
      nuke_seq: [9, 3, 1],
      turn_signal: { dir: 'flat', label: '方向未明', ma3_last: 5, sentiment_seq_last3: [1, 8, 6], divergence: null },
    },
  } as unknown as EmotionSummary5D

  it('① 恶化三条件全成立 → live = true', () => {
    const s = buildScenarios(fb({ nuke_count: 8, broken_rate: 0.5, zt_expand: -0.5 }), summaryFlat)
    const w = s.find((x) => x.key === 'worsen')!
    expect(w.met).toEqual({ hit: 3, total: 3 })
    expect(w.live).toBe(true)
  })

  it('② 只成立 2/3 → live = false（⛔ 不半途宣布情景成立）', () => {
    const s = buildScenarios(fb({ nuke_count: 8, broken_rate: 0.5, zt_expand: 0.2 }), summaryFlat)
    const w = s.find((x) => x.key === 'worsen')!
    expect(w.met).toEqual({ hit: 2, total: 3 })
    expect(w.live).toBe(false)
  })

  it('③ 修复情景需「拐点为 repair」且「核按钮连续 2 日下降」', () => {
    const repair = {
      trajectory: {
        nuke_seq: [9, 5, 2],
        turn_signal: { dir: 'repair', label: '修复', ma3_last: 5, sentiment_seq_last3: [1, 2, 3], divergence: null },
      },
    } as unknown as EmotionSummary5D
    const r = buildScenarios(fb(), repair).find((x) => x.key === 'repair')!
    expect(r.live).toBe(true)
    // 拐点不是 repair → 不成立
    const r2 = buildScenarios(fb(), summaryFlat).find((x) => x.key === 'repair')!
    expect(r2.live).toBe(false)
  })

  it('④ 三情景恒返回且顺序固定（延续/修复/恶化 · 页面纵向排列）', () => {
    const s = buildScenarios(null, null)
    expect(s.map((x) => x.key)).toEqual(['continue', 'repair', 'worsen'])
    expect(s.every((x) => x.conditions.length > 0)).toBe(true)
  })
})
