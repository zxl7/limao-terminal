import { useState } from 'react'
import type { DossierStock } from '@/shared/api'
import { cn } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
import { Tag } from '@/features/analytics'
import { boardsText, fbtText, num, pctText, styleText, watchGroupText, yiText } from '../lib/format'

/**
 * 单票决策卡 —— **四维**（方向 / 身位 / 封板 / 晋级），一屏扫完。
 *
 * ## 2026-11-06 用户「不要那些看不懂的指标」
 *
 * 原来六维里有两维是**内部推导量**，不是盘面事实，删掉：
 *
 * | 删掉 | 为什么删 |
 * |---|---|
 * | **资金**（主力当日/5 日净流入、获利盘比例） | 主力净流入是算法估算值，同一只票不同软件能差出一倍；盘中盯盘根本不会看它 |
 * | **三问**（`passed/3` + 「卡在晋级率」） | 它只是把「晋级率/历史高度/地位」再算成 1 个分数，信息已在前两维里；`passed/3` 这种形态没人会拿来做决定 |
 * | **情绪校准**（`history_relay_prob`） | 同高度晋级率再乘一个情绪系数，多一层推导、少一层可信度 |
 * | **该档真买到胜率 + n=** | 样本常是 5~7 个，读起来像结论，其实是噪声 |
 *
 * ⛔ 留下的一律是**能在盘面上直接看到的事**：几板、差几板、多少家同题材、
 *    成交额、换手、封单占流通、首封时间、炸板次数、同高度晋级率。
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

  /**
   * 同高度晋级率（%）与样本数。
   * ⛔ 只取 `win_rate` 原值 —— `history_relay_prob`（情绪校准后）与三问总分都不上卡，
   *    那是**推导量**，多一层计算少一层可信度（2026-11-06 用户「不要看不懂的指标」）。
   */
  const rawWin = quiz?.items?.win_rate?.value
  const rawWinN = quiz?.items?.win_rate?.samples

  const sealRatio =
    s.seal_ratio_pct ??
    (s.seal_amt != null && s.lt_mktcap ? (Number(s.seal_amt) / Number(s.lt_mktcap)) * 100 : null)

  /** 封板质量细节：全是盘面上直接看得到的事实 */
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

  /**
   * 「明天开得高不高、买不买得到」——把 `p_over5` 翻成人话。
   * ⛔ 不显示 p25~p75、不显示该档胜率与 n=：前者是分位带，后者样本常 5~7 个，
   *    摆在卡上像结论，其实是噪声。
   */
  const buyHint =
    fc?.p_over5 == null ? '—' : fc.p_over5 >= 50 ? '多半买不进' : fc.p_over5 >= 30 ? '看运气' : '基本能买到'

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

      {/* ── 四维规格清单（无内边框 · 标签定宽对齐，可跨票纵向扫读）─────── */}
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
          label="身位"
          main={gapToMarket == null ? '—' : gapToMarket === 0 ? '最高板' : `差 ${gapToMarket} 板`}
          mainTone={gapToMarket == null ? 'sub' : gapToMarket === 0 ? 'up' : gapToMarket >= 2 ? 'down' : 'warn'}
          details={[
            `带动 ${s.carry_cnt ? `${s.carry_cnt} 家` : '—'}`,
            s.relay_stage === 'one_to_two' ? '1进2' : s.relay_stage === 'two_to_three' ? '2进3' : null,
            s.leader_role ?? null,
          ]
            .filter(Boolean)
            .join(' · ')}
          title={s.line_tier_why}
        />

        <SpecRow
          label="封板"
          main={s.cje_yi == null ? '—' : `${num(s.cje_yi, 2)} 亿`}
          mainTone={(s.cje_yi ?? 0) >= 5 ? 'up' : (s.cje_yi ?? 0) >= 3 ? 'warn' : 'down'}
          details={sealDetail}
          title={`封板形态 ${styleText(seal?.style)}；生效门槛 ${num(seal?.floor_used, 1)} 亿`}
        />

        <SpecRow
          label="晋级率"
          main={pctText(rawWin, 1)}
          mainTone={rawWin == null ? 'sub' : Number(rawWin) >= 40 ? 'up' : Number(rawWin) >= 30 ? 'warn' : 'down'}
          details={
            rawWin == null
              ? '无同高度样本'
              : `同高度 ${rawWinN ?? '—'} 次${
                  s.history_relay_stock_samples ? ` · 本股 ${s.history_relay_stock_samples} 次` : ''
                }`
          }
          title="同高度历史晋级率原值（⛔ 不含情绪加权、不折成三问总分）"
        />
      </div>

      {/* ── 明日推测（唯一强调条：这是最常被误读的一格）────────────── */}
      {fc && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm bg-hover px-2 py-1 text-11">
          <span className="text-sub">明早</span>
          <span className="num text-txt">
            预计开 <span className="font-semibold">{num(fc.gap_median, 1)}%</span>
          </span>
          <span className="num text-warn">
            {buyHint}
            {fc.p_over5 != null && <span className="text-sub">（高开过半概率 {num(fc.p_over5, 0)}%）</span>}
          </span>
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
              title={(fc.reasons ?? []).join('；')}
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
