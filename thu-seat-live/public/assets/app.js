/* ==========================================================================
   清华图书馆 · 座位实时看板  —  前端逻辑
   ========================================================================== */

const API = {
  dashboard: '/api/dashboard',
  status: '/api/status',
  refresh: '/api/refresh',
};

const POLL_FALLBACK_MS = 30000; // 后端默认轮询间隔
const STALE_AFTER_MS = 90000; // 超过此时长未更新视为「数据陈旧」
const TICK_MS = 1000;

const els = {};
const state = {
  data: null, // 最近一次 /api/dashboard 结果
  lastFetchedAt: null, // 快照时间戳（用于去重 & 倒计时）
  pollMs: POLL_FALLBACK_MS,
  nextPollAt: 0,
  autoRefresh: true,
  selectedLibId: null,
  trendMode: 'all',
  loading: false,
  refreshing: false,
  skeletonDone: false,
};

/* --------------------------------------------------------------------------
   工具
   -------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const pct = (r) => Math.round(clamp(r, 0, 1) * 100);

const nf = new Intl.NumberFormat('zh-CN');

function fmt(n) {
  return n === null || n === undefined || Number.isNaN(n) ? '—' : nf.format(n);
}

function fmtTime(ts, withSeconds = true) {
  if (!ts) return '—';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (!withSeconds) return `${hh}:${mm}`;
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wd}`;
}

/** 按占用率取色：绿 → 黄 → 橙 → 红 */
function rateColor(rate, { light = 1 } = {}) {
  const r = clamp(rate, 0, 1);
  const hue = 148 - r * 144; // 148 → 4
  const sat = 58 + r * 18;
  const lig = (34 + r * 6) * light;
  return `hsl(${hue.toFixed(1)} ${sat.toFixed(0)}% ${lig.toFixed(1)}%)`;
}

function heatGradient(rate) {
  const r = clamp(rate, 0, 1);
  const hue = 148 - r * 144;
  return `linear-gradient(145deg, hsl(${hue.toFixed(0)} ${(62 + r * 14).toFixed(0)}% ${(30 + r * 5).toFixed(0)}%), hsl(${hue.toFixed(0)} ${(70 + r * 12).toFixed(0)}% ${(22 + r * 6).toFixed(0)}%))`;
}

function statusBadge(lib) {
  if (lib.available === 0) return '<span class="lib-badge">满座</span>';
  if (lib.rate >= 0.9) return '<span class="lib-badge">紧张</span>';
  return '';
}

function toast(msg, isError = false) {
  const el = els.toast;
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* --------------------------------------------------------------------------
   顶栏 / 时钟 / 倒计时
   -------------------------------------------------------------------------- */

function tickClock() {
  const now = new Date();
  els.clockTime.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  els.clockDate.textContent = fmtDate(now.getTime());
}

function tickCountdown() {
  if (!state.data) return;
  const pollMs = state.pollMs;
  const remainMs = Math.max(0, state.nextPollAt - Date.now());
  const remain = Math.ceil(remainMs / 1000);
  const circumference = 97.4;
  const ratio = clamp(remainMs / pollMs, 0, 1);
  els.cdRing.style.strokeDashoffset = String(circumference * (1 - ratio));
  els.cdText.textContent = state.autoRefresh ? (remain <= 0 ? '…' : `${remain}s`) : '暂停';
  els.cdRing.style.stroke = state.autoRefresh ? '#e2414f' : '#4b5464';
}

function setLiveState(kind, text) {
  els.liveChip.dataset.state = kind;
  els.liveText.textContent = text;
}

/* --------------------------------------------------------------------------
   取数
   -------------------------------------------------------------------------- */

async function fetchDashboard({ silent = false } = {}) {
  try {
    const res = await fetch(API.dashboard, { cache: 'no-store' });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      // 首次采集尚未完成
      if (!silent) setLiveState('loading', json.error || '数据准备中…');
      return;
    }

    state.data = json;
    state.pollMs = json.pollMs || POLL_FALLBACK_MS;
    state.nextPollAt = Date.now() + state.pollMs;
    els.pollLabel.textContent = Math.round(state.pollMs / 1000);

    if (state.lastFetchedAt !== json.fetchedAt) {
      state.lastFetchedAt = json.fetchedAt;
      render();
      if (state.loading) {
        state.loading = false;
        els.layout.setAttribute('aria-busy', 'false');
      }
    }
    updateLiveBadge();
  } catch (err) {
    setLiveState('error', '本地服务未连接');
    if (!silent) toast(`无法连接后端服务：${err.message}`, true);
  }
}

