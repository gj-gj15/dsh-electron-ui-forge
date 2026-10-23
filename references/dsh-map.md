# dsh 地图：路径、锚点、变量族

> 本文件只回答「dsh 长什么样、元素叫什么」，不重复通用手法。
> 通用注入技法见 `inject.md`；启动耗时诊断见 `startup-perf.md`；
> 插件四文件骨架见 `plugin-dev.md`；统一踩坑清单见 `pitfalls.md`。

实测环境：Windows，应用显示名「DeepSeek Harness」，窗口标题「花子 — DeepSeek Harness」，
页面 URL `dsh-app://app/`。

## 一、启动带调试端口

```bash
# exe 路径（Windows 默认安装位置）
"%LOCALAPPDATA%/Programs/DeepSeek Harness/DeepSeek Harness.exe"

# 必须清两个变量（IDE/沙箱进程树会注入，Electron 会退化成纯 Node：进程活着但没窗口）
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
  "$LOCALAPPDATA/Programs/DeepSeek Harness/DeepSeek Harness.exe" \
  --remote-debugging-port=9223 --remote-allow-origins=*
```

- 必须用后台模式启动；直接 `&` 会被回收（进程消失、端口无响应）。
- 环境里若配了 `http_proxy`，`curl` 访问 9223 会被代理吞掉；改用 Node 内置
  `fetch` / `WebSocket` 直连（`cdp.js` 已如此实现）。

### 启动慢

三段计时、地板法、全部排除项、预热方案都在 `startup-perf.md`，这里只留 dsh 特有的操作细节：

- **连续重启撞端口**：`bind() 0x2740` 后 devtools 起不来、CDP 连不上，measure 脚本
  会无限等。杀进程后要轮询 9223 直到连不上，再启动。
- **冷启动后默认停在「插件」设置页**，要回对话页得点侧边栏会话。探锚点前先切回去，
  否则 `[data-composer-card]` 根本不在 DOM 里。
- **临时关插件测速**：`node ~/.dsh/plugin-toggle.js`（`list` / `off|on <名>` / `off --suggest`），
  只改 profile 的 `dsh.profile.bundles`，不动 node_modules。改之前先 `cp package.json`。
- 冷启动到插件就绪 **83~96 秒**，波动大，等满 100s 再判失败。

## 二、插件机制

插件放 `~/.dsh/plugins/<name>/`，四个文件（`package.json` / `cordis.patch.yml` /
`index.js` / `client.js`），注册三处（profile 的 `dependencies`、`dsh.profile.bundles`、
`node_modules` 联接）。全文骨架与注册命令见 `plugin-dev.md`，这里只强调一句：

改 `client.js` 后**必须冷重启**，热 reload 会卡在 "Loading plugins…"。

## 三、可依赖的真实锚点

CSS Module 类名（`_9lTDKa_fade` 这类）不可依赖，只用 `data-*`：

| 锚点 | 含义 |
|---|---|
| `[data-chat-flow-kind]` | 消息块类型：`turn-trigger` / `turn-process` / `assistant-step` / `tool-call` / `turn-error` / `turn-tail` / `user` |
| `[data-state]` | 块状态：`running` / `ok` / `error` |
| `[data-composer-input]` | 输入区 `div[contenteditable=true]`（**不是 textarea**，读值要兼容 `textContent`） |
| `[data-composer-card]` | 输入卡本体 |
| `[data-composer-seat]` | 输入卡外层的壳（左右 16px padding，比正文列的 32px 小） |
| `[data-attn-col]` | 正文列容器（注入层给的自定义锚点，非原生） |
| `[data-conversation-scroll]` / `[data-conversation-content]` | 滚动容器 / 内容容器 |
| `[data-approval-key]` | 工具执行许可面板（内部滚动 `[data-approval-scroll]`） |
| `[data-question-key]` | AI 提问、给选项让用户挑（内部滚动 `[data-question-scroll]`） |
| `[data-plan-review-key]` | 计划提交上来等批准 |
| `[data-question-reply]` + `[data-reply-outcome]` | 已答完的提问记录（在消息流里，不是焦点对象） |
| `[data-composer-overlay]` | 上面三个「等你回话」面板的挂载点：`height:0; position:absolute`，在输入卡内部 |
| `[data-slot="conversation.session.header.actions"]` | 页眉面包屑右侧的官方动作插槽 |

DOM 里存在与正文同名、高度为 0 的测量/无障碍副本：取焦点时必须过滤
`getBoundingClientRect().height > 0`。

## 四、主题的三层封锁

主题「纸感」通过三个手段把所有颜色钉死：

1. `documentElement.style` 与 `body.style` 上写全套变量，带 `!important`
2. 打包 CSS 里展开成字面量规则（不只用变量）
3. 脚本每 **120ms** 回写一次（实测：写入即时生效，120ms 后被打回）

**结论：变量必须声明在 `#root`（`body` 的首个子元素）上**，靠自定义属性继承绕开
`body` 的 inline `!important`。实测 `getComputedStyle(#root)` 与深层卡片都取到新值，
不随回写抖动。

