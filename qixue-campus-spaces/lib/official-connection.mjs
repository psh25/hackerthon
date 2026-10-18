import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { CLASSROOM_URL, isClassroomUrl } from './classroom.mjs';
import { detectConnection, portalPage, classroomWindow } from './official-pages.mjs';

async function readClassroom(page) {
  // 仅重载受版本控制的本地解析模块，方便校准官方页面，无需重启认证窗口。
  const revision = (await stat(new URL('./classroom.mjs', import.meta.url))).mtimeMs;
  const { inspectClassroom: inspect } = await import(`./classroom.mjs?revision=${revision}`);
  return inspect(page);
}

async function saveSchedule(observation) {
  if (!observation?.records.length) return;
  const directory = new URL('../data/private/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const safe = { status: 'schedule_snapshot', source: CLASSROOM_URL, observedAt: observation.observedAt, queriedAt: observation.queriedAt || null, records: observation.records, days: observation.days, truncated: observation.truncated, rejectedRows: observation.rejectedRows, dateBasis: observation.dateBasis, periodClockTimes: null, availabilityReady: false, queryReady: false };
  const temporary=new URL(`classroom-snapshot-${process.pid}.tmp`,directory);
  try {
    await writeFile(temporary, JSON.stringify(safe) + '\n', { mode: 0o600 });
    await rename(temporary,new URL('classroom-snapshot.json',directory));
  } finally { await unlink(temporary).catch(()=>{}); }
}

const PORTAL = 'https://info.tsinghua.edu.cn/f/info/gxfw_fg/common/index';
const RESOURCE_LABEL = /教室|自习|空闲|教学楼|图书馆|座位|教学资源/;
export function officialUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'tsinghua.edu.cn' || url.hostname.endsWith('.tsinghua.edu.cn')); }
  catch { return false; }
}

function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); } catch {}
  const modules = process.env.BUNDLED_NODE_MODULES || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
  return createRequire(join(modules, '..', 'package.json'))('playwright');
}

