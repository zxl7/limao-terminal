import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'
import { IntradayEventBlock } from './IntradayEventLine'
import { severityNote, splitEventTextKeyed, type EventSegKind } from '../lib/event-text'
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
import { groupSlotByTheme, slotThemeMarks, type ThemeBurst } from '../lib/theme-burst'

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
            title={`当前龙头：${t}`}
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
            title="全天形态"
          >
            {meta.icon} {meta.label}
          </span>
        )}
        {g.dayTotal != null && (
          <span
            className="text-[10px] text-sub"
            title="全天封板总数"
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

/**
 * 槽内「某**题材**当刻封板」的分组块 —— **详情模式专用**（2026-09-22 用户定）。
 *
 * 用户原话：「我需要看到的是题材、题材爆发以及与题材相关的大量个股，
 * 我不喜欢看到现在什么的爆发走强，杀跌这些数量。」
 *
 * 与 `SectorSlotGroup`（行业分组 · 卡面用）的分工：
 *   · 本组件以**题材**为主轴，并补出**该题材当日全部涨停成员**（「大量个股」的来源）；
 *   · 行业分组仍服务于 240px 卡面的紧凑呈现，⛔ 两者不互相取代。
 *
 * ⛔ 「当日其余涨停成员」必须**排除本槽已列出的票**，否则同一只票在同一条详情里出现两次。
 */
function ThemeSlotGroup({
  theme,
  stocks,
  burst,
  topBoard,
  tags,
  reasonByCode,
  themeInfo,
}: {
  theme: string
  stocks: ZtPoolStock[]
  /** 本槽这一刻该题材是否为「新主线崛起」→ 题材名用**大红** + 放大 + 🚀 */
  burst: boolean
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  themeInfo?: Map<string, ThemeBurst>
}) {
  const t = themeInfo?.get(theme)
  const inSlot = new Set(stocks.map((s) => s.code))
  const restMembers = (t?.members ?? []).filter((m) => !inSlot.has(m.code))
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
        {burst && <span className="text-[11px] flex-none">🚀</span>}
        <span
          className={cn(
            'font-semibold break-all min-w-0',
            // 爆发 = 大红 + 放大一号（用户 2026-10-18：「字体稍微大一点，突出这个题材牛逼」）
            // 首爆 = 紫（2026-10-20 用户：「首爆改为紫色」），与轴上标记同色
            burst ? 'text-[13.5px] font-bold text-rec' : 'text-[12.5px] text-txt',
          )}
        >
          {theme}
        </span>
        <span className="num text-[11px] text-sub flex-none">当刻 {stocks.length} 只</span>
        {t && t.members.length > 0 && (
          <span className="num text-[10.5px] text-sub flex-none" title="该题材当日涨停池成员总数">
            当日 {t.members.length} 只
          </span>
        )}
        {t?.currentLeader && (
          <span className="text-[10.5px] text-lead flex-none">龙 {t.currentLeader}</span>
        )}
      </div>

      {t?.catalyst && (
        <div className="text-[11px] text-txt break-all min-w-0">催化：{t.catalyst}</div>
      )}

      <div className="grid gap-x-2 gap-y-0.5 min-w-0">
        {(() => {
          const seen = new Map<string, number>()
          return stocks.map((s) => {
            // 内容签名（题材+代码+首封）+ 出现序号：同刻同股多条记录也不丢、不撞键
            const sig = `thm:${theme}:${s.code}:${s.fbt ?? ''}`
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

      {restMembers.length > 0 && (
        <div className="text-[10.5px] text-sub break-all min-w-0">
          当日其余涨停成员：
          <span className="text-txt">{restMembers.map((m) => m.name).join('、')}</span>
        </div>
      )}
    </div>
  )
}

/**
 * 事件原文分段的渲染配色。
 *
 * ⛔ **主角是内容，不是标签**（用户 2026-09-17：「降低『系统观测』的视觉权重……
 * 优先展示当前节点实际发生的事件，突出涉及的个股和题材」）：
 * 题材紫、个股与关键值加粗深色、转弱板块跌色，**连接词一律退灰**。
 */
const SEG_CLASS: Record<EventSegKind, string> = {
  theme: 'text-rec font-medium',
  stock: 'text-txt font-semibold',
  value: 'text-txt font-medium',
  down: 'text-down font-medium',
  plain: 'text-sub',
}

/** 一行系统观测（原文分段着色 + severity 例外标注） */
function EventRow({ e }: { e: NonNullable<TimelineSlot['events']>[number] }) {
  const sev = severityNote(e.severity)
  return (
    <li className="flex items-baseline gap-1.5 text-[12px] min-w-0">
      <span className="truncate min-w-0" title={e.event}>
        {/* 分段与 key 都由内核给（位移即身份）—— ⛔ 组件里不做跨段累加 */}
        {splitEventTextKeyed(e.event).map((seg) => (
          <span key={seg.key} className={SEG_CLASS[seg.kind]}>
            {seg.text}
          </span>
        ))}
      </span>
      {sev && <span className="text-[10px] text-sub flex-none">[{sev}]</span>}
    </li>
  )
}

/**
 * 槽内事件分区（原始事件流）。
 *
 * · **来源标注退到灰**：原先是饱和青绿 `text-warn` + 加粗 + ⚡，又出现在**每一张**有事件的卡上
 *   → 整屏读起来「全部处于系统观测状态」，而真正发生了什么反而看不见。现降为 10px 灰字。
 * · **正文高亮**：`splitEventText` 把原文切成 题材 / 个股 / 关键值 三段各自着色（⛔ 无损）。
 * · **severity 只标例外**：实测 ~95% 是 `high`，逐行展示等于噪声 → 仅非最高档时以灰字附注。
 * · **默认折叠机器噪声**（2026-09-17 用户拍板「可以」）：实测 5 天 109 条里 **86% 是噪声**
 *   （龙头切换 51.4% / 情绪回摆 31.2% / 广度归零 3.7%）→ 默认只留真信号，
 *   其余收进「另有 N 条系统观测」（原生 `<details>`，⛔ **折叠 ≠ 删除**）。
 *   ⛔ 悬停明细（`unfold`）**一律全量展开** —— 那才是「完整明细」的落点。
 */
function EventSlot({ slot, unfold = false }: { slot: TimelineSlot; unfold?: boolean }) {
  const events = slot.events ?? []
  const folded = unfold ? new Set<number>() : new Set(slot.foldedIdx ?? [])
  const shown: typeof events = []
  const hidden: typeof events = []
  events.forEach((e, i) => (folded.has(i) ? hidden : shown).push(e))

  return (
    <div className="flex flex-col gap-0.5 border-t border-line-faint pt-1 mt-0.5 min-w-0">
      {shown.length > 0 && (
        <>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[10px] text-sub">
              {shown.length > 1 ? `系统观测 ${shown.length} 条` : '系统观测'}
            </span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {shown.map((e, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：事件流与时刻严格对齐，同一时刻可能重复同一句话，用内容做 key 反而会撞。
              <EventRow key={i} e={e} />
            ))}
          </ul>
        </>
      )}
      {hidden.length > 0 && (
        <details className="min-w-0">
          <summary className="text-[10px] text-sub cursor-pointer select-none">
            另有 {hidden.length} 条系统观测
          </summary>
          <ul className="flex flex-col gap-0.5 pt-0.5">
            {hidden.map((e, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- 同上：位置序列即身份
              <EventRow key={i} e={e} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** 槽内推送分区（题材台账）—— 标题同样退为灰色小字（分区标题不抢内容的风头） */
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
        <span className="text-[10px] text-sub flex-none">📤</span>
        <span className="text-[10px] text-sub">题材推送 {pushes.length} 条</span>
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
        <span className="text-sub text-[10.5px]">板块 {sectorCount} 个</span>
      )}
    </div>
  )
}

/**
 * 槽内内容（**不含外框 / 宽度 / 高度**）—— 三处卡片 + 蛇形轴详情面板共用。
 *
 * @param showTime 是否在卡体内再渲染一次时刻行。普通卡由卡头给时刻（false）；
 *   联动卡 / 合并卡 / **详情面板**内部含**多个槽**，故需要每槽的时刻行（true）。
 * @param showAllSectors 是否**取消「最强 N 个板块」上限**。⛔ 详情面板必须传 `true`
 *   —— 它是「更详细的内容」的落点，卡面的 3 个上限是为了紧凑，不该在详情里也截。
 * @param showAllEvents 是否**取消系统观测的「噪声折叠」**（`slot.foldedIdx`）。
 *   ⛔ 详情面板必须传 `true`：那里是「完整明细」，⛔ 一条都不能藏。
 */
export function SlotBody({
  slot,
  topBoard,
  tags,
  reasonByCode,
  themeInfo,
  showTime = false,
  showAllSectors = false,
  showAllEvents = false,
  themeGrouped = false,
}: {
  slot: TimelineSlot
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  /**
   * 题材名 → 该题材的当日全貌（催化原文 / 涨停成员 / 观测时刻序列）。
   *
   * ⛔ **只由 hover 详情面板传入** —— 卡面保持紧凑（题材名 + 家数 + 龙头），
   *    详情里才补上「催化 / 成员 / 观测时刻」。故该 prop 是否存在本身就是
   *    「这是详情模式」的开关，不与 `showAllSectors`（板块上限）混用。
   */
  themeInfo?: Map<string, ThemeBurst>
  showTime?: boolean
  showAllSectors?: boolean
  showAllEvents?: boolean
  /**
   * **详情模式**：个股按**题材**分组（而非行业），并补出该题材当日全部涨停成员；
   * 同时展示盘中涨跌与板块波动明细。
   *
   * ⚠️ 与 `themeInfo` 的区别：`themeInfo` 只是「有没有题材全貌数据」，本 prop 是
   *    「展示主轴换成题材」。二者在本项目里**同时为真**（`BlockDetail` 一起传），
   *    但语义独立 —— ⛔ 不要用 `themeInfo` 的存在性代替本 prop。
   */
  themeGrouped?: boolean
}) {
  /** 🚀 题材爆发 / ⚠️ 题材衰竭 —— 本页的**核心诉求**：每个时间节点哪些题材起、哪些题材落 */
  const marks = slotThemeMarks(slot.events, slot.pushes)

  /**
   * 详情模式的题材分组（2026-09-22 用户「我要题材 + 题材相关的大量个股」）。
   * `null` = 卡面路径，走原「行业分组」渲染。
   */
  const themeGroups = themeGrouped
    ? groupSlotByTheme(slot, tags, new Set(marks.burst.map((b) => b.theme)))
    : null
  const bursts = withKeys(marks.burst, (b) => b.theme)
  const rotateds = withKeys(marks.rotated, (r) => r.theme)
  const fades = withKeys(marks.fade, (f) => f.label)
  const pushes = withKeys(marks.pushed, (p) => p.name)

  /** 板块按**强度降序**（强 → 弱）：最强的最先被看到 */
  const sortedSectors = sortSlotSectors(slot.sectors)
  const topSectors = showAllSectors ? sortedSectors : sortedSectors.slice(0, SLOT_VISIBLE_SECTORS)
  const restSectors = showAllSectors ? [] : sortedSectors.slice(SLOT_VISIBLE_SECTORS)

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

      {/* ── 题材爆发 / 轮动 / 衰竭（置顶：这是时间轴要回答的第一件事）── */}
      {(marks.burst.length > 0 ||
        marks.rotated.length > 0 ||
        marks.fade.length > 0 ||
        marks.pushed.length > 0) && (
        <div className="flex flex-col gap-0.5 rounded-sm bg-line-faint/60 px-1.5 py-1 min-w-0">
          {marks.burst.length > 0 && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-baseline gap-1 flex-wrap min-w-0">
                {/* 题材爆发 = **大红**（2026-10-18 用户定调：与「题材轮动紫」分家）——
                    原为紫色，与「轮动/回流」同色，看不出「新爆发」还是「又轮动一下」。
                    轴上竖条已同步为红：首爆实心大红、后续续强半档红。 */}
                <span className="text-[11.5px] font-bold text-rec flex-none">🚀 首爆</span>
                {bursts.map(({ key, item: b }) => (
                  <span key={key} className="flex items-baseline gap-1 flex-none">
                    <span className="text-[12px] font-semibold text-rec break-all">{b.theme}</span>
                    {b.count != null && <span className="num text-[10px] text-sub">{b.count}只</span>}
                    {b.leader && <span className="text-[10px] text-lead">龙 {b.leader}</span>}
                  </span>
                ))}
              </div>
              {/* 详情模式（仅 hover 面板传 `themeInfo`）：补上该题材的催化原文 / 当日涨停成员 / 观测时刻序列 */}
              {themeInfo &&
                bursts.map(({ key, item: b }) => {
                  const t = themeInfo.get(b.theme)
                  if (!t) return null
                  if (t.catalyst == null && t.members.length === 0 && t.points.length <= 1) return null
                  return (
                    <div key={`${key}#detail`} className="flex flex-col gap-0.5 pl-3 min-w-0">
                      {t.catalyst && <span className="text-[11px] text-txt break-all">催化：{t.catalyst}</span>}
                      {t.members.length > 0 && (
                        <span className="text-[11px] text-sub break-all">
                          当日涨停成员：{t.members.map((m) => m.name).join('、')}
                        </span>
                      )}
                      {t.points.length > 1 && (
                        <span className="num text-[10.5px] text-sub break-all">
                          观测 {t.points.map((p) => minToClock(p.at)).join(' → ')}
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
          {marks.rotated.length > 0 && (
            /* 弱标记：题材当刻**被系统观测到**（仅龙头轮动）—— ⛔ 不是爆发，故描边淡紫、⛔ 不带 🚀。
               ⚠️ 与 2026-09-17 撤除的「↻ 反复」不同：那类把机械换人当**题材层信号**渲染，
                  本类只回答「这个题材今天在动」，且不参与强度判定（仍可被低频合并）。 */
            <div className="flex items-baseline gap-1 flex-wrap min-w-0">
              <span className="text-[10px] text-sub flex-none">轮动</span>
              {rotateds.map(({ key, item: r }) => (
                <span
                  key={key}
                  className="text-[11px] text-rec/80 border border-rec/30 rounded-sm px-1"
                >
                  {r.theme}
                  {themeInfo && r.leader && (
                    <span className="text-[10px] text-sub ml-1">龙 {r.leader}</span>
                  )}
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

      {/* 涨跌事实在普通卡与完整详情均展示，不能因缺少个股而隐藏整段盘中记录。 */}
      <IntradayEventBlock up={slot.intradayUp} down={slot.intradayDown} showAll={showAllSectors} />

      {themeGroups ? (
        /* ── 详情模式：**题材主轴** —— 题材 → 该题材当刻个股 → 该题材当日全部涨停成员 ── */
        <>
          {themeGroups.groups.map((g) => (
            <ThemeSlotGroup
              key={`thm:${slot.at}:${g.theme}`}
              theme={g.theme}
              stocks={g.stocks}
              burst={g.burst}
              topBoard={topBoard}
              tags={tags}
              reasonByCode={reasonByCode}
              themeInfo={themeInfo}
            />
          ))}
          {themeGroups.unthemed.length > 0 && (
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="text-[10.5px] text-sub">
                无题材标记 {themeGroups.unthemed.length} 只
              </div>
              <div className="grid gap-x-2 gap-y-0.5 min-w-0">
                {withKeys(
                  themeGroups.unthemed,
                  (s) => `unthm:${slot.at}:${s.code}:${s.fbt ?? ''}`,
                ).map(({ key, item }) => (
                  <StockRow
                    key={key}
                    s={item}
                    topBoard={topBoard}
                    tags={tags}
                    reasonByCode={reasonByCode}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
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
          <div className="text-[10.5px] text-sub">
            ↓ 其余 {restSectors.length} 个板块
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
          <div className="text-[10.5px] text-sub">单票 {slot.singles.length} 只</div>
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

        </>
      )}

      {/* 事件分区（同刻合并 · 默认只留真信号，机器噪声收进「另有 N 条」） */}
      {slot.events && <EventSlot slot={slot} unfold={showAllEvents} />}

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
  themeInfo,
  variant = 'normal',
}: {
  slot: TimelineSlot
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  /** 详情模式：题材名 → 当日全貌（催化原文 / 涨停成员 / 观测时刻）。左栏常驻详情传入。 */
  themeInfo?: Map<string, ThemeBurst>
  variant?: 'normal' | 'linkage'
}) {
  const stockCount = slot.sectors.reduce((n, g) => n + g.count, 0) + slot.singles.length
  return (
    <CardShell
      tone={variant}
      ariaLabel={`${minToClock(slot.at)} 当刻封板 ${stockCount} 只 · 板块 ${slot.sectors.length} 个`}
      head={<SlotHead slot={slot} sectorCount={slot.sectors.length} />}
    >
      <SlotBody
        slot={slot}
        topBoard={topBoard}
        tags={tags}
        reasonByCode={reasonByCode}
        themeInfo={themeInfo}
      />
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
  themeInfo,
}: {
  block: Extract<TimelineBlock, { kind: 'linkage' }>
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  themeInfo?: Map<string, ThemeBurst>
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
            themeInfo={themeInfo}
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
  themeInfo,
}: {
  block: Extract<TimelineBlock, { kind: 'merged' }>
  topBoard: number
  tags: Map<string, StockThemeTag>
  reasonByCode: Map<string, string>
  themeInfo?: Map<string, ThemeBurst>
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
            themeInfo={themeInfo}
            showTime
          />
        </div>
      ))}
    </CardShell>
  )
}
