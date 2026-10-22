# 狸猫终端 · 全系统自检与优化计划

> 扫描日期：2026-10-18（周六，非交易日）
> 范围：前端 `狸猫终端`（React 19 + Vite 8）+ 后端 `狸猫猎手`（Python，只读数据源）
> 方式：全量门禁 + 真实浏览器测量（1920 / 1440）+ 路由新鲜度扫描 + 依赖清单 + 源码静态扫描
> 结论口径：**已实测**优先；推断项显式标注「待验证」。

---

## 0. 结论摘要

| 维度 | 结论 |
|---|---|
| 分层与类型 | 健康。`arch` 通过，`tsc --noEmit` 无输出，`oxlint` 0 warning / 0 error（159 文件） |
| 构建 | 通过（2.7s）。但主包 **583KB**（gzip 180KB）触发 >500KB 警告 |
| 数据路由 | **79/79 可用，缺失 0**；但 **29 条路由龄期 ≥48h**，其中 8 条 ≥800h |
| 测试 | 557 passed / 10 failed（6 文件）。失败**全部为既有基线**，本轮布局改造未新增红灯 |
| 安全 | 后端服务原默认 `0.0.0.0` + 空 token（已修）；`npm audit` 因镜像源不支持而**无法执行** |
| UI 布局 | **发现并修复外壳级 P0 缺陷**：左侧栏 / 右侧栏 / 顶栏宽屏 KPI 因 Tailwind 同属性竞争**恒不显示**，整个 PC 三段式外壳退化为顶部横条 |

一句话判断：

> 系统当前不是「功能不够」，而是**外壳可见性失效 + 数据新鲜度不可见 + 数据口径多源未收敛**。
> 本轮已修掉外壳 P0，并把后端默认暴露改为安全默认；数据口径与测试基线仍需按下面路线收口。

---

## 1. 本次已修复（可直接验收）

### 1.1 P0 · 三段式外壳失效（本轮最重要）

**现象**：PC 上左侧导航栏、右侧辅助栏从不显示；顶栏「最高板 / 上涨家数 / 成交额」三个 KPI 永不出现；窄屏兜底 tab 条反而常驻。

**根因（构建产物实测，非推断）**：

| 规则 | 产物偏移 | 媒体查询 |
|---|---:|---|
| `.lg\:flex{display:flex}` | 55,730 | `@media (width>=64rem)` |
| `.max-lg\:hidden{display:none}` | 53,801 | `@media not all and (width>=64rem)` |
| `.flex{display:flex}` | 65,550 | 无 |
| `.hidden{display:none}` | 65,588 | 无 |

同层、同权（单类选择器）⇒ **源码顺序决定**。裸 `hidden` / `flex` 排在响应式变体之后 ⇒ 它们在**所有宽度**都赢。`display` 这一属性组和 `flex-direction` 是同一类陷阱。

**修复**（改成互斥媒体查询）：

```diff
- Sidebar:     hidden lg:flex
+ Sidebar:     max-lg:hidden lg:flex
- RightRail:   hidden 3xl:flex
+ RightRail:   max-3xl:hidden 3xl:flex
- TopNavFallback: lg:hidden flex
+ TopNavFallback: max-lg:flex lg:hidden
- TopBar brand:   lg:hidden flex
+ TopBar brand:   max-lg:flex lg:hidden
- TopBar KPI:     hidden 2xl:flex  (×3)
+ TopBar KPI:     max-2xl:hidden 2xl:flex
- BoardCorePage 内条: hidden md:inline-block
+ BoardCorePage 内条: max-md:hidden md:inline-block
```

**实测结果（真实 Chromium）**：

| 视口 | 侧栏 | 右栏 | 顶部兜底 tab | 主区宽度 |
|---|---:|---:|---:|---:|
| 1920 | 220px ✅ | 320px ✅ | 0（隐藏）✅ | 1380px |
| 1440 | 220px ✅ | 0（隐藏）✅ | 0（隐藏）✅ | 1220px |

页面级横向溢出：`document.scrollWidth === innerWidth`（1920/1440 均无横向滚动）。

**影响范围**：全部 29 个页面（外壳层，页面代码零改动）。

**验证方式**：
1. `npm run test -- --run tests/tailwind-class-conflict.test.ts`（新增 2 项守卫：全仓裸 display × 响应式 display 不得同现；外壳三段必须用互斥写法）；
2. 浏览器实测三段宽度（见上表）；
3. `npm run build` 后检查产物中 `.hidden` 仍排在 `.lg\:flex` 之后 —— 这是**已知产物顺序**，守卫锁的是**源码写法**，不是产物顺序（产物顺序不可控）。

### 1.2 P0 · 后端服务默认对外且无鉴权

**原状**：`SHARE_HOST` 默认 `0.0.0.0`，`SHARE_TOKEN` 默认空，仅打印一行警告。等于默认把盘面、持仓、执行审计暴露到局域网。

