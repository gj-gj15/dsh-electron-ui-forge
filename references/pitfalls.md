# 踩坑清单

按「撞上就浪费一轮」的程度排序。每条都带症状，便于对症查。

## 一、启动与进程

### 从 IDE / 沙箱进程树启动，进程活着但没有窗口

症状：`tasklist` 有 `DeepSeek Harness.exe`，但 9223 无监听、无窗口、无日志。

原因：宿主进程注入了 `ELECTRON_RUN_AS_NODE`，Electron 退化成纯 Node 解释器；
`NODE_OPTIONS` 还会往里塞第三方 fs 钩子。

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "…/DeepSeek Harness.exe" --remote-debugging-port=9223 --remote-allow-origins=*
```

判断方式：正常 GUI 启动是 11 个进程；只有 1 个就是没进 GUI 模式。

### 后台启动的进程被回收

症状：sh 里带 `&` 或 `nohup` 启动，几秒后进程消失，返回 exit 1。

原因：任务管理机制会把脱离会话的子进程回收。必须用工具自带的后台模式，
或 `cmd /c start "" "<exe>" args` 真正脱离会话。

### 再次启动直接 exit 1

症状：启动命令返回 exit code 1，什么也不打印。

这是 **Electron 单实例机制**，不是故障：已有实例在跑，新进程自杀。
要冷启动必须先杀旧实例，并轮询 9223 直到连不上再启动，否则会撞端口
（`bind() 0x2740`，devtools 起不来，CDP 一直连不上）。

### 单实例 + 托盘

窗口关了不等于程序退出（默认最小化到托盘）。这意味着「每次启动都要付一次启动成本」
是用户侧的真实痛点，而不是重复启动。

## 二、测量

### 拿到 3.4 秒的假启动时间

原因：拿「Loading plugins…」文案消失当就绪判据。页面早期 `body` 是空的，
这个条件立刻成立。

正确判据：`document.querySelector('[data-composer-card]')` 命中，或 `/json` 里出现
`type:"page"`（只看端口通不通会得到 0.0s）。

### 拿到 43 秒的假启动时间（更隐蔽）

症状：输入卡已经存在，但页面还是「正在加载设置…」的空壳，量出来比真实可用时间早 50 秒。

原因：启动时先渲染设置页，输入卡在设置页加载阶段就已进入 DOM，**只看存在性会提前放行**。

正确判据要三条同时成立：

```js
const c = document.querySelector('[data-composer-card]')
c && c.getBoundingClientRect().height > 0
  && !(document.body.innerText || '').includes('正在加载')
