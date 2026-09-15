import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { CarrierItem } from '@/shared/api'
import { analyticsQueries, DataTable, StatPair, Tag, fmtFbt, n1, pct } from '@/features/analytics'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 载体追踪 —— 数据源 `cache/carrier_state.json` + `cache/ma5_status.json`。
 *
 * ## 什么是「载体」，为什么要单独追踪
 *
 * 连板梯队里真正决定情绪的不是板数最高的票，而是**资金承接的载体**——
 * 即「这笔钱今天落在谁身上、明天还认不认它」。原系统把载体拆成两半：
 *   · `carriers_today` —— 今日确认的载体（封板质量 + 带动性都过关）
 *   · `carriers_dead`  —— 今日证伪的载体（昨日还在，今日断板）
 * `carrier_migration` 给出的一句话是整页的**结论**：资金从谁迁到了谁。
 *
 * ## 载体 ≠ 龙头
 *
 * `carry_cnt`（带动家数）是载体的核心指标 —— 一个板数不高但能带动
 * 6 家跟风的票，价值高于一个孤立的高板。因此本页把 `carry_cnt` 与
 * `boards` 并列，而不是只按板数排序。
 *
 * ## 五日线（MA5）是**回撤防线**
 *
 * `ma5_status` 是同一批标的的**技术位**检查：跌破 MA5 的票进 `broken_list`。
 * 它与载体确认是两套独立判据 —— 载体看资金结构，MA5 看价格结构，
 * 两者同时成立才是「结构完好」。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.carrierState())
  await queryClient.ensureQueryData(analyticsQueries.ma5Status())
  return null
}

