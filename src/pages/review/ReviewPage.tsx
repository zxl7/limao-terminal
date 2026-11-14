import { api, queryClient } from '@/shared/api'
import { ReviewPanelSection } from '@/features/review/ReviewPanel'

/**
 * 今日复盘（2026-11-14 用户「新增一个 tab 叫今日复盘，加星」）。
 *
 * 数据：`/api/review/panel` ← `cache/review_panel.json`（15:35 收盘链落盘）。
 * 内容：明日跌停预判 / 赚钱效应 / 高标处境 / 主线与板块 / 复盘点评（LLM 卡分段）。
 * ⛔ 只呈现，前端不做二次推断。
 */
export async function loader() {
  await queryClient.ensureQueryData({
    queryKey: ['review', 'panel'] as const,
    queryFn: api.reviewPanel,
  })
  return null
}

export function Component() {
  return <ReviewPanelSection />
}
