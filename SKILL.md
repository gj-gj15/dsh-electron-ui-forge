---
name: dsh-electron-ui-forge
description: >
  改造已安装 Electron 桌面应用的界面与行为，不碰源码、不重新打包。三件事一条线打通：
  ① 运行时注入 —— 用 CDP 连进活体应用，探测真实 DOM 与计算样式，覆盖主题变量、
  修对比度、对齐版式、修交互失效；② 插件开发 —— 给 dsh（DeepSeek Harness / 花子）
  这类 cordis 体系应用建插件、注册三处、冷启动探锚点、诊断启动耗时；③ 注意力导演 ——
  用状态机把视觉权重集中到「此刻该看的地方」，让对话界面自动聚焦。
  适用于「字看不清 / 有黑条 / 按钮点不动 / 宽度不对 / 颜色改不动」、给应用加功能或
  换皮、dsh 启动太慢、界面太吵不知道该看哪这类需求。
  关键词：dsh UI、花子插件、Electron 注入、CDP 调试、主题变量覆盖、对比度审计、
  cordis、client.js 注入、dsh 启动慢、注意力导演、焦点状态机、单焦点、视觉权重、
  发光输入框、失焦虚化、对话界面交互设计、界面改版。
---

# dsh Electron UI Forge

在一个仓库里解决「改成品应用的界面」的所有环节。三种活共用一套探测工具、一套铁律、
一份症状表——不重复造。

`app.asar` 里的东西改不动也不该改（升级即覆盖）。所有改造都落在**运行时注入层**或
**用户目录下的插件**里。

## 场景路由

先认场景，再去读对应的那一份。不要一次读完所有 references。

| 你要做的事 | 读 | 跑 |
|---|---|---|
| 改颜色 / 修可读性 / 对齐版式 / 修点击失效 | `references/inject.md` | `scripts/cdp.js`、`audit-contrast.js` |
| 给 dsh 加功能、加 UI、改交互 | `references/plugin-dev.md` + `references/dsh-map.md` | `scripts/new-plugin.js` |
| 撞到怪现象，先查是不是已知坑 | `references/pitfalls.md` | — |
| 用户抱怨启动慢 | `references/startup-perf.md` | `scripts/measure-startup.js` |
| 想让对话界面有焦点感、不再一屏嘈杂 | `references/attention.md` | `../assets/attention-core.js` |
| 调注意力效果的数值（权重、模糊、缓动） | `references/visual-recipe.md` | `scripts/selftest.js` |

dsh 专属的东西（exe 路径、端口、`data-*` 锚点、主题变量族、DS Bot 页）全在
`references/dsh-map.md`；换成别的 Electron 应用时，这一份不用读。

## 六条铁律

1. **先探测，后动手。** 改每个值之前先读出真实的计算样式、盒子坐标、层叠来源。
   改错层级的成本远高于探测。
2. **只动插件层，不碰安装目录。** 解包改 `app.asar` 在下次升级时消失，且无法回滚。
   要改本体行为，用插件在运行时拦截或覆盖。
3. **只用 `data-*` 锚点，不用 CSS Module 类名。** 哈希类名（`_9lTDKa_fade`）随构建变化，
   今天能选中，明天就失效。没有合适锚点时自己注入一个属性作为落脚点。
4. **改动必须可量化。** 「看起来好多了」不算完成；对比度比值、坐标数字、命中元素才算。
5. **一次只改一类。** 颜色、几何、交互分开做、分开验；混在一起出问题无法定位。
6. **留痕。** 每处改动写进 `CHANGELOG.md`（改了什么 → 为什么 → 怎么验证的），
   被改文件末尾追加「变更记录」。

状态写到 `<html>` 的 `data-*` 上，CSS 全部挂在 `html[data-xxx]` 下。属性不存在时对
页面影响为零——这是「可随时关掉」的技术保证。

## 起点：让应用带调试端口启动

Electron 应用需要 `--remote-debugging-port`。在沙箱 / IDE 进程树里启动时，必须清掉
两个会让 Electron 退化成纯 Node 的环境变量（症状：进程活着、没窗口、无日志）：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "<app.exe>" \
  --remote-debugging-port=9223 --remote-allow-origins=*
