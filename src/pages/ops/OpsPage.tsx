import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type { AuditEntry, PushedSignals } from '@/shared/api'
import {
  analyticsQueries,
  CardArchiveView,
  DataTable,
  SegTabs,
  StatPair,
  Tag,
  fileDate,
  type ArchiveCard,
} from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 运维审计 —— 回答「系统今天到底跑了什么、推了什么」。
 *
 * ## 三个数据源的诊断分工
 *
 *   ① `pulse_windows/` —— **盘中脉冲卡的成品存档**（逐字节留存）。看到卡片
 *      原文才能判断「当时那句话该不该说」，而不是只看推送条数。
 *   ② `pushed_signals_*.json` —— **当日推送状态**。这是最有效的故障指纹：
 *      文件极小 / 各数组全空 = 该日事件链**零产出**（不是「没有信号」，
 *      而是「链没跑起来」）。两者含义完全不同，必须区分。
 *   ③ `audit_log.jsonl` —— **推送审计**（含 `19001` 这类失败码）。
 *      客户群镜像失败只记 audit 不告警，因此排查镜像问题只能看这里。
 *
 * ## ⚠️ 「零产出」是最容易被忽略的故障
 *
 * 一个安静的日子与一条断掉的链路，在结果上完全一样（都没有推送）。
 * 判据就是 `pushed_signals` 的体积与内容 —— 因此本页把它的**体积**与
 * **各字段计数**一起放在页首，让「安静」和「坏了」一眼可分。
 */

export async function loader() {
  await queryClient.ensureQueryData(analyticsQueries.pulseWindows())
  await queryClient.ensureQueryData(analyticsQueries.pulsePushedSignals())
  await queryClient.ensureQueryData(analyticsQueries.auditLog())
  return null
}

