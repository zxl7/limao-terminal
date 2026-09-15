import {
  AmbushCard,
  EbbBanner,
  ExpectCard,
  ExtremeCard,
  FeedbackCard,
  LadderCard,
  LeadersCard,
  MoodBar,
  SectorDeltaCard,
  SectorFlowCard,
  SignalsCard,
  ThemeTopCard,
  marketQueries,
} from "@/features/market"
import { cn } from "@/shared/lib"
import type { ReactNode } from "react"
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
 * 实时页三栏之一：机会 / 主工作 / 风险辅助。
 *
 * 极简语义标签（色点 + 小字）表达「这一栏的用途」，不与卡片标题重复；
 * 栏内纵向堆叠卡片，且栏本身 `min-w-0` 防内容溢出。
 */
function Zone({ label, dot, className, children }: { label: string; dot: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-2.5 min-w-0", className)}>
      <div className="flex items-center gap-1.5 px-0.5 pt-0.5">
        <span className={cn("w-1 h-1 rounded-full flex-none", dot)} aria-hidden />
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-sub uppercase">{label}</span>
      </div>
      {children}
    </section>
  )
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
 * 顶部 MoodBar / EbbBanner 通栏（由外层 flex 自然铺满），下方补充区（前瞻信息）独立两栏。
 */
export function Component() {
  return (
    <div className="flex flex-col gap-3">
      {/* ── 顶部情绪 header：上移至顶栏下方、sticky 常驻，不占主区卡片位 ──
          贴在 TopBar(46px) 正下方，全宽（抵消 main 的 padding）、不透明底盖住
          滚动内容；三栏与前瞻区站位完全不变。 */}
      <div className="sticky top-[46px] z-20 -mx-4 lg:-mx-5 -mt-3 px-4 lg:px-5 pt-3 pb-3 bg-bg border-b border-line">
        <MoodBar header />
        <EbbBanner header />
      </div>

      {/* 任务导向三栏分区：机会 20% / 主工作 50% / 风险 30% */}
      <div className="intraday-zones flex gap-3 xl:flex-row xl:items-start">
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
      </div>

      {/* 前瞻信息补充区：两栏等宽，不挤占主区 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ExpectCard />
        <SectorDeltaCard />
      </div>
    </div>
  )
}
