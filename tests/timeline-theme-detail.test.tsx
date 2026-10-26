import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  BlockDetail,
  groupSlotByTheme,
  TimelineSlotCard,
  type StockThemeTag,
  type ThemeBurst,
  type TimelineBlock,
  type TimelineSlot,
  type TimelineSlotSector,
} from '@/features/analytics'
import type { IntradayTimelineEvent, ZtPoolStock } from '@/shared/api'

/**
 * 时间轴详情的**题材主轴**契约（2026-09-22 用户定）。
 *
 * 用户原话：「我需要看到的是**题材、题材爆发以及与题材相关的大量个股**，
 * 我不喜欢看到现在什么的**爆发走强，杀跌这些数量**。」
 *
 * 病灶：详情此前的个股按 `zt_list[].sector`（**行业**）分组 —— 而炒作单位是**题材**。
 * 「医药 3 只」被摊成「化学制药 2 只 + 中药 1 只」，用户在详情里看不到题材。
 *
 * 本组锁五点：
 *   ① 归组主轴 = 题材（`themes[0]`），一只票**不重复**出现在它的每个题材下；
 *   ② 无题材标记的票**不丢**，归入 `unthemed`；
 *   ③ 排序：**爆发题材优先** → 家数 → 最高板 → 名；
 *   ④ 详情**不渲染**盘中「爆发/走强 · 杀跌」事件块与 `↑N/↓N`（用户的明确否决）；
 *   ⑤ 卡面（240px）**不受影响** —— 仍走行业分组，题材主轴只用于详情。
 */

function mkStock(
  code: string,
  name: string,
  sector: string,
  boards = 1,
  fbt = '100000',
): ZtPoolStock {
  return {
    code,
    name,
    pct: 10,
    price: 10,
    boards,
    fbt,
    zbc: 0,
    hs: 1,
    sector,
    seal: 1,
    cje_yi: 1,
    zsz_yi: 10,
  } as unknown as ZtPoolStock
}

function group(sector: string, stocks: ZtPoolStock[]): TimelineSlotSector {
  return { sector, stocks, count: stocks.length, dayShape: null, daySpan: 5, dayTotal: stocks.length }
}

const a1 = mkStock('a1', '甲药', '化学制药', 2)
const a2 = mkStock('a2', '乙药', '化学制药', 1)
const a3 = mkStock('a3', '丙药', '中药', 3)
const b1 = mkStock('b1', '机一', '自动化设备', 1)
const b2 = mkStock('b2', '机二', '自动化设备', 1)
const c1 = mkStock('c1', '无题一', '电力', 1)

/** 医药 3 只（跨 2 个行业）+ 机器人 2 只 + 无题材 1 只 */
const TAGS = new Map<string, StockThemeTag>([
  ['a1', { themes: ['医药'], leaderOf: ['医药'] }],
  ['a2', { themes: ['医药'], leaderOf: [] }],
  // ⛔ 主轴 = themes[0] = 医药 → 不得再出现在 'CXO' 组
  ['a3', { themes: ['医药', 'CXO'], leaderOf: [] }],
  ['b1', { themes: ['机器人'], leaderOf: [] }],
  ['b2', { themes: ['机器人'], leaderOf: [] }],
])

const THEME_INFO = new Map<string, ThemeBurst>([
  [
    '医药',
    {
      theme: '医药',
      at: 600,
      to: 660,
      isNewMainline: true,
      riseCount: 5,
      leaders: ['哈药股份'],
      currentLeader: '哈药股份',
      points: [{ at: 600, kind: 'rise' }],
      catalyst: '基药目录落地 + 创新药出海',
      pushCount: 2,
      // 当日该题材涨停成员 5 只（本槽只出现前 3 只 → 其余 2 只应作为「其余成员」列出）
      members: [
        { code: 'a1', name: '甲药' },
        { code: 'a2', name: '乙药' },
        { code: 'a3', name: '丙药' },
        { code: 'x9', name: '丁药' },
        { code: 'x8', name: '戊药' },
      ],
    },
  ],
])

/** 题材爆发事件（`新主线崛起：医药 涨停5只，龙头 哈药股份`） */
const RISE = { time: '10:00', event: '新主线崛起：医药 涨停5只，龙头 哈药股份', severity: 'high', topic: '医药' }

const UP = [
  { time: '10:00', kind: 'sector_up', name: '化学制药', zt_count: 3, delta: 2 },
] as unknown as IntradayTimelineEvent[]
const DOWN = [
  { time: '10:00', kind: 'sector_down', name: '白银', pct: -6.49 },
] as unknown as IntradayTimelineEvent[]

