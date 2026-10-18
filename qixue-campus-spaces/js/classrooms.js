import { cachePolicy, recommendClassrooms } from './schedule.js';
import {AGENDA_KEY,validateAgenda,studyWindow}from'./agenda.js';
const $ = selector => document.querySelector(selector);
let observation, request, appliedNeeds;
let limit = 24, recommendationLimit = 12;
const allowedStatuses = ['空闲', '有课', '考试', '借用', '屏蔽', '预约', '已约'];
function node(tag, text, className) { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; }
const formatDate = value => new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
function card(room, slots, recommendation) {
  const item=node('article',undefined,'classroom-card');
  item.append(node('span',recommendation?'课表条件推荐 · 场景设施待核实':'官方周课表 · 非自习许可','card-index'),node('h3',room.name));
  const list=node('div',undefined,'schedule-slots');
  for(const slot of slots) {
    const status=allowedStatuses.includes(slot.status)?slot.status:'待核实';
    list.append(node('span',`第${slot.period}节 · ${status}`,status==='空闲'?'schedule-free':'schedule-other'));
  }
  item.append(list);
  if(recommendation) {
    item.append(node('p',recommendation.reason,'recommendation-reason'));
    item.append(node('p',recommendation.caveats.join('；'),'panel-note'));
  }
  item.append(node('p',`官方容量：${room.capacity == null ? '待核实（源数据为0或缺失）' : room.capacity+'人'}；实时空位：待核实。`,'panel-note'));
  if(!recommendation)item.append(node('p','允许自习 / 电源 / 安静程度：待核实。','panel-note'));
  const link=node('a','官方教室来源 ↗','source-link');link.href='https://zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do';link.target='_blank';link.rel='noopener noreferrer';
  item.append(link);return item;
}
function renderRecommendations() {
  const root=$('#study-results');root.replaceChildren();$('#more-study-results').hidden=true;
  if(!appliedNeeds)return;
  const currentScenario=document.querySelector('[data-scenario][aria-pressed="true"]')?.dataset.scenario;
  if(appliedNeeds.date!==$('#need-date').value||appliedNeeds.startTime!==$('#need-time').value||appliedNeeds.duration!==Number($('#need-duration').value)||appliedNeeds.periodStart!==($('#need-period-start').value?Number($('#need-period-start').value):null)||appliedNeeds.periodEnd!==($('#need-period-end').value?Number($('#need-period-end').value):null)||appliedNeeds.scenario!==currentScenario||appliedNeeds.power!==$('#need-power').checked){
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
  $('#study-summary').textContent=`${appliedNeeds.date} 第${appliedNeeds.periodStart}–${appliedNeeds.periodEnd}节 · ${report.message} 缓存采集于${formatDate(observation.observedAt)}；钟点需求${appliedNeeds.startTime} / ${appliedNeeds.duration}分钟尚未用于时段筛选。${observation.syncWarning||''}`;
  for(const match of report.results.slice(0,recommendationLimit))root.append(card(match.room,match.slots,match));
  if(!report.results.length)root.append(node('p',report.message,'recommendation-empty'));
  $('#more-study-results').hidden=report.results.length<=recommendationLimit;
}
function render() {
  const root=$('#classroom-results');root.replaceChildren();$('#more-classrooms').hidden=true;
  const date=$('#need-date').value;
  const policy=cachePolicy(observation,date);
  $('#cache-status').textContent=policy.usable ? `本周课表可直接使用 · ${policy.weekStart}—${policy.weekEnd}` : '暂无可用的本周课表缓存';
  $('#cache-message').textContent=policy.usable ? `${observation.records.length}个教室 · 采集于${formatDate(observation.observedAt)} · 有效至${formatDate(policy.expiresAt)}（上海）。${policy.message}${observation.syncWarning||''}` : policy.message;
  if(!policy.usable){$('#classroom-summary').textContent=policy.message;renderRecommendations();return;}
  const dayIndex=observation.days.findIndex(day=>day.date===date);
  const period=$('#classroom-period').value==='all'?null:Number($('#classroom-period').value);
  const matches=observation.records.filter(room=>{
    if(!$('#only-schedule-free').checked)return true;
    const slots=room.periods.filter(slot=>slot.dayIndex===dayIndex&&(!period||slot.period===period));
    return slots.length===(period?1:6)&&slots.every(slot=>slot.status==='空闲');
  });
  $('#classroom-summary').textContent=`本周缓存 · ${date} · 第${period||'1–6'}节 · ${matches.length}个课表候选 / ${observation.records.length}个教室 · 采集于${formatDate(observation.observedAt)}（上海）。可能有临时调课；非实时座位，不代表允许自习。${observation.syncWarning||''}`;
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
    observation=result;render();
  } catch {
    if(controller!==request)return;
    observation=null;render();
    $('#cache-message').textContent='本地缓存接口读取失败，请确认本地服务器运行正常。不需要因此立即登录学校门户。';
    if(appliedNeeds)$('#study-summary').textContent='推荐暂未完成：本地课表读取失败，请重试。';
  } finally{clearTimeout(timeout);}
}
window.addEventListener('qixue:classrooms',load);
window.addEventListener('qixue:agenda-changed',()=>{if(appliedNeeds)renderRecommendations();});
for(const id of['need-date','need-time','need-duration','need-period-start','need-period-end','need-power'])$(`#${id}`).addEventListener('change',()=>{if(appliedNeeds)renderRecommendations();});
for(const button of document.querySelectorAll('[data-scenario]'))button.addEventListener('click',()=>{if(appliedNeeds)renderRecommendations();});
window.addEventListener('qixue:needs-invalid',event=>{
  appliedNeeds=null;$('#study-recommendations').hidden=false;$('#study-result-count').textContent='0';
  $('#study-results').replaceChildren(node('p',event.detail,'recommendation-empty'));$('#study-summary').textContent='需求未通过校验，已撤下此前推荐。';$('#more-study-results').hidden=true;
});
window.addEventListener('qixue:needs',event=>{
  appliedNeeds=event.detail;recommendationLimit=12;
  $('#study-recommendations').hidden=false;$('#study-result-count').textContent='…';$('#study-summary').textContent='正在从本周本地缓存生成推荐，无需登录…';
  $('#study-results').replaceChildren();$('#more-study-results').hidden=true;
  $('#study-title').focus({preventScroll:true});$('#study-recommendations').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  load();
});
for(const id of ['classroom-period','only-schedule-free'])$(`#${id}`).addEventListener('change',()=>{limit=24;render();});
$('#need-date').addEventListener('change',()=>{limit=24;render();load();});
$('#more-classrooms').addEventListener('click',()=>{limit+=24;render();});
$('#more-study-results').addEventListener('click',()=>{recommendationLimit+=12;renderRecommendations();});
load();setInterval(render,60000);
