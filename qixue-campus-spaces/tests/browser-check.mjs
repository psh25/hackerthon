import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { syntheticFact, syntheticPlace, syntheticDataset } from './fixtures.mjs';
import { scheduleFixture } from './schedule-fixtures.mjs';
import { chinaDate } from '../js/schedule.js';

// 优先复用本地 Playwright；项目运行本身无 npm 依赖，不下载浏览器。
let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); }
catch {
  const bundled = process.env.BUNDLED_NODE_MODULES;
  if (!bundled) throw new Error('浏览器测试需要本地 Playwright。请设置 BUNDLED_NODE_MODULES 为已有 node_modules 的绝对路径；本脚本不会下载依赖。');
  playwright = createRequire(`${bundled.replaceAll('\\', '/')}/../package.json`)('playwright');
}

const base = process.env.APP_URL || 'http://127.0.0.1:4173';
const executablePath = process.env.BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(path => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const checks = [];
const errors = [];
const externalRequests = [];
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });

async function check(name, fn) {
  await fn(); checks.push(name); console.log(`PASS ${name}`);
}

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  return page;
}

try {
  const page = await newPage();
  await page.goto(base);
  await page.locator('#results[aria-busy="false"]').waitFor();
  await page.locator('#need-time-mode').selectOption('periods');
  await check('生产空数据：明确待补充，无虚构卡片', async () => {
    assert.equal(await page.locator('.place-card').count(), 0);
    assert.match(await page.locator('#dataset-label').innerText(), /已核实场所 0/);
    assert.match(await page.locator('#results').innerText(), /完整场景设施仍待核实/);
    assert.equal(await page.locator('#result-count').innerText(), '00');
  });
  await check('新版连接状态不伪装同步成功，网页不接收密码', async () => {
    await page.waitForFunction(() => document.querySelector('#connection-message').textContent.includes('在清华官方窗口'));
    await page.waitForFunction(() => !document.querySelector('#cache-status').textContent.includes('正在读取'));
    assert.match(await page.locator('#connection-status').innerText(), /尚未连接/);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.equal(await page.locator('#connect-official').isEnabled(), true);
    assert.equal(await page.locator('#refresh-official').isDisabled(), true);
  });
  await check('每日计划可保存需求但不虚构所选时段可用性', async () => {
    await page.locator('#need-date').fill('2026-10-18');
    await page.locator('#need-time').fill('15:00');
    await page.locator('#need-duration').selectOption('90');
    await page.locator('#need-power').check();
    await page.getByRole('button', { name: '按我的需求推荐' }).click();
    assert.match(await page.locator('#needs-message').innerText(), /手动模式/);
    assert.match(await page.locator('#sort-label').innerText(), /已核实偏好覆盖率/);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('qixue.daily-needs.v1')));
    assert.deepEqual(Object.keys(stored).sort(), ['bufferMinutes', 'date', 'duration', 'periodEnd', 'periodStart', 'power', 'scenario', 'startTime','timeMode']);
    assert.equal(stored.duration, 90); assert.equal(stored.power, true);
    assert.equal(await page.locator('.place-card').count(), 0);
  });
  await check('当前官方窗口 OCR 参考单列展示，不混入推荐或假装已核实', async () => {
    await page.locator('.classroom-reference summary').click();
    await page.waitForFunction(() => document.querySelectorAll('#reference-rooms li').length > 0);
    assert.match(await page.locator('#reference-message').innerText(), /OCR|待核实|复核/);
    assert.equal(await page.locator('#reference-rooms li').count(), 12);
    assert.equal(await page.locator('.place-card').count(), 0);
    assert.equal(await page.locator('#query-classrooms').isDisabled(), true);
    await page.locator('.classroom-reference summary').click();
  });
  await check('官方课表候选：真实快照单独展示，时间与来源边界明确', async () => {
    const cards=page.locator('#classroom-results .classroom-card');
    const snapshot = await (await page.request.get(`${base}/api/classrooms/observation`)).json();
    if (!snapshot.records?.length) { assert.equal(await page.locator('#classroom-results .classroom-card').count(), 0); return; }
    const observed = snapshot.days?.find(day => day.date === '2026-10-18');
    assert.ok(observed); assert.equal(snapshot.records.length, 423); assert.equal(snapshot.truncated, false);
    if (!snapshot.cachePolicy?.usable) {
      assert.equal(await cards.count(), 0); return;
    }
    await cards.first().waitFor();
    assert.equal(await cards.count(), 24);
    assert.match(await page.locator('#classroom-summary').innerText(), /本周缓存|采集于/);
    assert.match(await cards.first().innerText(), /非自习许可/);
    assert.equal(await cards.first().locator('a').getAttribute('href'), 'https://zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do');
    await page.locator('#more-classrooms').click(); assert.equal(await cards.count(), 48);
    await page.locator('#classroom-period').selectOption('6'); await page.locator('#only-schedule-free').check();
    const count = snapshot.records.filter(room => room.periods.some(slot => slot.dayIndex === 6 && slot.period === 6 && slot.status === '空闲')).length;
    assert.match(await page.locator('#classroom-summary').innerText(), new RegExp(`${count}个课表候选`));
    assert.equal(await cards.locator('.schedule-other').count(), 0);
    await page.locator('#need-date').fill('2026-11-01'); await page.locator('#need-date').dispatchEvent('change');
    assert.match(await page.locator('#classroom-summary').innerText(), /不覆盖所选日期/); assert.equal(await cards.count(), 0);
    await page.locator('#need-date').fill('2026-10-18'); await page.locator('#need-date').dispatchEvent('change');
    await page.locator('#only-schedule-free').uncheck(); await page.locator('#classroom-period').selectOption('all');
  });
  await check('真实本周缓存无需登录，点击推荐产生正确数量、原因与来源', async () => {
    const snapshot=await(await page.request.get(`${base}/api/classrooms/observation?date=2026-10-18`)).json();
    assert.equal(snapshot.cachePolicy.usable,true);assert.equal(snapshot.records.length,423);
    await page.locator('#need-period-start').selectOption('2');await page.locator('#need-period-end').selectOption('3');
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    const count=snapshot.records.filter(room=>room.periods.filter(slot=>slot.dayIndex===6&&[2,3].includes(slot.period)).every(slot=>slot.status==='空闲')).length;
    await page.waitForFunction(count=>document.querySelector('#study-result-count').textContent===String(count),count);
    assert.ok(count>0);assert.equal(await page.locator('#study-results .classroom-card').count(),Math.min(count,12));
    assert.match(await page.locator('#study-summary').innerText(),/钟点需求.*尚未用于时段筛选/);
    assert.match(await page.locator('#study-results .classroom-card').first().innerText(),/供电设施：待核实/);
    assert.equal(await page.locator('#study-results .classroom-card').first().locator('a').getAttribute('target'),'_blank');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'study-title');
    assert.match(await page.locator('#connection-status').innerText(),/尚未连接/);
    if(count>12){await page.locator('#more-study-results').click();assert.equal(await page.locator('#study-results .classroom-card').count(),Math.min(count,24));}
  });
  await check('推荐无结果、跨周缓存、接口失败和反向节次均有明确反馈',async()=>{
    const p=await newPage();let mode='occupied';
    const source=scheduleFixture();const today=chinaDate();const day=new Date(`${today}T04:00:00Z`);day.setUTCDate(day.getUTCDate()-(day.getUTCDay()||7)+1);
    source.days=Array.from({length:7},(_,i)=>({date:new Date(day.valueOf()+i*86400000).toISOString().slice(0,10)}));source.observedAt=new Date().toISOString();source.records=source.records.slice(1,2);
    await p.route('**/api/classrooms/observation**',route=>{
      if(mode==='failure')return route.fulfill({status:500,contentType:'application/json',body:'{}'});
      const data=structuredClone(source);if(mode==='expired')data.observedAt='2026-01-01T00:00:00Z';
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await p.goto(base);await p.locator('#need-time-mode').selectOption('periods');await p.locator('#need-period-start').selectOption('2');await p.locator('#need-period-end').selectOption('3');
    await p.getByRole('button',{name:'按我的需求推荐'}).click();
    await p.waitForFunction(()=>document.querySelector('#study-summary').textContent.includes('没有全部标为'));
    assert.equal(await p.locator('#study-results .classroom-card').count(),0);
    mode='expired';await p.getByRole('button',{name:'按我的需求推荐'}).click();await p.waitForFunction(()=>document.querySelector('#study-summary').textContent.includes('过期'));
    mode='failure';await p.getByRole('button',{name:'按我的需求推荐'}).click();await p.waitForFunction(()=>document.querySelector('#study-summary').textContent.includes('读取失败'));
    await p.locator('#need-period-start').selectOption('5');await p.locator('#need-period-end').selectOption('2');await p.getByRole('button',{name:'按我的需求推荐'}).click();
    assert.match(await p.locator('#needs-message').innerText(),/结束不早于开始/);
    await p.context().close();
  });
  await check('系统时间可读，“从现在开始”填入上海日期与时间',async()=>{
    assert.match(await page.locator('#system-clock').innerText(),/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · 上海时间/);
    await page.locator('#use-now').click();assert.equal(await page.locator('#need-date').inputValue(),chinaDate());
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
    assert.equal(await page.locator('#need-time').inputValue(),parts);assert.match(await page.locator('#clock-note').innerText(),/本机系统时钟/);
    await page.locator('#need-date').fill('2026-10-18');await page.locator('#need-time').fill('15:00');
  });
  await check('动态日程冲突暂停推荐，本次不参加可恢复，教室占用不被改写',async()=>{
    await page.locator('#need-time-mode').selectOption('periods');await page.locator('#need-date').fill('2026-10-18');await page.locator('#need-time').fill('15:00');await page.locator('#need-duration').selectOption('60');
    await page.locator('#need-period-start').selectOption('2');await page.locator('#need-period-end').selectOption('3');
    await page.locator('#agenda-event-date').fill('2026-10-18');await page.locator('#agenda-title').fill('合成临时办事');
    await page.locator('#agenda-start').fill('15:10');await page.locator('#agenda-end').fill('15:40');await page.locator('#agenda-kind').selectOption('event');
    await page.getByRole('button',{name:'加入本机日程'}).click();
    assert.match(await page.locator('#agenda-events').innerText(),/合成临时办事/);
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.waitForFunction(()=>document.querySelector('#study-summary').textContent.includes('暂停推荐'));
    assert.equal(await page.locator('#study-results .classroom-card').count(),0);
    await page.getByRole('button',{name:'本次不参加：合成临时办事',exact:true}).click();
    await page.waitForFunction(()=>Number(document.querySelector('#study-result-count').textContent)>0);
    const records=await(await page.request.get(`${base}/api/classrooms/observation?date=2026-10-18`)).json();
    assert.ok(records.records.some(room=>room.periods.some(slot=>slot.status==='有课')));
    await page.reload();await page.locator('#results[aria-busy="false"]').waitFor();
    assert.match(await page.locator('#agenda-events').innerText(),/仅本次不参加/);
    await page.getByRole('button',{name:'恢复参加：合成临时办事',exact:true}).click();
    await page.getByRole('button',{name:'按我的需求推荐'}).click();await page.waitForFunction(()=>document.querySelector('#study-summary').textContent.includes('暂停推荐'));
    await page.getByRole('button',{name:'删除日程：合成临时办事',exact:true}).click();
    await page.waitForFunction(()=>Number(document.querySelector('#study-result-count').textContent)>0);
  });
  await check('编辑需求后撤下旧推荐，重新提交才生成新需求结果',async()=>{
    await page.locator('#need-duration').selectOption('90');
    assert.equal(await page.locator('#study-results .classroom-card').count(),0);
    assert.match(await page.locator('#study-summary').innerText(),/需求已更改/);
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.waitForFunction(()=>Number(document.querySelector('#study-result-count').textContent)>0);
  });
  await check('生产页面四个场景的选中状态、标题与数量同步', async () => {
    for (const [id, label] of [['quiet', '安静学习'], ['group', '小组讨论'], ['short', '临时学习'], ['power', '需要供电']]) {
      await page.locator(`[data-scenario="${id}"]`).click();
      assert.equal(await page.locator('#scene-name').innerText(), label);
      assert.equal(await page.locator('[data-scenario][aria-pressed="true"]').count(), 1);
      assert.equal(await page.locator(`[data-scenario="${id}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#result-count').innerText(), '00');
    }
    await page.locator('[data-scenario="quiet"]').click();
  });
  await check('数据原则对话框：打开、焦点限制、Esc 关闭、焦点返回', async () => {
    await page.locator('#data-button').click();
    assert.equal(await page.locator('#detail-dialog').evaluate(node => node.open), true);
    assert.match(await page.locator('#dialog-content').innerText(), /匹配规则/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close-dialog');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('#detail-dialog').contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail-dialog').evaluate(node => node.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'data-button');
  });
  await check('320 / 390 / 768 / 1024 / 1440 / 1920px 无页面横向溢出', async () => {
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1 && !node.closest('dialog')).slice(0, 8).map(node => ({ tag: node.tagName, cls: node.className, right: node.getBoundingClientRect().right })) }));
      assert.ok(overflow.width <= width, `横向溢出: ${width}; ${JSON.stringify(overflow)}`);
      const size = await page.locator('[data-scenario="quiet"]').boundingBox(); assert.ok(size.height >= 44);
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: new URL('../test-results/desktop.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('../test-results/mobile.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });

  const fixtures = await newPage();
  const a = syntheticPlace('a'); a.features.groupDiscussion = syntheticFact(true);
  const b = syntheticPlace('b'); b.features.quiet = syntheticFact(false); b.features.shortStay = syntheticFact(true); b.features.power = syntheticFact(true);
  const testData = syntheticDataset([a, b]);
  await fixtures.route('**/data/places.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testData) }));
  await fixtures.goto(base);
  await fixtures.locator('.place-card').waitFor();
  await check('合成夹具：匹配卡片字段、未知时间和官方外链属性', async () => {
    assert.equal(await fixtures.locator('.place-card').count(), 1);
    assert.match(await fixtures.locator('.place-card').innerText(), /自动化合成场所 a/);
    assert.match(await fixtures.locator('.card-facts').innerText(), /待核实/);
    assert.match(await fixtures.locator('.card-reason').innerText(), /官方资料已明确支持安静学习/);
    const link = fixtures.locator('.card-footer .source-link');
    assert.equal(await link.getAttribute('href'), 'https://example.edu/synthetic-fixture');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener noreferrer/);
  });
  await check('合成夹具：详情、实时未知、字段证据和关闭焦点', async () => {
    await fixtures.locator('.detail-button').click();
    assert.equal(await fixtures.locator('#detail-dialog').evaluate(node => node.open), true);
    for (const label of ['实时空位', '当前开放情况', '电源当前可用性']) {
      const row = fixtures.locator('.detail-facts .fact-row').filter({ has: fixtures.locator('dt', { hasText: label }) });
      assert.equal(await row.locator('dd').innerText(), '待核实');
    }
    assert.match(await fixtures.locator('.detail-sources').innerText(), /依据字段/);
    assert.match(await fixtures.locator('.detail-reason').innerText(), /2026-10-18/);
    await fixtures.keyboard.press('Escape');
    assert.equal(await fixtures.evaluate(() => document.activeElement.className), 'detail-button');
  });
  await check('合成夹具：四场景分别返回正确卡片', async () => {
    for (const [scene, id] of [['quiet', 'a'], ['group', 'a'], ['short', 'b'], ['power', 'b']]) {
      await fixtures.locator(`[data-scenario="${scene}"]`).click();
      assert.equal(await fixtures.locator('.place-card').count(), 1);
      assert.match(await fixtures.locator('.place-card h3').innerText(), new RegExp(`场所 ${id}`));
    }
    await fixtures.setViewportSize({ width: 390, height: 844 });
    assert.ok(await fixtures.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await fixtures.screenshot({ path: new URL('../test-results/fixture-mobile.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  });
  await check('合成夹具：每日偏好展示匹配百分比，同时注明时间可用性未知', async () => {
    await fixtures.locator('[data-scenario="quiet"]').click();
    await fixtures.locator('#need-date').fill('2026-10-18');
    await fixtures.locator('#need-time').fill('14:00');
    await fixtures.locator('#need-power').check();
    await fixtures.getByRole('button', { name: '按我的需求推荐' }).click();
    assert.match(await fixtures.locator('.preference-summary').innerText(), /67%/);
    assert.match(await fixtures.locator('.preference-summary').innerText(), /该时段可用性：待核实/);
    assert.match(await fixtures.locator('.preference-summary').innerText(), /待核实：学习用电源/);
    assert.ok(await fixtures.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await check('合成夹具：有资料但无匹配显示独立空态', async () => {
    await fixtures.route('**/data/places.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(syntheticDataset([syntheticPlace()])) }));
    await fixtures.reload(); await fixtures.locator('#results[aria-busy="false"]').waitFor();
    await fixtures.locator('[data-scenario="power"]').click();
    assert.equal(await fixtures.locator('[data-state="no-match"]').count(), 1);
    assert.equal(await fixtures.locator('.place-card').count(), 0);
  });
  const recovery = await newPage(); let broken = true;
  await recovery.route('**/data/places.json', route => route.fulfill({ status: broken ? 500 : 200, contentType: 'application/json', body: JSON.stringify(broken ? { error: 'test' } : syntheticDataset()) }));
  await recovery.goto(base); await recovery.locator('[data-state="error"]').waitFor();
  await check('资料接口失败：明确报错，重试后恢复', async () => {
    assert.equal(await recovery.locator('.place-card').count(), 0);
    broken = false;
    await recovery.getByRole('button', { name: '重新读取资料' }).click();
    await recovery.locator('.place-card').waitFor();
    assert.equal(await recovery.locator('[data-state="error"]').count(), 0);
  });
  await check('无效 JSON 不会导致静默错误或虚构推荐', async () => {
    await recovery.route('**/data/places.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{invalid' }));
    await recovery.reload(); await recovery.locator('[data-state="error"]').waitFor();
    assert.equal(await recovery.locator('.place-card').count(), 0);
  });
  await check('HTML 注入内容仅作为文本渲染，不执行', async () => {
    const injection = syntheticPlace(); injection.name = syntheticFact('<img src=x onerror="window.INJECTED=true">');
    await recovery.route('**/data/places.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(syntheticDataset([injection])) }));
    await recovery.reload(); await recovery.locator('.place-card').waitFor();
    assert.equal(await recovery.locator('.place-card img').count(), 0);
    assert.equal(await recovery.evaluate(() => window.INJECTED), undefined);
  });
  await check('无 JavaScript 异常且网页未请求第三方服务', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  });
  const report = { executedAt: new Date().toISOString(), browser: await browser.version(), base, checks, count: checks.length, errors, externalRequests, productionData: 'empty; awaiting actual verified survey', fixtureWarning: 'Browser routes use synthetic fixtures only. Production JSON is not modified. External links were checked as attributes, not opened or verified.' };
  await writeFile(new URL('../test-results/browser-report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Browser checks passed: ${checks.length}`);
} finally { await browser.close(); }
