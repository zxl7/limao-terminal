import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type {
  EmotionDay,
  MarketMemory,
  ZtHistoryDay,
  ZtIntradayPoint,
  ZtPoolSnapshot,
} from '@/shared/api'
import {
  analyticsQueries,
  DataTable,
  SegTabs,
  StatPair,
  Tag,
  boardsLabel,
  fileDate,
  fmtFbt,
  n1,
  pct,
  rate,
  /** ⚠️ 别名：本文件内已有同名的局部变量/参数 `tone`（SeqRow 的色调枚举），
   *  直接导入会触发 no-shadow，且语义也确实不同（那是「序列色调」不是「涨跌色调」）。 */
  tone as toneCls,
} from '@/features/analytics'
import { buildTideState, marketQueries, TideCard, tideConflict } from '@/features/market'
import { BarChart, Card, CardBadge, EmptyState, Icon, LineChart, Sparkline, Zone, ZoneRow, maLine } from '@/shared/ui'
import { cn, sentimentClass } from '@/shared/lib'

/**
 * 情绪周期 —— 数据源 `cache/emotion_summary_5d.json` + `cache/zt_history_*.json`。
 *
 * ## 窗口分层（原系统定义，不可自行改口径）
 *
 *   当日 = **执行层**：今天该不该动手
 *   3 日 = **方向层**：`sentiment_ma3` 的拐点，噪声最少但滞后 1 日
 *   5 日 = **纪律层**：连续 5 日的修复/退潮，用来确认「不是单日反抽」
 *   10 日 = **归纳层**：`summary10`（原系统只保留摘要，本页不展开）
 *
 * ## 为什么把 `turn_signal` 放在最上面
 *
 * 情绪分本身是**水平量**，只回答「现在几度」；而 `turn_signal` 是**方向量**，
 * 回答「正在往哪走」—— 交易决策依赖的是后者。原系统的 `ebb_warn`（假修复）
 * 与 `repair_warn`（修复前兆）正是两个最容易做反的拐点，故置顶。
 *
 * ## 盘中涨停时序的读法
 *
 * `intraday_points` 是**当日盘中逐窗口**的涨停家数与题材分布，用于回答
 * 「涨停是早上堆出来的还是下午补的」。`intraday_only=true` 表示该日归档
 * 只有盘中点、没有盘后明细（归档残缺），此时不可据其做全量结论。
 */

export async function loader() {
  // 四份日频/归档数据独立产出；任一文件暂缺时保留其余数据与页面内空态。
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.emotionSummary5d()),
    queryClient.ensureQueryData(analyticsQueries.emotionZtHistory()),
    queryClient.ensureQueryData(analyticsQueries.emotionMemory()),
    queryClient.ensureQueryData(analyticsQueries.ztYesterday()),
    queryClient.ensureQueryData(marketQueries.feedback()),
  ])
  return null
}

const TURN_TONE: Record<string, { label: string; cls: string }> = {
  repair: { label: '修复方向', cls: 'text-up' },
  ebb: { label: '退潮方向', cls: 'text-down' },
  flat: { label: '方向不明', cls: 'text-sub' },
}

/**
 * 盘中时序行 —— 在 `ZtHistoryDay` 之上收窄出「必定含盘中点」的形态。
 *
 * ⚠️ 为什么要收窄：归档存在**两种形态** ——
 *   · 新形态：带 `intraday_points`（当日逐窗口快照）
 *   · 旧形态：只有 `zt_count` / `ladder` / `zt_list` 等收盘字段，无逐窗口数据
 * 旧形态日混进「盘中时序」表会因为读不到点而整行渲染错乱，故在过滤阶段就用
 * 类型守卫剔除，而不是在渲染里逐处可选链兜底（那样会产出「0 个盘中点」的
 * 假数据，让人误以为该日盘中全程无涨停）。
 */
type IntradayRow = ZtHistoryDay & { intraday_points: ZtIntradayPoint[] }

