import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENARIOS, UNKNOWN, validateDataset, recommend, supportedScenes, factText, isSafeSourceUrl } from '../js/recommend.js';
import { syntheticFact as fact, syntheticPlace, syntheticDataset } from './fixtures.mjs';

test('四个所需场景均存在', () => assert.deepEqual(Object.keys(SCENARIOS), ['quiet', 'group', 'short', 'power']));
test('生产数据符合格式，空数据明确标记尚待调查', async () => {
  const data = validateDataset(JSON.parse(await readFile(new URL('../data/places.json', import.meta.url), 'utf8')));
  if (!data.places.length) assert.equal(data.datasetStatus, 'awaiting_verified_data');
  for (const place of data.places) assert.doesNotMatch(place.name.value, /合成|synthetic|测试夹具/iu);
});
test('明确核实为支持的场所才可推荐', () => {
  const place = syntheticPlace();
  assert.equal(recommend([place], 'quiet').length, 1);
  for (const id of ['group', 'short', 'power']) assert.equal(recommend([place], id).length, 0);
});
test('已核实不支持的设施不进入推荐', () => {
  const place = syntheticPlace(); place.features.power = fact(false);
  assert.equal(recommend([place], 'power').length, 0);
});
test('没有来源或核实日期的 true 不能用于匹配', () => {
  const place = syntheticPlace(); place.features.power = { value: true, sourceIds: [], verifiedAt: null };
  assert.equal(recommend([place], 'power').length, 0);
});
test('其他设施不会间接推断出供电', () => {
  const place = syntheticPlace(); place.features.shortStay = fact(true); place.features.groupDiscussion = fact(true);
  assert.equal(recommend([place], 'power').length, 0);
});
test('每一种场景可以独立匹配', () => {
  for (const [id, scene] of Object.entries(SCENARIOS)) {
    const place = syntheticPlace();
    for (const key of Object.keys(place.features)) place.features[key] = null;
    place.features[scene.feature] = fact(true);
    assert.equal(recommend([place], id).length, 1);
    assert.deepEqual(supportedScenes(place), [{ id, label: scene.label }]);
  }
});
test('未知资料统一显示待核实，不根据名称推断', () => {
  const place = syntheticPlace(); assert.equal(factText(place.openingHours, place), UNKNOWN);
  assert.equal(factText({ value: '推测的地址' }, place), UNKNOWN);
});
test('排序优先核实完整度，不修改原始数组', () => {
  const a = syntheticPlace('a'), b = syntheticPlace('b'); b.openingHours = fact('测试时间');
  const input = [a, b]; const results = recommend(input, 'quiet');
  assert.equal(results[0].place.id, 'b'); assert.deepEqual(input, [a, b]);
  assert.equal(recommend(input, 'quiet')[0].place.id, 'b');
});
test('未知场景被拒绝', () => assert.throws(() => recommend([], 'fake')));
test('有效的合成数据可用于规则测试', () => assert.equal(validateDataset(syntheticDataset()).places.length, 1));
test('没有官方来源的场所不可收录', () => {
  const data = syntheticDataset(); data.places[0].sources = []; assert.throws(() => validateDataset(data));
});
test('来源是否官方必须由录入人确认', () => {
  const data = syntheticDataset(); data.places[0].sources[0].official = false; assert.throws(() => validateDataset(data));
});
test('缺少名称证据不可收录', () => {
  const data = syntheticDataset(); data.places[0].name = null; assert.throws(() => validateDataset(data));
});
test('未知设施必须用 null，不接受未经证实的布尔值', () => {
  const data = syntheticDataset(); data.places[0].features.power = true; assert.throws(() => validateDataset(data));
});
test('事实引用不存在的来源会被拒绝', () => {
  const data = syntheticDataset(); data.places[0].location.sourceIds = ['missing']; assert.throws(() => validateDataset(data));
});
test('日期格式及无效日期被拒绝', () => {
  const data = syntheticDataset(); data.updatedAt = '2026-02-30'; assert.throws(() => validateDataset(data));
});
test('重复场所标识不可收录', () => assert.throws(() => validateDataset(syntheticDataset([syntheticPlace(), syntheticPlace()]))));
test('有场所时不得缺少校园身份或资料状态', () => {
  const data = syntheticDataset(); data.campus = null; assert.throws(() => validateDataset(data));
});
test('外链只接受 HTTPS，拒绝脚本、文件和凭证', () => {
  assert.equal(isSafeSourceUrl('https://example.edu/info'), true);
  for (const value of ['javascript:alert(1)', 'file:///secret', 'http://example.edu', '//example.edu', 'https://a:b@example.edu']) assert.equal(isSafeSourceUrl(value), false);
});
