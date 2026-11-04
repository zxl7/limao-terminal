import type { DecisionDossier, PoolCallFile } from '@/shared/api'
import { cn } from '@/shared/lib'
import { num, pctText } from '../lib/format'

/**
 * 环境结论 —— 只回答**两件**事，别的一概不放。
 *
 * ## 2026-11-04 用户「环境体检感觉没有存在必要」
 *
 * 用户判断是对的，但**不是整块没用，是八成内容在别处已经能看**：
 *
 * | 原段落 | 处置 | 理由 |
 * |---|---|---|
 * | 昨日情绪 6 项 | ❌ 删 | `/emotion` 整页就是干这个（执行层/方向层/纪律层/归纳层四窗口） |
 * | 盘面 6 项（指数/跌停/炸板） | ❌ 删 | 同上，且 `/intraday`、`/timeline` 都有 |
 * | **今晨竞价 6 项 + 未达标原因** | ✅ **保留** | **全系统唯一**能回答「今天为什么没买」的地方 |
 *
 * ⛔ 「今晨竞价」不可删：删了之后「今日决策」只剩「有什么票」，
 *    回答不了「为什么是空的」——而空池恰恰是这套战法最常见的结论。
 *    实证 11-04：昨涨停红开 26/48、≥3板 10/15 未达标 → 名额 1→0 → relay 0 只。
 *    用户唯一能看懂这句因果的地方就是这里。
 *
 * ⛔ 也不要改成「折叠」：折叠默认收起 = 等于删掉（没人会为了一句原因去点开）。
 */

function Cell({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: React.ReactNode
  tone?: 'up' | 'down' | 'warn' | 'sub'
  title?: string
}) {
  return (
    <span className="flex items-baseline gap-1" title={title}>
      <span className="text-11 text-sub">{label}</span>
      <span
        className={cn(
          'num text-12 font-semibold',
          tone === 'up'
            ? 'text-up'
            : tone === 'down'
              ? 'text-down'
              : tone === 'warn'
                ? 'text-warn'
                : tone === 'sub'
                  ? 'text-sub'
                  : 'text-txt',
        )}
      >
        {value}
      </span>
    </span>
  )
}

export function EnvPanel({
  dossier,
  callFile,
}: {
  dossier?: DecisionDossier
  callFile?: PoolCallFile
}) {
  const mo = callFile?.meta?.market_open

  const redRatio = mo?.red_open_ratio != null ? mo.red_open_ratio * 100 : null
  const leaderRedRatio = mo?.leader_red_open_ratio != null ? mo.leader_red_open_ratio * 100 : null

  /** 名义 → 生效名额（被市场环境压过之后）；两者不同才并列显示 */
  const quota = callFile?.meta?.effective_quota ?? callFile?.quota ?? null
  const nominalQuota = callFile?.quota ?? null
  const participate = callFile?.meta?.participate?.length ?? 0
  const stanceCn = callFile?.stance
    ? ({ attack: '进攻', defend: '防守', hold: '观察' } as Record<string, string>)[callFile.stance] ?? callFile.stance
    : '未裁决'

  return (
    <div className="flex flex-col gap-1.5">
      {/* 第 1 行：出手结论（取向 / 名额 / 实际买入 / 最高板） */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-sm bg-hover px-2 py-1">
        <Cell label="取向" value={stanceCn} />
        <Cell
          label="名额"
          value={
            quota == null ? (
              '—'
            ) : (
              <>
                {nominalQuota != null && nominalQuota !== quota && (
                  <span className="num font-normal text-sub">{nominalQuota} → </span>
                )}
                <span className={quota === 0 ? 'text-down' : 'text-txt'}>{quota}</span>
              </>
            )
          }
        />
        <Cell label="实际买入" value={`${participate} 只`} tone={participate > 0 ? 'up' : 'sub'} />
        <Cell label="全市场最高" value={`${num(dossier?.market_max_boards, 0)} 板`} />
        {dossier?.market_style?.label && <Cell label="风格" value={dossier.market_style.label} />}
      </div>

      {/* 第 2 行：今晨竞价体检（唯一能解释「为什么没买」的地方） */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-2">
        <span className="flex items-baseline gap-1.5">
          <span className="text-11 font-semibold text-txt">今晨竞价</span>
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
        <Cell
          label="昨涨停红开"
          value={mo?.pool_size ? `${mo.red_open_count ?? 0}/${mo.pool_size}` : '—'}
          tone={redRatio == null ? 'sub' : redRatio >= 60 ? 'up' : redRatio >= 40 ? 'warn' : 'down'}
          title="昨日涨停池今晨竞价高开家数"
        />
        <Cell
          label="≥3板红开"
          value={mo?.leader_count ? `${mo.leader_red_open_count ?? 0}/${mo.leader_count}` : '—'}
          tone={
            leaderRedRatio == null ? 'sub' : leaderRedRatio >= 60 ? 'up' : leaderRedRatio >= 40 ? 'warn' : 'down'
          }
        />
        <Cell
          label="高标竞价量"
          value={mo?.leader_volume_median_ratio != null ? `${num(mo.leader_volume_median_ratio, 2)}x` : '—'}
          tone={(mo?.leader_volume_median_ratio ?? 0) >= 1 ? 'up' : 'down'}
          title="竞价成交额 / 昨日全天成交额。集合竞价只占全天一小段，0.1x 属正常"
        />
        <Cell
          label="量能达标"
          value={mo?.leader_volume_pass_ratio != null ? pctText(mo.leader_volume_pass_ratio * 100, 0) : '—'}
          tone={(mo?.leader_volume_pass_ratio ?? 0) >= 0.5 ? 'up' : 'down'}
        />
        <Cell label="报价覆盖" value={mo?.coverage != null ? pctText(mo.coverage * 100, 0) : '—'} tone="sub" />
      </div>

      {/* 未达标原因：一句话说明「为什么没买」。⛔ 压缩高度也不能省。 */}
      {mo?.reason && <div className="px-2 text-11 leading-relaxed text-warn">{mo.reason}</div>}
      {callFile?.meta?.market_open_relief && (
        <div className="px-2 text-11 text-rec">竞价后回暖，已解冻</div>
      )}
    </div>
  )
}
