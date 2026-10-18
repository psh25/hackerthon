import { LIBRARY_SOURCE } from '../js/library-policy.js';
export const libraryHtml = (rows = [
  { id: 35, name: '合成甲馆', remaining: 8, total: 20 },
  { id: 64, name: '合成乙馆', remaining: 12, total: 40 },
  { id: 89, name: '合成满馆', remaining: 0, total: 10 }
]) => `<html><body>${rows.map(row => `<div class="rooms"><div class="ceng"><b>${row.name}</b></div><div><b>今日剩余${row.remaining}，总量${row.total}</b></div><div class="seat"><a href="/home/web/seat/area/${row.id}">座 位</a></div><div class="clearfix"></div></div>`).join('')}</body></html>`;
export function librarySnapshot(now = new Date('2026-10-18T06:00:00Z')) {
  return { source: LIBRARY_SOURCE, observedAt: now.toISOString(), upstreamUpdatedAt: null, countMeaning: 'official_today_remaining', records: [
    { id: 35, name: '合成甲馆', remaining: 8, total: 20 }, { id: 64, name: '合成乙馆', remaining: 12, total: 40 }, { id: 89, name: '合成满馆', remaining: 0, total: 10 }
  ].map(row => ({ ...row, source: LIBRARY_SOURCE, detailSource: `https://seat.lib.tsinghua.edu.cn/home/web/seat/area/${row.id}` })) };
}
