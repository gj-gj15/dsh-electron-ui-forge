#!/usr/bin/env node
/**
 * new-plugin.js — 生成 dsh 插件骨架并完成注册。
 *
 * 用法:
 *   node new-plugin.js <name> [显示名] [--profile <profile名>]
 *
 * 做的事:
 *   1. 在 ~/.dsh/plugins/<name>/ 写 package.json / cordis.patch.yml / index.js / client.js
 *   2. profile package.json: dependencies 加 link + bundles 追加（先备份）
 *   3. profile node_modules 下建目录联接指向插件目录
 *
 * 不做的事: 不重启 dsh、不改任何既有插件条目。改完自己冷启动验证。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HOME = os.homedir();
// DSH_HOME 仅用于沙箱自测，正常使用保持默认
const DSH = process.env.DSH_HOME || path.join(HOME, '.dsh');

function die(msg) {
  console.error('[new-plugin] ' + msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
let profileName = 'desktop';
const pi = argv.indexOf('--profile');
if (pi >= 0) {
  profileName = argv[pi + 1];
  argv.splice(pi, 2);
}

const name = argv[0];
const display = argv[1] || name;
if (!name) die('缺少插件名。用法: node new-plugin.js <name> [显示名]');
if (!/^[a-z][a-z0-9-]*$/.test(name)) die('插件名只能是小写字母、数字、连字符，且以字母开头');

const pluginDir = path.join(DSH, 'plugins', name);
const profileDir = path.join(DSH, 'profiles', profileName);
const profilePkg = path.join(profileDir, 'package.json');

if (fs.existsSync(pluginDir)) die('插件目录已存在，拒绝覆盖: ' + pluginDir);
if (!fs.existsSync(profilePkg)) die('找不到 profile: ' + profilePkg);

// ── 1. 写插件文件 ──────────────────────────────────────────────────────
fs.mkdirSync(pluginDir, { recursive: true });

const short = name.replace(/^dsh-/, '');

const pkg = {
  name,
  version: '0.1.0',
  private: true,
  type: 'module',
  description: `${display}：一句话说明它做什么、改动范围的边界在哪里。`,
  main: './index.js',
  exports: {
    '.': './index.js',
    './client': './client.js',
    './package.json': './package.json',
  },
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: { platform: 'web', inject: [] },
  },
  keywords: ['dsh', 'dsh-plugin'],
  license: 'MIT',
};
fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

fs.writeFileSync(
  path.join(pluginDir, 'cordis.patch.yml'),
  `# ${name} bundle patch. 只放纯 insert 行（市场热挂载只认这种形状）。\n` +
    `- insert:\n    - id: ${name}\n      name: '${name}'\n`
);

fs.writeFileSync(
  path.join(pluginDir, 'index.js'),
  `/**\n * ${name} — 服务端半身。\n *\n` +
    ` * 本插件是纯前端插件：状态推导与样式注入全部在 client.js 完成，\n` +
    ` * 服务端不需要注册 webServer / tools 路由。apply 留空即可让 cordis 正常挂载。\n */\n` +
    `export const name = '${name}'\n\nexport function apply() {}\n`
);

const clientTemplate = `/**
 * ${name} — 浏览器端。
 *
 * 一句话：它把什么变成什么。
 *
 * 安全边界：
 *   - 所有规则都挂在 html[data-${short}] 下，属性不在时对页面零影响
 *   - 不删、不改宿主已有的属性与元素
 *   - 卸载时移除全部 style、observer、listener、属性
 */
window.__ModuleLoader__.load({
  id: '${name}',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports

    const ATTR = 'data-${short}'
    const SEL_ANCHOR = '[data-composer-card]'

    const CSS = \`
html[\${ATTR}] \${SEL_ANCHOR}{
  /* 规则写在这里。全部以 html[data-${short}] 为前提，属性不在时零影响 */
}
\`

    function apply(ctx) {
      const root = document.documentElement
      let observer = null
      let debounce = null

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', '${name}')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, '${name}: styles')

      function sync() {
        const el = document.querySelector(SEL_ANCHOR)
        if (el) root.setAttribute(ATTR, 'on')
        else root.removeAttribute(ATTR)
      }

      function schedule() {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(sync, 60)
      }

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

        const onInput = () => schedule()
        document.addEventListener('input', onInput, true)

        return () => {
          if (observer) observer.disconnect()
          document.removeEventListener('input', onInput, true)
          if (debounce) clearTimeout(debounce)
          root.removeAttribute(ATTR)
        }
      }, '${name}: state')
    }

    exports.apply = apply
    return module.exports
  },
})
`;
fs.writeFileSync(path.join(pluginDir, 'client.js'), clientTemplate);

// ── 2. 注册：dependencies + bundles ────────────────────────────────────
const bak = `${profilePkg}.bak-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}`;
fs.copyFileSync(profilePkg, bak);

const j = JSON.parse(fs.readFileSync(profilePkg, 'utf8'));
j.dependencies = j.dependencies || {};
j.dependencies[name] = `link:../../plugins/${name}`;
if (!j.dsh) j.dsh = {};
if (!j.dsh.profile) j.dsh.profile = {};
if (!Array.isArray(j.dsh.profile.bundles)) j.dsh.profile.bundles = [];
if (!j.dsh.profile.bundles.includes(name)) j.dsh.profile.bundles.push(name);
fs.writeFileSync(profilePkg, JSON.stringify(j, null, 2) + '\n');

// ── 3. 目录联接 ────────────────────────────────────────────────────────
const linkPath = path.join(profileDir, 'node_modules', name);
try {
  fs.lstatSync(linkPath);
  console.log('[new-plugin] 联接已存在，跳过: ' + linkPath);
} catch {
  try {
    execSync(`cmd /c mklink /J "${linkPath}" "${pluginDir}"`, { stdio: 'pipe' });
  } catch (e) {
    // 退路：相对软链（部分环境 junction 需要管理员权限）
    fs.symlinkSync(path.join('..', '..', '..', 'plugins', name), linkPath, 'junction');
  }
}

// ── 汇总 ───────────────────────────────────────────────────────────────
const chk = JSON.parse(fs.readFileSync(profilePkg, 'utf8'));
console.log('[new-plugin] 已创建: ' + pluginDir);
console.log('  dependencies : ' + chk.dependencies[name]);
console.log('  in bundles   : ' + chk.dsh.profile.bundles.includes(name) +
  ' (共 ' + chk.dsh.profile.bundles.length + ' 项)');
console.log('  node_modules : ' + (fs.existsSync(linkPath) ? 'ok' : '缺失'));
console.log('  备份         : ' + bak);
console.log('');
console.log('下一步: 冷重启 dsh（不要用热 reload），等输入卡出现后验证:');
console.log('  node ' + path.join(__dirname, 'cdp.js') + ' eval \\');
console.log(`    "JSON.stringify({attr:document.documentElement.getAttribute('${short}'),` +
  `style:!!document.querySelector('style[data-plugin=\\"${name}\\"]')})"`);
