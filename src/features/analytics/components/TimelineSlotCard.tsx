import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'
import { Tag } from './Table'
import { IntradayEventBlock } from './IntradayEventLine'
import {
  minToClock,
  SHAPE_META,
  SLOT_VISIBLE_SECTORS,
  sortSlotSectors,
  type TimelineBlock,
  type TimelineSlot,
  type TimelineSlotSector,
} from '../lib/timeline'
import type { ZtPoolStock } from '@/shared/api'
import type { StockThemeTag } from '../lib/theme-burst'
import { slotThemeMarks } from '../lib/theme-burst'

/**
 * 时间轴「分钟槽」卡片 —— **固定宽 × 固定高 × 内部滚动**。
 *
 * ## 这一版纠正了什么（用户 2026-09-17 第三轮）
 *
 * | 问题 | 修法 |
 * |---|---|
 * | 卡片高度随内容浮动 → 换行后高低不齐、长卡把整行拉长 | **固定高 240px**（`SLOT_HEIGHT`），超出**内部滚动** |
 * | 卡内板块顺序 = 数据出现顺序 → 「最强的板块不一定在最前」 | `sortSlotSectors` **按强度降序**（强→弱） |
 * | 板块多了要靠肉眼翻 → 找不到主线 | 卡面**直接展示最强 3 个**（`SLOT_VISIBLE_SECTORS`），其余在分隔标注后**下拉可见**（⛔ 不丢数据） |
 * | 内容一长，时刻被挤走 → 不知道这张卡是几点 | 卡头（时刻）**固定在滚动区之外**，永远可见 |
 *
 * ## 保留的既有契约（⛔ 勿回退）
 *   · 卡固定宽 440px、卡间 12px、行优先自动换行（非 dense / 非 masonry）；
 *   · 个股行**固定四列 CSS grid**（名称 100px / 标记 84px / 行业 84px / 原因自适应），
 *     `min-w-0` + 截断约束，**长原因绝不溢出**（ellipsis + title）；
 *   · 题材标记保持**紫色加粗**；跨时行业的 🚀 形态只作「全天汇总」小注，**不冒充当刻爆发**。
 */
export const SLOT_WIDTH = 440
/** 卡片**固定高度**（px）—— 卡面等高 + 内部滚动，长内容不撑高整行（用户 2026-09-17） */
export const SLOT_HEIGHT = 240
export const SLOT_GAP = 12
// `SLOT_VISIBLE_SECTORS`（卡内直接展示的板块条目上限）定义在 `../lib/timeline` —— 单一来源，
// 行业分组块与盘中板块事件**共用同一上限**（避免两处常量各写一个 3 而漂移）。

/**
 * 固定四列 grid：**名称 100px / 标记 84px / 行业 84px / 原因 自适应**。
 *
 * ⛔ 之前「标记」列用了 `auto`，会因 20cm / 炸板 有无而每行变宽，导致列不齐。
 * 现在三列全固定（`auto` → 固定 px），标记列在 84px 内 `flex-wrap` 自行换行，
 * 不再把整列撑宽。名称/原因用 `min-w-0` + 截断约束，长文本不溢出。
 */
const ROW_GRID = '100px 84px 84px minmax(0,1fr)'

