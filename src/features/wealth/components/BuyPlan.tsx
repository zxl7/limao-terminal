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
 * 「什么情况下可以买」——每只票都要有一句可执行的判断（2026-11-16 用户要求）。
 *
 * 全部由**已有字段**拼，不新增推断：
 *   · 预期区间 `expectation.expected_range`（%）
 *   · 竞价额下限 `expectation.auction_amount_min_yi`（亿）
 *   · 一字/买不到 → 明确写「看是否开板」
 *   · 预案方向 `forecast.verdict`（只用来决定措辞，不再单独成列）
 */
function buyCondition(s: DossierStock): string {
  const r = s.expectation?.expected_range
  const lo = Array.isArray(r) && r.length === 2 ? Number(r[0]) : null
  const hi = Array.isArray(r) && r.length === 2 ? Number(r[1]) : null
  const amt = s.expectation?.auction_amount_min_yi
  const v = s.forecast?.verdict
  const oneWord = (s as { is_one_word?: boolean }).is_one_word
  const boards = s.boards ?? 0

  const range = (lo != null && hi != null && Number.isFinite(lo) && Number.isFinite(hi))
    ? `竞价 ${num(lo, 1)}% ~ ${num(hi, 1)}%`
    : ''
  const cash = (typeof amt === 'number' && amt > 0) ? `且竞价额 ≥ ${num(amt, 1)} 亿` : ''

  if (oneWord) {
    return `一字买不到：只有开板才做（开板后 ${range || '回到预案区间'} ${cash} 才接）`
  }
  if (v === '放弃') {
    return `默认不买（预案判放弃）；除非 ${range || '竞价明显好于预期'} ${cash} 再复核`
  }
  if (range) {
    return `${range} ${cash}${v === '可等' ? ' → 可买' : ' → 可买（需盯开盘承接）'}`
  }
  if (v === '可等') return '竞价符合预期即可买（区间未给出，按开盘承接判断）'
  if (boards >= 3) return '高位票：只做竞价强势（红开/不大幅低开），弱开不接'
  return '竞价不弱于预期即可参与（区间未给出）'
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
          label: '什么情况下买',
          className: 'whitespace-normal min-w-[220px]',
          cell: ({ s: row }) => (
            <span className="text-11 leading-snug text-txt">{buyCondition(row)}</span>
          ),
        },
        {
          label: '竞价额要够',
          num: true,
          cell: ({ s }) => <span className="num text-txt">{yiText(s.expectation?.auction_amount_min_yi)}</span>,
        },
      ]}
      />
    </div>
  )
}
