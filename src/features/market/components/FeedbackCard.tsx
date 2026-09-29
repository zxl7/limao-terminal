import { useQuery } from '@tanstack/react-query'
import { sentimentClass } from '@/shared/lib'
import { Card, Kpi, KpiStrip, StockLink } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { defenseTone, feedbackTone } from '../model/labels'

/**
 * 昨日涨停反馈矩阵 —— 对应原 dashboard「昨日涨停反馈」段，但把**明细**也放上来。
 *
 * ## ⚠️ 语义规范（原系统 2026-08-16 用户定，不可改）
 *
 *    改善 = 红（`--up`）／ 恶化 = 绿（`--down`）—— 与涨跌方向无关。
 *    判定：核按钮 ≥ 3 视为恶化；晋级率低于动态阀门视为恶化。
 *
 * 也就是说本卡里的**绿色是坏消息**，红色是好消息。这与「涨红跌绿」同向但
 * 判定依据完全不同（例如晋级率低是「恶化」，即使昨日涨停股今天在涨）。
 *
 * ## 本次补上的三处（数据早已落盘，此前未渲染）
 *
 * 1. **核按钮明细**（`nuke_list`）—— 原卡只给「核按钮 10 只」这个数字。
 *    明细里每条都带 `break_ma5` / `break_ma10` / `breakdown`：
 *    **跌停 + 同时跌破 5/10 日线 = 结构性走坏**，与单纯一根跌停完全不是一回事，
 *    这是判断「亏钱效应是否扩散」最直接的证据。
 * 2. **炸板率**（`broken_rate`）—— 封板质量的另一面。脚本用它判退潮（>30% 权重 2），
 *    但前端一直没显示。
 * 3. **防御等级**（`trend.defense_level`）与**上涨占比**（`up_rate`）——
 *    广度指标，说明「不只是涨停股的事，全市场是否也在退」。
 */