function slotObj(opts: Partial<TimelineSlot> = {}): TimelineSlot {
  return {
    at: 600,
    sectors: [group('化学制药', [a1, a2]), group('中药', [a3]), group('自动化设备', [b1, b2])],
    singles: [c1],
    events: [RISE] as unknown as TimelineSlot['events'],
    pushes: null,
    pushTo: null,
    intradayUp: UP,
    intradayDown: DOWN,
    key: 'slot:600',
    ...opts,
  }
}

const block = (): TimelineBlock => ({ kind: 'normal', at: 600, slot: slotObj(), key: 'normal:600' })

const detailProps = {
  topBoard: 3,
  tags: TAGS,
  reasonByCode: new Map<string, string>(),
  themeInfo: THEME_INFO,
}

describe('groupSlotByTheme · 题材归组（纯函数）', () => {
  it('① 按题材归组，主轴取 `themes[0]`（⛔ 不重复出现在每个题材下）', () => {
    const { groups, unthemed } = groupSlotByTheme(slotObj(), TAGS, new Set(['医药']))
    const names = groups.map((g) => g.theme)
    expect(names, '应恰好 2 个题材组').toHaveLength(2)
    expect(names).toContain('医药')
    expect(names).toContain('机器人')
    expect(names, '⛔ CXO 是 a3 的次要题材，不得再成一组（会重复计数）').not.toContain('CXO')

    const med = groups.find((g) => g.theme === '医药')!
    expect(med.stocks.map((s) => s.code).sort()).toEqual(['a1', 'a2', 'a3'])
    expect(med.burst, '医药在本槽为爆发题材').toBe(true)

    // 无题材标记的票单独归集，⛔ 不丢
    expect(unthemed.map((s) => s.code)).toEqual(['c1'])
  })

  it('② 排序：**爆发题材优先**，即便家数更少', () => {
    // 机器人 2 只（不爆发） vs 医药 3 只（爆发）→ 医药第一
    const { groups } = groupSlotByTheme(slotObj(), TAGS, new Set(['医药']))
    expect(groups[0].theme).toBe('医药')
    // 都不爆发时按家数降序
    const none = groupSlotByTheme(slotObj(), TAGS, new Set())
    expect(none.groups[0].theme).toBe('医药')
  })

  it('③ 同 code + 同 fbt 的病态重复输入只归一次', () => {
    const s = slotObj({
      sectors: [group('化学制药', [a1, a1])],
      singles: [],
      events: null,
    })
    const { groups } = groupSlotByTheme(s, TAGS, new Set())
    expect(groups[0].stocks).toHaveLength(1)
  })
})

