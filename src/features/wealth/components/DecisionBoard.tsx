import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ParticipationQuotes, DecisionDossier, PoolCallFile, PoolLedger, ScreenFile } from '@/shared/api'
import { Tag } from '@/features/analytics'
import { AntDescriptions, AntdProvider, AntDrawer, AntTable } from '@/shared/ui/antd'
import { boardsText } from '@/features/wealth/lib/format'
import { cn } from '@/shared/lib'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { buyCondition } from './BuyPlan'
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
  const [picked, setPicked] = useState<DecisionDossier['relay'][number] | null>(null)
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
        <AntdProvider>
          <AntTable
            rowKey="code"
            size="small"
            bordered
            pagination={false}
            locale={{ emptyText: '本期无候选 —— 接力池留空是允许的结论，不是数据缺失' }}
            dataSource={rows as unknown as Array<Record<string, unknown>>}
            sticky
            onRow={(r) => ({
              onClick: () => setPicked(r as unknown as DecisionDossier['relay'][number]),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: '标的',
                dataIndex: 'name',
                render: (_v, r) => {
                  const row = r as unknown as DecisionDossier['relay'][number]
                  return (
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-txt font-semibold">{row.name}</span>
                      <span className="num text-11 text-sub">{row.code}</span>
                      {row.watch_group === '板块核心观察' && <CardBadge>核心</CardBadge>}
                    </span>
                  )
                },
              },
              { title: '板数', dataIndex: 'boards', align: 'right', width: 72, render: (v) => boardsText(Number(v)) },
              {
                title: '身位',
                dataIndex: 'dragon_rank',
                align: 'right',
                width: 72,
                render: (v) => (v == null ? <span className="text-sub">—</span> : `第 ${v}`),
              },
              {
                title: '封板',
                align: 'right',
                width: 190,
                render: (_v, r) => {
                  const row = r as unknown as DecisionDossier['relay'][number]
                  return (
                    <span className="text-sub">
                      {row.cje_yi == null ? '—' : `${row.cje_yi.toFixed(2)} 亿`}
                      {row.seal_ratio_pct != null ? ` · 占流通 ${row.seal_ratio_pct.toFixed(2)}%` : ''}
                    </span>
                  )
                },
              },
              {
                title: '晋级率',
                align: 'right',
                width: 90,
                render: (_v, r) => {
                  const row = r as unknown as DecisionDossier['relay'][number]
                  const cp = (row as { conditional_promotion?: { quality?: string; rate?: number } }).conditional_promotion
                  const ok = cp?.quality === 'ok'
                  const rate = cp?.rate
                  return (
                    <span className={cn('num', !ok ? 'text-sub' : (rate ?? 0) >= 30 ? 'text-up' : 'text-warn')}>
                      {ok && rate != null ? `${rate.toFixed(1)}%` : '—'}
                    </span>
                  )
                },
              },
              {
                title: '涨停原因',
                dataIndex: 'limit_up_reason',
                render: (v) => <span className="text-sub text-12">{String(v || '—')}</span>,
              },
            ]}
          />
        </AntdProvider>

        {/* 右侧抽屉：点行弹出这只票的完整明细（今日涨停事实 + 明日竞价预案） */}
        <AntDrawer
          open={!!picked}
          onClose={() => setPicked(null)}
          width={560}
          title={picked ? `${picked.name}（${picked.code}） · 明日预案` : ''}
          destroyOnClose
        >
          {picked && <PlanDetail s={picked} />}
        </AntDrawer>
      </Card>
    </div>
  )
}

/** 二级：明天的竞价预案（区间 / 条件 / 金额 / 身位说明） */
/**
 * 抽屉详情（2026-11-16 用户选 B：一级表格 + 右侧抽屉）。
 * 竖排分组：今日（涨停事实） / 明日（竞价预案），主题色 + Tag 沿用页面口径。
 */