function updateLiveBadge() {
  const d = state.data;
  if (!d) return;
  const age = Date.now() - d.fetchedAt;
  if (d.lastError && d.stale) {
    setLiveState('error', `采集失败 · 数据 ${fmtTime(d.fetchedAt)}`);
  } else if (d.stale || age > STALE_AFTER_MS) {
    setLiveState('stale', `数据 ${Math.round(age / 1000)} 秒前`);
  } else {
    setLiveState('live', `实时 · ${fmtTime(d.fetchedAt)}`);
  }
}

async function manualRefresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  els.refreshBtn.classList.add('spinning');
  document.getElementById('refreshBtn')?.classList.add('spinning');
  try {
    await fetch(API.refresh, { method: 'POST' });
    const before = state.lastFetchedAt;
    // 轮询等待后端完成一次采集（最多 25 秒）
    for (let i = 0; i < 50; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const st = await fetch(API.status, { cache: 'no-store' }).then((r) => r.json());
      if (!st.polling) break;
    }
    await fetchDashboard({ silent: true });
    if (state.lastFetchedAt !== before) toast('已更新至最新数据');
    else toast('数据暂未变化');
  } catch (err) {
    toast(`刷新失败：${err.message}`, true);
  } finally {
    state.refreshing = false;
    els.refreshBtn.classList.remove('spinning');
  }
}

/* --------------------------------------------------------------------------
   渲染：Hero
   -------------------------------------------------------------------------- */

const RING_CIRCUMFERENCE = 515.2;

function renderHero() {
  const s = state.data.summary;

  // 环：显示空座占比（空座越多，环越满）
  const freeRatio = s.total > 0 ? s.available / s.total : 0;
  els.ringArc.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - freeRatio));
  els.ringArc.style.stroke = rateColor(s.rate, { light: 1 });

  els.heroPct.textContent = `${s.ratePct}%`;
  els.heroPct.style.background = `linear-gradient(180deg, #fff 8%, ${rateColor(s.rate, { light: 1.5 })})`;
  els.heroPct.style.webkitBackgroundClip = 'text';
  els.heroPct.style.backgroundClip = 'text';

  els.heroAvailable.textContent = fmt(s.available);
  els.heroOccupied.textContent = fmt(s.occupied);
  els.heroTotal.textContent = fmt(s.total);

  // 近 1 小时在座变化
  const hist = state.data.history || [];
  const cur = hist[hist.length - 1];
  const oneHourAgo = (state.data.fetchedAt || Date.now()) - 3600_000;
  const ref = hist.find((h) => h.t >= oneHourAgo) || hist[0];
  const deltaEl = els.heroOccupiedDelta;
  if (cur && ref && ref !== cur && cur.t - ref.t > 120_000) {
    const diff = cur.occupied - ref.occupied;
    if (diff === 0) {
      deltaEl.textContent = '持平';
      deltaEl.className = 'delta';
    } else {
      deltaEl.textContent = `${diff > 0 ? '+' : ''}${diff}`;
      deltaEl.className = `delta ${diff > 0 ? 'up' : 'down'}`;
      deltaEl.title = `相较 ${fmtTime(ref.t, false)}（1 小时前）的变化`;
    }
  } else {
    deltaEl.textContent = '';
    deltaEl.title = '';
  }

  // 座位拥挤度分布（按楼层分级统计座位数）
  let green = 0;
  let amber = 0;
  let red = 0;
  for (const lib of state.data.libraries) {
    for (const f of lib.floors) {
      const { available, total, rate } = f;
      if (!total) continue;
      if (rate < 0.5) green += available;
      else if (rate < 0.8) amber += available;
      else red += available;
    }
  }
  const sum = green + amber + red || 1;
  els.distBar.innerHTML =
    `<i class="free" style="width:${(green / sum) * 100}%"></i>` +
    `<i class="mid" style="width:${(amber / sum) * 100}%"></i>` +
    `<i class="full" style="width:${(red / sum) * 100}%"></i>`;
  els.distFree.textContent = fmt(green);
  els.distMid.textContent = fmt(amber);
  els.distFull.textContent = fmt(red);

  renderSpark();
}

