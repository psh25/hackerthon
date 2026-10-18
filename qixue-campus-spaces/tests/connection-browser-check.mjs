import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { detectConnection } from '../lib/official-pages.mjs';

const modules = process.env.BUNDLED_NODE_MODULES || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = createRequire(join(modules, '../package.json'))('playwright');
const executablePath = process.env.BROWSER_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
const base = process.env.APP_URL || 'http://127.0.0.1:4173';
const proxy = `https://webvpn.tsinghua.edu.cn/http/${'a'.repeat(80)}/pk.classroomctrl.do`;
try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body><h1>教室状况查看</h1><button>查询</button></body></html>'}));
  const official = await context.newPage(); await official.goto(proxy);
  await check('真实 DOM：WebVPN 教室页认证识别（离线合成页面）', async () => {
    const result = await detectConnection(context.pages()); assert.equal(result.services.classrooms,'authenticated'); assert.equal(result.proxy,true);
  });
  await check('真实 DOM：同一资源地址显示登录表单，不误判已连接', async () => {
    await official.setContent('<h1>教室</h1><input type="password"><button>查询</button>');
    assert.equal((await detectConnection(context.pages())).services.classrooms,'login_required');
  });
  await check('真实 DOM：iframe 中的代理资源与直连门户分别核验', async () => {
    await official.goto('https://info.tsinghua.edu.cn/f/info/index');
    await official.setContent(`<a>本科生课表</a><iframe src="${proxy}"></iframe>`);
    await official.frames()[1].waitForLoadState();
    const result = await detectConnection(context.pages()); assert.equal(result.services.portal,'authenticated'); assert.equal(result.services.classrooms,'authenticated');
  });
  await context.close();
  const app = await browser.newPage();
  const errors=[]; app.on('pageerror',error=>errors.push(error.message));
  const fixture = {state:'authenticated',message:'合成认证状态，仅用于测试',resourceLinks:[],classroomObservation:null,classroomStatus:'待核实',services:{portal:'authenticated',classrooms:'not_observed'},connectionMode:'direct'};
  let current=fixture, fail=false, calls=0, observationCalls=0;
  app.on('request', request => {if(request.url().includes('/api/classrooms/observation'))observationCalls++;});
  await app.route('**/api/connection/status', route => {calls++;return fail?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.fulfill({contentType:'application/json',body:JSON.stringify(current)});});
  await app.goto(base); await app.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('门户：已确认'));
  const initialObservations=observationCalls;
  await check('前端：登录成功后仍轮询，能发现认证失效', async () => {
    const before=calls; current={...fixture,state:'awaiting_login',services:{portal:'login_required',classrooms:'not_observed'}};
    await app.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('请在官方窗口'),{},{timeout:9000});assert.ok(calls>before);
  });
  await check('前端：服务暂时失败不会永久停止轮询，下一次自动恢复', async () => {
    fail=true; await app.waitForFunction(()=>document.querySelector('#connection-message').textContent.includes('自动重试'),{},{timeout:9000});
    fail=false;current={...fixture,connectionMode:'webvpn',services:{portal:'not_observed',classrooms:'authenticated'}};
    await app.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('教室：已确认'),{},{timeout:9000});
    assert.match(await app.locator('#connection-status').innerText(),/WebVPN/);
  });
  await check('连接状态轮询不反复刷新缓存或重绘推荐，没有 JS 异常', async () => {
    assert.equal(observationCalls,initialObservations);assert.deepEqual(errors,[]);
  });
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/connection-browser-report.json',import.meta.url),JSON.stringify({executedAt:new Date().toISOString(),count:checks.length,checks,note:'Official DOMs and authentication states are synthetic fixtures intercepted locally. No real official login/MFA was tested.'},null,2)+'\n');
  console.log(`Connection browser checks passed: ${checks.length}`);
} finally { await browser.close(); }
