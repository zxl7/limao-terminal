import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, queryClient } from '@/shared/api'
import type { ThemeLibrary } from '@/shared/api/types'
import type { PoolStock, RotationCandidate, SectorFlowFull } from '@/shared/api'
import { DataTable, SegTabs, StatPair, Tag, n1, n2, pct } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarList, Card, CardBadge, EmptyState, Icon, Sparkline, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, capitalText, klineText, phaseText, ztDirText, tradableStocks } from '@/shared/lib'

/**
 * 题材轮动 —— 数据源 `cache/rotation.json`（`scripts/theme_rotation.py` 产出）。
 *
 * ## 这一页承载三块互不重叠的信息
 *
 * 1. **回流候选**（`candidates`）——「哪些炒过的题材快回来了」。
 *    核心字段是 `cooled_days`（冷却天数）与 `confidence`（置信度）。
 *    `confidence_factors` 把置信度拆成**五因子**（催化 / 大盘 / 资金 / 阶段 / K线止跌），
 *    这是**可核查的**置信度，不是拍脑袋的分数。
 * 2. **板块资金 5 日**（`flow_5d`）——「钱往哪去」。区间累计净额 + 流入天数
 *    比单日净额稳健得多（单日容易被大单扰动）。
 * 3. **规避名单**（`avoidance_sweep`）——「钱从哪走」。这是原系统少见的
 *    **负向清单**，`tier`/`stance` 给出回避强度。
 *
 * ## ⚠️ 铁律：`watch_pool` 的题材标签不可直接采信
 *
 * 原系统 2026-09-03 定的最高级铁律：按个股**真实主轴**归类，不得盲从
 * `watch_pool` 的标签（典型误判：星网锐捷 = 通信/CPO 算力，**非**数字货币）。
 * 本页因此把 `watch_pool` 与 `main_board_pool` 并列展示，并把板块归属
 * （`board`）显式列出，便于人工核对。
 */

export async function loader() {
  await queryClient.ensureQueryData(marketQueries.rotation())
  return null
}

/**
 * 轮动候选的执行阶段。
 *
 * `confidence` 是上游的原始排序分，不能替代低回撤入场判断：当日已爆发、资金走弱或
 * 大盘拖累的题材，即使分数高也不能排在埋伏机会之前。这里仅消费既有五因子，不改上游策略参数。
 */
type RotationStage = {
  key: 'ambush' | 'confirm' | 'started' | 'invalid' | 'incomplete'
  label: string
  tone: 'up' | 'rec' | 'warn' | 'down' | 'neutral'
  action: string
  reason: string
}

function rotationStage(c: RotationCandidate): RotationStage {
  const f = c.confidence_factors
  const capitalReady = f.capital === 'inflow_rising'
  const capitalWeak = ['inflow_fading', 'outflow_widening', 'outflow'].includes(f.capital)
  const kline = String(f.kline ?? '')
  const klineReady = kline.startsWith('stop_fall')
  const klineMissing = !kline || kline === 'no_data'
  const started = c.today_hot || f.phase === 'boom'

  if (capitalWeak || f.market === false || c.zt_dir === 'falling') {
    return { key: 'invalid', label: '回流失效', tone: 'down', action: '不买', reason: '钱在撤、大盘拖累，或涨停家数在减少' }
  }
  if (started) {
    return { key: 'started', label: '已启动', tone: 'warn', action: '只观察', reason: '今天已经涨起来了，错过了提前布局的位置' }
  }
  if (klineMissing || f.capital === 'no_data') {
    return { key: 'incomplete', label: '数据待补', tone: 'neutral', action: '不买', reason: '资金或走势数据缺失，没看清就不动手' }
  }
  if (capitalReady && klineReady && c.catalyst_fresh && f.market === true) {
    return { key: 'ambush', label: '埋伏就绪', tone: 'up', action: '优先看', reason: '钱回来了、走势止跌、消息也新，但还没启动' }
  }
  return { key: 'confirm', label: '等待确认', tone: 'rec', action: '观察', reason: '钱、走势、消息、大盘这几项里还差至少一项' }
}

const STAGE_ORDER: Record<RotationStage['key'], number> = {
  ambush: 0,
  confirm: 1,
  started: 2,
  invalid: 3,
  incomplete: 4,
}

/**
 * 题材走到哪了只解释题材所处位置；`RotationStage` 单独回答当前是否值得放进埋伏漏斗。
 * 两者不混用，避免把“爆发扩散”误读成“可提前埋伏”。
 */
