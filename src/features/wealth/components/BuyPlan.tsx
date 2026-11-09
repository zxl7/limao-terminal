import type { DossierStock } from '@/shared/api'
import { cn } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
import { DataTable } from '@/features/analytics'
import { boardsText, num, yiText } from '../lib/format'

/**
 * 明日买点矩阵 —— 把「明天怎么下单」压成一张表。
 *
 * ## 2026-11-06 用户「不要那些看不懂的指标」，从 10 列砍到 6 列
 *
 * 砍掉的四列及其理由（都是**统计推导量**，不是下单要用的事实）：
 *
 * | 砍掉 | 原来长什么样 | 为什么砍 |
 * |---|---|---|
 * | 超预期线 | `≥3.2% · 0.51 亿` | 与「计划区间」是同一件事的两端，看区间就够 |
 * | 明早中位 | `9.8%` | 与「买不到概率」重复表达同一件事 |
 * | 买不到 | `66%`（`p_over5`） | 名字像结论、实际是历史分组占比，且样本常 5~7 个 |
 * | 该档真买到 | `28.6% n=7` | 与上一列互为条件概率，两列并排必被误读成「胜率 28.6%」 |
 *
 * 留下的六列全部是**下单当下要用的**：买谁、几板、什么方向、竞价落在哪个区间、
 * 需要多少钱、明天到底做不做（含一句理由）。
 * ⛔ 区间用二元数组 `expected_range`（`[下沿, 上沿]`），⛔ 不可直接插值。
 */
export function BuyPlan({
  relay,
  watch,
}: {
  relay: DossierStock[]
  watch: DossierStock[]
}) {
  const rows = [
    ...relay.map((s) => ({ s, bucket: '接力' as const, rank: s.relay_rank })),
    ...watch.map((s) => ({ s, bucket: '观察' as const, rank: s.watch_rank })),
  ].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (b.s.boards ?? 0) - (a.s.boards ?? 0))

  return (
    <DataTable
      rows={rows}
      rowKey={(r) => `${r.bucket}-${r.s.code}`}
      empty="本期无候选 —— 接力池留空是允许的结论，不是数据缺失"
      columns={[
        {
          label: '标的',
          cell: ({ s }) => (
            <span className="flex items-baseline gap-1">
              <StockLink code={s.code} className="text-txt">
                {s.name}
              </StockLink>
              <span className="num text-11 text-sub">{s.code}</span>
            </span>
          ),
        },
        {
          label: '池别',
          cell: ({ bucket }) => (
            <span className={bucket === '接力' ? 'text-up' : 'text-sub'}>{bucket}</span>
          ),
        },
        {
          label: '板数',
          num: true,
          cell: ({ s }) => <span className="num font-semibold text-up">{boardsText(s.boards)}</span>,
        },
        {
          label: '方向',
          cell: ({ s }) => <span className="text-12">{s.core_theme || s.theme || '—'}</span>,
        },
        {
          label: '竞价落在',
          num: true,
          cell: ({ s }) => {
            const r = s.expectation?.expected_range
            return (
              <span className="num text-txt">
                {Array.isArray(r) && r.length === 2 ? `${num(r[0], 1)}% ~ ${num(r[1], 1)}%` : '—'}
              </span>
            )
          },
        },
        {
          label: '竞价额要够',
          num: true,
          cell: ({ s }) => <span className="num text-txt">{yiText(s.expectation?.auction_amount_min_yi)}</span>,
        },
        {
          label: '明日结论',
          className: 'whitespace-normal min-w-[260px]',
          cell: ({ s }) => {
            const v = s.forecast?.verdict
            const why = s.forecast?.reasons?.[0]
            if (!v) return <span className="text-sub">—</span>
            return (
              <span className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    'w-fit rounded-sm border px-1 text-11',
                    v === '可等'
                      ? 'border-up text-up'
                      : v === '放弃'
                        ? 'border-down text-down'
                        : 'border-line text-sub',
                  )}
                >
                  {v}
                </span>
                {why && <span className="text-11 leading-snug text-sub">{why}</span>}
              </span>
            )
          },
        },
      ]}
    />
  )
}
