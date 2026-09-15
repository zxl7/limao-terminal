import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { InstitutionPoolFile } from '@/shared/api'
import {
  analyticsQueries,
  CardArchiveView,
  DataTable,
  SegTabs,
  StatPair,
  Tag,
  type ArchiveCard,
} from '@/features/analytics'
import { Card, CardBadge, EmptyState } from '@/shared/ui'

/**
 * 机构投研 —— 数据源三类，视角完全不同：
 *
 *   ① `cache/institution_pool_*.json` —— **机构关注池**（74 家级别），
 *      每票一句话机构逻辑（`theme`）。这是「机构在关注什么」的横截面。
 *   ② `cache/gangtise_morning_full_v5.json` —— 机构研报**早盘卡**（08:50 推送）
 *   ③ `cache/gangtise_evening_research.json` + `gangtise_weekend_0913.json`
 *      —— 机构**晚报 / 周末复盘**（21:00 / 周末）
 *
 * ## 为什么机构视角值得单列一页
 *
 * 本系统其余维度全是从**盘面**反推（涨停、资金、梯队），而机构视角是从
 * **产业链逻辑**正推。两者经常不一致 —— 盘面热的题材机构未必认，
 * 机构共识强的方向盘面可能还没动。这个「不一致」本身就是信息：
 * 机构先行的方向提供埋伏位，盘面先行的方向提供接力位。
 *
 * ## 卡片存档按**文本块降级渲染**
 *
 * `gangtise_*` 文件是飞书卡片结构（title / color / elements）。
 * 本页不还原卡片外观，而是抽取文本块 —— 目的是读回结论，不是复刻推送样式。
 * 卡片 `color` 是原系统推送语义色，与本项目 A 股色板无关，故仅标注不着色。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.institutionPool())
  await queryClient.ensureQueryData(analyticsQueries.institutionMorning())
  await queryClient.ensureQueryData(analyticsQueries.institutionEvening())
  await queryClient.ensureQueryData(analyticsQueries.institutionWeekend())
  return null
}

/** 机构关注池按 theme 归组 —— 「一句话逻辑」相同的票属于同一机构逻辑链 */
interface PoolGroup {
  theme: string
  items: Array<{ code: string; name: string }>
}

