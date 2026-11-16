import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BoardLeaderDailyFile, BoardLeaderRow } from '@/shared/api'
import { analyticsQueries } from '@/features/analytics'
import { Card, CardBadge, EmptyState, Icon, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 连板日观察 —— 数据源 `cache/board_leader_daily/leader_<date>.json`
 * （`scripts/board_leader_daily.py` 盘后落一份）。
 *
 * ## 这一页回答的问题
 *
 * 「这条线现在是第几个连板日、龙一还是不是它、什么时候换的人、哪一天断的」
 * —— 这些**单日候选卡答不出来**：`candidates-<date>.json` 只记今天推谁，
 * `theme_series` 的日期轴是**当日 5 个盘中时点**（不是跨日），`board_core`
 * 是跨 20 日的历史核心票（不是当日身位）。
 *
 * 所以矩阵的读法是**竖着看一条线的一生**：
 *   同一行连成一条红 = 这条线一路晋级；中途换色 = 换人；突然变灰 = 熄火。
 *
 * ## 龙一口径（与选股同源）
 *
 * `wealth_code/core/sector_leader.py`：板数 → 封板时刻 ±5 分钟算同一档
 * → 封单/流通% → 带动家数 → 更早封板 → 代码稳定。
 * 所以「台账里的龙一」与「那天推的票」是同一个答案，⛔ 不是另算一套。
 *
 * ## ⚠️ `theme_source` 必须显式提示
 *
 * 题材快照 2026-10-18 才上线，之前的日子降级用**申万行业**分组（`sector_fallback`）。
 * 行业口径与题材口径不是同一把尺子（行业内 ≥2 家才算一条线，同一只票可能被归到
 * 不同「板块」），所以降级日的格子必须带标记 —— 横跨两种口径比板数是没有意义的。
 *
 * ## ⚠️ 空白的三种含义（与 HeatMatrix 同一铁律）
 *
 *   · 斜纹格  = **该日没有这一行的记录**（这条线当天没涨停 / 数据缺失）
 *   · 「灭」  = 昨天有、今天整条线零涨停（`change.kind === 'gone'`，真实熄火）
 *   · 数字格  = 当天有龙一，格子里的数字是它的连板数
 */

/** 格子背景：按板数分档（⛔ 穷举字面量，Tailwind 不认拼接类名） */
const BOARD_BG = [
  'bg-up/10',
  'bg-up/15',
  'bg-up/22',
  'bg-up/30',
  'bg-up/38',
  'bg-up/46',
  'bg-up/55',
  'bg-up/64',
  'bg-up/74',
  'bg-up/85',
] as const

function boardBg(boards: number): string {
  const i = Math.min(BOARD_BG.length - 1, Math.max(0, boards - 1))
  return BOARD_BG[i]
}

/** 短日期（矩阵列头用）：2026-10-27 → 10-27 */
function shortDate(d: string): string {
  return d.length >= 10 ? d.slice(5) : d
}

const CHANGE_LABEL: Record<string, string> = {
  same: '连续',
  switch: '换人',
  new: '新线',
  gone: '熄火',
}

interface Cell {
  row: BoardLeaderRow | null
  /** 该板块该日是否根本没有记录 */
  empty: boolean
}

export function Component() {
  const { data, isLoading, isError } = useQuery(analyticsQueries.boardLeaderDaily())
  const [openTheme, setOpenTheme] = useState<string | null>(null)
  const [days, setDays] = useState(12)

  /** 逐日文件按日期升序；`data.date` 是脚本写死的真值，file 名只作兜底 */
  const files = useMemo<BoardLeaderDailyFile[]>(() => {
    return (data ?? [])
      .map((d) => d.data)
      .filter((x): x is BoardLeaderDailyFile => !!x && !!x.date)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const cols = useMemo(() => files.slice(-days), [files, days])
  const latest = cols.length ? cols[cols.length - 1] : null

  /** 行 = 最新一日出现的全部板块线（含「今日熄火」），按当日家数降序 */
  const rowsData = useMemo(() => {
    if (!latest) return []
    return [...latest.boards].sort((a, b) => b.mates - a.mates)
  }, [latest])

  /** 板块 × 日期 → 格子 */
  const grid = useMemo(() => {
    const m = new Map<string, Cell[]>()
    for (const r of rowsData) {
      m.set(
        r.theme,
        cols.map((f) => {
          const hit = f.boards.find((b) => b.theme === r.theme)
          return hit ? { row: hit, empty: false } : { row: null, empty: true }
        }),
      )
    }
    return m
  }, [rowsData, cols])

  const selected = useMemo<BoardLeaderRow | null>(() => {
    if (!rowsData.length) return null
    return rowsData.find((r) => r.theme === openTheme) ?? rowsData[0]
  }, [rowsData, openTheme])

  const selectedSeries = useMemo(() => {
    if (!selected) return []
    return cols.map((f) => ({
      date: f.date,
      themeSource: f.theme_source,
      row: f.boards.find((b) => b.theme === selected.theme) ?? null,
    }))
  }, [selected, cols])

  const degradedDays = cols.filter((f) => f.degraded).length

  if (isError) {
    return <EmptyState text="连板日台账读不到" hint="先跑 python3 scripts/board_leader_daily.py build" />
  }
  if (isLoading) {
    return <EmptyState text="加载中" hint="正在读连板日台账…" />
  }
  if (!files.length) {
    return (
      <EmptyState
        text="还没有连板日台账"
        hint="盘后跑一次 scripts/board_leader_daily.py build（或 backfill --days 30 回填历史）"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部状态条 —— 一屏之内先回答「这是哪一天、多少家、最高几板、口径对不对」 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-card px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Icon name="stairs" size={14} className="text-lead" />
          <span className="text-13 font-semibold">连板日观察</span>
          <span className="text-sub text-12">每个板块每条线的逐日身位</span>
        </div>
        <div className="text-12 text-sub">
          最新 <b className="text-txt">{latest?.date}</b> ｜ 涨停{' '}
          <b className="text-txt">{latest?.zt_count}</b> 只 ｜ 最高{' '}
          <b className="text-up">{latest?.max_boards}</b> 板 ｜ 板块线{' '}
          <b className="text-txt">{rowsData.length}</b> 条
        </div>
        {latest?.theme_source !== 'snapshot' ? (
          <CardBadge tone="warn">
            {latest?.theme_source === 'sector_fallback' ? '行业口径（题材快照缺失）' : '无有效题材映射'}
          </CardBadge>
        ) : (
          <CardBadge>题材归类 · 和选股同一套</CardBadge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {[8, 12, 20].map((n) => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={cn(
                'rounded px-2 py-0.5 text-12 transition-colors',
                days === n ? 'bg-head-bg text-head-txt' : 'text-sub hover:bg-line-faint',
              )}
            >
              近 {n} 日
            </button>
          ))}
        </div>
      </div>

      <ZoneRow>
        <Zone label="连板日矩阵" dot="bg-up" className="xl:w-[68%]">
          <Card
            title="🐉 板块 × 交易日（格内 = 龙一 · 数字 = 连板数）"
            extra={<CardBadge>{cols.length} 个交易日</CardBadge>}
          >
            {degradedDays > 0 && (
              <p className="mb-2 text-12 leading-relaxed text-sub">
                窗口内 <b className="text-warn">{degradedDays}</b> 天的题材快照缺失、
                已降级为<b className="text-txt">申万行业</b>分组（列头标 <code className="text-11">行</code>）。
                行业分类和题材分类不是一把尺子，<b className="text-txt">跨着比板数没有意义</b>，
                只用于看「这条线有没有延续」。
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-12">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card px-2 py-1 text-left font-medium text-sub">
                      板块 / 家数
                    </th>
                    {cols.map((f) => (
                      <th key={f.date} className="px-1 py-1 text-center font-medium text-sub">
                        <div className="whitespace-nowrap">{shortDate(f.date)}</div>
                        {f.degraded && (
                          <div className="text-10 text-warn" title="题材快照缺失·已降级为行业分组">
                            行
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsData.map((r) => {
                    const cells = grid.get(r.theme) ?? []
                    const isSel = selected?.theme === r.theme
                    return (
                      <tr
                        key={r.theme}
                        onClick={() => setOpenTheme(r.theme)}
                        className={cn(
                          'cursor-pointer',
                          isSel ? 'bg-rec-soft/60' : 'hover:bg-line-faint/60',
                        )}
                      >
                        <td className="sticky left-0 z-10 max-w-[190px] truncate bg-inherit px-2 py-1">
                          <span className={cn('font-medium', r.mates > 0 ? 'text-txt' : 'text-sub')}>
                            {r.theme || '（未分类）'}
                          </span>
                          <span className="ml-1 text-11 text-sub">{r.mates}家</span>
                        </td>
                        {cells.map((c, i) => {
                          const b = c.row
                          const ch = b?.change?.kind ?? ''
                          const lead = b?.leader
                          if (c.empty || !b) {
                            return (
                              <td key={cols[i].date} className="px-0.5 py-0.5">
                                <div
                                  className="flex h-9 items-center justify-center rounded-sm text-11 text-sub/70"
                                  style={{
                                    backgroundImage:
                                      'repeating-linear-gradient(135deg, #f0f1f5 0 4px, #fafafa 4px 8px)',
                                  }}
                                  title={`${r.theme} · ${cols[i].date} 没有记录（当天这条线没涨停或数据缺失）`}
                                >
                                  ·
                                </div>
                              </td>
                            )
                          }
                          if (ch === 'gone' || !lead?.name) {
                            return (
                              <td key={cols[i].date} className="px-0.5 py-0.5">
                                <div
                                  className="flex h-9 items-center justify-center rounded-sm bg-line-faint text-11 text-sub"
                                  title={`${b.change?.note ?? '整条线零涨停'}`}
                                >
                                  灭
                                </div>
                              </td>
                            )
                          }
                          return (
                            <td key={cols[i].date} className="px-0.5 py-0.5">
                              <div
                                className={cn(
                                  'flex h-9 flex-col items-center justify-center rounded-sm leading-tight',
                                  boardBg(lead.boards),
                                  ch === 'switch' && 'ring-1 ring-inset ring-break',
                                )}
                                title={[
                                  `${r.theme} · ${cols[i].date}`,
                                  `龙一 ${lead.name}（${lead.boards} 板）`,
                                  lead.fbt ? `首封 ${lead.fbt.slice(0, 2)}:${lead.fbt.slice(2, 4)}` : '',
                                  lead.seal_ratio_pct != null ? `封单占流通 ${lead.seal_ratio_pct}%` : '封单数据缺失',
                                  CHANGE_LABEL[ch] ?? '',
                                  b.change?.note ?? '',
                                ]
                                  .filter(Boolean)
                                  .join(' ｜ ')}
                              >
                                <span className="max-w-[62px] truncate text-11 font-medium text-txt">
                                  {lead.name}
                                </span>
                                <span className="text-10 text-sub">
                                  {lead.boards}板{ch === 'switch' ? '·换' : ''}
                                </span>
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-12 leading-relaxed text-sub">
              竖着读一条线：
              <b className="text-txt">连成一片红</b>=一路晋级；
              <b className="text-break">琥珀描边</b>=当天换人（龙一易主）；
              <b className="text-txt">「灭」</b>=昨天还在、今天整条线零涨停；
              <b className="text-txt">斜纹 ·</b>=当天没有记录（≠ 零涨停）。
              数字是当天龙一的连板数，颜色深浅按板数分档。
            </p>
          </Card>
        </Zone>

        <Zone label="逐日明细" dot="bg-lead" className="xl:w-[32%]">
          <Card
            title={selected ? `🐉 ${selected.theme || '未分类'}` : '🐉 选一条线'}
            extra={<CardBadge>{selected?.mates ?? 0} 家</CardBadge>}
          >
            {!selected ? (
              <EmptyState text="点左侧选一条线" hint="点矩阵任意一行" />
            ) : (
              <ol className="flex flex-col gap-1.5">
                {selectedSeries.map(({ date, row, themeSource }) => {
                  const ch = row?.change?.kind ?? ''
                  const lead = row?.leader
                  if (!row || !lead?.name) {
                    return (
                      <li
                        key={date}
                        className="flex items-center justify-between rounded border border-dashed border-line px-2 py-1 text-12 text-sub"
                      >
                        <span>{date}</span>
                        <span>{ch === 'gone' ? '整条线熄火' : '无记录'}</span>
                      </li>
                    )
                  }
                  return (
                    <li
                      key={date}
                      className={cn(
                        'flex items-center justify-between rounded px-2 py-1 text-12',
                        ch === 'switch' ? 'bg-break-soft' : 'bg-line-faint',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sub">{date}</span>
                        <StockLink code={lead.code}>{lead.name}</StockLink>
                        <span className="font-medium text-up">{lead.boards}板</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-11 text-sub">
                        {lead.seal_ratio_pct != null && <span>封{lead.seal_ratio_pct}%</span>}
                        <span className={cn(ch === 'switch' && 'text-break')}>
                          {CHANGE_LABEL[ch] ?? ''}
                        </span>
                        {themeSource !== 'snapshot' && <span title="行业口径">行</span>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            {selected?.change?.prev && (
              <p className="mt-2 border-t border-line pt-2 text-12 leading-relaxed text-sub">
                上一个交易日龙一：<b className="text-txt">{selected.change.prev.name}</b>（
                {selected.change.prev.boards} 板）
                {selected.change.kind === 'switch' ? (
                  selected.change.prev_today ? (
                    <>今天仍在涨停池（{selected.change.prev_today.boards} 板）—— <b className="text-break">换人但没断</b></>
                  ) : (
                    <>今天已断板 —— <b className="text-down">这条线在换挡</b></>
                  )
                ) : (
                  <>同一只延续中</>
                )}
              </p>
            )}
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
