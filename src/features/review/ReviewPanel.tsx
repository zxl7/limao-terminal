import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api'
import type { ReviewPanel } from '@/shared/api/types'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { StatPair, Tag, n1, n2 } from '@/features/analytics'
import { cn } from '@/shared/lib'

/**
 * 复盘模块（2026-11-14 用户「放在主线题材下面」）。
 *
 * 五块：① 明日跌停预判 ② 赚钱效应 ③ 高标处境 ④ 主线与板块 ⑤ 复盘点评（LLM 卡内容）。
 * 数据源：`/api/review/panel` ← `cache/review_panel.json`（15:35 落盘）。
 * ⛔ 只呈现，不在前端二次推断。
 */
export function ReviewPanelSection() {
  const q = useQuery({
    queryKey: ['review', 'panel'] as const,
    queryFn: api.reviewPanel,
    staleTime: 5 * 60_000,
  })
  const d = q.data as ReviewPanel | undefined

  if (!d) {
    return (
      <Card title="🧭 复盘" extra={<CardBadge>—</CardBadge>}>
        <EmptyState text="暂无复盘数据" hint={q.isLoading ? '加载中…' : '收盘后由 15:35 链生成'} />
      </Card>
    )
  }

  const risk = d.dump_risk ?? d.risk
  const hb = d.high_board
  const m = d.money

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🧭 复盘"
        extra={<CardBadge>{d.date}{d.prev ? `（对比 ${d.prev}）` : ''}</CardBadge>}
      >
        {/* ① 明日跌停预判 */}
        <section className="mb-3">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-13 font-semibold">⚠️ 明日跌停预判</span>
            <Tag tone={risk.level === '高' ? 'down' : risk.level === '中' ? 'warn' : 'up'}>
              {risk.level}（命中 {risk.hits}）
            </Tag>
          </div>
          {risk.verdict && <p className="text-12 text-sub mb-1.5">{risk.verdict}</p>}
          <ul className="text-12 leading-relaxed m-0">
            {risk.signals.map((s) => (
              <li key={s.name} className="flex gap-1.5">
                <span className={s.hit ? 'text-down' : 'text-sub'}>{s.hit ? '●' : '○'}</span>
                <span className={s.hit ? 'text-txt' : 'text-sub'}>{s.name}：{s.value}</span>
              </li>
            ))}
          </ul>
          {!!risk.prev_zt_to_limit_down?.length && (
            <p className="text-12 text-warn mt-1 mb-0">
              昨日涨停今日跌停 {risk.prev_zt_to_limit_down_count} 只：{risk.prev_zt_to_limit_down.join('、')}
            </p>
          )}
        </section>

        {/* ② 赚钱效应 */}
        <section className="mb-3 border-t border-line-faint pt-2">
          <div className="text-13 font-semibold mb-1.5">💰 赚钱效应</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mb-1.5">
            <StatPair label="昨日涨停池均幅" value={m.zt_pool_avg == null ? '—' : `${n2(m.zt_pool_avg)}%`} tone={(m.zt_pool_avg ?? 0) >= 0 ? 'up' : 'down'} />
            <StatPair label="红盘率" value={m.red_ratio == null ? '—' : `${n1(m.red_ratio)}%`} />
            <StatPair label="接力均幅" value={m.relay_avg == null ? '—' : `${n2(m.relay_avg)}%`} tone={(m.relay_avg ?? 0) >= 0 ? 'up' : 'down'} />
            <StatPair label="隔夜均幅" value={m.overnight_avg == null ? '—' : `${n2(m.overnight_avg)}%`} tone={(m.overnight_avg ?? 0) >= 0 ? 'up' : 'down'} />
          </div>
          <ul className="text-12 leading-relaxed m-0">
            {m.relay_best && m.relay_worst && (
              <li>
                接力（昨日 {m.relay_max_boards} 板）最强 <b className="text-up">{m.relay_best.name} {n2(m.relay_best.pct)}%</b>
                　最弱 <b className="text-down">{m.relay_worst.name} {n2(m.relay_worst.pct)}%</b>
              </li>
            )}
            {m.overnight_best && m.overnight_worst && (
              <li>
                隔夜（昨日 2 板）最强 <b className="text-up">{m.overnight_best.name} {n2(m.overnight_best.pct)}%</b>
                　最弱 <b className="text-down">{m.overnight_worst.name} {n2(m.overnight_worst.pct)}%</b>
              </li>
            )}
          </ul>
        </section>

        {/* ③ 高标处境 */}
        {hb && (
          <section className="mb-3 border-t border-line-faint pt-2">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-13 font-semibold">👑 高标处境</span>
              <Tag tone="warn">{hb.max_boards} 板 · {hb.count} 只</Tag>
            </div>
            <ul className="text-12 leading-relaxed m-0">
              {hb.rows.map((r) => (
                <li key={r.code} className="mb-1">
                  <b>{r.name}</b>({r.code}) {r.boards} 板 · 封 {r.fbt || '—'} · 炸 {r.zbc} 次
                  {r.second_wave && <Tag tone="warn">第二波</Tag>}
                  <span className="block text-sub">{r.key}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ④ 主线与板块 */}
        <section className="mb-3 border-t border-line-faint pt-2">
          <div className="text-13 font-semibold mb-1.5">🎯 主线与板块</div>
          <ul className="text-12 leading-relaxed m-0">
            {d.themes.slice(0, 8).map((t) => (
              <li key={t.name} className="flex items-center gap-2">
                <span className="w-[104px] flex-none truncate">{t.name}</span>
                <span className="h-[5px] flex-1 max-w-[160px] rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
                  <span className="block h-full" style={{ width: `${Math.round(t.strength * 100)}%`, background: 'var(--color-lead)' }} />
                </span>
                <span className="num flex-none">{t.zt} 家</span>
                <span className="text-sub flex-none">最高 {t.max_boards} 板</span>
                <span className={cn('text-sub flex-none', t.day >= 3 && 'text-warn')}>第 {t.day} 天</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ⑤ 复盘点评（LLM 卡内容原样呈现） */}
        {!!d.commentary?.length && (
          <section className="border-t border-line-faint pt-2">
            <div className="text-13 font-semibold mb-1.5">🧠 复盘点评</div>
            <div className="text-12 leading-relaxed">
              {d.commentary.map((s) => (
                <div key={s.heading} className="mb-2">
                  <div className="text-sub mb-0.5">{s.heading}</div>
                  {s.lines.map((ln, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 文案序列，索引即位置
                    <p key={i} className="m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}
      </Card>
    </div>
  )
}

/** 把飞书 lark_md 的 `<text_tag color='x'>`/加粗 转成 HTML；其余原样转义。 */
function fmt(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/&lt;text_tag color='(red|green|blue|purple|grey|neutral)'&gt;/g, (_m, c) => `<span class="tt-${c}">`)
    .replace(/&lt;\/text_tag&gt;/g, '</span>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br/>')
}
