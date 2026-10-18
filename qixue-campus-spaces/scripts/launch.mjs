import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createAppServer } from '../server.mjs';
import { APP_VERSION, WORKSPACE_ID } from '../lib/app-info.mjs';
import { runtimeStatus } from '../lib/runtime.mjs';

export function supportedNode(version = process.versions.node) {
  return /^\d+\.\d+\.\d+/.test(version) && Number(version.split('.')[0]) >= 20;
}

export function parsePort(value = '4173') {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('PORT 必须是 1–65535 的整数。取消自定义 PORT 后可使用默认端口。');
  }
  return Number(value);
}

export function probe(port, timeout = 600) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', agent: false }, response => {
      if (response.statusCode !== 200) { response.resume(); finish(null); return; }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 8192) { finish(null); request.destroy(); }
      });
      response.on('end', () => { try { finish(JSON.parse(body)); } catch { finish(null); } });
      response.on('error', () => finish(null));
    });
    const timer = setTimeout(() => { finish(null); request.destroy(); }, timeout);
    request.on('error', () => finish(null));
  });
}

export function isOurServer(health, identity = { version: APP_VERSION, workspaceId: WORKSPACE_ID }) {
  return health?.status === 'ok' && health.app === 'qixue-campus-spaces'
    && health.version === identity.version && health.workspaceId === identity.workspaceId;
}

export async function startOrReuse({ port = 4173, attempts = 20, makeServer = createAppServer, identity } = {}) {
  port = parsePort(port);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) throw new Error('无效端口尝试次数。');
  const ports = Array.from({ length: Math.min(attempts, 65536 - port) }, (_, i) => port + i);
  // 一并检查候选端口，重复启动时也能找到此前因端口占用而后移的同目录服务。
  const statuses = await Promise.all(ports.map(candidate => probe(candidate)));
  const existing = statuses.findIndex(health => isOurServer(health, identity));
  if (existing >= 0) return { reused: true, port: ports[existing], server: null };
  for (const candidate of ports) {
    const server = makeServer();
    const error = await new Promise(resolve => {
      const onError = error => { server.removeListener('listening', onListening); resolve(error); };
      const onListening = () => { server.removeListener('error', onError); resolve(null); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(candidate, '127.0.0.1');
    });
    if (!error) return { reused: false, port: candidate, server };
    if (error.code !== 'EADDRINUSE') throw error;
    // 另一启动进程可能刚刚抢先完成监听。
    if (isOurServer(await probe(candidate), identity)) return { reused: true, port: candidate, server: null };
  }
  throw new Error(`端口 ${ports[0]}–${ports.at(-1)} 均被占用。请设置其他 PORT，或关闭不需要的服务。`);
}

export function openBrowser(url, { platform = process.platform, run = spawn } = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/$/.test(url)) return Promise.resolve(false);
  const [command, args] = platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  return new Promise(resolve => {
    try {
      const child = run(command, args, { stdio: 'ignore', windowsHide: true, shell: false });
      child.once('error', () => resolve(false));
      child.once('exit', code => resolve(code === 0));
    } catch { resolve(false); }
  });
}

async function main() {
  if (!supportedNode()) throw new Error('请先安装 Node.js LTS（需 Node.js 20 或以上），然后重新双击 start.cmd。');
  if (process.argv.slice(2).some(arg => arg !== '--no-open')) throw new Error('启动参数仅支持 --no-open。');
  const result = await startOrReuse({ port: parsePort(process.env.PORT || '4173') });
  const url = `http://127.0.0.1:${result.port}/`;
  console.log(`\n栖学 v${APP_VERSION}  ${result.reused ? '已运行，复用原服务' : '启动成功'}\n\n浏览器地址：${url}`);
  if (result.port !== parsePort(process.env.PORT || '4173')) console.log('默认端口被其他服务占用，已选择其他端口；没有停止其他程序。浏览器偏好和手动日程按端口隔离。');
  if (!result.reused) {
    console.log(`\n${runtimeStatus().message}\n\n请保留此窗口；停止服务请按 Ctrl+C。只关闭网页不会停止服务。\n`);
    result.server.on('error', error => console.error(`本地服务异常：${error.code || 'unknown'}`));
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      console.log('\n正在关闭本次服务及官方认证窗口…');
      const timeout = setTimeout(() => process.exit(0), 4000);
      timeout.unref();
      await result.server.disconnectOfficial().catch(() => {});
      result.server.close(() => process.exit(0));
    });
  }
  if (!process.argv.includes('--no-open') && !await openBrowser(url)) console.log(`未能自动打开浏览器，请复制此地址：${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`\n启动失败：${error.message}`); process.exitCode = 1; });
}
