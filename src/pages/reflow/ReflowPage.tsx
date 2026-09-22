import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { RotationCandidate } from '@/shared/api'
import { DataTable, StatPair, Tag, n1, n2, pct } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarChart, BarList, Card, CardBadge, EmptyState, Icon, Zone, ZoneRow } from '@/shared/ui'
import { cn } from '@/shared/lib'

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
  await queryClient.ensureQueryData(marketQueries.rotation())
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

export function Component() {
  const rot = useQuery(marketQueries.rotation())
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

  /**
   * 回流信号排序条 —— 本页的核心交付物「可排序的介入清单」的视觉版。
   *
   * 附注给出**因子结构与冷却天数**：同样的置信度分值，来自「四因子齐备」还是
   * 「仅形态回流」是完全不同的操作价值，光看条长会把两者混为一谈。
   * 未启动的题材排在前面（可低吸），已启动的置后并整体压在下方 —— 顺序本身就是建议。
   */
  const signalItems = useMemo(() => {
    const ordered = [...calm, ...moved]
    return ordered.slice(0, 15).map((c) => ({
      label: c.theme,
      value: c.confidence,
      note: `${confTier(c).label} · 冷却 ${c.cooled_days} 日`,
    }))
  }, [calm, moved])

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
      { label: 'K线止跌', value: cnt((c) => String(c.confidence_factors.kline ?? '').startsWith('stop_fall')), tone: 'mid' as const },
      { label: '阶段爆发位', value: cnt((c) => c.confidence_factors.phase === 'boom'), tone: 'mid' as const },
      { label: '大盘配合', value: cnt((c) => c.confidence_factors.market === true), tone: 'mid' as const },
      { label: '今日已动', value: moved.length, tone: 'mid' as const },
    ]
  }, [all, moved])

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
          <StatPair
            label="K线止跌"
            value={all.filter((c) => String(c.confidence_factors.kline ?? '').startsWith('stop_fall')).length}
            tone="up"
          />
          <StatPair label="新催化" value={all.filter((c) => c.catalyst_fresh).length} />
          <StatPair label="窗口" value={d?.data_meta?.window ?? '—'} />
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          置信度是**五因子**（催化 / 大盘 / 资金 / 相位 / **K线止跌**）加权后的**排序分值**，
          不是成功率 —— 本页按它排序，但不把它当概率解读。「K线止跌」看的是**该题材龙头个股**
          的日K（站上MA5 / 近2日不创新低 / 跌幅收窄 / 缩量，四条命中≥2 成立）。
          「今日已动」的题材已失去低吸位置，与「未启动」分开列示。
        </p>
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
              <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
                <Icon name="target" size={13} className="text-rec" />
                置信度 Top {signalItems.length}（未启动优先）
              </div>
              <BarList
                items={signalItems}
                format={(v) => (v == null ? '—' : n1(v))}
                labelWidth={96}
                emptyText="无回流候选"
              />
              <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
                条长按<b className="text-txt">本批最高置信度</b>归一，仅表批内相对强弱。
                附注里的因子结构必须一并读：同样的分值，来自
                <b className="text-txt"> 四因子齐备</b> 与 <b className="text-txt">仅形态回流</b>
                的操作价值完全不同。排序把<b className="text-txt">未启动（可低吸）</b>排在前面，
                已启动的置后 —— <b className="text-txt">顺序本身就是建议</b>。
              </p>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
                <Icon name="dna" size={13} className="text-sub" />
                四因子命中结构
              </div>
              <BarChart bars={factorBars} height={175} format={(v) => `${v} 个`} maxBarWidth={38} showValue />
              <p className="text-sub text-[11px] mt-1.5 leading-relaxed">
                柱高 = <b className="text-txt">命中该因子的题材数</b>（不是分值），
                故统一用中性蓝着色 —— 计数没有好坏语义，染红染绿都是过度解读。
                <br />
                <b className="text-txt">「资金回流」柱子最高、而「催化新」很低</b> = 这轮回流靠资金推动、
                缺乏新增催化，属技术性回流而非逻辑修复，持续性通常更弱。
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
            { label: '资金趋势', cell: (c) => <span className="text-sub text-[11.5px]">{c.flow_trend || '—'}</span> },
            { label: '板块构成', cell: (c) => <span className="text-sub text-[11.5px]">主板 {c.board_mix?.main ?? '—'} / 创业 {c.board_mix?.cyb ?? '—'}</span> },
            {
              label: '触发条件',
              className: 'whitespace-normal min-w-[280px]',
              cell: (c) => <span className="text-[12px] leading-relaxed">{c.trigger || '—'}</span>,
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
            { label: '置信度', num: true, cell: (c) => n1(c.confidence) },
            { label: '冷却', num: true, cell: (c) => `${c.cooled_days} 日` },
            {
              label: '爆发参照',
              cell: (c) => (
                <span className="text-sub text-[11.5px]">
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
            { label: '涨停方向', cell: (c) => <span className="text-sub text-[11.5px]">{c.zt_dir || '—'}</span> },
          ]}
        />
      </Card>
        </Zone>

        <Zone label="池全量底表" dot="bg-mid" className="xl:w-[38%]">
      {all.length > 0 && (
        <Card title="观察池与主板池全量" extra={<CardBadge>按题材归属核对</CardBadge>}>
          <p className="text-warn text-[11.5px] leading-relaxed border-l-2 border-warn pl-2.5 mb-2">
            铁律：池内题材标签不可直接采信 —— 须按个股真实主轴核对。下表按题材分组列出标的，
            距「可操作」还差一步人工确认。
          </p>
          <div className="flex flex-col gap-2">
            {sorted.map((c) => (
              <div key={c.theme} className="border border-line rounded-sm px-2.5 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1.5">
                  <span className="text-[13px] font-semibold text-txt">{c.theme}</span>
                  <Tag tone={confTier(c).tone}>{confTier(c).label}</Tag>
                  <span className="text-sub text-[11.5px]">
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
                        s.pct > 0 && !s.dragon && 'text-up border-up',
                      )}
                      title={`${s.code} · ${s.board || '板块未知'} · ${n2(s.cap_yi)}亿${s.risk ? ` · ${s.risk}` : ''}`}
                    >
                      {s.dragon ? '龙 ' : ''}
                      {s.name}
                      <span className="num ml-1">{pct(s.pct, 1)}</span>
                    </span>
                  ))}
                  {(c.watch_pool?.length ?? 0) === 0 && <span className="text-sub text-[11.5px]">观察池为空</span>}
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
