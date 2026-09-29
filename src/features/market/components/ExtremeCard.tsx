import { useQuery } from '@tanstack/react-query'
import { sentimentClass } from '@/shared/lib'
import { Card, Kpi, KpiStrip, StockLink } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { defenseTone, feedbackTone } from '../model/labels'

/**
 * 极值名单（`latest.limit_down.names` / `latest.broken.names`）—— 亏钱效应的具象化。
 *
 * ## 为什么值得单独一张卡
 *
 * 情绪条只给「跌停 33 家」这个数字。数字说不了的是**是谁在跌**：
 * 33 家里如果有昨日的连板龙头，那是核按钮；如果全是 ST 与低位票，那只是
 * 存量资金的日常出清 —— 两种盘面同样是「跌停 33」，交易含义完全相反。
 *
 * ## ⚠️ 为什么限高 + 内部滚动
 *
 * 实测跌停 33 条 + 炸板 24 条 = 57 个名字。在全宽平铺时它会成为整页最高的卡，
 * 把同一网格行的其它卡拉开一大截空白（`items-start` 下表现为「下方留白」）。
 * 限定高度后，这张卡回到与邻居同一量级，需要时滚动查看全部。
 *
 * ## ⚠️ 名单通常**不打「跌停」二字**
 *
 * 脚本给的是纯股票名（`names: string[]`），没有代码、没有跌幅、没有板数 ——
 * 所以此处只做名单呈现，不去编造「几连板」之类的附加信息。
 * 核按钮明细来自反馈矩阵，和跌停、炸板名单保留各自事实口径。
 */
