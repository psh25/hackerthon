const $ = selector => document.querySelector(selector);
const source = $('#discover');
const main = document.querySelector('main');
const stage = document.createElement('section'); stage.id = 'workspace'; stage.className = 'workspace';
stage.innerHTML = `<div class="workspace-intro"><div><span class="eyebrow">QIXUE / 清华学习空间</span><h1>下一站，去哪里学习？</h1><p>先选需求，或在地图上点一栋楼。</p></div><span class="local-pill">本机版 · 官方数据</span></div>
<div class="workspace-tabs" role="tablist" aria-label="工作区">
${[['recommend','✦','找空间'],['map','⌖','校园地图'],['classrooms','▦','教室'],['libraries','▤','图书馆'],['agenda','◷','日程'],['connect','↗','数据连接']].map(([id,icon,label])=>`<button id="tab-${id}" type="button" role="tab" data-view="${id}" aria-controls="view-${id}" aria-selected="${id==='recommend'}" tabindex="${id==='recommend'?'0':'-1'}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</div>
${['recommend','map','classrooms','libraries','agenda','connect'].map(id=>`<div id="view-${id}" class="workspace-view" role="tabpanel" aria-labelledby="tab-${id}" ${id==='recommend'?'':'hidden'}></div>`).join('')}`;
main.insertBefore(stage, main.firstChild);
const move = (selector, view) => { const item = $(selector); if (item) $(`#view-${view}`).append(item); return item; };
move('.scenario-grid', 'recommend');
const needs = move('[aria-labelledby="daily-title"]', 'recommend');
move('#study-recommendations', 'recommend'); move('#library-recommendations', 'recommend');
const welcome = document.createElement('div'); welcome.id = 'recommend-welcome'; welcome.className = 'quick-start';
welcome.innerHTML = '<strong>从一段空闲时间开始。</strong><p>提交需求，查看教室与图书馆推荐。</p><button type="button" data-open-view="map">或去地图点一栋楼 →</button>';
$('#view-recommend').append(welcome);
const verified = document.createElement('details'); verified.className = 'verified-drawer';
verified.innerHTML = '<summary>查看场景设施核实资料</summary>';
for (const selector of ['.results-heading', '.data-strip', '#result-announcement', '#results', 'noscript', '.results-note']) {
  const item = $(selector); if (item) verified.append(item);
}
$('#view-recommend').append(verified);
move('[aria-labelledby="classrooms-title"]', 'classrooms');
const classroomDate = document.createElement('label'); classroomDate.className = 'classroom-date-label';
classroomDate.innerHTML = '查看日期<input id="classroom-date" type="date">';
$('#classroom-period').closest('.daily-form').prepend(classroomDate);
$('#classroom-date').value = $('#need-date').value;
$('#classroom-date').addEventListener('change', () => {
  $('#need-date').value = $('#classroom-date').value;
  $('#need-date').dispatchEvent(new Event('change', { bubbles: true }));
});
$('#need-date').addEventListener('change', () => { $('#classroom-date').value = $('#need-date').value; });
move('#library-panel', 'libraries');
move('[aria-labelledby="agenda-heading"]', 'agenda');
move('.cache-panel', 'connect'); move('[aria-labelledby="connection-title"]', 'connect');
// 完整设施资料保留在按需展开区域，不再挤占首页。
const evidence = document.createElement('details'); evidence.className = 'evidence-drawer';
evidence.innerHTML = '<summary>场景设施核实资料与数据说明</summary>';
for (const item of [...source.children]) if (!item.matches('.section-kicker,.resource-nav')) evidence.append(item);
$('#view-connect').append(evidence);
source.remove(); document.querySelector('.hero')?.remove(); document.querySelector('.principles')?.remove();
document.querySelector('.hero-cta')?.remove();
document.querySelector('.site-footer').innerHTML = '<span>教室看课表 · 图书馆看采集快照</span><span>未知不猜测 · 路线与现场有座不保证</span>';
document.querySelector('header nav').querySelector('a').href = '#recommend';
document.querySelector('.skip-link').href = '#workspace';
document.querySelector('.edition-version').textContent = '/ 08';

// 只保留日期、开始时间、时长三个高频项；高级节次与电源偏好折叠。
const form = $('#daily-needs');
const advanced = document.createElement('details'); advanced.className = 'advanced-controls';
advanced.innerHTML = '<summary>更多条件 · 电源 / 手选节次</summary><div class="daily-form"></div>';
const advancedBody = advanced.querySelector('div');
for (const id of ['need-time-mode','need-period-start','need-period-end','need-power']) advancedBody.append($(`#${id}`).closest('label'));
const submit = form.querySelector('[type="submit"]'); form.insertBefore(advanced, submit);
const explanation = document.createElement('details'); explanation.className = 'compact-explanation'; explanation.innerHTML = '<summary>查看时间匹配与数据边界</summary>';
for (const id of ['clock-note','time-mapping','needs-message']) explanation.append($(`#${id}`));
const periodDetails = needs.querySelector('.period-time-reference'); if (periodDetails) explanation.append(periodDetails);
needs.append(explanation);
$('#daily-title').textContent = '这一段，留给学习';
$('#daily-title').closest('.panel-heading').querySelector('span').textContent = '教室 + 图书馆';

const clock = $('#system-clock'); clock.closest('.clock-bar').classList.add('compact-clock');
const tabButtons = [...document.querySelectorAll('[role="tab"][data-view]')];
const allowedViews = new Set(tabButtons.map(item => item.dataset.view));
let currentView = 'recommend';
function activate(view, { focus = false, updateHash = true } = {}) {
  if (!allowedViews.has(view)) return;
  currentView = view;
  for (const button of tabButtons) {
    const selected = button.dataset.view === view;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    $(`#view-${button.dataset.view}`).hidden = !selected;
    if (selected && focus) button.focus();
  }
  if (updateHash) history.replaceState(null, '', `#${view}`);
  if (view !== 'recommend') stage.scrollIntoView({ block: 'start', behavior: 'instant' });
  window.dispatchEvent(new CustomEvent('qixue:view-changed', { detail: { view } }));
}
for (const button of tabButtons) {
  button.addEventListener('click', () => activate(button.dataset.view));
  button.addEventListener('keydown', event => {
    const index = tabButtons.indexOf(button);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabButtons.length : event.key === 'ArrowLeft' ? (index + tabButtons.length - 1) % tabButtons.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); activate(tabButtons[next].dataset.view, { focus: true }); }
  });
}
document.addEventListener('click', event => {
  const opener = event.target.closest('[data-open-view]');
  if (opener) activate(opener.dataset.openView);
  const link = event.target.closest('a[href^="#"]');
  if (link && allowedViews.has(link.hash.slice(1))) { event.preventDefault(); activate(link.hash.slice(1)); }
  if (link?.hash === '#connection-title') { event.preventDefault(); activate('connect'); $('#connection-title').scrollIntoView({ block: 'nearest' }); }
});
window.addEventListener('qixue:navigate', event => activate(event.detail.view));
window.addEventListener('hashchange', () => activate(location.hash.slice(1), { updateHash: false }));
window.addEventListener('qixue:needs', () => { welcome.hidden = true; activate('recommend'); });
window.addEventListener('qixue:needs-invalid', () => { welcome.hidden = true; activate('recommend'); });
activate(allowedViews.has(location.hash.slice(1)) ? location.hash.slice(1) : currentView, { updateHash: false });
