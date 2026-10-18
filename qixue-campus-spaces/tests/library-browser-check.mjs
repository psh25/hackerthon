import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { loadPlaywright, browserExecutable } from '../lib/runtime.mjs';
import { librarySnapshot } from './library-fixtures.mjs';
import { chinaNow, AGENDA_KEY } from '../js/agenda.js';

let mode = 'fresh', forceCalls = 0;
const server = createAppServer({ readSnapshot: async () => { throw new Error('no classroom cache'); }, library: { get: async options => {
  if (options?.force) forceCalls++;
  if (mode === 'failure') throw new Error('synthetic local failure');
  const data = librarySnapshot(new Date(Date.now() - (mode === 'stale' ? 130000 : 1000)));
  if (mode === 'refresh_failed') data.lastRefreshFailed = true;
  return data;
} } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await loadPlaywright().chromium.launch({ headless: true, executablePath: browserExecutable() });
const errors = [], external = [], checks = [];
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  // 固定为上海14:00，使未来/过去与跨节次检查不受实际运行时刻影响。
  await context.addInitScript(({ fixed }) => {
    const Original = Date;
    class TestDate extends Original { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }
    window.Date = TestDate;
  }, { fixed: new Date(`${chinaNow().date}T06:00:00Z`).getTime() });
  const page = await context.newPage();
  // 服务数据时间同步到浏览器冻结的14:00；只拦截本地API，不访问官网。
  await page.route('**/api/libraries/observation', async route => {
    if (mode !== 'fresh') return route.continue();
    const data = librarySnapshot(new Date(`${chinaNow().date}T06:00:00Z`));
    await route.fulfill({ json: data });
  });
  await page.route('**/api/libraries/refresh', async route => {
    if (mode === 'fresh') {
      const response = await route.fetch();
      const data = await response.json(); data.observedAt = new Date(`${chinaNow().date}T06:00:00Z`).toISOString();
      return route.fulfill({ json: data });
    }
    if (mode === 'stale' || mode === 'refresh_failed') {
      const data = librarySnapshot(new Date(`${chinaNow().date}T06:00:00Z`));
      if (mode === 'stale') data.observedAt = new Date(Date.parse(data.observedAt) - 130000).toISOString();
      else data.lastRefreshFailed = true;
      return route.fulfill({ json: data });
    }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
  await page.goto(base);
  await page.locator('#results[aria-busy="false"]').waitFor();
  await page.locator('#library-results .library-card').first().waitFor();
  await check('无需教室登录，图书馆与教室并列展示且每卡有官方来源和采集时间', async () => {
    assert.equal(await page.locator('#library-results .library-card').count(), 3);
    assert.match(await page.locator('#connection-status').innerText(), /尚未连接/);
    assert.match(await page.locator('#library-message').innerText(), /采集于/);
    const links = await page.locator('#library-results .library-card > a').evaluateAll(items => items.map(item => ({ href: item.href, rel: item.rel, target: item.target })));
    assert.equal(links.length, 3);
    for (const link of links) { assert.equal(link.href, 'https://seat.lib.tsinghua.edu.cn/home/web/f_second'); assert.match(link.rel, /noopener/); assert.equal(link.target, '_blank'); }
  });
  await page.locator('#use-now').click(); await page.locator('#need-duration').selectOption('60');
  await page.getByRole('button', { name: '按我的需求推荐' }).click();
  await check('同一需求同时处理两类资源，图书馆按剩余排序并排除0，教室无缓存不影响图书馆', async () => {
    await page.waitForFunction(() => document.querySelector('#library-study-count').textContent === '2');
    assert.equal(await page.locator('#library-study-results h3').first().innerText(), '合成乙馆');
    await page.waitForFunction(() => document.querySelector('#study-result-count').textContent === '0');
    assert.equal(await page.locator('#study-result-count').innerText(), '0');
    assert.match(await page.locator('#library-study-summary').innerText(), /不能保证/);
  });
  await check('查看详情展示缺失设施，不伪装安静、供电或开放时间', async () => {
    const detail = page.locator('#library-study-results details').first(); await detail.locator('summary').click();
    assert.match(await detail.innerText(), /待核实/); assert.match(await detail.innerText(), /不是现场传感器/);
    assert.match(await detail.locator('a').getAttribute('href'), /\/seat\/area\/64$/);
    await page.locator('[data-scenario="power"]').click();
    await page.getByRole('button', { name: '按我的需求推荐' }).click();
    await page.waitForFunction(() => document.querySelector('#library-study-count').textContent === '2');
    assert.match(await page.locator('#library-study-results').innerText(), /供电设施：待核实/);
  });
  await check('未来学习时段不套用当前数字，修改需求先撤下旧推荐', async () => {
    await page.locator('#need-time').fill('18:00');
    assert.equal(await page.locator('#library-study-results .library-card').count(), 0);
    await page.getByRole('button', { name: '按我的需求推荐' }).click();
    assert.match(await page.locator('#library-study-summary').innerText(), /不能用当前剩余预测/);
  });
  await page.locator('#use-now').click(); await page.getByRole('button', { name: '按我的需求推荐' }).click();
  await check('个人动态日程冲突同样阻止图书馆推荐', async () => {
    const agenda = [{ id: 'synthetic-event', title: '合成事务', date: chinaNow().date, start: '14:00', end: '15:00', location: '', kind: 'event', attending: true, source: 'manual' }];
    await page.evaluate(({ key, agenda }) => { localStorage.setItem(key, JSON.stringify(agenda)); window.dispatchEvent(new CustomEvent('qixue:agenda-changed')); }, { key: AGENDA_KEY, agenda });
    assert.match(await page.locator('#library-study-summary').innerText(), /日程冲突/);
    assert.equal(await page.locator('#library-study-results .library-card').count(), 0);
    await page.evaluate(key => { localStorage.removeItem(key); window.dispatchEvent(new CustomEvent('qixue:agenda-changed')); }, AGENDA_KEY);
  });
  await check('手动刷新使用受保护接口，失败撤下推荐并保留历史警示，恢复后可重试', async () => {
    await page.locator('#library-refresh').click(); await page.waitForFunction(() => !document.querySelector('#library-refresh').disabled);
    assert.ok(forceCalls > 0);
    mode = 'refresh_failed'; await page.locator('#library-refresh').click();
    await page.waitForFunction(() => document.querySelector('#library-message').textContent.includes('最近一次'));
    assert.equal(await page.locator('#library-study-results .library-card').count(), 0);
    assert.equal(await page.locator('#library-results .library-card').count(), 3);
    mode = 'fresh'; await page.locator('#library-refresh').click(); await page.waitForFunction(() => document.querySelector('#library-study-count').textContent === '2');
  });
  await check('2分钟过期及接口503均不冒充当前可用，另一来源独立运行', async () => {
    mode = 'stale'; await page.locator('#library-refresh').click(); await page.waitForFunction(() => document.querySelector('#library-message').textContent.includes('过期'));
    assert.equal(await page.locator('#library-study-count').innerText(), '0');
    mode = 'failure'; await page.locator('#library-refresh').click(); await page.waitForFunction(() => document.querySelector('#library-status').textContent.includes('暂不可用'));
    assert.equal(await page.locator('#library-study-count').innerText(), '0');
    assert.equal(await page.locator('#classroom-results .classroom-card').count(), 0);
    mode = 'fresh'; await page.locator('#library-refresh').click(); await page.waitForFunction(() => document.querySelector('#library-study-count').textContent === '2');
  });
  await check('320/390/768/1440px响应式布局无横向溢出，浏览器不请求第三方且无JS异常', async () => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `width=${width}`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
  });
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/library-page.png', import.meta.url)), fullPage: true });
  await writeFile(new URL('../test-results/library-browser-report.json', import.meta.url), JSON.stringify({ executedAt: new Date().toISOString(), count: checks.length, checks, fixtures: 'Synthetic public library counts and local API failures only. No real login or reservation.', errors, external }, null, 2));
  console.log(`Library browser checks passed: ${checks.length}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
