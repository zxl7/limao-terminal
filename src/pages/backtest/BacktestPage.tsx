import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { BacktestMetricBlock, BacktestReport, PromoBacktest } from '@/shared/api'
import { analyticsQueries, DataTable, SegTabs, StatPair, Tag, n1 } from '@/features/analytics'
import { BarChart, Card, CardBadge, EmptyState, LineChart, Zone, ZoneRow } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 推测回测 —— 数据源 `cache/backtest/backtest_*.json`（`scripts/backtest_engine.py` 产出）。
 *
 * ## 三个指标口径互不替代（原系统唯一口径定义）
 *
 *   ① `candidate_hit`   —— 候选命中率：候选池里的票，次日是否真涨
 *   ② `range_hit`       —— 区间命中率：预期区间是否覆盖实际开盘涨幅
 *   ③ `sentiment_align` —— 情绪对齐度：预测情绪分与实际情绪分之差
 *
 * 三者回答不同问题：①衡量**选股**，②衡量**预期定价**，③衡量**盘面定性**。
 * 一个策略可能选股很准（①高）但预期区间定得太窄（②低）—— 这时问题不在选股，
 * 而在预期规则（`expectation_rules.json` 的 `max_range_width`）。
 *
 * ## ⚠️ `available: false` 是正常状态
 *
 * 原系统对样本不足的指标**拒绝计算**并给出 `reason`（如「样本不足」），
 * 而不是给一个基于 3 个样本的百分比。本页原样展示 reason，
 * 不把不可用当作 0% —— 那会让人误以为策略失效。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.backtestReport())
  await queryClient.ensureQueryData(analyticsQueries.promoBacktest())
  return null
}

type MetricKey = 'candidate_hit' | 'range_hit' | 'sentiment_align'

const METRIC_META: Record<MetricKey, { label: string; desc: string }> = {
  candidate_hit: { label: '候选命中', desc: '候选池的票次日是否真涨 —— 衡量选股' },
  range_hit: { label: '区间命中', desc: '预期区间是否覆盖实际开盘涨幅 —— 衡量预期定价' },
  sentiment_align: { label: '情绪对齐', desc: '预测情绪分与实际情绪分之差 —— 衡量盘面定性' },
}

