import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import {
  analyticsQueries,
  CardArchiveView,
  SegTabs,
  cardDate,
  fileDate,
  type ArchiveCard,
} from '@/features/analytics'
import { Card, CardBadge, EmptyState, Zone, ZoneRow } from '@/shared/ui'
import { cn, staleLabel } from '@/shared/lib'

/**
 * 卡片原文存档 —— 决策过程的可追溯原件。
 *
 * ## 为什么值得单独一页
 *
 * 本项目其余页面都是**把 JSON 重新组织成表格/图表**，即「结构化重述」。
 * 但推送卡是原系统当时**真正发出去的东西** —— 措辞、顺序、结论都冻结在卡里。
 * 复盘时最有价值的一问是「当时卡上到底怎么说的」，重述版答不了这个问题。
 * 本页因此**不做任何改写**，只把卡片元素降级为可读文本块原样呈现。
 *
 * ## 五类卡（均为 `{title, color, elements[]}` 飞书卡结构）
 *
 * | 卡 | 落盘 | 时点 |
 * |---|---|---|
 * | 盘后复盘 | `cache/fupan_card_<日期>.json` | 盘后 |
 * | 盘前预测 | `wealth_code/cache/panqian_card_<日期>.json` | 06:06 |
 * | 尾盘潜伏 | `wealth_code/cache/ambush_card_<日期>.json` | 尾盘 |
 * | 龙虎榜速览 | `cache/lhb_card_<日期>.json` | 18:20 |
 * | 财富密码混合卡 | `wealth_code/cache/card_<日期>_<时刻>.json` | 09:26 / 盘中 / 15:37 |
 *
 * ⚠️ 混合卡两条不同时点的卡**混存在同一目录、同一命名规则下**，
 * 只能靠 title 前缀区分（`⚡ 竞价验证` vs `📊 盘后候选`）——
 * 这正是原先 `/api/card/verify` 路由取不到数据的原因（目录整错且无法按内容过滤），
 * 现已改指真实落盘并按前缀在页内分组。
 *
 * ⛔ 卡片的 `color` 是**原系统推送语义色**，与本项目 A 股色板不是同一套，
 * 故 `CardArchiveView` 只标注不着色（详见该组件注释）。
 */

type Dated<T> = { file: string; data: T | null }

type Kind = 'fupan' | 'panqian' | 'ambush' | 'lhb' | 'mixed'

const KINDS: ReadonlyArray<{ key: Kind; label: string; note: string }> = [
  { key: 'fupan', label: '盘后复盘', note: 'cache/fupan_card_<日期>.json' },
  { key: 'panqian', label: '盘前预测', note: 'wealth_code/cache/panqian_card_<日期>.json' },
  { key: 'ambush', label: '尾盘潜伏', note: 'wealth_code/cache/ambush_card_<日期>.json' },
  { key: 'lhb', label: '龙虎榜速览', note: 'cache/lhb_card_<日期>.json' },
  { key: 'mixed', label: '财富密码', note: 'wealth_code/cache/card_<日期>_<时刻>.json' },
]

/** 混合卡的两条产线：以 title 前缀识别（路由层无内容谓词，只能在此分组） */
function mixedKind(title: string | undefined): 'verify' | 'eod' | 'other' {
  if (!title) return 'other'
  if (title.includes('竞价验证')) return 'verify'
  if (title.includes('盘后候选')) return 'eod'
  return 'other'
}

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.cardFupan())
  await queryClient.ensureQueryData(analyticsQueries.cardPanqian())
  await queryClient.ensureQueryData(analyticsQueries.cardAmbush())
  await queryClient.ensureQueryData(analyticsQueries.cardLhb())
  await queryClient.ensureQueryData(analyticsQueries.cardMixed())
  return null
}