type ThemeLifecycle = {
  key: 'potential' | 'start' | 'boom' | 'cooling' | 'reflow-watch' | 'reflow-ambush' | 'reflow-confirm' | 'fade'
  label: string
  tone: 'up' | 'rec' | 'warn' | 'down' | 'neutral'
  description: string
}

const LIFECYCLE_ORDER: ThemeLifecycle['key'][] = [
  'potential',
  'start',
  'boom',
  'cooling',
  'reflow-watch',
  'reflow-ambush',
  'reflow-confirm',
  'fade',
]

function themeLifecycle(c: RotationCandidate): ThemeLifecycle {
  const f = c.confidence_factors
  const phase = c.phase || f.phase
  const stage = rotationStage(c)
  const capitalWeak = ['inflow_fading', 'outflow_widening', 'outflow'].includes(f.capital)

  if (capitalWeak || f.market === false || c.zt_dir === 'falling' || phase === 'dead' || phase === 'no-reentry') {
    return { key: 'fade', label: '退潮失效', tone: 'down', description: '资金撤离、方向走弱，退出观察' }
  }
  if (phase === 'boom') {
    return { key: 'boom', label: '爆发扩散', tone: 'warn', description: '板块集中走强，关注强度与分歧' }
  }
  if (phase === '分歧' || phase === 'cooling') {
    return { key: 'cooling', label: '分歧冷却', tone: 'neutral', description: '热度回落，等止跌与资金回流' }
  }
  if (phase === 're-entry-candidate') {
    if (stage.key === 'ambush') {
      return { key: 'reflow-ambush', label: '回流埋伏', tone: 'up', description: '止跌、资金转入后，尚未启动的优先候选' }
    }
    if (c.today_hot) {
      return { key: 'reflow-confirm', label: '回流确认', tone: 'rec', description: '已有价格响应，验证是否形成新一轮扩散' }
    }
    return { key: 'reflow-watch', label: '回流观察', tone: 'rec', description: '老主线出现回流迹象，等待关键证据' }
  }
  if (c.today_hot || c.zt_dir === 'new' || c.zt_dir === 'rising') {
    return { key: 'start', label: '启动试盘', tone: 'rec', description: '价格有响应，尚未确认扩散' }
  }
  return { key: 'potential', label: '酝酿潜伏', tone: 'neutral', description: '题材仍在沉淀，暂不形成介入结论' }
}

