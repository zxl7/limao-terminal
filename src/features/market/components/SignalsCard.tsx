import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, isStarMarket } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import type { ShortSpiritDeposit } from '@/shared/api'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/**
 * 短线精灵 —— 对应原 watch.html 的 `renderWatch` / `buildSpirit` 逻辑。
 * 数据源：`/api/market/signals`（short_spirit_signals.json）。
 *
 * ## ⛔ 渲染「当日沉淀」而不是「本轮触发」
 *
 * `signals` 是**本轮触发**的信号，文件每轮**覆盖写**；后端 `_timeliness_gate` 又会剔掉
 * 存量涨停（上一轮已观测为涨停的票）→ 大部分轮次 `signals` 为空 →
 * 前端一刷新列表就消失（用户 2026-09-21「我这一刷新，列表那里就空了」）。
 *
 * `signals_today` 是**当日累积**：每条带 `first_seen`（首次触发时刻）与 `seen_count`
 * （当日出现过几轮）→ 列表即「当天信号时间线」，按首次触发倒序，最新在前。
 *
 * ## 三条兜底纪律
 *
 * 1. 旧数据没有 `signals_today` → 回退 `signals`（向后兼容，不因字段缺失而空卡）；
 * 2. ⛔ 科创板（688/689）无交易权限 → 全卡剔除（后端未滤，前端兜底）；
 * 3. ⚠️ 沉淀里的**历史条目只有身份与时刻**（由事件流回填，没有 pct / 资金 / 理由）
 *    → 一律 `—` 兜底，⛔ 不得退化成 0 或空白。
 */
export function SignalsCard() {
  const { data } = useQuery(marketQueries.signals())
  const sessionText = data?.session === 'morning' ? '早盘' : '午后'

  /** `ShortSpiritSignal` 的字段是 `ShortSpiritDeposit` 的子集 → 可直接并入同一列表 */
  const deposited = data?.signals_today ?? []
  const rows: ShortSpiritDeposit[] = deposited.length > 0 ? deposited : (data?.signals ?? [])

  const visible = rows.filter((s) => !isStarMarket(s.code))

  return (
    <Card
      title="⚡ 短线精灵"
      extra={
        data && (
          <span className="text-[11px] font-normal text-sub">
            {visible.length} 条 · {sessionText}
          </span>
        )
      }
    >
      {visible.length > 0 ? (
        /* 上限 300px + 内部滚动：沉淀是一整天的时间线（实测可上百条），
           不封顶会把两栏网格的整列拉高（与 LeadersCard 同口径）。 */
        <div className="flex flex-col gap-2 max-h-[300px] overflow-auto">
          {visible.map((s) => (
            <div
              key={s.code ?? s.name}
              className="pb-[7px] border-b border-line last:border-b-0 last:pb-0"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="num text-[11px] text-sub flex-none">
                  {s.first_seen ? s.first_seen.slice(0, 5) : '—'}
                </span>
                <span className="text-[13px] font-semibold">{s.name}</span>
                <span className="text-[11px] text-sub">{s.code}</span>
                {s.pct != null ? (
                  <span className={cn('num text-[13px] font-semibold ml-auto', pctTone(s.pct))}>
                    {fmtPct(s.pct)}
                  </span>
                ) : (
                  <span className="num text-[13px] text-sub ml-auto">—</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-[3px]">
                {[s.type, ...(s.tags ?? [])].filter(Boolean).map((t) => (
                  <span key={t} className="badge bg-line text-sub">
                    {t}
                  </span>
                ))}
                {s.sector && <span className="text-[11px] text-sub">{s.sector}</span>}
                {s.reason && <span className="text-[11px] text-sub">{s.reason}</span>}
              </div>

              <div className="num text-[11px] text-sub mt-0.5">
                强度 {(s.strength ?? 0).toFixed(2)}
                {s.seen_count != null && s.seen_count > 1 && ` ｜ ${s.seen_count} 轮`}
                {s.flow_yi != null && ` ｜ 资金 ${s.flow_yi} 亿`}
                {s.market_cap_yi != null && ` ｜ 市值 ${s.market_cap_yi} 亿`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="暂无短线信号" />
      )}
    </Card>
  )
}
