import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/shared/api'
import { DataTable, StatPair, Tag, n1 } from '@/features/analytics'
import { marketQueries } from '@/features/market'
import { BarChart, Card, CardBadge, EmptyState, Icon, Zone, ZoneRow } from '@/shared/ui'
import { cn } from '@/shared/lib'

/** 环比 = 当日涨停数 − 昨日涨停数（⚠️ 不能用 `delta`，它是状态枚举） */
/**
 * 环比 = 今日涨停数 − 昨日涨停数。
 *
 * ⚠️ `prev` 必须接受 `null`：`zt_prev` 在**新晋题材**上实测为 null（昨日还没有
 * 这个题材，自然没有昨日涨停数）。null 与 0 语义不同 —— 0 是「昨日有题材但零家
 * 涨停」，null 是「昨日无此题材」。后者不能算作「昨日 0 家」再推出「+N」的结论。
 */
function deltaText(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || prev == null) return '—'
  const d = cur - prev
  if (d === 0) return '持平'
  return d > 0 ? `+${d}` : String(d)
}

function deltaTone(
  cur: number | null | undefined,
  prev: number | null | undefined,
): 'up' | 'down' | 'sub' {
  if (cur == null || prev == null) return 'sub'
  const d = cur - prev
  return d > 0 ? 'up' : d < 0 ? 'down' : 'sub'
}

/** `delta` 是题材状态枚举：'new' 新晋 / 'ongoing' 持续 */
function stateLabel(delta: string | undefined): string | null {
  if (delta === 'new') return '新晋'
  if (delta === 'ongoing') return '持续'
  return delta ? delta : null
}

/**
 * 主线题材 —— 数据源 `cache/pulse_snapshots/latest.json` 的 `top5` 字段（原系统 `render_theme_compare`）。
 *
 * ## 判读主线要看的三组数
 *
 * 1. **规模**：`zt_count`（本题材涨停家数）+ `total_stocks`（题材内总家数）。
 *    只有涨停多而总家数极小 = 题材本身很小众，扩散空间有限。
 * 2. **资金强度**：`turn_avg`（平均换手）+ 龙头 `turn`。换手是「有多少筹码换手
 *    到新资金手里」的代理指标，比涨幅更能说明接力意愿。
 * 3. **变化方向**：环比 = `zt_count - zt_prev`。
 *
 * ## ⚠️ 实测：`delta` 不是数字，是状态枚举
 *
 * 落盘数据里 `delta` 取值只有 `'new'`（新晋）与 `'ongoing'`（持续），
 * **不是**涨停数环比。早期把它当 number 会导致 `delta > 0` 恒为 false ——
 * 每个题材都会被渲染成「持平」，且不报任何错。故本页：
 *   · 环比一律用 `zt_count - zt_prev` 计算
 *   · `delta` 只作为「新晋 / 持续」标签展示
 *
 * ## `positives` / `risks` / `diffusion` 是原系统的定性结论
 *
 * 它们由原系统脚本生成，不是本页推断。本页只负责呈现，并**不做改写** ——
 * 改写会掩盖原系统当时的判断依据。
 */

export async function loader() {
  await queryClient.ensureQueryData(marketQueries.latest())
  return null
}

