import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { ExecutionAudit } from '@/shared/api'
import { analyticsQueries, DataTable, StatPair, Tag } from '@/features/analytics'
import { Card, CardBadge, EmptyState, StockLink } from '@/shared/ui'

/** 真实执行审计：候选预测、题材/连板研究与账户收益不在此页混算。 */
export async function loader() {
  // 审计产物按日生成；生成窗口内不可用只能显示页内空态，不能阻断整个终端。
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.decisionExecutionAudit()),
  ])
  return null
}

export function Component() {
  const audit = useQuery(analyticsQueries.decisionExecutionAudit())
  const data: ExecutionAudit | undefined = audit.data
  const batches = useMemo(() => [...(data?.batches ?? [])].reverse(), [data])
  const entered = useMemo(
    () => batches.flatMap((batch) => batch.stocks.filter((stock) => stock.execution.entered).map((stock) => ({
      recommendation_date: batch.recommendation_date,
      trade_date: batch.trade_date ?? '待证实',
      code: stock.code,
      name: stock.name,
      bucket: stock.bucket,
      caliber: stock.execution.caliber ?? '—',
      gross_return_pct: stock.execution.gross_return_pct ?? null,
      evidence: batch.integrity.complete ? '完整' : batch.integrity.issues.join('；'),
    }))),
    [batches],
  )

  if (!audit.isLoading && !data) return <EmptyState text="执行审计尚未生成" hint="运行 wealth_code/scripts/execution_audit.py 后在此查看" />

  return (
    <div className="flex flex-col gap-3">
      <Card title="🔎 真实执行审计" extra={<CardBadge tone="neutral">只读证据链</CardBadge>}>
        <p className="text-sub text-[12px] leading-relaxed mb-3">
          主口径只统计“盘后冻结候选 → 9:25 竞价 → 实际入场 → 当日收盘”。候选命中、连板晋级与题材回流留在各自研究页，不会混入账户收益。
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <StatPair label="候选批次" value={data?.summary.batches ?? '—'} />
          <StatPair label="实际入场" value={data?.summary.entered ?? '—'} tone="up" />
          <StatPair label="有收益覆盖" value={data?.summary.covered_returns ?? '—'} tone="up" />
          <StatPair label="不完整批次" value={data?.summary.incomplete_batches ?? '—'} tone="warn" />
          <StatPair label="AI 否决入场" value={data?.summary.ai_rejected_entries ?? '—'} tone="warn" />
          <StatPair label="AI 预案缺失候选" value={data?.summary.ai_plan_missing_candidates ?? '—'} tone="warn" />
          <StatPair label="冰点 AI 冲突" value={data?.summary.ice_ai_entries ?? '—'} tone="warn" />
        </div>
        <p className="text-sub text-[11px] mt-3">
          {data?.main_metric.label ?? '—'}；不含手续费和滑点。交易日历来自已冻结的市场证据与法定休市配置，共 {data?.calendar.count ?? 0} 日。
        </p>
      </Card>

      <Card title="已执行收益" extra={<CardBadge tone="up">账户账本唯一口径</CardBadge>}>
        <DataTable
          rows={entered}
          rowKey={(row) => `${row.trade_date}-${row.code}`}
          dense
          empty="尚无已入场且有收益的记录"
          columns={[
            { label: '推荐日', cell: (row) => row.recommendation_date },
            { label: '执行日', cell: (row) => row.trade_date },
            { label: '标的', cell: (row) => <StockLink code={row.code}>{row.name || row.code}</StockLink> },
            { label: '候选池', cell: (row) => row.bucket },
            { label: '裁决口径', cell: (row) => <Tag tone={row.caliber === 'ai' ? 'up' : 'warn'}>{row.caliber}</Tag> },
            { label: '竞价至收盘', num: true, cell: (row) => row.gross_return_pct == null ? '—' : `${row.gross_return_pct >= 0 ? '+' : ''}${row.gross_return_pct.toFixed(2)}%` },
            { label: '证据完整性', cell: (row) => row.evidence },
          ]}
        />
      </Card>

      <Card title="批次缺口与风控">
        <div className="flex flex-col gap-2">
          {batches.filter((batch) => !batch.integrity.complete).map((batch) => (
            <div key={batch.recommendation_date} className="border border-warn/50 rounded-sm px-3 py-2 text-[12px]">
              <span className="font-medium">{batch.recommendation_date} → {batch.trade_date ?? '待证实'}</span>
              <span className="text-sub"> · {batch.integrity.issues.join('；')}</span>
            </div>
          ))}
          {batches.length > 0 && batches.every((batch) => batch.integrity.complete) && <p className="text-sub text-[12px]">全部批次的冻结证据完整。</p>}
        </div>
      </Card>
    </div>
  )
}
