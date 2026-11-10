# 狸猫终端 · 系统体检报告

> 日期：2026-11-09（周一，交易日收盘后 15:50 左右）
> 范围：前端 `狸猫终端`（React 19 + Vite 8）+ 只读数据源 `狸猫猎手`
> 方式：全量门禁（lint / arch / typecheck / test / build）+ 路由体检 + 活体探针（dev 5181 + /api/health）
> 口径：**实测优先**；推断项显式标注「待确认」。

---

## 0. 结论摘要

| 维度 | 结论 |
|---|---|
| 构建链 | **本轮修复**：`vite build` / `vitest` 原本**完全无法加载配置**，已定位为原生绑定版本错配并修好 |
| 构建产物 | 通过（1.13s），`dist` 37 个资源 / 1.5MB；主包 **619KB（gzip 193KB）** 仍超 500KB 警戒线 |
| 分层与类型 | 健康：`arch` ✓、`tsc --noEmit` ✓、`oxlint` 0 warning / 0 error（214 文件） |
| 路由 | `data` **88/88 可用，缺失 0**；`parity` 88/88 双源逐键一致 |
| 测试 | **877 passed / 6 failed**（55 文件）。6 条红灯**全部是既有基线**，未提交改动未新增红灯 |
| 活体 | dev 服务 5181 在线，`/api/health` 200；今日快照 `15:00:06` 落盘（涨停 54 / 炸板 45 / 跌停 2 / 情绪偏强） |
| 数据新鲜度 | 36 条 ≤6h；**18 条 >7 天**，其中龙虎榜链停更约 41 天，需确认 |

一句话判断：

> **系统本身是活的、数据是今天的**；真正卡住交付的是**构建链的原生二进制错配**（已修）与**6 条口径漂移的红灯测试**（未修，需业务二选一）。

---

## 1. 本轮修复 · 构建链断裂（P0）

### 现象

| 命令 | 修复前 |
|---|---|
| `npm run build` | `failed to load config from vite.config.ts` → `sourcemapPathTransform option: The function returned object, but expected string` |
| `npm test`（`vitest run`，默认 configLoader=bundle） | 同上，**一条测试都跑不起来** |
| `vite build --configLoader runner` | 能过 config，但在 `generateBundle` 崩：`bindingChunk.getCodeIdentity is not a function` |
| `npm run dev` | 正常 —— 因为脚本带了 `--configLoader runner`，**把问题遮住了** |

`dev` 能用、`build`/`test` 不能用，说明不是配置写错，而是**工具链底层**的问题。

### 根因（已实测，非推断）

1. 本机 Node 是 **x64**：`/usr/local/opt/node@22/bin/node`，`process.arch = x64`（V22.22.2）。
2. `node_modules` 是 **pnpm 布局 + npm 残留**的混合体：
   - pnpm 树：`vite@8.3.5` + `rolldown@1.2.16`，原生绑定却只装了 **`@rolldown/binding-darwin-arm64@1.2.16`**（与 x64 Node 不匹配）；
   - 根目录残留 npm 装的 `rolldown@1.2.8` + `@rolldown/binding-darwin-x64@1.2.8`（`npm ls` 标记为 extraneous）。
3. 运行时：JS 侧走 pnpm 的 **rolldown 1.2.16**，绑定侧因 arm64 不可用而回落到根目录的 **x64 绑定 1.2.8** → **JS 1.2.16 × Native 1.2.8 混搭**，新 API（`getCodeIdentity`、新的 `sourcemapPathTransform` 签名）在旧绑定上不存在，于是报上述两类错。
4. 该版本校验默认被 `NAPI_RS_ENFORCE_VERSION_CHECK` 关闭，所以不会给出「版本不匹配」的明确提示，只表现为两个看似无关的内部错误。

### 处置

把 x64 绑定换成与 JS 同为 1.2.16：`@rolldown/binding-darwin-x64@1.2.16` 装入 `node_modules/@rolldown/binding-darwin-x64`。

修复后实测：

