import type { ReactNode } from 'react'
import type { PoolCallFile, PoolCallView } from '@/shared/api'
import { cn } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
import { n2, pct } from '../lib/format'

/**
 * 「竞价命中逻辑」—— 回答**今天命中了哪只票、为什么是它**（2026-11-04 用户定）。
 *
 * ## 用户口径（唯一源）
 *
 * 第一版做成了「今日选出的每只票都给选股理由」被否掉，用户原话：
 * 「**不是选股逻辑，而是叫竞价命中的个股逻辑**。比如今天命中了"龙板传媒"，逻辑是：
 *   开盘传媒个股强度比较高、有1字涨停 → 所以聚焦传媒方向 → 再根据连板、量能和地位
 *   聚焦龙板传媒。**不是说你选出来那些个股都要给原因**。」
 *
 * 第二次补充（同日）：
 * 「今日其实命中了紫竹和东方海洋，但是因为某种原因，大盘情绪没有买？所以可以将这两个个股放在这里」
 * → 于是本页分两块：**已参与** 与 **命中但被市场级条件压住**。
 *
 * ## 两块的分界是硬口径，不是感觉
 *
 * | 状态 | 判据 | 含意 |
 * |---|---|---|
 * | 已参与 | `meta.participate` 含该 code | 方向 + 个股 + 市场全通过，名额内成交 |
 * | 命中但被压住 | `view=watch` ∧ `high_win_gate` 非空 ∧ **只含市场级条件**（`情绪`） | 方向与个股都成立，**是冻结不是否决** —— 市场级可被盘中新证据推翻 |
 * | 其余 watch/skip | 缺个股级条件（题材龙/量能/梯队/身位…） | ⛔ **不进本页**，不逐个解释 |
 *
 * ⛔ 市场级白名单只放「情绪」，与 `pool_call.POOL_CALL_MARKET_LEVEL` /
 *    `pipeline_eod.HIGH_WIN_MARKET_LEVEL` 同源。⛔ 不要在前端另造一套。
 * ⛔ 方向强度是**池内**口径（relay+watch），不是全市场板块强度。措辞必须带"池内"。
 * ⛔ 竞价涨停幅用 gap≥9.8%（20cm 19.8%）近似，**不等同"一字板"**。
 */

/** 市场级条件白名单 —— 与后端 `POOL_CALL_MARKET_LEVEL` 保持一致，⛔ 别加个股级 */
export const MARKET_LEVEL_CONDITIONS: readonly string[] = ['情绪']

/** 只缺市场级条件 ⇒ 属"冻结"，不是"否决" */
export function isMarketOnlyBlock(view: PoolCallView): boolean {
  const hw = view.high_win_gate
  return (
    view.view === 'watch' &&
    Array.isArray(hw) &&
    hw.length > 0 &&
    hw.every((x) => MARKET_LEVEL_CONDITIONS.includes(String(x)))
  )
}

/** 一段「步骤标题 + 内容」 */
function Step({
  no,
  title,
  tone,
  children,
}: {
  no: string
  title: string
  tone?: 'muted'
  children: ReactNode
}) {
  return (
    <div className="flex gap-2 min-w-0">
      <span
        className={cn(
          'num flex-none w-[18px] text-right text-11 font-semibold',
          tone === 'muted' ? 'text-sub' : 'text-rec',
        )}
      >
        {no}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-11 font-semibold text-sub mb-0.5">{title}</div>
        <div className="text-12 leading-relaxed text-txt break-all">{children}</div>
      </div>
    </div>
  )
}

/** 竞价涨幅是否已到涨停幅 —— 近似判断，⛔ 不等同"一字板" */
function nearLimit(gap: number | null | undefined, is20cm: boolean): boolean {
  if (typeof gap !== 'number') return false
  return gap >= (is20cm ? 19.8 : 9.8)
}

export interface ThemeStrength {
  theme: string
  total: number
  red: number
  medianGap: number | null
  atLimit: number
  maxBoards: number
}