export function Component() {
  const pool = useQuery(analyticsQueries.institutionPool())
  const morning = useQuery(analyticsQueries.institutionMorning())
  const evening = useQuery(analyticsQueries.institutionEvening())
  const weekend = useQuery(analyticsQueries.institutionWeekend())
  const [tab, setTab] = useState<'pool' | 'morning' | 'evening' | 'weekend'>('pool')
  const [q, setQ] = useState('')

  const poolFiles = useMemo<InstitutionPoolFile[]>(
    () =>
      (pool.data ?? [])
        .map((f) => f.data)
        .filter((x): x is InstitutionPoolFile => !!x)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [pool.data],
  )
  const latest = poolFiles[0]

  /** 按机构逻辑归组，组内按代码排序 */
  const groups = useMemo<PoolGroup[]>(() => {
    const map = new Map<string, Array<{ code: string; name: string }>>()
    for (const it of latest?.items ?? []) {
      const key = it.theme || '（无机构逻辑标注）'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ code: it.code, name: it.name })
    }
    return [...map.entries()]
      .map(([theme, items]) => ({ theme, items }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [latest])

  const filteredGroups = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return groups
    return groups
      .map((g) => ({
        theme: g.theme,
        items: g.items.filter((i) => i.name.toLowerCase().includes(k) || i.code.includes(k)),
      }))
      .filter((g) => g.items.length > 0 || g.theme.toLowerCase().includes(k))
  }, [groups, q])

  const asCard = (v: unknown): ArchiveCard | null =>
    v && typeof v === 'object' ? (v as ArchiveCard) : null

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🏛️ 机构投研"
        extra={<CardBadge>{latest ? `${latest.date} · ${latest.count} 家` : '—'}</CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="机构池日期" value={latest?.date ?? '—'} />
          <StatPair label="覆盖家数" value={latest?.count ?? '—'} />
          <StatPair label="逻辑分组" value={groups.length} />
          <StatPair label="归档期数" value={poolFiles.length} />
          <StatPair label="早盘卡" value={morning.data ? '有' : '无'} tone={morning.data ? 'up' : 'sub'} />
          <StatPair label="晚报" value={evening.data ? '有' : '无'} tone={evening.data ? 'up' : 'sub'} />
        </div>
        <p className="text-sub text-[11.5px] leading-relaxed">
          本系统其余维度从**盘面**反推（涨停 / 资金 / 梯队），机构视角从**产业链逻辑**正推。
          两者不一致处即信息所在：机构先行提供埋伏位，盘面先行提供接力位。
        </p>
        {!pool.isLoading && !latest && (
          <EmptyState text="机构池未生成" hint="cache/institution_pool_*.json 缺失" />
        )}
      </Card>

      <Card
        title="明细"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'pool' && (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜个股 / 代码 / 逻辑…"
                className="px-2.5 py-1 text-[12.5px] rounded-sm min-w-[170px] bg-transparent border border-line text-txt placeholder:text-sub focus:outline-none focus:border-line-strong"
              />
            )}
            <SegTabs
              items={[
                { key: 'pool', label: `机构池 (${latest?.count ?? 0})` },
                { key: 'morning', label: '早盘卡' },
                { key: 'evening', label: '机构晚报' },
                { key: 'weekend', label: '周末复盘' },
              ]}
              value={tab}
              onChange={(k) => setTab(k as typeof tab)}
            />
          </div>
        }
      >
        {tab === 'pool' && (
          <>
            {filteredGroups.length === 0 && (
              <EmptyState
                text={latest ? '无匹配' : '机构池未生成'}
                hint={latest ? '换个关键词' : undefined}
              />
            )}
            <div className="flex flex-col gap-2">
              {filteredGroups.map((g) => (
                <div key={g.theme} className="border border-line rounded-sm px-2.5 py-2">
                  <div className="flex items-baseline gap-2 mb-1">
                    <Tag tone="up">{g.items.length} 家</Tag>
                    <span className="text-[13px] font-semibold text-txt">{g.theme}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {g.items.map((it) => (
                      <span
                        key={it.code}
                        className="badge border border-line text-sub"
                        title={it.code}
                      >
                        {it.name}
                        <span className="num ml-1 opacity-70">{it.code}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {groups.length > 0 && (
              <p className="text-sub text-[11px] mt-2">
                按机构逻辑归组 —— 同一句话逻辑下的票属于同一条产业链，这与按行业分类不同。
              </p>
            )}
          </>
        )}

        {tab === 'morning' && (
          <ArchivePane card={asCard(morning.data)} loading={morning.isLoading} file="cache/gangtise_morning_full_v5.json" />
        )}
        {tab === 'evening' && (
          <ArchivePane card={asCard(evening.data)} loading={evening.isLoading} file="cache/gangtise_evening_research.json" />
        )}
        {tab === 'weekend' && (
          <ArchivePane card={asCard(weekend.data)} loading={weekend.isLoading} file="cache/gangtise_weekend_0913.json" />
        )}
      </Card>

      {poolFiles.length > 1 && (
        <Card title="机构池历史" extra={<CardBadge>{poolFiles.length} 期</CardBadge>}>
          <DataTable
            rows={poolFiles}
            rowKey={(f) => f.date}
            dense
            empty="无"
            columns={[
              { label: '日期', cell: (f) => <span className="num">{f.date}</span> },
              { label: '家数', num: true, cell: (f) => f.count },
              {
                label: '逻辑条数',
                num: true,
                cell: (f) => new Set((f.items ?? []).map((i) => i.theme)).size,
              },
              {
                label: '首条逻辑',
                className: 'whitespace-normal min-w-[280px]',
                cell: (f) => <span className="text-sub text-[11.5px]">{f.items?.[0]?.theme ?? '—'}</span>,
              },
            ]}
          />
        </Card>
      )}
    </div>
  )
}

/** 卡片存档面板 —— 统一处理「未生成 / 已生成」两态 */
function ArchivePane({
  card,
  loading,
  file,
}: {
  card: ArchiveCard | null
  loading: boolean
  file: string
}) {
  if (loading) return <EmptyState text="加载中…" />
  if (!card) return <EmptyState text="该卡未生成" hint={file} />
  return <CardArchiveView card={card} />
}
