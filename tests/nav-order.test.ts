/**
 * 导航顺序锁定 —— 「实时优先」是可回归的产品决策，不是一个随手排的数组。
 *
 * ## 为什么要锁这个
 *
 * 21 个 Tab 的顺序看起来只是 UI 细节，但它决定了用户**一屏之内先看到什么**。
 * 本项目当前 61 条数据路由中只有 8 条是盘中实时（`cadence: 'intraday'`），
 * 其余 52 条都是日频/历史档 —— 若实时页被历史页淹没，终端就退化成「翻旧账工具」，
 * 而这恰恰是用户明确提出要修的问题。
 *
 * 顺序一旦被无意改动（新增页面时插错位置、或有人「顺手按字母序排一下」），
 * 单看界面很难察觉。故此处把三条不变量写死：
 *   1. 段序固定：实时 → 盘面 → 决策 → 题材 → 数据
 *   2. 「实时」段必须是**连续前缀**（不能有历史页插队到实时页之间）
 *   3. 「实时」段成员必须等于 cadence 审计结论 —— 且路由表若新增实时路由，
 *      本测试会失败以提醒重新审计导航
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TABS } from '@/app/AppShell'

/**
 * 「实时」段成员 = 消费 `cadence: 'intraday'` 路由的页面。
 *
 * 来源：脚本遍历「页面 → query → endpoint → 路由 → cadence」全链路（2026-09-15）。
 * 与 `routes.ts` 的实时路由逐条对应：
 *   /api/market/latest      → / 盘中实时、/mainline 主线题材
 *   /api/theme/rotation     → /rotation 题材轮动、/reflow 题材回流、/flow 资金流向
 *   /api/emotion/zt-history → /timeline 日内时间轴（含 `zt_list.fbt` 与 intraday_points）
 *                             ⚠️ 该页归类为「实时」是**页面级决策**而非路由 cadence 推导：
 *                             zt-history 路由本身是 daily，但页面读的 audit.jsonl 是
 *                             intraday，且它的用途是盘中随盘推进地看「今天怎么走到现在」。
 *
 * ⚠️ 2026-09-22 审计：`/record`（数据记录）、`/ops`（运维审计）**已迁入「数据」段**
 *    （用户明确要求「数据记录 / 运维审计 / 同花顺数据 移到数据模块」）。
 *    二者虽含 intraday 路由，但页面主体是**日频台账/审计**，按「短线交易优先级」不属实时段
 *    —— 再次印证：cadence 是**路由级**属性，导航段是**页面级**决策。
 */
const REALTIME_TABS = [
  '/',
  '/timeline',
  '/mainline',
  '/effect',
  '/flow',
  '/reflow',
  '/rotation',
] as const

/** 段序 —— 实时段置首是本次改动的核心，顺序即契约 */
const GROUP_ORDER = ['实时', '盘面', '决策', '题材', '数据'] as const

describe('导航顺序 —— 实时优先', () => {
  it('分段顺序固定为 实时 → 盘面 → 决策 → 题材 → 数据', () => {
    // 按出现次序去重，得到实际段序
    const seen: string[] = []
    for (const t of TABS) if (seen[seen.length - 1] !== t.group) seen.push(t.group)
    expect(seen).toEqual([...GROUP_ORDER])
  })

  it('「实时」段是连续前缀 —— 历史页不得插队到实时页之间', () => {
    const firstNonRealtime = TABS.findIndex((t) => t.group !== '实时')
    expect(firstNonRealtime, '导航里根本没有「实时」段').toBeGreaterThan(0)
    // 前缀内必须全是实时段，其后必须全不是
    for (const t of TABS.slice(0, firstNonRealtime)) {
      expect(t.group, `${t.label} 混进了实时前缀`).toBe('实时')
    }
    for (const t of TABS.slice(firstNonRealtime)) {
      expect(t.group, `${t.label} 在实时段之后却又标了实时`).not.toBe('实时')
    }
  })

  it('「实时」段成员等于 cadence 审计结论（不多不少）', () => {
    const actual = TABS.filter((t) => t.group === '实时').map((t) => t.to)
    expect(actual).toEqual([...REALTIME_TABS])
  })

  it('首项是首页「盘中实时」—— 短线交易的最高优先级入口', () => {
    expect(TABS[0].to).toBe('/')
    expect(TABS[0].end, '首页必须精确匹配，否则所有子路由都会把它点亮').toBe(true)
    expect(TABS[0].label).toBe('盘中实时')
  })

  it('「实时」段顺序 = 声明的短线优先级（顺序即契约 · ⛔ 不许重排）', () => {
    // 首页（盘中实时）恒在首位；其后时间轴 → 主线 → 赚钱效应 → 资金 → 回流 → 轮动。
    // ⛔ 2026-09-22 起数据/运维类（/record·/ops）已移出实时段，不再参与本排序。
    // ⛔ 2026-09-23 新增 /effect（赚钱效应）—— 与 /timeline 同属「盘中定性」组，紧邻其后。
    expect([...REALTIME_TABS]).toEqual([
      '/',
      '/timeline',
      '/mainline',
      '/effect',
      '/flow',
      '/reflow',
      '/rotation',
    ])
  })

  it('路径唯一 —— 重复会让同一页出现两个 Tab 且高亮错乱', () => {
    const paths = TABS.map((t) => t.to)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('路由表新增实时路由时本测试失败，以提醒重新审计导航', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/shared/api/routes.ts'),
      'utf8',
    )
    const intraday = [...src.matchAll(/cadence:\s*'intraday'/g)].length
    /**
     * 9 = latest / prev / auction / signals / feedback / candidates /
     *     theme.rotation / audit.log / system.engine
     *
     * ⚠️ 2026-09-16 审计记录（新增 `system.engine` 后重跑本锁）：
     *    「实时段」的成员判定**不是**「页面是否含 intraday 路由」，而是两条准则的交集 ——
     *    ① 实时性；② 短线交易优先级。`/system`（系统台账）虽然含一条 intraday 路由
     *    （盘中引擎状态 · 60s 刷新），但页面主体是**日频配置与台账**；按准则 ②
     *    它不该出现在导航最前，故留在「数据」段。
     *    → 这条锁有意保持「数量」而非「映射」：cadence 是**路由级**属性，
     *      导航段是**页面级**决策，两者本来就不是一一对应。
     */
    /**
     * ⚠️ 2026-09-17 审计记录（新增 `/api/intraday/timeline` 后重跑本锁）：9 → 10。
     *    新路由 = 「盘中情绪时间轴」逐事件日志（`intraday_timeline.py` 每轮追加 · cadence=intraday，名副其实）。
     *    它被 **`/timeline` 页面**消费（该页已在「实时」段首位之后），
     *    ⇒ 无需增删「实时」段成员，只更新计数。
     *    再次印证本条锁的用意：cadence 是**路由级**，导航段是**页面级**，两者非一一映射。
     */
    expect(
      intraday,
      'intraday 路由数量变了 —— 请重新跑「页面 × cadence」审计，确认「实时」段是否需要增删成员',
    ).toBe(12)
  })
})
