import { useQuery } from '@tanstack/react-query'
import { api, queryClient } from '@/shared/api'
import type { ReviewPanel, ReviewSeries } from '@/shared/api/types'
import { Card, CardBadge, EmptyState } from '@/shared/ui'
import { CycleTemperaturePanel, Tag, n1, n2, useCycleTemperature } from '@/features/analytics'
import { cn } from '@/shared/lib'
import { parseMainline } from '@/features/review/mainline'
import { parseAi } from '@/features/review/ai'
import { parseEvolution, parseOutlook, splitLabeled } from '@/features/review/sections'

/**
 * 今日复盘（2026-11-14 用户「改造成网页类型，连续几天做折线图」）。
 *
 * 版式：KPI 行 → 情绪/涨停双轴折线 → 涨停-跌停柱状 → 最高板折线
 *       → 高标处境 → 主线板块 → 复盘点评（可折叠）。
 * 数据：`/api/review/panel`（当日五块）+ `/api/review/series`（多日序列）。
 * ⛔ 只呈现，不在前端二次推断。
 */
/** 页面加载当天（模块级：避免渲染期调用 Date.now 触发 React purity 规则） */
const BOOT_DAY = new Date().toISOString().slice(0, 10)

export async function loader() {
  await Promise.allSettled([
    queryClient.ensureQueryData({ queryKey: ['review', 'panel'] as const, queryFn: api.reviewPanel }),
    queryClient.ensureQueryData({ queryKey: ['review', 'series'] as const, queryFn: api.reviewSeries }),
  ])
  return null
}

