import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import type {
  ArchiveIndexEntry,
  EngineStateFile,
  LearningConfig,
  RuleConfigFile,
  ShortSpiritConfig,
} from '@/shared/api'
import {
  analyticsQueries,
  DataTable,
  SegTabs,
  StatPair,
  Tag,
  fileDate,
  n1,
  parseTaskLedger,
} from '@/features/analytics'
import { Card, CardBadge, EmptyState, Zone, ZoneRow } from '@/shared/ui'
import { cn, staleLabel } from '@/shared/lib'

/**
 * 系统台账 —— 把这个量化系统**自身**的运行配置与状态摊开。
 *
 * ## 为什么要有这一页
 *
 * 其余 23 页展示的都是「市场」（涨停、题材、资金、决策）；
 * 但一个自己写脚本、自己排任务的系统，最容易出问题的恰恰是**它自己**：
 * 哪个任务还挂在那儿、阈值被改成多少了、引擎状态件是不是卡死了、
 * 上一次备份是什么时候。这些信息原先只能靠读文件与跑脚本获得。
 *
 * ## 三块内容的性质完全不同，不要混读
 *
 *   · **任务台账 / 配置**（日频）—— 「规则是什么」，人工改动的结果，不常变
 *   · **盘中引擎状态**（盘中 60s）—— 「引擎现在在记什么」，随盘面滚动
 *   · **备份 / 存档索引**（日频）—— 「历史留了哪些底」，用于回滚与追溯
 *
 * ⛔ 安全铁律（本页的敏感点）：`config/` 目录里 `settings.json` 与 `app_config.yaml`
 *    都含**明文飞书 webhook / BIYING_TOKEN**。本页只消费**显式单文件路由**，
 *    绝不按目录通配去读 `config/`；`cache/backups` 也走前缀**白名单**
 *    （该目录存在 `settings.json.bak_*`，通配会把它一起漏出来）。
 */

/** 星期码 → 中文（用于把 rrule 讲成人话） */
const DOW: Record<string, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
}

/**
 * rrule → 人话（**只做展示，不改写原文**）。
 *
 * 原文仍以 `title` 属性挂在单元格上 —— 因为这是运维页，
 * 排查调度问题时必须能拿到原始值，人话只是加速扫读。
 */
function describeRrule(r: string | undefined): string {
  if (!r) return '—'
  const get = (k: string) => r.match(new RegExp(`${k}=([^;]+)`))?.[1]
  const hh = get('BYHOUR')
  const mm = get('BYMINUTE')
  const time = hh != null && mm != null ? `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}` : ''
  const byday = get('BYDAY')
  let days = ''
  if (byday) {
    const ds = byday.split(',')
    days =
      ds.length === 5 && ds.every((d) => ['MO', 'TU', 'WE', 'TH', 'FR'].includes(d))
        ? '周一至周五'
        : ds.map((d) => `周${DOW[d] ?? d}`).join('/')
  }
  const head = `${days}${days && time ? ' ' : ''}${time}`
  return head || r
}

/** 一个值 → 单行可读文本（对象/数组只给规模，不展开 —— 展开会撑爆表格） */
function brief(v: unknown): string {
  if (v == null) return '—'
  if (Array.isArray(v)) return `${v.length} 项`
  if (typeof v === 'object') return `${Object.keys(v as object).length} 键`
  return String(v)
}

/**
 * 键值对展示（配置类数据的通用形态）。
 *
 * ⚠️ 刻意**不做二级展开**：这些配置对象里嵌着阈值表，
 *    展开后会变成一整屏小字而失去可扫读性。嵌套值只报「N 键 / N 项」，
 *    需要细节时去读原文件 —— 本页的职责是「一览」不是「全文」。
 */
function KeyVals({ obj, depth = 0 }: { obj: Record<string, unknown>; depth?: number }) {
  const entries = Object.entries(obj)
  if (entries.length === 0) return <span className="text-sub text-12">（空）</span>
  return (
    <div className={cn('flex flex-col', depth > 0 && 'pl-3')}>
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-3 py-1 border-b border-line-faint last:border-0"
        >
          <span className="num text-12 text-sub break-all">{k}</span>
          <span className="text-12 text-txt text-right">{brief(v)}</span>
        </div>
      ))}
    </div>
  )
}

export async function loader() {
  // 单路失败不拖垮整页（与 /timeline 同口径）
  await Promise.allSettled([
    queryClient.ensureQueryData(analyticsQueries.systemTasks()),
    queryClient.ensureQueryData(analyticsQueries.systemLearning()),
    queryClient.ensureQueryData(analyticsQueries.systemShortSpirit()),
    queryClient.ensureQueryData(analyticsQueries.systemRules()),
    queryClient.ensureQueryData(analyticsQueries.systemEngine()),
    queryClient.ensureQueryData(analyticsQueries.systemBackups()),
    queryClient.ensureQueryData(analyticsQueries.systemArchiveIndex()),
  ])
  return null
}

