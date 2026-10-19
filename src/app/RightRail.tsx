import { useQuery } from '@tanstack/react-query'
import { marketQueries } from '@/features/market'
import { Card, StockLink } from '@/shared/ui'
import { fmtPct, isStarMarket, upcls } from '@/shared/lib'
import type { Leader, HotSpot } from '@/shared/api'

/**
 * 右侧辅助 rail —— 仅在 ≥3xl（1920px 有效宽度）显示。
 *
 * 用途：填满 4K / 宽屏下的右侧边缘，提供「自选 / 异动 / 快讯」三类
 * 高频但不挤占主工作区的实时信息。
 */

export function RightRail() {
  const { data } = useQuery(marketQueries.latest())

  return (
    <aside
      className="max-3xl:hidden 3xl:flex flex-col w-[var(--rail-width)] 4xl:w-[var(--rail-width-4xl)] flex-none border-l border-line bg-card overflow-y-auto"
      aria-label="辅助信息"
    >
      <div className="flex-none h-[var(--header-height)] flex items-center px-3 border-b border-line bg-head-bg 3xl:bg-card">
        <span className="text-[12px] font-semibold tracking-[0.1em] text-sub 3xl:text-txt uppercase">
          实时速览
        </span>
      </div>

      <div className="flex-1 p-3 space-y-3 min-h-0">
        <Watchlist leaders={data?.leaders ?? []} />
        <HotSpots spots={data?.hot_spots} />
        <Newsflash items={data?.newsflash ?? []} />
      </div>
    </aside>
  )
}

/** 自选候选：从 leaders 中可买且非科创板取前 5。 */
function Watchlist({ leaders }: { leaders: Leader[] }) {
  const picks = leaders
    .filter((l) => l.buyable && !isStarMarket(l.code))
    .slice(0, 5)

  return (
    <Card title="自选候选" extra={<span className="txt-sub">可买</span>}>
      {picks.length === 0 ? (
        <EmptyRow />
      ) : (
        <ul className="space-y-1">
          {picks.map((l) => (
            <li
              key={l.code}
              className="flex items-center justify-between gap-2 py-1 border-b border-line-faint last:border-0"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] text-sub truncate">{l.sector}</span>
                <span className="text-[13px] text-txt truncate">{l.name}</span>
                {l.is_20cm && (
                  <span className="badge bg-rec-soft text-rec">20cm</span>
                )}
              </div>
              <span className={`num text-[13px] font-medium ${upTone(l.pct)}`}>
                {fmtPct(l.pct)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** 异动板块：来自 latest.hot_spots（结构 {sector, stocks[]}）。 */
function HotSpots({ spots }: { spots?: HotSpot[] }) {
  const list = (spots ?? []).slice(0, 5)
  return (
    <Card title="盘中异动" extra={<span className="txt-sub">题材</span>}>
      {list.length === 0 ? (
        <EmptyRow>暂无异动题材</EmptyRow>
      ) : (
        <ul className="space-y-2.5">
          {list.map((s) => {
            const stocks = (s.stocks ?? [])
              .filter((st) => !isStarMarket(st.code))
              .slice(0, 5)
            return (
              <li key={s.sector} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-txt">{s.sector}</span>
                  <span className="badge bg-up-soft text-up">{stocks.length} 只</span>
                </div>
                {stocks.length === 0 ? (
                  <div className="text-[12px] text-sub">—</div>
                ) : (
                  <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                    {stocks.map((st) => (
                      <span key={st.code} className="text-[12px] text-sub">
                        <StockLink code={st.code}>{st.name}</StockLink>
                        <span className={`num ${upTone(st.pct)} ml-0.5`}>
                          {fmtPct(st.pct)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** 快讯：来自 latest.newsflash。 */
function Newsflash({ items }: { items: { title: string; plates?: string[] }[] }) {
  return (
    <Card title="快讯" extra={<span className="txt-sub">实时</span>}>
      {items.length === 0 ? (
        <EmptyRow>暂无新快讯</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 5).map((n) => (
            <li
              key={n.title}
              className="text-[12px] leading-relaxed text-txt border-b border-line-faint last:border-0 pb-1.5 last:pb-0"
            >
              {n.title}
              {n.plates && n.plates.length > 0 && (
                <span className="ml-1.5 text-sub">[{n.plates.join(' · ')}]</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function EmptyRow({ children }: { children?: React.ReactNode }) {
  return (
    <div className="py-3 text-center text-[12px] text-sub">{children ?? '暂无数据'}</div>
  )
}

function upTone(pct: number): string {
  const cls = upcls(pct)
  if (cls === 'up') return 'text-up'
  if (cls === 'down') return 'text-down'
  return 'text-sub'
}
