import { useQuery } from '@tanstack/react-query'
import { analyticsQueries, AuctionMoneyCard, buildAuctionRows, DataTable, Tag } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import type { DecisionDossier, EarlyItem, PoolCallFile } from '@/shared/api'
import { Card, CardBadge, EmptyState, StockLink } from '@/shared/ui'
import { AuctionPremiumCard } from './AuctionPremiumCard'
import { cn, fmtPct, tradableStocks } from '@/shared/lib'

/**
 * 今日执行 —— 09:25 竞价到底怎么走的。
 *
 * ## 2026-11-04 用户「auction 命中挺准…按你的思路合并到 AI 这一个页面」
 *
 * 原 `/auction` 与 `/ai` 是**同一份决策档案的两个副本**：
 * 环境定调 / 接力池 / 观察池三块完全重复，只有「执行时点」的视角是它独有的。
 * 现在只把这部分抽出来，挂在 AI 页的「今日执行」tab：
 *
 * | 模块 | 回答什么 | 为什么不能省 |
 * |---|---|---|
 * | **竞价资金榜** | 09:25 钱往哪去 | 唯一能验证「昨天选的票今早有没有人要」的地方 |
 * | **早鸟埋伏** | 爆发前夜的埋伏位 | 决策档案独有字段，接力池里没有 |
 * | **盘中候选池** | 盘中滚动候选 | 盘中口径与盘后不同，混在一起会误读 |
 * | **全局旁白** | 决策原件的自然语言 | 复盘时读「当时怎么想的」唯一来源 |
 *
 * ⛔ 不搬 `竞价实时报价`：该链路（`auction_live.json`）已停更，照常渲染会把
 *    19 天前的报价当今日竞价展示 —— 比空卡更危险的失真。
 * ⛔ 不搬「影子排序对照」「环境指纹」：那是 P2-13 的观察入口，与今日执行无关。
 */

export function ExecutionPanel({
  dossier,
  callFile,
}: {
  dossier?: DecisionDossier
  callFile?: PoolCallFile
}) {
  const auctionHist = useQuery(analyticsQueries.decisionAuctionHistory())
  const cands = useQuery(marketQueries.candidates())
  const ztYesterday = useQuery(marketQueries.yesterday())

  /** code → 名称：优先决策档案，再用昨日涨停池兜底（竞价文件只有代码） */
  const nameByCode = new Map<string, string>()
  for (const s of [...(dossier?.relay ?? []), ...(dossier?.watch ?? [])]) {
    if (s.code) nameByCode.set(s.code, s.name)
  }
  for (const c of cands.data?.candidates ?? []) nameByCode.set(c.code, c.name)
  for (const z of ztYesterday.data?.zt_list ?? []) nameByCode.set(z.code, z.name)

  /**
   * 竞价资金榜：`decision/auction-history` 按文件名升序返回多日存档 → 取最后一份。
   * ⛔ 只用真实落盘字段（prev_close / auction_price / auction_amount_yi），
   *    净额需要逐笔委托方向，我们不造。
   */
  const auctionFiles = (auctionHist.data ?? []) as Array<{
    file?: string
    data?: Record<
      string,
      { prev_close: number | null; auction_price: number | null; auction_amount_yi: number | null; time?: string }
    >
  }>
  const latestAuction = [...auctionFiles]
    .sort((a, b) => (a.file ?? '').localeCompare(b.file ?? ''))
    .at(-1)
  const auctionDate = /(\d{4}-\d{2}-\d{2})/.exec(latestAuction?.file ?? '')?.[1] ?? null

  /**
   * 池内裁决 → 竞价榜。
   * ⛔ 必须按 `trade_date` 对齐：日期不同就不合并，否则昨天的「参与」
   *    会被标到今天的竞价榜上，页面看起来正常但结论是错的。
   */
  const poolViews =
    callFile && auctionDate && callFile.trade_date === auctionDate ? callFile.views : null
  const auctionMoneyRows = buildAuctionRows(latestAuction?.data, nameByCode, { pool: poolViews })

  const cf = cands.data
  const early: EarlyItem[] = dossier?.early_ambush ?? []

  return (
    <div className="flex flex-col gap-3">
      {/* ① 昨日连板 · 今晨竞价溢价（2026-11-04 用户）——
             回答「昨天连板那批票，今早是溢价接还是折价跑」。
             ⛔ 放在资金榜之前：先看**这条线还认不认**，再看钱去了哪。 */}
      <AuctionPremiumCard board={callFile?.meta?.premium_board} />

      {/* ② 竞价资金榜 —— 今天 9:25 钱往哪去 */}
      <AuctionMoneyCard rows={auctionMoneyRows} date={auctionDate} />

      {/* ② 早鸟埋伏 + 盘中候选 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[42%_minmax(0,1fr)]">
        <Card title="早鸟埋伏" extra={<CardBadge tone="rec">{early.length} 条</CardBadge>}>
          {early.length ? (
            <ul className="space-y-2">
              {early.map((e) => (
                <li key={`${e.sector}-${e.buy?.code ?? ''}`} className="border-l-2 border-rec pl-2.5 py-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="badge bg-rec-soft text-rec">{e.type}</span>
                    <span className="text-13 font-semibold text-txt">{e.sector}</span>
                    <span className="text-11 text-sub">
                      涨停 {e.zt_in_sector ?? '—'} · 池 {e.count ?? '—'}
                    </span>
                  </div>
                  {e.buy && (
                    <div className="mt-0.5 text-13">
                      <span className="text-sub">关注 </span>
                      <StockLink code={e.buy.code} className="text-txt font-medium">
                        {e.buy.name}
                      </StockLink>
                      <span
                        className={cn(
                          'num ml-1.5 text-12',
                          e.buy.pct > 0 ? 'text-up' : e.buy.pct < 0 ? 'text-down' : 'text-sub',
                        )}
                      >
                        {fmtPct(e.buy.pct)}
                      </span>
                      {e.buy.is_20cm && <span className="badge ml-1 bg-rec-soft text-rec">20cm</span>}
                    </div>
                  )}
                  {e.desc && <p className="mt-0.5 text-12 leading-relaxed text-sub">催化：{e.desc}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text="今日无早鸟埋伏" />
          )}
        </Card>

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
                      <StockLink code={r.code} className="text-txt">
                        {r.name}
                      </StockLink>
                    </span>
                  ),
                },
                { label: '板块', cell: (r) => <Tag>{r.sector || '—'}</Tag> },
                {
                  label: '涨幅',
                  num: true,
                  cell: (r) => <span className={cn(r.pct >= 0 ? 'text-up' : 'text-down')}>{r.pct?.toFixed(1)}%</span>,
                },
                { label: '板数', num: true, cell: (r) => r.boards ?? '—' },
                { label: '状态', cell: (r) => (r.buyable ? <Tag tone="up">可买</Tag> : <Tag>观察</Tag>) },
              ]}
            />
          ) : (
            <EmptyState text="盘中候选池未生成" hint="cache/pulse_snapshots/candidates.json 缺失" />
          )}
        </Card>
      </div>

      {/* ③ 全局旁白 —— 复盘时读「当时怎么想的」唯一来源 */}
      <Card title="全局旁白" extra={<CardBadge>决策原件的自然语言部分</CardBadge>}>
        {dossier?.global_narrative ? (
          <p className="whitespace-pre-line text-13 leading-relaxed text-txt">{dossier.global_narrative}</p>
        ) : (
          <EmptyState text="无全局旁白" />
        )}
      </Card>
    </div>
  )
}
