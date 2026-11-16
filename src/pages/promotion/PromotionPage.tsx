import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { PromoDaily, PromoEvent, PromoSummaryRow } from '@/shared/api'
import { analyticsQueries, SegTabs, n1, pct, tone } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarChart, BarList, Card, CardBadge, EmptyState, Icon, LineChart, StockLink, Zone, ZoneRow, maLine } from '@/shared/ui'
import { cn, stageText } from '@/shared/lib'

/**
 * 连板晋级量化 —— 数据源 `cache/promo/`（`scripts/promo_quant.py` 产出）。
 *
 * ## 这张表在交易体系里的位置
 *
 * 用户口径：**收益引擎 = 候选质量 + 接力质量**。本页就是「接力质量」的量化证据 ——
 * 它回答的不是「今天涨没涨」，而是「**在这个阶段接力的人，长期期望是多少**」。
 *
 * ## 两个数字要一起读，不能只读一个
 *
 * · `succ_rate`（成功率）—— 决定「多少次能成」
 * · `prem_close_avg`（晋级次日溢价）—— 决定「成了赚多少」
 *
 * 二者相乘才是期望。单看成功率会高估高段位（3进4 成功率 51.6% 看似最高，
 * 但样本少、且次日溢价可能被高位分歧压缩）；单看溢价会忽略失败率。
 * 所以表里把「成功组溢价」与「失败组开盘」并排 —— 赔率与胜率同屏才成立。
 *
 * ## 三类视图各回答一个问题
 *
 *   · **逐日晋级率折线** → 「现在处于周期的哪个位置」
 *     绝对值不重要，**方向和水平**才重要：连续低于冰点基准 = 退潮期不接力。
 *   · **分阶段成功率条** → 「哪一段胜率最高」（附注给出该段赔率，避免只看胜率）
 *   · **赔率对照柱** → 「成了赚多少 vs 不成亏多少」
 *
 * ⚠️ 关于「冰点基准 25%」这条参考线：系统内的晋级率阀门是**动态**的
 * （对比前 10 交易日晋级率的截尾均值，见 `promotion_gate_10d`），
 * 本页不做该口径的复算 —— 折线上的虚线段是**本页自算的 10 日简单均值**，
 * 只作趋势参考；25% 是体系里的冰点期基准下限，**不是**当日阀门值。
 * 二者的差别必须在页面上讲清，否则会被误读成「今天阀门就是 25%」。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.promotionSummary())
  await queryClient.ensureQueryData(analyticsQueries.promotionDaily())
  await queryClient.ensureQueryData(marketQueries.feedback())
  return null
}

/** 阶段排序权重：1to2 < 2to3 < 3to4 < 4to5+ */
const stageOrder = (s: string) => {
  const m = /^(\d+)to/.exec(s)
  return m ? Number(m[1]) : 99
}

/** 体系里的冰点期基准下限（%）——仅作视觉基准线，非当日动态阀门值 */
const ICE_BASE = 25

