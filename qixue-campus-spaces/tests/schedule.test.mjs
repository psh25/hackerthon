import test from 'node:test';
import assert from 'node:assert/strict';
import { cachePolicy,recommendClassrooms,chinaDate } from '../js/schedule.js';
import { scheduleFixture } from './schedule-fixtures.mjs';
import { createAppServer } from '../server.mjs';
import { once } from 'node:events';
const now=new Date('2026-10-18T06:00:00Z');
const needs={date:'2026-10-18',scenario:'quiet',power:true,periodStart:2,periodEnd:3};
test('同周内超过10分钟乃至6天可复用，无需刷新采集时间',()=>{
  const snapshot=scheduleFixture();snapshot.fromCache=true;
  const p=cachePolicy(snapshot,needs.date,now);
  assert.equal(p.usable,true);assert.equal(p.expiresAt,'2026-10-18T16:00:00.000Z');assert.equal(p.fromCache,true);
  assert.equal(snapshot.observedAt,'2026-10-12T02:00:00Z');
});
test('上海周一零点立即跨周失效，不误用上周日缓存',()=>{
  assert.equal(cachePolicy(scheduleFixture(),needs.date,new Date('2026-10-18T15:59:59Z')).usable,true);
  assert.equal(cachePolicy(scheduleFixture(),'2026-10-19',new Date('2026-10-18T16:00:00Z')).code,'expired');
  assert.equal(chinaDate(new Date('2026-10-18T16:00:00Z')),'2026-10-19');
});
test('不在缓存覆盖日期内不能拿错周推荐',()=>assert.equal(cachePolicy(scheduleFixture(),'2026-10-20',now).code,'not_covered'));
test('最多7天有效，预采课表仍不延长采集有效期',()=>{
  const s=scheduleFixture();s.observedAt='2026-10-11T01:00:00Z';assert.equal(cachePolicy(s,needs.date,now).code,'expired');
});
test('截断、未知来源、未来时间、不完整周和损坏节次均拒绝',()=>{
  for(const mutate of [s=>s.truncated=true,s=>s.source='https://evil.invalid/',s=>s.observedAt='2026-10-19T00:00:00Z',s=>s.days.pop(),s=>s.records[0].periods.pop(),s=>s.records[0].periods[1]={...s.records[0].periods[0]},s=>s.days[2].date='2026-02-30']) {
    const s=scheduleFixture();mutate(s);assert.equal(cachePolicy(s,needs.date,now).usable,false);
  }
});
test('推荐仅返回所选连续节次全部空闲的教室，不把未知或占用算作可用',()=>{
  const r=recommendClassrooms(scheduleFixture(),needs,now);assert.equal(r.results.length,1);assert.equal(r.results[0].room.name,'可用合成教室');
  assert.equal(r.results[0].extraFreePeriods,3);assert.equal(r.results[0].slots.length,2);assert.match(r.results[0].caveats.join('；'),/供电设施：待核实/);
});
test('没有选择节次时明确提示缺失，不猜钟点映射',()=>{
  const r=recommendClassrooms(scheduleFixture(),{...needs,periodStart:null,periodEnd:null,startTime:'14:00',duration:60},now);
  assert.equal(r.needsPeriods,true);assert.equal(r.results.length,0);assert.match(r.message,/钟点/);
});
test('反向节次拒绝，未知状态不混入结果，无结果返回可操作提示',()=>{
  assert.equal(recommendClassrooms(scheduleFixture(),{...needs,periodStart:5,periodEnd:2},now).needsPeriods,true);
  const s=scheduleFixture();s.records.shift();const r=recommendClassrooms(s,needs,now);assert.deepEqual(r.results,[]);assert.match(r.message,/调整节次/);
});
test('推荐按后续连续空闲节次优先，名称稳定排序，不改输入',()=>{
  const s=scheduleFixture();const second=structuredClone(s.records[0]);second.name='另一合成教室';second.periods.find(x=>x.dayIndex===6&&x.period===4).status='有课';s.records.push(second);
  const before=JSON.stringify(s);const r=recommendClassrooms(s,needs,now);assert.equal(r.results[0].extraFreePeriods,3);assert.equal(r.results[1].extraFreePeriods,0);assert.equal(JSON.stringify(s),before);
});
test('本机缓存API在连接或认证状态下仍可读，不触发官方请求',async t=>{
  const realDate=chinaDate();const d=new Date(`${realDate}T04:00:00Z`);const weekday=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-weekday+1);
  const snapshot=scheduleFixture();snapshot.observedAt=new Date().toISOString();snapshot.days=Array.from({length:7},(_,i)=>({date:new Date(d.valueOf()+i*86400000).toISOString().slice(0,10)}));
  let starts=0;
  const connection={state:'awaiting_login',classroomObservation:null,start:async()=>{starts++;},disconnect:async()=>{},checkLogin:async()=>({state:'awaiting_login'})};
  const server=createAppServer({connection,readSnapshot:async()=>structuredClone(snapshot)});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  let r=await (await fetch(`${base}/api/classrooms/observation?date=${realDate}`)).json();assert.equal(r.cachePolicy.usable,true);assert.equal(r.fromCache,true);assert.equal(starts,0);
  connection.classroomObservation={status:'query_failed',records:[]};r=await(await fetch(`${base}/api/classrooms/observation?date=${realDate}`)).json();assert.equal(r.cachePolicy.usable,true);assert.match(r.syncWarning,/未成功/);assert.equal(r.observedAt,snapshot.observedAt);
});