/** 按炒作题材聚合竞价强度 —— 池内口径，⛔ 不代表全市场板块强弱 */
export function buildThemeStrength(views: Record<string, PoolCallView>): ThemeStrength[] {
  const groups = new Map<string, PoolCallView[]>()
  for (const v of Object.values(views)) {
    const theme = (v.theme_name || '').trim()
    if (!theme) continue
    const arr = groups.get(theme) ?? []
    arr.push(v)
    groups.set(theme, arr)
  }
  const out: ThemeStrength[] = []
  for (const [theme, rows] of groups) {
    const gaps = rows.map((r) => r.gap_pct).filter((x): x is number => typeof x === 'number')
    const sorted = [...gaps].sort((a, b) => a - b)
    const median =
      sorted.length === 0
        ? null
        : sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    out.push({
      theme,
      total: rows.length,
      red: gaps.filter((g) => g > 0).length,
      medianGap: median,
      atLimit: rows.filter((r) => nearLimit(r.gap_pct, r.is_20cm === true)).length,
      maxBoards: Math.max(...rows.map((r) => (typeof r.boards === 'number' ? r.boards : 0))),
    })
  }
  // 强度序：竞价涨停幅家数 → 红开家数 → 中位涨幅 → 最高板（⛔ 不引入主观"地位分"）
  return out.sort(
    (a, b) =>
      b.atLimit - a.atLimit ||
      b.red - a.red ||
      (b.medianGap ?? -99) - (a.medianGap ?? -99) ||
      b.maxBoards - a.maxBoards,
  )
}

const ZONE_LABEL: Record<string, string> = {
  ok: '落区间',
  above: '超上限',
  below: '低于下沿',
  unknown: '无量价',
}

