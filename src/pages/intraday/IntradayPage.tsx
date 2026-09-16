import { AmbushCard, EbbBanner, ExpectCard, ExtremeCard, FeedbackCard, LadderCard, LeadersCard, SectorDeltaCard, SectorFlowCard, SignalsCard, ThemeTopCard, marketQueries } from "@/features/market"
import { Zone, ZoneRow } from "@/shared/ui"
import { queryClient } from "@/shared/api"

/**
 * 路由 loader —— 导航完成前确保首屏关键数据在手。
 *
 * `ensureQueryData` 在缓存新鲜时同步返回，所以二次进入本页是零等待。
 */
export async function loader() {
  await queryClient.ensureQueryData(marketQueries.latest())
  return null
}

/**
 * 盘中实时 —— 全站的**指挥页**，也是唯一一个「所有数据都是 intraday 节拍」的页面。
 *
 * ## 布局：任务导向三栏（PC 数据工作台），不再等权铺卡
 *
 * 旧版用 `Board` 等权网格：长短卡混排，短卡下方留白，且所有卡片等权，没有
 * 「这块内容比那块重要」的引导，缩放后呈现「移动端放大」的观感。
 * 现在按交易决策顺序分三栏（`<xl` 退化为单栏纵向，避免窄屏强塞三栏）：
 *
 *   ┌ 机会区 23% ┬ 主工作区 1fr ┬ 风险辅助区 27% ┐
 *   │ 早鸟埋伏    │ 核心标的宽表   │ 昨日反馈       │
 *   │ 主线热度    │ 板块资金流向   │ 连板天梯       │
 *   │            │ 短线精灵信号   │ 极值名单       │
 *   └────────────┴──────────────┴────────────────┘
 *
 * 各栏内部纵向堆叠（不被同网格最高卡拉高），主要数据（核心标的 / 资金）占最大面积。
 * 情绪维度（情绪分 / 指数 / 涨停·跌停·炸板·封板率 / 最高板 / 涨跌家数 / 成交额）
 * 已上移全局顶栏 header，本页顶部只保留 EbbBanner 退潮预警通栏（有预警才渲染）。
 */
export function Component() {
  return (
    <div className="flex flex-col gap-3">
      {/* 退潮预警通栏 —— 层级高于所有卡片（有预警才渲染，无预警不占位）。
          其余情绪维度（情绪分 / 三大指数 / 涨停·跌停·炸板·封板率 / 最高板 /
          涨跌家数 / 成交额）已全部上移到全局顶栏 header，本页不再重复渲染
          指挥条，避免与顶栏重复并让首屏三栏直接可见。 */}
      <EbbBanner />

      {/* 任务导向三栏分区：机会 20% / 主工作 50% / 风险 30% */}
      <ZoneRow className="intraday-zones">
        <Zone label="机会" dot="bg-up" className="xl:w-[20%]">
          <AmbushCard />
          <ThemeTopCard />
        </Zone>

        <Zone label="主工作区" dot="bg-lead" className="xl:w-[50%]">
          <LeadersCard />
          <SectorFlowCard />
          <SignalsCard />
        </Zone>

        <Zone label="风险辅助" dot="bg-down" className="xl:w-[30%]">
          <FeedbackCard />
          <LadderCard />
          <ExtremeCard />
        </Zone>
      </ZoneRow>

      {/* 前瞻信息补充区：两栏等宽，不挤占主区 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ExpectCard />
        <SectorDeltaCard />
      </div>
    </div>
  )
}
