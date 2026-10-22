import { cn } from '@/shared/lib'
import type { IntradayLimitUpStock, IntradayTimelineEvent } from '@/shared/api'
import { StockLink } from '@/shared/ui'
import { SLOT_VISIBLE_SECTORS, sortIntradaySectorEvents } from '../lib/timeline'

/**
 * 盘中逐事件（`intraday_timeline_<date>.jsonl`）的**共享渲染件**。
 *
 * 抽成独立文件的原因：它要同时被 `TimelineSlotCard`（合进主时间轴）使用，
 * 而 `TimelineSlotCard` 又导出 `SLOT_WIDTH` —— 若互相 import 会形成环。
 * 故常量与排序内核都放在 `../lib/timeline`（lib 不依赖组件，无环）。
 *
 * ## ⛔ 方向语义（A 股：涨红跌绿）
 * `zt_total` / `sector_up` / `stock_up` = **涨**；
 * `sector_down` / `limit_down_new` / `broken_new` = **跌**。
 *
 * ## 板块条目的「最多 3 个」（用户 2026-09-17）
 * 实测（2026-09-17 真实日志）：单张卡最多挤进 **9 个板块走强 + 6 个杀跌板块**，卡面被淹。
 * 现改为：**按强度降序**，卡面直接展示最强的 `SLOT_VISIBLE_SECTORS`(=3) 个，
 * 其余在「其余 N 个板块」标注之后照常渲染（**下拉可见，⛔ 不删数据**）。
 * 个股 / 炸板 / 跌停 / 涨停总数**不受此上限影响**（用户只要求板块）。
 */

/** 下跌侧事件类型（其余一律归「涨」侧） */
export const INTRADAY_DOWN_KINDS = new Set(['sector_down', 'limit_down_new', 'broken_new'])

export type IntradayDirection = 'up' | 'down'

export function intradayDirection(e: IntradayTimelineEvent): IntradayDirection {
  return INTRADAY_DOWN_KINDS.has(String(e.kind)) ? 'down' : 'up'
}

/** 板块级事件类型（受「最多 3 个」约束的那一类） */
const SECTOR_KIND: Record<IntradayDirection, string> = {
  up: 'sector_up',
  down: 'sector_down',
}

/**
 * 内容签名 + 出现序号 → 稳定唯一的 React key。
 * ⛔ 禁止用数组下标当 key（同刻可重复同一板块，下标在增删后会复用错位 DOM）。
 */
function withKeys<T>(items: T[], sig: (t: T) => string): Array<{ key: string; item: T }> {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const s = sig(item)
    const n = seen.get(s) ?? 0
    seen.set(s, n + 1)
    return { key: `${s}#${n}`, item }
  })
}

