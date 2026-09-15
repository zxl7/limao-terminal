import { useQuery } from '@tanstack/react-query'
import { marketQueries } from '@/features/market'
import { bjTimeString, fmtPct, sentimentClass, sessionName, upcls } from '@/shared/lib'
import { useContractIssues, useNow } from '@/shared/hooks'
import { APP_CONFIG } from '@/shared/config'

/**
 * 顶栏 —— 全局盘面状态条。
 *
 * ## 为什么它属于 app 层而不是 features/market
 *
 * 顶栏是**外壳的一部分**：只要应用还在运行，它就存在。它聚合的是「跨页面的全局
 * 状态」（指数、情绪、数据新鲜度、契约健康度），而不是某一个业务页的数据视图。
 * 把它放进 features 会造成 `features → app` 的反向依赖。
 *
 * ## 三个设计要点
 *
 * 1. **数据的可用性 ≠ 数据的新鲜度**。指示灯只管「更新是否还活着」，
 *    契约异常单独一档显示 —— 数据在、格式变了，比数据缺失更危险（会静默错误渲染）。
 *
 * 2. **语义色在深底上必须换一套**。`--color-up`(#ee2500) 在 #1c2130 上对比度不足，
 *    故顶栏用 `text-head-up`(#ff6b52)。这是刻意的双套色，不是冗余。
 *
 * 3. **`useNow` 与查新解耦**。时钟 1s 一跳，数据 30s 一轮；把时钟塞进 query 会让
 *    整条数据链路每秒重算一次。两者各自独立。
 */
export function TopBar() {
  const { data } = useQuery(marketQueries.latest())
  const issues = useContractIssues()
  const now = useNow(APP_CONFIG.clockTickMs)

  const indexes = data?.index ?? []
  const updatedText = data?.data_scope?.asof || (data ? bjTimeString(new Date(data.ts)) : '—')
  const contractCount = issues.size

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-5 px-4 h-[46px] flex-none text-head-txt"
      style={{ background: 'linear-gradient(90deg, #1c2130, #283049)' }}
    >
      {/* 品牌 —— 仅窄屏显示（≥lg 时品牌在左侧栏，避免重复） */}
      <div className="lg:hidden flex items-center gap-2 font-bold text-[15px] tracking-[0.02em]">
        <span
          className="w-6 h-6 rounded-md inline-flex items-center justify-center text-white text-[13px] font-extrabold"
          style={{ background: 'linear-gradient(135deg, #ee2500, #ff7a3d)' }}
        >
          狸
        </span>
        <span>狸猫终端</span>
      </div>

      {/* 指数 */}
      <div className="flex gap-[18px] flex-1 min-w-0 overflow-hidden">
        {indexes.map((x) => (
          <div key={x.name} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-head-soft text-xs">{x.name}</span>
            <b className={`head-num text-[15px] ${headTone(x.pct)}`}>{fmtPct(x.pct)}</b>
          </div>
        ))}
        {indexes.length === 0 && <span className="text-head-soft text-xs">指数加载中…</span>}
      </div>

      {/* 情绪 */}
      {data?.sentiment_detail?.score != null && (
        <div className="flex items-center gap-1.5 px-4 whitespace-nowrap border-x border-white/15">
          <span className="text-head-soft text-xs">情绪</span>
          <b className={`head-num text-[15px] ${headSemantic(sentimentClass(data.sentiment_detail.score))}`}>
            {data.sentiment_detail.score}
          </b>
          <span className="text-head-soft text-xs">{data.sentiment_detail.label}</span>
        </div>
      )}

      {/* 时钟 + 健康度 */}
      <div className="flex items-center gap-2.5 text-xs whitespace-nowrap">
        <span className="text-head-soft">{sessionName(now)}</span>
        <span className="head-num">{bjTimeString(now)}</span>
        <span
          className={`w-2 h-2 rounded-full ${
            isStale(data?.ts) ? 'bg-head-soft' : 'bg-head-down shadow-[0_0_6px_#34d399]'
          }`}
          title={isStale(data?.ts) ? '数据已超过陈旧阈值' : '数据新鲜'}
        />
        <span className="text-head-soft">{updatedText}</span>

        {contractCount > 0 && (
          <span
            className="text-head-warn font-semibold cursor-help"
            title={[...issues.entries()]
              .map(([route, list]) => `${route}\n${list.map((i) => `  · ${i.path}: ${i.message}`).join('\n')}`)
              .join('\n\n')}
          >
            {contractCount} 源结构异常
          </span>
        )}
      </div>
    </header>
  )
}

/** 数据是否已陈旧（超过 APP_CONFIG.staleAfterMs） */
function isStale(ts: string | undefined): boolean {
  if (!ts) return true
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return true
  return Date.now() - t > APP_CONFIG.staleAfterMs
}

/**
 * 顶栏专用的色调映射。
 *
 * ⚠️ 不能用 `features/market/model/labels.ts` 的 `TONE_TEXT`：那个返回浅底用的
 *    `text-up`/`text-down`。顶栏在深底上必须换成 `text-head-*`。这是同一语义的
 *    **两套载体**，共用判定、不共用类名 —— 判定仍来自 `shared/lib/semantic.ts`。
 */

/** 涨跌方向 → 顶栏色（涨红跌绿） */
function headTone(v: number | null | undefined): string {
  return headSemantic(upcls(v))
}

/** 语义标识 → 顶栏色。`''`/`'mid'`/`'flat'` 一律归为中性蓝。 */
function headSemantic(s: '' | 'up' | 'down' | 'mid' | 'flat'): string {
  if (s === 'up') return 'text-head-up'
  if (s === 'down') return 'text-head-down'
  return 'text-head-mid'
}
