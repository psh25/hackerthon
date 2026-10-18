/**
 * 清华图书馆座位实时可视化 —— 后端服务
 *
 * 零第三方依赖，只需 Node 20+（内置 fetch）。
 *
 *   node server.js            # 默认 http://127.0.0.1:8787
 *   PORT=9000 node server.js  # 自定义端口
 *
 * 设计：
 *   1. 后台定时轮询上游 `/api.php/v3areas`（单请求 = 全站数据），默认每 30 秒一次；
 *   2. 结果聚合后缓存在内存，前端任意次刷新都走缓存，绝不放大对校方的请求；
 *   3. 内存中保留 6 小时采样历史，供趋势图使用；
 *   4. 上游偶发失败时保留上一次成功快照，并标记 stale，前端会显示「数据陈旧」。
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const { fetchAreaTree, UpstreamError } = require('./src/tsinghua');
const { buildDashboard } = require('./src/aggregate');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const POLL_MS = Math.max(10000, Number(process.env.POLL_MS || 30000));
const HISTORY_MS = Math.max(60 * 60 * 1000, Number(process.env.HISTORY_MS || 6 * 60 * 60 * 1000));
const STATIC_ROOT = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

const state = {
  snapshot: null, // 最近一次成功聚合结果
  history: [], // [{t, total, occupied, available, rate, libraries:{id:rate}}]
  lastError: null,
  lastAttemptAt: null,
  successCount: 0,
  failCount: 0,
  polling: false,
  pollMs: POLL_MS,
  timer: null,
  startedAt: Date.now(),
};

function trimHistory(now = Date.now()) {
  const cutoff = now - HISTORY_MS;
  let i = 0;
  while (i < state.history.length && state.history[i].t < cutoff) i += 1;
  if (i > 0) state.history.splice(0, i);
}

function pushHistory(agg, fetchedAt) {
  const libRates = {};
  for (const lib of agg.libraries) libRates[lib.id] = Math.round(lib.rate * 1000) / 1000;
  state.history.push({
    t: fetchedAt,
    total: agg.summary.total,
    occupied: agg.summary.occupied,
    available: agg.summary.available,
    rate: Math.round(agg.summary.rate * 1000) / 1000,
    libs: libRates,
  });
  trimHistory();
}

// ---------------------------------------------------------------------------
// 采集
// ---------------------------------------------------------------------------

async function pollOnce({ reason = 'schedule' } = {}) {
  if (state.polling) return { skipped: true };
  state.polling = true;
  state.lastAttemptAt = Date.now();
  const startedAt = Date.now();
  try {
    const tree = await fetchAreaTree({ timeoutMs: 15000 });
    const agg = buildDashboard(tree.nodes);
    const now = Date.now();
    state.snapshot = {
      ...agg,
      fetchedAt: tree.fetchedAt,
      serverTime: now,
      elapsedMs: now - startedAt,
      upstreamElapsedMs: tree.elapsedMs,
      nodeCount: tree.nodes.length,
      stale: false,
      error: null,
      reason,
    };
    pushHistory(agg, tree.fetchedAt);
    state.successCount += 1;
    state.lastError = null;
    console.log(
      `[poll] ok  ${new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}  ` +
        `在座 ${agg.summary.occupied}/${agg.summary.total} (${agg.summary.ratePct}%)  ` +
        `${state.snapshot.elapsedMs}ms  节点${tree.nodes.length}`,
    );
    return { ok: true };
  } catch (err) {
    state.failCount += 1;
    state.lastError = {
      message: err.message || String(err),
      at: Date.now(),
      url: err.url || null,
    };
    if (state.snapshot) state.snapshot.stale = true;
    console.error(`[poll] fail ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    state.polling = false;
    scheduleNext();
  }
}

function scheduleNext() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    pollOnce({ reason: 'schedule' });
  }, state.pollMs);
  if (state.timer.unref) state.timer.unref();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function publicStatus() {
  return {
    ok: true,
    service: 'thu-seat-live',
    startedAt: state.startedAt,
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    pollMs: state.pollMs,
    polling: state.polling,
    snapshot: state.snapshot
      ? {
          fetchedAt: state.snapshot.fetchedAt,
          stale: state.snapshot.stale,
          total: state.snapshot.summary.total,
          occupied: state.snapshot.summary.occupied,
          ratePct: state.snapshot.summary.ratePct,
          nodeCount: state.snapshot.nodeCount,
          elapsedMs: state.snapshot.elapsedMs,
        }
      : null,
    lastError: state.lastError,
    successCount: state.successCount,
    failCount: state.failCount,
  };
}

async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(STATIC_ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) throw Object.assign(new Error('dir'), { code: 'ENOENT' });
    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache',
      ETag: etag,
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // 预览主页面/静态资源
  if (req.method === 'GET' && (p === '/' || p.startsWith('/assets/') || p === '/index.html' || p === '/favicon.ico')) {
    return serveStatic(res, p === '/' ? '/index.html' : p);
  }

  // 主数据
  if (req.method === 'GET' && p === '/api/dashboard') {
    if (!state.snapshot) {
      return sendJson(res, 503, {
        ok: false,
        error: '数据尚未就绪（首次采集进行中）',
        lastError: state.lastError,
        pollMs: state.pollMs,
      });
    }
    return sendJson(res, 200, {
      ok: true,
      pollMs: state.pollMs,
      historyWindowMs: HISTORY_MS,
      ...state.snapshot,
      history: state.history,
      lastError: state.lastError,
    });
  }

  // 状态 / 健康检查
  if (req.method === 'GET' && (p === '/api/status' || p === '/healthz')) {
    return sendJson(res, 200, publicStatus());
  }

  // 手动触发一次采集
  if ((req.method === 'POST' && p === '/api/refresh') || (req.method === 'GET' && p === '/api/refresh')) {
    if (state.polling) return sendJson(res, 202, { ok: true, polling: true });
    pollOnce({ reason: 'manual' });
    return sendJson(res, 202, { ok: true, accepted: true });
  }

  return sendJson(res, 404, { ok: false, error: 'Not Found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[http] error', err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: '内部错误' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  清华大学图书馆 · 座位实时看板`);
  console.log(`  本地地址   http://${HOST}:${PORT}`);
  console.log(`  数据来源   https://seat.lib.tsinghua.edu.cn/api.php/v3areas`);
  console.log(`  轮询间隔   ${Math.round(POLL_MS / 1000)} 秒\n`);
  pollOnce({ reason: 'startup' });
});

function shutdown(sig) {
  console.log(`\n收到 ${sig}，正在关闭…`);
  if (state.timer) clearTimeout(state.timer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { server, pollOnce, state };
