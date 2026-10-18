// 来源：用户提供的节次时间图片，不宣称来自本次官网自动抓取。
export const PERIOD_TIME_SOURCE = Object.freeze({
  kind: 'user_provided_image', label: '用户提供的学校节次时间表',
  file: '720be3dd4f3805f6366a36360fbd4532.jpg',
  sha256: 'C3D2CAE59AA91BB139F5D162F29B97E19F60E6851708F1C94950DDF93575B73C',
  recordedOn: '2026-10-18', timezone: 'Asia/Shanghai',
  note: '图片未给出学期及有效期；如学校调整作息需重新核对。第3节为13:30，不是OCR误识别的15:30。'
});
export const PERIOD_TIMES = Object.freeze([
  { period: 1, start: '08:00', end: '09:35' },
  { period: 2, start: '09:50', end: '12:15' },
  { period: 3, start: '13:30', end: '15:05' },
  { period: 4, start: '15:20', end: '16:55' },
  { period: 5, start: '17:05', end: '18:40' },
  { period: 6, start: '19:20', end: '21:45' }
].map(Object.freeze));
const validClock = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const clockMinutes = value => Number(value.slice(0,2))*60+Number(value.slice(3));
export const clockText = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
export function periodLabel(period) {
  const time = PERIOD_TIMES.find(item => item.period === period);
  return time ? `第${period}节 ${time.start}–${time.end}` : `第${period}节（时间待核实）`;
}
export function matchClockWindow(startTime, duration) {
  if (!validClock(startTime) || !Number.isInteger(duration) || duration < 1 || duration > 480) throw new Error('请填写有效开始时间与1–480分钟的学习时长。');
  const start = clockMinutes(startTime), end = start+duration;
  if (end>1440) throw new Error('暂不支持跨日学习，请缩短时长。');
  const overlaps = PERIOD_TIMES.map(item=>({...item,from:Math.max(start,clockMinutes(item.start)),to:Math.min(end,clockMinutes(item.end))})).filter(item=>item.from<item.to);
  const gaps=[];let cursor=start,coveredMinutes=0;
  for(const item of overlaps){if(cursor<item.from)gaps.push({start:clockText(cursor),end:clockText(item.from),minutes:item.from-cursor});coveredMinutes+=item.to-item.from;cursor=item.to;}
  if(cursor<end)gaps.push({start:clockText(cursor),end:clockText(end),minutes:end-cursor});
  return {startTime,endTime:clockText(end),duration,periods:overlaps.map(item=>item.period),periodStart:overlaps[0]?.period??null,periodEnd:overlaps.at(-1)?.period??null,coveredMinutes,uncoveredMinutes:duration-coveredMinutes,coverage:Math.round(coveredMinutes/duration*100),gaps,fullyCovered:coveredMinutes===duration,source:PERIOD_TIME_SOURCE};
}
export function currentPeriod(time) {
  if(!validClock(time))return null;
  return PERIOD_TIMES.find(item=>clockMinutes(item.start)<=clockMinutes(time)&&clockMinutes(item.end)>clockMinutes(time))||null;
}
