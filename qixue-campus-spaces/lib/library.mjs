import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { LIBRARY_SOURCE, LIBRARY_REFRESH_MS, libraryPolicy, validateLibrarySnapshot } from '../js/library-policy.js';

const DIRECTORY = new URL('../data/private/', import.meta.url);
function text(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, token => {
    if (token[1] === '#') {
      const number = token[2].toLowerCase() === 'x' ? parseInt(token.slice(3, -1), 16) : Number(token.slice(2, -1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    }
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[token.toLowerCase()];
  }).replace(/\s+/g, ' ').trim();
}

export function parseLibraryPage(html, observedAt = new Date().toISOString()) {
  if (typeof html !== 'string' || html.length > 1000000) throw new Error('图书馆页面大小或格式异常。');
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const records = [];
  for (const match of clean.matchAll(/<div\b[^>]*class=["'][^"']*\brooms\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["']clearfix["'])/gi)) {
    const block = match[1];
    const link = block.match(/href=["']\/home\/web\/seat\/area\/([1-9]\d*)["']/i);
    if (!link) continue; // 只有实际展示官方座位入口的卡片才采集。
    const labels = [...block.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/gi)].map(item => text(item[1]));
    const count = labels[1]?.match(/^今日剩余\s*(\d+)\s*[，,]\s*总量\s*(\d+)$/);
    if (!count || !labels[0]) throw new Error('图书馆页面字段发生变化，未猜测或补零。');
    const id = Number(link[1]);
    records.push({ id, name: labels[0], remaining: Number(count[1]), total: Number(count[2]), source: LIBRARY_SOURCE, detailSource: `https://seat.lib.tsinghua.edu.cn/home/web/seat/area/${id}` });
  }
  return validateLibrarySnapshot({ source: LIBRARY_SOURCE, observedAt, countMeaning: 'official_today_remaining', upstreamUpdatedAt: null, records });
}

export async function fetchPublicLibrary({ request = fetch, now = () => new Date() } = {}) {
  const response = await request(LIBRARY_SOURCE, {
    method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8000),
    headers: { Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' }
  });
  if (!response.ok) throw new Error('图书馆官网暂不可达。');
  if (!/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('官网未返回预期页面。');
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1000000) throw new Error('图书馆页面超出大小限制。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return parseLibraryPage(new TextDecoder().decode(Buffer.concat(chunks)), now().toISOString());
}

async function saveSnapshot(snapshot) {
  await mkdir(DIRECTORY, { recursive: true });
  const temporary = new URL(`library-snapshot-${process.pid}.tmp`, DIRECTORY);
  try { await writeFile(temporary, JSON.stringify(snapshot) + '\n', { mode: 0o600 }); await rename(temporary, new URL('library-snapshot.json', DIRECTORY)); }
  finally { await unlink(temporary).catch(() => {}); }
}

export class LibraryService {
  constructor({ fetchSnapshot = fetchPublicLibrary, now = () => new Date(), readSnapshot = async () => JSON.parse(await readFile(new URL('library-snapshot.json', DIRECTORY), 'utf8')), save = saveSnapshot } = {}) {
    Object.assign(this, { fetchSnapshot, now, readSnapshot, save, snapshot: null, pending: null, lastAttempt: null, lastRefreshFailed: false, loaded: false, persistenceWarning: null });
  }
  status() {
    const result = { ...(this.snapshot || { source: LIBRARY_SOURCE, records: [], observedAt: null }), lastAttemptAt: this.lastAttempt === null ? null : new Date(this.lastAttempt).toISOString(), lastRefreshFailed: this.lastRefreshFailed, persistenceWarning: this.persistenceWarning };
    const policy = libraryPolicy(result, this.now());
    return { ...result, status: policy.usable ? 'recent' : this.snapshot ? 'historical' : 'unavailable', policy, refreshAfterMs: this.lastAttempt === null ? 0 : Math.max(0, (this.lastRefreshFailed ? 30000 : LIBRARY_REFRESH_MS) - (this.now().getTime() - this.lastAttempt)) };
  }
  async get({ force = false } = {}) {
    if (this.pending) return this.pending;
    this.pending = this.update(force).finally(() => { this.pending = null; });
    return this.pending;
  }
  async update(force) {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const saved = validateLibrarySnapshot(await this.readSnapshot());
        // 只保存公开白名单字段，不把扩展内容、会话参数或失败状态传给客户端。
        this.snapshot = { source: saved.source, observedAt: saved.observedAt, countMeaning: 'official_today_remaining', upstreamUpdatedAt: null, records: saved.records.map(({ id, name, total, remaining, source, detailSource }) => ({ id, name, total, remaining, source, detailSource })) };
      } catch {}
    }
    const now = this.now().getTime();
    const since = this.lastAttempt === null ? Infinity : now - this.lastAttempt;
    if (since >= 0 && since < (force ? 30000 : this.lastRefreshFailed ? 30000 : LIBRARY_REFRESH_MS)) return this.status();
    if (!force && this.lastAttempt === null && libraryPolicy(this.snapshot, this.now()).usable && now - Date.parse(this.snapshot.observedAt) < LIBRARY_REFRESH_MS) {
      this.lastAttempt = Date.parse(this.snapshot.observedAt); return this.status();
    }
    this.lastAttempt = now;
    try {
      const snapshot = validateLibrarySnapshot(await this.fetchSnapshot());
      this.snapshot = snapshot; this.lastRefreshFailed = false; this.persistenceWarning = null;
      try { await this.save(snapshot); } catch { this.persistenceWarning = '本次数字可查看，但未能写入本机缓存；重启后可能需要重新获取。'; }
    } catch { this.lastRefreshFailed = true; }
    return this.status();
  }
}
