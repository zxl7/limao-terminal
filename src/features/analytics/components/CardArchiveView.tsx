import type { ReactNode } from 'react'
import { cn } from '@/shared/lib'
import { Tag } from './Table'

/**
 * 飞书卡片存档阅读器 —— 卡片存档（复盘 / 盘前 / 机构 / 脉冲窗口）的共同渲染。
 *
 * ## 为什么要转义成「文本块」而不是还原成卡片
 *
 * 这些 JSON 是**飞书卡片的结构**（`elements[].tag` + `text.tag='lark_md'`）。
 * 完整还原卡片渲染需要一个飞书卡片渲染引擎（column_set / note / hr / 嵌套 div…），
 * 而本页的目的不是「复刻推送外观」，而是**读回当时的结论**。
 *
 * 因此这里做的是**降级提取**：把每个元素抽成一个纯文本块，保留层级与顺序，
 * 丢弃纯装饰（颜色、分隔线、按钮）。好处：
 *   · 逻辑极简，不会因飞书卡片 schema 演进失效
 *   · 文本可直接选中复制，便于对比不同日期的措辞差异
 *
 * ## ⚠️ 颜色语义不还原
 *
 * 卡片的 `color` 字段（red/blue/grey…）是原系统的**推送语义色**，
 * 与本项目的 A 股语义色板（涨红跌绿）**不是同一套体系**。
 * 直接套用会把「蓝色复盘卡」误渲染成「跌」，故此处只做标注、不做着色。
 */

interface FeishuText {
  tag?: string
  content?: string
}

interface FeishuElement {
  tag?: string
  text?: FeishuText | string
  /** note 类元素是纯文本数组 */
  elements?: FeishuText[]
  fields?: unknown[]
  [k: string]: unknown
}

export interface ArchiveCard {
  title?: string
  color?: string
  elements?: FeishuElement[]
  note?: string
  [k: string]: unknown
}

/** 从一个元素里抽出可读文本（div / markdown / note / plain_text 四种形态） */
function extractText(el: FeishuElement): string | null {
  const t = el.text
  if (typeof t === 'string') return t
  if (t && typeof t === 'object') {
    if (typeof t.content === 'string') return t.content
    if (Array.isArray((t as { elements?: FeishuText[] }).elements)) {
      const inner = (t as { elements?: FeishuText[] }).elements ?? []
      const joined = inner
        .map((x) => (typeof x?.content === 'string' ? x.content : ''))
        .filter(Boolean)
        .join(' ')
      return joined || null
    }
  }
  if (Array.isArray(el.elements)) {
    const joined = el.elements
      .map((x) => (typeof x?.content === 'string' ? x.content : ''))
      .filter(Boolean)
      .join(' ')
    return joined || null
  }
  return null
}

/**
 * 卡片存档视图 —— 标题 + 逐元素文本块。
 *
 * `compact` 用于「同日多卡并列」的场景（如图表卡 + 文本卡），会去掉外层留白。
 */
export function CardArchiveView({
  card,
  compact,
  className,
}: {
  card: ArchiveCard | null | undefined
  compact?: boolean
  className?: string
}): ReactNode {
  if (!card) return null
  const blocks = (card.elements ?? [])
    .map(extractText)
    .filter((x): x is string => !!x && x.trim().length > 0)

  return (
    <div className={cn(compact ? '' : 'border border-line rounded-sm px-2.5 py-2', className)}>
      {(card.title || card.color) && (
        <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', compact ? 'mb-1' : 'mb-2')}>
          {card.title && <span className="text-14 font-semibold text-txt">{card.title}</span>}
          {card.color && <Tag title="原系统推送语义色，与本项目 A 股色板无关">{card.color}</Tag>}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {blocks.map((b, i) => (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
            key={i}
            className="text-13 leading-relaxed whitespace-pre-wrap border-l-2 border-line-faint pl-2.5"
          >
            {b}
          </div>
        ))}
        {blocks.length === 0 && <span className="text-sub text-12">（卡片无文本元素）</span>}
      </div>

      {card.note && (
        <div className="mt-2 pt-1.5 border-t border-line-faint text-sub text-12 leading-relaxed">
          {card.note}
        </div>
      )}
    </div>
  )
}

/** 卡片内的日期（用于列表） */
export function cardDate(card: ArchiveCard | null | undefined, fallback: string): string {
  if (!card) return fallback
  const t = card.title
  if (typeof t === 'string') {
    const m = t.match(/(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}`
  }
  return fallback
}
