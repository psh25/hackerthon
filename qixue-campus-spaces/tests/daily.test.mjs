import test from 'node:test';
import assert from 'node:assert/strict';
import { shanghaiDate, validateNeeds, recommendDaily } from '../js/daily.js';
import { syntheticPlace, syntheticFact } from './fixtures.mjs';

const needs = { scenario: 'quiet', date: '2026-10-18', startTime: '14:00', duration: 60, power: true };
test('每日日期按上海时区初始化，跨 UTC 日期正确', () => assert.equal(shanghaiDate(new Date('2026-10-17T20:00:00Z')), '2026-10-18'));
test('日期、场景、时间、时长、电源类型和跨日校验', () => {
  assert.equal(validateNeeds(needs), needs);
  for (const patch of [{ date: '2026-02-30' }, { scenario: 'toString' }, { startTime: '25:00' }, { duration: 0 }, { duration: 481 }, { duration: '60' }, { power: 'true' }, { startTime: '23:45', duration: 60 }]) assert.throws(() => validateNeeds({ ...needs, ...patch }));
});
test('已核实供电优先，未知不视作支持，输出不是实时可用概率', () => {
  const unknown = syntheticPlace('unknown'), yes = syntheticPlace('yes'), no = syntheticPlace('no');
  yes.features.power = syntheticFact(true); no.features.power = syntheticFact(false);
  const result = recommendDaily([unknown, yes, no], needs);
  assert.equal(result[0].place.id, 'yes'); assert.equal(result[0].preferenceMatch, 100);
  assert.equal(result.find(r => r.place.id === 'unknown').preferenceMatch, 67);
  assert.deepEqual(result.find(r => r.place.id === 'unknown').unknownPreferences, ['学习用电源']);
  assert.deepEqual(result.find(r => r.place.id === 'no').unsupportedPreferences, ['学习用电源']);
  for (const row of result) assert.equal(row.timeAvailability, '待核实');
});
test('供电主场景不重复计算额外供电偏好', () => {
  const place = syntheticPlace(); place.features.power = syntheticFact(true);
  assert.equal(recommendDaily([place], { ...needs, scenario: 'power' })[0].preferenceMatch, 100);
});
test('无数据不生成推荐，主场景未知仍不推荐', () => {
  assert.deepEqual(recommendDaily([], needs), []);
  const place = syntheticPlace(); place.features.quiet = null; place.features.power = syntheticFact(true);
  assert.deepEqual(recommendDaily([place], needs), []);
});
