import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { parseLibraryPage, fetchPublicLibrary, LibraryService } from '../lib/library.mjs';
import { LIBRARY_SOURCE, libraryPolicy, recommendLibraries, validateLibrarySnapshot } from '../js/library-policy.js';
import { libraryHtml, librarySnapshot } from './library-fixtures.mjs';
import { createAppServer } from '../server.mjs';

const now = new Date('2026-10-18T06:00:00Z');
const needs = { date: '2026-10-18', startTime: '14:00', duration: 60, scenario: 'quiet', power: false };

test('只解析官网可见卡片中的今日剩余和总量，不从区域树或无来源数字猜测', () => {
  const parsed = parseLibraryPage(libraryHtml() + '<!-- <div class="rooms"><b>假馆</b></div> -->', now.toISOString());
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.records[1].remaining, 12);
  assert.equal(parsed.records[2].remaining, 0);
  assert.equal(parsed.upstreamUpdatedAt, null);
  assert.equal(parsed.source, LIBRARY_SOURCE);
  assert.equal(parsed.records[0].detailSource, 'https://seat.lib.tsinghua.edu.cn/home/web/seat/area/35');
  assert.equal(parseLibraryPage(libraryHtml([{ id: 5, name: '合成 A &amp; B', remaining: 1, total: 2 }]), now.toISOString()).records[0].name, '合成 A & B');
});

test('字段改变、登录页、空页面、重复ID、异常计数均拒绝，不夹成0或伪造记录', () => {
  for (const html of ['', '<html>请登录</html>', libraryHtml().replace('今日剩余8', '余量8'), libraryHtml().replace('剩余8，总量20', '剩余28，总量20'), libraryHtml().replace('/area/64', '/area/35'), libraryHtml().replace('剩余8', '剩余-1'), 'x'.repeat(1000001)]) {
    assert.throws(() => parseLibraryPage(html, now.toISOString()));
  }
  for (const patch of [{ source: 'https://example.com/' }, { records: [] }, { observedAt: 'invalid' }]) assert.throws(() => validateLibrarySnapshot({ ...librarySnapshot(), ...patch }));
});

test('匿名只读固定官网地址，无Cookie、登录、跳转跟随或写操作', async () => {
  let calls = 0;
  const result = await fetchPublicLibrary({ now: () => now, request: async (url, options) => {
    calls++; assert.equal(url, LIBRARY_SOURCE); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(Object.hasOwn(options.headers, 'Cookie'), false);
    return new Response(libraryHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } });
  assert.equal(calls, 1); assert.equal(result.observedAt, now.toISOString());
  await assert.rejects(fetchPublicLibrary({ request: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) }));
  await assert.rejects(fetchPublicLibrary({ request: async () => new Response('unavailable', { status: 503 }) }));
  await assert.rejects(fetchPublicLibrary({ request: async () => new Response('x'.repeat(1000001), { headers: { 'Content-Type': 'text/html' } }) }));
});

test('分钟级新鲜度：2分钟后、未来时间、跨上海日期和失败快照不用于推荐', () => {
  const snapshot = librarySnapshot();
  assert.equal(libraryPolicy(snapshot, now).usable, true);
  assert.equal(libraryPolicy(snapshot, new Date(now.getTime() + 120001)).usable, false);
  assert.equal(libraryPolicy(snapshot, new Date(now.getTime() - 1)).usable, false);
  assert.equal(libraryPolicy({ ...snapshot, lastRefreshFailed: true }, now).usable, false);
  assert.equal(libraryPolicy(librarySnapshot(new Date('2026-10-18T15:59:30Z')), new Date('2026-10-18T16:00:00Z')).usable, false);
});

