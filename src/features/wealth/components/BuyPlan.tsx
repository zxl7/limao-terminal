import type { DossierStock } from '@/shared/api'
import { cn } from '@/shared/lib'
import { StockLink } from '@/shared/ui'
import { DataTable } from '@/features/analytics'
import { boardsText, num, yiText } from '../lib/format'

/**
 * 明日买点矩阵 —— 把「明天怎么下单」压成一张表。
 *
 * ## 2026-11-06 用户「不要那些看不懂的指标」，从 10 列砍到 6 列
 *
 * 砍掉的四列及其理由（都是**统计推导量**，不是下单要用的事实）：
 *
 * | 砍掉 | 原来长什么样 | 为什么砍 |
 * |---|---|---|
 * | 超预期线 | `≥3.2% · 0.51 亿` | 与「计划区间」是同一件事的两端，看区间就够 |
 * | 明早中位 | `9.8%` | 与「买不到概率」重复表达同一件事 |
 * | 买不到 | `66%`（`p_over5`） | 名字像结论、实际是历史分组占比，且样本常 5~7 个 |
 * | 该档真买到 | `28.6% n=7` | 与上一列互为条件概率，两列并排必被误读成「胜率 28.6%」 |
 *
 * 留下的六列全部是**下单当下要用的**：买谁、几板、什么方向、竞价落在哪个区间、
 * 需要多少钱、明天到底做不做（含一句理由）。
 * ⛔ 区间用二元数组 `expected_range`（`[下沿, 上沿]`），⛔ 不可直接插值。
 */
/**
 * 明日结论的**一句话**（2026-11-11 用户第二次反馈「还是全是重复文案」）。
 *
 * 旧冻结件（11-10 及以前）的 `forecast.reasons[0]` 是**整段档位统计**——同档所有票一字不差。
 * 冻结件不改写，所以在展示层做规范化：能拿到 `stat_note`（新件）就直接用后端短句；
 * 拿不到就从**这只票自己的字段**拼一句，统计交给上方的「本档统计」行（只显示一次）。
 */
function shortReason(s: DossierStock): string {
  const fc = s.forecast
  const raw = String(fc?.reasons?.[0] ?? '').trim()
  if (fc?.stat_note) return raw                       // 新冻结件：后端已给短句
  if (!raw) return ''
  const b = s.boards
  const dr = s.dragon_rank
  const role = s.leader_role ?? ''
  const rank = typeof dr === 'number' && dr > 0 ? `本方向第${dr}` : ''
  const tag = [b ? `${b}板` : '', rank, role].filter(Boolean).join('·')
  // ⛔ 必须用 startsWith：「比本题材最高板低 ≥2 板…」也含这个子串，
  //    用 includes 会把**后排**的票误写成「它就是最高板」（11-11 日出东方踩到）。
  // 旧数据写作「它自己就是本题材最高板」，新数据写作「它就是本题材最高板」
  if (/^它(自己)?就是本题材最高板/.test(raw)) {
    return `它就是本题材最高板${tag ? `（${tag}）` : ''}`
  }
  if (raw.includes('比本题材最高板低')) {
    return `比本题材最高板低 ≥2 板＝后排${tag ? `（${tag}）` : ''}`
  }
  if (raw.includes('只差 1 板')) {
    return `只差 1 板＝最快的一档${tag ? `（${tag}）` : ''}`
  }
  if (raw.includes('历史崖位')) return `${b} 板是历史崖位`
  return raw
}

