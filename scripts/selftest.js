#!/usr/bin/env node
/**
 * selftest.js — attention-core 状态机回归测试（零依赖，不需要浏览器）。
 *
 * 用法: node selftest.js
 *
 * 用一个最小 DOM 替身验证状态推导、焦点打标、done 的事件撤销、清理痕迹。
 * 改过 assets/attention-core.js 之后跑一遍，全部 PASS 才算没改坏。
 */
const path = require('path');
const { createAttentionDirector } = require(path.join(__dirname, '..', 'assets', 'attention-core.js'));

// ── 最小 DOM 替身 ──────────────────────────────────────────────────────
function matchSimple(el, sel) {
  // 支持 [attr] / [attr="v"] / [attr*="v"]
  const m = /^\[([\w-]+)(?:(\*?=)"([^"]*)")?\]$/.exec(sel);
  if (!m) return false;
  const v = el.getAttribute(m[1]);
  if (v === null) return false;
  if (m[2] === undefined) return true;
  if (m[2] === '*=') return v.indexOf(m[3]) >= 0;
  return v === m[3];
}

function match(el, sel) {
  // 支持 "A B" 形式：最后一个 token 匹配自身，前面依次匹配祖先
  const parts = sel.trim().split(/\s+/);
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  let node = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (node) {
      if (matchSimple(node, parts[i])) {
        found = true;
        node = node.parentElement;
        break;
      }
      node = node.parentElement;
    }
    if (!found) return false;
  }
  return true;
}

class El {
  constructor(tag, attrs, rect) {
    this.tagName = (tag || 'div').toUpperCase();
    this.attrs = Object.assign({}, attrs);
    this.children = [];
    this.parentElement = null;
    this.rect = rect || { top: 0, bottom: 100, height: 100 };
    this.value = undefined;
    this.textContent = '';
  }
  getAttribute(n) {
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
  }
  setAttribute(n, v) {
    this.attrs[n] = String(v);
  }
  removeAttribute(n) {
    delete this.attrs[n];
  }
  appendChild(c) {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(x => x !== this);
      this.parentElement = null;
    }
  }
  getBoundingClientRect() {
    return this.rect;
  }
  contains(other) {
    let n = other;
    while (n) {
      if (n === this) return true;
      n = n.parentElement;
    }
    return false;
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (match(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  getAll() {
    const out = [];
    const walk = e => {
      for (const c of e.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

function makeDom() {
  const html = new El('html');
  const body = new El('body');
  html.appendChild(body);
  const head = new El('head');
  html.appendChild(head);

  const doc = {
    documentElement: html,
    body,
    head,
    activeElement: body,
    createElement: t => new El(t),
    querySelector(sel) {
      const all = [html].concat(html.getAll());
      return all.find(e => match(e, sel)) || null;
    },
    querySelectorAll(sel) {
      const all = html.getAll();
      return all.filter(e => match(e, sel));
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return { doc, html, body, head };
}

// ── 断言 ───────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ' (期望 ' + expected + ')'}`);
  ok ? pass++ : fail++;
}

// ── 场景 ───────────────────────────────────────────────────────────────
const { doc, html, body } = makeDom();

const flowHost = body.appendChild(new El('div', { 'data-conversation-content': '' }));
function addFlow(kind, rect) {
  return flowHost.appendChild(new El('div', { 'data-chat-flow-kind': kind }, rect));
}
const card = body.appendChild(new El('div', { 'data-composer-card': '' }));
const input = card.appendChild(new El('div', { 'data-composer-input': '' }));
const composerSeat = body.appendChild(new El('div', { 'data-composer-seat': '' }));

const director = createAttentionDirector({
  document: doc,
  innerHeight: 900,
  selectors: {
    flow: '[data-chat-flow-kind]',
    kindAttr: 'data-chat-flow-kind',
    running: '[data-chat-flow-kind] [data-state="running"]',
    input: '[data-composer-input]',
    card: '[data-composer-card]',
    approval: '[data-slot*="approval"]',
  },
  config: { resultKind: 'assistant-step', errorKind: 'turn-error' },
});

console.log('[1] 初始：无内容 → idle');
director.sync();
check('state', director.state, 'idle');
check('焦点数', director.liveCount, 0);

console.log('[2] 光标在输入框 → typing');
doc.activeElement = input;
director.sync();
check('state', director.state, 'typing');
check('焦点数', director.liveCount, 0);

console.log('[3] 输入框有字 → 打 filled 标记');
input.textContent = '写点东西';
director.sync();
check('filled', html.getAttribute('data-attn-filled'), '');
input.textContent = '';
director.sync();
check('filled 已撤销', html.getAttribute('data-attn-filled'), null);

console.log('[4] 出现运行中块 → running，且只有它亮');
doc.activeElement = body;
const turn = addFlow('turn-process');
const running = turn.appendChild(new El('div', { 'data-state': 'running' }));
director.sync();
check('state', director.state, 'running');
check('焦点数', director.liveCount, 1);
check('焦点是运行块', running.closest('[data-chat-flow-kind]').getAttribute('data-attn-live'), '');

console.log('[5] 运行结束 → done，焦点交给结果块');
running.removeAttribute('data-state');
const answer = addFlow('assistant-step');
director.sync();
check('state', director.state, 'done');
check('焦点数', director.liveCount, 1);
check('焦点是结果块', answer.getAttribute('data-attn-live'), '');

console.log('[6] 结果块滚出视野 → 撤销 done');
answer.rect = { top: -500, bottom: -400, height: 100 };
director.sync();
check('state', director.state, 'idle');
check('焦点数', director.liveCount, 0);

console.log('[7] 结果块重新可见 + 重新进入 done（不重复撤销）');
answer.rect = { top: 100, bottom: 200, height: 100 };
director.sync();
check('state（已撤销过，不再进 done）', director.state, 'idle');

console.log('[8] 错误块在 running 态不压暗：通过属性确认状态机不干扰');
const errTurn = addFlow('turn-error', { top: 300, bottom: 400, height: 100 });
doc.activeElement = body;
const run2 = addFlow('turn-process');
run2.appendChild(new El('div', { 'data-state': 'running' }));
director.sync();
check('state', director.state, 'running');
check('错误块未被标为焦点', errTurn.getAttribute('data-attn-live'), null);

console.log('[9] 审批卡优先于一切');
const approval = body.appendChild(new El('div', { 'data-slot': 'approval-card' }));
director.sync();
check('state', director.state, 'approval');
check('焦点数', director.liveCount, 0);
approval.remove();

console.log('[10] force / auto');
director.force('done');
check('forced', director.state, 'done');
director.auto();
check('auto 回到推导', director.state, 'running');

console.log('[11] detach 清空全部痕迹');
director.detach();
check('根属性', html.getAttribute('data-attn'), null);
check('filled', html.getAttribute('data-attn-filled'), null);
check('offscreen', html.getAttribute('data-attn-offscreen'), null);
check('残留焦点', doc.querySelectorAll('[data-attn-live]').length, 0);

console.log('');
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
