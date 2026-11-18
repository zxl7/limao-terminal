/**
 * 图表组件库 —— **零依赖 SVG/HTML 图表**，不引入任何图表框架。
 *
 * ## 为什么不装 ECharts / recharts
 *
 * 本项目的数据形态固定且有限（时序折线、正负柱、二维热力、多维雷达、单值弧表），
 * 每种都只需要「比例尺 + 路径」两步。引入通用图表库的代价是：
 *   · 体积（ECharts 全量 > 1MB，本库全部图表合计 < 20KB）
 *   · 语义错配（通用库的「success 绿 / danger 红」与 A 股「涨红跌绿」相反，
 *     逐处覆写反而更容易出错）
 *   · 不可控的默认值（自动 tooltip 格式化会把 null 显示成 0，正是本站最忌讳的）
 *
 * ## ⚠️ 所有图表共享的两条铁律
 *
 * 1. **`null` 是断点，不是 0**：折线断段、面积不涂、热力格标「无样本」。
 *    把缺失画成 0 会凭空造出「暴跌」「零成交」这类不存在的形态。
 * 2. **柱状图必须过零基线**：柱长即数量，跨零基线长度比例就失真。
 *    折线图相反 —— 不能过零，否则窄幅波动被压平、趋势消失。
 *
 * 数学内核见 `@/shared/lib` 的 chart.ts（纯函数、框架无关、有独立单测）。
 */

export { useChartWidth } from './useChartWidth'
export { Sparkline } from './Sparkline'
export { LineChart, maLine, type LineSeries, type RefLine, type ChartMarker } from './LineChart'
export { BarChart, type Bar } from './BarChart'
export { BarList, type BarListItem } from './BarList'
export { HeatMatrix, type HeatRow } from './HeatMatrix'
export { Radar, type RadarAxis } from './Radar'
export { Gauge } from './Gauge'

export { AXIS, plotBox, sampleTicks, toneSoftVar, toneVar, valueTone, type Tone } from './util'
