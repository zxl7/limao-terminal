import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { AccountNavEntry } from '@/shared/api'
import { analyticsQueries, DataTable, Tag, n1, n2, pct } from '@/features/analytics'
import { BarChart, Card, CardBadge, EmptyState, Icon, LineChart, Zone, ZoneRow } from '@/shared/ui'
import { cn, drawdownSeries, maxDrawdownOf } from '@/shared/lib'

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
 * ## 为什么同时展示 `account_metrics`
 *
 * 净值只回答「赚了多少」，不回答「有多少机会本来能赚」。`sample_count`（候选样本）
 * 与 `tradable_count`（实际可成交）的差额才是**错过率** —— 这是策略迭代的关键输入。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.accountNav())
  await queryClient.ensureQueryData(analyticsQueries.accountMetrics())
  return null
}

const CALIBER_LABEL: Record<string, { text: string; tone: 'up' | 'rec' | 'warn' }> = {
  ai: { text: 'AI 口径', tone: 'up' },
  mechanical_fallback: { text: '机械回退', tone: 'warn' },
}

export function Component() {
  const nav = useQuery(analyticsQueries.accountNav())
  const metrics = useQuery(analyticsQueries.accountMetrics())

  const rows = useMemo(
    () => [...(nav.data ?? [])].sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    [nav.data],
  )
  const last = rows.at(-1)

  /** 最大回撤（单值，口径 = 逐点回撤序列的最小值） */
  const maxDrawdown = useMemo(() => maxDrawdownOf(rows.map((r) => r.nav)), [rows])

  /** 胜率：当日均收益 > 0 的结算日占比（空仓日不计入分母） */
  const winRate = useMemo(() => {
    const traded = rows.filter((r) => r.stock_count > 0)
    if (!traded.length) return null
    return (traded.filter((r) => r.avg_return_pct > 0).length / traded.length) * 100
  }, [rows])

  /** 口径切换点 —— 用于在表格里显式提示「此前为机械口径」 */
  const firstAiIdx = rows.findIndex((r) => r.caliber === 'ai')

  /**
   * 净值曲线 + 回撤曲线（同一条时间轴，两个量纲）。
   *
   * ⚠️ 两条曲线**必须分开画**：净值在 1.0 附近波动，回撤是 0 ~ -20% 的负值。
   *    共用一个 Y 轴会把净值曲线压成一条贴顶的平线，回撤曲线也读不出幅度 ——
   *    这正是「不共轴」原则的又一例。
   *
   * 回撤口径 = `nav / 历史最高净值 - 1`（峰到当前的跌幅）。它比「最大回撤」
   * 这个单值更有用：单值只告诉你「最惨到什么程度」，曲线告诉你「现在离最惨还有多远」。
   */
  const navChart = useMemo(() => {
    const labels = rows.map((r) => r.trade_date.slice(5))
    const navs = rows.map((r) => r.nav)

    /* 回撤以 % 呈现（页面量纲），内核统一用小数 */
    const dd = drawdownSeries(navs).map((v) => (v == null ? null : v * 100))

    const tail = navs.at(-1)
    const tone = tail == null ? ('sub' as const) : tail >= 1 ? ('up' as const) : ('down' as const)
    return { labels, navs, dd, tone }
  }, [rows])

  const mRows = useMemo(
    () => [...(metrics.data?.records ?? [])].sort((a, b) => b.trade_date.localeCompare(a.trade_date)),
    [metrics.data],
  )

  /** 错过率：样本存在但不可成交的比例（可成交 < 样本） */
  const missRate = useMemo(() => {
    const withSample = mRows.filter((r) => r.sample_count > 0)
    if (!withSample.length) return null
    const miss = withSample.reduce((s, r) => s + Math.max(0, r.sample_count - r.tradable_count), 0)
    const total = withSample.reduce((s, r) => s + r.sample_count, 0)
    return total ? (miss / total) * 100 : null
  }, [mRows])

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
            label="最大回撤"
            value={maxDrawdown == null ? '—' : pct(maxDrawdown * 100)}
            cls="text-down"
          />
          <Metric
            label="胜率（有成交日）"
            value={winRate == null ? '—' : `${winRate.toFixed(0)}%`}
            cls={winRate != null && winRate >= 50 ? 'text-up' : 'text-txt'}
          />
          <Metric label="结算日数" value={String(rows.length)} />
          <Metric
            label="错过率（不可成交/样本）"
            value={missRate == null ? '—' : `${missRate.toFixed(1)}%`}
            cls="text-warn"
          />
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

        <p className="text-sub text-[11.5px] leading-relaxed">
          「错过率」= 候选样本中存在但最终不可成交的比例（缩量、竞价未达标、无竞价数据）。
          这是策略迭代的关键输入 —— 净值不反映「本来能赚却没赚」的部分。
        </p>
      </Card>

      {/* 主工作区 = 净值走势 + 收益分布 + 结算流水（宽表·多列，需要最大横向空间）；
          辅助区 = 候选样本 vs 可成交（诊断用，次要）。
          ⛔ 旧版 5 张卡等宽纵向平铺：4K 下每张右侧大片空白，且主次不分。 */}
      <ZoneRow>
        <Zone label="净值与流水" dot="bg-lead" className="xl:w-[62%]">
          {/* ── 净值曲线 + 回撤曲线（分轴）── */}
          <Card
            title="📉 净值与回撤"
        extra={
          <CardBadge tone={navChart.tone === 'up' ? 'up' : navChart.tone === 'down' ? 'down' : 'neutral'}>
            {rows.length} 个结算日
          </CardBadge>
        }
      >
        {rows.length ? (
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1">
                <Icon name="trendUp" size={13} className={navChart.tone === 'up' ? 'text-up' : 'text-down'} />
                净值曲线（初始 1.00）
              </div>
              <LineChart
                labels={navChart.labels}
                series={[{ name: '净值', values: navChart.navs, tone: navChart.tone, area: true }]}
                height={185}
                showLegend={false}
                /* 3 位小数：净值精度到千分位才有意义（1 分钱的差异在小资金上很可观） */
                format={(v) => v.toFixed(3)}
                yTickCount={5}
                refLines={[
                  { value: 1, label: '本金线 1.00', tone: 'sub' },
                  /* -10% 是心法纪律层的硬警示线（NAV_DRAWDOWN_WARN_PCT），
                     画出来才能「一眼看到自己离红线还有多远」，而不是靠记数字 */
                  { value: 0.9, label: '-10% 回撤硬线', tone: 'warn' },
                ]}
              />
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1">
                <Icon name="downRight" size={13} className="text-down" />
                回撤曲线（距历史最高净值）
              </div>
              <LineChart
                labels={navChart.labels}
                series={[{ name: '回撤', values: navChart.dd, tone: 'down', area: true }]}
                height={130}
                showLegend={false}
                zeroBased
                format={(v) => `${n1(v)}%`}
                refLines={[{ value: -10, label: '-10% 心法硬线', tone: 'warn' }]}
              />
              <p className="text-sub text-[11.5px] mt-1.5 leading-relaxed">
                回撤口径 = 净值 ÷ 历史最高净值 − 1。它比单个「最大回撤」数字更有用：
                <b className="text-txt"> 最大回撤</b>只说明最惨到什么程度，而曲线说明
                <b className="text-txt"> 现在离最惨还有多远</b>。破 -10% 即触发心法纪律层的硬警示。
              </p>
            </div>

            <p className="text-sub text-[11.5px] leading-relaxed border-l-2 border-line-strong pl-2.5">
              两条曲线 <b className="text-txt">分轴呈现</b>：净值在 1.0 附近波动、回撤是 0 至 −20% 的负值，
              共用 Y 轴会把净值压成贴顶平线且回撤读不出幅度。各自与自己历史比较才有意义。
            </p>
          </div>
        ) : (
          <EmptyState text="净值账本为空" hint="account_nav_history.jsonl 未生成" />
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

        </Zone>

        <Zone label="候选诊断" dot="bg-warn" className="xl:w-[38%]">
          <Card title="候选样本 vs 可成交" extra={<CardBadge tone="warn">错过率 = 策略迭代关键输入</CardBadge>}>
        <DataTable
          rows={mRows.slice(0, 30)}
          rowKey={(r) => r.trade_date}
          dense
          empty="无指标记录"
          columns={[
            { label: '结算日', cell: (r) => <span className="num">{r.trade_date}</span> },
            { label: '决策日', cell: (r) => <span className="num text-sub">{r.recommendation_date}</span> },
            { label: '候选样本', num: true, cell: (r) => r.sample_count },
            {
              label: '实际可成交',
              num: true,
              cell: (r) => <span className={r.tradable_count > 0 ? 'text-txt' : 'text-sub'}>{r.tradable_count}</span>,
            },
            {
              label: '错过',
              num: true,
              cell: (r) => {
                const d = r.sample_count - r.tradable_count
                return <span className={d > 0 ? 'text-warn' : 'text-sub'}>{d > 0 ? d : '—'}</span>
              },
            },
          ]}
        />
        {mRows.length > 30 && (
          <p className="text-sub text-[11px] mt-1.5">仅显示最近 30 行（共 {mRows.length} 行）</p>
        )}
      </Card>
        </Zone>
      </ZoneRow>
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
