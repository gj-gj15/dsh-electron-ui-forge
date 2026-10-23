#!/usr/bin/env node
// 给已启动的 Electron 页面发真实键盘事件（走 Input.dispatchKeyEvent）。
// 用途：清理受控编辑器（Lexical / Slate / CodeMirror）里的内容 —— 直接改 DOM 会被状态层覆盖。
//
// 用法：
//   node keys.js ctrl+a            # 全选
//   node keys.js Backspace         # 退格一次
//   node keys.js Backspace 6       # 连发 6 次
//   node keys.js Escape
//   node keys.js --port 9223 ctrl+a
'use strict'

const argv = process.argv.slice(2)
const portIdx = argv.indexOf('--port')
const PORT = portIdx > -1 ? argv[portIdx + 1] : process.env.CDP_PORT || 9223

const KEYS = {
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
}

const args = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port')
const combo = args[0]
if (!combo) {
  console.error('usage: node keys.js <ctrl+a|Backspace|...> [repeat]')
  process.exit(2)
}
const repeat = Number(args[1]) || 1

const parts = combo.split('+')
const base = parts.pop()
const MOD = { ctrl: 2, control: 2, alt: 1, shift: 8, meta: 4 }
let modifiers = 0
for (const p of parts) modifiers |= MOD[p.toLowerCase()] || 0

const def = KEYS[base] || {
  key: base.length === 1 ? base : base,
  code: base.length === 1 ? 'Key' + base.toUpperCase() : base,
  vk: base.length === 1 ? base.toUpperCase().charCodeAt(0) : 0,
}

async function main() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && !/^devtools:\/\//.test(t.url))
  if (!page) throw new Error('no page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = () => j(new Error('ws error'))
  })

  let id = 0
  const send = (method, params) =>
    new Promise((resolve) => {
      const myId = ++id
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data)
        if (m.id === myId) {
          ws.removeEventListener('message', onMsg)
          resolve(m)
        }
      }
      ws.addEventListener('message', onMsg)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })

  for (let i = 0; i < repeat; i++) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers,
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      nativeVirtualKeyCode: def.vk,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers,
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      nativeVirtualKeyCode: def.vk,
    })
  }
  console.log(`sent: ${combo} x${repeat}`)
  ws.close()
}

main().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
