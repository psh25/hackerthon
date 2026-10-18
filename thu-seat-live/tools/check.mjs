/**
 * 静态一致性检查：确保 JS 引用的 DOM id / CSS 类、HTML 声明的 id、CSS 定义的类三者对得上，
 * 避免「元素取不到 → innerHTML 报错」这类只有浏览器里才会暴露的低级问题。
 *
 * 运行：node tools/check.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const js = readFileSync(path.join(root, 'public/assets/app.js'), 'utf8');
const css = readFileSync(path.join(root, 'public/assets/style.css'), 'utf8');

const problems = [];
const notes = [];

/* id 清单 -------------------------------------------------------------- */

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const jsGetById = new Set([...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]));
const jsCacheList = (() => {
  const block = js.match(/function cacheEls\(\)\s*\{[\s\S]*?const ids = \[([\s\S]*?)\];/);
  if (!block) return new Set();
  return new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
})();

for (const id of [...jsGetById, ...jsCacheList]) {
  if (!htmlIds.has(id)) problems.push(`JS 引用了 HTML 中不存在的 id: #${id}`);
}
for (const id of htmlIds) {
  if (!jsGetById.has(id) && !jsCacheList.has(id) && !['ringGrad', 'sparkFill', 'hoverLine'].includes(id)) {
    notes.push(`HTML 中 #${id} 未被 JS 直接引用（可能由模板动态生成或仅用于样式）`);
  }
}

/* JS 未定义就使用的 els.xxx -------------------------------------------- */

const elsUsage = new Set([...js.matchAll(/\bels\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
const declaredIds = jsCacheList; // cacheEls 用 els[id] 动态赋值，列表即声明
// cacheEls 用 els[id] 动态赋值，因此 elsUsage 中的属性都必须在 cacheEls 列表里
for (const name of elsUsage) {
  if (!declaredIds.has(name)) problems.push(`JS 使用了 els.${name}，但 cacheEls() 的 id 列表里没有 "${name}"`);
}

/* CSS 类 --------------------------------------------------------------- */

const cssClasses = new Set();
for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);
// 伪类/数字等排除
['active', 'hover', 'focus', 'before', 'after', 'nth-child', 'first-child', 'last-child'].forEach((k) => {
  if (!cssClasses.has(k)) cssClasses.delete(k);
});

const isTemplate = (s) => s.includes('${');

const jsClassTokens = new Set([
  ...[...js.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)].flatMap((m) =>
    [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]),
  ),
  ...[...js.matchAll(/class="([^"]*)"/g)]
    .filter((m) => !isTemplate(m[1]))
    .flatMap((m) => m[1].split(/\s+/).filter(Boolean)),
]);

const htmlClassTokens = new Set(
  [...html.matchAll(/class="([^"]*)"/g)]
    .filter((m) => !isTemplate(m[1]))
    .flatMap((m) => m[1].split(/\s+/).filter(Boolean)),
);

for (const c of [...jsClassTokens, ...htmlClassTokens]) {
  if (!cssClasses.has(c)) problems.push(`使用了 CSS 中未定义的类: .${c}`);
}

/* CSS 大括号平衡 ------------------------------------------------------- */

let depth = 0;
for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
  if (ch === '{') depth += 1;
  else if (ch === '}') depth -= 1;
  if (depth < 0) break;
}
if (depth !== 0) problems.push(`CSS 大括号不平衡（剩余层级 ${depth}）`);

/* 结构检查 ------------------------------------------------------------- */

const htmlTags = ['html', 'head', 'body', 'header', 'main', 'section', 'article', 'div', 'svg'];
for (const tag of htmlTags) {
  const open = (html.match(new RegExp(`<${tag}(\\s|>)`, 'g')) || []).length;
  const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  if (open !== close) problems.push(`HTML 标签 <${tag}> 未闭合：开 ${open} / 闭 ${close}`);
}

if (!js.includes("fetchDashboard()")) problems.push('app.js 未在初始化时调用 fetchDashboard()');
if (!html.includes('/assets/app.js')) problems.push('index.html 未引入 app.js');
if (!html.includes('/assets/style.css')) problems.push('index.html 未引入 style.css');

/* 输出 ----------------------------------------------------------------- */

console.log('── 静态一致性检查 ──');
console.log(`HTML id 数量: ${htmlIds.size}，JS 引用 id: ${jsCacheList.size}（cacheEls）`);
console.log(`CSS 定义的类: ${cssClasses.size}，使用中的类: ${new Set([...jsClassTokens, ...htmlClassTokens]).size}`);

if (notes.length) {
  console.log('\n提示:');
  notes.forEach((n) => console.log('  · ' + n));
}

if (problems.length) {
  console.log('\n发现 ' + problems.length + ' 个问题:');
  problems.forEach((p) => console.log('  ✗ ' + p));
  process.exit(1);
}

console.log('\n✓ 全部通过');
