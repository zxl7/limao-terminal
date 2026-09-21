/**
 * 行情域的数据过滤 —— **纯函数**，域内知识，不外泄。
 *
 * 为什么单独一个文件而不是散在组件里：过滤规则是**可交易性**约束，
 * 它与「怎么画」无关。放在组件里就无法被单测直接覆盖，只能靠渲染测试间接验证
 * （而渲染测试里字段一旦换位置，断言就静默失效 —— 本项目已经踩过一次）。
 */

import { isLimitUp, isStarMarket } from '@/shared/lib'
import type { EarlyItem, Leader } from '@/shared/api'

type CoreStock = Pick<Leader, 'name' | 'code' | 'pct'> & Partial<Leader> & {
  themes: string[]
  catalysts: string[]
  unsealed: boolean
}

/** 优先保留核心标的报价，同票多题材只补充归属，不重复铺行。 */
export function mergeCoreStocks(leaders: Leader[], early: EarlyItem[]): CoreStock[] {
  const rows: CoreStock[] = []
  const codeKey = (code: string) => code.match(/\d{6}/)?.[0] ?? code.trim()
  const nameKey = (name: string) => name.replace(/\s/g, '')
  const locate = (s: { code: string; name: string }) => rows.find((r) =>
    s.code && r.code ? codeKey(s.code) === codeKey(r.code) : nameKey(s.name) === nameKey(r.name),
  )
  for (const s of leaders) {
    if (isStarMarket(s.code)) continue
    const found = locate(s)
    if (found) {
      if (s.sector && !found.themes.includes(s.sector)) found.themes.push(s.sector)
      continue
    }
    rows.push({ ...s, themes: s.sector ? [s.sector] : [], catalysts: [],
      unsealed: s.buyable && !isLimitUp(s.pct, s.is_20cm),
    })
  }
  for (const e of early) {
    const s = e.buy
    if (!s || isStarMarket(s.code) || s.limit_up_days !== 0 || !Number.isFinite(s.pct) || isLimitUp(s.pct, s.is_20cm)) continue
    const found = locate(s)
    if (found) {
      if (e.sector && !found.themes.includes(e.sector)) found.themes.push(e.sector)
      if (e.desc && !found.catalysts.includes(e.desc)) found.catalysts.push(e.desc)
      continue
    }
    rows.push({ ...s, themes: e.sector ? [e.sector] : [], catalysts: e.desc ? [e.desc] : [], unsealed: true })
  }
  return rows
}

/**
 * 剔除科创板（688 / 689）标的后返回新数组。
 *
 * ## ⛔ 这是硬约束，不是排序偏好
 *
 * 用户**没有科创板交易权限** —— 科创板标的在本系统里不可交易。
 * 出现在早鸟埋伏 / 核心标的 / 题材榜里都毫无意义，只会稀释注意力。
 *
 * ## 它必须存在，因为上游并不总是过滤
 *
 * 2026-09-15 实测：`latest.leaders` / `latest.early` / `latest.top5` 的代码里
 * 都没有 688（上游脚本已过滤），但 `latest.em_expect`（东财题材榜）**原样透传**
 * 东财榜单 —— 5 个题材里有 4 个含 688，单条占比最高达 5/8（CRO 题材）。
 *
 * ⚠️ 保留原数组顺序：题材榜的顺序本身带信息（东财按相关性排），不要顺手排序。
 */
export function tradableStocks<T extends { code?: string | null }>(
  rows: T[] | null | undefined,
): T[] {
  return (rows ?? []).filter((s) => !isStarMarket(s.code))
}
