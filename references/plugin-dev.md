# 插件骨架全文

dsh 插件是「一个目录 + 四个文件」。下面是可以直接复制的形状，把 `<name>` 换成插件名
（全小写、连字符分隔），`<display>` 换成中文显示名。

## 目录

```
~/.dsh/plugins/<name>/
├── package.json
├── cordis.patch.yml
├── index.js
└── client.js
```

## 一、package.json

```json
{
  "name": "<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "<display>：一句话说明它做什么、改动范围边界。",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": []
    }
  },
  "keywords": ["dsh", "dsh-plugin"],
  "license": "MIT"
}
```

要点：

- `type: "module"` 必须，`index.js` 用 ESM 语法
- `exports` 三条都要：`.`（服务端）、`./client`（浏览器端）、`./package.json`
- `dsh.client.platform` 固定 `web`；`inject` 通常留空数组
- `version` 每次实质改动都递增，配合 CHANGELOG

## 二、cordis.patch.yml

```yaml
# <name> bundle patch. 只放纯 insert 行（市场热挂载只认这种形状）。
- insert:
    - id: <name>
      name: '<name>'
```

只许写 `insert`。不要出现 `update:` / `remove:` / 修改既有条目的写法——那会让
市场热挂载识别失败，插件在市场里显示异常。

## 三、index.js（服务端半身）

```js
/**
 * <name> — 服务端半身。
 *
 * 本插件是纯前端插件：状态推导与样式注入全部在 client.js 完成，
 * 服务端不需要注册 webServer / tools 路由。apply 留空即可让 cordis 正常挂载。
 */
export const name = '<name>'

export function apply() {}
```

即使完全不需要服务端能力，这个文件也不能省：cordis 按 `name` 挂载，
缺了入口整条 bundle 加载失败。

需要服务端能力时（注册路由、提供工具），`apply(ctx)` 里用 cordis 的 `ctx` 注册，
浏览器端通过 `ctx` 暴露的通道访问。纯 UI 改造不需要。

## 四、client.js（全部逻辑）

```js
/**
 * <name> — 浏览器端。
 *
 * 一句话：它把什么变成什么。
 *
 * 安全边界：
 *   - 所有规则都挂在 html[data-<short>] 下，属性不在时对页面零影响
 *   - 不删、不改宿主已有的属性与元素
 *   - 卸载时移除全部 style、observer、listener、属性
 */
window.__ModuleLoader__.load({
  id: '<name>',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports

    const ATTR = 'data-<short>'

    // 只用 data-* 锚点，不用 CSS Module 哈希类名
    const SEL_ANCHOR = '[data-composer-card]'

    const CSS = `
html[${ATTR}] ${SEL_ANCHOR}{
  /* 规则内容 */
}
`

    function apply(ctx) {
      const root = document.documentElement
      let observer = null
      let debounce = null

      // ── 样式注入：ctx.effect 负责生命周期 ────────────────────────────
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', '<name>')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, '<name>: styles')

      // ── 主逻辑 ──────────────────────────────────────────────────────
      function sync() {
        // 读 DOM → 计算 → 写 root 的 data-* 属性
        const el = document.querySelector(SEL_ANCHOR)
        if (el) root.setAttribute(ATTR, 'on')
        else root.removeAttribute(ATTR)
      }

      function schedule() {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(sync, 60)
      }

      // ── 监听与清理 ──────────────────────────────────────────────────
      ctx.effect(() => {
        sync()

        observer = new MutationObserver(schedule)
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-state', 'aria-expanded'],
        })

        // 输入框的值变化不触发 MutationObserver，单独听
        const onInput = () => schedule()
        document.addEventListener('input', onInput, true)

        return () => {
          observer && observer.disconnect()
          document.removeEventListener('input', onInput, true)
          if (debounce) clearTimeout(debounce)
          root.removeAttribute(ATTR)
        }
      }, '<name>: state')
    }

    exports.apply = apply
    return module.exports
  },
})
```

### 为什么是这个形状

| 设计 | 原因 |
|---|---|
| `window.__ModuleLoader__.load({ id, factory })` | dsh 的浏览器端模块协议；不走它加载器不认识这个文件 |
| `factory: require => {...}` + `module.exports` | 兼容加载器对 CommonJS 形状的期望，同时 `type: module` 的包也能被消费 |
| `ctx.effect(fn, label)` | cordis 的生命周期钩子；`fn` 返回清理函数，卸载/禁用时自动执行。label 用于诊断 |
| 状态写在 `document.documentElement` 上 | CSS 可以从 `html[data-xxx]` 派生，且一处属性控制全页 |
| `schedule()` 60ms 防抖 | MutationObserver 一次渲染会连发几十次回调，直接 sync 会打满主线程 |
| `attributeFilter` 只列关心的属性 | 不过滤的话，主题脚本每 120ms 改样式就会触发一轮 sync，无限自激 |

### React 重渲染的应对

React 会抹掉插件往组件内部插的节点。凡是需要长期存在的自制元素（把手、徽章），
必须在每轮 `sync()` 里检查后重新挂载：

```js
function mountGrip() {
  const card = document.querySelector(SEL_ANCHOR)
  if (!card || card.querySelector('.my-grip')) return  // 已存在就跳过
  const grip = document.createElement('div')
  grip.className = 'my-grip'
  grip.addEventListener('pointerdown', startResize)
  card.appendChild(grip)
}
```

## 五、注册三处

```bash
NAME=my-plugin
PROFILE="$HOME/.dsh/profiles/desktop"

# 备份
cp "$PROFILE/package.json" "$PROFILE/package.json.bak-$(date +%m%d%H%M)"

# 1 + 2：dependencies 与 bundles
node -e '
const fs=require("fs"), p=process.argv[1], name=process.argv[2];
const f=p+"/package.json";
const j=JSON.parse(fs.readFileSync(f,"utf8"));
j.dependencies=j.dependencies||{};
j.dependencies[name]="link:../../plugins/"+name;
const b=j.dsh.profile.bundles;
if(!b.includes(name)) b.push(name);
fs.writeFileSync(f,JSON.stringify(j,null,2));
console.log("bundles:",b.length);
' "$PROFILE" "$NAME"

# 3：目录联接
cmd //c mklink //J "$(cygpath -w "$PROFILE/node_modules/$NAME")" "$(cygpath -w "$HOME/.dsh/plugins/$NAME")"
```

验证三处都到位：

```bash
node -e '
const p=require(process.argv[1]);
console.log("dep:", p.dependencies[process.argv[2]]);
console.log("in bundles:", p.dsh.profile.bundles.includes(process.argv[2]));
' "$PROFILE/package.json" "$NAME"
ls -la "$PROFILE/node_modules/$NAME"
```

## 六、最小可验证清单

插件跑通不看「界面像不像」，看这四项：

1. `<html>` 上有 `data-<short>` 属性，值为预期状态
2. `document.head` 里有 `<style data-plugin="<name>">`，`sheet.cssRules.length > 0`
3. 目标元素的计算样式确实变了（`getComputedStyle(el).transform` 等）
4. 触发一次交互后属性随之切换，且没有控制台报错

```bash
CDP=scripts/cdp.js   # 本技能自带（零依赖 CDP 客户端）
node $CDP eval "JSON.stringify({
  attr: document.documentElement.getAttribute('<attr>'),
  style: !!document.querySelector('style[data-plugin=\"<name>\"]'),
  rules: (document.querySelector('style[data-plugin=\"<name>\"]')||{sheet:{cssRules:[]}}).sheet.cssRules.length
})"
```
