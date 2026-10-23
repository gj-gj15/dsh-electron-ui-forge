# 运行时注入：层级选择与可复用模板

> 通用手法，不绑定任何宿主。dsh 专属的锚点、变量族、主题封锁见 `dsh-map.md`。

## 一、先问三个问题，再决定改哪一层

改一个值之前，必须能回答：

1. **它被谁写的？** 沿祖先链读 `getComputedStyle(el).getPropertyValue('--x')`，
   第一处值与元素不同（或第一次出现非空值）的那一级 = 声明处。
2. **它会不会被写回？** 写入后等 150~300ms 再读。变了就是有脚本在回写。
3. **我要盖的这层，在层叠里比它高吗？**

三条都不清楚就动手，等于赌。

## 二、层叠与继承的实际优先级

同源样式，从高到低：

```
inline style + !important     ← 无法用样式表覆盖
样式表规则 + !important        ← 靠特异性决胜负
inline style（无 important）
样式表规则（无 important）
继承值                        ← 永远最低
```

**关键推论**：从**子元素**上声明的值，对子元素的后代来说是"继承链上最近的一层"，
而被写在 `body` 上的 inline `!important` 根本够不到子元素内部。
所以「变量被 inline !important 钉死在 body 上」这类问题，唯一稳定解是：

```js
const host = document.getElementById('root') || document.body.firstElementChild
host.style.setProperty('--some-alias', '#123456')   // 不带 important 也行
```

想让所有后代都吃到，用一张样式表：

```css
html[data-my-layer] #root{
  --some-alias: #123456 !important;
}
```

## 三、探测脚本骨架

```js
(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
  }
  const el = document.querySelector('[data-some-anchor]')
  const p = el && el.parentElement
  const cs = p && getComputedStyle(p)
  return JSON.stringify({
    el: box(el),
    parent: box(p),
    parentPadding: cs && [cs.paddingLeft, cs.paddingRight].join(' '),
    fontSize: el && getComputedStyle(el).fontSize,
    color: el && getComputedStyle(el).color,
    // 变量来源：逐级向上找第一个有值的那一层
    varChain: (() => {
      const out = []
      let n = el
      while (n && n.nodeType === 1 && out.length < 6) {
        out.push([n.id || n.tagName, getComputedStyle(n).getPropertyValue('--some-alias').trim()])
        n = n.parentElement
      }
      return out
    })(),
  }, null, 1)
})()
```

## 四、回写检测

```js
(async () => {
  const host = document.getElementById('root')
  const name = '--some-alias'
  const before = getComputedStyle(host).getPropertyValue(name).trim()
  host.style.setProperty(name, '#ff0000')
  const snap = []
  for (const t of [0, 60, 150, 300, 600]) {
    await new Promise((r) => setTimeout(r, t === 0 ? 0 : t - (snap.at(-1)?.t ?? 0)))
    snap.push({ t, v: getComputedStyle(host).getPropertyValue(name).trim() })
  }
  return JSON.stringify({ before, snap })
})()
```

若 `snap` 里出现回退到 `before` 的记录 → 有人在按帧回写，必须换层级。

## 五、颜色手法：不新造色相

修可读性时优先**同色相加深/减浅**，不要引入新色相（会跟整套设计打架）：

- 文字太淡 → 保持色相，把明度往深推 2~3 档，直到对比度进区间
- `-tertiary` 语义令牌 → 它的语义是"最浅一级填充"；若被指到深色档，取回同色相浅色
- 深底深字（对比度 < 2）→ 优先把底换成浅色，而不是把字提到白（白字配深底会变成新的注意力中心）

对比度达标线：小字 4.5:1，大字（≥24px，或 ≥18.66px 且粗体）3:1。
低于 2:1 基本等于"看不见"，是缺陷不是风格。

## 六、版式对齐：量父容器，不量元素

两个元素对不齐，八成不是它们自己的问题：

```
卡在 .shell { padding: 0 16px }   → 可用宽 956
列在 .scroll { padding: 0 32px }  → 可用宽 924
```

卡一旦超过 924，就被列容器的边界夹住，左右各差 16px。
做法：`availableWidth() = min(卡父级内宽, 列父级内宽)`，任何宽度都先过这道闸。

**持久化陷阱**：初始化阶段（应用尚未排完版）测到的可用宽偏小，
不能写进 `width` 本身。规则：

- 初始化：只按绝对上下限夹（如 500~1200）
- 每帧/每次渲染：显示时夹一次 `displayed = Math.min(stored, available)`，不改 `stored`

## 七、交互验收：别信"我点了一下好像好了"

```bash
node scripts/cdp.js click 26 20     # 会打印 elementFromPoint 命中
```

命中元素不是目标 → 被遮罩吞了。造一个与残留遮罩完全同构的假遮罩（同尺寸、同 z-index、
同 role、全透明），再派发真实鼠标事件，能稳定复现"点不动"，修完能稳定复现"点得动"。

## 八、全局 reset 用 `:where()` 降特异性

写注入层的 reset 时：

```css
/* 差：(0,1,2) 会压掉所有单类按钮样式 */
html[data-my-layer] button { padding: 0 }

/* 好：特异性 0，永远让位给具体组件 */
:where(html[data-my-layer]) :where(button) { padding: 0 }
```

## 九、验收清单

- [ ] `audit-contrast.js` 返回 `total: 0`
- [ ] 需要对齐的元素：left / right 完全相等
- [ ] 改动前后的截图同角度并列
- [ ] 关键交互：`elementFromPoint` 命中目标本身
- [ ] 冷启动一次仍成立（不是热 reload 的假象）
- [ ] `CHANGELOG.md` 与文件末尾变更记录已更新
