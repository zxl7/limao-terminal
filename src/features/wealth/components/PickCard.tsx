import { useState } from 'react'
import type { DossierStock } from '@/shared/api'
import { cn } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
import { Tag } from '@/features/analytics'
import { boardsText, fbtText, num, pctText, ratioText, styleText, watchGroupText, yiText } from '../lib/format'

/**
 * 单票决策卡 —— 六个分析维度压在**一张卡**里。
 *
 * ## 为什么不是六个小方块（2026-11-04 用户「小卡太多了」）
 *
 * 第一版把六维各包一层 `border`，加上外层卡片共 **7 道边框**。视觉上变成
 * 「卡片里塞了 6 张卡」，边框抢戏、层级反而变浅；更要命的是每格宽度随内容浮动，
 * **同一维度在不同票上位置不一样**，横向扫比时眼睛每次都要重新定位。
 *
 * 现改为**规格清单（spec list）**：
 *   · 左列标签定宽对齐 → 六维在每张票上落在同一 x 位置，可纵向扫读
 *   · 主值一列右对齐、加粗 → 差异一眼可见
 *   · 细节压成同行小字 → 不丢维度，但不另起一层
 *   · 整卡只剩 1 道边框
 *
 * ⛔ 维度本身一个没减（用户：「维度没问题」）。
 * ⛔ 缺字段渲染 `—`，不回落成 0。
 */

/** 规格清单的一行：标签 | 主值 | 同行细节 */
function SpecRow({
  label,
  main,
  mainTone,
  details,
  title,
}: {
  label: string
  main: React.ReactNode
  mainTone?: 'up' | 'down' | 'warn' | 'rec' | 'sub'
  details?: string
  title?: string
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 leading-tight" title={title}>
      <span className="w-9 flex-none text-11 text-sub">{label}</span>
      <span
        className={cn(
          'num w-[72px] flex-none truncate text-right text-13 font-semibold',
          mainTone === 'up'
            ? 'text-up'
            : mainTone === 'down'
              ? 'text-down'
              : mainTone === 'warn'
                ? 'text-warn'
                : mainTone === 'rec'
                  ? 'text-rec'
                  : mainTone === 'sub'
                    ? 'text-sub'
                    : 'text-txt',
        )}
      >
        {main}
      </span>
      <span className="min-w-0 flex-1 truncate text-11 text-sub">{details || ''}</span>
    </div>
  )
}

