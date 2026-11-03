import { useMemo, useState } from 'react'
import { cn, fmtPct } from '@/shared/lib'
import { Card, CardBadge, StockLink } from '@/shared/ui'
import { DataTable, SegTabs } from './Table'
import {
  buildAuctionThemeAgg,
  sortAuctionRows,
  type AuctionRow,
  type AuctionSortKey,
  type PoolRole,
} from '../lib/auction-money'

/**
 * 竞价资金榜 —— 09:25 竞价这一刻「钱往哪些票去」。
 *
 * 设计参考了同类产品的排序榜（净额 / 占比 / 换手三列可切），但**没有照抄「竞价净额」**：
 * 净额需要逐笔委托方向，我们的落盘只有成交额，算不出来就不造（见 `lib/auction-money.ts`）。
 * 这里保留的是它真正好用的三件事：
 *   ① 按不同维度切换排序；② 一行一个结论（暖黄=高开且有量）；③ 默认只给前 12 只 + 展开。
 *
 * 2026-10-19 追加：把当日 `pool_call` 的裁决贴上来（池内角色 / 题材 / 量能是否达标）。
 * 参考产品的榜只回答「钱多不多」，我们的榜首必须再回答一句「这钱该不该跟」——
 * 否则「竞额第一名」会是一只看不懂的空票（实测榜首是低开的非池内票）。
 */

/** 默认展示条数：超过就折叠（用户看榜先看头部，不需要一屏 60 行） */
const DEFAULT_VISIBLE = 12

/** 题材聚合条最多展示几条（超出进「其余」计数，不堆成两行） */
const THEME_CHIPS = 6

const ROLE_TONE: Readonly<Record<PoolRole, string>> = {
  参与: 'bg-up-soft text-up',
  观察: 'bg-warn-soft text-warn',
  放弃: 'bg-down-soft text-down',
  池外: 'bg-line-faint text-sub',
}