export function ExtremeCard() {
  const { data, isPending, isError } = useQuery(marketQueries.latest())
  const { data: fb, isPending: feedbackPending, isError: feedbackError } = useQuery(marketQueries.feedback())
  const ld = data?.limit_down
  const broken = data?.broken

  // 只有后台明确返回零值才能断言无风险，缺字段不能当作零。
  const ldNames = ld?.names ?? []
  const brokenNames = broken?.names ?? []
  // 核按钮是昨日涨停股的负反馈，与当日跌停名单不互相代替。
  const nukes = fb?.error ? [] : (fb?.nuke_list ?? [])
  const nukeCount = fb?.error ? null : fb?.nuke_count
  const breakWarn = (fb?.broken_rate ?? 0) > 30
  const scoreClass = sentimentClass(fb?.sentiment_score)

  return (
    <Card
      title="🧊 极值名单"
      extra={
        <span className="text-[11px] font-normal text-sub">
          跌停 <b className="num text-[12px] text-down">{ld?.count ?? '—'}</b> · 炸板{' '}
          <b className="num text-[12px] text-down">{broken?.count ?? '—'}</b>
        </span>
      }
    >
      {isError && <p role="status" className="text-[11px] text-warn">{data ? '极值数据更新失败，保留上次数据' : '极值数据加载失败'}</p>}
      {feedbackError && <p role="status" className="text-[11px] text-warn">{fb ? '反馈更新失败，保留上次数据' : '反馈加载失败'}</p>}
      {fb?.market_missing && <p role="status" className="text-[11px] text-warn mb-2">两市成交额或全市场涨跌家数缺失，情绪分未包含量能与广度修正。</p>}
      {fb && !fb.error && (
        <div className="mb-2.5 pb-2 border-b border-line-faint">
          <div className="num text-[10.5px] text-sub mb-1.5">负反馈 {fb.generated_ts}</div>
          <KpiStrip min={96}>
            <Kpi label="核按钮" value={nukeCount ?? '—'} unit="只"
              tone={nukeCount == null ? 'sub' : feedbackTone(nukeCount >= 3)} sub="≥3 视为恶化" size="sm" />
            <Kpi label="炸板率" value={fb.broken_rate ?? '—'} unit="%"
              tone={fb.broken_rate == null ? 'sub' : feedbackTone(breakWarn)} sub=">30% 封板质差" size="sm" />
            <Kpi label="情绪分" value={fb.sentiment_score ?? '—'}
              tone={fb.sentiment_score == null ? 'sub' : scoreClass === 'up' ? 'up' : scoreClass === 'down' ? 'down' : 'mid'}
              sub={fb.sentiment_label || '0–10 口径'} size="sm" />
            <Kpi label="防御等级" value={fb.trend?.defense_level ?? '—'}
              tone={defenseTone(fb.trend?.defense_level)} sub="0 无 / 3 最强" size="sm" />
          </KpiStrip>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-1 text-[10.5px] text-sub">
            <span>核按钮 · 昨涨停负反馈</span>
            <span className="num">{nukeCount == null ? '—' : `${nukes.length}/${nukeCount} 只已列出`}</span>
          </div>
          {nukes.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1 max-h-[240px] overflow-y-auto overscroll-contain">
              {nukes.map((n) => (
                <div key={n.code ?? n.name} className="rounded-sm bg-down-soft/50 px-2 py-1.5 text-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex items-baseline gap-1.5">
                      <StockLink code={n.code} className="text-txt truncate font-bold">{n.name}</StockLink>
                      {n.tag && <span className="text-sub">{n.tag}</span>}
                    </span>
                    <b className="num text-down shrink-0">{n.pct != null ? `${n.pct > 0 ? '+' : ''}${n.pct}%` : '—'}</b>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-sub mt-0.5">
                    <span>昨 {n.prev_boards ?? '—'} 板</span>
                    <span>现价 <span className="num">{n.price ?? '—'}</span></span>
                    <span>MA5 <span className="num">{n.ma5 ?? '—'}</span></span>
                    <span>MA10 <span className="num">{n.ma10 ?? '—'}</span></span>
                    {n.breakdown ? <span className="text-down font-semibold">破位（5/10 日线）</span> : (
                      <>
                        {n.break_ma5 && <span className="text-down">破5日线</span>}
                        {n.break_ma10 && <span className="text-down">破10日线</span>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-sub mt-1">
              {feedbackPending ? '正在加载核按钮数据…' : feedbackError && !fb ? '暂无法确认核按钮状态' : fb?.error ? `反馈矩阵异常：${fb.error}` : nukeCount === 0 ? '当前快照无核按钮' : nukeCount != null ? '核按钮明细未提供' : '核按钮数据未提供'}
            </div>
          )}
        </div>
        <NameGroup
          label="跌停"
          hint="按封单额排序 · 无代码详情"
          names={ldNames}
          chipClass="bg-down-soft text-down"
          emptyText={isPending ? '正在加载跌停数据…' : isError && !data ? '暂无法确认跌停状态' : ld?.count === 0 ? '当前快照无跌停' : ld?.count != null ? '跌停名单未提供' : '跌停数据未提供'}
        />
        <NameGroup
          label="炸板"
          hint="曾涨停后打开 · 承接不足"
          names={brokenNames}
          chipClass="bg-line-faint text-down"
          emptyText={isPending ? '正在加载炸板数据…' : isError && !data ? '暂无法确认炸板状态' : broken?.count === 0 ? '当前快照无炸板' : broken?.count != null ? '炸板名单未提供' : '炸板数据未提供'}
        />
      </div>
    </Card>
  )
}

function NameGroup({
  label,
  hint,
  names,
  chipClass,
  emptyText,
}: {
  label: string
  hint: string
  names: string[]
  chipClass: string
  emptyText: string
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] text-sub">{label}</span>
        <span className="text-[10.5px] text-sub">· {hint}</span>
      </div>
      {names.length > 0 ? (
        <div className="flex flex-wrap gap-1 mt-1 max-h-[104px] overflow-y-auto">
          {names.map((n) => (
            <span key={n} className={`badge ${chipClass}`}>
              {n}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-sub mt-1">{emptyText}</div>
      )}
    </div>
  )
}