```

一定要用工具的后台模式，不能用 `&`（脱离会话的子进程会被回收）。

确认连通：

```bash
node scripts/cdp.js targets   # type / title / url / ws
node scripts/cdp.js size      # 视口尺寸，截图换算用
```

冷启动到注入层就绪可能要 1~2 分钟（dsh 挂满插件时 96~117 秒），没到判据别急着报失败。

## 主流程

### 1. 探测

```bash
node scripts/cdp.js eval probe.js                          # 自己写的 IIFE，返回 JSON.stringify
node scripts/cdp.js eval /abs/scripts/audit-contrast.js    # 哪些文字不合格
node scripts/cdp.js eval /abs/scripts/find-dark-bars.js    # 哪里有大块深色
```

标准探测项：`getBoundingClientRect()`、`getComputedStyle()` 关键属性、父级 padding、
以及**变量在哪一级声明**（沿 `parentElement` 逐级取 `--x`，第一个出现值的层级就是声明处）。

判断「这个值改得动吗」：写入 → 等 150~300ms → 再读。变了就说明有人在回写。

### 2. 定注入层级

| 变量的声明位置 | 样式表能覆盖吗 | 做法 |
|---|---|---|
| `documentElement.style` / `body.style` 带 `!important` | 不能（inline important 最高） | 声明到 `body` 的**子元素**（`#root`）上，靠继承生效 |
| 样式表里带 `!important` 的规则 | 能 | 同等 `!important` + 提高特异性（补 `html[data-xxx]` 前缀） |
| 每 N 毫秒被 JS 回写 | 只在其上层级有效 | 不写同一元素；挪到回写够不着的子元素 |
| 字面量颜色 + 每帧刷 `background-color` | 不能 | 放弃正面攻击，把**相邻层**改成同值，视觉合并 |

自定义属性走**继承**，后代取最近的祖先声明 —— 这是绕开一切 inline `!important` 的关键，
先试它再想别的。完整判据见 `references/inject.md`。

### 3. 注入 + 双层验证

```bash
node scripts/cdp.js shot out.png --sel '[data-some-anchor]' --scale 2  # 精确裁切对比
node scripts/cdp.js eval /abs/scripts/audit-contrast.js                # 目标：total 归零
node scripts/cdp.js click 26 20                                        # 附带 elementFromPoint 命中
```

`shot` 的 `clip` 用 **CSS 坐标**。截图宽度 ÷ `size` 报的 `innerWidth` = 缩放系数，
不要拿截图里的像素直接当坐标。

### 4. 收敛判据

- 对比度：小字 < 4.5:1、大字 < 3:1 的条目数为 **0**
- 几何：要对齐的两个元素，`getBoundingClientRect()` 的 left/right 完全一致
- 交互：`elementFromPoint` 命中的是目标元素本身，不是覆盖层
- 视觉：改前 / 改后两张同角度截图并列可对照

## 症状 → 去哪查

这张表只做分诊，详细病因在对应文件里。

| 症状 | 先看 | 大概率原因 |
|---|---|---|
| 字普遍偏淡、标签看不清 | `inject.md` | 文字色阶令牌压太低，`-tertiary` 语义被指到深色档 |
| 某片区域大黑条 / 整页字隐形 | `dsh-map.md` 第四节 | 子应用自带明暗两套调色板，暗色标记还挂在 DOM 上 |
| 按钮点不动 | `inject.md` | 弹层系统残留全屏透明捕获层，目标 `z-index` 压不过它 |
| 两个元素左右不对齐 | `inject.md` | 两者父容器 padding 不同，可用宽不一样 |
| 回答问题的时候正文列变窄 | `dsh-map.md` 五点五 | 浮层接管输入卡，限宽的测量源当场失真 |
| 颜色怎么写都不变 | `inject.md` | inline `!important`，或主题脚本按帧回写 |
| 宽度重启后变小、长不回来 | `pitfalls.md` 第五节 | 布局没排完就把量测值写进了持久状态 |
| 改完插件没反应 | `pitfalls.md` 第三节 | 注册三处缺一，或 `client.js` 没走 `__ModuleLoader__.load` |
| 重启卡在 Loading plugins… | `pitfalls.md` | 热 reload 在插件阶段卡死，只能冷启动 |
| 选择器今天有效明天失效 | `pitfalls.md` | 用了哈希类名，换 `data-*` |
| 布局改完整页跳一下 | `pitfalls.md` | 改了 width/height 触发重排，改用 `transform` |
| 启动时间怎么优化都不动 | `startup-perf.md` | 时间花在 host 的插件初始化，属本体成本 |
| 截图和真实尺寸对不上 | `pitfalls.md` | 截图有缩放系数，用 CSS 坐标换算 |
| 界面太吵、不知道看哪 | `attention.md` | 所有元素音量相同，需要按状态分配权重 |
| 生成时输入框不缩回 | `attention.md` | `typing` 判据只看焦点，发了消息焦点还在框里 |
| 读完答案周围还在压暗 | `attention.md` | `data-state="running"` 挂到整轮结束，`done` 判断不到位 |
| 提问 / 选择卡片出现，注意力没接管 | `attention.md` | 判据用了不存在的 slot 名；或输入区被压暗，卡片反而半透明 |