function renderSpark() {
  const hist = state.data.history || [];
  const svg = els.sparkSvg;
  const W = 260;
  const H = 56;
  svg.innerHTML = '';

  if (hist.length < 2) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" fill="#646e7f" font-size="10" font-family="var(--mono)">数据积累中…</text>`;
    els.sparkNow.textContent = `${state.data.summary.ratePct}%`;
    els.sparkFrom.textContent = fmtTime(hist[0]?.t, false) || '—';
    els.sparkTo.textContent = fmtTime(state.data.fetchedAt, false);
    return;
  }

  const pts = hist.map((h) => ({ t: h.t, v: h.rate }));
  const xs = pts.map((p) => p.t);
  const minT = Math.min(...xs);
  const maxT = Math.max(...xs);
  const span = Math.max(1, maxT - minT);
  const yOf = (v) => H - 6 - clamp(v, 0, 1) * (H - 12);
  const xOf = (t) => ((t - minT) / span) * W;

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];
  const color = rateColor(last.v);

  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#sparkFill)"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${xOf(last.t).toFixed(1)}" cy="${yOf(last.v).toFixed(1)}" r="2.8" fill="${color}" stroke="#0e121a" stroke-width="1.4"/>
  `;

  els.sparkNow.textContent = `${Math.round(last.v * 100)}%`;
  els.sparkNow.style.color = color;
  els.sparkFrom.textContent = fmtTime(minT, false);
  els.sparkTo.textContent = fmtTime(maxT, false);
}

/* --------------------------------------------------------------------------
   渲染：分馆列表
   -------------------------------------------------------------------------- */

function renderLibraries() {
  const libs = state.data.libraries;
  const host = els.libList;

  // 首次渲染时清掉骨架屏
  if (!state.skeletonDone) {
    host.querySelector('.skeleton-list')?.remove();
    state.skeletonDone = true;
  }

  // 若已存在行则就地更新，避免闪烁
  if (host.querySelectorAll('.lib-row').length === libs.length) {
    updateLibraryRows(libs);
    return;
  }

  host.innerHTML = libs
    .map((lib, i) => {
      const p = pct(lib.rate);
      return `
      <div class="lib-row" data-lib="${lib.id}" role="button" tabindex="0" aria-label="${lib.name}">
        <div class="lib-rank">${i + 1}</div>
        <div class="lib-main">
          <div class="lib-name">${lib.name}${statusBadge(lib)}</div>
          <div class="lib-en">${lib.enname || ''}</div>
        </div>
        <div class="lib-track"><div class="lib-fill" style="width:${p}%;background:${rateColor(lib.rate)}"></div></div>
        <div class="lib-count"><b>${fmt(lib.available)}</b><small>/${lib.total}</small></div>
        <div class="lib-pct" style="color:${rateColor(lib.rate, { light: 1.45 })}">${p}%</div>
      </div>`;
    })
    .join('');

  host.querySelectorAll('.lib-row').forEach((row) => {
    const id = Number(row.dataset.lib);
    row.addEventListener('click', () => selectLibrary(id === state.selectedLibId ? null : id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectLibrary(id === state.selectedLibId ? null : id);
      }
    });
  });

  if (state.selectedLibId) highlightRows();
}

function updateLibraryRows(libs) {
  const rows = els.libList.querySelectorAll('.lib-row');
  rows.forEach((row, i) => {
    const lib = libs[i];
    if (!lib) return;
    const p = pct(lib.rate);
    row.dataset.lib = lib.id;
    row.querySelector('.lib-name').innerHTML = `${lib.name}${statusBadge(lib)}`;
    row.querySelector('.lib-fill').style.width = `${p}%`;
    row.querySelector('.lib-fill').style.background = rateColor(lib.rate);
    row.querySelector('.lib-count').innerHTML = `<b>${fmt(lib.available)}</b><small>/${lib.total}</small>`;
    const pctEl = row.querySelector('.lib-pct');
    pctEl.textContent = `${p}%`;
    pctEl.style.color = rateColor(lib.rate, { light: 1.45 });
  });
  if (state.selectedLibId) renderDetail(state.selectedLibId, { keepScroll: true });
}

function highlightRows() {
  els.libList.querySelectorAll('.lib-row').forEach((r) => {
    r.classList.toggle('active', Number(r.dataset.lib) === state.selectedLibId);
  });
}

function selectLibrary(id) {
  state.selectedLibId = id;
  highlightRows();
  if (id === null) {
    els.detailPanel.hidden = true;
    els.libHint.textContent = '点击卡片查看楼层与阅览区';
    return;
  }
  els.detailPanel.hidden = false;
  els.libHint.textContent = '点击卡片切换分馆';
  renderDetail(id);
  els.detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetail(libId, { keepScroll = false } = {}) {
  const lib = state.data.libraries.find((l) => l.id === libId);
  if (!lib) return;
  const prevScroll = keepScroll ? els.panelBody.scrollTop : 0;

  els.panelTitle.textContent = lib.name;
  els.panelStats.innerHTML =
    `<span>楼层 <b>${lib.floorCount}</b></span>` +
    `<span>总座位 <b>${fmt(lib.total)}</b></span>` +
    `<span>空座 <b>${fmt(lib.available)}</b></span>` +
    `<span>在座率 <b>${pct(lib.rate)}%</b></span>`;

  els.panelBody.innerHTML = lib.floors
    .map((f) => {
      const areas = [...f.areas].sort((a, b) => b.rate - a.rate || b.total - a.total);
      const areaRows = areas
        .map(
          (a) => `
        <div class="area-row" title="${a.enname || a.name}｜总 ${a.total}·空 ${a.available}">
          <div class="area-name">${a.name}</div>
          <div class="area-bar"><i style="width:${pct(a.rate)}%;background:${rateColor(a.rate)}"></i></div>
          <div class="area-num"><b>${fmt(a.available)}</b> / ${a.total}</div>
        </div>`,
        )
        .join('');
      return `
      <div class="floor-block">
        <div class="floor-head">
          <div class="floor-name">${f.name}${f.available === 0 ? ' <span class="lib-badge">满</span>' : ''}</div>
          <div class="floor-meta"><b>${pct(f.rate)}%</b> · 空 ${fmt(f.available)}</div>
          <div class="area-bar"><i style="width:${pct(f.rate)}%;background:${rateColor(f.rate)}"></i></div>
        </div>
        <div class="area-list">${areaRows}</div>
      </div>`;
    })
    .join('');

  els.panelBody.scrollTop = prevScroll;
}

/* --------------------------------------------------------------------------
   渲染：分馆对比
   -------------------------------------------------------------------------- */

function renderCompare() {
  const libs = state.data.libraries;
  const maxTotal = Math.max(...libs.map((l) => l.total), 1);
  els.cmpHint.textContent = `最高 ${pct(Math.max(...libs.map((l) => l.rate)))}% · 最低 ${pct(
    Math.min(...libs.map((l) => l.rate)),
  )}%`;

  els.cmpChart.innerHTML = libs
    .map((lib) => {
      const p = pct(lib.rate);
      const color = rateColor(lib.rate);
      return `
      <div class="cmp-row" title="${lib.name}｜在座 ${lib.occupied} / 总 ${lib.total}">
        <div class="cmp-label">${lib.name}</div>
        <div class="cmp-track"><div class="cmp-fill" style="width:${p}%;background:linear-gradient(90deg, ${color}cc, ${color})"><i></i></div></div>
        <div class="cmp-val" style="color:${rateColor(lib.rate, { light: 1.45 })}">${p}%</div>
      </div>`;
    })
    .join('');
}

/* --------------------------------------------------------------------------
   渲染：热力图
   -------------------------------------------------------------------------- */

function renderHeatmap() {
  const libs = state.data.libraries;
  const s = state.data.summary;

  els.heatPct.textContent = `${s.ratePct}%`;
  els.heatPct.style.color = rateColor(s.rate, { light: 1.5 });
  els.heatAvail.textContent = `空 ${fmt(s.available)} / 总 ${fmt(s.total)}`;
  const fill = els.heatFill;
  fill.style.width = `${s.ratePct}%`;
  fill.style.background = `linear-gradient(90deg, #2bd39c, ${rateColor(s.rate)})`;

  // 计算最大楼层数，用来决定是否折行
  const maxFloors = Math.max(...libs.map((l) => l.floors.length));
  els.heat.innerHTML = libs
    .map((lib) => {
      const cells = lib.floors
        .map((f) => {
          const p = pct(f.rate);
          const cls = f.total === 0 ? 'na' : f.available === 0 ? 'full' : '';
          const style = f.total === 0 ? '' : `background:${heatGradient(f.rate)}`;
          return `<div class="heat-cell ${cls}" style="${style}"
                    title="${lib.name} · ${f.name}｜在座 ${f.occupied} / 总 ${f.total}（空 ${f.available}）">
                    ${f.total === 0 ? '—' : p + '%'}<small>${f.total === 0 ? '暂无' : '空' + f.available}</small></div>`;
        })
        .join('');
      const pad = maxFloors - lib.floors.length;
      const filler = pad > 0 ? '<div class="heat-cell na" style="background:transparent;border-color:transparent"></div>'.repeat(pad) : '';
      return `
      <div class="heat-row">
        <div class="heat-label">${lib.name}<small>${lib.floorCount} 层 · ${fmt(lib.total)} 座</small></div>
        ${cells}${filler}
      </div>`;
    })
    .join('');
}

