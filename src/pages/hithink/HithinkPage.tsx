import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type {
  DatedFile,
  HithinkAnomalyFile,
  HithinkAuctionFile,
  HithinkLadderFile,
  HithinkValuationFile,
  HithinkZtDiffFile,
  HithinkZtFile,
} from '@/shared/api'
import { analyticsQueries, DataTable, StatPair, Tag, n1 } from '@/features/analytics'
import { Card, CardBadge, EmptyState, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, staleLabel } from '@/shared/lib'

/**
 * 同花顺专业数据 —— 盘前/盘后**第二权威** + 数据质量证据。
 *
 * ## 为什么单开一页（而不是塞进现有页面）
 *
 * 同花顺（`scripts/hithink_fetch.py`）产出的 6 类数据服务的是**交叉校验**这个职责：
 *
 *   · `zt`       涨停池（含**涨停原因**原文 —— 必盈口径没有这一列）
 *   · `zt-diff`  同花顺 vs 必盈的**逐票差异**（数据质量证据，不是结论）
 *   · `ladder`   连板天梯 30 日（仅 2 板以上 · 作板数校验与窗口外兜底）
 *   · `auction`  竞价风向标
 *   · `anomaly`  异动原因（AI 生成的逐票说明，250KB+，只取最新一期）
 *   · `valuation` 估值（code → pe/pb/ps/pcf）
 *
 * 它既不属于「盘中实时」（盘后才全量刷新），也不属于任何单一题材页，故独立成页。
 *
 * ## ⚠️ 两处类型与真实数据不符（2026-09-16 读真实文件后修正）
 *
 *   1. `valuation` 真实结构是 **`values`（code → 估值对象）**，不是 `items` 数组；
 *      按 items 渲染会**静默读空**。
 *   2. `zt-diff` 的 `only_biying` / `only_hithink` 是**代码字符串数组**，非对象数组。
 *
 * 这类「类型与数据反向」的错误编译期查不出来，只能靠读真实落盘文件发现。
 */

export async function loader() {
  // 单路失败不拖垮整页（与 /timeline 同口径）
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.hithinkZt()),
    queryClient.ensureQueryData(analyticsQueries.hithinkLadder()),
    queryClient.ensureQueryData(analyticsQueries.hithinkZtDiff()),
  ])
  return null
}

/** 目录型路由（`DatedFile<T>[]`）取**最新且有内容**的一期 */
function latestOf<T>(files: DatedFile<T>[] | undefined): T | null {
  if (!files?.length) return null
  const sorted = [...files].sort((a, b) => b.file.localeCompare(a.file))
  for (const f of sorted) if (f.data) return f.data
  return null
}

/** 天梯档位键 → 中文标签（实测键名：two_board…seven_over） */
const BOARD_TIERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'two_board', label: '2 板' },
  { key: 'three_board', label: '3 板' },
  { key: 'four_board', label: '4 板' },
  { key: 'five_board', label: '5 板' },
  { key: 'six_board', label: '6 板' },
  { key: 'seven_over', label: '7 板+' },
]

/** 异动标签 → 语义色（A 股：涨红跌绿） */
const ANOMALY_TONE: Record<string, 'up' | 'down'> = {
  涨停: 'up',
  大涨: 'up',
  跌停: 'down',
  大跌: 'down',
}