export function AuctionMoneyCard({
  rows,
  date,
  className,
}: {
  rows: AuctionRow[]
  date: string | null
  className?: string
}) {
  const [sortKey, setSortKey] = useState<AuctionSortKey>('amount')
  const [expanded, setExpanded] = useState(false)

  const sorted = useMemo(() => sortAuctionRows(rows, sortKey), [rows, sortKey])
  const themes = useMemo(() => buildAuctionThemeAgg(rows), [rows])
  const shown = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE)
  const rest = sorted.length - shown.length
  const poolCount = rows.filter((r) => r.inPool).length

  return (
    <Card
      title="💰 竞价资金榜"
      extra={
        <span className="flex items-center gap-2">
          <CardBadge>{date ? `${date} · 09:25 结算` : '今日未落盘'}</CardBadge>
          <SegTabs
            items={[
              { key: 'amount', label: '竞额' },
              { key: 'pct', label: '竞价涨幅' },
              { key: 'share', label: '占榜内比' },
              { key: 'pool', label: `池内 ${poolCount}` },
            ]}
            value={sortKey}
            onChange={(k) => setSortKey(k as AuctionSortKey)}
          />
        </span>
      }
      className={className}
    >
      <p className="text-sub text-12 leading-relaxed mb-2">
        按{sortKey === 'pct' ? '竞价涨幅' : sortKey === 'share' ? '占榜内比' : sortKey === 'pool' ? '池内角色' : '竞额'}排序 ·
        <span className="text-warn"> 暖黄 = 高开 ≥5% 且竞额 ≥ 榜内中位数</span>
      </p>

      {/* 题材聚合：钱集中在哪几条线（只算池内票，池外无题材归属） */}
      {themes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2 pb-2 border-b border-line-faint">
          {themes.slice(0, THEME_CHIPS).map((t) => (
            <span
              key={t.theme}
              className="flex items-center gap-1 text-11"
              title={`${t.count} 只 · 竞额 ${t.amountYi.toFixed(2)} 亿 · 池内参与 ${t.participate} 只`}
            >
              <span className={cn('font-medium', t.participate > 0 ? 'text-rec' : 'text-sub')}>
                {t.theme}
              </span>
              <span className="num text-sub">
                {t.count}只 · {t.amountYi.toFixed(1)}亿 · {t.sharePct.toFixed(0)}%
              </span>
            </span>
          ))}
          {themes.length > THEME_CHIPS && (
            <span className="text-11 text-sub">其余 {themes.length - THEME_CHIPS} 条</span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center text-sub text-xs py-4">
          今日竞价报价未落盘（09:25 后生成 auction_quotes-&lt;date&gt;.json）
        </div>
      ) : (
        <>
          <DataTable
            rows={shown}
            rowKey={(r) => r.code}
            dense
            rowClass={(r) => (r.hot ? 'bg-warn-soft/45' : undefined)}
            empty="今日竞价无有效报价"
            columns={[
              {
                label: '#',
                num: true,
                className: 'w-8 text-sub',
                cell: (r) => <span className="num text-11 text-sub">{sorted.indexOf(r) + 1}</span>,
              },
              {
                label: '股票',
                cell: (r) => (
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <StockLink code={r.code} className="text-txt">
                      {r.name}
                    </StockLink>
                    {/* 名称未补齐时 name === code，此时不再重复打印一遍代码 */}
                    {r.name !== r.code && (
                      <span className="num text-11 text-sub">{r.code}</span>
                    )}
                  </span>
                ),
              },
              {
                label: '竞价涨幅',
                num: true,
                cell: (r) => (
                  <span
                    className={cn(
                      'num font-medium',
                      r.pct > 0 ? 'text-up' : r.pct < 0 ? 'text-down' : 'text-sub',
                    )}
                  >
                    {fmtPct(r.pct)}
                  </span>
                ),
              },
              {
                label: '竞额(亿)',
                num: true,
                cell: (r) => <span className="num">{r.amountYi.toFixed(2)}</span>,
              },
              {
                label: '量能线',
                num: true,
                cell: (r) =>
                  r.needYi == null ? (
                    <span className="num text-sub">—</span>
                  ) : (
                    <span
                      className={cn('num', r.amountPass ? 'text-up' : 'text-down')}
                      title={`竞价 ${r.amountYi.toFixed(2)} 亿 / 门槛 ${r.needYi.toFixed(2)} 亿`}
                    >
                      {r.amountPass ? '达标' : '未达'} {r.needYi.toFixed(1)}
                    </span>
                  ),
              },
              {
                label: '占榜内比',
                num: true,
                cell: (r) => (
                  <span className={cn('num', r.hot ? 'font-semibold text-txt' : 'text-sub')}>
                    {r.sharePct.toFixed(1)}%
                  </span>
                ),
              },
              {
                label: '池内',
                cell: (r) => (
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <span className={cn('badge', ROLE_TONE[r.poolRole])}>{r.poolRole}</span>
                    {r.isCore && <span className="text-10 text-lead">核心</span>}
                    {r.lineRank === 1 && <span className="text-10 text-lead">龙一</span>}
                  </span>
                ),
              },
              {
                label: '题材',
                cell: (r) =>
                  r.theme ? (
                    <span className="text-12 text-txt">{r.theme}</span>
                  ) : (
                    <span className="text-sub">—</span>
                  ),
              },
              {
                label: '撮合时刻',
                cell: (r) => <span className="num text-11 text-sub">{r.time.slice(11, 19) || '—'}</span>,
              },
            ]}
          />
          {rest > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-2 px-2.5 py-1 text-12 rounded-sm border border-line text-sub bg-transparent cursor-pointer hover:text-txt hover:border-line-strong"
            >
              展开其余 {rest} 只
            </button>
          )}
          {expanded && sorted.length > DEFAULT_VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-2 ml-2 px-2.5 py-1 text-12 rounded-sm border border-line text-sub bg-transparent cursor-pointer hover:text-txt hover:border-line-strong"
            >
              收起
            </button>
          )}
        </>
      )}
    </Card>
  )
}
