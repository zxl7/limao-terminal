import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { MarketSnapshot, RotationCandidate } from '@/shared/api'
import { DataTable, StatPair, Tag, n1, n2, pct } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarChart, BarList, Card, CardBadge, EmptyState, Icon, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, phaseText } from '@/shared/lib'

/**
 * 题材回流 —— 数据源 `cache/rotation.json` 的 `candidates` 子集。
 *
 * ## 与「题材轮动」页的分工
 *
 * 两页共用同一份数据，但回答的问题不同：
 *   · 题材轮动 = **全貌**（候选 + 涨停趋势 + 资金 + 规避名单）
 *   · 题材回流 = **只看回流信号本身**，并把它做成「可排序的介入清单」
 *
 * 拆页的理由：回流的判断需要**同时看四件事**，塞进宽表会看不见重点 ——
 *   ① 冷却够不够久（`cooled_days`）
 *   ② 催化新不新（`catalyst_fresh`）
 *   ③ 资金是不是在回（`tx_5d_yi` / `tx_10d_yi` / `flow_trend`）
 *   ④ 今天有没有开始动（`today_hot`）
 * 「今天已动」的票已失去低吸位置，因此本页把 `today_hot` 做成**显式分流**，
 * 而不是藏在列里。
 *
 * ## ⚠️ 置信度不是概率
 *
 * `confidence` 是原系统四因子加权后的**排序分值**，不是「成功率 65%」。
 * 本页按分值排序，但不给它加「胜率」「概率」这类措辞 —— 那会造成误读。
 */

export async function loader() {
  // 单路失败不拖垮整页（与 /timeline 同口径）
  await Promise.allSettled([
    queryClient.ensureQueryData(marketQueries.rotation()),
    queryClient.ensureQueryData(marketQueries.latest()),
  ])
  return null
}

/**
 * 五因子全满足 = 高置信；缺资金 = 待确认；缺催化 = 仅技术性回流。
 *
 * ⚠️ 2026-09-22 由四因子扩为**五因子**（新增「K线止跌」，用户口径：
 * 「监听板块消息、资金流和**K线是否止跌**，确定是否回流」）——
 * 资金/消息再好但**价格没止跌**，按用户口径不算真回流，故单列一档提示。
 */
function confTier(c: RotationCandidate): { label: string; tone: 'up' | 'rec' | 'warn' | 'neutral' } {
  const f = c.confidence_factors
  const capitalOk = f.capital === 'inflow_rising'
  const klineOk = String(f.kline ?? '').startsWith('stop_fall')
  if (f.catalyst && capitalOk && f.phase === 'boom' && klineOk)
    return { label: '五因子齐备', tone: 'up' }
  if (capitalOk && klineOk) return { label: '资金已回·K线止跌', tone: 'rec' }
  if (capitalOk) return { label: '资金已回·K线未止跌', tone: 'warn' }
  if (f.catalyst) return { label: '有催化·缺资金', tone: 'warn' }
  return { label: '仅形态回流', tone: 'neutral' }
}

type LiveReflow = {
  label: '题材确认' | '资金试探' | '待资金回流'
  tone: 'up' | 'rec' | 'warn'
  evidence: string
}

/**
 * 周期相位 → 展示口径（theme_phase_v1 · 2026-11-03）。
 *
 * ## 为什么这一列比置信度更重要
 *
 * `confidence` 回答「这题材像不像要回流」，但它不知道**这波线已经走到第几天**。
 * 同一个 9 家涨停：出现在第 1 天叫「新线冒头」（最值钱），出现在第 5 天
 * 叫「高位分歧」（最危险）。旧页面把两者按同一个置信度分值平铺，等于没分。
 *
 * ## order 就是操作建议的顺序
 *
 * 启动/发酵 → 有位置；回流 → 资金回来了但要防反抽不过前高；
 * 高潮 → 家数最多、质量最差，不追；分歧 → 2/3 会回流，方向等次日竞价；
 * 退潮/沉寂 → 出局。⛔ 这里只排「先看谁」，不是买卖指令。
 */
