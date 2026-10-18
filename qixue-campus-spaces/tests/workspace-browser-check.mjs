import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { loadPlaywright, browserExecutable } from '../lib/runtime.mjs';
import { scheduleFixture } from './schedule-fixtures.mjs';
import { librarySnapshot } from './library-fixtures.mjs';
import { chinaDate } from '../js/schedule.js';

// 精简冒烟：只用本地合成数据，不登录或请求学校网站。
const date = chinaDate(), fixed = Date.parse(`${date}T14:00:00+08:00`);
const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const monday = Date.parse(`${date}T00:00:00Z`) - (weekday - 1) * 86400000;
const snapshot = scheduleFixture();
snapshot.observedAt = `${date}T01:00:00Z`;
snapshot.days = Array.from({ length: 7 }, (_, day) => ({ date: new Date(monday + day * 86400000).toISOString().slice(0, 10) }));
const template = snapshot.records[0];
snapshot.records = [...Array.from({ length: 15 }, (_, i) => ({ ...template, name: `六教${601 + i}` })), { ...template, name: '四教4101' }, { ...template, name: '新水利馆101' }];
const server = createAppServer({ readSnapshot: async () => snapshot, library: { get: async () => librarySnapshot(new Date(fixed)) } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await loadPlaywright().chromium.launch({ headless: true, executablePath: browserExecutable() });
const checks = [], errors = [], external = [];
const check = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ fixed }) => {
    const Original = Date;
    window.Date = class extends Original { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
  }, { fixed });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.goto(base);
  await page.locator('#classroom-building-tabs button').first().waitFor({ state: 'attached' });
  await check('首页只展示一个主面板，高级条件和资料默认折叠', async () => {
    assert.equal(await page.locator('.workspace-tabs [role=tab]').count(), 6);
    assert.equal(await page.locator('.workspace-view:visible').count(), 1);
    assert.equal(await page.locator('#view-recommend').isVisible(), true);
    assert.equal(await page.locator('#need-time-mode').isVisible(), false);
    assert.equal(await page.locator('#results').isVisible(), false);
  });
  await check('教室按楼宇切换、分批加载，日期独立可见', async () => {
    await page.locator('#tab-classrooms').click();
    assert.equal(await page.locator('#classroom-date').inputValue(), date);
    assert.equal(await page.locator('#classroom-results h3').count(), 12);
    assert.ok((await page.locator('#classroom-results h3').allTextContents()).every(name => name.startsWith('六教')));
    await page.locator('#more-classrooms').click();
    assert.equal(await page.locator('#classroom-results h3').count(), 15);
    await page.locator('#classroom-building-tabs [data-building="jiaoxue-4"]').click();
    assert.equal(await page.locator('#classroom-results h3').innerText(), '四教4101');
    await page.locator('#classroom-results details summary').click();
    assert.match(await page.locator('#classroom-results details').innerText(), /楼层.*待核实/);
    assert.match(await page.locator('#classroom-results a').getAttribute('href'), /zhjw\.cic\.tsinghua\.edu\.cn/);
  });
  await check('地图图像加载、六教落点比例正确，点击后进入本楼教室', async () => {
    await page.locator('#tab-map').click();
    await page.waitForFunction(() => document.querySelector('.campus-map-canvas img').naturalWidth === 4370);
    const geometry = await page.evaluate(() => {
      const image = document.querySelector('.campus-map-canvas').getBoundingClientRect();
      const pin = document.querySelector('.map-pin[data-building="jiaoxue-6"]').getBoundingClientRect();
      return { x: (pin.x + pin.width / 2 - image.x) / image.width, y: (pin.y + pin.height / 2 - image.y) / image.height };
    });
    assert.ok(Math.abs(geometry.x - 2740 / 4370) < 0.002);
    assert.ok(Math.abs(geometry.y - 3650 / 6142) < 0.002);
    await page.locator('.map-pin[data-building="jiaoxue-6"]').click();
    assert.equal(await page.locator('#map-detail h3').innerText(), '六教');
    await page.locator('#map-detail').getByRole('button', { name: '查看本楼教室' }).click();
    assert.equal(await page.locator('#view-classrooms').isVisible(), true);
    assert.equal(await page.locator('#classroom-building-heading h3').innerText(), '六教');
    await page.locator('#classroom-building-heading button').click();
    assert.equal(await page.locator('#view-map').isVisible(), true);
    await page.locator('#map-zoom').fill('2');
    assert.equal(await page.locator('#map-zoom-value').innerText(), '2×');
    await page.locator('#map-building').selectOption('north-library');
    await page.locator('#map-detail').getByRole('button', { name: '查看图书馆座位' }).click();
    assert.equal(await page.locator('#view-libraries').isVisible(), true);
  });
  await check('提交需求仍生成推荐，并按楼宇展示', async () => {
    await page.locator('#tab-recommend').click();
    await page.locator('#use-now').click();
    await page.locator('#need-duration').selectOption('60');
    await page.locator('#daily-needs [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#study-result-count').textContent === '17');
    await page.locator('#recommendation-building-tabs [data-building="jiaoxue-6"]').click();
    assert.equal(await page.locator('#study-results h3').count(), 6);
    await page.locator('#recommendation-building-tabs [data-building="jiaoxue-4"]').click();
    assert.equal(await page.locator('#study-results h3').innerText(), '四教4101');
    assert.equal(await page.locator('#library-study-count').innerText(), '2');
  });
  await check('390px手机宽度标签切换、地图定位可用且页面无横向溢出', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const id of ['recommend', 'map', 'classrooms', 'libraries', 'agenda', 'connect']) {
      await page.locator(`#tab-${id}`).click();
      assert.equal(await page.locator(`#view-${id}`).isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow in ${id}`);
    }
    await page.locator('#tab-map').click();
    await page.locator('#map-building').selectOption('jiaoxue-6');
    assert.equal(await page.locator('#map-detail h3').innerText(), '六教');
    assert.equal(await page.locator('.map-pin[data-building="water-new"]').count(), 0);
  });
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/workspace-mobile.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/workspace-map.png', import.meta.url)), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(new URL('../test-results/workspace-report.json', import.meta.url), JSON.stringify({ executedAt: new Date().toISOString(), checks, count: checks.length, errors, external, fixtures: 'Synthetic classrooms and libraries only; no official login or network.' }, null, 2) + '\n');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