describe('BlockDetail · 详情走题材主轴，并保留盘中事实', () => {
  it('④ 渲染题材 + 该题材当刻个股 + 催化 + 当日全部成员', () => {
    const { container } = render(<BlockDetail block={block()} {...detailProps} />)
    const txt = container.textContent ?? ''
    expect(txt, '缺题材名').toContain('医药')
    expect(txt, '缺该题材个股').toContain('甲药')
    expect(txt, '缺该题材个股').toContain('丙药')
    expect(txt).toContain('当刻 3 只')
    expect(txt, '缺当日题材成员总数').toContain('当日 5 只')
    expect(txt, '缺催化原文').toContain('基药目录落地')
    expect(txt).toContain('龙 哈药股份')
    // 「与题材相关的大量个股」= 该题材当日**其余**涨停成员也要列出
    expect(txt, '缺该题材当日其余成员').toContain('当日其余涨停成员')
    expect(txt).toContain('丁药')
    expect(txt).toContain('戊药')
    // 本槽已有 3 只 → 不应在「其余成员」里重复
    const rest = txt.slice(txt.indexOf('当日其余涨停成员'))
    expect(rest, '⛔ 本槽已列出的票不得在其余成员里重复').not.toContain('甲药')
  })

  it('⑤ 盘中走强和风险事件在详情中完整展示，头部仍使用题材维度', () => {
    const { container } = render(<BlockDetail block={block()} {...detailProps} />)
    const txt = container.textContent ?? ''
    /**
     * ⚠️ 2026-10-22 用户：「Hover 弹窗里面简洁一点」—— 详情改扁平后，
     * 段标题去掉冗余尾字（「盘中走强与涨停变化」→「盘中走强」）。
     * ⛔ 数据一条不少，只是不再给每段套一张卡片；卡面（非 flat）仍用全称。
     */
    expect(txt, '盘中走强区缺失').toContain('盘中走强')
    expect(txt, '盘中走弱区缺失').toContain('盘中走弱')
    expect(txt, '盘中板块计数缺失').toContain('板块 1 个')
    expect(txt, '⛔ 头部 ↑N/↓N 应换成题材维度').not.toContain('↑')
    expect(txt, '⛔ 头部 ↑N/↓N 应换成题材维度').not.toContain('↓')
    expect(txt, '头部应显示题材数').toContain('题材 2')
  })

  it('⑥ 无题材标记的票不丢 —— 单独一段列出', () => {
    const { container } = render(<BlockDetail block={block()} {...detailProps} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('无题材标记 1 只')
    expect(txt).toContain('无题一')
  })
})

describe('卡面回归 · 240px 卡片仍走行业分组（⛔ 题材主轴只用于详情）', () => {
  it('⑦ 卡面仍保留「含题材」行业分组与盘中事件块', () => {
    const { container } = render(
      <TimelineSlotCard
        slot={slotObj()}
        topBoard={3}
        tags={TAGS}
        reasonByCode={new Map<string, string>()}
      />,
    )
    const txt = container.textContent ?? ''
    expect(txt, '卡面应保留行业分组（题材主轴仅详情用）').toContain('含题材')
    expect(txt, '卡面应保留盘中事件块').toContain('盘中走强与涨停变化')
  })
})

/**
 * ## 详情浮层「扁平 + 分隔线」契约（2026-10-22）
 *
 * 用户两条连续指令：
 *   ①「Hover 弹窗里面简洁一点，不要嵌套三张卡片了」
 *   ②「可以有分割线」
 *
 * 合起来的口径 = **拆框不拆线**：
 *   · ⛔ 内层不能再有独立卡片（圆角 + 边框 + 白底 + 阴影）；
 *   · ✅ 段与段之间必须有 hairline（只上边框、极淡），否则拆完就糊成一坨。
 *
 * ⛔ jsdom 不加载 Tailwind，`getComputedStyle` 读不到实际边框宽度 ——
 *    所以断言落在 **class 契约**（父级的选择器变体）与**DOM 结构**（不再有卡片壳）上。
 */
describe('BlockDetail · 扁平化与分隔线（拆框不拆线）', () => {
  const flat = () => {
    const { container } = render(<BlockDetail block={block()} {...detailProps} />)
    return container
  }

  it('① 内层不再有卡片壳：无 shadow-sm、无 bg-card 的嵌套块', () => {
    const c = flat()
    expect(
      c.querySelectorAll('[class*="shadow-sm"]').length,
      '⛔ 详情里不该再有卡片阴影（原来的槽白卡）',
    ).toBe(0)
    expect(
      c.querySelectorAll('[class*="bg-card"]').length,
      '⛔ 不该再有白底卡片（弹窗外框除外：它由 HoverDetail 提供，不在 BlockDetail 内）',
    ).toBe(0)
  })

  it('② 段与段之间必须有分隔线（父级 `[&>*+*]:border-t`）', () => {
    const c = flat()
    const slotWrap = c.querySelector('[class*="[&>*+*]:border-t"]')
    expect(slotWrap, '⛔ 槽内容器缺少顶层分隔线规则').toBeTruthy()
    expect(
      slotWrap!.className,
      '分隔线必须用 hairline（line-faint），不能用实线重色',
    ).toContain('border-line-faint')
  })

  it('③ 走强/走弱/消息三段之间各自带线（段内 `divider`）', () => {
    /**
     * ⛔ 必须给夹具补一条消息面事件：默认 `UP` 里只有 `sector_up`，
     *    `NewsSection` 根本不渲染 —— 那样「消息段落缺少分隔线」会**恒真失败**，
     *    测出来的不是缺线、是缺数据（本用例第一版就踩了）。
     */
    const newsSlot = slotObj({
      intradayUp: [
        ...UP,
        {
          at: '2026-10-22 10:00:01',
          kind: 'newsflash_new',
          name: '工信部发布机器人新政',
          title: '工信部发布机器人新政',
        },
      ] as unknown as IntradayTimelineEvent[],
    })
    const withNews: TimelineBlock = { kind: 'normal', at: 600, slot: newsSlot, key: 'normal:600' }
    const { container } = render(<BlockDetail block={withNews} {...detailProps} />)
    const sections = Array.from(container.querySelectorAll('[class*="border-t"]'))
    expect(
      sections.some((el) => (el.textContent ?? '').includes('盘中走弱')),
      '走弱段缺少分隔线',
    ).toBe(true)
    expect(
      sections.some((el) => (el.textContent ?? '').includes('消息面')),
      '消息面段缺少分隔线',
    ).toBe(true)
  })

  it('④ ⛔ 卡片流不受影响：卡面仍保留内层块（flat 只由 BlockDetail 传）', () => {
    const { container } = render(
      <TimelineSlotCard
        slot={slotObj()}
        topBoard={3}
        tags={TAGS}
        reasonByCode={new Map<string, string>()}
      />,
    )
    expect(
      container.querySelector('[class*="[&>*+*]:border-t"]'),
      '⛔ 卡片流不该被扁平化规则波及',
    ).toBeNull()
  })
})
