import { PERIOD_TIMES, PERIOD_TIME_SOURCE, matchClockWindow, periodLabel } from './period-times.js';
const $ = selector => document.querySelector(selector);

export function syncTimeSelection() {
  const automatic=$('#need-time-mode').value==='clock';
  $('#need-period-start').disabled=automatic;$('#need-period-end').disabled=automatic;
  if(!automatic){$('#time-mapping').textContent='手动模式：仅按所选节次筛选教室；钟点仍用于个人日程冲突检查，不代表它与手选节次一致。';return null;}
  try {
    const timing=matchClockWindow($('#need-time').value,Number($('#need-duration').value));
    $('#need-period-start').value=timing.periodStart?String(timing.periodStart):'';
    $('#need-period-end').value=timing.periodEnd?String(timing.periodEnd):'';
    const coverage=timing.periods.length?`自动对应${timing.periods.map(period=>`第${period}节`).join('、')}，教学时段覆盖${timing.coveredMinutes}/${timing.duration}分钟。`:'没有相交教学节次，不能凭课表确认该时段教室空闲。';
    $('#time-mapping').textContent=`${timing.startTime}–${timing.endTime} · ${coverage}${timing.gaps.length?`未覆盖：${timing.gaps.map(gap=>`${gap.start}–${gap.end}`).join('、')}，状态待核实。`:''} 时间依据用户提供图片，非本次官网自动核验。`;
    return timing;
  }catch(error){$('#need-period-start').value='';$('#need-period-end').value='';$('#time-mapping').textContent=error.message;return null;}
}

export function initializeTimeSelection() {
  for(const id of['need-period-start','need-period-end','classroom-period']){
    for(const option of $(`#${id}`).options){const period=Number(option.value);if(period>=1&&period<=6)option.textContent=periodLabel(period);}
  }
  const body=$('#period-time-rows');body.replaceChildren();
  for(const item of PERIOD_TIMES){const row=document.createElement('tr');for(const value of[`第${item.period}节`,item.start,item.end]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}
  $('#period-source-note').textContent=`来源：${PERIOD_TIME_SOURCE.label}（${PERIOD_TIME_SOURCE.file}）；${PERIOD_TIME_SOURCE.recordedOn}录入。${PERIOD_TIME_SOURCE.note}`;
  for(const id of['need-time','need-duration','need-time-mode'])$(`#${id}`).addEventListener('change',syncTimeSelection);
  $('#need-time').addEventListener('input',syncTimeSelection);
  syncTimeSelection();
}