export function FeedbackCard() {
  const { data: fb, isPending, isError } = useQuery(marketQueries.feedback())

  /** 晋级率动态阀门（前 10 交易日截尾均值，缺失回退 25 —— 与原系统一致） */
  const gate = fb?.trend?.promotion_gate_10d ?? 25
  const promWarn = (fb?.promote_rate ?? 100) < gate
  const nukeWarn = (fb?.nuke_count ?? 0) >= 3
  const breakWarn = (fb?.broken_rate ?? 0) > 30
  const scoreClass = sentimentClass(fb?.sentiment_score)
  /** 域内 Tone ⊂ 通用 ToneToken，可直接喂给 <Kpi tone>（'neutral' 已在令牌表内注册） */
  const defTone = defenseTone(fb?.trend?.defense_level)

  /** 数值的语气色：改善红 / 恶化绿（见 labels.ts::feedbackTone） */
  const nukes = fb?.nuke_list ?? []

  return (
    <Card
      title="📊 昨日涨停反馈"
      extra={
        fb?.prev_date && (
          <span className="text-[11px] font-normal text-sub">
            对照 {fb.prev_date} 涨停 {fb.prev_zt_count ?? '—'} 只
          </span>
        )
      }
    >
      {isError && <p role="status" className="text-[11px] text-warn">{fb ? '反馈更新失败，保留上次数据' : '反馈加载失败'}</p>}
      {fb?.generated_ts && <div className="num text-[10.5px] text-sub mb-2">数据时间 {fb.generated_ts}</div>}
      {fb?.market_missing && <p role="status" className="text-[11px] text-warn mb-2">两市成交额或全市场涨跌家数缺失，情绪分未包含量能与广度修正。</p>}
      {fb && !fb.error ? (
        <>
          {/* 缺失指标使用中性色，避免把未知状态表达为改善。 */}
          <KpiStrip min={92}>
            <Kpi
              label="晋级率"
              value={fb.promote_rate ?? '—'}
              unit="%"
              tone={fb.promote_rate == null ? 'sub' : promWarn ? 'down' : 'up'}
              sub={`阀门 ${gate.toFixed(1)}%`}
            />
            <Kpi
              label="连板晋级"
              value={fb.lb_promote_rate ?? '—'}
              unit="%"
              tone={fb.lb_promote_rate == null ? 'sub' : fb.lb_promote_rate < 30 ? 'down' : 'up'}
              sub={fb.lb_prev_count != null ? `昨连板 ${fb.lb_prev_count} 只` : undefined}
            />
            <Kpi
              label="核按钮"
              value={fb.nuke_count ?? '—'}
              unit="只"
              tone={fb.nuke_count == null ? 'sub' : feedbackTone(nukeWarn)}
              sub="≥3 视为恶化"
            />
            <Kpi
              label="炸板率"
              value={fb.broken_rate ?? '—'}
              unit="%"
              tone={fb.broken_rate == null ? 'sub' : feedbackTone(breakWarn)}
              sub="当前快照 · >30% 封板质差"
            />
            <Kpi
              label="均涨幅"
              value={fb.avg_pct ?? '—'}
              unit="%"
              tone={fb.avg_pct == null ? 'sub' : fb.avg_pct < 0 ? 'down' : 'up'}
              sub="昨涨停今日平均"
            />
            <Kpi
              label="昨涨停今上涨占比"
              value={fb.up_rate ?? '—'}
              unit="%"
              tone={fb.up_rate == null ? 'sub' : fb.up_rate < 50 ? 'down' : 'up'}
              sub="昨日涨停股样本"
            />
            <Kpi
              label="最高板"
              value={`${fb.prev_max_boards ?? '—'}→${fb.now_max_boards ?? '—'}`}
              tone={fb.max_trend == null ? 'sub' : fb.max_trend < 0 ? 'down' : 'up'}
              sub={fb.max_trend == null ? '高度趋势未提供' : fb.max_trend < 0 ? '高度压缩' : '高度维持'}
            />
            <Kpi
              label="情绪分"
              value={fb.sentiment_score ?? '—'}
              tone={fb.sentiment_score == null ? 'sub' : scoreClass === 'up' ? 'up' : scoreClass === 'down' ? 'down' : 'mid'}
              sub={fb.sentiment_label || '0–10 口径'}
            />
            <Kpi
              label="防御等级"
              value={fb.trend?.defense_level ?? '—'}
              tone={defTone}
              sub="0 无 / 3 最强"
            />
          </KpiStrip>

          {/* ── 晋级个股 ── */}
          {fb.promote_list && fb.promote_list.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-dashed border-line text-[12px]">
              <span className="text-sub font-semibold">
                晋级 {fb.promote_count ?? fb.promote_list.length}
              </span>
              {fb.promote_list.map((p) => (
                <span key={p.code ?? p.name}>
                  <span className="text-txt font-medium">{p.name}</span>
                  <span className="num text-up ml-1">
                    {(p.pct ?? 0) > 0 ? '+' : ''}
                    {p.pct}%
                  </span>
                  <span className="text-sub ml-1">({p.prev_boards}板)</span>
                </span>
              ))}
            </div>
          )}

          {/* ── 核按钮明细（带均线破位）── */}
          {nukes.length > 0 && (
            <div className="mt-2 pt-2 border-t border-dashed border-line">
              <div className="text-[10.5px] text-sub mb-1">
                核按钮明细 · 破位 = 同时跌破 5/10 日均线（结构性走坏）
              </div>
              <div className="flex flex-col max-h-[132px] overflow-y-auto">
                {nukes.map((n) => (
                  <div
                    key={n.code ?? n.name}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-1 py-[2px]"
                  >
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <StockLink code={n.code} className="text-[12px] text-txt truncate">{n.name}</StockLink>
                      {n.tag && <span className="badge bg-line-faint text-sub">{n.tag}</span>}
                    </span>
                    <span className="flex gap-1">
                      {n.breakdown ? (
                        <span className="badge bg-down text-white">破位</span>
                      ) : (
                        <>
                          {n.break_ma5 && <span className="badge bg-down-soft text-down">破5日</span>}
                          {n.break_ma10 && <span className="badge bg-down-soft text-down">破10日</span>}
                        </>
                      )}
                    </span>
                    <span className="num text-[12px] font-semibold text-down text-right">
                      {n.prev_boards}板 · {n.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : fb?.error ? (
        <p className="text-[12px] text-down py-2">反馈矩阵异常：{fb.error}</p>
      ) : (
        <p className="text-[12px] text-sub py-2">{isPending ? '正在加载反馈数据…' : isError ? '暂无法确认反馈状态' : '反馈数据未提供'}</p>
      )}
    </Card>
  )
}
