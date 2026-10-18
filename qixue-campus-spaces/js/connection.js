import { shanghaiDate, validateNeeds } from './daily.js';
import { chinaNow } from './agenda.js';
import { initializeTimeSelection, syncTimeSelection } from './period-ui.js';

const $ = selector => document.querySelector(selector);
const STORE = 'qixue.daily-needs.v1';
let token;
let poll;
let pending = false;
let checking = false;
let current;
let observationVersion;
const statuses = {
  disconnected: '尚未连接官方门户',
  launching: '正在打开官方认证窗口',
  awaiting_login: '请在官方窗口登录并完成二次认证',
  authenticated: '官方服务已连接 · 各资源单独核验',
  closed: '官方窗口已关闭，需要时请重新连接',
  error: '连接失败，可重试或查看启动配置'
};

async function api(path, action = false) {
  const response = await fetch(path, { method: action ? 'POST' : 'GET', cache: 'no-store', headers: action ? { 'X-Qixue-Token': token } : {}, signal: AbortSignal.timeout(action ? 55000 : 10000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || '本地连接服务暂不可用。');
  return body;
}

function renderConnection(status) {
  current = status;
  $('#connection-status').textContent = statuses[status.state] || '连接状态待核实';
  if (status.state === 'authenticated' && status.services) {
    const names = { authenticated: '已确认', login_required: '需重新认证', unconfirmed: '待确认', not_observed: '未打开' };
    $('#connection-status').textContent = `门户：${names[status.services.portal] || '待确认'} · 教室：${names[status.services.classrooms] || '待确认'}${status.connectionMode === 'webvpn' ? ' · WebVPN' : ''}`;
  }
  $('#connection-message').textContent = status.message;
  $('#connect-official').disabled = pending || ['launching', 'awaiting_login', 'authenticated'].includes(status.state);
  $('#refresh-official').disabled = pending || !['awaiting_login', 'authenticated'].includes(status.state);
  $('#disconnect-official').disabled = pending || !['launching', 'awaiting_login', 'authenticated'].includes(status.state);
  $('#open-classrooms').disabled = pending || status.state !== 'authenticated';
  $('#inspect-classrooms').disabled = pending || !['awaiting_login', 'authenticated'].includes(status.state);
  $('#query-classrooms').disabled = pending || status.state !== 'authenticated' || (status.services && status.services.classrooms !== 'authenticated') || !['schema_observed', 'no_results','schedule_observed'].includes(status.classroomStatus);
  $('#classroom-message').textContent = status.classroomObservation?.message || '有本周缓存时无需连接；这里只用于主动更新官方课表。';
  const nextVersion = JSON.stringify(status.classroomObservation || null);
  if (observationVersion !== nextVersion) { observationVersion = nextVersion; window.dispatchEvent(new CustomEvent('qixue:classrooms')); }
  const list = $('#official-resource-links');
  list.replaceChildren();
  for (const resource of status.resourceLinks || []) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    // 这里只显示官方路径，不透出查询字符串、令牌或登录会话。
    link.textContent = resource.label;
    link.href = resource.url;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    item.append(link); list.append(item);
  }
  const active = ['launching', 'awaiting_login', 'authenticated'].includes(status.state);
  if (active && !poll) poll = setInterval(() => updateStatus(), 5000);
  if (!active && poll) { clearInterval(poll); poll = null; }
}

async function updateStatus() {
  if (pending || checking) return;
  checking = true;
  try { renderConnection(await api('/api/connection/status')); }
  catch {
    $('#connection-message').textContent = '本地连接服务暂未响应，正在保留窗口并自动重试；这不等于官方登录已失效。';
    if (!poll) poll = setInterval(() => updateStatus(), 5000);
  }
  finally { checking = false; }
}

async function action(path) {
  if (pending) return;
  pending = true;
  for (const id of ['connect-official', 'refresh-official', 'disconnect-official', 'open-classrooms', 'inspect-classrooms', 'query-classrooms']) $(`#${id}`).disabled = true;
  $('#connection-message').textContent = '正在处理本地连接请求…';
  try {
    // 服务重启后令牌会轮换；每次主动动作获取新令牌，不重放失败的写动作。
    token = (await api('/api/session')).token;
    const status = await api(path, true);
    pending = false; renderConnection(status);
  } catch (error) {
    pending = false;
    $('#connection-message').textContent = error.message;
    $('#connect-official').disabled = ['launching', 'awaiting_login', 'authenticated'].includes(current?.state);
    $('#refresh-official').disabled = !['awaiting_login', 'authenticated'].includes(current?.state);
    $('#disconnect-official').disabled = !['awaiting_login', 'authenticated'].includes(current?.state);
    $('#open-classrooms').disabled = current?.state !== 'authenticated';
    $('#inspect-classrooms').disabled = !['awaiting_login', 'authenticated'].includes(current?.state);
    $('#query-classrooms').disabled = true;
  }
}

const initial = { scenario: 'quiet', date: shanghaiDate(), startTime: chinaNow().time, duration: 60, power: false, timeMode:'clock' };
try {
  const saved = JSON.parse(localStorage.getItem(STORE));
  if (saved) { validateNeeds(saved); Object.assign(initial, saved, { date: shanghaiDate() }); }
} catch { /* 本地偏好损坏不影响使用。 */ }
$('#need-date').value = initial.date;
$('#need-time').value = initial.startTime;
$('#need-duration').value = String(initial.duration);
$('#need-power').checked = initial.power;
$('#need-period-start').value=initial.periodStart?String(initial.periodStart):'';
$('#need-period-end').value=initial.periodEnd?String(initial.periodEnd):'';
$('#travel-buffer').value=String(initial.bufferMinutes??10);
$('#need-time-mode').value=initial.timeMode||'clock';
initializeTimeSelection();
// 场景由原有四个按钮决定；不会缓存账号、密码或 Cookie。
$('#daily-needs').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const scenario = document.querySelector('[data-scenario][aria-pressed="true"]').dataset.scenario;
    syncTimeSelection();
    const needs = validateNeeds({ scenario, date: $('#need-date').value, startTime: $('#need-time').value, duration: Number($('#need-duration').value), power: $('#need-power').checked, timeMode:$('#need-time-mode').value,periodStart:$('#need-period-start').value?Number($('#need-period-start').value):null,periodEnd:$('#need-period-end').value?Number($('#need-period-end').value):null,bufferMinutes:Number($('#travel-buffer').value) });
    try { localStorage.setItem(STORE, JSON.stringify(needs)); } catch {}
    window.dispatchEvent(new CustomEvent('qixue:needs', { detail: needs }));
    $('#needs-message').textContent = needs.timeMode==='clock' ? '已按开始时间和时长自动匹配相交节次；下方显示推荐及未覆盖时间，课间不自动视为空闲。' : '已按手选节次提交；手动模式不使用钟点筛选教室，钟点仅用于日程冲突检查。';
  } catch (error) {
    $('#needs-message').textContent = error.message;
    window.dispatchEvent(new CustomEvent('qixue:needs-invalid',{detail:error.message}));
  }
});
$('#connect-official').addEventListener('click', () => action('/api/connection/start'));
$('#refresh-official').addEventListener('click', () => action('/api/connection/refresh'));
$('#disconnect-official').addEventListener('click', () => action('/api/connection/disconnect'));
$('#open-classrooms').addEventListener('click', () => action('/api/connection/openClassrooms'));
$('#inspect-classrooms').addEventListener('click', () => action('/api/connection/inspectClassrooms'));
$('#query-classrooms').addEventListener('click', () => action('/api/connection/queryClassrooms'));
window.addEventListener('pagehide', () => { if (poll) clearInterval(poll); });
window.addEventListener('pageshow', () => { if (poll) clearInterval(poll); poll = null; updateStatus(); });
window.addEventListener('online', updateStatus);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateStatus(); });
updateStatus();
fetch('/api/runtime', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error('Runtime unavailable');
  return response.json();
}).then(runtime => {
  $('#runtime-message').textContent = runtime.message;
}).catch(() => {
  $('#runtime-message').textContent = '未能检查查询组件。首次查询前可运行 setup-official.cmd；请使用 start.cmd 启动完整项目。';
});
fetch('/data/classroom-reference.json', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error('Reference unavailable'); return response.json();
}).then(reference => {
  $('#reference-message').textContent = `${reference.notice} 页面显示：${reference.observedWeekLabel}，${reference.observedDateRangeText}。`;
  for (const room of reference.rooms) {
    const item = document.createElement('li'); item.textContent = `${room.building} ${room.room} · 待核实`;
    $('#reference-rooms').append(item);
  }
}).catch(() => { $('#reference-message').textContent = '页面参考记录暂不可用，不影响原有功能。'; });
