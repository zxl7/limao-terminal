import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { DecisionDossier, DecisionManifest, ZtPoolSnapshot } from '@/shared/api'
import {
  analyticsQueries,
  DataTable,
  DossierView,
  SegTabs,
  StatPair,
  Tag,
  fileDate,
  n1,
  pct,
} from '@/features/analytics'
import { Card, CardBadge, EmptyState, StockLink, Zone, ZoneRow } from '@/shared/ui'
import { cn, roleText, tradableStocks } from '@/shared/lib'

/**
 * 决策存档（黑匣子）—— 数据源 `cache/decision_log/<日期>/` + `wealth_code/cache/candidates-<日期>.json`。
 *
 * ## 黑匣子的意义：让「当时可用的信息」可回溯
 *
 * 复盘时最容易犯的错是**用今天的信息评判当时的决策**。原系统因此在决策
 * 时点把全部输入冻结存档（`manifest` 记录每个来源的 sha256 与字节数），
 * 这样任何一次决策都能回答：「在**当时**掌握的信息下，这个选择是否合理」。
 *
 * 四个存档件各管一件事：
 *   · `manifest.json`   —— 存档清单 + **缺口**（该日缺了哪些来源）。缺口本身
 *     就是结论：来源缺失的日子，决策质量天然受限，复盘时必须打折看待。
 *   · `candidates.json` —— **每日决策档案**（`wealth_code_candidates_v1`）：
 *     情绪环境 + 真实盘面 + 接力池 + 观察池 + 早鸟埋伏 + 诊断计数 + 全局旁白。
 *     ⚠️ 它**不是**「候选池」—— 文件名里的 candidates 指的是候选**决策**，
 *     结构里没有 `candidates` 数组。此处曾误绑成候选池类型，页面会静默读空。
 *   · `zt_pool.json`    —— 决策时点的涨停池明细（含**全量** `zt_list`，
 *     这是 `yesterday_zt.json` 不具备的 —— 后者只有天梯没有明细）。
 *   · `auction_quotes`  —— 竞价报价存档（判定「能否买到」的原始依据）。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.decisionManifest())
  await queryClient.ensureQueryData(analyticsQueries.decisionCandidates())
  await queryClient.ensureQueryData(analyticsQueries.decisionZtPool())
  await queryClient.ensureQueryData(analyticsQueries.decisionArchive())
  return null
}

export function Component() {
  const manifest = useQuery(analyticsQueries.decisionManifest())
  const cands = useQuery(analyticsQueries.decisionCandidates())
  const ztPool = useQuery(analyticsQueries.decisionZtPool())
  const auction = useQuery(analyticsQueries.decisionAuctionHistory())
  /**
   * 黑匣子**原件**（`cache/decision_log/<日期>/candidates.json`）。
   *
   * ⚠️ 与 `decisionCandidates`（`wealth_code/cache/candidates-<日期>.json`）**不是重复**：
   *    两者是同 schema 的两份落盘 —— 前者是 `archive_decision.py` 在决策时点
   *    **冻结的副本**（与 manifest 记录的 sha256 对应），后者是选股脚本当天写出的原卷。
   *    对不上就说明「归档之后原卷被改过」，这正是黑匣子要能发现的事。
   */
  const frozen = useQuery(analyticsQueries.decisionArchive())
  const [tab, setTab] = useState<'manifest' | 'candidates' | 'frozen' | 'zt' | 'auction'>(
    'manifest',
  )
  /** 候选/竞价/原件三路的期次选择各自独立 —— 归档日期不一定重合；默认取最新一期 */
  const [candFile, setCandFile] = useState('')
  const [auctionFile, setAuctionFile] = useState('')
  const [frozenFile, setFrozenFile] = useState('')

  const m: DecisionManifest | undefined = manifest.data

  const candFiles = useMemo(
    () =>
      (cands.data ?? []).filter((f) => !!f.data).sort((a, b) => b.file.localeCompare(a.file)),
    [cands.data],
  )
  const activeCand =
    (candFiles.find((f) => f.file === candFile)?.data as DecisionDossier | undefined) ??
    (candFiles[0]?.data as DecisionDossier | undefined)

  const pool: ZtPoolSnapshot | undefined = ztPool.data

  const auctionFiles = useMemo(
    () => (auction.data ?? []).filter((f) => !!f.data).sort((a, b) => b.file.localeCompare(a.file)),
    [auction.data],
  )
  const activeAuction = auctionFiles.find((f) => f.file === auctionFile) ?? auctionFiles[0]

  /** 黑匣子原件期次（`decision_log/<日期>/candidates.json`） */
  const frozenFiles = useMemo(
    () => (frozen.data ?? []).filter((f) => !!f.data).sort((a, b) => b.file.localeCompare(a.file)),
    [frozen.data],
  )
  const activeFrozen =
    (frozenFiles.find((f) => f.file === frozenFile)?.data as DecisionDossier | undefined) ??
    (frozenFiles[0]?.data as DecisionDossier | undefined)

  /** 竞价报价的条目展开（quotes 是 code → 涨幅 的映射） */
  const auctionQuotes = useMemo(() => {
    const q = (activeAuction?.data as { quotes?: Record<string, number | null>; ts?: string } | undefined)?.quotes
    if (!q) return []
    return Object.entries(q)
      .map(([code, pctv]) => ({ code, pct: pctv }))
      .sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity))
  }, [activeAuction])

  /** 板数降序的涨停池明细（本页取的是 decision_log 的 zt_pool，含全量 zt_list） */
  const ztList = useMemo(
    () => [...(pool?.zt_list ?? [])].sort((a, b) => b.boards - a.boards || (a.fbt || '').localeCompare(b.fbt || '')),
    [pool],
  )
  /** 涨停池里的科创板（688/689）家数 —— 用户无权限，展示时剔除但把数量说清楚 */
  const starCount = useMemo(() => ztList.length - tradableStocks(ztList).length, [ztList])

  const gaps = m?.gaps ?? []

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🗃️ 决策黑匣子"
        extra={
          <CardBadge tone={gaps.length ? 'warn' : 'up'}>
            {gaps.length ? `存档缺口 ${gaps.length}` : '存档完整'}
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="存档日期" value={m?.date ?? '—'} />
          <StatPair label="schema" value={m?.schema ?? '—'} />
          <StatPair label="来源件数" value={m?.sources?.length ?? '—'} />
          <StatPair label="缺口" value={gaps.length} tone={gaps.length ? 'down' : 'sub'} />
          <StatPair label="候选归档" value={candFiles.length} />
          <StatPair label="竞价归档" value={auctionFiles.length} />
          <StatPair label="存档时间" value={m?.archived_at?.slice(0, 19).replace('T', ' ') ?? '—'} />
        </div>
        <p className="text-sub text-12 leading-relaxed">
          黑匣子的意义：把决策**当时**的输入冻结，避免复盘时用今天的信息评判当时的决策。
          存档缺口本身就是结论 —— 来源缺失的日子，决策质量天然受限，复盘需打折看待。
        </p>
      </Card>

      {/* 辅助区 = 存档缺口（警示清单，窄栏即可）；主工作区 = 存档明细（多 tab 档案，占最大面积）。
          ⛔ 旧版纵向平铺：缺口卡独占一整行，明细表又被压到下方。 */}
      <ZoneRow>
        <Zone label="存档缺口" dot="bg-warn" className="xl:w-[32%]">
          {gaps.length > 0 && (
            <Card title="存档缺口（该日缺失的来源）" extra={<CardBadge tone="warn">{gaps.length}</CardBadge>}>
          <ul className="text-13 leading-relaxed text-warn">
            {gaps.map((g, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
              <li key={i}>
                {typeof g === 'string' ? g : JSON.stringify(g)}
              </li>
            ))}
          </ul>
        </Card>
      )}
        </Zone>

        <Zone label="存档明细" dot="bg-lead" className="xl:w-[68%]">
          <Card
            title="存档明细"
        extra={
          <SegTabs
            items={[
              { key: 'manifest', label: `来源清单 (${m?.sources?.length ?? 0})` },
              { key: 'candidates', label: `候选 (${candFiles.length})` },
              { key: 'frozen', label: `黑匣子原件 (${frozenFiles.length})` },
              { key: 'zt', label: `涨停池 (${ztList.length || (pool?.zt_count ?? 0)})` },
              { key: 'auction', label: `竞价 (${auctionFiles.length})` },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'manifest' && (
          <DataTable
            rows={m?.sources ?? []}
            rowKey={(s) => s.dst || s.src}
            dense
            empty="无来源清单"
            columns={[
              { label: '角色', cell: (s) => <Tag tone="up">{roleText(s.role)}</Tag> },
              { label: '源路径', cell: (s) => <span className="num text-12">{s.src || '—'}</span> },
              { label: '存档路径', cell: (s) => <span className="num text-12 text-sub">{s.dst || '—'}</span> },
              {
                label: '体积',
                num: true,
                cell: (s) => <span className="text-sub">{fmtSize(s.bytes)}</span>,
              },
              {
                label: 'sha256',
                cell: (s) => (
                  <span className="num text-11 text-sub" title={s.sha256}>
                    {s.sha256?.slice(0, 12) ?? '—'}…
                  </span>
                ),
              },
            ]}
          />
        )}

        {tab === 'candidates' && (
          <>
            {candFiles.length > 1 && (
              <div className="mb-2">
                <select
                  value={candFiles.find((f) => f.data === activeCand)?.file ?? ''}
                  onChange={(e) => setCandFile(e.target.value)}
                  className="text-12 px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
                >
                  {candFiles.map((f) => (
                    <option key={f.file} value={f.file}>
                      {fileDate(f.file)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {activeCand ? (
              <DossierView d={activeCand} />
            ) : (
              <EmptyState
                text="无决策档案"
                hint="wealth_code/cache/candidates-<日期>.json 缺失"
              />
            )}
          </>
        )}

        {tab === 'frozen' && (
          <>
            {frozenFiles.length > 1 && (
              <div className="mb-2">
                <select
                  value={frozenFiles.find((f) => f.data === activeFrozen)?.file ?? ''}
                  onChange={(e) => setFrozenFile(e.target.value)}
                  className="text-12 px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
                >
                  {frozenFiles.map((f) => (
                    <option key={f.file} value={f.file}>
                      {fileDate(f.file)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {activeFrozen ? (
              <>
                <div className="text-sub text-12 mb-2 leading-relaxed">
                  以下是**决策时点冻结的原件**（`cache/decision_log/&lt;日期&gt;/candidates.json`）。
                  与「候选」tab 的原卷逐项对不上时，说明归档之后脚本又写过该日数据 ——
                  这正是黑匣子存在的意义。
                </div>
                <DossierView d={activeFrozen} />
              </>
            ) : (
              <EmptyState
                text="无黑匣子原件"
                hint="cache/decision_log/<日期>/candidates.json 缺失"
              />
            )}
          </>
        )}

        {tab === 'zt' && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
              <StatPair label="决策时点" value={pool?.date ?? '—'} />
              <StatPair label="涨停家数" value={pool?.zt_count ?? '—'} tone="up" />
              <StatPair label="最高板" value={pool?.max_boards ?? '—'} />
              <StatPair label="天梯层数" value={pool?.ladder ? Object.keys(pool.ladder).length : '—'} />
              <StatPair label="明细条数" value={ztList.length} tone={ztList.length ? 'up' : 'sub'} />
              {starCount > 0 && (
                <StatPair label="已剔除科创" value={`${starCount} 只`} tone="sub" />
              )}
            </div>

            {ztList.length > 0 ? (
                <DataTable
                  virtual
                  rows={tradableStocks(ztList)}
                  rowKey={(s) => s.code}
                  dense
                  empty="无明细"
                  columns={[
                    {
                      label: '标的',
                      cell: (s) => (
                        <span>
                          <StockLink code={s.code} className="text-txt">{s.name}</StockLink>
                        </span>
                      ),
                    },
                    { label: '板数', num: true, cell: (s) => <span className="text-up font-semibold">{s.boards}</span> },
                    { label: '首封', cell: (s) => <span className="num text-sub">{s.fbt || '—'}</span> },
                    {
                      label: '炸板',
                      num: true,
                      cell: (s) => <span className={s.zbc > 0 ? 'text-warn' : 'text-sub'}>{s.zbc || '—'}</span>,
                    },
                    { label: '换手', num: true, cell: (s) => `${n1(s.hs)}%` },
                    { label: '成交额', num: true, cell: (s) => `${n1(s.cje_yi)}亿` },
                    { label: '市值', num: true, cell: (s) => `${n1(s.zsz_yi)}亿` },
                    { label: '板块', cell: (s) => <Tag>{s.sector || '—'}</Tag> },
                    {
                      // ⚠️ 此列原标「封板质量」并直接渲染 seal —— 但 seal 实测是
                      //    **封单资金（亿）**（float，1700+ 条全为 float），
                      //    标成「质量」会让 1.34 被读成某种评分。已改为如实标注。
                      label: '封单(亿)',
                      num: true,
                      cell: (s) => <span className="num text-sub">{n1(s.seal)}</span>,
                    },
                  ]}
                />
            ) : (
              <EmptyState
                text="决策时点涨停池无全量明细"
                hint="仅 decision_log 的 zt_pool.json 带 zt_list；yesterday_zt.json 天生不带明细"
              />
            )}

            {pool?.top_codes?.length ? (
              <div className="mt-3">
                <div className="text-12 text-sub mb-1">决策时点高位股（top_codes）</div>
                <DataTable
                  rows={pool.top_codes}
                  rowKey={(t) => t.code}
                  dense
                  empty="无"
                  columns={[
                    { label: '标的', cell: (t) => <StockLink code={t.code} className="text-txt">{t.name}</StockLink> },
                    { label: '板数', num: true, cell: (t) => <span className="text-up font-semibold">{t.boards}</span> },
                  ]}
                />
              </div>
            ) : null}
          </>
        )}

        {tab === 'auction' && (
          <>
            {auctionFiles.length === 0 ? (
              <EmptyState text="无竞价报价存档" hint="wealth_code/cache/auction_quotes-*.json 缺失" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <select
                    value={activeAuction?.file ?? ''}
                    onChange={(e) => setAuctionFile(e.target.value)}
                    className="text-12 px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
                  >
                    {auctionFiles.map((f) => (
                      <option key={f.file} value={f.file}>
                        {fileDate(f.file)}
                      </option>
                    ))}
                  </select>
                  <StatPair label="报价条数" value={auctionQuotes.length} />
                  <StatPair
                    label="数据时间"
                    value={(activeAuction?.data as { ts?: string } | undefined)?.ts ?? '—'}
                  />
                  <StatPair
                    label="高开 ≥5%"
                    value={auctionQuotes.filter((q) => q.pct != null && q.pct >= 5).length}
                    tone="up"
                  />
                </div>
                <DataTable
                  rows={auctionQuotes}
                  rowKey={(q) => q.code}
                  dense
                  empty="无报价"
                  columns={[
                    { label: '标的', cell: (q) => <StockLink code={q.code}>{q.code}</StockLink> },
                    {
                      label: '竞价涨幅',
                      num: true,
                      cell: (q) => (
                        <span
                          className={cn(
                            'font-semibold',
                            q.pct == null ? 'text-sub' : q.pct > 0 ? 'text-up' : q.pct < 0 ? 'text-down' : 'text-txt',
                          )}
                        >
                          {pct(q.pct)}
                        </span>
                      ),
                    },
                    {
                      label: '相对 5% 纪律',
                      cell: (q) =>
                        q.pct == null ? <Tag>无报价</Tag> : q.pct > 5 ? <Tag tone="down">超上限</Tag> : <Tag tone="up">在限内</Tag>,
                    },
                  ]}
                />
                <p className="text-warn text-12 mt-2 leading-relaxed border-l-2 border-warn pl-2.5">
                  口径提示：竞价报价文件在当天后续运行中会被**覆盖重写**，因此此刻看到的报价可能
                  与 09:26 决策时点的快照不完全一致（原系统已知问题，未修）。判定「能否买到」应以
                  决策时点的快照为准。
                </p>
              </>
            )}
          </>
        )}
      </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}

function fmtSize(b: number): string {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}
