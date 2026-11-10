import { useQuery } from '@tanstack/react-query'
import { ebbTone, marketQueries, sentimentLabelTone, type Tone } from '@/features/market'
import { bjTimeString, cn, fmtPct, isFrozenSnapshot, sessionName, sortLadderDesc, upcls } from '@/shared/lib'
import { useContractIssues, useNow } from '@/shared/hooks'
import { APP_CONFIG } from '@/shared/config'

/**
 * 顶栏 —— 全局盘面状态 header，**盘中情绪维度的唯一载体**。
 *
 * ## 为什么情绪指挥条在这里而不是盘中页
 *
 * 原盘中页顶部有一整块 `MoodBar` 指挥条（情绪分 + 三大指数 + 涨停/跌停/炸板/
 * 封板率/最高板/涨跌家数/成交额）。它占掉首屏一整行，且与全局顶栏**重复展示**
 * 指数与情绪分。现在这些数据维度全部收进顶栏：盘中页只留三栏工作内容，
 * 顶栏 `sticky` 常驻，保证任何滚动位置都能看到盘面定性。
 *
 * ## 三个设计要点
 *
 * 1. **数据的可用性 ≠ 数据的新鲜度**。指示灯只管「更新是否还活着」，
 *    契约异常单独一档显示 —— 数据在、格式变了，比数据缺失更危险（会静默错误渲染）。
 *
 * 2. **语义色在深底上必须换一套**。`--color-up`(#ee2500) 在 #1c2130 上对比度不足，
 *    故顶栏用 `text-head-up`(#ff6b52)。这是刻意的双套色，不是冗余。
 *
 * 3. **`useNow` 与查新解耦**。时钟 1s 一跳，数据 30s 一轮；把时钟塞进 query 会让
 *    整条数据链路每秒重算一次。两者各自独立。
 *
 * ## ⚠️ 情绪分判色口径（此前用错，已修正）
 *
 * 新快照评分由 feedback_matrix 同轮回填（1–10），待计算时为 null。
 * 历史快照可能保留旧有符号分；一律按生产 label 走 sentimentLabelTone，
 * 不在展示层重复计算情绪结论或换算旧分。
 */

/** 缺数据一律 `—`（不是 0）：0 是「真的没有」，`—` 是「没有样本」 */
const DASH = '—'