/**
 * 内容签名 + 出现序号 → 稳定唯一的 React key。
 *
 * ⛔ 禁止用数组索引当 key（切日期后索引不变而内容全变 → 复用错位 DOM）；
 * 但同名题材/板块在同一槽内可能重复，故用「签名 + 第几次出现」保证唯一。
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
          className={cn('text-[12px] truncate min-w-0', s.boards === topBoard && 'font-semibold text-up')}
          title={s.name}
        >
          {s.name}
        </span>
        {tag?.leaderOf.map((t) => (
          <span
            key={t}
            className="text-[10px] px-1 rounded-sm bg-lead-soft text-lead min-w-0 max-w-full truncate"
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
              className="text-[10.5px] font-medium px-1 rounded-sm bg-rec-soft text-rec min-w-0 max-w-full truncate"
              title={`题材归属：${t}`}
            >
              {t}
            </span>
          ))}
      </span>
      {/* 列 2：板数 / 20cm / 炸板（固定 84px 内换行，不撑宽整列） */}
      <span className="flex items-baseline gap-1 flex-wrap min-w-0">
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
  rank,
  topBoard,
  tags,
  reasonByCode,
}: {
  g: TimelineSlotSector
  /** 强度排名（1 = 最强）—— 卡面直接给出「哪个板块最强」 */
  rank?: number
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
}) {
  const meta = g.dayShape ? SHAPE_META[g.dayShape] : null
  const blockThemes = [...new Set(g.stocks.flatMap((s) => tags.get(s.code)?.themes ?? []))]
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        {rank != null && (
          <span
            className={cn(
              'num text-[10px] px-1 rounded-sm flex-none',
              rank === 1 ? 'bg-up-soft text-up font-semibold' : 'bg-line-faint text-sub',
            )}
            title={`强度排名第 ${rank}（按当刻封板家数 → 组内最高板 → 全天总数）`}
          >
            #{rank}
          </span>
        )}
        <span className="text-[12.5px] font-semibold text-txt break-all min-w-0">{g.sector}</span>
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
        <div className="text-[10.5px] text-sub break-all min-w-0">
          含题材：<span className="text-rec font-medium break-all">{blockThemes.join(' / ')}</span>
        </div>
      )}
      <div className="grid gap-x-2 gap-y-0.5 min-w-0">
        {(() => {
          const seen = new Map<string, number>()
          return g.stocks.map((s) => {
            // 内容签名（板块+代码+首封）+ 同签名出现序号：同刻同股多条有效记录也互不撞键、不丢
            const sig = `stk:${g.sector}:${s.code}:${s.fbt ?? ''}`
            const n = seen.get(sig) ?? 0
            seen.set(sig, n + 1)
            return (
              <StockRow
                key={`${sig}#${n}`}
                s={s}
                topBoard={topBoard}
                tags={tags}
                reasonByCode={reasonByCode}
              />
            )
          })
        })()}
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
            <span className={cn('text-txt truncate min-w-0', /重挫/.test(e.event) && 'text-down')} title={e.event}>
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
        {(() => {
          const seen = new Map<string, number>()
          return pushes.map((p) => {
            // 内容签名 + 同签名出现序号：同刻同题材推送多条也不丢、不撞键
            const sig = `push:${p.name}:${p.push_count}`
            const n = seen.get(sig) ?? 0
            seen.set(sig, n + 1)
            return (
              <div key={`${sig}#${n}`} className="flex flex-col min-w-0">
                <span className="text-[12px] text-txt break-all min-w-0" title={p.name}>
                  {p.name}
                  <span className="num text-sub ml-1">×{p.push_count}</span>
                </span>
                {p.context && (
                  <span className="text-[10.5px] text-sub leading-snug truncate" title={p.context}>
                    {p.context}
                  </span>
                )}
              </div>
            )
          })
        })()}
      </div>
    </div>
  )
}

/**
 * 时间轴卡片的**统一外壳**（普通 / 联动 / 合并三处共用）。
 *
 * · **固定宽 + 固定高** → 换行后卡面等高、行列整齐（不再被长内容撑高）；
 * · **卡头固定在滚动区之外** → 无论内容多长，**时刻永远可见**（时间轴的第一信息）；
 * · **卡体滚动** → 超出部分下拉查看，⛔ 不裁剪数据（用户「不丢不重」铁律）。
 */
function CardShell({
  tone,
  ariaLabel,
  head,
  children,
}: {
  tone: 'normal' | 'linkage'
  ariaLabel: string
  head: ReactNode
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'flex flex-col rounded-[var(--radius-sm)] border min-w-0 overflow-hidden flex-none',
        tone === 'linkage' ? 'border-up/40 bg-up-soft' : 'border-line bg-card',
      )}
      style={{ width: SLOT_WIDTH, height: SLOT_HEIGHT }}
      aria-label={ariaLabel}
    >
      {/* 卡头：⛔ 不随卡体滚动（时刻必须常驻可见） */}
      <div className="flex-none px-2 pt-2 pb-1.5 min-w-0">{head}</div>
      {/* 卡体：固定高之外的余量 → 滚动区（`min-h-0` 是 flex 内滚动的必要条件） */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-2 flex flex-col gap-1.5 min-w-0">
        {children}
      </div>
    </section>
  )
}

