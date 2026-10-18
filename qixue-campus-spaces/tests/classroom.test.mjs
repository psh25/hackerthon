import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSROOM_URL, isClassroomUrl, inspectClassroom, parseClassroomTables } from '../lib/classroom.mjs';
import { readFile } from 'node:fs/promises';

test('教室入口只允许已观察到的准确主机路径，不接受类似域名或其他接口', () => {
  assert.equal(isClassroomUrl(CLASSROOM_URL), true);
  assert.equal(isClassroomUrl(CLASSROOM_URL.replace('https:', 'http:')), true);
  assert.equal(isClassroomUrl(CLASSROOM_URL + '?safe=synthetic'), true);
  for (const url of ['https://zhjw.cic.tsinghua.edu.cn/other.do', CLASSROOM_URL.replace('tsinghua.edu.cn', 'tsinghua.edu.cn.evil.test'), 'file:///pk.classroomctrl.do', 'https://a:b@zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do']) assert.equal(isClassroomUrl(url), false);
});
test('无页面、已关闭页面不生成动态数据', async () => {
  for (const page of [null, { isClosed: () => true }]) {
    const result = await inspectClassroom(page);
    assert.equal(result.status, 'page_not_found'); assert.deepEqual(result.records, []); assert.equal(result.availabilityReady, false);
  }
});
test('教务实际超时地址明确提示重新认证，不输出带 jsessionid 的 URL', async () => {
  const result = await inspectClassroom({ isClosed: () => false, url: () => 'http://zhjw.cic.tsinghua.edu.cn/timeout.jsp;jsessionid=synthetic', frames: () => [] });
  assert.equal(result.status, 'login_required'); assert.equal(JSON.stringify(result).includes('jsessionid'), false);
});
test('资源表只采集观察结果，未标定颜色和节次前不产生可用结论', async () => {
  const result = await inspectClassroom({ isClosed: () => false, frames: () => [{ url: () => CLASSROOM_URL, evaluate: async () => ({ expired: false, controls: [{ name: 'synthetic', tag: 'select', options: [] }], tables: [{ rows: [[{ text: '教室\\节次', color: 'rgb(1, 2, 3)', rowSpan: 1, colSpan: 1 }]] }] }) }] });
  assert.equal(result.status, 'schema_observed'); assert.equal(result.tables.length, 1); assert.deepEqual(result.records, []); assert.equal(result.availabilityReady, false);
});
test('旧关窗代码已移除：不因非白名单跳转主动关闭用户窗口', async () => {
  const source = await readFile(new URL('../lib/official-connection.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /popup\.close\(/);
});

const cell = (text='', title='', colSpan=1) => ({text,title,colSpan,rowSpan:1,color:'rgb(123,45,67)'});
function syntheticTables(count=1) {
  return [{rows:[[cell('星期'),...['一(10.12)','二(10.13)','三(10.14)','四(10.15)','五(10.16)','六(10.17)','日(10.18)'].map(text=>cell(text,'',6))]]},
    {rows:Array.from({length:count},(_,i)=>[cell(`合成测试教室${i} : ${i===0?0:40}(人)`),...Array.from({length:42},()=>cell('','空闲'))])}];
}
test('所有423行均读取，不截断成240行；每个教室42个节次',()=>{
  const result=parseClassroomTables(syntheticTables(423),'2026-10-18T06:00:00Z');
  assert.equal(result.records.length,423);assert.equal(result.rejectedRows,0);
  assert.equal(result.records[0].periods.length,42);assert.equal(result.records.at(-1).periods.at(-1).period,6);
  assert.equal(result.records[0].capacity,null);assert.equal(result.records[1].capacity,40);
  assert.equal(result.days[6].date,'2026-10-18');assert.equal(result.periodClockTimes,null);
});
test('只用明确tooltip状态，不从颜色或空白猜空闲',()=>{
  const tables=syntheticTables();tables[1].rows[0][1].title='';tables[1].rows[0][2].title='合成教室 周一第2节,有课';
  const r=parseClassroomTables(tables,'2026-10-18T06:00:00Z').records[0];
  assert.equal(r.periods[0].status,'待核实');assert.equal(r.periods[1].status,'有课');assert.equal(r.periods[2].status,'空闲');
  assert.equal(r.selfStudyAllowed,null);assert.equal(r.currentSeats,null);assert.equal(r.power,null);
});
test('日期离采集日过远不推算年份，缺少日期表头不生成日期',()=>{
  assert.equal(parseClassroomTables(syntheticTables(),'2026-01-01T00:00:00Z').days[0].date,null);
  assert.deepEqual(parseClassroomTables(syntheticTables().slice(1),'2026-10-18T00:00:00Z').days,[]);
});
test('列数或合并单元格异常时拒绝该行，不错配节次',()=>{
  const tables=syntheticTables(3);tables[1].rows[0].pop();tables[1].rows[1][2].colSpan=2;
  const result=parseClassroomTables(tables,'2026-10-18T00:00:00Z');assert.equal(result.records.length,1);assert.equal(result.rejectedRows,2);
});
