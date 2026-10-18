import { LIBRARY_SOURCE, LIBRARY_REFRESH_MS, libraryPolicy, recommendLibraries, validateLibrarySnapshot } from './library-policy.js';
import { AGENDA_KEY, validateAgenda, studyWindow } from './agenda.js';

const $ = selector => document.querySelector(selector);
const format = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
let observation = null, appliedNeeds = null, loading = false, requestError = false;
const openedDetails = new Set();
function node(tag, text, className) { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; }
function sourceLink(label, url) { const a = node('a', label, 'source-link'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }

function card(row, policy, recommendation) {
  const article = node('article', undefined, 'classroom-card library-card');
  article.append(node('span', policy.usable ? '官网今日剩余 · 采集快照' : '历史数字 · 不用于推荐', 'card-index'), node('h3', row.name));
  const count = node('p', undefined, 'library-count');
  count.append(node('strong', String(row.remaining)), node('span', ` / ${row.total} · 今日剩余 / 总量`));
  article.append(count);
  if (recommendation) article.append(node('p', recommendation.reason, 'recommendation-reason'));
  article.append(node('p', `采集于 ${format(observation.observedAt)}（上海） · 到馆有座待核实`, 'panel-note'));
  const details = node('details', undefined, 'library-detail');
  const detailKey = `${recommendation ? 'recommendation' : 'overview'}:${row.id}`;
  details.open = openedDetails.has(detailKey);
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) openedDetails.add(detailKey); else openedDetails.delete(detailKey);
  });
  details.append(node('summary', '查看详情与数据口径'));
  if (recommendation) details.append(node('p', recommendation.caveats.join('；'), 'panel-note'));
  else details.append(node('p', '开放时间 / 进入要求 / 安静程度 / 讨论许可 / 供电设施：待核实。', 'panel-note'));
  details.append(node('p', '位置：本分馆；具体楼层、路线、开放时间与进入条件待核实。适用场景设施尚未核实，不因“图书馆”名称推断安静或有插座。', 'panel-note'));
  details.append(node('p', '数字直接抄录官网“今日剩余／总量”，不是现场传感器空位数；官网未给出本数字更新时间。未来空位、全时段有座及预约成功均待核实，选座/预约请到官方系统办理。', 'panel-note'));
  details.append(sourceLink('打开官方分馆入口 ↗', row.detailSource));
  article.append(details, sourceLink('官方图书馆来源 ↗', LIBRARY_SOURCE));
  return article;
}

function unchangedNeeds() {
  const scene = document.querySelector('[data-scenario][aria-pressed="true"]')?.dataset.scenario;
  return appliedNeeds.date === $('#need-date').value && appliedNeeds.startTime === $('#need-time').value
    && appliedNeeds.duration === Number($('#need-duration').value) && appliedNeeds.scenario === scene
    && appliedNeeds.power === $('#need-power').checked && appliedNeeds.timeMode === $('#need-time-mode').value
    && appliedNeeds.periodStart === ($('#need-period-start').value ? Number($('#need-period-start').value) : null)
    && appliedNeeds.periodEnd === ($('#need-period-end').value ? Number($('#need-period-end').value) : null);
}

function renderRecommendations() {
  const root = $('#library-study-results'); root.replaceChildren();
  $('#library-study-count').textContent = '0';
  if (!appliedNeeds) return;
  if (!unchangedNeeds()) { $('#library-study-summary').textContent = '学习需求已更改，已撤下此前图书馆推荐；请重新点击“按我的需求推荐”。'; return; }
  try {
    const raw = localStorage.getItem(AGENDA_KEY);
    const plan = studyWindow(raw ? validateAgenda(JSON.parse(raw)) : [], { ...appliedNeeds, bufferMinutes: Number($('#travel-buffer').value) });
    if (!plan.allowed) { $('#library-study-summary').textContent = '所选学习时段与已录入日程冲突（含自设预留），图书馆推荐同样暂停。请调整时间或明确设置本次不参加。'; return; }
  } catch { $('#library-study-summary').textContent = '个人日程或时间读取失败，已暂停图书馆推荐。'; return; }
  if (requestError) { $('#library-study-summary').textContent = '本地图书馆接口请求失败，已撤下推荐；教室数据独立处理。请重试。'; return; }
  const report = recommendLibraries(observation, appliedNeeds);
  $('#library-study-summary').textContent = report.message;
  $('#library-study-count').textContent = String(report.results.length);
  for (const match of report.results) root.append(card(match.library, report.policy, match));
  if (!report.results.length) root.append(node('p', report.message, 'recommendation-empty'));
}

