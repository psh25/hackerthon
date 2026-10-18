import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';

test('本地 HTTP 服务：资源、健康检查、数据与访问边界', async t => {
  const server = createAppServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  await t.test('首页为中文 UTF-8 HTML', async () => {
    const response = await fetch(base); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html.*utf-8/);
    assert.match(await response.text(), /校园学习空间发现器/);
  });
  await t.test('健康检查不宣称实时数据', async () => {
    const response = await fetch(`${base}/api/health`); assert.equal(response.status, 200); assert.equal((await response.json()).realtimeData, false);
  });
  await t.test('本地 JSON 数据接口可读', async () => {
    const response = await fetch(`${base}/data/places.json`); assert.equal(response.status, 200); assert.equal((await response.json()).schemaVersion, 1);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  await t.test('CSS 与 ES 模块的 MIME 正确', async () => {
    for (const [path, type] of [['/styles.css', 'text/css'], ['/js/app.js', 'text/javascript'], ['/js/recommend.js', 'text/javascript']]) {
      const response = await fetch(base + path); assert.equal(response.status, 200); assert.ok(response.headers.get('content-type').startsWith(type));
    }
  });
  await t.test('HEAD 不返回正文', async () => { const response = await fetch(base, { method: 'HEAD' }); assert.equal(response.status, 200); assert.equal(await response.text(), ''); });
  await t.test('未知资源和内部文件不可访问', async () => {
    for (const path of ['/missing', '/.git/config', '/package.json', '/server.mjs', '/tests/fixtures.mjs', '/..%2f.git/config']) assert.equal((await fetch(base + path)).status, 404);
  });
  await t.test('禁止写入型请求', async () => { const response = await fetch(`${base}/data/places.json`, { method: 'POST' }); assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD'); });
  await t.test('内容安全策略禁止第三方脚本和后台接口', async () => {
    const response = await fetch(base); assert.match(response.headers.get('content-security-policy'), /script-src 'self'/); assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});