**修复**：默认 `127.0.0.1`；对外监听（非 loopback）且无 token 时**直接拒绝启动**。

**实测**：

```text
$ SHARE_HOST=0.0.0.0 python3 serve.py
[serve] ⛔ 拒绝启动：SHARE_HOST=0.0.0.0 为对外监听，但未设置 SHARE_TOKEN。
exit=1
```

**验证方式**：上述命令 + `python3 -m py_compile serve.py`；对外部署必须 `SHARE_TOKEN=... SHARE_HOST=0.0.0.0`。

### 1.3 细节打磨

- `main` 内边距增加 `3xl:px-6`，宽屏（≥1920）内容不再贴边。

---

## 2. 问题清单（按优先级）

> 「证据」列均可复现；「待验证」表示尚未取证到根因。

### P0 · 可信度与安全（先做，不改页面结构）

| # | 问题 | 证据 | 影响范围 | 目标 | 验证方式 |
|---|---|---|---|---|---|
| P0-1 | **数据口径多源未收敛**（涨停数 59 vs 61 类冲突） | 10-16 实证：`latest.total_zt=59`、`feedback.now_zt_count=59`、`today_zt_codes=61`、`zt_history=61` | 顶栏、情绪周期、时间轴、盘后复盘、AI 卡片 | 单一发布契约：一份「当日涨停池」→ 所有模块只读 | 已加 `data_ready` 一致性闸门（见 10-17 修复）：三者不等即 `ready=false`；下一交易日盘中实测 |
| P0-2 | **29 条路由龄期 ≥48h**，旧数据仍按正常数据展示 | `npm run data`：`/api/hithink/valuation` 1259h、`/api/theme/sequence` 1075h、`/api/board/core` 930h、`/api/shadow/relay` 881h、`/api/theme/weekly-map` 830h、`/api/card/fupan` 905h、`/api/decision/execution-audit` 482h、`/api/lhb/tencent` 448h | 8 个页面：同花顺数据、板块核心、题材爆发史、竞价决策、执行审计、龙虎榜、卡片原文、数据堆叠 | 每条路由显式标注「最近有效日 / 已停更」，停更路由标 `retired` 并**停止轮询** | `/record` 页逐路由龄期表；`routes.ts` cadence 断言；`npm run data` 龄期阈值检查 |
| P0-3 | **`npm audit` 无法执行** | `registry.npmmirror.com` 未实现 `/-/npm/v1/security/audits` | 供应链安全 | 建立可执行的依赖漏洞扫描 | `npm audit --registry=https://registry.npmjs.org --omit=dev` 或 `osv-scanner -r .` 出报告 |
| P0-4 | 生产白名单与前端路由不一致 | `serve.py` 排除 `/api/ai/*`、`/api/decision/*`、`/api/account/*`、`/api/system/*`；前端这些页面在 8123 下**渲染为空态**而非「未开放」 | AI竞价、交易战绩、决策存档、系统台账、运维审计 | 空态与权限态分离 | `SHARE_TOKEN=x python3 serve.py` 逐页访问，断言出现「未开放」文案而非空表 |

### P1 · 判断质量与性能

| # | 问题 | 证据 | 影响范围 | 目标 | 验证方式 |
|---|---|---|---|---|---|
| P1-1 | **主包 583KB / gzip 180KB**，构建告警 | `✓ built` 输出 `index-*.js 583.05 kB` | 首屏加载（本地部署影响小，远程访问明显） | 首屏 < 300KB：把 29 页按路由切分 + 图表库独立 chunk | `npm run build` 输出逐 chunk 体积；`vite` 拆分配置后复查 |
| P1-2 | **超大响应体** | `/api/decision/candidates` 812.9KB、`/api/lhb/hithink` 486.3KB、`/api/market/relay-effect` 346.4KB、`/api/flow/history` 336.1KB、`/api/decision/execution-audit` 315.4KB | AI竞价、龙虎榜、赚钱效应、资金流向 | 单路由 >300KB 时改为服务端裁剪字段/分页 | `npm run data` 的「响应体积」段；裁剪后复测 |
| P1-3 | **事件折叠不守恒**（3 项测试红） | `event-segments.test.ts`：跨槽累积折叠 / `events` 数组一条不改 / `signal + 折叠 === 总数` 全部失败 | 时间轴事件区（默认可见条数） | 折叠只作标注、绝不改数组；信号数守恒 | 该文件 3 项转绿；变异验证（把 `foldNoise` 关掉应全 signal） |
| P1-4 | **`pool_call` 名额不变量被破坏** | `ranked.length = 1 > quota = 0` | AI竞价判断明细 / 执行审计 | 名额只给成交票；`meta.participate` 与名额序自洽 | `pool-call-route.test.ts` 第 ③ 项转绿；查当日 `pool_call-*.json` |
| P1-5 | **顶栏 KPI 与页面口径重复** | 顶栏「涨停/跌停/炸板/封板率」与盘中页卡重复；`最高板` 取 `ladder[0]`（当日池），盘后不复存在 | 全局 | 顶栏只留「全局定性」，明细归页面；最高板改用 `yesterday_zt` + `promote` 口径 | 盘中/盘后各截一次图，确认数值与页面一致 |
| P1-6 | **枚举回落两处未定性** | `AiPage.tsx:326` `row.call?.view ?? row.view ?? 'pending'`；`RotationPage.tsx:107` `c.phase \|\| f.phase` | AI竞价 / 题材轮动 | 若为内部状态键 → 进 `SAFE` 白名单并注释；若上屏 → 走白话层 | `plain-labels.test.ts` 第 ⑨ 项转绿 |
| P1-7 | 后端**无依赖清单、无 CI** | 无 `requirements.txt` / `pyproject.toml` / `.github`；`akshare` 未锁版本 | 换机/迁移不可复现 | 补 `requirements.txt`（含版本）+ 一条最小 CI（`pytest` + 前端三门） | `pip install -r requirements.txt` 在干净 venv 跑通 `pytest tests/` |

