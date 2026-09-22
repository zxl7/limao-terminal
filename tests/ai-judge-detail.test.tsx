import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AiJudgeDetail, type JudgeRow } from '@/features/analytics'
import type { DossierStock } from '@/shared/api'

/**
 * AI 台账「判断明细」—— AI 判断 × 尾盘财富密码接力卡真实字段的渲染契约。
 *
 * 用户 2026-09-22 抓包：「这里显示真实的尾盘财富密码卡接力卡数据，预测的开盘区间和代码，
 * 股票名称加股票代码**不能只显示股票代码**，然后再加上理由，**不要统一为 5%**。
 * 我们不是有区间吗？我们不仅有区间，还有量能，还有指标，还有各种 tag 都要显示在这里。」
 *
 * 故锁六点：① 名称+代码同时在；② 开盘**区间**（非 5%）；③ 量能；④ 维度指标；⑤ 标签；⑥ 理由。
 */

/** 接力卡单条（只填本测试断言用到的字段，其余用 cast 补齐） */
const stock = {
  code: '603230',
  name: '内蒙新华',
  theme: '出版',
  tags: ['先发', '空间'],
  boards: 4,
  style_tag: '龙头',
  is_20cm: false,
  cje_yi: 5.57,
  seal_amt: 0.86,
  hs: 10.63,
  main_flow_yi: -0.34,
  lt_mktcap: 52.43,
  theme_name: '大消费',
  core_theme: '传媒',
  theme_mates_cnt: 13,
  carry_cnt: 5,
  dim_panel: {
    环境: { score: 85, label: '进攻窗口' },
    板块: { score: 65, label: '中' },
    接力: { score: 100, label: '强候选' },
    _band: '条件触发', // ⛔ 内部字段（下划线开头）不得出现
  },
  expectation: {
    expected_range: [0.4, 2.4],
    super_gap_min: 3.4,
    auction_amount_min_yi: 0.39,
    auction_amount_super_yi: 0.67,
    auction_amount_range: [7, 12],
    auction_boom_yi: 0.84,
    boom_label: '🔺爆量高开',
    gap_strength_hint: '⬆正常高开预期',
    seal_form: '炸板回封',
    seal_zbc: 3,
    sector_tier: 'dragon',
    sector_sentiment: 'mid',
    confidence: 0.65,
    phase: '亢奋',
    expected_text: '[炸板回封×3]板块龙·板块中 ⬆正常高开预期 | 竞价涨幅 0.4%~2.4%',
    dragon_diagnosis: { composite: 4, identity: '真龙头(主升)' },
  },
} as unknown as DossierStock

const row: JudgeRow = {
  code: '603230',
  view: 'participate',
  reason: '医药是今天最强的方向（22只涨停）。\n⚠️风险：开太高就不划算。',
  stock,
  bucketLabel: '接力池',
}

/**
 * 带**今晨 09:25 终态**的行 —— 复刻 2026-09-22 的真实情形：
 * 昨日盘后预案判 `normal`（派生 view = watch），今晨竞价后实际判 `participate` 并买入。
 *
 * 用户原话：「数据对，所以我这边这个交易应该更新呀，不应该显示昨天的，
 * 应该显示今天 9:25 的这个。」
 */
const callRow: JudgeRow = {
  ...row,
  view: 'watch', // 昨日预案（判反的那份）
  bias: 'normal',
  call: {
    view: 'participate', // 今晨终态
    quotaRank: 1,
    gapPct: 2.9,
    zone: 'ok',
    amountYi: 0.64,
    needYi: 0.39,
    lineRank: 1,
    lineCoreName: '龙头股份',
    reason: '今天开在 +2.90%，没超 5% 上限、也没低于预期 → 买入',
  },
}

