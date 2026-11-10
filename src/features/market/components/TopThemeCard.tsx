import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, isFrozenSnapshot } from '@/shared/lib'
import { Card, EmptyState, StockLink } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'
import { buildThemeRows, codeKey, type ThemeRow, type ThemeRowStock } from '../model/theme-rows'

const DELTA_LABEL: Record<string, string> = {
  new: '新晋',
  surging: '升温',
  ongoing: '持续',
}

/**
 * 「今天最强题材」—— 题材强度 + 该题材的个股汇总，**一行一题材，点开看个股**。
 *
 * ## 为什么要合并，而不是再开一张卡
 *
 * 2026-10-30 之前首页是两张独立的卡：`题材强度`（只有涨停/前值/增减）与
 * `核心标的`（全量票，不归属任何题材）。想回答「今天最强那条线里都有谁」，
 * 得在一张表里记下名字、再去另一张表里找——两张表都没有这个连接键。
 *
 * 而 `top5[].name` 与 `leaders[].sector` **是同一套词表**（实测 10/10 命中），
 * 所以正确的做法是让题材当行、个股当详情：**点击折叠**，一次只看一条线。
 *
 * ## 排序与默认态
 *
 * · 题材：涨停家数 → 环比增量 → 均换手（宽度优先，孤军高板不抢头条）
 * · 个股：**首封时间升序**（2026-10-31 用户口径）→ 无时间者排最后 → 同一时刻再看高度
 * · 默认展开**第一名**：打开页面就能看到最强那条线里是谁
 *
 * ⛔ 科创板（688/689）在数据层就剔除（用户无权限），不靠样式隐藏。
 */
export function TopThemeCard() {
  const { data } = useQuery(marketQueries.latest())
  const { data: pool } = useQuery(marketQueries.ztPool())

  /**
   * 6 位码 → 首封时间。
   *
   * 两个源，优先级明确：
   *   ① 主快照 `limit_up_stocks[].fbt`（30s 刷新，盘中就是当下）
   *   ② 盘后归档 `zt_pool.zt_list[].fbt`（只在**同一交易日**才用）
   *
   * ⛔ 跨日借用会把昨天的时间当今天用 —— 那比没有时间更糟。
   */
  const fbtByCode = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of data?.limit_up_stocks ?? []) {
      if (s.fbt) map.set(codeKey(s.code), s.fbt)
    }
    // ⚠️ `data_scope.asof` 实测是 **'2026-10-30 15:00'**（带时刻），不是纯日期；
    //    直接与 `zt_pool.date`（'2026-10-30'）比较会永远不等 → 时间永远回填不上。
    //    只比「日」，不比时刻。
    const asofDay = (data?.data_scope?.asof ?? data?.ts ?? '').slice(0, 10)
    const poolDay = String(pool?.date ?? '').slice(0, 10)
    const poolList = pool?.zt_list ?? []
    if (poolDay && poolDay === asofDay) {
      for (const s of poolList) {
        const k = codeKey(s.code)
        if (s.fbt && !map.has(k)) map.set(k, s.fbt)
      }
    }
    return map
  }, [data?.limit_up_stocks, data?.data_scope?.asof, data?.ts, pool])

  const rows = useMemo(
    () => buildThemeRows(data?.top5, data?.leaders, data?.early, fbtByCode),
    [data?.top5, data?.leaders, data?.early, fbtByCode],
  )

  /**
   * 非当日数据（周末/节假日/盘后）时标题不能写「今天」——那是事实错误。
   * 休息日看的是**上一个交易日的收盘定格**，标题与副标题都要跟着改。
   */
  const frozen = isFrozenSnapshot(data?.data_scope?.asof || data?.ts)
  const snapDay = String(data?.data_scope?.asof ?? data?.ts ?? '').slice(5, 10)

  // null = 默认全部收起（2026-11-10 截图审查：第一名默认展开会把 20+ 只票铺满首屏，
  //        其余题材被挤到折叠线以下）；点某一行才展开它，再点一次收起。
  const [picked, setPicked] = useState<string | null | undefined>(null)
  const activeName = picked === undefined ? (rows[0]?.name ?? null) : picked

  return (
    <Card
      title={frozen ? '最近交易日最强题材' : '今天最强题材'}
      extra={
        <span className="text-11 font-normal text-sub">
          {rows.length > 0
            ? `${frozen && snapDay ? `${snapDay} 收盘 · ` : ''}${rows.length} 个题材 · 点击展开个股`
            : '—'}
        </span>
      }
    >
      {rows.length > 0 ? (
        <div className="max-h-[420px] overflow-auto">
          {rows.map((t, i) => (
            <ThemeLine
              key={t.name}
              row={t}
              top={i === 0}
              open={t.name === activeName}
              onToggle={() => setPicked(t.name === activeName ? null : t.name)}
            />
          ))}
        </div>
      ) : (
        <EmptyState text="暂无题材强度数据" />
      )}
    </Card>
  )
}