/** 卡头内容：时刻 + 当刻封板数 + 板块数（已按强度排序） */
function SlotHead({ slot, sectorCount }: { slot: TimelineSlot; sectorCount: number }) {
  const stockCount = slot.sectors.reduce((n, g) => n + g.count, 0) + slot.singles.length
  return (
    <div className="flex items-baseline gap-2 flex-wrap min-w-0">
      <span className="num text-[13px] font-semibold text-txt flex-none">
        {minToClock(slot.at)}
      </span>
      <span className="text-sub text-[10.5px]">当刻封板 {stockCount} 只</span>
      {sectorCount > 0 && (
        <span
          className="text-sub text-[10.5px]"
          title={`板块按强度降序（当刻封板家数 → 组内最高板 → 全天总数）；卡面直接展示最强 ${SLOT_VISIBLE_SECTORS} 个`}
        >
          板块 {sectorCount} 个 · 按强度排序
        </span>
      )}
      {sectorCount > SLOT_VISIBLE_SECTORS && (
        <span className="text-warn text-[10px] flex-none">↓ 下拉看其余 {sectorCount - SLOT_VISIBLE_SECTORS} 个</span>
      )}
    </div>
  )
}

/**
 * 槽内内容（**不含外框 / 宽度 / 高度**）—— 三处卡片共用。
 *
 * @param showTime 是否在卡体内再渲染一次时刻行。联动卡 / 合并卡由卡头统一给时间区间，
 *   但其内部含**多个槽**，故仍需要每槽的时刻行（`showTime=true`）。
 */
