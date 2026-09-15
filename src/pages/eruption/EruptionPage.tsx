import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { EruptionDay, NewsflashHistoryDay } from '@/shared/api'
import { analyticsQueries, DataTable, SegTabs, StatPair, Tag, n1, pct } from '@/features/analytics'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 题材爆发史 —— 数据源 `cache/eruption_history/` + `cache/newsflash_history/`。
 *
 * ## 这一页的价值在于「题材的为什么」
 *
 * 涨停池只告诉你「哪个题材今天涨停多」，但不告诉你**为什么**。
 * `EruptionTheme.title` 存的就是那条催化本身 —— 这是原系统从东财预期接口
 * 抓下来的原始标题，是全系统里唯一把「题材」和「催化原文」绑在一处的地方。
 *
 * ## 与「快讯映射」的分工
 *
 *   · 题材爆发史 → 以**题材**为主键，聚合该题材的催化 + 涨停 + 龙头
 *   · 快讯映射   → 以**快讯**为主键，给出这条消息指向哪些题材与个股
 *
 * 同一个信息两种切片方式，处理不同问题：前者回答「这个题材什么来头」，
 * 后者回答「这条消息能炒什么」。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.eruptionHistory())
  await queryClient.ensureQueryData(analyticsQueries.newsflashHistory())
  return null
}