function render() {
  const policy = libraryPolicy(observation);
  const root = $('#library-results'); root.replaceChildren();
  $('#library-status').textContent = requestError ? '图书馆接口暂不可用' : policy.usable ? '图书馆公开座位数据 · 近期快照' : observation?.records?.length ? '图书馆历史快照 · 不用于推荐' : '暂无图书馆座位数据';
  $('#library-message').textContent = `${requestError ? '本地读取失败，保留的数字只能作历史参考。' : policy.message}${observation?.observedAt ? ` 采集于${format(observation.observedAt)}（上海）。` : ''}${observation?.persistenceWarning || ''} 页面可见时每60秒尝试更新；手动刷新最短间隔30秒，不使用教室的一周缓存。`;
  $('#library-refresh').disabled = loading;
  $('#library-refresh').textContent = loading ? '正在刷新图书馆…' : '刷新图书馆';
  const displayPolicy = { ...policy, usable: policy.usable && !requestError };
  for (const row of observation?.records || []) root.append(card(row, displayPolicy));
  if (!observation?.records?.length) root.append(node('p', '尚未取得公开数字。无需登录，点击刷新重试；此处不会用演示数据填充。', 'recommendation-empty'));
  renderRecommendations();
}

async function load(force = false) {
  if (loading) return;
  loading = true; $('#library-refresh').disabled = true; $('#library-refresh').textContent = '正在刷新图书馆…';
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    let options = { cache: 'no-store', signal: controller.signal };
    if (force) {
      const session = await fetch('/api/session', options);
      if (!session.ok) throw new Error('Session unavailable');
      const { token } = await session.json();
      options = { ...options, method: 'POST', headers: { 'X-Qixue-Token': token } };
    }
    const response = await fetch(force ? '/api/libraries/refresh' : '/api/libraries/observation', options);
    if (!response.ok) throw new Error('Library unavailable');
    const result = await response.json();
    if (!Array.isArray(result.records)) throw new Error('Library response invalid');
    // 有记录时由共享校验器核对所有数字/官方链接；错误响应不覆盖历史。
    if (result.records.length) validateLibrarySnapshot(result);
    observation = result; requestError = false;
  } catch { requestError = true; }
  finally { clearTimeout(timer); loading = false; render(); }
}

$('#library-refresh').addEventListener('click', () => load(true));
window.addEventListener('qixue:needs', event => {
  appliedNeeds = event.detail; $('#library-recommendations').hidden = false; renderRecommendations(); load();
});
window.addEventListener('qixue:needs-invalid', event => {
  appliedNeeds = null; $('#library-recommendations').hidden = false; $('#library-study-count').textContent = '0';
  $('#library-study-summary').textContent = event.detail; $('#library-study-results').replaceChildren();
});
window.addEventListener('qixue:agenda-changed', renderRecommendations);
for (const id of ['need-date', 'need-time', 'need-duration', 'need-time-mode', 'need-period-start', 'need-period-end', 'need-power', 'travel-buffer']) {
  $(`#${id}`).addEventListener('change', renderRecommendations);
}
$('#need-time').addEventListener('input', renderRecommendations);
for (const button of document.querySelectorAll('[data-scenario]')) button.addEventListener('click', renderRecommendations);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); load(); } });
setInterval(() => { if (!document.hidden) load(); }, LIBRARY_REFRESH_MS);
setInterval(() => { if (!document.hidden) render(); }, 15000);
load();
