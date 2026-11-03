import { useState, type ReactNode } from 'react'
import type { DossierStock } from '@/shared/api'
import { cn, biasText, cardPhaseText, sectorSentimentText, sectorTierText, viewText } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
// ⚠️ `tone` 别名导入：本文件内 `Chip` 组件有一个同名的 `tone` prop，
//    直接导入会被 lint 判为「遮蔽外层变量」（实测 1 warning，门禁要求 0）。
import { n1, n2, pct, rangePct, tone as valueTone } from '../lib/format'

/**
 * AI 台账「判断明细」—— **AI 判断 × 尾盘财富密码接力卡**的联合明细（2026-09-22 用户定）。
 *
 * ## 为什么要有它
 *
 * 旧版明细只有「代码 / 判断 / AI 自定高开上限(恒 5%) / 理由」四列，用户抓包：
 * 「这里显示真实的尾盘财富密码卡接力卡数据，预测的开盘区间和代码，股票名称加股票代码
 *   不能只显示股票代码，然后再加上理由，**不要统一为 5%**。我们不是有区间吗？
 *   我们不仅有区间，还有量能，还有指标，还有各种 tag 都要显示在这里。」
 *
 * 故本组件把**接力卡真实字段**铺开：名称+代码 / 预期开盘**区间**（`expected_range`，非 5%）/
 * 竞价量能（`auction_amount_min_yi` + 昨量区间 + 爆量线）/ 封板形态与板块地位 /
 * 逐维打分（`dim_panel`）/ 量价指标（成交额·封单·换手·主力）/ 标签（`tags`）/
 * AI 理由 + 脚本计划原文（`expected_text`）。
 *
 * ⛔ 空值一律走 `format.ts` 的 `n1/n2/pct/rangePct` → 渲染成「—」，**绝不显示 0 或空白**。
 */

/**
 * 今晨 09:25 池内裁决终态（`pool_call`）。
 *
 * ⚠️ 与 `AiViewItem` 的区别：`bias`（昨日盘后预案）是**输入**，
 * 本结构是**竞价后的定音**（实际做没做 + 买入名额序 + 当时竞价数据）。
 */
export interface JudgeCall {
  leaderRole?: '龙头' | '准龙头' | '跟风' | null
  leaderEvidenceNote?: string
  statusRank?: number
  /** 终态：participate / watch / skip */
  view: string
  /** 买入名额序（1 起；仅成交票有） */
  quotaRank?: number | null
  /** 今晨竞价涨幅 % */
  gapPct?: number | null
  /** ok 落区间 / above 超上限 / below 低于下沿 / unknown */
  zone?: string
  /** 今晨竞价成交额（亿） */
  amountYi?: number | null
  /** 量能线（亿） */
  needYi?: number | null
  /** 在自身方向内的排名（1 = 龙一） */
  lineRank?: number | null
  /** 同方向核心票名称（判断是否跟风用） */
  lineCoreName?: string | null
  /** 机械强龙事实是否参与了09:25名额排序 */
  mechanicalLeader?: boolean
  /** 机械强龙依据（接力池第1 / 09:30秒板 / 带动） */
  mechanicalLeaderNote?: string | null
  /** 裁决理由（短句） */
  reason?: string
}

export interface JudgeRow {
  code: string
  /**
   * AI 判断：participate / watch / skip。
   *
   * ⚠️ 这是**昨日盘后预案**的同义派生（`ai_view` 的 `view`）。展示用的「判断」
   * 应取 `call.view`（今晨 09:25 终态）；本字段在无终态时兜底。
   */
  view?: string
  /** AI 盘后理由（长文，含换行 · 前一交易日 15:30 写） */
  reason?: string
  /** 昨日盘后预案档：focus 重点看 / normal 一般 / avoid 回避 */
  bias?: string
  /** 今晨 09:25 裁决终态 —— 有则以它为准（用户 2026-09-22「应该显示今天 9:25 的」） */
  call?: JudgeCall
  /**
   * ⛔ 硬否决兜底留痕：非空 = AI 的 `avoid` 无四类硬伤，已被降级。
   * `normal` 与机械强龙的差异已融入09:25排序，保留事实留痕但不显示为告警。
   */
  biasWarning?: string
  /** 接力卡里的该标的（接力池 / 观察池）—— 缺失时只渲染 AI 判断那一半 */
  stock?: DossierStock
  /** 池别文案（接力池 / 观察池） */
  bucketLabel?: string
}