### P2 · 结构与体验

| # | 问题 | 证据 | 目标 |
|---|---|---|---|
| P2-1 | `shared/api/types.ts` **2658 行**单文件 | `wc -l` | 按域拆分（market / decision / analytics / system），barrel 保持导出不变 |
| P2-2 | 巨型后端文件：`build_cards.py` 3801 行、`live_signal.py` 2813 行、`intraday_pulse.py` 2354 行 | `wc -l` | 按职责拆模块；先抽纯函数（可单测）再迁移 |
| P2-3 | 依赖有可用小版本更新 | `npm outdated`：react-router 8.3.1→8.4.0、vite 8.3.0→8.3.4、react 19.3.0→19.3.1、zod 4.6.5→4.6.7、oxlint 1.83→1.88 | 每月一次「小版本批更」，每次只更一组并跑全门禁 |
| P2-4 | `typescript 7.0.2` 为大版本 | `npm outdated` | 单独排期，先跑 `tsc` 兼容性 |
| P2-5 | 页面无统一「数据截至」标识（仅顶栏） | 顶栏有全局刷新时间，单卡无各自时点 | 卡片级 `title` 或角标携带 `generated_ts`，不改布局 |
| P2-6 | `/timeline` 测试依赖「今天有归档」 | 周末运行必红（本轮实际红） | 测试钉死时钟或按「最近有效日」断言 |

---

## 3. 演进与学习方案（三阶段）

### 阶段一 · 让系统「可信」（1~2 周，不改页面结构）

1. **单一发布契约**：`zt_pool`（当日涨停池）成为唯一事实源，`feedback_matrix` / `memory` / `capture_daily` / 前端全部只读它；`data_ready` 保留一致性闸门。
2. **数据新鲜度中心**：`/record` 升级为「路由 × 文件 mtime × 业务日期 × cadence × 是否 retired」的表格，>1 交易日高亮；停更路由停止轮询。
3. **权限态与空态分离**：生产白名单外的页面显示「生产环境未开放」，⛔ 不显示空表。
4. **依赖可复现**：`requirements.txt` + 最小 CI + 可用漏洞扫描通道。

**学习点**：把「数据看起来正常」和「数据可被证明正确」分开 —— 前者是 UI，后者是契约。

### 阶段二 · 提升判断质量（2~4 周）

1. `/mainline` 拆「核心龙头 / 跟随宽度 / 资金回流」，禁止按涨停数量单一排序。
2. `/effect` 拆「现在发生 / 昨天兑现 / 明天验证」三层，颜色与标题区分事实与预测。
3. `/ai` 固定三日期：预案写作日、执行日、09:25 裁决时间；禁止「今日/昨日」相对词。
4. `/promotion`、`/lhb`、`/carrier` 各自统一「汇总截至 / 明细截至」双时间。
5. 修 P1-3（折叠守恒）、P1-4（名额不变量）、P1-6（枚举回落定性）。

**学习点**：同一个指标只允许一个口径；口径变更必须同时改**读方**与**测试**。

### 阶段三 · 降低维护成本（4 周+）

1. 拆 `types.ts`、抽 `features/*/api` 编排层，页面只留渲染。
2. 后端巨文件按「采集 / 计算 / 发布」拆分，纯函数优先单测。
3. 路由 cadence 成为 query 刷新的**唯一来源**（页面不再各自猜轮询）。
4. 建立「月度体检」：门禁 + 龄期 + 体积 + 依赖更新，一次出报告。

---

## 4. 门禁与基线（2026-10-18 实测）

