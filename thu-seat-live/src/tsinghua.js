/**
 * 清华大学图书馆座位数据源客户端
 *
 * 数据来源：https://seat.lib.tsinghua.edu.cn/api.php/v3areas
 *   - 单次请求返回全馆区域树（133 个节点，depth 0/1/2）
 *   - 每个节点字段：
 *       TotalCount        该区域座位总数
 *       UnavailableSpace  当前不可用座位数（已选座 / 已预约 / 临时离开锁定）
 *       isValid           该区域是否开放
 *       webhidden         是否在官网网页端隐藏
 *       type              1 = 阅览区（叶子）
 *       parentId          父级区域 id
 *
 * 注意：本客户端只做只读聚合，不实现登录 / 选座 / 退座等写操作。
 */

const API_BASE = 'https://seat.lib.tsinghua.edu.cn/api.php';
const AREA_TREE_URL = `${API_BASE}/v3areas`;
const AREA_URL = (id) => `${API_BASE}/v3areas/${id}`;
const AREA_URL_DAY = (id, day) => `${API_BASE}/v3areas/${id}/date/${day}`;

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://seat.lib.tsinghua.edu.cn/home/web/f_second',
  'X-Requested-With': 'XMLHttpRequest',
};

/** 网页端可正常使用的分馆（由 `webhidden === 0` 的根节点决定，此处作为兜底白名单） */
const KNOWN_LIBRARIES = [35, 64, 89, 6, 19, 29];

class UpstreamError extends Error {
  constructor(message, { status, url, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.url = url;
    if (cause) this.cause = cause;
  }
}

async function requestJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    const elapsedMs = Date.now() - startedAt;
    const buf = Buffer.from(await res.arrayBuffer());
    const text = new TextDecoder('utf-8').decode(buf);
    if (!res.ok) {
      throw new UpstreamError(`上游返回 HTTP ${res.status}`, { status: res.status, url });
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UpstreamError('上游返回内容不是合法 JSON', { status: res.status, url });
    }
    if (!json || json.status !== 1) {
      throw new UpstreamError(`上游业务状态异常：${json && json.msg ? json.msg : '未知'}`, {
        status: res.status,
        url,
      });
    }
    return { json, elapsedMs, status: res.status };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new UpstreamError(`请求超时（${timeoutMs}ms）`, { url });
    }
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(`网络请求失败：${err.message}`, { url, cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓取全量区域树（含每层实时座位数），一次请求即可完成整站采集。
 * @returns {Promise<{ fetchedAt:number, elapsedMs:number, nodes:Array, byId:Map }>}
 */
async function fetchAreaTree({ timeoutMs = 15000 } = {}) {
  const startedAt = Date.now();
  const { json, elapsedMs } = await requestJson(AREA_TREE_URL, { timeoutMs });
  const list = json?.data?.list;
  const raw = Array.isArray(list?.childArea) ? list.childArea : [];
  if (!raw.length) {
    throw new UpstreamError('上游区域树为空，可能是接口结构变化');
  }
  const nodes = raw.map((n) => ({
    id: Number(n.id),
    name: String(n.name ?? '').trim(),
    enname: n.enname ? String(n.enname).trim() : '',
    parentId: Number(n.parentId ?? 0),
    type: Number(n.type ?? 0),
    isValid: Number(n.isValid ?? 0) === 1,
    webhidden: Number(n.webhidden ?? 0) === 1,
    total: Math.max(0, Number(n.TotalCount ?? 0) || 0),
    unavailable: Math.max(0, Number(n.UnavailableSpace ?? 0) || 0),
  }));
  // 已占用数不得超过总数，上游偶发脏数据时收敛
  for (const n of nodes) {
    if (n.unavailable > n.total) n.unavailable = n.total;
  }
  return {
    fetchedAt: Date.now(),
    elapsedMs,
    requestMs: elapsedMs,
    wallMs: Date.now() - startedAt,
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
  };
}

/** 单馆视图接口：支持指定日期（用于「明日预约情况」等扩展场景） */
async function fetchArea(areaId, day, { timeoutMs = 15000 } = {}) {
  const url = day ? AREA_URL_DAY(areaId, day) : AREA_URL(areaId);
  const { json, elapsedMs } = await requestJson(url, { timeoutMs });
  return { list: json?.data?.list ?? null, elapsedMs };
}

/** 可选日期列表（今日 / 明日） */
async function fetchAreaDays(areaId, { timeoutMs = 12000 } = {}) {
  const url = `${API_BASE}/v3areadays/${areaId}`;
  const { json, elapsedMs } = await requestJson(url, { timeoutMs });
  const list = json?.data?.list ?? [];
  return {
    days: list.map((d) => String(d?.day?.date ?? '').slice(0, 10)).filter(Boolean),
    elapsedMs,
  };
}

module.exports = {
  API_BASE,
  KNOWN_LIBRARIES,
  UpstreamError,
  fetchAreaTree,
  fetchArea,
  fetchAreaDays,
};