export function Component() {
  const bt = useQuery(analyticsQueries.backtestReport())
  const promoQ = useQuery(analyticsQueries.promoBacktest())
  const [tab, setTab] = useState<MetricKey>('candidate_hit')
  const [promoFile, setPromoFile] = useState('')

  /** 晋级量化回测报告（与候选回测是两条独立链 · 见页尾的分工说明） */
  const promoFiles = useMemo(
    () => (promoQ.data ?? []).filter((f) => !!f.data).sort((a, b) => b.file.localeCompare(a.file)),
    [promoQ.data],
  )
  const activePromo: PromoBacktest | null | undefined =
    promoFiles.find((f) => f.file === promoFile)?.data ?? promoFiles[0]?.data

  const reports = useMemo<BacktestReport[]>(
    () =>
      (bt.data ?? [])
        .map((f) => f.data)
        .filter((x): x is BacktestReport => !!x)
        .sort((a, b) => String(b.settle_date ?? '').localeCompare(String(a.settle_date ?? ''))),
    [bt.data],
  )
  const latest = reports[0]

  /**
   * 按期次的走势 —— 时间轴**升序**（左旧右新，与折线阅读习惯一致；`reports` 本身是倒序）。
   *
   * 合并三条指标在一张图里会失真：命中率是 0~100 的百分数，情绪偏差是 ±个位数的差值，
   * 共轴会把偏差压成贴着零线的直线。故拆两张：
   *   · 命中线（同一量纲：%）→ 一张，含 50% 掷硬币基准线
   *   · 情绪偏差（另一量纲）→ 独立双向柱，含 ±1 对齐带
   */
  const trend = useMemo(() => {
    const asc = [...reports].reverse()
    return {
      labels: asc.map((r) => String(r.settle_date ?? r.rec_date ?? '').slice(5)),
      cand: asc.map((r) => r.summary?.candidate_hit_rate ?? null),
      range: asc.map((r) => r.summary?.range_hit_rate ?? null),
      sent: asc.map((r) => r.summary?.sentiment_diff ?? null),
    }
  }, [reports])

  const block: BacktestMetricBlock | undefined = latest?.metrics?.[tab]

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🔬 推测回测"
        extra={
          <CardBadge tone={(latest?.summary?.candidate_hit_rate ?? 0) >= 50 ? 'up' : 'neutral'}>
            候选命中 {latest?.summary?.candidate_hit_rate != null ? `${n1(latest.summary.candidate_hit_rate)}%` : '—'}
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="结算日" value={latest?.settle_date ?? '—'} />
          <StatPair label="推荐日" value={latest?.rec_date ?? '—'} />
          <StatPair
            label="候选命中率"
            value={latest?.summary?.candidate_hit_rate != null ? `${n1(latest.summary.candidate_hit_rate)}%` : '—'}
            tone={(latest?.summary?.candidate_hit_rate ?? 0) >= 50 ? 'up' : 'sub'}
          />
          <StatPair
            label="区间命中率"
            value={latest?.summary?.range_hit_rate != null ? `${n1(latest.summary.range_hit_rate)}%` : '—'}
          />
          <StatPair
            label="情绪偏差"
            value={latest?.summary?.sentiment_diff != null ? n1(latest.summary.sentiment_diff) : '—'}
            tone={Math.abs(latest?.summary?.sentiment_diff ?? 0) <= 1 ? 'up' : 'down'}
          />
          <StatPair label="归档期数" value={reports.length} />
          <StatPair label="schema" value={latest?.schema ?? '—'} />
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          三个指标衡量的是不同环节 —— 候选命中看**选股**，区间命中看**预期定价**，
          情绪对齐看**盘面定性**。其中一项低不代表策略整体失效，要先定位是哪一环。
          样本不足时原系统拒绝计算并给出原因，本页原样展示，不把不可用当作 0%。
        </p>
        {!bt.isLoading && !latest && (
          <EmptyState text="回测报告未生成" hint="cache/backtest/ 为空" />
        )}
      </Card>

      {/* 主工作区 = 指标明细 + 指标走势（当期的核心读数与跨期方向）；
          辅助区 = 历史期次（归档表，次要）。
          ⛔ 旧版四块纵向平铺，4K 下每块右侧大片空白。 */}
      <ZoneRow>
        <Zone label="指标与走势" dot="bg-lead" className="xl:w-[64%]">
      {latest && (
        <Card
          title="指标明细"
          extra={
            <SegTabs
              items={(Object.keys(METRIC_META) as MetricKey[]).map((k) => ({
                key: k,
                label: METRIC_META[k].label,
              }))}
              value={tab}
              onChange={(k) => setTab(k as MetricKey)}
            />
          }
        >
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
            <StatPair label="可用" value={block?.available ? '是' : '否'} tone={block?.available ? 'up' : 'warn'} />
            <StatPair label="可评估样本" value={block?.evaluable ?? '—'} />
            <StatPair label="命中数" value={block?.hit_count ?? '—'} tone="up" />
            <StatPair
              label="命中率"
              value={block?.hit_rate != null ? `${n1(block.hit_rate)}%` : '—'}
              tone={(block?.hit_rate ?? 0) >= 50 ? 'up' : 'sub'}
            />
          </div>

          <p className="text-sub text-[12px] mb-2">{METRIC_META[tab].desc}</p>

          {!block?.available && (
            <div className="border border-warn rounded-sm px-2.5 py-2 mb-2">
              <div className="flex items-center gap-2 mb-0.5">
                <Tag tone="warn">不可用</Tag>
              </div>
              <p className="text-[12.5px] leading-relaxed">
                原因：{block?.reason || '未说明（该指标本期未产出）'}
              </p>
              <p className="text-sub text-[11.5px] mt-1">
                原系统对样本不足的指标拒绝计算，而非给出小样本百分比 —— 这是刻意的保守口径。
              </p>
            </div>
          )}

          {block?.rows?.length ? (
            <DataTable
              rows={block.rows}
              rowKey={(_r, i) => String(i)}
              dense
              empty="无逐条明细"
              columns={pickColumns(block.rows[0])}
            />
          ) : (
            block?.available && <EmptyState text="该指标本期无逐条明细" />
          )}
        </Card>
      )}

      {/* ── 走势层：单期读数说明不了策略有效性，跨期方向才能 ── */}
      {reports.length > 1 && (
        <Card
          title="📈 指标走势"
          extra={<CardBadge tone="warn">{reports.length} 期 · 左旧右新</CardBadge>}
        >
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[12px] font-semibold mb-1.5">命中率（同量纲共轴：%）</div>
              <LineChart
                labels={trend.labels}
                series={[
                  { name: '候选命中率', values: trend.cand, tone: 'up', area: true },
                  { name: '区间命中率', values: trend.range, tone: 'mid' },
                ]}
                height={200}
                format={(v) => `${n1(v)}%`}
                yTickCount={5}
                refLines={[{ value: 50, label: '掷硬币基准 50%', tone: 'sub', dashed: true }]}
              />
              <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
                两条线都是 0~100 的百分数，故可共轴。低于 <b className="text-txt">50% 基准线</b>
                说明当期表现不如随机 —— 单期如此属正常波动，<b className="text-txt">连续多期低于基准</b>才是策略失效的信号。
                缺该期数据的点为 <b className="text-txt">断口</b>（不连线、不补 0）：原系统对样本不足的期次拒绝计算，
                补 0 会伪造出「命中率为零」的暴跌形态。
              </p>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1.5">情绪对齐偏差（预测情绪分 − 实际情绪分）</div>
              <BarChart
                bars={trend.labels.map((label, i) => ({
                  label,
                  value: trend.sent[i],
                  /* 绝对值 ≤1 视为对齐（体系内的容忍带），取中性色；超出才用红绿区分偏乐观/偏悲观 */
                  tone: trend.sent[i] == null ? undefined : Math.abs(trend.sent[i]!) <= 1 ? ('mid' as const) : undefined,
                }))}
                height={150}
                format={(v) => (v > 0 ? `+${n1(v)}` : n1(v))}
                maxBarWidth={26}
              />
              <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
                零轴居中：<b className="text-up">正值 = 预测偏乐观</b>（实际没有预期那么热）/
                <b className="text-down"> 负值 = 预测偏悲观</b>。
                <b className="text-mid">蓝色柱 = 绝对偏差 ≤1</b>，落在体系容忍带内；
                偏差与命中率**分开画**是刻意的：命中率看选股、偏差看定性，共轴会把两个量纲搅在一起。
              </p>
            </div>
          </div>
        </Card>
      )}

        </Zone>

        <Zone label="历史期次" dot="bg-mid" className="xl:w-[36%]">
      {reports.length > 1 && (
        <Card title="历史期次" extra={<CardBadge>{reports.length} 期</CardBadge>}>
          <DataTable
            rows={reports}
            rowKey={(r) => `${r.settle_date}-${r.rec_date}`}
            dense
            empty="无"
            columns={[
              { label: '结算日', cell: (r) => <span className="num">{r.settle_date}</span> },
              { label: '推荐日', cell: (r) => <span className="num text-sub">{r.rec_date}</span> },
              {
                label: '候选命中率',
                num: true,
                cell: (r) => (
                  <span className={cn((r.summary?.candidate_hit_rate ?? 0) >= 50 ? 'text-up' : 'text-txt')}>
                    {r.summary?.candidate_hit_rate != null ? `${n1(r.summary.candidate_hit_rate)}%` : '—'}
                  </span>
                ),
              },
              {
                label: '区间命中率',
                num: true,
                cell: (r) => (r.summary?.range_hit_rate != null ? `${n1(r.summary.range_hit_rate)}%` : '—'),
              },
              {
                label: '情绪偏差',
                num: true,
                cell: (r) => (
                  <span className={cn(Math.abs(r.summary?.sentiment_diff ?? 0) <= 1 ? 'text-up' : 'text-down')}>
                    {r.summary?.sentiment_diff != null ? n1(r.summary.sentiment_diff) : '—'}
                  </span>
                ),
              },
              {
                label: '可用指标',
                cell: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {(Object.keys(METRIC_META) as MetricKey[]).map((k) =>
                      r.metrics?.[k]?.available ? (
                        <Tag key={k} tone="up">
                          {METRIC_META[k].label}
                        </Tag>
                      ) : (
                        <Tag key={k}>{METRIC_META[k].label}</Tag>
                      ),
                    )}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
        </Zone>
      </ZoneRow>

      {/* ── 晋级量化回测（cache/promo/backtest_*.json）──
          与上方「候选命中率回测」**不是同一件事**：
          上方评测的是**选股**（候选有没有走对），这里评测的是**接力**
          （1进2 在各板块/各日的成功率与次日溢价）。
          两者对应用户常说的一句话：预期区间不等于收益 ——
          收益引擎 = 候选质量 × 接力质量，所以两块必须分开看。 */}
      <ZoneRow>
        <Zone label="晋级量化回测 · 1进2 分组表现" dot="bg-rec" className="xl:w-[64%]">
          <Card
            title="📊 晋级回测报告"
            extra={
              <div className="flex items-center gap-2">
                {promoFiles.length > 1 && (
                  <SegTabs
                    items={promoFiles.map((f) => ({
                      key: f.file,
                      label: f.file.replace(/^backtest_/, '').replace(/[.]json$/, '').slice(0, 14),
                    }))}
                    value={promoFiles.find((f) => f.data === activePromo)?.file ?? ''}
                    onChange={setPromoFile}
                  />
                )}
                <CardBadge>{promoFiles.length} 份</CardBadge>
              </div>
            }
          >
            {!activePromo ? (
              <EmptyState text="未读到晋级回测报告（cache/promo/backtest_*.json）" />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-[13px] font-semibold text-txt">{activePromo.title}</span>
                  <span className="num text-[11px] text-sub">{activePromo.ts?.slice(0, 16) || '—'}</span>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  <DataTable
                    dense
                    rows={activePromo.rows ?? []}
                    rowKey={(r) => r.key}
                    empty="该报告无分组数据"
                    columns={[
                      { label: '分组', cell: (r) => <span className="text-txt">{r.key}</span> },
                      { label: '样本', num: true, cell: (r) => <span className="num text-sub">{r.n}</span> },
                      { label: '成功', num: true, cell: (r) => <span className="num text-up">{r.ok}</span> },
                      { label: '失败', num: true, cell: (r) => <span className="num text-down">{r.fail}</span> },
                      {
                        label: '成功率',
                        num: true,
                        cell: (r) => (
                          <span
                            className={cn(
                              'num font-semibold',
                              r.succ_rate >= 50 ? 'text-up' : r.succ_rate >= 30 ? 'text-mid' : 'text-down',
                            )}
                          >
                            {n1(r.succ_rate)}%
                          </span>
                        ),
                      },
                      {
                        label: '次日开盘溢价',
                        num: true,
                        className: 'whitespace-nowrap',
                        cell: (r) => (
                          <span className={cn('num', (r.prem_open1 ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                            {r.prem_open1 == null ? '—' : `${n1(r.prem_open1)}%`}
                          </span>
                        ),
                      },
                      {
                        label: '次日收盘溢价',
                        num: true,
                        className: 'whitespace-nowrap',
                        cell: (r) => (
                          <span className={cn('num', (r.prem_close1 ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                            {r.prem_close1 == null ? '—' : `${n1(r.prem_close1)}%`}
                          </span>
                        ),
                      },
                      {
                        label: '第2日收盘',
                        num: true,
                        className: 'whitespace-nowrap',
                        cell: (r) => (
                          <span className="num text-sub">
                            {r.prem_close2 == null ? '—' : `${n1(r.prem_close2)}%`}
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
                <div className="text-sub text-[11px] leading-relaxed">
                  成功率 = 晋级成功数 / 样本数；溢价为**平均**值。分组键的含义随报告不同
                  （`1to2_board` = 按板块，`_day_` = 按交易日）。样本小的分组（n ≤ 3）波动极大，
                  不可单看成功率定论。
                </div>
              </div>
            )}
          </Card>
        </Zone>

        <Zone label="读法提示 · 与候选回测的分工" dot="bg-sub" className="xl:w-[36%]">
          <Card title="🧭 这两块回测各管什么">
            <div className="flex flex-col gap-2 text-[12px] leading-relaxed">
              <div>
                <span className="font-semibold text-txt">候选命中率回测（上方）</span>
                <div className="text-sub mt-0.5">
                  评测**选股**：当日选出的票，次日是否按预期走。回答「选得对不对」。
                </div>
              </div>
              <div>
                <span className="font-semibold text-txt">晋级量化回测（本区）</span>
                <div className="text-sub mt-0.5">
                  评测**接力**：1进2 在各分组下的成功率与溢价。回答「接力值不值得做、哪类值得做」。
                </div>
              </div>
              <div className="border-t border-line-faint pt-2 text-sub">
                两者都命中 ≠ 一定赚钱：候选对了但接力环境差（晋级率低 / 隔日核按钮多）
                同样会亏。这正是系统把「候选质量」与「接力质量」分成两个引擎的原因。
              </div>
            </div>
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

/**
 * 明细行是宽松对象（各指标字段不同），此处按**第一行的实际 keys** 动态生成列 ——
 * 这比写死列名更抗契约变化：原系统新增字段时自动出现，删除字段时自动消失。
 */
function pickColumns(sample: Record<string, unknown>) {
  return Object.keys(sample).map((k) => ({
    label: k,
    num: typeof sample[k] === 'number',
    className: typeof sample[k] === 'string' && String(sample[k]).length > 30 ? 'whitespace-normal min-w-[240px]' : undefined,
    cell: (r: Record<string, unknown>) => {
      const v = r[k]
      if (v == null) return <span className="text-sub">—</span>
      if (typeof v === 'boolean') return v ? <span className="text-up">是</span> : <span className="text-sub">否</span>
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : n1(v)
      if (Array.isArray(v)) return <span className="text-sub text-[11.5px]">{v.join(', ') || '—'}</span>
      return <span className="text-[11.5px]">{String(v)}</span>
    },
  }))
}