## 脚本

全部零第三方依赖，只用 Node 内置模块（Node 22+ 才有内置 WebSocket）。

| 脚本 | 作用 |
|---|---|
| `scripts/cdp.js` | CDP 客户端：`targets` / `eval` / `shot` / `click` / `size` / `type`。`--port`（默认 9223 或 `CDP_PORT`）、`--match <url片段>` |
| `scripts/keys.js` | 发**真实**键盘事件（`ctrl+a` / `Backspace` / `Escape`）。清理受控编辑器必用 |
| `scripts/audit-contrast.js` | 页面内对比度审计（含祖先 opacity 累乘、多层背景 alpha 合成），WCAG AA，按严重度排序 |
| `scripts/find-dark-bars.js` | 深色块 / 深色渐变探测，父块已覆盖的子块不重复报 |
| `scripts/new-plugin.js` | 建插件骨架 + 注册三处 + 建目录联接。`node new-plugin.js <name> [显示名]` |
| `scripts/measure-startup.js` | 冷启动计时，输出 T1/T3 与 `RESULT` 行；`--probe` 只报告不重启 |
| `scripts/selftest.js` | 注意力核心库回归测试，11 场景 25 断言，零依赖 |

`eval` 的表达式文件请返回 `JSON.stringify(...)` 字符串，输出可直接当证据留存。

**清理受控编辑器只能走键盘事件。** Lexical / Slate / CodeMirror 维护自己的状态树，
直接改 `innerHTML` 或 `execCommand('delete')` 都会被状态层覆盖（表现为「看起来删了、
下次渲染又出现」）。正确姿势：

```bash
node scripts/keys.js ctrl+a && node scripts/keys.js Backspace
```

## 目录

```
SKILL.md
references/
  inject.md          运行时注入：层级判据、可复用模板、验收清单
  dsh-map.md         dsh 地图：路径、锚点、变量族、主题三层封锁
  plugin-dev.md      插件四文件全文骨架、注册三处命令、生命周期写法
  pitfalls.md        统一踩坑清单 + 已知不可行
  startup-perf.md    启动耗时诊断实录、地板法、排除项、预热方案
  attention.md       注意力导演：状态机、running 时间窗、反模式
  visual-recipe.md   视觉配方：每个数值的来源与调参边界
assets/
  attention-core.js  可移植核心库，锚点走配置对象，不绑定宿主
scripts/             七个脚本，见上表
history/             合并前三个仓库的 git bundle（可用来追溯或被删内容）
```

## 变更记录

- 2026-10-23 v2.0.0 由 `electron-ui-injection`、`dsh-plugin-dev`、
  `attention-director` 三个技能合并。`cdp.js` 原本两份完全重复（diff 为 0），现只留一份；
  dsh 启动性能知识原本散在 `dsh-notes` 与 `startup-perf` 两处，现统一到后者；
  已知不可行清单原本有两份，现统一到 `pitfalls.md` 第六节。三个仓库的历史以
  git bundle 形式留在 `history/`。
- 合并前的版本：`electron-ui-injection` v1.2、`dsh-plugin-dev` v1.0.2、
  `attention-director` v1.0.3。
