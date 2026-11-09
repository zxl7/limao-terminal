import { useQuery } from '@tanstack/react-query'
import { cn } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { ebbTone } from '../model/labels'

/** 风险通栏按后端口径展示；接力风险不等同于全市场赚钱效应，无预警时不占位。 */
export function EbbBanner({ header = false }: { header?: boolean } = {}) {
  const { data } = useQuery(marketQueries.latest())
  const ebb = data?.ebb
  if (!ebb) return null

  const tone = ebbTone(ebb.severity, ebb.risk_level)
  const marketEffect = ebb.market_effect == null ? null : {
    strong: '强', positive: '偏强', neutral: '中性', weak: '偏弱', unknown: '待确认',
  }[ebb.market_effect]
  const riskScope = ebb.risk_scope == null ? null : {
    market: '全市场', relay: '接力', mixed: '全市场与接力',
  }[ebb.risk_scope]
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
        <span className={cn('flex items-center gap-1.5 text-15 font-semibold', ink)}>
          <Icon name="alert" size={17} />
          {ebb.severity}
        </span>

        <span className="text-11 text-sub">
          最高板 <b className="num text-13 text-txt">{ebb.max_board ?? '—'}</b>
        </span>
        <span className="text-11 text-sub">
          涨停 <b className="num text-13 text-up">{ebb.total_zt ?? '—'}</b>
        </span>
        {riskScope && <span className="text-11 text-sub">风险范围：{riskScope}</span>}
        {marketEffect && <span className="text-11 text-sub">全市场赚钱效应：{marketEffect}</span>}
        <span className="text-11 text-sub">
          接力情绪分
          <b className="num text-13 text-txt ml-1">
            {ebb.sentiment_score ?? '—'}
            {ebb.sentiment_score != null && <span className="text-10 text-sub">/10</span>}
          </b>
        </span>

        <span className="text-11 text-sub ml-auto">
          判断依据：{ebb.signals?.length ?? 0} 项
        </span>
      </div>

      {ebb.signals && ebb.signals.length > 0 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 mt-2 pt-2 border-t border-current/10 list-none p-0">
          {ebb.signals.map((s) => (
            <li key={s} className="flex items-start gap-1.5 text-12 text-txt">
              <span className={cn('mt-[6px] w-1 h-1 rounded-full flex-none', ink)} aria-hidden />
              {s}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
