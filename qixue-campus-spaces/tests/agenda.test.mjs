import test from'node:test';import assert from'node:assert/strict';
import{chinaNow,validateEvent,validateAgenda,attendanceException,studyWindow}from'../js/agenda.js';
const event=(patch={})=>({id:'manual-one',title:'合成测试课程',date:'2026-10-18',start:'15:00',end:'16:00',location:'合成测试地点',kind:'course',attending:true,source:'manual',...patch});
const window={date:'2026-10-18',startTime:'14:00',duration:60,bufferMinutes:10};
test('系统时钟固定上海时区，UTC跨日正确',()=>assert.deepEqual(chinaNow(new Date('2026-10-17T16:01:02Z')),{date:'2026-10-18',time:'00:01',seconds:'02'}));
test('个人日程有效性、来源、同日起止与唯一id校验',()=>{
 assert.equal(validateEvent(event()).title,'合成测试课程');
 for(const patch of[{date:'2026-02-30'},{start:'25:00'},{end:'14:00'},{title:''},{source:'official'},{kind:'unknown'},{attending:'false'}])assert.throws(()=>validateEvent(event(patch)));
 assert.throws(()=>validateAgenda([event(),event()]));assert.throws(()=>validateAgenda({}));
});
test('事务前后预留计入冲突，不把未量测路程伪装已计算',()=>{
 const plan=studyWindow([event()],window);assert.equal(plan.allowed,false);assert.equal(plan.availableMinutes,50);assert.equal(plan.next.title,'合成测试课程');assert.equal(plan.bufferMinutes,10);
});
test('本次不参加只影响一次事项，其他日期和原始数组不变',()=>{
 const original=[event(),event({id:'next-occurrence',date:'2026-10-19'})];const updated=attendanceException(original,'manual-one',false);
 assert.equal(updated[0].attending,false);assert.equal(updated[1].attending,true);assert.equal(original[0].attending,true);
 assert.equal(studyWindow(updated,window).allowed,true);assert.equal(studyWindow(updated,window).ignored.length,1);
 assert.equal(studyWindow(attendanceException(updated,'manual-one',true),window).allowed,false);
});
test('临时非课程事务同样占用时间，当前进行中无可用窗口',()=>{
 const plan=studyWindow([event({kind:'event',title:'办事',start:'13:50',end:'14:20'})],window);
 assert.equal(plan.allowed,false);assert.equal(plan.availableMinutes,0);assert.equal(plan.current.title,'办事');
});
test('事项边界结束等于开始且无预留时不冲突，邻近日程求交正确',()=>{
 assert.equal(studyWindow([event()],{...window,bufferMinutes:0}).allowed,true);
 assert.equal(studyWindow([event({start:'12:00',end:'14:00'})],{...window,bufferMinutes:0}).allowed,true);
 assert.equal(studyWindow([event()],{...window,duration:50}).allowed,true);
 assert.equal(studyWindow([event()],{...window,duration:51}).allowed,false);
});
test('跨日学习、负预留、非法日期应拒绝',()=>{
 for(const patch of[{startTime:'23:50',duration:30},{bufferMinutes:-1},{bufferMinutes:121},{date:'2026-02-30'}])assert.throws(()=>studyWindow([],{...window,...patch}));
});
