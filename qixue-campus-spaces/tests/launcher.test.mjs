import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startOrReuse, parsePort, supportedNode, probe, isOurServer, openBrowser } from '../scripts/launch.mjs';
import { setup } from '../scripts/setup-official.mjs';
import { runtimeStatus, playwrightCli } from '../lib/runtime.mjs';
import { existsSync } from 'node:fs';
import { APP_ROOT, APP_VERSION, WORKSPACE_ID } from '../lib/app-info.mjs';
import { createAppServer } from '../server.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
function close(server) {
  return new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
}

test('启动参数：Node 版本和端口检查', () => {
  assert.equal(supportedNode('18.20.0'), false);
  assert.equal(supportedNode('20.0.0'), true);
  assert.equal(supportedNode('24.20.0'), true);
  assert.equal(supportedNode('invalid'), false);
  assert.equal(parsePort(), 4173);
  assert.equal(parsePort('5000'), 5000);
  for (const value of ['abc', '1.5', '0', '-1', '65536', '4173x', '']) assert.throws(() => parsePort(value));
});

test('只复用同版本、同目录的应用，不误认旧版/其他克隆', async t => {
  const server = createAppServer(), port = await listen(server);
  t.after(() => close(server));
  const health = await probe(port);
  assert.equal(health.version, APP_VERSION);
  assert.equal(isOurServer(health), true);
  assert.equal(isOurServer({ ...health, workspaceId: 'different' }), false);
  assert.equal(isOurServer({ ...health, version: '0.5.1' }), false);
  assert.equal(isOurServer({ ...health, app: 'other' }), false);
  assert.equal(isOurServer(null), false);
  assert.match(WORKSPACE_ID, /^[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(health).includes(APP_ROOT), false);
  assert.equal((await startOrReuse({ port, attempts: 1 })).reused, true);
});

test('外部端口冲突自动后移，重复启动找到后移的服务，不停止原服务', async t => {
  const foreign = http.createServer((request, response) => { response.writeHead(200); response.end('not qixue'); });
  const port = await listen(foreign);
  t.after(() => close(foreign));
  if (port > 65525) return t.skip('随机端口距上限太近');
  const first = await startOrReuse({ port, attempts: 10 });
  t.after(() => close(first.server));
  assert.equal(first.reused, false);
  assert.ok(first.port > port);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'not qixue');
  const again = await startOrReuse({ port, attempts: 10 });
  assert.equal(again.reused, true);
  assert.equal(again.port, first.port);
});

test('没有可用端口时给出错误，不关闭占用者', async t => {
  const foreign = http.createServer((request, response) => response.end('foreign'));
  const port = await listen(foreign);
  t.after(() => close(foreign));
  await assert.rejects(startOrReuse({ port, attempts: 1 }), /均被占用/);
  assert.equal(foreign.listening, true);
});

