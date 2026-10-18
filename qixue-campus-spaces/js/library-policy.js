import { chinaNow, minutes } from './agenda.js';

export const LIBRARY_SOURCE = 'https://seat.lib.tsinghua.edu.cn/home/web/f_second';
export const LIBRARY_FRESH_MS = 120000;
export const LIBRARY_REFRESH_MS = 60000;

export function validateLibrarySnapshot(snapshot) {
  if (!snapshot || snapshot.source !== LIBRARY_SOURCE || !Number.isFinite(Date.parse(snapshot.observedAt))
    || !Array.isArray(snapshot.records) || !snapshot.records.length || snapshot.records.length > 100) throw new Error('图书馆快照不完整。');
  const ids = new Set();
  for (const row of snapshot.records) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 150
      || !Number.isSafeInteger(row.total) || row.total < 0 || !Number.isSafeInteger(row.remaining) || row.remaining < 0 || row.remaining > row.total
      || row.source !== LIBRARY_SOURCE || row.detailSource !== `https://seat.lib.tsinghua.edu.cn/home/web/seat/area/${row.id}`) throw new Error('图书馆记录格式或来源异常。');
    ids.add(row.id);
  }
  return snapshot;
}

export function libraryPolicy(snapshot, now = new Date()) {
  try { validateLibrarySnapshot(snapshot); } catch { return { usable: false, message: '尚无可用的图书馆公开座位数据，请点击“刷新图书馆”。' }; }
  const age = now.getTime() - Date.parse(snapshot.observedAt);
  if (snapshot.lastRefreshFailed) return { usable: false, message: '最近一次图书馆刷新失败；下方仅保留上次成功的历史数字，不用于当前推荐。' };
  if (age < 0 || age > LIBRARY_FRESH_MS || chinaNow(now).date !== chinaNow(new Date(snapshot.observedAt)).date) {
    return { usable: false, message: '图书馆数字已过期或跨日；只能查看历史，不用于当前推荐。请刷新。' };
  }
  return { usable: true, ageSeconds: Math.floor(age / 1000), expiresAt: new Date(Date.parse(snapshot.observedAt) + LIBRARY_FRESH_MS).toISOString(), message: '近期采集的官网“今日剩余”数字；不等于到馆有座、可成功预约或当前开放。' };
}

export function recommendLibraries(snapshot, needs, now = new Date()) {
  const policy = libraryPolicy(snapshot, now);
  if (!policy.usable) return { policy, results: [], message: policy.message };
  const current = chinaNow(now);
  const start = /^([01]\d|2[0-3]):[0-5]\d$/.test(needs?.startTime) ? minutes(needs.startTime) : NaN;
  if (needs?.date !== current.date || !Number.isInteger(needs.duration) || needs.duration < 15 || needs.duration > 480 || !Number.isFinite(start)
    || start + needs.duration > 1440 || start > minutes(current.time) || start + needs.duration <= minutes(current.time)) {
    return { policy, results: [], message: '图书馆只用当前采集数字推荐包含此刻的今日学习窗口；不能用当前剩余预测未来或过去。可点击“从现在开始”后重新推荐。' };
  }
  const scene = { quiet: '安静程度', group: '小组讨论许可', short: '临时进入要求', power: '供电设施' }[needs.scenario];
  if (!scene) return { policy, results: [], message: '请先选择有效学习场景。' };
  const results = snapshot.records.filter(row => row.remaining > 0).map(row => ({
    library: row,
    reason: `官网在采集时显示今日剩余${row.remaining} / 总量${row.total}，按剩余数量由多到少排列；不是场景设施匹配分数。`,
    caveats: [`${scene}：待核实`, ...(needs.power && needs.scenario !== 'power' ? ['供电设施：待核实'] : []), '开放时间 / 进入要求：待核实', '整个学习时段有座 / 预约能否成功：待核实']
  })).sort((a, b) => b.library.remaining - a.library.remaining || a.library.id - b.library.id);
  return { policy, results, message: results.length ? `找到${results.length}个采集时官网显示有剩余的分馆，按官网剩余数量排序；场景设施待核实，不能保证整个学习时段有座。` : '采集时官网显示所有分馆今日剩余为0，不推荐为有剩余候选；不据此推断闭馆。' };
}
