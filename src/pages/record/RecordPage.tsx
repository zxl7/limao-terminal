import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MarketSnapshot } from '@/shared/api'
import { DataTable, StatPair, n1 } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { useContractIssues } from '@/shared/hooks'

/**
 * 数据记录 —— 三层诊断信息，回答「数据到底可不可信」。
 *
 * ## 为什么把这三件事放在同一页
 *
 * 排查一次异常渲染，通常要连问三个问题，而它们的答案在不同地方：
 *   ① **数据在不在** → `/api/health`（文件存在性 + mtime + 体积 + 龄期）
 *   ② **数据变没变** → `/api/market/latest` vs `/api/market/prev` 的字段级环比
 *   ③ **结构对不对** → 契约守卫捕获的异常（`useContractIssues`）
 *
 * 三者一起看才能定性：例如「涨停数从 40 掉到 3」看起来是情绪冰点，
 * 但若 `health` 显示最新快照 12 分钟未更新、`contractIssues` 又报了字段缺失，
 * 那真实原因是**数据没刷进来**，而不是市场崩了。
 *
 * ## ⚠️ 契约异常不是「错误」，是「降级」
 *
 * 原系统哲学：结构不符契约时**数据照用 + 显式提示**，而不是整页报错。
 * 本页因此把异常列出来但不阻断 —— 提示的作用是让人知道「该字段可能不可信」。
 */

