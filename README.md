# dsh-electron-ui-forge

改造已安装 Electron 桌面应用的界面与行为 —— **不碰源码，不重新打包**。

给成品应用换皮、修可读性、加插件、让对话界面自动聚焦，都在运行时完成。改坏了关掉
开关就回到原样。

适用于 dsh（DeepSeek Harness / 花子）这类 cordis 插件体系的应用，也适用于任何能在
Chromium 远程调试端口上驱动的 Electron 应用。

## 它解决三类问题

**一、界面改不动**

「字看不清」「有黑条」「按钮点不动」「宽度不对」「颜色怎么写都不变」——
用 CDP 连进运行中的应用，先探测真实的计算样式与盒子坐标，再决定改哪一层。
拿内联 `!important` 和按帧回写的主题脚本没辙时，靠自定义属性继承绕开：
把变量声明到 `body` 的子元素上，后代取最近的祖先声明，回写永远够不着。

**二、要给应用加功能**

dsh 的本体在 `app.asar` 里，改不动也不该改（升级即覆盖）。所有改造都落在
`~/.dsh/plugins/<name>/`。插件是四个文件的硬形状，注册要动三处，缺一不生效；
改完必须冷重启，热 reload 会卡在 `Loading plugins…`。

**三、界面太吵，不知道该看哪**

同一时刻只让一个区域占满视觉权重，其余主动退让。五个状态
（`idle` / `typing` / `running` / `approval` / `done`）驱动 opacity、blur、transform
与光晕。只调权重，不动底色、字体、布局 —— 用户装的主题说了算。

## 六条铁律

1. 先探测，后动手
2. 只动插件层，不碰安装目录
3. 只用 `data-*` 锚点，不用 CSS Module 哈希类名
4. 改动必须可量化（对比度比值、坐标数字、命中元素）
5. 一次只改一类（颜色 / 几何 / 交互分开验）
6. 留痕（`CHANGELOG.md` + 被改文件末尾「变更记录」）

## 快速开始

应用要带调试端口启动。在 IDE / 沙箱进程树里启动时必须清两个变量，否则 Electron
退化成纯 Node —— 进程活着、没窗口、无日志：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "<app.exe>" \
  --remote-debugging-port=9223 --remote-allow-origins=*
```

```bash
node scripts/cdp.js targets                              # 连上了吗
node scripts/cdp.js eval /abs/scripts/audit-contrast.js   # 哪些字不合格
node scripts/cdp.js shot out.png --sel '[data-anchor]'    # 精确裁切截图
```

给 dsh 建一个插件：

```bash
node scripts/new-plugin.js my-plugin
```

## 脚本

全部零第三方依赖，只用 Node 内置模块（需要 Node 22+ 的内置 WebSocket）。

| 脚本 | 作用 |
|---|---|
| `cdp.js` | CDP 客户端：`targets` / `eval` / `shot` / `click` / `size` / `type` |
| `keys.js` | 发真实键盘事件，清理 Lexical / Slate / CodeMirror 必用 |
| `audit-contrast.js` | 对比度审计（含祖先 opacity 累乘、多层背景 alpha 合成），WCAG AA |
| `find-dark-bars.js` | 深色块 / 深色渐变探测 |
| `new-plugin.js` | 建插件骨架 + 注册三处 + 建目录联接 |
| `measure-startup.js` | 冷启动三段计时 |
| `selftest.js` | 注意力核心库回归测试，11 场景 25 断言 |

## 结构

```
SKILL.md             路由 + 六条铁律 + 症状分诊表
references/
  inject.md          运行时注入：层级判据、可复用模板、验收清单
  dsh-map.md         dsh 地图：路径、锚点、变量族、主题三层封锁
  plugin-dev.md      插件四文件全文骨架、注册命令、生命周期写法
  pitfalls.md        统一踩坑清单 + 已知不可行
  startup-perf.md    启动耗时诊断实录、地板法、排除项、预热方案
  attention.md       注意力导演：状态机、running 时间窗、反模式
  visual-recipe.md   视觉配方：每个数值的来源与调参边界
assets/
  attention-core.js  可移植核心库，锚点走配置对象，不绑定宿主
history/             合并前三个仓库的 git bundle
```

## 一些实测数字

不是估计，是在一台真实机器上量出来的：

- dsh 冷启动地板 **45.7 秒**（只挂 `base` + `web-app`），挂满 20 个插件 **96~117 秒**，
  每个插件约 **3.5 秒**。全部花在 asar 内的插件初始化，外部压不下去 ——
  所以做的是预热（开机后延迟拉起），不是优化。
- 主进程 V8 profile **97.9% idle**，干活的是 host 子进程。抓主进程得不出结论。
- 验证过无效的方向：V8 编译缓存、磁盘、CPU、asar 打包、网络、GPU、会话归档。别再试。
- 主题脚本每 **120ms** 回写一次变量。写完即时生效、120ms 后被打回，是判断
  「改得动改不动」的实用依据。

## 许可

MIT
