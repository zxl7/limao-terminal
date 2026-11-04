import type { DecisionDossier, PoolCallFile, ScreenFile } from '@/shared/api'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { BuyPlan } from './BuyPlan'
import { EnvPanel } from './EnvPanel'
import { PickCard } from './PickCard'

/**
 * 财富密码决策档案 —— 一天的完整决策链，**五行**自上而下。
 *
 *   ① 环境结论（整排·两行）  —— 今天允不允许出手、为什么没买
 *   ② 明日标的（整排）       —— 明天怎么下单
 *   ③ 接力池（整排）         —— 可接力的票，逐票六维
 *   ④ 观察池（整排）         —— 待确认的票
 *
 * ⛔ 全量过筛**不在此页**（2026-11-04 用户「感觉没有存在必要」）：
 *    它是**调参诊断层**，不是下单依据。今天实证——过筛放行 70 只，
 *    后面被「最高板薄封」全拦掉，70 只一只没用上；而 `通过 70` 这个数字
 *    摆在决策页只会让人误以为「有 70 个机会」。已移到 AI 页独立「诊断」tab。
 *
 * ## 2026-11-04 用户定的布局
 *
 * 原布局是「顶部决策条 + 左 34% 窄栏 + 右双池 + 底部买点表」。用户要求：
 *   · 「财富密码下面的这个横条就不要了」
 *   · 「环境体检和全量过筛横向放一排，环境占左、过筛占右」
 *   · 「下面横排明日标的」「再下面接力池」「再下面观察池」
 *
 * ⛔ 横条删的是**那一整排版面**，不是数据 —— 「取向 / 名额 N→M / 实际买入」是
 *    「今天该不该出手」的唯一锚点，删掉整页就失去判断起点。已压进
 *    `EnvPanel` 卡内首行（一行小字），信息不丢、不占版面。
 * ⛔ 三个整排区一律**单排铺满**，不再分左右栏 —— 卡片横向排布本身就是对照，
 *    窄栏会让每行只放得下 1 张卡，反而更难比。
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
  // ⛔ `screen` 已不再在此页渲染（移到 AI 页「诊断」tab）。
  //    保留参数只为不破坏既有调用方与测试；`void` 掉避免 lint 报未使用。
  screen: _screen,
}: {
  dossier?: DecisionDossier
  callFile?: PoolCallFile
  screen?: ScreenFile
}) {
  if (!dossier) {
    return (
      <EmptyState
        text="本期决策档案未落盘"
        hint="wealth_code/cache/candidates-<日期>.json 未生成"
      />
    )
  }

  void _screen
  const relay = dossier.relay ?? []
  const watch = dossier.watch ?? []

  return (
    <div className="flex flex-col gap-3">
      {/* ① 环境体检（整排） —— 用户「第一排就放环境体检，拉整排，尽量压缩高度」 */}
      <Card title="环境体检" extra={<CardBadge>{dossier.date}</CardBadge>}>
        <EnvPanel dossier={dossier} callFile={callFile} />
      </Card>

      {/* ② 明日标的（整排） —— 「明天怎么下单」压成一张可横向对比的表 */}
      <Card title="明日标的" extra={<CardBadge>{relay.length + watch.length} 只</CardBadge>}>
        <BuyPlan relay={relay} watch={watch} />
      </Card>

      {/* ③ 接力池（整排） */}
      <PoolSection
        title="接力池"
        badge={`${relay.length} 只`}
        stocks={relay}
        bucket="relay"
        marketMaxBoards={dossier.market_max_boards}
        emptyText="今日无可接力标的 —— 接力池留空是允许的结论"
      />

      {/* ④ 观察池（整排） */}
      <PoolSection
        title="观察池"
        badge={`${watch.length} 只`}
        stocks={watch}
        bucket="watch"
        marketMaxBoards={dossier.market_max_boards}
        emptyText="无观察标的"
      />

    </div>
  )
}
