import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createAppServer } from '../server.mjs';
import { scheduleFixture } from './schedule-fixtures.mjs';
import { chinaDate } from '../js/schedule.js';

const modules=process.env.BUNDLED_NODE_MODULES||join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(modules,'../package.json'))('playwright');
const executablePath=process.env.BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const snapshot=scheduleFixture(),today=chinaDate(),date=new Date(`${today}T04:00:00Z`);
const dayIndex=(date.getUTCDay()+6)%7;
date.setUTCDate(date.getUTCDate()-dayIndex);
snapshot.days=Array.from({length:7},(_,i)=>({date:new Date(date.valueOf()+i*86400000).toISOString().slice(0,10)}));
snapshot.observedAt=new Date(Date.now()-60000).toISOString();
for(const [index,room] of snapshot.records.entries())for(const slot of room.periods)slot.status=index===1&&slot.period===3?'有课':index===2&&slot.period===4?'待核实':'空闲';
const server=createAppServer({readSnapshot:async()=>structuredClone(snapshot),library:{get:async()=>({source:'https://seat.lib.tsinghua.edu.cn/home/web/f_second',records:[],observedAt:null})}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const checks=[],errors=[],external=[];
const check=async(name,run)=>{await run();checks.push(name);console.log(`PASS ${name}`);};
try{
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(base))external.push(request.url());});
  await page.goto(base);await page.locator('#results[aria-busy="false"]').waitFor();
  await page.locator('#need-time').fill('14:00');await page.locator('#need-duration').selectOption('60');
  await check('自动模式默认启用，14:00一小时自动选第3节，不必手选',async()=>{
    assert.equal(await page.locator('#need-time-mode').inputValue(),'clock');
    assert.equal(await page.locator('#need-period-start').inputValue(),'3');assert.equal(await page.locator('#need-period-end').inputValue(),'3');
    assert.equal(await page.locator('#need-period-start').isDisabled(),true);
    assert.match(await page.locator('#time-mapping').innerText(),/60\/60分钟/);
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.waitForFunction(()=>document.querySelector('#study-result-count').textContent==='2');
    assert.match(await page.locator('#study-summary').innerText(),/已用于筛选/);
    assert.match(await page.locator('#study-results').innerText(),/13:30–15:05/);
  });
  await check('15点一小时跨第3、4节，任意占用或未知排除，课间15分钟明确待核实',async()=>{
    await page.locator('#need-time').fill('15:00');await page.locator('#need-time').blur();
    assert.equal(await page.locator('#study-result-count').innerText(),'0');
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.waitForFunction(()=>document.querySelector('#study-result-count').textContent==='1');
    assert.match(await page.locator('#study-summary').innerText(),/15分钟未覆盖/);
    assert.match(await page.locator('#study-results').innerText(),/15:05–15:20/);
  });
  await check('午休完整30分钟没有覆盖节次，不输出虚构空闲候选',async()=>{
    await page.locator('#need-time').fill('12:30');await page.locator('#need-duration').selectOption('30');
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.waitForFunction(()=>document.querySelector('#study-summary').textContent.includes('教学时段之外'));
    assert.equal(await page.locator('#study-results .classroom-card').count(),0);
  });
  await check('手动模式可覆盖选择，重新切回自动不沿用矛盾节次',async()=>{
    await page.locator('#need-time-mode').selectOption('periods');
    await page.locator('#need-period-start').selectOption('1');await page.locator('#need-period-end').selectOption('1');
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.waitForFunction(()=>document.querySelector('#study-result-count').textContent==='3');
    assert.match(await page.locator('#study-summary').innerText(),/手动模式/);
    await page.locator('#need-time-mode').selectOption('clock');
    assert.equal(await page.locator('#need-period-start').inputValue(),'');
    await page.locator('#need-time').fill('14:00');await page.locator('#need-duration').selectOption('60');
    assert.equal(await page.locator('#need-period-start').inputValue(),'3');
  });
  await check('日程冲突仍阻止推荐，时段映射不自动忽略事务',async()=>{
    await page.locator('#agenda-event-date').fill(today);await page.locator('#agenda-title').fill('合成课程冲突');
    await page.locator('#agenda-start').fill('14:30');await page.locator('#agenda-end').fill('15:00');
    await page.getByRole('button',{name:'加入本机日程'}).click();
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.waitForFunction(()=>document.querySelector('#study-summary').textContent.includes('冲突'));
    assert.equal(await page.locator('#study-results .classroom-card').count(),0);
  });
  await check('六节时间表可查看且来源为用户图片，手机320px无横向溢出',async()=>{
    await page.locator('.period-time-reference summary').click();
    assert.equal(await page.locator('#period-time-rows tr').count(),6);
    assert.match(await page.locator('#period-source-note').innerText(),/用户提供/);
    for(const width of[320,390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  });
  await check('从现在开始恢复自动模式，刷新后保留自动匹配与来源边界',async()=>{
    await page.locator('#need-time-mode').selectOption('periods');await page.locator('#use-now').click();
    assert.equal(await page.locator('#need-time-mode').inputValue(),'clock');
    await page.locator('#need-time').fill('14:00');await page.locator('#need-duration').selectOption('60');
    await page.getByRole('button',{name:'按我的需求推荐'}).click();
    await page.reload();await page.locator('#results[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('#need-time-mode').inputValue(),'clock');
    assert.equal(await page.locator('#need-period-start').inputValue(),'3');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  });
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/time-browser-report.json',import.meta.url),JSON.stringify({executedAt:new Date().toISOString(),checks,count:checks.length,fixtures:'Synthetic room states only; no private snapshots and no official login.',errors,external},null,2)+'\n');
  console.log(`Time browser checks passed: ${checks.length}`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
