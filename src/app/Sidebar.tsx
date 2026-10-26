import { Fragment, useState } from 'react'
import { NavLink } from 'react-router'
import { TABS, type TabGroup } from './AppShell'
import { preloadPage } from './lazyRoute'
import { NavErrorBanner, usePageNav } from './usePageNav'
import { cn } from '@/shared/lib'

/**
 * 左侧栏 —— PC 交易终端的「分区」骨架。
 *
 * ## 为什么需要它（这是「PC 端那种划分」缺失的那一层）
 *
 * 旧外壳是「顶部横向 tab 条 + 全宽单列内容」，这是**响应式网站**的形态；
 * 在 4K 上缩放后只是「移动端放大」。真正的 PC 终端（同花顺 / TradingView /
 * Bloomberg）是 **左侧栏导航 + 顶栏指挥条 + 满宽多列主区** 三段分区。
 *
 * 侧栏把 21 个入口按「实时 / 盘面 / 决策 / 题材 / 数据」分组，段头小标签 +
 * 实时段呼吸点，激活态左侧 `--color-up` 红条。改这一段即改变全站 21 页的
 * 导航外观，与页面内容解耦。
 *
 * ## 视觉：深底「终端框」+ 浅底「工作区」
 *
 * 侧栏与顶栏同用深底 `#1c2130`，主区用浅底白卡 —— 强对比形成「框 / 画布」
 * 的终端质感，而非平铺的文字 tab。激活项：`bg-white/10` + 左 2px 红条，
 * 文本提亮到纯白，与默认 `head-soft` 拉开层级。
 */

/** 五段固定顺序（与 TABS 的分组一致，仅用于控制渲染次序与段头） */
const GROUPS: TabGroup[] = ['实时', '盘面', '决策', '题材', '数据']

/** 段图标 —— 极简线性 SVG（currentColor 跟随侧栏文字色） */
function GroupIcon({ group }: { group: TabGroup }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (group) {
    case '实时': // 脉冲线
      return (
        <svg {...common}>
          <path d="M1.5 8h3l1.5-4 3 8 1.5-4h3.5" />
        </svg>
      )
    case '盘面': // 网格
      return (
        <svg {...common}>
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
          <path d="M8 2v12M2 8h12" />
        </svg>
      )
    case '题材': // 标签
      return (
        <svg {...common}>
          <path d="M2.5 2.5h4l6.5 6.5-4 4L2.5 6.5z" />
          <circle cx="5" cy="5" r="0.9" />
        </svg>
      )
    case '决策': // 靶心
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      )
    case '数据': // 堆叠
      return (
        <svg {...common}>
          <path d="M2 4.5l6-2.5 6 2.5-6 2.5z" />
          <path d="M2 8l6 2.5 6-2.5M2 11.5l6 2.5 6-2.5" />
        </svg>
      )
  }
}