| 门禁 | 结果 |
|---|---|
| `npm run arch` | ✓ 分层边界校验通过 |
| `npm run typecheck` | ✓ 无输出 |
| `npm run lint` | ✓ 0 warning / 0 error（159 文件，134 规则） |
| `npm run build` | ✓ built in 2.67s（主包 583KB 触发体积警告） |
| `npm run data` | ✓ 79/79 可用，缺失 0；6 条路由 >300KB |
| `npm run test`（全量） | 557 passed / 10 failed（6 文件） |

**10 个失败用例的归属**（全部为既有基线，与本次布局改造无关）：

| 文件 | 数量 | 根因分类 |
|---|---:|---|
| `ai-judge-detail.test.tsx` | 2 | 排序期望与「名称+代码同显」夹具漂移 |
| `event-segments.test.ts` | 3 | 事件折叠不守恒（**真实缺陷候选，P1-3**） |
| `intraday-board.test.tsx` | 2 | 页面栏位已改（3 卡→2 卡）+ 周末 `feedback=pre_auction` 导致卡片不渲染 |
| `all-pages-render.test.tsx` | 1 | 断言「今天有归档」，周末必然不成立 |
| `plain-labels.test.ts` | 1 | 2 处枚举回落（P1-6，待定性） |
| `pool-call-route.test.ts` | 1 | 名额不变量（P1-4，**真实数据问题**） |

---

## 5. 附录 · 关键量化指标

**代码体量**：前端 `src` 31,096 行（最大 `shared/api/types.ts` 2658）；后端 `scripts+common+wealth_code` 52,422 行（最大 `build_cards.py` 3801）。
**前端依赖**：15 个包有可用更新（其中 1 个大版本 `typescript 7`）。
**后端依赖**：近乎纯标准库，第三方仅 `akshare` 等少数，且无版本清单。
**数据路由**：79 条全部可用；龄期 ≥48h 共 29 条，≥800h 共 4 条。
**安全**：`serve.py` 已改为安全默认；`npm audit` 通道不可用（P0-3）。

---

## 6. 下一步建议（可直接派工）

1. 用本报告 P0-1~P0-4 建 4 张单，逐项验收（不改页面结构）。
2. P1-3 / P1-4 先定性再修：若确实是缺陷，写不变量测试（守恒 / 名额自洽），做变异验证。
3. 视觉基线：以 1920 / 1440 两张截图为准，后续任何外壳改动都要复测三段宽度。

---

## 7. 第二批 · 29 个 Tab 逐页扫描与精细化优化（2026-10-18 下午）

扫描方式：3 个只读审计并行覆盖 29 页（实时/盘面 10、决策/题材 10、数据/运维 9），
逐页记录「布局原语 / 数据源 / 是否显示数据日期 / 688 过滤 / 明显缺陷」，再按**可验证性**分批落地。

### 7.1 共性缺陷（跨页，优先修）

| 类别 | 实测范围 | 后果 |
|---|---|---|
| 688/689 未过滤 | `/lhb`（688835 实测出现）、`/archive`（688592 实测出现）、`/mainline`、`/board-core`、`/promotion`、`/effect`、`/reflow`、`/rotation`、`/institution`、`/auction` | 用户无权限却看到可投标的 |
| 陈旧数据当当前 | `/hithink` 估值 53 天、`/stack` 周地图 5 周、`/system` 引擎 45 天、`/cards` 复盘 38 天/龙虎榜 19 天、`/ops` 脉冲档 45 天 | 「不知道」被显示成「现在是 0 / 持平」 |
| 裸枚举上屏 | `/promotion` stage、`/auction` regime、`/execution-audit` caliber/bucket、`/archive` role、`/backtest` 动态英文表头 | 面向机器的输出 |
| 双滚动条 | `/` rail 60vh、`/timeline` 左栏 calc(100vh)、`/flow` 62vh、`/gene` 70vh、`/stack` 68vh | 页面滚动与卡片内滚动叠加 |
| 空态无原因 | `/`、`/effect`、`/ambush`、`/institution`、`/execution-audit` | 分不清「没跑」与「跑了没数据」 |

### 7.2 本轮已落地（13 项，全部通过门禁）

