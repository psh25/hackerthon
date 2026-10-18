/**
 * 前端逻辑的「无浏览器」验证脚手架。
 *
 * 用途：在不依赖无头浏览器的环境下，用一个最小 DOM 打桩真实执行 public/assets/app.js，
 * 打通 fetch → 渲染 → 断言 的完整链路，用来捕捉模板字符串、取数、SVG 生成等运行时错误。
 *
 * 运行：node tools/verify-ui.mjs   （需先启动 server.js）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = path.join(__dirname, '..', 'public', 'assets', 'app.js');
const ORIGIN = process.env.VERIFY_ORIGIN || 'http://127.0.0.1:8787';

/* --------------------------------------------------------------------------
   最小 DOM 打桩
   -------------------------------------------------------------------------- */

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  contains(c) { return this.set.has(c); }
  toString() { return [...this.set].join(' '); }
}

class FakeEl {
  constructor(tag = 'div', id = null) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.attrs = new Map();
    this.style = new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; }, get: (t, k) => t[k] ?? '' });
    this.dataset = {};
    this.classList = new FakeClassList();
    this._innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.scrollTop = 0;
    this.listeners = new Map();
  }
  set innerHTML(v) { this._innerHTML = String(v); }
  get innerHTML() { return this._innerHTML; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener() {}
  dispatch(type, ev = {}) {
    (this.listeners.get(type) || []).forEach((fn) => fn({ target: this, preventDefault() {}, ...ev }));
  }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 216 }; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    // 仅支持本页面实际用到的类选择器 / [data-x] 选择器 / id 选择器
    const nodes = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (matches(c, sel)) nodes.push(c);
        walk(c);
      }
    };
    walk(this);
    return nodes;
  }
  focus() {}
}

function matches(el, sel) {
  const s = sel.trim();
  if (s.startsWith('#')) return el.id === s.slice(1);
  const attr = s.match(/^\[([\w-]+)(?:=["']?([^"']*)["']?)?\]$/);
  if (attr) {
    const key = attr[1];
    const want = attr[2];
    const val = key.startsWith('data-') ? el.dataset[key.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] : el.attrs.get(key);
    return want === undefined ? val !== undefined : String(val) === want;
  }
  if (s.startsWith('.')) return el.classList.contains(s.slice(1));
  return el.tagName === s.toUpperCase();
}

/** 从 innerHTML 字符串中抽取顶层结构，生成可查询的子节点（够用即可） */
function parseHtmlToChildren(host, html) {
  const tagRe = /<(\w+)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1];
    if (['path', 'circle', 'line', 'rect', 'stop', 'text', 'g', 'defs', 'linearGradient'].includes(tag)) continue;
    const el = new FakeEl(tag);
    const attrStr = m[2];
    const classMatch = attrStr.match(/class="([^"]*)"/);
    if (classMatch) classMatch[1].split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    const dataMatch = attrStr.match(/data-lib="([^"]*)"/);
    if (dataMatch) el.dataset.lib = dataMatch[1];
    host.appendChild(el);
  }
}

const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new FakeEl('div', id));
    return elements.get(id);
  },
  createElement(tag) { return new FakeEl(tag); },
  addEventListener(type, fn) {
    if (!this._l) this._l = new Map();
    if (!this._l.has(type)) this._l.set(type, []);
    this._l.get(type).push(fn);
  },
  dispatch(type, ev = {}) { (this._l?.get(type) || []).forEach((fn) => fn({ target: this, preventDefault() {}, ...ev })); },
};

// 让 innerHTML 赋值后能被子节点查询命中
const rawInnerHtml = Object.getOwnPropertyDescriptor(FakeEl.prototype, 'innerHTML');
Object.defineProperty(FakeEl.prototype, 'innerHTML', {
  get() { return this._innerHTML; },
  set(v) {
    this._innerHTML = String(v);
    this.children = [];
    if (this._innerHTML.includes('<')) parseHtmlToChildren(this, this._innerHTML);
  },
});

const windowStub = {
  addEventListener: () => {},
  innerWidth: 1600,
  innerHeight: 900,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
};

/* --------------------------------------------------------------------------
   fetch 打桩：转发到本地服务
   -------------------------------------------------------------------------- */

const calls = [];
async function fetchStub(input, opts = {}) {
  const url = typeof input === 'string' ? input : String(input.url || input);
  const abs = url.startsWith('http') ? url : ORIGIN + url;
  calls.push(`${opts.method || 'GET'} ${url}`);
  const res = await fetch(abs, opts);
  return res;
}

