import { useQuery } from '@tanstack/react-query'
import { queryClient, ROUTES } from '@/shared/api'
import type { CandidatesFile, DecisionDossier, DossierStock, EarlyItem, PoolCallFile, RelayShadow } from '@/shared/api'
import { analyticsQueries, AuctionMoneyCard, buildAuctionRows, DataTable, StatPair, Tag, n1 } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { Card, CardBadge, EmptyState, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, fmtPct, regimeText, tradableStocks } from '@/shared/lib'

/**
 * 竞价 · 候选 · 决策档案 —— 财富密码链的**当日原件**。
 *
 * ## 三个数据源各自回答什么
 *
 *   · `decision/latest`（`wealth_code_candidates_v1`）—— **当时凭什么这么选**：
 *     环境读数 + 接力池（可执行）+ 观察池（待确认）+ 早鸟埋伏 + 诊断计数 + 全局旁白。
 *     这是决策链的单一产出物，也是事后复盘「判断依据」的唯一原件。
 *   · `market/candidates`——盘中候选池（`phase: intraday`，盘中滚动）
 *   · `market/auction`——竞价实时报价（`code → 竞价涨幅`）
 *     ⚠️ 2026-10-14 审计：该链路已停更（无写入方），卡片按 `retired` 降级渲染。
 *     真实竞价数据在 `/api/decision/auction-history`（`auction_quotes-<date>.json`）。
 *
 * ## ⚠️ 两套情绪读数必须并列（不可只留一套）
 *
 * `environment`（脚本自算）与 `real_env`（盘中快照）是**两套独立读数** ——
 * 两者背离本身就是「脚本环境失真」的证据。只展示一套会掩盖这个信号。
 *
 * ## ⚠️ 已知字段陷阱
 *
 *   · `DossierStock.price` 实测**恒为 null**（选股阶段未回填）→ 渲染「—」，不是 0
 *   · `real_env.limit_down` / `broken` 形态不统一（可能是数字，也可能是 `{count,names}`）
 *     → 用 `cnt()` 统一兜底，避免渲染出 `[object Object]`
 */

export async function loader() {
  // 单路失败不拖垮整页（与 /timeline 同口径）
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.decisionLatest()),
    queryClient.ensureQueryData(analyticsQueries.shadowRelay()),
    queryClient.ensureQueryData(marketQueries.candidates()),
    queryClient.ensureQueryData(marketQueries.auction()),
    queryClient.ensureQueryData(analyticsQueries.decisionAuctionHistory()),
    queryClient.ensureQueryData(analyticsQueries.decisionPoolCall()),
  ])
  return null
}

/** 数值兜底：非数字一律「—」 */
function num(v: unknown): string {
  return typeof v === 'number' ? n1(v) : '—'
}

/** 计数兜底：兼容 `number` 与 `{count}` 两种形态（实测两种都出现过） */
function cnt(v: unknown): string {
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object' && 'count' in v) {
    const c = (v as { count?: unknown }).count
    return typeof c === 'number' ? String(c) : '—'
  }
  return '—'
}

/** 与猎手选池同源：先聚焦板块龙和空间高度，再比较带动、题材广度与综合分。 */
function leaderFirst(rows: DossierStock[]): DossierStock[] {
  return [...rows].sort((a, b) =>
    Number(b.is_sector_dragon) - Number(a.is_sector_dragon)
    || b.boards - a.boards
    || b.carry_cnt - a.carry_cnt
    || b.theme_mates_cnt - a.theme_mates_cnt
    || b.lead_score - a.lead_score
    || b.score - a.score,
  ).map((row, index) => ({ ...row, leader_preference_rank: row.leader_preference_rank ?? index + 1 }))
}