| # | 页面 | 改动 | 验证 |
|---|---|---|---|
| 1 | 全局 | 新增 `shared/lib/freshness.ts`（`staleDays` / `staleLabel`，按**北京自然日**计龄） | `tests/freshness.test.ts` 9 passed |
| 2 | 全局 | 新增 `tradableStocks()`（唯一 688/689 过滤口径，含 `600688` 不误杀） | 同上 |
| 3 | `/record` | `/api/health` 由 37 条扩到 **76 条**（纳入目录型）；新增 `kind/cadence/retired/asof`；目录探针改按 **mtime** 取最新（原按文件名字典序） | 页面实测 76 源 / 缺失 0 / 已停更 3 |
| 4 | `/record` | 龄期告警改按节拍分档（盘中 4h、日频 36h、manual/retired 与周末不告警） | 旧规则周末 33/37 全黄 → 现 0 误报 |
| 5 | `/record` | 新增 KPI「业务日期落后」（14 条真滞后）、新增「业务日期 / 节拍 / 目录」列；健康总表改**通栏**（7 列挤在 42% 栏里横向溢出） | 截图 `output/tab-record-health.png` |
| 6 | `/mainline` | `zt_prev == null` 不再显示「环比持平（null 家）」→「昨日无此题材」 | 新增 `DeltaBadge` 分支 |
| 7 | `/mainline` | 涨停股清单接入 `tradableStocks` | 类型 + 渲染测试通过 |
| 8 | `/auction` | 早鸟涨幅 `+{num}%` → `fmtPct`（负数不再输出 `+-3.2%`，颜色按方向） | — |
| 9 | `/lhb` | 无榜单时不再显示「机构合计净买 0.00 亿」→「无当日榜单」；机构表与游资席位内层个股接入 688 过滤 | — |
| 10 | `/stack` | 盘中 `HH:MM` 混入日期轴不再产生空表头（`dayLabel` 分支）；周地图徽标改为真实周区间 + 「已停更 N 周」；「本周」改「该周」 | 类型 + 页面测试通过 |
| 11 | `/hithink` | 估值卡补数据日期 + 停更徽标（实测 2026-08-26） | 截图可见 `已停更 1 个月` |
| 12 | `/archive` | 涨停池接入 688 过滤，并显示「已剔除科创 N 只」 | 10-16 池实测剔除 1 只 |
| 13 | `/cards` | 库存卡补「已停更 N 天/周」徽标 | — |

### 7.3 测试口径修正（1 项）

`tests/all-pages-render.test.tsx` 的 `/timeline`「盘中默认日」断言把系统时间伪造成 2026-09-21，
却取**全局最新**归档（2026-10-16）比较 → 周末/换月必红。现改为取「≤ 伪造今天」的最新归档，
31 passed。

### 7.4 本轮门禁结果

| 门禁 | 结果 |
|---|---|
| `arch` | ✓ 通过 |
| `typecheck` | ✓ 无输出 |
| `lint` | ✓ 0 warning / 0 error（161 文件） |
| `build` | ✓ built in 2.36s |
| `data` | ✓ 79/79 可用 |
| 定向测试（8 文件） | 109 passed / 2 failed（仅 `intraday-board` 两个既有基线：栏位定稿漂移 + `pre_auction` 空态） |

### 7.5 仍未做（按价值排序，供下一轮派工）

1. **双滚动条治理**：`/`、`/timeline`、`/flow`、`/gene`、`/stack` 五处内层 `max-h-*`，建议统一「页面单一滚动 + 表格分页」。
2. **裸枚举收口**：`promotion.stage`、`auction.regime/band`、`execution-audit.caliber/bucket`、`archive.role`、`backtest` 动态表头 —— 扩展 `plain.ts` 词表并加契约测试（本轮未动，因需先实测每个枚举的真实取值）。
3. **688 过滤补全**：`/board-core`、`/promotion`、`/effect`、`/reflow`、`/rotation`、`/institution`、`/auction` 七页。
4. **停更标识补全**：`/ops` 脉冲档、`/system` 引擎、`/carrier` 非交易日空转。
5. `/ai` 历史日期仍写「今晨 09:25 裁决」；`/execution-audit` 未渲染 `generated_at_bj`。

---

## 8. 第三批 · 按 7.5 清单收口（2026-10-18 15:00）

### 8.1 裸枚举收口（先实测取值，再建词表）

| 字段 | 实测取值来源 | 词表 |
|---|---|---|
| `promotion.stage` | `cache/promo/promo_summary.json`：`1to2 / 2to3 / 3to4 / 4to5+ / "None"` | `STAGE_PLAIN` → 1进2…4进5及以上 |
| `decision.regime` | `wealth_code/cache/candidates*.json`：`ice` | `REGIME_PLAIN` → 冰点/退潮/修复/亢奋/进攻/中性/防守/空仓 |
| `manifest.role` | `cache/decision_log/<日期>/manifest.json`：`card / candidates / ai_view / zt_pool_data` | `ROLE_PLAIN` |
| `execution_audit.caliber` | 同上文件：`ai` / 空串 | `CALIBER_PLAIN`（空串→`—`，⛔ 不回落「机械」） |
| `execution_audit.bucket` | 同上文件：`relay / watch` | `BUCKET_PLAIN` → 接力位/观察位 |
| 回测明细动态列 | `cache/backtest_report_*.json` | `BACKTEST_FIELD_PLAIN` + `backtestFieldText()`；未登记字段显式标「未登记字段(x)」 |

落地页：`/promotion`（两处 stage）、`/auction`（regime）、`/execution-audit`（caliber/bucket）、`/archive`（role）、`/backtest`（表头）。
守卫：`tests/plain-enums.test.ts` 9 项（含「未知 token 必须回落未识别」）。

