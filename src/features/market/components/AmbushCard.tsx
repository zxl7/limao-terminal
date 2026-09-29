import { useQuery } from '@tanstack/react-query'
import { cn, fmtPct } from '@/shared/lib'
import { Card, EmptyState, Icon, StockLink } from '@/shared/ui'
import { marketQueries } from '../api/queries'
import { pctTone } from '../model/labels'

/**
 * 早鸟埋伏（`latest.early`）—— **本系统的核心诉求**，且是本页最该被看到的卡。
 *
 * ## 它答的是哪个问题
 *
 * 「板块已经在爆发，但**我还能买什么**」—— 即未封板的强势龙头。
 * 连板天梯答「谁最强」（但已封板买不到），主线热度答「哪条线在共振」，
 * 只有本卡把「板块级催化」和**可买标的**连起来。
 *
 * ## 数据口径（来自 `intraday_pulse.py::build_early`）
 *
 *   · `type`        —— 阶段（实测「爆发中」）
 *   · `sector`      —— 板块名（题材归属的唯一权威来自选股宝 plates）
 *   · `desc`        —— 板块催化原文；**可能为空串**（无事件支撑的纯资金板块）
 *   · `buy`         —— **未封板**的可买龙头（`limit_up_days: 0` 即今日未涨停）
 *   · `zt_in_sector`—— 该板块当日涨停家数（共振强度）
 *   · `members`     —— 板块内强势成员（**对象数组**，非字符串数组 ——
 *                      早期类型写错会直接抛 "Objects are not valid as a React child"）
 *
 * ## ⚠️ 两条硬约束已由上游脚本保证，前端只做展示
 *
 *   1. **科创板（688）已剔除** —— 用户无 688 权限，`buy.code` 不会是 688 开头。
 *   2. `buy` 一定是**未封板**标的 —— 这正是「埋伏」而非「追板」的含义。
 *
 * ## ⚠️ 20cm 标注
 *
 * 创业板（300/301）20cm 与主板 10cm 在本系统**对称参与，无倾向性加减分**；
 * 但 20cm 波动更大，故按「标注而不歧视」原则加「波动大」提示，不做排序压制。
 */
export function AmbushCard() {
  const { data } = useQuery(marketQueries.latest())
  const rows = data?.early ?? []

  return (
    <Card
      title="🚀 早鸟埋伏"
      extra={
        <span className="text-[11px] font-normal text-sub">
          {rows.length > 0 ? `${rows.length} 个在爆发` : '无'}
        </span>
      }
    >
      {rows.length > 0 ? (
        <div className="flex flex-col gap-2">
          {rows.map((e) => (
            <div
              key={`${e.sector}-${e.buy?.code ?? e.sector}`}
              className="rounded-[var(--radius-sm)] bg-rec-soft px-2 py-1.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="badge bg-rec text-white px-1.5">{e.type}</span>
                <span className="text-[13px] font-semibold text-rec">{e.sector}</span>
                <span className="num text-[11px] text-sub ml-auto">
                  板块涨停 <b className="text-[12px] text-up">{e.zt_in_sector}</b>
                </span>
              </div>

              {/* 催化 —— 空串时不留空行，直接省略（空 desc 本身也是一条信息） */}
              {e.desc ? (
                <div className="text-[11px] text-sub mt-0.5 line-clamp-2">催化：{e.desc}</div>
              ) : (
                <div className="text-[11px] text-sub mt-0.5">暂无板块级催化（纯资金驱动）</div>
              )}

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-1 pt-1 border-t border-rec/15">
                <span className="flex items-center gap-1 text-[10.5px] text-rec flex-none">
                  <Icon name="target" size={12} />
                  可买
                </span>
                <StockLink code={e.buy?.code} className="text-[13px] font-semibold text-txt">{e.buy?.name ?? '—'}</StockLink>
                <span className={cn('num text-[13px] font-semibold', pctTone(e.buy?.pct))}>
                  {fmtPct(e.buy?.pct)}
                </span>
                {e.buy?.price != null && (
                  <span className="num text-[11px] text-sub">¥{e.buy.price}</span>
                )}
                {e.buy?.is_20cm && (
                  <span className="badge bg-lead-soft text-lead">20cm · 波动大</span>
                )}
              </div>

              {e.members && e.members.length > 0 && (
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mt-0.5">
                  <span className="text-[10.5px] text-sub flex-none">同板强势</span>
                  {e.members.map((m) => (
                    <span key={m.name} className="text-[11.5px] text-txt">
                      {m.name}
                      <span className={cn('num ml-1', pctTone(m.pct))}>{fmtPct(m.pct)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="当前无未封板的板块强势龙头" />
      )}
    </Card>
  )
}
