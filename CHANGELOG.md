# 变更记录

## v2.0.3 · 2026-10-23 · 测量源必须在被测那一刻稳定

用户原话：「内容流显示框在我回答问题的时候会变窄。」

**改了什么**

| 文件 | 改动 |
|---|---|
| `references/dsh-map.md` | 新增「五点五、限宽：正文列和输入卡共用一个变量」 |
| `references/pitfalls.md` | 新增「靠测量输入卡来定正文列宽度，浮层一出就缩」 |
| `SKILL.md` | 症状表加一行：回答问题的时候正文列变窄 |

**为什么**

限宽取 `min(输入卡宿主, 正文列容器)` 是对的——两者外壳 padding 不同（16 / 32），
不取小就左右对不齐。但输入卡宿主这个测量源在浮层接管时失真：三种待回话卡片都渲染在
`[data-composer-overlay]` 里，是输入卡的后代，卡片一浮出，`[data-composer-card]` 的
`parentElement` 可用宽度掉几十像素，`min` 跟着掉，正文列整列缩窄；卡片消失又长回去。

写成一句可复用的规则：**测量源必须在被测那一刻稳定。** 受影响就换源，
不要为了省事把 `min` 去掉——那会破坏左右一条线。

**怎么验证的**

`scripts/selftest.js` 25 通过 / 0 失败。插件侧改动见 dsh-attention `CHANGELOG v0.10`；
真机复测待带调试端口的冷启动（这次实例 9223 无监听，取不到页面帧数据）。

---

## v2.0.2 · 2026-10-23 · 澄清「等你回话」的三种形态

**改了什么**

- `references/attention.md` 状态机表把 `approval` 从「出现审批卡」改为「出现『等你回话』
  的卡片」，并新增一节讲清它的定义、三种形态、两个实现陷阱、离开条件。
- `references/dsh-map.md` 锚点表删掉从不命中的 `[data-slot*="approval"]`，补上
  `[data-approval-key]` / `[data-question-key]` / `[data-plan-review-key]` /
  `[data-question-reply]` / `[data-composer-overlay]`。
- `references/pitfalls.md` 新增「猜出来的 slot 名从不命中，还不报错」，附两条查法。
- `SKILL.md` 症状表补一行分诊。

**为什么**

用户提出「AI 问我问题的时候，让我做选择的时候，都是注意力焦点」。按这条回查 dsh 实现，
发现 `approval` 判据用的是 `[data-slot*="approval"]`——slot 全集里没有这个名字，
`app.asar` 里搜 `data-slot="approval` 也是 0 处，所以这态从来没进去过。

真实锚点在组件源码里：提问与计划审核来自
`dsh/node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`，
工具许可来自 `ui-tool` 的 `ApprovalPanel`。三者都挂在
`[data-composer-overlay]`（`height:0; position:absolute`）里，是输入卡的后代——
所以任何「压暗输入区」的退让规则都会把焦点自己压暗。

**怎么验证的**

在 dsh 活体页面里逐个注入三种锚点，每次等两个 sync 周期后读状态与沿祖先链累乘的
有效不透明度：三种均进入 `approval`，卡片 1、最后一条消息流 0.46、seat 1；
移除探针后回到 `typing`。`node --check` 通过。

## v2.0.1 · 2026-10-23 · 改名 dsh-electron-ui-forge

**改了什么**

`electron-ui-forge` → `dsh-electron-ui-forge`。目录、`SKILL.md` 的 `name` 与标题、
`README.md` 标题同步改名。

**为什么**

技能内容的主体是 dsh 专属的：exe 路径、9223 端口、`data-*` 锚点、`--dsw-*` 变量族、
主题三层封锁、DS Bot 页、启动耗时实测。通用的 CDP 注入与对比度审计只是手段。
名字带 `dsh` 有三个作用：技能列表里按前缀归组；触发词更准，不会在「改别的 Electron
应用」时被当作 dsh 专用流程；避免读者误以为这是一套与 dsh 无关的通用工具。
保留 `electron`，说明手段适用于任何 Electron 应用。

**怎么验证的**

目录改名后 `git status` 干净；`selftest.js` 25 通过 / 0 失败；`cdp.js targets` 正常连上运行中的 dsh。

