import type { DecisionDossier, PoolCallFile, PoolLedger } from '@/shared/api'
import { Card, CardBadge, StockLink } from '@/shared/ui'
import { cn } from '@/shared/lib'
import { num, signedPct } from '../lib/format'

/**
 * 今天的结论条 —— 全页最先要看的一行，只回答两句话：
 *
 *   **「今天买了没有」** 与 **「为什么是这个结果」**。
 *
 * ## 2026-11-06 用户「不要那些看不懂的指标…方便我看买什么、赚没赚、为什么买、为什么没买」
 *
 * 原来这一层信息散在三处：`EnvPanel` 一行小字（取向/名额）、`market_open` 六个比率、
 * `defense.env.hits` 三句话（根本没进页面）。要看懂「今天为什么空仓」得自己拼三处、
 * 还得懂「晋级率 / 红开率 / 量能达标率」各指什么 —— 那是指标，不是原因。
 *
 * 现在只留 **`defense.env.hits` 的原话**（后端已经排成白话，如「今天开盘昨天涨停的票
 * 只有 27% 红开」），加上「名额 1 → 0」这唯一一个数字。
 * ⛔ 不要用命中条数 / 阈值数字二次拼装原因 —— 拼出来的是指标，不是人话。
 *
 * ## 三种状态必须分开（⛔ 别把「没名额」写成「没票」）
 *
 * | 状态 | 判据 | 文案 |
 * |---|---|---|
 * | 空仓·环境不允 | 生效名额 = 0 | 「今天空仓 —— 环境防守，名额压到 0」+ 命中原因 |
 * | 空仓·无票可买 | 名额 > 0 但池内无 participate | 「今天空仓 —— 有 N 个名额，但票都没过闸」 |
 * | 有买 | `meta.participate` 非空 | 「今天买了 N 只：xxx」+ 结算收益（若已落盘） |
 */

const STANCE_CN: Record<string, string> = { attack: '进攻', selective: '精选', defend: '防守', hold: '观察' }

