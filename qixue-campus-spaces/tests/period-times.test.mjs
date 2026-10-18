import test from 'node:test';
import assert from 'node:assert/strict';
import { PERIOD_TIMES, PERIOD_TIME_SOURCE, matchClockWindow, currentPeriod } from '../js/period-times.js';
import { recommendClassrooms } from '../js/schedule.js';
import { validateNeeds } from '../js/daily.js';
import { scheduleFixture } from './schedule-fixtures.mjs';
const now=new Date('2026-10-18T07:00:00Z');
const needs={date:'2026-10-18',scenario:'quiet',startTime:'14:00',duration:60,power:false,timeMode:'clock'};

test('图片6个大节的时间逐项记录，第三节13:30不接受OCR错误15:30',()=>{
  assert.deepEqual(PERIOD_TIMES.map(p=>[p.period,p.start,p.end]),[[1,'08:00','09:35'],[2,'09:50','12:15'],[3,'13:30','15:05'],[4,'15:20','16:55'],[5,'17:05','18:40'],[6,'19:20','21:45']]);
  assert.equal(PERIOD_TIME_SOURCE.kind,'user_provided_image');assert.match(PERIOD_TIME_SOURCE.sha256,/^[A-F\d]{64}$/);
});
test('14点一小时仅落第3节，不需手选，全部60分钟覆盖',()=>{
  const result=matchClockWindow('14:00',60);
  assert.deepEqual(result.periods,[3]);assert.equal(result.fullyCovered,true);assert.equal(result.endTime,'15:00');assert.deepEqual(result.gaps,[]);
});
test('半开时间边界：结束在09:35不算第2节，09:50才开始第2节',()=>{
  assert.deepEqual(matchClockWindow('09:05',30).periods,[1]);
  assert.deepEqual(matchClockWindow('09:35',15).periods,[]);
  assert.deepEqual(matchClockWindow('09:50',30).periods,[2]);
  assert.equal(currentPeriod('09:35'),null);assert.equal(currentPeriod('09:50').period,2);
});
test('跨节次需全部空闲，课间15分钟标记未覆盖而非捏造连续可用',()=>{
  const result=matchClockWindow('09:20',60);
  assert.deepEqual(result.periods,[1,2]);assert.equal(result.coveredMinutes,45);assert.equal(result.uncoveredMinutes,15);assert.equal(result.coverage,75);
  assert.deepEqual(result.gaps,[{start:'09:35',end:'09:50',minutes:15}]);
});
test('午休、早晚及最后节次之后均不自动推测可用',()=>{
  for(const [start,duration] of [['12:15',75],['07:00',30],['21:45',60]]){
    const result=matchClockWindow(start,duration);assert.equal(result.periods.length,0);assert.equal(result.uncoveredMinutes,duration);
  }
  const mixed=matchClockWindow('12:00',120);assert.deepEqual(mixed.periods,[2,3]);assert.equal(mixed.uncoveredMinutes,75);
});
test('非法钟点、非整数时长、跨日被拒绝，24:00仅为结束展示',()=>{
  for(const args of [['24:00',30],['14:90',30],['14:00',0],['14:00',1.5],['14:00',481],['23:50',30]])assert.throws(()=>matchClockWindow(...args));
  assert.equal(matchClockWindow('23:00',60).endTime,'24:00');assert.equal(currentPeriod('21:44').period,6);assert.equal(currentPeriod('21:45'),null);
});
test('钟点模式从图片推导而不信任过期或矛盾的手填节次',()=>{
  const result=recommendClassrooms(scheduleFixture(),{...needs,periodStart:6,periodEnd:1},now);
  assert.deepEqual(result.timing.periods,[3]);assert.equal(result.results.length,1);
  assert.ok(result.results.every(match=>match.slots.length===1&&match.slots[0].period===3));
  assert.equal(validateNeeds({...needs,periodStart:6,periodEnd:1}).timeMode,'clock');
});
test('自动跨节次不接受其中任意有课或未知的教室，未覆盖在卡片明确标注',()=>{
  const result=recommendClassrooms(scheduleFixture(),{...needs,startTime:'15:00',duration:60},now);
  assert.deepEqual(result.timing.periods,[3,4]);assert.equal(result.timing.uncoveredMinutes,15);
  assert.equal(result.results.length,1);assert.equal(result.results[0].timetableCoverage,75);
  assert.match(result.results[0].reason,/不表示整个学习窗口连续空闲/);
  assert.match(result.results[0].caveats.join('；'),/15:05–15:20/);
});
test('全在空档内返回操作说明及0候选，即使旧手选节次不为空',()=>{
  const result=recommendClassrooms(scheduleFixture(),{...needs,startTime:'12:30',duration:30,periodStart:2,periodEnd:3},now);
  assert.equal(result.results.length,0);assert.equal(result.needsPeriods,true);assert.match(result.message,/待核实/);
});
test('手动模式明确保留节次筛选能力，但不谎称已使用钟点',()=>{
  const result=recommendClassrooms(scheduleFixture(),{...needs,timeMode:'periods',periodStart:2,periodEnd:3},now);
  assert.equal(result.timing,null);assert.equal(result.results.length,1);
  assert.throws(()=>validateNeeds({...needs,timeMode:'unsupported'}));
});
