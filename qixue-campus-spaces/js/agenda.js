export const AGENDA_KEY='qixue.agenda.v1';
const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
const dateOk=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
export function chinaNow(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=type=>parts.find(part=>part.type===type).value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`,seconds:get('second')};
}
export function validateEvent(event) {
  if(!event||typeof event.id!=='string'||!event.id||event.id.length>100||typeof event.title!=='string'||!event.title.trim()||event.title.length>100)throw new Error('请填写有效的日程名称（最多100字）。');
  if(!dateOk(event.date)||!clock.test(event.start)||!clock.test(event.end)||minutes(event.end)<=minutes(event.start))throw new Error('请选择有效日期和同一天内的起止时间，结束应晚于开始。');
  if(!['course','event'].includes(event.kind)||typeof event.attending!=='boolean'||typeof event.location!=='string'||event.location.length>120)throw new Error('日程类型、地点或参加状态不正确。');
  if(event.source!=='manual')throw new Error('本版个人日程仅支持用户录入，不冒充官方导入。');
  return event;
}
export function validateAgenda(events) {
  if(!Array.isArray(events)||events.length>500)throw new Error('本机日程数据不正确或超过500项。');
  const ids=new Set();for(const event of events){validateEvent(event);if(ids.has(event.id))throw new Error('日程编号重复。');ids.add(event.id);}return events;
}
export function attendanceException(events,id,attending) {
  validateAgenda(events);if(typeof attending!=='boolean')throw new Error('参加状态不正确。');
  // 每条记录是具体日期的一次事项：不会删除课程本身，也不改写其他日期。
  return events.map(event=>event.id===id?{...event,attending}:event);
}
export function studyWindow(events,{date,startTime,duration,bufferMinutes=10}) {
  validateAgenda(events);
  if(!dateOk(date)||!clock.test(startTime)||!Number.isInteger(duration)||duration<1||duration>480||!Number.isInteger(bufferMinutes)||bufferMinutes<0||bufferMinutes>120)throw new Error('学习窗口或预留时间不正确。');
  const start=minutes(startTime),end=start+duration;
  if(end>1440)throw new Error('暂不支持跨日学习窗口。');
  const active=events.filter(event=>event.date===date&&event.attending).sort((a,b)=>minutes(a.start)-minutes(b.start)||a.id.localeCompare(b.id));
  // 预留时间由用户设定，不是假装已算出的校园步行时间。
  const conflicts=active.filter(event=>start<Math.min(1440,minutes(event.end)+bufferMinutes)&&end>Math.max(0,minutes(event.start)-bufferMinutes));
  const current=active.find(event=>minutes(event.start)<=start&&minutes(event.end)>start);
  const upcoming=active.find(event=>minutes(event.start)>start);
  const availableMinutes=current?0:Math.max(0,(upcoming?Math.max(start,minutes(upcoming.start)-bufferMinutes):1440)-start);
  return {conflicts,current:current||null,next:upcoming||null,availableMinutes,ignored:events.filter(event=>event.date===date&&!event.attending),allowed:conflicts.length===0,bufferMinutes};
}
