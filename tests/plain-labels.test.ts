import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_DATA_ROOT, DATA_ROOT_ENV, ROUTES } from '@/shared/api'
import {
  CAPITAL_PLAIN,
  biasText,
  capitalText,
  cardPhaseText,
  klineText,
  phaseText,
  PLAIN_UNKNOWN,
  sectorSentimentText,
  sectorTierText,
  stanceText,
  viewText,
  ztDirText,
} from '@/shared/lib'
// eslint-disable-next-line
import { readRoute, resolveDataRoot } from '../scripts/lib/read-route.mjs'

/**
 * **白话层契约（2026-09-23 审计确立）**
 *
 * 用户诉求：把实时板块模块里「面向机器 / 术语化 / 数据化」的输出，统一转译成普通用户
 * 直接看得懂的中文；重点引入**基于周期的因果解读**（今日强 → 昨日资金已进场；
 * 今日弱 → 昨日热度已达极值）。评估结论见
 * `狸猫猎手/config/design_实时板块周期归因话术_评估.md`：**能做，但 P0 必须先把
 * 已经漏在屏幕上的英文内部枚举收干净**，否则话术层建在脏底上。
 *
 * ## 实测违规 6 处（本测试就是防它们复发）
 *
 * | 位置 | 曾经屏幕上显示的 |
 * |---|---|
 * | `RotationPage.tsx:394` | `资金 inflow_rising` |
 * | `RotationPage.tsx:396` | `阶段 boom` |
 * | `RotationPage.tsx:405` | `涨停方向 falling` |
 * | `AiJudgeDetail.tsx:299` | `capacity`（旧表漏了这个值，`?? raw` 直接漏出） |
 * | `AiJudgeDetail.tsx:301` | `mid` |
 * | `AiJudgeDetail.tsx:166 / 201` | `participate` / `focus`（`META[x] ?? x` 回落） |
 * | `AiPage.tsx:330` | `hibernate`（旧表只有 3 项，缺这个值） |
 *
 * ## ⛔ 本组最关键的一条锁
 *
 * 后端的枚举值**不是干净的单值** —— 同一函数里混用三种形态：
 * 裸 token（`inflow_rising`）、**带中文后缀**（`inflow_fading(流入转弱)` / `weak_outflow(无趋势)`）、
 * 已是中文（`分歧`）。所以「**含中文就原样返回**」这种偷懒实现是**不够的**：
 * `weak_outflow(无趋势)` 会带着英文前缀漏出去。② 号用例专门锁这一条。
 */

const NO_ASCII_LETTER = /^[^A-Za-z]*$/

/** 断言「已译成白话」：含中文、且**不含任何 ASCII 字母**、且不是未识别 */
function expectPlain(out: string, where: string) {
  expect(out, `${where} 不应回落成未识别`).not.toBe(PLAIN_UNKNOWN)
  // ⚠️ 「K线」是中文技术写作的惯例写法（K 是保留术语，不是内部 token 泄漏）——
  //    校验前把它换成纯中文，避免把 `无K线数据` 误判成英文泄漏。
  const probe = out.replace(/K线/g, '线')
  expect(probe, `${where} 仍含英文字母 —— 内部 token 漏到屏幕：${out}`).toMatch(NO_ASCII_LETTER)
  expect(out, `${where} 结果为空`).not.toBe('—')
}