test('预检接口仅报告组件状态，不暴露路径，也不声明官网登录成功', async t => {
  const server = createAppServer(), port = await listen(server);
  t.after(() => close(server));
  const response = await fetch(`http://127.0.0.1:${port}/api/runtime`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(typeof data.officialReady, 'boolean');
  assert.deepEqual(Object.keys(data).sort(), ['driverInstalled', 'systemBrowserFound', 'managedBrowserFound', 'officialReady', 'message'].sort());
  assert.equal(JSON.stringify(data).includes(APP_ROOT), false);
  const missing = runtimeStatus({ load() { throw new Error('missing'); }, findBrowser: () => undefined });
  assert.equal(missing.officialReady, false);
  assert.match(missing.message, /setup-official.cmd/);
  const present = runtimeStatus({ load: () => ({ chromium: { executablePath: () => '/nonexistent' } }), findBrowser: () => 'system browser' });
  assert.equal(present.officialReady, true);
  assert.match(present.message, /另行核验/);
});

test('慢响应和过大/无效健康响应不会让启动卡住', async t => {
  const slow = http.createServer(() => {});
  const port = await listen(slow);
  t.after(() => close(slow));
  assert.equal(await probe(port, 50), null);
  const large = http.createServer((req, res) => res.end('x'.repeat(9000)));
  const other = await listen(large);
  t.after(() => close(large));
  assert.equal(await probe(other), null);
});

test('自动打开只允许本机地址，用参数数组而不是 shell 拼接', async () => {
  let called = false;
  const run = (command, args, options) => {
    called = true;
    assert.equal(command, 'rundll32.exe');
    assert.deepEqual(args, ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4173/']);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
  assert.equal(await openBrowser('https://example.com/', { run }), false);
  assert.equal(called, false);
  assert.equal(await openBrowser('http://127.0.0.1:4173/', { platform: 'win32', run }), true);
  assert.equal(await openBrowser('http://127.0.0.1:4173/', { run: () => { throw new Error('no opener'); } }), false);
});

test('可选组件安装：取消不联网，已就绪不重装，失败可重试', async () => {
  let installs = 0;
  const missing = { officialReady: false, driverInstalled: false, managedBrowserFound: false };
  assert.equal((await setup({ confirm: async () => false, getStatus: () => missing, install: async () => installs++ })).installed, false);
  assert.equal(installs, 0);
  await setup({ getStatus: () => ({ officialReady: true }) });
  await assert.rejects(setup({
    confirm: async () => true, getStatus: () => missing, findNpm: () => 'npm-cli.js',
    install: async () => { throw new Error('network unavailable'); }
  }), /network unavailable/);
  let installed = false;
  const result = await setup({
    confirm: async () => true, findNpm: () => 'npm-cli.js', findBrowser: () => 'Edge',
    getStatus: () => installed ? { officialReady: true, driverInstalled: true } : missing,
    install: async args => {
      assert.deepEqual(args, ['npm-cli.js', 'install', '--no-save', '--package-lock=false', '--ignore-scripts', 'playwright@1.62.1']);
      installed = true;
    }
  });
  assert.equal(result.ready, true);
});

test('缺少系统浏览器时使用有效的 Playwright CLI 安装 Chromium', async () => {
  let stage = 0;
  const argsSeen = [];
  const result = await setup({
    confirm: async () => true, findNpm: () => 'npm-cli.js', findBrowser: () => undefined, findCli: () => 'playwright/cli.js',
    getStatus: () => ({ officialReady: stage === 2, driverInstalled: stage >= 1, managedBrowserFound: stage === 2 }),
    install: async args => { argsSeen.push(args); stage++; }
  });
  assert.equal(result.ready, true);
  assert.deepEqual(argsSeen[1], ['playwright/cli.js', 'install', 'chromium']);
  if (runtimeStatus().driverInstalled) assert.equal(existsSync(playwrightCli()), true);
});

test('Windows 双击入口：中文空格路径、仓库根目录分派、缺少 Node 保留提示', { skip: process.platform !== 'win32' }, async () => {
  const root = fileURLToPath(new URL(`../test-results/启动入口 space-${process.pid}/`, import.meta.url));
  const app = join(root, 'qixue-campus-spaces');
  await mkdir(join(app, 'scripts'), { recursive: true });
  // 使用真实 cmd.exe 执行入口，但用无服务器的 Node stub 验证参数和工作目录。
  await copyFile(new URL('../start.cmd', import.meta.url), join(root, 'start.cmd'));
  await writeFile(join(app, 'scripts/launch.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('launch-marker.json', JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));");
  async function execute(env) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start.cmd', '--no-open'], {
        cwd: root, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      child.stdin.on('error', () => {});
      child.stdin.end('\r\n');
      const timeout = setTimeout(() => { child.kill(); reject(new Error('batch timeout')); }, 10000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timeout); resolve({ code, output }); });
    });
  }
  const result = await execute(process.env);
  assert.equal(result.code, 0, result.output);
  const marker = JSON.parse(await readFile(join(app, 'launch-marker.json'), 'utf8'));
  assert.equal(marker.cwd.toLowerCase(), app.toLowerCase());
  assert.deepEqual(marker.args, ['--no-open']);
  const missing = await execute({ ...process.env, PATH: '', ProgramFiles: root });
  assert.equal(missing.code, 1, missing.output);
  assert.match(missing.output, /nodejs.org/);
  assert.match(missing.output, /pause|任意键|Press any key/i);
});
