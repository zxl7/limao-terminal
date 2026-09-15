/**
 * 图表数学内核测试。
 *
 * ## 为什么这层必须单测
 *
 * 图表算错**不会报警** —— 只会画出一条看起来很正常、但含义完全错误的线。
 * 本项目已经踩过同类的坑（区间数组被静默拼成 "02"）。这里锁定三类最危险的
 * 静默错值：
 *
 *   1. **null 被当成 0** → 折线垂直砸到基线再弹回，凭空造出一个「暴跌」形态
 *   2. **柱状图缺零基线** → 柱子长度比例失真（3:5 看起来像 1:5）
 *   3. **刻度不是 nice 值** → 轴端点是 13.7 / 31.4 这类读数，无法快速估量级
 */

import { describe, expect, it } from 'vitest'
import {
  areaSegments,
  axisLabel,
  bipolarScale,
  directions,
  drawdownSeries,
  evenAngles,
  extentOf,
  extentOfMany,
  isNum,
  lineSegments,
  maxDrawdownOf,
  movingAverage,
  niceScale,
  polygonPoints,
  polar,
  round2,
  scaleLinear,
  withZero,
} from '@/shared/lib'

describe('isNum —— null 不是 0', () => {
  it('只认真正的有限数值', () => {
    expect(isNum(0)).toBe(true)
    expect(isNum(-1.5)).toBe(true)
    expect(isNum(null)).toBe(false)
    expect(isNum(undefined)).toBe(false)
    expect(isNum(Number.NaN)).toBe(false)
  })
})

describe('extentOf —— 忽略 null 取极值', () => {
  it('null 不参与极值计算（不能被当 0 拉低下限）', () => {
    // 若把 null 当 0，下限会变成 0；正确结果是 5
    expect(extentOf([null, 5, 9])).toEqual([5, 9])
    expect(extentOf([null, -3, null])).toEqual([-3, -3])
  })

  it('全 null → null（调用方渲染空态，而不是画 [0,0] 的假线）', () => {
    expect(extentOf([null, null])).toBeNull()
    expect(extentOf([])).toBeNull()
  })

  it('真实的 0 参与计算', () => {
    expect(extentOf([0, 8])).toEqual([0, 8])
  })

  it('多序列联合极值用于共用 Y 轴', () => {
    expect(extentOfMany([[1, 2], [null, 9]])).toEqual([1, 9])
    expect(extentOfMany([[], []])).toBeNull()
  })
})

describe('niceScale —— 刻度落在 1/2/2.5/5×10ⁿ', () => {
  it('把 [13,47] 收敛成整十刻度（不从 0 起 —— 折线图要放大波动而非压平）', () => {
    const s = niceScale(13, 47, 5)
    // ⚠️ 起点是 10 而不是 0 是**预期行为**：折线图靠形状表达变化，
    //    强行把轴拉到 0 会把 [13,47] 的差异压成一小段，反而看不清趋势。
    //    柱状图才需要零基线（见 withZero）。
    expect(s.min).toBe(10)
    expect(s.max).toBe(50)
    expect(s.ticks).toEqual([10, 20, 30, 40, 50])
    for (const t of s.ticks) expect(t % 10).toBe(0)
  })

  it('浮点步长不产生 4.999999999 这类脏刻度', () => {
    const s = niceScale(0, 0.5, 5)
    for (const t of s.ticks) {
      expect(String(t)).not.toMatch(/9999|0001/)
    }
    expect(s.ticks).toContain(0.5)
  })

  it('全平序列上下撑开，避免线贴死在轴线上', () => {
    const s = niceScale(8, 8, 4)
    expect(s.min).toBeLessThan(8)
    expect(s.max).toBeGreaterThan(8)
  })

  it('非有限输入退化为安全默认值（不产生 NaN 坐标）', () => {
    const s = niceScale(Number.NaN, Number.POSITIVE_INFINITY, 4)
    expect(Number.isFinite(s.min)).toBe(true)
    expect(Number.isFinite(s.max)).toBe(true)
  })
})

describe('withZero —— 柱状图零基线', () => {
  it('把 [3,5] 撑到 [0,5]，使柱长比例可比', () => {
    expect(withZero([3, 5])).toEqual([0, 5])
  })

  it('全负区间撑到 0 封顶', () => {
    expect(withZero([-9, -2])).toEqual([-9, 0])
  })

  it('已含 0 的区间不变', () => {
    expect(withZero([-4, 6])).toEqual([-4, 6])
  })
})

describe('bipolarScale —— 双向轴 0 必须在刻度上', () => {
  it('0 落在刻度上时直接可用', () => {
    const s = bipolarScale([-10, 20], 4)
    expect(s.ticks).toContain(0)
  })

  it('0 不在刻度上时补进去（否则无法判断柱子正负）', () => {
    const s = bipolarScale([-7, 23], 4)
    expect(s.ticks).toContain(0)
    // 刻度必须严格升序，且不重复
    for (let i = 1; i < s.ticks.length; i++) {
      expect(s.ticks[i]).toBeGreaterThan(s.ticks[i - 1])
    }
  })
})

