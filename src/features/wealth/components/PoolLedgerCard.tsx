import { useState } from 'react'
import type { ParticipationQuotes, PoolCallFile, PoolLedger, PoolLedgerAgg, PoolLedgerRow } from '@/shared/api'
import { Card, CardBadge, EmptyState, StockLink } from '@/shared/ui'
import { DataTable, type Column } from '@/features/analytics'
import { cn } from '@/shared/lib'
import { num, signedPct } from '../lib/format'

/**
 * 今日账本 —— **「今天这些票，09:25 买了、拿到收盘，到底赚没赚」**。
 *
 * ## 为什么这张卡必须是「今日决策」页的第一块
 *
 * 决策页原来是「环境 → 明日标的 → 接力池 → 观察池」，回答的全是**事前**问题。
 * 用户 2026-11-06 提出的真实需求是四句话：
 *   「买什么 / 赚没赚 / 为什么买 / 为什么没买」—— 后三个字「赚没赚」是**事后**的，
 *   原来整页没有任何一处回答它，只能自己去别处 join 竞价价和收盘价。
 *
 * `cache/pool_ledger/<date>.json` 就是为这件事新落的数据（`scripts/pool_ledger.py`），
 * 本卡是它唯一的展示面。
 *
 * ## 三条口径（⛔ 改渲染前先读）
 *
 * 1. 主口径 `au_ret` = **09:25 竞价价买 → 当日收盘卖**。用户原话「对比早上 9:25 竞价价
 *    看当天收盘赚没赚」。`oc_ret`（开盘价买）与 `chg_pct`（昨收→收盘）只作对照，⛔ 不可替代。
 * 2. `one_word`（一字板）/ `sealed_auction`（竞价已封死）**买不进** —— 标 `═`/`锁`、
 *    **不计入任何汇总**。把买不进的涨停算成收益是虚报（11-06 海源复材 +9.97% 封死、当日 −10.69%）。
 * 3. 台账文件**缺失 = 当日收盘 K 线未生成**（脚本 `exit 2` 不写半截文件），
 *    ⛔ 不是「今天没票」、更不是 0 收益。缺就明说「未生成」，不拿昨日顶上。
 */

/** 裁决 → 展示文案与语义色。⛔ 与 `AiPage.VIEW_META` 同义，别造第二套措辞。 */
const VIEW_LABEL: Record<string, { text: string; tone: string }> = {
  participate: { text: '买了', tone: 'text-up' },
  watch: { text: '只看', tone: 'text-sub' },
  skip: { text: '放弃', tone: 'text-down' },
}

/** 汇总条：n 只 / 均值 / 中位 / 胜率 */
function AggLine({ label, agg, strong }: { label: string; agg?: PoolLedgerAgg; strong?: boolean }) {
  if (!agg || !agg.n) {
    return (
      <span className="flex items-baseline gap-1">
        <span className="text-11 text-sub">{label}</span>
        <span className="num text-12 text-sub">—</span>
      </span>
    )
  }
  const up = agg.avg >= 0
  return (
    <span className="flex items-baseline gap-1.5" title={`最好 ${signedPct(agg.max)}／最差 ${signedPct(agg.min)}`}>
      <span className="text-11 text-sub">{label}</span>
      <span className="num text-11 text-sub">{agg.n} 只</span>
      <span className={cn('num font-semibold', strong ? 'text-14' : 'text-13', up ? 'text-up' : 'text-down')}>
        {signedPct(agg.avg)}
      </span>
      <span className="num text-11 text-sub">中位 {signedPct(agg.med)}</span>
      <span className="num text-11 text-sub">胜 {num(agg.win, 0)}%</span>
    </span>
  )
}

/** 一行票：赚最多的排最上，买不进的垫底（要看得见「为什么没买」） */
function rowRank(r: PoolLedgerRow): number {
  if (!r.tradable) return -9999
  return r.au_ret ?? -8888
}

/**
 * 逐票结算列 —— 全部走项目统一的 `DataTable`（⛔ 不要手写 `<table>`：
 * 通用表的表头浅底、hover 防串行、数值列右对齐都是统一维护的，
 * 手写一份就等于把这三条规矩复制一遍，下次改样式会漏）。
 */
