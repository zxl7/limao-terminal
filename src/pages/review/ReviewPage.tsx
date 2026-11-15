import { useQuery } from '@tanstack/react-query'
import { api, queryClient } from '@/shared/api'
import type { ReviewPanel, ReviewSeries } from '@/shared/api/types'
import { Card, CardBadge, EmptyState, LineChart } from '@/shared/ui'
import { Tag, n1, n2 } from '@/features/analytics'
import { cn } from '@/shared/lib'
import { parseMainline } from '@/features/review/mainline'

/**
 * 今日复盘（2026-11-14 用户「改造成网页类型，连续几天做折线图」）。
 *
 * 版式：KPI 行 → 情绪/涨停双轴折线 → 涨停-跌停柱状 → 最高板折线
 *       → 高标处境 → 主线板块 → 复盘点评（可折叠）。
 * 数据：`/api/review/panel`（当日五块）+ `/api/review/series`（多日序列）。
 * ⛔ 只呈现，不在前端二次推断。
 */
export async function loader() {
  await Promise.allSettled([
    queryClient.ensureQueryData({ queryKey: ['review', 'panel'] as const, queryFn: api.reviewPanel }),
    queryClient.ensureQueryData({ queryKey: ['review', 'series'] as const, queryFn: api.reviewSeries }),
  ])
  return null
}