- `npm run build` → `✓ built in 1.13s`，`dist` 重新生成；
- `npm test`（默认 bundle loader）→ 正常加载配置并跑完 883 条。

### ⚠️ 残留风险与根治方案

当前修复是**手工塞进 `node_modules`** 的，`node_modules` 不入库 ⇒ **换机 / 重装依赖会复发**。三选一：

| 方案 | 说明 | 评价 |
|---|---|---|
| A. 在 x64 Node 下重装 | 删 `node_modules` 后 `pnpm install`（node 仍为 x64） | **推荐**：让 pnpm 按当前平台装 x64 绑定 |
| B. 改用 npm 一条道 | 删 `node_modules` + `pnpm-lock`，`npm ci`（lock 锁 vite 8.3.0 + rolldown 1.2.8，两者自洽） | 可行，但等于回退 vite 小版本 |
| C. 换 arm64 Node | 装 arm64 Node 并重装依赖 | 可行，但会改动用户环境 |

另：仓库同时存在 `package-lock.json`（npm）与 pnpm 布局，是本次混合污染的源头，**建议二选一后删掉另一份锁文件**。

---

## 2. 门禁明细

| 门禁 | 结果 |
|---|---|
| `npm run lint` | 0 warning / 0 error（214 文件，134 规则） |
| `npm run arch` | ✓ 分层边界无反向依赖（shared ← features ← pages ← app） |
| `npm run typecheck` | ✓ 无输出 |
| `npm run data` | **88/88 可用，缺失 0**；合计体积 13.5MB；13 条路由 >300KB（最大 `/api/decision/candidates` 2.1MB） |
| `npm run parity` | ✓ routes.ts 88 ↔ serve.py PUBLIC_ROUTES 88 逐键一致 |
| `npm test` | **877 passed / 6 failed**（3 文件） |
| `npm run build` | ✓ 1.13s；主 chunk 619KB（gzip 193KB），超 500KB 警告 |

超体积路由（建议限流/分页，非阻断）：`/api/decision/candidates` 2.1MB、`/api/decision/archive` 2.1MB、`/api/decision/latest` 893KB、`/api/market/relay-effect` 848KB、`/api/data/theme-snapshot` 599KB。

---

## 3. 六条红灯逐条归因

> 三类根因：**测试夹具过期**（2 组）、**产品口径冲突**（1 组）、**数据口径变更使断言失效**（1 条）。**都不是**未提交改动引入的。

### 3.1 `event-segments.test.ts`（3 条）· 夹具用了开盘前时点

- 文件最后改动 2026-09-23，而 `timeline.ts` 在 2026-10-18 改过（`SESSION_OPEN = 09:25`，见 `src/features/analytics/lib/snake.ts:2`）。
- 夹具把「分歧首次出现」放在 **09:19**（集合竞价期）→ 被 `inTimelineSession` 判为盘外直接丢弃，后续 `09:32` 的「回摆」因此变成首次出现，折叠标记、条数守恒三条断言连锁失败。
- 实测证据：`buildTimeline` 输出的 4 个节点里没有 09:19，`folded` 只剩 2（期望 4）。
- **修法二选一**（产品口径）：① 夹具时点改到 ≥09:25（认可「时间轴只放交易时段」）；② 若要保留竞价留痕，改 `SESSION_OPEN=09:15` 并同步回归。

### 3.2 `ai-judge-detail.test.tsx`（2 条）· `7144fc3`（09-29 StockLink 统一）后口径漂移

| 测试要求（09-28 写入） | 当前实现（`AiJudgeDetail.tsx`） |
|---|---|
| ① 名称 **+ 代码**同时出现 | `StockLink` 只渲染 `name \|\| code`（:235-236），**代码丢了** |
| 同一裁决档内，板块龙 / 空间高度 **优先于**低位高分票 | 排序先比 `score`，再比 `is_sector_dragon`/`boards`（:159-176），**高分票排前** |

两条都是「代码说 A、测试说 B」，需业务定夺：改代码（回到 09-28 规则）还是改测试（承认 09-29 起的新口径）。

