import type { ParticipationQuotes, DecisionDossier, PoolCallFile, PoolLedger, ScreenFile } from '@/shared/api'
import { useState } from 'react'
import { SegTabs } from '@/features/analytics'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { BuyPlan } from './BuyPlan'
import { EnvPanel } from './EnvPanel'
import { PickCard } from './PickCard'
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
function PoolSection({
  title,
  badge,
  stocks,
  bucket,
  marketMaxBoards,
  emptyText,
}: {
  title: string
  badge: string
  stocks: DecisionDossier['relay']
  bucket: 'relay' | 'watch'
  marketMaxBoards?: number | null
  emptyText: string
}) {
  return (
    <Card
      title={title}
      extra={
        <CardBadge tone={stocks.length ? (bucket === 'relay' ? 'up' : 'neutral') : 'neutral'}>{badge}</CardBadge>
      }
    >
      {stocks.length ? (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {stocks.map((s, i) => (
            <PickCard
              key={s.code}
              stock={s}
              bucket={bucket}
              rank={bucket === 'relay' ? (s.relay_rank ?? i + 1) : (s.watch_rank ?? i + 1)}
              marketMaxBoards={marketMaxBoards}
            />
          ))}
        </div>
      ) : (
        <div className="py-3 text-center text-12 text-sub">{emptyText}</div>
      )}
    </Card>
  )
}

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
  // 今日 / 明日 两个 tab（2026-11-16 用户要求分开）。
  // 自动切换口径（用户第二次更正）：**过了午夜 00:00** 才默认「明日」——
  //   白天到当晚 24:00 之前都看「今日」；跨过零点，预案就成了"今天要做的事"，
  //   默认切到「明日标的」（内容仍是昨晚收盘写的那份，等下一个收盘再刷新）。
  // ⛔ Hook 必须在早退之前调用（rules of hooks）。
  const [tab, setTab] = useState<'today' | 'tomorrow'>(() => {
    const today = new Date().toISOString().slice(0, 10)
    const dossierDate = String(dossier?.date ?? '')
    return dossierDate && today > dossierDate ? 'tomorrow' : 'today'
  })

  if (!dossier) {
    return (
      <div className="flex flex-col gap-3">
        <TodayVerdict callFile={callFile} ledger={ledger} />
        <PoolLedgerCard callFile={callFile} ledger={ledger} quotes={quotes} participateCount={callFile?.meta?.participate?.length} />
        <EmptyState text="本期决策档案未生成" hint="wealth_code/cache/candidates-<日期>.json 未生成" />
      </div>
    )
  }

  void _screen
  const relay = dossier.relay ?? []
  const watch = dossier.watch ?? []

  /**
   * 今日 / 明日 分两个 tab（2026-11-16 用户：「今日策略和明日分隔开，新开一个明日 tab，
   * 过了 12 点再自动切换」）。
   *
   * 默认值的规则：**中午 12 点后默认看「明日」**（上午盘面已走完，重点转成明天怎么做）；
   * 12 点前默认「今日」。⛔ 默认值只算一次（模块级日期），手动切换后不再被时间抢回。
   */
  return (
    <div className="flex flex-col gap-3">
      <SegTabs
        items={[
          { key: 'today', label: '今日策略' },
          { key: 'tomorrow', label: `明日标的（${relay.length + watch.length}）` },
        ]}
        value={tab}
        onChange={(k) => setTab(k as 'today' | 'tomorrow')}
      />
      {tab === 'today' && (
      <>
      {/* ① 今天：买了没有 + 为什么是这个结果（全页第一眼） */}
      <TodayVerdict dossier={dossier} callFile={callFile} ledger={ledger} />

      {/* ② 今日账本：09:25 竞价价买 → 当日收盘卖（赚没赚） */}
      <PoolLedgerCard
        callFile={callFile}
        quotes={quotes}
        ledger={ledger}
        participateCount={callFile?.meta?.participate?.length ?? 0}
        effectiveQuota={callFile?.meta?.effective_quota ?? callFile?.quota}
      />

      {/* ③ 今晨竞价：读数层（只留两个能读出结论的计数） */}
      <Card title="今晨竞价" extra={<CardBadge>{callFile?.trade_date ?? '未生成'}</CardBadge>}>
        <EnvPanel callFile={callFile} />
      </Card>

      </>
      )}

      {tab === 'tomorrow' && (
      <>
      {/* ④ 明日标的：买什么、竞价落在哪、要多少钱。
          ⚠️ 日期口径：`dossier` 是**今天盘后写的预案**，执行日是**次一交易日** ——
              与上方 ①②③（今日执行日）不是同一天，⛔ 必须在卡头标明，否则会把
              「明天该买的」当成「今天买了什么」读。 */}
      <Card
        title="明日标的"
        extra={
          <span className="flex items-baseline gap-2">
            <CardBadge>{relay.length + watch.length} 只</CardBadge>
            <CardBadge tone="rec">预案 {dossier.date} · 次一交易日执行</CardBadge>
          </span>
        }
      >
        <p className="text-11 text-sub m-0 mb-1.5">
          这份是 <b className="text-txt">{dossier.date}</b> 收盘后写的，等下一次收盘再刷新。
          盘后只给<b className="text-txt">预案</b>：竞价区间、要多少钱、大概什么档位。
          <b className="text-txt">买卖结论要到明早 9:25 竞价后</b>，对整个池子统一裁一次。
        </p>
        <BuyPlan relay={relay} watch={watch} />
      </Card>

      {/* ⑤ 接力池 */}
      <PoolSection
        title="接力池"
        badge={`${relay.length} 只`}
        stocks={relay}
        bucket="relay"
        marketMaxBoards={dossier.market_max_boards}
        emptyText="今日无可接力标的 —— 接力池留空是允许的结论"
      />

      {/*
        ⑥ 观察（2026-11-11 文案）：11-10 起已合并为**单接力池**，watch 里通常只剩
        「全市场唯一且 ≥7 板」那只高度观察票。⛔ 不能再叫「观察池·不可买」——
        原观察票明早照样走 09:25 裁决（POOL_CALL_ALL_TRADEABLE=1）。
      */}
      <PoolSection
        title="观察（明早竞价判）"
        badge={`${watch.length} 只`}
        stocks={watch}
        bucket="watch"
        marketMaxBoards={dossier.market_max_boards}
        emptyText="无观察标的"
      />
      </>
      )}
    </div>
  )
}