export function TodayVerdict({
  dossier,
  callFile,
  ledger,
}: {
  dossier?: DecisionDossier
  callFile?: PoolCallFile
  ledger?: PoolLedger
}) {
  const meta = callFile?.meta
  const picks = meta?.participate ?? []
  const effective = meta?.effective_quota ?? callFile?.quota ?? null
  const nominal = callFile?.quota ?? null
  const hits = meta?.defense?.env?.hits ?? []
  const level = meta?.defense?.env?.level ?? null

  /** 今日台账里「买了的那几只」的结算 —— 只有在同一执行日时才用 */
  const sameDay = !!ledger && !!callFile && ledger.date === callFile.trade_date
  /**
   * 按 code 取结算行。⛔ 不要按 `row.view === 'participate'` 过滤：
   * 权威的成交名单是 `meta.participate`，台账行只是同一份数据的镜像 ——
   * 两处口径若不一致（历史件有过），按 view 过滤会把已成交的票判成「没结算」。
   */
  const boughtRows = sameDay && ledger ? ledger.rows.filter((r) => picks.includes(r.code)) : []
  const boughtAgg = sameDay ? ledger?.summary.by_view?.participate : undefined

  const hasCall = !!callFile
  const empty = picks.length === 0
  const quotaBlocked = empty && effective === 0

  return (
    <Card
      title="今天"
      extra={
        <span className="flex items-baseline gap-2">
          {callFile?.trade_date && <CardBadge>{callFile.trade_date}</CardBadge>}
          {hits.length > 0 && <CardBadge tone={quotaBlocked ? 'down' : 'warn'}>{hits.length} 条防守命中</CardBadge>}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* ── 左：买了没有 ─────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={cn(
                'text-15 font-semibold',
                !hasCall ? 'text-sub' : empty ? 'text-warn' : 'text-up',
              )}
            >
              {!hasCall ? '今晨裁决未生成' : empty ? '今天空仓' : `系统买入 ${picks.length} 只（非券商成交）`}
            </span>
            {hasCall && (
              <span className="text-12 text-sub">
                取向 {STANCE_CN[callFile?.stance ?? ''] ?? callFile?.stance ?? '—'}
                <span className="mx-1.5 text-line">|</span>
                名额{' '}
                {nominal != null && effective != null && nominal !== effective ? (
                  <span className="num text-txt">
                    {nominal} → <b className={effective === 0 ? 'text-down' : 'text-txt'}>{effective}</b>
                  </span>
                ) : (
                  <span className="num text-txt">{effective ?? '—'}</span>
                )}
              </span>
            )}
          </div>

          {/* 买到的票：名称 + 今日结算（赚没赚） */}
          {picks.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {picks.map((code) => {
                const row = boughtRows.find((r) => r.code === code)
                const name = callFile?.views[code]?.name || row?.name || '名称暂无'
                return (
                  <span key={code} className="flex items-baseline gap-1">
                    <StockLink code={code} className="text-13 font-medium text-txt">
                      {name} <span className="num text-sub">{code}</span>
                    </StockLink>
                    {row && (
                      <span
                        className={cn(
                          'num text-13 font-semibold',
                          (row.au_ret ?? 0) >= 0 ? 'text-up' : 'text-down',
                        )}
                        title="09:25 竞价价买 → 当日收盘卖"
                      >
                        {signedPct(row.au_ret)}
                      </span>
                    )}
                  </span>
                )
              })}
              {boughtAgg && boughtAgg.n > 0 && (
                <span className="num text-12 text-sub">
                  （当日合计 {signedPct(boughtAgg.avg)}）
                </span>
              )}
              {!sameDay && <span className="text-11 text-sub">今日结算 16:00 后生成</span>}
            </div>
          )}

          {/* 空仓时：把「机会成本」摆出来 —— 空仓躲没躲对，看这一个数字 */}
          {empty && sameDay && ledger && ledger.summary.auction_buy_close_sell.n > 0 && (
            <div className="text-12 text-sub">
              空仓的机会成本：今天池内{' '}
              <b className="num text-txt">{ledger.summary.auction_buy_close_sell.n}</b> 只可成交票，
              全买平均{' '}
              <b
                className={cn(
                  'num font-semibold',
                  ledger.summary.auction_buy_close_sell.avg >= 0 ? 'text-up' : 'text-down',
                )}
              >
                {signedPct(ledger.summary.auction_buy_close_sell.avg)}
              </b>
              （胜 {num(ledger.summary.auction_buy_close_sell.win, 0)}%）
            </div>
          )}

          {dossier?.market_max_boards != null && (
            <div className="text-11 text-sub">
              全市场最高 <b className="num text-txt">{num(dossier.market_max_boards, 0)}</b> 板
              {dossier.market_style?.label && (
                <>
                  <span className="mx-1.5 text-line">|</span>
                  风格 {dossier.market_style.label}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── 右：为什么是这个结果（白话，不是指标）───────────────── */}
        <div className="flex flex-col gap-1 border-l-0 xl:border-l xl:border-line xl:pl-3">
          <div className="text-11 font-semibold text-txt">
            {empty ? '为什么没买' : '为什么买这几只'}
          </div>

          {/* 空仓且有名额：说明是「票没过闸」，不是环境拦的（两者责任不同） */}
          {quotaBlocked ? (
            <>
              <div className="text-12 leading-relaxed text-warn">
                环境防守 → 名额压到 0，今天不主动买。
              </div>
              {hits.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {hits.map((h) => (
                    <li key={h} className="text-12 leading-relaxed text-sub">
                      · {h}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-11 text-sub">
                  {level === 'block' ? '防守腿命中达上限（明细未生成）' : '命中条数已达拦截线'}
                </div>
              )}
            </>
          ) : empty ? (
            <div className="text-12 leading-relaxed text-sub">
              名额有 {effective ?? 0} 个，但今天池内没有票通过准入 ——
              逐票原因见下方「今日池」与「今日账本」的「为什么」一列。
            </div>
          ) : (
            <>
              <div className="text-12 leading-relaxed text-sub">
                系统按名额序买入前 {picks.length} 只（非券商成交），逐票理由见「今日池」。
              </div>
              {hits.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {hits.map((h) => (
                    <li key={h} className="text-11 leading-relaxed text-warn">
                      · 环境待观察：{h}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {meta?.market_open?.reason && (
            <div className="text-11 leading-relaxed text-sub">读数：{meta.market_open.reason}</div>
          )}
          {meta?.market_open_relief && <div className="text-11 text-rec">竞价后回暖，已解冻</div>}
        </div>
      </div>
    </Card>
  )
}
