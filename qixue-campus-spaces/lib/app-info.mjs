import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const APP_ROOT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
export const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// 只公开不可逆标识，不通过健康检查泄露用户目录。
export const WORKSPACE_ID = createHash('sha256').update(process.platform === 'win32' ? APP_ROOT.toLowerCase() : APP_ROOT).digest('hex').slice(0, 24);