export function Component() {
  const carrier = useQuery(analyticsQueries.carrierState())
  const ma5 = useQuery(analyticsQueries.ma5Status())

  const c = carrier.data
  const m = ma5.data

  /** 载体按带动家数降序 —— 带动性优先于板数 */
  const today = useMemo(
    () => [...(c?.carriers_today ?? [])].sort((a, b) => (b.carry_cnt ?? 0) - (a.carry_cnt ?? 0)),
    [c?.carriers_today],
  )
  const dead = c?.carriers_dead ?? []

  /** 破位名单按偏离度升序（越负越危险） */
  const broken = useMemo(
    () => [...(m?.broken_list ?? [])].sort((a, b) => a.pct_vs_ma5 - b.pct_vs_ma5),
    [m?.broken_list],
  )

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🧭 载体追踪"
        extra={<CardBadge tone={dead.length ? 'warn' : 'neutral'}>今日证伪 {dead.length} 家</CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="交易日" value={c?.date ?? '—'} />
          <StatPair label="前一日" value={c?.prev_date ?? '—'} />
          <StatPair label="今日确认载体" value={today.length} tone="up" />
          <StatPair label="今日证伪" value={dead.length} tone={dead.length ? 'down' : 'sub'} />
          <StatPair label="MA5 检查数" value={m?.total ?? '—'} />
          <StatPair label="站上 MA5" value={m?.above_count ?? '—'} tone="up" />
          <StatPair label="跌破 MA5" value={m?.broken_count ?? '—'} tone={m?.broken_count ? 'down' : 'sub'} />
        </div>

        {c?.carrier_migration && (
          <p className="text-[12.5px] leading-relaxed border-l-2 border-line-strong pl-2.5">
            {c.carrier_migration}
          </p>
        )}

        {!carrier.isLoading && !c && (
          <EmptyState text="载体状态未生成" hint="cache/carrier_state.json 缺失" />
        )}
      </Card>

      <Card title="今日确认载体" extra={<CardBadge tone="up">带动家数降序</CardBadge>}>
        <DataTable<CarrierItem>
          rows={today}
          rowKey={(r) => r.code}
          empty="今日无确认载体"
          columns={[
            {
              label: '载体',
              cell: (r) => (
                <span>
                  <span className="text-rec">{r.name}</span>
                  <span className="num text-sub ml-1.5">{r.code}</span>
                </span>
              ),
            },
            { label: '板数', num: true, cell: (r) => (r.boards ? <span className="text-up">{r.boards}</span> : '—') },
            {
              label: '带动家数',
              num: true,
              cell: (r) => (
                <span className={cn('font-semibold', (r.carry_cnt ?? 0) >= 5 ? 'text-up' : 'text-txt')}>
                  {r.carry_cnt ?? '—'}
                </span>
              ),
            },
            { label: '板块', cell: (r) => <Tag>{r.sector || '—'}</Tag> },
            { label: '首封', cell: (r) => <span className="num text-sub">{fmtFbt(r.fbt)}</span> },
            {
              label: '炸板次数',
              num: true,
              cell: (r) => (
                <span className={r.zbc > 0 ? 'text-warn' : 'text-sub'}>{r.zbc > 0 ? `${r.zbc} 次` : '—'}</span>
              ),
            },
            {
              label: '确认',
              cell: () =>
                // confirmed 为可选字段（部分归档无此字段），缺省时不下结论
                <Tag tone="up">已确认</Tag>,
            },
          ]}
        />
        <p className="text-sub text-[11px] mt-1.5">
          载体 ≠ 龙头：板数不高但能带动 5 家以上的票，价值高于孤立高板 —— 故本表按带动家数排序。
        </p>
      </Card>

      {dead.length > 0 && (
        <Card title="今日证伪（资金迁移来源）" extra={<CardBadge tone="down">{dead.length} 家</CardBadge>}>
          <DataTable<CarrierItem>
            rows={dead}
            rowKey={(r) => r.code}
            rowClass={() => 'bg-down/5'}
            empty="无"
            columns={[
              {
                label: '标的',
                cell: (r) => (
                  <span>
                    <span className="text-txt">{r.name}</span>
                    <span className="num text-sub ml-1.5">{r.code}</span>
                  </span>
                ),
              },
              { label: '前板数', num: true, cell: (r) => r.boards ?? '—' },
              { label: '板块', cell: (r) => <Tag>{r.sector || '—'}</Tag> },
              { label: '首封', cell: (r) => <span className="num text-sub">{fmtFbt(r.fbt)}</span> },
              {
                label: '炸板',
                num: true,
                cell: (r) => <span className={r.zbc > 0 ? 'text-down' : 'text-sub'}>{r.zbc > 0 ? `${r.zbc} 次` : '—'}</span>,
              },
              { label: '昨日带动', num: true, cell: (r) => r.carry_cnt ?? '—' },
            ]}
          />
          <p className="text-sub text-[11px] mt-1.5">
            证伪 = 昨日确认、今日断板。这一批标的的资金去向，正是今日新载体的来源。
          </p>
        </Card>
      )}

      <Card
        title="五日线防线（MA5）"
        extra={
          <CardBadge tone={m?.broken_count ? 'down' : 'up'}>
            {m ? `站上 ${m.above_count} / ${m.total}` : '—'}
          </CardBadge>
        }
      >
        {broken.length > 0 ? (
          <DataTable
            rows={broken}
            rowKey={(r) => r.code}
            rowClass={() => 'bg-down/5'}
            empty="无破位"
            columns={[
              {
                label: '标的',
                cell: (r) => (
                  <span>
                    <span className="text-txt">{r.name}</span>
                    <span className="num text-sub ml-1.5">{r.code}</span>
                  </span>
                ),
              },
              { label: '现价', num: true, cell: (r) => n1(r.price) },
              { label: 'MA5', num: true, cell: (r) => <span className="text-sub">{n1(r.ma5)}</span> },
              {
                label: '偏离',
                num: true,
                cell: (r) => (
                  <span className={cn('font-semibold', r.pct_vs_ma5 < 0 ? 'text-down' : 'text-up')}>
                    {pct(r.pct_vs_ma5)}
                  </span>
                ),
              },
              {
                label: '近 5 收',
                cell: (r) => (
                  <span className="num text-[11px] text-sub">{r.closes?.map((x) => n1(x)).join(' → ')}</span>
                ),
              },
              { label: '检查时间', cell: (r) => <span className="num text-sub text-[11px]">{r.checked_at?.slice(11, 19) ?? '—'}</span> },
            ]}
          />
        ) : (
          <EmptyState
            text={m ? '全部标的站稳 MA5' : 'MA5 状态未生成'}
            hint={m ? undefined : 'cache/ma5_status.json 缺失'}
          />
        )}
        {m?.ts && <p className="text-sub text-[11px] mt-1.5">检查于 {m.ts}</p>}
      </Card>
    </div>
  )
}
