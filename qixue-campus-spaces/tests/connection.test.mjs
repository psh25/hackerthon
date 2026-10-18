import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { officialUrl, OfficialConnection } from '../lib/official-connection.mjs';

test('连接官方地址限制，不接受相似域名、凭证或非 HTTPS', () => {
  for (const url of ['https://id.tsinghua.edu.cn/login', 'https://info.tsinghua.edu.cn/f/info/index', 'https://tsinghua.edu.cn']) assert.equal(officialUrl(url), true);
  for (const url of ['http://id.tsinghua.edu.cn', 'https://tsinghua.edu.cn.evil.test', 'https://fake-tsinghua.edu.cn', 'javascript:alert(1)', 'https://a:b@info.tsinghua.edu.cn']) assert.equal(officialUrl(url), false);
});
test('初始状态诚实标记资源适配未完成，断开清除内存状态', async () => {
  const connection = new OfficialConnection();
  assert.equal(connection.status().dynamicDataReady, false);
  assert.equal(connection.status().lastResourceSync, null);
  connection.resourceLinks = [{ label: '合成测试入口', url: 'https://info.tsinghua.edu.cn/test' }];
  connection.expires = '2026-10-18T00:00:00Z'; await connection.disconnect();
  assert.deepEqual(connection.status().resourceLinks, []); assert.equal(connection.status().expiresAt, null);
  assert.equal(connection.status().passwordStored, false); assert.equal(connection.status().sessionPersistence, 'memory_only');
});
test('在官方认证页仍为待登录，不把二次认证说成已连接', async () => {
  const connection = new OfficialConnection();
  connection.context = { pages: () => [{ isClosed: () => false, url: () => 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/check' }] };
  assert.equal((await connection.checkLogin()).state, 'awaiting_login');
  await connection.disconnect();
});
test('进入门户也保持动态数据未同步', async () => {
  const connection = new OfficialConnection();
  connection.context = { pages: () => [{ isClosed: () => false, url: () => 'https://info.tsinghua.edu.cn/f/info/index', evaluate: async () => ({portal:true}) }] };
  const status = await connection.checkLogin(); assert.equal(status.state, 'authenticated'); assert.equal(status.dynamicDataReady, false);
  await connection.disconnect();
});
test('本机连接 API：防跨源、受保护动作及拒收账号密码正文', async t => {
  const calls = [];
  const connection = {
    checkLogin: async () => ({ state: 'disconnected', dynamicDataReady: false }),
    start: async () => { calls.push('start'); return { state: 'awaiting_login', dynamicDataReady: false }; },
    refresh: async () => ({ state: 'authenticated', dynamicDataReady: false }),
    disconnect: async () => ({ state: 'disconnected' })
  };
  const server = createAppServer({ connection, readSnapshot:async()=>{throw new Error('Synthetic no snapshot');} }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenResponse = await fetch(base + '/api/session'); const { token } = await tokenResponse.json(); assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await fetch(base + '/api/session', { headers: { origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await fetch(base + '/api/session', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const post = headers => fetch(base + '/api/connection/start', { method: 'POST', headers });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ 'X-Qixue-Token': 'x'.repeat(64) })).status, 403);
  const response = await post({ 'X-Qixue-Token': token, Origin: base }); assert.equal(response.status, 200); assert.equal((await response.json()).state, 'awaiting_login');
  const reject = await fetch(base + '/api/connection/start', { method: 'POST', headers: { 'X-Qixue-Token': token }, body: JSON.stringify({ username: 'synthetic', password: 'synthetic' }) });
  assert.equal(reject.status, 400); assert.deepEqual(calls, ['start']);
  assert.equal((await (await fetch(base + '/api/connection/status')).json()).dynamicDataReady, false);
  assert.equal((await fetch(base + '/lib/official-connection.mjs')).status, 404);
  assert.equal((await fetch(base + '/data/private/classroom-snapshot.json')).status, 404);
  const observation = await (await fetch(base + '/api/classrooms/observation')).json();
  assert.deepEqual(observation.records, []);
});
test('入口发现不透出查询令牌、敏感动作或非官方链接', async () => {
  const connection = new OfficialConnection();
  const frame = {
    url: () => 'https://info.tsinghua.edu.cn/f/info/index',
    evaluate: async () => ({portal:true}),
    locator: () => ({ evaluateAll: async () => [
      { label: '教室资源', href: 'https://info.tsinghua.edu.cn/f/rooms' },
      { label: '图书馆', href: 'https://lib.tsinghua.edu.cn/?ticket=synthetic' },
      { label: '座位', href: 'https://evil.invalid/seat' },
      { label: '我的预约', href: 'https://info.tsinghua.edu.cn/reserve' },
      { label: '图书馆资源', href: 'https://lib.tsinghua.edu.cn/logout' },
      { label: '图书馆', href: 'https://lib.tsinghua.edu.cn/#token' }
    ] })
  };
  const page = { isClosed: () => false, url: frame.url, frames: () => [frame] };
  connection.context = { pages: () => [page] };
  const status = await connection.refresh();
  assert.deepEqual(status.resourceLinks, [{ label: '教室资源', url: 'https://info.tsinghua.edu.cn/f/rooms' }]);
  assert.equal(status.dynamicDataReady, false); await connection.disconnect();
});
test('教室查询失败撤下旧候选，不把上次成功当作本次成功', async () => {
  const connection = new OfficialConnection();
  const url = () => 'https://zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do';
  const frame = { url, evaluate: async () => ({ expired:false,controls:[],tables:[] }), getByRole: () => ({ count:async()=>1,isVisible:async()=>true,click:async()=>{throw new Error('synthetic failure');} }) };
  const page = { url,isClosed:()=>false,frames:()=>[frame] };
  connection.context={pages:()=>[page]};connection.classroomObservation={records:[{name:'synthetic previous'}]};
  const status=await connection.queryClassrooms();
  assert.equal(status.classroomStatus,'query_failed');assert.equal(status.classroomObservation.recordCount,0);assert.equal(connection.busy,false);
  await connection.disconnect();
});