export function Component() {
  const zt = useQuery(analyticsQueries.hithinkZt())
  const ladder = useQuery(analyticsQueries.hithinkLadder())
  const diff = useQuery(analyticsQueries.hithinkZtDiff())
  const auction = useQuery(analyticsQueries.hithinkAuction())
  const anomaly = useQuery(analyticsQueries.hithinkAnomaly())
  const valuation = useQuery(analyticsQueries.hithinkValuation())

  const ztData = latestOf<HithinkZtFile>(zt.data)
  const diffData = latestOf<HithinkZtDiffFile>(diff.data)
  const auctionData = latestOf<HithinkAuctionFile>(auction.data)
  const ladderData: HithinkLadderFile | undefined = ladder.data
  const ladderLatest = ladderData?.items?.[0]
  const anomalyData: HithinkAnomalyFile | undefined = anomaly.data
  const valData: HithinkValuationFile | undefined = valuation.data

  /** 估值只有代码没有名称 —— 用涨停池建立 code → name 映射补齐 */
  const nameByCode = new Map((ztData?.items ?? []).map((i) => [i.code, i.name]))
  const agreeRate =
    diffData && diffData.biying_count > 0 ? (diffData.both / diffData.biying_count) * 100 : null
  const diffCount = diffData
    ? diffData.only_biying.length + diffData.only_hithink.length
    : null

  return (
    <div className="flex flex-col gap-3">
      {/* 总览通栏：这一页的存在理由 = 交叉校验，故「一致率」是首要指标 */}
      <Card
        title="📊 同花顺专业数据"
        extra={
          <CardBadge>{ztData?.date ?? diffData?.date ?? '—'} · 盘前/盘后第二权威</CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <StatPair label="涨停（同花顺）" value={ztData?.zt_count ?? '—'} tone="up" />
          <StatPair label="抓取总数" value={ztData?.total ?? '—'} />
          <StatPair label="剔除科创板" value={ztData?.excluded_688 ?? '—'} tone="sub" />
          <StatPair label="剔除 ST" value={ztData?.excluded_st ?? '—'} tone="sub" />
          <StatPair
            label="双源一致"
            value={diffData ? `${diffData.both}/${diffData.biying_count}` : '—'}
            tone="up"
          />
          <StatPair
            label="一致率"
            value={agreeRate != null ? `${n1(agreeRate)}%` : '—'}
            tone={agreeRate != null && agreeRate < 95 ? 'warn' : 'sub'}
          />
          <StatPair
            label="天梯窗口"
            value={ladderData?.window?.length ? `${ladderData.window.length} 日` : '—'}
          />
          <StatPair label="异动条数" value={anomalyData?.filtered ?? '—'} />
        </div>
        <p className="text-sub text-12 leading-relaxed mt-2">
          涨停池以必盈为权威、同花顺做交叉校验 —— 两者差异本身就是**数据质量证据**，
          而不是待修正的错误（下方「双源校验」逐票列出）。
        </p>
      </Card>

      <ZoneRow>
        <Zone label="涨停池 · 含涨停原因" dot="bg-up" className="xl:w-[62%]">
          <Card
            title="同花顺涨停池"
            extra={<CardBadge>{(ztData?.items ?? []).length} 家</CardBadge>}
          >
            {ztData?.items?.length ? (
              <DataTable
                rows={ztData.items}
                rowKey={(r) => r.code}
                dense
                empty="无涨停"
                columns={[
                  {
                    label: '标的',
                    cell: (r) => (
                      <span>
                        <StockLink code={r.code} className="text-up">{r.name}</StockLink>
                      </span>
                    ),
                  },
                  {
                    label: '板数',
                    num: true,
                    cell: (r) =>
                      r.boards ? <span className="text-up font-semibold">{r.boards}</span> : '—',
                  },
                  { label: '首封', cell: (r) => <span className="num text-sub">{r.fbt || '—'}</span> },
                  { label: '封单(亿)', num: true, cell: (r) => n1(r.seal_yi) },
                  {
                    label: '涨幅',
                    num: true,
                    cell: (r) => <span className="text-up">{n1(r.pct)}%</span>,
                  },
                  {
                    label: '涨停原因',
                    className: 'whitespace-normal min-w-[240px]',
                    cell: (r) => (
                      <span className="text-sub text-12">{r.reason || '—'}</span>
                    ),
                  },
                ]}
              />
            ) : (
              <EmptyState text="涨停池未生成" hint="cache/hithink_zt_*.json 缺失" />
            )}
          </Card>
        </Zone>

        <Zone label="竞价 · 双源 · 估值" dot="bg-lead" className="xl:w-[38%]">
          <Card
            title="竞价风向标"
            extra={<CardBadge>{auctionData?.benchmark?.length ?? 0} 只</CardBadge>}
          >
            {auctionData?.benchmark?.length ? (
              <ul className="space-y-1">
                {auctionData.benchmark.map((b) => (
                  <li
                    key={b.thscode}
                    className="flex items-center justify-between gap-2 py-1 border-b border-line-faint last:border-0"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-13 text-txt truncate">{b.name}</span>
                      {(b.tags ?? []).slice(0, 2).map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </span>
                    <span
                      className={cn(
                        'num text-13 font-medium',
                        b.auction_pct > 0
                          ? 'text-up'
                          : b.auction_pct < 0
                            ? 'text-down'
                            : 'text-sub',
                      )}
                    >
                      {b.auction_pct > 0 ? '+' : ''}
                      {n1(b.auction_pct)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="竞价风向标未生成" />
            )}
          </Card>

          <Card
            title="涨停池双源校验"
            extra={
              <CardBadge tone={diffCount ? 'warn' : 'up'}>
                {diffCount != null ? `${diffCount} 处差异` : '—'}
              </CardBadge>
            }
          >
            {diffData ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <StatPair label="必盈" value={diffData.biying_count} />
                  <StatPair label="同花顺" value={diffData.hithink_count} />
                  <StatPair label="一致" value={diffData.both} tone="up" />
                </div>
                {diffData.only_biying.length > 0 && (
                  <div className="text-12 text-sub">
                    仅必盈有：
                    <span className="num text-warn">{diffData.only_biying.join(' · ')}</span>
                  </div>
                )}
                {diffData.only_hithink.length > 0 && (
                  <div className="text-12 text-sub">
                    仅同花顺有：
                    <span className="num text-warn">{diffData.only_hithink.join(' · ')}</span>
                  </div>
                )}
                {diffCount === 0 && <div className="text-12 text-sub">两源完全一致</div>}
              </div>
            ) : (
              <EmptyState text="双源校验未生成" hint="hithink_fetch.py limitup --check 未跑" />
            )}
          </Card>

          <Card
            title="估值"
            extra={
              valData ? (
                <span className="flex items-center gap-1.5">
                  <CardBadge>{valData.date} · {valData.got} 只</CardBadge>
                  {staleLabel(valData.date, 3) && (
                    <span className="badge bg-warn-soft text-warn">{staleLabel(valData.date, 3)}</span>
                  )}
                </span>
              ) : (
                <CardBadge>—</CardBadge>
              )
            }
          >
            {valData && Object.keys(valData.values ?? {}).length ? (
              <DataTable
                rows={Object.entries(valData.values).map(([code, v]) => ({ code, ...v }))}
                rowKey={(r) => r.code}
                dense
                empty="无估值"
                columns={[
                  {
                    label: '标的',
                    cell: (r) => (
                      <span>
                        <StockLink code={r.code} className="text-txt">{nameByCode.get(r.code) ?? r.code}</StockLink>
                      </span>
                    ),
                  },
                  { label: 'PE', num: true, cell: (r) => (r.pe != null ? n1(r.pe) : '—') },
                  { label: 'PB', num: true, cell: (r) => (r.pb != null ? n1(r.pb) : '—') },
                  { label: 'PS', num: true, cell: (r) => (r.ps != null ? n1(r.ps) : '—') },
                ]}
              />
            ) : (
              <EmptyState text="估值未生成" hint="hithink_fetch.py valuation 未跑" />
            )}
          </Card>
        </Zone>
      </ZoneRow>

      <ZoneRow>
        <Zone label="连板天梯" dot="bg-mid" className="xl:w-[46%]">
          <Card
            title="连板天梯 · 最新一日"
            extra={<CardBadge>{ladderLatest?.date ?? '—'}</CardBadge>}
          >
            {ladderLatest ? (
              <div className="space-y-2">
                {BOARD_TIERS.map((t) => {
                  const list = ladderLatest.boards?.[t.key] ?? []
                  if (!list.length) return null
                  return (
                    <div key={t.key} className="flex items-start gap-2">
                      <span className="badge bg-up-soft text-up flex-none mt-0.5">{t.label}</span>
                      <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-13 text-txt">
                        {list.map((s) => (
                          <span key={s.ticker}>{s.name}</span>
                        ))}
                      </span>
                    </div>
                  )
                })}
                {BOARD_TIERS.every((t) => !(ladderLatest.boards?.[t.key] ?? []).length) && (
                  <EmptyState text="该日无 2 板以上标的" />
                )}
              </div>
            ) : (
              <EmptyState text="天梯未生成" hint="cache/hithink_ladder.json 缺失" />
            )}
            <p className="text-sub text-11 leading-relaxed mt-2">
              天梯仅收 2 板以上（无首板），用途是**板数校验**与 12 日窗口外补充，不作涨停池主源。
            </p>
          </Card>
        </Zone>

        <Zone label="异动原因" dot="bg-warn" className="xl:w-[54%]">
          <Card
            title="异动原因 · 最新一期"
            extra={<CardBadge>{anomalyData?.date ?? '—'}</CardBadge>}
          >
            {anomalyData?.stats && (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
                {Object.entries(anomalyData.stats).map(([k, v]) => (
                  <StatPair key={k} label={k} value={v} tone={ANOMALY_TONE[k] ?? 'sub'} />
                ))}
              </div>
            )}
            {anomalyData?.items?.length ? (
              <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {anomalyData.items.slice(0, 40).map((it) => (
                  <li
                    key={`${it.code}-${it.tag}`}
                    className="border-b border-line-faint last:border-0 pb-1.5 last:pb-0"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Tag tone={ANOMALY_TONE[it.tag] ?? 'neutral'}>{it.tag}</Tag>
                      <StockLink code={it.code} className="text-13 text-txt font-medium">{it.name || it.code}</StockLink>
                    </div>
                    <p className="text-sub text-12 leading-relaxed">{it.content}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="异动原因未生成" hint="hithink_fetch.py anomaly 未跑" />
            )}
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