export function BuyPlan({
  relay,
  watch,
}: {
  relay: DossierStock[]
  watch: DossierStock[]
}) {
  const rows = [
    ...relay.map((s) => ({ s, bucket: '接力' as const, rank: s.relay_rank })),
    ...watch.map((s) => ({ s, bucket: '观察' as const, rank: s.watch_rank })),
  ].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (b.s.boards ?? 0) - (a.s.boards ?? 0))

  // 🧾 档位统计只显示一次（2026-11-11 用户「重复率没有意义」）
  //    新冻结件：直接用 `forecast.stat_note`；
  //    旧冻结件：从整段理由里**截出统计从句**（「这档 35 日实测…」）去重后显示，
  //    ⛔ 不改冻结数据，也不在这里重算任何统计数字。
  const statNotes = Array.from(new Set([
    ...rows.map((r) => r.s.forecast?.stat_note).filter((x): x is string => Boolean(x)),
    ...rows
      .filter((r) => !r.s.forecast?.stat_note)
      .map((r) => String(r.s.forecast?.reasons?.[0] ?? ''))
      .map((t) => {
        const i = t.indexOf('这档')
        // 旧冻结件曾把空样本渲染成「None%」→ 展示层清洗成「样本不足」，⛔ 不改数据文件
        return i >= 0 ? t.slice(i).trim().replace(/None%/g, '样本不足') : ''
      })
      .filter(Boolean),
  ]))

  return (
    <div className="flex flex-col gap-1.5">
      {statNotes.length > 0 && (
        <div className="text-11 leading-relaxed text-sub">
          本档统计：{statNotes.join('｜')}
        </div>
      )}
      <DataTable
      rows={rows}
      rowKey={(r) => `${r.bucket}-${r.s.code}`}
      empty="本期无候选 —— 接力池留空是允许的结论，不是数据缺失"
      columns={[
        {
          label: '标的',
          cell: ({ s }) => (
            <span className="flex items-baseline gap-1">
              <StockLink code={s.code} className="text-txt">
                {s.name}
              </StockLink>
              <span className="num text-11 text-sub">{s.code}</span>
            </span>
          ),
        },
        {
          label: '池别',
          cell: ({ bucket }) => (
            <span className={bucket === '接力' ? 'text-up' : 'text-sub'}>{bucket}</span>
          ),
        },
        {
          label: '板数',
          num: true,
          cell: ({ s }) => <span className="num font-semibold text-up">{boardsText(s.boards)}</span>,
        },
        {
          label: '身位',
          cell: ({ s }) => {
            // 🐉 2026-11-11 用户「龙1/龙2 全没了」：身位单独成列，
            // ⛔ 不再塞进理由里（理由列只放这只票特有的事实）。
            const role = s.leader_role ?? ''
            const dr = s.dragon_rank
            const rank = typeof dr === 'number' && dr > 0 ? `第${dr}` : ''
            if (!role && !rank) return <span className="text-sub">—</span>
            return (
              <span className={cn('text-12', role === '龙头' ? 'text-up' : 'text-txt')}>
                {role}
                {role && rank ? '·' : ''}
                {rank}
              </span>
            )
          },
        },
        {
          label: '方向',
          cell: ({ s }) => <span className="text-12">{s.core_theme || s.theme || '—'}</span>,
        },
        {
          label: '竞价落在',
          num: true,
          cell: ({ s }) => {
            const r = s.expectation?.expected_range
            return (
              <span className="num text-txt">
                {Array.isArray(r) && r.length === 2 ? `${num(r[0], 1)}% ~ ${num(r[1], 1)}%` : '—'}
              </span>
            )
          },
        },
        {
          label: '竞价额要够',
          num: true,
          cell: ({ s }) => <span className="num text-txt">{yiText(s.expectation?.auction_amount_min_yi)}</span>,
        },
        {
          label: '明日结论',
          className: 'whitespace-normal min-w-[260px]',
          cell: ({ s }) => {
            const v = s.forecast?.verdict
            const why = shortReason(s)
            if (!v) return <span className="text-sub">—</span>
            return (
              <span className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    'w-fit rounded-sm border px-1 text-11',
                    v === '可等'
                      ? 'border-up text-up'
                      : v === '放弃'
                        ? 'border-down text-down'
                        : 'border-line text-sub',
                  )}
                >
                  {v}
                </span>
                {why && <span className="text-11 leading-snug text-sub">{why}</span>}
              </span>
            )
          },
        },
      ]}
      />
    </div>
  )
}
