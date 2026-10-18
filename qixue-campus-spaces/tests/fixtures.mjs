// 仅供自动化测试使用的合成数据，不是真实场所，不得放入 data/places.json。
export const syntheticFact = value => ({ value, sourceIds: ['test-source'], verifiedAt: '2026-10-18' });

export function syntheticPlace(id = 'synthetic-only') {
  return {
    id,
    name: syntheticFact(`自动化合成场所 ${id}（非真实）`),
    location: syntheticFact('仅用于测试的合成位置'),
    openingHours: null,
    access: null,
    features: { quiet: syntheticFact(true), groupDiscussion: null, shortStay: null, power: null },
    sources: [{ id: 'test-source', title: '合成测试链接（非真实场所来源）', publisher: '自动化测试夹具', url: 'https://example.edu/synthetic-fixture', official: true }]
  };
}

export function syntheticDataset(places = [syntheticPlace()]) {
  return { schemaVersion: 1, campus: '仅用于自动化的合成校园', datasetStatus: 'verified', updatedAt: '2026-10-18', notice: '合成测试夹具，不是真实场所。', places };
}