export function Component() {
  const latest = useQuery(marketQueries.latest())
  const prev = useQuery(marketQueries.prev())
  const health = useQuery(marketQueries.health())
  const issues = useContractIssues()

  const cur = latest.data
  const old = prev.data

  /** 环比差异行 —— 只列原系统口径里真正会变的字段 */
  const diffRows = useMemo(() => {
    if (!cur || !old) return []
    return [
      { key: '快照时间', a: old.ts, b: cur.ts, plain: true },
      { key: '全市场涨停', a: old.total_zt, b: cur.total_zt, better: 'up' as const },
      { key: '跌停家数', a: old.limit_down?.count, b: cur.limit_down?.count, better: 'down' as const },
      { key: '炸板家数', a: old.broken?.count, b: cur.broken?.count, better: 'down' as const },
      { key: '情绪', a: old.sentiment, b: cur.sentiment, plain: true },
      { key: '情绪分', a: old.sentiment_detail?.score, b: cur.sentiment_detail?.score, better: 'up' as const },
      { key: '封板率', a: old.sentiment_detail?.seal_rate, b: cur.sentiment_detail?.seal_rate, better: 'up' as const },
      { key: '最高板', a: maxBoards(old), b: maxBoards(cur), better: 'up' as const },
      { key: '两市成交额(亿)', a: old.market ?? undefined, b: cur.market ?? undefined, better: 'up' as const },
      { key: '上涨家数', a: old.breadth?.up ?? undefined, b: cur.breadth?.up ?? undefined, better: 'up' as const },
      { key: '下跌家数', a: old.breadth?.down ?? undefined, b: cur.breadth?.down ?? undefined, better: 'down' as const },
      { key: '连板梯队层数', a: old.ladder?.length, b: cur.ladder?.length, plain: true },
      { key: '快讯条数', a: old.newsflash?.length, b: cur.newsflash?.length, plain: true },
      { key: '早鸟埋伏项', a: old.early?.length, b: cur.early?.length, plain: true },
      { key: '辨识度标的', a: old.leaders?.length, b: cur.leaders?.length, plain: true },
    ]
  }, [cur, old])

  const changed = diffRows.filter((d) => String(d.a) !== String(d.b)).length

  const files = health.data?.files ?? []
  const missing = files.filter((f) => !f.exists)
  const stale = files.filter((f) => f.exists && (f.age_sec ?? 0) > 86_400)

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🔍 数据诊断"
        extra={
          <CardBadge tone={issues.size === 0 ? 'up' : 'warn'}>
            契约异常 {issues.size}
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="已登记数据源" value={files.length} />
          <StatPair label="缺失" value={missing.length} tone={missing.length ? 'down' : 'sub'} />
          <StatPair label="龄期 > 1 天" value={stale.length} tone={stale.length ? 'warn' : 'sub'} />
          <StatPair label="环比变化字段" value={`${changed} / ${diffRows.length}`} />
          <StatPair label="数据根" value={health.data?.data_root ?? '—'} />
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          三层诊断合看才能定性：涨停数骤降可能是真冰点，也可能是**数据没刷进来** ——
          后者会同时体现在「文件龄期偏大」与「契约异常」上。契约异常不阻断渲染（数据照用），
          它的作用是提示该字段可能不可信。
        </p>
      </Card>

      <Card title="快照环比（latest ↔ prev）" extra={<CardBadge>{changed} 项变化</CardBadge>}>
        {!cur || !old ? (
          <EmptyState
            text={latest.isLoading || prev.isLoading ? '加载中…' : '双快照不全'}
            hint="环比需要 latest 与 prev 同时存在"
          />
        ) : (
          <DataTable
            rows={diffRows}
            rowKey={(r) => r.key}
            rowClass={(r) => (String(r.a) !== String(r.b) ? 'bg-up/5' : undefined)}
            columns={[
              { label: '字段', cell: (r) => <span className="text-txt">{r.key}</span> },
              {
                label: 'prev',
                num: true,
                cell: (r) => <span className="text-sub">{fmtVal(r.a)}</span>,
              },
              {
                label: 'latest',
                num: true,
                cell: (r) => <span className="text-txt font-semibold">{fmtVal(r.b)}</span>,
              },
              {
                label: '变化',
                num: true,
                cell: (r) => {
                  const na = Number(r.a)
                  const nb = Number(r.b)
                  if (Number.isNaN(na) || Number.isNaN(nb)) {
                    return <span className="text-sub">{String(r.a) === String(r.b) ? '—' : '变更'}</span>
                  }
                  const d = nb - na
                  if (d === 0) return <span className="text-sub">—</span>
                  /** 改善红 / 恶化绿 —— 由 better 字段决定方向，而非数值正负 */
                  const good = r.better === 'up' ? d > 0 : r.better === 'down' ? d < 0 : null
                  return (
                    <span className={good == null ? 'text-txt' : good ? 'text-up' : 'text-down'}>
                      {d > 0 ? '+' : ''}
                      {n1(d)}
                    </span>
                  )
                },
              },
            ]}
          />
        )}
      </Card>

      <Card
        title="契约守卫（结构不符 → 记录但数据照用）"
        extra={<CardBadge tone={issues.size ? 'warn' : 'up'}>{issues.size ? `${issues.size} 个路由` : '全部符合'}</CardBadge>}
      >
        {issues.size === 0 ? (
          <EmptyState text="当前无契约异常" hint="所有已取数路由的结构均符合 zod 契约" />
        ) : (
          <div className="flex flex-col gap-2">
            {[...issues.entries()].map(([route, list]) => (
              <div key={route} className="border border-line rounded-sm px-2.5 py-1.5">
                <div className="num text-[12px] text-txt mb-0.5">{route}</div>
                <ul className="text-[11.5px] text-warn leading-relaxed">
                  {list.map((it, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                    <li key={i}>
                      <span className="num">{it.path}</span> — {it.message}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`文件新鲜度（${files.length} 个数据源）`} extra={<CardBadge>{health.data?.ts ?? '—'}</CardBadge>}>
        <div className="max-h-[62vh] overflow-y-auto">
          <DataTable
            rows={files}
            rowKey={(f) => f.route}
            dense
            rowClass={(f) => (!f.exists ? 'bg-down/5' : (f.age_sec ?? 0) > 86_400 ? 'bg-warn/5' : undefined)}
            empty="无健康数据"
            columns={[
              { label: '路由', cell: (f) => <span className="num text-[11.5px]">{f.route}</span> },
              { label: '说明', cell: (f) => <span className="text-sub text-[11.5px]">{f.desc || '—'}</span> },
              {
                label: '存在',
                cell: (f) =>
                  f.exists ? (
                    <span className="text-up">✓</span>
                  ) : (
                    <span className="text-down font-semibold">✗</span>
                  ),
              },
              {
                label: '龄期',
                num: true,
                cell: (f) => <span className="text-sub">{fmtAge(f.age_sec)}</span>,
              },
              {
                label: '体积',
                num: true,
                cell: (f) => <span className="text-sub">{fmtSize(f.size)}</span>,
              },
              {
                label: '更新时间',
                cell: (f) => <span className="num text-sub text-[11px]">{f.mtime?.slice(5, 19).replace('T', ' ') ?? '—'}</span>,
              },
            ]}
          />
        </div>
      </Card>
    </div>
  )
}

/** 与 feedback / 天梯口径一致：最高板取 ladder 各层的最大 boards */
function maxBoards(s: MarketSnapshot): number | undefined {
  if (!s.ladder?.length) return undefined
  return s.ladder.reduce((m, g) => Math.max(m, g.boards ?? 0), 0)
}

function fmtVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : n1(v)
  return String(v)
}

function fmtAge(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${sec.toFixed(0)} 秒`
  if (sec < 3600) return `${(sec / 60).toFixed(0)} 分`
  if (sec < 86_400) return `${(sec / 3600).toFixed(1)} 时`
  return `${(sec / 86_400).toFixed(1)} 天`
}

function fmtSize(b: number): string {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}