export function PickCard({
  stock,
  bucket,
  rank,
  marketMaxBoards,
}: {
  stock: DossierStock
  bucket: 'relay' | 'watch'
  rank?: number
  marketMaxBoards?: number | null
}) {
  const [open, setOpen] = useState(false)
  const s = stock

  const exp = s.expectation
  const fc = s.forecast
  const quiz = s.promotion_quiz
  const seal = s.seal_gate

  /** 方向内身位：自身板数 vs 该方向最高板 */
  const lineTop = s.line_top ?? null
  const gapToLineTop = lineTop != null && s.boards ? lineTop - s.boards : null

  /** 距全市场最高板 */
  const gapToMarket =
    marketMaxBoards != null && s.boards ? Number(marketMaxBoards) - Number(s.boards) : null

  /** 情绪校准后的接力概率（0–1）与原始同高度晋级率（%） */
  const calibProb = s.history_relay_prob
  const rawWin = quiz?.items?.win_rate?.value
  const rawWinN = quiz?.items?.win_rate?.samples
  /**
   * 三问的键名 → 中文。
   * ⛔ 直接把 `blocked_by` 的键拼进文案会漏出 `win_rate` 这种内部字段名（实测已泄漏）。
   */
  const QUIZ_KEY_CN: Record<string, string> = {
    win_rate: '晋级率',
    promote: '历史高度',
    status: '地位',
  }
  const quizFail = (quiz?.blocked_by ?? []).map((k) => QUIZ_KEY_CN[k] ?? k).join('·')

  const sealRatio =
    s.seal_ratio_pct ??
    (s.seal_amt != null && s.lt_mktcap ? (Number(s.seal_amt) / Number(s.lt_mktcap)) * 100 : null)

  /** 量能与封板的细节合成一行 */
  const sealDetail = [
    s.hs != null ? `换手${pctText(s.hs, 1)}` : null,
    sealRatio != null ? `封单占流通${pctText(sealRatio, 1)}` : null,
    s.fbt ? `首封${fbtText(s.fbt)}` : null,
    s.zbc ? `炸${s.zbc}` : null,
    seal?.style ? styleText(seal.style) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const expectRange =
    Array.isArray(exp?.expected_range) && exp.expected_range.length === 2
      ? `${num(exp.expected_range[0], 1)}%~${num(exp.expected_range[1], 1)}%`
      : '—'

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-sm border border-line bg-card px-2.5 py-2">
      {/* ── 头：名称 · 板数 · 角色 · 方向内身位 ─────────────────────── */}
      <div className="flex items-baseline gap-1.5 min-w-0">
        {rank != null && <span className="num flex-none text-11 text-sub">{rank}</span>}
        <StockLink code={s.code} className="truncate text-13 font-semibold text-txt">
          {s.name}
        </StockLink>
        <span className="num flex-none text-11 text-sub">{s.code}</span>
        <span className="num flex-none rounded-sm border border-up px-1 text-11 font-semibold text-up">
          {boardsText(s.boards)}
        </span>
        {s.leader_role && <Tag tone={s.leader_role === '龙头' ? 'up' : 'rec'}>{s.leader_role}</Tag>}
        {s.is_20cm && <Tag tone="warn">20cm</Tag>}
        {/* 2026-11-04：昨日在池 + 今日晋级 → 优先占位。必须标出来，
            否则用户不知道为什么它排在前面（也看不出观察池是连续的）。 */}
        {s.carryover_promoted && <Tag tone="up">昨在池·今晋级</Tag>}
        {bucket === 'watch' && s.watch_group && <Tag>{watchGroupText(s.watch_group)}</Tag>}
        <span className="ml-auto flex flex-none items-baseline gap-1">
          <span className="text-11 text-sub">方向内</span>
          <span className="num text-11 text-txt">
            {s.dragon_rank != null ? `第 ${s.dragon_rank}` : '—'}
            {lineTop != null ? ` / 最高 ${lineTop} 板` : ''}
          </span>
        </span>
      </div>

      {/* ── 六维规格清单（无内边框 · 标签定宽对齐，可跨票纵向扫读）─────── */}
      <div className="flex flex-col gap-[3px]">
        <SpecRow
          label="方向"
          main={s.core_theme || s.theme || '—'}
          title={s.line_tier_why || s.core_theme_logic || s.core_theme || s.theme}
          details={[
            s.theme_mates_cnt ? `同题材 ${s.theme_mates_cnt} 家` : '独苗',
            gapToLineTop == null ? null : gapToLineTop === 0 ? '线内最高' : `距线顶差 ${gapToLineTop} 板`,
          ]
            .filter(Boolean)
            .join(' · ')}
        />

        <SpecRow
          label="股性"
          main={rawWin == null ? ratioText(calibProb, 1) : pctText(rawWin, 1)}
          mainTone={rawWin == null ? 'sub' : Number(rawWin) >= 40 ? 'up' : Number(rawWin) >= 30 ? 'warn' : 'down'}
          details={[
            `同高度样本 ${rawWinN ?? '—'}`,
            `情绪校准 ${ratioText(calibProb, 1)}`,
            s.history_relay_stock_samples ? `个股样本 ${s.history_relay_stock_samples}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          title={s.history_relay_note || '主值＝历史同高度晋级率；「情绪校准」为叠加情绪后的概率'}
        />

        <SpecRow
          label="量能"
          main={s.cje_yi == null ? '—' : `${num(s.cje_yi, 2)} 亿`}
          mainTone={(s.cje_yi ?? 0) >= 5 ? 'up' : (s.cje_yi ?? 0) >= 3 ? 'warn' : 'down'}
          details={sealDetail}
          title={`封板形态 ${styleText(seal?.style)}；生效门槛 ${num(seal?.floor_used, 1)} 亿`}
        />

        <SpecRow
          label="身位"
          main={gapToMarket == null ? '—' : gapToMarket === 0 ? '最高板' : `差 ${gapToMarket} 板`}
          mainTone={gapToMarket == null ? 'sub' : gapToMarket === 0 ? 'up' : gapToMarket >= 2 ? 'down' : 'warn'}
          details={[
            `带动 ${s.carry_cnt ? `${s.carry_cnt} 家` : '—'}`,
            s.ladder_has_complete ? `梯队完整 ${s.ladder_grade || ''}` : `梯队不完整 ${s.ladder_grade || ''}`,
            s.relay_stage === 'one_to_two' ? '1进2' : s.relay_stage === 'two_to_three' ? '2进3' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          title={s.line_tier_why}
        />

        <SpecRow
          label="资金"
          main={s.main_flow_yi == null ? '—' : `${num(s.main_flow_yi, 2)} 亿`}
          mainTone={(s.main_flow_yi ?? 0) > 0 ? 'up' : (s.main_flow_yi ?? 0) < 0 ? 'down' : 'sub'}
          details={[
            `5日 ${s.main_flow_5d_yi == null ? '—' : `${num(s.main_flow_5d_yi, 2)} 亿`}`,
            `获利盘 ${s.chip_profit_rate == null ? '—' : pctText(s.chip_profit_rate, 1)}`,
          ].join(' · ')}
          title="主力净流入：当日 / 近 5 日；获利盘＝当前价位获利筹码比例"
        />

        <SpecRow
          label="三问"
          main={quiz ? `${quiz.passed}/3` : '—'}
          mainTone={!quiz ? 'sub' : quiz.passed >= 3 ? 'up' : quiz.passed >= 2 ? 'warn' : 'down'}
          details={quiz ? [quiz.label, quizFail ? `卡在${quizFail}` : '全过'].filter(Boolean).join(' · ') : ''}
          title={quiz?.note || '晋级三问：晋级率 / 历史高度 / 地位'}
        />
      </div>

      {/* ── 明日推测（唯一强调条：这是最常被误读的一格）────────────── */}
      {fc && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm bg-hover px-2 py-1 text-11">
          <span className="text-sub">明早</span>
          <span className="num text-txt">
            中位 <span className="font-semibold">{num(fc.gap_median, 1)}%</span>
            <span className="text-sub">
              （{num(fc.gap_p25, 1)}~{num(fc.gap_p75, 1)}%）
            </span>
          </span>
          <span className="num text-warn">{num(fc.p_over5, 0)}% 买不到</span>
          <span className="num text-sub">
            这档买到胜率{' '}
            <span
              className={cn(
                'font-semibold',
                (fc.buy_win ?? 0) >= 45 ? 'text-up' : (fc.buy_win ?? 0) >= 35 ? 'text-warn' : 'text-down',
              )}
            >
              {pctText(fc.buy_win, 1)}
            </span>
            {fc.buy_n != null && <span className="text-sub">（n={fc.buy_n}）</span>}
          </span>
          {fc.group && (
            <span className="truncate text-sub" title={`同组 ${fc.group_n ?? '—'} 个历史样本`}>
              {fc.group}
            </span>
          )}
          {fc.verdict && (
            <span
              className={cn(
                'rounded-sm border px-1',
                fc.verdict === '可等'
                  ? 'border-up text-up'
                  : fc.verdict === '放弃'
                    ? 'border-down text-down'
                    : 'border-line text-sub',
              )}
            >
              {fc.verdict}
            </span>
          )}
        </div>
      )}

      {/* ── 买点（默认收起，避免每张卡都铺一遍方案）───────────────── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-none text-11 text-rec hover:underline"
        >
          {open ? '收起' : '买点与理由'}
        </button>
        <span className="min-w-0 truncate text-11 text-sub">
          区间 <span className="num text-txt">{expectRange}</span>
          <span> · 量能线 </span>
          <span className="num text-txt">{yiText(exp?.auction_amount_min_yi)}</span>
        </span>
        {bucket === 'watch' && <span className="ml-auto flex-none text-11 text-sub">{s.watch_group || '观察'}</span>}
      </div>

      {open && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
          {exp && (
            <div className="flex flex-col gap-0.5 text-11 leading-relaxed">
              <div>
                <span className="text-sub">计划 </span>
                <span className="text-txt">{exp.expected_text || '—'}</span>
              </div>
              <div>
                <span className="text-sub">超预期 </span>
                <span className="text-up">{exp.super_text || '—'}</span>
              </div>
              <div>
                <span className="text-sub">不及预期 </span>
                <span className="text-down">{exp.low_text || '—'}</span>
              </div>
            </div>
          )}
          {s.narrative && (
            <div className="flex flex-col gap-0.5 text-11 leading-relaxed text-txt">
              {s.narrative
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => (
                  <div key={line.slice(0, 24)} className={line.startsWith('⚠️') ? 'text-warn' : undefined}>
                    {line}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
