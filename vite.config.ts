/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES, HEALTH_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from './src/shared/api/routes.ts'
import { readRoute, healthPayload, freshnessHeaders, resolveDataRoot } from './scripts/lib/read-route.mjs'
import { parseDataQuery, readDataQuery } from './scripts/lib/data-query.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 原系统（狸猫猎手）数据根目录。**只读**。
 * 迁移服务器时通过环境变量 LIMAO_DATA_ROOT 覆写，代码零改动。
 */
const DATA_ROOT = resolveDataRoot(__dirname, DEFAULT_DATA_ROOT, DATA_ROOT_ENV)

// ────────────────────────────────────────────────────────────────
// 数据读取实现见 `scripts/lib/read-route.mjs` —— 与命令行体检脚本**共用同一份**，
// 避免「页面能看、体检说没数据」这类因实现漂移产生的互相矛盾。
// ────────────────────────────────────────────────────────────────

function sendJson(
  res: import('node:http').ServerResponse,
  code: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  // 数据基座（工件 F）：注入新鲜度头，使前端 AgeBadge / 新鲜度面板在 dev 也能工作
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v)
  }
  res.end(JSON.stringify(body))
}

/**
 * 开发期数据接口：把 /api/* 直连到原系统落盘文件。
 * 生产环境由 serve.py 提供同样语义的路由，前端代码无需区分。
 */
function dataApiPlugin(): Plugin {
  return {
    name: 'limao-data-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        const url = requestUrl.pathname
        const dataQuery = parseDataQuery(url, requestUrl.searchParams)

        if (dataQuery) {
          if ('error' in dataQuery) {
            sendJson(res, 400, { ...dataQuery, route: url })
            return
          }
          try {
            sendJson(res, 200, readDataQuery(DATA_ROOT, dataQuery))
          } catch (e) {
            sendJson(res, 404, {
              error: 'data_unavailable',
              route: url,
              message: e instanceof Error ? e.message : String(e),
            })
          }
          return
        }

        if (url === '/api/health') {
          sendJson(res, 200, healthPayload(DATA_ROOT, HEALTH_ROUTES))
          return
        }

        const def = ROUTES[url]
        if (!def) {
          next()
          return
        }

        try {
          sendJson(res, 200, readRoute(DATA_ROOT, def), freshnessHeaders(def, DATA_ROOT))
        } catch (e) {
          // 数据缺失是**可预期状态**，不是异常：盘前大量文件尚未生成
          sendJson(res, 404, {
            error: 'data_unavailable',
            route: url,
            target: def.file ?? def.dir,
            desc: def.desc,
            message: e instanceof Error ? e.message : String(e),
          })
        }
      })
    },
  }
}

// ────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [
    // React Compiler 1.0：编译期自动记忆化，免手写 useMemo/useCallback。
    // ⚠️ @vitejs/plugin-react 6.x 已**移除 `babel` 选项**，改用 `compiler`
    //    内建接入（底层由 oxc-transform-react 承担，须显式安装）。
    //    旧写法 `react({ babel: { plugins: [['babel-plugin-react-compiler']] } })`
    //    在 5.x 可用，6.x 会直接报 TS2353（对象字面量不得含未知属性）。
    react({ compiler: true }),
    tailwindcss(),
    dataApiPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // 与 Vue 版（5180）错开，两版可同时运行对照
    port: 5181,
    strictPort: false,
    // 监听所有网卡 + 放行穿透域名（ngrok/cloudflared 免费域名随机，true=放行全部 host）
    // 仅用于本地 dev + 临时穿透；生产由 serve.py 提供（白名单制）
    host: true,
    allowedHosts: true,
    /**
     * 启动后台预热 —— 解决「切 tab 才第一次编译、那几秒里任何一次请求失败就报
     * `Importing a module script failed`」的体感问题。
     *
     * ⚠️ 只预热**共享层**，不预热 29 个页面：页面改动频繁，每次都重编译所有页面
     * 会明显拖慢 dev 启动与保存后的 HMR；而页面级的「提前加载」由侧栏悬停预取
     * （`Sidebar.tsx`）负责，两者分工 —— 这里稳住共享底座，那里提前取目标页。
     */
    warmup: {
      clientFiles: [
        'src/main.tsx',
        // 共享层与业务 barrel 被所有页面依赖 —— 它们 transform 失败会**同时**
        // 打掉依赖它的每一个页面，是最该优先稳住的一层
        'src/app/router.tsx',
        'src/app/AppShell.tsx',
        'src/features/analytics/index.ts',
        'src/features/market/index.ts',
        'src/shared/api/index.ts',
        'src/shared/ui/index.ts',
      ],
    },
  },
  /**
   * 显式声明预构建入口。
   *
   * 为什么必须写死：dev 期间如果 Vite 发现「有未预构建的新依赖」，会**现场重算**
   * `node_modules/.vite/deps` 并让旧的 `?v=` hash 全部失效 —— 浏览器此时请求的
   * 模块 URL 直接 504（`Outdated Optimize Dep`），表现就是「切个 tab 报模块加载失败」。
   * 把主依赖列全，运行中就只会有一次预构建（启动时）。
   */
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router',
      '@tanstack/react-query',
      'zustand',
      'zod',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx'],
      reporter: ['text', 'html'],
    },
  },
})
