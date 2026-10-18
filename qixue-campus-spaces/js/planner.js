import{AGENDA_KEY,chinaNow,validateAgenda,validateEvent,attendanceException,studyWindow}from'./agenda.js';
import { currentPeriod, periodLabel } from './period-times.js';
const $=selector=>document.querySelector(selector);
let events=[],storeError='';
try{const saved=localStorage.getItem(AGENDA_KEY);if(saved)events=validateAgenda(JSON.parse(saved));}catch{storeError='本机已有日程无法读取；为避免覆盖未保存资料，请先导出或检查浏览器存储。';}
function announce(){window.dispatchEvent(new CustomEvent('qixue:agenda-changed'));}
function save(next){validateAgenda(next);localStorage.setItem(AGENDA_KEY,JSON.stringify(next));events=next;storeError='';renderAgenda();announce();}
function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
function renderAgenda(){
  const date=$('#need-date').value||chinaNow().date;$('#agenda-date-label').textContent=date;
  const list=$('#agenda-events');list.replaceChildren();
  const today=events.filter(event=>event.date===date).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
  if(!today.length)list.append(node('p','此日还没有录入个人日程。没有记录不代表官方课表无课。'));
  for(const event of today){
    const row=document.createElement('li');row.className=event.attending?'agenda-event':'agenda-event is-skipped';
    const text=document.createElement('div');text.append(node('strong',`${event.start}–${event.end} ${event.title}`),node('small',`${event.kind==='course'?'课程':'临时事项'} · ${event.location||'地点待填写'} · 用户录入 · ${event.attending?'参加 / 占用此时段':'仅本次不参加，不占用个人时间'}`));
    const toggle=node('button',event.attending?'本次不参加':'恢复参加');toggle.type='button';toggle.setAttribute('aria-label',`${toggle.textContent}：${event.title}`);
    toggle.addEventListener('click',()=>{try{save(attendanceException(events,event.id,!event.attending));}catch{$('#agenda-message').textContent='日程未能保存，请检查浏览器存储。';}});
    const remove=node('button','删除');remove.type='button';remove.setAttribute('aria-label',`删除日程：${event.title}`);remove.addEventListener('click',()=>{try{save(events.filter(item=>item.id!==event.id));}catch{$('#agenda-message').textContent='删除未保存，请检查浏览器存储。';}});
    row.append(text,toggle,remove);list.append(row);
  }
  $('#agenda-message').textContent=storeError||'日程仅存当前浏览器、未额外加密，不上传；共用电脑请使用后清除。本次不参加不会改变教室占用，不代表学校批准缺席。';
  showWindow();
}
function showWindow(){
  const fields={date:$('#need-date').value,startTime:$('#need-time').value,duration:Number($('#need-duration').value),bufferMinutes:Number($('#travel-buffer').value)};
  try{const plan=studyWindow(events,fields);$('#personal-window').textContent=plan.conflicts.length?`计划与${plan.conflicts.map(e=>`「${e.title}」`).join('、')}冲突（含前后${plan.bufferMinutes}分钟自设预留）。请改时间，或只对确实不参加的本次日程设置例外。`:`已录入日程中无冲突；从所选开始时刻起，到下一项已录入事务前最多${plan.availableMinutes}分钟${plan.next?`，下一项「${plan.next.title}」${plan.next.start}开始`:'；今天尚无下一项已录入事务'}。这不是已同步官方个人课表。`;}catch{$('#personal-window').textContent='请填写有效的同日学习时段和预留分钟。';}
}
function tick(){const now=chinaNow();const period=currentPeriod(now.time);$('#system-clock').textContent=`${now.date} ${now.time}:${now.seconds} · 上海时间`;$('#clock-note').textContent=`${period?`按图片时间表，此刻处于${periodLabel(period.period)}`:'此刻不在图片列明的教学时段内，不能据此认定教室空闲'}。读取本机系统时钟，不是学校授时；系统时间不准确时请先校准。`;}
tick();setInterval(tick,1000);
$('#use-now').addEventListener('click',()=>{const now=chinaNow();$('#need-date').value=now.date;$('#need-time').value=now.time;$('#need-time-mode').value='clock';$('#agenda-event-date').value=now.date;$('#need-time-mode').dispatchEvent(new Event('change'));$('#need-date').dispatchEvent(new Event('change'));$('#need-time').dispatchEvent(new Event('change'));$('#needs-message').textContent='已使用本机当前日期和时间，并切换为自动匹配节次；请点击推荐，未覆盖的课间/午休仍待核实。';});
$('#agenda-event-date').value=chinaNow().date;
$('#agenda-form').addEventListener('submit',event=>{
  event.preventDefault();try{
    if(storeError)throw new Error(storeError);
    const item=validateEvent({id:crypto.randomUUID(),title:$('#agenda-title').value.trim(),date:$('#agenda-event-date').value,start:$('#agenda-start').value,end:$('#agenda-end').value,location:$('#agenda-location').value.trim(),kind:$('#agenda-kind').value,attending:true,source:'manual'});
    save([...events,item]);$('#agenda-title').value='';$('#agenda-message').textContent=`日程已保存在本机。${item.date!==$('#need-date').value?'切换学习日期至'+item.date+'可查看。':''}`;
  }catch(error){$('#agenda-message').textContent=error.message;}
});
$('#clear-agenda').addEventListener('click',()=>{if(!confirm('删除当前浏览器保存的全部个人日程？不会修改官方课表。'))return;try{save([]);}catch{$('#agenda-message').textContent='未能清除本机日程。';}});
for(const id of['need-date','need-time','need-duration','travel-buffer'])$(`#${id}`).addEventListener('change',()=>{renderAgenda();announce();});
window.addEventListener('qixue:needs',()=>showWindow());
window.addEventListener('storage',event=>{if(event.key!==AGENDA_KEY)return;try{events=event.newValue?validateAgenda(JSON.parse(event.newValue)):[];storeError='';renderAgenda();announce();}catch{$('#agenda-message').textContent='另一个标签的日程数据不正确；尚未加载，请检查。';}});
renderAgenda();