const COLUMNS: Column<PoolLedgerRow>[] = [
  {
    label: '标的',
    cell: (r) => {
      const mark = r.one_word ? '一字' : r.sealed_auction ? '封死' : null
      return (
        <span className="flex items-baseline gap-1">
          <StockLink code={r.code} className="text-txt">
            {r.name || r.code}
          </StockLink>
          {mark && <span className="badge border-line text-sub">{mark}</span>}
        </span>
      )
    },
  },
  { label: '板', num: true, cell: (r) => <span className="text-sub">{r.boards || '—'}</span> },
  {
    label: '方向',
    cell: (r) => (
      <span className="block max-w-[92px] truncate text-sub" title={r.theme}>
        {r.theme || '—'}
      </span>
    ),
  },
  {
    label: '今开',
    num: true,
    cell: (r) => (
      <span className={(r.gap_pct ?? 0) >= 0 ? 'text-up' : 'text-down'}>{signedPct(r.gap_pct)}</span>
    ),
  },
  {
    // 🕳️ DEV = 今开 − 该票自己的质量预期。今开只说「开了多少」，DEV 说「比它该开的差多少」——
    //    后者才是 `gap_zone` 真正用的判据（实测 U 形：≤−6 最好、−4~−2 最差）。
    label: 'DEV',
    num: true,
    cell: (r) =>
      r.dev === null || r.dev === undefined ? (
        <span className="text-sub" title="该日冻结件无 quality 预期项">
          —
        </span>
      ) : (
        <span className={(r.dev ?? 0) >= 0 ? 'text-up' : 'text-down'}>{signedPct(r.dev, 1)}</span>
      ),
  },
  {
    label: '裁决',
    cell: (r) => (
      <span className={(VIEW_LABEL[r.view] ?? { tone: 'text-sub' }).tone}>
        {(VIEW_LABEL[r.view] ?? { text: r.view }).text}
      </span>
    ),
  },
  {
    label: '竞价→收盘',
    num: true,
    cell: (r) =>
      r.tradable ? (
        <span
          className={cn(
            'font-semibold',
            (r.au_ret ?? 0) > 0 ? 'text-up' : (r.au_ret ?? 0) < 0 ? 'text-down' : 'text-txt',
          )}
          title="09:25 竞价价买 → 当日收盘卖"
        >
          {signedPct(r.au_ret)}
        </span>
      ) : (
        <span className="text-sub" title="买不进（一字/竞价封死），不计入统计">
          —
        </span>
      ),
  },
  {
    // 📏 T+1 另立口径：竞价买 → **次日**收盘卖（A 股当天买的当天不能卖）。
    //    ⛔ 与「竞价→收盘」并列展示，不可互相替代；次日未生成时是 `—` 不是 0。
    label: 'T+1',
    num: true,
    cell: (r) => (
      <span
        className={cn(
          'text-sub',
          r.t1_ret === null || r.t1_ret === undefined ? '' : (r.t1_ret ?? 0) >= 0 ? 'text-up' : 'text-down',
        )}
        title={r.t1_date ? `竞价价买 → ${r.t1_date} 收盘卖` : '次日行情未生成'}
      >
        {signedPct(r.t1_ret)}
      </span>
    ),
  },
  {
    label: '当日',
    num: true,
    cell: (r) => (
      <span className="text-sub" title="昨收 → 收盘">
        {signedPct(r.chg_pct)}
      </span>
    ),
  },
  {
    label: '为什么',
    className: 'whitespace-normal min-w-[300px]',
    cell: (r) => (
      <span className="line-clamp-2 text-11 leading-snug text-sub" title={r.reason}>
        {r.reason || '—'}
      </span>
    ),
  },
]