export function Component() {
  const fupan = useQuery(analyticsQueries.cardFupan())
  const panqian = useQuery(analyticsQueries.cardPanqian())
  const ambush = useQuery(analyticsQueries.cardAmbush())
  const lhb = useQuery(analyticsQueries.cardLhb())
  const mixed = useQuery(analyticsQueries.cardMixed())

  const [kind, setKind] = useState<Kind>('fupan')
  const [pick, setPick] = useState('')
  const [sub, setSub] = useState<'all' | 'verify' | 'eod'>('all')

  /** 五条源统一成「有新到旧」的期次列表；`data` 为空的期次直接剔除（不占位） */
  const byKind = useMemo<Record<Kind, Dated<ArchiveCard>[]>>(() => {
    const norm = (raw: Dated<ArchiveCard>[] | undefined) =>
      (raw ?? [])
        .filter((f) => !!f.data)
        .slice()
        .sort((a, b) => b.file.localeCompare(a.file))
    return {
      fupan: norm(fupan.data as Dated<ArchiveCard>[] | undefined),
      panqian: norm(panqian.data as Dated<ArchiveCard>[] | undefined),
      ambush: norm(ambush.data as Dated<ArchiveCard>[] | undefined),
      lhb: norm(lhb.data as Dated<ArchiveCard>[] | undefined),
      mixed: norm(mixed.data as Dated<ArchiveCard>[] | undefined),
    }
  }, [fupan.data, panqian.data, ambush.data, lhb.data, mixed.data])

  const listAll = byKind[kind]
  const list =
    kind === 'mixed' && sub !== 'all'
      ? listAll.filter((f) => mixedKind(f.data?.title) === sub)
      : listAll

  /** 期次默认取最新一份；`pick` 失效（换卡类/过滤后不在列表里）时同样回落最新 */
  const current = list.find((f) => f.file === pick) ?? list[0]

  const loading =
    fupan.isLoading || panqian.isLoading || ambush.isLoading || lhb.isLoading || mixed.isLoading

  const kindNote = KINDS.find((k) => k.key === kind)?.note ?? ''

  return (
    <div className="flex flex-col gap-3">
      {/* ── 概览通栏：五类卡的库存与最新期次 ── */}
      <Card title="🗂 卡片原件库存" extra={<CardBadge>{KINDS.length} 类</CardBadge>}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-3 xl:grid-cols-5">
          {KINDS.map((k) => {
            const l = byKind[k.key]
            const latest = l[0]
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => {
                  setKind(k.key)
                  setPick('')
                  setSub('all')
                }}
                className={cn(
                  'text-left rounded-sm border px-2 py-1.5 cursor-pointer bg-transparent transition-colors',
                  k.key === kind
                    ? 'border-line-strong bg-line-faint'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      'text-13',
                      k.key === kind ? 'font-semibold text-txt' : 'text-sub',
                    )}
                  >
                    {k.label}
                  </span>
                  <span className="num text-12 text-sub">{l.length} 份</span>
                </div>
                <div className="text-11 text-sub mt-0.5 truncate">
                  {latest ? `最新 ${fileDate(latest.file)}` : '—'}
                  {latest && staleLabel(fileDate(latest.file), 7) && (
                    <span className="badge bg-warn-soft text-warn ml-1">
                      {staleLabel(fileDate(latest.file), 7)}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* 最新一份的标题 —— 卡的原生措辞，比任何重述都更接近当时的判断 */}
        <div className="mt-2.5 pt-2 border-t border-line-faint">
          <div className="text-11 text-sub leading-tight">最新一份卡标题</div>
          <div className="text-13 text-txt leading-snug mt-0.5">
            {current?.data?.title ?? '—'}
          </div>
          {current && (
            <div className="num text-11 text-sub mt-0.5">{fileDate(current.file)}</div>
          )}
        </div>
      </Card>

      <ZoneRow>
        {/* ── 主工作区：卡面原文（本页的主体重心）── */}
        <Zone label="卡面原文" dot="bg-lead" className="xl:w-[72%]">
          <Card
            title={KINDS.find((k) => k.key === kind)?.label ?? '卡片'}
            extra={
              <div className="flex items-center gap-2">
                {kind === 'mixed' && (
                  <SegTabs
                    items={[
                      { key: 'all', label: '全部' },
                      { key: 'verify', label: '竞价验证' },
                      { key: 'eod', label: '盘后候选' },
                    ]}
                    value={sub}
                    onChange={(v) => {
                      setSub(v as 'all' | 'verify' | 'eod')
                      setPick('')
                    }}
                  />
                )}
                <CardBadge>{list.length} 期</CardBadge>
              </div>
            }
          >
            {loading ? (
              <div className="text-sub text-13 py-3">加载中…</div>
            ) : current?.data ? (
              <CardArchiveView card={current.data} />
            ) : (
              <EmptyState text={`${kindNote} 下暂无可用存档`} />
            )}
          </Card>
        </Zone>

        {/* ── 辅助区：期次目录（点选切换，长列表局部滚动）── */}
        <Zone label="期次目录" dot="bg-mid" className="xl:w-[28%]">
          <Card title="期次" extra={<CardBadge>{list.length}</CardBadge>}>
            {list.length === 0 ? (
              <EmptyState text="无期次" />
            ) : (
              <ul className="flex flex-col max-h-[560px] overflow-y-auto">
                {list.map((f) => {
                  const on = current?.file === f.file
                  const mk = kind === 'mixed' ? mixedKind(f.data?.title) : null
                  return (
                    <li key={f.file}>
                      <button
                        type="button"
                        onClick={() => setPick(f.file)}
                        className={cn(
                          'w-full text-left px-2 py-1.5 border-b border-line-faint cursor-pointer bg-transparent transition-colors',
                          on ? 'bg-line-faint' : 'hover:bg-line-faint',
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              'num text-12',
                              on ? 'font-semibold text-txt' : 'text-sub',
                            )}
                          >
                            {fileDate(f.file)}
                          </span>
                          <span className="text-11 text-sub truncate">
                            {cardDate(f.data, '') }
                          </span>
                        </div>
                        <div className="text-12 text-txt truncate mt-0.5">
                          {f.data?.title ?? '—'}
                        </div>
                        {mk && mk !== 'other' && (
                          <div className="text-11 text-sub mt-0.5">
                            {mk === 'verify' ? '竞价验证卡' : '盘后候选卡'}
                          </div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
