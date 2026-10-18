import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

function playwrightRequire() {
  const local = createRequire(import.meta.url);
  try { local.resolve('playwright'); return local; } catch {}
  // 开发机可复用已有组件；队友通过 setup-official.cmd 在项目本地安装。
  const modules = process.env.BUNDLED_NODE_MODULES || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  return createRequire(join(modules, '..', 'package.json'));
}

export function loadPlaywright() { return playwrightRequire()('playwright'); }
export function playwrightCli() { return join(playwrightRequire().resolve('playwright/package.json'), '..', 'cli.js'); }

export function browserExecutable() {
  const candidates = process.env.BROWSER_PATH ? [process.env.BROWSER_PATH] : [
    ...[process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean).flatMap(base => [
      join(base, 'Microsoft/Edge/Application/msedge.exe'), join(base, 'Google/Chrome/Application/chrome.exe')
    ]),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  return candidates.find(candidate => existsSync(candidate));
}

export function runtimeStatus({ load = loadPlaywright, findBrowser = browserExecutable } = {}) {
  let playwright;
  try { playwright = load(); } catch {}
  const driverInstalled = Boolean(playwright?.chromium);
  const systemBrowserFound = Boolean(findBrowser());
  const managedBrowserFound = Boolean(driverInstalled && existsSync(playwright.chromium.executablePath()));
  const officialReady = driverInstalled && (systemBrowserFound || managedBrowserFound);
  const message = officialReady
    ? '官方查询组件已检测到；校园网络和登录状态需连接时另行核验。'
    : '首次查询官网：请双击项目中的 setup-official.cmd 安装查询组件（需联网）；Mac/Linux 运行 npm run setup:official。查看页面和已有本周缓存不需要安装。';
  return { driverInstalled, systemBrowserFound, managedBrowserFound, officialReady, message };
}
