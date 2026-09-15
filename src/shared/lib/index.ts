/**
 * 共享工具 —— **纯函数，无框架依赖、无副作用**。
 *
 * ⚠️ 分层铁律：本层禁止 import react / 上层任何模块。
 *    这一条使 shared/lib 可以被 Node 脚本、测试、甚至另一个前端框架直接复用
 *    （本项目里 `semantic.ts` / `marketTime.ts` 就同时被 Vue 版复用）。
 */

export { cn } from './cn'
export * from './semantic'
export * from './marketTime'
export * from './chart'