function ThemeLine({ row, top, open, onToggle }: {
  row: ThemeRow
  top: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-t border-line-faint first:border-t-0">
      <button
        type="button"
        aria-label={`题材 ${row.name}`}
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'w-full cursor-pointer rounded-sm border-0 bg-transparent px-1 py-1.5 text-left text-txt',
          open && 'bg-line-faint',
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={cn('num w-[16px] text-12 font-semibold', top ? 'text-up' : 'text-sub')}>
            {row.rank}
          </span>
          <span className="text-13 font-semibold text-txt">{row.name}</span>
          {top && <span className="badge bg-up-soft text-up">最强</span>}
          <Tag>{DELTA_LABEL[row.delta] ?? (row.delta || '—')}</Tag>

          <span className="text-12 text-sub" title={`涨停 ${row.ztCount} 只 / 该题材共 ${row.totalStocks} 只`}>
            涨停 <b className="num text-13 text-up">{row.ztCount}</b>
            <span className="num text-sub">/{row.totalStocks}</span>
          </span>
          {row.change !== null && (
            <span className={cn('num text-12', pctTone(row.change))}>
              {row.change > 0 ? `+${row.change}` : row.change}
            </span>
          )}
          <span className="num text-11 text-sub">前值 {row.ztPrev ?? '—'}</span>

          <span className="inline-flex items-baseline gap-1.5 text-12 text-sub">
            <span>龙头 {row.leaderName || '—'}</span>
            {row.leaderBoards && <span className="text-lead">{row.leaderBoards}</span>}
            {row.leaderPct !== null && (
              <span className={cn('num', pctTone(row.leaderPct))}>{fmtPct(row.leaderPct, 1)}</span>
            )}
          </span>

          <span className="ml-auto flex-none text-11 text-sub">
            {open ? '收起 ▴' : `展开 ${row.stocks.length} 只 ▾`}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-1 pb-2 pt-0.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-11 text-sub">
            {row.desc && <span>{row.desc}</span>}
            <span className="num">均换手 {row.turnAvg ? `${row.turnAvg}%` : '—'}</span>
            {row.diffusion && <span>扩散 · {row.diffusion}</span>}
            {row.unsealedCount > 0 && <span className="text-rec">未封板 {row.unsealedCount}</span>}
          </div>

          {row.stocks.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {row.stocks.map((s) => (
                <StockChip key={s.code} stock={s} />
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-1.5 text-12 text-sub">该题材暂无个股明细（上游未提供涨停名单与核心标的）</p>
          )}

          {(row.positives.length > 0 || row.risks.length > 0) && (
            <div className="mt-1.5 flex flex-col gap-0.5 border-t border-line-faint pt-1.5 text-11">
              {row.positives.length > 0 && (
                <p className="m-0 text-sub">
                  <span className="text-up">催化</span> {row.positives.slice(0, 3).join(' · ')}
                </p>
              )}
              {row.risks.length > 0 && (
                <p className="m-0 text-sub">
                  <span className="text-down">风险</span> {row.risks.slice(0, 3).join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StockChip({ stock: s }: { stock: ThemeRowStock }) {
  return (
    <li data-stock-code={s.code} className="flex flex-wrap items-baseline gap-x-1.5 text-12">
      <StockLink code={s.code} className={cn('text-txt', s.isThemeLeader && 'font-semibold')}>
        {s.name}
      </StockLink>
      {/* 首封时间：这道题的答案就是「谁先被封死」，所以时间必须露在名字后面 */}
      {s.fbt && <span className="num text-10 text-sub" title={`首封 ${s.fbt}`}>{s.fbt}</span>}
      {s.boards && <span className="text-11 text-lead">{s.boards}</span>}
      <span className={cn('num text-11', s.unsealed ? 'font-semibold' : '', pctTone(s.pct))}>
        {fmtPct(s.pct, 1)}
      </span>
      {s.turn !== null && <span className="num text-11 text-sub">换 {s.turn}%</span>}
      {s.is20cm && <span className="text-10 text-sub" title="20cm · 波动大须紧止损">20cm</span>}
      {s.unsealed && <span className="text-10 text-rec">未封板</span>}
    </li>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="badge border border-line text-sub">{children}</span>
}
