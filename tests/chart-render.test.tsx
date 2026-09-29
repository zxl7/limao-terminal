/**
 * 图表组件渲染测试 —— 锁定「画出来了」与「画错了」的差别。
 *
 * ## 为什么数学内核有测试还不够
 *
 * `chart.test.ts` 验证的是比例尺与路径字符串；但组件层还有一层独立的出错空间：
 * 路径算对了却因为 props 串错、条件写反而没挂到 DOM 上。这类错误在浏览器里表现为
 * **一片空白**，而「空白」既可解读为「无数据」也可解读为「渲染失败」，
 * 人工排查时极难分辨。
 *
 * 因此本文件的核心断言是**形状层面的**：
 *   · 有数据 → 必须真的存在带 `M`/`L` 指令的 `<path>`
 *   · 中间有 null → 必须是**两段** path（断线规则）
 *   · 含负值 → 必须同时存在零线上下两侧的 `<rect>`
 *   · 全 null → 必须是明确的空态文案，而不是静默空白
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BarChart, BarList, Gauge, HeatMatrix, LineChart, Radar, Sparkline } from '@/shared/ui'

/** 取所有非空 path 的 d 值 */
function pathDs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('path')]
    .map((p) => p.getAttribute('d') ?? '')
    .filter((d) => d.length > 0)
}

describe('LineChart —— 有数据必须画出线，null 必须断线', () => {
  it('连续序列产生带 M/L 指令的路径', () => {
    const { container } = render(
      <LineChart labels={['1', '2', '3', '4']} series={[{ name: 's', values: [1, 3, 2, 5] }]} />,
    )
    const ds = pathDs(container)
    const line = ds.find((d) => d.includes('M') && d.includes('L'))
    expect(line).toBeTruthy()
    // 归一化后坐标必须落在画布内，而不是 NaN
    expect(line).not.toContain('NaN')
  })

  it('中间有 null → 断成两段路径（不跨越无数据区间连线）', () => {
    const { container } = render(
      <LineChart
        labels={['1', '2', '3', '4']}
        series={[{ name: 's', values: [1, 3, null, 5] }]}
      />,
    )
    // 主序列只有一个，但应产出两段（[1,3] 与 [5]）—— 注意第二段只有单点仍是有效 M
    const ds = pathDs(container).filter((d) => d.includes('M'))
    // 网格线是 <line>，不落进 path；参考线同理。故 path 只来自序列（+面积）
    expect(ds.length).toBe(2)
  })

  it('全 null → 明确空态文案，不静默留白', () => {
    render(<LineChart labels={['1', '2']} series={[{ name: 's', values: [null, null] }]} />)
    expect(screen.getByText('无可用序列数据')).toBeInTheDocument()
  })

  it('悬浮读数默认不显示（避免与静态截图混淆）', () => {
    const { container } = render(
      <LineChart labels={['1', '2']} series={[{ name: 's', values: [1, 2] }]} />,
    )
    // 未交互时不应有十字准线（stroke 宽度 1 且贯穿绘图区的 line）
    expect(container.querySelectorAll('svg').length).toBe(1)
  })
})

/** 只取「数据柱」矩形 —— 排除悬浮热区（fill=transparent） */
function dataRects(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('rect')].filter(
    (r) => r.getAttribute('fill') !== 'transparent',
  )
}