### 8.2 688/689 过滤补全

本轮新增：`/effect`、`/auction`（接力池/观察池/候选）、`/rotation`（观察池/主板池）、`/institution`（机构池分组）。
加上第二轮的 `/mainline`、`/lhb`、`/archive`，现共 **7 页**统一走 `tradableStocks()`。
⛔ 两处**确认不适用**（不是遗漏）：`/reflow` 的 `calm/moved` 是**题材级** `RotationCandidate`（无 `code`）；
`/lhb` 的游资「席位」本身无代码，已改为过滤席位**内层**个股列表。

### 8.3 停更标识补全

| 页面 | 改动 | 实测 |
|---|---|---|
| `/ops` | 「当日推送 N 条」→「最新归档 N 条」（实为 10-16）；脉冲卡「当日 X 张」→「该日 X 张」+ 停更徽标 | 页面出现「已停更 1 个月」 |
| `/system` | 引擎状态件逐件按 `date` 判龄期；区块名去掉「60s 刷新」→「盘中引擎状态件（含历史留档）」 | 同上 |
| `/carrier` | `feedback.error` 分支显示「非交易时段 · 未计算」+ 后端 `msg`，不再拿「刚生成的时间」冒充盘中更新 | 周末实测 |
| `/execution-audit` | 顶部显示 `generated_at_bj` + 审计滞后徽标（此前类型有字段但页面从不渲染） | 截图可见 |

### 8.4 双滚动条治理（部分）

- `/` 短线精灵 rail：移除 `max-h-[60vh] overflow-auto`，只留页面单一滚动。
- `/timeline` 左侧详情：移除 `max-h-[calc(100vh-190px)]`。
- ⛔ **刻意保留** `/flow`（62vh）、`/gene`（70vh）、`/stack`（68vh）的内层滚动：这三页表格 200+ 行，
  取消限高会把页面拉到数千像素。正确解法是「分页 + 单滚动」，属独立任务，不宜在本次顺带改。

### 8.5 门禁

`lint` 0/0（162 文件）、`arch` ✓、`typecheck` ✓、`build` ✓ 2.27s、`data` 79/79、
定向测试 6 文件 **71 passed**（新增 `plain-enums` 9 项）。

---

## 9. 长列表虚拟化 + 高度不超屏（2026-10-18 15:40 用户硬要求）

用户原话：「**高度设置为最高 100vh，反正不要超出屏幕；都用上虚拟列表**」。

### 9.1 高度契约：为什么不能写 `100vh`

实测盘中页信号栏的**起始位置会变**：顶栏 46 + 主区 padding 24 + 可选提示条 / 退潮横幅
⇒ 实测 top 从 70 变到 **172**。写死 `100vh` 必然溢出 172px；写 `calc(100vh-84px)` 也会超 88px。

最终做法 —— `useViewportFill()`：

```text
高度 = window.innerHeight − 元素 getBoundingClientRect().top − 10
```

监听 `resize` + `ResizeObserver(document.body)`（提示条/横幅出现会让 top 变化）。
实测结果：

| 视口 | 信号栏 top | 高度 | 底边 | 是否超屏 |
|---|---:|---:|---:|---|
| 1920×1080 | 172 | 898 | 1070 | 否 ✅ |
| 1440×900 | 172 | 718 | 890 | 否 ✅ |

### 9.2 虚拟列表原语（零依赖，30 行核心）

`src/shared/ui/VirtualList.tsx`：
- `windowRange()` 纯函数（可单测）：`scrollTop → { start, end, padTop, padBottom }`；
- `useVirtualRows()`：绑定 onScroll；
- `useMeasuredHeight()`：ResizeObserver 量容器高度；
- `useViewportFill()`：按视口剩余空间给高度；
- `<VirtualList>`：容器 + 上下占位 + 只渲染可见片段。

⛔ 一个真实边界 bug 已修：`scrollTop` 越界（切筛选后旧值仍在）时 `start` 会算到 31 万，
`slice()` 返回空数组 → **表格整块空白**。现在 `start` 被夹在「最后一屏起点」以内，并写入单测。

### 9.3 已接入虚拟化的位置

| 位置 | 行数 | 渲染节点 | 说明 |
|---|---:|---:|---|
| `/` 短线精灵 `SignalRail` | ~63 | **30** | 固定高度 + 内部滚动，行高 46（含首/末两行） |
| `/gene` 逐票主表 | 205 | **39** | 自定义表加窗口 + 上下占位，行高 32 |
| `/flow` 板块资金逐日表 | 多 | — | `DataTable virtual`，表头 sticky |
| `/archive` 决策涨停池 | 61 | — | 同上 |
| `/record` 健康总表 | 76 | **13** | 实测 13 行渲染、滚动高度 2463 |

`DataTable` 新增 `virtual` / `heightClass` 两个可选属性，默认行为**完全不变**（有单测锁：
未开 virtual 时 500 行全量渲染）。

