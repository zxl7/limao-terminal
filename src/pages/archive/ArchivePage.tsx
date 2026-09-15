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
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { cn } from '@/shared/lib'

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
  return null
}

export function Component() {
  const manifest = useQuery(analyticsQueries.decisionManifest())
  const cands = useQuery(analyticsQueries.decisionCandidates())
  const ztPool = useQuery(analyticsQueries.decisionZtPool())
  const auction = useQuery(analyticsQueries.decisionAuctionHistory())
  const [tab, setTab] = useState<'manifest' | 'candidates' | 'zt' | 'auction'>('manifest')
  /** 候选/竞价的期次选择各自独立 —— 两者归档日期不一定重合；默认取最新一期 */
  const [candFile, setCandFile] = useState('')
  const [auctionFile, setAuctionFile] = useState('')

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

  /** 竞价报价的条目展开（quotes 是 code → 涨幅 的映射） */
  const auctionQuotes = useMemo(() => {
    const q = (activeAuction?.data as { quotes?: Record<string, number>; ts?: string } | undefined)?.quotes
    if (!q) return []
    return Object.entries(q)
      .map(([code, pctv]) => ({ code, pct: pctv }))
      .sort((a, b) => b.pct - a.pct)
  }, [activeAuction])

  /** 板数降序的涨停池明细（仅 decision_log 的 zt_pool 带 zt_list） */
  const ztList = useMemo(
    () => [...(pool?.zt_list ?? [])].sort((a, b) => b.boards - a.boards || (a.fbt || '').localeCompare(b.fbt || '')),
    [pool],
  )

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
        <p className="text-sub text-[11.5px] leading-relaxed">
          黑匣子的意义：把决策**当时**的输入冻结，避免复盘时用今天的信息评判当时的决策。
          存档缺口本身就是结论 —— 来源缺失的日子，决策质量天然受限，复盘需打折看待。
        </p>
      </Card>

      {gaps.length > 0 && (
        <Card title="存档缺口（该日缺失的来源）" extra={<CardBadge tone="warn">{gaps.length}</CardBadge>}>
          <ul className="text-[12.5px] leading-relaxed text-warn">
            {gaps.map((g, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
              <li key={i}>
                {typeof g === 'string' ? g : JSON.stringify(g)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="存档明细"
        extra={
          <SegTabs
            items={[
              { key: 'manifest', label: `来源清单 (${m?.sources?.length ?? 0})` },
              { key: 'candidates', label: `候选 (${candFiles.length})` },
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
              { label: '角色', cell: (s) => <Tag tone="up">{s.role || '—'}</Tag> },
              { label: '源路径', cell: (s) => <span className="num text-[11.5px]">{s.src || '—'}</span> },
              { label: '存档路径', cell: (s) => <span className="num text-[11.5px] text-sub">{s.dst || '—'}</span> },
              {
                label: '体积',
                num: true,
                cell: (s) => <span className="text-sub">{fmtSize(s.bytes)}</span>,
              },
              {
                label: 'sha256',
                cell: (s) => (
                  <span className="num text-[10.5px] text-sub" title={s.sha256}>
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
                  className="text-[12px] px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
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

        {tab === 'zt' && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
              <StatPair label="决策时点" value={pool?.date ?? '—'} />
              <StatPair label="涨停家数" value={pool?.zt_count ?? '—'} tone="up" />
              <StatPair label="最高板" value={pool?.max_boards ?? '—'} />
              <StatPair label="天梯层数" value={pool?.ladder ? Object.keys(pool.ladder).length : '—'} />
              <StatPair label="明细条数" value={ztList.length} tone={ztList.length ? 'up' : 'sub'} />
            </div>

            {ztList.length > 0 ? (
              <div className="max-h-[62vh] overflow-y-auto">
                <DataTable
                  rows={ztList}
                  rowKey={(s) => s.code}
                  dense
                  empty="无明细"
                  columns={[
                    {
                      label: '标的',
                      cell: (s) => (
                        <span>
                          <span className="text-rec">{s.name}</span>
                          <span className="num text-sub ml-1.5">{s.code}</span>
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
                    { label: '封板质量', cell: (s) => <span className="text-[11.5px]">{s.seal || '—'}</span> },
                  ]}
                />
              </div>
            ) : (
              <EmptyState
                text="决策时点涨停池无全量明细"
                hint="仅 decision_log 的 zt_pool.json 带 zt_list；yesterday_zt.json 天生不带明细"
              />
            )}

            {pool?.top_codes?.length ? (
              <div className="mt-3">
                <div className="text-[12px] text-sub mb-1">决策时点高位股（top_codes）</div>
                <DataTable
                  rows={pool.top_codes}
                  rowKey={(t) => t.code}
                  dense
                  empty="无"
                  columns={[
                    { label: '标的', cell: (t) => <span className="text-rec">{t.name}</span> },
                    { label: '代码', cell: (t) => <span className="num text-sub">{t.code}</span> },
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
                    className="text-[12px] px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
                  >
                    {auctionFiles.map((f) => (
                      <option key={f.file} value={f.file}>
                        {fileDate(f.file)}
                      </option>
                    ))}
                  </select>
                  <StatPair label="报价条数" value={auctionQuotes.length} />
                  <StatPair
                    label="快照时间"
                    value={(activeAuction?.data as { ts?: string } | undefined)?.ts ?? '—'}
                  />
                  <StatPair
                    label="高开 ≥5%"
                    value={auctionQuotes.filter((q) => q.pct >= 5).length}
                    tone="up"
                  />
                </div>
                <DataTable
                  rows={auctionQuotes}
                  rowKey={(q) => q.code}
                  dense
                  empty="无报价"
                  columns={[
                    { label: '代码', cell: (q) => <span className="num">{q.code}</span> },
                    {
                      label: '竞价涨幅',
                      num: true,
                      cell: (q) => (
                        <span className={cn('font-semibold', q.pct > 0 ? 'text-up' : q.pct < 0 ? 'text-down' : 'text-txt')}>
                          {pct(q.pct)}
                        </span>
                      ),
                    },
                    {
                      label: '相对 5% 纪律',
                      cell: (q) => (q.pct > 5 ? <Tag tone="down">超上限</Tag> : <Tag tone="up">在限内</Tag>),
                    },
                  ]}
                />
                <p className="text-warn text-[11.5px] mt-2 leading-relaxed border-l-2 border-warn pl-2.5">
                  口径提示：竞价报价文件在当天后续运行中会被**覆盖重写**，因此此刻看到的报价可能
                  与 09:26 决策时点的快照不完全一致（原系统已知问题，未修）。判定「能否买到」应以
                  决策时点的快照为准。
                </p>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

function fmtSize(b: number): string {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}