/** 三值判断的**配色**（文字走 `@/shared/lib` 的 `viewText` —— 白话层单一源，⛔ 不在此回落原 token） */
const VIEW_META: Record<string, { label: string; cls: string }> = {
  participate: { label: '参与', cls: 'text-up border-up' },
  watch: { label: '观察', cls: 'text-rec border-rec' },
  skip: { label: '放弃', cls: 'text-sub border-line' },
}

/** 竞价落点 → 中文标签（A 股语义：涨=红 / 跌=绿） */
const ZONE_META: Record<string, { label: string; cls: string }> = {
  ok: { label: '落区间', cls: 'text-up' },
  above: { label: '超上限', cls: 'text-up' },
  below: { label: '低于下沿', cls: 'text-down' },
  unknown: { label: '无量价', cls: 'text-sub' },
}

/** 板块地位 / 情绪 / 高开强度 的中文映射 —— 见 `@/shared/lib` 的 `plain.ts`（白话层单一源）。
 *  ⛔ 本文件不再自带映射表：各自一套必然与别处漂移，且缺省回落容易变成「直出原 token」。 */

/** 标签小药丸 */
function Chip({ children, tone }: { children: ReactNode; tone?: 'rec' | 'sub' }) {
  return (
    <span
      className={cn(
        'inline-block text-11 px-1 rounded-sm border whitespace-nowrap',
        tone === 'rec' ? 'text-rec border-rec/40 bg-rec-soft' : 'text-sub border-line',
      )}
    >
      {children}
    </span>
  )
}

/** 一行「标签 + 内容」——标签固定宽，内容可折行 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-12 leading-relaxed min-w-0">
      <span className="text-sub flex-none w-[52px] text-right">{label}</span>
      <span className="min-w-0 break-all">{children}</span>
    </div>
  )
}

/** `dim_panel` 是 `{ 环境: {score,label,note}, ... }`，值类型未知 → 逐项守卫 */
function dimEntries(v: unknown): Array<{ key: string; label: string; score: number | null }> {
  if (!v || typeof v !== 'object') return []
  const out: Array<{ key: string; label: string; score: number | null }> = []
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith('_')) continue // `_mid_carry` / `_band` 等内部字段不展示
    if (!val || typeof val !== 'object') continue
    const o = val as { score?: unknown; label?: unknown }
    out.push({
      key: k,
      label: typeof o.label === 'string' && o.label ? o.label : '—',
      score: typeof o.score === 'number' ? o.score : null,
    })
  }
  return out
}

/** 判断档位先行；参与、观察、放弃与待裁决分别成类。 */
const VIEW_ORDER: Record<string, number> = { participate: 0, watch: 1, skip: 2, pending: 3 }

/**
 * 展示口径的「判断」= **今晨 09:25 终态优先**，无终态才回落昨日盘后预案。
 *
 * 2026-09-22 用户抓包：「数据对，所以我这边这个交易应该更新呀，不应该显示昨天的，
 * 应该显示今天 9:25 的这个」—— 旧版直接渲染 `ai_view.view`（＝昨日 15:30 写的预案），
 * 于是真龙被判「一般」而跟风票被判「重点看」，与今晨实际成交完全相反。
 */
const viewOf = (r: JudgeRow) => r.call?.view ?? r.view ?? 'pending'

