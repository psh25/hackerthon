import test from 'node:test';
import assert from 'node:assert/strict';
import { officialPage, classroomLocation, classroomWindow, detectConnection } from '../lib/official-pages.mjs';
import { OfficialConnection } from '../lib/official-connection.mjs';
import { isClassroomUrl, isClassroomFrame, inspectClassroom } from '../lib/classroom.mjs';

const proxy = 'https://webvpn.tsinghua.edu.cn/http/' + 'a'.repeat(80) + '/pk.classroomctrl.do';
const frame = (url, features) => ({ url: () => url, evaluate: async () => features });
const page = (...frames) => ({ url: frames[0].url, isClosed: () => false, frames: () => frames });

test('WebVPN 教室 URL 与直连、旧系统会话路径兼容且严格限定官方域名', () => {
  for (const url of [proxy, 'http://zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do;jsessionid=SYNTHETIC?ticket=secret']) {
    assert.equal(isClassroomUrl(url), true); assert.equal(isClassroomFrame(url), true);
  }
  for (const url of [proxy.replace('webvpn.tsinghua.edu.cn','webvpn.tsinghua.edu.cn.evil.test'), proxy.replace('https:','http:'), proxy.replace('/pk.classroomctrl.do','/login'), 'https://a:b@zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do']) assert.equal(classroomLocation(url), false);
});
test('诊断不携带 URL 查询、片段、会话参数和代理编码', async () => {
  const result = await detectConnection([page(frame(proxy + ';jsessionid=SECRET?ticket=SECRET#SECRET', {classroom:true}))]);
  assert.equal(result.services.classrooms, 'authenticated'); assert.equal(result.proxy, true);
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /SECRET|a{20}|ticket|jsessionid/);
  assert.equal(officialPage('https://evil.test'), null);
});
test('只见认证页面、跳转 URL 或空白页面时不冒充认证成功', async () => {
  for (const features of [{password:true,portal:true}, {denied:true,classroom:true}, {challenge:true}, {}, null]) {
    const result = await detectConnection([page(frame(proxy, features)), page(frame('https://id.tsinghua.edu.cn/login', {portal:true}))]);
    assert.notEqual(result.services.classrooms, 'authenticated'); assert.equal(result.services.portal, 'not_observed');
  }
});
test('iframe 内的 WebVPN 教室可确认，门户与教务过期分别显示', async () => {
  const target = page(frame('https://webvpn.tsinghua.edu.cn/', {}), frame(proxy, {classroom:true}));
  assert.equal(classroomWindow(target), true);
  const result = await detectConnection([page(frame('https://info.tsinghua.edu.cn/f/info/index', {denied:true})), target]);
  assert.equal(result.services.portal, 'login_required'); assert.equal(result.services.classrooms, 'authenticated'); assert.equal(result.classroom, target);
});
test('同一服务旧认证页不覆盖另一已认证页面', async () => {
  const result = await detectConnection([page(frame(proxy, {classroom:true})), page(frame(proxy, {password:true}))]);
  assert.equal(result.services.classrooms, 'authenticated');
});
test('读取 WebVPN 教室沿用真实表格解析，不改变缓存的官方来源定义', async () => {
  const result = await inspectClassroom(page(frame(proxy, {expired:false, controls:[],tables:[],legends:[],tableCount:0,rowCounts:[]})));
  assert.equal(result.status, 'no_results'); assert.equal(result.frameSummary[0].path, '/[webvpn]/pk.classroomctrl.do');
});
test('重复轮询后仍能发现过期及恢复，断开期间的异步检查不得恢复旧会话', async () => {
  let features = {classroom:true};
  const target = page({url:()=>proxy,evaluate:async()=>features});
  const connection = new OfficialConnection(); connection.context = {pages:()=>[target]};
  assert.equal((await connection.checkLogin()).state,'authenticated');
  features = {denied:true}; assert.equal((await connection.checkLogin()).state,'awaiting_login');
  features = {classroom:true}; assert.equal((await connection.checkLogin()).state,'authenticated');
  let finish;
  target.frames = () => [{url:()=>proxy,evaluate:()=>new Promise(resolve=>{finish=resolve;})}];
  const pending = connection.checkLogin(); await connection.disconnect(); finish({classroom:true});
  assert.equal((await pending).state,'disconnected'); assert.equal(connection.status().services.classrooms,'not_observed');
});
