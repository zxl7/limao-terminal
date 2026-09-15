import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { RiskWatchFile } from '@/shared/api'
import { analyticsQueries, DataTable, StatPair, Tag, n1 } from '@/features/analytics'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 风险监控 —— 数据源 `cache/risk_watch/risk_watch_*.json`。
 *
 * ## 这一页是「向上脉冲捕捉器」的**反向补丁**
 *
 * 原系统整体是向上捕捉器：只覆盖涨停 / 炸板 / 跌停这些极端端，
 * 对「高位票的隐形风险」没有输出。`risk_watch` 正是补这一块的 ——
 * 它按涨停池板数 Top 取高标，逐个查质押比例与公告，给出**风险标签**。
 *
 * ## 三个字段读法
 *
 *   · `pledge_pct`   —— 股权质押比例。高质押 = 大股东资金紧张，
 *     在连续涨停后容易出现被动减持（这是高标最常见的隐性杀跌来源）。
 *   · `notice_count` —— 公告数量。「关注函 / 问询函 / 减持计划」这类公告
 *     本身不改变基本面，但会打断情绪的一致性。
 *   · `checked`      —— 是否已核查。**未核查 ≠ 无风险**，这两者必须区分，
 *     因此本页把未核查的单独标出，而不是当作「干净」。
 *
 * ## ⚠️ 本页只呈现事实，不做买卖建议
 *
 * 风险标签是原系统查到的客观信息。是否因此回避，取决于个人的持仓周期与
 * 风险承受度 —— 本页不替用户下结论。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.riskWatch())
  return null
}

export function Component() {
  const risk = useQuery(analyticsQueries.riskWatch())
  const [onlyRisky, setOnlyRisky] = useState(true)

  const files = useMemo<RiskWatchFile[]>(
    () =>
      (risk.data ?? [])
        .map((f) => f.data)
        .filter((x): x is RiskWatchFile => !!x)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [risk.data],
  )
  const latest = files[0]

  const items = useMemo(() => {
    const list = latest?.items ?? []
    return onlyRisky ? list.filter((i) => i.risk_labels?.length || i.notice_count > 0) : list
  }, [latest, onlyRisky])

  const unchecked = (latest?.items ?? []).filter((i) => !i.checked).length
  const risky = (latest?.items ?? []).filter((i) => i.risk_labels?.length).length
  const highPledge = (latest?.items ?? []).filter((i) => (i.pledge_pct ?? 0) >= 30).length

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="⚠️ 高标风险面"
        extra={<CardBadge tone={risky ? 'warn' : 'neutral'}>带风险标签 {risky} 家</CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="数据日" value={latest?.date ?? '—'} />
          <StatPair label="覆盖标的" value={latest?.items?.length ?? '—'} />
          <StatPair label="带风险标签" value={risky} tone={risky ? 'down' : 'sub'} />
          <StatPair label="质押 ≥30%" value={highPledge} tone={highPledge ? 'warn' : 'sub'} />
          <StatPair label="未核查" value={unchecked} tone={unchecked ? 'warn' : 'sub'} />
          <StatPair label="归档期数" value={files.length} />
        </div>
        {latest?.scope && <p className="text-sub text-[11.5px] leading-relaxed">口径：{latest.scope}</p>}
        <p className="text-warn text-[11.5px] leading-relaxed border-l-2 border-warn pl-2.5 mt-1.5">
          **未核查 ≠ 无风险** —— 原系统对部分标的未完成质押/公告核查，本页将其单列而非视作干净。
        </p>
        {!risk.isLoading && !latest && (
          <EmptyState text="风险面未生成" hint="cache/risk_watch/ 为空" />
        )}
      </Card>

      <Card
        title="明细"
        extra={
          <button
            type="button"
            onClick={() => setOnlyRisky((v) => !v)}
            className={cn(
              'px-2.5 py-1 text-[12px] rounded-sm border cursor-pointer bg-transparent transition-colors',
              onlyRisky ? 'border-line-strong text-txt font-semibold' : 'border-line text-sub hover:text-txt',
            )}
          >
            {onlyRisky ? '仅看有风险项' : '看全部标的'}
          </button>
        }
      >
        <DataTable
          rows={items}
          rowKey={(r) => r.code}
          rowClass={(r) => (r.risk_labels?.length ? 'bg-warn/5' : undefined)}
          empty="无符合条件标的"
          columns={[
            {
              label: '标的',
              cell: (r) => (
                <span>
                  <span className="text-rec">{r.name}</span>
                  <span className="num text-sub ml-1.5">{r.code}</span>
                </span>
              ),
            },
            { label: '板数', num: true, cell: (r) => (r.boards ? <span className="text-up">{r.boards}</span> : '—') },
            { label: '板块', cell: (r) => <Tag>{r.sector || '—'}</Tag> },
            {
              label: '风险标签',
              className: 'whitespace-normal min-w-[180px]',
              cell: (r) =>
                r.risk_labels?.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.risk_labels.map((l) => (
                      <Tag key={l} tone="warn">
                        {l}
                      </Tag>
                    ))}
                  </span>
                ) : (
                  <span className="text-sub">—</span>
                ),
            },
            {
              label: '质押比例',
              num: true,
              cell: (r) => (
                <span
                  className={cn(
                    (r.pledge_pct ?? 0) >= 30 ? 'text-down font-semibold' : (r.pledge_pct ?? 0) > 0 ? 'text-warn' : 'text-sub',
                  )}
                >
                  {r.pledge_pct != null ? `${n1(r.pledge_pct)}%` : '—'}
                </span>
              ),
            },
            {
              label: '公告数',
              num: true,
              cell: (r) => <span className={r.notice_count > 0 ? 'text-warn' : 'text-sub'}>{r.notice_count || '—'}</span>,
            },
            {
              label: '核查',
              cell: (r) =>
                r.checked ? <Tag tone="up">已核查</Tag> : <Tag tone="warn">未核查</Tag>,
            },
            {
              label: '公告摘要',
              className: 'whitespace-normal min-w-[260px]',
              cell: (r) =>
                r.notices?.length ? (
                  <ul className="text-[11.5px] leading-relaxed text-sub">
                    {r.notices.slice(0, 3).map((n, i) => (
                      // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                      <li key={i}>{summarizeNotice(n)}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-sub">—</span>
                ),
            },
          ]}
        />
      </Card>

      {files.length > 1 && (
        <Card title="历史期次" extra={<CardBadge>{files.length} 期</CardBadge>}>
          <DataTable
            rows={files}
            rowKey={(f) => f.date}
            dense
            empty="无"
            columns={[
              { label: '日期', cell: (f) => <span className="num">{f.date}</span> },
              { label: '覆盖', num: true, cell: (f) => f.items?.length ?? 0 },
              { label: '带风险标签', num: true, cell: (f) => f.items?.filter((i) => i.risk_labels?.length).length ?? 0 },
              { label: '未核查', num: true, cell: (f) => f.items?.filter((i) => !i.checked).length ?? 0 },
              { label: '生成于', cell: (f) => <span className="num text-sub text-[11px]">{f.generated_ts?.slice(0, 19).replace('T', ' ') ?? '—'}</span> },
            ]}
          />
        </Card>
      )}
    </div>
  )
}

/** 公告条目为宽松对象，优先取常见标题字段 */
function summarizeNotice(n: Record<string, unknown>): string {
  const keys = ['title', 'name', 'notice_title', 'type', 'desc']
  for (const k of keys) {
    const v = n[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return '（公告明细字段未识别）'
}