export function Component() {
  const eruption = useQuery(analyticsQueries.eruptionHistory())
  const news = useQuery(analyticsQueries.newsflashHistory())
  const [tab, setTab] = useState<'themes' | 'news'>('themes')
  const [dayIdx, setDayIdx] = useState(0)
  const [q, setQ] = useState('')

  const days = useMemo<EruptionDay[]>(
    () =>
      (eruption.data ?? [])
        .map((f) => f.data)
        .filter((x): x is EruptionDay => !!x)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [eruption.data],
  )
  const active = days[Math.min(dayIdx, Math.max(0, days.length - 1))]

  const themes = useMemo(() => {
    const list = active?.themes ?? []
    const k = q.trim().toLowerCase()
    if (!k) return list
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(k) ||
        t.title?.toLowerCase().includes(k) ||
        t.stocks?.some((s) => s.name.includes(k)),
    )
  }, [active, q])

  const newsDays = useMemo<NewsflashHistoryDay[]>(
    () =>
      (news.data ?? [])
        .map((f) => f.data)
        .filter((x): x is NewsflashHistoryDay => !!x)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [news.data],
  )
  const activeNews = newsDays[0]

  const newsFiltered = useMemo(() => {
    const list = activeNews?.newsflash ?? []
    const k = q.trim().toLowerCase()
    if (!k) return list
    return list.filter(
      (n) =>
        n.title.toLowerCase().includes(k) ||
        n.plates?.some((p) => p.toLowerCase().includes(k)) ||
        n.stocks?.some((s) => s.toLowerCase().includes(k)),
    )
  }, [activeNews, q])

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="💥 题材爆发史"
        extra={<CardBadge>{days.length} 日归档 · 最新 {active?.date ?? '—'}</CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="最新日题材数" value={active?.themes?.length ?? '—'} />
          <StatPair
            label="涨停最多题材"
            value={active?.themes?.reduce((m, t) => Math.max(m, t.zt ?? 0), 0) ?? '—'}
            tone="up"
          />
          <StatPair label="快讯归档" value={newsDays.length} />
          <StatPair label="最新快讯条数" value={activeNews?.newsflash?.length ?? '—'} />
          <StatPair label="生成时间" value={active?.generated_ts?.slice(11, 19) ?? '—'} />
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          题材 + 催化原文绑定是全系统唯一一处 —— 涨停池告诉你「什么多」，这里告诉你「为什么」。
          催化标题为原系统抓取的原始文案，本页不做改写。
        </p>
      </Card>

      <Card
        title="明细"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜题材 / 催化 / 个股…"
              className={cn(
                'px-2.5 py-1 text-[12.5px] rounded-sm min-w-[180px]',
                'bg-transparent border border-line text-txt placeholder:text-sub',
                'focus:outline-none focus:border-line-strong',
              )}
            />
            <SegTabs
              items={[
                { key: 'themes', label: `题材爆发 (${themes.length})` },
                { key: 'news', label: `快讯映射 (${newsFiltered.length})` },
              ]}
              value={tab}
              onChange={(k) => setTab(k as typeof tab)}
            />
          </div>
        }
      >
        {tab === 'themes' && (
          <>
            {days.length > 1 && (
              <div className="mb-2">
                <select
                  value={active?.date ?? ''}
                  onChange={(e) => setDayIdx(days.findIndex((x) => x.date === e.target.value))}
                  className="text-[12px] px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
                >
                  {days.map((x) => (
                    <option key={x.date} value={x.date}>
                      {x.date}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {themes.length === 0 && (
              <EmptyState
                text={active ? '该日无题材爆发记录' : '题材爆发史未生成'}
                hint={active ? '换个关键词' : 'cache/eruption_history/ 为空'}
              />
            )}

            <div className="flex flex-col gap-2">
              {themes.map((t) => (
                <div key={t.name} className="border border-line rounded-sm px-2.5 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[13.5px] font-semibold text-txt">{t.name}</span>
                    <StatPair label="涨停" value={t.zt} tone="up" />
                    <StatPair
                      label="当日"
                      value={t.pct != null ? pct(t.pct) : '—'}
                      tone={(t.pct ?? 0) > 0 ? 'up' : 'down'}
                    />
                    <StatPair
                      label="区间累计"
                      value={t.cum_pct != null ? pct(t.cum_pct) : '—'}
                      tone={(t.cum_pct ?? 0) > 0 ? 'up' : 'down'}
                    />
                    <span className="num text-sub text-[11px]">{t.themeCode || ''}</span>
                  </div>

                  {t.title && (
                    <div className="mt-1 text-[12.5px] leading-relaxed">
                      <span className="text-warn">催化：</span>
                      {t.title}
                    </div>
                  )}

                  {!!t.stocks?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.stocks.slice(0, 12).map((s) => (
                        <span
                          key={s.code}
                          className={cn('badge border', s.dragon ? 'border-lead text-lead' : 'border-line text-sub')}
                          title={`${s.code} · 市值 ${n1(s.cap_yi)}亿`}
                        >
                          {s.dragon ? '龙 ' : ''}
                          {s.name}
                          <span className={cn('num ml-1', s.pct > 0 ? 'text-up' : 'text-down')}>
                            {n1(s.pct)}%
                          </span>
                        </span>
                      ))}
                      {t.stocks.length > 12 && (
                        <span className="text-sub text-[11px] self-center">+{t.stocks.length - 12}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'news' && (
          <>
            <div className="text-sub text-[12px] mb-2">
              {activeNews
                ? `归档日 ${activeNews.date} · ${activeNews.newsflash.length} 条`
                : '无快讯归档'}
            </div>
            <DataTable
              rows={newsFiltered}
              rowKey={(n, i) => `${n.title}-${i}`}
              empty="无快讯记录"
              columns={[
                {
                  label: '快讯',
                  className: 'whitespace-normal min-w-[320px]',
                  cell: (n) => <span className="text-[12.5px] leading-relaxed">{n.title}</span>,
                },
                {
                  label: '指向题材',
                  className: 'whitespace-normal min-w-[160px]',
                  cell: (n) =>
                    n.plates?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {n.plates.map((p) => (
                          <Tag key={p} tone="up">
                            {p}
                          </Tag>
                        ))}
                      </span>
                    ) : (
                      <span className="text-sub">—</span>
                    ),
                },
                {
                  label: '指向个股',
                  className: 'whitespace-normal min-w-[200px]',
                  cell: (n) =>
                    n.stocks?.length ? (
                      <span className="flex flex-wrap gap-1">
                        {n.stocks.map((s) => (
                          <Tag key={s}>{s}</Tag>
                        ))}
                      </span>
                    ) : (
                      <span className="text-sub">—</span>
                    ),
                },
              ]}
            />
            {!!newsDays.length && newsDays.length > 1 && (
              <p className="text-sub text-[11px] mt-2">
                已归档 {newsDays.length} 日（{newsDays.at(-1)?.date} ~ {newsDays[0]?.date}），本页展示最新一日。
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
