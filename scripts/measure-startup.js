#!/usr/bin/env node
/**
 * measure-startup.js — dsh 冷启动计时。
 *
 * 用法:
 *   node measure-startup.js [label] [--probe]
 *
 * 输出: T1（page target 出现）/ T3（输入卡可用）以及一行 RESULT，便于横向对比。
 * --probe: 只连现有实例报告状态，不杀进程、不启动。
 *
 * 环境:
 *   DSH_EXE  可执行文件路径（默认 DeepSeek Harness 安装位置）
 *   DSH_PORT 调试端口（默认 9223）
 */
const { execSync } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const EXE =
  process.env.DSH_EXE ||
  path.join(
    os.homedir(),
    'AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe'
  );
const PORT = Number(process.env.DSH_PORT || 9223);
const CDP = `http://127.0.0.1:${PORT}/json`;

const label = process.argv[2] || 'run';
// 两种写法都认：`--probe` 或直接 `probe`。后者容易误当成 label 而触发一次完整冷启动，
// 白白关掉用户正在用的窗口。
const probeOnly = process.argv.includes('--probe') || process.argv[2] === 'probe';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(url) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: 1200 }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// 零依赖 WebSocket：发一条 Runtime.evaluate
function wsEval(wsUrl, expression) {
  return new Promise(resolve => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
      timeout: 3000,
    });
    req.on('error', () => resolve(null));
    req.on('upgrade', (res, socket) => {
      const payload = Buffer.from(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        })
      );
      const mask = crypto.randomBytes(4);
      let head;
      if (payload.length < 126) head = Buffer.from([0x81, 0x80 | payload.length]);
      else head = Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255]);
      const masked = Buffer.from(payload);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
      socket.write(Buffer.concat([head, mask, masked]));

      let buf = Buffer.alloc(0);
      let settled = false;
      const done = v => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {}
        resolve(v);
      };
      const timer = setTimeout(() => done(null), 3000);
      socket.on('data', c => {
        buf = Buffer.concat([buf, c]);
        if (buf.length < 2) return;
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) {
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return;
        clearTimeout(timer);
        const txt = buf.slice(off, off + len).toString('utf8');
        try {
          done(JSON.parse(txt));
        } catch {
          done(null);
        }
      });
      socket.on('error', () => done(null));
    });
    req.end();
  });
}

async function pageTarget() {
  const list = await getJSON(CDP);
  return (list && list.find(t => t.type === 'page')) || null;
}

// 界面是否真正可用。
// 判据不能只看「输入卡存在」：启动时设置页还在加载，输入卡已经在 DOM 里，
// 只看存在性会提前放行（实测 43s，实际 96s 才可交互）。
async function uiReady() {
  const page = await pageTarget();
  if (!page) return 0;
  const r = await wsEval(
    page.webSocketDebuggerUrl,
    `(() => {
      const c = document.querySelector('[data-composer-card]');
      if (!c || c.getBoundingClientRect().height <= 0) return 0;
      if ((document.body.innerText || '').indexOf('正在加载') >= 0) return 0;
      return 1;
    })()`
  );
  const v = r && r.result && r.result.result && r.result.result.value;
  return Number(v) || 0;
}

(async () => {
  if (probeOnly) {
    const page = await pageTarget();
    if (!page) {
      console.log(`[${label}] 无运行实例（${CDP} 无 page target）`);
      process.exit(2);
    }
    const n = await uiReady();
    console.log(`[${label}] 实例在跑，界面${n > 0 ? '可用' : '尚未就绪'}`);
    return;
  }

  // 1. 杀旧实例并等端口彻底释放（不等会撞端口，CDP 永不上线）
  try {
    execSync('taskkill /F /IM "DeepSeek Harness.exe" /T', { stdio: 'ignore' });
  } catch {}
  let freed = false;
  for (let i = 0; i < 40; i++) {
    if (!(await getJSON(CDP))) {
      freed = true;
      break;
    }
    await sleep(250);
  }
  console.log(`[${label}] 端口已释放: ${freed}`);
  await sleep(1200);

  // 2. 干净环境启动：删掉会让 Electron 退化成纯 Node 的变量
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  const args = [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'];
  const t0 = Date.now();
  // cmd start 真正脱离会话，否则 Electron 被子进程回收
  execSync(`cmd /c start "" "${EXE}" ${args.join(' ')}`, { env, stdio: 'ignore' });

  // 3. T1
  let t1 = 0;
  for (let i = 0; i < 400; i++) {
    if (await pageTarget()) {
      t1 = Date.now() - t0;
      break;
    }
    await sleep(120);
  }
  console.log(`[${label}] T1 窗口出来: ${(t1 / 1000).toFixed(1)}s`);

  // 4. T3：必须等输入卡，不能等文案
  let t3 = 0;
  for (let i = 0; i < 1200; i++) {
    if ((await uiReady()) > 0) {
      t3 = Date.now() - t0;
      break;
    }
    await sleep(400);
  }
  console.log(`[${label}] T3 界面可用: ${(t3 / 1000).toFixed(1)}s`);
  console.log(`[${label}] RESULT t1=${(t1 / 1000).toFixed(1)} t3=${(t3 / 1000).toFixed(1)}`);
})().catch(e => {
  console.error('[measure-startup] ' + e.message);
  process.exit(1);
});
