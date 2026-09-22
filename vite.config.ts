/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES, FILE_ROUTES, DEFAULT_DATA_ROOT, DATA_ROOT_ENV } from './src/shared/api/routes.ts'
import { readRoute, healthPayload, resolveDataRoot } from './scripts/lib/read-route.mjs'

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

function sendJson(res: import('node:http').ServerResponse, code: number, body: unknown) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
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
        const url = (req.url ?? '').split('?')[0]

        if (url === '/api/health') {
          sendJson(res, 200, healthPayload(DATA_ROOT, FILE_ROUTES))
          return
        }

        const def = ROUTES[url]
        if (!def) {
          next()
          return
        }

        try {
          sendJson(res, 200, readRoute(DATA_ROOT, def))
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