export function Component() {
  const rot = useQuery(marketQueries.rotation())
  const d = rot.data
  // 大盘上下文是「参考态」时（接口不全/超时），情绪/核按钮只是参考值，⛔ 不能当实时读数
  const ctx = d?.market_context as { reference_only?: boolean; age_seconds?: number } | undefined
  const ctxRef = Boolean(ctx?.reference_only)
  const ctxAge = ctx?.age_seconds ? Math.max(1, Math.round(ctx.age_seconds / 60)) : 0
  const [tab, setTab] = useState<'reflow' | 'trend' | 'flow' | 'avoid'>('reflow')

  /** 候选列表：`d?.candidates ?? []` 每次渲染都会生成新数组，故显式 memo 稳定引用 */
  const candidates = useMemo(() => d?.candidates ?? [], [d])
  /**
   * 先按执行阶段、再按原始分排序：低回撤埋伏必须排在爆发题材与失效题材之前。
   * 同阶段仍保留上游 confidence 的相对顺序，避免在终端重写策略权重。
   */
  const sorted = useMemo(
    () => [...candidates].sort((a, b) => {
      const stageGap = STAGE_ORDER[rotationStage(a).key] - STAGE_ORDER[rotationStage(b).key]
      return stageGap || (b.confidence ?? 0) - (a.confidence ?? 0)
    }),
    [candidates],
  )
  const stageCounts = useMemo(() => {
    const count = (key: RotationStage['key']) => candidates.filter((c) => rotationStage(c).key === key).length
    return {
      ambush: count('ambush'),
      confirm: count('confirm'),
      started: count('started'),
      invalid: count('invalid'),
      incomplete: count('incomplete'),
    }
  }, [candidates])
  const lifecycleCounts = useMemo(() => {
    const count = (key: ThemeLifecycle['key']) => candidates.filter((c) => themeLifecycle(c).key === key).length
    return Object.fromEntries(LIFECYCLE_ORDER.map((key) => [key, count(key)])) as Record<ThemeLifecycle['key'], number>
  }, [candidates])
  /** 生命周期顺序展示；同一阶段内仍按原始排序分保留上游相对强弱。 */
  const lifecycleGroups = useMemo(
    () => LIFECYCLE_ORDER.map((key) => {
      const rows = sorted.filter((c) => themeLifecycle(c).key === key)
      return rows.length ? { lifecycle: themeLifecycle(rows[0]), rows } : null
    }).filter((group): group is { lifecycle: ThemeLifecycle; rows: RotationCandidate[] } => group != null),
    [sorted],
  )

  const mc = d?.market_context
  const flows = d?.flow_5d
  const sentiment = mc?.sentiment_score

  /** 题材涨停序列的日期轴（`zt_series` 与顶层 `data_days` 严格同长） */
  const dayLabels = useMemo(() => (d?.data_days ?? []).map((x) => x.slice(5)), [d])

  /**
   * 题材涨停趋势条 —— 把 `zt_series` 从「一串数字标签」变成形状。
   *
   * 表格里的序列是 7 个并排的方块，要逐个读完再心算才能判断走势；折线一眼可辨
   * 「持续爬升 / 单根尖峰 / 逐日衰减」。取当日涨停数前 12 个题材（页面已无更细的排序口径）。
   *
   * 折线着色按 `dir`（rising 红 / falling 绿 / 走平灰）—— 方向即语义，
   * 与表格里的「方向」Tag 同源，不会出现图形与标签打架。
   */
  const trendRows = useMemo(() => {
    const list = d?.sector_zt_trends ?? []
    return [...list].sort((a, b) => b.latest - a.latest).slice(0, 12)
  }, [d])

  /** 5 日资金双向榜 —— 流入流出合成一张零线居中的榜，对冲关系一眼可见 */
  const flow5d = useMemo(() => {
    const inflow = (flows?.inflow_top ?? []).map((r) => ({
      label: r.name,
      value: r.total_yi,
      note: `${r.inflow_days}/${r.days} 日`,
    }))
    const outflow = (flows?.outflow_top ?? [])
      .slice()
      .sort((a, b) => a.total_yi - b.total_yi)
      .map((r) => ({ label: r.name, value: r.total_yi, note: `${r.inflow_days}/${r.days} 日` }))
    return [...inflow, ...outflow]
  }, [flows])

  /** 当日进出榜合并（同「资金流向」页口径） */
  const todayDuel = useMemo(() => {
    const inflow = (mc?.inflow_top ?? []).map((r) => ({ label: r.name, value: r.flow_yi }))
    const outflow = (mc?.outflow_top ?? [])
      .slice()
      .sort((a, b) => a.flow_yi - b.flow_yi)
      .map((r) => ({ label: r.name, value: r.flow_yi }))
    return [...inflow, ...outflow]
  }, [mc])

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🔄 题材轮动"
        extra={
          <CardBadge
            tone={sentiment == null ? 'neutral' : sentiment >= 6 ? 'up' : sentiment <= 2 ? 'down' : 'neutral'}
          >
            轮动快照 {d?.generated_ts?.slice(11, 19) ?? '—'} · 情绪 {n1(sentiment)} · 快照涨停 {mc?.zt_count_today ?? '—'}{ctxRef ? ` · 大盘参考态 ${ctxAge} 分钟前` : ''}
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="数据日" value={d?.date ?? '—'} />
          <StatPair label="回流候选" value={candidates.length} />
          <StatPair label="埋伏就绪" value={stageCounts.ambush} tone="up" />
          <StatPair label="等待确认" value={stageCounts.confirm} tone="rec" />
          <StatPair label="已启动" value={stageCounts.started} tone="warn" />
          <StatPair label="回流失效" value={stageCounts.invalid} tone="down" />
          <StatPair label={ctxRef ? '晋级率(参考)' : '晋级率'} value={mc ? `${n1(mc.promote_rate)}%` : '—'} />
          <StatPair
            label={ctxRef ? '核按钮(参考)' : '核按钮'}
            value={mc?.nuke_count ?? '—'}
            tone={(mc?.nuke_count ?? 0) >= 3 ? 'down' : 'sub'}
          />
          <StatPair label="数据天数" value={d?.data_meta?.aligned_days ?? '—'} />
          <StatPair label="覆盖范围" value={d?.data_meta?.window ?? '—'} />
          <StatPair label="涨停源" value={d?.data_meta?.zt_source ?? '—'} />
        </div>
        {d?.note && <p className="text-sub text-12 leading-relaxed">{d.note}</p>}
        {d?.generated_ts && <p className="text-warn text-12 leading-relaxed">本页轮动候选与资金榜取自 {d.generated_ts.replace('T', ' ').slice(0, 19)} 的快照，盘中变化以“盘中实时”页的当前快照为准。</p>}
        {!rot.isLoading && !d && (
          <EmptyState text="题材轮动数据未生成" hint="cache/rotation.json 缺失" />
        )}
      </Card>

      {/* 主工作区 = 轮动明细（回流候选 / 涨停趋势 / 5日资金 / 规避，四 tab 内容最重）；
          辅助区 = 当日板块资金进出榜（单日快照，次要）。
          ⛔ 旧版 3 张卡等宽纵向平铺，主次不分且 4K 下右侧大片空白。 */}
      <ZoneRow>
        <Zone label="轮动明细" dot="bg-lead" className="xl:w-[62%]">
          <Card
            title="明细"
        extra={
          <SegTabs
            items={[
              { key: 'reflow', label: `回流候选 (${sorted.length})` },
              { key: 'trend', label: `涨停家数 (${d?.sector_zt_trends?.length ?? 0})` },
              { key: 'flow', label: '5 日资金' },
              { key: 'avoid', label: `规避名单 (${d?.avoidance_sweep?.length ?? 0})` },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'reflow' && (
          <div className="flex flex-col gap-2">
            {sorted.length === 0 && <EmptyState text="当前无轮动候选" />}
            {sorted.length > 0 && (
              <ThemeLifecycleFunnel counts={lifecycleCounts} />
            )}
            {lifecycleGroups.map(({ lifecycle, rows }) => (
              <div key={lifecycle.key} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 text-12 pt-1.5 border-t border-line-faint first:border-t-0 first:pt-0">
                  <Tag tone={lifecycle.tone}>{lifecycle.label}</Tag>
                  <span className="text-sub">{lifecycle.description}</span>
                  <span className="num text-sub">{rows.length} 个</span>
                </div>
                {rows.map((c) => (
                  <ReflowRow key={c.theme} c={c} stage={rotationStage(c)} lifecycle={themeLifecycle(c)} />
                ))}
              </div>
            ))}
            {sorted.length > 0 && (
              <p className="text-warn text-12 leading-relaxed border-l-2 border-warn pl-2.5">
                提醒：题材名只是标签，不等于这只票真正在炒什么。
                比如通信、算力票常被挂到别的题材下 —— 下单前请对一眼个股本身的业务。
              </p>
            )}
          </div>
        )}

        {tab === 'trend' && (
          <>
            {trendRows.length > 0 && (
              <div className="mb-3">
                <div className="text-12 font-semibold mb-1.5 flex items-center gap-1">
                  <Icon name="trendUp" size={13} className="text-sub" />
                  涨停趋势形状（当日涨停数 Top {trendRows.length}）
                </div>
                <div className="flex flex-col gap-0.5">
                  {trendRows.map((r) => (
                    <div
                      key={r.theme}
                      className="flex items-center gap-2 text-12 py-0.5 border-b border-line/40 last:border-0"
                    >
                      <span className="w-[104px] shrink-0 truncate text-txt" title={r.theme}>
                        {r.theme}
                      </span>
                      <Sparkline
                        points={r.zt_series}
                        tone={r.dir === 'rising' ? 'up' : r.dir === 'falling' ? 'down' : 'sub'}
                        area
                        height={22}
                        className="flex-1"
                        /* `zt_series` 与顶层 `data_days` 严格同长（实测均为 5），故可直接对齐 */
                        labels={dayLabels}
                        format={(v) => `${n1(v)} 家`}
                      />
                      <span className="num w-[34px] shrink-0 text-right font-semibold text-txt">{r.latest}</span>
                      <span
                        className={cn(
                          'num w-[40px] shrink-0 text-right',
                          r.delta > 0 ? 'text-up' : r.delta < 0 ? 'text-down' : 'text-sub',
                        )}
                      >
                        {r.delta > 0 ? `+${r.delta}` : r.delta}
                      </span>
                      <span className="w-[38px] shrink-0 text-right text-11 text-sub">
                        {r.dir === 'rising' ? '升温' : r.dir === 'falling' ? '降温' : '走平'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-sub text-11 mt-1.5 leading-relaxed">
                  看形状比看数字快：<b className="text-up">红线往上</b>＝这条线在变热，
                  <b className="text-down">绿线往下</b>＝在退烧，<b className="text-txt">灰线</b>＝没变化。
                  <b className="text-txt">一路爬升</b>＝参与的人在变多；
                  <b className="text-txt">只冒一根尖</b>＝一日游；
                  <b className="text-txt">一天比一天少</b>＝钱在撤。
                  线上<b className="text-txt">中间断开</b>＝那天没有可用数据（不是跌到 0）。
                </p>
              </div>
            )}
            <DataTable
              rows={d?.sector_zt_trends ?? []}
            rowKey={(r) => r.theme}
            empty="无趋势数据"
            columns={[
              { label: '题材', cell: (r) => <span className="text-txt">{r.theme}</span> },
              { label: '当日涨停', num: true, cell: (r) => r.latest },
              {
                label: '环比',
                num: true,
                cell: (r) => (
                  <span className={r.delta > 0 ? 'text-up' : r.delta < 0 ? 'text-down' : 'text-txt'}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </span>
                ),
              },
              {
                label: '方向',
                cell: (r) => (
                  <Tag tone={r.dir === 'rising' ? 'up' : r.dir === 'falling' ? 'down' : 'neutral'}>
                    {r.dir === 'rising' ? '升温' : r.dir === 'falling' ? '降温' : '走平'}
                  </Tag>
                ),
              },
              {
                label: '序列',
                className: 'whitespace-normal',
                cell: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.zt_series.map((v, i) => (
                      <span
                        // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                        key={i}
                        className={cn(
                          'num text-12 px-1.5 border border-line-faint rounded-sm min-w-[26px] text-center',
                          v == null ? 'text-sub' : v > 0 ? 'text-up' : 'text-txt',
                        )}
                      >
                        {v ?? '—'}
                      </span>
                    ))}
                  </span>
                ),
              },
              {
                label: '补全日数',
                num: true,
                cell: (r) => <span className="text-sub">{Object.keys(r.zt_filled ?? {}).length || '—'}</span>,
              },
            ]}
          />
          </>
        )}

        {tab === 'flow' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-12 font-semibold mb-1 flex items-center gap-1">
                <Icon name="flow" size={13} className="text-sub" />
                5 日累计净额双向榜
              </div>
              <BarList
                items={flow5d}
                format={(v) => `${v == null ? '—' : `${v > 0 ? '+' : ''}${n2(v)}`} 亿`}
                bipolar
                labelWidth={104}
                emptyText="无 5 日资金数据"
              />
              <p className="text-sub text-11 mt-1.5 leading-relaxed">
                零线居中：右边红条是累计净流入、左边绿条是净流出。
                下面的<b className="text-txt">「连着流入」</b>更要紧——连着几天都在进，
                比一天砸进来一大笔更可靠；<b className="text-txt">金额大、天数少，多半是一日行情</b>。
              </p>
            </div>
            <Flow5DTable title="5 日资金净流入 Top" rows={flows?.inflow_top ?? []} days={flows?.data_days} />
            <Flow5DTable title="5 日资金净流出 Top" rows={flows?.outflow_top ?? []} days={flows?.data_days} />
          </div>
        )}

        {tab === 'avoid' && (
          <DataTable
            rows={d?.avoidance_sweep ?? []}
            rowKey={(r) => r.name}
            rowClass={(r) => (r.stance === 'avoid' ? 'bg-down/5' : undefined)}
            empty="无规避名单（或该项未在最近一期产出）"
            columns={[
              { label: '板块', cell: (r) => <span className="text-txt">{r.name}</span> },
              {
                label: '5日累计净额',
                num: true,
                cell: (r) => (
                  <span className={r.total_5d_yi < 0 ? 'text-down' : 'text-up'}>{n2(r.total_5d_yi)} 亿</span>
                ),
              },
              {
                label: '最近一日',
                num: true,
                cell: (r) => <span className={r.last_yi < 0 ? 'text-down' : 'text-up'}>{n2(r.last_yi)} 亿</span>,
              },
              { label: '流入天数', num: true, cell: (r) => r.inflow_days },
              { label: '档位', cell: (r) => <Tag tone={r.tier === 'high' ? 'down' : 'neutral'}>{r.tier || '—'}</Tag> },
              { label: '立场', cell: (r) => <span className="text-12">{r.stance || '—'}</span> },
              { label: '触发条件', cell: (r) => <span className="text-sub text-12">{r.trigger || '—'}</span> },
              {
                label: '升级提示',
                className: 'whitespace-normal min-w-[200px]',
                cell: (r) => <span className="text-12">{r.upgrade_hint || '—'}</span>,
              },
            ]}
          />
        )}
      </Card>

        </Zone>

        <Zone label="当日资金" dot="bg-up" className="xl:w-[38%]">
          <Card title="快照板块资金进出榜" extra={<CardBadge>{d?.generated_ts || '—'}</CardBadge>}>
        {todayDuel.length > 0 && (
          <div className="mb-3">
            <div className="text-12 font-semibold mb-1 flex items-center gap-1">
              <Icon name="compass" size={13} className="text-sub" />
              当日资金对决（零线居中）
            </div>
            <BarList
              items={todayDuel}
              format={(v) => `${v == null ? '—' : `${v > 0 ? '+' : ''}${n2(v)}`} 亿`}
              bipolar
              labelWidth={104}
            />
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <FlowSide title="净流入" rows={mc?.inflow_top ?? []} />
          <FlowSide title="净流出" rows={mc?.outflow_top ?? []} />
        </div>
      </Card>

      {/* 📚 题材库沉淀（2026-11-16 用户「我在哪里可以看题材的沉淀」） */}
      <ThemeLibraryCard />
        </Zone>
      </ZoneRow>
    </div>
  )
}

/**
 * 题材库沉淀：把每日选股宝快照累计成「代码 → 题材历史」。
 * 数据 `cache/theme_library.json`（`scripts/theme_library.py` 15:35 追加）。
 */
function ThemeLibraryCard() {
  const lib = useQuery({ queryKey: ['theme', 'library'] as const, queryFn: api.themeLibrary, staleTime: 10 * 60_000 })
  const d = lib.data as ThemeLibrary | undefined
  const rows = useMemo(() => {
    const cnt = new Map<string, { n: number; days: number }>()
    for (const e of Object.values(d?.entries ?? {})) {
      const t = e.theme_base_latest || e.theme_latest
      if (!t) continue
      const cur = cnt.get(t) ?? { n: 0, days: 0 }
      cur.n += 1
      cur.days += e.day_count
      cnt.set(t, cur)
    }
    return [...cnt.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12)
  }, [d])

  if (!d) {
    return (
      <Card title="📚 题材库沉淀" extra={<CardBadge>—</CardBadge>}>
        <EmptyState text={lib.isLoading ? '加载中…' : '暂无题材库'} hint="每日 15:35 由快照合并生成" />
      </Card>
    )
  }
  const max = rows[0]?.[1].n ?? 1
  return (
    <Card title="📚 题材库沉淀" extra={<CardBadge>{d.day_count} 天 · {d.code_count} 只</CardBadge>}>
      <p className="text-11 text-sub m-0 mb-1.5">
        选股宝快照每日累计（{d.days[0]} ~ {d.days.at(-1)}）；下面的「只」＝出现过该题材的股票数
      </p>
      <ul className="text-12 leading-relaxed m-0">
        {rows.map(([name, v]) => (
          <li key={name} className="flex items-center gap-2 mb-0.5">
            <span className="w-[132px] flex-none truncate">{name}</span>
            <span className="h-[4px] flex-1 max-w-[220px] rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
              <span className="block h-full" style={{ width: `${Math.round((v.n / max) * 100)}%`, background: 'var(--color-lead)' }} />
            </span>
            <span className="num flex-none w-[52px] text-right">{v.n} 只</span>
            <span className="text-sub flex-none w-[64px] text-right">累计 {v.days} 天</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** 生命周期总览：按时间顺序呈现，数值为当前候选落在该阶段的数量。 */
function ThemeLifecycleFunnel({ counts }: { counts: Record<ThemeLifecycle['key'], number> }) {
  const steps: ThemeLifecycle[] = [
    { key: 'potential', label: '酝酿潜伏', tone: 'neutral', description: '底部沉淀' },
    { key: 'start', label: '启动试盘', tone: 'rec', description: '试强' },
    { key: 'boom', label: '爆发扩散', tone: 'warn', description: '扩散' },
    { key: 'cooling', label: '开始降温', tone: 'neutral', description: '热度在退' },
    { key: 'reflow-watch', label: '回流观察', tone: 'rec', description: '等证据' },
    { key: 'reflow-ambush', label: '回流埋伏', tone: 'up', description: '优先候选' },
    { key: 'reflow-confirm', label: '回流确认', tone: 'rec', description: '已有价格响应，验证扩散' },
    { key: 'fade', label: '退潮失效', tone: 'down', description: '退出' },
  ]

  return (
    <div className="border border-line rounded-sm px-2.5 py-2">
      <div className="text-12 font-semibold mb-1.5">题材走到哪了</div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {steps.map((step, index) => (
          <span key={step.key} className="inline-flex items-center gap-1">
            {index > 0 && <span className="text-sub text-11">→</span>}
            <span className={cn('inline-flex items-baseline gap-1 px-1.5 py-0.5 border rounded-sm text-12',
              step.tone === 'up' ? 'text-up border-up' : step.tone === 'down' ? 'text-down border-down' : step.tone === 'rec' ? 'text-rec border-rec' : step.tone === 'warn' ? 'text-warn border-warn' : 'text-sub border-line')}>
              {step.label}<b className="num">{counts[step.key]}</b>
            </span>
          </span>
        ))}
      </div>
      <p className="text-sub text-11 leading-relaxed mt-1.5">
        想“提前布局”，要同时满足四件事：钱在回来、走势止跌、消息是新的、大盘不拖后腿，而且还没真正启动；已经有了价格反应的，就进入“确认回来了”，看能不能扩散。
      </p>
    </div>
  )
}

/** 回流候选单行卡片 —— 字段多且分四因子，横向铺开比塞进表格更易读 */
function ReflowRow({ c, stage, lifecycle }: { c: RotationCandidate; stage: RotationStage; lifecycle: ThemeLifecycle }) {
  const f = c.confidence_factors
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-line rounded-sm px-2.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-14 font-semibold text-txt bg-transparent border-0 cursor-pointer p-0"
        >
          {open ? '▾' : '▸'} {c.theme}
        </button>
        <Tag tone={lifecycle.tone}>{lifecycle.label}</Tag>
        <Tag tone={stage.tone}>{stage.label}</Tag>
        <span className={cn('text-12 font-semibold', stage.tone === 'up' ? 'text-up' : stage.tone === 'down' ? 'text-down' : 'text-sub')}>
          {stage.action}
        </span>
        <Tag tone={c.catalyst_fresh ? 'up' : 'neutral'}>{c.catalyst_fresh ? '新催化' : '催化已旧'}</Tag>
        <Tag tone={c.today_hot ? 'up' : 'neutral'}>{c.today_hot ? '今日已动' : '今日未动'}</Tag>
        <StatPair label="原始排序分" value={n1(c.confidence)} tone={c.confidence >= 60 ? 'up' : 'sub'} />
        <StatPair label="冷却" value={`${c.cooled_days} 日`} />
        <StatPair label="爆发日" value={c.boom_day ?? '—'} />
        <StatPair label="爆发涨停" value={c.boom_zt ?? '—'} />
        <StatPair label="爆发涨幅" value={c.boom_pct != null ? pct(c.boom_pct) : '—'} />
        <StatPair
          label="5日资金"
          value={c.tx_5d_yi != null ? `${n1(c.tx_5d_yi)} 亿` : '—'}
          tone={(c.tx_5d_yi ?? 0) > 0 ? 'up' : 'down'}
        />
        <StatPair
          label="10日资金"
          value={c.tx_10d_yi != null ? `${n1(c.tx_10d_yi)} 亿` : '—'}
          tone={(c.tx_10d_yi ?? 0) > 0 ? 'up' : 'down'}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-sub">
        <span>
          因子：
          <span className={f.catalyst ? 'text-up' : 'text-sub'}>催化 {f.catalyst ? '✓' : '✗'}</span>
          {' · '}
          <span className={f.capital === 'inflow_rising' ? 'text-up' : 'text-sub'}>
            资金 {capitalText(f.capital)}
          </span>
          {' · '}
          <span className={f.phase === 'boom' ? 'text-up' : 'text-sub'}>阶段 {phaseText(f.phase)}</span>
          {' · '}
          <span className={String(f.kline ?? '').startsWith('stop_fall') ? 'text-up' : 'text-sub'}>
            K线 {klineText(f.kline)}
          </span>
          {' · '}
          <span className={f.market === false ? 'text-down' : 'text-sub'}>
            大盘 {f.market == null ? '未知' : f.market ? '配合' : '拖累'}
          </span>
        </span>
        <span>
          板块构成 主板 {c.board_mix?.main ?? '—'} / 创业 {c.board_mix?.cyb ?? '—'}
        </span>
        <span>涨停方向 {ztDirText(c.zt_dir)}</span>
        <span>有效日 {c.zt_valid_days}</span>
      </div>

      <div className="mt-1 text-12 leading-relaxed">
        <span className={stage.tone === 'up' ? 'text-up' : stage.tone === 'down' ? 'text-down' : 'text-sub'}>
          {stage.label}：
        </span>
        {stage.reason}
      </div>

      {c.trigger && (
        <div className="mt-1 text-12 leading-relaxed">
          <span className="text-warn">触发条件：</span>
          {c.trigger}
        </div>
      )}
      {c.catalyst && <div className="mt-0.5 text-12 leading-relaxed text-sub">催化：{c.catalyst}</div>}

      {open && (
        <div className="mt-2 pt-2 border-t border-line-faint grid md:grid-cols-2 gap-3">
          <PoolTable title="观察池" rows={c.watch_pool ?? []} />
          <PoolTable title="主板池" rows={c.main_board_pool ?? []} />
          {c.pool_note && (
            <p className="md:col-span-2 text-sub text-12 leading-relaxed">池备注：{c.pool_note}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** 池内个股 —— `board` 显式展示，便于核对题材标签是否与真实主轴一致 */
function PoolTable({ title, rows }: { title: string; rows: PoolStock[] }) {
  return (
    <div>
      <div className="text-12 text-sub mb-1">
        {title}（{rows.length}）
      </div>
      <DataTable
        rows={tradableStocks(rows)}
        rowKey={(r) => r.code}
        dense
        empty="空"
        columns={[
          {
            label: '个股',
            cell: (r) => (
              <span>
                {r.dragon && <span className="text-lead mr-1">龙</span>}
                <StockLink code={r.code} className="text-txt">{r.name}</StockLink>
              </span>
            ),
          },
          {
            label: '涨幅',
            num: true,
            cell: (r) => (
              <span className={r.pct > 0 ? 'text-up' : r.pct < 0 ? 'text-down' : 'text-txt'}>{pct(r.pct)}</span>
            ),
          },
          { label: '市值', num: true, cell: (r) => `${n1(r.cap_yi)}亿` },
          { label: '板块', cell: (r) => <span className="text-sub text-12">{r.board || '—'}</span> },
          {
            label: '来源',
            cell: (r) => (r.from_zt ? <Tag tone="up">涨停池</Tag> : <span className="text-sub">—</span>),
          },
          {
            label: '风险',
            cell: (r) =>
              r.risk ? <span className="text-warn text-12">{r.risk}</span> : <span className="text-sub">—</span>,
          },
        ]}
      />
    </div>
  )
}

function Flow5DTable({
  title,
  rows,
  days,
}: {
  title: string
  rows: Array<{ name: string; total_yi: number; days: number; inflow_days: number; last_yi: number; trend: string; streak?: number }>
  days?: string[]
}) {
  return (
    <div>
      <div className="text-12 text-sub mb-1">
        {title}
        {days?.length ? ` · 窗口 ${days[0]} ~ ${days.at(-1)}` : ''}
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.name}
        dense
        empty="无数据"
        columns={[
          { label: '板块', cell: (r) => <span className="text-txt">{r.name}</span> },
          {
            label: '区间累计净额',
            num: true,
            cell: (r) => (
              <span className={cn('font-semibold', r.total_yi > 0 ? 'text-up' : 'text-down')}>
                {r.total_yi > 0 ? '+' : ''}
                {n2(r.total_yi)} 亿
              </span>
            ),
          },
          { label: '最近一日', num: true, cell: (r) => (r.last_yi > 0 ? `+${n2(r.last_yi)}` : n2(r.last_yi)) },
          { label: '流入天数', num: true, cell: (r) => `${r.inflow_days}/${r.days}` },
          {
            label: '连着流入',
            num: true,
            cell: (r) => (
              <span className={cn((r.streak ?? 0) >= 2 ? 'text-up font-semibold' : 'text-sub')}>
                {(r.streak ?? 0) > 0 ? `${r.streak} 天` : '—'}
              </span>
            ),
          },
          { label: '趋势', cell: (r) => <span className="text-sub text-12">{r.trend || '—'}</span> },
        ]}
      />
    </div>
  )
}

function FlowSide({ title, rows }: { title: string; rows: SectorFlowFull[] }) {
  return (
    <div>
      <div className="text-12 text-sub mb-1">{title}</div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.name}
        dense
        empty="无数据"
        columns={[
          {
            label: '板块',
            cell: (r) => (
              <span className={r.is_focus ? 'text-up font-semibold' : 'text-txt'}>
                {r.name}
                {r.is_focus && <span className="text-11 ml-1">关注</span>}
              </span>
            ),
          },
          {
            label: '涨幅',
            num: true,
            cell: (r) => (
              <span className={r.pct > 0 ? 'text-up' : r.pct < 0 ? 'text-down' : 'text-txt'}>{pct(r.pct)}</span>
            ),
          },
          {
            label: '主力净额',
            num: true,
            cell: (r) => (
              <span className={r.flow_yi > 0 ? 'text-up' : 'text-down'}>
                {r.flow_yi > 0 ? '+' : ''}
                {n2(r.flow_yi)} 亿
              </span>
            ),
          },
          { label: '超大单', num: true, cell: (r) => <span className="text-sub">{n2(r.super_large_yi)}</span> },
          { label: '大单', num: true, cell: (r) => <span className="text-sub">{n2(r.large_yi)}</span> },
          { label: '小单', num: true, cell: (r) => <span className="text-sub">{n2(r.small_yi)}</span> },
        ]}
      />
    </div>
  )
}
