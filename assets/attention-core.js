/**
 * attention-core.js — 注意力导演的可移植核心。
 *
 * 不绑定任何宿主：锚点与配色全部走配置。接新应用时只改 SELECTORS / CONFIG。
 *
 * 用法（浏览器）:
 *
 *   const director = createAttentionDirector({
 *     selectors: {
 *       flow:     '[data-chat-flow-kind]',   // 消息/内容块，需要有类型属性
 *       kindAttr: 'data-chat-flow-kind',     // 类型属性名
 *       running:  '[data-state="running"]',  // 「正在处理」的标记
 *       input:    '[data-composer-input]',   // 输入框
 *       card:     '[data-composer-card]',    // 输入卡容器
 *       approval: '[data-slot*="approval"]', // 审批/确认弹层（可选）
 *     },
 *     config: {
 *       accent: '166,124,0',   // 发光色 RGB 分量
 *       ink:    '43,38,32',    // 投影色 RGB 分量
 *       resultKind: 'assistant-step', // 结果块类型（done 态的焦点）
 *       errorKind:  'turn-error',     // 错误块类型（永不压暗）
 *     },
 *   })
 *
 *   director.attach()          // 挂载：注入样式 + 监听
 *   director.force('done')     // 调试：强制某态（不动真实 DOM 状态）
 *   director.auto()            // 调试：回到自动推导
 *   director.detach()          // 卸载：移除全部痕迹
 *
 * 决策全部在 sync() 内完成，状态写到根元素的三个属性上，样式从属性派生。
 */