export function TopBar() {
  const { data } = useQuery(marketQueries.latest())
  const issues = useContractIssues()
  const now = useNow(APP_CONFIG.clockTickMs)

  const indexes = data?.index ?? []
  const updatedText = data?.data_scope?.asof || (data ? bjTimeString(new Date(data.ts)) : DASH)
  /**
   * 数据延迟（秒）：`now` 每秒跳一次，`ts` 是快照生成时刻。
   *
   * 为什么非要显示具体秒数：原来的指示灯只回答「新鲜 / 已陈旧」两档，
   * 而盘中真正会误判的是**「40 秒前」与「4 分钟前」看起来一样**。
   * 数字让「页面停留在旧盘」这件事无法被忽略。
   */
  const lagSec = data?.ts ? Math.max(0, Math.floor((now.getTime() - new Date(data.ts).getTime()) / 1000)) : null
  /**
   * 定格态：快照是**已收盘定稿**的历史数据（周末/节假日/盘后）。
   *
   * 此时「落后 +66000s」是正常态，不是故障 —— 继续刷黄只会让告警失去意义。
   * 所以换成中性的「定格」标签，把「数据有问题」这一档留给真正的盘中断流。
   */
  const frozen = isFrozenSnapshot(data?.data_scope?.asof || data?.ts, now)
  const contractCount = issues.size

  const sd = data?.sentiment_detail
  const tone = sentimentLabelTone(sd?.label ?? data?.sentiment)
  const ladder = sortLadderDesc(data?.ladder ?? [])
  const maxBoards = ladder[0]?.boards ?? null
  const breadth = data?.breadth ?? { up: null, down: null, flat: null }
  const ebb = data?.ebb

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-4 px-4 h-[46px] flex-none text-head-txt bg-head-bg"
    >
      {/* 品牌 —— 仅窄屏显示（≥lg 时品牌在左侧栏，避免重复） */}
      <div className="max-lg:flex lg:hidden items-center gap-2 font-bold text-15 tracking-[0.02em]">
        <span
          className="w-6 h-6 rounded-md inline-flex items-center justify-center text-white text-13 font-semibold bg-up"
        >
          狸
        </span>
        <span>狸猫终端</span>
      </div>

      {/* 三大指数：价 + 涨幅（指数判断「权重还是题材行情」的第一手依据） */}
      <div className="flex items-center gap-4 flex-none">
        {indexes.map((x) => (
          <div key={x.name} className="flex flex-col leading-tight whitespace-nowrap">
            <span className="text-10 text-head-soft">{x.name}</span>
            <span className="flex items-baseline gap-1.5">
              <b className="head-num text-13 text-head-txt">{x.price ?? DASH}</b>
              <b className={cn('head-num text-11', headTone(x.pct))}>{fmtPct(x.pct)}</b>
            </span>
          </div>
        ))}
        {indexes.length === 0 && <span className="text-head-soft text-xs">指数加载中…</span>}
      </div>

      <span className="w-px h-6 bg-white/15 flex-none" aria-hidden />

      {/* 快照情绪：定性 + 分数（按 label 判色） */}
      <div className="flex items-center gap-1.5 flex-none whitespace-nowrap">
        <span className="text-10 text-head-soft">快照情绪</span>
        <b className={cn('head-num text-15', headFromTone(tone))}>{sd?.score ?? DASH}</b>
        <span className="text-11 text-head-soft">{sd?.label ?? data?.sentiment ?? DASH}</span>
      </div>

      <span className="w-px h-6 bg-white/15 flex-none" aria-hidden />

      {/* 极值 / 广度 / 量能 —— 盘中页原指挥条的数据维度，全部上移到 header */}
      <div className="flex items-center gap-4 min-w-0 overflow-hidden">
        <HeadKpi
          label="涨停"
          value={data?.total_zt ?? DASH}
          unit="只"
          tone={headFromTone('up')}
          hint="收盘封住涨停的只数（口径同「情绪周期」页的涨停家数）"
        />
        <HeadKpi
          label="跌停"
          value={data?.limit_down?.count ?? DASH}
          unit="只"
          tone={headFromTone('down')}
        />
        <HeadKpi
          label="炸板"
          value={data?.broken?.count ?? DASH}
          unit="只"
          tone={headFromTone('down')}
          hint="今日曾涨停、收盘未封住的只数；封板率的分母是「涨停 + 炸板」"
        />
        <HeadKpi
          label="封板率"
          value={sd?.seal_rate != null ? sd.seal_rate.toFixed(1) : DASH}
          unit="%"
          tone={sd?.seal_rate != null && sd.seal_rate < 55 ? headFromTone('down') : 'text-head-txt'}
          hint="封板率 = 涨停 ÷（涨停 + 炸板）；页面里的「炸板率」= 100 − 封板率，两者同源"
        />
        <HeadKpi
          label="最高板"
          value={maxBoards ?? DASH}
          unit="板"
          tone={headFromTone('up')}
          className="max-2xl:hidden 2xl:flex"
        />
        <HeadKpi
          label="上涨家数"
          value={breadth.up ?? DASH}
          unit="家"
          tone={headFromTone('up')}
          className="max-2xl:hidden 2xl:flex"
        />
        <HeadKpi
          label="成交额"
          value={data?.market != null ? data.market.toFixed(0) : DASH}
          unit="亿"
          tone="text-head-txt"
          className="max-2xl:hidden 2xl:flex"
        />
      </div>

      {/* 退潮预警 —— 决策权重最高的一条，常驻可见 */}
      {ebb && (
        <span className={cn('flex-none whitespace-nowrap text-11 font-semibold', headFromTone(ebbTone(ebb.severity, ebb.risk_level)))}>
          {ebb.severity}
        </span>
      )}

      {/* 时钟 + 健康度 */}
      <div className="flex items-center gap-2.5 text-xs whitespace-nowrap ml-auto flex-none">
        <span className="text-head-soft">{sessionName(now)}</span>
        <span className="head-num">{bjTimeString(now)}</span>
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            frozen || isStale(data?.ts) ? 'bg-head-soft' : 'bg-head-down',
          )}
          title={frozen ? '非当日/已收盘数据：展示的是定格收盘盘面' : isStale(data?.ts) ? '数据已超过陈旧阈值' : '数据新鲜'}
        />
        <span className="text-head-soft">{updatedText}</span>
        {frozen ? (
          <span
            className="text-10 px-1 py-0.5 rounded-sm bg-white/10 text-head-soft leading-none"
            title="周末/节假日/盘后：页面展示最近一个交易日的收盘定格数据，不做延迟告警"
          >
            定格
          </span>
        ) : lagSec !== null && (
          <span
            className={cn(
              'head-num tabular-nums',
              lagSec > 300 ? 'text-head-warn font-semibold' : lagSec > 90 ? 'text-head-warn' : 'text-head-soft',
            )}
            title={lagSec > 90 ? `数据快照已落后 ${lagSec} 秒` : '数据新鲜'}
          >
            +{lagSec}s
          </span>
        )}

        {contractCount > 0 && (
          <span
            className="text-head-warn font-semibold cursor-help"
            title={[...issues.entries()]
              .map(([route, list]) => `${route}\n${list.map((i) => `  · ${i.path}: ${i.message}`).join('\n')}`)
              .join('\n\n')}
          >
            {contractCount} 源结构异常
          </span>
        )}
      </div>
    </header>
  )
}