export class OfficialConnection {
  constructor() {
    this.state = 'disconnected'; this.browser = null; this.page = null; this.context = null;
    this.resourceLinks = []; this.expires = null; this.timer = null; this.lastDiscovery = 0;
    this.generation = 0; this.busy = false;
    this.classroomPage = null; this.classroomObservation = null; this.lastClassroomRead = 0;
    this.lastClassroomQuery = 0;
    this.services = { portal: 'not_observed', classrooms: 'not_observed' };
    this.checkedAt = null; this.connectionCheck = null; this.connectionMode = 'not_observed'; this.diagnostics = [];
    this.message = '在清华官方窗口完成认证；当前尚无动态资源数据。';
  }
  status() {
    return { state: this.state, message: this.message, services: this.services, checkedAt: this.checkedAt, connectionMode: this.connectionMode, diagnostics: this.diagnostics, resourceLinks: this.resourceLinks, expiresAt: this.expires, dynamicDataReady: false, lastResourceSync: null, resourceAdapter: 'classroom_schedule', classroomStatus: this.classroomObservation?.status || '待核实', classroomObservation: this.classroomObservation ? { status: this.classroomObservation.status, message: this.classroomObservation.message, observedAt: this.classroomObservation.observedAt, queryReady: this.classroomObservation.queryReady, recordCount: this.classroomObservation.records.length } : null, libraryStatus: '待核实', passwordStored: false, sessionPersistence: 'memory_only' };
  }
  async start() {
    if (this.busy || ['launching', 'awaiting_login', 'authenticated'].includes(this.state)) return this.status();
    this.busy = true;
    const generation = ++this.generation;
    this.state = 'launching'; this.resourceLinks = [];
    this.message = '正在打开官方认证窗口，请只在官方域名输入凭据。';
    let browser;
    try {
      const { chromium } = loadPlaywright();
      const executablePath = process.env.BROWSER_PATH || [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe'
      ].find(path => existsSync(path));
      browser = await chromium.launch({ headless: false, ...(executablePath ? { executablePath } : {}), timeout: 25000 });
      if (generation !== this.generation) { await browser.close(); return this.status(); }
      this.browser = browser;
      this.context = await browser.newContext({ acceptDownloads: false });
      this.context.on('page', popup => {
        popup.on('framenavigated', frame => {
          if (frame === popup.mainFrame() && frame.url() !== 'about:blank' && !officialUrl(frame.url()) && !isClassroomUrl(frame.url())) {
            // 不关闭跳转窗口：旧系统可能经过 HTTP、IP 或其他服务域名。
            // 未核实页面仅停止自动读取，留给用户检查，不能把关窗当作安全隔离。
            this.message = '窗口跳转到尚未核实的地址，已暂停自动读取，但不会关闭窗口。请勿在非官方地址输入凭据。';
          }
        });
      });
      this.page = await this.context.newPage();
      this.state = 'awaiting_login';
      this.message = '请在弹出的清华官方窗口自行输入账号密码并完成二次认证。不需要把验证码发到聊天中。';
      this.expires = new Date(Date.now() + 45 * 60 * 1000).toISOString();
      this.timer = setTimeout(() => this.disconnect(), 45 * 60 * 1000);
      this.timer.unref?.();
      browser.on('disconnected', () => {
        if (generation !== this.generation) return;
        clearTimeout(this.timer); this.timer = null; this.browser = null; this.context = null; this.page = null; this.classroomPage = null; this.classroomObservation = null; this.resourceLinks = []; this.expires = null;
        this.services = { portal: 'not_observed', classrooms: 'not_observed' }; this.connectionMode = 'not_observed'; this.diagnostics = []; this.checkedAt = null;
        if (this.state !== 'error') { this.state = 'closed'; this.message = '官方窗口已关闭，本次内存登录会话不再保留。'; }
      });
      await this.page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await this.checkLogin();
    } catch {
      if (generation === this.generation) {
        this.state = 'error'; this.message = '无法打开官方窗口。请检查本机 Playwright、浏览器、校园网络与门户连通性；未获取动态资源。';
        this.resourceLinks = []; this.expires = null; clearTimeout(this.timer);
        if (browser) await browser.close().catch(() => {});
        this.browser = null; this.context = null; this.page = null;
      }
    } finally { this.busy = false; }
    return this.status();
  }
  async checkLogin() {
    if (!this.context || this.state === 'launching') return this.status();
    if (this.connectionCheck) return this.connectionCheck;
    const generation = this.generation;
    const context = this.context;
    this.connectionCheck = (async () => {
      const pages = context.pages().filter(page => !page.isClosed());
      if (!pages.length) { await this.disconnect(); return this.status(); }
      const result = await detectConnection(pages);
      if (generation !== this.generation || context !== this.context) return this.status();
      this.services = result.services; this.checkedAt = new Date().toISOString(); this.diagnostics = result.diagnostics;
      this.connectionMode = result.proxy ? 'webvpn' : result.portal || result.classroom ? 'direct' : 'unconfirmed';
      this.classroomPage = result.classroom;
      if (result.portal || result.classroom) {
        this.page = result.portal || result.classroom; this.state = 'authenticated';
        this.message = `${result.proxy ? '已识别 WebVPN 官方代理页面。' : ''}${result.portal ? '信息门户已确认。' : '教室服务已确认，门户状态单独核验。'}${result.classroom ? '教室页面已确认；查询数据和实时座位不是连接状态。' : '教室服务尚未确认，请从门户进入教室查询。'}`;
      } else {
        this.state = 'awaiting_login'; this.resourceLinks = [];
        this.message = result.diagnostics.some(item => item.status === 'login_required') ? '当前官方页面提示登录或认证失效，请在原官方窗口完成认证；窗口不会被自动关闭。' : '当前官方窗口尚无可确认的资源页面，可能正在跳转。请在本作品打开的窗口进入信息门户或教室资源；其他普通浏览器的登录不会自动共享。';
      }
      return this.status();
    })();
    try { return await this.connectionCheck; }
    finally { this.connectionCheck = null; }
  }
  async refresh() {
    await this.checkLogin();
    if (this.state !== 'authenticated' || this.busy) return this.status();
    if (this.services.portal !== 'authenticated') { this.message = '教室服务已连接，但信息门户入口尚未确认；可直接读取当前教室页面，无需反复打开门户。'; return this.status(); }
    if (Date.now() - this.lastDiscovery < 30000) return this.status();
    this.lastDiscovery = Date.now();
    this.busy = true;
    try {
      const links = new Map();
      for (const frame of this.page.frames()) {
        if (!officialUrl(frame.url())) continue;
        const entries = await frame.locator('a[href]').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().width && n.getBoundingClientRect().height).map(n => ({ label: n.innerText.trim().slice(0, 100), href: n.href })).filter(n => /教室|自习|空闲|教学楼|图书馆|座位|教学资源/.test(n.label)).slice(0, 30)).catch(() => []);
        for (const entry of entries) {
          if (!RESOURCE_LABEL.test(entry.label) || !officialUrl(entry.href) || /注销|退出|删除|提交|预约|个人|我的/.test(entry.label)) continue;
          const url = new URL(entry.href);
          if (/logout|delete|remove|submit|reserve|token|ticket|session/i.test(url.pathname)) continue;
          // 不回传带查询字符串/片段的链接，以免泄漏 SSO ticket 或其他临时凭据。
          if (url.search || url.hash) continue;
          links.set(url.href, { label: entry.label, url: url.origin + url.pathname });
        }
      }
      this.resourceLinks = [...links.values()].slice(0, 20);
      this.message = this.resourceLinks.length ? '发现官方资源入口，但尚未实现或核实动态数据解析。请在官方窗口打开教室 / 图书馆资源页，之后才能针对真实字段实现只读适配。' : '已连接门户，当前页面没有发现可安全展示的资源入口。请在官方窗口手动进入教室 / 图书馆资源页；尚未同步资源数据。';
    } finally { this.busy = false; }
    return this.status();
  }
  async openClassrooms() {
    if (!this.context || this.busy) { this.message = '请先连接官方门户并完成认证。'; return this.status(); }
    this.busy = true;
    try {
      const existing = this.context.pages().find(classroomWindow);
      if (existing) { this.classroomPage = existing; await existing.bringToFront(); }
      else {
        const portal = this.context.pages().find(page => {
          return !page.isClosed() && (portalPage(page.url()) || page.frames().some(frame => portalPage(frame.url())));
        });
        let clicked = false;
        if (portal) {
          for (const frame of portal.frames()) {
            if (!officialUrl(frame.url())) continue;
            const entry = frame.getByText('教室状况查看', { exact: true });
            if (await entry.count() && await entry.first().isVisible()) {
              // 点击已观察到的只读资源入口，保留官方 SSO 跳转，而非猜测后台接口。
              await entry.first().click({ timeout: 10000 }); clicked = true; break;
            }
          }
          if (clicked) {
            const deadline = Date.now() + 12000;
            while (Date.now() < deadline) {
              const target = this.context.pages().find(classroomWindow);
              if (target) { this.classroomPage = target; break; }
              await new Promise(resolve => setTimeout(resolve, 400));
            }
          }
        }
        if (!this.classroomPage || this.classroomPage.isClosed()) {
          this.classroomPage = await this.context.newPage();
          await this.classroomPage.goto(CLASSROOM_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
      }
      this.classroomObservation = await readClassroom(this.classroomPage);
      await saveSchedule(this.classroomObservation);
      this.lastClassroomRead = Date.now(); this.message = this.classroomObservation.message;
    } catch { this.message = '自动打开或读取教室页未完成，窗口保持打开。请在官方窗口检查认证或资源页面。'; }
    finally { this.busy = false; }
    return this.status();
  }
  async inspectClassrooms() {
    if (this.busy) return this.status();
    if (Date.now() - this.lastClassroomRead < 5000) return this.status();
    this.lastClassroomRead = Date.now();
    const target = this.context?.pages().find(classroomWindow) || this.classroomPage;
    this.busy = true;
    try {
      const previous = this.classroomObservation;
      this.classroomObservation = await readClassroom(target);
      if (previous?.records.length && this.classroomObservation.records.length) {
        // 重新读取同一张DOM不是向官方重新查询，不能把旧课表的时间刷新成现在。
        this.classroomObservation.observedAt = previous.observedAt;
        this.classroomObservation.queriedAt = previous.queriedAt || null;
      }
      await saveSchedule(this.classroomObservation);
      this.message = this.classroomObservation.message;
    } catch {
      this.classroomObservation = { status: 'read_failed', source: CLASSROOM_URL, records: [], days: [], observedAt: null, availabilityReady: false, queryReady: false, message: '读取官方课表失败，已撤下此前候选；请检查认证后重试。' };
      this.message = this.classroomObservation.message;
    } finally { this.busy = false; }
    return this.status();
  }
  async queryClassrooms() {
    if (this.busy) return this.status();
    if (Date.now() - this.lastClassroomQuery < 30000) { this.message = '为避免频繁请求，教室查询至少间隔 30 秒。'; return this.status(); }
    const page = this.context?.pages().find(classroomWindow);
    if (!page) { this.message = '请先在本作品的官方窗口完成认证并打开教室页；不会复用其他浏览器的 Cookie。'; return this.status(); }
    this.busy = true;
    try {
    const frame = page.frames().find(frame => isClassroomUrl(frame.url()));
      if (!frame) { this.message = '未发现已核实的教室查询页面，未提交查询。'; return this.status(); }
      const before = await readClassroom(page);
      if (before.status === 'login_required') { this.classroomObservation = before; this.message = before.message; return this.status(); }
      const query = frame.getByRole('button', { name: '查询', exact: true });
      if (await query.count() !== 1 || !(await query.isVisible())) { this.message = '尚未明确识别唯一的官方“查询”按钮，未猜测或提交其他表单。'; return this.status(); }
      this.lastClassroomQuery = Date.now();
      this.classroomObservation = null;
      // 用户主动触发；只点击已观察到的“查询”，保留官方当前过滤条件，不推算周次。
      await query.click({ timeout: 10000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      this.classroomObservation = await readClassroom(page);
      this.classroomObservation.queriedAt = this.classroomObservation.records.length ? this.classroomObservation.observedAt : null;
      await saveSchedule(this.classroomObservation);
      this.lastClassroomRead = Date.now();
      this.message = `已点击官方当前条件的查询。${this.classroomObservation.message} 该查询未按每日日期自动换算周次。`;
    } catch {
      this.classroomObservation = { status: 'query_failed', source: CLASSROOM_URL, records: [], days: [], observedAt: null, availabilityReady: false, queryReady: false, message: '自动查询失败，已撤下此前候选。请检查登录状态或官方页面变化。' };
      this.message = this.classroomObservation.message;
    }
    finally { this.busy = false; }
    return this.status();
  }
  async disconnect() {
    ++this.generation; clearTimeout(this.timer); this.timer = null;
    const browser = this.browser;
    this.browser = null; this.context = null; this.page = null; this.classroomPage = null; this.classroomObservation = null; this.resourceLinks = []; this.expires = null;
    this.services = { portal: 'not_observed', classrooms: 'not_observed' }; this.connectionMode = 'not_observed'; this.diagnostics = []; this.checkedAt = null;
    this.lastDiscovery = 0; this.lastClassroomRead = 0; this.lastClassroomQuery = 0;
    this.state = 'disconnected'; this.message = '已断开并清除本次内存会话。没有保存密码、Cookie 或门户页面。';
    if (browser) await browser.close().catch(() => {});
    return this.status();
  }
}