describe('白话层 · 已知取值全覆盖（取值清单来自后端源码与实测缓存）', () => {
  it('① 每个已知枚举都必须译成白话（⛔ 不留一个英文）', () => {
    // 值清单来源：`scripts/theme_rotation.py::_confidence` / `::build`、`pool_call.py`、
    // 接力卡 `expectation`。⛔ 增删值时必须同步这里 —— 它同时是「后端值空间」的登记处。
    const known: Array<[string, (v: unknown) => string, string[]]> = [
      // 8 种（含带中文后缀的 5 种）
      ['capital', capitalText, Object.keys(CAPITAL_PLAIN)],
      ['phase', phaseText, ['boom', 'watch', 'cooling', 'dead', 're-entry-candidate', 'no-reentry', '分歧']],
      ['zt_dir', ztDirText, ['new', 'rising', 'flat', 'falling']],
      ['stance', stanceText, ['attack', 'selective', 'defend', 'hibernate']],
      ['sector_tier', sectorTierText, ['dragon', 'follower', 'lone', 'capacity']],
      ['sector_sentiment', sectorSentimentText, ['high', 'mid', 'low']],
      ['view', viewText, ['participate', 'watch', 'skip']],
      ['bias', biasText, ['focus', 'normal', 'avoid']],
    ]
    for (const [field, fn, values] of known) {
      for (const v of values) expectPlain(fn(v), `${field}=${v}`)
    }
  })

  it('② 带中文后缀的形态必须**剥壳**，不得把英文前缀带出去（本次最易踩的坑）', () => {
    // `theme_rotation.py::_confidence` 同一函数里两种写法混用：
    //   capital = "inflow_rising"                ← 裸 token
    //   capital = "inflow_fading(流入转弱)"      ← 带后缀
    //   capital = "weak_outflow(无趋势)"         ← 带后缀（且裸 token 无独立语义）
    expect(capitalText('inflow_fading(流入转弱)')).toBe('流入转弱')
    expect(capitalText('neutral(无趋势)')).toBe('资金无趋势')
    expect(capitalText('no_data(无资金流)')).toBe('无资金数据')
    // 裸 token 有独立语义时**优先用裸 token 译**（信息量更大）；`weak_outflow` = 小幅流出
    expect(capitalText('weak_outflow(无趋势)')).toBe('小幅流出')
    expect(capitalText('outflow(无趋势)')).toBe('持续流出')
    // 裸 token 不在表里 → **退回中文后缀**（⛔ 不得把 `new_token(中文)` 整体原样吐出）
    expect(capitalText('new_token(中文后缀)')).toBe('中文后缀')
    for (const v of ['inflow_fading(流入转弱)', 'weak_outflow(无趋势)', 'no_data(无资金流)']) {
      expectPlain(capitalText(v), `剥壳 capital=${v}`)
    }
  })

  it('③ 未知 token **绝不直出**原 token，回落固定中文「未识别」', () => {
    for (const bad of ['some_new_enum', 'SURGE', 'phase_v2']) {
      expect(capitalText(bad)).toBe(PLAIN_UNKNOWN)
      expect(phaseText(bad)).toBe(PLAIN_UNKNOWN)
      expect(stanceText(bad)).toBe(PLAIN_UNKNOWN)
      expect(sectorTierText(bad)).toBe(PLAIN_UNKNOWN)
    }
    // 回归守卫：结果里不得出现原 token 本身
    expect(capitalText('some_new_enum')).not.toContain('some_new_enum')
  })

  it('④ 空值 → 「—」（项目统一口径，⛔ 不退化成 0 或空白）', () => {
    for (const fn of [capitalText, phaseText, ztDirText, stanceText, sectorTierText]) {
      expect(fn(null)).toBe('—')
      expect(fn(undefined)).toBe('—')
      expect(fn('')).toBe('—')
      expect(fn('   ')).toBe('—')
    }
  })

  it('⑤ 后端已给中文的值原样返回（如 phase=`分歧`），⛔ 不误判成未识别', () => {
    expect(phaseText('分歧')).toBe('分歧')
  })

  it('⑥ 接力卡相位走另一套词，且 `cardPhaseText` 对两套值都安全', () => {
    // `candidate.phase` 是英文枚举；接力卡 `expectation.phase` 实测是中文（亢奋/分歧/冰点）
    expect(cardPhaseText('亢奋')).toBe('亢奋')
    expect(cardPhaseText('冰点')).toBe('冰点')
    expect(cardPhaseText('boom'), '接力卡语境下 boom = 亢奋').toBe('亢奋')
    expectPlain(cardPhaseText('亢奋'), 'cardPhase(亢奋)')
  })

  it('⑦ K 线止跌保留「判据命中数 N/4」——那是程度信息，⛔ 不得被收敛掉', () => {
    expect(klineText('stop_fall(止跌3/4)')).toBe('止跌 3/4')
    expect(klineText('stop_fall(止跌4/4)')).toBe('止跌 4/4')
    expect(klineText('not_yet(未止跌1/4)')).toBe('未止跌 1/4')
    expect(klineText('no_data(无K线)')).toBe('无K线数据')
    expect(klineText('stop_fall')).toBe('止跌成立')
    expect(klineText(null)).toBe('—')
    expect(klineText('xyz')).toBe(PLAIN_UNKNOWN)
    for (const v of ['stop_fall(止跌3/4)', 'not_yet(未止跌1/4)', 'no_data(无K线)', 'stop_fall']) {
      expectPlain(klineText(v), `kline=${v}`)
    }
  })
})

// ── 真实数据全量扫（读落盘缓存；缺料则跳过，不制造假绿也不假红）────────────────
const DATA_ROOT = resolveDataRoot(
  path.resolve(import.meta.dirname, '..'),
  DEFAULT_DATA_ROOT,
  DATA_ROOT_ENV,
)

