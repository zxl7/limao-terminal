import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { AccountNavEntry } from '@/shared/api'
import { analyticsQueries, DataTable, Tag, n1, n2, pct } from '@/features/analytics'
import { BarChart, Card, CardBadge, EmptyState, LineChart } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 交易战绩 —— 数据源 `wealth_code/cache/account_nav_history.jsonl` + `account_metrics.json`。
 *
 * ## 这是**脚本轨**的净值（与「AI 台账」页的 AI 轨是两本独立账）
 *
 * 两者的差别不在收益率高低，而在**成交集合的来源**：
 *   · 脚本轨 → 机械口径（系统规则判定可买 → 竞价涨幅达标 → 成交）
 *   · AI 轨   → AI 判断口径（AI 判 participate 且竞价达标 → 成交）
 *
 * ## ⚠️ `caliber` 字段必须展示出来
 *
 * 原系统 2026-09-14 起把账本口径切到 AI，但**历史行仍是机械口径**。
 * 因此每行都带 `caliber` 标记：
 *   · `ai`                  → AI 口径（09-14 之后）
 *   · `mechanical_fallback` → 该执行日缺 AI 决策行，**回退机械口径并告警**
 *
 * 不区分口径地混算累计收益是错的 —— 本页因此把口径做成显式列，而非脚注。
 *
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.accountNav())
  return null
}

const CALIBER_LABEL: Record<string, { text: string; tone: 'up' | 'rec' | 'warn' }> = {
  ai: { text: 'AI 口径', tone: 'up' },
  mechanical_fallback: { text: '机械回退', tone: 'warn' },
}

