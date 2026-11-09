import type { PoolCallFile } from '@/shared/api'
import { cn } from '@/shared/lib'
import { num } from '../lib/format'

/**
 * 今晨竞价体检 —— 只回答一件事：**昨天涨停那批票，今早还有没有人接**。
 *
 * ## 2026-11-06 用户「不要那些看不懂的指标」
 *
 * 原来排了 6 个读数，其中 3 个是**比率/倍数**，看懂了也不能改变任何决定，删掉：
 *
 * | 删掉 | 原来是什么 | 为什么删 |
 * |---|---|---|
 * | 高标竞价量 | `1.34x`（竞价额 / 昨全天额的中位数） | 集合竞价只占全天一小段，零点几倍是常态，没有可比基准 |
 * | 量能达标 | `60%`（达标率） | 与「高标竞价量」是同一指标的两个切法，重复 |
 * | 报价覆盖 | `100%` | 数据工程指标，与「今天买不买」无关（真要查覆盖，看今日账本的数据缺口行） |
 *
 * 只留两个**能直接读出结论**的计数：
 *   · **昨涨停红开 x/y** —— 池子里还有多少人愿意出高价接；
 *   · **≥3 板红开 x/y** —— 连板那批人跑没跑（这条比总体更灵敏）。
 *
 * ⛔ 出手结论（取向 / 名额 / 实际买入）已移到页面最上方 `TodayVerdict`，
 *    本组件**不再重复**——同一句话在一屏里出现两次，反而让人以为它们是两个来源。
 */
export function EnvPanel({ callFile }: { callFile?: PoolCallFile }) {
  const mo = callFile?.meta?.market_open
  const redRatio = mo?.red_open_ratio != null ? mo.red_open_ratio * 100 : null
  const leaderRedRatio = mo?.leader_red_open_ratio != null ? mo.leader_red_open_ratio * 100 : null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-12 font-semibold text-txt">今晨竞价</span>
          {mo?.ready != null && (
            <span
              className={cn(
                'rounded-sm border px-1 text-11',
                mo.ready ? 'border-up text-up' : 'border-down text-down',
              )}
            >
              {mo.ready ? '达标放行' : '未达标'}
            </span>
          )}
        </span>

        <span className="flex items-baseline gap-1" title="昨日涨停池今晨竞价高开家数（越多＝还有人愿意出高价接）">
          <span className="text-11 text-sub">昨涨停红开</span>
          <span
            className={cn(
              'num text-13 font-semibold',
              redRatio == null ? 'text-sub' : redRatio >= 60 ? 'text-up' : redRatio >= 40 ? 'text-warn' : 'text-down',
            )}
          >
            {mo?.pool_size ? `${mo.red_open_count ?? 0}/${mo.pool_size}` : '—'}
          </span>
          {redRatio != null && <span className="num text-11 text-sub">（{num(redRatio, 0)}%）</span>}
        </span>

        <span
          className="flex items-baseline gap-1"
          title="≥3 板票今晨竞价高开家数（连板那批跑没跑，比总体更灵敏）"
        >
          <span className="text-11 text-sub">≥3板红开</span>
          <span
            className={cn(
              'num text-13 font-semibold',
              leaderRedRatio == null
                ? 'text-sub'
                : leaderRedRatio >= 60
                  ? 'text-up'
                  : leaderRedRatio >= 40
                    ? 'text-warn'
                    : 'text-down',
            )}
          >
            {mo?.leader_count ? `${mo.leader_red_open_count ?? 0}/${mo.leader_count}` : '—'}
          </span>
          {leaderRedRatio != null && <span className="num text-11 text-sub">（{num(leaderRedRatio, 0)}%）</span>}
        </span>
      </div>

      {/* 未达标的原话：⛔ 压缩高度也不能省 —— 这是「为什么没买」的读数层 */}
      {mo?.reason && <div className="text-11 leading-relaxed text-warn">{mo.reason}</div>}
      {callFile?.meta?.market_open_relief && <div className="text-11 text-rec">竞价后回暖，已解冻</div>}
    </div>
  )
}