export function Component() {
  const summary = useQuery(analyticsQueries.emotionSummary5d())
  const ztHist = useQuery(analyticsQueries.emotionZtHistory())
  const memory = useQuery(analyticsQueries.emotionMemory())
  const yzt = useQuery(analyticsQueries.ztYesterday())
  const feedback = useQuery(marketQueries.feedback())
  const [tab, setTab] = useState<'days' | 'trajectory' | 'intraday'>('days')
  const [memPick, setMemPick] = useState('')

  const s = summary.data
  /**
   * ⚠️ 必须 memo：`s?.days ?? []` 里的 `?? []` 会在 `s` 未就绪时**每次渲染
   *    新建一个空数组**，引用一变，所有以它为依赖的 useMemo 都会失效 ——
   *    图表的比例尺与路径随之整表重算（最典型的表现是鼠标一划就卡）。
   */
  const days = useMemo(() => s?.days ?? [], [s])
  const traj = s?.trajectory
  const turn = traj?.turn_signal
  const turnStyle = turn ? (TURN_TONE[turn.dir] ?? TURN_TONE.flat) : null
  /** 实时潮位严格按候选链路的 feedback_matrix 门控映射，不能拿日频摘要替代。 */
  const tide = useMemo(() => buildTideState(feedback.data), [feedback.data])
  const tideDirectionConflict = useMemo(() => tideConflict(tide, turn?.dir), [tide, turn?.dir])

  /**
   * 情绪快照（`market_memory_<日期>.json`）—— 盘中「情绪联动」的唯一数据源。
   *
   * 与 `summary_5d` 的分工**不是重复**：
   *   · `summary_5d` 是**日频统计** —— 每天一个情绪分，回答「水平与方向」
   *   · 情绪快照是**当日盘中的过程记录** —— 情绪何时生变（`event_log`）、
   *     当天系统推过哪些题材（`pushed_topics`，含首推/末推时刻与次数）
   * 复盘时「今天几点开始转暖、哪条线被反复推」只有后者答得了。
   */
  const memFiles = useMemo(
    () =>
      (memory.data ?? [])
        .filter((f) => !!f.data)
        .slice()
        .sort((a, b) => b.file.localeCompare(a.file)),
    [memory.data],
  )
  const memPickFile = memFiles.find((f) => f.file === memPick)?.file ?? memFiles[0]?.file ?? ''
  const mem: MarketMemory | null | undefined = memFiles.find(
    (f) => f.file === memPickFile,
  )?.data

  /** 昨日涨停池（**唯一涨停权威**）—— 本页其余口径若有分歧，一律以这份为准 */
  const y: ZtPoolSnapshot | undefined = yzt.data
  const yLadder = useMemo(
    () =>
      Object.entries(y?.ladder ?? {})
        .map(([b, names]) => ({ boards: Number(b), names }))
        .filter((x) => Number.isFinite(x.boards) && x.names.length > 0)
        .sort((a, b) => b.boards - a.boards),
    [y],
  )

  /** 盘中时序按日期倒序，取最近 8 个交易日（仅保留确有逐窗口数据的归档日） */
  const intradayRows = useMemo<IntradayRow[]>(
    () =>
      (ztHist.data ?? [])
        .map((f) => f.data)
        .filter((x): x is IntradayRow => !!x && Array.isArray(x.intraday_points))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8),
    [ztHist.data],
  )

  /**
   * 情绪分轨迹序列 —— 实线 + MA3 虚线 + 档位参考线。
   *
   * ⚠️ X 轴标签从 `days` 取但长度以**序列为准**：`sentiment_seq` 与 `days`
   *    理论上同窗口等长，一旦上游窗口参数改动导致不等长，用 `days` 驱动
   *    X 轴会让折线点与日期错位（最隐蔽的一类图表错误：图能画出来，但每天
   *    对应的值整体位移）。故以序列长度为真，日期缺失则留空标签。
   */
  const sentSeries = useMemo(() => {
    const seq = traj?.sentiment_seq ?? []
    if (!seq.length) return null
    const labels = seq.map((_, i) => (days[i]?.date ?? '').slice(5))
    // 线色按**当前档位**取（末个有效值），而非固定色 —— 情绪分≥7 时整条线转红，
    // 与全站「≥7 红 / 3–6 蓝 / ≤2 绿」口径一致，扫一眼就知道当前处哪一档
    const lastValid = [...seq].reverse().find((v) => v != null) ?? null
    const lvl = sentimentClass(lastValid)
    const tone = lvl === 'up' ? 'up' : lvl === 'down' ? 'down' : 'mid'
    return {
      labels,
      series: [
        { name: '情绪分', values: seq, tone, area: true },
        maLine(`MA${traj?.ma3_window ?? 3}`, seq, traj?.ma3_window ?? 3, 'sub'),
      ] as Parameters<typeof LineChart>[0]['series'],
      tone,
      lastValid,
    }
  }, [traj, days])

  /**
   * 近 12 个交易日收盘涨停家数。
   *
   * ⚠️ 数据源刻意的选择：`trajectory.zt_seq` 实测**全为 null**（summary 生成器
   *    未回填该序列），若照直渲染就是一张空图。而 `zt_history` 每天都有真值 ——
   *    优先取当日**最后一个盘中点**的 `total`（=`intraday_only` 归档日没有
   *    `zt_count` 字段，但 intraday_points 一定有末点），回退到 `zt_count`。
   *    这样 21 天里有值的日子全都能画出来，而不是被一个空字段挡住。
   */
  const ztTrend = useMemo(() => {
    const rows = (ztHist.data ?? [])
      .map((f) => f.data)
      .filter((x): x is ZtHistoryDay => !!x)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-12)

    const labels: string[] = []
    const values: (number | null)[] = []
    for (const r of rows) {
      const last = r.intraday_points?.at(-1)
      const total = last ? last.total : (r.zt_count ?? null)
      labels.push(r.date.slice(5))
      values.push(typeof total === 'number' ? total : null)
    }
    // 条形色按「较前一交易日改善/恶化」：涨停增多=红（转强），减少=绿（转弱）。
    // 这符合本项目「改善红 / 恶化绿」的语义色板，也让趋势在柱色上二次强化。
    const bars = values.map((v, i) => {
      const prev = i > 0 ? values[i - 1] : null
      const d = v != null && prev != null ? v - prev : null
      return {
        label: labels[i],
        value: v,
        tone: d == null ? ('sub' as const) : d > 0 ? ('up' as const) : d < 0 ? ('down' as const) : ('sub' as const),
      }
    })
    return { bars, hasAny: values.some((v) => v != null) }
  }, [ztHist.data])

  /** 最新归档日的盘中涨停节奏（逐快照窗口）—— 回答「涨停是堆早盘还是补午后」 */
  const todayRhythm = useMemo(() => {
    const top = intradayRows[0]
    if (!top || top.intraday_points.length < 2) return null
    return {
      date: top.date,
      truncated: !!top.intraday_only,
      labels: top.intraday_points.map((p) => p.window),
      series: [
        {
          name: '盘中涨停',
          values: top.intraday_points.map((p) => p.total),
          tone: 'up' as const,
          area: true,
        },
        {
          name: '最高板',
          values: top.intraday_points.map((p) => p.max_boards),
          tone: 'lead' as const,
          dashed: true,
        },
      ],
    }
  }, [intradayRows])

  return (
    <div className="flex flex-col gap-3">
      {/* ── 方向层：交易决策真正依赖的是方向，不是水平 ── */}
      <Card
        title="🌡️ 情绪周期"
        extra={
          <CardBadge tone={turn?.dir === 'repair' ? 'up' : turn?.dir === 'ebb' ? 'down' : 'neutral'}>
            {s?.cycle_hint ?? '—'}
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair
            label="3日情绪均 (MA3)"
            value={n1(turn?.ma3_last)}
            tone={turn?.dir === 'repair' ? 'up' : turn?.dir === 'ebb' ? 'down' : 'sub'}
          />
          <StatPair label="窗口" value={`${s?.window_days ?? '—'} 日`} />
          <StatPair label="轨迹样本" value={traj?.sentiment_seq?.length ?? '—'} />
          {turnStyle && (
            <span className={cn('text-[12.5px] font-semibold', turnStyle.cls)}>
              {turnStyle.label}
            </span>
          )}
        </div>

        {turn?.divergence && (
          <p className="text-[12px] leading-relaxed text-sub border-l-2 border-line-strong pl-2.5">
            背离：{turn.divergence}
          </p>
        )}

        {!summary.isLoading && !s && (
          <EmptyState text="情绪摘要未生成" hint="cache/emotion_summary_5d.json 缺失" />
        )}
      </Card>

      <Card
        title="🌊 盘中潮汐裁决"
        extra={<CardBadge tone={tide.tone === 'neutral' ? 'neutral' : tide.tone}>{tide.label}</CardBadge>}
      >
        <TideCard tide={tide} conflict={tideDirectionConflict} />
      </Card>

      {/* ── 情绪轨迹图：把「方向」画出来，而不是只给一个水平值 ── */}
      {/* 主工作区 = 情绪轨迹 + 接力质量 + 收盘涨停（图表为主，需要横向宽度）；
          辅助区 = 分层明细 + 窗口内快讯（纵向堆叠的日期块，窄栏即可）。
          ⛔ 旧版 6 张卡等宽纵向平铺，主次不分且 4K 下右侧大片空白。 */}
      <ZoneRow>
        <Zone label="轨迹与接力" dot="bg-lead" className="xl:w-[58%]">
          <Card
            title="📈 情绪轨迹"
        extra={
          <span className="text-sub text-[11.5px]">
            <Icon name="info" size={12} className="inline align-[-2px] mr-1" />
            实线=逐日情绪分 · 虚线=MA{traj?.ma3_window ?? 3}（方向层）
          </span>
        }
      >
        {sentSeries ? (
          <>
            <LineChart
              labels={sentSeries.labels}
              series={sentSeries.series}
              height={190}
              /* ⚠️ Y 轴固定 0–10 而非按数据自适应：情绪分是绝对标尺，
                 固定量程后「同样高的线」在任何一天都代表同样的分数；
                 若自适应，3 分的一天也会被画满整个高度，跨日对比立刻失效。 */
              yMin={0}
              yMax={10}
              yTickCount={5}
              format={(v) => n1(v)}
              refLines={[
                { value: 7, label: '≥7 偏强', tone: 'up' },
                { value: 4.5, label: '修复', tone: 'mid' },
                { value: 2, label: '≤2 退潮', tone: 'down' },
              ]}
            />
            <p className="text-sub text-[11.5px] mt-1.5 leading-relaxed">
              决策依赖的是 <b className="text-txt">方向</b> 而非水平：实线抬升并站上虚线 →
              修复方向；实线跌穿虚线 → 退潮方向。当日值显著高于 MA3 属单日脉冲，
              须次日确认（即上方「背离」提示）。
            </p>
          </>
        ) : (
          <EmptyState text="无情绪轨迹序列" hint="summary_5d.json 的 trajectory 段缺失" />
        )}
      </Card>

      {/* ── 接力质量：晋级率与核按钮分轴并置 ── */}
      <Card
        title="🔁 接力质量"
        extra={<CardBadge tone="neutral">量纲不同 · 分轴呈现</CardBadge>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5 gap-y-4">
          <div>
            <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1">
              <Icon name="trendUp" size={13} className="text-up" />
              晋级率（越高越好）
            </div>
            <LineChart
              labels={(traj?.promote_seq ?? []).map((_, i) => (days[i]?.date ?? '').slice(5))}
              series={[
                {
                  name: '晋级率',
                  values: traj?.promote_seq ?? [],
                  tone: 'up',
                  area: true,
                },
              ]}
              height={150}
              showLegend={false}
              /* 25% 是修复线：低于它意味着接力资金不接牌，与动态阀门同一口径 */
              refLines={[{ value: 25, label: '25% 修复线', tone: 'warn' }]}
              format={(v) => `${n1(v)}%`}
            />
          </div>

          <div>
            <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1">
              <Icon name="alert" size={13} className="text-down" />
              核按钮家数（越低越好）
            </div>
            <BarChart
              bars={(traj?.nuke_seq ?? []).map((v, i) => ({
                label: (days[i]?.date ?? '').slice(5),
                value: v,
                // ≥3 家即视为情绪转弱信号，与页面正文口径一致
                tone: v >= 3 ? 'down' : 'sub',
              }))}
              height={150}
              format={(v) => String(Math.round(v))}
            />
          </div>
        </div>
        <p className="text-sub text-[11.5px] mt-2 leading-relaxed">
          ⚠️ 两者<b className="text-txt">不共用一个 Y 轴</b>：晋级率是百分比、核按钮是家数，
          共轴会让「两条线的高低关系」变成无意义的伪信息。分轴并置后，各自只与自己历史比较。
        </p>
      </Card>

      {/* ── 涨停家数趋势：数据源刻意绕开空字段 ── */}
      <Card
        title="📊 收盘涨停家数"
        extra={<CardBadge tone="up">近 {ztTrend.bars.length} 个交易日</CardBadge>}
      >
        {ztTrend.hasAny ? (
          <>
            <BarChart
              bars={ztTrend.bars}
              height={175}
              format={(v) => String(Math.round(v))}
              maxBarWidth={30}
            />
            <p className="text-sub text-[11.5px] mt-1.5 leading-relaxed">
              柱色 = 较前一交易日 <b className="text-up">增多（转强）</b> /{' '}
              <b className="text-down">减少（转弱）</b>。
              数据取自 <span className="num">zt_history</span> 每日末个盘中快照的涨停总数 ——
              <span className="num"> trajectory.zt_seq</span> 实测全为空，从那里取会得到一张空图。
            </p>
          </>
        ) : (
          <EmptyState text="无涨停历史归档" hint="cache/zt_history/zt_*.json 缺失" />
        )}
      </Card>

      {/* ── 纪律层：5 日逐日 + 盘中时序 ── */}
        </Zone>

        <Zone label="分层与快讯" dot="bg-mid" className="xl:w-[42%]">
          <Card
            title="📅 分层明细"
        extra={
          <SegTabs
            items={[
              { key: 'days', label: '5日逐日' },
              { key: 'trajectory', label: '轨迹序列' },
              { key: 'intraday', label: '盘中时序' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'days' && (
          <DataTable<EmotionDay>
            rows={days}
            rowKey={(d) => d.date}
            rowClass={(d) => (d.seed ? 'bg-warn/5' : undefined)}
            empty="无逐日数据"
            columns={[
              {
                label: '日期',
                cell: (d) => (
                  <span className="num">
                    {d.date}
                    {d.seed && <span className="text-warn text-[11px] ml-1.5">冰点种子</span>}
                  </span>
                ),
              },
              {
                label: '情绪分',
                num: true,
                cell: (d) => (
                  <span className={cn('font-semibold', sentCls(d.sentiment_score))}>
                    {n1(d.sentiment_score)}
                  </span>
                ),
              },
              { label: '定性', cell: (d) => <span className="text-sub">{d.sentiment_label || '—'}</span> },
              { label: '涨停', num: true, cell: (d) => (d.zt_count ?? '—') as number | string },
              { label: '最高板', num: true, cell: (d) => (d.max_boards ?? '—') as number | string },
              {
                label: '晋级率',
                num: true,
                cell: (d) => (
                  /** 晋级率 ≥ 前 10 日截尾均值为健康，这里只做 25 基准的点睛 */
                  <span className={d.promote_rate >= 25 ? 'text-up' : 'text-txt'}>
                    {rate(d.promote_rate)}
                  </span>
                ),
              },
              {
                label: '核按钮',
                num: true,
                cell: (d) => (
                  <span className={d.nuke_count >= 3 ? 'text-down font-semibold' : 'text-txt'}>
                    {d.nuke_count}
                  </span>
                ),
              },
              {
                label: '主导题材',
                cell: (d) =>
                  d.main_themes?.length ? (
                    <span className="flex flex-wrap gap-1">
                      {d.main_themes?.slice(0, 4).map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                      {(d.main_themes?.length ?? 0) > 4 && (
                        <span className="text-sub text-[11px]">+{(d.main_themes?.length ?? 0) - 4}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-sub">—</span>
                  ),
              },
            ]}
          />
        )}

        {tab === 'trajectory' && (
          <div className="flex flex-col gap-2.5">
            {traj ? (
              <>
                <SeqRow label="情绪分" seq={(traj.sentiment_seq ?? []).map((v) => n1(v))} tone="sent" />
                <SeqRow
                  label={`MA${traj.ma3_window} 均`}
                  seq={(traj.sentiment_ma3 ?? []).map((v) => n1(v))}
                  tone="sent"
                />
                <SeqRow label="晋级率" seq={(traj.promote_seq ?? []).map((v) => n1(v))} tone="plain" />
                <SeqRow label="核按钮" seq={(traj.nuke_seq ?? []).map((v) => String(v))} tone="nu" />
                <SeqRow label="涨停数" seq={(traj.zt_seq ?? []).map((v) => (v == null ? '—' : String(v)))} tone="plain" />
                <p className="text-sub text-[11.5px] mt-1 leading-relaxed">
                  序列按时间正序；`—` = 该日字段为空（盘前快照尚未落盘），非 0。
                </p>
              </>
            ) : (
              <EmptyState text="无轨迹数据" />
            )}
          </div>
        )}

        {tab === 'intraday' && (
          <div className="flex flex-col gap-3">
            {/* 最新归档日的盘中节奏 —— 逐快照窗口，回答「涨停堆早盘还是补午后」 */}
            {todayRhythm && (
              <div className="border border-line rounded-sm px-2.5 py-2">
                <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1">
                  <Icon name="clock" size={13} className="text-sub" />
                  {todayRhythm.date} 盘中涨停节奏
                  {todayRhythm.truncated && (
                    <span className="text-warn text-[11px] font-normal ml-1">归档残缺（仅盘中点）</span>
                  )}
                </div>
                <LineChart
                  labels={todayRhythm.labels}
                  series={todayRhythm.series}
                  height={170}
                  format={(v) => String(Math.round(v))}
                />
                <p className="text-sub text-[11.5px] mt-1.5 leading-relaxed">
                  早盘快速抬升 → 情绪亢奋（追高需谨慎）；尾盘才补量 → 资金态度犹豫，
                  次日溢价通常更弱。高点回落幅度即为当日炸板强度。
                </p>
              </div>
            )}

            <DataTable<IntradayRow>
            rows={intradayRows}
            rowKey={(d) => d.date}
            empty="无盘中时序归档"
            columns={[
              {
                label: '日期',
                cell: (d) => (
                  <span className="num">
                    {d.date}
                    {d.intraday_only && (
                      <span className="text-warn text-[11px] ml-1.5">归档残缺</span>
                    )}
                  </span>
                ),
              },
              { label: '盘中点', num: true, cell: (d) => d.intraday_points.length },
              {
                label: '收盘涨停',
                num: true,
                cell: (d) => {
                  const last = d.intraday_points.at(-1)
                  return last ? last.total : '—'
                },
              },
              {
                label: '盘中最高板',
                num: true,
                cell: (d) => {
                  const max = d.intraday_points.reduce((m, p) => Math.max(m, p.max_boards || 0), 0)
                  return max || '—'
                },
              },
              {
                label: '题材数（末点）',
                num: true,
                cell: (d) => Object.keys(d.intraday_points.at(-1)?.themes ?? {}).length || '—',
              },
              {
                label: '涨停节奏',
                cell: (d) => <Sparkline points={d.intraday_points.map((p) => p.total)} tone="up" area />,
              },
            ]}
          />
          </div>
        )}
      </Card>

      {/* ── 消息面（原系统 5 日快讯块）── */}
      {!!s?.news?.length && (
        <Card title="📰 窗口内快讯" extra={<CardBadge>{s.news.length} 组</CardBadge>}>
          <div className="flex flex-col gap-2">
            {s.news.map((blk) => (
              <div key={blk.date} className="border-l-2 border-line pl-2.5">
                <div className="text-[12px] text-sub mb-0.5">
                  <span className="num">{blk.date}</span> · {blk.count} 条
                </div>
                <ul className="text-[12.5px] leading-relaxed">
                  {blk.titles.slice(0, 6).map((t, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}
        </Zone>
      </ZoneRow>

      {/* ── 权威口径与过程留痕 ──
          上半部分都是「统计口径」（summary_5d 的日频聚合 / zt_history 的盘中时序）。
          这一行补两类**不可替代的原始件**：
            · 昨日涨停池 —— 涨停家数的**唯一权威**（record_zt_snapshot 固化）。
              本页任何地方读到的涨停数若与它不一致，一律以它为准。
            · 情绪快照 —— 当日盘中的**过程留痕**（情绪几点生变、当天系统推过哪些题材）。
              日频聚合天然看不到这一层，而复盘最需要的恰恰是「几点开始转的」。 */}
      <ZoneRow>
        <Zone label="昨日涨停池 · 唯一权威口径" dot="bg-up" className="xl:w-[58%]">
          <Card
            title="📌 昨日涨停池（唯一权威）"
            extra={<CardBadge>{y?.date ?? '—'}</CardBadge>}
          >
            {!y ? (
              <EmptyState text="昨日涨停池未落盘 —— record_zt_snapshot 未运行，本页所有涨停数口径均不可信" />
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                  <StatPair label="涨停家数" value={y.zt_count} tone="up" />
                  <StatPair label="最高板" value={boardsLabel(y.max_boards)} tone="rec" />
                  <StatPair label="天梯层数" value={yLadder.length} />
                  <StatPair label="明细条数" value={y.zt_list?.length ?? '—'} />
                  <StatPair
                    label="固化时间"
                    value={y.generated_ts ? y.generated_ts.slice(11, 16) : '—'}
                  />
                </div>

                {yLadder.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-line-faint pt-2">
                    {yLadder.map((l) => (
                      <div key={l.boards} className="flex items-baseline gap-2">
                        <span className="badge bg-up-soft text-up flex-none">
                          {boardsLabel(l.boards)}
                        </span>
                        <span className="num text-[11.5px] text-sub flex-none w-[30px] text-right">
                          {l.names.length}
                        </span>
                        <span className="text-[12.5px] text-txt">{l.names.join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(y.zt_list?.length ?? 0) > 0 && (
                  <div className="border-t border-line-faint pt-2 max-h-[420px] overflow-y-auto">
                    <DataTable
                      dense
                      rows={y.zt_list ?? []}
                      rowKey={(r) => r.code}
                      columns={[
                        { label: '名称', cell: (r) => <span className="text-txt">{r.name}</span> },
                        { label: '代码', cell: (r) => <span className="num text-sub">{r.code}</span> },
                        { label: '板数', num: true, cell: (r) => boardsLabel(r.boards) },
                        {
                          label: '涨幅',
                          num: true,
                          cell: (r) => <span className={toneCls(r.pct)}>{pct(r.pct)}</span>,
                        },
                        {
                          label: '换手',
                          num: true,
                          cell: (r) => <span className="num text-sub">{rate(r.hs)}</span>,
                        },
                        {
                          label: '首封',
                          num: true,
                          cell: (r) => <span className="num text-sub">{fmtFbt(r.fbt)}</span>,
                        },
                        {
                          label: '炸板',
                          num: true,
                          cell: (r) => <span className="num text-sub">{r.zbc}</span>,
                        },
                        { label: '板块', cell: (r) => <span className="text-sub">{r.sector || '—'}</span> },
                      ]}
                    />
                  </div>
                )}
              </div>
            )}
          </Card>
        </Zone>

        <Zone label="情绪快照 · 盘中过程留痕" dot="bg-rec" className="xl:w-[42%]">
          <Card
            title="🧠 情绪快照"
            extra={
              <div className="flex items-center gap-2">
                {memFiles.length > 1 && (
                  <SegTabs
                    items={memFiles.slice(0, 8).map((f) => ({
                      key: f.file,
                      label: fileDate(f.file).slice(5),
                    }))}
                    value={memPickFile}
                    onChange={setMemPick}
                  />
                )}
                <CardBadge>{memFiles.length} 期</CardBadge>
              </div>
            }
          >
            {!mem ? (
              <EmptyState text="情绪快照未落盘（memory_lib 未运行）" />
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                  <StatPair
                    label="情绪定性"
                    value={mem.market_state.sentiment}
                    tone={memTone(mem.market_state.sentiment)}
                  />
                  <StatPair label="涨停家数" value={mem.market_state.total_zt} tone="up" />
                  <StatPair label="主导板块" value={mem.market_state.dominant_sector || '—'} />
                  <StatPair label="指数趋势" value={mem.market_state.index_trend || '—'} />
                  <StatPair
                    label="情绪生变于"
                    value={mem.market_state.sentiment_change_at || '—'}
                  />
                </div>

                {/* 情绪事件流 —— 「几点开始转暖/转衰」的唯一来源 */}
                <div className="border-t border-line-faint pt-2">
                  <div className="text-[11px] text-sub mb-1">
                    情绪事件流（{(mem.event_log ?? []).length} 条）
                  </div>
                  {(mem.event_log ?? []).length === 0 ? (
                    <div className="text-sub text-[12px]">当日无情绪事件记录</div>
                  ) : (
                    <ul className="flex flex-col max-h-[220px] overflow-y-auto">
                      {(mem.event_log ?? []).map((e, i) => (
                        <li
                          // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：事件流与时间轴严格对齐，同一时刻可能重复同一句话，用内容做 key 反而会撞。
                          key={i}
                          className="flex items-baseline gap-2 py-1 border-b border-line-faint last:border-0"
                        >
                          <span className="num text-[11.5px] text-sub flex-none w-[38px]">
                            {e.time}
                          </span>
                          {/*
                            ⚠️ 刻意**不给 severity 上语义色** —— 'high' 说的是「信号强度」，
                            与 A 股涨跌方向无关；套上红/绿会把「高强度利空」渲染成看多。
                          */}
                          <Tag title="原系统严重度标记（信号强度，非涨跌方向）">{e.severity}</Tag>
                          <span className="text-[12.5px] text-txt">{e.event}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 当日推送台账 —— 「今天系统推过什么、推了几次」 */}
                <div className="border-t border-line-faint pt-2">
                  <div className="text-[11px] text-sub mb-1">
                    当日推送题材（{(mem.pushed_topics ?? []).length} 条）
                  </div>
                  {(mem.pushed_topics ?? []).length === 0 ? (
                    <div className="text-sub text-[12px]">当日无题材推送</div>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {(mem.pushed_topics ?? []).map((t) => (
                        <li key={t.name} className="flex flex-col gap-0.5">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[12.5px] font-semibold text-txt">{t.name}</span>
                            <span className="num text-[11px] text-sub">推 {t.push_count} 次</span>
                            <span className="num text-[11px] text-sub">
                              {t.first_pushed}~{t.last_pushed}
                            </span>
                          </div>
                          {t.context && (
                            <div className="text-[11.5px] text-sub leading-relaxed line-clamp-2">
                              {t.context}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border-t border-line-faint pt-1.5 text-sub text-[11px]">
                  各任务最后推送：
                  {Object.entries(mem.last_push_by_task ?? {}).length === 0
                    ? '—'
                    : Object.entries(mem.last_push_by_task)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(' · ')}
                </div>
              </div>
            )}
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

/** 情绪分着色 —— 复用 shared/lib 的口径（≥6 红 / ≤2 绿 / 其间蓝） */
function sentCls(score: number): string {
  const c = sentimentClass(score)
  return c === 'up' ? 'text-up' : c === 'down' ? 'text-down' : c === 'mid' ? 'text-mid' : 'text-txt'
}

/**
 * 情绪**定性词** → 语义色。
 *
 * ⚠️ 与 `sentCls` 不是同一件事：`sentCls` 吃的是 0–10 的**数值分**，
 *    这里吃的是原系统写进快照的**中文定性词**（`market_state.sentiment`）。
 *
 * ⚠️ 取值是开放集（实测近 20 期只出现「亢奋 / 分歧」两种，但不保证封版），
 *    故**未知词一律返回 `undefined`（保持中性灰）**，绝不按字面猜方向 ——
 *    猜错会把「退潮」渲染成看多，比不显色危险得多。
 */
function memTone(
  sentiment: string | null | undefined,
): 'up' | 'down' | 'warn' | 'sub' | undefined {
  if (!sentiment) return undefined
  const s = sentiment.trim()
  if (['亢奋', '修复', '回暖', '转强', '强势'].includes(s)) return 'up'
  if (['退潮', '冰点', '低迷', '转弱', '弱势'].includes(s)) return 'down'
  // 分歧 = 方向未定 —— 用警戒青绿而非涨跌色，避免被读成看多看空
  if (['分歧', '震荡', '反复'].includes(s)) return 'warn'
  return undefined
}

/** 序列横向滚动容器 —— 逐日值一行排开，便于肉眼比较相邻日 */
function SeqRow({ label, seq, tone }: { label: string; seq: string[]; tone: 'sent' | 'nu' | 'plain' }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-sub text-[12px] w-[62px] flex-none pt-0.5">{label}</span>
      <div className="flex flex-wrap gap-1">
        {seq.map((v, i) => {
          const n = Number(v.replace('%', ''))
          const cls =
            tone === 'nu'
              ? n >= 3
                ? 'text-down'
                : 'text-txt'
              : tone === 'sent'
                ? sentCls(n)
                : 'text-txt'
          return (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
              key={i}
              className={cn('num text-[12px] px-1.5 py-0.5 border border-line-faint rounded-sm min-w-[38px] text-center', cls)}
            >
              {v}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/*
 * 说明：原先此处有一个页面内私有的「极简柱形 Sparkline」。
 * 已删除并改用 `@/shared/ui` 的统一 Sparkline —— 私有实现有两个问题：
 *   ① 遇到 `null` 会算成 0 高（`.map` 直接取值），把「无样本」画成「零涨停」；
 *   ② 柱形与全站其它迷你趋势线（折线）形态不一致，同一概念两种画法。
 * 统一后与 LineChart 共享同一套 null 断点语义。
 */