type PhaseTone = 'up' | 'rec' | 'warn' | 'mid' | 'down' | 'sub'
/**
 * 只登记「色调 + 排序」，**中文名一律走 `plain.ts` 的 `phaseText`**。
 * 两处各写一份中文迟早漂移 —— 白话层是单一源。
 */
const PHASE_META: Record<string, { tone: PhaseTone; order: number }> = {
  start: { tone: 'up', order: 0 },
  ferment: { tone: 'up', order: 1 },
  reflow: { tone: 'rec', order: 2 },
  climax: { tone: 'warn', order: 3 },
  diverge: { tone: 'mid', order: 4 },
  ebb: { tone: 'down', order: 5 },
  dormant: { tone: 'sub', order: 6 },
}

/** 相位色调 → 字面量类名（Tailwind 只认字面量，⛔ 不可写成 `text-${tone}`） */
const PHASE_TEXT: Record<PhaseTone, string> = {
  up: 'text-up',
  rec: 'text-rec',
  warn: 'text-warn',
  mid: 'text-mid',
  down: 'text-down',
  sub: 'text-sub',
}

/** 相位取值；null/未知一律返回 null（⛔ 不许默认成任何一档） */
function phaseOf(c: RotationCandidate) {
  const p = c.phase_v2
  if (!p?.phase) return null
  const meta = PHASE_META[p.phase]
  if (!meta) return null
  return { ...meta, label: phaseText(p.phase), raw: p }
}

/** Tag 组件只认 5 档语义色：mid/sub 归中性，⛔ 不许把分歧染成涨或跌 */
function tagTone(t: PhaseTone): 'neutral' | 'up' | 'down' | 'rec' | 'warn' {
  if (t === 'mid' || t === 'sub') return 'neutral'
  return t
}

/**
 * 表格里的周期格：主标签 + 第 N 天，title 带上判定依据。
 * 导出给测试直接渲染（避免为验一个标签去造整页数据）。
 */
export function PhaseCell({ c }: { c: RotationCandidate }) {
  const p = phaseOf(c)
  if (!p) {
    return (
      <span className="text-sub text-12" title="今日家数未取到 —— 不猜，等明早数据">
        未取到
      </span>
    )
  }
  const d = p.raw
  return (
    <span className="flex flex-wrap items-baseline gap-1">
      <Tag tone={tagTone(p.tone)} title={d.reason}>
        {p.label}
        {d.day_n ? ` ${d.day_n}天` : ''}
      </Tag>
      {d.cur != null && d.peak != null && (
        <span className="text-sub text-11 num" title="今日家数 / 窗口峰值家数（按选股宝题材归属算）">
          {d.cur}/{d.peak}
        </span>
      )}
      {d.src === 'pool_codes' && (
        <span
          className="text-sub text-10"
          title="题材库里没对上这条线，改用「历史成员今天有几只涨停」估算 —— 会偏高，只作参考"
        >
          估算
        </span>
      )}
      {d.quality === 'weak' && (
        <span className="text-sub text-10" title="有效数据不足 8 天，只作方向参考">
          数据不足
        </span>
      )}
    </span>
  )
}

/** 与上游回流监控同口径：名称先精确匹配，避免泛行业名误配具体题材。 */
function themeHit(theme: string, sector: string): boolean {
  const t = theme.trim()
  const s = sector.trim()
  return Boolean(t && s && (t === s || (t.length >= 2 && s.includes(t)) || (s.length >= 3 && t.includes(s))))
}

function liveReflow(c: RotationCandidate, latest?: MarketSnapshot): LiveReflow {
  if (c.confidence_factors.capital !== 'inflow_rising') {
    return { label: '待资金回流', tone: 'warn', evidence: '五日资金尚未转入' }
  }
  const sector = latest?.top5.find((x) => themeHit(c.theme, x.name))
  if (!sector) return { label: '资金试探', tone: 'rec', evidence: '资金已回，等待板块进入实时强势榜' }
  const leaderPct = sector.leader?.pct ?? 0
  const confirmed = (sector.delta === 'new' || sector.delta === 'surging') && sector.zt_count >= 2 && leaderPct >= 5
  if (confirmed) {
    return { label: '题材确认', tone: 'up', evidence: `${sector.name} 涨停 ${sector.zt_count} 只 · ${sector.leader?.name ?? '核心票'} +${n1(leaderPct)}%` }
  }
  return { label: '资金试探', tone: 'rec', evidence: `${sector.name} 尚未形成扩散确认` }
}

