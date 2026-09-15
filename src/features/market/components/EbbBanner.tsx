import { useQuery } from '@tanstack/react-query'
import { cn } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { ebbTone } from '../model/labels'

/**
 * 退潮预警通栏 —— 盘中实时页**决策权重最高的一条**，此前全站未渲染。
 *
 * ## 为什么它必须存在（数据早已落盘）
 *
 * `latest.ebb` 由 `scripts/intraday_pulse.py::detect_ebb` 生成，是一套**加权评分**
 * 的结果，权重分层即「什么更致命」：
 *
 *   · 权重 2 —— 亏钱效应：核按钮 ≥10 / 晋级率 <25% / 炸板率 >30%
 *   · 权重 1 —— 结构走坏：涨停清淡、最高板 ≤3、板块分散无主线、活跃板块缺热点
 *   · 权重 1 —— 情绪周期文件已判退潮（周期先行，指标滞后时的提前量）
 *
 *   总分 ≥5 → `⚠ 退潮预警`；3–4 → `⚡ 情绪转弱`；<3 → 不产出（正常态）。
 *
 * 对短线交易者，这是「今天该不该出手」的第一性问题 —— 它比涨停家数重要得多：
 * 涨停 32 家看着还行，但若核按钮 9 只 + 晋级率 12.7% + 炸板率 42.9%，
 * 真实含义是「赚钱效应已断」。前端此前只显示涨停数，等于只报了半个盘面。
 *
 * ## 为什么是通栏而不是卡片
 *
 * 它是**全局定性**，不属于任何一块内容。放进网格里会与其他卡片平权，
 * 而它在层级上高于所有卡片。通栏 + 语义底色，一眼可辨。
 *
 * ## ⚠️ 无预警时返回 null（不占位）
 *
 * 「没有预警」由「这条通栏不存在」表达。若渲染一条「今日无退潮信号」的空通栏，
 * 就等于每天固定浪费一行高度，而它 90% 的日子都没有信息量。
 */
export function EbbBanner({ header = false }: { header?: boolean } = {}) {
  const { data } = useQuery(marketQueries.latest())
  const ebb = data?.ebb
  if (!ebb) return null

  const tone = ebbTone(ebb.severity)
  /** 色彩载体：退潮=青绿底 / 转弱=中性底。用富集类名而非拼接，见 shared/ui/tone.ts */
  const shell =
    tone === 'warn'
      ? 'bg-warn-soft border-warn/35'
      : tone === 'mid'
        ? 'bg-line-faint border-line-strong'
        : 'bg-line-faint border-line'
  const ink = tone === 'warn' ? 'text-warn' : tone === 'mid' ? 'text-mid' : 'text-sub'

  /** header 模式下去掉卡片圆角/边框，做通栏预警 strip（底色保留以醒目） */
  const cardCls = header
    ? 'px-3 py-2.5'
    : 'rounded-[var(--radius-DEFAULT)] border px-3 py-2.5'

  return (
    <section className={cn(cardCls, shell)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className={cn('flex items-center gap-1.5 text-[15px] font-semibold', ink)}>
          <Icon name="alert" size={17} />
          {ebb.severity}
        </span>

        <span className="text-[11px] text-sub">
          最高板 <b className="num text-[13px] text-txt">{ebb.max_board ?? '—'}</b>
        </span>
        <span className="text-[11px] text-sub">
          涨停 <b className="num text-[13px] text-up">{ebb.total_zt ?? '—'}</b>
        </span>
        {/* ⚠️ 这是反馈矩阵的 0–10 情绪分（不是快照的加权和）；脚本在情绪分 ≥7 时会
            主动跳过晋级率信号，此处并列展示正是为了让人一眼看出「指标 vs 情绪分」
            是否互相印证 —— 两者背离本身就是一条信息。 */}
        <span className="text-[11px] text-sub">
          反馈情绪分
          <b className="num text-[13px] text-txt ml-1">
            {ebb.sentiment_score ?? '—'}
            {ebb.sentiment_score != null && <span className="text-[10px] text-sub">/10</span>}
          </b>
        </span>

        <span className="text-[10.5px] text-sub ml-auto">
          共 {ebb.signals?.length ?? 0} 条负反馈
        </span>
      </div>

      {ebb.signals && ebb.signals.length > 0 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 mt-2 pt-2 border-t border-current/10 list-none p-0">
          {ebb.signals.map((s) => (
            <li key={s} className="flex items-start gap-1.5 text-[12px] text-txt">
              <span className={cn('mt-[6px] w-1 h-1 rounded-full flex-none', ink)} aria-hidden />
              {s}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
