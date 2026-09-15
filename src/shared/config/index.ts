/**
 * 配置域 —— **公开出口**。
 *
 * 上层只允许 `from '@/shared/config'`。这样将来配置来源从「静态常量」换成
 * 「运行时拉取 / 构建期注入」，改的只是本目录内部，调用方一行不用动。
 */

export { APP_CONFIG, type AppConfig } from './env'
