import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { APP_ROOT } from '../lib/app-info.mjs';
import { browserExecutable, runtimeStatus, playwrightCli } from '../lib/runtime.mjs';
import { supportedNode } from './launch.mjs';

export function npmCli() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
  ];
  try { candidates.push(createRequire(import.meta.url).resolve('npm/bin/npm-cli.js')); } catch {}
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error('未找到 npm。请使用带 npm 的 Node.js LTS 安装包，或在终端手动安装本项目的 Playwright。');
  return found;
}

export function runNode(args, { run = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = run(process.execPath, args, {
      cwd: APP_ROOT, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('安装未成功。请检查终端中的网络/权限提示，再重新运行安装入口；不会影响普通页面启动。')));
  });
}

export async function setup({ confirm, getStatus = runtimeStatus, install = runNode, findNpm = npmCli, findBrowser = browserExecutable, findCli = playwrightCli } = {}) {
  if (getStatus().officialReady) { console.log('查询组件和浏览器已就绪，不需要重新安装。请重新打开网页后连接官网。'); return { installed: false, ready: true }; }
  if (!await confirm()) { console.log('已取消安装。仍可双击 start.cmd 查看页面和已有缓存。'); return { installed: false, ready: false }; }
  if (!getStatus().driverInstalled) {
    // 与开发机实际验证版本一致；不改全局 npm 配置，不安装到全局，不运行安装生命周期脚本。
    await install([findNpm(), 'install', '--no-save', '--package-lock=false', '--ignore-scripts', 'playwright@1.62.1']);
  }
  if (!findBrowser() && !getStatus().managedBrowserFound) {
    await install([findCli(), 'install', 'chromium']);
  }
  const ready = getStatus().officialReady;
  if (!ready) throw new Error('未检测到可用浏览器。请安装 Edge/Chrome 后重试，或检查上方安装错误。');
  console.log('安装完成。双击 start.cmd 打开网页；组件就绪不代表已登录官网。');
  return { installed: true, ready };
}

async function main() {
  if (!supportedNode()) throw new Error('请先安装 Node.js LTS（Node.js 20 或以上）。');
  if (!process.stdin.isTTY) throw new Error('请在可交互终端运行安装入口；不会在后台自动安装组件。');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await setup({ confirm: async () => {
      console.log('\n此操作会联网下载官方查询组件到当前项目的 node_modules。\n优先使用已安装的 Edge/Chrome；如果没有，会下载 Chromium（可能较大）。\n不需要管理员权限，不下载个人课表，不保存密码或会话，不包含付费服务。');
      return /^(y|yes)$/i.test((await prompt.question('是否继续？输入 Y 继续，直接回车取消：')).trim());
    } });
  } finally { prompt.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`安装提示：${error.message}`); process.exitCode = 1; });
}
