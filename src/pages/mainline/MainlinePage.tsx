import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { ThemeTop } from '@/shared/api'
import {
  analyticsQueries,
  buildGeneIndex,
  buildThemeCoreIndex,
  DataTable,
  tierOf,
  StatPair,
  Tag,
  n1,
  n2,
  type GeneFacts,
  type ThemeCoreFacts,
} from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarChart, Card, CardBadge, EmptyState, Icon, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, tradableStocks } from '@/shared/lib'

/** 环比 = 当日涨停数 − 昨日涨停数（⚠️ 不能用 `delta`，它是状态枚举） */
/**
 * 环比 = 今日涨停数 − 昨日涨停数。
 *
 * ⚠️ `prev` 必须接受 `null`：`zt_prev` 在**新晋题材**上实测为 null（昨日还没有
 * 这个题材，自然没有昨日涨停数）。null 与 0 语义不同 —— 0 是「昨日有题材但零家
 * 涨停」，null 是「昨日无此题材」。后者不能算作「昨日 0 家」再推出「+N」的结论。
 */
function deltaText(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || prev == null) return '—'
  const d = cur - prev
  if (d === 0) return '持平'
  return d > 0 ? `+${d}` : String(d)
}

function deltaTone(
  cur: number | null | undefined,
  prev: number | null | undefined,
): 'up' | 'down' | 'sub' {
  if (cur == null || prev == null) return 'sub'
  const d = cur - prev
  return d > 0 ? 'up' : d < 0 ? 'down' : 'sub'
}

/** `delta` 是题材状态枚举：'new' 新晋 / 'ongoing' 持续 */
function stateLabel(delta: string | undefined): string | null {
  if (delta === 'new') return '新晋'
  if (delta === 'ongoing') return '持续'
  return delta ? delta : null
}

/**
 * 主线题材 —— 数据源 `cache/pulse_snapshots/latest.json` 的 `top5` 字段（原系统 `render_theme_compare`）。
 *
 * ## 判读主线要看的三组数
 *
 * 1. **规模**：`zt_count`（本题材涨停家数）+ `total_stocks`（题材内总家数）。
 *    只有涨停多而总家数极小 = 题材本身很小众，扩散空间有限。
 * 2. **资金强度**：`turn_avg`（平均换手）+ 龙头 `turn`。换手是「有多少筹码换手
 *    到新资金手里」的代理指标，比涨幅更能说明接力意愿。
 * 3. **变化方向**：环比 = `zt_count - zt_prev`。
 *
 * ## ⚠️ 实测：`delta` 不是数字，是状态枚举
 *
 * 落盘数据里 `delta` 取值只有 `'new'`（新晋）与 `'ongoing'`（持续），
 * **不是**涨停数环比。早期把它当 number 会导致 `delta > 0` 恒为 false ——
 * 每个题材都会被渲染成「持平」，且不报任何错。故本页：
 *   · 环比一律用 `zt_count - zt_prev` 计算
 *   · `delta` 只作为「新晋 / 持续」标签展示
 *
 * ## `positives` / `risks` / `diffusion` 是原系统的定性结论
 *
 * 它们由原系统脚本生成，不是本页推断。本页只负责呈现，并**不做改写** ——
 * 改写会掩盖原系统当时的判断依据。
 */

/** 模块级空数组：保证 `top5` 在无数据时引用稳定，避免 useMemo 每次失效 */
const EMPTY_TOP5: ThemeTop[] = []

export async function loader() {
  await Promise.allSettled([
    queryClient.ensureQueryData(marketQueries.latest()),
    // 资金流与股性档案是叠加维度；缺失不阻塞主线本体
    queryClient.ensureQueryData(analyticsQueries.flowLive()),
    queryClient.ensureQueryData(analyticsQueries.geneHist()),
  ])
  return null
}