export function Component() {
  const nav = useQuery(analyticsQueries.accountNav())

  const rows = useMemo(
    () => [...(nav.data ?? [])].sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    [nav.data],
  )
  const last = rows.at(-1)

  /** 胜率：当日均收益 > 0 的结算日占比（空仓日不计入分母） */
  const winRate = useMemo(() => {
    const traded = rows.filter((r) => r.stock_count > 0)
    if (!traded.length) return null
    return (traded.filter((r) => r.avg_return_pct > 0).length / traded.length) * 100
  }, [rows])

  /** 口径切换点 —— 用于在表格里显式提示「此前为机械口径」 */
  const firstAiIdx = rows.findIndex((r) => r.caliber === 'ai')

  /**
   * 全部实际交易按成交先后串成一条线：同一结算日的多只股票也拆为多个点。
   *
   * 账本净值是「按日等权」的账户口径，不能冒充“所有交易”；这里单独用逐票
   * `return_pct` 连乘，旧账本缺逐票收益时回退为当日平均收益，并标注口径。
   * 不另画回撤。
   */
  const tradeChart = useMemo(() => {
    const result = rows.reduce(
      (total, day) => {
        const stocks = day.stocks?.length
          ? day.stocks.map((stock) => ({
              label: `${day.trade_date.slice(5)} ${stock.name || stock.code}`,
              returnPct: stock.return_pct,
            }))
          : Array.from({ length: day.stock_count }, (_, index) => ({
              label: `${day.trade_date.slice(5)} ${day.names[index] || day.codes[index] || `交易${index + 1}`}`,
              returnPct: undefined,
            }))
        const next = stocks.reduce(
          (dayTotal, stock) => {
            const hasStockReturn = Number.isFinite(stock.returnPct)
            const returnPct = hasStockReturn ? Number(stock.returnPct) : day.avg_return_pct
            const point = { label: stock.label, nav: dayTotal.nav * (1 + returnPct / 100) }
            return {
              nav: point.nav,
              fallbackCount: dayTotal.fallbackCount + (hasStockReturn ? 0 : 1),
              points: [...dayTotal.points, point],
            }
          },
          { nav: total.nav, fallbackCount: total.fallbackCount, points: total.points },
        )
        return next
      },
      { nav: 1, fallbackCount: 0, points: [] as Array<{ label: string; nav: number }> },
    )
    const tail = result.points.at(-1)?.nav
    const tone = tail == null ? ('sub' as const) : tail >= 1 ? ('up' as const) : ('down' as const)
    return {
      labels: result.points.map((point) => point.label),
      navs: result.points.map((point) => point.nav),
      tone,
      fallbackCount: result.fallbackCount,
    }
  }, [rows])

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="📈 净值闭环（脚本轨）"
        extra={
          <CardBadge tone={last && last.nav >= 1 ? 'up' : 'down'}>
            净值 {last ? n2(last.nav) : '—'}
          </CardBadge>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-2 mb-2 text-[12.5px]">
          <Metric
            label="累计收益"
            value={last ? pct((last.nav - 1) * 100) : '—'}
            cls={last && last.nav >= 1 ? 'text-up' : 'text-down'}
          />
          <Metric
            label="胜率（有成交日）"
            value={winRate == null ? '—' : `${winRate.toFixed(0)}%`}
            cls={winRate != null && winRate >= 50 ? 'text-up' : 'text-txt'}
          />
          <Metric label="结算日数" value={String(rows.length)} />
          <Metric label="最新结算日" value={last?.trade_date ?? '—'} />
          <Metric label="最新决策日" value={last?.recommendation_date ?? '—'} />
          <Metric
            label="最新成交"
            value={last ? `${last.stock_count} 只` : '—'}
            cls={last && last.stock_count > 0 ? 'text-txt' : 'text-sub'}
          />
        </div>

        {firstAiIdx > 0 && (
          <p className="text-warn text-[11.5px] leading-relaxed border-l-2 border-warn pl-2.5 mb-2">
            口径分界：本账自 <span className="num font-semibold">{rows[firstAiIdx].trade_date}</span> 起采用
            AI 口径，其前 {firstAiIdx} 个结算日为**机械口径**。两者混算的累计收益不具可比性 ——
            本页按原系统留痕原样展示，不做口径折算。
          </p>
        )}

      </Card>

      {/* 净值走势、收益分布与结算流水均展示真实成交结果。 */}
          <Card
            title="📈 全部交易走势"
            extra={
              <CardBadge tone={tradeChart.tone === 'up' ? 'up' : tradeChart.tone === 'down' ? 'down' : 'neutral'}>
                {tradeChart.navs.length} 笔实际交易
              </CardBadge>
            }
          >
            {tradeChart.navs.length ? (
              <>
                <LineChart
                  labels={tradeChart.labels}
                  series={[{ name: '逐笔净值', values: tradeChart.navs, tone: tradeChart.tone, area: true }]}
                  height={260}
                  showLegend={false}
                  format={(v) => v.toFixed(3)}
                  yTickCount={5}
                  refLines={[{ value: 1, label: '本金线 1.00', tone: 'sub' }]}
                />
                <p className="text-sub text-[11.5px] mt-1.5 leading-relaxed">
                  每个点对应一笔实际成交，按成交先后以单票收益连续计算；同日多只股票不再合并成一个点。
                  {tradeChart.fallbackCount > 0 && ` 其中 ${tradeChart.fallbackCount} 笔旧记录缺逐票收益，暂按当日平均收益绘制。`}
                </p>
              </>
            ) : (
              <EmptyState text="交易账本为空" hint="account_nav_history.jsonl 未生成" />
            )}
          </Card>

      {/* ── 逐日收益：双向柱状（正红负绿）── */}
      <Card
        title="📊 逐日收益分布"
        extra={
          <CardBadge tone={winRate != null && winRate >= 50 ? 'up' : 'neutral'}>
            胜率 {winRate == null ? '—' : `${winRate.toFixed(0)}%`}
          </CardBadge>
        }
      >
        {rows.length ? (
          <>
            <BarChart
              bars={rows.map((r) => ({
                label: r.trade_date.slice(5),
                value: r.avg_return_pct,
                /* 空仓日无收益概念，用中性色而非红绿 —— 否则「没成交」会被读成「跌了」 */
                tone: r.stock_count === 0 ? ('sub' as const) : undefined,
              }))}
              height={170}
              format={(v) => `${n1(v)}%`}
              maxBarWidth={26}
            />
            <p className="text-sub text-[11.5px] mt-1.5 leading-relaxed">
              双向轴：<b className="text-up">正收益=红</b> / <b className="text-down">负收益=绿</b>
              （A 股口径）。<b>空仓日以中性色呈现</b> —— 空仓不是亏损，把它染绿会让「胜率」与
              「收益」两条线互相污染。虚线短横代表该日无样本。
            </p>
          </>
        ) : (
          <EmptyState text="无逐日收益记录" />
        )}
      </Card>

      <Card title="结算流水" extra={<CardBadge>{rows.length} 日</CardBadge>}>
        <DataTable<AccountNavEntry>
          rows={[...rows].reverse()}
          rowKey={(r) => r.trade_date}
          empty="尚无结算记录"
          columns={[
            { label: '结算日', cell: (r) => <span className="num">{r.trade_date}</span> },
            { label: '决策日', cell: (r) => <span className="num text-sub">{r.recommendation_date}</span> },
            {
              label: '口径',
              cell: (r) => {
                const c = r.caliber ? CALIBER_LABEL[r.caliber] : null
                return c ? (
                  <Tag tone={c.tone} title={r.note}>
                    {c.text}
                  </Tag>
                ) : (
                  <span className="text-sub text-[11.5px]">机械</span>
                )
              },
            },
            {
              label: '成交',
              num: true,
              cell: (r) => <span className={r.stock_count === 0 ? 'text-sub' : 'text-txt'}>{r.stock_count}</span>,
            },
            {
              label: '均收益',
              num: true,
              cell: (r) => (
                <span
                  className={cn(
                    r.avg_return_pct > 0 ? 'text-up' : r.avg_return_pct < 0 ? 'text-down' : 'text-txt',
                  )}
                >
                  {pct(r.avg_return_pct)}
                </span>
              ),
            },
            {
              label: '净值',
              num: true,
              cell: (r) => (
                <span className={cn('num font-semibold', r.nav >= 1 ? 'text-up' : 'text-down')}>
                  {n2(r.nav)}
                </span>
              ),
            },
            {
              label: '成交标的',
              className: 'whitespace-normal min-w-[240px]',
              cell: (r) =>
                r.names?.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.names.map((n, i) => (
                      // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                      <Tag key={`${n}-${i}`}>{n}</Tag>
                    ))}
                  </span>
                ) : (
                  <span className="text-sub">空仓</span>
                ),
            },
          ]}
        />
        {!nav.isLoading && !rows.length && (
          <EmptyState text="净值账本为空" hint="wealth_code/cache/account_nav_history.jsonl 未生成" />
        )}
      </Card>
    </div>
  )
}

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-sub text-[11.5px]">{label}</span>
      <span className={cn('num text-[15px] font-semibold', cls ?? 'text-txt')}>{value}</span>
    </div>
  )
}
