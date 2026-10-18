/**
 * 把清华座位系统的扁平区域树聚合成「分馆 → 楼层 → 阅览区」三级视图。
 *
 * 聚合规则（与官网 f_second 页面的口径保持一致）：
 *   楼层座位数 = 该楼层下所有 isValid 的阅览区座位数之和
 *   （注意：楼层节点自带的 TotalCount 可能包含 isValid=0 的旧区域，直接相减会偏大，
 *    例：北馆二层 楼层节点 280 vs 有效阅览区 312（含 E 区 24 + 连廊 8 已停用），
 *    因此一律以有效叶子节点重新累加。）
 */

const STATUS = {
  OPEN: 'open', // 开放
  FULL: 'full', // 已满
  CLOSED: 'closed', // 未开放 / 暂停使用
  NO_SEATS: 'no_seats', // 开放但当前无可用座位数据
};

function rate(occupied, total) {
  if (!total || total <= 0) return 0;
  const r = occupied / total;
  return r > 1 ? 1 : r < 0 ? 0 : r;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {Array} nodes  fetchAreaTree().nodes
 * @returns {{libraries:Array, summary:Object, issues:Array}}
 */
function buildDashboard(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map();
  for (const n of nodes) {
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
    childrenOf.get(n.parentId).push(n);
  }

  const issues = [];
  const libraries = [];

  const roots = (childrenOf.get(0) ?? [])
    .filter((n) => !n.webhidden && n.isValid)
    .sort((a, b) => a.id - b.id);

  for (const root of roots) {
    const floorNodes = (childrenOf.get(root.id) ?? []).filter((n) => !n.webhidden);

    const floors = [];
    for (const f of floorNodes) {
      const leaves = (childrenOf.get(f.id) ?? []).filter(
        (n) => n.type === 1 && n.isValid && !n.webhidden,
      );
      if (!leaves.length) continue; // 没有任何有效阅览区的楼层不展示

      let total = 0;
      let occupied = 0;
      const areas = leaves.map((a) => {
        total += a.total;
        occupied += a.unavailable;
        return {
          id: a.id,
          name: a.name,
          enname: a.enname,
          total: a.total,
          occupied: a.unavailable,
          available: Math.max(0, a.total - a.unavailable),
          rate: rate(a.unavailable, a.total),
          status: a.total > 0 ? (a.unavailable >= a.total ? STATUS.FULL : STATUS.OPEN) : STATUS.NO_SEATS,
        };
      });
      areas.sort((x, y) => x.id - y.id);

      // 楼层节点自带的口径若与累加值不同，记录下来便于排查（不影响最终结果）
      if (f.total > 0 && f.total !== total) {
        issues.push({
          level: 'floor',
          areaId: f.id,
          name: `${root.name} / ${f.name}`,
          reportedByFloor: f.total,
          summedFromAreas: total,
          note: '楼层 TotalCount 与有效阅览区累加不一致，已采用有效阅览区累加值',
        });
      }

      const available = Math.max(0, total - occupied);
      floors.push({
        id: f.id,
        name: f.name,
        enname: f.enname,
        total,
        occupied,
        available,
        rate: rate(occupied, total),
        status:
          total > 0 ? (available === 0 ? STATUS.FULL : STATUS.OPEN) : STATUS.NO_SEATS,
        areas,
      });
    }

    if (!floors.length) continue; // 没有可用楼层的分馆（如古籍室等）不展示

    let total = 0;
    let occupied = 0;
    for (const f of floors) {
      total += f.total;
      occupied += f.occupied;
    }
    if (total <= 0) continue;

    const available = Math.max(0, total - occupied);
    libraries.push({
      id: root.id,
      name: root.name,
      enname: root.enname,
      total,
      occupied,
      available,
      rate: rate(occupied, total),
      status: available === 0 ? STATUS.FULL : STATUS.OPEN,
      floorCount: floors.length,
      floors,
    });
  }

  libraries.sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate;
    return b.total - a.total;
  });

  let total = 0;
  let occupied = 0;
  let areaCount = 0;
  for (const lib of libraries) {
    total += lib.total;
    occupied += lib.occupied;
    areaCount += lib.floors.reduce((s, f) => s + f.areas.length, 0);
  }

  return {
    libraries,
    issues,
    summary: {
      total,
      occupied,
      available: Math.max(0, total - occupied),
      rate: rate(occupied, total),
      ratePct: round1(rate(occupied, total) * 100),
      libraryCount: libraries.length,
      floorCount: libraries.reduce((s, l) => s + l.floors.length, 0),
      areaCount,
      fullLibraries: libraries.filter((l) => l.available === 0).length,
      emptyLibraries: libraries.filter((l) => l.occupied === 0).length,
    },
  };
}

module.exports = { buildDashboard, STATUS, rate };