```

`measure-startup.js` 已按此实现。任何「等某个元素出现」的判据都要检查：
该元素是否在加载占位阶段就已存在。

### 波动 20 秒，以为测量错了

20 个插件时 T3 在 96~117 秒之间波动是正常的（磁盘缓存、Defender 扫描、首次加载）。
比较方案时至少跑三次看分布，别拿单次数值下结论。

### 主进程 profiler 全 idle

症状：对主进程抓 V8 profile，97.9% 是 idle，看不出瓶颈。

原因：干活的是 host 子进程（`--expose-internals …/dsh/…`），主进程只是在等它。
要 profile 就得进 host 进程，而 host 在 asar 内，注入不进去。

### `--cpu-prof` 在 Electron 里不落盘

试过三条退出路径都不写文件：`Browser.close`（无响应）、`process.exit`（不触发写入）、
`--require` 注入 host（不生效）。不要再重复投入。

## 三、插件机制

### 热 reload 卡在「Loading plugins…」

改完 `client.js` 点重载，界面永久停在加载态。已多次复现，**一律冷重启**。

### 插件写了没反应

按三处逐条核对，缺一不生效：

1. profile `dependencies` 有 `"<name>": "link:../../plugins/<name>"`
2. `dsh.profile.bundles` 数组里有 `<name>`
3. `node_modules/<name>` 联接存在且指向插件目录

两处都对但仍然没反应时，看 `client.js` 是否走了 `window.__ModuleLoader__.load`——
加载器不认识这个文件就不会执行任何代码，控制台也不会报错。

### desktop profile 被独占

症状：CLI `dump-config` 报错或返回空。

原因：GUI 在跑的时候 profile 被占用。要看配置就读 `package.json` 本身，不要试图用 CLI。

### 读 asar 里的文件

Electron 的 asar 目录结构每层都包了一层 `files`，路径解析要逐层下沉，否则第一层就
`NOT FOUND`。可直接复用项目里的 `perf/asar-read.js`：

```bash
node asar-read.js ls "dsh/node_modules/@deepseek-ai"
node asar-read.js read "<内部路径>" /tmp/out.js
```

## 四、DOM 与样式

### 选择器今天有效明天失效

用了 CSS Module 哈希类名。只用 `data-*`；实在没有就自己注入一个属性当锚点。

### 取到的元素永远「不可见」

DOM 里有与正文同名、高度为 0 的测量 / 无障碍副本。所有取值都要过滤
`getBoundingClientRect().height > 0`。

### `[data-composer-input]` 赋值抛错

它是 `div[contenteditable=true]`，不是 textarea。用 textarea 的 setter 会抛
`TypeError: Illegal invocation`。读值用 `textContent`，写入用 `document.execCommand`
或选区 API。

### 颜色怎么写都不变

三条封锁：`documentElement.style` / `body.style` 的 inline `!important`、
样式表里的字面量规则、脚本每 120ms 回写。判断「改得动吗」：写入 → 等 300ms → 再读。

- 变量类：声明到 `#root`（`body` 首个子元素），靠继承绕开
- 字面量类：放弃正面攻击，把相邻层改成同值（反解法则）
- 判断是不是 inline important：读 `element.getAttribute('style')`

### 摘掉别人的主题标记会拉锯

摘 `data-*-dark-theme` 几百毫秒就恢复正常，但主题脚本会写回，反复几百毫秒一轮。
不要开这个头。

### 改布局整页跳一下

改 `width` / `height` 触发重排。用 `transform: scale()`，
`transform-origin` 落在视觉稳定的那条边（输入框用底边中点，向上长）。

### 截图与坐标对不上

CDP 截图有缩放系数。`shot` 的 clip 用 CSS 坐标，文件名宽度 ÷ `innerWidth` = 缩放系数。

### 截图偶发伪影

页眉偶尔出现黑色渐变，是渲染伪影，重截一次即正常。别当成 bug 去查样式。

## 五、状态持久化

### 存进去的宽度重启后变小且再也长不回来

原因：插件在 App 还没排完版时加载，那一刻量出的「可用宽度」偏小，
用它 `clamp` 会把用户存的值永久改小（实测：存 936 → 开机 856 → 之后一直 856）。

规则：**初始化只按绝对范围夹；每轮渲染只夹「显示值」，不动存储值。**

### 状态按计时器撤销，导致读一半突然变暗

计时器猜不准人什么时候读完。状态撤销必须事件驱动：用户开始输入、滚出视野、
新任务开始。见 `attention.md`。

## 六、已知不可行

| 想做的事 | 为什么不行 |
|---|---|
| 换掉主题底色成冷白 | 主题把 `background-color` 写成字面量 + 按帧回写滚动容器，会得到半白半黄 |
| 用样式表覆盖输入区底色 | 输入区是 inline `background-color: rgb(245,241,231) !important`，样式表 `!important` 打不过 |
| 在滚动容器外侧画装饰 | 滚动容器 `.WW4l1q_body` 左边界与内容重合且 `overflow:auto`，外侧装饰一律被裁切；画内侧又压首字符 |
| 摘 `data-ds-dark-theme` 修 DS Bot 黑条 | 主题脚本几百毫秒内写回，进入拉锯 |
| 靠热 reload 让插件改动生效 | 卡在 "Loading plugins…" |
| 靠减少插件把启动压到 30 秒内 | 底座本身就 45.7s（base + web-app），与插件无关 |
| 靠 V8 编译缓存加速启动 | 实测三次 116.8 / 114.5 / 117.2，无差别 |
