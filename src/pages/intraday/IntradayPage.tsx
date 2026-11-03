import { useQuery } from '@tanstack/react-query'
import { EbbBanner, ExtremeCard, LadderCard, SectorFlowCard, SignalRail, TopThemeCard, marketQueries } from '@/features/market'
import { IntradayMoodCard } from '@/features/analytics'
import { Zone } from '@/shared/ui'
import { cn } from '@/shared/lib'
import { queryClient } from '@/shared/api'

export async function loader() {
  // 预取失败交给页面状态提示，避免主快照缺失使整个应用进入根错误页。
  await queryClient.prefetchQuery(marketQueries.latest())
  return null
}

/**
 * 盘中实时 —— 全站唯一「所有数据都是 intraday 节拍」的页面。
 *
 * ## 版面：左主区 / 中反馈区 / 最右固定信号 rail（2026-09-22 定稿，三栏）
 *
 * ```
 * ┌──────── 左 60% ──────────────┬── 中 30% ──┬ 最右 rail 10% ──┐
 * │ 最强题材（通栏·可折叠）       │ 反馈与信号  │ ⚡ 信号（固定）  │
 * │ ────────────────────────      │ 连板/极值   │ 短线精灵按type着色│
 * │ 情绪走势 │ 板块资金            │             │                  │
 * └───────────────────────────────┴────────────┴─────────────────┘
 * ```
 *
 * · **左栏首行 = 最强题材通栏**（`xl:col-span-2`）—— 2026-10-30 起把「题材强度」
 *   与「核心标的」**并成一张可折叠卡**：题材当行、个股当详情。原来两张表各自
 *   都答不了「最强那条线里都有谁」，用户得靠名字在两表之间来回找。
 * · **左栏次行 = 情绪走势 + 板块资金**（2 列均分）—— 都是「当刻盘面」，需要宽度；
 * · **中栏 = 连板天梯（含晋级）+ 极值名单（含核按钮）** —— 纵向堆叠；
 * · **最右「信号」rail = 固定 10% 窄列**（`SignalRail`）—— 只放紧凑版短线精灵列表，
 *   按信号 `type` 着色（涨停/接近涨停=红、快速拉升=紫、打开涨停板=橙、打开跌停=青）。
 *   09-22 起**不再折叠**、**不再显示反馈 4 数字条**（与中区两张融合卡重复）。
 *
 * ⚠️ 左栏内部**不能用 `Board`** —— 它按**视口**断点给列数（≥1920 直接 4 列），
 *    放进栏里会得到 4 张 ~270px 的窄卡（表格必挤）。栏内均分用显式 2 列网格。
 * ⛔ 窄屏三栏退化为 `flex-col`（`max-xl:flex-col`）—— 窄屏强塞多栏会把表格挤成两行。
 */
const ZONE_MAIN = 'xl:w-[60%]'
const ZONE_MID = 'xl:w-[30%]'
const ZONE_RAIL = 'xl:w-[10%]'

export function Component() {
  const { data, isPending, isError } = useQuery(marketQueries.latest())
  // 量能与广度缺失是上游明确的未知值，提示用户不要把空白当作盘面为零。
  const missingMarket = data?.market == null
  const missingBreadth = data?.breadth?.up == null || data?.breadth?.down == null
  const missingParts = [missingMarket && '两市成交额', missingBreadth && '全市场涨跌家数'].filter(Boolean).join('、')

  return (
    <div className="flex flex-col gap-3">
      {(isPending || isError || !data) && (
        <p role="status" className="m-0 rounded-sm bg-warn-soft px-3 py-2 text-12 text-warn">
          {isPending ? '正在加载主快照…' : isError ? data ? '主快照更新失败，相关卡片保留上次数据；空白项不能视为零值。' : '主快照加载失败，暂无法确认盘面与风险状态。' : '主快照尚未提供，暂无法确认盘面与风险状态。'}
        </p>
      )}
      {data && missingParts && (
        <p role="status" className="m-0 rounded-sm bg-warn-soft px-3 py-2 text-12 text-warn">
          当前快照 {data.ts.slice(11, 19)}：{missingParts}未采集到，量能与广度判断不完整。
        </p>
      )}
      {/* 退潮预警通栏 —— 层级高于所有卡片（有预警才渲染，无预警不占位）。
          其余情绪维度（情绪分 / 三大指数 / 涨停·跌停·炸板·封板率 / 最高板 /
          涨跌家数 / 成交额）已全部上移到全局顶栏 header，本页不重复渲染。 */}
      <EbbBanner />

      {/* ⛔ 不要在这里加裸 `flex-col`：Tailwind v4 产物里它与 `xl:flex-row` 同层同权、
          且排在后者之后 ⇒ 所有宽度都会变竖排（2026-09-21 实测事故）。
          `max-xl:flex-col`（媒体查询互斥，安全）表达「窄屏竖排 / 宽屏横排」。 */}
      {/* `intraday-zones` = 三栏容器的**稳定测试钩子**（布局不变量由 `intraday-board.test.tsx` 锁） */}
      <div className="intraday-zones flex gap-3 items-start max-xl:flex-col">
        <Zone label="盘面与标的" dot="bg-up" className={cn('min-w-0', ZONE_MAIN)}>
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            {/* 最强题材占满整行：展开后要铺一条线的全部个股，半宽会挤成三行 */}
            <div className="xl:col-span-2">
              <TopThemeCard />
            </div>
            <IntradayMoodCard />
            <SectorFlowCard />
          </div>
        </Zone>

        <Zone label="反馈与信号" dot="bg-down" className={cn('min-w-0', ZONE_MID)}>
          {/* 昨日涨停反馈分别并入天梯与极值，避免同一指标在三张卡里重复。 */}
          <LadderCard />
          <ExtremeCard />
        </Zone>

        <SignalRail className={cn('min-w-0', ZONE_RAIL)} />
      </div>
    </div>
  )
}