/** 单票判断链；`blocked=true` 时第④步说"为什么没买"而不是"参与" */
function HitCard({
  view,
  strength,
  blocked,
}: {
  view: PoolCallView
  strength?: ThemeStrength
  blocked: boolean
}) {
  const sq = view.seal_quality
  // ⚠️ 变量名不能叫 `fbt`：vite 的 react-compiler 插件会把它当 fbt 宏冲突，
  //    每次 HMR 刷一屏 'Support local variables named fbt' 警告，看着像启动失败。
  const fbtTxt = typeof sq?.fbt_hm === 'number' ? String(sq.fbt_hm).padStart(4, '0') : null
  const lf = view.linkage_facts
  const volOk =
    typeof view.amount_yi === 'number' && typeof view.need_yi === 'number'
      ? view.amount_yi >= view.need_yi
      : null
  const gapToTop = typeof view.gap_to_top === 'number' ? view.gap_to_top : null

  return (
    <article
      className={cn(
        'min-w-0 rounded-[var(--radius-sm)] border p-2.5',
        blocked ? 'border-rec/30 bg-rec-soft/20' : 'border-up/30 bg-up-soft/30',
      )}
    >
      <div className="flex items-baseline gap-2 flex-wrap mb-2 min-w-0">
        <span className={cn('text-11 font-semibold', blocked ? 'text-rec' : 'text-up')}>
          {blocked ? '命中·未买' : '命中·已参与'}
        </span>
        <StockLink code={view.code} className="text-14 font-semibold text-txt">
          {view.name || view.code}
        </StockLink>
        {view.quota_rank != null && <span className="num text-11 text-sub">名额 #{view.quota_rank}</span>}
        <span className="text-sub text-11">方向</span>
        <span className="text-rec text-12 font-medium">{view.theme_name || '—'}</span>
        {typeof view.boards === 'number' && <span className="num text-11 text-sub">{view.boards} 板</span>}
        {view.leader_role && <span className="text-11 text-sub">{view.leader_role}</span>}
      </div>

      <div className="flex flex-col gap-2">
        {/* ① 方向 */}
        <Step no="①" title={`为什么先聚焦「${view.theme_name || '该方向'}」`}>
          {strength ? (
            <>
              池内该方向 <span className="num">{strength.total}</span> 只，竞价红开{' '}
              <span className="num text-up">{strength.red}</span> 只
              {strength.medianGap != null && (
                <>
                  （中位 <span className="num">{pct(strength.medianGap, 2)}</span>）
                </>
              )}
              {strength.atLimit > 0 && (
                <>
                  ，<span className="num text-up">{strength.atLimit}</span> 只竞价即涨停幅
                </>
              )}
              {typeof lf?.theme_pool_zt_count === 'number' && (
                <>
                  ；昨日该题材涨停 <span className="num">{lf.theme_pool_zt_count}</span> 家
                </>
              )}
              {lf?.eod_status === 'linked' && <span className="text-sub">，题材联动成立</span>}
              {lf?.data_quality && lf.data_quality !== 'complete_pool' && (
                <span className="text-sub">，数据完整性 {lf.data_quality}</span>
              )}
            </>
          ) : (
            <span className="text-sub">该方向无池内竞价样本，方向强度缺失</span>
          )}
        </Step>

        {/* ② 个股 */}
        <Step no="②" title="为什么落到这一只，而不是同方向其他票">
          方向内第 <span className="num font-semibold">{view.line_rank ?? '—'}</span>
          {view.line_is_core ? <span className="text-rec ml-1">（方向核心）</span> : null}
          {view.line_core && !view.line_is_core && (
            <span className="text-sub ml-1">，核心 {view.line_core.name}</span>
          )}
          {typeof view.line_max_boards === 'number' && (
            <>
              <span className="text-sub"> · 方向最高 </span>
              <span className="num">{view.line_max_boards}</span> 板
              {view.line_tops?.length ? <span className="text-sub">（{view.line_tops.join('/')}）</span> : null}
              {gapToTop != null && <span className="text-sub">，身位差 {gapToTop}</span>}
            </>
          )}
          {typeof view.carry_cnt === 'number' && (
            <>
              <span className="text-sub"> · 带动 </span>
              <span className="num">{view.carry_cnt}</span>
              <span className="text-sub"> 家</span>
            </>
          )}
          {typeof view.market_max_boards === 'number' && (
            <span className="text-sub"> · 全市场最高 {view.market_max_boards} 板</span>
          )}
          {view.line_tier_why && <div className="text-11 text-sub mt-0.5">{view.line_tier_why}</div>}
        </Step>

        {/* ③ 量能与封板 */}
        <Step no="③" title="量能与封板是否支持参与">
          竞价 <span className="num">{n2(view.amount_yi)}</span>/
          <span className="num">{n2(view.need_yi)}</span> 亿
          {volOk != null && (
            <span className={cn('ml-1', volOk ? 'text-up' : 'text-down')}>{volOk ? '达标' : '不足'}</span>
          )}
          {fbtTxt && (
            <>
              <span className="text-sub"> · 昨首封 </span>
              <span className="num">
                {fbtTxt.slice(0, 2)}:{fbtTxt.slice(2, 4)}
              </span>
            </>
          )}
          {typeof sq?.seal_ratio_pct === 'number' && (
            <>
              <span className="text-sub"> · 封单占流通 </span>
              <span className="num">{sq.seal_ratio_pct.toFixed(2)}%</span>
            </>
          )}
          {typeof sq?.hs_pct === 'number' && (
            <>
              <span className="text-sub"> · 换手 </span>
              <span className="num">{n2(sq.hs_pct)}%</span>
            </>
          )}
        </Step>

        {/* ④ 落点：参与 / 被市场级压住 */}
        <Step
          no="④"
          title={blocked ? '个股成立，但市场级条件没通过' : '竞价落点与裁决'}
          tone={blocked ? 'muted' : undefined}
        >
          <span className={cn('num font-semibold', (view.gap_pct ?? 0) > 0 ? 'text-up' : 'text-down')}>
            {pct(view.gap_pct, 2)}
          </span>
          {view.zone && <span className="text-sub ml-1">{ZONE_LABEL[view.zone] ?? view.zone}</span>}
          <span className="text-sub"> · </span>
          {blocked ? (
            <span className="text-rec font-semibold">未买（缺 {view.high_win_gate?.join('/')}）</span>
          ) : (
            <span className="text-up font-semibold">参与</span>
          )}
          {view.reason && <div className="text-11 text-sub mt-0.5">{view.reason}</div>}
        </Step>
      </div>
    </article>
  )
}

/** 今晨情绪体检 —— 解释"为什么大盘情绪导致名额为 0" */
function MarketBlock({ file }: { file?: PoolCallFile }) {
  const mo = file?.meta?.market_open
  const eff = file?.meta?.effective_quota
  const quota = file?.quota
  if (!mo && eff == null) return null
  const weakened = typeof eff === 'number' && typeof quota === 'number' && eff < quota
  return (
    <div className="rounded-sm border border-line bg-card p-2.5">
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <span className="text-12 font-semibold text-txt">今晨情绪体检</span>
        {typeof quota === 'number' && (
          <span className="text-11 text-sub">
            名义名额 <span className="num">{quota}</span>
            {typeof eff === 'number' && (
              <>
                {' '}
                → 生效{' '}
                <span className={cn('num font-semibold', weakened ? 'text-warn' : 'text-txt')}>{eff}</span>
              </>
            )}
          </span>
        )}
        {mo?.ready === false && <span className="text-11 text-warn">未达放行条件</span>}
      </div>
      {mo && (
        <div className="text-12 leading-relaxed text-txt break-all">
          昨涨停池 <span className="num">{mo.quoted ?? '—'}</span>/
          <span className="num">{mo.pool_size ?? '—'}</span> 只有效报价，竞价红开{' '}
          <span className="num">{mo.red_open_count ?? '—'}</span> 只
          {typeof mo.red_open_ratio === 'number' && (
            <>
              （<span className="num">{pct(mo.red_open_ratio * 100, 1)}</span>）
            </>
          )}
          {typeof mo.leader_red_open_ratio === 'number' && (
            <>
              ；≥3 板红开 <span className="num">{mo.leader_red_open_count ?? '—'}</span>/
              <span className="num">{mo.leader_count ?? '—'}</span>（
              <span className="num">{pct(mo.leader_red_open_ratio * 100, 1)}</span>）
            </>
          )}
          {mo.reason && <div className="text-11 text-sub mt-0.5">{mo.reason}</div>}
        </div>
      )}
    </div>
  )
}

export interface AiHitLogicProps {
  /** 当日 09:25 裁决全文（含逐票终态与 meta） */
  file?: PoolCallFile
  tradeDate?: string
}

export function AiHitLogic({ file, tradeDate }: AiHitLogicProps) {
  const allViews = file?.views ?? {}
  const parts = file?.meta?.participate ?? []
  const strength = buildThemeStrength(allViews)
  const strengthByTheme = new Map(strength.map((s) => [s.theme, s]))

  const hits = parts.map((c) => allViews[c]).filter((v): v is PoolCallView => !!v)
  const hitCodes = new Set(hits.map((v) => v.code))
  // 命中但被市场级压住：⛔ 只认纯市场级缺项，掺个股级的一律不进本页
  const frozen = Object.values(allViews)
    .filter((v) => isMarketOnlyBlock(v) && !hitCodes.has(v.code))
    .sort((a, b) => (a.line_rank ?? 99) - (b.line_rank ?? 99))

  const date = tradeDate ?? file?.trade_date
  const empty = !hits.length && !frozen.length

  return (
    <div className="flex flex-col gap-2">
      <div className="text-11 leading-relaxed text-sub border-b border-line pb-2">
        口径：{date ?? '—'} 09:25 竞价裁决。只讲**命中的**票 —— 方向强度 → 方向内身位 → 量能封板 →
        落点。缺个股级条件的票不在此逐个解释。
      </div>

      {hits.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-13 font-semibold text-txt">已参与</span>
            <span className="num text-11 text-sub">{hits.length} 只</span>
            <span className="text-11 text-sub">名额内成交</span>
          </div>
          {hits.map((v) => (
            <HitCard key={v.code} view={v} strength={strengthByTheme.get(v.theme_name)} blocked={false} />
          ))}
        </section>
      )}

      {frozen.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-13 font-semibold text-txt">命中但未买</span>
            <span className="num text-11 text-sub">{frozen.length} 只</span>
            <span className="text-11 text-sub">
              方向与个股成立，仅缺市场级条件 ⇒ 属<span className="text-rec font-semibold">冻结</span>，不是否决
            </span>
          </div>
          <MarketBlock file={file} />
          {frozen.map((v) => (
            <HitCard key={v.code} view={v} strength={strengthByTheme.get(v.theme_name)} blocked />
          ))}
        </section>
      )}

      {empty && (
        <div className="rounded-sm border border-line bg-card p-2.5">
          <div className="text-13 font-semibold text-txt mb-1">今日无命中</div>
          <div className="text-12 text-sub leading-relaxed">
            既没有名额内成交，也没有「只缺市场级条件」的票。这不是缺数据 —— 空仓日不编个股理由。
          </div>
          {strength.length > 0 && (
            <div className="mt-2 border-t border-line-faint pt-1.5">
              <div className="text-11 text-sub mb-1">当日池内最强方向（只列强度，不解释个股）</div>
              <div className="flex flex-col gap-0.5">
                {strength.slice(0, 3).map((s) => (
                  <div key={s.theme} className="text-12 text-txt">
                    <span className="text-rec">{s.theme}</span>
                    <span className="text-sub"> · 池内 </span>
                    <span className="num">{s.total}</span>
                    <span className="text-sub"> 只，红开 </span>
                    <span className="num text-up">{s.red}</span>
                    {s.medianGap != null && (
                      <>
                        <span className="text-sub">，中位 </span>
                        <span className="num">{pct(s.medianGap, 2)}</span>
                      </>
                    )}
                    {s.atLimit > 0 && (
                      <>
                        <span className="text-sub">，竞价涨停幅 </span>
                        <span className="num">{s.atLimit}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
