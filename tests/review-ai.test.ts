import { describe, expect, it } from 'vitest'
import { parseAi, splitLabel } from '@/features/review/ai'

const LINES = [
  '**盘面状态**　权重护指数、老票集体清算\n**判断**　1.8 分不是「还在退潮」，是「清算到底」',
  '**第一个事实 · 分数没动，两头走反**　涨停 37 对 37 持平，情绪 1.6→1.8。',
  '**第二个事实 · 跌停池里全是一个月前的主角**　33 只跌停里 26 只是 11 月涨停过的票。',
  "<text_tag color='green'>风险 A</text_tag>　**跌停 33 只，26 只是这个月涨停过的票。** 大东方今天封在跌停板。",
  "<text_tag color='green'>风险 B</text_tag>　**影视这条线 8 只全是首板、零连板。** 同一个形状。",
  '**是不是换了主线**　<text_tag color=\'orange\'>换了，但只换了钱的去处</text_tag>　新方向有了，旧高度断了。',
]

describe('parseAi', () => {
  it('拆出盘面状态与判断', () => {
    const r = parseAi(LINES)
    expect(r.status).toContain('权重护指数')
    expect(r.verdict).toContain('清算到底')
  })

  it('事实按前缀切条，标题与正文分离', () => {
    const { facts } = parseAi(LINES)
    expect(facts).toHaveLength(2)
    expect(facts[0].tag).toBe('第一个事实')
    expect(facts[0].title).toBe('分数没动，两头走反')
    expect(facts[0].body).toContain('37 对 37')
  })

  it('风险按字母编号切条', () => {
    const { risks } = parseAi(LINES)
    expect(risks.map((x) => x.tag)).toEqual(['风险 A', '风险 B'])
    expect(risks[0].body).toContain('大东方')
  })

  it('结论保留原标题与正文', () => {
    const { conclusion } = parseAi(LINES)
    expect(conclusion?.title).toContain('换了主线')
    expect(conclusion?.body).toContain('新方向有了')
  })

  it('无结构的行不丢', () => {
    expect(splitLabel('随便一句').body).toBe('随便一句')
  })
})