export function Component() {
  const [tab, setTab] = useState<'summary' | 'daily'>('summary')
  const summary = useQuery(analyticsQueries.promotionSummary())
  const daily = useQuery(analyticsQueries.promotionDaily())
  const feedback = useQuery(marketQueries.feedback())

  const rows = useMemo<PromoSummaryRow[]>(() => {
    const list = summary.data?.rows ?? []
    return [...list].sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage))
  }, [summary.data])

  /** 明细按日期倒序（最新在前） */
  const days = useMemo(() => {
    return (daily.data ?? [])
      .map((d) => d.data)
      .filter((x): x is PromoDaily => !!x?.events?.length)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [daily.data])

  const [day, setDay] = useState<string>('')
  const activeDay = days.find((d) => d.date === day) ?? days[0]

  /**
   * 逐日晋级率趋势 —— 本页最有决策价值的一张图。
   *
   * 时间轴**升序**（左旧右新，与折线阅读习惯一致；明细表则倒序，最新在前）。
   *
   * ⚠️ 单日样本量少的日子（如仅 2 只票）晋级率会在 0%~100% 之间剧烈跳动，
   *    属统计噪声而非情绪信号。这里**不做过滤**（过滤会隐藏真实数据分布），
   *    而是在图下明确提示，并把 10 日虚线与它并排 —— 均值线才是读趋势的那条。
   */
  const trend = useMemo(() => {
    const asc = [...days].reverse()
    const labels = asc.map((d) => d.date.slice(5))
    const rates = asc.map((d) => {
      const all = d.events.length
      if (!all) return null
      return (d.events.filter((e) => e.ok).length / all) * 100
    })
    const counts = asc.map((d) => d.events.length)
    return { labels, rates, ma: maLine('10 日均值', rates, 10, 'sub'), counts }
  }, [days])

  /** 当日明细按次日收盘溢价倒序 —— 直接看「这批接力的人赚了还是亏了」 */
  const dayPremier = useMemo(() => {
    const list = activeDay?.events ?? []
    return [...list]
      .sort((a, b) => (b.prem_close1 ?? -Infinity) - (a.prem_close1 ?? -Infinity))
      .map((e) => ({
        label: e.name,
        value: e.prem_close1,
        sub: stageText(e.stage),
        note: e.ok ? `晋级 ${e.prev_boards}→${e.boards}` : '断板',
        tone: e.ok ? undefined : ('sub' as const),
      }))
  }, [activeDay])

  return (
    <div className="flex flex-col gap-3">
      <Card title="⚡ 实时晋级反馈" extra={<CardBadge tone="up">{feedback.data?.generated_ts?.slice(11, 19) ?? '等待盘中数据'}</CardBadge>}>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <span>昨日涨停 <b className="num text-txt">{feedback.data?.prev_zt_count ?? '—'}</b></span>
          <span>今日晋级 <b className="num text-up">{feedback.data?.promote_count ?? '—'}</b></span>
          <span>晋级率 <b className="num text-up">{feedback.data?.promote_rate != null ? `${n1(feedback.data.promote_rate)}%` : '—'}</b></span>
          <span>连板晋级 <b className="num text-up">{feedback.data?.lb_promote_count ?? '—'}</b></span>
          <span>核按钮 <b className={feedback.data?.nuke_count ? 'num text-down' : 'num text-sub'}>{feedback.data?.nuke_count ?? '—'}</b></span>
        </div>
        <p className="mt-1.5 text-11 text-sub">本卡随反馈矩阵刷新；下方统计仍是已收盘交易日的结果，不将盘中浮动状态混入历史晋级率。</p>
      </Card>
      {/* ── 趋势层：先看周期位置，再看分段统计 ── */}
      {/* 两卡都是内容主体（趋势图 + 分档量化表），PC 下并排而非上下铺满。
          ⛔ 旧版纵向平铺：4K 下每张卡右侧大片空白。 */}
      <ZoneRow>
        <Zone label="逐日晋级率" dot="bg-lead" className="xl:w-[50%]">
          <Card
            title="📈 逐日晋级率"
        extra={
          <CardBadge tone="warn">
            {trend.counts.length} 个交易日 · 虚线 = 本页自算 10 日均值
          </CardBadge>
        }
      >
        {trend.labels.length >= 2 ? (
          <>
            <LineChart
              labels={trend.labels}
              series={[
                { name: '晋级率', values: trend.rates, tone: 'up', area: true },
                trend.ma,
              ]}
              height={210}
              format={(v) => `${n1(v)}%`}
              yTickCount={5}
              refLines={[
                {
                  value: ICE_BASE,
                  label: `冰点基准 ${ICE_BASE}%`,
                  tone: 'warn',
                  dashed: true,
                },
              ]}
            />
            <p className="text-sub text-12 mt-2 leading-relaxed">
              晋级率 = 当日晋级家数 ÷ 当日接力样本。读的是<b className="text-txt">方向与水平</b>，不是单日绝对值：
              连续跌破 <b className="text-warn">冰点基准 {ICE_BASE}%</b> = 退潮期，接力期望为负。
              <br />
              ⚠️ <b className="text-txt">单日样本少时波动剧烈</b>（2 只票里成 1 只就是 50%），属统计噪声。
              故并列 <b className="text-txt">10 日简单均值虚线</b>作为趋势读数 —— 它是本页自算的参考，
              与系统内 <b className="text-txt">动态阀门</b>（对比前 10 交易日截尾均值）<b>不是同一套算法</b>，
              当日阀门值以系统计算为准。
            </p>
          </>
        ) : (
          <EmptyState text="晋级明细不足 2 日，无法成趋势" hint="cache/promo/promo_YYYYMMDD.json" />
        )}
      </Card>

        </Zone>

        <Zone label="晋级量化" dot="bg-up" className="xl:w-[50%]">
          <Card
            title="📐 连板晋级量化"
        extra={
          <span className="flex items-center gap-2">
            {summary.data?.ts && (
              <span className="text-sub text-11 num">{summary.data.ts.slice(0, 10)}</span>
            )}
            <SegTabs
              value={tab}
              onChange={(k) => setTab(k as 'summary' | 'daily')}
              items={[
                { key: 'summary', label: '分段汇总' },
                { key: 'daily', label: `逐票明细${days.length ? ` ${days.length}日` : ''}` },
              ]}
            />
          </span>
        }
      >
        {tab === 'summary' ? (
          <SummaryView rows={rows} loading={summary.isLoading} dateRange={summary.data?.date_range} />
        ) : (
          <DailyView
            days={days}
            activeDay={activeDay}
            onDay={setDay}
            loading={daily.isLoading}
            premier={dayPremier}
          />
        )}
      </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────

function SummaryView({
  rows,
  loading,
  dateRange,
}: {
  rows: PromoSummaryRow[]
  loading: boolean
  dateRange?: string
}) {
  if (loading) return <EmptyState text="加载晋级统计…" />
  if (!rows.length) {
    return (
      <EmptyState
        text="尚无晋级统计"
        hint="cache/promo/promo_summary.json 未生成 —— 由 capture_daily step7.5 每日滚动"
      />
    )
  }

  /** 归一上限：取各段成功率的最大值，使段间差异不被压缩 */
  const rateMax = Math.max(...rows.map((r) => r.succ_rate), 1)

  return (
    <>
      <p className="text-sub text-12 mb-2 leading-relaxed">
        胜率与赔率必须同屏读：<span className="text-txt">成功率</span>决定「多少次能成」，
        <span className="text-txt">晋级次日溢价</span>决定「成了赚多少」。
        失败组开盘均值用于衡量「不成时亏多少」。{dateRange && <span className="ml-1">区间：{dateRange}</span>}
      </p>

      {/* ── 分段成功率条：条长即成功率，同屏附注赔率 ── */}
      <div className="mb-3">
        <div className="text-12 font-semibold mb-1.5 flex items-center gap-1">
          <Icon name="stairs" size={13} className="text-sub" />
          分阶段胜率（附注 = 晋级次日收盘溢价均值）
        </div>
        <BarList
          items={rows.map((r) => ({
            label: stageText(r.stage),
            value: r.succ_rate,
            note: r.prem_close_avg == null ? '溢价 —' : `溢价 ${pct(r.prem_close_avg)}`,
            sub: `n=${r.n}`,
          }))}
          format={(v) => `${v == null ? '—' : `${n1(v)}%`}`}
          max={rateMax}
          labelWidth={96}
        />
        <p className="text-sub text-11 mt-1.5 leading-relaxed">
          条长按各段成功率的<b className="text-txt">本批最大值</b>归一（不是按 100%），
          目的是让段间差异可见；因此<b className="text-txt">绝对水平请看右侧数字</b>，不要凭条长估量级。
        </p>
      </div>

      {/* ── 赔率对照：成功组溢价 vs 失败组开盘（同一零轴）── */}
      <div className="mb-3">
        <div className="text-12 font-semibold mb-1.5 flex items-center gap-1">
          <Icon name="scale" size={13} className="text-sub" />
          赔率对照：成功组次日收盘溢价（实心） vs 失败组次日开盘均值（空心）
        </div>
        <BarChart
          bars={rows.map((r) => ({
            label: stageText(r.stage),
            value: r.prem_close_avg,
            compare: r.fail_open_avg,
            compareLabel: '失败组开盘均值',
          }))}
          height={175}
          format={(v) => `${n1(v)}%`}
          maxBarWidth={30}
        />
        <p className="text-sub text-11 mt-1.5 leading-relaxed">
          零基线双向：<b className="text-up">零线上方 = 赚钱</b> / <b className="text-down">零线下方 = 亏钱</b>。
          实心柱为<b className="text-txt">成功组</b>次日收盘溢价均值，空心柱为<b className="text-txt">失败组</b>次日开盘均值 ——
          前者衡量「成了赚多少」，后者衡量「不成亏多少」，两者都在零线以下说明该段位接力期望为负。
          无竞价溢价数据（`n_prem = 0`）的段位以虚线短横呈现，**不补 0**。
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-13">
          <thead>
            <tr className="border-b border-line text-sub">
              <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">阶段</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">样本</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">成功</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">失败</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">成功率</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">溢价均值</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">溢价中位</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">失败组开盘</th>
              <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">溢价样本</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage} className="border-b border-line-faint">
                <td className="py-1.5 px-2 whitespace-nowrap font-semibold text-txt">{stageText(r.stage)}</td>
                <td className="py-1.5 px-2 text-right num">{r.n}</td>
                <td className="py-1.5 px-2 text-right num text-up">{r.ok}</td>
                <td className="py-1.5 px-2 text-right num text-down">{r.fail}</td>
                <td
                  className={cn(
                    'py-1.5 px-2 text-right num font-semibold',
                    // 成功率本身无「好坏」语义 —— 它只是事实。故只在明显偏高时点睛
                    r.succ_rate >= 45 ? 'text-up' : 'text-txt',
                  )}
                >
                  {r.succ_rate}%
                </td>
                <td className={cn('py-1.5 px-2 text-right num', tone(r.prem_close_avg))}>
                  {pct(r.prem_close_avg)}
                </td>
                <td className="py-1.5 px-2 text-right num">{pct(r.prem_close_med)}</td>
                <td className={cn('py-1.5 px-2 text-right num', tone(r.fail_open_avg))}>
                  {pct(r.fail_open_avg)}
                </td>
                <td className="py-1.5 px-2 text-right num text-sub">{r.n_prem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sub text-11 mt-2 leading-relaxed">
        注：溢价样本数（n_prem）是「有竞价溢价数据」的子样本，可能小于成功数 ——
        2026-09-14 起账本口径切换后部分历史日缺竞价快照。
      </p>
    </>
  )
}

// ────────────────────────────────────────────────────────────────

interface PremierItem {
  label: string
  value: number | null
  sub: string
  note: string
  tone?: 'sub'
}

function DailyView({
  days,
  activeDay,
  onDay,
  loading,
  premier,
}: {
  days: PromoDaily[]
  activeDay: PromoDaily | undefined
  onDay: (d: string) => void
  loading: boolean
  premier: PremierItem[]
}) {
  const [only, setOnly] = useState<'all' | 'ok' | 'fail'>('all')

  const events = useMemo<PromoEvent[]>(() => {
    const list = activeDay?.events ?? []
    const filtered =
      only === 'ok' ? list.filter((e) => e.ok) : only === 'fail' ? list.filter((e) => !e.ok) : list
    return [...filtered].sort(
      (a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.code.localeCompare(b.code),
    )
  }, [activeDay, only])

  if (loading) return <EmptyState text="加载晋级明细…" />
  if (!days.length) {
    return <EmptyState text="尚无晋级明细" hint="cache/promo/promo_YYYYMMDD.json 未生成" />
  }

  const okN = activeDay?.events.filter((e) => e.ok).length ?? 0
  const allN = activeDay?.events.length ?? 0

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <select
          value={activeDay?.date ?? ''}
          onChange={(e) => onDay(e.target.value)}
          className="px-2 py-1 text-13 rounded-sm bg-transparent border border-line text-txt focus:outline-none focus:border-line-strong"
        >
          {days.map((d) => (
            <option key={d.date} value={d.date} className="bg-card text-txt">
              {d.date}
            </option>
          ))}
        </select>

        <SegTabs
          value={only}
          onChange={(k) => setOnly(k as 'all' | 'ok' | 'fail')}
          items={[
            { key: 'all', label: `全部 ${allN}` },
            { key: 'ok', label: `晋级 ${okN}` },
            { key: 'fail', label: `断板 ${allN - okN}` },
          ]}
        />

        <span className="text-sub text-12">
          前一交易日 {activeDay?.prev_date ?? '—'}
        </span>
      </div>

      {/* ── 当日结果分布：比逐票表格更快看出「这批接力的人赚没赚」── */}
      {premier.length > 0 && (
        <div className="mb-3">
          <div className="text-12 font-semibold mb-1.5 flex items-center gap-1">
            <Icon name="trendUp" size={13} className="text-sub" />
            次日收盘溢价分布（按溢价倒序）
          </div>
          <BarList items={premier} format={(v) => (v == null ? '—' : pct(v))} labelWidth={88} />
          <p className="text-sub text-11 mt-1.5 leading-relaxed">
            条色按正负自动判定（<b className="text-up">正=红</b> / <b className="text-down">负=绿</b>）；
            <b className="text-txt">断板票以中性灰呈现</b>并在附注标出结果 ——
            断板不等于亏钱（有断板高开的情形），把断板一律染绿会让「结果」与「收益」两个维度互相污染。
            附注里的 <span className="num">x→y</span> 为板数变化。
          </p>
        </div>
      )}

      {events.length === 0 ? (
        <EmptyState text="该日无符合条件的事件" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-13">
            <thead>
              <tr className="border-b border-line text-sub">
                <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">个股</th>
                <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">阶段</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">板数</th>
                <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">结果</th>
                <th className="text-left font-normal py-1.5 px-2 whitespace-nowrap">板块</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">首封(分)</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">封单(亿)</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">炸板</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">次日竞价</th>
                <th className="text-right font-normal py-1.5 px-2 whitespace-nowrap">次日收</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr
                  // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                  key={`${e.code}-${i}`}
                  className={cn('border-b border-line-faint', e.ok && 'bg-up-soft')}
                >
                  <td className="py-1.5 px-2 whitespace-nowrap text-txt">
                  <StockLink code={e.code}>{e.name}</StockLink>
                  </td>
                  <td className="py-1.5 px-2 whitespace-nowrap text-sub">{stageText(e.stage)}</td>
                  <td className="py-1.5 px-2 text-right num">
                    {e.prev_boards}
                    <span className="text-sub mx-0.5">→</span>
                    <b className={e.boards > 0 ? 'text-up' : 'text-down'}>{e.boards}</b>
                  </td>
                  <td className="py-1.5 px-2 whitespace-nowrap">
                    {e.ok ? <span className="text-up">晋级</span> : <span className="text-down">断板</span>}
                  </td>
                  <td className="py-1.5 px-2 whitespace-nowrap text-sub">{e.sector ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right num">{e.seal_min ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right num">{e.seal_fund_yi ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right num">{e.broken ?? '—'}</td>
                  <td className={cn('py-1.5 px-2 text-right num', tone(e.prem_open1))}>
                    {pct(e.prem_open1)}
                  </td>
                  <td className={cn('py-1.5 px-2 text-right num', tone(e.prem_close1))}>
                    {pct(e.prem_close1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
