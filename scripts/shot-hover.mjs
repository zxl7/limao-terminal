/**
 * 用 CDP 驱动 headless Chrome 触发真实 hover，再截图 —— 只为核对浮层观感。
 * 用法: node scripts/shot-hover.mjs <out.png> [端口]
 */
/* oxlint-disable no-await-in-loop -- 轮询等 Chrome 起监听，必须顺序重试 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const OUT = process.argv[2] || 'output/hover.png'
const PORT = Number(process.argv[3] || 9333)
const URL_PAGE = process.argv[4] || 'http://127.0.0.1:5182/timeline'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-proxy-server',
  '--hide-scrollbars', '--window-size=1920,1200',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-profile-limao',
  'about:blank',
], { stdio: 'ignore' })

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(250)
  }
  throw new Error('chrome 未就绪')
}

const page = await targets()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => (ws.onopen = res))
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id
    pending.set(n, res)
    ws.send(JSON.stringify({ id: n, method, params }))
  })

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: URL_PAGE })
await sleep(9000)

// 找一个「有下区标签」的节点，hover 它
const probe = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const btns = [...document.querySelectorAll('button[aria-haspopup="dialog"]')];
    const pick =
      btns.find(b => b.getAttribute('aria-label')?.startsWith('14:30')) ||
      btns.find(b => b.querySelector('[data-label-tier][data-label-dir="down"]')) ||
      btns[Math.floor(btns.length/2)];
    if (!pick) return null;
    const r = pick.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, label: pick.getAttribute('aria-label') };
  })()`,
})
const box = probe.result?.value
if (!box) throw new Error('没找到节点')
console.log('hover:', box.label, box.x, box.y)

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 })
await sleep(1200)
// 浮层出现后再移进浮层内一点点，避免被延迟关闭
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 2, y: box.y + 2, buttons: 0 })
await sleep(1200)

const dlg = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { text: d.innerText, x: r.x, y: r.y, w: r.width, h: r.height,
             cards: d.querySelectorAll('.rounded-\\\\[var\\\\(--radius-sm\\\\)\\\\]').length,
             borders: d.querySelectorAll('[class*="border"]').length,
             shadows: d.querySelectorAll('[class*="shadow"]').length };
  })()`,
})
const info = dlg.result?.value
if (!info) {
  console.log('⚠️ 浮层未打开')
} else {
  console.log('浮层 rect', info.x, info.y, info.w, info.h)
  console.log('内层 rounded 卡片', info.cards, '｜带 border 类', info.borders, '｜带 shadow 类', info.shadows)
  console.log('--- 文本 ---')
  console.log(info.text)
}

const clip = info
  ? { x: Math.max(0, info.x - 8), y: Math.max(0, info.y - 8), width: info.w + 16, height: info.h + 16, scale: 1.4 }
  : undefined
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log('saved', OUT)
ws.close()
proc.kill()
process.exit(0)
