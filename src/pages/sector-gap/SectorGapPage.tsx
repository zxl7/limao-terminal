import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { SectorGapDay, SectorGapRow, SectorGapStat } from '@/shared/api'
import { analyticsQueries, DataTable, SegTabs, StatPair, Tag } from '@/features/analytics'
import { Card, CardBadge, EmptyState, StockLink } from '@/shared/ui'

/**
 * 竞价三环影子 · 逐日留痕
 *
 * ⚠️ 本页是**对账页**，不是交易页：
 *   09:25 真正决定买不买的算法是 `ai_caliber.gap_zone`（逐票预期 DEV）。
 *   三环联动（板块 / 梯队 / 量能）目前只写进冻结件的影子字段，恒不改 view/zone/
 *   quota/仓位。本页把「若开守卫会砍谁」与事后收益并排，用来决定将来要不要转正。
 *
 * 两套收益**分列**：
 *   · 当日收盘 = 系统决策评估代理
 *   · 次交易日收盘 = `ai_judgement_next_day_close` 账本结算口径的 T+1 可执行代理
 * 二者都无成交回报、无费用滑点，⛔ 不是真实券商战绩，⛔ 不并入交易战绩页。
 */
export async function loader() {
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.sectorGapTrace()),
  ])
  return null
}

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`

const cls = (v: number | null | undefined) =>
  v == null ? 'text-sub' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-txt'

const STATUS_TEXT: Record<string, string> = {
  ok: '三环齐全',
  volume_veto: '量能证伪',
  abstain_missing_ring: '缺环不裁决',
  abstain_no_plates: '缺题材不裁决',
}

type Scope = 'flagged' | 'all'

export function SectorGapView() {
  const q = useQuery(analyticsQueries.sectorGapTrace())
  const data = q.data
  const [scope, setScope] = useState<Scope>('flagged')

  const days = useMemo<SectorGapDay[]>(
    () => [...(data?.days ?? [])].reverse(), [data],
  )
  const rows = useMemo<SectorGapRow[]>(() => {
    const base = [...(data?.rows ?? [])].sort(
      (a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code),
    )
    return scope === 'flagged'
      ? base.filter((r) => r.would_cut || r.veto || r.isolated)
      : base
  }, [data, scope])

  // ⚠️ 不能用 `!q.isLoading && !data`：查询失败后若发生重取，isLoading 会再次翻真，
  //    用户看到的就永远是「一屏 —」而不是「尚未生成」。用「已落定且无数据」判定。
  if (!data && (q.isError || !q.isFetching)) {
    return (
      <EmptyState
        text="竞价留痕尚未生成"
        hint="在狸猫猎手运行 scripts/sector_gap_daily_trace.py 后在此查看"
      />
    )
  }

  const s = data?.summary
  const groups: Array<{ key: string; label: string; pair: { same_close: SectorGapStat; t1_close: SectorGapStat } | undefined }> = [
    { key: 'v0', label: '现判据（全部）', pair: s?.v0 },
    { key: 'cut', label: '影子砍掉', pair: s?.cut },
    { key: 'keep', label: '影子保留', pair: s?.keep },
    { key: 'veto_strict', label: '量能证伪·干净组', pair: s?.veto_strict },
    { key: 'veto', label: 'veto 标记全组', pair: s?.veto },
    { key: 'abstain', label: '缺环不裁决', pair: s?.abstain },
  ]

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🧷 竞价三环影子 · 逐日留痕"
        extra={
          <span className="flex items-center gap-2">
            <CardBadge tone="neutral">只观察 · 不下单</CardBadge>
            {data?.generated_at && (
              <span className="text-11 text-sub">生成 {data.generated_at.slice(0, 16).replace('T', ' ')}</span>
            )}
          </span>
        }
      >
        <p className="text-12 text-sub leading-relaxed mb-3">
          <b className="text-txt">「影子」是什么：</b>同一批 09:25 竞价数据算两份结果 ——
          一份是真正下单用的裁决（逐票质量预期 <span className="num">DEV</span>），
          另一份是「板块 → 梯队 → 量能 → 预期」三环联动的<b className="text-txt">平行判断</b>。
          影子只写进冻结件的留痕字段，<b className="text-up">从不参与买不买、不改名额与仓位</b>。
          之所以不直接合并，是因为历史窗口的证据只够描述、不够开硬闸：先并行记账，
          攒够 T+1 可执行收益再决定要不要转正。
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <StatPair label="窗口" value={`${data?.window.start ?? '—'} ~ ${data?.window.end ?? '—'}`} />
          <StatPair label="有效交易日" value={data?.window.active_days ?? '—'} />
          <StatPair label="可买票次" value={s?.n_tradable ?? '—'} />
          <StatPair label="现判据 ok" value={s?.n_v0 ?? '—'} />
          <StatPair label="影子标记" value={s?.n_cut ?? '—'} tone="warn" />
          <StatPair label="砍对天数" value={`${s?.cut_better_days ?? '—'} / ${s?.cut_worse_days ?? '—'}`} />
        </div>
        <p className="text-11 text-sub mt-3">
          三条硬约束：缺选股宝题材快照不裁决 · 缺任一环不裁决 · 量能只证伪不打分。
          最新交易日的 T+1 收益要等次一交易日收盘才有，显示「—」属正常。
        </p>
      </Card>

      <Card
        title="累计对照 · 两套收益口径分列"
        extra={<CardBadge tone="warn">⛔ 晋级率 ≠ 买入胜率 ≠ 可执行收益</CardBadge>}
      >
        <DataTable
          rows={groups}
          rowKey={(r) => r.key}
          dense
          columns={[
            { label: '分组', cell: (r) => r.label },
            { label: '样本', num: true, cell: (r) => r.pair?.t1_close.n ?? '—' },
            { label: 'T+1 有价', num: true, cell: (r) => r.pair?.t1_close.covered ?? '—' },
            { label: '当日均值', num: true, cell: (r) => <span className={cls(r.pair?.same_close.mean)}>{fmt(r.pair?.same_close.mean)}</span> },
            { label: '当日胜率', num: true, cell: (r) => r.pair?.same_close.win_rate == null ? '—' : `${r.pair.same_close.win_rate.toFixed(1)}%` },
            { label: 'T+1 均值', num: true, cell: (r) => <span className={cls(r.pair?.t1_close.mean)}>{fmt(r.pair?.t1_close.mean)}</span> },
            { label: 'T+1 胜率', num: true, cell: (r) => r.pair?.t1_close.win_rate == null ? '—' : `${r.pair.t1_close.win_rate.toFixed(1)}%` },
            { label: '当日晋级', num: true, cell: (r) => r.pair?.t1_close.zt ?? '—' },
          ]}
        />
        <p className="text-11 text-sub mt-3">
          当日收盘＝竞价买入至收盘的评估代理；T+1＝竞价买入至次一交易日收盘，
          对齐<b className="text-txt">账本结算口径</b>。
          「量能证伪·干净组」是三环齐全、只被量能证伪的票；
          「veto 标记全组」还含缺环不裁决的票，两组⛔不可混读。
        </p>
      </Card>

      <Card title="逐日留痕" extra={<CardBadge tone="neutral">Δ = 若砍掉，组合 T+1 均值改善</CardBadge>}>
        <DataTable
          rows={days}
          rowKey={(r) => r.date}
          dense
          empty="尚无有效交易日"
          columns={[
            { label: '日期', cell: (r) => r.date },
            { label: '题材源', cell: (r) => <Tag tone={r.theme_src === 'plates' ? 'up' : 'neutral'}>{r.theme_src === 'plates' ? '选股宝' : '行业兜底'}</Tag> },
            { label: '可买', num: true, cell: (r) => r.n_tradable },
            { label: '现判据', num: true, cell: (r) => r.n_v0 },
            { label: '影子砍', num: true, cell: (r) => r.cut_codes.length },
            { label: '砍组 T+1', num: true, cell: (r) => <span className={cls(r.cut.t1_close.mean)}>{fmt(r.cut.t1_close.mean)}</span> },
            { label: '保留 T+1', num: true, cell: (r) => <span className={cls(r.keep.t1_close.mean)}>{fmt(r.keep.t1_close.mean)}</span> },
            { label: 'Δ T+1', num: true, cell: (r) => <span className={cls(r.delta_t1_pct)}>{r.delta_t1_pct == null ? '—' : `${r.delta_t1_pct >= 0 ? '+' : ''}${r.delta_t1_pct.toFixed(2)}pct`}</span> },
          ]}
        />
      </Card>

      <Card
        title="逐票明细（最近若干交易日）"
        extra={
          <SegTabs
            items={[
              { key: 'flagged', label: '仅标记票' },
              { key: 'all', label: '全部票' },
            ]}
            value={scope}
            onChange={(k) => setScope(k as Scope)}
          />
        }
      >
        <DataTable
          rows={rows}
          rowKey={(r) => `${r.date}-${r.code}`}
          dense
          empty="所选窗口暂无逐票明细"
          rowClass={(r) => r.would_cut ? 'bg-down-soft' : undefined}
          columns={[
            { label: '日期', cell: (r) => r.date },
            { label: '标的', cell: (r) => <StockLink code={r.code}>{r.name || r.code}</StockLink> },
            { label: '竞价', num: true, cell: (r) => <span className={cls(r.gap)}>{fmt(r.gap)}</span> },
            { label: '预期 E', num: true, cell: (r) => r.E == null ? '—' : `${r.E >= 0 ? '+' : ''}${r.E.toFixed(2)}%` },
            { label: 'DEV', num: true, cell: (r) => <span className={cls(r.DEV)}>{r.DEV == null ? '—' : `${r.DEV >= 0 ? '+' : ''}${r.DEV.toFixed(2)}`}</span> },
            { label: '偏离同题材', num: true, cell: (r) => r.gap_vs_theme == null ? '—' : `${r.gap_vs_theme >= 0 ? '+' : ''}${r.gap_vs_theme.toFixed(2)}` },
            { label: '背书', num: true, cell: (r) => `${r.credits_n ?? '—'}/3` },
            { label: '状态', cell: (r) => <Tag tone={r.status === 'volume_veto' ? 'warn' : r.status === 'ok' ? 'up' : 'neutral'}>{STATUS_TEXT[r.status ?? ''] ?? r.status ?? '—'}</Tag> },
            { label: '当日', num: true, cell: (r) => <span className={cls(r.ret_same_close)}>{fmt(r.ret_same_close)}</span> },
            { label: 'T+1', num: true, cell: (r) => <span className={cls(r.ret_t1_close)}>{fmt(r.ret_t1_close)}</span> },
            { label: '影子标记', cell: (r) => r.would_cut
              ? <Tag tone="down">会砍</Tag>
              : r.veto ? <Tag tone="warn">量能证伪</Tag>
                : r.isolated ? <Tag tone="neutral">孤立高开</Tag> : '—' },
          ]}
        />
      </Card>

      <Card title="口径与边界">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-12 text-sub">
          <span>当日收盘口径</span><span>{data?.caliber.same_close ?? '—'}</span>
          <span>T+1 结算口径</span><span>{data?.caliber.t1_close ?? '—'}</span>
          <span>排除项</span><span>{data?.caliber.excluded ?? '—'}</span>
          <span>影子定义</span><span>{data?.caliber.shadow ?? '—'}</span>
          <span>覆盖不足剔除日</span><span>{data?.window.dropped.length ? data.window.dropped.map((x) => `${x.date}(${x.reason})`).join('、') : '无'}</span>
        </div>
        <p className="text-11 text-warn mt-3">{data?.caliber.warning ?? ''}</p>
      </Card>
    </div>
  )
}

/** 路由入口（保持 URL 兼容）：SectorGapView 的薄包装 */
export function Component() {
  return <SectorGapView />
}
