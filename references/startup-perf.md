# 启动耗时诊断

用户抱怨「启动太慢」时，先归因再动手。本文件记录一套可复用的测法与实测数据。

## 一、三段计时

| 里程碑 | 判据 | 怎么量 |
|---|---|---|
| T1 窗口出来 | `http://127.0.0.1:9223/json` 里出现 `type:"page"` | 轮询 |
| T2 host 就绪 | host 输出出现 `dsh web: http://127.0.0.1:PORT` | 抓 host stdout |
| T3 界面可用 | `document.querySelector('[data-composer-card]')` 命中 | CDP `Runtime.evaluate` |

用 `scripts/measure-startup.js <label>` 直接得到 T1/T3。要看 T2 得抓 host 原始输出。

**判据陷阱**：只看端口通不通会得到 0.0s；拿「Loading plugins…」文案消失当判据会得到 3.4s；
只看输入卡存在会得到 43s（设置页加载阶段卡已在 DOM 里，页面还是「正在加载设置…」空壳）。
都必须三条同时成立：

```js
card && card.getBoundingClientRect().height > 0
  && !document.body.innerText.includes('正在加载')
```

## 二、时间线（本机实测，20 插件，96.1s 那次）

| 时刻 | 事件 |
|---|---|
| 2.4s | page target 出现 |
| 2.6s | 页面骨架加载完，此后 **93 秒零资源请求** |
| 36.8s | memory-evolve 同步技能完成 |
| 55.6s | 拉取模型列表完成（`api.deepseek.com`，实测 234ms，不是瓶颈） |
| 64.0s | host 就绪 |
| 96.1s | 输入卡出现 |

关键结论：**前端不是慢，是在等 host。** 逐秒采样 `performance.getEntriesByType('resource').length`
可以证明第 4 秒到第 96 秒这个数字一直不动。

## 三、地板法

把 profile 的 `bundles` 临时缩到 `[base, web-app]` 两项，量出「不加载任何第三方插件」的成本：

| 配置 | T3 |
|---|---|
| 底座两项 | **45.7s** |
| 8 个插件 | 57.6s |
| 20 个插件 | 96~117s |

差值即插件成本：18 个插件 ≈ 62 秒，约 3.5 秒/个。做完这一步才能说清
「关插件能省多少」和「关了也不够快」这两件事。

还原务必用备份：

```bash
cp ~/.dsh/profiles/desktop/package.json.bak-<时间> ~/.dsh/profiles/desktop/package.json
```

## 四、排除项（都实测过，别重复投入）

| 猜测 | 实测 |
|---|---|
| V8 编译缓存能加速 | `NODE_COMPILE_CACHE` 三次 116.8 / 114.5 / 117.2，无差别 |
| 磁盘慢 | 37KB 文件读取 0.58ms/次；183MB asar 全读 1.7s |
| CPU 不够 | 5000 万次加法 188ms |
| asar 打包拖累 | asar 内读取 0.93ms/次、realpath 0.07ms/次，比解包还快 |
| 网络慢 | `api.deepseek.com` 234ms（代理环境不可达时也能跑完，说明不阻塞） |
| GPU | `--disable-gpu` 无差别 |
| 单个大包 | univer-office 213M 单独开机 57s，但去掉它总时长不变 |
| 会话太多 | 418 个会话全在一个月内、已压缩，归档收益 <1s |
| 主进程忙 | 主进程 97.9% idle，干活的是 host 子进程 |

底座那 34 秒空白的成因是 `createRuntimeResolution` / `collectInstallationScopePackages`
对整棵依赖图做 BFS（每个包 `realpathSync` + 读 `package.json`），但实测这些调用
本身只占毫秒级——时间花在 `dsh-base` 展开后的插件初始化计算上，代码在 asar 内，改不了。

## 五、唯一有效的手段：把等待挪到不用的时候

启动成本压不下去时，改变它发生的时间点。dsh 是单实例，只要后台已有一个实例，
点图标就是唤起窗口（0.3 秒），用户感知的启动时间 ≈ 0。

`~/.dsh/dsh-preload.cmd` 的做法：

- 开机启动文件夹放一个快捷方式，参数 `warm 90`：登录后等 90 秒再静默拉起，避免抢焦点
- 拉起前先 `tasklist` 检查是否已有实例，有就直接退出（单实例，不需要第二个）
- 提供 `install` / `uninstall` 子命令

代价：开机后常驻一份内存（约 480MB）。用户嫌占内存就卸载，改手工预热。

```bash
~/.dsh/dsh-preload.cmd uninstall    # 撤销
~/.dsh/dsh-preload.cmd              # 手动预热一次
```

## 六、脚本

| 脚本 | 作用 |
|---|---|
| `scripts/measure-startup.js` | 杀旧实例 → 冷启动 → 量 T1/T3，输出 `RESULT t1= t3=` |
| `scripts/cdp.js` | 探测页面状态（本技能自带） |
| 项目 `perf/logrun.js` | 抓 host stdout 到文件，带时间戳（要 T2 就靠它） |
| 项目 `perf/probe.js` | 启动期间逐秒采样前端状态（资源数、DOM 文本） |

`logrun.js` 与 `probe.js` 是一次性诊断脚本，留在项目目录即可，不必进技能。

## 七、给用户的结论模板

> 底座 45.7 秒是本体成本，20 个插件再加 50~70 秒，都在 asar 里，外部没有既省时间
> 又不丢功能的办法。所以做的是：开机后延迟 90 秒静默拉起，之后点图标 0.3 秒出窗口。
> 想撤就一条命令；缺点是常驻约 480MB 内存。