/* --------------------------------------------------------------------------
   渲染：趋势图
   -------------------------------------------------------------------------- */

function renderTrendTabs() {
  const tabs = [{ key: 'all', label: '全馆' }].concat(
    state.data.libraries.map((l) => ({ key: String(l.id), label: l.name.replace(/\(.*?\)/g, '') })),
  );
  if (!tabs.some((t) => t.key === state.trendMode)) state.trendMode = 'all';
  els.trendTabs.innerHTML = tabs
    .map(
      (t) =>
        `<button class="trend-tab ${t.key === state.trendMode ? 'active' : ''}" data-mode="${t.key}">${t.label}</button>`,
    )
    .join('');
  els.trendTabs.querySelectorAll('.trend-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.trendMode = btn.dataset.mode;
      renderTrendTabs();
      renderTrend();
    });
  });
}

function trendSeries() {
  const hist = state.data.history || [];
  if (state.trendMode === 'all') {
    return {
      name: '全馆在座率',
      points: hist.map((h) => ({ t: h.t, v: h.rate, occupied: h.occupied, total: h.total })),
    };
  }
  const id = Number(state.trendMode);
  const lib = state.data.libraries.find((l) => l.id === id);
  const points = hist
    .filter((h) => h.libs && typeof h.libs[id] === 'number')
    .map((h) => ({ t: h.t, v: h.libs[id], occupied: Math.round(h.libs[id] * (lib?.total || 0)), total: lib?.total }));
  return { name: lib ? lib.name : '在座率', points };
}

