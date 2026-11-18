import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { LineChart } from '@/shared/ui'

/**
 * 折线图极点标注（2026-11-18 借鉴外部情绪图）：
 * 「高潮 / 冰点」这类文字必须画在数据点旁，且**不能改动坐标**。
 */
describe('LineChart markers', () => {
  const labels = ['11-10', '11-11', '11-12', '11-13']
  const values = [9.2, 5.8, 1.6, 3.9]

  it('打印极点文字与日期', () => {
    const { getByText } = render(
      <LineChart
        labels={labels}
        series={[{ name: '情绪分', values, tone: 'up' }]}
        yMin={0}
        yMax={10}
        markers={[
          { index: 0, label: '高潮 11-10', tone: 'rec' },
          { index: 2, label: '冰点 11-12', tone: 'down', place: 'below' },
        ]}
      />,
    )
    expect(getByText('高潮 11-10')).toBeTruthy()
    expect(getByText('冰点 11-12')).toBeTruthy()
  })

  it('没有标注时不渲染任何 marker 文本', () => {
    const { container } = render(
      <LineChart labels={labels} series={[{ name: '情绪分', values, tone: 'up' }]} yMin={0} yMax={10} />,
    )
    expect(container.textContent).not.toContain('高潮')
  })
})
