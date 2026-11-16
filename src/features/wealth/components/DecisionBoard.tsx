import { useState } from 'react'
import type { ParticipationQuotes, DecisionDossier, PoolCallFile, PoolLedger, ScreenFile } from '@/shared/api'
import { DataTable } from '@/features/analytics'
import { boardsText } from '@/features/wealth/lib/format'
import { cn } from '@/shared/lib'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { buyCondition } from './BuyPlan'
import { PickCard } from './PickCard'
import { EnvPanel } from './EnvPanel'
import { PoolLedgerCard } from './PoolLedgerCard'
import { TodayVerdict } from './TodayVerdict'

/**
 * 财富密码决策档案 —— 按用户的**四个真问题**排，不再按数据表排。
 *
 * ## 2026-11-06 用户原话
 *
 * 「不要那些看不懂的指标，其他的你看着优化一下，总之目的方便我看
 *  **买什么、赚没赚、为什么买、为什么没买**」
 *
 * 于是版面顺序直接对回这四句话：
 *
 * | 屏上位置 | 回答 | 组件 |
 * |---|---|---|
 * | ① 今天 | **买了没有 / 为什么是这个结果** | `TodayVerdict` |
 * | ② 今日账本 | **赚没赚**（09:25 竞价价买 → 收盘卖） | `PoolLedgerCard` |
 * | ③ 今晨竞价 | 昨天涨停那批今早还有没有人接（读数层） | `EnvPanel` |
 * | ④ 明日标的 | **买什么**（竞价区间 / 竞价额 / 结论） | `BuyPlan` |
 * | ⑤ 接力池 / 观察池 | 逐票为什么是它 | `PickCard` |
 *
 * ## 与前一版的差别（⛔ 别默默改回去）
 *
 * · 「环境体检」不再占整排：出手结论并入 ①，读数只留两个红开计数（③）。
 *   —— 原来一半内容是 `/emotion` 整页已有的东西，另一半是看不懂的比率。
 * · 账本从「不存在」变成第 ② 块：它是全页唯一的事后证据，
 *   没有它，用户永远只能看到「准备买什么」，看不到「买了会怎样」。
 * · 全量过筛仍**不在此页**（调参诊断层，2026-11-04 已移到 AI 页「诊断」tab）。
 *
 * ⛔ 三个池区一律**单排铺满**，不分左右窄栏 —— 卡片横向排布本身就是对照。
 */