/** AI 裁决不变；每个裁决类别内严格按冻结排序评分从高到低展示。 */
export function compareJudgeRows(a: JudgeRow, b: JudgeRow): number {
  const viewOrder = (VIEW_ORDER[viewOf(a)] ?? 9) - (VIEW_ORDER[viewOf(b)] ?? 9)
  if (viewOrder) return viewOrder
  const as = a.stock
  const bs = b.stock
  const scoreOrder = (bs?.score ?? -Infinity) - (as?.score ?? -Infinity)
  if (scoreOrder) return scoreOrder
  const leaderOrder =
    Number(bs?.is_sector_dragon) - Number(as?.is_sector_dragon)
    || (bs?.boards ?? 0) - (as?.boards ?? 0)
    || (bs?.carry_cnt ?? 0) - (as?.carry_cnt ?? 0)
    || (bs?.theme_mates_cnt ?? 0) - (as?.theme_mates_cnt ?? 0)
    || (bs?.lead_score ?? 0) - (as?.lead_score ?? 0)
  if (leaderOrder) return leaderOrder
  return (a.call?.statusRank ?? a.stock?.status_rank ?? Infinity)
    - (b.call?.statusRank ?? b.stock?.status_rank ?? Infinity)
}

/** 历史记录的 normal/机械强龙提示在09:25融合排序落地前生成；不改账本，仅在展示层降噪。 */
function actionableWarning(warning?: string): string | undefined {
  if (!warning) return undefined
  return warning.includes('机械证据显示是强龙') && warning.includes('与接力池排名背离')
    ? undefined
    : warning
}