### 3.3 `page-charts.test.tsx`（1 条）· 数据口径变了，断言前提没了

- 断言「情绪偏差柱」必须存在（`dataRects > 0`）。
- 真实数据显示：`backtest_report_2026-10-16` 起，`summary.sentiment_diff` **恒为 null**；`candidate_hit_rate` 自 10-16 起也基本为 null。
- 报告内自带原因，属**设计性空值**而非数据缺口：
  - `candidate_hit`：`当日零参与（stance=defend），nav 无账可写 → 真空仓，非数据缺口`
  - `sentiment_align`：`「情绪X/10」为昨日实际分（回顾语境），非明日预判，不采用`（该指标已被废弃）
- 故「走势图必须有情绪偏差柱」这一断言在当前口径下**永远不可能成立** → 测试应改成夹具驱动（或断言「无该指标时给出空态」），不要依赖真实数据。

---

## 4. 数据新鲜度（/api/health，85 条路由）

| 龄期 | 条数 |
|---|---|
| ≤6h | 36 |
| 6–48h | 4 |
| 48–168h（周末/近几日正常） | 24 |
| 168–720h | 4 |
| **>720h（>30 天）** | **14** |

**需确认的重点停更项**：

| 路由 | 龄期 | 说明 |
|---|---|---|
| `/api/lhb/tencent`、`/api/card/lhb` | ≈982h（41 天） | 龙虎榜链自 09-29 起无产出，页面会长期显示旧榜 |
| `/api/decision/execution-audit` | ≈1016h | 执行审计（候选冻结/裁决/收益缺口）停更 |
| `/api/system/rules` | ≈1823h（76 天） | 策略规则配置未动（**可能本就该静态**，仅提示） |
| `/api/hithink/valuation` | ≈1792h（75 天） | 同花顺估值回填停更 |
| `/api/promo/backtest`、`/api/board/core` | ≈1464h（61 天） | 晋级回测、板块核心票长期未重算 |

> 另有 3 条 `retired`（如 `auction_live`，desc 已注明「已停更·无写入方」），属预期退役。

---

## 5. 未提交改动（工作区）

`14 改 + 2 新增`（wealth 决策板 / 池内台账 / 今日裁决 / AI 页 / 数据层 schema+types+plain / 5 个测试 / vite 代理新增 `participation-quotes`）。

- 相关测试全绿：`wealth-decision-board` 31、`wealth-nav-table-order` 6、`pool-call-route` 6、`plain-labels` 13、`all-pages-render` 35。
- 与 HEAD 基线对比（同环境）：HEAD 在同样 3 个文件里红 **17** 条，当前工作区红 **6** 条 —— 未提交改动**净修复 11 条**（主要是数据层解析修复后，page-charts 12 条恢复 11 条）。
- 结论：这批 WIP 是**改进**，建议尽快提交，避免长期挂在工作区。

---

## 6. 建议下一步（按优先级）

1. **P0 固化构建链**：按方案 A 在 x64 Node 下 `pnpm install`（或统一改用 npm），并删掉多余的锁文件 —— 否则换机/重装必复发。
2. **P1 收口 6 条红灯**：先定 `SESSION_OPEN` 与 AI 明细排序/代码展示两条口径，再统一「测试改」或「代码改」；`page-charts` 那条改成夹具驱动。
3. **P2 数据新鲜度**：确认龙虎榜链（41 天）与执行审计是否应继续产出；超 300KB 的 13 条路由补 `limit`/`latest`。
4. **P3 包体**：主 chunk 619KB，按页已分包（37 个资源），可再把 `analytics` 三方依赖做手写 chunk 拆分。

---

## 附：复现命令

```bash
cd 狸猫终端
npm run lint && npm run arch && npm run typecheck   # 应全绿
npm run data                                        # 88/88
npm run parity                                      # 88/88
npm test                                            # 877/883
npm run build                                       # 1.1s
curl -s http://127.0.0.1:5181/api/health | head -c 300
```