export function Component() {
  const windows = useQuery(analyticsQueries.pulseWindows())
  const signals = useQuery(analyticsQueries.pulsePushedSignals())
  const audit = useQuery(analyticsQueries.auditLog())
  const health = useQuery(marketQueries.health())
  const [tab, setTab] = useState<'pulse' | 'signals' | 'audit'>('pulse')

  /** 脉冲卡：日期倒序，同一日期内含多张卡 */
  const pulseDays = useMemo(
    () =>
      (windows.data ?? [])
        .filter((f) => !!f.data)
        .sort((a, b) => b.file.localeCompare(a.file))
        .slice(0, 12),
    [windows.data],
  )
  const [pulseDate, setPulseDate] = useState('')
  const activeDayIdx = Math.max(0, pulseDate ? pulseDays.findIndex((f) => f.file === pulseDate) : 0)
  const activeDay = pulseDays[activeDayIdx]
  /** 单文件可能是卡片数组，也可能是单张卡 */
  const activeCards = useMemo<ArchiveCard[]>(() => {
    const raw = activeDay?.data as unknown
    if (!raw) return []
    if (Array.isArray(raw)) return raw as ArchiveCard[]
    return [raw as ArchiveCard]
  }, [activeDay])

  /** 推送状态：取最新一日 */
  const signalFiles = useMemo(
    () => (signals.data ?? []).filter((f) => !!f.data).sort((a, b) => b.file.localeCompare(a.file)),
    [signals.data],
  )
  const sig: PushedSignals | undefined = signalFiles[0]?.data as PushedSignals | undefined

  /** 推送状态各维度计数 —— 全为 0 = 事件链零产出（故障指纹） */
  const sigCounts = useMemo(() => {
    if (!sig) return []
    return [
      { key: '涨停推送', n: sig.zt_codes?.length ?? 0, tone: 'up' as const },
      { key: '拉升推送', n: Object.keys(sig.surge_codes ?? {}).length, tone: 'rec' as const },
      { key: '快讯推送', n: sig.nf_titles?.length ?? 0, tone: 'warn' as const },
      { key: '板块推送', n: sig.sector_pushed?.length ?? 0, tone: 'up' as const },
      { key: '强势推送', n: sig.strong_codes?.length ?? 0, tone: 'rec' as const },
      { key: '充电推送', n: sig.charge_codes?.length ?? 0, tone: 'warn' as const },
    ]
  }, [sig])
  const totalPushed = sigCounts.reduce((s, c) => s + c.n, 0)

  const auditRows = useMemo(
    () => [...(audit.data ?? [])].reverse(),
    [audit.data],
  )
  /** 失败码扫描 —— 19001 = 客户群 webhook 失效（原系统已知码） */
  const failures = useMemo(
    () => auditRows.filter((a) => JSON.stringify(a).includes('19001')),
    [auditRows],
  )

  const files = health.data?.files ?? []

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="🛠️ 运维审计"
        extra={
          <CardBadge tone={totalPushed === 0 ? 'warn' : 'up'}>
            当日推送 {totalPushed} 条
          </CardBadge>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
          <StatPair label="脉冲归档日数" value={pulseDays.length} />
          <StatPair label="推送状态日" value={signalFiles[0] ? fileDate(signalFiles[0].file) : '—'} />
          <StatPair label="推送总条数" value={totalPushed} tone={totalPushed === 0 ? 'down' : 'up'} />
          <StatPair label="审计条目" value={auditRows.length} />
          <StatPair label="19001 失败" value={failures.length} tone={failures.length ? 'down' : 'sub'} />
          <StatPair label="数据源登记" value={files.length} />
        </div>

        {sigCounts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {sigCounts.map((c) => (
              <span
                key={c.key}
                className={cn('badge border', c.n === 0 ? 'border-line text-sub' : 'border-line-strong text-txt')}
              >
                {c.key} {c.n}
              </span>
            ))}
          </div>
        )}

        <p className="text-warn text-[11.5px] leading-relaxed border-l-2 border-warn pl-2.5">
          判据：推送状态文件**极小或各计数全为 0** = 该日事件链**零产出**（链路没跑起来），
          而不是「当日没有信号」。两者结果都是「没有推送」，但含义完全不同 ——
          一个安静的日子和一条断掉的链路，只能靠本页区分。
        </p>
      </Card>

      {failures.length > 0 && (
        <Card title="推送失败（含 19001 客户群失效）" extra={<CardBadge tone="down">{failures.length}</CardBadge>}>
          <DataTable
            rows={failures}
            rowKey={(_r, i) => String(i)}
            dense
            empty="无"
            columns={[
              { label: '时间', cell: (a) => <span className="num text-sub text-[11px]">{a.ts?.slice(0, 19).replace('T', ' ') ?? '—'}</span> },
              { label: '事件', cell: (a) => <Tag tone="warn">{a.event || '—'}</Tag> },
              { label: '模块', cell: (a) => <span className="text-[11.5px]">{a.module || '—'}</span> },
              { label: '目标', cell: (a) => <span className="num text-[11.5px]">{a.target || '—'}</span> },
              {
                label: '详情',
                className: 'whitespace-normal min-w-[240px]',
                cell: (a) => <span className="text-[11.5px] leading-relaxed">{brief(a)}</span>,
              },
            ]}
          />
          <p className="text-sub text-[11px] mt-1.5">
            19001 = 客户群 webhook 失效。原系统对客户群镜像失败**只记审计不告警**，
            因此排查镜像是否到货只能看这里。
          </p>
        </Card>
      )}

      <Card
        title="明细"
        extra={
          <SegTabs
            items={[
              { key: 'pulse', label: `脉冲卡存档 (${pulseDays.length})` },
              { key: 'signals', label: '推送状态' },
              { key: 'audit', label: `审计日志 (${auditRows.length})` },
            ]}
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === 'pulse' && (
          <>
            {pulseDays.length === 0 ? (
              <EmptyState text="无脉冲卡存档" hint="cache/pulse_windows/ 为空" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <select
                    value={activeDay?.file ?? ''}
                    onChange={(e) => setPulseDate(e.target.value)}
                    className="text-[12px] px-2 py-1 rounded-sm border border-line bg-transparent text-txt cursor-pointer"
                  >
                    {pulseDays.map((f) => (
                      <option key={f.file} value={f.file}>
                        {fileDate(f.file)}（{Array.isArray(f.data) ? f.data.length : 1} 张）
                      </option>
                    ))}
                  </select>
                  <span className="text-sub text-[11.5px]">
                    当日 {activeCards.length} 张卡 · 逐字节留存的成品，用于判断「当时那句话该不该说」
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {activeCards.map((c, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                    <CardArchiveView key={i} card={c} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === 'signals' && (
          <>
            {!sig ? (
              <EmptyState text="无推送状态文件" hint="cache/pulse_snapshots/pushed_signals_*.json 缺失" />
            ) : (
              <>
                <div className="text-sub text-[12px] mb-2">
                  归档日 <span className="num text-txt">{fileDate(signalFiles[0].file)}</span>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <SigList title={`涨停推送（${sig.zt_codes?.length ?? 0}）`} items={sig.zt_codes} />
                  <SigList
                    title={`拉升推送（${Object.keys(sig.surge_codes ?? {}).length}）`}
                    items={Object.entries(sig.surge_codes ?? {}).map(([c, t]) => `${c}　${String(t).slice(11, 19)}`)}
                  />
                  <SigList title={`板块推送（${sig.sector_pushed?.length ?? 0}）`} items={sig.sector_pushed} />
                  <SigList title={`强势推送（${sig.strong_codes?.length ?? 0}）`} items={sig.strong_codes} />
                  <SigList title={`充电推送（${sig.charge_codes?.length ?? 0}）`} items={sig.charge_codes} />
                  <SigList title={`快讯推送（${sig.nf_titles?.length ?? 0}）`} items={sig.nf_titles} wide />
                </div>
              </>
            )}
          </>
        )}

        {tab === 'audit' && (
          <div className="max-h-[62vh] overflow-y-auto">
            <DataTable
              rows={auditRows.slice(0, 300)}
              rowKey={(_a, i) => String(i)}
              dense
              empty="无审计日志"
              columns={[
                {
                  label: '时间',
                  cell: (a) => <span className="num text-sub text-[11px]">{a.ts?.slice(0, 19).replace('T', ' ') ?? '—'}</span>,
                },
                {
                  label: '事件',
                  cell: (a) => (
                    <Tag tone={a.event === 'push' ? 'up' : a.event === 'config' ? 'warn' : 'neutral'}>
                      {a.event || '—'}
                    </Tag>
                  ),
                },
                { label: '模块', cell: (a) => <span className="text-[11.5px]">{a.module || '—'}</span> },
                { label: '动作', cell: (a) => <span className="text-[11.5px] text-sub">{a.action || '—'}</span> },
                { label: '规则', cell: (a) => <span className="text-[11.5px] text-sub">{a.rule || '—'}</span> },
                {
                  label: '目标',
                  className: 'whitespace-normal min-w-[180px]',
                  cell: (a) => <span className="num text-[11px]">{a.target || '—'}</span>,
                },
                {
                  label: '详情',
                  className: 'whitespace-normal min-w-[220px]',
                  cell: (a) => <span className="text-[11.5px] leading-relaxed">{brief(a)}</span>,
                },
              ]}
            />
            {auditRows.length > 300 && (
              <p className="text-sub text-[11px] mt-1.5">仅显示最近 300 条（共 {auditRows.length} 条）</p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function SigList({ title, items, wide }: { title: string; items?: string[]; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-2' : undefined}>
      <div className="text-[12px] text-sub mb-1">{title}</div>
      {items?.length ? (
        <div className="flex flex-wrap gap-1">
          {items.map((x, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
            <span key={`${x}-${i}`} className="badge border border-line text-sub num">
              {x}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-sub text-[12px]">空</span>
      )}
    </div>
  )
}

/** 审计条目字段随事件类型变化，此处只做简短摘要 */
function brief(a: AuditEntry): string {
  const parts: string[] = []
  if (a.before !== undefined) parts.push(`before=${condense(a.before)}`)
  if (a.after !== undefined) parts.push(`after=${condense(a.after)}`)
  if (a.snapshot) parts.push(`快照 ${String(a.snapshot)}`)
  const extra = Object.entries(a).find(([k]) => !['ts', 'event', 'module', 'action', 'rule', 'target', 'before', 'after', 'snapshot'].includes(k))
  if (extra) parts.push(`${extra[0]}=${condense(extra[1])}`)
  return parts.join(' · ') || '—'
}

function condense(v: unknown): string {
  if (v == null) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}