### 9.4 仍未虚拟化的位置（诚实边界）

`/stack` 题材×日矩阵、`/lhb` 两源榜单、`/cards` 137 期列表 —— 这三处行高不固定或为分组折叠结构，
需要先固定行高（或改成分页）才能安全虚拟化，否则会出现「空白缝 / 跳行」。
原语已就绪，下一轮逐个接入即可。

### 9.5 门禁

`lint` 0/0（164 文件）、`typecheck` ✓、`build` ✓ 2.20s、定向 6 文件 **74 passed**
（失败 2 项为 `intraday-board` 既有基线：中栏定稿 3→2、`pre_auction` 空态）。

---

## 10. 侧栏重点标记改星标 + 节点详情面板定高（2026-10-18 21:20）

### 10.1 侧栏重点入口：整行底色 → 右侧五角星

原做法：重点 Tab 用 `bg-white/[0.07]` + 左侧 2px 红条**整行高亮**。问题：多条重点同时存在时
侧栏出现一片深浅不一的色块，与「当前页高亮」抢视觉，反而看不出重点在哪。

现做法：底色只表示**当前页**；重点入口在行尾加一颗 `★`（`text-head-up`，11px，`aria-label="重点盯盘"`）。
`data-priority` 属性保留（导航测试与埋点依赖），点击行为不变。

实测：5 个重点入口（盘中实时 / 主线题材 / 情绪周期 / AI竞价 / AI尾盘潜伏）各带一颗星，其余入口无星。

### 10.2 节点详情：固定高度 + 虚拟列表（不再顶开页面）

**现象**：`TimelineDetailList` 的虚拟滚动视口只有 `min-w-0`，没有高度上限 → 内容多高就长多高，
整页被顶出屏幕，滚动条落在页面上而不是面板内（用户：「现在的这个滚动也把那个高度顶开了」）。

**修复**：复用 `useViewportFill()` 给面板算高度（与 `SignalRail` 同一套契约），
内部视口 `flex-1 min-h-0 overflow-y-auto`。虚拟列表本身早已实现（实测高度回填 + 前缀和定位），本轮只是补上高度约束。

实测：

| 视口 | 面板 top | 高度 | 底边 | 超屏 | 内部滚动 | 渲染条目 |
|---|---:|---:|---:|---|---:|---:|
| 1920×1080 | 193 | 877 | 1070 | 否 ✅ | 853 / 21565 | 8 / ~56 |
| 1440×900 | 193 | 697 | 890 | 否 ✅ | — | — |

### 10.3 顺带修掉一个分层违规

`Table.tsx` 之前从 `@/shared/ui/VirtualList` **深路径**导入，`npm run arch` 直接拦下
（shared 必须走 barrel）。已改回 `@/shared/ui`。这条正是 arch 门禁存在的意义 ——
不跑就发现不了，因为运行期完全正常。

### 10.4 门禁

`arch` ✓、`typecheck` ✓、`lint` 0/0（164 文件）、`build` ✓ 2.15s、定向 5 文件 **56 passed**
（`nav-render` 断言已按「星标」重写：重点必带星、非重点不得带星、且不得再用整行底色）。

---

## 11. 时间轴节点形状规范 + 顶部图例（2026-10-18 21:40）

用户：「不用全部用椭圆柱体，可以用三角形、圆形等标示不同信号；立一下标准；顶部给每个图形做解释」。

### 11.1 标准：形状是第一编码，颜色是第二编码

理由：颜色在色盲、强光屏、缩放下都会失真；「三角朝上 / 朝下」不会看错。故：

| 形状 | 信号（kind） | 含义 | 颜色 |
|---|---|---|---|
| ▲ 上三角 | `burst` | 题材首次爆发 / 续强 | 大红（首爆实心、续强半档） |
| ▼ 下三角 | `risk` | 炸板 / 负反馈 / 板块杀跌 | 绿 |
| ◆ 菱形 | `linkage` | 同刻多板块联动 | 红 |
| ● 实心圆 | `up` | 板块或个股走强（未成爆发） | 红 70% |
| ○ 空心圆 | `rotation` | 旧题材回流 / 龙头切换（**不是**新爆发） | 紫描边、内部透明 |
| ■ 方块 | `system` | 低频系统观测合并 | 灰 |
| │ 细竖线 | `normal` | 单个封板 / 推送事实点 | 灰 |

**尺寸仍表示活跃度（高度），形状只表示性质** —— 两者正交。

### 11.2 实现

- 新规范落在 `lib/snake.ts`：`SignalKind` / `SignalShape` / `SIGNAL_SHAPE`（含中文名与解释）/ `SHAPE_LEGEND_ORDER`（按重要度排序）/ `shapeBox()`（纯函数：形状 → 盒子尺寸 + `clipPath`/圆角/描边）。
- 三角/菱形用 `clip-path` 裁剪、圆形用 `border-radius: 9999px`、空心圆额外给 1.5px 描边；
  **普通事实保持 10px 窄条**（宽度不随高度变粗，否则满屏粗条会淹没信号）。
