import { useQuery } from '@tanstack/react-query'
import { api, queryClient } from '@/shared/api'
import type { ReviewPanel, ReviewSeries } from '@/shared/api/types'
import { Card, CardBadge, EmptyState, LineChart, BarChart } from '@/shared/ui'
import { StatPair, Tag, n1, n2 } from '@/features/analytics'
import { cn } from '@/shared/lib'

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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)] gap-3 items-start">
      {/* ⬅️ 左栏：图表速览（占位小，深度周期分析请看「情绪周期」tab） */}
      <div className="flex flex-col gap-3">
        <Card title="🧭 今日复盘" extra={<CardBadge>{d.date}</CardBadge>}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatPair label="跌停风险" value={risk.level} tone={risk.level === '高' ? 'down' : risk.level === '中' ? 'warn' : 'up'} />
            <StatPair label="涨停/跌停" value={`${last?.zt ?? '—'} / ${last?.dt ?? '—'}`} />
            <StatPair label="最高板" value={last?.max_boards == null ? '—' : `${last.max_boards} 板`} tone="warn" />
            <StatPair label="情绪分" value={last?.sentiment == null ? '—' : `${n1(last.sentiment)}/10`} tone={tone((last?.sentiment ?? 5) - 5)} />
          </div>
          <p className="text-11 text-sub m-0 mt-1.5">{risk.verdict ?? ''}</p>
          <p className="text-11 text-sub m-0 mt-1">
            深度周期定位见 <span className="text-lead">情绪周期</span> 页 · 本页只做当日复盘
          </p>
        </Card>

        <Card title="📈 情绪分 / 晋级率" extra={<CardBadge>{rows.length} 日</CardBadge>}>
          {rows.length ? (
            <LineChart
              labels={labels}
              series={[
                { name: '情绪分', values: rows.map((r) => r.sentiment), tone: 'up', area: true },
                { name: '晋级率%', values: rows.map((r) => r.promote_rate), tone: 'lead', axis: 'right', format: (v) => `${Math.round(v)}%` },
              ]}
              height={130}
              format={(v) => n1(v)}
              showLegend={false}
              refLines={[{ value: 7, label: '7', tone: 'sub', dashed: true }, { value: 2, label: '2', tone: 'sub', dashed: true }]}
            />
          ) : <EmptyState text="无序列数据" />}
        </Card>

        <Card title="📊 涨停 vs 跌停" extra={<CardBadge>近 10 日</CardBadge>}>
          {rows.length ? (
            <BarChart
              bars={rows.slice(-10).map((r) => ({ label: r.date.slice(5), value: r.zt, compare: r.dt, compareLabel: '跌停' }))}
              height={120}
              maxBarWidth={18}
              format={(v) => `${Math.round(v)}`}
            />
          ) : <EmptyState text="无序列数据" />}
        </Card>

        <Card title="⚠️ 明日跌停预判" extra={<CardBadge>{risk.level}（{risk.hits}）</CardBadge>}>
          <div className="grid grid-cols-1 gap-y-0.5 text-12">
            {risk.signals.map((sig) => (
              <div key={sig.name} className="flex items-center gap-1.5">
                <span className={sig.hit ? 'text-down' : 'text-sub'}>{sig.hit ? '●' : '○'}</span>
                <span className={sig.hit ? 'text-txt' : 'text-sub'}>{sig.name}</span>
                <span className="text-sub ml-auto num">{sig.value}</span>
              </div>
            ))}
          </div>
          {!!risk.prev_zt_to_limit_down?.length && (
            <p className="text-11 text-warn mt-1 mb-0">
              昨涨停今跌停 {risk.prev_zt_to_limit_down_count} 只：{risk.prev_zt_to_limit_down.join('、')}
            </p>
          )}
        </Card>

        <Card title="💰 赚钱效应" extra={<CardBadge>昨日涨停池</CardBadge>}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatPair label="池均幅" value={m.zt_pool_avg == null ? '—' : `${n2(m.zt_pool_avg)}%`} tone={tone(m.zt_pool_avg)} />
            <StatPair label="红盘率" value={m.red_ratio == null ? '—' : `${n1(m.red_ratio)}%`} />
            <StatPair label="接力均幅" value={m.relay_avg == null ? '—' : `${n2(m.relay_avg)}%`} tone={tone(m.relay_avg)} />
            <StatPair label="隔夜均幅" value={m.overnight_avg == null ? '—' : `${n2(m.overnight_avg)}%`} tone={tone(m.overnight_avg)} />
          </div>
          <ul className="text-11 leading-relaxed m-0 mt-1">
            {m.relay_best && m.relay_worst && (
              <li>接力最强 <b className="text-up">{m.relay_best.name} {n2(m.relay_best.pct)}%</b> · 最弱 <b className="text-down">{m.relay_worst.name} {n2(m.relay_worst.pct)}%</b></li>
            )}
            {m.overnight_best && m.overnight_worst && (
              <li>隔夜最强 <b className="text-up">{m.overnight_best.name} {n2(m.overnight_best.pct)}%</b> · 最弱 <b className="text-down">{m.overnight_worst.name} {n2(m.overnight_worst.pct)}%</b></li>
            )}
          </ul>
        </Card>

        {!!hb?.rows?.length && (
          <Card title="👑 高标处境" extra={<CardBadge>{hb.max_boards} 板</CardBadge>}>
            {hb.rows.map((r) => (
              <div key={r.code} className="text-12 leading-relaxed mb-1">
                <b>{r.name}</b>({r.code}) {r.boards} 板 · 封 {r.fbt || '—'} · 炸 {r.zbc}
                {r.second_wave && <Tag tone="warn">第二波</Tag>}
                <span className="block text-11 text-sub">{r.key}</span>
              </div>
            ))}
          </Card>
        )}

        <Card title="🎯 主线与板块" extra={<CardBadge>按家数</CardBadge>}>
          <ul className="text-12 leading-relaxed m-0">
            {d.themes.slice(0, 8).map((t) => (
              <li key={t.name} className="flex items-center gap-2">
                <span className="w-[88px] flex-none truncate">{t.name}</span>
                <span className="h-[4px] flex-1 max-w-[110px] rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
                  <span className="block h-full" style={{ width: `${Math.round(t.strength * 100)}%`, background: 'var(--color-lead)' }} />
                </span>
                <span className="num flex-none">{t.zt}</span>
                <span className="text-sub flex-none">最高 {t.max_boards}</span>
                <span className={cn('flex-none', t.day >= 3 ? 'text-warn' : 'text-sub')}>第 {t.day} 天</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ➡️ 右栏：复盘点评（核心内容，全文不折叠） */}
      <div className="flex flex-col gap-3">
        {d.commentary?.length ? d.commentary.map((sec) => (
          <Card key={sec.heading} title={sec.heading} extra={<CardBadge>{sec.lines.length} 行</CardBadge>}>
            <div className="text-13 leading-relaxed">
              {sec.lines.map((ln, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- 文案序列，索引即位置
                <CommentLine key={i} text={ln} />
              ))}
            </div>
          </Card>
        )) : (
          <Card title="🧠 复盘点评" extra={<CardBadge>—</CardBadge>}>
            <EmptyState text="今日暂无复盘点评" hint="15:35 复盘链生成后会出现在这里" />
          </Card>
        )}
      </div>
    </div>
  )
}

/**
 * 点评行渲染（2026-11-14 用户「右边全是文案，优化阅读」）。
 * `**标签** 值` → 两列；`· xxx` → 列表；含进度条字符时画进度条。
 */
function CommentLine({ text }: { text: string }) {
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
        <span className="text-13 leading-relaxed" dangerouslySetInnerHTML={{ __html: fmt(t.replace(/^·\s*/, '')) }} />
      </div>
    )
  }
  if (m) {
    return (
      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 mb-0.5">
        <span className="text-12 text-sub">{m[1]}</span>
        <span className="text-13 leading-relaxed" dangerouslySetInnerHTML={{ __html: fmt(m[2]) }} />
      </div>
    )
  }
  return <p className="text-13 leading-relaxed m-0 mb-1" dangerouslySetInnerHTML={{ __html: fmt(t) }} />
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