export function Component() {
  const snap = useQuery(marketQueries.latest())
  const top5 = snap.data?.top5 ?? []
  const [openRank, setOpenRank] = useState<number | null>(top5[0]?.rank ?? null)

  const expanded = top5.find((t) => t.rank === openRank) ?? top5[0]

  /** 题材内涨停数的相对量纲（用于列表行内的细条；仅本批相对比较） */
  const ztMax = Math.max(1, ...top5.map((t) => t.zt_count))

  /**
   * 题材涨停家数柱状 —— 长度 = 绝对家数，颜色 = 环比方向。
   *
   * ## 为什么颜色不跟长度走
   *
   * 家数恒为非负，若按符号着色则所有柱都是红色，**「扩了还是缩了」这一最关键
   * 的信息就丢了**。故此处用双通道编码：
   *   · 长度 → 今日绝对家数（过零基线，长度即数量）
   *   · 颜色 → 环比方向（<b>增多=红 / 减少=绿</b>，符合本项目「改善红 / 恶化绿」板）
   *   · 空心柱 → 昨日家数
   * 三者正交，一根柱子里同时读完「多大」「比昨天多还是少」。
   *
   * ⚠️ `zt_prev` 为 null = **昨日无此题材**（新晋），不是「昨日 0 家」。
   *    空心柱缺失（画成虚线短横），且颜色取中性 —— 无基准就无从谈增减。
   */
  const ztBars = top5.map((t) => {
    const d = t.zt_prev == null ? null : t.zt_count - t.zt_prev
    return {
      label: t.name,
      value: t.zt_count,
      compare: t.zt_prev,
      compareLabel: '昨日涨停',
      tone: d == null ? ('sub' as const) : d > 0 ? ('up' as const) : d < 0 ? ('down' as const) : ('mid' as const),
    }
  })

  return (
    <div className="flex flex-col gap-3">
      {/* 主工作区 = 主线题材（可展开的题材列表，内容最重）；辅助区 = 涨停家数对比 + 展开详情。
          ⛔ 旧版三块纵向平铺，4K 下主线列表右侧大片空白。 */}
      <ZoneRow>
        <Zone label="主线题材" dot="bg-lead" className="xl:w-[62%]">
          <Card
            title="🎯 主线题材"
        extra={<CardBadge>{snap.data?.data_scope?.asof ?? snap.data?.ts?.slice(11, 19) ?? '—'}</CardBadge>}
      >
        {top5.length === 0 ? (
          <EmptyState
            text="无主线题材数据"
            hint={snap.isLoading ? '加载中…' : 'latest.json 的 top5 为空（盘前早段常见）'}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-2">
              <StatPair label="快照时间" value={snap.data?.ts?.slice(11, 19) ?? '—'} />
              <StatPair label="全市场涨停" value={snap.data?.total_zt ?? '—'} tone="up" />
              <StatPair label="情绪" value={snap.data?.sentiment ?? '—'} />
              <StatPair label="封板率" value={snap.data?.sentiment_detail?.seal_rate != null ? `${n1(snap.data.sentiment_detail.seal_rate)}%` : '—'} />
              <StatPair label="广度" value={snap.data?.data_scope?.breadth ?? '—'} />
              <StatPair label="成交额" value={snap.data?.data_scope?.amount ?? '—'} />
            </div>

            <div className="flex flex-col gap-1.5">
              {top5.map((t) => (
                <button
                  key={t.rank}
                  type="button"
                  onClick={() => setOpenRank(t.rank)}
                  className={cn(
                    'text-left border rounded-sm px-2.5 py-1.5 cursor-pointer bg-transparent transition-colors',
                    t.rank === expanded?.rank ? 'border-line-strong bg-card' : 'border-line hover:border-line-strong',
                  )}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className={cn(
                        'num text-[13px] font-semibold w-[18px]',
                        t.rank === 1 ? 'text-lead' : 'text-sub',
                      )}
                    >
                      {t.rank}
                    </span>
                    <span className="text-[13.5px] font-semibold text-txt">{t.name}</span>
                    <StatPair label="涨停" value={t.zt_count} tone="up" />
                    <StatPair
                      label="环比"
                      value={deltaText(t.zt_count, t.zt_prev)}
                      tone={deltaTone(t.zt_count, t.zt_prev)}
                    />
                    <StatPair label="昨日" value={t.zt_prev} />
                    <StatPair label="均换手" value={n1(t.turn_avg)} />
                    <StatPair label="题材家数" value={t.total_stocks} />
                    <span className="text-[12px] text-sub flex items-center gap-1">
                      <Icon name="trophy" size={12} className="text-lead" />
                      龙头 {t.leader?.name ?? '—'}
                    </span>
                    {t.leader?.boards && <Tag tone="up">{t.leader.boards}</Tag>}
                    {stateLabel(t.delta) && <Tag tone={t.delta === 'new' ? 'rec' : 'neutral'}>{stateLabel(t.delta)}</Tag>}
                  </div>
                  {/* 行内细条：仅表达「本批题材间」涨停家数的相对规模，便于纵向扫读排名。
                      不与大盘或历史比较 —— 那是上方柱状图的职责。 */}
                  <span
                    className="block mt-1 h-[3px] w-full rounded-sm overflow-hidden"
                    style={{ background: 'var(--color-line-faint)' }}
                  >
                    <span
                      className="block h-full rounded-sm"
                      style={{
                        width: `${(t.zt_count / ztMax) * 100}%`,
                        background: 'var(--color-up)',
                      }}
                    />
                  </span>
                  {t.desc && <div className="text-[12px] text-sub mt-0.5 leading-relaxed">{t.desc}</div>}
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

        </Zone>

        <Zone label="环比与详情" dot="bg-up" className="xl:w-[38%]">
          {/* ── 环比视角：列表看「多少」，这张看「扩还是缩」 ── */}
          <Card
            title="📊 题材涨停家数 · 今日 vs 昨日"
        extra={<CardBadge tone="warn">长度=今日家数 · 颜色=环比方向 · 空心=昨日</CardBadge>}
      >
        {ztBars.length ? (
          <>
            <BarChart
              bars={ztBars}
              height={200}
              format={(v) => `${n1(v)} 家`}
              maxBarWidth={44}
              showValue
            />
            <p className="text-sub text-[11.5px] mt-2 leading-relaxed">
              <b className="text-up">红 = 环比增多</b> / <b className="text-down">绿 = 环比减少</b> /
              <b className="text-txt"> 蓝 = 家数持平</b>（符合本项目「改善红 / 恶化绿」的语义色板）。
              柱长则恒为<b className="text-txt">今日绝对家数</b> —— 颜色与长度正交，
              同一根柱子里同时读出「多大」与「比昨天多还是少」。
              <br />
              <b className="text-txt">灰色虚线短横 = 昨日无此题材</b>（`zt_prev` 为 null，属新晋），
              <b>不是「昨日 0 家」</b> —— 无基准就无从谈增减，所以这类题材颜色取中性。
              题材内总家数（`total_stocks`）未画进柱子：它与涨停家数不同量纲，
              共轴会把涨停差异压平；该值请看上方列表。
            </p>
          </>
        ) : (
          <EmptyState text="无题材数据" hint="latest.json 的 top5 为空" />
        )}
      </Card>

      {expanded && (
        <Card
          title={`${expanded.name} · 题材详情`}
          extra={
            <div className="flex items-center gap-2">
              {deltaTone(expanded.zt_count, expanded.zt_prev) === 'up' && (
                <CardBadge tone="up">环比 {deltaText(expanded.zt_count, expanded.zt_prev)}</CardBadge>
              )}
              {deltaTone(expanded.zt_count, expanded.zt_prev) === 'down' && (
                <CardBadge tone="down">环比 {deltaText(expanded.zt_count, expanded.zt_prev)}</CardBadge>
              )}
              {deltaTone(expanded.zt_count, expanded.zt_prev) === 'sub' && (
                <CardBadge>环比持平（{expanded.zt_prev} 家）</CardBadge>
              )}
            </div>
          }
        >
          {/* ── 龙头详况 ── */}
          <div className="border border-line rounded-sm px-2.5 py-2 mb-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
              <span className="text-lead text-[12.5px] font-semibold">龙头</span>
              <span className="text-[14px] font-semibold text-rec">{expanded.leader?.name ?? '—'}</span>
              <span className="num text-sub text-[11.5px]">{expanded.leader?.code ?? ''}</span>
              {expanded.leader?.boards && <Tag tone="up">{expanded.leader.boards}</Tag>}
              <StatPair
                label="涨幅"
                value={expanded.leader?.pct != null ? `${n1(expanded.leader.pct)}%` : '—'}
                tone={(expanded.leader?.pct ?? 0) > 0 ? 'up' : 'down'}
              />
              <StatPair label="价" value={expanded.leader?.price ?? '—'} />
              <StatPair label="换手" value={expanded.leader?.turn != null ? `${n1(expanded.leader.turn)}%` : '—'} />
              <StatPair label="市值" value={expanded.leader?.cap_yi != null ? `${n1(expanded.leader.cap_yi)}亿` : '—'} />
              {expanded.leader?.seal && <span className="text-[12px]">{expanded.leader.seal}</span>}
            </div>
            {expanded.leader?.desc && (
              <div className="text-[12.5px] leading-relaxed mt-1.5">{expanded.leader.desc}</div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {/* ── 跟风股 ── */}
            <div>
              <div className="text-[12px] text-sub mb-1">跟风股（换手越高 = 接力意愿越强）</div>
              <DataTable
                rows={expanded.followers ?? []}
                rowKey={(r, i) => `${r.name}-${i}`}
                dense
                empty="无跟风股"
                columns={[
                  { label: '个股', cell: (r) => <span className="text-rec">{r.name}</span> },
                  {
                    label: '涨幅',
                    num: true,
                    cell: (r) => (
                      <span className={r.pct > 0 ? 'text-up' : r.pct < 0 ? 'text-down' : 'text-txt'}>{n1(r.pct)}%</span>
                    ),
                  },
                  { label: '换手', num: true, cell: (r) => `${n1(r.turn)}%` },
                ]}
              />
            </div>

            {/* ── 涨停股清单 ── */}
            <div>
              <div className="text-[12px] text-sub mb-1">当日涨停股（{expanded.zt_stocks?.length ?? 0}）</div>
              <DataTable
                rows={expanded.zt_stocks ?? []}
                rowKey={(r) => r.code}
                dense
                empty="无涨停股明细"
                columns={[
                  {
                    label: '个股',
                    cell: (r) => (
                      <span>
                        <span className="text-rec">{r.name}</span>
                        <span className="num text-sub ml-1.5">{r.code}</span>
                      </span>
                    ),
                  },
                  {
                    label: '涨幅',
                    num: true,
                    cell: (r) => <span className="text-up font-semibold">{n1(r.pct)}%</span>,
                  },
                ]}
              />
            </div>
          </div>

          {/* ── 定性结论（原系统生成，不做改写）── */}
          <div className="mt-3 grid md:grid-cols-3 gap-3">
            {expanded.diffusion && (
              <div className="border border-line rounded-sm px-2.5 py-2 md:col-span-3">
                <div className="text-[12px] text-sub mb-0.5">扩散路径</div>
                <div className="text-[12.5px] leading-relaxed">{expanded.diffusion}</div>
              </div>
            )}
            {!!expanded.positives?.length && (
              <div className="border border-line rounded-sm px-2.5 py-2">
                <div className="text-[12px] text-up mb-0.5">正向因素</div>
                <ul className="text-[12.5px] leading-relaxed">
                  {expanded.positives.map((p, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!expanded.risks?.length && (
              <div className="border border-line rounded-sm px-2.5 py-2">
                <div className="text-[12px] text-warn mb-0.5">风险因素</div>
                <ul className="text-[12.5px] leading-relaxed">
                  {expanded.risks.map((p, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- 位置序列 / 同名去重 —— 索引即身份：这些列表与日期轴或原数组严格对齐，元素本身没有稳定唯一 id，用内容做 key 反而会在重复项上出错。
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-sub text-[11px] mt-2 leading-relaxed">
            扩散路径 / 正向因素 / 风险因素由原系统脚本生成，本页原样呈现不做改写 ——
            改写会掩盖当时的判断依据。
          </p>
        </Card>
      )}
        </Zone>
      </ZoneRow>
    </div>
  )
}