function SlotBody({
  slot,
  topBoard,
  tags,
  reasonByCode,
  showTime = false,
}: {
  slot: TimelineSlot
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  showTime?: boolean
}) {
  /** 🚀 题材爆发 / ⚠️ 题材衰竭 —— 本页的**核心诉求**：每个时间节点哪些题材起、哪些题材落 */
  const marks = slotThemeMarks(slot.events, slot.pushes)
  const bursts = withKeys(marks.burst, (b) => b.theme)
  const switches = withKeys(marks.switched, (s) => `${s.theme}|${s.from}|${s.to}`)
  const fades = withKeys(marks.fade, (f) => f.label)
  const pushes = withKeys(marks.pushed, (p) => p.name)

  /** 板块按**强度降序**（强 → 弱）：最强的最先被看到 */
  const sortedSectors = sortSlotSectors(slot.sectors)
  const topSectors = sortedSectors.slice(0, SLOT_VISIBLE_SECTORS)
  const restSectors = sortedSectors.slice(SLOT_VISIBLE_SECTORS)

  return (
    <>
      {showTime && (
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="num text-[12px] font-semibold text-txt flex-none">
            {minToClock(slot.at)}
          </span>
          <span className="text-sub text-[10.5px]">当刻封板 {slot.sectors.reduce((n, g) => n + g.count, 0) + slot.singles.length} 只</span>
        </div>
      )}

      {/* ── 题材爆发 / 衰竭（置顶：这是时间轴要回答的第一件事）── */}
      {(marks.burst.length > 0 ||
        marks.switched.length > 0 ||
        marks.fade.length > 0 ||
        marks.pushed.length > 0) && (
        <div className="flex flex-col gap-0.5 rounded-sm bg-line-faint/60 px-1.5 py-1 min-w-0">
          {marks.burst.length > 0 && (
            <div className="flex items-baseline gap-1 flex-wrap min-w-0">
              <span className="text-[10.5px] font-semibold text-up flex-none">🚀 爆发</span>
              {bursts.map(({ key, item: b }) => (
                <span key={key} className="flex items-baseline gap-1 flex-none">
                  <span className="text-[11.5px] font-medium text-up break-all">{b.theme}</span>
                  {b.count != null && <span className="num text-[10px] text-sub">{b.count}只</span>}
                  {b.leader && <span className="text-[10px] text-lead">龙 {b.leader}</span>}
                </span>
              ))}
            </div>
          )}
          {marks.switched.length > 0 && (
            <div className="flex items-baseline gap-1 flex-wrap min-w-0">
              <span className="text-[10.5px] font-semibold text-rec flex-none">🔁 龙头易主</span>
              {switches.map(({ key, item: s }) => (
                <span key={key} className="flex items-baseline gap-1 flex-none">
                  <span className="text-[11.5px] text-txt break-all">{s.theme}</span>
                  <span className="text-[10px] text-sub">
                    {s.from ?? '—'} → {s.to ?? '—'}
                  </span>
                </span>
              ))}
            </div>
          )}
          {marks.fade.length > 0 && (
            <div className="flex items-baseline gap-1 flex-wrap min-w-0">
              <span className="text-[10.5px] font-semibold text-down flex-none">⚠️ 衰竭</span>
              {fades.map(({ key, item: f }) => (
                <span key={key} className="flex items-baseline gap-1 flex-none">
                  <span className="text-[11.5px] text-down break-all">{f.label}</span>
                  <span className="text-[10px] text-sub">集体重挫</span>
                </span>
              ))}
            </div>
          )}
          {marks.pushed.length > 0 && (
            <div className="flex items-baseline gap-1 flex-wrap min-w-0">
              <span className="text-[10.5px] font-semibold text-lead flex-none">📤 推送</span>
              {pushes.map(({ key, item: p }) => (
                <span key={key} className="text-[11px] text-txt break-all flex-none">
                  {p.name}
                  {p.pushCount != null && p.pushCount > 1 && (
                    <span className="num text-[10px] text-sub">×{p.pushCount}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 盘中逐事件（🔴 涨 / 🟢 跌）—— 2026-09-17 合进时间轴 ── */}
      <IntradayEventBlock up={slot.intradayUp} down={slot.intradayDown} />

      {/* 行业内个股分区：**强度降序**，卡面直接给出最强 N 个（同刻同行业合并为一组） */}
      {topSectors.map((g, i) => (
        <SectorSlotGroup
          key={`sec:${slot.at}:${g.sector}`}
          g={g}
          rank={i + 1}
          topBoard={topBoard}
          tags={tags}
          reasonByCode={reasonByCode}
        />
      ))}
      {restSectors.length > 0 && (
        <>
          <div className="flex items-baseline gap-1.5 gap-y-0 border-t border-line-faint pt-1 mt-0.5 text-[10.5px] text-sub min-w-0 flex-wrap">
            <span className="flex-none">↓ 其余 {restSectors.length} 个板块（较弱，下拉查看）</span>
            <span className="min-w-0 break-all">卡面直接展示最强的 {SLOT_VISIBLE_SECTORS} 个</span>
          </div>
          {restSectors.map((g, i) => (
            <SectorSlotGroup
              key={`sec:${slot.at}:${g.sector}`}
              g={g}
              rank={SLOT_VISIBLE_SECTORS + i + 1}
              topBoard={topBoard}
              tags={tags}
              reasonByCode={reasonByCode}
            />
          ))}
        </>
      )}

      {/* 单票分区（仅同分钟合并，不跨分钟） */}
      {slot.singles.length > 0 && (
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[10.5px] text-sub">单票 {slot.singles.length} 只（未入板块集群）</div>
          <div className="grid gap-x-2 gap-y-0.5 min-w-0">
            {(() => {
              const seen = new Map<string, number>()
              return slot.singles.map((s) => {
                // 内容签名（槽时刻+代码+首封）+ 同签名出现序号：同分钟同代码多条也不丢
                const sig = `sng:${slot.at}:${s.code}:${s.fbt ?? ''}`
                const n = seen.get(sig) ?? 0
                seen.set(sig, n + 1)
                return (
                  <StockRow
                    key={`${sig}#${n}`}
                    s={s}
                    topBoard={topBoard}
                    tags={tags}
                    reasonByCode={reasonByCode}
                  />
                )
              })
            })()}
          </div>
        </div>
      )}

      {/* 事件分区（同刻合并） */}
      {slot.events && <EventSlot events={slot.events} />}

      {/* 推送分区（同刻合并） */}
      {slot.pushes && <PushSlot pushes={slot.pushes} at={slot.at} to={slot.pushTo} />}
    </>
  )
}

/**
 * 时间轴分钟槽卡片（**普通独立**类）。
 *
 * @param slot      一个分钟槽（来自 `buildTimelineSlots`）
 * @param topBoard  全市场最高板，用于高亮最高板个股
 * @param tags      代码 → 题材标记（来自 `buildThemeBursts`）
 * @param reasonByCode 代码 → 逐票涨停原因（同花顺）
 * @param variant   `linkage` = 联动类，用稍深底色突出；默认普通卡
 */
export function TimelineSlotCard({
  slot,
  topBoard,
  tags,
  reasonByCode,
  variant = 'normal',
}: {
  slot: TimelineSlot
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  variant?: 'normal' | 'linkage'
}) {
  const stockCount = slot.sectors.reduce((n, g) => n + g.count, 0) + slot.singles.length
  return (
    <CardShell
      tone={variant}
      ariaLabel={`${minToClock(slot.at)} 当刻封板 ${stockCount} 只 · 板块 ${slot.sectors.length} 个`}
      head={<SlotHead slot={slot} sectorCount={slot.sectors.length} />}
    >
      <SlotBody slot={slot} topBoard={topBoard} tags={tags} reasonByCode={reasonByCode} />
    </CardShell>
  )
}

/**
 * **高强度联动聚合卡**（`linkage`）—— 多个板块短时联动，及时聚合成**一张**卡，
 * 底色稍深突出，**绝不因低频合并而延迟或吞并**。
 *
 * ⚠️ 联动判定口径见 `LINKAGE_MIN_SECTORS`（**待用户确认**），本组件只负责渲染。
 */
export function TimelineLinkageCard({
  block,
  topBoard,
  tags,
  reasonByCode,
}: {
  block: Extract<TimelineBlock, { kind: 'linkage' }>
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
}) {
  return (
    <CardShell
      tone="linkage"
      ariaLabel={`${minToClock(block.at)} 板块联动 ${block.sectors.length} 个`}
      head={
        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
          <span className="num text-[13px] font-semibold text-txt flex-none">
            {block.at === block.to ? minToClock(block.at) : `${minToClock(block.at)}~${minToClock(block.to)}`}
          </span>
          <span className="text-[11.5px] font-semibold text-up flex-none">🚀 板块联动</span>
          <span className="text-sub text-[10.5px] min-w-0 break-all">
            {block.sectors.length} 个板块 · {block.sectors.join(' / ')}
          </span>
        </div>
      }
    >
      {block.slots.map((s) => (
        <div key={s.key} className="border-t border-up/20 pt-1 min-w-0 flex flex-col gap-1.5">
          <SlotBody
            slot={s}
            topBoard={topBoard}
            tags={tags}
            reasonByCode={reasonByCode}
            showTime
          />
        </div>
      ))}
    </CardShell>
  )
}

/**
 * **低频合并卡**（`merged`）—— 连续若干分钟**只有弱消息**（无个股、无题材层信号）时合并成一张。
 *
 * ⚠️ 外框与普通卡**完全一致**（`border-line bg-card`）—— 「同一个时间轴」只能有一种卡形态，
 * 差异只在卡头标签与内容（用户 2026-09-17：不同日子看着像两套设计）。
 */
export function TimelineMergedCard({
  block,
  topBoard,
  tags,
  reasonByCode,
}: {
  block: Extract<TimelineBlock, { kind: 'merged' }>
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
}) {
  return (
    <CardShell
      tone="normal"
      ariaLabel={`${minToClock(block.at)} 起合并 ${block.slots.length} 个低强度时刻`}
      head={
        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
          <span className="num text-[13px] font-semibold text-txt flex-none">
            {block.at === block.to ? minToClock(block.at) : `${minToClock(block.at)}~${minToClock(block.to)}`}
          </span>
          <span className="text-[10.5px] px-1 rounded-sm bg-line-faint text-sub flex-none">
            📎 合并 {block.slots.length} 刻
          </span>
          <span className="text-[10.5px] font-medium text-txt flex-none">
            涉及板块 {block.sectors.length} 个
          </span>
          {block.sectors.length > 0 && (
            <span className="text-sub text-[10.5px] min-w-0 break-all">
              {block.sectors.join(' / ')}
            </span>
          )}
        </div>
      }
    >
      {block.slots.map((s) => (
        <div key={s.key} className="border-t border-line-faint pt-1 min-w-0 flex flex-col gap-1.5">
          <SlotBody
            slot={s}
            topBoard={topBoard}
            tags={tags}
            reasonByCode={reasonByCode}
            showTime
          />
        </div>
      ))}
    </CardShell>
  )
}