describe('AiJudgeDetail · 判断明细（AI 判断 × 接力卡）', () => {
  it('① 名称 + 代码同时出现（⛔ 不能只显示代码）', () => {
    const { container } = render(<AiJudgeDetail rows={[row]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('内蒙新华')
    expect(txt).toContain('603230')
  })

  it('② 显示接力卡给的**开盘区间**，且不是统一的 5%', () => {
    const { container } = render(<AiJudgeDetail rows={[row]} />)
    const txt = container.textContent ?? ''
    expect(txt, '缺少预期开盘区间').toContain('0.4~2.4%')
    expect(txt).toContain('超预期 ≥3.4%')
    // ⛔ 旧版「统一 5%」的口径不得再出现
    expect(txt).not.toContain('AI 自定高开上限')
  })

  it('③ 显示量能（竞价下限 + 昨量区间 + 爆量线）', () => {
    const { container } = render(<AiJudgeDetail rows={[row]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('≥0.39亿')
    expect(txt).toContain('昨量 7~12%')
    expect(txt).toContain('🔺爆量高开')
  })

  it('④ 显示维度指标（dim_panel）且**过滤内部下划线字段**', () => {
    const { container } = render(<AiJudgeDetail rows={[row]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('环境')
    expect(txt).toContain('85')
    expect(txt).toContain('强候选')
    expect(txt, '内部字段 _band 不应展示').not.toContain('条件触发')
  })

  it('⑤ 显示标签（tags）与形态地位', () => {
    const { container } = render(<AiJudgeDetail rows={[row]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('先发')
    expect(txt).toContain('空间')
    expect(txt).toContain('炸板回封')
    expect(txt).toContain('板块龙')
    expect(txt).toContain('真龙头(主升)')
  })

  it('⑥ 显示 AI 理由（含换行分段）', () => {
    const { container } = render(<AiJudgeDetail rows={[row]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('医药是今天最强的方向')
    expect(txt).toContain('开太高就不划算')
  })

  it('⑦ 接力卡缺失 → 只渲染 AI 判断那半，且不崩（不编造区间）', () => {
    const { container } = render(
      <AiJudgeDetail rows={[{ code: '000001', view: 'watch', reason: '仅 AI 判断' }]} />,
    )
    const txt = container.textContent ?? ''
    expect(txt).toContain('000001')
    expect(txt).toContain('观察')
    expect(txt).toContain('仅 AI 判断')
    expect(txt, '无卡数据不得凭空给区间').not.toContain('预期开盘')
  })

  it('⑧ 空列表 → 明确空态', () => {
    const { container } = render(<AiJudgeDetail rows={[]} />)
    expect(container.textContent).toContain('该日无 AI 判断记录')
  })

  it('⑨b bias 越权兜底留痕必须显示（否则等于没兜住）', () => {
    const { container } = render(
      <AiJudgeDetail
        rows={[
          {
            ...row,
            biasWarning: 'AI 判 normal，但机械证据显示是强龙（接力池第1·09:25秒板）→ 与接力池排名背离，请复核',
          },
        ]}
      />,
    )
    const txt = container.textContent ?? ''
    expect(txt).toContain('与接力池排名背离')
    expect(txt).toContain('接力池第1')
    // 无留痕时不得凭空渲染该段
    const clean = render(<AiJudgeDetail rows={[row]} />)
    expect(clean.container.textContent ?? '').not.toContain('背离')
  })

  it('⑨ 「参与」排在最前，其后观察、放弃（同档内保持原序）', () => {
    const mk = (code: string, view: string): JudgeRow => ({ code, view, reason: `理由-${code}` })
    const { container } = render(
      <AiJudgeDetail
        rows={[
          mk('600001', 'skip'),
          mk('600002', 'participate'),
          mk('600003', 'watch'),
          mk('600004', 'participate'),
        ]}
      />,
    )
    const order = [...container.querySelectorAll('article')].map(
      (el) =>
        ['600001', '600002', '600003', '600004'].find((c) => (el.textContent ?? '').includes(c)) ??
        '?',
    )
    // 参与(600002,600004 保原序) → 观察(600003) → 放弃(600001)
    expect(order).toEqual(['600002', '600004', '600003', '600001'])
  })

  it('⑩ 判断以**今晨 09:25 终态**为准（⛔ 不得显示昨日预案的档位）', () => {
    const { container } = render(<AiJudgeDetail rows={[callRow]} />)
    const txt = container.querySelector('article')?.textContent ?? ''
    expect(txt, '终态为参与 → 必须显示「参与」').toContain('参与')
    expect(txt, '⛔ 昨日预案派生 view=watch（观察）不得覆盖终态').not.toContain('观察')
    expect(txt).toContain('今晨 09:25 裁决')
    expect(txt).toContain('买入名额 #1')
    // 昨日预案作为**对照**保留（用户要看 AI 当初怎么想 vs 实际怎么做）
    expect(txt).toContain('昨预案 一般')
  })

  it('⑪ 今晨裁决段：竞价涨幅 / 区间落点 / 量能达标 / 方向内排名 / 裁决语', () => {
    const { container } = render(<AiJudgeDetail rows={[callRow]} />)
    const txt = container.querySelector('article')?.textContent ?? ''
    expect(txt).toContain('+2.90%')
    expect(txt).toContain('落区间')
    expect(txt).toContain('0.64/0.39亿')
    expect(txt).toContain('达标')
    expect(txt).toContain('方向内第 1')
    expect(txt).toContain('核心 龙头股份')
    expect(txt).toContain('没超 5% 上限')
  })

  it('⑫ 无终态 → 明说「今晨裁决未落盘」，且不渲染裁决段', () => {
    const { container } = render(<AiJudgeDetail rows={[row]} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('今晨裁决未落盘')
    expect(txt, '⛔ 无终态不得凭空长出一段裁决').not.toContain('裁决语')
  })

  it('⑬ 排序按**终态**：预案参与但今晨被否 → 排到后面', () => {
    const mk = (code: string, view: string, callView: string): JudgeRow => ({
      code,
      view,
      call: { view: callView },
    })
    const { container } = render(
      <AiJudgeDetail
        rows={[
          mk('600001', 'participate', 'skip'), // 预案说做，今晨没做
          mk('600002', 'skip', 'participate'), // 预案说不做，今晨做了
        ]}
      />,
    )
    const order = [...container.querySelectorAll('article')].map(
      (el) =>
        ['600001', '600002'].find((c) => (el.textContent ?? '').includes(c)) ?? '?',
    )
    expect(order, '排序口径必须是终态而非预案').toEqual(['600002', '600001'])
  })

  it('⑭ 竞价数据缺失 → 「—」，不得渲染成 0', () => {
    const { container } = render(
      <AiJudgeDetail
        rows={[{ ...callRow, call: { view: 'watch', gapPct: null, amountYi: null, needYi: null } }]}
      />,
    )
    const txt = container.querySelector('article')?.textContent ?? ''
    expect(txt).not.toContain('+0.00%')
    expect(txt).not.toContain('0.00/0.00亿')
    expect(txt).toContain('—')
  })
})
