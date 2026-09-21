import { EbbBanner, ExtremeCard, FeedbackCard, LadderCard, LeadersCard, SectorFlowCard, SignalsCard, ThemeTopCard, marketQueries } from '@/features/market'
import { IntradayMoodCard } from '@/features/analytics'
import { Zone, ZoneRow } from '@/shared/ui'
import { queryClient } from '@/shared/api'

export async function loader() {
  await queryClient.ensureQueryData(marketQueries.latest())
  return null
}

/**
 * 盘中实时 —— 全站唯一「所有数据都是 intraday 节拍」的页面。
 *
 * ## 版面：左 60% / 右 40% 两栏（用户 2026-09-21 定稿）
 *
 * ```
 * ┌─────────────── 左 60% ───────────────┬──────── 右 40% ────────┐
 * │ 📈 盘中情绪走势 ｜ 🔥 题材强度        │ 📊 昨日涨停反馈        │
 * │ ────────────────┼──────────────────  │ 🪜 连板天梯            │
 * │ 核心标的        ｜ 💰 板块资金与弱势   │ 🧊 极值名单            │
 * │                                   │ ⚡ 短线精灵            │
 * └───────────────────────────────────┴───────────────────────┘
 * ```
 *
 * · **左栏 4 张 = 2×2 均分**（`grid xl:grid-cols-2`）—— 都是「当刻盘面与标的」，需要宽度
 *   （情绪曲线、题材表、核心标的表、资金条）→ 每张约占页面 30% 宽；
 * · **右栏 4 张 = 纵向堆叠** —— 昨日涨停反馈 / 连板天梯 / 极值名单 / 短线精灵（2026-09-21 调定）；
 * · `<xl` 退化为单栏（`flex-col`）—— 窄屏强塞两栏会把表格挤成两行。
 *
 * ⚠️ 左栏内部**不能用 `Board`** —— 它按**视口**断点给列数（≥1920 直接 4 列），
 *    放进 60% 宽的栏里会得到 4 张 ~270px 的窄卡（表格必挤）。栏内均分用显式 2 列网格。
 */
export function Component() {
  return (
    <div className="flex flex-col gap-3">
      {/* 退潮预警通栏 —— 层级高于所有卡片（有预警才渲染，无预警不占位）。
          其余情绪维度（情绪分 / 三大指数 / 涨停·跌停·炸板·封板率 / 最高板 /
          涨跌家数 / 成交额）已全部上移到全局顶栏 header，本页不重复渲染。 */}
      <EbbBanner />

      {/* ⛔ 不要在这里加裸 `flex-col`：Tailwind v4 产物里它与 `xl:flex-row` 同层同权、
          且排在后者之后 ⇒ 所有宽度都会变竖排（2026-09-21 实测事故：两栏上下堆叠）。
          `ZoneRow` 已内置 `max-xl:flex-col`（媒体查询互斥，安全）。 */}
      <ZoneRow className="intraday-zones">
        <Zone label="盘面与标的" dot="bg-up" className="xl:w-[60%]">
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            <IntradayMoodCard />
            <ThemeTopCard />
            <LeadersCard />
            <SectorFlowCard />
          </div>
        </Zone>

        <Zone label="反馈与信号" dot="bg-down" className="xl:w-[40%]">
          <FeedbackCard />
          <LadderCard />
          <ExtremeCard />
          <SignalsCard />
        </Zone>
      </ZoneRow>
    </div>
  )
}