/* --------------------------------------------------------------------------
   执行
   -------------------------------------------------------------------------- */

const code = readFileSync(APP_PATH, 'utf8');
const sandbox = {
  document,
  window: windowStub,
  fetch: fetchStub,
  console,
  setTimeout,
  clearTimeout,
  setInterval: (fn, ms) => {
    // 只登记，不真正永久启动，避免脚本挂住进程
    if (ms <= 1200) return 0;
    return setInterval(fn, Math.max(ms, 5000));
  },
  clearInterval,
  Intl,
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Promise,
  URL,
};

const context = vm.createContext(sandbox);
vm.runInContext(code, context, { filename: 'app.js' });

// 触发 DOMContentLoaded
document.dispatch('DOMContentLoaded');

// 等待首屏渲染
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 300));
  if (elements.get('heroAvailable')?.textContent && elements.get('heroAvailable').textContent !== '--') break;
}

/* --------------------------------------------------------------------------
   断言
   -------------------------------------------------------------------------- */

const failures = [];
const pass = [];
function check(name, cond, detail = '') {
  if (cond) pass.push(name);
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const g = (id) => elements.get(id);

check('fetch 已发起', calls.length > 0, calls.join(', '));
check('总空座数字已渲染', /^[\d,]+$/.test(g('heroAvailable').textContent), g('heroAvailable').textContent);
check('在座率已渲染', /%$/.test(g('heroPct').textContent), g('heroPct').textContent);
check('环形图已设置偏移', Number(g('ringArc').style.strokeDashoffset) >= 0, g('ringArc').style.strokeDashoffset);
check('分馆行已生成', g('libList').querySelectorAll('.lib-row').length >= 5, String(g('libList').querySelectorAll('.lib-row').length));
check('分馆行含空座数', /<b>[\d,]+<\/b>/.test(g('libList').innerHTML));
check('对比图已生成', g('cmpChart').querySelectorAll('.cmp-row').length >= 5, String(g('cmpChart').querySelectorAll('.cmp-row').length));
check('热力图已生成', /heat-cell/.test(g('heat').innerHTML) && g('heat').innerHTML.includes('heat-row'));
check('热力图含楼层百分比', /\d+%/.test(g('heat').innerHTML));
check('趋势图坐标轴已绘制', /%<\/text>/.test(g('trendSvg').innerHTML));
check('趋势图底部统计已渲染', g('trendFoot').innerHTML.length > 20);
check('状态卡片已渲染', g('statusGrid').querySelectorAll('.stat-box').length >= 6, String(g('statusGrid').querySelectorAll('.stat-box').length));
check('分布条已渲染', /width:[\d.]+%/.test(g('distBar').innerHTML), g('distBar').innerHTML);
check('迷你趋势已绘制', /<path/.test(g('sparkSvg').innerHTML));
check('实时状态灯已更新', g('liveChip').dataset.state !== 'loading', String(g('liveChip').dataset.state));

// 模拟点击第一个分馆 → 详情面板
const firstRow = g('libList').querySelectorAll('.lib-row')[0];
if (firstRow) {
  firstRow.dispatch('click');
  await new Promise((r) => setTimeout(r, 120));
  check('详情面板已展开', g('detailPanel').hidden === false);
  check('详情面板含楼层块', /floor-block/.test(g('panelBody').innerHTML), String(g('panelBody').innerHTML.length));
  check('详情面板含阅览区行', /area-row/.test(g('panelBody').innerHTML));
  check('面板标题已填充', g('panelTitle').textContent.length > 1, g('panelTitle').textContent);
} else {
  failures.push('未能获取首个分馆行，无法测试下钻');
}

// 模拟切换趋势维度
const tab = g('trendTabs').querySelectorAll('.trend-tab')[1];
if (tab) {
  tab.dispatch('click');
  await new Promise((r) => setTimeout(r, 80));
  check('趋势维度切换正常', g('trendFoot').innerHTML.length > 20);
}

/* --------------------------------------------------------------------------
   输出
   -------------------------------------------------------------------------- */

console.log('\n──────── 通过 ────────');
pass.forEach((p) => console.log('  ✓ ' + p));
if (failures.length) {
  console.log('\n──────── 失败 ────────');
  failures.forEach((f) => console.log('  ✗ ' + f));
}
console.log(`\n结果：${pass.length} 通过 / ${failures.length} 失败`);
console.log('fetch 调用：', calls.join(' | '));
process.exit(failures.length ? 1 : 0);
