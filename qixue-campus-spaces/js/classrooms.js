import { cachePolicy, recommendClassrooms } from './schedule.js';
import {AGENDA_KEY,validateAgenda,studyWindow}from'./agenda.js';
import { periodLabel } from './period-times.js';
import { buildingFor, groupClassrooms } from './campus.js';
const $ = selector => document.querySelector(selector);
let observation, request, appliedNeeds;
let limit = 12, recommendationLimit = 6;
let selectedBuilding = null, recommendedBuilding = null;
const allowedStatuses = ['空闲', '有课', '考试', '借用', '屏蔽', '预约', '已约'];
function node(tag, text, className) { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; }
const formatDate = value => new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
function card(room, slots, recommendation) {
  const item=node('article',undefined,'classroom-card');
  item.append(node('span',buildingFor(room).name+' · '+(recommendation?'课表匹配':'官方课表'),'card-index'),node('h3',room.name));
  const list=node('div',undefined,'schedule-slots');
  for(const slot of slots) {
    const status=allowedStatuses.includes(slot.status)?slot.status:'待核实';
    const badge=node('span',`第${slot.period}节 · ${status}`,status==='空闲'?'schedule-free':'schedule-other');badge.title=periodLabel(slot.period);list.append(badge);
  }
  item.append(list);
  item.append(node('p',`容量 ${room.capacity == null ? '待核实' : room.capacity+'人'} · 现场座位待核实`,'panel-note'));
  const details=node('details',undefined,'card-more');details.append(node('summary','详情与匹配依据'));
  if(recommendation)details.append(node('p',recommendation.reason,'panel-note'),node('p',recommendation.caveats.join('；'),'panel-note'));
  details.append(node('p','位置：'+buildingFor(room).name+' · '+room.name+'；具体楼层、入口和楼内位置待核实。课表空闲不代表允许自习、有插座或实时有座。','panel-note'));
  const link=node('a','官方教室来源 ↗','source-link');link.href='https://zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do';link.target='_blank';link.rel='noopener noreferrer';
  item.append(details,link);return item;
}
const buildingTabs=node('div',undefined,'building-tabs');buildingTabs.id='classroom-building-tabs';buildingTabs.setAttribute('role','group');buildingTabs.setAttribute('aria-label','按楼宇选择教室');
$('#classroom-summary').before(buildingTabs);
const buildingTitle=node('div',undefined,'building-heading');buildingTitle.id='classroom-building-heading';$('#classroom-results').before(buildingTitle);
const recommendationTabs=node('div',undefined,'building-tabs');recommendationTabs.id='recommendation-building-tabs';$('#study-results').before(recommendationTabs);
function makeTabs(root,groups,selected,onSelect){root.replaceChildren();for(const group of groups){const button=node('button',`${group.name} ${group.rooms.length}`,'building-chip');button.type='button';button.dataset.building=group.id;button.setAttribute('aria-pressed',String(selected===group.id));button.addEventListener('click',()=>onSelect(group.id));root.append(button);}}
function selectBuilding(id){selectedBuilding=id;limit=12;render();}
window.addEventListener('qixue:select-building',event=>selectBuilding(event.detail.id));
function renderRecommendations() {
  const root=$('#study-results');root.replaceChildren();recommendationTabs.replaceChildren();$('#more-study-results').hidden=true;
  if(!appliedNeeds)return;
  const currentScenario=document.querySelector('[data-scenario][aria-pressed="true"]')?.dataset.scenario;
  if(appliedNeeds.timeMode!==$('#need-time-mode').value||appliedNeeds.date!==$('#need-date').value||appliedNeeds.startTime!==$('#need-time').value||appliedNeeds.duration!==Number($('#need-duration').value)||appliedNeeds.periodStart!==($('#need-period-start').value?Number($('#need-period-start').value):null)||appliedNeeds.periodEnd!==($('#need-period-end').value?Number($('#need-period-end').value):null)||appliedNeeds.scenario!==currentScenario||appliedNeeds.power!==$('#need-power').checked){
    $('#study-result-count').textContent='0';$('#study-summary').textContent='学习需求已更改，已撤下此前推荐；请再次点击“按我的需求推荐”。';return;
  }
  try {
    const saved=localStorage.getItem(AGENDA_KEY);const events=saved?validateAgenda(JSON.parse(saved)):[];
    const plan=studyWindow(events,{...appliedNeeds,bufferMinutes:Number($('#travel-buffer').value)});
    if(!plan.allowed){$('#study-result-count').textContent='0';$('#study-summary').textContent=`所选学习时间与已录入日程${plan.conflicts.map(event=>`「${event.title}」`).join('、')}冲突（含自设${plan.bufferMinutes}分钟预留），已暂停推荐。请调整时间或明确设置本次不参加。`;
      root.append(node('p','不会为了推荐学习地点而自动忽略你的课程或其他事务。','recommendation-empty'));return;}
  }catch{$('#study-result-count').textContent='0';$('#study-summary').textContent='个人日程读取或学习时段校验失败，已暂停推荐；请检查本机日程和时间。';return;}
  const report=recommendClassrooms(observation,appliedNeeds);
  $('#study-result-count').textContent=String(report.results.length);
  $('#study-summary').textContent=report.message;
  if(!report.policy.usable || report.needsPeriods) {root.append(node('p',report.message,'recommendation-empty'));return;}
  const timeDescription=report.timing?`${report.timing.startTime}–${report.timing.endTime} → 第${report.timing.periodStart}–${report.timing.periodEnd}节；时间依据用户图片，已用于筛选`:`手动第${appliedNeeds.periodStart}–${appliedNeeds.periodEnd}节；钟点需求${appliedNeeds.startTime} / ${appliedNeeds.duration}分钟尚未用于时段筛选（手动模式）`;
  $('#study-summary').textContent=`${appliedNeeds.date} ${timeDescription} · ${report.message} 缓存采集于${formatDate(observation.observedAt)}。${observation.syncWarning||''}`;
  const groups=groupClassrooms(report.results.map(match=>match.room));
  if(!groups.some(group=>group.id===recommendedBuilding))recommendedBuilding=report.results.length?buildingFor(report.results[0].room).id:null;
  makeTabs(recommendationTabs,groups,recommendedBuilding,id=>{recommendedBuilding=id;recommendationLimit=6;renderRecommendations();});
  const shown=report.results.filter(match=>buildingFor(match.room).id===recommendedBuilding);
  for(const match of shown.slice(0,recommendationLimit))root.append(card(match.room,match.slots,match));
  if(!report.results.length)root.append(node('p',report.message,'recommendation-empty'));
  $('#more-study-results').hidden=shown.length<=recommendationLimit;
}
function render() {
  const root=$('#classroom-results');root.replaceChildren();$('#more-classrooms').hidden=true;buildingTabs.replaceChildren();buildingTitle.replaceChildren();
  const date=$('#need-date').value;
  const policy=cachePolicy(observation,date);
  const mapRooms=policy.usable?observation:null;
  if(window.qixueCampusRooms!==mapRooms){window.qixueCampusRooms=mapRooms;window.dispatchEvent(new CustomEvent('qixue:rooms-loaded',{detail:mapRooms}));}
  $('#cache-status').textContent=policy.usable ? `本周课表可直接使用 · ${policy.weekStart}—${policy.weekEnd}` : '暂无可用的本周课表缓存';
  $('#cache-message').textContent=policy.usable ? `${observation.records.length}个教室 · 采集于${formatDate(observation.observedAt)} · 有效至${formatDate(policy.expiresAt)}（上海）。${policy.message}${observation.syncWarning||''}` : policy.message;
  if(!policy.usable){$('#classroom-summary').textContent=policy.message;renderRecommendations();return;}
  const dayIndex=observation.days.findIndex(day=>day.date===date);
  const groups=groupClassrooms(observation.records);
  if(!groups.some(group=>group.id===selectedBuilding))selectedBuilding=groups.find(group=>group.id==='jiaoxue-6')?.id||groups[0]?.id;
  makeTabs(buildingTabs,groups,selectedBuilding,selectBuilding);
  const activeGroup=groups.find(group=>group.id===selectedBuilding);
  if(activeGroup){buildingTitle.append(node('h3',activeGroup.name));const locate=node('button',activeGroup.x?'在地图中查看 ↗':'地图位置待核实','text-button');locate.type='button';locate.disabled=!activeGroup.x;locate.addEventListener('click',()=>{window.dispatchEvent(new CustomEvent('qixue:navigate',{detail:{view:'map'}}));window.dispatchEvent(new CustomEvent('qixue:focus-map',{detail:{id:activeGroup.id}}));});buildingTitle.append(locate);}
  const period=$('#classroom-period').value==='all'?null:Number($('#classroom-period').value);
  const matches=observation.records.filter(room=>{
    if(buildingFor(room).id!==selectedBuilding)return false;
    if(!$('#only-schedule-free').checked)return true;
    const slots=room.periods.filter(slot=>slot.dayIndex===dayIndex&&(!period||slot.period===period));
    return slots.length===(period?1:6)&&slots.every(slot=>slot.status==='空闲');
  });
  $('#classroom-summary').textContent=`${date} · ${activeGroup?.name||'所选楼宇'} ${matches.length}间 / 全校${observation.records.length}间 · 采集 ${formatDate(observation.observedAt)}。课表空闲≠实时有座。`;
  for(const room of matches.slice(0,limit))root.append(card(room,room.periods.filter(slot=>slot.dayIndex===dayIndex&&(!period||slot.period===period))));
  if(!matches.length)root.append(node('p','所选日期 / 节次暂无符合条件的教室。','panel-note'));
  $('#more-classrooms').hidden=matches.length<=limit;
  renderRecommendations();
}
async function load() {
  request?.abort();const controller=new AbortController();request=controller;
  const timeout=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch(`/api/classrooms/observation?date=${encodeURIComponent($('#need-date').value)}`,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('unavailable');
    const result=await response.json();if(controller!==request)return;
    observation=result;window.qixueCampusRooms=cachePolicy(result,$('#need-date').value).usable?result:null;window.dispatchEvent(new CustomEvent('qixue:rooms-loaded',{detail:window.qixueCampusRooms}));render();
  } catch {
    if(controller!==request)return;
    observation=null;window.qixueCampusRooms=null;window.dispatchEvent(new CustomEvent('qixue:rooms-loaded',{detail:null}));render();
    $('#cache-message').textContent='本地缓存接口读取失败，请确认本地服务器运行正常。不需要因此立即登录学校门户。';
    if(appliedNeeds)$('#study-summary').textContent='推荐暂未完成：本地课表读取失败，请重试。';
  } finally{clearTimeout(timeout);}
}
window.addEventListener('qixue:classrooms',load);
window.addEventListener('qixue:agenda-changed',()=>{if(appliedNeeds)renderRecommendations();});
for(const id of['need-date','need-time','need-duration','need-time-mode','need-period-start','need-period-end','need-power'])$(`#${id}`).addEventListener('change',()=>{if(appliedNeeds)renderRecommendations();});
$('#need-time').addEventListener('input',()=>{if(appliedNeeds)renderRecommendations();});
for(const button of document.querySelectorAll('[data-scenario]'))button.addEventListener('click',()=>{if(appliedNeeds)renderRecommendations();});
window.addEventListener('qixue:needs-invalid',event=>{
  appliedNeeds=null;$('#study-recommendations').hidden=false;$('#study-result-count').textContent='0';
  $('#study-results').replaceChildren(node('p',event.detail,'recommendation-empty'));$('#study-summary').textContent='需求未通过校验，已撤下此前推荐。';$('#more-study-results').hidden=true;
});
window.addEventListener('qixue:needs',event=>{
  appliedNeeds=event.detail;recommendationLimit=6;
  $('#study-recommendations').hidden=false;$('#study-result-count').textContent='…';$('#study-summary').textContent='正在从本周本地缓存生成推荐，无需登录…';
  $('#study-results').replaceChildren();$('#more-study-results').hidden=true;
  $('#study-title').focus({preventScroll:true});$('#study-recommendations').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  load();
});
for(const id of ['classroom-period','only-schedule-free'])$(`#${id}`).addEventListener('change',()=>{limit=12;render();});
$('#need-date').addEventListener('change',()=>{limit=12;render();load();});
$('#more-classrooms').textContent='再显示12间教室';$('#more-classrooms').addEventListener('click',()=>{limit+=12;render();});
$('#more-study-results').textContent='再显示6间推荐';$('#more-study-results').addEventListener('click',()=>{recommendationLimit+=6;renderRecommendations();});
load();setInterval(render,60000);
