// 页面内对比度审计（IIFE，返回 JSON 字符串）。
// 用：node cdp.js eval /abs/path/audit-contrast.js
// 只统计有直接文本节点、可见、且面积够大的元素；按对比度从低到高排。
// WCAG AA：小字 4.5:1，≥24px 或 ≥18.66px 粗体 3:1。
(() => {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s)
    if (!m) return null
    const p = m[1].split(',').map(Number)
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }
  }
  const lin = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
  const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t)) // t = a 的不透明度

  // 自底向上做 alpha 合成，得到文字真正压着的底色
  const bgOf = (el) => {
    const layers = []
    let n = el
    while (n && n.nodeType === 1) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0.01) {
        layers.unshift(c)
        if (c.a >= 0.99) break
      }
      n = n.parentElement
    }
    let bg = [255, 255, 255]
    for (const l of layers) bg = mix(l.rgb, bg, l.a)
    return bg
  }
  // 祖先链上的 opacity 会整体稀释文字，必须累乘
  const opacityOf = (el) => {
    let o = 1
    let n = el
    while (n && n.nodeType === 1) {
      o *= parseFloat(getComputedStyle(n).opacity || 1)
      n = n.parentElement
    }
    return o
  }

  const out = {}
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    if (r.bottom < 0 || r.top > innerHeight) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue

    let text = ''
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue
    text = text.trim()
    if (!text) continue

    const fgRaw = parse(cs.color)
    if (!fgRaw) continue
    const bg = bgOf(el)
    const op = opacityOf(el) * (fgRaw.a ?? 1)
    if (op < 0.05) continue // 注意力退让态刻意压暗的，不算缺陷
    const fg = mix(fgRaw.rgb, bg, op)

    const L1 = lum(fg)
    const L2 = lum(bg)
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
    const fs = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 600
    const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : 4.5
    if (ratio >= need) continue

    const cls =
      (el.className || '').toString().split(/\s+/).find((c) => /[A-Za-z]/.test(c)) || el.tagName
    const key = `${cs.color} on rgb(${bg.map(Math.round).join(',')}) @${cls}`
    if (!out[key]) {
      out[key] = {
        ratio: Math.round(ratio * 100) / 100,
        need,
        fs,
        cls,
        opacity: Math.round(op * 100) / 100,
        sample: text.slice(0, 24),
        n: 0,
      }
    }
    out[key].n++
  }

  const items = Object.entries(out)
    .map(([k, v]) => ({ key: k, ...v }))
    .sort((a, b) => a.ratio - b.ratio)
  return JSON.stringify(
    { total: items.length, viewport: [innerWidth, innerHeight], items: items.slice(0, 40) },
    null,
    1
  )
})()