## v2.0.0 · 2026-10-23 · 三个技能合并为 electron-ui-forge

**改了什么**

`electron-ui-injection`、`dsh-plugin-dev`、`attention-director` 合并成一个技能。
一个入口、一份铁律、一张症状表、一套脚本。

| 合并项 | 处理 |
|---|---|
| `scripts/cdp.js` | 原来两份，`diff` 差异 0 行，只留一份 |
| dsh 启动性能 | 原来散在 `dsh-notes` 与 `startup-perf` 两处，统一到 `startup-perf.md` |
| 已知不可行清单 | 原来 `pitfalls` 与 `dsh-notes` 各一份，统一到 `pitfalls.md` 第六节 |
| 插件机制四文件表 | 原来 `dsh-notes` 与 `plugin-skeleton` 各一份，统一到 `plugin-dev.md` |
| 通用注入手法 | 原 `playbook.md` → `references/inject.md`，标题改为通用表述 |
| 注意力导演 | 原 `SKILL.md` 正文 → `references/attention.md`，`visual-recipe` 保持独立 |
| README / LICENSE / .gitignore / .gitattributes | 三份合一 |

**为什么**

三者本来就是一条链：改成品应用 UI → 发现要改机制 → 写插件 / 用状态机引导注意力。
拆成三个技能会让同一份知识（CDP 连接、`data-*` 锚点、层级判据）各维护一遍，
发布到开源时也要维护三个仓库。

**怎么验证的**

- `node scripts/selftest.js` → 25 通过 / 0 失败
- 全部脚本与 `assets/attention-core.js` 过 `node --check`
- 三个旧仓库以 `git bundle` 完整导出到 `history/`，可随时恢复追溯

## 合并前：electron-ui-injection

# electron-ui-injection 变更日志

记录格式：版本 · 日期 → 改了什么 → 为什么 → 怎么验证的。

---

### v1.2 · 2026-10-23 — 可发布整理

**改了什么**

- 新增 `README.md`、`LICENSE`（MIT）、`.gitignore`、`.gitattributes`
- 清除本机信息：exe 路径改 `%LOCALAPPDATA%` 约定、插件目录改 `~/.dsh/`、
  本机代理端口改为通用描述（「若配了 http_proxy，curl 会被吞掉」）

**为什么**

准备发布到 GitHub。发布版不应暴露作者机器的用户名、安装位置与环境细节。

**怎么验证的**

四个脚本 `node --check` 全过；`keys.js` 无参数时正常打印用法；
全仓扫描用户名与盘符路径，无残留。

### v1.1 · 2026-10-23 — 补键盘事件通道

**改了什么**

- 新增 `scripts/keys.js`：通过 `Input.dispatchKeyEvent` 发送真实按键，支持 ctrl/alt/shift/meta 组合与重复次数

**为什么**

清理 Lexical 编辑器的输入内容时踩坑：先 `focus()` 再 `execCommand('selectAll')` + `execCommand('delete')`，
返回成功但文字还在（残留 6 个字符）。原因是 Lexical 维护自己的状态树并在下一次渲染时把 DOM 写回来。
改为真实键盘事件（ctrl+a → Backspace）后一次清空成功，`data-attn-filled` 标记同步消失。

**怎么验证的**

在运行中的 dsh 上：输入「测试虚化效果」→ ctrl+a / Backspace → `textContent` 为空、
`innerHTML` 只剩 Lexical 的托管换行、无残留文字。SKILL.md 的脚本表与清理段落同步更新。

---

### v1.0 · 2026-10-23 — 首版

从「dsh 注意力导演」三轮实战（原型 → 插件落地 → 可读性修复 → 四条看图反馈）
中提炼，把一次性经验固化成可复用的注入式改造流程。

**内容**

- `SKILL.md`：五条铁律、六步工作流、症状→病因→手法决策表、反模式清单
- `scripts/cdp.js`：零依赖 CDP 客户端（`targets` / `eval` / `shot` / `click` / `size`），
  Node 22+ 内置 WebSocket