function createAttentionDirector(options) {
  const opts = options || {}
  const doc = opts.document || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('attention-core: 需要 DOM 环境')

  const root = doc.documentElement
  const body = doc.body

  // ── 配置 ────────────────────────────────────────────────────────────
  const S = Object.assign(
    {
      flow: '[data-chat-flow-kind]',
      kindAttr: 'data-chat-flow-kind',
      running: '[data-chat-flow-kind] [data-state="running"]',
      input: '[data-composer-input]',
      card: '[data-composer-card]',
      approval: '[data-slot*="approval"]',
      resultKind: 'assistant-step',
      errorKind: 'turn-error',
    },
    opts.selectors
  )

  const C = Object.assign(
    {
      accent: '166,124,0',
      ink: '43,38,32',
      weight: { typing: 0.55, running: 0.36, done: 0.42, approval: 0.46 },
      blur: 1.4,
      lift: 6,
      scale: 1.022,
      durationMorph: 260,
      durationWeight: 220,
    },
    opts.config
  )

  const ATTR = 'data-attn'
  const LIVE = 'data-attn-live'
  const FILLED = 'data-attn-filled'
  const OFFSCREEN = 'data-attn-offscreen'

  // ── 样式 ────────────────────────────────────────────────────────────
  const css = `
html[${ATTR}] ${S.flow}{
  transition:opacity ${C.durationWeight}ms cubic-bezier(.4,0,.2,1),
             filter ${C.durationWeight}ms cubic-bezier(.4,0,.2,1);
}
html[${ATTR}="typing"] ${S.flow}{ opacity:${C.weight.typing} }
html[${ATTR}="running"] ${S.flow}:not([${LIVE}]){ opacity:${C.weight.running} }
html[${ATTR}="running"] ${S.flow}[${LIVE}]{ opacity:1 }
html[${ATTR}="done"] ${S.flow}:not([${LIVE}]){ opacity:${C.weight.done} }
html[${ATTR}="done"] ${S.flow}[${LIVE}]{ opacity:1 }
html[${ATTR}="approval"] ${S.flow}{ opacity:${C.weight.approval} }

/* 错误块永不压暗。:not([${LIVE}]) 不能省，否则特异性不够会被主规则压回去 */
html[${ATTR}="running"] ${S.flow}[${S.kindAttr}="${S.errorKind}"]:not([${LIVE}]){ opacity:1 }
html[${ATTR}="done"]    ${S.flow}[${S.kindAttr}="${S.errorKind}"]:not([${LIVE}]){ opacity:1 }

/* 焦点块不在视野里时恢复等权：此时压暗只是惩罚 */
html[${ATTR}="running"][${OFFSCREEN}] ${S.flow}{ opacity:1 }
html[${ATTR}="done"][${OFFSCREEN}]    ${S.flow}{ opacity:1 }

/* 基础态必须写在状态规则【之前】：同特异性下后出现的胜出，
   若把「归零」放在 typing 之后，输入卡就永远不放大（实测踩过）。 */
html[${ATTR}] ${S.card}{
  transition:transform ${C.durationMorph}ms cubic-bezier(.22,1,.36,1),
             box-shadow ${C.durationMorph}ms cubic-bezier(.22,1,.36,1);
  transform:translateY(0) scale(1);
  transform-origin:50% 100%;
}

/* 输入卡被拿起：抬升 + 双环 + 外发光 + 离地投影，四层缺一不可 */
html[${ATTR}="typing"] ${S.card}{
  transform:translateY(-${C.lift}px) scale(${C.scale});
  box-shadow:
    0 0 0 2px rgba(${C.accent},.66),
    0 0 0 7px rgba(${C.accent},.09),
    0 0 30px 7px rgba(${C.accent},.20),
    0 18px 42px -12px rgba(${C.ink},.28);
}

/* 真在写字时才虚化：点进去就糊整页太凶 */
html[${ATTR}="typing"][${FILLED}] ${S.flow}{
  filter:blur(${C.blur}px);
  opacity:.5;
}

@media (prefers-reduced-motion: reduce){
  html[${ATTR}] ${S.flow}, html[${ATTR}] ${S.card}{ transition:none }
}
`

  // ── 运行时状态 ──────────────────────────────────────────────────────
  let observer = null
  let styleEl = null
  let debounce = null
  let lastState = null
  let forced = null
  let sawRunning = false
  let doneActive = false
  let releasedFor = null
  let lastLive = null
  const listeners = []

  const qs = sel => doc.querySelector(sel)
  const qsa = sel => doc.querySelectorAll(sel)

  function visibleHeight(el) {
    return el && el.getBoundingClientRect().height > 0
  }

  function readInputText() {
    const el = qs(S.input)
    if (!el) return ''
    // contenteditable 没有 value；textarea 才有
    return typeof el.value === 'string' ? el.value : el.textContent || ''
  }

  function inputFocused() {
    const el = qs(S.input)
    if (!el) return false
    const active = doc.activeElement
    return !!active && (active === el || el.contains(active))
  }

  // 结果块：最后一个可见的非错误结果块；整轮失败时退到错误块
  function resultBlock() {
    const flows = qsa(S.flow)
    let answer = null
    let failed = null
    for (let i = 0; i < flows.length; i++) {
      const el = flows[i]
      if (!visibleHeight(el)) continue
      const kind = el.getAttribute(S.kindAttr)
      if (kind === S.resultKind) answer = el
      else if (kind === S.errorKind) failed = el
    }
    return answer || failed
  }

  function derive() {
    if (S.approval && qs(S.approval)) return 'approval'
    if (qs(S.running)) return 'running'
    if (inputFocused()) return 'typing'

    // done 是「挂着的」状态，不是算出来的：结果还在视野里、用户还没开始下一句，
    // 它就一直是焦点。撤销靠事件（开始输入 / 滚出视野），不靠计时。
    if (doneActive) {
      const result = resultBlock()
      if (result && result !== releasedFor) return 'done'
      doneActive = false
    }
    return 'idle'
  }

  // 打焦点标记，返回焦点块是否在视野内
  function markLive(state) {
    const previous = qsa('[' + LIVE + ']')
    for (let i = 0; i < previous.length; i++) previous[i].removeAttribute(LIVE)

    // 审批态的焦点是审批卡本身（由宿主自己承重），不需要给内容块打标。
    // 这里若继续走 running 分支，会把某个内容块标成 1，与「单焦点」冲突。
    if (state === 'approval') {
      lastLive = null
      return true
    }

    let latest = null
    if (state === 'done') {
      latest = resultBlock()
    } else {
      const running = qsa(S.running)
      for (let i = 0; i < running.length; i++) {
        const item = running[i].closest(S.flow)
        if (item && visibleHeight(item)) latest = item
      }
    }
    if (latest) latest.setAttribute(LIVE, '')
    lastLive = latest

    const rect = latest && latest.getBoundingClientRect()
    return !!rect && rect.bottom > 0 && rect.top < (opts.innerHeight || globalThis.innerHeight || 0)
  }

  function sync() {
    // 一轮的生命周期：running 消失的那一轮把 done 打开
    if (qs(S.running)) {
      sawRunning = true
      doneActive = false
      releasedFor = null
    } else if (sawRunning) {
      sawRunning = false
      doneActive = true
      releasedFor = null
    }

    if (readInputText().trim().length > 0) root.setAttribute(FILLED, '')
    else root.removeAttribute(FILLED)

    const state = forced || derive()
    if (state !== lastState) {
      root.setAttribute(ATTR, state)
      lastState = state
    }

    const visible = markLive(state)

    // 焦点块滚出视野：用户开始翻历史，撤销 done 焦点
    if (state === 'done' && lastLive && !visible) {
      releasedFor = lastLive
      doneActive = false
      lastLive = null
      root.setAttribute(ATTR, 'idle')
      lastState = 'idle'
      root.removeAttribute(OFFSCREEN)
      const live = qsa('[' + LIVE + ']')
      for (let i = 0; i < live.length; i++) live[i].removeAttribute(LIVE)
      return
    }

    if (visible) root.removeAttribute(OFFSCREEN)
    else root.setAttribute(OFFSCREEN, '')
  }

  function schedule() {
    if (debounce) clearTimeout(debounce)
    // 60ms：一次渲染会连发几十个 MutationObserver 回调，直接 sync 会打满主线程
    debounce = setTimeout(sync, 60)
  }

  function on(target, type, fn, opt) {
    target.addEventListener(type, fn, opt)
    listeners.push(() => target.removeEventListener(type, fn, opt))
  }

  // ── 生命周期 ────────────────────────────────────────────────────────
  function attach() {
    styleEl = doc.createElement('style')
    styleEl.setAttribute('data-plugin', 'attention-director')
    styleEl.textContent = css
    doc.head.appendChild(styleEl)

    sync()

    observer = new MutationObserver(schedule)
    observer.observe(body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      // 不过滤会被主题脚本的样式回写触发，无限自激
      attributeFilter: [
        'data-state',
        'data-phase',
        'data-content-phase',
        'aria-expanded',
      ],
    })

    // 输入框的值变化不触发 MutationObserver，必须单独听
    on(doc, 'input', schedule, true)
    on(doc, 'focusin', schedule, true)
    on(doc, 'focusout', schedule, true)

    // 滚动必须 capture：发生在内部容器上，不冒泡到 window
    on(globalThis, 'scroll', schedule, { passive: true, capture: true })

    return api
  }

  function detach() {
    if (observer) observer.disconnect()
    observer = null
    if (debounce) clearTimeout(debounce)
    debounce = null
    while (listeners.length) listeners.pop()()
    if (styleEl) styleEl.remove()
    styleEl = null

    const live = qsa('[' + LIVE + ']')
    for (let i = 0; i < live.length; i++) live[i].removeAttribute(LIVE)
    root.removeAttribute(ATTR)
    root.removeAttribute(FILLED)
    root.removeAttribute(OFFSCREEN)
    lastState = null
  }

  const api = {
    attach,
    detach,
    sync,
    schedule,
    css,
    force(state) {
      forced = state
      sync()
      return api
    },
    auto() {
      forced = null
      sync()
      return api
    },
    get state() {
      return root.getAttribute(ATTR)
    },
    get liveCount() {
      return qsa('[' + LIVE + ']').length
    },
  }

  return api
}

// 末尾两个分号不能省：这份文件常被拼接到别的表达式前面执行，
// 少了分号，下一行的 "(" 会被 ASI 解析成一次函数调用。
if (typeof module !== 'undefined' && module.exports) module.exports = { createAttentionDirector };
if (typeof globalThis !== 'undefined') globalThis.createAttentionDirector = createAttentionDirector;
