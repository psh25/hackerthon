import { MAP_INFO, BUILDINGS, buildingFor } from './campus.js';

const $ = selector => document.querySelector(selector);
const landmarks = BUILDINGS.filter(item => item.x && item.y);
const view = $('#view-map');
view.innerHTML = `<div class="campus-map-wrap">
  <div class="map-toolbar"><div><h2>在地图上找空间</h2><p>点击楼宇查看教室，拖动滚动条浏览全图。</p></div>
    <div class="map-controls"><label class="sr-only" for="map-building">定位楼宇</label><select id="map-building"><option value="">定位楼宇…</option></select><button type="button" id="map-reset" class="text-button">回到六教</button></div>
  </div>
  <div class="map-layout">
    <div class="campus-map" id="campus-map" role="region" tabindex="0" aria-label="校园地图，可滚动；也可使用上方楼宇选择">
      <div class="campus-map-canvas"><img src="${MAP_INFO.image}" alt="用户提供的清华校园地图，楼宇示意标记可点击" width="${MAP_INFO.width}" height="${MAP_INFO.height}"><div id="map-pins"></div></div>
    </div>
    <aside id="map-detail" class="map-detail" aria-live="polite"><h3>选择一个楼宇</h3><p>点击地图标记或使用上方列表。</p></aside>
  </div>
  <div class="map-bottom"><span class="map-legend"><i></i>教学楼示意 <i class="library-dot"></i>图书馆</span><label>缩放 <input id="map-zoom" type="range" min="1" max="3" step="0.5" value="1" aria-label="地图缩放"></label><output id="map-zoom-value">1×</output></div>
  <details class="map-notes"><summary>地图来源与未定位楼宇</summary><p>${MAP_INFO.source} · ${MAP_INFO.note}</p><p id="map-unlocated"></p></details>
</div>`;

const canvas = $('#campus-map');
const imageCanvas = $('.campus-map-canvas');
const pins = $('#map-pins');
const detail = $('#map-detail');
const selector = $('#map-building');
let selectedId = null, initialized = false;
const baseWidth = () => Math.max(canvas.clientWidth, 900);
const roomsFor = id => (window.qixueCampusRooms?.records || []).filter(room => buildingFor(room).id === id);
const button = (text, action) => {
  const item = document.createElement('button'); item.type = 'button'; item.className = 'panel-button'; item.textContent = text;
  item.addEventListener('click', action); return item;
};

function showDetail(building) {
  selectedId = building.id; selector.value = building.id; detail.replaceChildren();
  const rooms = roomsFor(building.id);
  const heading = document.createElement('h3'); heading.textContent = building.name;
  const caption = document.createElement('p'); caption.className = 'map-evidence'; caption.textContent = `${building.mapEvidence} · 示意位置`;
  detail.append(heading, caption);
  if (rooms.length) {
    const total = document.createElement('p'); total.textContent = `${rooms.length} 间已采集教室`; total.className = 'map-room-count'; detail.append(total);
    const preview = document.createElement('ul');
    for (const room of rooms.slice(0, 4)) { const row = document.createElement('li'); row.textContent = room.name; preview.append(row); }
    detail.append(preview, button('查看本楼教室 →', () => {
      window.dispatchEvent(new CustomEvent('qixue:navigate', { detail: { view: 'classrooms' } }));
      window.dispatchEvent(new CustomEvent('qixue:select-building', { detail: { id: building.id } }));
    }));
  } else if (!building.libraryId) {
    const note = document.createElement('p'); note.textContent = '暂无本周可用教室数据，请在“数据连接”中采集。';
    detail.append(note, button('前往数据连接 →', () => window.dispatchEvent(new CustomEvent('qixue:navigate', { detail: { view: 'connect' } }))));
  }
  if (building.libraryId) {
    detail.append(button('查看图书馆座位 →', () => window.dispatchEvent(new CustomEvent('qixue:navigate', { detail: { view: 'libraries' } }))));
  }
  const note = document.createElement('p'); note.className = 'map-caveat'; note.textContent = '具体楼层、入口、开放情况和现场座位待核实。'; detail.append(note);
  for (const pin of pins.children) pin.classList.toggle('is-selected', pin.dataset.building === building.id);
}

function focusBuilding(id) {
  const building = landmarks.find(item => item.id === id); if (!building) return;
  showDetail(building);
  // 仅滚动地图内部，避免页面跟着远处的标记跳动。
  const scale = imageCanvas.clientWidth / MAP_INFO.width;
  canvas.scrollTo({ left: building.x * scale - canvas.clientWidth / 2, top: building.y * scale - canvas.clientHeight / 2, behavior: 'instant' });
}

for (const building of landmarks) {
  const option = document.createElement('option'); option.value = building.id; option.textContent = building.name; selector.append(option);
  const pin = document.createElement('button'); pin.type = 'button'; pin.dataset.building = building.id;
  pin.className = `map-pin${building.libraryId ? ' is-library' : ''}`;
  pin.style.left = `${building.x / MAP_INFO.width * 100}%`; pin.style.top = `${building.y / MAP_INFO.height * 100}%`;
  pin.setAttribute('aria-label', `打开${building.name}`);
  const dot = document.createElement('span'); dot.textContent = building.libraryId ? '▤' : '●';
  const label = document.createElement('small'); label.textContent = building.mapLabel || building.name;
  pin.append(dot, label); pin.addEventListener('click', () => showDetail(building)); pins.append(pin);
}
function updateData() {
  if (selectedId) showDetail(landmarks.find(item => item.id === selectedId));
  const missing = [...new Set((window.qixueCampusRooms?.records || []).map(buildingFor).filter(item => !item.x).map(item => item.name))];
  $('#map-unlocated').textContent = missing.length ? `地图位置待核实：${missing.join('、')}。仍可在“教室”标签按楼宇查看。` : '只有能从提供地图中辨认的位置才标注；其余楼宇不猜测坐标。';
}
function resizeMap() {
  imageCanvas.style.width = `${baseWidth() * Number($('#map-zoom').value)}px`;
  if (selectedId && !view.hidden) focusBuilding(selectedId);
}
selector.addEventListener('change', () => focusBuilding(selector.value));
$('#map-reset').addEventListener('click', () => focusBuilding('jiaoxue-6'));
$('#map-zoom').addEventListener('input', () => { $('#map-zoom-value').value = `${$('#map-zoom').value}×`; resizeMap(); });
window.addEventListener('resize', resizeMap);
window.addEventListener('qixue:rooms-loaded', updateData);
window.addEventListener('qixue:focus-map', event => focusBuilding(event.detail.id));
window.addEventListener('qixue:view-changed', event => {
  if (event.detail.view !== 'map') return;
  resizeMap(); if (!initialized) { initialized = true; focusBuilding('jiaoxue-6'); }
});
updateData();
if (!view.hidden) { resizeMap(); initialized = true; focusBuilding('jiaoxue-6'); }
