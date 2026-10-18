import { classroomLocation, officialPage } from './official-pages.mjs';
export const CLASSROOM_URL = 'https://zhjw.cic.tsinghua.edu.cn/pk.classroomctrl.do';

export function isClassroomUrl(value) {
  return classroomLocation(value);
}

export function isClassroomFrame(value) {
  return classroomLocation(value);
}

export function parseClassroomTables(tables, observedAt) {
  const header = tables.flatMap(table => table.rows).find(row => row.length === 8 && row.slice(1).every(cell => cell.colSpan === 6 && /[一二三四五六日天]\s*[（(]\d{1,2}\.\d{1,2}[）)]/.test(cell.text)));
  const observed = new Date(observedAt);
  const days = header ? header.slice(1).map((cell, dayIndex) => {
    const match = cell.text.match(/([一二三四五六日天])\s*[（(](\d{1,2})\.(\d{1,2})[）)]/);
    const monthDay = `${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    const expectedWeekday = (dayIndex + 1) % 7;
    const labelWeekday = '一二三四五六日'.indexOf(match[1] === '天' ? '日' : match[1]);
    const candidates = [observed.getUTCFullYear()-1, observed.getUTCFullYear(), observed.getUTCFullYear()+1].map(year => `${year}-${monthDay}`).filter(date => {
      const value = new Date(`${date}T04:00:00Z`);
      return labelWeekday === dayIndex && !Number.isNaN(value.valueOf()) && value.toISOString().slice(0,10) === date && value.getUTCDay() === expectedWeekday && Math.abs(value.valueOf() - observed.valueOf()) <= 21 * 86400000;
    });
    return { label: cell.text, monthDay, date: candidates.length === 1 ? candidates[0] : null, weekday: dayIndex+1 };
  }) : [];
  const grid = tables.find(table => table.rows.some(row => row.length === 43 && /[:：]\s*\d+\s*[（(]人[）)]/.test(row[0].text)));
  const records = [];
  let rejectedRows = 0;
  for (const row of grid?.rows || []) {
    if (row.length !== 43) { rejectedRows++; continue; }
    const identity = row[0].text.match(/^(.+?)\s*[:：]\s*(\d+)\s*[（(]人[）)]$/);
    if (!identity || row.some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1)) { rejectedRows++; continue; }
    const periods = row.slice(1).map((cell, index) => {
      // 仅解析官方 title 中的明确状态；不由颜色或空白推断。
      const status = cell.title === '空闲' ? '空闲' : cell.title.match(/[,，]\s*(有课|考试|借用|屏蔽|预约|已约)\s*$/)?.[1] || '待核实';
      return { dayIndex: Math.floor(index/6), period: index%6+1, status };
    });
    records.push({ name: identity[1].trim(), reportedCapacity: Number(identity[2]), capacity: Number(identity[2]) > 0 ? Number(identity[2]) : null, periods, selfStudyAllowed: null, currentSeats: null, power: null });
  }
  return { days, records, rejectedRows, dateBasis: '页面月日与星期交叉核验，并限定在采集日期前后21天内；不推算学期起始日', periodClockTimes: null };
}

export async function inspectClassroom(page) {
  const result = { status: 'page_not_found', source: CLASSROOM_URL, observedAt: new Date().toISOString(), controls: [], tables: [], records: [], legend: [], message: '尚未读取到已认证的教室查询页。', queryReady: false, availabilityReady: false };
  if (!page || page.isClosed()) return result;
  const frames = page.frames().filter(frame => isClassroomFrame(frame.url()));
  result.frameSummary = [];
  if (!frames.length) {
    try {
      const url = new URL(page.url());
      if (url.hostname === 'zhjw.cic.tsinghua.edu.cn' && /timeout|login/i.test(url.pathname)) { result.status = 'login_required'; result.message = '教务系统提示登录超时或内容不存在；需要经门户授权进入，不能直接匿名查询。'; }
    } catch {}
    return result;
  }
  for (const frame of frames) {
    const data = await frame.evaluate(() => {
      const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
      const text = value => String(value || '').replace(/\s+/g, ' ').trim();
      const controls = [...document.querySelectorAll('select,input:not([type=hidden]):not([type=password]),button')].filter(visible).slice(0, 45).map((node, index) => ({
        index, tag: node.tagName.toLowerCase(), type: node.type || '', id: node.id, name: node.name,
        label: text(node.labels?.[0]?.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || (node.tagName === 'BUTTON' || /button|submit/.test(node.type) ? node.innerText || node.value : '')).slice(0, 80),
        options: node.tagName === 'SELECT' ? [...node.options].slice(0, 80).map(option => ({ value: option.value, label: text(option.text), selected: option.selected })) : []
      }));
      // 仅采集教室资源表，不采集整页正文、链接令牌、隐藏表单或个人信息。
      const candidates = [...document.querySelectorAll('table')].filter(visible);
      const tables = candidates.filter(table => /教室|节次|查询结果/.test(table.innerText) || (table.rows.length > 3 && /\d+\s*[（(]人[）)]/.test(table.innerText)))
        .map(table => ({ totalRows: table.rows.length, truncated: table.rows.length > 1000, rows: [...table.rows].slice(0, 1000).map(row => [...row.cells].slice(0, 65).map(cell => ({ text: text(cell.innerText).slice(0, 100), title: text(cell.getAttribute('title')).slice(0, 100), rowSpan: cell.rowSpan, colSpan: cell.colSpan, color: getComputedStyle(cell).backgroundColor }))) })).slice(0, 6);
      const legendLabels = ['有课','考试','借用','屏蔽','空闲','预约','已约'];
      const legends = [...document.querySelectorAll('td,span,div,font')].filter(node => visible(node) && legendLabels.includes(text(node.innerText))).slice(0, 35).map(node => ({ label: text(node.innerText), color: getComputedStyle(node).backgroundColor, childColors: [...node.children].slice(0,5).map(child => getComputedStyle(child).backgroundColor) }));
      return { controls, tables, legends, tableCount: candidates.length, rowCounts: candidates.slice(0,8).map(t => t.rows.length), expired: /用户登[录陆]超时|访问内容不存在/.test(document.body.innerText) };
    });
    if (data.expired) { result.status = 'login_required'; result.message = '教务系统登录已超时；请经门户重新认证。'; return result; }
    result.controls.push(...data.controls); result.tables.push(...data.tables);
    result.frameSummary.push({ path: officialPage(frame.url()).safePath, tableCount: data.tableCount, rowCounts: data.rowCounts });
    result.legend.push(...(data.legends || []));
  }
  result.status = result.tables.length ? 'schema_observed' : 'no_results';
  result.message = result.tables.length ? '已读取教室页实际表格结构。尚未核对节次时间与状态图例，暂不生成时段可用性结论。' : '已进入教室查询页，但尚未取得资源表；请先选择条件并执行一次查询。';
  // 保存字段结构即可；资源行和图例需经实页核验后配置，不从颜色猜含义。
  result.controls = result.controls.slice(0, 45);
  result.queryReady = result.controls.some(control => control.label === '查询');
  Object.assign(result, parseClassroomTables(result.tables, result.observedAt));
  result.truncated = result.tables.some(table => table.truncated);
  if (result.records.length) {
    result.status = 'schedule_observed';
    result.message = `已读取 ${result.records.length} 个教室的官方课表状态。空闲不等于允许自习或实时有座；钟点映射另据用户提供的节次图片，课间状态待核实。${result.truncated ? '结果存在截断，不能当作完整列表。' : ''}`;
  }
  return result;
}