/** 顶栏 KPI：标签在上、数值在下（深底用小号字，数值等宽） */
function HeadKpi({
  label,
  value,
  unit,
  tone,
  className,
  hint,
}: {
  label: string
  value: string | number
  unit?: string
  tone: string
  className?: string
  /** 口径提示（悬停可见）：把「这个数怎么算的」钉在指标上，避免与页面内同名数字打架 */
  hint?: string
}) {
  return (
    <div
      className={cn('flex-col leading-tight whitespace-nowrap', className || 'flex')}
      title={hint}
    >
      <span className="text-10 text-head-soft">{label}</span>
      <span className={cn('head-num text-13', tone)}>
        {value}
        {unit && <span className="text-10 text-head-soft ml-0.5">{unit}</span>}
      </span>
    </div>
  )
}

/** 数据是否已陈旧（超过 APP_CONFIG.staleAfterMs） */
function isStale(ts: string | undefined): boolean {
  if (!ts) return true
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return true
  return Date.now() - t > APP_CONFIG.staleAfterMs
}

/**
 * 顶栏专用的色调映射。
 *
 * ⚠️ 不能用 `features/market/model/labels.ts` 的 `TONE_TEXT`：那个返回浅底用的
 *    `text-up`/`text-down`。顶栏在深底上必须换成 `text-head-*`。这是同一语义的
 *    **两套载体**，共用判定、不共用类名 —— 判定仍来自 `shared/lib/semantic.ts`。
 */

/** 涨跌方向 → 顶栏色（涨红跌绿） */
function headTone(v: number | null | undefined): string {
  return headSemantic(upcls(v))
}

/** 语义标识 → 顶栏色。`''`/`'mid'`/`'flat'` 一律归为中性蓝。 */
function headSemantic(s: '' | 'up' | 'down' | 'mid' | 'flat'): string {
  if (s === 'up') return 'text-head-up'
  if (s === 'down') return 'text-head-down'
  return 'text-head-mid'
}

/**
 * 域内 Tone（来自 `sentimentLabelTone`）→ 顶栏色。
 *
 * 新旧快照都直接按生产 label 判色，不在顶栏重复分档或换算历史分。
 */
function headFromTone(t: Tone): string {
  if (t === 'up') return 'text-head-up'
  if (t === 'down') return 'text-head-down'
  if (t === 'warn') return 'text-head-warn'
  return 'text-head-mid'
}