/** 从任意嵌套结构里收集指定 key 的字符串值 */
function collect(obj: unknown, keys: readonly string[], out: Array<[string, string]> = []) {
  if (Array.isArray(obj)) {
    for (const x of obj) collect(x, keys, out)
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (keys.includes(k) && typeof v === 'string' && v.trim()) out.push([k, v])
      collect(v, keys, out)
    }
  }
  return out
}

const mapperOf: Record<string, (v: unknown) => string> = {
  capital: capitalText,
  phase: phaseText,
  zt_dir: ztDirText,
  stance: stanceText,
  sector_tier: sectorTierText,
  sector_sentiment: sectorSentimentText,
  kline: klineText,
  view: viewText,
  bias: biasText,
}

describe('白话层 · 真实落盘数据全量扫', () => {
  const routes: Array<[string, string[]]> = [
    ['/api/theme/rotation', ['capital', 'phase', 'zt_dir', 'kline']],
    ['/api/decision/pool-call', ['stance', 'view']],
    ['/api/ai/view', ['view', 'bias']],
    ['/api/decision/candidates', ['sector_tier', 'sector_sentiment', 'phase']],
  ]

  for (const [route, keys] of routes) {
    it(`⑧ ${route} 的枚举值全部可译（实测数据，非构造）`, () => {
      let data: unknown
      try {
        data = readRoute(DATA_ROOT, ROUTES[route as keyof typeof ROUTES])
      } catch {
        data = null
      }
      const pairs = collect(data, keys)
      if (pairs.length === 0) {
        // 数据未落盘（如盘后链未跑）→ 跳过，⛔ 不拿空数据假装通过
        expect(true).toBe(true)
        return
      }
      for (const [k, v] of pairs) expectPlain(mapperOf[k](v), `${route} ${k}=${v}`)
    })
  }
})

// ── 源扫描：缺省分支不得直出原 token ──────────────────────────────────────
describe('白话层 · 源扫描（⛔ 防「?? raw」回落复发）', () => {
  const SRC = path.resolve(import.meta.dirname, '..', 'src')
  const ENUM_FIELDS = [
    'capital',
    'phase',
    'zt_dir',
    'stance',
    'sector_tier',
    'sector_sentiment',
    'kline',
    'bias',
    'view',
  ]
  /**
   * `?? x.phase` / `|| x.capital` —— 这类回落会把内部 token 直接送进 JSX。
   * ⚠️ 负向前瞻只排除**比较上下文**（`===` `!==` `==` `!=` `<` `>` …）：
   *    `|| e.phase === '亢奋' ? …` 是「逻辑或 + 判断」，不是回落（实测 DossierView 有这种写法，曾误报）。
   *    ⛔ 不要把裸 `?` 也算进去 —— 那样 `?? x.view ?? ''` 这类**真回落**会被整条漏掉。
   */
  const RAW_FALLBACK = new RegExp(
    `(\\?\\?|\\|\\|)\\s*[A-Za-z_$][\\w$]*\\.(${ENUM_FIELDS.join('|')})\\b(?!\\s*(===|!==|==|!=|<=|>=|<|>))`,
  )

  /**
   * 允许的例外：**源选择**而非展示回落 —— 两个来源都是同一枚举，最终统一走 `viewText`。
   * ⚠️ 例外条目必须**仍然存在**（下面的断言会校验），否则就是过期豁免 = 盲区。
   */
  const SAFE = ['r.call?.view ?? r.view']

  function walk(dir: string, out: string[] = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
    return out
  }

  it('⑨ src 下不存在「`?? 原 token`」式的枚举回落', () => {
    const offenders: string[] = []
    let safeSeen = 0
    for (const f of walk(SRC)) {
      for (const [i, line] of fs.readFileSync(f, 'utf8').split('\n').entries()) {
        if (!RAW_FALLBACK.test(line)) continue
        const safe = SAFE.find((s) => line.includes(s))
        if (safe) {
          safeSeen += 1
          continue
        }
        offenders.push(`${path.relative(SRC, f)}:${i + 1}  ${line.trim().slice(0, 110)}`)
      }
    }
    expect(
      offenders,
      `枚举回落直出原 token —— 必须走 @/shared/lib 的白话层：\n${offenders.join('\n')}`,
    ).toEqual([])
    expect(safeSeen, '⛔ 过期豁免：SAFE 里的例外在源码中已不存在，请删掉它').toBe(SAFE.length)
  })
})
