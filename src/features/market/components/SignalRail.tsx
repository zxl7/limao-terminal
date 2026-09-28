import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct, isStarMarket } from '@/shared/lib'
import { pctTone } from '../model/labels'
import { marketQueries } from '../api/queries'
import type { ShortSpiritDeposit } from '@/shared/api'

/**
 * 信号 rail —— 盘中实时页最右侧的**固定窄列（占宽 10%）**。
 *
 * ## 与「反馈与信号」的关系（2026-09-21 → 09-22 调整）
 *
 * 用户要求：① 宽度固定 10%、不用展开；② 删除 rail 内的「晋级率/核按钮/炸板率/情绪分」
 * 精简条（与中区连板天梯、极值名单重复，不显示）；③ 短线精灵列表**按信号类型做视觉区分**。
 *
 * 故本组件现在只做一件事：**紧凑版短线精灵列表**（竖向、截断、按 `type` 着色）。
 * 中区两张融合卡展示反馈信号，rail 不再重复。
 *
 * ## 信号类型视觉区分（A 股语义：红=涨/多，绿=跌/空，紫=机会，橙=分歧，青=异动）
 *
 * 类型由后端 `short_spirit.py` 的 `signal_type` / `signal_type_down` 产出（2026-09-22 盲区补强后含下跌支）：
 * - `涨停` / `接近涨停`   → 红（强多，已达/逼近涨停）
 * - `炸板·回落`           → 橙（冲板后炸开回落，分歧）
 * - `快速拉升`           → 紫（拉升中的机会信号）
 * - `跌停`               → 绿（封死跌停，空方极致）
 * - `打开跌停`           → 青（曾触跌停炸开/撬板异动，常伴撬板转强）
 * - `快速下跌`           → 绿（急杀但未封跌停）
 * - 其他 / 缺省          → 灰（无类别）
 *
 * ## 短线精灵数据口径（与 SignalsCard 一致）
 *
 * 优先 `signals_today`（当日沉淀，带 first_seen/seen_count），缺失回退 `signals`；⛔ 剔除 688/689；
 * 历史条目无 pct → 一律 `—` 兜底，不退化成 0。
 */

/** 信号类型 → 语义色（与主题 token 一致的硬色，明暗主题都可读） */
function signalTypeStyle(type?: string): { text: string; dot: string } {
  if (!type) return { text: 'text-sub', dot: 'bg-line' }
  if (type === '涨停' || type === '接近涨停') return { text: 'text-[#ee2500]', dot: 'bg-[#ee2500]' } // 强多
  if (type === '炸板·回落') return { text: 'text-[#e8940a]', dot: 'bg-[#e8940a]' } // 冲板回落·分歧橙
  if (type === '快速拉升') return { text: 'text-[#8b5cf6]', dot: 'bg-[#8b5cf6]' } // 机会紫
  if (type === '跌停') return { text: 'text-[#0a8f3c]', dot: 'bg-[#0a8f3c]' } // 封死跌停·空方绿
  if (type === '打开跌停') return { text: 'text-[#0d9488]', dot: 'bg-[#0d9488]' } // 撬板异动·青
  if (type === '快速下跌') return { text: 'text-[#0a8f3c]', dot: 'bg-[#0a8f3c]' } // 急杀·绿
  return { text: 'text-sub', dot: 'bg-line' }
}

export function SignalRail({ className }: { className?: string }) {
  const { data: sig, isPending, isError } = useQuery(marketQueries.signals())

  // —— 短线精灵紧凑列表（与 SignalsCard 同口径）——
  const deposited = sig?.signals_today ?? []
  const rows: ShortSpiritDeposit[] = deposited.length > 0 ? deposited : (sig?.signals ?? [])
  const visible = rows.filter((s) => !isStarMarket(s.code))
  // 沉淀保留最后触发时的报价与类型，不能当作当前行情。
  const isHistory = deposited.length > 0
  const hasRows = isHistory || sig?.signals != null

  return (
    <section className={cn('signal-rail flex flex-col gap-2 min-w-0', className)}>
      {/* 栏头：色条 + 标题 + 延伸线 */}
      <div className="flex items-center gap-2 px-0.5 pt-0.5">
        <span className="w-[3px] h-3.5 rounded-[2px] bg-rec flex-none" aria-hidden />
        <span className="text-[11px] font-semibold tracking-[0.12em] text-sub uppercase whitespace-nowrap">
          信号
        </span>
        <span className="flex-1 h-px bg-line min-w-2" aria-hidden />
      </div>

      {/* 短线精灵紧凑列表（按 type 着色） */}
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="text-[10.5px] font-semibold text-sub">⚡ 短线精灵</span>
        {sig && <span className="text-[10.5px] text-sub">{visible.length} 条</span>}
      </div>

      <div className="px-0.5 text-[10px] text-sub leading-relaxed">
        <div>{isHistory ? '当日信号记录' : '本轮信号'} · {sig?.date ?? '日期未提供'}</div>
        {sig?.ts && <div className="num">数据时间 {sig.ts}</div>}
        {isHistory && <div>类型与涨幅为触发时记录，不代表当前状态。</div>}
      </div>
      {isError && <p role="status" className="m-0 text-[11px] text-warn">{sig ? '信号更新失败，保留上次数据' : '信号加载失败'}</p>}

      {visible.length > 0 ? (
        <div className="flex flex-col max-h-[60vh] overflow-auto">
          {visible.map((s) => {
            const st = signalTypeStyle(s.type)
            return (
              <div
                key={s.code ?? s.name}
                className="py-[4px] border-b border-line last:border-b-0 min-w-0"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-semibold truncate min-w-0" title={`${s.name ?? s.code} · ${s.code}`}>{s.name}</span>
                  {s.pct != null ? (
                    <span className={cn('num text-[12px] font-semibold ml-auto flex-none', pctTone(s.pct))}>
                      {fmtPct(s.pct)}
                    </span>
                  ) : (
                    <span className="num text-[12px] text-sub ml-auto flex-none">—</span>
                  )}
                </div>
                {isHistory && (
                  <div className="num flex flex-wrap gap-x-2 text-[10px] text-sub mt-0.5">
                    <span>首 {s.first_seen?.slice(0, 5) ?? '—'}</span>
                    <span>末 {s.last_seen?.slice(0, 5) ?? '—'}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-[2px]">
                  <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-none', st.dot)} aria-hidden />
                  <span className={cn('text-[10.5px] font-medium flex-none truncate', st.text)}>
                    {s.type || '信号'}
                  </span>
                  {s.seen_count != null && s.seen_count > 1 && (
                    <span className="text-[10px] text-sub flex-none ml-auto">{s.seen_count}轮</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-[12px] text-sub px-0.5 py-1">{isPending ? '正在加载短线信号…' : isError ? '暂无法确认信号状态' : !hasRows ? '信号列表未提供' : '暂无短线信号'}</p>
      )}
    </section>
  )
}
