import { describe, expect, it } from 'vitest'
import { parseEvolution, parseOutlook, splitItems, splitSections } from '@/features/review/sections'

const EVO = [
  '**昨日核心 · 今日命运**',
  '昨天 11 只连板，今天活下来 3 只（27.3%）。',
  '**今日核心**　**天普股份(605255) 4 板**［汽车管路］　生命周期：加速段，但封单最虚',
  '**走到哪步**　封 0.23 亿、占流通 **0.23%**、炸 2 次。',
  '**明日推演**',
  '· **天普 4 进 5 就看封单补不补**　0.23 亿要补到 1 亿以上才算锁住',
  '· **质量最好的接棒人是北纬科技**　3 板、封 1.78 亿',
]

const OUT = [
  '**看点**',
  '① **影视 8 个首板明天出几个 2 板**　出 3 只以上这条线才算真起来',
  '② **天普 4 板封单补不补**　补到 1 亿以上撑得住',
  '**修好需要什么（今天离得多远）**　晋级率回 **20.6%**（今 18.9）',
  '**明日确认点**　新方向能不能走出高度｜板块大票能不能连板',
  '**风险**　今天最容易读错的一句是「涨停 37 只没掉」。',
  '**延续观察**',
  '① 涨停股成交 225.1 亿，占全市场 **1.36%**。',
  '**🧘 心法**',
  '1.8 分和昨天的 1.6 几乎一样。',
]

describe('splitSections', () => {
  it('按独占加粗行分段', () => {
    const s = splitSections(EVO)
    expect(s.map((x) => x.heading)).toEqual([
      '昨日核心 · 今日命运', '今日核心', '走到哪步', '明日推演',
    ])
  })
})

describe('splitItems', () => {
  it('识别 ① 编号与 · 条目', () => {
    const items = splitItems(['① **甲**　说明一', '· **乙**　说明二'])
    expect(items.map((x) => x.no)).toEqual(['①', '·'])
    expect(items[0].title).toBe('甲')
    expect(items[0].body).toBe('说明一')
  })
})

describe('parseEvolution', () => {
  it('拆出四段并把「明日推演」变成条目', () => {
    const r = parseEvolution(EVO)
    expect(r.sections).toHaveLength(3)
    expect(r.outlook).toHaveLength(2)
    expect(r.outlook[0].title).toContain('天普 4 进 5')
  })
})

describe('parseOutlook', () => {
  it('看点/延续观察是条目，修好/确认/风险/心法是段落', () => {
    const r = parseOutlook(OUT)
    expect(r.points).toHaveLength(2)
    expect(r.follow).toHaveLength(1)
    expect(r.repair?.heading).toContain('修好')
    expect(r.confirm?.heading).toContain('确认点')
    expect(r.risk?.heading).toContain('风险')
    expect(r.mantra?.heading).toContain('心法')
  })

  it('正文里的加粗与数字原样保留', () => {
    const r = parseOutlook(OUT)
    expect(r.repair?.lines[0]).toContain('20.6%')
  })
})
