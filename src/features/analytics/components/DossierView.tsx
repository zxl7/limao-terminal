import { useState } from 'react'
import type { DecisionDossier, DossierStock } from '@/shared/api'
import { cn, cardPhaseText } from '@/shared/lib'
import { Card, CardBadge, EmptyState, StockLink } from '@/shared/ui'
import { DataTable, SegTabs, StatPair, Tag } from './Table'
import { fmtFbt, n1, n2, pct, rangeLow, rangePct } from '../lib/format'

/**
 * 财富密码决策档案视图（`wealth_code_candidates_v1`）。
 *
 * ## 这是全系统信息密度最高的一份数据
 *
 * 每日选股脚本把它一次性写出，包含：情绪环境 + 真实盘面 + 接力池 + 观察池 +
 * 早鸟埋伏 + 诊断计数 + 全局旁白。每一只入选的票都带 **70 余个项** ——
 * 包括逐维打分、预期区间、主力资金四段、筹码结构、历史同高度接力概率。
 *
 * ## 为什么只挑一部分项展示
 *
 * 70 个项全铺开会长到没人看。本视图按「决策时会真正用到」筛选：
 *   ① 结果层：分数 / 排名 / 板数 / 涨幅 —— 这只票凭什么入选
 *   ② 可交易层：预期区间 / 换手 / 炸板 / 封单 —— 明天能不能买到、买到值不值
 *   ③ 结构层：主轴题材 / 带动家数 / 梯队等级 / 历史接力概率 —— 接力质量
 *   ④ 资金层：主力资金四段 + 筹码获利比例 —— 谁在买、成本在哪
 * 其余项保留在 JSON 里备查，不占版面。
 *
 * ## ⚠️ 两个必须显式提示的口径
 *
 * 1. `theme`（东财题材名）与 `core_theme`（脚本判定的主轴）**可能不同轴**。
 *    原系统铁律是「按个股真实主轴归类」，故两者并列展示而非二选一 ——
 *    差异本身即信号（标签与真实主线不符）。
 * 2. `price` 实测为 `null`（该项在选股阶段未回填，价格由竞价阶段提供）。
 *    渲染成「—」而不是 0。
 */

