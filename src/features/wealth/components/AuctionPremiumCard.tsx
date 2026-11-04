import type { AuctionPremiumBoard } from '@/shared/api'
import { DataTable, Tag } from '@/features/analytics'
import { Card, CardBadge, EmptyState, StockLink } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 昨日连板 · 今晨竞价溢价榜（2026-11-04 用户）。
 *
 * ## 用户原话
 *
 * > 「今日的竞价能看到昨天连板的那些票开出来是什么样的情况，也可以结合热度看一下，
 * >   这些热度高的票开出来是什么样的情况。**大于 0 至少是有溢价的，那就非常不错；
 * >   如果没有溢价，那就要谨慎。**」
 *
 * ## 读法（按用户口径，不另立标准）
 *
 * | 竞价 | 含义 | 标签 |
 * |---|---|---|
 * | `> 0` | 有人愿意溢价接昨天的获利盘 | 有溢价 |
 * | `= 0` | 平开，承接意愿不明 | 平开 |
 * | `< 0` | 折价走，昨天买的人先跑 | **谨慎** |
 *
 * ⛔ 热度列是「该题材昨日涨停家数」——线越宽说明这条线当时越强，
 *    用来回答「热度高的那几条线，今早还认不认」。
 * ⛔ 首板不入榜：首板次日没有获利盘兑现压力（用户：「第一板是看不出什么东西的」）。
 * ⛔ 只做读数，不给买卖建议 —— 买不买仍由 09:25 池内裁决决定。
 */

/** 竞价涨幅语义色：红＝有溢价（中国习惯），绿＝折价（谨慎） */
function gapTone(pct: number): string {
  return pct > 0 ? 'text-up' : pct < 0 ? 'text-down' : 'text-sub'
}

function verdictMeta(v: string): { label: string; tone: 'up' | 'down' | 'neutral' } {
  if (v === 'premium') return { label: '有溢价', tone: 'up' }
  if (v === 'discount') return { label: '谨慎', tone: 'down' }
  return { label: '平开', tone: 'neutral' }
}

export function AuctionPremiumCard({ board }: { board?: AuctionPremiumBoard }) {
  if (!board || board.count === 0) {
    return (
      <Card title="昨日连板 · 今晨竞价" extra={<CardBadge>未落盘</CardBadge>}>
        <EmptyState
          text="今日竞价溢价榜未生成"
          hint="09:25 竞价裁决（verify）跑完即产出 · 昨日无 2 板以上或报价缺失时为空"
        />
      </Card>
    )
  }

  const ratio = board.premium_ratio != null ? board.premium_ratio * 100 : null
  const tone = ratio == null ? 'neutral' : ratio >= 60 ? 'up' : ratio >= 40 ? 'rec' : 'down'

  return (
    <Card
      title="昨日连板 · 今晨竞价"
      extra={
        <CardBadge tone={tone}>
          溢价 {board.premium_count}/{board.count}
          {ratio != null ? ` · ${ratio.toFixed(0)}%` : ''}
        </CardBadge>
      }
    >
      <div className="flex flex-col gap-2.5">
        {/* 汇总行：一眼看「这条线今早还认不认」 */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-sm bg-hover px-2 py-1 text-12">
          <span className="text-sub">
            中位溢价 <span className={cn('num font-semibold', gapTone(board.median_gap ?? 0))}>
              {board.median_gap != null ? `${board.median_gap.toFixed(2)}%` : '—'}
            </span>
          </span>
          <span className="text-sub">
            均值 <span className={cn('num font-semibold', gapTone(board.avg_gap ?? 0))}>
              {board.avg_gap != null ? `${board.avg_gap.toFixed(2)}%` : '—'}
            </span>
          </span>
          <span className="text-sub">
            有溢价 <span className="num font-semibold text-up">{board.premium_count}</span> · 平{' '}
            <span className="num text-sub">{board.flat_count}</span> · 折价{' '}
            <span className={cn('num font-semibold', board.discount_count ? 'text-down' : 'text-sub')}>
              {board.discount_count}
            </span>
          </span>
          <span className="ml-auto text-11 text-sub">
            {board.prev_date} 连板 → {board.trade_date} 竞价
          </span>
        </div>

        {/* 分档：高位与 2 板的溢价往往不同 */}
        {Object.keys(board.by_boards).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(board.by_boards)
              .sort((a, b) => Number(b[0]) - Number(a[0]))
              .map(([b, v]) => (
                <span
                  key={b}
                  className="flex items-baseline gap-1.5 rounded-sm border border-line px-2 py-0.5 text-11"
                >
                  <span className="font-semibold text-txt">{b} 板</span>
                  <span className="text-sub">
                    {v.premium_count}/{v.count} 溢价
                  </span>
                  {v.median_gap != null && (
                    <span className={cn('num', gapTone(v.median_gap))}>{v.median_gap.toFixed(2)}%</span>
                  )}
                </span>
              ))}
          </div>
        )}

        <DataTable
          rows={board.rows}
          rowKey={(r) => r.code}
          dense
          heightClass="max-h-[380px]"
          empty="无连板票"
          columns={[
            {
              label: '标的',
              cell: (r) => (
                <span className="flex items-baseline gap-1.5">
                  <StockLink code={r.code} className="text-txt">
                    {r.name}
                  </StockLink>
                  <span className="num rounded-sm border border-up px-1 text-11 font-semibold text-up">
                    {r.boards}板
                  </span>
                </span>
              ),
            },
            {
              label: '竞价',
              num: true,
              cell: (r) => (
                <span className={cn('num font-semibold', gapTone(r.gap_pct))}>
                  {r.gap_pct > 0 ? '+' : ''}
                  {r.gap_pct.toFixed(2)}%
                </span>
              ),
            },
            {
              label: '判定',
              cell: (r) => {
                const m = verdictMeta(r.verdict)
                return <Tag tone={m.tone}>{m.label}</Tag>
              },
            },
            {
              label: '热度',
              num: true,
              cell: (r) => (
                <span className={cn('num', r.theme_hot >= 5 ? 'text-up' : 'text-sub')} title="同题材昨日涨停家数">
                  {r.theme_hot}
                </span>
              ),
            },
            { label: '题材', cell: (r) => <span className="text-sub">{r.theme || '—'}</span> },
            {
              label: '竞额',
              num: true,
              cell: (r) => (
                <span className="num text-sub">{r.amount_yi != null ? `${r.amount_yi.toFixed(2)}亿` : '—'}</span>
              ),
            },
          ]}
        />

        {/* 报价缺失：⛔ 不是平开，是没数据 —— 必须单独说，不能混进统计 */}
        {board.no_quote.length > 0 && (
          <div className="text-11 text-warn">
            无报价 {board.no_quote.length} 只：{board.no_quote.join('、')}（未计入溢价统计）
          </div>
        )}
      </div>
    </Card>
  )
}
