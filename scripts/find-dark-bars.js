// 页面内深色块探测（IIFE，返回 JSON 字符串）。
// 用：node cdp.js eval /abs/path/find-dark-bars.js
// 用途：在浅色主题里找「突兀的黑条」——大面积深色底或深色渐变，通常是子应用/插件
// 用了自己的一套明暗调色板，而宿主只换了底色没换它。
(() => {
  const isDark = ([r, g, b], a) => r < 96 && g < 96 && b < 96 && (a === undefined || a > 0.2)
  const bars = []
  for (const n of document.querySelectorAll('body *')) {
    const r = n.getBoundingClientRect()
    if (r.width < 240 || r.height < 18) continue
    if (r.bottom < 0 || r.top > innerHeight) continue
    const cs = getComputedStyle(n)
    const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor)
    const p = m ? m[1].split(',').map(Number) : null
    const bgDark = p ? isDark(p, p[3]) : false
    // 渐变里的深色只在不透明时才算出问题：rgba(0,0,0,0) 的渐隐蒙层是正常设计
    const gradDark =
      /gradient/.test(cs.backgroundImage) &&
      (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).some((t) => {
        const q = t.replace(/rgba?\(|\)/g, '').split(',').map(Number)
        return isDark(q, q.length > 3 ? q[3] : 1)
      })
    if (!bgDark && !gradDark) continue
    bars.push({
      tag: n.tagName,
      cls: (n.className || '').toString().slice(0, 60),
      id: n.id || undefined,
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage === 'none' ? undefined : cs.backgroundImage.slice(0, 120),
      z: cs.zIndex,
      pos: cs.position,
    })
  }
  // 父元素已覆盖的子元素不重复报
  const top = bars.filter(
    (b, i) =>
      !bars.some(
        (o, j) =>
          j !== i &&
          o.box[0] <= b.box[0] &&
          o.box[1] <= b.box[1] &&
          o.box[0] + o.box[2] >= b.box[0] + b.box[2] &&
          o.box[1] + o.box[3] >= b.box[1] + b.box[3] &&
          o.box[2] * o.box[3] > b.box[2] * b.box[3]
      )
  )
  return JSON.stringify({ total: top.length, bars: top.slice(0, 20) }, null, 1)
})()
