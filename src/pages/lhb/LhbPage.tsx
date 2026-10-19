import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { HithinkLhbFile, LhbTencentFile } from '@/shared/api'
import { analyticsQueries, DataTable, SegTabs, StatPair, Tag, n2 } from '@/features/analytics'
import { Card, CardBadge, EmptyState, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, tradableStocks } from '@/shared/lib'

/**
 * 龙虎榜 —— 数据源 `cache/lhb_*.json`（腾讯源）与 `cache/hithink_lhb_*.json`（同花顺源）。
 *
 * ## 为什么需要两个源
 *
 * 它们回答的不是同一个问题：
 *   · **腾讯源** → `institution`（哪些票被机构买）+ `hotmoney`（哪些游资席位在买）
 *     这是「**资金性质**」视角：同一只票被机构买和被游资买，后续走势含义不同。
 *   · **同花顺源** → `org_top5` / `hotmoney_top5`，带 `concepts`（概念标签），
 *     是「**谁在买什么题材**」的横截面视角。
 *
 * 两源交叉验证的价值：当某票在腾讯源里「机构买入」为正、而同花顺源里
 * `org_net_yi` 为负，说明席位口径存在分歧（机构内部有买有卖），此时不应
 * 按「机构净买」简化叙述。
 *
 * ## ⚠️ 披露时点
 *
 * 龙虎榜由交易所盘后披露（约 18:00+），因此**盘中本页永远显示上一交易日**，
 * 这是正常的，不是数据滞后。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.lhbTencent())
  await queryClient.ensureQueryData(analyticsQueries.lhbHithink())
  return null
}

export function Component() {
  const tx = useQuery(analyticsQueries.lhbTencent())
  const ths = useQuery(analyticsQueries.lhbHithink())
  const [tab, setTab] = useState<'inst' | 'hot' | 'ths'>('inst')

  const txFiles = useMemo<LhbTencentFile[]>(
    () =>
      (tx.data ?? [])
        .map((f) => f.data)
        .filter((x): x is LhbTencentFile => !!x)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [tx.data],
  )
  const txLatest = txFiles[0]

  const thsFiles = useMemo<HithinkLhbFile[]>(
    () =>
      (ths.data ?? [])
        .map((f) => f.data)
        .filter((x): x is HithinkLhbFile => !!x)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [ths.data],
  )
  const thsLatest = thsFiles[0]

  /** 机构净买合计 —— 判断当日机构整体态度（净买 = 加仓意愿） */
  const instNetSum = useMemo(
    () => (txLatest?.institution ?? []).reduce((s, i) => s + (i.net_yi ?? 0), 0),
    [txLatest],
  )

  return (
    <div className="flex flex-col gap-3">
      {/* 概览窄栏（口径与总览） + 明细宽栏（机构/游资榜单，多列需横向空间）。
          ⛔ 旧版概览通栏独占一整行、明细被压到下方。 */}
      <ZoneRow>
        <Zone label="总览" dot="bg-rec" className="xl:w-[34%]">
          <Card
            title="🏦 龙虎榜"
        extra={
          txLatest ? (
            <CardBadge tone={instNetSum >= 0 ? 'up' : 'down'}>
              机构合计净买 {instNetSum >= 0 ? '+' : ''}{n2(instNetSum)} 亿
            </CardBadge>
          ) : (
            // ⛔ 无数据时不能显示「净买 0.00 亿」—— 那是把「不知道」说成「零」
            <CardBadge tone="neutral">无当日榜单</CardBadge>
          )
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="腾讯源披露日" value={txLatest?.date ?? '—'} />
          <StatPair label="机构上榜" value={txLatest?.institution.length ?? '—'} />
          <StatPair label="游资席位数" value={txLatest?.hotmoney.length ?? '—'} />
          <StatPair label="同花顺源日" value={thsLatest?.date ?? '—'} />
          <StatPair label="同花顺上榜股" value={thsLatest?.stock_count ?? '—'} />
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          交易所盘后（约 18:00+）披露，故盘中本页恒显示上一交易日 —— 这是披露时点，不是数据滞后。
          机构净买为**正**表示加仓，为**负**表示减仓。
        </p>
      </Card>
        </Zone>

        <Zone label="榜单明细" dot="bg-lead" className="xl:w-[66%]">
          <Card
            title="明细"
        extra={
          <SegTabs
            items={[
              { key: 'inst', label: '机构买入' },
              { key: 'hot', label: '游资席位' },
              { key: 'ths', label: '同花顺横截面' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'inst' && (
          <DataTable
            rows={tradableStocks(txLatest?.institution)}
            // ⚠️ 同一只票可能因多个上榜原因重复出现（实测 688835 出现两次），仅用 code 会 key 冲突
            rowKey={(r, i) => `${r.code}-${i}`}
            empty="该日无机构上榜（或文件未生成）"
            columns={[
              {
                label: '标的',
                cell: (r) => (
                  <span>
                    <StockLink code={r.code} className="text-rec">{r.name}</StockLink>
                  </span>
                ),
              },
              {
                label: '机构买入',
                num: true,
                cell: (r) => (
                  <span className={r.inst_buy_yi > 0 ? 'text-up' : 'text-txt'}>{n2(r.inst_buy_yi)} 亿</span>
                ),
              },
              {
                label: '净额',
                num: true,
                cell: (r) => (
                  <span className={cn('font-semibold', r.net_yi > 0 ? 'text-up' : r.net_yi < 0 ? 'text-down' : 'text-txt')}>
                    {r.net_yi > 0 ? '+' : ''}
                    {n2(r.net_yi)} 亿
                  </span>
                ),
              },
              {
                label: '连榜',
                cell: (r) => <span className="text-sub text-[11.5px]">{r.days_on_board || '—'}</span>,
              },
            ]}
          />
        )}

        {tab === 'hot' && (
          <DataTable
            rows={txLatest?.hotmoney ?? []}
            rowKey={(r, i) => `${r.seat}-${i}`}
            empty="该日无游资席位数据"
            columns={[
              { label: '席位', cell: (r) => <span className="text-[12px]">{r.seat}</span> },
              {
                label: '买入额',
                num: true,
                cell: (r) => (
                  <span className={r.amount_yi > 0 ? 'text-up' : 'text-txt'}>{n2(r.amount_yi)} 亿</span>
                ),
              },
              {
                label: '涉及个股',
                className: 'whitespace-normal min-w-[280px]',
                cell: (r) =>
                  tradableStocks(r.stocks).length ? (
                    <span className="flex flex-wrap gap-1">
                      {/* ⚠️ stocks 是对象数组 {code, name}，不是字符串数组 */}
                      {tradableStocks(r.stocks).map((s) => (
                        <Tag key={s.code} title={s.code}>
                          <StockLink code={s.code}>{s.name || s.code}</StockLink>
                        </Tag>
                      ))}
                    </span>
                  ) : (
                    <span className="text-sub">—</span>
                  ),
              },
            ]}
          />
        )}

        {tab === 'ths' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[12px] text-sub mb-1">机构席位 Top5（带概念标签）</div>
              <DataTable
                rows={thsLatest?.org_top5 ?? []}
                // ⚠️ 同花顺源同一只票可能因多个席位重复出现，仅用 code 会 key 冲突
                rowKey={(r, i) => `${r.code}-${i}`}
                empty="无数据"
                columns={[
                  {
                    label: '标的',
                    cell: (r) => (
                      <span>
                        <StockLink code={r.code} className="text-rec">{r.name}</StockLink>
                      </span>
                    ),
                  },
                  {
                    label: '机构净额',
                    num: true,
                    cell: (r) => (
                      <span className={r.org_net_yi > 0 ? 'text-up' : r.org_net_yi < 0 ? 'text-down' : 'text-txt'}>
                        {r.org_net_yi > 0 ? '+' : ''}
                        {n2(r.org_net_yi)} 亿
                      </span>
                    ),
                  },
                  {
                    label: '总净额',
                    num: true,
                    cell: (r) => (
                      <span className={r.net_yi > 0 ? 'text-up' : r.net_yi < 0 ? 'text-down' : 'text-txt'}>
                        {r.net_yi > 0 ? '+' : ''}
                        {n2(r.net_yi)} 亿
                      </span>
                    ),
                  },
                  {
                    label: '概念',
                    className: 'whitespace-normal min-w-[200px]',
                    cell: (r) =>
                      r.concepts?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {/* ⚠️ concepts 是对象数组 {name}，不是字符串数组 */}
                          {r.concepts.slice(0, 4).map((c) => (
                            <Tag key={c.name}>{c.name}</Tag>
                          ))}
                        </span>
                      ) : (
                        <span className="text-sub">—</span>
                      ),
                  },
                ]}
              />
            </div>

            <div>
              <div className="text-[12px] text-sub mb-1">游资席位 Top5</div>
              <DataTable
                rows={thsLatest?.hotmoney_top5 ?? []}
                rowKey={(r, i) => `${r.seat}-${i}`}
                empty="无数据"
                columns={[
                  { label: '席位', cell: (r) => <span className="text-[12px]">{r.seat}</span> },
                  {
                    label: '买入额',
                    num: true,
                    cell: (r) => <span className="text-up">{n2(r.buy_yi)} 亿</span>,
                  },
                  {
                    label: '涉及个股',
                    className: 'whitespace-normal min-w-[260px]',
                    cell: (r) =>
                      r.stocks?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {/* ⚠️ stocks 是对象数组 {code, name} */}
                          {tradableStocks(r.stocks).map((s) => (
                            <Tag key={s.code} title={s.code}>
                              <StockLink code={s.code}>{s.name || s.code}</StockLink>
                            </Tag>
                          ))}
                        </span>
                      ) : (
                        <span className="text-sub">—</span>
                      ),
                  },
                ]}
              />
            </div>
          </div>
        )}

        {!tx.isLoading && !txLatest && !thsLatest && (
          <EmptyState text="龙虎榜数据未生成" hint="cache/lhb_*.json 缺失" />
        )}
        {txLatest && (
          <p className="text-sub text-[11px] mt-2">
            腾讯源生成于 {txLatest.generated_ts || '—'}
            {thsLatest && ` · 同花顺源生成于 ${thsLatest.generated_ts || '—'}`}
            {txFiles.length > 1 && ` · 已归档 ${txFiles.length} 期（最新 ${txLatest.date}）`}
          </p>
        )}
      </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