/** 单条事件的一行文字 */
export function IntradayEventLine({ e }: { e: IntradayTimelineEvent }) {
  switch (e.kind) {
    case 'zt_total':
      return (
        <div className="flex flex-col gap-1 text-[11.5px] text-txt">
          <span>
            涨停总数 <span className="num font-semibold">{e.total ?? '—'}</span>
            {e.delta != null && e.delta !== 0 && (
              <span className={cn('num ml-1', e.delta > 0 ? 'text-up' : 'text-down')}>
                {e.delta > 0 ? '+' : ''}
                {e.delta}
              </span>
            )}
          </span>
          {e.delta != null && e.delta > 0 && <LimitUpStocks label="新增封板" stocks={e.added} tone="up" />}
          {e.delta != null && e.delta < 0 && <LimitUpStocks label="打开涨停" stocks={e.removed} tone="down" />}
        </div>
      )
    case 'sector_up':
      return (
        <span className="text-[11.5px] text-up">
          <span className="font-medium">{e.name}</span>
          <span className="num text-sub ml-1">{e.zt_count == null ? '—' : `${e.zt_count}只`}</span>
          {e.delta != null && <span className="num text-up ml-1">新增 {e.delta} 只</span>}
        </span>
      )
    case 'stock_up':
      return (
        <span className="text-[11.5px] text-up">
          <StockLink code={e.code} className="font-medium">{e.name}</StockLink>
          {e.sector && <span className="text-sub ml-1">{e.sector}</span>}
          {e.pct != null && <span className="num ml-1">+{Number(e.pct).toFixed(2)}%</span>}
        </span>
      )
    case 'sector_down':
      return (
        <span className="text-[11.5px] text-down">
          <span className="font-medium">{e.name}</span>
          {e.pct != null && <span className="num ml-1">{Number(e.pct).toFixed(2)}%</span>}
          {e.inflow != null && (
            <span className="num text-sub ml-1">{(Number(e.inflow) / 1e8).toFixed(2)}亿</span>
          )}
        </span>
      )
    case 'limit_down_new':
      return <span className="text-[11.5px] text-down">{e.name} 跌停</span>
    case 'broken_new':
      /**
       * ⛔ 2026-10-20 自查：这里原来用 `text-warn`（青绿 #0d9488），
       * 而轴上的炸板节点是 `text-break`（琥珀 #e8940a）——
       * 同一个事实「炸板」在两个地方两种颜色，读者会以为是两类事件。
       * 统一到琥珀（warn 是「退潮预警」的青绿，另有归属）。
       */
      return <span className="text-[11.5px] text-break">{e.name} 炸板</span>
    /**
     * 短线精灵个股异动（2026-10-20 用户：「消息面呢？这边是否介入快讯
     * 【短线精灵 + 终端！！】」）。
     *
     * 来源是 `short_spirit_signals.json` 的 `signals_today[].first_seen`，
     * 由 `TimelinePage` 转成 `signal_new` 事件并入分钟槽。
     * ⛔ 不用「+x%」写法（那不是涨幅陈述，是异动）——给「异动」小标签 + 类型 + 涨幅。
     */
    /**
     * 外部快讯（2026-10-20 用户：「消息面呢？这边是否介入快讯【短线精灵+终端！！】」）。
     *
     * 由 `scripts/intraday_timeline.py` 落盘（`newsflash_new`，时刻=快讯自己的 `ctime`）。
     * ⛔ 标题**全文照抄**（轴上才截断）—— 明细里读的就是原文，不得改写、不得加判断。
     */
    case 'newsflash_new': {
      const title = typeof e.title === 'string' ? e.title : String(e.name ?? '')
      const plates = Array.isArray(e.plates) ? (e.plates as string[]) : []
      const stocks = Array.isArray(e.stocks) ? (e.stocks as string[]) : []
      return (
        <div className="flex flex-col gap-0.5 text-[11.5px] text-txt">
          <span>
            <span className="mr-1 rounded-sm bg-line-faint px-1 text-[10px] text-txt/70">快讯</span>
            {title}
          </span>
          {(plates.length > 0 || stocks.length > 0) && (
            <span className="pl-1.5 text-[10.5px] text-sub">
              {plates.length > 0 && <>板块 {plates.join('、')}</>}
              {plates.length > 0 && stocks.length > 0 && ' · '}
              {stocks.length > 0 && <>点名 {stocks.join('、')}</>}
            </span>
          )}
        </div>
      )
    }
    case 'signal_new': {
      // 索引签名是 `unknown`（事件是开放结构）→ 先收窄，⛔ 不直接把 unknown 塞进 JSX
      const sigType = typeof e.type === 'string' ? e.type : ''
      return (
        <span className="text-[11.5px] text-rec">
          <span className="mr-1 rounded-sm bg-rec-soft px-1 text-[10px] text-rec">异动</span>
          <StockLink code={e.code} className="font-medium">{e.name}</StockLink>
          {sigType && <span className="text-sub ml-1">{sigType}</span>}
          {e.pct != null && <span className="num ml-1">+{Number(e.pct).toFixed(2)}%</span>}
        </span>
      )
    }
    default:
      return (
        <span className="text-[11.5px] text-sub">
          {String(e.kind)}
          {e.name ? ` ${e.name}` : ''}
        </span>
      )
  }
}

/** 涨停总数变动的可核对个股明细；上游缺失时该节点已在投影层跳过。 */
function LimitUpStocks({
  label,
  stocks,
  tone,
}: {
  label: string
  stocks: IntradayLimitUpStock[] | null | undefined
  tone: 'up' | 'down'
}) {
  if (!stocks?.length) return null
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pl-1.5">
      <span className={cn('text-[10.5px] font-medium', tone === 'up' ? 'text-up' : 'text-down')}>{label}</span>
      {stocks.map((stock) => (
        <span key={stock.code} className="text-[11px] text-txt">
          <StockLink code={stock.code} className="font-medium">{stock.name || stock.code}</StockLink>
          {stock.sector && <span className="ml-1 text-sub">{stock.sector}</span>}
          {stock.boards != null && stock.boards !== '' && <span className="num ml-1 text-sub">{stock.boards}</span>}
        </span>
      ))}
    </div>
  )
}

/**
 * 一个方向（涨 / 跌）分区。
 *
 * 排版顺序：**板块条目在前（按强度降序，卡面只直接展示最强 3 个）**，
 * 非板块条目（炸板 / 跌停）在其后。
 *
 * 同分钟的市场总量变化、个股与板块事件共同展示，结构化个股由投影层避免重复。
 */