export function Component() {
  const dossier = useQuery(analyticsQueries.decisionLatest())
  const shadowQ = useQuery(analyticsQueries.shadowRelay())
  const cands = useQuery(marketQueries.candidates())
  const auction = useQuery(marketQueries.auction())
  const auctionHist = useQuery(analyticsQueries.decisionAuctionHistory())
  /** 当日 09:25 池内裁决 —— 给竞价榜贴「该不该跟」；只有 trade_date 与竞价文件同日才可用 */
  const poolCall = useQuery(analyticsQueries.decisionPoolCall())
  /** 竞价文件只有代码，名称优先用「昨日涨停池」（覆盖当日竞价大名单）补齐 */
  const ztYesterday = useQuery(marketQueries.yesterday())

  const d: DecisionDossier | undefined = dossier.data
  /** 接力权重影子模式（只观察·不改产池 · 升级项 P2-13 的观测入口） */
  const shadow: RelayShadow | undefined = shadowQ.data
  const cf: CandidatesFile | undefined = cands.data
  const au = auction.data
  const env = d?.environment
  const renv = d?.real_env
  const relayRows = leaderFirst(d?.relay ?? [])
  const watchRows = leaderFirst(d?.watch ?? [])

  /** 竞价报价只有代码没有名称 —— 用接力池/观察池/候选池的名单补齐 */
  const nameByCode = new Map<string, string>()
  for (const s of [...(d?.relay ?? []), ...(d?.watch ?? [])]) nameByCode.set(s.code, s.name)
  for (const c of cf?.candidates ?? []) nameByCode.set(c.code, c.name)
  for (const z of ztYesterday.data?.zt_list ?? []) nameByCode.set(z.code, z.name)
  const quotes = Object.entries(au?.quotes ?? {}).map(([code, pct]) => ({
    code,
    name: nameByCode.get(code) ?? '—',
    pct,
  }))

  /**
   * 竞价资金榜（2026-10-19）。
   *
   * `decision/auction-history` 按文件名升序返回多日存档 → 取最后一份（最新交易日）。
   * ⛔ 只用**真实落盘字段**（prev_close / auction_price / auction_amount_yi）：
   *    净额需要逐笔委托方向，我们不造（见 lib/auction-money.ts 头注）。
   */
  const auctionFiles = (auctionHist.data ?? []) as Array<{
    file?: string
    data?: Record<string, { prev_close: number | null; auction_price: number | null; auction_amount_yi: number | null; time?: string }>
  }>
  const latestAuction = [...auctionFiles].sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '')).at(-1)
  const auctionDate = /(\d{4}-\d{2}-\d{2})/.exec(latestAuction?.file ?? '')?.[1] ?? null

  /**
   * 池内裁决 → 竞价榜。
   *
   * ⛔ **必须按 `trade_date` 对齐竞价文件日期**：日期不同就不合并。
   *    理由是这一条一旦放松，昨天的「参与」会被标到今天的竞价榜上，页面看起来完全正常，
   *    但结论是错的 —— 属于最难发现的一类错（`pool_call.trade_date` = 执行日，不是预案写作日）。
   */
  const poolFiles = (poolCall.data ?? []) as Array<{ data?: PoolCallFile | null }>
  const latestPool = [...poolFiles]
    .filter((f) => f.data)
    .sort((a, b) => (a.data!.trade_date ?? '').localeCompare(b.data!.trade_date ?? ''))
    .at(-1)
  const poolViews =
    latestPool?.data && auctionDate && latestPool.data.trade_date === auctionDate
      ? latestPool.data.views
      : null

  const auctionMoneyRows = buildAuctionRows(latestAuction?.data, nameByCode, { pool: poolViews })

  const dg = d?.diagnostics as Record<string, unknown> | undefined

  /**
   * ⚠️ 2026-10-14 审计（A3）：`auction_live.json` **在产侧已无写入方**，
   * 文件停在 2026-09-25 15:30（46 B）。它会一直「存在」，若照常渲染，
   * 页面就会把 19 天前的报价当成今日竞价 —— 这是比「空卡」更危险的失真。
   * 故按 `routes.ts` 的 `retired` 标记降级：明示停更 + 指向真实源。
   */
  const auctionRetired = ROUTES['/api/market/auction']?.retired === true

  return (
    <div className="flex flex-col gap-3">
      {/* 竞价资金榜：09:25 钱往哪去（通栏，按竞额降序，暖黄=高开且有量） */}
      <AuctionMoneyCard rows={auctionMoneyRows} date={auctionDate} />

      {/* 档案定性通栏：脚本环境 vs 真实盘面 —— 两套读数并列才有意义 */}
      <Card
        title="⚡ 决策档案 · 环境与定调"
        extra={
          <span className="flex items-center gap-2">
            <CardBadge tone={d?.regime === 'risk_on' ? 'up' : d?.regime === 'ice' ? 'down' : 'neutral'}>
              {regimeText(d?.regime)}
            </CardBadge>
            <span className="text-[11px] text-sub">
              {d?.date ?? '—'} · {d?.generated_at_bj ?? '—'}
            </span>
          </span>
        }
      >
        {d ? (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
              <div>
                <div className="text-[11px] text-sub mb-1">脚本环境（选股输入）</div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <StatPair label="情绪分" value={num(env?.sentiment_score)} />
                  <StatPair label="标签" value={env?.sentiment_label ?? '—'} />
                  <StatPair label="晋级率" value={env?.promote_rate != null ? `${num(env.promote_rate)}%` : '—'} />
                  <StatPair label="核按钮" value={num(env?.nuke_count)} tone="down" />
                  <StatPair label="涨停" value={num(env?.now_zt_count)} tone="up" />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-sub mb-1">真实盘面（盘中快照）</div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <StatPair label="情绪分" value={num(renv?.sentiment_score)} />
                  <StatPair label="情绪" value={renv?.sentiment ?? '—'} />
                  <StatPair label="涨停" value={cnt(renv?.total_zt)} tone="up" />
                  <StatPair label="跌停" value={cnt(renv?.limit_down)} tone="down" />
                  <StatPair label="炸板" value={cnt(renv?.broken)} tone="down" />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-sub mb-1">池规模</div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <StatPair label="接力池" value={(d.relay ?? []).length} tone="up" />
                  <StatPair label="观察池" value={(d.watch ?? []).length} />
                  <StatPair label="早鸟" value={(d.early_ambush ?? []).length} tone="rec" />
                  <StatPair label="数据源" value={d.data_source ?? '—'} />
                </div>
              </div>
              <div>
                <div className="text-[11px] text-sub mb-1">诊断计数</div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <StatPair label="参与评分" value={num(dg?.['scored'])} />
                  <StatPair label="严格池" value={num(dg?.['strict_pool'])} />
                  <StatPair label="均原始分" value={num(dg?.['mean_raw_score'])} />
                  <StatPair label="选择模式" value={String(dg?.['selection_mode'] ?? '—')} />
                </div>
              </div>
            </div>
            <p className="text-sub text-[11px] leading-relaxed mt-2">
              脚本环境与真实盘面是**两套独立读数** —— 两者背离即「脚本环境失真」的证据，
              故并列展示而不合并。
            </p>
          </>
        ) : (
          <EmptyState text="决策档案未生成" hint="wealth_code/cache/candidates-*.json 缺失" />
        )}
      </Card>

      <ZoneRow>
        <Zone label="接力池 · 可执行" dot="bg-up" className="xl:w-[62%]">
          <Card
            title="🎯 接力池"
            extra={<CardBadge tone="up">{(d?.relay ?? []).length} 只 · 龙头优先排序</CardBadge>}
          >
            {d?.relay?.length ? (
              <DataTable
                rows={tradableStocks(relayRows)}
                rowKey={(r) => r.code}
                dense
                empty="无接力标的"
                columns={[
                  {
                    label: '标的',
                    cell: (r) => (
                      <span>
                        {r.leader_preference_rank != null && <span className="num text-rec mr-1">#{r.leader_preference_rank}</span>}
                        <StockLink code={r.code} className="text-up">{r.name}</StockLink>
                      </span>
                    ),
                  },
                  { label: '题材', cell: (r) => <Tag>{r.theme || '—'}</Tag> },
                  {
                    label: '综合分',
                    num: true,
                    cell: (r) => <span className="text-up font-semibold">{num(r.score)}</span>,
                  },
                  { label: '点火', num: true, cell: (r) => num(r.ign_score) },
                  { label: '预期', num: true, cell: (r) => num(r.exp_score) },
                  { label: '带动', num: true, cell: (r) => num(r.lead_score) },
                  { label: '梯队', num: true, cell: (r) => (r.themeTier ? `T${r.themeTier}` : '—') },
                  { label: '板数', num: true, cell: (r) => (r.boards ? <span className="text-up">{r.boards}</span> : '—') },
                  { label: '首封', cell: (r) => <span className="num text-sub">{r.fbt || '—'}</span> },
                  {
                    label: '标签',
                    className: 'whitespace-normal min-w-[150px]',
                    cell: (r) =>
                      r.tags?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {r.tags.map((t) => (
                            <Tag key={t} tone="rec">
                              {t}
                            </Tag>
                          ))}
                        </span>
                      ) : (
                        <span className="text-sub">—</span>
                      ),
                  },
                ]}
              />
            ) : (
              <EmptyState text="接力池为空" hint="冰点期可能空池（受 P1-6 产池解冻开关影响）" />
            )}
          </Card>
        </Zone>

        <Zone label="早鸟埋伏 · 爆发前夜" dot="bg-rec" className="xl:w-[38%]">
          <Card
            title="🚀 早鸟埋伏"
            extra={<CardBadge tone="rec">{(d?.early_ambush ?? []).length} 条</CardBadge>}
          >
            {d?.early_ambush?.length ? (
              <ul className="space-y-2">
                {d.early_ambush.map((e: EarlyItem) => (
                  <li
                    key={`${e.sector}-${e.buy?.code ?? ''}`}
                    className="border-l-2 border-rec pl-2.5 py-0.5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="badge bg-rec-soft text-rec">{e.type}</span>
                      <span className="text-[13px] font-semibold text-txt">{e.sector}</span>
                      <span className="text-[11px] text-sub">
                        涨停 {e.zt_in_sector ?? '—'} · 池 {e.count ?? '—'}
                      </span>
                    </div>
                    {e.buy && (
                      <div className="text-[12.5px] mt-0.5">
                        <span className="text-sub">关注 </span>
                        <StockLink code={e.buy.code} className="text-rec font-medium">{e.buy.name}</StockLink>
                        <span
                          className={cn(
                            'num text-[12px] ml-1.5',
                            e.buy.pct > 0 ? 'text-up' : e.buy.pct < 0 ? 'text-down' : 'text-sub',
                          )}
                        >
                          {fmtPct(e.buy.pct)}
                        </span>
                        {e.buy.is_20cm && <span className="badge bg-rec-soft text-rec ml-1">20cm</span>}
                      </div>
                    )}
                    {e.desc && (
                      <p className="text-sub text-[11.5px] leading-relaxed mt-0.5">催化：{e.desc}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="今日无早鸟埋伏" />
            )}
          </Card>
        </Zone>
      </ZoneRow>

      <ZoneRow>
        <Zone label="盘中候选池" dot="bg-lead" className="xl:w-[55%]">
          <Card
            title="候选池 · 盘中"
            extra={
              <CardBadge>
                {cf?.phase ?? '—'} · {cf?.generated_at ?? '—'}
              </CardBadge>
            }
          >
            {cf?.candidates?.length ? (
              <DataTable
                rows={tradableStocks(cf.candidates)}
                rowKey={(r) => r.code}
                dense
                empty="无候选"
                columns={[
                  {
                    label: '标的',
                    cell: (r) => (
                      <span>
                        <StockLink code={r.code} className="text-txt">{r.name}</StockLink>
                      </span>
                    ),
                  },
                  { label: '板块', cell: (r) => <Tag>{r.sector || '—'}</Tag> },
                  {
                    label: '涨幅',
                    num: true,
                    cell: (r) => (
                      <span className={cn(r.pct >= 0 ? 'text-up' : 'text-down')}>{num(r.pct)}%</span>
                    ),
                  },
                  { label: '板数', num: true, cell: (r) => r.boards ?? '—' },
                  {
                    label: '状态',
                    cell: (r) =>
                      r.buyable ? <Tag tone="up">可买</Tag> : <Tag>观察</Tag>,
                  },
                  {
                    label: '20cm',
                    cell: (r) => (r.is_20cm ? <span className="badge bg-rec-soft text-rec">20cm</span> : '—'),
                  },
                ]}
              />
            ) : (
              <EmptyState text="盘中候选池未生成" hint="cache/pulse_snapshots/candidates.json 缺失" />
            )}
          </Card>
        </Zone>

        <Zone label="竞价实时报价" dot={auctionRetired ? 'bg-down' : 'bg-warn'} className="xl:w-[45%]">
          <Card
            title="竞价报价"
            extra={
              <CardBadge tone={auctionRetired ? 'down' : undefined}>
                {auctionRetired ? '已停更 · 仅留档' : `${au?.ts ?? '—'} · ${quotes.length} 只`}
              </CardBadge>
            }
          >
            {auctionRetired ? (
              <EmptyState
                text="该链路已停更"
                hint="盘口竞价实时报价（auction_live.json）已无写入方 · 最后一份 2026-09-25。真实竞价数据请看「竞价报价存档」（/api/decision/auction-history · 每交易日 09:25 落盘）。"
              />
            ) : quotes.length ? (
              <ul className="space-y-1">
                {quotes.map((q) => (
                  <li
                    key={q.code}
                    className="flex items-center justify-between gap-2 py-1 border-b border-line-faint last:border-0"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <StockLink code={q.code} className="text-[13px] text-txt truncate">{q.name}</StockLink>
                    </span>
                    <span
                      className={cn(
                        'num text-[13px] font-medium',
                        q.pct == null ? 'text-sub' : q.pct > 0 ? 'text-up' : q.pct < 0 ? 'text-down' : 'text-sub',
                      )}
                    >
                      {q.pct != null && q.pct > 0 ? '+' : ''}
                      {q.pct == null ? '—' : `${num(q.pct)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="无竞价报价" hint="盘中时段才有；收盘后为空属正常" />
            )}
          </Card>

          <Card
            title="观察池 · 待确认"
            extra={<CardBadge>{(d?.watch ?? []).length} 只</CardBadge>}
          >
            {d?.watch?.length ? (
              <DataTable
                rows={tradableStocks(watchRows)}
                rowKey={(r) => r.code}
                dense
                empty="无观察标的"
                columns={[
                  {
                    label: '标的',
                    cell: (r) => (
                      <span>
                        <StockLink code={r.code} className="text-txt">{r.name}</StockLink>
                      </span>
                    ),
                  },
                  { label: '题材', cell: (r) => <Tag>{r.theme || '—'}</Tag> },
                  { label: '总分', num: true, cell: (r) => num(r.score) },
                  { label: '梯队', num: true, cell: (r) => (r.themeTier ? `T${r.themeTier}` : '—') },
                ]}
              />
            ) : (
              <EmptyState text="观察池为空" />
            )}
          </Card>
        </Zone>
      </ZoneRow>

      {/* 全局旁白：账户 + 盘面 + 结论，分段文本 —— 原样呈现，不改写 */}
      <Card title="🗣️ 全局旁白" extra={<CardBadge>决策原件的自然语言部分</CardBadge>}>
        {d?.global_narrative ? (
          <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-txt">
            {d.global_narrative}
          </p>
        ) : (
          <EmptyState text="无全局旁白" />
        )}
      </Card>

      {/* ── 接力权重影子模式（只观察 · 不改产池）──
          影子模式在**同一份决策输入**上跑另一套接力权重排序，与实际入池并行落盘，
          用来回答「如果换权重，今天会不会选出不一样的票」。
          ⛔ 它不参与任何真实决策 —— 这个前提必须在页面上写明，否则会被当成第二套买入信号。
          对应升级项 P2-13 的观测入口。 */}
      <ZoneRow>
        <Zone label="影子排序对照 · 只观察" dot="bg-mid" className="xl:w-[66%]">
          <Card
            title="🌗 接力权重影子模式"
            extra={
              <CardBadge>{shadow ? `${shadow.date} · ${shadow.mode || 'shadow'}` : '—'}</CardBadge>
            }
          >
            {!shadow ? (
              <EmptyState
                text="影子模式未落盘"
                hint="cache/shadow/relay_shadow_<日期>.json 缺失（该实验非每日运行）"
              />
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                  <StatPair
                    label={`前 ${shadow.diff.top_n_compared} 名一致`}
                    value={shadow.diff.top3_same}
                    tone="rec"
                  />
                  <StatPair
                    label="影子独推"
                    value={shadow.diff.shadow_promoted.length}
                    tone="warn"
                  />
                  <StatPair label="实际独有" value={shadow.diff.eod_only.length} tone="warn" />
                  <StatPair label="实际入池" value={shadow.eod_relay.length} tone="up" />
                </div>

                <div className="border-t border-line-faint pt-2">
                  <div className="text-[11px] text-sub mb-1">
                    影子排序（{shadow.shadow_ranked.length} 只 · 按影子分降序 ·
                    高亮 = 影子会推而实际没推）
                  </div>
                  <DataTable
                    dense
                    rows={shadow.shadow_ranked}
                    rowKey={(r) => r.code}
                    empty="无影子排序"
                    rowClass={(r) =>
                      shadow.diff.shadow_promoted.includes(r.code) ? 'bg-warn-soft' : undefined
                    }
                    columns={[
                      {
                        label: '名称',
                        cell: (r) => (
                          <span className="text-txt">
                            <StockLink code={r.code}>{r.name}</StockLink>
                          </span>
                        ),
                      },
                      { label: '题材', cell: (r) => <span className="text-sub">{r.theme || '—'}</span> },
                      { label: '板数', num: true, cell: (r) => <span className="num">{r.boards}</span> },
                      {
                        label: '影子分',
                        num: true,
                        cell: (r) => <span className="num font-semibold">{n1(r.score)}</span>,
                      },
                      { label: '分档', cell: (r) => <Tag>{r.band || '—'}</Tag> },
                      {
                        label: '过闸',
                        cell: (r) => (
                          <Tag tone={r.pass === false ? 'down' : 'up'}>
                            {r.pass === false ? '否' : '是'}
                          </Tag>
                        ),
                      },
                    ]}
                  />
                </div>

                <div className="border-t border-line-faint pt-2">
                  <div className="text-[11px] text-sub mb-1">
                    实际入池（{shadow.eod_relay.length} 只 · 现行规则产出，即上方接力池）
                  </div>
                  <DataTable
                    dense
                    rows={shadow.eod_relay}
                    rowKey={(r) => r.code}
                    empty="空"
                    columns={[
                      {
                        label: '名称',
                        cell: (r) => (
                          <span className="text-txt">
                            <StockLink code={r.code}>{r.name}</StockLink>
                          </span>
                        ),
                      },
                      { label: '题材', cell: (r) => <span className="text-sub">{r.theme || '—'}</span> },
                      { label: '板数', num: true, cell: (r) => <span className="num">{r.boards}</span> },
                      {
                        label: 'EOD 分',
                        num: true,
                        cell: (r) => <span className="num font-semibold">{n1(r.score_eod)}</span>,
                      },
                      { label: '分档', cell: (r) => <Tag>{r.band || '—'}</Tag> },
                      {
                        label: '过闸',
                        cell: (r) => <Tag tone={r.pass ? 'up' : 'down'}>{r.pass ? '是' : '否'}</Tag>,
                      },
                      {
                        label: '排除原因',
                        cell: (r) => <span className="text-sub">{r.exclude_reason || '—'}</span>,
                      },
                    ]}
                  />
                </div>
              </div>
            )}
          </Card>
        </Zone>

        <Zone label="环境指纹 · 影子判定时的盘面" dot="bg-warn" className="xl:w-[34%]">
          <Card title="🌡 环境指纹" extra={<CardBadge>{shadow?.source_file ?? '—'}</CardBadge>}>
            {!shadow ? (
              <EmptyState text="无环境指纹" />
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                  <StatPair label="regime" value={shadow.env_digest.regime || '—'} />
                  <StatPair
                    label="情绪分"
                    value={n1(shadow.env_digest.sentiment_score)}
                    tone="rec"
                  />
                  <StatPair label="情绪定性" value={shadow.env_digest.sentiment_label || '—'} />
                  <StatPair label="晋级率" value={`${n1(shadow.env_digest.promote_rate)}%`} />
                  <StatPair label="核按钮" value={shadow.env_digest.nuke_count} tone="down" />
                  <StatPair label="当时涨停" value={shadow.env_digest.now_zt_count} tone="up" />
                  <StatPair label="最高板" value={`${shadow.env_digest.max_boards} 板`} />
                </div>

                <div className="border-t border-line-faint pt-2">
                  <div className="text-[11px] text-sub mb-1">影子分档计数</div>
                  {Object.keys(shadow.bands ?? {}).length === 0 ? (
                    <div className="text-sub text-[12px]">—</div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {Object.entries(shadow.bands).map(([band, n]) => (
                        <div key={band} className="flex items-baseline justify-between gap-2">
                          <Tag>{band}</Tag>
                          <span className="num text-[12.5px]">{n} 只</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-line-faint pt-1.5 text-sub text-[11px] leading-relaxed">
                  环境指纹是影子判定当时的盘面快照 —— 复盘影子排序是否合理时，
                  必须先看当时的 regime 与情绪分，否则等于用今天的盘面评判当时的排序。
                </div>
              </div>
            )}
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