export function Component() {
  const tasksQ = useQuery(analyticsQueries.systemTasks())
  const learnQ = useQuery(analyticsQueries.systemLearning())
  const spiritQ = useQuery(analyticsQueries.systemShortSpirit())
  const rulesQ = useQuery(analyticsQueries.systemRules())
  const engineQ = useQuery(analyticsQueries.systemEngine())
  const backupsQ = useQuery(analyticsQueries.systemBackups())
  const indexQ = useQuery(analyticsQueries.systemArchiveIndex())

  const [ruleFile, setRuleFile] = useState('')

  /** 任务台账：原始 YAML 文本 → 条目（解析只认子集，详见 parseTaskLedger） */
  const tasks = useMemo(() => parseTaskLedger(tasksQ.data), [tasksQ.data])
  const learn: LearningConfig | undefined = learnQ.data
  const spirit: ShortSpiritConfig | undefined = spiritQ.data

  const ruleFiles = useMemo(
    () => (rulesQ.data ?? []).filter((f) => !!f.data).sort((a, b) => b.file.localeCompare(a.file)),
    [rulesQ.data],
  )
  const activeRule: RuleConfigFile | null | undefined =
    ruleFiles.find((f) => f.file === ruleFile)?.data ?? ruleFiles[0]?.data

  const engineFiles = useMemo(
    () => (engineQ.data ?? []).filter((f) => f.data).sort((a, b) => a.file.localeCompare(b.file)),
    [engineQ.data],
  )

  const backups = useMemo(
    () => (backupsQ.data ?? []).filter((f) => f.data).sort((a, b) => b.file.localeCompare(a.file)),
    [backupsQ.data],
  )

  const indexRows: ArchiveIndexEntry[] = indexQ.data ?? []

  /** 带 rrule 的任务数 —— 没有 rrule 的通常是在平台已停用、只在台账里留档的 */
  const liveTasks = tasks.filter((t) => !!t.rrule).length

  return (
    <div className="flex flex-col gap-3">
      {/* ── 概览：系统自身的规模与新鲜度 ── */}
      <Card
        title="🧭 系统台账"
        extra={<CardBadge>把这套系统自身的配置与状态摊开</CardBadge>}
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <StatPair label="台账任务" value={tasks.length} />
          <StatPair label="其中有调度" value={liveTasks} tone="up" />
          <StatPair label="策略规则" value={ruleFiles.length} />
          <StatPair label="引擎状态件" value={engineFiles.length} />
          <StatPair label="备份快照" value={backups.length} />
          <StatPair label="存档期数" value={indexRows.length} />
        </div>
        <div className="text-sub text-12 mt-2 leading-relaxed">
          本页只读原系统落盘的配置文件与小状态件，不含任何写操作。
          ⛔ `config/settings.json` 与 `config/app_config.yaml`（含飞书 webhook /
          BIYING_TOKEN 明文密钥）**刻意不接入**；`cache/backups` 走前缀白名单，
          避免把 `settings.json.bak_*` 一并暴露。
        </div>
      </Card>

      {/* ── 任务台账 + 阈值配置 ── */}
      <ZoneRow>
        <Zone label="自动化任务台账 · config/tasks.yaml" dot="bg-lead" className="xl:w-[62%]">
          <Card
            title="🗂 自动化任务台账"
            extra={<CardBadge>{tasks.length} 条</CardBadge>}
          >
            {tasks.length === 0 ? (
              <EmptyState
                text="任务台账未读到"
                hint="config/tasks.yaml 缺失，或格式超出解析器支持的子集"
              />
            ) : (
              <div className="max-h-[520px] overflow-y-auto">
                <DataTable
                  dense
                  rows={tasks}
                  rowKey={(t) => t.id || t.name}
                  columns={[
                    {
                      label: '任务名',
                      cell: (t) => (
                        <span className={cn('text-txt', !t.rrule && 'text-sub')}>{t.name}</span>
                      ),
                    },
                    { label: '骨架', cell: (t) => <Tag>{t.kind}</Tag> },
                    {
                      label: '调度',
                      className: 'whitespace-nowrap',
                      cell: (t) => (
                        <span className="num text-12" title={t.rrule ?? '无 rrule（平台侧可能已停用）'}>
                          {describeRrule(t.rrule)}
                        </span>
                      ),
                    },
                    {
                      label: '推送',
                      cell: (t) => <span className="text-sub">{t.webhook || '—'}</span>,
                    },
                    {
                      label: '写回',
                      cell: (t) => <span className="text-sub">{t.writeback || '—'}</span>,
                    },
                    {
                      label: 'automation id',
                      className: 'whitespace-nowrap',
                      cell: (t) => (
                        <span className="num text-11 text-sub">{t.id || '—'}</span>
                      ),
                    },
                  ]}
                />
              </div>
            )}
            <div className="text-sub text-11 mt-2 leading-relaxed">
              原始文件是 YAML，路由按**文本**透传、前端只解析所需子集（name/id/kind/rrule/
              webhook/writeback）。无「调度」的行 = 台账留档但平台侧已停用。
              ⛔ 改调度只改 `config/tasks.yaml` + 平台任务两处，不在页面里改。
            </div>
          </Card>
        </Zone>

        <Zone label="阈值配置 · 自学习与短线精灵" dot="bg-rec" className="xl:w-[38%]">
          <div className="flex flex-col gap-2.5">
            <Card
              title="🧪 自学习阈值（learning_config）"
              extra={<CardBadge>{learn ? fileDate(learn.updated) : '—'}</CardBadge>}
            >
              {!learn ? (
                <EmptyState text="未读到 config/learning_config.json" />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                    <StatPair
                      label="允许自动写回"
                      value={learn.auto_apply ? '是' : '否'}
                      tone={learn.auto_apply ? 'warn' : 'sub'}
                    />
                    <StatPair label="单次步长上限" value={n1(learn.max_adjust_step)} />
                    <StatPair label="统计窗口" value={`${learn.window_days} 日`} />
                    <StatPair label="规则数" value={Object.keys(learn.rules ?? {}).length} />
                  </div>
                  <div className="border-t border-line-faint pt-2">
                    <div className="text-11 text-sub mb-1">规则清单</div>
                    <KeyVals obj={learn.rules ?? {}} />
                  </div>
                  {learn.note && (
                    <div className="text-sub text-11 leading-relaxed border-t border-line-faint pt-1.5">
                      {learn.note}
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card title="⚡ 短线精灵阈值（short_spirit）" extra={<CardBadge>可调参数</CardBadge>}>
              {!spirit ? (
                <EmptyState text="未读到 config/short_spirit.json" />
              ) : (
                <KeyVals obj={spirit as unknown as Record<string, unknown>} />
              )}
            </Card>
          </div>
        </Zone>
      </ZoneRow>

      {/* ── 策略规则 + 盘中引擎状态 ── */}
      <ZoneRow>
        <Zone label="策略规则配置 · wealth_code/config" dot="bg-lead" className="xl:w-[56%]">
          <Card
            title="📐 策略规则"
            extra={
              <div className="flex items-center gap-2">
                {ruleFiles.length > 1 && (
                  <SegTabs
                    items={ruleFiles.map((f) => ({
                      key: f.file,
                      label: f.file.replace(/[.]json$/, '').replace(/_(rules|config)$/, ''),
                    }))}
                    value={ruleFiles.find((f) => f.data === activeRule)?.file ?? ''}
                    onChange={setRuleFile}
                  />
                )}
                <CardBadge>{ruleFiles.length} 份</CardBadge>
              </div>
            }
          >
            {!activeRule ? (
              <EmptyState text="未读到 wealth_code/config/*.json" />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {activeRule.schema && <Tag tone="up">{activeRule.schema}</Tag>}
                  {activeRule.version && <Tag>v{activeRule.version}</Tag>}
                  {activeRule.updated && (
                    <span className="num text-12 text-sub">更新 {activeRule.updated}</span>
                  )}
                </div>
                {activeRule.note && (
                  <div className="text-12 text-sub leading-relaxed">{activeRule.note}</div>
                )}
                {activeRule.desc && (
                  <div className="text-12 text-sub leading-relaxed">{activeRule.desc}</div>
                )}
                <div className="border-t border-line-faint pt-2">
                  <KeyVals
                    obj={Object.fromEntries(
                      Object.entries(activeRule).filter(
                        ([k]) => !['schema', 'note', 'desc', 'version', 'updated'].includes(k),
                      ),
                    )}
                  />
                </div>
              </div>
            )}
          </Card>
        </Zone>

        <Zone label="盘中引擎状态件（含历史留档）" dot="bg-warn" className="xl:w-[44%]">
          <Card
            title="⚙️ 盘中引擎状态"
            extra={<CardBadge>{engineFiles.length} 件</CardBadge>}
          >
            {engineFiles.length === 0 ? (
              <EmptyState text="未读到引擎状态件（cache/pulse_snapshots 下 4 件）" />
            ) : (
              <div className="flex flex-col gap-2.5">
                {engineFiles.map((f) => {
                  const d = f.data as EngineStateFile
                  const keys = Object.entries(d).filter(([k]) => k !== 'ts' && k !== 'date')
                  return (
                    <div key={f.file} className="border border-line-faint rounded-sm px-2 py-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="num text-12 font-semibold text-txt">
                          {f.file.replace(/[.]json$/, '')}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="num text-11 text-sub">
                            {typeof d.ts === 'number'
                              ? new Date(d.ts * 1000).toLocaleString('zh-CN', { hour12: false })
                              : d.date || '—'}
                          </span>
                          {staleLabel(typeof d.date === 'string' ? d.date : null, 3) && (
                            <span className="badge bg-warn-soft text-warn">
                              {staleLabel(typeof d.date === 'string' ? d.date : null, 3)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-1">
                        <KeyVals obj={Object.fromEntries(keys)} />
                      </div>
                    </div>
                  )
                })}
                <div className="text-sub text-11 leading-relaxed">
                  ⚠️ 这几件是**盘中引擎自己的工作状态**（加速名单 / 待推队列 / 板块风险缓存 /
                  资金池），不是行情数据 —— 排查「为什么没推送 / 推重了」时先看这里。
                </div>
              </div>
            )}
          </Card>
        </Zone>
      </ZoneRow>

      {/* ── 备份 + 存档索引 ── */}
      <ZoneRow>
        <Zone label="备份快照 · 白名单" dot="bg-mid" className="xl:w-[56%]">
          <Card title="💾 备份快照" extra={<CardBadge>{backups.length} 份</CardBadge>}>
            {backups.length === 0 ? (
              <EmptyState text="未读到备份（cache/backups）" />
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                <DataTable
                  dense
                  rows={backups}
                  rowKey={(b) => b.file}
                  columns={[
                    {
                      label: '文件',
                      cell: (b) => <span className="num text-12 text-txt">{b.file}</span>,
                    },
                    {
                      label: '内容规模',
                      num: true,
                      cell: (b) => (
                        <span className="text-sub">
                          {Array.isArray(b.data)
                            ? `${b.data.length} 条`
                            : b.data && typeof b.data === 'object'
                              ? `${Object.keys(b.data as object).length} 键`
                              : '—'}
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            )}
            <div className="text-sub text-11 mt-2 leading-relaxed">
              仅放行 `nav_` / `ai_decisions_` / `learning_rollback_` 三类前缀。
              ⛔ 该目录下存在 `settings.json.bak_*`（含 webhook 明文），
              故路由用前缀白名单而非 `*.json` 通配。
            </div>
          </Card>
        </Zone>

        <Zone label="决策存档索引 · 黑匣子总目录" dot="bg-lead" className="xl:w-[44%]">
          <Card
            title="🗃 存档索引"
            extra={<CardBadge>{indexRows.length} 期</CardBadge>}
          >
            {indexRows.length === 0 ? (
              <EmptyState text="未读到 cache/decision_log/index.jsonl" />
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                <DataTable
                  dense
                  rows={[...indexRows].sort((a, b) => b.date.localeCompare(a.date))}
                  rowKey={(r) => r.date}
                  columns={[
                    {
                      label: '日期',
                      className: 'whitespace-nowrap',
                      cell: (r) => <span className="num text-12 text-txt">{r.date}</span>,
                    },
                    { label: '来源', num: true, cell: (r) => <span className="num">{r.sources}</span> },
                    { label: '接力', num: true, cell: (r) => <span className="num">{r.relay}</span> },
                    { label: '观察', num: true, cell: (r) => <span className="num">{r.watch}</span> },
                    { label: '卡片', num: true, cell: (r) => <span className="num">{r.cards}</span> },
                    {
                      // 缺口 ≠ 0 才着色：缺口是「该日存档不全」的证据，直接影响复盘可信度
                      label: '缺口',
                      num: true,
                      cell: (r) => (
                        <span className={cn('num', r.gaps > 0 ? 'text-down font-semibold' : 'text-sub')}>
                          {r.gaps}
                        </span>
                      ),
                    },
                    {
                      label: '归档于',
                      className: 'whitespace-nowrap',
                      cell: (r) => <span className="num text-11 text-sub">{r.archived_at}</span>,
                    },
                  ]}
                />
              </div>
            )}
            <div className="text-sub text-11 mt-2 leading-relaxed">
              「缺口」= 该日归档缺失的来源数。缺口 &gt; 0 的日子，当时的决策输入本来就不全，
              复盘时必须打折看待。
            </div>
          </Card>
        </Zone>
      </ZoneRow>
    </div>
  )
}
