import type { DossierStock } from '@/shared/api'
import { cn } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
import { DataTable } from '@/features/analytics'
import { boardsText, num, pctText, yiText } from '../lib/format'

/**
 * 明日买点矩阵 —— 把「明天怎么下单」压成一张可横向对比的表。
 *
 * ⛔ 三列口径不可混：
 *   · 预期区间   —— 竞价涨幅落在哪一档算正常
 *   · 量能线     —— 竞价成交额下限（低开但没钱＝不接）
 *   · 买不到概率 —— 历史同组高开 >5% 的占比，这才是「看得见吃不着」的量化
 *   ⛔ `buy_win` 是**这一档真买到时**的胜率，不是全样本晋级率。
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
      empty="本期无候选"
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
          label: '预期竞价区间',
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
          label: '量能线',
          num: true,
          cell: ({ s }) => <span className="num text-txt">{yiText(s.expectation?.auction_amount_min_yi)}</span>,
        },
        {
          label: '超预期线',
          num: true,
          cell: ({ s }) => (
            <span className="num text-sub">
              {s.expectation?.super_gap_min != null ? `≥${num(s.expectation.super_gap_min, 1)}%` : '—'}
              {s.expectation?.auction_amount_super_yi != null && s.expectation.auction_amount_super_yi > 0
                ? ` · ${yiText(s.expectation.auction_amount_super_yi)}`
                : ''}
            </span>
          ),
        },
        {
          label: '明早中位',
          num: true,
          cell: ({ s }) => (
            <span className="num text-txt">{num(s.forecast?.gap_median, 1)}%</span>
          ),
        },
        {
          label: '买不到',
          num: true,
          cell: ({ s }) => {
            const v = s.forecast?.p_over5
            return (
              <span
                className={cn('num', v == null ? 'text-sub' : v >= 50 ? 'text-down' : v >= 30 ? 'text-warn' : 'text-txt')}
              >
                {v == null ? '—' : `${num(v, 0)}%`}
              </span>
            )
          },
        },
        {
          label: '该档真买到',
          num: true,
          cell: ({ s }) => {
            const w = s.forecast?.buy_win
            return (
              <span className="flex items-baseline gap-1">
                <span
                  className={cn(
                    'num font-semibold',
                    w == null ? 'text-sub' : w >= 45 ? 'text-up' : w >= 35 ? 'text-warn' : 'text-down',
                  )}
                >
                  {pctText(w, 1)}
                </span>
                {s.forecast?.buy_n != null && (
                  <span className="num text-11 text-sub">n={s.forecast.buy_n}</span>
                )}
              </span>
            )
          },
        },
        {
          label: '建议',
          cell: ({ s }) => {
            const v = s.forecast?.verdict
            if (!v) return <span className="text-sub">—</span>
            return (
              <span
                className={cn(
                  'rounded-sm border px-1 text-11',
                  v === '可等'
                    ? 'border-up text-up'
                    : v === '放弃'
                      ? 'border-down text-down'
                      : 'border-line text-sub',
                )}
              >
                {v}
              </span>
            )
          },
        },
      ]}
    />
  )
}