- 节点标记新增 `data-node-shape`，供样式与测试定位（⛔ 不再用宽度选择器筛节点）。
- 顶部图例 `<ShapeLegend>`：7 项，每项「图形 + 名字 + 悬停解释」，**与节点渲染共用同一套 `SIGNAL_SHAPE` + `shapeBox`**（各写一套必然漂移）。

### 11.3 实测（10-16 数据）

图例渲染：`图形说明 首爆 风险 联动 走强 轮动 记录 事实 高度 = 该刻活跃度`；
节点形状分布：`triangle-up 7 / triangle-down 1 / square 5 / bar 41`（当日无联动/轮动节点，故菱形与空心圆未出现 —— 属数据分布，不是未实现）。

### 11.4 门禁

`lint` 0/0（164 文件）、`arch` ✓、`build` ✓ 2.09s、定向 4 文件 **135 passed**
（新增：形状唯一性、尺寸上下限、`clip-path`/描边断言、节点形状渲染、图例 7 项文案）。

### 11.5 追加（21:58）：图标改为**等大**，不再随活跃度缩放

用户：「三角符号还是一样大吧，不要忽大忽小……就不要再控制这个 icon 的大小了」。

- 新增 `SHAPE_ICON_SIZE = 14`：三角 / 菱形 / 圆 / 空心圆 / 方块一律 14px 基准盒（各自微调 1–5px 保持视觉等重）。
  实测每类形状**只有一个尺寸**：`triangle-up 14×14`、`triangle-down 14×14`、`square 9×9`。
- ⛔ 不再对图标做 `clamp(h*0.8, 10, 20)` 这类随动缩放 —— 同轴上 9px 和 20px 的三角看起来像两种信号，
  实际只是活跃度不同，纯噪声。
- 活跃度**只由细竖线（普通事实）的高度**表达（实测 13–20px 仍随活跃度变化）；图例文案同步为
  「图标等大 · 竖线高度 = 活跃度」。
- 测试改为锁「等大」：同一形状在 height=8 与 46 时宽高完全相同、且正反三角同尺寸。

---

## 12. 竞价资金榜（吸收同类产品思路 · 2026-10-19）

### 12.1 从截图吸收到的四个设计点

| 设计点 | 原产品做法 | 我们的落地 |
|---|---|---|
| 多维排序切换 | 竞价净额 / 竞额 / 净额占比 / 竞价换手 四个 tab | 竞额 / 竞价涨幅 / 占榜内比 三个 tab |
| 一行一结论 | 净额占比 ≥45% 整行暖黄 | 高开 ≥5% **且** 竞额 ≥ 榜内中位数 → 暖黄 |
| 先给头部再展开 | 默认 20 行 +「展开其余 12 只」 | 默认 12 行 +「展开其余 N 只」+ 收起 |
| 口径写在卡上 | 副标题写清排序键与高亮阈值 | 卡片副标题同样写清，并声明「净额不造」 |

### 12.2 ⛔ 没照抄「竞价净额」——我们算不出来

`auction_quotes-<date>.json` 只有四个字段：`prev_close / auction_price / auction_amount_yi / time`。
**净额 = 主动买成交 − 主动卖成交**，需要逐笔委托方向；用涨幅乘金额去凑净额属于编造，不做。
同理「净额占比」也缺分子。

要补这一列，需要后端新增数据源（逐笔委托 / 竞价成交明细），不是前端改公式能解决的。

### 12.3 实际落地：`/auction` 顶部「💰 竞价资金榜」

- 数据：`/api/decision/auction-history` 取最新一份（代码只有 4 位代码，名称用**昨日涨停池**补齐）。
- 列：`# / 股票 / 竞价涨幅 / 竞额(亿) / 占榜内比 / 撮合时刻`。
- 三个可证事实：涨幅 = price/prev−1；竞额 = 落盘金额；占榜内比 = 该票竞额 / 榜内合计
  （⛔ 明写「榜内」，不是全市场）。
- 高亮：`涨幅 ≥ 5% 且 竞额 ≥ 中位数` —— 只高开没量的是假高开，只放量不涨的是承接盘。
- 纯函数 `buildAuctionRows / sortAuctionRows / median`（`lib/auction-money.ts`），8 项单测。

实测（2026-10-19）：59 只有效报价，榜首 新华传媒 600825（竞额 4.61 亿 / −1.06%）、
万丰奥威 002085（3.05 亿 / +9.89%，暖黄）、江淮汽车 600418（1.03 亿 / +2.82%）。

### 12.4 门禁

`lint` 0/0（167 文件）、`arch` ✓、`build` ✓ 2.45s、定向 2 文件 **39 passed**。