describe('BarChart —— 零基线与正负双向', () => {
  it('全正序列：柱子都在零线之上（y 值小于画布高）', () => {
    const { container } = render(<BarChart bars={[{ label: 'a', value: 5 }, { label: 'b', value: 9 }]} />)
    const rects = dataRects(container)
    expect(rects.length).toBe(2)
    for (const r of rects) {
      expect(Number(r.getAttribute('height'))).toBeGreaterThan(0)
    }
  })

  it('含负值 → 自动切双向：零线上下都必须有柱子', () => {
    const { container } = render(
      <BarChart bars={[{ label: 'in', value: 8 }, { label: 'out', value: -6 }]} />,
    )
    const rects = dataRects(container)
    expect(rects.length).toBe(2)
    const ys = rects.map((r) => Number(r.getAttribute('y')))
    // 两根柱的顶端 y 明显不同 → 一个向上一个向下
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(5)
  })

  it('null 值画虚线短横而非 0 高柱（「无样本」≠「值为 0」）', () => {
    const { container } = render(<BarChart bars={[{ label: 'a', value: null }, { label: 'b', value: 4 }]} />)
    const dashed = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-dasharray') === '3 2',
    )
    expect(dashed.length).toBe(1)
  })

  it('对比柱同时渲染主柱与空心对比柱', () => {
    const { container } = render(
      <BarChart bars={[{ label: 'a', value: 9, compare: 5, compareLabel: '昨日' }]} showValue />,
    )
    expect(dataRects(container).length).toBe(2)
  })

  it('全 null → 空态文案', () => {
    render(<BarChart bars={[{ label: 'a', value: null }]} />)
    expect(screen.getByText('无可用柱状数据')).toBeInTheDocument()
  })
})

describe('Sparkline —— 全 null 画虚线基线，不画实线', () => {
  it('有数据 → 存在折线路径', () => {
    const { container } = render(<Sparkline points={[1, 4, 2, 6]} />)
    expect(pathDs(container).some((d) => d.includes('M'))).toBe(true)
  })

  it('全 null → 只有虚线基线，没有任何折线路径', () => {
    const { container } = render(<Sparkline points={[null, null]} />)
    expect(container.querySelectorAll('path').length).toBe(0)
    const dashed = container.querySelector('line[stroke-dasharray]')
    expect(dashed).toBeTruthy()
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('无数据')
  })

  it('单点序列不报错（域退化时不能出 NaN 坐标）', () => {
    const { container } = render(<Sparkline points={[7]} />)
    for (const d of pathDs(container)) expect(d).not.toContain('NaN')
  })
})

describe('BarList —— 缺失值显式标注「无样本」', () => {
  it('渲染标签与数值', () => {
    render(<BarList items={[{ label: '半导体' }, { label: 'PCB' }].map((x, i) => ({ ...x, value: i ? -3 : 7 }))} format={(v) => String(v)} />)
    expect(screen.getByText('半导体')).toBeInTheDocument()
    expect(screen.getByText('PCB')).toBeInTheDocument()
  })

  it('null 值不得显示为 0，而要标「无样本」', () => {
    render(<BarList items={[{ label: 'X', value: null }]} format={(v) => String(v ?? '—')} />)
    expect(screen.getByText('无样本')).toBeInTheDocument()
  })

  it('空列表给空态文案', () => {
    render(<BarList items={[]} format={(v) => String(v)} />)
    expect(screen.getByText('无数据')).toBeInTheDocument()
  })
})

describe('HeatMatrix —— 三态区分（null / 0 / 有值）', () => {
  it('null 格不着色且不显示数字，0 格显示 0', () => {
    const { container } = render(
      <HeatMatrix rows={[{ label: '题材A', values: [null, 0, 5] }]} cols={['09-10', '09-11', '09-12']} />,
    )
    expect(container.textContent).toContain('0')
    expect(container.textContent).toContain('5')
    // ⚠️ 只数**数据格**（数据格带 aria-label，图例色块没有），
    //    否则会把色阶图例里那个斜纹样本一起数进来
    const nullCells = [...container.querySelectorAll('span[aria-label]')].filter((s) =>
      (s.getAttribute('aria-label') ?? '').endsWith('无样本'),
    )
    expect(nullCells.length).toBe(1)
    // 该格必须无数字文本
    expect(nullCells[0].textContent).toBe('')
  })

  it('空矩阵给空态文案', () => {
    render(<HeatMatrix rows={[]} cols={[]} />)
    expect(screen.getByText('无矩阵数据')).toBeInTheDocument()
  })

  it('signed 模式按正负值使用红绿双向色阶', () => {
    const { container } = render(
      <HeatMatrix rows={[{ label: '资金', values: [5, -5] }]} cols={['流入', '流出']} signed />,
    )
    const cells = [...container.querySelectorAll<HTMLElement>('span[aria-label]')]
    expect(cells[0].style.background).toContain('var(--color-up)')
    expect(cells[1].style.background).toContain('var(--color-down)')
    expect(container.textContent).toContain('净流入')
    expect(container.textContent).toContain('净流出')
  })
})