describe('scaleLinear —— 线性映射', () => {
  it('把数据域端点映射到像素域端点', () => {
    const sx = scaleLinear([0, 10], [0, 100])
    expect(sx(0)).toBe(0)
    expect(sx(10)).toBe(100)
    expect(sx(5)).toBe(50)
  })

  it('Y 轴用反向 range 实现「值大在上」', () => {
    const sy = scaleLinear([0, 10], [200, 0])
    expect(sy(0)).toBe(200)
    expect(sy(10)).toBe(0)
  })

  it('域退化成一个点时不除零（返回中点而非 Infinity）', () => {
    const s = scaleLinear([5, 5], [0, 100])
    expect(s(5)).toBe(50)
    expect(Number.isFinite(s(5))).toBe(true)
  })
})

describe('lineSegments —— null 断线（本项目最关键的一条）', () => {
  const at = (i: number, v: number) => [i * 10, 100 - v] as const

  it('连续序列生成单段路径', () => {
    expect(lineSegments([1, 2, 3], at)).toEqual(['M0,99 L10,98 L20,97'])
  })

  it('null 处切断，不补 0、不跨段连线', () => {
    // 若把 null 当 0，会得到一段穿过 y=100（基线）的假暴跌
    const segs = lineSegments([1, null, 3], at)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toBe('M0,99')
    expect(segs[1]).toBe('M20,97')
    // 任何一段都不得包含代表 0 的 y=100
    expect(segs.join(' ')).not.toContain(',100')
  })

  it('首尾 null 不产生空段', () => {
    expect(lineSegments([null, null], at)).toEqual([])
    expect(lineSegments([null, 5, null], at)).toEqual(['M10,95'])
  })

  it('NaN 与 undefined 同样视为断点', () => {
    expect(lineSegments([1, Number.NaN, 3], at)).toHaveLength(2)
    expect(lineSegments([1, undefined, 3], at)).toHaveLength(2)
  })
})

describe('areaSegments —— 面积填充同样断线', () => {
  const at = (i: number, v: number) => [i * 10, 100 - v] as const

  it('每段独立闭合到基线，不跨越无数据区间涂色', () => {
    const segs = areaSegments([1, 2, null, 3, 4], at, 100)
    expect(segs).toHaveLength(2)
    // 每段都以基线起、以基线终（`Z` 闭合）
    for (const d of segs) {
      expect(d.startsWith('M')).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
    }
    // 两段必须各自闭合 —— 若连成一片，说明跨过了 null 把无数据区间也涂了色
    expect(segs[0]).not.toBe(segs[1])
  })

  it('孤立单点不生成面积（一个点构不成面）', () => {
    // [1, null, 3] 两段各只有一个点 → 两段都不渲染，结果为空
    expect(areaSegments([1, null, 3], at, 100)).toEqual([])
  })

  it('单点段不生成面积（无法构成面）', () => {
    expect(areaSegments([5], at, 100)).toEqual([])
  })
})

describe('movingAverage —— MA 拐点基础', () => {
  it('窗口内任一点缺失即返回 null，不做「有几个算几个」的降级', () => {
    // 用 4、6 两值冒充 3 日均值会得到 5，使拐点提前出现 —— 必须拒绝
    const ma = movingAverage([4, null, 6], 2)
    expect(ma[0]).toBeNull()
    expect(ma[1]).toBeNull()
    expect(ma[2]).toBeNull()
  })

  it('正常窗口求均值，前 window-1 项无值', () => {
    const ma = movingAverage([1, 2, 3, 4], 3)
    expect(ma[0]).toBeNull()
    expect(ma[1]).toBeNull()
    expect(ma[2]).toBeCloseTo(2)
    expect(ma[3]).toBeCloseTo(3)
  })

  it('window<=0 退化为本身（仅净化 null）', () => {
    expect(movingAverage([1, null, 3], 0)).toEqual([1, null, 3])
  })
})

describe('directions —— 方向层拐点', () => {
  it('识别上行/下行/持平', () => {
    expect(directions([1, 2, 2, 1])).toEqual([null, 1, 0, -1])
  })

  it('null 处不产生方向信号（无数据≠方向改变）', () => {
    const dirs = directions([1, null, 3])
    expect(dirs[1]).toBeNull()
    // 跨过 null 仍能与上一个有效值比较
    expect(dirs[2]).toBe(1)
  })
})