export function Component() {
  const panel = useQuery({ queryKey: ['review', 'panel'] as const, queryFn: api.reviewPanel, staleTime: 5 * 60_000 })
  const series = useQuery({ queryKey: ['review', 'series'] as const, queryFn: api.reviewSeries, staleTime: 5 * 60_000 })
  const d = panel.data as ReviewPanel | undefined
  const s = series.data as ReviewSeries | undefined
  // 周期温度（投机情绪/涨停反馈/资金温度）：Hook 必须在早退之前调用
  const temperature = useCycleTemperature()

  const rows = s?.rows ?? []
  const tone = (v: number | null | undefined) => (v == null ? 'sub' : v >= 0 ? 'up' : 'down')

  if (!d) {
    return (
      <Card title="🧭 今日复盘" extra={<CardBadge>—</CardBadge>}>
        <EmptyState text="暂无复盘数据" hint={panel.isLoading ? '加载中…' : '收盘后由 15:35 链生成'} />
      </Card>
    )
  }

  // 「数据生成于」不是今天 → 标黄，提示可能没更新（⛔ 渲染期不调 Date.now，用模块级常量）
  const staleDay = !!d.generated_at && d.generated_at.slice(0, 10) !== BOOT_DAY
  const risk = d.dump_risk ?? d.risk
  const m = d.money
  const hb = d.high_board
  const last = rows.at(-1)

  // 2026-11-15：删「真实情绪总览/轮动复盘/板块资金」；情绪演变放左栏主线之下，右栏 AI 综合判断 + 主线复盘 + 其余。
  // 2026-11-15：删「真实情绪总览 / 轮动复盘 / 板块资金」；「主线复盘」单独结构化渲染。
  const commentary = (d.commentary ?? []).filter(
    (sec) => !/真实情绪|轮动复盘|板块资金/.test(sec.heading),
  )
  const evolution = commentary.find((sec) => sec.heading.includes('情绪演变'))
  const ai = commentary.find((sec) => sec.heading.includes('综合判断'))
  const mainline = commentary.find((sec) => sec.heading.includes('主线复盘'))
  const evo = commentary.find((sec) => sec.heading.includes('核心演化'))
  const outlook = commentary.find((sec) => sec.heading.includes('明日展望'))
  const rest = commentary.filter(
    (sec) => sec !== evolution && sec !== ai && sec !== mainline && sec !== evo && sec !== outlook,
  )
  const evoData = evo ? parseEvolution(evo.lines) : null
  const outlookData = outlook ? parseOutlook(outlook.lines) : null
  // 2026-11-15 用户：「支线」不展示
  const mainlineBlocks = (mainline ? parseMainline(mainline.lines) : []).filter((b) => b.rank !== '支线')
  const aiData = ai ? parseAi(ai.lines) : null
  /** 评分轨迹：只取有情绪分的那几天（当前 5 日窗口），不足 2 点不画图 */

  return (
    <div className="flex flex-col gap-3">
      {/* ① 一行速览：风险 + 关键数字 + 信号 chips（删除单独的「风险卡/赚钱效应卡」，避免重复） */}
      <Card
        title={`🧭 ${cnDate(d.date)}复盘`}
        extra={
          <span className="flex items-center gap-1.5">
            {d.generated_at && (
              <CardBadge tone={staleDay ? 'warn' : 'neutral'}>
                数据生成于 {d.generated_at.slice(5, 16)}{staleDay ? ' · 不是今天的' : ''}
              </CardBadge>
            )}
            <CardBadge>{d.prev ? `对比 ${d.prev}` : '当日'}</CardBadge>
          </span>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-12 text-sub">跌停风险</span>
            <span className={cn('text-20 font-semibold num', risk.level === '高' ? 'text-down' : risk.level === '中' ? 'text-warn' : 'text-up')}>{risk.level}</span>
          </div>
          <Kpi label="情绪分" value={last?.sentiment == null ? '—' : `${n1(last.sentiment)}`} tone={tone((last?.sentiment ?? 5) - 5)} />
          <Kpi label="晋级率" value={last?.promote_rate == null ? '—' : `${n1(last.promote_rate)}%`} />
          <Kpi label="池均幅" value={m.zt_pool_avg == null ? '—' : `${n2(m.zt_pool_avg)}%`} tone={tone(m.zt_pool_avg)} />
          <Kpi label="红盘率" value={m.red_ratio == null ? '—' : `${n1(m.red_ratio)}%`} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {risk.signals.map((sig) => (
            <span
              key={sig.name}
              className={cn('text-11 px-1.5 py-[1px] rounded-sm border',
                sig.hit ? 'text-down border-down/40 bg-down/10' : 'text-sub border-line-faint')}
            >
              {sig.hit ? '●' : '○'} {sig.name} {sig.value}
            </span>
          ))}
        </div>
      </Card>

      {/* 🌊 情绪周期（2026-11-17 用户：把情绪周期的关键图搬到复盘顶部）
          ⛔ 不重复顶栏已有的 涨停/跌停/炸板/封板率/最高板/涨跌家数 —— 这里只放「周期」视角：
          情绪分轨迹 + 晋级率 + 核按钮。 */}
      {/* 🌊 情绪周期（2026-11-17 用户：把「投机情绪·周期相位 / 昨日涨停反馈·涨停家数·炸板率 /
          资金温度·主力净额 / 接力质量」接进复盘页）
          ⛔ 不重复顶栏已有的 涨停/跌停/炸板/封板率/最高板/涨跌家数。 */}
      <Card title="🌊 情绪周期" extra={<CardBadge>相位 · 反馈 · 资金</CardBadge>}>
        <CycleTemperaturePanel result={temperature} />
        {/* 🔁 接力质量：晋级率 / 核按钮 / 连板晋级（与上方面板来源不同，单独一行） */}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line-faint pt-2">
          <span className="text-12 font-semibold text-txt">🔁 接力质量</span>
          <Kpi label="晋级率" value={last?.promote_rate == null ? '—' : `${n1(last.promote_rate)}%`} />
          <Kpi label="核按钮" value={last?.nuke == null ? '—' : `${last.nuke} 只`} tone={(last?.nuke ?? 0) >= 5 ? 'down' : undefined} />
          <Kpi label="情绪分" value={last?.sentiment == null ? '—' : `${n1(last.sentiment)}/10`} tone={tone((last?.sentiment ?? 5) - 5)} />
        </div>
      </Card>

      {/* ② 两栏：左=高标 + 主线 + 梯队；右=AI 综合判断 + 主线复盘 + 其余点评 */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-3 items-start">
        <div className="flex flex-col gap-3">

          <Card title="👑 高标" extra={hb ? <CardBadge>{hb.max_boards} 板</CardBadge> : undefined}>
            {hb?.rows?.length ? hb.rows.map((r) => (
              <div key={r.code} className="text-12 leading-relaxed">
                <b>{r.name}</b> {r.boards} 板 · 封 {r.fbt || '—'} · 炸 {r.zbc}
                {r.second_wave && <Tag tone="warn">二波</Tag>}
                <div className="text-11 text-sub">明日封住 → {r.boards + 1} 板（{r.next_odds ?? '—'}%）；断板 → 退潮</div>
              </div>
            )) : <p className="text-12 text-sub m-0">无高标</p>}
          </Card>

          <Card title="🎯 主线" extra={<CardBadge>Top 6</CardBadge>}>
            <ul className="text-12 leading-relaxed m-0">
              {d.themes.slice(0, 6).map((t) => (
                <li key={t.name} className="flex items-center gap-2 mb-0.5">
                  <span className="w-[80px] flex-none truncate">{t.name}</span>
                  <span className="h-[4px] flex-1 rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
                    <span className="block h-full" style={{ width: `${Math.round(t.strength * 100)}%`, background: 'var(--color-lead)' }} />
                  </span>
                  <span className="num flex-none w-[34px] text-right">{t.zt}家</span>
                  <span className={cn('flex-none w-[42px] text-right', t.day >= 3 ? 'text-warn' : 'text-sub')}>{t.max_boards}板·{t.day}天</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* 🏗 板块梯队：家数 + 高度 + 梯队分布（2026-11-16 用户「梯队+强度是最重要的指标」） */}
          {!!d.ladder?.length && (
            <Card title="🏗 板块梯队" extra={<CardBadge>{d.ladder.length} 条线</CardBadge>}>
              <ul className="text-12 leading-relaxed m-0">
                {d.ladder.slice(0, 8).map((r) => (
                  <li key={r.theme} className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-[86px] flex-none truncate">{r.theme}</span>
                    <span className="num flex-none w-[30px] text-right">{r.mates}家</span>
                    <span className={cn('flex-none w-[38px] text-right', r.max_boards >= 3 ? 'text-up' : 'text-sub')}>高{r.max_boards}</span>
                    <span className="flex-none text-11 text-sub w-[92px] text-right">
                      首{r.l1}·2板{r.l2}·3板{r.l3}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-11 text-sub m-0 mt-1">
                一堆首板＝方向有了但没高度；首板多、高度也有的线才走得远
              </p>
            </Card>
          )}

        </div>

        {/* 右栏：AI 综合判断 → 主线复盘 → 其余段落 */}
        <div className="flex flex-col gap-3 min-w-0">
          {aiData && (
            <Card title="🧠 AI 综合判断" extra={<CardBadge>{aiData.facts.length} 事实 · {aiData.risks.length} 风险</CardBadge>}>
              <div className="flex flex-col gap-3">
                {/* 判断条：状态 + 一句话结论 */}
                <div className="border-l-2 border-line-strong pl-2.5">
                  {aiData.status && <div className="text-11 text-sub mb-0.5">盘面状态 · {aiData.status}</div>}
                  {aiData.verdict && (
                    <div className="text-14 font-semibold leading-[1.6]" dangerouslySetInnerHTML={{ __html: fmt(aiData.verdict) }} />
                  )}
                </div>

                {/* 事实：先给标题（一眼看完），正文折叠在卡片内 */}
                {aiData.facts.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {aiData.facts.map((f) => (
                      <details key={f.tag} className="rounded-sm border border-line-faint px-2.5 py-1.5 min-w-0">
                        <summary className="cursor-pointer text-12 leading-[1.6] text-txt">
                          <span className="text-11 text-lead mr-1">{f.tag}</span>
                          <b>{f.title || f.body.slice(0, 24)}</b>
                        </summary>
                        <div className="text-12 leading-[1.65] text-sub mt-1 break-words" dangerouslySetInnerHTML={{ __html: fmt(f.body) }} />
                      </details>
                    ))}
                  </div>
                )}

                {/* 风险：同样先给结论句 */}
                {aiData.risks.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {aiData.risks.map((r) => (
                      <details key={r.tag} className="rounded-sm border border-down/25 px-2.5 py-1.5 min-w-0">
                        <summary className="cursor-pointer text-12 leading-[1.6] text-txt">
                          <span className="text-11 text-down mr-1">{r.tag}</span>
                          <b>{firstSentence(r.title || r.body)}</b>
                        </summary>
                        <div className="text-12 leading-[1.65] text-sub mt-1 break-words" dangerouslySetInnerHTML={{ __html: fmt(r.body) }} />
                      </details>
                    ))}
                  </div>
                )}

                {/* 结论条 */}
                {aiData.conclusion && (
                  <div className="rounded-sm border border-warn/30 bg-warn/5 px-2.5 py-2">
                    <div className="text-11 text-warn mb-0.5">{aiData.conclusion.title}</div>
                    <div className="text-12 leading-[1.65] text-txt break-words" dangerouslySetInnerHTML={{ __html: fmt(aiData.conclusion.body) }} />
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* 🎯 主线复盘：最强/次强/第三 三卡并排（各占 1/3）；支线不展示 */}
          {mainlineBlocks.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 min-w-0 items-start">
              {mainlineBlocks.map((b) => {
                const isBranch = b.rank === '支线'
                return (
                  <div
                    key={`${b.rank}-${b.name}`}
                    className={cn('min-w-0 review-rank-top', isBranch && 'xl:col-span-3')}
                  >
                    <Card
                      title={b.rank ? `${b.rank} · ${b.name || '—'}` : (b.name || '主线')}
                      extra={b.meta ? <CardBadge>{b.meta}</CardBadge> : undefined}
                    >
                      <div className="flex flex-col gap-1.5">
                        {b.stocks.length > 0 && (
                          <div className="grid grid-cols-2 gap-1.5">
                            {b.stocks.map((st, i) => (
                              // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                              <div key={`${st.name}-${i}`} className="rounded-sm border border-line-faint px-2 py-1 min-w-0">
                                <div className="text-12 font-semibold text-txt truncate">{st.name || '—'}</div>
                                <div className="text-11 text-sub leading-snug break-words">{st.detail || '—'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {b.logic.map((ln, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-11 text-sub leading-[1.65] m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                        ))}
                        {b.risk.map((ln, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-11 text-warn leading-[1.65] m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                        ))}
                        {b.text.map((ln, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-12 text-txt leading-[1.65] m-0" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                        ))}
                      </div>
                    </Card>
                  </div>
                )
              })}
            </div>
          )}

          {/* 👑 核心演化 + 📎 明日展望：并排一张行 */}
          {(evoData || outlookData) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start min-w-0">
              {evoData && (
                <Card title="👑 核心演化" extra={<CardBadge>{evoData.outlook.length} 条推演</CardBadge>}>
                  <div className="flex flex-col gap-2">
                    {evoData.sections.map((sec) => (
                      <div key={sec.heading} className="border-l-2 border-line-faint pl-2.5">
                        <div className="text-11 text-sub mb-0.5">{sec.heading}</div>
                        {sec.lines.map((ln, i) => {
                          const { title, body } = splitLabeled(ln)
                          return (
                            // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                            <p key={i} className="text-12 leading-[1.65] m-0 text-txt break-words">
                              {title && <b className="text-txt">{title} </b>}
                              <span dangerouslySetInnerHTML={{ __html: fmt(body) }} />
                            </p>
                          )
                        })}
                      </div>
                    ))}
                    {evoData.outlook.length > 0 && (
                      <div className="border-l-2 border-line-faint pl-2.5">
                        <div className="text-11 text-sub mb-0.5">明日推演</div>
                        {evoData.outlook.map((it, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-12 leading-[1.65] m-0 text-txt break-words">
                            <b>{it.title}</b>
                            {it.body && <span className="text-sub"> —— </span>}
                            <span className="text-sub" dangerouslySetInnerHTML={{ __html: fmt(it.body) }} />
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {outlookData && (
                <Card title="📎 明日展望" extra={<CardBadge>{outlookData.points.length} 个看点</CardBadge>}>
                  <div className="flex flex-col gap-2">
                    {outlookData.points.length > 0 && (
                      <div>
                        <div className="text-11 text-sub mb-1">看点</div>
                        <ol className="m-0 p-0 list-none flex flex-col gap-1">
                          {outlookData.points.map((pt, i) => (
                            // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                            <li key={i} className="flex gap-1.5 text-12 leading-[1.65]">
                              <span className="text-lead flex-none">{pt.no}</span>
                              <span className="min-w-0 break-words">
                                {pt.title && <b>{pt.title}</b>}
                                {pt.title && pt.body && <span className="text-sub">　</span>}
                                <span className="text-sub" dangerouslySetInnerHTML={{ __html: fmt(pt.body) }} />
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {outlookData.repair && (
                      <div className="rounded-sm border border-line-faint px-2.5 py-1.5">
                        <div className="text-11 text-sub mb-0.5">{outlookData.repair.heading}</div>
                        {outlookData.repair.lines.map((ln, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-12 leading-[1.65] m-0 break-words" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                        ))}
                      </div>
                    )}

                    {outlookData.confirm && (
                      <div>
                        <div className="text-11 text-sub mb-1">{outlookData.confirm.heading}</div>
                        <div className="flex flex-wrap gap-1">
                          {outlookData.confirm.lines.join('｜').split('｜').filter(Boolean).map((t) => (
                            <span key={t} className="text-11 px-1.5 py-[1px] rounded-sm border border-line-faint text-sub">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {outlookData.risk && (
                      <div className="rounded-sm border border-down/30 bg-down/5 px-2.5 py-1.5">
                        <div className="text-11 text-down mb-0.5">{outlookData.risk.heading}</div>
                        {outlookData.risk.lines.map((ln, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-12 leading-[1.65] m-0 break-words" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                        ))}
                      </div>
                    )}

                    {outlookData.follow.length > 0 && (
                      <div>
                        <div className="text-11 text-sub mb-1">延续观察</div>
                        {outlookData.follow.map((it, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-12 leading-[1.65] m-0 text-sub break-words">
                            <span className="text-lead mr-1">{it.no}</span>
                            <span dangerouslySetInnerHTML={{ __html: fmt(it.title || it.body) }} />
                          </p>
                        ))}
                      </div>
                    )}

                    {outlookData.mantra && (
                      <div className="border-l-2 border-line-strong pl-2.5">
                        <div className="text-11 text-sub mb-0.5">{outlookData.mantra.heading}</div>
                        {outlookData.mantra.lines.map((ln, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                          <p key={i} className="text-12 leading-[1.65] m-0 text-sub italic break-words" dangerouslySetInnerHTML={{ __html: fmt(ln) }} />
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}

          {rest.length > 0 && (
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 items-start min-w-0">
              {rest.map((sec) => (
                <div key={sec.heading} className={cn('min-w-0', sec.lines.join('').length > 700 && '2xl:col-span-2')}>
                  <Card title={sec.heading.replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '')}>
                    <div className="flex flex-col gap-2 text-13 leading-[1.75] text-txt break-words">
                      {sec.lines.map((ln, i) => (
                        // oxlint-disable-next-line react/no-array-index-key -- 原文顺序不变
                        <CommentLine key={i} text={ln} />
                      ))}
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          )}

          {!evolution && !ai && !mainline && !evo && !outlook && rest.length === 0 && (
            <Card title="🧠 复盘点评">
              <EmptyState text="今日暂无复盘点评" hint="复盘数据生成后出现" />
            </Card>
          )}
        </div>
      </div>

      {/* 📌 今日总结（2026-11-17 用户：底部放今天的归纳，重点是主线 / 次主线）
          ⛔ 只做归纳，不重复上面已有的明细（风险信号、AI 事实卡、点评正文都不再搬）。 */}
      {!!d.ladder?.length && (
        <Card title="📌 今日总结" extra={<CardBadge>主线 / 次主线</CardBadge>}>
          <div className="flex flex-col gap-1.5 text-12">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sub w-[52px] flex-none">主线</span>
              <Tag tone="up">{d.ladder[0].theme}</Tag>
              <span className="text-sub">
                {d.ladder[0].mates} 家 · 最高 {d.ladder[0].max_boards} 板 · 首板 {d.ladder[0].l1} 家
              </span>
            </div>
            {d.ladder.length > 1 && (
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sub w-[52px] flex-none">次主线</span>
                {d.ladder.slice(1, 4).map((r) => (
                  <span key={r.theme} className="flex items-baseline gap-1">
                    <Tag tone="warn">{r.theme}</Tag>
                    <span className="text-sub">{r.mates} 家 · {r.max_boards} 板</span>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sub w-[52px] flex-none">一句话</span>
              <span className="text-txt">
                情绪 {last?.sentiment == null ? '—' : n1(last.sentiment)}/10 ·
                晋级率 {last?.promote_rate == null ? '—' : `${n1(last.promote_rate)}%`} ·
                跌停风险 {risk.level}
                {d.ladder[0].l3 === 0 ? ' · 主线没有高度，只有首板' : ` · 主线有 ${d.ladder[0].l3} 只 3 板以上`}
              </span>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

/** `2026-11-13` → `2026年11月13日`（标题用，解析失败原样返回） */
function cnDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : d
}

/** 取第一句（到「。」或 42 字），用于折叠卡的摘要行。 */
function firstSentence(text: string): string {
  const m = /^(.+?)[。！？]/.exec(text.trim())
  const s = m ? m[1] : text.trim()
  return s.length > 42 ? `${s.slice(0, 42)}…` : s
}

/** 顶部速览用的小指标（label 上、值下，紧凑） */
function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'warn' | 'sub' }) {
  return (
    <div className="review-kpi flex flex-col leading-tight">
      <span className="text-11 text-sub">{label}</span>
      <span className={cn('text-15 font-semibold num', tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : 'text-txt')}>{value}</span>
    </div>
  )
}

/**
 * 点评行渲染（2026-11-14 用户「右边全是文案，优化阅读」）。
 * `**标签** 值` → 两列；`· xxx` → 列表；含进度条字符时画进度条。
 */
function CommentLine({ text, compact = false }: { text: string; compact?: boolean }) {
  const t = text.trim()
  const m = /^\*\*(.+?)\*\*[　\s]*(.*)$/.exec(t)
  const bar = /[▰▱]{6,}/.exec(t)
  if (bar) {
    const s = bar[0]
    const filled = (s.match(/▰/g) || []).length
    const pct = Math.round((filled / s.length) * 100)
    return (
      <div className="mb-1.5">
        <div className="h-[6px] w-full rounded-sm overflow-hidden" style={{ background: 'var(--color-line-faint)' }}>
          <div className="h-full" style={{ width: `${pct}%`, background: 'var(--color-up)' }} />
        </div>
        <div className="text-12 mt-0.5" dangerouslySetInnerHTML={{ __html: fmt(t.replace(s, '')) }} />
      </div>
    )
  }
  if (t.startsWith('·')) {
    return (
      <div className="flex gap-1.5 mb-0.5">
        <span className="text-sub flex-none">·</span>
        <span className={cn('leading-[1.55]', compact ? 'text-12' : 'text-13')} dangerouslySetInnerHTML={{ __html: fmt(t.replace(/^·\s*/, '')) }} />
      </div>
    )
  }
  if (m) {
    const shortLabel = m[1].length <= 6 && m[2].trim().length > 0
    return (
      <div className={shortLabel ? 'grid grid-cols-[64px_minmax(0,1fr)] gap-3' : 'flex flex-col gap-1'}>
        <span className={shortLabel ? 'text-12 text-sub leading-[1.75]' : 'text-13 font-semibold text-txt leading-[1.75]'}>{m[1]}</span>
        {m[2] && <span className={cn('leading-[1.75]', compact ? 'text-12' : 'text-13')} dangerouslySetInnerHTML={{ __html: fmt(m[2]) }} />}
      </div>
    )
  }
  return <p className={cn('m-0 leading-[1.75]', compact ? 'text-12 mb-0.5' : 'text-13 mb-1')} dangerouslySetInnerHTML={{ __html: fmt(t) }} />
}

/** lark_md 轻量转 HTML：`<text_tag color>` → span，`**加粗**` → b，换行 → br。 */
function fmt(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/&lt;text_tag color='(red|green|blue|purple|grey|neutral)'&gt;/g, (_m, c) => `<span class="tt-${c}">`)
    .replace(/&lt;\/text_tag&gt;/g, '</span>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br/>')
}
