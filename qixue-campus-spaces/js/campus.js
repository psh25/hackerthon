// 楼宇归类来自官方教室名称；地图点来自用户提供校园图文字，均为示意坐标而非GPS。
export const MAP_INFO = {
  image: '/assets/campus-map.jpg', width: 4370, height: 6142,
  source: '用户提供的校园地图', original: 'dd92110b70cfe5b45a630ad5b91159bb.jpg',
  sha256: '4df17f2a765fb838c8c585614072825e7ae5d02d0d543b53f0910d9114243e40',
  note: '地图地名识别后手动标注，落点为文字附近示意位置；不提供实时定位、步行距离或楼内导航。'
};
export const BUILDINGS = [
  { id: 'jiaoxue-1', name: '一教', pattern: /^一教/ },
  { id: 'jiaoxue-2', name: '二教', pattern: /^二教/ },
  { id: 'jiaoxue-3', name: '三教', pattern: /^(三教|研讨间三教)/ },
  { id: 'jiaoxue-4', name: '四教', pattern: /^(四教|研讨间四教)/ },
  { id: 'jiaoxue-5', name: '五教', pattern: /^五教/ },
  { id: 'jiaoxue-6', name: '六教', pattern: /^六教/, x: 2740, y: 3650, mapLabel: '六教学楼', mapEvidence: '放大地图文字“六教学楼”' },
  { id: 'water-old', name: '旧水利馆', pattern: /^旧水利馆/, x: 2190, y: 3760, mapLabel: '旧水利馆', mapEvidence: '地图文字“旧水利馆”' },
  { id: 'water-new', name: '新水利馆', pattern: /^新水利馆/ },
  { id: 'wenbei', name: '文北楼', pattern: /^文北楼/ },
  { id: 'mingli', name: '明理楼', pattern: /^明理楼/, x: 3005, y: 4630, mapLabel: '明理楼', mapEvidence: '地图文字“明理楼”' },
  { id: 'jianhua', name: '建华楼', pattern: /^(建华楼|建华\/经管新楼)/, x: 2630, y: 4190, mapLabel: '经管新楼', mapEvidence: '官方教室名称“建华/经管新楼”与地图“经管新楼”对应' },
  { id: 'shunde', name: '舜德楼', pattern: /^舜德\/经管西楼/, x: 2860, y: 4290, mapLabel: '经管西楼', mapEvidence: '官方教室名称“舜德/经管西楼”与地图“经管西楼”对应' },
  { id: 'law-library', name: '法律图书馆', pattern: /^法律图书馆/, x: 2540, y: 4340, mapLabel: '法律图书馆', libraryId: 6, mapEvidence: '地图文字“法律图书馆”' },
  { id: 'technology', name: '技术科学楼', pattern: /^技术科学楼/, x: 3225, y: 4630, mapLabel: '技术科学楼', mapEvidence: '地图技术科学楼文字示意，具体入口待核实' },
  { id: 'xuetang', name: '清华学堂', pattern: /^清华学堂/ },
  { id: 'humanities', name: '人文楼', pattern: /^人文楼/, x: 2565, y: 3460, mapLabel: '人文楼', mapEvidence: '地图文字“人文楼”' },
  { id: 'ziqiang', name: '自强科技楼', pattern: /^(自强科技楼|研讨间自强)/ },
  { id: 'architecture', name: '建筑馆', pattern: /^建筑馆/ },
  { id: 'west-lecture', name: '西阶梯教室', pattern: /^西阶梯教室/, x: 1910, y: 3495, mapLabel: '西阶梯教室', mapEvidence: '地图文字“西阶梯教室”' },
  { id: 'east-lecture', name: '东阶梯教室', pattern: /^东阶梯教室/ },
  { id: 'old-economics', name: '旧经管报告厅', pattern: /^旧经管报告厅/ },
  { id: 'north-library', name: '北馆', pattern: /a^/, x: 1920, y: 2940, mapLabel: '图书馆北馆（李文正馆）', libraryId: 35, mapEvidence: '地图文字“图书馆北馆／李文正馆”' }
];

export function buildingFor(room) {
  const name = typeof room === 'string' ? room : room?.name;
  if (typeof name !== 'string') return { id: 'unclassified', name: '未分类' };
  return BUILDINGS.find(item => item.pattern.test(name)) || { id: `other:${name.replace(/[0-9].*$/, '')}`, name: name.replace(/[0-9].*$/, '') || '未分类' };
}
export function groupClassrooms(records = []) {
  const groups = new Map();
  for (const room of records) {
    const building = buildingFor(room);
    if (!groups.has(building.id)) groups.set(building.id, { ...building, rooms: [] });
    groups.get(building.id).rooms.push(room);
  }
  const order = new Map(BUILDINGS.map((item, index) => [item.id, index]));
  return [...groups.values()].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || a.name.localeCompare(b.name, 'zh-CN'));
}