function renderTrend() {
  const svg = els.trendSvg;
  const W = 640;
  const H = 240;
  const PAD = { top: 14, right: 12, bottom: 26, left: 38 };
  svg.innerHTML = '';

  const { name, points } = trendSeries();
  const now = Date.now();
  const windowMs = 6 * 3600 * 1000;
  const winStart = now - windowMs;

  // 坐标轴
  const yOf = (v) => PAD.top + (1 - clamp(v, 0, 1)) * (H - PAD.top - PAD.bottom);
  const xOf = (t) => PAD.left + ((t - winStart) / windowMs) * (W - PAD.left - PAD.right);

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((v) => {
      const y = yOf(v);
      return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
              <text x="${PAD.left - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="#646e7f" font-size="9.5" font-family="ui-monospace, monospace">${Math.round(v * 100)}%</text>`;
    })
    .join('');

  // x 轴时间刻度（每 1 小时）
  let xTicks = '';
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  for (let i = 0; i <= 6; i += 1) {
    const t = hourStart.getTime() - i * 3600 * 1000;
    if (t < winStart) break;
    const x = xOf(t);
    const hh = String(new Date(t).getHours()).padStart(2, '0');
    xTicks += `<line x1="${x.toFixed(1)}" y1="${H - PAD.bottom}" x2="${x.toFixed(1)}" y2="${H - PAD.bottom + 4}" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
               <text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#646e7f" font-size="9.5" font-family="ui-monospace, monospace">${hh}:00</text>`;
  }

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const base = `<g>${gridLines}${xTicks}</g>`;

  if (points.length < 2) {
    svg.innerHTML =
      base +
      `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#98a3b4" font-size="12">正在积累数据，趋势图稍后生成</text>`;
    els.trendFoot.innerHTML = `<span>当前 <b>${state.data.summary.ratePct}%</b></span><span class="card-hint">后端每 ${Math.round(
      state.pollMs / 1000,
    )} 秒采样一次，约 1 分钟后可形成曲线</span>`;
    return;
  }

  const inWin = points.filter((p) => p.t >= winStart - 60000);
  const pts = inWin.length >= 2 ? inWin : points.slice(-2);
  const last = pts[pts.length - 1];
  const color = rateColor(last.v);
  const gid = `grad-${Math.random().toString(36).slice(2, 8)}`;

  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${xOf(last.t).toFixed(1)},${H - PAD.bottom} L${xOf(pts[0].t).toFixed(1)},${H - PAD.bottom} Z`;

  svg.innerHTML =
    base +
    `<defs>
       <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0%" stop-color="${color}" stop-opacity="0.36"/>
         <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
       </linearGradient>
     </defs>
     <path d="${areaPath}" fill="url(#${gid})"/>
     <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
     <line id="hoverLine" x1="0" y1="${PAD.top}" x2="0" y2="${H - PAD.bottom}" stroke="rgba(255,255,255,0.28)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
     <circle id="hoverDot" r="4.5" fill="${color}" stroke="#0e121a" stroke-width="2" opacity="0"/>
     <circle cx="${xOf(last.t).toFixed(1)}" cy="${yOf(last.v).toFixed(1)}" r="3.6" fill="${color}" stroke="#0e121a" stroke-width="1.6"/>

     <rect id="hitArea" x="${PAD.left}" y="${PAD.top}" width="${W - PAD.left - PAD.right}" height="${
       H - PAD.top - PAD.bottom
     }" fill="transparent" style="cursor:crosshair"/>`;

  // 悬停交互
  const hit = $('hitArea');
  const hoverLine = $('hoverLine');
  const hoverDot = $('hoverDot');
  const tip = els.chartTip;
  const toSvgX = (clientX) => {
    const rect = svg.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  };
  hit.addEventListener('pointermove', (e) => {
    const x = toSvgX(e.clientX);
    // 找最近的点
    let best = pts[0];
    let bestD = Infinity;
    for (const p of pts) {
      const d = Math.abs(xOf(p.t) - x);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const px = xOf(best.t);
    const py = yOf(best.v);
    hoverLine.setAttribute('x1', px);
    hoverLine.setAttribute('x2', px);
    hoverLine.setAttribute('opacity', '1');
    hoverDot.setAttribute('cx', px);
    hoverDot.setAttribute('cy', py);
    hoverDot.setAttribute('opacity', '1');

    const rect = svg.getBoundingClientRect();
    const left = (px / W) * rect.width;
    tip.hidden = false;
    tip.innerHTML = `<b>${Math.round(best.v * 100)}%</b> <span class="muted">${fmtTime(best.t, false)}</span><br><span class="muted">${
      best.occupied !== undefined && best.total ? `在座 ${fmt(best.occupied)} / ${fmt(best.total)}` : ''
    }</span>`;
    tip.style.left = `${clamp(left, 70, rect.width - 70)}px`;
    tip.style.top = `${(py / H) * rect.height}px`;
  });
  hit.addEventListener('pointerleave', () => {
    hoverLine.setAttribute('opacity', '0');
    hoverDot.setAttribute('opacity', '0');
    tip.hidden = true;
  });

  // 底部统计
  const values = pts.map((p) => p.v);
  const maxV = Math.max(...values);
  const minV = Math.min(...values);
  const avgV = values.reduce((a, b) => a + b, 0) / values.length;
  const first = pts[0];
  const change = (last.v - first.v) * 100;
  els.trendFoot.innerHTML = `
    <span>${name}</span>
    <span>当前 <b>${Math.round(last.v * 100)}%</b></span>
    <span>区间峰值 <b>${Math.round(maxV * 100)}%</b></span>
    <span>均值 <b>${Math.round(avgV * 100)}%</b></span>
    <span>较 ${fmtTime(first.t, false)} <b style="color:${change > 0 ? '#f2604f' : change < 0 ? '#2bd39c' : '#98a3b4'}">${
      change > 0 ? '+' : ''
    }${change.toFixed(1)} pt</b></span>
    <span>样本 <b>${pts.length}</b></span>`;
}

