# 狸猫终端 · Limao Terminal

A股情绪核心盯盘终端。**React 19 分层架构**，数据源为原系统「狸猫猎手」的落盘 JSON —— **原系统只读，不做任何改造**。

```
磁盘 JSON（狸猫猎手 cache/）  ──►  /api/*  ──►  shared/api  ──►  features  ──►  pages  ──►  app
```

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5181（自动接管 ../狸猫猎手 的数据）
```

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（含数据中间件，端口 5181） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物 |
| `npm test` | 单元 / 组件测试 |
| `npm run check` | 全量质量门（lint → 分层 → 类型 → 测试） |
| `npm run arch` | **分层边界校验**（见下） |
| `npm run data` | **数据链路体检**（命令行版 `/api/health`） |
| `npm run data:verbose` | 附每条路由的顶层字段结构 |

迁移到服务器时无需改代码，只需覆写数据根：

```bash
LIMAO_DATA_ROOT=/srv/limao npm run dev
```

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| UI | **React 19.3** | 并发渲染 + Actions |
| 路由 | **react-router 8** | Data Router：`loader` 导航前预取、`errorElement` 分层兜底 |
| 服务端状态 | **TanStack Query 5** | 轮询 / 去重 / 竞态 / 后台暂停，全部内建 |
| 客户端状态 | **zustand 5** | 仅在确实需要跨组件共享 UI 状态时使用 |
| 数据契约 | **zod 4** | 只校验不转换（zod 会 strip 未知键，用解析结果会丢字段） |
| 样式 | **Tailwind v4** + **@skyroc/web-ui** | `@theme` 令牌 + `@utility` 组合类 |
| 构建 | **Vite 8** + **oxc-transform-react** | React Compiler 编译期自动记忆化 |
| 检查 | **TypeScript 6** + **oxlint** + **Vitest 5** | 类型 / 静态 / 测试 |

> ⚠️ **版本坑（实测）**
> - TypeScript **7.x 不可用**：其 `exports` 只剩 `./unstable/*`，`vue-tsc` / 部分工具链会崩。本工程锁 `~6.0.3`。
> - `@vitejs/plugin-react` **6.x 移除了 `babel` 选项**。React Compiler 须用 `react({ compiler: true })`，并显式安装 `oxc-transform-react`（peer 要求 `^0.145.0`）。
> - TS6 已弃用 `baseUrl`，`paths` 直接相对 tsconfig 解析。

## 分层架构

```
src/
├── shared/          框架无关的地基。可被 Node 脚本 / 测试 / 未来其他前端直接复用
│   ├── api/         ★ 唯一取数入口。routes(路由真源) / types(契约) / schemas(守卫) / client / endpoints
│   ├── lib/         ⚠️ 禁止 import react —— 纯函数，零副作用
│   ├── config/      APP_CONFIG：所有魔法数字的唯一出口
│   ├── hooks/       通用 hooks（useNow / useContractIssues）
│   └── ui/          无业务语义的原子组件（Card / EmptyState）
├── features/        业务域。每个域自带 api / components / model，通过 index.ts 暴露
│   └── market/      行情域
├── pages/           页面 = 组装 + loader（数据预取与组件同文件，就近维护）
└── app/             装配层：AppShell(布局) / TopBar / router / providers / RootError
```

**依赖方向单向向下**：`app → pages → features → shared`。反向依赖由 `npm run arch` 强制拦截。

### 两条硬规则

1. **barrel 是契约边界**。上层只能 `from '@/shared/api'`，禁止 `from '@/shared/api/client'`。
   理由：没有 barrel 的「分层」只是文件夹分类 —— 改一个内部文件路径就会引发全项目 import 雪崩。

2. **`shared/lib` 保持框架无关**。判定逻辑（涨跌、涨停、情绪分）必须能被 Node 脚本直接调用，
   否则同一口径会在前端与脚本各写一份，然后漂移。

## A股语义色铁律

| 语义 | 令牌 | 值 |
| --- | --- | --- |
| 涨 / 改善 / 机会 | `--color-up` | `#ee2500` 红 |
| 跌 / 恶化 / 回避 | `--color-down` | `#0a8f3c` 绿 |
| 可买 / AI 推荐 | `--color-rec` | `#8b5cf6` 紫 |
| 涨停标杆龙 | `--color-lead` | `#e8940a` 金 |
| 退潮 / 风险预警 | `--color-warn` | `#0d9488` 青 |

**与欧美市场完全相反**：涨红跌绿。

### ⚠️ 两套语义必须隔离

Skyroc UI 自带 `primary` / `destructive`(红) / `success`(绿) —— 服务的是**通用交互语义**。
本项目另有 `up` / `down` —— 服务的是**行情语义**。两者的「红」含义不同：

- `destructive` = 红 = 删除 / 危险
- `up` = 红 = 上涨 / 利好

**绝不可互相替代**，也绝不可把 `--color-success` 重定义为红（那会让删除按钮变绿）。

| 场景 | 用哪套 |
| --- | --- |
| 按钮、弹窗、表单校验 | skyroc 的 `primary` / `destructive` / … |
| 价格、晋级率、梯队、情绪 | 本项目的 `up` / `down` / `rec` / `lead` / `warn` |

深色顶栏另有一套提亮色（`--color-head-up` 等）—— 因为 `#ee2500` 在 `#1c2130` 上对比度不足。
这是刻意的「同一语义、两套载体」，不是冗余。

## 数据缺失是一等状态

原系统盘前大量字段为空。本工程的处理原则：

| 情形 | 表现 |
| --- | --- |
| 文件未生成 → 404 | `DataUnavailableError`，卡片降级为空态，**不崩溃** |
| 结构不符契约 | 记录到 `contractIssues`，**数据仍按原样使用**，顶栏提示「N 源结构异常」 |
| 数值缺失 | 渲染 `—`，绝不显示 `NaN` |

依据：**宁可显示可疑数据，也不白屏** —— 盘中白屏意味着错过信号。
而结构异常要显式暴露，因为它比数据缺失更危险：数据在、口径变了，会**安静地给出错误结论**。

## 原系统（狸猫猎手）的对接方式

`src/shared/api/routes.ts` 是**唯一的路由真源**，把 URL 映射到原系统落盘文件：

| 路由 | 文件 | 用途 |
| --- | --- | --- |
| `/api/market/latest` | `cache/pulse_snapshots/latest.json` | 主快照（梯队 / 核心标的 / 板块风险 / 情绪） |
| `/api/market/prev` | `cache/pulse_snapshots/prev.json` | 上一版快照（环比） |
| `/api/market/auction` | `cache/pulse_snapshots/auction_live.json` | 竞价实时报价 |
| `/api/market/signals` | `cache/short_spirit_signals.json` | 短线精灵 |
| `/api/market/feedback` | `cache/feedback_matrix.json` | 昨日涨停反馈矩阵 |
| `/api/market/candidates` | `cache/pulse_snapshots/candidates.json` | 候选池 |
| `/api/theme/rotation` | `cache/theme_rotation.json` | 题材轮动 / 回流 / 5日资金 |
| `/api/theme/series` | `cache/theme_series.json` | 题材多日序列 |
| `/api/theme/sequence` | `cache/theme_sequence.json` | 题材序列 |
| `/api/flow/history` | `cache/sector_flow_history/` | 板块资金历史（多日合并） |
| `/api/health` | — | 数据新鲜度体检（合成） |

**同语义的两个执行者**：开发期由 `vite.config.ts` 中间件提供，生产期由 `serve.py` 提供，
两者共用 `scripts/lib/read-route.mjs` 的读取实现，避免漂移。前端代码无需区分环境。

## 页面加载稳定性（31 个懒加载页面）

每个页面都是 `lazy: () => import(...)`，好处是首屏轻；代价是**模块下载失败时整页进不去**。
浏览器的原生报错长这样（同一件事，三个内核三种文案）：

| 内核 | 报错 |
| --- | --- |
| Safari / WebKit | `TypeError: Importing a module script failed.` |
| Chrome | `TypeError: Failed to fetch dynamically imported module` |
| Firefox | `TypeError: error loading dynamically imported module` |

成因都是**瞬时**的，与页面代码无关：

| 成因 | 典型场景 |
| --- | --- |
| Vite 依赖重新预构建 | dev 期间发现未预构建的依赖，旧 `?v=` hash 全部失效（`504 Outdated Optimize Dep`） |
| HMR 打断 | 保存瞬间正在加载；或中间态语法错误让共享 barrel transform 500 |
| 多个 dev server 共用 `.vite` | 谁触发预构建都让另一个实例的模块图失效（本项目实测过 5181/5182 并存） |
| 部署换版 | `vite build` 清空 `assets/`，旧 HTML 引用的旧 hash chunk 直接 404 |
| 网络抖动 | `server.host = true` + 穿透隧道，链路不稳时模块请求批量失败 |

四层防御：

1. **预取**（`Sidebar.tsx`）—— 悬停 / 聚焦即 `preloadPage`，把下载提前到点击之前；重点页在空闲时预取。
2. **重试 + 幂等缓存**（`lazyRoute.ts`）—— 只重试「模块请求失败」，页面顶层抛错不重试；缓存 promise 让连点 / 预取 / StrictMode 只发一次请求。
3. **失败清缓存** —— 不清的话「重试」永远拿到那个已失败的 promise，只能整页刷新才能恢复。
4. **分层兜底** —— 每页挂 `PageError`（只替换 `<Outlet />`，侧栏顶栏保留）；导航失败弹提示条（重试 / 刷新）。

### ⚠️ 三条实测结论（别凭直觉"优化"掉）

- **浏览器会缓存模块加载失败**。CDP 拦截实测：同一 URL 的第二次 `import()` 常常**不发网络请求**、直接失败。
  所以「重试」不是万能药，**整页刷新才是终极手段**（`autoReloadOnce`，同页 60s 节流防死循环）。
- **React Router 的 `lazy` 失败会静默取消导航** —— URL 回退、页面不动、目标路由的 `errorElement` 根本不会渲染，
  只在控制台留一行报错。用户看到的是「点了没反应」。所以导航必须自己拦（`usePageNav`）。
- **预取绝不允许触发整页刷新**。否则鼠标沿侧栏划一趟（31 个页面）就可能连刷十几次，
  比报错本身更难受。`preload()` 内部固定 `autoReload: false`，并由单测锁住。

## 迁移进度

**已迁（盘中实时）**

- ✅ 情绪条 `MoodBar` — 对应原 dashboard `render()`
- ✅ 昨日涨停反馈 `FeedbackCard` — 改善红 / 恶化绿
- ✅ 连板天梯 `LadderCard` — 对应 `render_ladder()`
- ✅ 今天最强题材 `TopThemeCard` — 题材当行、个股当详情，点行折叠（2026-10-30 由 `ThemeTopCard` + `LeadersCard` 合并）
- ✅ 短线精灵 `SignalsCard` — 对应原 watch.html `renderWatch()`
- ✅ 顶栏 `TopBar` — 指数 / 情绪 / 时序 / 契约健康度

**待迁**

> 截至 2026-10-30：下列能力**已全部迁移完成**，对应页面均已上线。完整能力以 `npm run data` 输出的 **83 条 `/api/*` 路由清单**为准（实测 83/83 缺失 0），本文档不再逐条维护待迁清单。

| 原待迁项 | 已迁页面 | 路由 |
| --- | --- | --- |
| 趋势追踪（含图表） | `FlowPage` / `RotationPage` / `EmotionPage` | `/api/flow/*` `/api/theme/*` `/api/emotion/*` |
| 盘前竞价定调 | `AuctionPage` | `/api/market/auction` `/api/decision/auction-history` |
| 核按钮分级预警 | `RiskPage`（ExtremeCard） | `/api/risk/watch` |
| 主线题材 Top / 题材轮动 / 回流预测 | `MainlinePage` / `BoardCorePage` / `RotationPage` / `ReflowPage` / `EruptionPage` | `/api/theme/*` `/api/board/*` `/api/eruption/*` |
| 资金流向 / 交易战绩 / 数据记录 / 数据堆叠 | `FlowPage` / `BacktestPage` / `RecordPage` / `StackPage` / `DataPage` | `/api/flow/*` `/api/backtest/*` `/api/data/*` |

## 已知限制

- 开发中间件与前端**同进程**，仅适用于本地；对外的服务器部署需 `serve.py`。
- `theme_sequence.json` 原系统写入频率低（实测可达数百小时未更新），属预期而非故障。
- React Compiler 已开启，但组件仍应按「纯渲染」写 —— 编译期记忆化不能修正错误的副作用。