function PlanDetail({ s }: { s: DecisionDossier['relay'][number] }) {
  const r = s.expectation?.expected_range
  const lo = Array.isArray(r) && r.length === 2 ? Number(r[0]) : null
  const hi = Array.isArray(r) && r.length === 2 ? Number(r[1]) : null
  const amt = s.expectation?.auction_amount_min_yi
  const exp = s.expectation as
    | { expected_text?: string; super_text?: string; low_text?: string; phase?: string; confidence?: number }
    | undefined
  const cp = (s as { conditional_promotion?: { quality?: string; rate?: number; n?: number } }).conditional_promotion
  const conf = exp?.confidence

  const today: DetailRow[] = [
    {
      k: '方向',
      v: () => (
        <span className="flex flex-wrap items-center gap-1">
          <Tag tone="up">{s.core_theme || s.theme || '—'}</Tag>
          <span className="text-sub">{s.theme_mates_cnt ? `同题材 ${s.theme_mates_cnt} 家` : '独苗'}</span>
        </span>
      ),
    },
    { k: '身位', v: () => (s.dragon_rank == null ? '—' : `方向内第 ${s.dragon_rank}`) },
    {
      k: '封板',
      v: () =>
        `${s.cje_yi == null ? '—' : `${s.cje_yi.toFixed(2)} 亿`}` +
        `${s.seal_ratio_pct != null ? ` · 占流通 ${s.seal_ratio_pct.toFixed(2)}%` : ''}`,
    },
    {
      k: '晋级率',
      v: () =>
        cp?.quality === 'ok' && cp.rate != null ? (
          <span className={cn('num', cp.rate >= 30 ? 'text-up' : 'text-warn')}>
            {cp.rate.toFixed(1)}%（样本 {cp.n} 次）
          </span>
        ) : (
          <span className="text-sub">样本不足</span>
        ),
    },
    { k: '涨停原因', v: () => <span className="text-txt">{s.limit_up_reason || '—'}</span> },
    { k: '带动', v: () => (s.carry_cnt ? `${s.carry_cnt} 家` : '—') },
  ]

  const tomorrow: DetailRow[] = [
    {
      k: '竞价落在',
      v: () => (
        <b className="num text-warn">
          {lo != null && hi != null ? `${lo.toFixed(1)}% ~ ${hi.toFixed(1)}%` : '未给出'}
        </b>
      ),
    },
    { k: '什么情况下买', v: () => <span className="text-txt">{buyCondition(s)}</span> },
    {
      k: '竞价额要够',
      v: () => (
        <b className="num text-rec">{typeof amt === 'number' && amt > 0 ? `${amt.toFixed(2)} 亿` : '—'}</b>
      ),
    },
    { k: '正常预期', v: () => <span className="text-sub">{exp?.expected_text || '—'}</span> },
    { k: '超预期', v: () => <span className="text-up">{exp?.super_text || '—'}</span> },
    { k: '低于预期', v: () => <span className="text-down">{exp?.low_text || '—'}</span> },
    {
      k: '情绪阶段',
      v: () => (exp?.phase ? <Tag tone="warn">{exp.phase}</Tag> : <span className="text-sub">—</span>),
    },
    {
      k: '置信度',
      v: () => (
        <span className={cn('num', (conf ?? 0) >= 0.7 ? 'text-up' : 'text-sub')}>
          {conf == null ? '—' : conf.toFixed(2)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <DetailGroup title="今日 · 涨停事实" rows={today} />
      <DetailGroup title="明日 · 竞价预案" rows={tomorrow} />
    </div>
  )
}

interface DetailRow {
  k: string
  v: () => ReactNode
}

/** 抽屉里的分组明细块（组件外定义，避免 render 期创建组件） */
function DetailGroup({ title, rows }: { title: string; rows: DetailRow[] }) {
  return (
    <AntDescriptions
      title={<span className="text-12 font-semibold text-txt">{title}</span>}
      column={1}
      size="small"
      bordered
      labelStyle={{ width: 96, background: '#fafbfd', color: '#6b7280' }}
      items={rows.map((row, i) => ({ key: String(i), label: row.k, children: row.v() }))}
    />
  )
}
