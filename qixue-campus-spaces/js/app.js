import { SCENARIOS, UNKNOWN, validateDataset, recommend, supportedScenes, factText, isVerifiedFact } from './recommend.js';
import { recommendDaily } from './daily.js';

const $ = selector => document.querySelector(selector);
const state = { dataset: null, scenario: 'quiet', error: false, loading: true, needs: null };
const results = $('#results');
const dialog = $('#detail-dialog');
let dialogTrigger;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sourceLink(source, label = source.title) {
  const link = el('a', 'source-link', `${label} ↗`);
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${label}，打开官方来源（新标签页）`);
  return link;
}

function field(label, value) {
  const row = el('div', 'fact-row');
  row.append(el('dt', '', label), el('dd', value === UNKNOWN ? 'unknown' : '', value));
  return row;
}

function showDialog(title, nodes, trigger) {
  dialogTrigger = trigger || document.activeElement;
  const content = $('#dialog-content');
  const heading = el('h2', '', title);
  heading.id = 'dialog-title';
  content.replaceChildren(heading, ...nodes);
  dialog.showModal();
  $('#close-dialog').focus();
}

function showAbout(event) {
  const paragraphs = [
    state.dataset?.notice || '资料暂不可用，请稍后重试。本页不会使用未经核实的数据补充推荐。',
    '匹配规则：仅当官方资料明确支持所选场景时才推荐。小组讨论、临时学习、供电和安静程度互不推断；未核实不等于没有，也不等于支持。',
    '排序规则：默认按资料完整度排序。应用每日需求后，先按已核实偏好覆盖率排序：主场景权重 2、额外电源偏好权重 1；未知和明确不支持均不计分，并分别注明。百分比不代表有空位或开放概率。',
    '完整场景卡片中的开放时间是常规资料，不等于当前开放。教室实时空位、临时闭馆和插座当前可用性仍待核实；图书馆单独展示官网“今日剩余”及采集时间，不推断现场占用或未来有座。出发前请查看官方通知。',
    '账号密码仅在清华官方窗口输入，作品不接收密码。教室认证仅保留本次内存会话；课表空闲不等于允许自习或实时有座。图书馆无需登录，独立读取官方公开页面的“今日剩余”，60秒共享缓存、120秒后不用于推荐；这是采集时快照，不是到馆有座或全时段保证。两类数据不混合打分，供电、安静、讨论许可与开放时间没有证据时仍待核实。'
  ].map(text => el('p', 'dialog-paragraph', text));
  showDialog('真实信息，清楚边界。', paragraphs, event.currentTarget);
}

function showPlace(result, trigger) {
  const { place, reason, evidence } = result;
  const facts = el('dl', 'detail-facts');
  facts.append(field('位置', factText(place.location, place)), field('官方公布开放时间', factText(place.openingHours, place)), field('进入 / 预约要求', factText(place.access, place)), field('适用场景', supportedScenes(place).map(scene => scene.label).join('、') || UNKNOWN));
  for (const scenario of Object.values(SCENARIOS)) {
    const fact = place.features[scenario.feature];
    facts.append(field(scenario.label, isVerifiedFact(fact, place) ? (fact.value ? '官方资料确认支持' : '官方资料确认不支持') : UNKNOWN));
  }
  facts.append(field('实时空位', UNKNOWN), field('当前开放情况', UNKNOWN), field('电源当前可用性', UNKNOWN));
  const why = el('div', 'detail-reason');
  why.append(el('h3', '', '为什么推荐'), el('p', '', reason), el('small', '', `匹配依据核实于 ${evidence.verifiedAt}`));
  const sourceSection = el('section', 'detail-sources');
  sourceSection.append(el('h3', '', '官方信息来源'));
  for (const source of place.sources) {
    const item = el('div', 'detail-source');
    const labels = ['name', 'location', 'openingHours', 'access'].filter(key => place[key]?.sourceIds?.includes(source.id)).map(key => ({ name: '名称', location: '位置', openingHours: '开放时间', access: '进入要求' })[key]);
    for (const scenario of Object.values(SCENARIOS)) if (place.features[scenario.feature]?.sourceIds?.includes(source.id)) labels.push(scenario.label);
    item.append(sourceLink(source), el('small', '', `${source.publisher} · 依据字段：${labels.join('、') || '补充参考'}`));
    sourceSection.append(item);
  }
  showDialog(factText(place.name, place), [facts, why, sourceSection], trigger);
}

function card(result, index) {
  const { place, reason, evidence } = result;
  const article = el('article', 'place-card');
  const top = el('div', 'card-top');
  top.append(el('span', 'card-index', `SPACE ${String(index + 1).padStart(2, '0')}`), el('span', 'verified-tag', '有官方依据'));
  const heading = el('h3', '', factText(place.name, place));
  const tags = el('div', 'scene-tags');
  for (const scene of supportedScenes(place)) tags.append(el('span', scene.id === state.scenario ? 'tag selected' : 'tag', scene.label));
  const facts = el('dl', 'card-facts');
  facts.append(field('位置', factText(place.location, place)), field('公布开放时间', factText(place.openingHours, place)));
  const why = el('div', 'card-reason');
  why.append(el('span', 'reason-label', '推荐理由'), el('p', '', reason));
  const footer = el('div', 'card-footer');
  const source = place.sources.find(item => evidence.sourceIds.includes(item.id));
  const detail = el('button', 'detail-button', '查看详情 →');
  detail.type = 'button';
  detail.setAttribute('aria-label', `查看${factText(place.name, place)}详情`);
  detail.addEventListener('click', () => showPlace(result, detail));
  footer.append(sourceLink(source, '官方来源'), detail);
  article.append(top, heading, tags, facts, why, el('p', 'card-live-note', '实时空位 / 当前开放情况：待核实'), footer);
  if (result.preferenceMatch !== undefined) {
    const note = el('div', 'preference-summary');
    note.append(el('strong', '', `已核实偏好覆盖 ${result.preferenceMatch}%`), el('small', '', `${result.requestedDate} ${result.requestedStart} · ${result.requestedDuration} 分钟；该时段可用性：待核实`));
    if (result.unknownPreferences.length) note.append(el('small', '', `待核实：${result.unknownPreferences.join('、')}`));
    if (result.unsupportedPreferences.length) note.append(el('small', '', `官方确认不支持：${result.unsupportedPreferences.join('、')}`));
    article.insertBefore(note, facts);
  }
  return article;
}

function emptyState(title, description, mode) {
  const block = el('div', 'empty-state');
  block.dataset.state = mode;
  const illustration = el('div', 'empty-books');
  illustration.setAttribute('aria-hidden', 'true');
  illustration.append(el('i'), el('i'), el('i'));
  block.append(illustration, el('span', 'empty-eyebrow', mode === 'error' ? 'DATA UNAVAILABLE' : 'VERIFIED INFORMATION FIRST'), el('h3', '', title), el('p', '', description));
  const action = el('button', 'text-button', mode === 'error' ? '重新读取资料 ↻' : '了解收录与匹配原则 ↗');
  action.type = 'button';
  action.addEventListener('click', mode === 'error' ? loadData : showAbout);
  block.append(action);
  return block;
}

function render() {
  const scenario = SCENARIOS[state.scenario];
  $('#scene-name').textContent = scenario.label;
  for (const button of document.querySelectorAll('[data-scenario]')) {
    const active = button.dataset.scenario === state.scenario;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  results.setAttribute('aria-busy', String(state.loading));
  if (state.loading) return;
  if (state.error) {
    $('#result-count').textContent = '—';
    $('#dataset-label').textContent = '本地资料读取失败 · 不展示未经核实的信息';
    results.replaceChildren(emptyState('资料暂时没有读到。', '请确认本地服务器已运行。数据缺失或格式不正确时，我们不会用推测填补结果。', 'error'));
    $('#result-announcement').textContent = '资料读取失败，可以重试。';
    return;
  }
  const matches = state.needs ? recommendDaily(state.dataset.places, { ...state.needs, scenario: state.scenario }) : recommend(state.dataset.places, state.scenario);
  $('#sort-label').textContent = state.needs ? '按已核实偏好覆盖率排序 ↓' : '仅推荐已核实匹配项 ↓';
  $('#result-count').textContent = String(matches.length).padStart(2, '0');
  $('#dataset-label').textContent = `已核实场所 ${state.dataset.places.length} · ${state.dataset.campus || '校园待核实'} · ${state.dataset.updatedAt ? `资料更新 ${state.dataset.updatedAt}` : '调查资料待补充'}`;
  if (matches.length) results.replaceChildren(...matches.map(card));
  else if (!state.dataset.places.length) results.replaceChildren(emptyState('完整场景设施仍待核实。', '教室课表条件推荐已在每日需求下方提供。这里仅展示同时核实了安静、讨论、临时进入或供电等场景特征的地点，尚无足够证据时不编造场景推荐。', 'awaiting-data'));
  else results.replaceChildren(emptyState('这个场景，暂时还没有核实的推荐。', `已收录资料暂不能确认哪些场所适合「${scenario.label}」。未核实不等于不支持；你可以切换其他场景。`, 'no-match'));
  $('#result-announcement').textContent = `已切换${scenario.label}，找到 ${matches.length} 个已核实匹配场所。`;
}

async function loadData() {
  state.loading = true;
  state.error = false;
  results.setAttribute('aria-busy', 'true');
  $('#dataset-label').textContent = '正在读取本地资料';
  results.replaceChildren(el('div', 'empty-state', '正在读取本地已核实资料…'));
  try {
    const response = await fetch('/data/places.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.dataset = validateDataset(await response.json());
  } catch (error) {
    state.dataset = null;
    state.error = true;
    console.error('读取场所数据失败：', error.message);
  } finally { state.loading = false; render(); }
}

for (const button of document.querySelectorAll('[data-scenario]')) {
  button.addEventListener('click', () => { state.scenario = button.dataset.scenario; render(); });
}
$('#about-button').addEventListener('click', showAbout);
$('#data-button').addEventListener('click', showAbout);
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')];
  const first = focusable[0], last = focusable.at(-1);
  if (!focusable.length) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
dialog.addEventListener('close', () => dialogTrigger?.focus());
loadData();
window.addEventListener('qixue:needs', event => { state.needs = event.detail; render(); });
