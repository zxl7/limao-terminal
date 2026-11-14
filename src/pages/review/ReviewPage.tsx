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
    <div className="flex flex-col gap-3">
      {/* ── KPI 行 ─────────────────────────────────────────── */}
      <Card title="🧭 今日复盘" extra={<CardBadge>{d.date}{d.prev ? ` · 对比 ${d.prev}` : ''}</CardBadge>}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-x-5 gap-y-2 mb-1">
          <StatPair label="跌停风险" value={risk.level} tone={risk.level === '高' ? 'down' : risk.level === '中' ? 'warn' : 'up'} />
          <StatPair label="涨停 / 跌停" value={`${last?.zt ?? '—'} / ${last?.dt ?? '—'}`} />
          <StatPair label="最高板" value={last?.max_boards == null ? '—' : `${last.max_boards} 板`} tone="warn" />
          <StatPair label="情绪分" value={last?.sentiment == null ? '—' : `${n1(last.sentiment)}/10`} tone={tone((last?.sentiment ?? 5) - 5)} />
          <StatPair label="晋级率" value={last?.promote_rate == null ? '—' : `${n1(last.promote_rate)}%`} tone={tone((last?.promote_rate ?? 50) - 30)} />
        </div>
        <p className="text-12 text-sub m-0">{risk.verdict ?? ''}</p>
      </Card>

      {/* ── 情绪分 + 涨停（双轴）───────────────────────────── */}
      <Card title="📈 情绪分 / 涨停家数" extra={<CardBadge>{rows.length} 日</CardBadge>}>
        {rows.length ? (
          <LineChart
            labels={labels}
            series={[
              { name: '情绪分', values: rows.map((r) => r.sentiment), tone: 'up', area: true },
              { name: '涨停数', values: rows.map((r) => r.zt), tone: 'lead', axis: 'right', format: (v) => `${Math.round(v)}` },
            ]}
            height={240}
            format={(v) => n1(v)}
            refLines={[{ value: 7, label: '偏强 7', tone: 'sub', dashed: true }, { value: 2, label: '退潮 2', tone: 'sub', dashed: true }]}
          />
        ) : <EmptyState text="无序列数据" />}
      </Card>

      {/* ── 涨停 / 跌停 柱状 ──────────────────────────────── */}
      <Card title="📊 涨停 vs 跌停" extra={<CardBadge>近 10 日</CardBadge>}>
        {rows.length ? (
          <BarChart
            bars={rows.slice(-10).map((r) => ({
              label: r.date.slice(5),
              value: r.zt,
              compare: r.dt,
              compareLabel: '跌停',
            }))}
            height={170}
            maxBarWidth={26}
            format={(v) => `${Math.round(v)}`}
          />
        ) : <EmptyState text="无序列数据" />}
      </Card>

      {/* ── 最高板 折线 ──────────────────────────────────── */}
      <Card title="🧱 最高板高度" extra={<CardBadge>近 10 日</CardBadge>}>
        {rows.length ? (
          <LineChart
            labels={rows.slice(-10).map((r) => r.date.slice(5))}
            series={[{ name: '最高板', values: rows.slice(-10).map((r) => r.max_boards), tone: 'warn', area: true }]}
            height={150}
            format={(v) => `${Math.round(v)} 板`}
            showLegend={false}
          />
        ) : <EmptyState text="无序列数据" />}
      </Card>

      {/* ── 明日跌停预判 + 赚钱效应 ───────────────────────── */}
      <Card title="⚠️ 明日跌停预判" extra={<CardBadge>{risk.level}（命中 {risk.hits}）</CardBadge>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-12">
          {risk.signals.map((sig) => (
            <div key={sig.name} className="flex items-center gap-1.5">
              <span className={sig.hit ? 'text-down' : 'text-sub'}>{sig.hit ? '●' : '○'}</span>
              <span className={sig.hit ? 'text-txt' : 'text-sub'}>{sig.name}</span>
              <span className="text-sub ml-auto num">{sig.value}</span>
            </div>
          ))}
        </div>
        {!!risk.prev_zt_to_limit_down?.length && (
          <p className="text-12 text-warn mt-1 mb-0">
            昨日涨停今日跌停 {risk.prev_zt_to_limit_down_count} 只：{risk.prev_zt_to_limit_down.join('、')}
          </p>
        )}
      </Card>

      <Card title="💰 赚钱效应" extra={<CardBadge>昨日涨停池</CardBadge>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-2 mb-1">
          <StatPair label="池均幅" value={m.zt_pool_avg == null ? '—' : `${n2(m.zt_pool_avg)}%`} tone={tone(m.zt_pool_avg)} />
          <StatPair label="红盘率" value={m.red_ratio == null ? '—' : `${n1(m.red_ratio)}%`} />
          <StatPair label="接力均幅" value={m.relay_avg == null ? '—' : `${n2(m.relay_avg)}%`} tone={tone(m.relay_avg)} />
          <StatPair label="隔夜均幅" value={m.overnight_avg == null ? '—' : `${n2(m.overnight_avg)}%`} tone={tone(m.overnight_avg)} />
        </div>
        <ul className="text-12 leading-relaxed m-0">
          {m.relay_best && m.relay_worst && (
            <li>接力（昨日 {m.relay_max_boards} 板）最强 <b className="text-up">{m.relay_best.name} {n2(m.relay_best.pct)}%</b>　最弱 <b className="text-down">{m.relay_worst.name} {n2(m.relay_worst.pct)}%</b></li>
          )}
          {m.overnight_best && m.overnight_worst && (
            <li>隔夜（昨日 2 板）最强 <b className="text-up">{m.overnight_best.name} {n2(m.overnight_best.pct)}%</b>　最弱 <b className="text-down">{m.overnight_worst.name} {n2(m.overnight_worst.pct)}%</b></li>
          )}
        </ul>
      </Card>

      {/* ── 高标 + 主线 ──────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Card title="👑 高标处境" extra={hb ? <CardBadge>{hb.max_boards} 板 · {hb.count} 只</CardBadge> : undefined}>
          {hb?.rows?.length ? (
            <ul className="text-12 leading-relaxed m-0">
              {hb.rows.map((r) => (
                <li key={r.code} className="mb-1.5">
                  <b>{r.name}</b>({r.code}) {r.boards} 板 · 封 {r.fbt || '—'} · 炸 {r.zbc} 次
                  {r.second_wave && <Tag tone="warn">第二波</Tag>}
                  <span className="block text-sub">{r.key}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState text="无高标" />}
        </Card>

        <Card title="🎯 主线与板块" extra={<CardBadge>按涨停家数</CardBadge>}>
          <ul className="text-12 leading-relaxed m-0">
            {d.themes.slice(0, 8).map((t) => (
              <li key={t.name} className="flex items-center gap-2">
                <span className="w-[104px] flex-none truncate">{t.name}</span>
                <span className="h-[5px] flex-1 max-w-[150px] rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
                  <span className="block h-full" style={{ width: `${Math.round(t.strength * 100)}%`, background: 'var(--color-lead)' }} />
                </span>
                <span className="num flex-none">{t.zt} 家</span>
                <span className="text-sub flex-none">最高 {t.max_boards} 板</span>
                <span className={cn('flex-none', t.day >= 3 ? 'text-warn' : 'text-sub')}>第 {t.day} 天</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ── 复盘点评（可折叠）────────────────────────────── */}
      {!!d.commentary?.length && (
        <Card title="🧠 复盘点评" extra={<CardBadge>{d.commentary.length} 段</CardBadge>}>
          <div className="flex flex-col gap-1.5">
            {d.commentary.map((sec) => (
              <details key={sec.heading} className="border border-line-faint rounded-sm px-2.5 py-1.5">
                <summary className="cursor-pointer text-12 text-sub">{sec.heading}</summary>
                <div className="text-12 leading-relaxed mt-1">
                  {sec.lines.map((ln, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 文案序列，索引即位置
                    <p key={i} className="m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
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