describe('polar / evenAngles / polygonPoints —— 雷达图底座', () => {
  it('0° 指向 12 点方向', () => {
    const [x, y] = polar(100, 100, 50, 0)
    expect(x).toBeCloseTo(100)
    expect(y).toBeCloseTo(50)
  })

  it('90° 指向 3 点方向', () => {
    const [x, y] = polar(100, 100, 50, 90)
    expect(x).toBeCloseTo(150)
    expect(y).toBeCloseTo(100)
  })

  it('N 个指标等分 360°', () => {
    expect(evenAngles(4)).toEqual([0, 90, 180, 270])
    expect(evenAngles(0)).toEqual([])
  })

  it('多边形点串按归一化值缩放', () => {
    const pts = polygonPoints([10, 0, 10, 0], 10, 100, 100, 50)
    expect(pts.split(' ')).toHaveLength(4)
  })

  it('超出上限的值被钳制到满半径，不外扩出画布', () => {
    // 超限值与「恰好等于上限」必须落在同一点 —— 否则爆表的指标会把图形撑破
    expect(polygonPoints([15], 10, 100, 100, 50)).toBe(polygonPoints([10], 10, 100, 100, 50))
    // 负值钳到圆心（不失真为反向）
    expect(polygonPoints([-5], 10, 100, 100, 50)).toBe(polygonPoints([0], 10, 100, 100, 50))
  })
})

describe('axisLabel —— 大数降位可读', () => {
  it('亿 / 万 自动降级（资金流动辄 9 位数）', () => {
    expect(axisLabel(382685064)).toBe('3.8亿')
    expect(axisLabel(-382685064)).toBe('-3.8亿')
    expect(axisLabel(25000)).toBe('2.5万')
  })

  it('小数不产生多余尾零', () => {
    expect(axisLabel(0.5)).toBe('0.5')
    expect(axisLabel(0)).toBe('0')
  })
})

describe('round2 —— 路径体积控制', () => {
  it('砍到 2 位小数', () => {
    expect(round2(1.23456789)).toBe(1.23)
    expect(round2(-1.23456789)).toBe(-1.23)
  })

  it('不产出 -0（Object.is(-0,0) 为 false，会静默走偏下游判零分支）', () => {
    const r = round2(-0.001)
    expect(Object.is(r, -0)).toBe(false)
    expect(r).toBe(0)
  })
})

describe('drawdownSeries —— 前向峰值回撤（距历史最高）', () => {
  it('首点为峰值自身，回撤恒为 0', () => {
    const dd = drawdownSeries([1.0, 0.9, 1.1])
    expect(dd[0]).toBe(0)
  })

  it('峰值只升不降 —— 创新高后回撤从 0 重新起算（而非从上一峰）', () => {
    // 1.0 → 1.2（+20%，回撤 0）→ 1.02（距 1.2 为 -15%）
    const dd = drawdownSeries([1.0, 1.2, 1.02])
    expect(dd[0]).toBe(0)
    expect(dd[1]).toBe(0)
    expect(dd[2]).toBeCloseTo(-0.15, 6)
  })

  it('未创新高时沿用旧峰值，不因中间反弹而重置', () => {
    // 峰 1.5 之后 1.2 → 1.35 → 1.05，峰值始终是 1.5
    const dd = drawdownSeries([1.0, 1.5, 1.2, 1.35, 1.05])
    expect(dd[2]).toBeCloseTo(1.2 / 1.5 - 1, 6)
    expect(dd[3]).toBeCloseTo(1.35 / 1.5 - 1, 6)
    expect(dd[4]).toBeCloseTo(1.05 / 1.5 - 1, 6)
  })

  it('null 原样透传（缺失点不参与峰值累积，也不产生断点外的伪造值）', () => {
    const dd = drawdownSeries([1.0, null, 1.1, null])
    expect(dd).toEqual([0, null, 0, null])
  })

  it('峰值 ≤ 0 时返回 null 而非 NaN —— 非法净值必须走断线', () => {
    // 首个有效点即为峰值：净值 0 → 自身回撤 0，其后 0.5 也距峰值 0
    expect(drawdownSeries([0, 0.5])).toEqual([null, 0])
    // 全程为负 = 全程非法，没有任何点能算出有意义的回撤
    expect(drawdownSeries([-1, -0.5])).toEqual([null, null])
    // 任一返回点都不得是 NaN（NaN 会污染 path 使整条线消失）
    expect(drawdownSeries([0, 0.5, -1, 1]).every((v) => v == null || Number.isFinite(v))).toBe(true)
  })

  it('输出与入参等长（图层与 X 轴严格对齐）', () => {
    const v = [1.0, 0.98, 1.05, 0.97, null, 1.1]
    expect(drawdownSeries(v)).toHaveLength(v.length)
  })
})

describe('maxDrawdownOf —— 单值最大回撤', () => {
  it('取回撤序列最小值', () => {
    expect(maxDrawdownOf([1.0, 1.2, 0.9])).toBeCloseTo(0.9 / 1.2 - 1, 6)
  })

  it('单调上行 → 回撤 0', () => {
    expect(maxDrawdownOf([1.0, 1.1, 1.2, 1.3])).toBe(0)
  })

  it('无有效样本返回 null（不是 0）—— 0 会被读成「完美无回撤」', () => {
    expect(maxDrawdownOf([])).toBeNull()
    expect(maxDrawdownOf([null, null])).toBeNull()
  })

  it('与 drawdownSeries 口径一致（同源，不得各算一套）', () => {
    const v = [1.0, 1.4, 1.1, 1.25, 0.95, 1.3]
    const dd = drawdownSeries(v).filter((x): x is number => x != null)
    expect(maxDrawdownOf(v)).toBe(Math.min(...dd))
  })
})
