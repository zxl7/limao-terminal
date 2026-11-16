import { useMemo, useState } from 'react'
import type { ScreenFile, ScreenStock } from '@/shared/api'
import { cn } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
import { boardsText, num, VERDICT_META } from '../lib/format'

/**
 * 全量过筛漏斗 —— 回答「48 只涨停，为什么只剩这几只」。
 *
 * ⛔ 这是**逐票台账**，不是黑名单：被排除的票次日会重新过筛。
 * ⛔ 拒因做归一化聚合（脚本按原文逐条记，如「换手板成交额 2.54亿」×N），
 *    不归一化会得到几十条形同质条目，看不住重点。
 */

/** 把脚本的原文拒因归成可统计的类别 */
function rejectKind(reason: string): string {
  if (reason.includes('换手板成交额')) return '换手板量能不足'
  if (reason.includes('未成线') || reason.includes('同题材仅')) return '未成线（独苗或题材太散）'
  if (reason.includes('身位差')) return '身位后排'
  if (reason.includes('封板弱')) return '封板偏弱'
  if (reason.includes('股性')) return '股性难连板'
  if (reason.includes('ST') || reason.includes('688')) return '硬性排除'
  return '其他'
}

export function ScreenFunnel({ screen }: { screen?: ScreenFile }) {
  const [openGroup, setOpenGroup] = useState<'pass' | 'watch_only' | 'reject' | null>(null)

  const agg = useMemo(() => {
    const m = new Map<string, number>()
    for (const [k, v] of Object.entries(screen?.reject_reasons ?? {})) {
      const kind = rejectKind(k)
      m.set(kind, (m.get(kind) ?? 0) + Number(v || 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [screen])

  if (!screen) {
    return (
      <div className="text-12 text-sub leading-relaxed">
        全量过筛未启用或未生成。
        <div className="mt-0.5 text-11">开启后每日盘后写 cache/daily_screen/</div>
      </div>
    )
  }

  const total = screen.zt_count || screen.screened.length
  const { pass, watch_only: watchOnly, reject } = screen.counts
  const pctOf = (n: number) => (total ? (n / total) * 100 : 0)

  // ⛔ 计数一律取 `counts`（脚本权威口径），不数 `screened`：
  //    screened 是明细列表，未来若被截断（limit）会把「排除 45」显示成「排除 1」。
  const groups: { key: 'pass' | 'watch_only' | 'reject'; n: number; rows: ScreenStock[] }[] = [
    { key: 'pass', n: pass, rows: screen.screened.filter((s) => s.verdict === 'pass') },
    { key: 'watch_only', n: watchOnly, rows: screen.screened.filter((s) => s.verdict === 'watch_only') },
    { key: 'reject', n: reject, rows: screen.screened.filter((s) => s.verdict === 'reject') },
  ]

  return (
    <div className="flex flex-col gap-2">
      {/* 漏斗条 */}
      <div className="flex h-2 w-full overflow-hidden rounded-sm">
        <div className="bg-up" style={{ width: `${pctOf(pass)}%` }} title={`通过 ${pass}`} />
        <div className="bg-rec" style={{ width: `${pctOf(watchOnly)}%` }} title={`只能看 ${watchOnly}`} />
        <div className="bg-line" style={{ width: `${pctOf(reject)}%` }} title={`排除 ${reject}`} />
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-12">
        <span className="text-sub">
          全量涨停 <span className="num font-semibold text-txt">{total}</span> 只
        </span>
        {groups.map((g) => {
          const meta = VERDICT_META[g.key]
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setOpenGroup(openGroup === g.key ? null : g.key)}
              className={cn(
                'flex items-baseline gap-1 rounded-sm border px-1.5 py-0.5 transition-colors',
                openGroup === g.key ? 'border-txt' : 'border-line',
                meta.tone === 'up'
                  ? 'text-up'
                  : meta.tone === 'rec'
                    ? 'text-rec'
                    : meta.tone === 'warn'
                      ? 'text-warn'
                      : 'text-sub',
              )}
              title={meta.hint}
            >
              {meta.label}
              <span className="num font-semibold">{g.n}</span>
            </button>
          )
        })}
      </div>

      {/* 拒因分布 */}
      {agg.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-11 text-sub">被排除的原因</div>
          {agg.slice(0, 6).map(([kind, n]) => (
            <div key={kind} className="flex items-center gap-1.5">
              <span className="w-[132px] flex-none truncate text-11 text-txt" title={kind}>
                {kind}
              </span>
              <div className="h-1.5 flex-1 rounded-sm bg-line">
                <div
                  className="h-full rounded-sm bg-down"
                  style={{ width: `${(n / Math.max(1, agg[0][1])) * 100}%` }}
                />
              </div>
              <span className="num w-6 flex-none text-right text-11 text-sub">{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* 逐票明细（点分组展开） */}
      {openGroup && (
        <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto border-t border-line pt-1.5">
          {groups.find((g) => g.key === openGroup)!.rows.length === 0 && (
            <div className="text-11 text-sub">
              共 {groups.find((g) => g.key === openGroup)!.n} 只，明细未随档案保存
            </div>
          )}
          {groups
            .find((g) => g.key === openGroup)!
            .rows.sort((a, b) => b.boards - a.boards || b.priority - a.priority)
            .map((s) => (
              <div key={s.code} className="flex items-baseline gap-1.5 text-11 leading-snug">
                <StockLink code={s.code} className="flex-none text-txt">
                  {s.name}
                </StockLink>
                <span className="num flex-none text-up">{boardsText(s.boards)}</span>
                <span className="flex-none text-sub">{s.theme}</span>
                <span className="truncate text-sub" title={[...s.rejects, ...s.watch_reasons].join('；')}>
                  {[...s.rejects, ...s.watch_reasons, ...s.supports].slice(0, 2).join('；') || '—'}
                </span>
              </div>
            ))}
        </div>
      )}

      <div className="text-11 text-sub">
        最高板 <span className="num text-txt">{num(screen.market_max_boards, 0)}</span> · 主看 ≥2 板
      </div>
    </div>
  )
}