/** 接力池 / 观察池共用列定义 —— 两池项完全同构，仅排名项名不同 */
function poolColumns(rankKey: 'relay_rank' | 'watch_rank') {
  return [
    {
      label: '排名',
      cell: (s: DossierStock) => (
        <span className="num text-sub">{String(s[rankKey] ?? '—')}</span>
      ),
    },
    {
      label: '标的',
      cell: (s: DossierStock) => (
        <span>
          <StockLink code={s.code} className="text-txt">{s.name}</StockLink>
          {s.is_20cm && <Tag tone="warn">20cm</Tag>}
          {s.is_st && <Tag tone="down">ST</Tag>}
          {s.is_capacity_core && <Tag tone="rec">容量核心</Tag>}
        </span>
      ),
    },
    {
      label: '主轴题材',
      cell: (s: DossierStock) => (
        <span>
          <span className="text-txt">{s.core_theme || s.theme || '—'}</span>
          <div className="text-sub text-11 leading-snug">{s.core_theme_logic || ''}</div>
        </span>
      ),
    },
    {
      label: '总分',
      num: true,
      cell: (s: DossierStock) => (
        <span className={cn('font-semibold', s.score >= 80 ? 'text-up' : 'text-txt')}>{n1(s.score)}</span>
      ),
    },
    {
      label: '维度（点火/爆发/带动/容量）',
      num: true,
      cell: (s: DossierStock) => (
        <span className="text-sub text-12 num">
          {n1(s.ign_score)} / {n1(s.exp_score)} / {n1(s.lead_score)} / {n1(s.cap_score)}
        </span>
      ),
    },
    {
      label: '板数',
      num: true,
      cell: (s: DossierStock) => (s.boards ? <span className="text-up font-semibold">{s.boards}</span> : '—'),
    },
    {
      label: '涨幅',
      num: true,
      cell: (s: DossierStock) => (
        <span className={s.pct > 0 ? 'text-up' : s.pct < 0 ? 'text-down' : 'text-txt'}>{pct(s.pct)}</span>
      ),
    },
    {
      label: '首封',
      cell: (s: DossierStock) => <span className="num text-sub">{fmtFbt(s.fbt)}</span>,
    },
    {
      label: '炸板',
      num: true,
      cell: (s: DossierStock) => <span className={s.zbc > 0 ? 'text-warn' : 'text-sub'}>{s.zbc || '—'}</span>,
    },
    {
      label: '换手',
      num: true,
      cell: (s: DossierStock) => `${n1(s.hs)}%`,
    },
    {
      label: '封单',
      num: true,
      cell: (s: DossierStock) => `${n2(s.seal_amt)}亿`,
    },
    {
      label: '成交额',
      num: true,
      cell: (s: DossierStock) => `${n1(s.cje_yi)}亿`,
    },
    {
      label: '流通市值',
      num: true,
      cell: (s: DossierStock) => `${n1(s.lt_mktcap)}亿`,
    },
    {
      label: '带动家数',
      num: true,
      cell: (s: DossierStock) => (
        <span className={cn((s.carry_cnt ?? 0) >= 5 ? 'text-up font-semibold' : 'text-txt')}>
          {s.carry_cnt ?? '—'}
        </span>
      ),
    },
    {
      label: '梯队等级',
      cell: (s: DossierStock) => (
        <span>
          <Tag tone={s.ladder_grade === 'A' ? 'up' : s.ladder_grade === 'D' ? 'down' : 'neutral'}>
            {s.ladder_grade || '—'}
          </Tag>
          <span className="num text-sub text-11 ml-1">{n1(s.ladder_health)}</span>
        </span>
      ),
    },
    {
      label: '同高度接力概率',
      num: true,
      cell: (s: DossierStock) => (
        <span className={cn('font-semibold', (s.history_relay_prob ?? 0) >= 0.5 ? 'text-up' : 'text-txt')}>
          {s.history_relay_prob != null ? `${(s.history_relay_prob * 100).toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      label: '预期区间·量能门槛',
      className: 'whitespace-normal min-w-[150px]',
      cell: (s: DossierStock) => {
        const e = s.expectation
        if (!e) return <span className="text-sub">—</span>
        const amtMin = rangeLow(e.auction_amount_range)
        return (
          <span className="block leading-snug">
            <span className="num text-txt">{rangePct(e.expected_range)}</span>
            {e.boom_label && <span className="text-sub text-11 ml-1">{e.boom_label}</span>}
            <span className="block num text-11 text-sub">
              量≥{n2(e.auction_amount_min_yi)}亿
              {amtMin != null ? `（昨${rangePct(e.auction_amount_range)}）` : ''}
            </span>
          </span>
        )
      },
    },
    {
      label: '阶段·置信',
      className: 'whitespace-normal min-w-[100px]',
      cell: (s: DossierStock) => {
        const e = s.expectation
        if (!e) return <span className="text-sub">—</span>
        const tone: 'up' | 'down' | 'neutral' =
          e.phase === '亢奋' || e.phase === '共振' ? 'up' : e.phase === '分歧' || e.phase === '退潮' ? 'down' : 'neutral'
        return (
          <span className="block leading-snug">
            <Tag tone={tone}>{cardPhaseText(e.phase)}</Tag>
            <span className="num text-11 text-sub ml-1">{n2(e.confidence)}</span>
            {e.non_tradeable && <Tag tone="down">不可交易</Tag>}
          </span>
        )
      },
    },
    {
      label: '龙头三要素（带/破/独）',
      num: true,
      cell: (s: DossierStock) => {
        const g = s.expectation?.dragon_diagnosis
        if (!g) return <span className="text-sub">—</span>
        return (
          <span className="text-12 num text-sub">
            {g.leadership?.stars ?? '—'}/{g.breakthrough?.stars ?? '—'}/{g.uniqueness?.stars ?? '—'}
            {g.identity && <span className="ml-1 text-txt">{g.identity}</span>}
          </span>
        )
      },
    },
    {
      label: '买入条件（脚本原文）',
      className: 'whitespace-normal min-w-[340px]',
      cell: (s: DossierStock) => (
        <span className="text-12 leading-relaxed">
          {s.expectation?.expected_text || '—'}
        </span>
      ),
    },
    {
      label: '主力资金（当日/5日）',
      num: true,
      cell: (s: DossierStock) => (
        <span>
          <span className={cn(s.main_flow_yi > 0 ? 'text-up' : 'text-down')}>{n2(s.main_flow_yi)}</span>
          <span className="text-sub"> / </span>
          <span className={cn(s.main_flow_5d_yi > 0 ? 'text-up' : 'text-down')}>{n2(s.main_flow_5d_yi)}</span>
        </span>
      ),
    },
    {
      label: '筹码获利',
      num: true,
      cell: (s: DossierStock) => (
        <span className={cn((s.chip_profit_rate ?? 0) >= 90 ? 'text-up' : 'text-txt')}>
          {n1(s.chip_profit_rate)}%
        </span>
      ),
    },
    {
      label: '标签',
      cell: (s: DossierStock) =>
        s.tags?.length ? (
          <span className="flex flex-wrap gap-1">
            {s.tags.map((t) => (
              <Tag key={t} tone="up">
                {t}
              </Tag>
            ))}
          </span>
        ) : (
          <span className="text-sub">—</span>
        ),
    },
  ]
}

/** 盘后候选卡按冻结总分展示；同分保留上游原顺序，原池内排名项不被改写。 */
function byFrozenScore<T extends DossierStock>(rows: T[] | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
}

export function DossierView({ d }: { d: DecisionDossier }) {
  const [tab, setTab] = useState<'relay' | 'watch' | 'early' | 'narrative'>('relay')
  const env = d.environment
  const diag = d.diagnostics
  const real = d.real_env

  return (
    <div className="flex flex-col gap-3">
      {/* ── 决策时点的情绪环境 ── */}
      <Card
        title="决策环境"
        extra={
          <div className="flex items-center gap-2">
            <CardBadge tone={env.sentiment_score >= 7 ? 'up' : env.sentiment_score <= 2 ? 'down' : 'neutral'}>
              {env.sentiment_label || '—'} {n1(env.sentiment_score)}
            </CardBadge>
            <Tag>{d.regime || '—'}</Tag>
          </div>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <StatPair label="当日涨停" value={env.now_zt_count ?? '—'} tone="up" />
          <StatPair label="晋级率" value={env.promote_rate != null ? `${n1(env.promote_rate)}%` : '—'} />
          <StatPair
            label="核按钮"
            value={env.nuke_count ?? '—'}
            tone={(env.nuke_count ?? 0) >= 3 ? 'down' : 'sub'}
          />
          <StatPair label="炸板率" value={env.broken_rate != null ? `${n1(env.broken_rate)}%` : '—'} />
          <StatPair label="上涨占比" value={env.up_rate != null ? `${n1(env.up_rate)}%` : '—'} />
          <StatPair label="候选均涨幅" value={pct(env.avg_pct)} />
          <StatPair label="决策时间" value={d.generated_at_bj?.slice(11, 19) ?? '—'} />
          <StatPair label="数据源" value={d.data_source || '—'} />
        </div>

        {real && (
          <div className="mt-2 pt-2 border-t border-line-faint">
            <div className="text-12 text-sub mb-1">
              决策时点真实盘面（用于核对脚本环境是否失真）
            </div>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
              {(real.indices ?? []).map((ix) => (
                <StatPair
                  key={ix.name}
                  label={ix.name}
                  value={pct(ix.pct)}
                  tone={ix.pct > 0 ? 'up' : ix.pct < 0 ? 'down' : 'sub'}
                />
              ))}
              <StatPair label="指数均涨" value={pct(real.avg_index_pct)} />
              <StatPair label="真实涨停" value={real.total_zt ?? '—'} />
              {real.breadth && (
                <>
                  <StatPair label="上涨" value={real.breadth.up ?? '—'} tone="up" />
                  <StatPair label="下跌" value={real.breadth.down ?? '—'} tone="down" />
                </>
              )}
              <StatPair label="数据时间" value={real.ts?.slice(11, 19) ?? '—'} />
            </div>

            {/* ── 双套情绪读数对照 —— 「脚本环境是否失真」的唯一证据 ── */}
            {real.feedback && (
              <div className="mt-2">
                <div className="text-12 text-sub mb-1">
                  情绪读数对照（左＝选股脚本自算 · 右＝盘中数据真实值）
                </div>
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                  <Delta label="情绪分" script={env.sentiment_score} real={real.feedback.sentiment_score} />
                  <Delta label="晋级率" script={env.promote_rate} real={real.feedback.promote_rate} unit="%" />
                  <Delta label="炸板率" script={env.broken_rate} real={real.feedback.broken_rate} unit="%" />
                  <Delta label="上涨占比" script={env.up_rate} real={real.feedback.up_rate} unit="%" />
                  <Delta label="核按钮" script={env.nuke_count} real={real.feedback.nuke_count} />
                  <Delta label="涨停数" script={env.now_zt_count} real={real.total_zt} />
                </div>
              </div>
            )}

            {/* ── 风险面：炸板 / 跌停 / 弱势板块 ── */}
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 mt-2">
              <StatPair
                label="炸板家数"
                value={real.broken?.count ?? '—'}
                tone={(real.broken?.count ?? 0) > 0 ? 'down' : 'sub'}
              />
              <StatPair
                label="跌停家数"
                value={real.limit_down?.count ?? '—'}
                tone={(real.limit_down?.count ?? 0) > 0 ? 'down' : 'sub'}
              />
              {real.sector_risk?.declining?.length ? (
                <span className="text-12 text-sub">
                  弱势板块{' '}
                  {real.sector_risk.declining.slice(0, 5).map((x) => (
                    <span key={x.name} className="num text-down mr-2">
                      {x.name} {pct(x.pct)}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>

            {/* ── 板块级热点：板块 → 领涨标的 ── */}
            {real.hot_spots?.length ? (
              <div className="mt-2">
                <div className="text-12 text-sub mb-1">决策时点板块热点</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {real.hot_spots.slice(0, 6).map((h) => (
                    <span key={h.sector} className="text-12">
                      <span className="text-rec">{h.sector}</span>{' '}
                      <span className="text-sub num">
                        {(h.stocks ?? [])
                          .slice(0, 3)
                          .map((s) => `${s.name}${s.boards ? `(${s.boards})` : ''}`)
                          .join(' · ')}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* ── 诊断计数：回答「为什么只选出这几只」 ── */}
      {diag && (
        <Card
          title="选股诊断"
          extra={
            <CardBadge tone={diag.selection_mode === 'strict' ? 'up' : 'warn'}>
              {diag.selection_mode === 'strict' ? '严格模式' : diag.selection_mode || '—'}
            </CardBadge>
          }
        >
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-1.5">
            <StatPair label="参与打分" value={diag.scored ?? '—'} />
            <StatPair label="严格池" value={diag.strict_pool ?? '—'} />
            <StatPair label="入接力池" value={diag.relay_count ?? '—'} tone="up" />
            <StatPair label="入观察池" value={diag.watch_count ?? '—'} />
            <StatPair label="均原始分" value={n1(diag.mean_raw_score)} />
            <StatPair label="高点突破达标" value={diag.height_breakout_eligible ?? '—'} />
            <StatPair label="高位达标" value={diag.high_mark_eligible ?? '—'} />
            <StatPair label="核心达标" value={diag.core_eligible ?? '—'} />
            <StatPair label="1进2 达标" value={diag.one_to_two_eligible ?? '—'} />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-12">
            <span className="text-sub">
              剔除低换手 <b className="num text-txt">{diag.excluded_low_turnover ?? '—'}</b>
            </span>
            <span className="text-sub">
              剔除 688 <b className="num text-txt">{diag.excluded_688 ?? '—'}</b>
            </span>
            <span className="text-sub">
              资金增强 <b className="num text-txt">{diag.tx_enriched ?? '—'}</b>
            </span>
            <span className="text-sub">
              弱转强命中 <b className="num text-up">{diag.weak2strong_hits ?? '—'}</b>
              {diag.weak2strong_codes?.length ? (
                <span className="num ml-1">({diag.weak2strong_codes.join(' ')})</span>
              ) : null}
            </span>
            <span className="text-sub">
              早鸟命中 <b className="num text-up">{diag.early_buy_hits ?? '—'}</b>
            </span>
          </div>
          {!!diag.early_buy_signals?.length && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {diag.early_buy_signals.map((s) => (
                <Tag key={`${s.code}-${s.type}`} tone="rec">
                  <StockLink code={s.code}>{s.code} {s.type}</StockLink>
                </Tag>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── 三池 + 旁白 ── */}
      <Card
        title="选股结果"
        extra={
          <SegTabs
            items={[
              { key: 'relay', label: `接力池 ${d.relay?.length ?? 0}` },
              { key: 'watch', label: `观察 ${d.watch?.length ?? 0}` },
              { key: 'early', label: `早鸟埋伏 ${d.early_ambush?.length ?? 0}` },
              { key: 'narrative', label: '全局旁白' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'relay' && (
          <>
            <p className="text-sub text-12 mb-1.5 leading-relaxed">
              接力池 = 可直接执行，列表按冻结总分由高到低展示。列序按「结果 → 可交易 → 结构 → 资金」排列，
              `theme` 与 `core_theme` 不同轴时以主轴为准（原系统铁律：按个股真实主轴归类）。
            </p>
            <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
              <DataTable
                rows={byFrozenScore(d.relay)}
                rowKey={(s, i) => `${s.code}-${i}`}
                dense
                empty="该日接力池为空"
                columns={poolColumns('relay_rank')}
              />
            </div>
          </>
        )}

        {tab === 'watch' && (
          <>
            <p className="text-sub text-12 mb-1.5 leading-relaxed">
              观察池 = 待确认，列表按冻结总分由高到低展示。分组由脚本给出（如「容量核心」）—— 属于不同介入逻辑，
              不可与接力池同等对待。
            </p>
            <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
              <DataTable
                rows={byFrozenScore(d.watch)}
                rowKey={(s, i) => `${s.code}-${i}`}
                dense
                empty="该日观察池为空"
                columns={[
                  {
                    label: '分组',
                    cell: (s: DossierStock) => <Tag tone="rec">{s.watch_group || '—'}</Tag>,
                  },
                  ...poolColumns('watch_rank'),
                ]}
              />
            </div>
          </>
        )}

        {tab === 'early' && (
          <>
            {(d.early_ambush?.length ?? 0) === 0 ? (
              <EmptyState text="该日无早鸟埋伏信号" hint="该日选股未命中未封板强势的早鸟标的" />
            ) : (
              <DataTable
                rows={d.early_ambush}
                rowKey={(e, i) => `${e.buy?.code ?? i}-${i}`}
                empty="无"
                columns={[
                  { label: '类型', cell: (e) => <Tag tone="rec">{e.type || '—'}</Tag> },
                  { label: '板块', cell: (e) => <span className="text-txt">{e.sector || '—'}</span> },
                  {
                    label: '关注标的',
                    cell: (e) => (
                      <span>
                        <StockLink code={e.buy?.code} className="text-txt">{e.buy?.name || '—'}</StockLink>
                        {e.buy?.is_20cm && <Tag tone="warn">20cm</Tag>}
                      </span>
                    ),
                  },
                  {
                    label: '涨幅',
                    num: true,
                    cell: (e) => (
                      <span className={cn((e.buy?.pct ?? 0) > 0 ? 'text-up' : 'text-down')}>
                        {pct(e.buy?.pct)}
                      </span>
                    ),
                  },
                  {
                    label: '板块涨停',
                    num: true,
                    cell: (e) => <span className="text-sub">{e.zt_in_sector ?? '—'}</span>,
                  },
                  {
                    label: '池内成员',
                    cell: (e) => (
                      <span className="flex flex-wrap gap-1">
                        {(e.members ?? []).map((m) => (
                          <Tag key={m.name}>
                            {m.name} <span className="num">{n1(m.pct)}%</span>
                          </Tag>
                        ))}
                      </span>
                    ),
                  },
                  {
                    label: '逻辑',
                    className: 'whitespace-normal min-w-[240px]',
                    cell: (e) => <span className="text-12 leading-relaxed">{e.desc || '—'}</span>,
                  },
                ]}
              />
            )}
          </>
        )}

        {tab === 'narrative' && (
          <Narrative text={d.global_narrative} />
        )}
      </Card>
    </div>
  )
}

/**
 * 双套情绪读数对照单元 —— 「脚本环境 vs 真实盘面」逐项并排。
 *
 * 差值 ≥1 才标红提示：小数量级抖动（如 8.0 vs 7.9）在采样时点差异下是正常的，
 * 全都标出来反而淹没真正的失真项。
 */
function Delta({
  label,
  script,
  real,
  unit = '',
}: {
  label: string
  script?: number | null
  real?: number | null
  unit?: string
}) {
  const s = script ?? null
  const r = real ?? null
  const diff = s != null && r != null ? s - r : null
  const v = (x: number | null) => (x == null ? '—' : `${n1(x)}${unit}`)

  return (
    <span className="text-12 whitespace-nowrap">
      <span className="text-sub mr-1">{label}</span>
      <span className="num text-txt">{v(s)}</span>
      <span className="text-sub mx-0.5">/</span>
      <span className="num text-txt">{v(r)}</span>
      {diff != null && Math.abs(diff) >= 1 && (
        <Tag tone="warn">
          差 {diff > 0 ? '+' : ''}
          {n1(diff)}
          {unit}
        </Tag>
      )}
    </span>
  )
}

/** 全局旁白 —— 按换行分段渲染，段落之间留白，便于逐段核对 */
function Narrative({ text }: { text?: string }) {
  if (!text) return <span className="text-sub text-12">该日无全局旁白</span>
  const paras = text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)

  return (
    <div className="flex flex-col gap-2">
      {paras.map((p, i) => (
        <p
          // oxlint-disable-next-line react/no-array-index-key -- 段落序号即身份：旁白为纯文本按 \n 切分，段落自身无 id，同文重复段落是合法的（且必须都渲染）。
          key={i}
          className="text-13 leading-relaxed border-l-2 border-line-faint pl-2.5 whitespace-pre-wrap"
        >
          {p}
        </p>
      ))}
    </div>
  )
}
