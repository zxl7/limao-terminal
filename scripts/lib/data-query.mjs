/**
 * 数据底座受限查询桥接。
 *
 * 静态路由继续由 read-route.mjs 处理；数据库型单票查询只能经过这里。
 * 本模块不接受SQL、路径、字段选择或任意命令片段。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

export const CODE_RE = /^\d{6}$/
export const MARKET_DAILY_LIMIT_MAX = 20

export function parseDataQuery(pathname, searchParams) {
  if (pathname !== '/api/data/market-daily' && pathname !== '/api/data/stock-registry') return null

  const code = searchParams.get('code') ?? ''
  if (!CODE_RE.test(code)) {
    return { error: 'invalid_request', message: 'code 必须为 6 位数字' }
  }

  if (pathname === '/api/data/stock-registry') {
    if ([...searchParams.keys()].some((key) => key !== 'code')) {
      return { error: 'invalid_request', message: 'stock-registry 仅接受 code 参数' }
    }
    return { command: 'stock-registry', code }
  }

  if ([...searchParams.keys()].some((key) => key !== 'code' && key !== 'limit')) {
    return { error: 'invalid_request', message: 'market-daily 仅接受 code 与 limit 参数' }
  }
  const rawLimit = searchParams.get('limit')
  const limit = rawLimit == null || rawLimit === '' ? MARKET_DAILY_LIMIT_MAX : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MARKET_DAILY_LIMIT_MAX) {
    return { error: 'invalid_request', message: `limit 必须为 1 到 ${MARKET_DAILY_LIMIT_MAX} 的整数` }
  }
  return { command: 'market-daily', code, limit }
}

export function readDataQuery(dataRoot, request) {
  const python = process.env.LIMAO_PYTHON || process.env.PYTHON || '/Users/zxl/.workbuddy/binaries/python/envs/default/bin/python'
  const script = path.join(dataRoot, 'scripts', 'data_gateway.py')
  const args = [script, request.command, '--code', request.code]
  if (request.command === 'market-daily') args.push('--limit', String(request.limit))

  const child = spawnSync(python, args, { encoding: 'utf8', timeout: 8_000 })
  if (child.error) throw child.error
  const output = String(child.stdout || '').trim()
  if (child.status !== 0) {
    let detail = String(child.stderr || output || `exit ${child.status}`).trim()
    try {
      const parsed = JSON.parse(output)
      if (typeof parsed.message === 'string') detail = parsed.message
    } catch {
      // 进程错误只向上提供简短摘要，禁止回传堆栈和本地路径。
    }
    throw new Error(detail.slice(0, 240))
  }
  try {
    return JSON.parse(output)
  } catch {
    throw new Error('数据底座查询返回非JSON')
  }
}
