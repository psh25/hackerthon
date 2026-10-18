export const UNKNOWN = '待核实';

export const SCENARIOS = Object.freeze({
  quiet: { label: '安静学习', feature: 'quiet', reason: '官方资料已明确支持安静学习。' },
  group: { label: '小组讨论', feature: 'groupDiscussion', reason: '官方资料已明确支持小组讨论。' },
  short: { label: '临时学习', feature: 'shortStay', reason: '官方资料已明确支持短时或临时学习。' },
  power: { label: '需要供电', feature: 'power', reason: '官方资料已明确提供学习用电源设施；当前是否可用仍待核实。' }
});

export function isSafeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname);
  } catch { return false; }
}

function hasText(value) { return typeof value === 'string' && value.trim().length > 0; }
function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function isVerifiedFact(fact, place) {
  return fact != null && typeof fact === 'object' && fact.value !== null
    && fact.value !== undefined && isDate(fact.verifiedAt)
    && Array.isArray(fact.sourceIds) && fact.sourceIds.length > 0
    && fact.sourceIds.every(id => place.sources.some(source => source.id === id));
}

export function factText(fact, place) {
  return isVerifiedFact(fact, place) && hasText(fact.value) ? fact.value : UNKNOWN;
}

export function validateDataset(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.places)) throw new Error('场所数据格式不正确。');
  if (!(data.campus === null || hasText(data.campus))) throw new Error('校园名称格式不正确。');
  if (!['awaiting_verified_data', 'verified'].includes(data.datasetStatus)) throw new Error('资料状态不正确。');
  if (!(data.updatedAt === null || isDate(data.updatedAt))) throw new Error('资料更新日期不正确。');
  if (!hasText(data.notice)) throw new Error('缺少资料边界说明。');
  if (data.places.length && (data.datasetStatus !== 'verified' || !hasText(data.campus) || !isDate(data.updatedAt))) throw new Error('已录入场所必须注明校园、核实状态和更新日期。');
  const ids = new Set();
  for (const place of data.places) {
    if (!place || !/^[a-z0-9][a-z0-9-]*$/.test(place.id) || ids.has(place.id)) throw new Error('场所标识缺失、重复或不合法。');
    ids.add(place.id);
    if (!Array.isArray(place.sources) || !place.sources.length) throw new Error('场所缺少官方来源。');
    const sourceIds = new Set();
    for (const source of place.sources) {
      if (!hasText(source.id) || sourceIds.has(source.id) || !hasText(source.title) || !hasText(source.publisher) || source.official !== true || !isSafeSourceUrl(source.url)) throw new Error('官方来源格式不正确。');
      sourceIds.add(source.id);
    }
    for (const key of ['name', 'location', 'openingHours', 'access']) {
      const fact = place[key];
      if (fact !== null && (!isVerifiedFact(fact, place) || !hasText(fact.value))) throw new Error(`场所 ${key} 缺少核实证据；未知项请使用 null。`);
    }
    if (!isVerifiedFact(place.name, place)) throw new Error('场所名称必须有核实依据。');
    if (!place.features || typeof place.features !== 'object') throw new Error('场所缺少设施字段。');
    for (const key of ['quiet', 'groupDiscussion', 'shortStay', 'power']) {
      const fact = place.features[key];
      if (fact !== null && (!isVerifiedFact(fact, place) || typeof fact.value !== 'boolean')) throw new Error(`设施 ${key} 缺少核实证据；未知项请使用 null。`);
    }
  }
  return data;
}

export function supportedScenes(place) {
  return Object.entries(SCENARIOS).filter(([, scenario]) => {
    const fact = place.features[scenario.feature];
    return isVerifiedFact(fact, place) && fact.value === true;
  }).map(([id, scenario]) => ({ id, label: scenario.label }));
}

function evidenceCount(place) {
  return [place.location, place.openingHours, place.access, ...Object.values(place.features)]
    .filter(fact => isVerifiedFact(fact, place)).length;
}

export function recommend(places, scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) throw new Error('不支持的学习场景。');
  return places.filter(place => {
    const fact = place.features[scenario.feature];
    return isVerifiedFact(fact, place) && fact.value === true;
  }).map(place => ({ place, reason: scenario.reason, evidence: place.features[scenario.feature], completeness: evidenceCount(place) }))
    .sort((a, b) => b.completeness - a.completeness || factText(a.place.name, a.place).localeCompare(factText(b.place.name, b.place), 'zh-CN') || a.place.id.localeCompare(b.place.id));
}