export function DecisionBoard({
  dossier,
  callFile,
  ledger,
  quotes,
  screen: _screen,
}: {
  dossier?: DecisionDossier
  callFile?: PoolCallFile
  /** 与 `callFile.trade_date` 同日的收盘结算；取不到就是「未生成」，⛔ 不回落昨日 */
  ledger?: PoolLedger
  quotes?: ParticipationQuotes
  // ⛔ `screen` 已不在此页渲染（移到 AI 页「诊断」tab），保留参数只为不破坏既有调用方。
  screen?: ScreenFile
}) {
  void _screen
  if (!dossier) {
    return (
      <div className="flex flex-col gap-3">
        <TodayVerdict callFile={callFile} ledger={ledger} />
        <PoolLedgerCard callFile={callFile} ledger={ledger} quotes={quotes} participateCount={callFile?.meta?.participate?.length} />
        <EmptyState text="本期决策档案未生成" hint="wealth_code/cache/candidates-<日期>.json 未生成" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <TodayVerdict dossier={dossier} callFile={callFile} ledger={ledger} />
      <PoolLedgerCard
        callFile={callFile}
        quotes={quotes}
        ledger={ledger}
        participateCount={callFile?.meta?.participate?.length ?? 0}
        effectiveQuota={callFile?.meta?.effective_quota ?? callFile?.quota}
      />
      <Card title="今晨竞价" extra={<CardBadge>{callFile?.trade_date ?? '未生成'}</CardBadge>}>
        <EnvPanel callFile={callFile} />
      </Card>
    </div>
  )
}

/**
 * 明日策略 —— 页面顶部独立 tab（2026-11-16 用户：不要在今日链路里再开「今日/明日」，
 * 顺序改为 今日、明日、尾盘、竞价、执行）。
 *
 * 内容：明日标的（每只票都给「什么情况下买」）+ 接力池 + 观察（明早竞价判）。
 * ⛔ 只呈现预案；买卖结论等当天 09:25 竞价后统一裁定。
 */
export function TomorrowBoard({ dossier }: { dossier?: DecisionDossier }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  if (!dossier) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState text="本期决策档案未生成" hint="wealth_code/cache/candidates-<日期>.json 未生成" />
      </div>
    )
  }
  const relay = dossier.relay ?? []
  const watch = dossier.watch ?? []
  const rows = [...relay, ...watch].filter(
    (s, i, arr) => arr.findIndex((x) => x.code === s.code) === i,
  )

  const toggle = (row: DecisionDossier['relay'][number], key: string) => {
    const next = new Set(open)
    // 子级内容按「代码」存，避免行序变化后展开错行
    if (next.has(row.code)) next.delete(row.code)
    else next.add(row.code)
    setOpen(next)
    void key
  }
  void toggle

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="明日标的"
        extra={
          <span className="flex items-baseline gap-2">
            <CardBadge>{rows.length} 只</CardBadge>
            <CardBadge tone="rec">预案 {dossier.date} · 次一交易日执行</CardBadge>
          </span>
        }
      >
        <p className="text-11 text-sub m-0 mb-1.5">
          <b className="text-txt">一级＝今天的涨停事实</b>（板数 / 身位 / 封板 / 晋级率 / 涨停原因）；
          <b className="text-txt">点开二级＝明天的竞价预案</b>（竞价落在哪、什么情况下买、要多少钱）。
          这份是 <b className="text-txt">{dossier.date}</b> 收盘后写的，等下一次收盘再刷新；
          买卖结论要到明早 9:25 竞价后统一裁。
        </p>
        <DataTable
          rows={rows}
          rowKey={(r) => r.code}
          dense
          empty="本期无候选 —— 接力池留空是允许的结论，不是数据缺失"
          expandedKeys={open}
          onToggleRow={(row) => {
            const next = new Set(open)
            if (next.has(row.code)) next.delete(row.code)
            else next.add(row.code)
            setOpen(next)
          }}
          renderExpanded={(r) => (
            <div className="flex flex-col gap-2">
              {/* 原始卡片全量数据（方向/身位/封板/…），先全部保留，按用户要求后面再删 */}
              <PickCard
                stock={r}
                bucket={r.watch_group ? 'watch' : 'relay'}
                rank={r.relay_rank ?? r.watch_rank ?? undefined}
                marketMaxBoards={dossier.market_max_boards}
              />
              <PlanDetail s={r} />
            </div>
          )}
          columns={[
            {
              label: '标的',
              cell: (r) => (
                <span className="flex items-baseline gap-1.5">
                  <span className="text-txt font-semibold">{r.name}</span>
                  <span className="num text-11 text-sub">{r.code}</span>
                  {r.watch_group === '板块核心观察' && <CardBadge>核心</CardBadge>}
                </span>
              ),
            },
            { label: '板数', num: true, cell: (r) => boardsText(r.boards) },
            {
              label: '身位',
              num: true,
              cell: (r) =>
                r.dragon_rank == null ? <span className="text-sub">—</span> : `第 ${r.dragon_rank}`,
            },
            {
              label: '封板',
              num: true,
              cell: (r) => (
                <span className="text-sub">
                  {r.cje_yi == null ? '—' : `${r.cje_yi.toFixed(2)} 亿`}
                  {r.seal_ratio_pct != null ? ` · 占流通 ${r.seal_ratio_pct.toFixed(2)}%` : ''}
                </span>
              ),
            },
            {
              label: '晋级率',
              num: true,
              cell: (r) => {
                const cp = (r as { conditional_promotion?: { quality?: string; rate?: number } }).conditional_promotion
                const rate = cp?.rate
                const ok = cp?.quality === 'ok'
                return (
                  <span className={cn('num', !ok ? 'text-sub' : (rate ?? 0) >= 30 ? 'text-up' : 'text-warn')}>
                    {ok && rate != null ? `${rate.toFixed(1)}%` : '—'}
                  </span>
                )
              },
            },
            {
              label: '涨停原因',
              className: 'whitespace-normal min-w-[260px]',
              cell: (r) => (
                <span className="text-sub text-12">{r.limit_up_reason || '—'}</span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}

/** 二级：明天的竞价预案（区间 / 条件 / 金额 / 身位说明） */
function PlanDetail({ s }: { s: DecisionDossier['relay'][number] }) {
  const r = s.expectation?.expected_range
  const lo = Array.isArray(r) && r.length === 2 ? Number(r[0]) : null
  const hi = Array.isArray(r) && r.length === 2 ? Number(r[1]) : null
  const amt = s.expectation?.auction_amount_min_yi
  const stars = (s as { conditional_promotion?: { quality?: string; rate?: number; n?: number } }).conditional_promotion
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-12 md:grid-cols-2">
      <span>
        <span className="text-sub">竞价落在　</span>
        <b className="num text-txt">
          {lo != null && hi != null ? `${lo.toFixed(1)}% ~ ${hi.toFixed(1)}%` : '未给出'}
        </b>
      </span>
      <span>
        <span className="text-sub">什么情况下买　</span>
        <span className="text-txt">{buyCondition(s)}</span>
      </span>
      <span>
        <span className="text-sub">竞价额要够　</span>
        <b className="num text-txt">{typeof amt === 'number' && amt > 0 ? `${amt.toFixed(2)} 亿` : '—'}</b>
      </span>
      <span>
        <span className="text-sub">身位　</span>
        <span className="text-txt">
          {s.dragon_rank == null ? '—' : `方向内第 ${s.dragon_rank}`}
          {s.theme_mates_cnt ? ` · 同题材 ${s.theme_mates_cnt} 家` : ' · 独苗'}
          {stars?.quality === 'ok' && stars.rate != null ? ` · 晋级样本 ${stars.n} 次 ${stars.rate.toFixed(1)}%` : ''}
        </span>
      </span>
    </div>
  )
}