仍然钉死的东西：页面底色、品牌色（琥珀 `#A67C00`）——它们在层里被写成字面量 +
每帧刷 `background-color`，单改变量只会得到半新半旧。**要动它必须改主题源头**。

## 五、常用变量族

```
--dsw-alias-label-primary / -secondary / -tertiary / -caption    文字色阶
--dsw-alias-state-error-primary / -secondary                     错误色
--dsw-alias-state-business-tertiary / -warn-tertiary / -success-tertiary
                                                                 浅色填充（常被误指到深色档）
--dsw-static-deepseek-800                                        品牌深色档
```

实测的"深底深字"陷阱：`-state-business-tertiary` 被指到 `--dsw-static-deepseek-800`
（`#6B4D00`），「预览版」角标变成 `#2B2620` on `#6B4D00` = **1.92:1**。
`tertiary` 的语义是最浅一级填充，遇到这种要取回同色相浅色（如 `#F3E6C4`）。

## 五点五、限宽：正文列和输入卡共用一个变量

dsh 自己不给正文列和输入卡同宽，上下边界经常差几个像素。要「一条线」，
做法是让两者共用同一个自定义属性：

```
--pt-composer-w    写在 #root 的 inline style 上，默认 748px
  ├─ [data-attn-col]{ max-width:var(--pt-composer-w) }        正文列
  └─ [data-composer-card]{ max-width:var(--pt-composer-w) }   输入卡
```

为什么不写 `documentElement`：主题脚本会按帧把整套变量重写到
`documentElement.style`，写在那里会被反复抹掉，宽度来回抖。
`#root` 只被 React 管，主题够不着。

**上限必须取两个容器的较小值**，因为外壳 padding 不同：
窗口 1280 时，输入卡在 16px 外壳里可用 956，正文列在 32px 滚动区里只有 924。
取 956 的话卡比列宽 32px，左右各错 16px——「一条线」当场破功。

**但测量前要确认源是稳定的。** 三种待回话卡片（审批 / 提问 / 计划审核）
渲染在 `[data-composer-overlay]` 里，是输入卡的后代；卡片一浮出，
`[data-composer-card]` 的 `parentElement` 可用宽度就掉几十像素，
`min()` 跟着掉，正文列整列缩窄，卡片消失又长回去。
所以卡片在场时要把这个源排除。详细症状与规则见 `pitfalls.md` 第五节。

## 六、DS Bot 页（`ds-bot` 插件）

这一页是自己的一套 `--bt-*` 调色板，明/暗两版分别定义在 `html body` 与
`html body[data-ds-dark-theme]` 上。宿主底色是米黄纸却在 `body` 上留着暗色标记，于是：

```
--bt-ink  #f3f0e8   → 浅字落米黄纸，1.01:1，正文全隐形
--bt-main #1f1e1b   → 页眉 60px 渐变、输入卡、侧栏全成黑条
```

处理：把主题自己在 `html body` 上写的**浅色版 17 个值**整组抬到 `#root`——
零新造颜色，只是把浅色版盖到暗色版上。余下 4 处 10~11px 小字
（`bt-chip` / `bt-row-preview` / `bt-cluster-more` / `bt-connect-warn`）单独加深两档。

**不要摘 `data-ds-dark-theme`**：摘下立刻恢复正常配色，但主题脚本几百毫秒内写回，
会反复拉锯。

页面切换：`ds-bot:surface` 的取值是 `"agent"` / `"bot"`（不是 chat/app/workbench）。
`localStorage.setItem('ds-bot:surface','agent')` + reload 回主界面；
单写偶尔不生效（插件自己的 setSurface 会清界面状态），再写一次即可。

## 七、已知不可行

统一清单在 `pitfalls.md` 第六节，不在这里重复维护。

## 七点五、inline !important 的反解法则

碰到"某块颜色被主题锁死、样式怎么写都不动"：不要加固优先级，**改旁边那层能动的**，
让两者同值，视觉上就合并了。

实例：输入卡上半是输入区（inline 米黄，改不动）、下半是工具行（透明，露出卡片的白），
看上去一张纸上贴了半张白纸。解不是去抢输入区的控制权，而是把**卡片**改成同一个米黄
（`--pt-well:#F5F1E7`），工具行随之露出米黄，整卡一片。同色之后卡片只剩描边定形，
所以描边和投影要各加重一档，否则卡片会溶进座位里。

判断顺序：先看是不是 inline !important（读 `element.getAttribute('style')`）→ 是的话
立刻放弃正面攻击，找同色的相邻层 → 改那一层。反过来给"想变的那层"染色也可以，
但要保证和锁死层同值。

## 八、环境噪声（别当成 bug 查）

- CDP 截全页偶发渲染伪影（页眉出现黑色渐变），重截一次即正常
- 会话页右侧一组横线是原生消息跳转标记（`xpvNua_mark`，28×10），不是渲染错误
- `[data-composer-input]` 是 `contenteditable`，用 textarea 的 setter 会抛
  `TypeError: Illegal invocation`