/* --------------------------------------------------------------------------
   渲染：运行状态
   -------------------------------------------------------------------------- */

function renderStatus() {
  const d = state.data;
  const ok = !d.lastError;
  const items = [
    { k: '数据更新', v: fmtTime(d.fetchedAt), cls: ok ? 'ok' : 'warn' },
    {
      k: '快照延迟',
      v: `${Math.max(0, Math.round((Date.now() - d.fetchedAt) / 1000))}`,
      unit: '秒前',
      cls: Date.now() - d.fetchedAt > 90000 ? 'warn' : '',
    },
    { k: '采集耗时', v: `${d.elapsedMs ?? '—'}`, unit: 'ms', cls: d.elapsedMs > 5000 ? 'warn' : '' },
    { k: '轮询间隔', v: `${Math.round(state.pollMs / 1000)}`, unit: '秒', cls: '' },
    { k: '区域节点', v: fmt(d.nodeCount), unit: '个', cls: '' },
    { k: '历史样本', v: fmt((d.history || []).length), unit: '条', cls: '' },
    {
      k: '上游状态',
      v: d.lastError ? '异常' : d.stale ? '陈旧' : '正常',
      cls: d.lastError ? 'bad' : d.stale ? 'warn' : 'ok',
    },
  ];
  els.statusGrid.innerHTML = items
    .map(
      (it) =>
        `<div class="stat-box ${it.cls}"><div class="k">${it.k}</div><div class="v">${it.v}${
          it.unit ? `<small>${it.unit}</small>` : ''
        }</div></div>`,
    )
    .join('');

  els.statusHint.textContent = d.lastError ? `最近错误：${d.lastError.message}` : `已稳定采集 ${d.summary.libraryCount} 个分馆`;
}