export function Component() {
  const panel = useQuery({ queryKey: ['review', 'panel'] as const, queryFn: api.reviewPanel, staleTime: 5 * 60_000 })
  const series = useQuery({ queryKey: ['review', 'series'] as const, queryFn: api.reviewSeries, staleTime: 5 * 60_000 })
  const d = panel.data as ReviewPanel | undefined
  const s = series.data as ReviewSeries | undefined

  const rows = s?.rows ?? []
  // 直接派生（`rows` 每次渲染都是新数组，放进 useMemo 依赖只会每次重算）
  const labels = rows.map((r) => r.date.slice(5))
  const tone = (v: number | null | undefined) => (v == null ? 'sub' : v >= 0 ? 'up' : 'down')

  if (!d) {
    return (
      <Card title="🧭 今日复盘" extra={<CardBadge>—</CardBadge>}>
        <EmptyState text="暂无复盘数据" hint={panel.isLoading ? '加载中…' : '收盘后由 15:35 链生成'} />
      </Card>
    )
  }

  const risk = d.dump_risk ?? d.risk
  const m = d.money
  const hb = d.high_board
  const last = rows.at(-1)

  // 2026-11-15：删「真实情绪总览/轮动复盘/板块资金」；情绪演变放左栏主线之下，右栏 AI 综合判断 + 主线复盘 + 其余。
  // 2026-11-15：删「真实情绪总览 / 轮动复盘 / 板块资金」；「主线复盘」单独结构化渲染。
  const commentary = (d.commentary ?? []).filter(
    (sec) => !/真实情绪|轮动复盘|板块资金/.test(sec.heading),
  )
  const evolution = commentary.find((sec) => sec.heading.includes('情绪演变'))
  const ai = commentary.find((sec) => sec.heading.includes('综合判断'))
  const mainline = commentary.find((sec) => sec.heading.includes('主线复盘'))
  const rest = commentary.filter((sec) => sec !== evolution && sec !== ai && sec !== mainline)
  const mainlineBlocks = mainline ? parseMainline(mainline.lines) : []
  /** 评分轨迹：只取有情绪分的那几天（当前 5 日窗口），不足 2 点不画图 */
  const trendRows = rows.filter((r) => r.sentiment != null).slice(-6)

  return (
    <div className="flex flex-col gap-3">
      {/* ① 一行速览：风险 + 关键数字 + 信号 chips（删除单独的「风险卡/赚钱效应卡」，避免重复） */}
      <Card
        title="🧭 今日复盘"
        extra={<CardBadge>{d.date}{d.prev ? ` · ${d.prev}` : ''}</CardBadge>}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-12 text-sub">跌停风险</span>
            <span className={cn('text-20 font-semibold num', risk.level === '高' ? 'text-down' : risk.level === '中' ? 'text-warn' : 'text-up')}>{risk.level}</span>
          </div>
          <Kpi label="涨停/跌停" value={`${last?.zt ?? '—'} / ${last?.dt ?? '—'}`} />
          <Kpi label="情绪分" value={last?.sentiment == null ? '—' : `${n1(last.sentiment)}`} tone={tone((last?.sentiment ?? 5) - 5)} />
          <Kpi label="晋级率" value={last?.promote_rate == null ? '—' : `${n1(last.promote_rate)}%`} />
          <Kpi label="最高板" value={last?.max_boards == null ? '—' : `${last.max_boards}`} tone="warn" />
          <Kpi label="池均幅" value={m.zt_pool_avg == null ? '—' : `${n2(m.zt_pool_avg)}%`} tone={tone(m.zt_pool_avg)} />
          <Kpi label="红盘率" value={m.red_ratio == null ? '—' : `${n1(m.red_ratio)}%`} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {risk.signals.map((sig) => (
            <span
              key={sig.name}
              className={cn('text-11 px-1.5 py-[1px] rounded-sm border',
                sig.hit ? 'text-down border-down/40 bg-down/10' : 'text-sub border-line-faint')}
            >
              {sig.hit ? '●' : '○'} {sig.name} {sig.value}
            </span>
          ))}
        </div>
      </Card>

      {/* ② 两栏：左=情绪分图 + 高标 + 主线 + 情绪演变；右=AI 综合判断 + 主线复盘 + 其余点评 */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-3 items-start">
        <div className="flex flex-col gap-3">
          {/* 情绪分 + 晋级率（双轴，20 日） */}
          <Card title="📈 情绪分 / 晋级率" extra={<CardBadge>近 {rows.length} 日</CardBadge>}>
            {rows.length ? (
              <LineChart
                labels={labels}
                series={[
                  { name: '情绪分', values: rows.map((r) => r.sentiment), tone: 'up', area: true },
                  { name: '晋级率%', values: rows.map((r) => r.promote_rate), tone: 'lead', axis: 'right', format: (v) => `${Math.round(v)}%` },
                ]}
                height={165}
                format={(v) => n1(v)}
                refLines={[{ value: 7, label: '7', tone: 'sub', dashed: true }, { value: 2, label: '2', tone: 'sub', dashed: true }]}
              />
            ) : <EmptyState text="无序列数据" />}
          </Card>

          <Card title="👑 高标" extra={hb ? <CardBadge>{hb.max_boards} 板</CardBadge> : undefined}>
            {hb?.rows?.length ? hb.rows.map((r) => (
              <div key={r.code} className="text-12 leading-relaxed">
                <b>{r.name}</b> {r.boards} 板 · 封 {r.fbt || '—'} · 炸 {r.zbc}
                {r.second_wave && <Tag tone="warn">二波</Tag>}
                <div className="text-11 text-sub">明日封住 → {r.boards + 1} 板（{r.next_odds ?? '—'}%）；断板 → 退潮</div>
              </div>
            )) : <p className="text-12 text-sub m-0">无高标</p>}
          </Card>

          <Card title="🎯 主线" extra={<CardBadge>Top 6</CardBadge>}>
            <ul className="text-12 leading-relaxed m-0">
              {d.themes.slice(0, 6).map((t) => (
                <li key={t.name} className="flex items-center gap-2 mb-0.5">
                  <span className="w-[80px] flex-none truncate">{t.name}</span>
                  <span className="h-[4px] flex-1 rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
                    <span className="block h-full" style={{ width: `${Math.round(t.strength * 100)}%`, background: 'var(--color-lead)' }} />
                  </span>
                  <span className="num flex-none w-[34px] text-right">{t.zt}家</span>
                  <span className={cn('flex-none w-[42px] text-right', t.day >= 3 ? 'text-warn' : 'text-sub')}>{t.max_boards}板·{t.day}天</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* 2026-11-15 用户：情绪演变做成小卡，放左栏主线之下 */}
          {evolution && (
            <Card title="📉 情绪演变" extra={<CardBadge>评分轨迹</CardBadge>}>
              {trendRows.length > 1 && (
                <LineChart
                  labels={trendRows.map((r) => r.date.slice(5))}
                  series={[{ name: '情绪分', values: trendRows.map((r) => r.sentiment), tone: 'up', area: true }]}
                  height={105}
                  format={(v) => n1(v)}
                  showLegend={false}
                  refLines={[{ value: 7, label: '7', tone: 'sub', dashed: true }, { value: 2, label: '2', tone: 'sub', dashed: true }]}
                />
              )}
              <div className="flex flex-col gap-1 text-11 leading-[1.65] text-txt mt-1.5 break-words">
                {evolution.lines.map((ln, i) => (
                  // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                  <CommentLine key={i} text={ln} compact />
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* 右栏：AI 综合判断 → 主线复盘 → 其余段落 */}
        <div className="flex flex-col gap-3 min-w-0">
          {ai && (
            <Card title="🧠 AI 综合判断" extra={<CardBadge>{ai.lines.length} 条</CardBadge>}>
              <div className="flex flex-col gap-2 text-13 leading-[1.75] text-txt break-words">
                {ai.lines.map((ln, i) => (
                  // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                  <CommentLine key={i} text={ln} />
                ))}
              </div>
            </Card>
          )}

          {/* 🎯 主线复盘：每条主线一张卡，个股做成小卡片 */}
          {mainlineBlocks.length > 0 && (
            <div className="flex flex-col gap-3 min-w-0">
              {mainlineBlocks.map((b) => (
                <Card
                  key={`${b.rank}-${b.name}`}
                  title={b.rank ? `${b.rank} · ${b.name || '—'}` : (b.name || '主线')}
                  extra={b.meta ? <CardBadge>{b.meta}</CardBadge> : undefined}
                >
                  <div className="flex flex-col gap-2">
                    {b.stocks.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-1.5">
                        {b.stocks.map((st, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <div key={`${st.name}-${i}`} className="rounded-sm border border-line-faint px-2 py-1 min-w-0">
                            <div className="text-12 font-semibold text-txt truncate">{st.name || '—'}</div>
                            <div className="text-11 text-sub leading-snug break-words">{st.detail || '—'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {b.logic.map((ln, i) => (
                      // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                      <p key={i} className="text-12 text-sub leading-[1.7] m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                    ))}
                    {b.risk.map((ln, i) => (
                      // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                      <p key={i} className="text-12 text-warn leading-[1.7] m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                    ))}
                    {b.text.map((ln, i) => (
                      // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                      <p key={i} className="text-12 text-txt leading-[1.7] m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 items-start min-w-0">
              {rest.map((sec) => (
                <div key={sec.heading} className={cn('min-w-0', sec.lines.join('').length > 700 && '2xl:col-span-2')}>
                  <Card title={sec.heading.replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '')}>
                    <div className="flex flex-col gap-2 text-13 leading-[1.75] text-txt break-words">
                      {sec.lines.map((ln, i) => (
                        // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                        <CommentLine key={i} text={ln} />
                      ))}
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          )}

          {!evolution && !ai && !mainline && rest.length === 0 && (
            <Card title="🧠 复盘点评">
              <EmptyState text="今日暂无复盘点评" hint="复盘数据生成后出现" />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

/** 顶部速览用的小指标（label 上、值下，紧凑） */
function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'warn' | 'sub' }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-11 text-sub">{label}</span>
      <span className={cn('text-15 font-semibold num', tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : 'text-txt')}>{value}</span>
    </div>
  )
}

/**
 * 点评行渲染（2026-11-14 用户「右边全是文案，优化阅读」）。
 * `**标签** 值` → 两列；`· xxx` → 列表；含进度条字符时画进度条。
 */
function CommentLine({ text, compact = false }: { text: string; compact?: boolean }) {
  const t = text.trim()
  const m = /^\*\*(.+?)\*\*[　\s]*(.*)$/.exec(t)
  const bar = /[▰▱]{6,}/.exec(t)
  if (bar) {
    const s = bar[0]
    const filled = (s.match(/▰/g) || []).length
    const pct = Math.round((filled / s.length) * 100)
    return (
      <div className="mb-1.5">
        <div className="h-[6px] w-full rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
          <div className="h-full" style={{ width: `${pct}%`, background: 'var(--color-up)' }} />
        </div>
        <div className="text-12 mt-0.5" dangerouslySetInnerHTML={{ __html: fmt(t.replace(s, '')) }} />
      </div>
    )
  }
  if (t.startsWith('·')) {
    return (
      <div className="flex gap-1.5 mb-0.5">
        <span className="text-sub flex-none">·</span>
        <span className={cn('leading-[1.55]', compact ? 'text-12' : 'text-13')} dangerouslySetInnerHTML={{ __html: fmt(t.replace(/^·\s*/, '')) }} />
      </div>
    )
  }
  if (m) {
    const shortLabel = m[1].length <= 6 && m[2].trim().length > 0
    return (
      <div className={shortLabel ? 'grid grid-cols-[64px_minmax(0,1fr)] gap-3' : 'flex flex-col gap-1'}>
        <span className={shortLabel ? 'text-12 text-sub leading-[1.75]' : 'text-13 font-semibold text-txt leading-[1.75]'}>{m[1]}</span>
        {m[2] && <span className={cn('leading-[1.75]', compact ? 'text-12' : 'text-13')} dangerouslySetInnerHTML={{ __html: fmt(m[2]) }} />}
      </div>
    )
  }
  return <p className={cn('m-0 leading-[1.75]', compact ? 'text-12 mb-0.5' : 'text-13 mb-1')} dangerouslySetInnerHTML={{ __html: fmt(t) }} />
}

/** lark_md 轻量转 HTML：`<text_tag color>` → span，`**加粗**` → b，换行 → br。 */
function fmt(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/&lt;text_tag color='(red|green|blue|purple|grey|neutral)'&gt;/g, (_m, c) => `<span class="tt-${c}">`)
    .replace(/&lt;\/text_tag&gt;/g, '</span>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br/>')
}
