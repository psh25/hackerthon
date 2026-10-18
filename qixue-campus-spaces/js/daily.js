import { SCENARIOS, isVerifiedFact, recommend } from './recommend.js';

export function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function validateNeeds(needs) {
  if (!needs || !Object.hasOwn(SCENARIOS, needs.scenario)) throw new Error('请选择有效的学习场景。');
  if (typeof needs.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(needs.date) || Number.isNaN(Date.parse(needs.date)) || new Date(needs.date).toISOString().slice(0, 10) !== needs.date) throw new Error('请选择有效日期。');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(needs.startTime)) throw new Error('请选择有效的开始时间。');
  if (!Number.isInteger(needs.duration) || needs.duration < 15 || needs.duration > 480) throw new Error('学习时长应在 15–480 分钟之间。');
  if (typeof needs.power !== 'boolean') throw new Error('供电偏好格式不正确。');
  if (needs.bufferMinutes != null && (!Number.isInteger(needs.bufferMinutes) || needs.bufferMinutes < 0 || needs.bufferMinutes > 120)) throw new Error('事务预留时间应为0–120分钟的整数。');
  if (needs.periodStart != null || needs.periodEnd != null) {
    if (!Number.isInteger(needs.periodStart) || !Number.isInteger(needs.periodEnd) || needs.periodStart < 1 || needs.periodEnd > 6 || needs.periodEnd < needs.periodStart) throw new Error('请选择有效的起止节次（1–6，结束不早于开始）。');
  }
  if (Number(needs.startTime.slice(0, 2)) * 60 + Number(needs.startTime.slice(3)) + needs.duration > 1440) throw new Error('本版仅支持当天内的学习时段，请缩短时长或提前开始时间。');
  return needs;
}

// 匹配百分比仅指已核实偏好覆盖率，不是实时可用概率。
export function recommendDaily(places, needs) {
  validateNeeds(needs);
  return recommend(places, needs.scenario).map(result => {
    const constraints = [{ feature: SCENARIOS[needs.scenario].feature, label: SCENARIOS[needs.scenario].label, weight: 2 }];
    if (needs.power && constraints[0].feature !== 'power') constraints.push({ feature: 'power', label: '学习用电源', weight: 1 });
    let matched = 0, total = 0;
    const unknown = [], unsupported = [];
    for (const constraint of constraints) {
      total += constraint.weight;
      const fact = result.place.features[constraint.feature];
      if (!isVerifiedFact(fact, result.place)) unknown.push(constraint.label);
      else if (fact.value === true) matched += constraint.weight;
      else unsupported.push(constraint.label);
    }
    return { ...result, preferenceMatch: Math.round(matched / total * 100), unknownPreferences: unknown, unsupportedPreferences: unsupported, requestedDate: needs.date, requestedStart: needs.startTime, requestedDuration: needs.duration, timeAvailability: '待核实' };
  }).sort((a, b) => b.preferenceMatch - a.preferenceMatch || b.completeness - a.completeness || a.place.id.localeCompare(b.place.id));
}
