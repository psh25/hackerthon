import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OfficialConnection } from './lib/official-connection.mjs';
import { cachePolicy, chinaDate } from './js/schedule.js';

const ROOT = new URL('./', import.meta.url);
const ROUTES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/js/app.js', ['js/app.js', 'text/javascript; charset=utf-8']],
  ['/js/recommend.js', ['js/recommend.js', 'text/javascript; charset=utf-8']],
  ['/js/daily.js', ['js/daily.js', 'text/javascript; charset=utf-8']],
  ['/js/connection.js', ['js/connection.js', 'text/javascript; charset=utf-8']],
  ['/js/classrooms.js', ['js/classrooms.js', 'text/javascript; charset=utf-8']],
  ['/js/schedule.js', ['js/schedule.js', 'text/javascript; charset=utf-8']],
  ['/js/agenda.js', ['js/agenda.js', 'text/javascript; charset=utf-8']],
  ['/js/planner.js', ['js/planner.js', 'text/javascript; charset=utf-8']],
  ['/data/places.json', ['data/places.json', 'application/json; charset=utf-8']],
  ['/data/classroom-reference.json', ['data/classroom-reference.json', 'application/json; charset=utf-8']]
]);

export function createAppServer({ connection = new OfficialConnection(), readSnapshot = async () => JSON.parse(await readFile(new URL('data/private/classroom-snapshot.json', ROOT), 'utf8')) } = {}) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const send = (status, type, body) => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    const host = request.headers.host || '';
    const origin = `http://${host}`;
    if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host) || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return send(403, 'application/json; charset=utf-8', JSON.stringify({ error: 'Forbidden', message: '仅允许本机同源访问。' }));
    const connectionAction = /^\/api\/connection\/(start|refresh|disconnect|openClassrooms|inspectClassrooms|queryClassrooms)$/.test(request.url);
    if (connectionAction && request.method === 'POST') {
      const supplied = request.headers['x-qixue-token'];
      if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return send(403, 'application/json; charset=utf-8', JSON.stringify({ error: 'Forbidden', message: '请刷新页面后再操作。' }));
      if (Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding']) return send(400, 'application/json; charset=utf-8', JSON.stringify({ error: 'Body not accepted', message: '本服务不接收账号、密码或任何请求正文。' }));
      try {
        const action = request.url.split('/').at(-1);
        const result = await connection[action]();
        return send(200, 'application/json; charset=utf-8', JSON.stringify(result));
      } catch { return send(503, 'application/json; charset=utf-8', JSON.stringify({ error: 'Unavailable', message: '官方连接暂不可用；未同步资源。' })); }
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return send(405, 'application/json; charset=utf-8', JSON.stringify({ error: 'Method not allowed' }));
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://127.0.0.1').pathname; }
    catch { return send(400, 'application/json; charset=utf-8', JSON.stringify({ error: 'Bad request' })); }
    if (pathname === '/api/session') return send(200, 'application/json; charset=utf-8', JSON.stringify({ token }));
    if (pathname === '/api/connection/status') {
      try { return send(200, 'application/json; charset=utf-8', JSON.stringify(await connection.checkLogin())); }
      catch { return send(503, 'application/json; charset=utf-8', JSON.stringify({ error: 'Unavailable' })); }
    }
    if (pathname === '/api/classrooms/observation') {
      const observation = connection.classroomObservation ? { ...connection.classroomObservation, tables: undefined } : null;
      let cached;
      try { cached = await readSnapshot(); cached.fromCache = true; cached.status = 'weekly_snapshot'; } catch {}
      const requestedDate = new URL(request.url, 'http://127.0.0.1').searchParams.get('date') || chinaDate();
      const livePolicy = cachePolicy(observation, requestedDate);
      const result = livePolicy.usable ? observation : cached || observation || { status:'not_observed', records:[], availabilityReady:false };
      const policy = cachePolicy(result, requestedDate);
      const syncFailed = observation && !observation.records?.length && /failed|login_required/.test(observation.status);
      return send(200, 'application/json; charset=utf-8', JSON.stringify({ ...result, cachePolicy:policy, message:policy.message, syncWarning:syncFailed ? '最近一次在线同步未成功；此处仍为此前缓存，未刷新采集时间。' : null }));
    }
    if (pathname === '/api/health') return send(200, 'application/json; charset=utf-8', JSON.stringify({ status: 'ok', app: 'qixue-campus-spaces', version: '0.5.1', realtimeData: false, resourceAdapter: 'classroom_schedule_weekly_cache', personalSchedule:'manual_local_only', semesterImport:'not_configured', libraryAdapter: 'not_configured', campusRouting:'not_configured' }));
    const route = ROUTES.get(pathname);
    if (!route) return send(404, 'application/json; charset=utf-8', JSON.stringify({ error: 'Not found' }));
    try { send(200, route[1], await readFile(new URL(route[0], ROOT))); }
    catch (error) {
      console.error(`Local file could not be served: ${route[0]} (${error.code || 'unknown'})`);
      send(500, 'application/json; charset=utf-8', JSON.stringify({ error: 'Local file unavailable' }));
    }
  });
  server.disconnectOfficial = () => connection.disconnect();
  server.on('close', () => { server.disconnectOfficial().catch(() => {}); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createAppServer();
    server.on('error', error => { console.error(`Unable to start local server: ${error.code}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Qixue is running at http://127.0.0.1:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      await server.disconnectOfficial();
      server.close(() => process.exit(0));
    });
  }
}