function DirectionSection({
  dir,
  label,
  events,
  showAll = false,
}: {
  dir: IntradayDirection
  label: string
  events: IntradayTimelineEvent[]
  /** ⛔ 明细浮层必须传 true —— 它是「完整明细」的落点，不能再截到 3 个 */
  showAll?: boolean
}) {
  const kind = SECTOR_KIND[dir]
  const sectors = withKeys(
    sortIntradaySectorEvents(
      events.filter((e) => String(e.kind) === kind),
      dir,
    ),
    (e) => `is:${kind}:${String(e.name ?? '')}`,
  )
  const others = events.filter((e) => String(e.kind) !== kind)
  const cap = showAll ? sectors.length : SLOT_VISIBLE_SECTORS
  const top = sectors.slice(0, cap)
  const rest = sectors.slice(cap)

  return (
    <div className={cn("flex flex-col gap-1 min-w-0 rounded-sm border-l-2 px-2 py-1.5", dir === "up" ? "bg-up-soft/40 border-up/40" : "bg-down-soft/40 border-down/40")}>
      <span className={cn('text-[10.5px] font-semibold', dir === 'up' ? 'text-up' : 'text-down')}>
        {label}
        {sectors.length > 0 && (
          <span className="text-sub font-normal ml-1.5">板块 {sectors.length} 个</span>
        )}
      </span>

      {top.length > 0 && (
        <div className="flex flex-col gap-0.5 min-w-0 pl-1.5">
          {top.map(({ key, item }) => (
            <IntradayEventLine key={key} e={item} />
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <>
          <div className="text-[10px] text-sub pl-1.5">↓ 其余 {rest.length} 个板块</div>
          <div className="flex flex-col gap-0.5 min-w-0 pl-1.5">
            {rest.map(({ key, item }) => (
              <IntradayEventLine key={key} e={item} />
            ))}
          </div>
        </>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-0.5 min-w-0 pl-1.5">
          {others.map((e, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- 同刻可重复同一标的，索引即身份
            <IntradayEventLine key={i} e={e} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 消息面事件（既不是「涨」也不是「跌」—— 单独一段，⛔ 不能塞进走强红框里） */
const NEWS_KINDS = new Set(['newsflash_new', 'signal_new'])

/**
 * 槽内的「🔴 涨 / 🟢 跌 / 📰 消息面」三段（合进主时间轴后共用）。
 * 空数组不渲染，保证无盘中事件的槽形态不变。
 *
 * ⚠️ 2026-10-20：消息面（外部快讯 + 短线精灵异动）此前混在「盘中走强」里，
 *    红框 + 走强标题会让「有条消息」被读成「这个板块在涨」。现在单列一段，
 *    中性灰底、无方向色 —— 与轴上的灰引导线同语义。
 */
export function IntradayEventBlock({
  up,
  down,
  showAll = false,
}: {
  up: IntradayTimelineEvent[]
  down: IntradayTimelineEvent[]
  /** 取消「板块最多 3 个」上限（明细浮层用） */
  showAll?: boolean
}) {
  const news = up.filter((e) => NEWS_KINDS.has(String(e.kind)))
  const upRest = up.filter((e) => !NEWS_KINDS.has(String(e.kind)))
  if (up.length === 0 && down.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5 rounded-sm bg-line-faint/60 px-1.5 py-1 min-w-0">
      {upRest.length > 0 && <DirectionSection dir="up" label="盘中走强与涨停变化" events={upRest} showAll={showAll} />}
      {down.length > 0 && (
        <DirectionSection dir="down" label="盘中走弱与风险变化" events={down} showAll={showAll} />
      )}
      {news.length > 0 && <NewsSection events={news} />}
    </div>
  )
}

/** 消息面一段（外部快讯 + 短线精灵异动）—— 中性灰，⛔ 不带涨跌方向色 */
function NewsSection({ events }: { events: IntradayTimelineEvent[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-sm border-l-2 border-line-strong bg-line-faint/70 px-2 py-1.5">
      <span className="text-[10.5px] font-semibold text-txt/75">
        消息面
        <span className="ml-1.5 font-normal text-sub">
          快讯 {events.filter((e) => String(e.kind) === 'newsflash_new').length} 条 · 异动{' '}
          {events.filter((e) => String(e.kind) === 'signal_new').length} 条
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 pl-1.5">
        {events.map((e, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- 同刻可重复同一标的，索引即身份
          <IntradayEventLine key={i} e={e} />
        ))}
      </div>
    </div>
  )
}
