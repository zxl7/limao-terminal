/**
 * Vitest 全局初始化。
 *
 * 只做两件事：
 *   1. 注入 jest-dom 断言（`toBeInTheDocument` 之类），让组件测试读起来像自然语言；
 *   2. 补齐 jsdom 缺失的浏览器 API —— 组件里用到的 `matchMedia` / `ResizeObserver`
 *      在 Node 环境不存在，不补会直接抛错（这类问题最容易在新项目里翻车）。
 */

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// ── jsdom 缺口补齐 ──

if (!globalThis.matchMedia) {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