describe('Radar —— 维度不足时退回文字，不强行画', () => {
  it('少于 3 个维度不画多边形', () => {
    const { container } = render(<Radar axes={[{ label: '时效', value: 3, max: 5 }]} />)
    expect(container.querySelectorAll('polygon').length).toBe(0)
    expect(container.textContent).toContain('时效')
  })

  it('四维正常渲染蛛网与数据面', () => {
    const { container } = render(
      <Radar
        axes={[
          { label: '时效', value: 4, max: 5 },
          { label: '封板硬度', value: 3, max: 5 },
          { label: '连板领先', value: 5, max: 5 },
          { label: '带动', value: 2, max: 5 },
        ]}
      />,
    )
    // 4 个同心环 + 1 个数据面
    expect(container.querySelectorAll('polygon').length).toBe(5)
  })
})

describe('Gauge —— null 不得显示为 0', () => {
  it('null 显示「—」，且不画数值弧', () => {
    const { container } = render(<Gauge value={null} max={10} />)
    expect(container.textContent).toContain('—')
    // 只有底弧一条路径
    expect(container.querySelectorAll('path').length).toBe(1)
  })

  it('有值时按分档取色', () => {
    const { container } = render(
      <Gauge
        value={8}
        max={10}
        bands={[
          { min: 0, tone: 'down', name: '退潮' },
          { min: 7, tone: 'up', name: '偏强' },
        ]}
      />,
    )
    expect(container.textContent).toContain('8')
    expect(container.textContent).toContain('偏强')
    // 底弧 + 数值弧
    expect(container.querySelectorAll('path').length).toBe(2)
  })
})

/**
 * PC 端尺寸不变量 —— 「宽度跟容器、高度恒定」。
 *
 * ## 为什么需要这条锁
 *
 * 这不是审美问题，是**功能性**问题。原写法 `className="w-full h-auto"` 会让
 * SVG 按 `viewBox` 等比放大：`720 × 200` 的折线图放进 1500px 宽的卡片后，
 * 高度被同比例拉到约 **417px**，图内字号同步 10px → 21px。
 * 一页三张图 ≈ 1200px 滚动，用户要看的表格被挤出首屏。
 *
 * 症状在窄屏上完全不可见，因此人工评审很难拦住 —— 必须靠断言。
 * 两个充要条件：
 *   · `preserveAspectRatio="none"`  —— 解除等比约束，宽高解耦
 *   · 显式 CSS `height`             —— 渲染高度 = 设计高度，与容器宽度无关
 *
 * ⚠️ jsdom 会把 CSS 选择器里的属性名小写化（`svg[preserveAspectRatio="none"]`
 *    恒不命中），故一律走 `getAttribute` 而非选择器。
 */
describe('PC 尺寸不变量 —— 禁「等比放大」', () => {
  /** 断言该 svg 满足「宽跟容器、高恒定」两个充要条件 */
  function expectContainerAdaptive(svg: SVGSVGElement, who: string) {
    expect(
      svg.getAttribute('preserveAspectRatio'),
      `${who} 缺 preserveAspectRatio="none"：会按 viewBox 等比放大，宽屏下高度失控`,
    ).toBe('none')

    const h = svg.style.height || svg.getAttribute('style') || ''
    expect(h, `${who} 未设置显式高度：渲染高度将随容器宽度漂移`).toMatch(/\d+(\.\d+)?px/)
  }

  it('LineChart 宽跟容器、高恒定', () => {
    const { container } = render(
      <LineChart labels={['1', '2', '3']} series={[{ name: 's', values: [1, 2, 3] }]} />,
    )
    const svg = container.querySelector('svg')
    expect(svg, '未渲染 svg').toBeTruthy()
    expectContainerAdaptive(svg!, 'LineChart')
  })

  it('BarChart 宽跟容器、高恒定', () => {
    const { container } = render(
      <BarChart bars={[{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }]} />,
    )
    const svg = container.querySelector('svg')
    expect(svg, '未渲染 svg').toBeTruthy()
    expectContainerAdaptive(svg!, 'BarChart')
  })
})
