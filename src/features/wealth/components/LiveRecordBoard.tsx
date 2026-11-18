import type { AiDecisionEntry, AiNavEntry } from '@/shared/api'
import { Card, CardBadge, LineChart, StockLink } from '@/shared/ui'
import { DataTable, StatPair, Tag, n1, n2, pct } from '@/features/analytics'
import { cn } from '@/shared/lib'
import { navRowsDesc } from '../lib/nav'

/**
 * 实盘战绩 —— AI 轨的**交易记录 + 净值曲线 + 逐日结算**（2026-11-18 用户）。
 *
 * ## 为什么单独成一个顶层面板
 *
 * 这三块数据原先塞在「今日」里的二级 tab（战绩 → 净值曲线 / 台账明细），
 * 结果是「看 AI 到底赚没赚」要先点进今日、再点二级 tab，且和当日决策混在同一屏。
 * 用户要求：**实盘战绩不进细分，直接在财富密码顶部单开一个入口**。
 *
 * ## 口径（⛔ 三条都不能混）
 *
 * 1. **AI 轨与脚本轨是两本独立账**，起点都是 1.0；本面板只放 AI 轨，
 *    脚本轨在「交易战绩」页（`/trade`）。⛔ 不把两条曲线放同一坐标比大小。
 * 2. **策略口径（当日收盘卖）与 T+1 口径（次日收盘卖）并列**，差额来自 T+1 制度，
 *    ⛔ 不相加、不换算。T+1 缺日时前向填充（净值是阶梯序列），⛔ 不插值、不补 0。
 * 3. **指标全部由后端算好落盘**，前端只做「末值 / 回撤」这类可由序列直接读出的展示，
 *    ⛔ 不在这里重算复利、年化、胜率 —— 那会变成第二套口径。
 */

/** 仓位加权口径的文案（与账本 `strategy` 字段一一对应） */
const CALIBER_LABEL: Record<string, string> = {
  ai_judgement_next_day_close: '策略口径（竞价→当日收盘）',
  ai_judgement_t1_close: 'T+1 口径（竞价→次日收盘）',
}

const NAV_BASELINE: { value: number; label: string; tone: 'sub'; dashed: boolean }[] = [
  { value: 1, label: '盈亏分界 1.0', tone: 'sub', dashed: true },
]

export interface LiveRecordBoardProps {
  /** 策略口径净值（正序） */
  navRows: AiNavEntry[]
  /** T+1 口径净值（正序，可空） */
  navT1Rows: AiNavEntry[]
  /** AI 逐票决策台账（已按决策日倒序） */
  decRows: AiDecisionEntry[]
  loading?: boolean
}