- `scripts/audit-contrast.js`：WCAG AA 对比度审计，含祖先 opacity 累乘与多层背景 alpha 合成
- `scripts/find-dark-bars.js`：深色块/深色渐变探测，父块已覆盖的子块不重复报
- `references/playbook.md`：层级选择三问、回写检测脚本、探测模板、`:where()` 降特异性、验收清单
- `references/dsh-notes.md`：dsh 专属——启动命令、插件注册三处、真实锚点、主题三层封锁、
  DS Bot 页处理、已知不可行项

**为什么**

前几轮每次都从头查「变量为什么改不动」「按钮为什么点不动」「黑条哪来的」，
重复成本高。把判断法则与量化验证脚本固化后，同类问题可直接走流程。

**验证**

在运行中的 dsh 上实测（CDP 9223，视口 1440×860）：

- `cdp.js targets` → 取到 `dsh-app://app/` 页面
- `cdp.js size` → `{"innerWidth":1440,"innerHeight":860,"devicePixelRatio":1}`
- `cdp.js eval audit-contrast.js` → `total: 0`（主界面全部达标）
- `cdp.js eval find-dark-bars.js` → `total: 0`（修正渐变透明色误报后）
- `cdp.js shot` 正常写出 PNG；`cdp.js eval -` 走 stdin 正常；不存在的文件给出明确 ENOENT
- `node --check` 三个脚本全部通过

## 合并前：dsh-plugin-dev


### v1.0.2 · 2026-10-23 · 可发布整理

**改了什么**

- 新增 `README.md`、`LICENSE`（MIT）、`.gitignore`
- 内置 `scripts/cdp.js`（与技能 `electron-ui-injection` 同源），仓库自包含，不再跨技能引用
- 清除全部本机路径：exe 路径改为 `%LOCALAPPDATA%` 约定 + `DSH_EXE` 覆盖，
  脚本调用改为相对的 `scripts/xxx.js`，`new-plugin.js` 的提示改为输出自身绝对路径
- `measure-startup.js` 的参数统一为 `--probe`（原先裸写 `probe` 会被当成 label 触发完整冷启动）

**为什么**

准备发布到 GitHub。发布版不能出现作者机器的用户名与安装位置，也不能依赖仓库外的文件——
别人 clone 下来必须能直接跑。

**怎么验证的**

四个脚本 `node --check` 全通过；`attention-director/scripts/selftest.js` 25 项断言全通过；
全仓扫描本机路径与高危命令模式，仅剩安装路径示例（`~/.workbuddy/skills/...`），属预期。

### v1.0.1 · 2026-10-23 · 就绪判据修正

`measure-startup.js` 的 T3 判据原来只查「输入卡存在」，实测会提前 50 秒放行：
启动时先渲染设置页，输入卡在该阶段已进入 DOM，而页面正文还是「正在加载设置…」空壳。
据此量出的 43s 是假的，真实可交互时间约 96s。

判据改为三条同时成立：

```js
card && card.getBoundingClientRect().height > 0
  && !document.body.innerText.includes('正在加载')
```

同步更新 `references/pitfalls.md` 与 `references/startup-perf.md` 中的判据说明，
并新增一条通用规则：任何「等某元素出现」的判据，都要确认该元素不会在加载占位阶段
就存在。

### v1.0.0 · 2026-10-23 · 首次建立

把「改造 dsh」这三轮实战沉淀为可复用技能。

### 来源

- dsh-attention 插件的完整开发周期（v0.1 → v0.7）：插件骨架、注册三处、
  属性驱动样式、React 重渲染后的元素重挂载、冷重启验证。
- dsh 启动耗时两轮诊断：三段计时、地板法、时间线取证、九项排除、
  V8 编译缓存与 profiler 的失败路径。
- 踩坑记录：环境变量污染、单实例、热 reload 卡死、假判据、零高度副本、
  inline `!important` 反解法则。

### 内容

- `SKILL.md`：五条铁律、六步工作流、症状→病因表、层级选择表、反模式。
- `references/plugin-skeleton.md`：四文件全文骨架、注册三处命令、生命周期写法、
  React 重渲染应对、最小可验证清单。
