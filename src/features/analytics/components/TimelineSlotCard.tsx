import { cn } from '@/shared/lib'
import { Tag } from './Table'
import {
  minToClock,
  SHAPE_META,
  type TimelineSlot,
  type TimelineSlotSector,
} from '../lib/timeline'
import type { ZtPoolStock } from '@/shared/api'
import type { StockThemeTag } from '../lib/theme-burst'

/**
 * 时间轴「分钟槽」卡片 —— **横向固定宽卡 + 内部固定 CSS grid**。
 *
 * ## 这一版纠正了什么
 *
 * 上一版把「整个行业全天」画成一条记录、把全部单票并成一张全日卡，导致后封的票被
 * 提前到最早时刻。现在 `buildTimelineSlots` 已把每只票按**自己的首封分钟**落点，
 * 本组件只负责把「一个分钟槽」画成一张 440px 的卡：
 *
 *   · 卡固定宽 440px、卡间 12px、行优先自动换行（非 dense / 非 masonry）；
 *   · 每卡一个时间（槽的 `at`），内部不重画时刻；
 *   · 卡内分区：**个股（按行业分组）/ 行业小注 / 事件 / 推送**，各自只渲染一次；
 *   · 个股行用**固定 CSS grid**（`名称 / 标记 / 行业 / 原因`），列宽固定、
 *     `min-w-0` + 截断约束，**长原因绝不溢出**（ellipsis + title）；
 *   · 题材标记保持**紫色加粗**；
 *   · 跨时行业的 🚀 爆发形态只作「全天汇总」小注（muted），**不冒充当刻爆发**。
 */
export const SLOT_WIDTH = 440
export const SLOT_GAP = 12

const ROW_GRID = 'minmax(0,1fr) auto 84px minmax(0,1fr)'

/** 一只票的一行：固定四列 grid（名称 / 标记 / 行业 / 原因） */
function StockRow({
  s,
  topBoard,
  tags,
  reasonByCode,
}: {
  s: ZtPoolStock
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
}) {
  const tag = tags.get(s.code)
  const reason = reasonByCode.get(s.code)
  return (
    <div className="grid items-baseline gap-x-2 min-w-0" style={{ gridTemplateColumns: ROW_GRID }}>
      {/* 列 1：名称 + 题材标记 + 👑（可换行，不溢出） */}
      <span className="flex items-baseline gap-1 flex-wrap min-w-0">
        <span
          className={cn('text-[12px] truncate', s.boards === topBoard && 'font-semibold text-up')}
          title={s.name}
        >
          {s.name}
        </span>
        {tag?.leaderOf.map((t) => (
          <span
            key={t}
            className="text-[10px] px-1 rounded-sm bg-lead-soft text-lead flex-none"
            title={`原系统认定：${t} 当前龙头`}
          >
            👑 {t}
          </span>
        ))}
        {tag?.themes
          .filter((t) => !tag.leaderOf.includes(t))
          .map((t) => (
            <span
              key={t}
              className="text-[10.5px] font-medium px-1 rounded-sm bg-rec-soft text-rec flex-none"
              title={`题材归属：${t}`}
            >
              {t}
            </span>
          ))}
      </span>
      {/* 列 2：板数 / 20cm / 炸板 */}
      <span className="flex items-baseline gap-1 flex-none">
        <StockMarks s={s} />
      </span>
      {/* 列 3：行业（固定宽，截断） */}
      <span className="text-[11px] text-sub truncate flex-none" title={s.sector} style={{ maxWidth: 84 }}>
        {s.sector}
      </span>
      {/* 列 4：涨停原因（长文 ellipsis + title，绝不溢出） */}
      {reason ? (
        <span
          className="text-[10.5px] text-sub truncate min-w-0"
          title={`涨停原因：${reason}`}
        >
          {reason}
        </span>
      ) : (
        <span className="min-w-0" />
      )}
    </div>
  )
}

/** 板数 / 20cm / 炸板三个标记（单票与行业块内共用） */
function StockMarks({ s }: { s: ZtPoolStock }) {
  return (
    <>
      <span className={cn('num text-[11px]', s.boards >= 2 ? 'text-up' : 'text-sub')}>
        {s.boards}板
      </span>
      {s.is_20cm && (
        <span className="text-[10px] text-warn" title="20cm 标的 · 波动大须紧止损">
          20cm
        </span>
      )}
      {s.zbc > 0 && (
        <span className="num text-[10px] text-warn" title={`当日炸板 ${s.zbc} 次`}>
          ×{s.zbc}
        </span>
      )}
    </>
  )
}

