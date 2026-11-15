import { describe, expect, it } from 'vitest'
import { parseMainline } from '@/features/review/mainline'

const LINES = [
  "<text_tag color='red'>⭐ 最强</text_tag>　**影视与 AI 短剧**（8 只 · 全部首板 · 板块逆势 +4.39%）",
  '· **文投控股** 封 2.46 亿·成交 10.45 亿 ／ **凯撒文化** 1.50 亿 ／ **横店影视** 0.91 亿',
  '· 由头是 11-12 抖音短剧版权中心开放互动剧与互动影游合作',
  '⚠️ 8 只合计封单 6.56 亿、成交 64.8 亿，但没有一只连板。',
  "<text_tag color='blue'>🔹 次强</text_tag>　**机器人标签**（6 只 · 票在封、板块在跌）",
  '· **北纬科技** 3 板 封 1.78 亿占流通 4.96%·0 炸 ／ **中马传动** 0.53 亿',
  '**支线**　猪肉养殖 2 只（金新农·天邦食品）｜光伏储能 2 只（金辰股份 3 板·新能股份）',
]

describe('parseMainline', () => {
  it('切成三段并识别排名', () => {
    const blocks = parseMainline(LINES)
    expect(blocks.map((b) => b.rank)).toEqual(['最强', '次强', '支线'])
  })

  it('票名与明细分开，且保留顺序', () => {
    const [first] = parseMainline(LINES)
    expect(first.name).toBe('影视与 AI 短剧')
    expect(first.meta).toContain('8 只')
    expect(first.stocks.map((s) => s.name)).toEqual(['文投控股', '凯撒文化', '横店影视'])
    expect(first.stocks[0].detail).toContain('2.46 亿')
  })

  it('由头进 logic、⚠️ 进 risk，文字不改写', () => {
    const [first] = parseMainline(LINES)
    expect(first.logic[0]).toContain('由头是 11-12 抖音短剧')
    expect(first.risk[0]).toContain('没有一只连板')
  })

  it('识别不出结构时整体退化为 text，不丢内容', () => {
    const blocks = parseMainline(['今天市场很弱，没有主线。'])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text[0]).toContain('今天市场很弱')
  })
})