export function Component() {
  const snap = useQuery(marketQueries.latest())
  const flow = useQuery(analyticsQueries.flowLive())
  const gene = useQuery(analyticsQueries.geneHist())
  const top5 = snap.data?.top5 ?? EMPTY_TOP5
  const [openRank, setOpenRank] = useState<number | null>(top5[0]?.rank ?? null)
  const themeNames = useMemo(() => top5.map((t) => t.name), [top5])
  /** 股性档案：近250日涨停次数 / 晋级率 / 历史最高连板 —— 辨识度的客观依据 */
  const geneIndex = useMemo(() => buildGeneIndex(gene.data), [gene.data])
  /**
   * 核心辨识度个股 + 题材资金流。
   * `leaders[].sector` 与题材名同词表，直接归队；资金按「更具体的同名板块」匹配。
   */
  const coreIndex = useMemo(
    () => buildThemeCoreIndex({
      snapshot: snap.data, fundBoards: flow.data?.boards, themeNames,
    }),
    [snap.data, flow.data, themeNames],
  )

  /** 页内资金量纲：用于「相对强度条」，只在本页题材之间比较，不是全市场标准 */
  const fundMaxAbs = Math.max(0, ...[...coreIndex.values()].map((f) => Math.abs(f.fund?.flowYi ?? 0)))

  const expanded = top5.find((t) => t.rank === openRank) ?? top5[0]

  /** 题材内涨停数的相对量纲（用于列表行内的细条；仅本批相对比较） */
  const ztMax = Math.max(1, ...top5.map((t) => t.zt_count))

  /**
   * 题材涨停家数柱状 —— 长度 = 绝对家数，颜色 = 环比方向。
   *
   * ## 为什么颜色不跟长度走
   *
   * 家数恒为非负，若按符号着色则所有柱都是红色，**「扩了还是缩了」这一最关键
   * 的信息就丢了**。故此处用双通道编码：
   *   · 长度 → 今日绝对家数（过零基线，长度即数量）
   *   · 颜色 → 环比方向（<b>增多=红 / 减少=绿</b>，符合本项目「改善红 / 恶化绿」板）
   *   · 空心柱 → 昨日家数
   * 三者正交，一根柱子里同时读完「多大」「比昨天多还是少」。
   *
   * ⚠️ `zt_prev` 为 null = **昨日无此题材**（新晋），不是「昨日 0 家」。
   *    空心柱缺失（画成虚线短横），且颜色取中性 —— 无基准就无从谈增减。
   */
  const ztBars = top5.map((t) => {
    const d = t.zt_prev == null ? null : t.zt_count - t.zt_prev
    return {
      label: t.name,
      value: t.zt_count,
      compare: t.zt_prev,
      compareLabel: '昨日涨停',
      tone: d == null ? ('sub' as const) : d > 0 ? ('up' as const) : d < 0 ? ('down' as const) : ('mid' as const),
    }
  })

  return (
    <div className="flex flex-col gap-3">
      {/* 主工作区 = 主线题材（可展开的题材列表，内容最重）；辅助区 = 涨停家数对比 + 展开详情。
          ⛔ 旧版三块纵向平铺，4K 下主线列表右侧大片空白。 */}
      <ZoneRow>
        <Zone label="主线题材" dot="bg-lead" className="xl:w-[62%]">
          <Card
            title="🎯 主线题材"
        extra={<CardBadge>{snap.data?.data_scope?.asof ?? snap.data?.ts?.slice(11, 19) ?? '—'}</CardBadge>}
      >
        {top5.length === 0 ? (
          <EmptyState
            text="无主线题材数据"
            hint={snap.isLoading ? '加载中…' : 'latest.json 的 top5 为空（盘前早段常见）'}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
              <StatPair label="快照时间" value={snap.data?.ts?.slice(11, 19) ?? '—'} />
              <StatPair label="全市场涨停" value={snap.data?.total_zt ?? '—'} tone="up" />
              <StatPair label="情绪" value={snap.data?.sentiment ?? '—'} />
              <StatPair label="封板率" value={snap.data?.sentiment_detail?.seal_rate != null ? `${n1(snap.data.sentiment_detail.seal_rate)}%` : '—'} />
              <StatPair label="广度" value={snap.data?.data_scope?.breadth ?? '—'} />
              <StatPair label="成交额" value={snap.data?.data_scope?.amount ?? '—'} />
            </div>

            <div className="flex flex-col gap-1.5">
              {top5.map((t) => {
                const core = coreIndex.get(t.name)
                const isOpen = t.rank === expanded?.rank
                return (
                  <div
                    key={t.rank}
                    className={cn(
                      'rounded-sm border transition-colors',
                      isOpen ? 'border-line-strong bg-card' : 'border-line',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`题材 ${t.name}`}
                      aria-expanded={isOpen}
                      onClick={() => setOpenRank(t.rank)}
                      className="w-full text-left border-0 rounded-sm px-2.5 py-1.5 cursor-pointer bg-transparent text-txt"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span
                          className={cn(
                            'num text-[13px] font-semibold w-[18px]',
                            t.rank === 1 ? 'text-lead' : 'text-sub',
                          )}
                        >
                          {t.rank}
                        </span>
                        <span className="text-[13.5px] font-semibold text-txt">{t.name}</span>
                        <StatPair label="涨停" value={t.zt_count} tone="up" />
                        <StatPair label="环比" value={deltaText(t.zt_count, t.zt_prev)} tone={deltaTone(t.zt_count, t.zt_prev)} />
                        <StatPair label="昨日" value={t.zt_prev} />
                        <StatPair label="均换手" value={n1(t.turn_avg)} />
                        <StatPair label="涨停/家数" value={`${t.zt_count}/${t.total_stocks}`} />
                        <span className="text-[12px] text-sub flex items-center gap-1">
                          <Icon name="trophy" size={12} className="text-lead" />
                          龙头 {t.leader?.name ?? '—'}
                        </span>
                        {t.leader?.boards && <Tag tone="up">{t.leader.boards}</Tag>}
                        {stateLabel(t.delta) && <Tag tone={t.delta === 'new' ? 'rec' : 'neutral'}>{stateLabel(t.delta)}</Tag>}
                      </div>
                      <span
                        className="block mt-1 h-[3px] w-full rounded-sm overflow-hidden"
                        style={{ background: 'var(--color-line-faint)' }}
                      >
                        <span
                          className="block h-full rounded-sm"
                          style={{
                            width: `${(t.zt_count / ztMax) * 100}%`,
                            background: 'var(--color-up)',
                          }}
                        />
                      </span>
                      {t.desc && <div className="text-[12px] text-sub mt-0.5 leading-relaxed">{t.desc}</div>}
                    </button>

                    {/* 龙虎榜明细就地展开在**本题材行下面**：左栏看完“几条线”，
                        紧接着看这条线的钱是哪些席位买的，不用跑去右栏找。 */}
                    {isOpen && core && <CorePanel facts={core} genes={geneIndex} fundMaxAbs={fundMaxAbs} />}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

        </Zone>

        <Zone label="环比与详情" dot="bg-up" className="xl:w-[38%]">
          {/* ── 环比视角：列表看「多少」，这张看「扩还是缩」 ── */}
          <Card
            title="📊 题材涨停家数 · 强度变化"
        extra={<CardBadge tone="warn">实心今日 · 空心昨日</CardBadge>}
      >
        {ztBars.length ? (
          <>
            <BarChart
              bars={ztBars}
              height={200}
              format={(v) => `${n1(v)} 家`}
              maxBarWidth={44}
              showValue
            />
            <p className="text-sub text-[11.5px] mt-2">
              <b className="text-up">红</b> = 较昨增加 · <b className="text-down">绿</b> = 较昨减少 · 灰色虚线 = 昨日无样本。
            </p>
          </>
        ) : (
          <EmptyState text="无题材数据" hint="latest.json 的 top5 为空" />
        )}
      </Card>

      {expanded && (
        <Card
          title={`${expanded.name} · 题材详情`}
          extra={<DeltaBadge cur={expanded.zt_count} prev={expanded.zt_prev} />}
        >
          {/* 龙头逻辑为实时快照原文；题材催化已随左侧每张强度卡展示。 */}
          {expanded.leader?.desc && (
            <div className="rounded-sm border border-lead/35 bg-lead/[0.035] px-3 py-2.5 mb-3">
              <div className="text-[11.5px] text-lead font-semibold mb-1">龙头炒作逻辑</div>
              <div className="text-[12.5px] leading-relaxed text-txt">{expanded.leader.desc}</div>
            </div>
          )}

          {/* ── 龙头详况 ── */}
          <div className="border border-line rounded-sm px-2.5 py-2 mb-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
              <span className="text-lead text-[12.5px] font-semibold">龙头</span>
              <StockLink code={expanded.leader?.code} className="text-[14px] font-semibold text-rec">{expanded.leader?.name ?? '—'}</StockLink>
              {expanded.leader?.boards && <Tag tone="up">{expanded.leader.boards}</Tag>}
              <StatPair
                label="涨幅"
                value={expanded.leader?.pct != null ? `${n1(expanded.leader.pct)}%` : '—'}
                tone={(expanded.leader?.pct ?? 0) > 0 ? 'up' : 'down'}
              />
              <StatPair label="价" value={expanded.leader?.price ?? '—'} />
              <StatPair label="换手" value={expanded.leader?.turn != null ? `${n1(expanded.leader.turn)}%` : '—'} />
              <StatPair label="市值" value={expanded.leader?.cap_yi != null ? `${n1(expanded.leader.cap_yi)}亿` : '—'} />
              {expanded.leader?.seal && <span className="text-[12px]">{expanded.leader.seal}</span>}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {/* ── 跟风股 ── */}
            <div>
              <div className="text-[12px] text-sub mb-1">跟风股（换手越高 = 接力意愿越强）</div>
              <DataTable
                rows={expanded.followers ?? []}
                rowKey={(r, i) => `${r.name}-${i}`}
                dense
                empty="无跟风股"
                columns={[
                  { label: '个股', cell: (r) => <span className="text-rec">{r.name}</span> },
                  {
                    label: '涨幅',
                    num: true,
                    cell: (r) => (
                      <span className={r.pct > 0 ? 'text-up' : r.pct < 0 ? 'text-down' : 'text-txt'}>{n1(r.pct)}%</span>
                    ),
                  },
                  { label: '换手', num: true, cell: (r) => `${n1(r.turn)}%` },
                ]}
              />
            </div>

            {/* ── 涨停股清单 ── */}
            <div>
              <div className="text-[12px] text-sub mb-1">当日涨停股（{expanded.zt_stocks?.length ?? 0}）</div>
              <DataTable
                rows={tradableStocks(expanded.zt_stocks)}
                rowKey={(r) => r.code}
                dense
                empty="无涨停股明细"
                columns={[
                  {
                    label: '个股',
                    cell: (r) => (
                      <span>
                        <StockLink code={r.code} className="text-rec">{r.name}</StockLink>
                      </span>
                    ),
                  },
                  {
                    label: '涨幅',
                    num: true,
                    cell: (r) => <span className="text-up font-semibold">{n1(r.pct)}%</span>,
                  },
                ]}
              />
            </div>
          </div>

          {/* ── 定性结论（原系统生成，不做改写）── */}
          <div className="mt-3 grid md:grid-cols-3 gap-3">
            {expanded.diffusion && (
              <div className="border border-line rounded-sm px-2.5 py-2 md:col-span-3">
                <div className="text-[12px] text-sub mb-0.5">扩散路径</div>
                <div className="text-[12.5px] leading-relaxed">{expanded.diffusion}</div>
              </div>
            )}
            {!!expanded.positives?.length && (
              <div className="border border-line rounded-sm px-2.5 py-2">
                <div className="text-[12px] text-up mb-0.5">正向因素</div>
                <ul className="text-[12.5px] leading-relaxed">
                  {expanded.positives.map((p, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!expanded.risks?.length && (
              <div className="border border-line rounded-sm px-2.5 py-2">
                <div className="text-[12px] text-warn mb-0.5">风险因素</div>
                <ul className="text-[12.5px] leading-relaxed">
                  {expanded.risks.map((p, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-sub text-[11px] mt-2 leading-relaxed">
            扩散路径 / 正向因素 / 风险因素由原系统脚本生成，本页原样呈现不做改写 ——
            改写会掩盖当时的判断依据。
          </p>
        </Card>
      )}
        </Zone>
      </ZoneRow>
    </div>
  )
}

/**
 * 环比徽标 —— `prev == null` 时**不能**说「持平」（2026-10-18 修）。
 *
 * 旧实现把 `prev == null` 与 `cur - prev === 0` 都归到 `sub` 分支，
 * 于是详情卡出现「环比持平（null 家）」—— 把「昨日没有这条线」说成了「家数没变」。
 */
function DeltaBadge({ cur, prev }: { cur: number | null | undefined; prev: number | null | undefined }) {
  if (prev == null) return <CardBadge tone="neutral">昨日无此题材</CardBadge>
  const tone = deltaTone(cur, prev)
  if (tone === 'sub') return <CardBadge tone="neutral">环比持平（{prev} 家）</CardBadge>
  return <CardBadge tone={tone}>环比 {deltaText(cur, prev)}</CardBadge>
}

function netTone(v: number | null): string {
  if (v === null || v === 0) return 'text-sub'
  return v > 0 ? 'text-up' : 'text-down'
}

/**
 * 题材行下方就地展开的「核心辨识度个股」面板。
 *
 * ## 顺序：个股在前，资金流在后
 *
 * 这张面板是**选股动作**的落点 —— 先看这条线里谁是真的核心（谁在领、几个板），
 * 再看钱有没有进来。把资金流放前面会让人先看宏观再看标的，本末倒置。
 *
 * ## 排序按辨识度地位，不按涨幅
 *
 * 20cm 小票涨幅常比 6 天 4 板的龙头更大，但「辨识度」看的是**地位**：
 * 连板高度 → 龙头身份 → 涨幅。否则列表第一行永远是一只没人在意的 20cm。
 *
 * ## 不重复
 *
 * 行摘要里**不再**重复股数与资金额 —— 展开面板给了完整信息，折叠状态只保留
 * 系统原有的涨停/环比/龙头字段。同一笔数据在页面上只出现一次。
 */
function CorePanel({ facts, genes, fundMaxAbs }: {
  facts: ThemeCoreFacts
  genes: Map<string, GeneFacts>
  fundMaxAbs: number
}) {
  const tiers: Array<{ label: string; stocks: ThemeCoreFacts['stocks'] }> = []
  for (const tier of ['连板', '首板', '未封·强势'] as const) {
    const stocks = facts.stocks.filter((s) => tierOf(s) === tier)
    if (stocks.length) tiers.push({ label: tier, stocks })
  }
  const fund = facts.fund
  const fundPct = fund && fundMaxAbs > 0 && fund.flowYi !== null
    ? Math.min(100, (Math.abs(fund.flowYi) / fundMaxAbs) * 100)
    : 0

  return (
    <div className="border-t border-line px-2.5 py-2 flex flex-col gap-2">
      {tiers.length > 0 ? tiers.map((tier) => (
        <section key={tier.label} aria-label={`核心个股·${tier.label}`} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-[10.5px] text-sub">
            <span>{tier.label}</span>
            <span className="num">{tier.stocks.length}</span>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
            {tier.stocks.map((s) => {
              const g = genes.get(s.code)
              return (
                <li key={s.code} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px]">
                  <StockLink code={s.code} className={cn('text-rec', s.role === 'theme-leader' && 'font-semibold')}>{s.name}</StockLink>
                  {s.boards && <span className="text-[10.5px] text-up">{s.boards}</span>}
                  <span className={cn('num text-[11px] font-semibold', netTone(s.pct))}>
                    {s.pct === null ? '—' : `${s.pct > 0 ? '+' : ''}${n1(s.pct)}%`}
                  </span>
                  {s.turn !== null && <span className={cn('num text-[10.5px]', s.turn >= 20 ? 'text-warn' : 'text-sub')}>换 {n1(s.turn)}%</span>}
                  {s.is20cm && <span className="text-[10px] text-warn">20cm</span>}
                  {s.buyable === false && <span className="text-[10px] text-sub">封死</span>}
                  {g && (
                    <span className="text-[10px] text-sub" title={`近250日涨停 ${g.zt250} 次 · 历史最高 ${g.maxBoards} 板${g.promoRate === null ? '' : ` · 晋级率 ${n1(g.promoRate)}%`}`}>
                      年涨停 <b className={cn('num font-normal', g.zt250 >= 15 ? 'text-txt' : 'text-sub')}>{g.zt250}</b>
                      {g.promoRate !== null && <> · 晋级 <b className={cn('num font-normal', g.promoRate >= 40 ? 'text-up' : 'text-sub')}>{n1(g.promoRate)}%</b></>}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )) : (
        <p className="text-[12px] text-sub m-0">该题材暂无核心辨识度标的</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-faint pt-1.5 text-[11.5px] text-sub">
        <span className="flex-none">资金流</span>
        {fund ? (
          <>
            <span className="text-txt flex-none">{fund.board}</span>
            <span className={cn('num flex-none', netTone(fund.pct))}>
              {fund.pct === null ? '—' : `${fund.pct > 0 ? '+' : ''}${n2(fund.pct)}%`}
            </span>
            <span className="flex items-center gap-1.5 min-w-0">
              <b className={cn('num flex-none', netTone(fund.flowYi))}>{yiText(fund.flowYi)}</b>
              <span className="h-[4px] w-[64px] rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
                <span
                  className="block h-full rounded-sm"
                  style={{ width: `${fundPct}%`, background: (fund.flowYi ?? 0) >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}
                />
              </span>
              <span className="text-[10px] text-sub flex-none" title="仅在本页题材之间相对比较">页内相对</span>
            </span>
          </>
        ) : (
          <span>该题材无同名板块资金口径</span>
        )}
      </div>
    </div>
  )
}

/** 亿位文本：缺失一律「—」，⛔ 不写 0.00 */
function yiText(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${n2(v)}亿`
}