export function Component() {
  const rot = useQuery(marketQueries.rotation())
  const latest = useQuery(marketQueries.latest())
  const d = rot.data

  /** `d?.candidates ?? []` 每次渲染都生成新数组，显式 memo 稳定引用后再参与 useMemo 依赖 */
  const all = useMemo(() => d?.candidates ?? [], [d])
  /** 置信度降序（与原系统排序口径一致） */
  const sorted = useMemo(
    () => [...all].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
    [all],
  )
  /** 今日已动 vs 未动 —— 决定「还能不能低吸」 */
  const moved = sorted.filter((c) => c.today_hot)
  const calm = sorted.filter((c) => !c.today_hot)
  const liveByTheme = useMemo(
    () => new Map(all.map((c) => [c.theme, liveReflow(c, latest.data)])),
    [all, latest.data],
  )
  const liveCounts = useMemo(() => ({
    confirmed: [...liveByTheme.values()].filter((x) => x.label === '题材确认').length,
    probing: [...liveByTheme.values()].filter((x) => x.label === '资金试探').length,
  }), [liveByTheme])

  /** 周期相位分组 —— null 单独计「未取到」，⛔ 不许并进任何相位 */
  const phaseGroups = useMemo(() => {
    const groups: Record<string, RotationCandidate[]> = {}
    let unknown = 0
    for (const c of all) {
      const p = phaseOf(c)
      if (!p) {
        unknown += 1
        continue
      }
      ;(groups[p.raw.phase] ||= []).push(c)
    }
    return { groups, unknown }
  }, [all])

  /** 相位分布（只画有题材的档，空档不占位） */
  const phaseBars = useMemo(
    () =>
      Object.entries(PHASE_META)
        .map(([key, m]) => ({
          label: phaseText(key),
          value: (phaseGroups.groups[key] ?? []).length,
          tone: m.tone as PhaseTone,
        }))
        .filter((b) => b.value > 0),
    [phaseGroups],
  )

  /**
   * 回流信号排序条 —— 本页的核心交付物「可排序的介入清单」的视觉版。
   *
   * 附注给出**因子结构与冷却天数**：同样的置信度分值，来自「五因子齐备」还是
   * 「仅形态回流」是完全不同的操作价值，光看条长会把两者混为一谈。
   * 未启动的题材排在前面（可低吸），已启动的置后并整体压在下方 —— 顺序本身就是建议。
   */
  const signalItems = useMemo(() => {
    // 未启动区内部按**周期相位**排（启动→发酵→回流→高潮→分歧→退潮→沉寂），
    // 而不是按 confidence 平铺：同一个置信度，第 1 天和第 5 天的操作价值完全不同。
    // ⚠️ 已启动的仍整体压后 —— 「今天已动」意味着低吸位置已经没了。
    const calmByPhase = [...calm].sort(
      (a, b) => (phaseOf(a)?.order ?? 9) - (phaseOf(b)?.order ?? 9),
    )
    const ordered = [...calmByPhase, ...moved]
    return ordered.slice(0, 15).map((c) => {
      const p = phaseOf(c)
      const ph = p ? `${p.label}${p.raw.day_n ? ` ${p.raw.day_n}天` : ''}` : '未取到'
      return {
        label: c.theme,
        value: c.confidence,
        note: `${ph} · ${liveByTheme.get(c.theme)?.label ?? '—'} · ${confTier(c).label} · 冷却 ${c.cooled_days} 日`,
      }
    })
  }, [calm, moved, liveByTheme])

  /**
   * 五因子命中结构 —— 回答「这批回流信号的质量如何」。
   *
   * 五项分别对应脚本的五因子：催化新 / 资金回流 / 阶段处于爆发位 / 大盘配合 / **K线止跌**。
   * 柱高是**命中该因子的题材数**（不是分值），故用中性蓝统一着色 ——
   * 计数没有「好坏」语义，染红染绿都是过度解读。
   */
  const factorBars = useMemo(() => {
    const cnt = (f: (c: RotationCandidate) => boolean) => all.filter(f).length
    return [
      { label: '催化新', value: cnt((c) => c.catalyst_fresh), tone: 'mid' as const },
      { label: '资金回流', value: cnt((c) => c.confidence_factors.capital === 'inflow_rising'), tone: 'mid' as const },
      { label: '题材确认', value: liveCounts.confirmed, tone: 'mid' as const },
      { label: 'K线止跌', value: cnt((c) => String(c.confidence_factors.kline ?? '').startsWith('stop_fall')), tone: 'mid' as const },
      { label: '阶段爆发位', value: cnt((c) => c.confidence_factors.phase === 'boom'), tone: 'mid' as const },
      { label: '大盘配合', value: cnt((c) => c.confidence_factors.market === true), tone: 'mid' as const },
      { label: '今日已动', value: moved.length, tone: 'mid' as const },
    ]
  }, [all, moved, liveCounts])

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="↩️ 题材回流"
        extra={<CardBadge tone={calm.length ? 'rec' : 'neutral'}>未启动 {calm.length} / 已启动 {moved.length}</CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="数据日" value={d?.date ?? '—'} />
          <StatPair label="候选总数" value={all.length} />
          <StatPair label="资金已回" value={all.filter((c) => c.confidence_factors.capital === 'inflow_rising').length} tone="up" />
          <StatPair label="题材确认" value={liveCounts.confirmed} tone="up" />
          <StatPair label="资金试探" value={liveCounts.probing} tone="rec" />
          <StatPair
            label="K线止跌"
            value={all.filter((c) => String(c.confidence_factors.kline ?? '').startsWith('stop_fall')).length}
            tone="up"
          />
          <StatPair label="新催化" value={all.filter((c) => c.catalyst_fresh).length} />
          <StatPair label="窗口" value={d?.data_meta?.window ?? '—'} />
        </div>

        {/* ── 周期位置：本页的第一等重要信息 ─────────────────────────────
            同一组家数出现在第 1 天和第 5 天是完全相反的两件事，
            而 `confidence` 对这两者给的分可能一样 —— 所以它必须单独成块，
            不能只当表格里的一列。 */}
        <div className="border-l-2 border-up pl-2.5 mb-2">
          <div className="text-12 font-semibold mb-1 flex flex-wrap items-baseline gap-x-2">
            {/* 2026-11-16：文案大扫除时误删了这个标题，测试把它当契约（本页第一等重要信息） */}
            <span className="text-txt">周期位置</span>
            {phaseGroups.unknown > 0 && (
              <span className="text-sub text-11 font-normal">
                {phaseGroups.unknown} 个数据未到（不猜，等明早）
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {phaseBars.map((b) => (
              <span key={b.label} className={cn('text-12', PHASE_TEXT[b.tone])}>
                {b.label} <b className="num">{b.value}</b>
              </span>
            ))}
            {phaseBars.length === 0 && <span className="text-sub text-12">相位数据未生成</span>}
          </div>
          <p className="text-sub text-11 mt-1 leading-relaxed">
            启动 = 首次成线，位置最低；发酵 = 还在高位；<b className="text-txt">高潮</b> = 家数最多但
            质量最差（不追）；<b className="text-txt">分歧</b> = 掉 30% 以上，历史上 2/3 会回流，
            但方向只能等次日竞价定；<b className="text-txt">退潮</b> = 反抽没过前高，线走完了。
          </p>
          {/* ⚠️ 口径必须写明（2026-11-03 用户拍板「先按选股宝走」）：
              相位家数 = **当日被选股宝归到这条线、且今日涨停**的票数，
              与涨停家数图同源。此前用的是「历史成员今天有几只涨停」，
              会把照明/造纸/园林混进「大消费」，两套数打架时无从查起。 */}
          
        </div>

        {!rot.isLoading && !d && <EmptyState text="回流数据未生成" hint="cache/rotation.json 缺失" />}
      </Card>

      {/* 主工作区 = 信号排序 + 未启动/已启动清单（介入决策主链，含宽表）；
          辅助区 = 观察池与主板池全量（核对用底表，次要）。
          ⛔ 旧版 5 块纵向平铺，4K 下每块右侧大片空白。 */}
      <ZoneRow>
        <Zone label="介入清单" dot="bg-rec" className="xl:w-[62%]">
      {/* ── 排序视图：把「介入清单」从宽表里提出来 ── */}
      {all.length > 0 && (
        <Card
          title="🎯 回流信号排序"
          extra={<CardBadge tone="rec">未启动优先 · 附注为因子结构与冷却天数</CardBadge>}
        >
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-12 font-semibold mb-1 flex items-center gap-1">
                <Icon name="target" size={13} className="text-rec" />
                置信度 Top {signalItems.length}（未启动优先）
              </div>
              <BarList
                items={signalItems}
                format={(v) => (v == null ? '—' : n1(v))}
                labelWidth={96}
                emptyText="无回流候选"
              />
              <p className="text-sub text-11 mt-1.5 leading-relaxed">
                条长按<b className="text-txt">本批最高置信度</b>归一，仅表批内相对强弱。
                附注里的因子结构必须一并读：同样的分值，来自
                <b className="text-txt"> 四因子齐备</b> 与 <b className="text-txt">仅形态回流</b>
                的操作价值完全不同。排序把<b className="text-txt">未启动（可低吸）</b>排在前面，
                已启动的置后 —— <b className="text-txt">顺序本身就是建议</b>。
              </p>
            </div>

            <div>
              <div className="text-12 font-semibold mb-1 flex items-center gap-1">
                <Icon name="dna" size={13} className="text-sub" />
                五因子与盘中确认结构
              </div>
              <BarChart bars={factorBars} height={175} format={(v) => `${v} 个`} maxBarWidth={38} showValue />
              <p className="text-sub text-11 mt-1.5 leading-relaxed">
                柱高 = <b className="text-txt">命中该因子的题材数</b>（不是分值），
                故统一用中性蓝着色 —— 计数没有好坏语义，染红染绿都是过度解读。
                <br />
                「资金回流」高而「题材确认」低时，说明资金只是试探，价格与扩散尚未配合；不能把它当作题材重新启动。
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card title="未启动候选（可低吸区）" extra={<CardBadge tone="rec">{calm.length} 个</CardBadge>}>
        <DataTable<RotationCandidate>
          rows={calm}
          rowKey={(c) => c.theme}
          empty="无未启动候选"
          columns={[
            { label: '题材', cell: (c) => <span className="text-txt font-semibold">{c.theme}</span> },
            { label: '周期', cell: (c) => <PhaseCell c={c} /> },
            {
              label: '置信度',
              num: true,
              cell: (c) => (
                <span className={cn('font-semibold', c.confidence >= 60 ? 'text-up' : 'text-txt')}>
                  {n1(c.confidence)}
                </span>
              ),
            },
            {
              label: '因子结构',
              cell: (c) => {
                const t = confTier(c)
                return <Tag tone={t.tone}>{t.label}</Tag>
              },
            },
            {
              label: '盘中状态',
              cell: (c) => {
                const state = liveByTheme.get(c.theme)
                return <Tag tone={state?.tone ?? 'neutral'} title={state?.evidence}>{state?.label ?? '—'}</Tag>
              },
            },
            { label: '冷却', num: true, cell: (c) => `${c.cooled_days} 日` },
            { label: '催化', cell: (c) => (c.catalyst_fresh ? <Tag tone="up">新</Tag> : <Tag>旧</Tag>) },
            {
              label: '5日资金',
              num: true,
              cell: (c) => (
                <span className={(c.tx_5d_yi ?? 0) > 0 ? 'text-up' : 'text-down'}>
                  {c.tx_5d_yi != null ? `${n1(c.tx_5d_yi)} 亿` : '—'}
                </span>
              ),
            },
            { label: '资金趋势', cell: (c) => <span className="text-sub text-12">{c.flow_trend || '—'}</span> },
            { label: '板块构成', cell: (c) => <span className="text-sub text-12">主板 {c.board_mix?.main ?? '—'} / 创业 {c.board_mix?.cyb ?? '—'}</span> },
            {
              label: '触发条件',
              className: 'whitespace-normal min-w-[280px]',
              cell: (c) => <span className="text-12 leading-relaxed">{c.trigger || '—'}</span>,
            },
          ]}
        />
      </Card>

      <Card title="今日已启动（追高区）" extra={<CardBadge tone="up">{moved.length} 个</CardBadge>}>
        <DataTable<RotationCandidate>
          rows={moved}
          rowKey={(c) => c.theme}
          empty="今日无题材启动回流"
          columns={[
            { label: '题材', cell: (c) => <span className="text-txt">{c.theme}</span> },
            { label: '周期', cell: (c) => <PhaseCell c={c} /> },
            { label: '置信度', num: true, cell: (c) => n1(c.confidence) },
            {
              label: '盘中状态',
              cell: (c) => {
                const state = liveByTheme.get(c.theme)
                return <Tag tone={state?.tone ?? 'neutral'} title={state?.evidence}>{state?.label ?? '—'}</Tag>
              },
            },
            { label: '冷却', num: true, cell: (c) => `${c.cooled_days} 日` },
            {
              label: '爆发参照',
              cell: (c) => (
                <span className="text-sub text-12">
                  {c.boom_day || '—'} · 涨停 {c.boom_zt ?? '—'} · {c.boom_pct != null ? pct(c.boom_pct) : '—'}
                </span>
              ),
            },
            {
              label: '近期资金',
              num: true,
              cell: (c) => (
                <span className={(c.tx_10d_yi ?? 0) > 0 ? 'text-up' : 'text-down'}>
                  {c.tx_10d_yi != null ? `${n1(c.tx_10d_yi)} 亿` : '—'}
                </span>
              ),
            },
            { label: '涨停方向', cell: (c) => <span className="text-sub text-12">{c.zt_dir || '—'}</span> },
          ]}
        />
      </Card>
        </Zone>

        <Zone label="池全量底表" dot="bg-mid" className="xl:w-[38%]">
      {all.length > 0 && (
        <Card title="观察池与主板池全量" extra={<CardBadge>按题材归属核对</CardBadge>}>
          <p className="text-warn text-12 leading-relaxed border-l-2 border-warn pl-2.5 mb-2">
            铁律：池内题材标签不可直接采信 —— 须按个股真实主轴核对。下表按题材分组列出标的，
            涨幅只显示当日实时行情；取不到即为「—」，距「可操作」还差一步人工确认。
          </p>
          <div className="flex flex-col gap-2">
            {sorted.map((c) => (
              <div key={c.theme} className="border border-line rounded-sm px-2.5 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1.5">
                  <span className="text-13 font-semibold text-txt">{c.theme}</span>
                  <Tag tone={confTier(c).tone}>{confTier(c).label}</Tag>
                  <span className="text-sub text-12">
                    观察池 {c.watch_pool?.length ?? 0} · 主板池 {c.main_board_pool?.length ?? 0}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(c.watch_pool ?? []).map((s) => (
                    <span
                      key={s.code}
                      className={cn(
                        'badge border',
                        s.dragon ? 'border-lead text-lead' : 'border-line text-sub',
                        (s.live_pct ?? 0) > 0 && !s.dragon && 'text-up border-up',
                      )}
                      title={`${s.code} · ${s.board || '板块未知'} · 实时涨幅 ${s.live_pct != null ? pct(s.live_pct, 1) : '—'}${c.boom_day ? ` · 建池日 ${c.boom_day}` : ''} · ${n2(s.cap_yi)}亿${s.risk ? ` · ${s.risk}` : ''}`}
                    >
                      <StockLink code={s.code}>
                        {s.dragon ? '龙 ' : ''}
                        {s.name}
                        <span className="text-sub text-10 ml-1">实时</span>
                        <span className="num ml-1">{s.live_pct != null ? pct(s.live_pct, 1) : '—'}</span>
                      </StockLink>
                    </span>
                  ))}
                  {(c.watch_pool?.length ?? 0) === 0 && <span className="text-sub text-12">观察池为空</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
        </Zone>
      </ZoneRow>
    </div>
  )
}