export function Sidebar() {
  const nav = usePageNav()

  const grouped = GROUPS.map(
    (g) => [g, TABS.filter((t) => t.group === g)] as const,
  ).filter(([, items]) => items.length > 0)

  return (
    /**
     * 侧栏高度锁定在视口（父级 `AppShell` 已 `h-screen`），三段切分固定：
     *   ① 品牌区 `flex-none` —— 「狸猫终端」恒在左上角，滚不动
     *   ② tab 列表 `flex-1 overflow-y-auto` —— **只有这里滚**
     *   ③ 页脚 `flex-none` —— 恒在左下角
     *
     * ⛔ `min-h-0` 必须有：flex 子项默认 `min-height:auto`，tab 多到超出时
     *    会把 `<aside>` 撑高、进而把整页撑高，`overflow-y-auto` 就失效
     *    （表现就是「tab 列表不自己滚，整个侧栏跟着内容走」）。
     */
    <aside
      className="max-lg:hidden lg:flex flex-col w-[220px] flex-none min-h-0 h-full text-head-txt border-r border-white/10 select-none"
      style={{ background: 'linear-gradient(180deg, #1c2130, #232c41)' }}
      aria-label="主导航"
    >
      {/* 品牌：固定左上角（⛔ 不要放进可滚动区） */}
      <div className="h-[46px] flex items-center gap-2 px-4 flex-none border-b border-white/10">
        <span
          className="w-7 h-7 rounded-md inline-flex items-center justify-center text-white text-[13px] font-extrabold"
          style={{ background: 'linear-gradient(135deg, #ee2500, #ff7a3d)' }}
        >
          狸
        </span>
        <span className="font-bold text-[15px] tracking-[0.02em]">狸猫终端</span>
      </div>

      {/* 分组导航 —— 本侧栏唯一的滚动区 */}
      <nav
        aria-label="主导航"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2.5 py-3 space-y-4"
      >
        {grouped.map(([group, items]) => {
          const live = group === '实时'
          return (
            <div key={group}>
              <div className="flex items-center gap-1.5 px-2 mb-1.5">
                {live && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-head-up animate-pulse"
                    aria-hidden
                  />
                )}
                <GroupIcon group={group} />
                {/* 实时段用深底强调红 text-head-up（不是浅底 text-up ——
                    深底上 --color-up 对比度不足），与历史段拉开层级 */}
                <span
                  className={cn(
                    'text-[10.5px] font-semibold tracking-[0.12em] uppercase',
                    live ? 'text-head-up' : 'text-head-soft',
                  )}
                >
                  {group}
                </span>
              </div>
              <div className="space-y-0.5">
                {items.map((t) => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    end={t.end}
                    /*
                      悬停 / 键盘聚焦即预取：把「点击后才下载」提前到「鼠标移过去就开始」。
                      移动鼠标到点击之间有 200–600ms，足够命中缓存；即使没命中，
                      真正点击时也是同一个 promise（`lazyRoute` 按路径缓存），不会重复请求。
                      预取失败静默 —— 点下去时 `load` 还会重试，不会给用户弹错误。
                    */
                    onMouseEnter={() => preloadPage(t.to)}
                    onFocus={() => preloadPage(t.to)}
                    /*
                      显式导航：先确保模块到位再跳转。React Router 的 lazy 失败
                      会**静默取消导航**（URL 回退、页面不动、只有控制台报错），
                      必须在这里拦一手，失败时给出「重试」而不是无声无息。
                    */
                    onClick={(event) => nav.onClick(event, t.to, t.label)}
                    data-priority={t.priority ? 'true' : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 px-2.5 py-[7px] rounded-md text-[13px] no-underline transition-colors',
                        isActive
                          ? 'bg-white/10 text-white shadow-[inset_2px_0_0_var(--color-up)]'
                          : 'text-head-soft hover:bg-white/5 hover:text-head-txt',
                      )
                    }
                  >
                    <span className="truncate">{t.label}</span>
                    {/*
                      重点入口标记（2026-10-18 用户改：**不要整行加底色**，改成右侧一颗五角星）。
                      原来的做法是 `bg-white/[0.07]` + 左侧红条，多条重点同时高亮时侧栏出现
                      一片深浅不一的色块，反而看不出重点；一颗星既不抢版式又一眼可辨。
                      ⛔ 星标只做「标识」，不改变点击行为与 `data-priority`（导航测试与埋点依赖它）。
                    */}
                    {t.priority && (
                      <span
                        className="ml-auto flex-none text-[11px] leading-none text-head-up"
                        aria-label="重点盯盘"
                        title="重点盯盘"
                      >
                        ★
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* 页脚状态 */}
      <div className="px-4 py-2.5 border-t border-white/10 flex items-center gap-2 text-[11px] text-head-soft flex-none">
        <span className="w-1.5 h-1.5 rounded-full bg-head-down" aria-hidden />
        <span>A股情绪核心 · 盘中实时终端</span>
      </div>

      <NavErrorBanner failure={nav.failure} onRetry={nav.retry} onDismiss={nav.dismiss} />
    </aside>
  )
}

/** 窄屏（<lg）回退导航 —— 侧栏隐藏时退化为顶部横向 tab 条，避免移动端无导航。 */
export function TopNavFallback() {
  const [dataOpen, setDataOpen] = useState(false)
  const nav = usePageNav()

  return (
    <nav
      className="max-lg:flex lg:hidden items-stretch gap-1 px-3 pt-2 bg-bg flex-none overflow-x-auto border-b border-line"
      aria-label="顶部导航"
    >
      {TABS.map((t, i) => {
        const isGroupStart = i === 0 || TABS[i - 1].group !== t.group
        const live = t.group === '实时'
        return (
          <Fragment key={t.to}>
            {isGroupStart && (
              <span className="flex items-center gap-1.5 flex-none my-1.5 pr-1">
                {i > 0 && <span className="w-px self-stretch bg-line mr-1.5" aria-hidden />}
                {live && (
                  <span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" aria-hidden />
                )}
                {t.group === '数据' ? (
                  <button
                    type="button"
                    aria-expanded={dataOpen}
                    onClick={() => setDataOpen((open) => !open)}
                    className="text-[10.5px] text-sub whitespace-nowrap cursor-pointer hover:text-txt"
                  >
                    数据 {dataOpen ? '⌃' : '⌄'}
                  </button>
                ) : (
                  <span
                    className={
                      live
                        ? 'text-[10.5px] font-semibold text-up whitespace-nowrap'
                        : 'text-[10.5px] text-sub whitespace-nowrap'
                    }
                  >
                    {t.group}
                  </span>
                )}
              </span>
            )}
            {(t.group !== '数据' || dataOpen) && (
              <NavLink
                to={t.to}
                end={t.end}
                onMouseEnter={() => preloadPage(t.to)}
                onFocus={() => preloadPage(t.to)}
                onClick={(event) => nav.onClick(event, t.to, t.label)}
                data-priority={t.priority ? 'true' : undefined}
                className={({ isActive }) =>
                  [
                    'border border-b-0 border-line bg-card text-sub px-3 py-1.5',
                    'rounded-t-[var(--radius-sm)] text-[13px] whitespace-nowrap no-underline',
                    'hover:text-txt transition-colors flex-none',
                    isActive
                      ? 'text-txt font-semibold border-line-strong shadow-[inset_0_-2px_0_var(--color-up)]'
                      : t.priority
                        ? 'text-up font-medium border-up/50 shadow-[inset_0_-2px_0_var(--color-up)]'
                        : '',
                  ].join(' ')
                }
              >
                {t.label}
              </NavLink>
            )}
          </Fragment>
        )
      })}

      <NavErrorBanner failure={nav.failure} onRetry={nav.retry} onDismiss={nav.dismiss} />
    </nav>
  )
}