/** 槽内「某行业当刻封板」的分组块 */
function SectorSlotGroup({
  g,
  topBoard,
  tags,
  reasonByCode,
}: {
  g: TimelineSlotSector
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
}) {
  const meta = g.dayShape ? SHAPE_META[g.dayShape] : null
  const blockThemes = [...new Set(g.stocks.flatMap((s) => tags.get(s.code)?.themes ?? []))]
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[12.5px] font-semibold text-txt">{g.sector}</span>
        <span className="num text-[11px] text-sub">当刻 {g.count} 只</span>
        {/* ⚠️ 跨时形态只作「全天汇总」小注（muted），不冒充当刻爆发 */}
        {meta && (
          <span
            className="text-[10.5px] text-sub flex-none"
            title="该板块全天形态（汇总口径，非当刻爆发）"
          >
            {meta.icon} {meta.label}
          </span>
        )}
        {g.dayTotal != null && (
          <span
            className="text-[10px] text-sub"
            title="该板块全天封板总数，属汇总非时间定位"
          >
            当日共 {g.dayTotal} 只
            {g.daySpan && g.daySpan > 0 ? ` · 跨 ${g.daySpan} 分` : ' · 当刻即全天'}
          </span>
        )}
      </div>
      {blockThemes.length > 0 && (
        <div className="text-[10.5px] text-sub">
          含题材：<span className="text-rec font-medium">{blockThemes.join(' / ')}</span>
        </div>
      )}
      <div className="grid gap-x-2 gap-y-0.5 min-w-0">
        {g.stocks.map((s, i) => (
          <StockRow
            key={`stk:${g.sector}:${s.code}:${i}`}
            s={s}
            topBoard={topBoard}
            tags={tags}
            reasonByCode={reasonByCode}
          />
        ))}
      </div>
    </div>
  )
}

/** 槽内事件分区（系统时点观测，非事件时刻） */
function EventSlot({ events }: { events: NonNullable<TimelineSlot['events']> }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-faint pt-1 mt-0.5 min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-warn text-[11px] flex-none">⚡</span>
        <span className="text-[11px] font-semibold text-warn">
          {events.length > 1 ? `系统观测 ${events.length} 条` : '系统观测'}
        </span>
        <span
          className="text-sub text-[10px]"
          title="原系统按卡片批量写入，同一时刻的多条是同一张卡的观测"
        >
          卡片时刻，非事件时刻
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {events.map((e, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- 同名去重：同一张卡里可能重复同一句话，用内容做 key 会撞，索引即身份
          <li key={i} className="flex items-baseline gap-1.5 text-[12px] min-w-0">
            <Tag title="原系统严重度（信号强度，非涨跌方向）">{e.severity}</Tag>
            <span className={cn('text-txt truncate', /重挫/.test(e.event) && 'text-down')}>
              {e.event}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 槽内推送分区（题材台账） */
function PushSlot({
  pushes,
  at,
  to,
}: {
  pushes: NonNullable<TimelineSlot['pushes']>
  at: number
  to: number | null
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line-faint pt-1 mt-0.5 min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-lead text-[11px] flex-none">📤</span>
        <span className="text-[11px] font-semibold text-lead">题材推送 {pushes.length} 条</span>
        <span className="num text-sub text-[10.5px]">
          {minToClock(at)}~{minToClock(to ?? at)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {pushes.map((p) => (
          <div key={p.name} className="flex flex-col min-w-0">
            <span className="text-[12px] text-txt">
              {p.name}
              <span className="num text-sub ml-1">×{p.push_count}</span>
            </span>
            {p.context && (
              <span className="text-[10.5px] text-sub leading-snug truncate" title={p.context}>
                {p.context}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 时间轴分钟槽卡片。
 *
 * @param slot      一个分钟槽（来自 `buildTimelineSlots`）
 * @param topBoard  全市场最高板，用于高亮最高板个股
 * @param tags      代码 → 题材标记（来自 `buildThemeBursts`）
 * @param reasonByCode 代码 → 逐票涨停原因（同花顺）
 */
export function TimelineSlotCard({
  slot,
  topBoard,
  tags,
  reasonByCode,
}: {
  slot: TimelineSlot
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
}) {
  const stockCount = slot.sectors.reduce((n, g) => n + g.count, 0) + slot.singles.length
  return (
    <section
      key={slot.key}
      className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-line bg-card p-2 min-w-0 overflow-hidden flex-none"
      style={{ width: SLOT_WIDTH }}
      aria-label={`${minToClock(slot.at)} 当刻封板 ${stockCount} 只`}
    >
      {/* 时刻（每卡一个时间，内部不重画） */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="num text-[12px] font-semibold text-txt flex-none">
          {minToClock(slot.at)}
        </span>
        <span className="text-sub text-[10.5px]">当刻封板 {stockCount} 只</span>
      </div>

      {/* 行业内个股分区（同刻同行业合并为一组） */}
      {slot.sectors.map((g) => (
        <SectorSlotGroup
          key={`sec:${slot.at}:${g.sector}`}
          g={g}
          topBoard={topBoard}
          tags={tags}
          reasonByCode={reasonByCode}
        />
      ))}

      {/* 单票分区（仅同分钟合并，不跨分钟） */}
      {slot.singles.length > 0 && (
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[10.5px] text-sub">单票 {slot.singles.length} 只（未入板块集群）</div>
          <div className="grid gap-x-2 gap-y-0.5 min-w-0">
            {slot.singles.map((s, i) => (
              <StockRow
                key={`sng:${slot.at}:${s.code}:${i}`}
                s={s}
                topBoard={topBoard}
                tags={tags}
                reasonByCode={reasonByCode}
              />
            ))}
          </div>
        </div>
      )}

      {/* 事件分区（同刻合并） */}
      {slot.events && <EventSlot events={slot.events} />}

      {/* 推送分区（同刻合并） */}
      {slot.pushes && <PushSlot pushes={slot.pushes} at={slot.at} to={slot.pushTo} />}
    </section>
  )
}