export function AiJudgeDetail({ rows, decisionDate }: { rows: JudgeRow[]; decisionDate?: string }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const needle = search.trim().toLowerCase()
  if (!rows.length) {
    return <div className="text-sub text-12 py-2">该日无 AI 判断记录</div>
  }
  const ordered = [...rows].sort(compareJudgeRows)
  const visible = ordered.filter((r) =>
    (filter === 'all' || (r.call ? r.call.view : 'pending') === filter) &&
    (!needle || `${r.code} ${r.stock?.name ?? ''} ${r.stock?.theme_name ?? ''}`.toLowerCase().includes(needle)),
  )
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <input aria-label="查找标的" placeholder="名称 / 代码 / 题材" value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 w-48 rounded-sm border border-line bg-card px-2 py-1.5 text-12 text-txt focus-visible:outline-2 focus-visible:outline-rec" />
        <select aria-label="筛选裁决" value={filter} onChange={(event) => setFilter(event.target.value)}
          className="rounded-sm border border-line bg-card px-2 py-1.5 text-12 text-txt">
          <option value="all">全部裁决</option><option value="participate">参与</option>
          <option value="watch">观察</option><option value="skip">放弃</option><option value="pending">待裁决</option>
        </select>
        <span className="ml-auto text-11 text-sub num" aria-live="polite">{visible.length} / {rows.length} 只</span>
      </div>
      {!visible.length && <div className="py-8 text-center text-sub text-12">没有匹配的标的</div>}
      {visible.map((r) => {
        const s = r.stock
        const e = s?.expectation
        const c = r.call
        const finalView = viewOf(r)
        const m = {
          label: viewText(finalView),
          cls: VIEW_META[finalView]?.cls ?? 'text-sub border-line',
        }
        const dims = dimEntries(s?.dim_panel)
        const tags = s?.tags ?? []
        const zone = c?.zone ? ZONE_META[c.zone] : undefined
        const volOk = c?.amountYi != null && c?.needYi != null && c.amountYi >= c.needYi
        const warning = actionableWarning(r.biasWarning)
        return (
          <article
            key={r.code}
            className={cn(
              'rounded-[var(--radius-sm)] border p-2.5 min-w-0',
              finalView === 'participate' ? 'border-up/30 bg-up-soft/40' : 'border-line bg-card',
            )}
          >
            {/* ── 标题行：名称 + 冻结排序评分 + 判断 + 池别 + 标签 ── */}
            <div className="flex items-baseline gap-2 flex-wrap mb-1.5 min-w-0">
              <StockLink code={r.code} className="text-14 font-semibold text-txt">
                {s?.name || r.code}
              </StockLink>
              <span
                className={cn('num text-15 font-semibold flex-none', (s?.score ?? 0) >= 80 ? 'text-up' : 'text-sub')}
              >
                {s?.score == null ? '—' : n1(s.score)}
              </span>
              <span
                className={cn(
                  'text-11 font-semibold px-1.5 rounded-sm border flex-none',
                  m.cls,
                )}
              >
                {m.label}
              </span>
              {/* 来源标注：有终态 = 今晨 09:25 定音；无 = 仍在看昨日预案（今晨裁决未落盘） */}
              <span className="text-11 text-sub flex-none">
                {c ? '今晨 09:25 裁决' : '昨日预案·今晨裁决未落盘'}
              </span>
              {c?.quotaRank != null && <Chip tone="rec">买入名额 #{c.quotaRank}</Chip>}
              {/* 身份统一在下方展示，机械证据融入原有理由，不另增指标。 */}
              {c && r.bias && <Chip>昨预案 {biasText(r.bias)}</Chip>}
              {r.bucketLabel && <Chip>{r.bucketLabel}</Chip>}
              {s?.boards != null && <Chip>昨{s.boards}板</Chip>}
              {s?.style_tag && <Chip>{s.style_tag}</Chip>}
              {s?.is_20cm && <Chip>20cm</Chip>}
              {tags.map((t) => (
                <Chip key={t} tone="rec">
                  {t}
                </Chip>
              ))}
              {(c?.leaderRole ?? s?.leader_role ?? e?.dragon_diagnosis?.identity) && (
                <Chip>{c?.leaderRole ?? s?.leader_role ?? (e?.dragon_diagnosis?.identity?.startsWith('真龙头') ? '龙头' : e?.dragon_diagnosis?.identity === '准龙头' ? '准龙头' : e?.dragon_diagnosis?.identity?.startsWith('跟风') ? '跟风' : '—')}</Chip>
              )}
            </div>

            {/* ── ⛔ 越权兜底留痕（bias 与机械证据冲突 / 已被降级）—— 必须显眼，否则等于没兜住 ── */}
            {warning && (
              <div className="mb-1.5 rounded-sm border border-warn/40 bg-warn-soft px-2 py-1 text-11 leading-relaxed text-warn break-all">
                ⚠️ {warning}
              </div>
            )}

            {/* ── 🌅 今晨 09:25 池内裁决终态（**结论** · 用户 2026-09-22「不应该显示昨天的」）──
                ⛔ 本段必须在接力卡字段（依据）之前 —— 先看做了什么，再看凭什么做。 */}
            {c && (
              <div className="mb-1.5 rounded-sm border border-line-faint px-2 py-1 flex flex-col gap-0.5">
                <Row label="今晨">
                  <span className={cn('num font-semibold', valueTone(c.gapPct))}>
                    {pct(c.gapPct, 2)}
                  </span>
                  {zone && <span className={cn('ml-1.5', zone.cls)}>{zone.label}</span>}
                  <span className="text-sub ml-1.5">量能</span>
                  <span className="num ml-1">
                    {n2(c.amountYi)}/{n2(c.needYi)}亿
                  </span>
                  <span className={cn('ml-1', volOk ? 'text-up' : 'text-sub')}>
                    {volOk ? '达标' : '不足'}
                  </span>
                  {c.lineRank != null && (
                    <span className="num text-sub ml-1.5">方向内第 {c.lineRank}</span>
                  )}
                  {c.lineCoreName && <span className="text-sub ml-1.5">核心 {c.lineCoreName}</span>}
                </Row>
                {(c.reason || c.leaderEvidenceNote || c.mechanicalLeaderNote) && (
                  <Row label="裁决语">
                    <span className="text-txt">{[c.reason, c.leaderEvidenceNote, c.mechanicalLeaderNote].filter(Boolean).join('；')}</span>
                  </Row>
                )}
              </div>
            )}

            {/* ── 接力卡真实字段（无卡数据时整段不渲染，只留 AI 判断那一半）── */}
            {s && (
              <div className="flex flex-col gap-0.5 border-t border-line-faint pt-1.5">
                {e && (
                  <>
                    <Row label="预期开盘">
                      <span className="num font-semibold text-txt">
                        {rangePct(e.expected_range, 1)}
                      </span>
                      {e.gap_strength_hint && (
                        <span className="text-rec ml-1.5">{e.gap_strength_hint}</span>
                      )}
                      {e.super_gap_min != null && (
                        <span className="num text-sub ml-1.5">
                          超预期 ≥{n1(e.super_gap_min)}%
                        </span>
                      )}
                    </Row>
                    <Row label="竞价量能">
                      <span className="num">≥{n2(e.auction_amount_min_yi)}亿</span>
                      <span className="text-sub ml-1.5">
                        昨量 {rangePct(e.auction_amount_range, 0)}
                      </span>
                      <span className="num text-sub ml-1.5">
                        超预期 {n2(e.auction_amount_super_yi)}亿
                      </span>
                      {e.boom_label && <span className="ml-1.5">{e.boom_label}</span>}
                      {e.auction_boom_yi != null && (
                        <span className="num text-sub ml-1">线 {n2(e.auction_boom_yi)}亿</span>
                      )}
                    </Row>
                    <Row label="形态地位">
                      {e.seal_form}
                      {e.seal_zbc != null && (
                        <span className="num text-sub ml-1">炸{e.seal_zbc}</span>
                      )}
                      <span className="text-sub ml-1.5">·</span>
                      <span className="ml-1.5">{sectorTierText(e.sector_tier)}</span>
                      <span className="text-sub ml-1.5">{sectorSentimentText(e.sector_sentiment)}</span>
                      {e.confidence != null && (
                        <span className="num text-sub ml-1.5">
                          置信 {n2(e.confidence)}
                        </span>
                      )}
                      {e.phase && <span className="text-rec ml-1.5">{cardPhaseText(e.phase)}</span>}
                    </Row>
                  </>
                )}

                {dims.length > 0 && (
                  <Row label="维度指标">
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {dims.map((d) => (
                        <span key={d.key} className="whitespace-nowrap">
                          <span className="text-sub">{d.key}</span>{' '}
                          <span className="num text-txt">{d.score == null ? '—' : n1(d.score)}</span>{' '}
                          <span className="text-sub">{d.label}</span>
                        </span>
                      ))}
                    </span>
                  </Row>
                )}

                <Row label="昨量价">
                  成交 <span className="num">{n2(s.cje_yi)}亿</span>
                  <span className="text-sub mx-1">·</span>封单{' '}
                  <span className="num">{n2(s.seal_amt)}亿</span>
                  <span className="text-sub mx-1">·</span>换手{' '}
                  <span className="num">{n2(s.hs)}%</span>
                  <span className="text-sub mx-1">·</span>主力{' '}
                  <span className={cn('num', s.main_flow_yi >= 0 ? 'text-up' : 'text-down')}>
                    {pct(s.main_flow_yi, 2)}亿
                  </span>
                  <span className="text-sub mx-1">·</span>流通市值{' '}
                  <span className="num">{n2(s.lt_mktcap)}亿</span>
                </Row>

                {s.theme_name && (
                  <Row label="题材">
                    <span className="text-rec">{s.theme_name}</span>
                    {s.core_theme && <span className="text-sub ml-1.5">主轴 {s.core_theme}</span>}
                    {s.theme_mates_cnt != null && (
                      <span className="num text-sub ml-1.5">同题材 {s.theme_mates_cnt} 家</span>
                    )}
                    {s.carry_cnt != null && (
                      <span className="num text-sub ml-1.5">带动 {s.carry_cnt} 家</span>
                    )}
                  </Row>
                )}
              </div>
            )}

            {/* ── AI 盘后理由（前一交易日 15:30 写 · 长文含换行）──
                ⚠️ 与上面的「今晨裁决」是两个时点、两套结论 —— 必须标清来源，否则会被误读 */}
            {(r.reason || s?.leader_evidence?.note) && (
              <div className="mt-1.5 border-t border-line-faint pt-1.5">
                <div className="text-11 text-sub mb-0.5">🤖 AI 盘后理由（{decisionDate ?? '昨日'} 15:30 写）</div>
                <div className="text-12 leading-relaxed text-txt whitespace-pre-wrap break-all">
                  {[r.reason, !c && s?.leader_evidence?.note].filter(Boolean).join('\n')}
                </div>
              </div>
            )}

            {/* ── 脚本计划原文（接力卡 `expected_text`，即「尾盘卡怎么写就怎么显示」）── */}
            {e?.expected_text && (
              <div className="mt-1 text-11 leading-relaxed text-sub break-all">
                📋 {e.expected_text}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