- `references/pitfalls.md`：按「撞上就浪费一轮」排序的踩坑清单，含「已知不可行」。
- `references/startup-perf.md`：启动诊断三段计时、时间线、地板法、九项排除、预热方案。
- `scripts/new-plugin.js`：生成骨架 + 注册三处 + 建目录联接（含重复保护与备份）。
- `scripts/measure-startup.js`：冷启动计时，输出 T1/T3 与 RESULT 行。

### 验证

- `new-plugin.js` 在 `DSH_HOME` 沙箱中实跑通过：四个文件生成、`client.js`
  通过 `node --check`、profile 注册三项到位、目录联接建立、重复运行被拒绝。
- `measure-startup.js` 在真实环境冷启动两次：T1 2.9s / T3 118.9s、
  T1 2.2s / T3 76.8s，`--probe` 分支正确报告运行中实例的状态。
- 沙箱数据已清理，未触碰真实 profile。

### 与既有技能的关系

- `electron-ui-injection`：通用 Electron UI 注入技法（对比度审计、几何对齐、
  层叠判定）。本技能不重复实现 CDP 客户端，直接复用它。
- `attention-director`：本技能负责「怎么把代码装进 dsh」，那个技能负责
  「装进去的东西按什么规则决定注意力」。

### 已知边界

- 技能内的启动耗时数据来自本机（Windows、20 个插件）。换机器需重新取基线，
  但测法与判据通用。
- 只覆盖插件式改造，不含解包修改 `app.asar` 的路径（该路径已判定为不可取）。

## 合并前：attention-director


### v1.0.3 · 2026-10-23 · 澄清 `running` 的时间窗

**改了什么**

`SKILL.md` 的状态机章节新增「`running` 的时间窗：从「提出问题」到「答案开始」」，
把原本含糊的一句「存在 running 标记」拆成有起止的定义：

| 边界 | 判据 |
|---|---|
| 起点 | 用户按下发送、问题进入 DOM |
| 中间 | 排队、思考、调工具、等首字，全程都算 |
| 终点 | 答案出现（不再有「正在处理」标记），焦点转到答案 |

同时写清两个实现陷阱，它们都会让这段区间表现错位：

1. **`typing` 必须在按下发送那一刻结束。** 判据不能只看 `activeElement` 在输入卡里——
   多数宿主的输入框发完消息不释放焦点，整个等待期会停在 `typing`：
   输入框保持放大发光、迟迟不缩回，与「发出指令后输入框缩回」正好相反。
   要再加一层「用户确实在写」：`inputFocused() && !justSubmitted`。
2. **`data-state="running"` 常挂到整轮结束。** 直接拿它当判据，用户读答案的全程
   周围都压着，`done` 可能永远不出现。判据要能区分「在等」和「在答」。

**为什么**

用户指出这段的实际表现有瑕疵，并给出了定义：「AI 运行时 = 我提出问题到 AI 给出答案前」。
按这个定义回查实现，两处判据都往外溢了——一个提前开始不了，一个结束不了。

**怎么验证的**

在 dsh 上实测：`document.visibilityState` 为 `hidden` 时 `setTimeout(50)` 两秒不执行，
证明定时器被冻结；`data-dsh-attn="running"` 而 `[data-state="running"]` 数量为 0，
证明状态确实冻在旧帧。两条判据修正后写入示例代码。

### v1.0.2 · 2026-10-23 · 可发布整理

**改了什么**

- 新增 `README.md`（含效果说明、状态机表、接入示例、已验证数据）、`LICENSE`（MIT）、`.gitignore`
- `SKILL.md` 移除指向作者本机的实现路径，改为说明「核心库 + 视觉配方 + 状态机即可从零重建」，
  并把姊妹技能标为配套仓库

**为什么**

准备发布到 GitHub。示例代码会过期，配置才是契约——仓库不承诺任何特定宿主的完整实现。

**怎么验证的**

`node scripts/selftest.js` 25 项断言全通过；`attention-core.js` 语法检查通过。

### v1.0.1 · 2026-10-23 · 真实界面实测与两处修复

在真实 dsh 窗口（CDP 注入，非模拟）跑完整验证，抓到两个会让技能「装上却没效果」的缺陷。

### 修复

