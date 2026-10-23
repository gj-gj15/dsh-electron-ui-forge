#!/usr/bin/env node
// 极简 CDP 客户端。零依赖：Node 22+ 内置 fetch 与 WebSocket。
// 目标：给已启动 Electron 应用做活体探测 / 截图 / 真实点击。
//
// 用法：
//   node cdp.js targets [--port 9223] [--match <url-substr>]
//   node cdp.js eval <file|->          # stdin 或文件内容当作表达式求值
//   node cdp.js shot <out.png> [--clip x,y,w,h] [--sel <css>] [--pad 16] [--scale 2]
//   node cdp.js click <x> <y>
//   node cdp.js type <text>            # 往当前焦点里插入文字（走真实输入通道）
//   node cdp.js size                   # 报告视口尺寸（截图缩放换算用）
'use strict'

const fs = require('fs')
const path = require('path')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i > -1 ? argv[i + 1] : null
}
const PORT = flag('--port') || process.env.CDP_PORT || 9223
const BASE = `http://127.0.0.1:${PORT}`

// 环境里常有 http_proxy，用 Node 原生 fetch 直连 127.0.0.1 可绕开；curl 会被代理坑住。
async function listTargets() {
  const res = await fetch(`${BASE}/json/list`)
  if (!res.ok) throw new Error(`CDP ${res.status}，应用是否带 --remote-debugging-port=${PORT} 启动？`)
  return res.json()
}

async function pickTarget() {
  const list = await listTargets()
  const match = flag('--match')
  const pages = list.filter((t) => t.type === 'page' && !/^devtools:\/\//.test(t.url))
  const page = match ? pages.find((t) => t.url.includes(match)) : pages[0]
  if (!page) throw new Error(`没有匹配的页面目标（共 ${pages.length} 个 page）：${pages.map((p) => p.url).join(' | ')}`)
  return page
}

function client(ws) {
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  return (method, params = {}, timeout = 30000) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      // 超时定时器必须在响应到达时清掉，否则每次调用都会把 Node 的事件循环
      // 多留 30 秒，脚本看着跑完了却迟迟不退（调用方只能 timeout 强杀）。
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`timeout: ${method}`))
        }
      }, timeout)
      pending.set(id, (m) => {
        clearTimeout(timer)
        resolve(m)
      })
      ws.send(JSON.stringify({ id, method, params }))
    })
}

async function open() {
  const page = await pickTarget()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
  })
  return { ws, send: client(ws), page }
}

// 表达式结果：页面脚本自己 JSON.stringify 的，原样打印；其他类型转 JSON。
function printValue(r) {
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails
    console.error('EXCEPTION:', (d.exception && (d.exception.description || d.exception.value)) || d.text)
    process.exitCode = 1
    return
  }
  const v = r.result ? r.result.result.value : undefined
  if (typeof v === 'string') console.log(v)
  else console.log(JSON.stringify(v, null, 1))
}

async function main() {
  const cmd = argv[0]

  if (cmd === 'targets') {
    const list = await listTargets()
    for (const t of list) console.log(`${t.type}\t${t.title}\t${t.url}\t${t.webSocketDebuggerUrl}`)
    return
  }

  const { ws, send } = await open()

  if (cmd === 'eval') {
    const src = argv[1]
    if (!src) throw new Error('缺少表达式文件；用 - 表示读 stdin')
    const expression = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(src), 'utf8')
    printValue(await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }))
  } else if (cmd === 'shot') {
    const out = argv[1]
    if (!out) throw new Error('缺少输出路径')
    const params = { format: 'png' }
    const scale = Number(flag('--scale') || 1)
    const sel = flag('--sel')
    const clipArg = flag('--clip')
    if (sel || clipArg) {
      let box
      if (sel) {
        const r = await send('Runtime.evaluate', {
          expression: `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height}})()`,
          returnByValue: true,
        })
        box = r.result.result.value
        if (!box) throw new Error(`选择器无匹配：${sel}`)
        // --pad：把裁切框向外扩，box-shadow / 外发光都在元素盒之外，
        // 不扩就永远拍不到自己想看的那个效果。
        const pad = Number(flag('--pad') || 0)
        if (pad) {
          box = {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width: box.width + pad * 2,
            height: box.height + pad * 2,
          }
        }
      } else {
        const [x, y, width, height] = clipArg.split(',').map(Number)
        box = { x, y, width, height }
      }
      // clip 用 CSS 坐标，不是截图像素坐标
      params.clip = { ...box, scale }
    } else if (scale !== 1) {
      const r = await send('Runtime.evaluate', {
        expression: `({x:0,y:0,width:innerWidth,height:innerHeight})`,
        returnByValue: true,
      })
      params.clip = { ...r.result.result.value, scale }
    }
    const r = await send('Page.captureScreenshot', params)
    fs.writeFileSync(path.resolve(out), Buffer.from(r.result.data, 'base64'))
    console.log(`saved ${out}${params.clip ? ` clip=${JSON.stringify(params.clip)}` : ''}`)
  } else if (cmd === 'click') {
    const x = Number(argv[1])
    const y = Number(argv[2])
    if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('用法：click <x> <y>')
    const base = { x, y, button: 'left', clickCount: 1 }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    // 落点先探一下，点击落空时这是最有用的证据
    const r = await send('Runtime.evaluate', {
      expression: `(()=>{const e=document.elementFromPoint(${x},${y});return e?{tag:e.tagName,cls:(e.className||'').toString().slice(0,60),z:getComputedStyle(e).zIndex,pos:getComputedStyle(e).position}:'none'})()`,
      returnByValue: true,
    })
    console.log('hit:', JSON.stringify(r.result.result.value))
  } else if (cmd === 'type') {
    // Input.insertText 走真实输入通道：contenteditable 与受控组件都能吃到，
    // 直接改 textContent 不会触发 React 的 onChange。
    const text = argv[1]
    if (!text) throw new Error('用法：type <text>')
    await send('Input.insertText', { text })
    const active = await send('Runtime.evaluate', {
      expression: `(()=>{const a=document.activeElement;return a?{tag:a.tagName,ce:a.isContentEditable,txt:(a.textContent||'').slice(0,40)}:'none'})()`,
      returnByValue: true,
    })
    console.log('active:', JSON.stringify(active.result.result.value))
  } else if (cmd === 'size') {
    const r = await send('Runtime.evaluate', {
      expression: `({innerWidth,innerHeight,devicePixelRatio})`,
      returnByValue: true,
    })
    console.log(JSON.stringify(r.result.result.value))
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 13).join('\n'))
    process.exitCode = 2
  }

  ws.close()
}

main().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