/* --------------------------------------------------------------------------
   总渲染
   -------------------------------------------------------------------------- */

function render() {
  renderHero();
  renderLibraries();
  renderCompare();
  renderHeatmap();
  renderTrendTabs();
  renderTrend();
  renderStatus();
  tickCountdown();
}

/* --------------------------------------------------------------------------
   生命周期
   -------------------------------------------------------------------------- */

function cacheEls() {
  const ids = [
    'layout', 'liveChip', 'liveText', 'clockTime', 'clockDate', 'pollLabel', 'cdRing', 'cdText',
    'refreshBtn', 'autoToggle', 'heroPct', 'ringArc', 'heroAvailable', 'heroOccupied', 'heroTotal',
    'heroOccupiedDelta', 'distBar', 'distFree', 'distMid', 'distFull', 'sparkSvg', 'sparkNow',
    'sparkFrom', 'sparkTo', 'libList', 'libSkeleton', 'libHint', 'detailPanel', 'panelTitle', 'panelStats',
    'panelBody', 'panelClose', 'cmpChart', 'cmpHint', 'heatPct', 'heatAvail', 'heatFill', 'heat',
    'trendTabs', 'trendSvg', 'chartTip', 'trendFoot', 'trendHint', 'statusGrid', 'statusHint', 'toast',
  ];
  for (const id of ids) els[id] = $(id);
}

function buildSkeleton() {
  els.libSkeleton.innerHTML = Array.from({ length: 6 }, () => '<div class="sk-row"></div>').join('');
}

function init() {
  cacheEls();
  buildSkeleton();
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(tickCountdown, 250);

  // 前端主动定时拉取：只在后端快照已过期时才取，且后端读缓存，开销极小
  setInterval(() => {
    if (!state.autoRefresh) return;
    const stale = !state.lastFetchedAt || Date.now() - state.lastFetchedAt >= state.pollMs * 0.95;
    if (stale) fetchDashboard({ silent: true });
    else updateLiveBadge();
  }, Math.max(3000, Math.round(state.pollMs / 4)));

  els.autoToggle.addEventListener('change', () => {
    state.autoRefresh = els.autoToggle.checked;
    state.nextPollAt = Date.now() + state.pollMs;
    toast(state.autoRefresh ? '已恢复自动刷新' : '已暂停自动刷新');
  });

  els.refreshBtn.addEventListener('click', manualRefresh);
  els.panelClose.addEventListener('click', () => selectLibrary(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedLibId) selectLibrary(null);
  });

  fetchDashboard();
  // 首屏若后端还在采集，快速重试
  setTimeout(() => {
    if (!state.data) fetchDashboard({ silent: true });
  }, 2500);
  setTimeout(() => {
    if (!state.data) fetchDashboard({ silent: true });
  }, 6000);
}

document.addEventListener('DOMContentLoaded', init);