export function PoolLedgerCard({
  ledger,
  callFile,
  quotes,
  /** 与台账同日的 09:25 裁决：只为取「实际成交几只」，⛔ 不参与收益计算 */
  participateCount,
  effectiveQuota,
}: {
  ledger?: PoolLedger
  callFile?: PoolCallFile
  quotes?: ParticipationQuotes
  participateCount?: number
  effectiveQuota?: number
}) {
  if (ledger && callFile && ledger.date !== callFile.trade_date) ledger = undefined
  const picks = callFile?.meta?.participate ?? []
  const [today] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()))
  const buyList = (
    <div className="flex flex-col gap-2">
      <div className="text-11 text-sub">
        系统买入名单 · 09:25 冻结裁决，非券商成交 · 已结算显示「竞价价买→收盘卖」，未结算显示实时数据（昨收对比，非持仓收益）
      </div>
      {!callFile ? <div className="text-12 text-sub">该执行日裁决未生成，不使用昨日名单</div> : !picks.length ? <div className="text-12 text-sub">该执行日系统无参与票</div> : picks.map((code) => {
        const quote = callFile.trade_date === today && quotes?.date === today ? quotes.quotes[code] : undefined
        const stamp = quote && new Date(quote.ts)
        const clock = stamp && Number.isFinite(stamp.getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(stamp) : ''
        const valid = quote && Number.isFinite(quote.pct) && stamp && Number.isFinite(stamp.getTime()) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(stamp) === today && clock >= '09:30'
        const row = ledger?.rows.find((r) => r.code === code)
        /**
         * ⛔ 2026-11-10 用户「同一只票一处 +5.54%、一处暂无报价」：
         *    账本已落盘时**以账本为主口径**（竞价价买→收盘卖），实时数据只作未结算时的兜底。
         *    原来无条件走实时数据，收盘后 quotes 过期 → 明明有结算却显示「暂无报价」。
         */
        const settled = row != null && typeof row.au_ret === 'number' && Number.isFinite(row.au_ret)
        const pct = settled ? (row!.au_ret as number) : valid ? quote.pct : null
        const tone = pct == null ? 'text-sub' : pct >= 0 ? 'text-up' : 'text-down'
        const note = settled
          ? '收盘结算 · 竞价价买 → 收盘卖'
          : valid
            ? `${quote.source} · 快照 ${quote.ts}`
            : callFile.trade_date !== today ? '历史执行日不套用今日行情' : '实时数据未到 · 结算见下表'
        const name = callFile.views[code]?.name || row?.name || '名称暂无'
        return <div key={code} className="flex flex-wrap items-baseline gap-3 text-12">
          <StockLink code={code}>{name}</StockLink><span className="num text-sub">{code}</span>
          <span className={tone}>{pct == null ? '暂无报价' : signedPct(pct)}</span>
          <span className="text-11 text-sub">{note}</span>
        </div>
      })}
    </div>
  )
  if (!ledger) {
    return (
      <Card title="今日账本" extra={<CardBadge tone="warn">未生成</CardBadge>}>
        {buyList}
        <EmptyState
          text="今日收盘结算未生成"
          hint="16:00 收盘 K 线确认后由 scripts/pool_ledger.py 生成；不是「今天没票」，也不是 0 收益"
        />
      </Card>
    )
  }

  /**
   * 🕳️ 空列治理（2026-11-10）：T+1 次日行情未生成时整列为 `—`。
   * 它既占宽度（把「为什么」挤出视口），又让读者以为「今天 T+1 是 0」。
   * 全列都空 → 整列不渲染；有任意一行有值才显示。
   */
  const showT1 = ledger.rows.some((r) => r.t1_ret !== null && r.t1_ret !== undefined)
  const columns = showT1 ? COLUMNS : COLUMNS.filter((c) => c.label !== 'T+1')

  const s = ledger.summary
  const agg = s.auction_buy_close_sell
  const rows = [...ledger.rows].sort((a, b) => rowRank(b) - rowRank(a))
  const bands = Object.entries(s.by_gap_band)
  const devBands = Object.entries(s.by_dev_band ?? {})
  const t1 = s.auction_buy_next_close_sell
  const views = Object.entries(s.by_view)

  return (
    <Card
      title="今日账本"
      extra={<CardBadge>{ledger.date}</CardBadge>}
    >
      <div className="flex flex-col gap-2">
        {buyList}
        {/* ① 一行结论：今天到底赚没赚 */}
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-sm bg-hover px-2.5 py-1.5">
          <AggLine label="池内全买" agg={agg} strong />
          <span className="flex items-baseline gap-1.5">
            <span className="text-11 text-sub">系统参与（非券商成交）</span>
            <span
              className={cn(
                'num text-13 font-semibold',
                (participateCount ?? 0) > 0 ? 'text-up' : 'text-sub',
              )}
            >
              {participateCount ?? 0} 只
            </span>
            {effectiveQuota === 0 && <span className="text-11 text-warn">名额 0 → 今天空仓</span>}
          </span>
        </div>

        {/* ② 口径与剔除项：买不进的不许混进收益 */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-0.5 text-11 text-sub">
          <span>口径：09:25 竞价价买 → 当日收盘卖</span>
          <span className="text-line">|</span>
          <span>
            池内 <b className="num text-txt">{s.pool}</b> 只 · 可成交{' '}
            <b className="num text-txt">{s.tradable}</b> 只
          </span>
          <span className="text-line">|</span>
          <span>
            买不进 <b className="num text-txt">{s.one_word + s.sealed_auction}</b> 只（一字{' '}
            {s.one_word}、竞价封死 {s.sealed_auction}）<b className="text-txt">不计入统计</b>
          </span>
          <span className="text-line">|</span>
          <span>
            当日封板 <b className="num text-txt">{s.sealed}</b> 只
          </span>
        </div>

        {/* ③ 按裁决分组：闸判对没判对，看这两行就够 */}
        {views.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-0.5">
            {views.map(([k, a]) => (
              <AggLine key={k} label={VIEW_LABEL[k]?.text ?? k} agg={a} />
            ))}
          </div>
        )}

        {/* ④ 按今开分档：拐点在哪一档，一眼看得出 */}
        {bands.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-sm border border-line px-2.5 py-1">
            <span className="text-11 text-sub">按今开分档</span>
            {bands.map(([k, a]) => (
              <span key={k} className="flex items-baseline gap-1">
                <span className="num text-11 text-sub">{k}</span>
                <span className={cn('num text-12 font-semibold', a.avg >= 0 ? 'text-up' : 'text-down')}>
                  {signedPct(a.avg)}
                </span>
                <span className="num text-11 text-sub">({a.n})</span>
              </span>
            ))}
          </div>
        )}

        {/* ④′ 按 DEV 分档：今开分档看不出结构，DEV 才有拐点（≤−6 最好、−4~−2 最差） */}
        {devBands.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-sm border border-line px-2.5 py-1">
            <span className="text-11 text-sub">按 DEV 分档</span>
            {devBands.map(([k, a]) => (
              <span key={k} className="flex items-baseline gap-1">
                <span className="num text-11 text-sub">{k}</span>
                <span className={cn('num text-12 font-semibold', a.avg >= 0 ? 'text-up' : 'text-down')}>
                  {signedPct(a.avg)}
                </span>
                <span className="num text-11 text-sub">({a.n})</span>
              </span>
            ))}
          </div>
        )}

        {/* ④″ T+1 另立口径汇总：A 股当天买的当天不能卖，与主口径并列不可替代 */}
        {t1 && t1.n > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-0.5">
            <span className="text-11 text-sub">T+1 另立口径</span>
            <AggLine label="竞价买→次日收盘" agg={t1} />
          </div>
        )}

        {/* ⑤ 逐票结算（含拒因）—— 「赚没赚」和「为什么」在同一行里 */}
        <DataTable<PoolLedgerRow>
          rows={rows}
          rowKey={(r) => r.code}
          dense
          columns={columns}
          // 买不进（一字/竞价封死）整行压灰：它出现在表里只为回答「为什么没买」，
          // ⛔ 它的收益不参与统计，视觉上必须与可成交行区分开。
          rowClass={(r) => (r.tradable ? undefined : 'opacity-55')}
        />

        {/* 采集漏票必须可见：⛔ 与「没竞价」不是一回事 */}
        {(ledger.coverage.missing_quotes.length > 0 || ledger.coverage.missing_kline.length > 0) && (
          <div className="text-11 text-warn leading-relaxed">
            数据缺口：竞价漏采 {ledger.coverage.missing_quotes.length} 只
            {ledger.coverage.missing_quotes.length > 0 && `（${ledger.coverage.missing_quotes.join('、')}）`}
            ；日线缺 {ledger.coverage.missing_kline.length} 只
          </div>
        )}
      </div>
    </Card>
  )
}
