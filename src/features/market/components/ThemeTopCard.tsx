import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct } from '@/shared/lib'
import { Card, EmptyState } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/**
 * 主线热度榜（`latest.top5`）—— 盘中「钱在哪条线上」的第一手依据。
 *
 * ## 和前端的其它卡片是什么关系
 *
 *   · 连板天梯 答「高度」—— 谁是 5 板
 *   · 核心标的 答「广度」—— 哪些没封板还能买
 *   · **本卡答「主线」** —— 哪条线在共振、扩散，并指出这条线的龙头
 *
 * 三者互补，缺一条就无法判断「今天是主线行情还是散乱行情」。
 *
 * ## ⚠️ 三处实测过的字段陷阱（都写在了这里，避免下次重犯）
 *
 * 1. `delta` 是**状态枚举字符串**（`new`/`surging`/`ongoing`），**不是**涨停数环比。
 *    早期把它当数字，`delta > 0` 恒 false → 所有题材被渲染成「持平」。
 *    真正的环比只能算 `zt_count - zt_prev`。
 * 2. `zt_prev` 可为 `null`（题材刚建立 / 盘面早段）→ 此时**不显示环比**，
 *    而不是显示 `+0`。`null` 是「没有对比基数」，0 是「和昨天一样多」。
 * 3. `leader` 也可为 `null`（占位条目：除 name / zt_count 外全空）→ 必须判空。
 */
const DELTA_LABEL: Record<string, string> = {
  new: '新晋',
  surging: '升温',
  ongoing: '持续',
}
const DELTA_CLASS: Record<string, string> = {
  new: 'bg-rec-soft text-rec',
  surging: 'bg-up-soft text-up',
  ongoing: 'bg-line-faint text-sub',
}

export function ThemeTopCard() {
  const { data } = useQuery(marketQueries.latest())
  const rows = data?.top5 ?? []

  return (
    <Card
      title="🔥 主线热度"
      extra={<span className="text-[11px] font-normal text-sub">{rows.length} 条共振板</span>}
    >
      {rows.length > 0 ? (
        <div className="flex flex-col gap-2">
          {rows.map((t) => {
            const rank = t.rank ?? 0
            const isTop = rank === 1
            const delta = DELTA_LABEL[t.delta] ?? t.delta
            // ⚠️ 只有拿到环比基数时才显示 —— zt_prev 为 null 表示「无基数」，不是 0
            const chg = t.zt_prev == null ? null : t.zt_count - t.zt_prev
            return (
              <div
                key={`${rank}-${t.name}`}
                className={cn(
                  'rounded-[var(--radius-sm)] px-2 py-1.5',
                  isTop ? 'bg-up-soft' : 'bg-line-faint',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      'num text-[11px] font-bold w-[18px] flex-none',
                      isTop ? 'text-up' : 'text-sub',
                    )}
                  >
                    {String(rank).padStart(2, '0')}
                  </span>
                  <span
                    className={cn(
                      'text-[13px] font-semibold',
                      isTop ? 'text-up' : 'text-txt',
                    )}
                  >
                    {t.name}
                  </span>
                  <span className="num text-[12px] text-sub">
                    涨停 <b className="text-[13px] text-up">{t.zt_count}</b>
                  </span>
                  {t.zt_prev != null && (
                    <span className={cn('num text-[11px]', pctTone(chg))}>
                      环比 {chg != null && chg > 0 ? '+' : ''}
                      {chg}
                    </span>
                  )}
                  <span className="text-[11px] text-sub">共 {t.total_stocks} 只</span>
                  {t.turn_avg != null && (
                    <span className="text-[11px] text-sub">均换手 {t.turn_avg}%</span>
                  )}
                  {delta && (
                    <span className={cn('badge', DELTA_CLASS[t.delta] ?? 'bg-line text-sub')}>
                      {delta}
                    </span>
                  )}
                  {t.diffusion && <span className="badge bg-line text-sub">{t.diffusion}</span>}
                </div>

                {/* 龙头 —— 主线里的「辨识度」载体，没有它这条线就只是一堆涨停 */}
                {t.leader ? (
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-1">
                    <span className="text-[10.5px] text-sub flex-none">龙头</span>
                    <span className="text-[12.5px] font-semibold text-lead">{t.leader.name}</span>
                    <span className="num text-[11px] text-sub">{t.leader.code}</span>
                    <span className={cn('num text-[12.5px] font-semibold', pctTone(t.leader.pct))}>
                      {fmtPct(t.leader.pct)}
                    </span>
                    {t.leader.seal && <span className="badge bg-lead-soft text-lead">{t.leader.seal}</span>}
                    {t.leader.cap_yi != null && (
                      <span className="num text-[11px] text-sub">{t.leader.cap_yi} 亿</span>
                    )}
                    {t.leader.turn != null && (
                      <span className="num text-[11px] text-sub">换手 {t.leader.turn}%</span>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-sub mt-1">龙头未定（题材尚未走出标杆）</div>
                )}

                {/* 跟随 —— 只有龙头没有跟随 = 孤票，不是主线 */}
                {t.followers && t.followers.length > 0 && (
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mt-0.5">
                    <span className="text-[10.5px] text-sub flex-none">跟随</span>
                    {t.followers.map((f) => (
                      <span key={f.name} className="text-[11.5px] text-txt">
                        {f.name}
                        <span className={cn('num ml-1', pctTone(f.pct))}>{fmtPct(f.pct)}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* 催化 —— 有 desc 才显示；空 desc 说明这条线是纯资金行为，无事件支撑 */}
                {t.desc && (
                  <div className="text-[11px] text-sub mt-0.5 line-clamp-1">催化：{t.desc}</div>
                )}

                {((t.positives?.length ?? 0) > 0 || (t.risks?.length ?? 0) > 0) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {(t.positives ?? []).map((p) => (
                      <span key={p} className="text-[11px] text-up">
                        ▲ {p}
                      </span>
                    ))}
                    {(t.risks ?? []).map((r) => (
                      <span key={r} className="text-[11px] text-down">
                        ▼ {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState text="暂无共振题材（盘面分散或无主线）" />
      )}
    </Card>
  )
}
