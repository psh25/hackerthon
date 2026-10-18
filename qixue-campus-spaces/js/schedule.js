import { matchClockWindow, periodLabel } from './period-times.js';
export const CLASSROOM_SOURCE = 'https://zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do';
export const WEEK_MS = 7 * 86400000;
export function chinaDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  return ['year','month','day'].map(type => parts.find(part => part.type === type).value).join('-');
}
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function cachePolicy(snapshot, requestedDate, now = new Date()) {
  const fail = (code, message) => ({ usable:false, code, message, expiresAt:null, weekStart:null, weekEnd:null });
  if (!validDate(requestedDate)) return fail('invalid_date','请选择有效学习日期。');
  if (!snapshot?.records?.length || snapshot.source !== CLASSROOM_SOURCE || snapshot.truncated === true) return fail('missing','没有完整可信的教室周课表缓存，请主动同步一次。');
  const dates = snapshot.days?.map(day => day.date);
  if (dates?.length !== 7 || dates.some(date => !validDate(date))) return fail('invalid_week','缓存周日期不完整，不能匹配所选日期。');
  const start = Date.parse(`${dates[0]}T00:00:00+08:00`);
  if (new Date(dates[0]).getUTCDay() !== 1 || dates.some((date,index) => Date.parse(`${date}T00:00:00+08:00`) !== start + index*86400000)) return fail('invalid_week','缓存不是完整的周一至周日课表。');
  const observed = Date.parse(snapshot.observedAt), time = now.valueOf();
  if (!Number.isFinite(observed) || observed > time + 60000) return fail('invalid_timestamp','缓存采集时间不正确，请重新同步。');
  const expires = Math.min(observed + WEEK_MS, start + WEEK_MS);
  if (time >= expires || time < start) return fail('expired','本周缓存已过期或不属于当前周，请重新同步所需周课表。');
  if (!dates.includes(requestedDate)) return fail('not_covered','已有缓存不覆盖所选日期，请同步对应周次；不会用上周数据冒充本周。');
  const keys = new Set();
  for (const room of snapshot.records) {
    if (typeof room.name !== 'string' || !room.name.trim() || !Array.isArray(room.periods) || room.periods.length !== 42) return fail('invalid_records','教室缓存结构不完整，请重新同步。');
    const slots = new Set();
    for (const slot of room.periods) {
      if (!Number.isInteger(slot.dayIndex) || slot.dayIndex < 0 || slot.dayIndex > 6 || !Number.isInteger(slot.period) || slot.period < 1 || slot.period > 6 || !['空闲','有课','考试','借用','屏蔽','预约','已约','待核实'].includes(slot.status)) return fail('invalid_records','缓存节次字段不正确。');
      slots.add(`${slot.dayIndex}:${slot.period}`);
    }
    if (slots.size !== 42 || keys.has(room.name)) return fail('invalid_records','缓存存在重复教室或错位节次，请重新同步。');
    keys.add(room.name);
  }
  return { usable:true, code:'weekly_cache', message:'使用本周已采集课表，无需再次登录；临时调课仍可能变化，请以官方最新通知为准。', expiresAt:new Date(expires).toISOString(), weekStart:dates[0], weekEnd:dates[6], requestedDate, fromCache:Boolean(snapshot.fromCache) };
}

export function recommendClassrooms(snapshot, needs, now = new Date()) {
  const policy = cachePolicy(snapshot, needs.date, now);
  if (!policy.usable) return { policy, results:[], message:policy.message };
  let timing = null;
  if (needs.timeMode === 'clock') {
    try { timing = matchClockWindow(needs.startTime, needs.duration); }
    catch(error) { return {policy,results:[],message:error.message,needsPeriods:true}; }
    if (!timing.periods.length) return {policy,results:[],timing,needsPeriods:true,message:`${timing.startTime}–${timing.endTime}完全位于图片列明的教学时段之外（课间、午休或早晚时段）；该段教室状态待核实，不能据此推荐空闲教室。`};
  }
  const start = timing ? timing.periodStart : needs.periodStart, end = timing ? timing.periodEnd : needs.periodEnd;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 6 || end < start) return { policy, results:[], message:'手动模式请选择起止官方节次（1–6），或切换为按钟点自动匹配。', needsPeriods:true };
  const dayIndex = snapshot.days.findIndex(day => day.date === needs.date);
  const results = snapshot.records.flatMap(room => {
    const slots = room.periods.filter(slot => slot.dayIndex === dayIndex && slot.period >= start && slot.period <= end).sort((a,b)=>a.period-b.period);
    if (slots.length !== end-start+1 || !slots.every(slot=>slot.status==='空闲')) return [];
    let consecutive = 0;
    for (let period=end+1; period<=6; period++) {
      if (room.periods.find(slot=>slot.dayIndex===dayIndex && slot.period===period)?.status !== '空闲') break;
      consecutive++;
    }
    const reason = timing ? `${timing.startTime}–${timing.endTime}涉及${timing.periods.map(periodLabel).join('、')}，这些节次均被官方周课表标为“空闲”。${timing.fullyCovered ? '所选钟点均落在这些教学时段内。' : `其中${timing.uncoveredMinutes}分钟不在教学时段内，状态待核实；不表示整个学习窗口连续空闲。`}` : `所选第${start}–${end}节均被官方课表标为“空闲”${consecutive ? `，之后另有${consecutive}个连续编号的空闲节次（不含课间保证）` : ''}。`;
    return [{ room, slots, extraFreePeriods:consecutive, timetableCoverage:timing ? timing.coverage : 100, timing, reason, caveats:[...(timing?.gaps.length ? [`未覆盖时间：${timing.gaps.map(gap=>`${gap.start}–${gap.end}`).join('、')}（待核实）`] : []), '允许自习：待核实', `${({quiet:'安静程度',group:'讨论许可',short:'临时进入要求',power:'供电设施'})[needs.scenario] || '场景设施'}：待核实`, ...(needs.power && needs.scenario!=='power' ? ['供电设施：待核实'] : []), '实时空位：待核实' ] }];
  }).sort((a,b)=>b.extraFreePeriods-a.extraFreePeriods || a.room.name.localeCompare(b.room.name,'zh-CN'));
  return { policy, results, timing, message:results.length ? `找到${results.length}个${timing?.gaps.length ? '包含待核实时段的' : ''}课表条件匹配候选，按后续空闲节次数、名称排序；这不是自习许可或实时座位。${timing?.gaps.length ? `课间/午休等${timing.uncoveredMinutes}分钟未覆盖，不能确认全程空闲。` : ''}` : '所选日期与节次没有全部标为“空闲”的教室，请调整时间或节次；未知状态不算空闲。' };
}
