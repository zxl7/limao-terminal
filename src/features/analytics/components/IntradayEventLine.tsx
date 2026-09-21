import { cn } from '@/shared/lib'
import type { IntradayTimelineEvent } from '@/shared/api'
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
        <span className="text-[11.5px] text-txt">
          涨停总数 <span className="num font-semibold">{e.total ?? '—'}</span>
          {e.delta != null && e.delta !== 0 && (
            <span className={cn('num ml-1', e.delta > 0 ? 'text-up' : 'text-down')}>
              {e.delta > 0 ? '+' : ''}
              {e.delta}
            </span>
          )}
        </span>
      )
    case 'sector_up':
      return (
        <span className="text-[11.5px] text-up">
          <span className="font-medium">{e.name}</span>
          <span className="num text-sub ml-1">{e.zt_count == null ? '—' : `${e.zt_count}只`}</span>
          {e.delta != null && <span className="num text-sub ml-1">+{e.delta}</span>}
        </span>
      )
    case 'stock_up':
      return (
        <span className="text-[11.5px] text-up">
          <span className="font-medium">{e.name}</span>
          {e.code && <span className="num text-sub ml-1">{e.code}</span>}
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
      return <span className="text-[11.5px] text-warn">{e.name} 炸板</span>
    default:
      return (
        <span className="text-[11.5px] text-sub">
          {String(e.kind)}
          {e.name ? ` ${e.name}` : ''}
        </span>
      )
  }
}

/**
 * 一个方向（涨 / 跌）分区。
 *
 * 排版顺序：**板块条目在前（按强度降序，卡面只直接展示最强 3 个）**，
 * 非板块条目（涨停总数 / 个股 / 炸板 / 跌停）在其后。
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
    <div className="flex flex-col gap-0.5 min-w-0">
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

/**
 * 槽内的「🔴 涨 / 🟢 跌」两段（合进主时间轴后共用）。
 * 空数组不渲染，保证无盘中事件的槽形态不变。
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
  if (up.length === 0 && down.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5 rounded-sm bg-line-faint/60 px-1.5 py-1 min-w-0">
      {up.length > 0 && <DirectionSection dir="up" label="🔴 爆发 / 走强" events={up} showAll={showAll} />}
      {down.length > 0 && (
        <DirectionSection dir="down" label="🟢 杀跌 / 炸板 / 跌停" events={down} showAll={showAll} />
      )}
    </div>
  )
}