export function LiveRecordBoard({ navRows, navT1Rows, decRows, loading }: LiveRecordBoardProps) {
  /** 横轴 = 两套口径成交日的并集；各自前向填充（缺日沿用上一净值，起点 1.0） */
  const axis = (() => {
    const ds = new Set<string>()
    for (const r of navRows) ds.add(r.trade_date)
    for (const r of navT1Rows) ds.add(r.trade_date)
    return [...ds].sort()
  })()

  const fill = (rows: AiNavEntry[], d: string) => {
    let v = 1
    for (const r of rows) {
      if (r.trade_date > d) break
      v = r.nav
    }
    return v
  }

  const series: Array<{ name: string; values: number[]; tone: 'up' | 'rec'; area?: boolean }> = [
    { name: '策略口径（当日收盘）', values: axis.map((d) => fill(navRows, d)), tone: 'up', area: true },
  ]
  if (navT1Rows.length) {
    series.push({ name: 'T+1 口径（次日收盘）', values: axis.map((d) => fill(navT1Rows, d)), tone: 'rec' })
  }

  const lastNav = navRows.at(-1)
  let maxDrawdown = 0
  {
    let peak = -Infinity
    for (const r of navRows) {
      peak = Math.max(peak, r.nav)
      maxDrawdown = Math.min(maxDrawdown, r.nav / peak - 1)
    }
  }

  const navTableRows = navRowsDesc(navRows)
  /** 已结算且有成交的记录＝实盘交易（空仓日单独标注，不混进交易笔数） */
  const tradedRows = navRows.filter((r) => r.stock_count > 0)

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="AI 轨净值"
        extra={
          <CardBadge tone={lastNav && lastNav.nav >= 1 ? 'up' : 'down'}>
            {lastNav ? n2(lastNav.nav) : '—'}
          </CardBadge>
        }
      >
        <div className="mb-2 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <StatPair
            label="累计收益"
            value={lastNav ? pct((lastNav.nav - 1) * 100) : '—'}
            tone={lastNav && lastNav.nav >= 1 ? 'up' : 'down'}
          />
          <StatPair label="最大回撤" value={navRows.length ? pct(maxDrawdown * 100) : '—'} tone="down" />
          <StatPair label="结算日数" value={navRows.length} />
          <StatPair label="有成交日" value={tradedRows.length} />
          <StatPair label="最新结算日" value={lastNav?.trade_date ?? '—'} />
        </div>
        <div className="mb-3 rounded-sm border border-line p-2.5">
          {axis.length ? (
            <LineChart series={series} labels={axis} height={220} format={(v) => n2(v)} refLines={NAV_BASELINE} />
          ) : (
            <div className="py-8 text-center text-12 text-sub">
              {loading ? '加载中…' : '尚无结算记录（每交易日 15:30 后生成）'}
            </div>
          )}
        </div>
        <DataTable
          rows={navTableRows}
          rowKey={(r) => r.trade_date}
          empty="尚无结算记录（15:30 后生成）"
          columns={[
            {
              label: '结算日',
              cell: (r, i) => (
                <span className="num">
                  {r.trade_date}
                  {i === 0 && <span className="ml-1.5 text-10 text-sub">最新</span>}
                </span>
              ),
            },
            { label: '决策日', cell: (r) => <span className="num text-sub">{r.recommendation_date}</span> },
            { label: '口径', cell: (r) => <Tag>{CALIBER_LABEL[r.strategy] ?? (r.strategy || '—')}</Tag> },
            {
              label: '成交数',
              num: true,
              cell: (r) => <span className={r.stock_count === 0 ? 'text-sub' : 'text-txt'}>{r.stock_count}</span>,
            },
            {
              label: '当日均收益',
              num: true,
              cell: (r) => (
                <span className={r.avg_return_pct >= 0 ? 'text-up' : 'text-down'}>{pct(r.avg_return_pct)}</span>
              ),
            },
            {
              label: '净值',
              num: true,
              cell: (r) => (
                <span className={cn('num font-semibold', r.nav >= 1 ? 'text-up' : 'text-down')}>{n2(r.nav)}</span>
              ),
            },
            {
              label: '成交标的',
              className: 'whitespace-normal min-w-[240px]',
              cell: (r) =>
                r.stocks.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.stocks.map((s) => (
                      <Tag key={s.code} tone={s.return_pct >= 0 ? 'up' : 'down'}>
                        <StockLink code={s.code}>
                          {s.name || s.code} {pct(s.return_pct, 1)}
                        </StockLink>
                      </Tag>
                    ))}
                  </span>
                ) : (
                  <span className="text-sub">空仓</span>
                ),
            },
          ]}
        />
      </Card>

      <Card title="AI 交易台账" extra={<CardBadge>{decRows.length} 条</CardBadge>}>
        <DataTable<AiDecisionEntry>
          rows={decRows}
          rowKey={(r, i) => `${r.decision_date}-${r.code}-${i}`}
          empty="台账为空"
          columns={[
            { label: '决策日', cell: (r) => <span className="num">{r.decision_date}</span> },
            {
              label: '标的',
              cell: (r) => (
                <StockLink code={r.code} className="text-txt">
                  {r.name || r.code}
                </StockLink>
              ),
            },
            {
              label: '排序评分',
              num: true,
              cell: (r) => (
                <span className={cn('num font-semibold', (r.ranking_score ?? 0) >= 80 ? 'text-up' : 'text-txt')}>
                  {r.ranking_score == null ? '—' : `${n1(r.ranking_score)} / 100`}
                </span>
              ),
            },
            {
              label: '判断',
              cell: (r) => (
                <span className={r.view === 'participate' ? 'text-up' : r.view === 'watch' ? 'text-rec' : 'text-sub'}>
                  {r.view === 'participate' ? '参与' : r.view === 'watch' ? '观察' : '放弃'}
                </span>
              ),
            },
            { label: '仓位', num: true, cell: (r) => (r.position ? r.position : '—') },
            {
              label: '结算',
              cell: (r) => <Tag tone={r.settled ? 'up' : 'neutral'}>{r.settled ? '已结算' : '未结算'}</Tag>,
            },
            {
              label: '理由',
              className: 'whitespace-normal min-w-[320px]',
              cell: (r) => <span className="text-12 leading-relaxed">{r.reason || '—'}</span>,
            },
          ]}
        />
      </Card>
    </div>
  )
}
