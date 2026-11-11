import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api'
import type { RuleEntry, RulesFiredFile, RulesRegistryFile } from '@/shared/api'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { cn } from '@/shared/lib'

/**
 * 判据登记表 —— 数据源 `config/rules_registry.json`（后端单一源）。
 *
 * ## 这一页为什么存在（2026-11-11）
 *
 * 用户：「竞价这一套有点越来越像一个黑盒，我应该后续怎么持续维护？」
 * 黑盒不是算不出来，是**没人能一眼说出「现在一共多少条判据、各管什么、怎么关」**。
 *
 * 所以这一页只做三件事：
 *   ① 把判据**全量列出**（准入闸 / 排序名额 / 仓位 / 数据语义 / 展示口径）；
 *   ② 每条带**开关名 + 默认值 + 回退方式**——能关的才叫可控；
 *   ③ 显示它**什么时候加、依据谁的哪句话**——防止下次改的时候不知道为什么有这个。
 *
 * ⛔ 本页只读：不提供开关切换（改开关要走环境变量 + 回放验证，不是点一下）。
 * ⛔ 注册表里没有的判据 = 视为不存在，应当删除（进一出一）。
 */

const KIND_LABEL: Record<RuleEntry['kind'], string> = {
  gate: '准入闸',
  rank: '排序·名额',
  position: '仓位',
  data: '数据语义',
  display: '展示口径',
}

const KIND_TONE: Record<RuleEntry['kind'], string> = {
  gate: 'text-up',
  rank: 'text-rec',
  position: 'text-txt',
  data: 'text-sub',
  display: 'text-sub',
}

export function Component() {
  const { data, isPending, isError } = useQuery<RulesRegistryFile>({
    queryKey: ['rules'],
    queryFn: () => api.rules(),
    retry: 1,
  })
  const fired = useQuery<RulesFiredFile>({
    queryKey: ['rules-fired'],
    queryFn: () => api.rulesFired(),
    retry: 1,
  })
  const [kind, setKind] = useState<RuleEntry['kind'] | 'all'>('all')

  const groups = useMemo(() => {
    const gs = data?.groups ?? []
    return gs
      .map((g) => ({ ...g, rules: g.rules.filter((r) => kind === 'all' || r.kind === kind) }))
      .filter((g) => g.rules.length > 0)
  }, [data, kind])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const g of data?.groups ?? []) {
      for (const r of g.rules) c[r.kind] = (c[r.kind] ?? 0) + 1
    }
    return c
  }, [data])

  if (isPending) return <EmptyState text="加载判据登记表…" />
  if (isError || !data) return <EmptyState text="判据登记表读取失败" />

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="判据登记表"
        extra={<CardBadge tone="warn">{data.count} 条 · {data.updated}</CardBadge>}
      >
        <div className="text-12 leading-relaxed text-sub">
          {data.note}
          <span className="text-11">（⛔ 不在表里的判据视为不存在；新增必须先登记，进一出一。）</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setKind('all')}
            className={cn(
              'rounded border px-2 py-0.5 text-11 cursor-pointer',
              kind === 'all' ? 'border-line-strong bg-white/5 text-txt' : 'border-line text-sub',
            )}
          >
            全部 {data.count}
          </button>
          {(Object.keys(KIND_LABEL) as RuleEntry['kind'][]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'rounded border px-2 py-0.5 text-11 cursor-pointer',
                kind === k ? 'border-line-strong bg-white/5 text-txt' : 'border-line text-sub',
              )}
            >
              {KIND_LABEL[k]} {counts[k] ?? 0}
            </button>
          ))}
        </div>
      </Card>

      {fired.data && (
        <Card
          title="今日命中"
          extra={<CardBadge tone="warn">{fired.data.date} · 买 {fired.data.bought}/{fired.data.total_views}</CardBadge>}
        >
          <div className="flex flex-col gap-1.5">
            {fired.data.fired.length === 0 && (
              <div className="text-12 text-sub">今天没有任何判据拦票（全过或全买）。</div>
            )}
            {fired.data.fired.map((f) => (
              <div key={f.id} className="flex flex-wrap items-baseline gap-2 text-12">
                <span className="text-txt">{f.name}</span>
                <span className="num text-11 text-sub">{f.id}</span>
                <span className="num text-12 font-semibold text-up">×{f.hits}</span>
                <span className="num text-10 text-sub">{f.codes.join(' ')}</span>
              </div>
            ))}
            {fired.data.zero_hit.length > 0 && (
              <div className="mt-1 text-11 text-sub">
                ⚠️ 今日零命中（待删候选，不是错误）：{fired.data.zero_hit.join('、')}
              </div>
            )}
            <div className="text-11 text-sub">
              三态分布：{Object.entries(fired.data.by_state).map(([k, v]) => `${k || '未标'} ${v}`).join(' · ')}
              {fired.data.substitutes.length > 0 && `｜替补 ${fired.data.substitutes.length} 只`}
            </div>
          </div>
        </Card>
      )}

      {groups.map((g) => (
        <Card key={g.name} title={g.name} extra={<CardBadge>{g.rules.length} 条</CardBadge>}>
          <div className="flex flex-col divide-y divide-line">
            {g.rules.map((r) => (
              <div key={r.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-12 font-semibold text-txt">{r.name}</span>
                  <span className={cn('text-10', KIND_TONE[r.kind])}>{KIND_LABEL[r.kind]}</span>
                  <span className="num text-10 text-sub">{r.id}</span>
                  {r.switch !== '—' && (
                    <code className="rounded bg-line-faint px-1 py-0.5 text-10 text-txt">
                      {r.switch}={r.default}
                    </code>
                  )}
                  {r.since !== '—' && <span className="text-10 text-sub">自 {r.since}</span>}
                </div>
                <div className="text-12 leading-relaxed text-sub">{r.what}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-10 text-sub">
                  {r.source && <span>依据：{r.source}</span>}
                  {r.rollback !== '—' && <span>回退：{r.rollback}</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