1. **CSS 顺序导致缩放失效。** 基础态规则 `html[data-attn] card{transform:translateY(0) scale(1)}`
   写在 `html[data-attn="typing"] card{transform:...scale(1.05)}` 之后。两者特异性相同，
   后者胜出，输入卡永远停在 `matrix(1,0,0,1,0,0)`。光晕还在（因为基础规则没写 box-shadow），
   所以肉眼容易误判为「生效了」。
   → 基础态（transition / 归零 / origin）全部前置。
2. **核心库末尾缺分号。** 拼接执行时，末尾的赋值表达式会与下一行的 `(` 被 ASI 拼成
   一次函数调用，整套代码静默失效（返回 undefined，无报错）。
   → 两行结尾补分号，并在 SKILL.md 反模式里记下这一条。

### 实测数据（dsh 真实窗口，测试参数：绿光 / lift 12 / scale 1.05）

| 项 | 实测 |
|---|---|
| 样式注入 | 15 条规则、1932 字节 |
| typing 视觉 | `matrix(1.05, 0, 0, 1.05, 0, -12)`，四层阴影齐全 |
| done 权重 | 结果块 1，其余 0.42，焦点块唯一 |
| running 权重 | 运行块 1，其余 0.36 |
| 错误块 | running 态下 opacity 1，未被压暗 |
| 真实点击 | `Input.dispatchMouseEvent` 点击输入区 → `state: typing`，焦点检测成立 |
| 清理 | detach 后属性、style、焦点标记全部归零 |

截图存档：`WorkBuddy/2026-10-22-22-11-49/perf/attn-shot.png`。

### 说明

- 真窗口里 JS `input.focus()` 在窗口未激活时无效，鼠标事件在 `document.hasFocus()` 为真时有效。
  验证焦点检测要用真实点击，不要用 `focus()`。
- 空会话没有消息块，权重测试用注入的测试块（挂在 `body` 下、视口内，测完移除），不碰 React 树。

### v1.0.0 · 2026-10-23 · 首次建立

把 dsh-attention 插件里「注意力导演」这一套交互范式抽成独立技能。
原先它与插件工程细节混在一起，导致「想用到别的界面」时无法直接迁移。

### 来源

dsh-attention 从 v0.1 到 v0.7 的迭代，其中可迁移的是决策规则而不是色值：

- 单焦点原则：同一时刻只有一个区域占满视觉权重
- 五态状态机：idle / typing / running / approval / done，按优先级推导
- `done` 只能由事件记住（running 消失的瞬间），撤销靠事件（开始输入 / 滚出视野）
- 焦点块不可见时全体恢复等权，否则压暗变成惩罚
- 错误行永不压暗，且特异性要带 `:not([data-attn-live])`
- 输入卡「被拿起」需要四层阴影同时给：实边 / 淡环 / 外发光 / 离地投影
- 发光必须用高饱和色，正文色扩散出来只是一层灰
- 虚化上限 1.4px，且只在「真的在写字」时上

### 内容

- `SKILL.md`：核心原则、状态机表、视觉配方、实现五步、验收判据、反模式。
- `assets/attention-core.js`：可移植核心库。锚点与配色走配置，不绑定宿主；
  提供 `attach` / `detach` / `force` / `auto` / `state` / `liveCount`。
- `references/visual-recipe.md`：每个数值的来源与调参边界，含「为什么不是别的数」。
- `scripts/selftest.js`：零依赖 DOM 替身回归测试，覆盖 11 个场景。

### 验证

`node scripts/selftest.js` 25 项断言全部通过。测试过程中发现并修复一处真实缺陷：
审批态仍给运行中的内容块打焦点标记，与「单焦点」原则冲突（原实现靠 CSS 没写
`[data-attn-live]` 规则掩盖了这个冲突，属于侥幸）。

### 已知边界

- 核心库假定宿主用「块 + 类型属性」的结构表达消息流；不适用虚拟滚动的窗口化列表
  （元素会被复用，焦点标记需要跟随 key 迁移）。
- 视觉数值按浅色纸质底调；深色底需要重新取发光色的饱和度与 α。
- `done` 的撤销依赖滚动可见性判断，宿主若有独立的「自动滚动到底部」行为，
  需要在滚动后补一次 `sync()`（核心库已监听 capture 滚动，通常无需额外处理）。