test('与教室同级条件推荐：按官网剩余排序、排除0，不伪造场景或未来时段', () => {
  const snapshot = librarySnapshot(); const original = structuredClone(snapshot);
  const report = recommendLibraries(snapshot, needs, now);
  assert.deepEqual(report.results.map(row => row.library.id), [64, 35]);
  assert.match(report.results[0].caveats.join(''), /安静程度：待核实/);
  assert.match(report.message, /不能保证整个学习时段有座/);
  const power = recommendLibraries(snapshot, { ...needs, scenario: 'power', power: true }, now);
  assert.match(power.results[0].caveats.join(''), /供电设施：待核实/);
  for (const change of [{ date: '2026-10-19' }, { startTime: '15:00' }, { startTime: '12:00' }, { duration: 600 }, { startTime: 'invalid' }, { scenario: 'unknown' }]) {
    assert.equal(recommendLibraries(snapshot, { ...needs, ...change }, now).results.length, 0);
  }
  const full = librarySnapshot(); for (const row of full.records) row.remaining = 0;
  assert.equal(recommendLibraries(full, needs, now).results.length, 0);
  assert.deepEqual(snapshot, original);
});

test('共享缓存合并并发，普通60秒/手动30秒节流，失败不更新采集时间并可恢复', async () => {
  let clock = now.getTime(), calls = 0, fail = false, saved = 0;
  const service = new LibraryService({ now: () => new Date(clock), readSnapshot: async () => { throw new Error('no cache'); }, save: async () => saved++, fetchSnapshot: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 5)); if (fail) throw new Error('unreachable'); return librarySnapshot(new Date(clock));
  } });
  await Promise.all(Array.from({ length: 10 }, () => service.get()));
  assert.equal(calls, 1); assert.equal(saved, 1);
  clock += 29000; await service.get({ force: true }); assert.equal(calls, 1);
  clock += 1000; await service.get(); assert.equal(calls, 1);
  await service.get({ force: true }); assert.equal(calls, 2);
  const observed = service.snapshot.observedAt;
  clock += 60000; fail = true;
  const failed = await service.get(); assert.equal(failed.policy.usable, false); assert.equal(failed.observedAt, observed); assert.equal(failed.records.length, 3);
  await service.get(); assert.equal(calls, 3);
  clock += 30000; fail = false; const recovered = await service.get();
  assert.equal(recovered.policy.usable, true); assert.equal(calls, 4);
});

test('重启只接受白名单公开字段，坏缓存会重取，写入失败不伪装保存成功', async () => {
  let calls = 0;
  const service = new LibraryService({ now: () => now, readSnapshot: async () => ({ ...librarySnapshot(), cookie: 'synthetic-private' }), fetchSnapshot: async () => { calls++; return librarySnapshot(); }, save: async () => {} });
  const initial = await service.get(); assert.equal(calls, 0); assert.equal(Object.hasOwn(initial, 'cookie'), false);
  const invalid = new LibraryService({ now: () => now, readSnapshot: async () => ({}), fetchSnapshot: async () => librarySnapshot(), save: async () => { throw new Error('read-only'); } });
  const result = await invalid.get(); assert.equal(result.policy.usable, true); assert.match(result.persistenceWarning, /未能写入/);
});

test('图书馆API独立于教室认证，手动刷新要求CSRF且不接受正文或任意来源URL', async t => {
  let calls = 0;
  const server = createAppServer({ library: { get: async options => { calls++; return { ...librarySnapshot(), forced: options?.force === true }; } }, readSnapshot: async () => { throw new Error('no classrooms'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + '/api/libraries/observation')).json()).records.length, 3);
  assert.equal(calls, 1);
  const token = (await (await fetch(base + '/api/session')).json()).token;
  assert.equal((await fetch(base + '/api/libraries/refresh', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/libraries/refresh', { method: 'POST', headers: { 'X-Qixue-Token': token }, body: 'source=anything' })).status, 400);
  const result = await (await fetch(base + '/api/libraries/refresh', { method: 'POST', headers: { 'X-Qixue-Token': token } })).json();
  assert.equal(result.forced, true); assert.equal(calls, 2);
  assert.equal((await fetch(base + '/api/libraries/observation', { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(base + '/data/private/library-snapshot.json')).status, 404);
  assert.equal((await (await fetch(base + '/api/connection/status')).json()).state, 'disconnected');
});
