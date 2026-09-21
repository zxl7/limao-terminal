import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bjDateString, bjTimeString, cn, inTrading, round2 } from '@/shared/lib'
import { useNow } from '@/shared/hooks'
import { Card, EmptyState, LineChart, type LineSeries } from '@/shared/ui'
import { analyticsQueries } from '../api/queries'
import { buildLimitSeries, clockMin, pickLiveBasis } from '../lib/timeline'

/**
 * 盘中情绪走势 —— **涨停（左轴）＋ 炸板率（右轴）** 两条实时曲线。
 *
 * ## 数据来源与节拍
 * `cache/intraday_timeline_<日期>.jsonl`（`intraday_timeline.py` 每轮守护追加写）：
 *   · `zt_total.total`   → 涨停（封板）家数；
 *   · `broken_new` 累计  → 炸板家数 → 炸板率 = 炸板 / (封板 + 炸板累计) × 100。
 * 查询用 `analyticsQueries.intradayTimeline()`（**30s 轮询**，与后端守护同频）——
 * 盘中曲线随交易推进自动向右生长，即「动态」。
 *
 * ## 三条不许违反的显示纪律
 *   1. **基准日独立于页面选中日**（`pickLiveBasis`）—— 盘中当日归档没有涨停池，
 *      页面默认选中日会退到昨天；曲线跟着走就永远是昨天（与实时相悖）。
 *   2. **不画未来** —— 基准日 = 今天时只画到「此刻」（`untilWm`），
 *      ⛔ 不把最后一个已知涨停数平推到收盘（那是假信息，见 `buildLimitSeries` 头注）。
 *   3. **不假实时** —— 非交易时段明确标「最近交易日 · MM-DD」，
 *      只有真正处于交易时段才标「盘中实时」（时段判定走 `shared/lib/marketTime` 单一实现）。
 *
 * ⚠️ 单位不同量纲：涨停是家数、炸板率是百分比 → 炸板率走**右轴**（`axis: 'right'`）。
 */
export function IntradayMoodCard() {
  const query = useQuery(analyticsQueries.intradayTimeline())
  /** 30s 时钟 —— 既驱动「是否实时」判定，也驱动盘中曲线的截止时刻 */
  const now = useNow(30_000)

  const basis = useMemo(() => pickLiveBasis(query.data ?? []), [query.data])
  const today = bjDateString(now)

  /**
   * 截止墙钟分钟：基准日是**今天**时只画到此刻；过去交易日（已收盘）填满全天。
   * `clockMin` 不认盘前/盘后分钟 → 回到 `undefined` 时按「不截断」处理即可。
   */
  const untilWm = useMemo(() => {
    if (!basis || basis.date !== today) return undefined
    return clockMin(bjTimeString(now).slice(0, 5)) ?? undefined
  }, [basis, today, now])

  const series = useMemo(
    () => buildLimitSeries(basis?.events ?? [], untilWm ?? Number.POSITIVE_INFINITY),
    [basis, untilWm],
  )
  const hasLive = series.zt.some((v) => v != null)

  const curve = useMemo<LineSeries[]>(
    () => [
      { name: '涨停', values: series.zt, tone: 'up' },
      {
        name: '炸板率',
        values: series.brokenRate,
        tone: 'rec',
        axis: 'right',
        format: (v) => `${round2(v)}%`,
      },
    ],
    [series],
  )

  /**
   * 是否标「盘中实时」—— ⛔ 必须**同时**满足两条：
   *   ① 基准日是**今天**（否则那是往日回放）；
   *   ② 此刻在交易时段。
   *
   * ⚠️ 2026-09-21 实测踩到：只判 ② 会让「交易时段打开页面、但曲线画的是往日数据」
   *    被标成「盘中实时」（例：今天 09:16 首轮 JSONL 还没落盘 → 基准日 = 昨天）。
   */
  const isToday = basis?.date === today
  const live = isToday && inTrading(undefined, now)

  return (
    <Card
      title="📈 盘中情绪走势"
      extra={
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-normal text-sub">
          {basis ? (
            <>
              <span className={cn('num', live && 'font-semibold text-txt')}>
                {live ? '盘中实时' : isToday ? '今日' : '最近交易日'} · {basis.date.slice(5)}
              </span>
              <span className="num">最后观测 {basis.lastAt.slice(11)}</span>
            </>
          ) : (
            <span className="num">无盘中逐事件</span>
          )}
        </span>
      }
    >
      {hasLive ? (
        <LineChart
          series={curve}
          labels={series.labels}
          height={120}
          zeroBased
          format={(v) => String(Math.round(v))}
          dotThreshold={20}
        />
      ) : (
        <div className="flex items-center justify-center" style={{ height: 120 }}>
          <EmptyState text={query.isPending ? '正在加载盘中逐事件' : '暂无盘中逐事件记录'} />
        </div>
      )}
    </Card>
  )
}
