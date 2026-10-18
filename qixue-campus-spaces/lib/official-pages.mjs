// 不保存 URL 查询参数、片段、JSESSIONID 或 WebVPN 的不透明代理编码。
export function officialPage(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return null;
    const path = url.pathname.replace(/;[^/]*/g, '');
    if (url.hostname === 'webvpn.tsinghua.edu.cn' && url.protocol === 'https:') {
      const match = path.match(/^\/(https?)\/[a-f\d]{20,240}(\/.*)$/i);
      return match ? { host: url.hostname, path: match[2], proxy: true, safePath: `/[webvpn]${match[2]}` } : { host: url.hostname, path, proxy: false, safePath: path };
    }
    if (!(url.hostname === 'tsinghua.edu.cn' || url.hostname.endsWith('.tsinghua.edu.cn'))) return null;
    if (url.protocol !== 'https:' && url.hostname !== 'zhjw.cic.tsinghua.edu.cn') return null;
    return { host: url.hostname, path, proxy: false, safePath: path };
  } catch { return null; }
}

export function portalPage(value) {
  const page = officialPage(value);
  return Boolean(page && (page.host === 'info.tsinghua.edu.cn' || (page.proxy && /^\/f\/info\//.test(page.path))));
}

export function classroomLocation(value) {
  const page = officialPage(value);
  return Boolean(page && (page.host === 'zhjw.cic.tsinghua.edu.cn' || page.proxy) && page.path === '/pk.classroomctrl.do');
}

export function classroomWindow(page) {
  return !page.isClosed() && (classroomLocation(page.url()) || page.frames?.().some(frame => classroomLocation(frame.url())));
}

export async function inspectAuthentication(frame) {
  let timer;
  try {
    return await Promise.race([
      frame.evaluate(() => {
        const visible = node => !!(node.getBoundingClientRect().width && node.getBoundingClientRect().height);
        const text = document.body?.innerText || '';
        const password = [...document.querySelectorAll('input[type=password]')].some(visible);
        const denied = /用户登[录陆]超时|访问内容不存在|登录已过期|会话已过期|请重新登录|请先登录/.test(text);
        const portal = /本科生课表|教室状况查看/.test(text);
        const challenge = /二次认证|动态口令|短信验证码|身份认证/.test(text) && !portal;
        const query = [...document.querySelectorAll('input[type=button],input[type=submit],button')].some(node => visible(node) && /^查\s*询$/.test((node.innerText || node.value || '').trim()));
        const classroom = (query && /教室|教学楼/.test(text)) || [...document.querySelectorAll('table')].some(table => visible(table) && /教室/.test(table.innerText) && /星期|周[一二三四五六日]|[一二三四五六日][（(]\d/.test(table.innerText));
        // 只返回布尔值，不回传整页、身份信息或表单值。
        return { password, denied, challenge, portal, classroom };
      }),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000); })
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function detectConnection(pages) {
  const candidates = [];
  for (const page of pages.slice(-12)) {
    const frames = typeof page.frames === 'function' ? page.frames() : [page];
    for (const frame of frames.slice(0, 12)) {
      const location = officialPage(frame.url());
      if (!location) continue;
      const service = portalPage(frame.url()) ? 'portal' : classroomLocation(frame.url()) ? 'classrooms' : null;
      if (service) candidates.push({ page, frame, location, service });
    }
  }
  const observations = await Promise.all(candidates.slice(0, 32).map(async item => ({ ...item, features: await inspectAuthentication(item.frame) })));
  const services = { portal: 'not_observed', classrooms: 'not_observed' };
  let portal = null, classroom = null, proxy = false;
  const diagnostics = [];
  for (const { page, location, service, features } of observations) {
    const denied = features && (features.password || features.denied || features.challenge);
    const verified = Boolean(features && !denied && (service === 'portal' ? features.portal : features.classroom));
    const state = verified ? 'authenticated' : denied ? 'login_required' : 'unconfirmed';
    if (verified || services[service] !== 'authenticated') services[service] = state;
    if (verified) { if (service === 'portal') portal = page; else classroom = page; proxy ||= location.proxy; }
    diagnostics.push({ service, host: location.host, path: location.safePath, status: state });
  }
  return { services, portal, classroom, proxy, diagnostics: diagnostics.slice(0, 12) };
}
