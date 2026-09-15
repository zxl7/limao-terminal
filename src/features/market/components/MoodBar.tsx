import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, fmtTime, sortLadderDesc } from '@/shared/lib'
import { Kpi, KpiStrip } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { TONE_SOFT, TONE_TEXT, pctTone, sentimentLabelTone } from '../model/labels'

/** 缺数据一律 `—`（不是 0）：0 是「真的没有」，`—` 是「没有样本」 */
const DASH = '—'

/**
 * 首屏指挥条 —— 对应原 dashboard「盘中实时：情绪条」，但**不再是一条小字**。
 *
 * ## 为什么重构（4K 下的可用性问题，不是审美）
 *
 * 原实现是 `flex flex-wrap gap-4 py-2` 的单行：情绪徽标 + 4 个 `text-xs` 小字
 * （`涨停 32 跌停 33 炸板 24 封板率 57%`）+ 右侧时间戳。它只有 **~40px 高**，
 * 而卡片横跨 3800px —— 于是首屏最上方是一条「蚂蚁大小的数字贴在极长空白条上」，
 * 既不好读，也在视觉上放大了整页的空洞感。
 *
 * 更重要的是**它只用了主快照 20 个字段里的 5 个**：三大指数（`index`）、
 * 涨跌家数（`breadth`）、两市成交额（`market`）、最高板（`ladder`）全部落盘
 * 但从未渲染 —— 「空洞」有一半是内容没上屏。
 *
 * ## 现在的结构（两层，仍是单块面板）
 *
 *   上层：情绪定性 + 三大指数 + 数据时间
 *   下层：涨停 / 跌停 / 炸板 / 封板率 / 最高板 / 涨跌家数 / 成交额 —— KPI 块，
 *         数值字号是标签的 2 倍（盘中先抓数字，需要确认含义时才读标签）
 *
 * 指数数值给足 17px：它是判断「今天是权重还是题材行情」的第一手依据，
 * 不该和涨停数挤在同一号字里。
 */
export function MoodBar({ header = false }: { header?: boolean } = {}) {
  const { data } = useQuery(marketQueries.latest())

  if (!data) return null

  const sd = data.sentiment_detail
  const tone = sentimentLabelTone(sd?.label ?? data.sentiment)
  const ladder = sortLadderDesc(data.ladder ?? [])
  const maxBoards = ladder[0]?.boards ?? null
  const breadth = data.breadth ?? { up: null, down: null, flat: null }

  return (
    <div className={cn('flex flex-col gap-3', header ? 'bg-transparent' : 'panel')}>
      {/* ── 上层：定性 + 指数 ── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <section className="flex items-center gap-2.5">
          <span className="text-[10.5px] text-sub">快照情绪</span>
          <span
            className={cn(
              'badge px-2 py-0.5 text-[13px] font-semibold',
              TONE_SOFT[tone],
              TONE_TEXT[tone],
            )}
          >
            {sd?.label ?? data.sentiment}
          </span>
          {/* ⚠️ 这个分数是有符号加权和（实测 −4…+6），**不是 0–10 情绪分** ——
              不要写 `/10`，也不要用 sentimentClass() 判色。见 labels.ts 的对照表。 */}
          <span className={cn('num text-[22px] font-semibold leading-none', TONE_TEXT[tone])}>
            {sd?.score ?? DASH}
          </span>
          <span className="text-[10.5px] text-sub">快照分</span>
        </section>

        <span className="w-px self-stretch bg-line" aria-hidden />

        <section className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {(data.index ?? []).map((ix) => (
            <div key={ix.name} className="min-w-0">
              <div className="text-[10.5px] text-sub truncate">{ix.name}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="num text-[17px] font-semibold leading-none text-txt">
                  {ix.price}
                </span>
                {/* ⚠️ 必须走 pctTone（穷举字面量）而非 `text-${upcls(...)}` ——
                    拼接出来的类名 Tailwind 静态扫描看不到，产物里没有对应 CSS。 */}
                <span className={cn('num text-[12px]', pctTone(ix.pct))}>{fmtPct(ix.pct)}</span>
              </div>
            </div>
          ))}
        </section>

        <span className="text-[11px] text-sub ml-auto">
          数据 {data.data_scope?.asof || DASH}
          {data.ts && <span className="ml-1.5">· 更新 {fmtTime(data.ts)}</span>}
        </span>
      </div>

      <div className="border-t border-line" />

      {/* ── 下层：极值 / 广度 / 量能 ── */}
      <KpiStrip min={104}>
        <Kpi label="涨停" value={data.total_zt} unit="只" tone="up" />
        <Kpi
          label="跌停"
          value={data.limit_down?.count ?? DASH}
          unit="只"
          tone="down"
          sub={
            data.limit_down?.count != null ? `${data.limit_down.count} 家跌停` : '暂无统计'
          }
        />
        <Kpi
          label="炸板"
          value={data.broken?.count ?? DASH}
          unit="只"
          tone="down"
          sub={data.broken?.count != null ? '未封住' : '暂无统计'}
        />
        <Kpi
          label="封板率"
          value={sd?.seal_rate != null ? sd.seal_rate.toFixed(1) : DASH}
          unit="%"
          tone={sd?.seal_rate != null && sd.seal_rate < 55 ? 'down' : 'txt'}
          sub="涨停 / (涨停+炸板)"
        />
        <Kpi
          label="最高板"
          value={maxBoards ?? DASH}
          unit="板"
          tone="up"
          sub={ladder[0]?.stocks?.[0] ? ladder[0].stocks[0] : undefined}
        />
        <Kpi
          label="上涨家数"
          value={breadth.up ?? DASH}
          unit="家"
          tone="up"
          sub={breadth.down != null ? `下跌 ${breadth.down} 家` : '广度未落盘'}
        />
        <Kpi
          label="两市成交额"
          value={data.market != null ? data.market.toFixed(0) : DASH}
          unit="亿"
          sub={data.market == null ? '盘中未落盘' : undefined}
        />
      </KpiStrip>
    </div>
  )
}
