import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bjDateString, bjTimeString, cn, inTrading, round2 } from '@/shared/lib'
import { useNow } from '@/shared/hooks'
import { Card, EmptyState, LineChart, type LineSeries } from '@/shared/ui'
import { analyticsQueries } from '../api/queries'
import { buildLimitSeries, clockMin, pickLiveBasis } from '../lib/timeline'

/**
 * 主快照的涨停数量与时段内新增事件累计分开展示。
 * 上游新增炸板、跌停事件不含 ST，且没有回封/开板抵扣，不能当成当前状态数量。
 * 保留既有序列计算，仅明确图例与公式，避免与反馈矩阵的快照炸板率混用。
 */
export function IntradayMoodCard() {
  const query = useQuery(analyticsQueries.intradayTimeline())
  /** 30s 时钟 —— 既驱动「是否实时」判定，也驱动盘中曲线的截止时刻 */
  const now = useNow(30_000)

  const basis = useMemo(() => pickLiveBasis(query.data ?? []), [query.data])
  const today = bjDateString(now)

  /**
   * 正常时沿用原截止时刻；请求失败时只保留最后观测之前的曲线。
   * `clockMin` 不认盘前/盘后分钟 → 回到 `undefined` 时按「不截断」处理即可。
   */
  const untilWm = useMemo(() => {
    if (!basis) return undefined
    if (query.isError) return clockMin(basis.lastAt.slice(11, 16)) ?? undefined
    if (basis.date !== today) return undefined
    return clockMin(bjTimeString(now).slice(0, 5)) ?? undefined
  }, [basis, today, now, query.isError])

  const series = useMemo(
    () => buildLimitSeries(basis?.events ?? [], untilWm ?? Number.POSITIVE_INFINITY),
    [basis, untilWm],
  )
  const hasLive = series.zt.some((v) => v != null)

  const curve = useMemo<LineSeries[]>(
    () => [
      { name: '涨停', values: series.zt, tone: 'up' },
      // 累计事件与当前涨停数量含义不同，图例明确累计口径。
      { name: '跌停累计', values: series.ld, tone: 'down' },
      {
        name: '炸板累计比',
        values: series.brokenRate,
        tone: 'rec',
        axis: 'right',
        format: (v) => `${round2(v)}%`,
      },
    ],
    [series],
  )

  // 事件流没有采集心跳；无新事件不等于停更，使用“盘中记录”而不宣称实时状态。
  const isToday = basis?.date === today
  const live = isToday && inTrading(undefined, now) && !query.isError

  return (
    <Card
      title="📈 盘中情绪走势"
      extra={
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-normal text-sub">
          {basis ? (
            <>
              <span className={cn('num', live && 'font-semibold text-txt')}>
                {live ? '盘中记录' : isToday ? '今日' : '最近交易日'} · {basis.date.slice(5)}
              </span>
              <span className="num">最后观测 {basis.lastAt.slice(11)}</span>
            </>
          ) : (
            <span className="num">无盘中逐事件</span>
          )}
        </span>
      }
    >
      {query.isError && <p role="status" className="text-[11px] text-warn">{hasLive ? '曲线更新失败，保留上次数据' : '盘中逐事件加载失败'}</p>}
      {hasLive && <p className="m-0 mb-1 text-[10px] text-sub leading-relaxed">跌停、炸板按时段内新增事件累计（不含 ST）。炸板累计比 = 累计炸板事件 ÷（涨停数 + 累计炸板事件），与反馈炸板率口径不同。</p>}
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
          <EmptyState text={query.isPending ? '正在加载盘中逐事件' : query.isError ? '暂无法确认盘中事件状态' : '暂无盘中逐事件记录'} />
        </div>
      )}
    </Card>
  )
}
