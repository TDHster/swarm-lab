// Floor plans and navigation. No DOM here (runs in Node too). Units: meters.
//
// A plan: wall segments, round columns, exit zones (rectangles - a person who steps in is out),
// areas where people stand at the start, and for open scenarios - flows with a fixed direction.
// Navigation: a distance-to-exit map on a 10 cm grid; people walk "downhill" on it.

const WORLD_W = 30;
const WORLD_H = 17.5;
const NAV_CELL = 0.1;
const NAV_CLEARANCE = 0.25;   // paths keep this far from walls (cells closer are allowed, but expensive)

function makePlan() {
  return { walls: [], columns: [], exits: [], spawns: [], flows: null, periodic: false };
}

function rectWalls(x0, y0, x1, y1, gaps) {
  // Room outline with door gaps: gaps = [{ side: 'right'|'left'|'top'|'bottom', at, width }]
  const walls = [];
  const side = (name, ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
    const cuts = gaps.filter(g => g.side === name).map(g => [g.at - g.width / 2, g.at + g.width / 2]).sort((a, b) => a[0] - b[0]);
    let t = 0;
    for (const [c0, c1] of cuts) {
      if (c0 > t) walls.push({ x1: ax + ux * t, y1: ay + uy * t, x2: ax + ux * c0, y2: ay + uy * c0 });
      t = c1;
    }
    if (t < len) walls.push({ x1: ax + ux * t, y1: ay + uy * t, x2: bx, y2: by });
  };
  // Positions along a side are measured from its first corner: top/bottom from the left, left/right from the top.
  side('top', x0, y0, x1, y0);
  side('bottom', x0, y1, x1, y1);
  side('left', x0, y0, x0, y1);
  side('right', x1, y0, x1, y1);
  return walls;
}

// opts: { count, door, column, aware } - only the ones a scenario uses.
function makeScenario(name, opts) {
  const p = makePlan();
  if (name === 'hall') {
    // A hall 15 x 12 m with one door in the right wall.
    const x0 = 3, y0 = 2.75, x1 = 18, y1 = 14.75, cy = (y0 + y1) / 2;
    p.walls = rectWalls(x0, y0, x1, y1, [{ side: 'right', at: cy - y0, width: opts.door }]);
    p.exits.push({ x0: x1 + 0.6, y0: cy - 2, x1: x1 + 2, y1: cy + 2, label: 'дверь' });
    p.spawns.push({ x0: x0 + 0.5, y0: y0 + 0.5, x1: x1 - 2, y1: y1 - 0.5, count: opts.count, target: -1 });
    // Slightly off the door axis, with room to pass between it and the wall (Helbing et al. 2000).
    if (opts.column) p.columns.push({ x: x1 - 1.6, y: cy + 0.3, r: 0.4 });
  } else if (name === 'two') {
    // A hall 20 x 13 m: the main door in the right wall (everyone knows it),
    // a spare door in the top wall near the far corner (only some know it).
    const x0 = 2, y0 = 2.5, x1 = 22, y1 = 15.5, cy = (y0 + y1) / 2;
    p.walls = rectWalls(x0, y0, x1, y1, [
      { side: 'right', at: cy - y0, width: opts.door },
      { side: 'top', at: 3, width: opts.door },
    ]);
    p.exits.push({ x0: x1 + 0.6, y0: cy - 2, x1: x1 + 2, y1: cy + 2, label: 'главный' });
    p.exits.push({ x0: x0 + 1, y0: y0 - 2, x1: x0 + 5, y1: y0 - 0.6, label: 'запасной' });
    p.spawns.push({ x0: x0 + 0.5, y0: y0 + 0.5, x1: x1 - 0.5, y1: y1 - 0.5, count: opts.count, target: -1, aware: opts.aware });
  } else if (name === 'corridor') {
    // A corridor 4 m wide, endless (the ends are glued), half walk right, half walk left.
    const ya = WORLD_H / 2 - 2, yb = WORLD_H / 2 + 2;
    p.periodic = true;
    p.walls = [{ x1: -1, y1: ya, x2: WORLD_W + 1, y2: ya }, { x1: -1, y1: yb, x2: WORLD_W + 1, y2: yb }];
    p.flows = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
    p.spawns.push({ x0: 0, y0: ya + 0.4, x1: WORLD_W, y1: yb - 0.4, count: opts.count, flows: [0, 1] });
  } else if (name === 'crossing') {
    // Two crowds cross at a right angle on an open square (edges glued both ways).
    p.periodic = true;
    p.flows = [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }];
    p.spawns.push({ x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H, count: opts.count, flows: [0, 1] });
  }
  return p;
}

// ---- navigation ------------------------------------------------------------------------------

function segDist(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - s.x1) * dx + (py - s.y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
  return { d: Math.hypot(px - cx, py - cy), cx, cy };
}

// Tiny binary heap of [cost, cell] for Dijkstra.
class Heap {
  constructor() { this.c = []; this.k = []; }
  push(cost, cell) {
    const c = this.c, k = this.k;
    let i = c.length;
    c.push(cost); k.push(cell);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p]; k[i] = k[p]; i = p;
    }
    c[i] = cost; k[i] = cell;
  }
  pop() {
    const c = this.c, k = this.k, top = k[0], lastC = c.pop(), lastK = k.pop();
    if (c.length) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= c.length) break;
        if (m + 1 < c.length && c[m + 1] < c[m]) m++;
        if (c[m] >= lastC) break;
        c[i] = c[m]; k[i] = k[m]; i = m;
      }
      c[i] = lastC; k[i] = lastK;
    }
    return top;
  }
  get size() { return this.c.length; }
}

// Per-cell cost: walls and columns are solid; a band of NAV_CLEARANCE around them is passable but
// 6x as expensive, so paths go through the middle of doors and corridors.
function navCosts(plan) {
  const W = Math.round(WORLD_W / NAV_CELL), H = Math.round(WORLD_H / NAV_CELL);
  const cost = new Float32Array(W * H).fill(1);
  const mark = (cx, cy, reach, fn) => {
    const r = Math.ceil(reach / NAV_CELL) + 1;
    const i0 = Math.max(0, Math.floor(cx / NAV_CELL) - r), i1 = Math.min(W - 1, Math.floor(cx / NAV_CELL) + r);
    const j0 = Math.max(0, Math.floor(cy / NAV_CELL) - r), j1 = Math.min(H - 1, Math.floor(cy / NAV_CELL) + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j, (i + 0.5) * NAV_CELL, (j + 0.5) * NAV_CELL);
  };
  const apply = (i, j, d) => {
    const k = j * W + i;
    if (d < 0.06) cost[k] = Infinity;
    else if (d < NAV_CLEARANCE) cost[k] = Math.max(cost[k], 6);
  };
  for (const s of plan.walls) {
    // Walk along the segment in steps and mark the cells around each point.
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), n = Math.max(1, Math.ceil(len / (NAV_CLEARANCE)));
    for (let q = 0; q <= n; q++) {
      const px = s.x1 + (s.x2 - s.x1) * q / n, py = s.y1 + (s.y2 - s.y1) * q / n;
      mark(px, py, NAV_CLEARANCE, (i, j, x, y) => apply(i, j, segDist(x, y, s).d));
    }
  }
  for (const c of plan.columns) mark(c.x, c.y, c.r + NAV_CLEARANCE, (i, j, x, y) => apply(i, j, Math.hypot(x - c.x, y - c.y) - c.r));
  return { W, H, cost };
}

// Distance (in meters, weighted by cost) from every cell to the nearest of the given exits,
// and the walking direction in every cell (minus the gradient of that distance).
function buildNavField(plan, exitIds, costs) {
  const { W, H, cost } = costs || navCosts(plan);
  const dist = new Float64Array(W * H).fill(Infinity);   // Float32 rounding makes "nd < dist" loop forever
  const heap = new Heap();
  for (const id of exitIds) {
    const e = plan.exits[id];
    for (let j = Math.max(0, Math.floor(e.y0 / NAV_CELL)); j < Math.min(H, Math.ceil(e.y1 / NAV_CELL)); j++) {
      for (let i = Math.max(0, Math.floor(e.x0 / NAV_CELL)); i < Math.min(W, Math.ceil(e.x1 / NAV_CELL)); i++) {
        const k = j * W + i;
        if (cost[k] === Infinity) continue;
        dist[k] = 0;
        heap.push(0, k);
      }
    }
  }
  // 16 neighbors (including knight moves) make distances close to straight-line ones.
  const moves = [];
  for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, 2], [2, 1]]) {
    for (const [si, sj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const m = [di * si, dj * sj];
      if (!moves.some(q => q[0] === m[0] && q[1] === m[1])) moves.push(m);
      const t = [dj * si, di * sj];
      if (!moves.some(q => q[0] === t[0] && q[1] === t[1])) moves.push(t);
    }
  }
  const moveLen = moves.map(([a, b]) => Math.hypot(a, b) * NAV_CELL);
  while (heap.size) {
    const k = heap.pop(), d = dist[k];
    const i = k % W, j = (k - i) / W;
    for (let m = 0; m < moves.length; m++) {
      const ni = i + moves[m][0], nj = j + moves[m][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (cost[nk] === Infinity) continue;
      // Knight moves must not jump over a solid cell.
      if (Math.abs(moves[m][0]) + Math.abs(moves[m][1]) === 3) {
        const mi = i + Math.sign(moves[m][0]) * (Math.abs(moves[m][0]) === 2 ? 1 : 0);
        const mj = j + Math.sign(moves[m][1]) * (Math.abs(moves[m][1]) === 2 ? 1 : 0);
        if (cost[mj * W + mi] === Infinity) continue;
      }
      const nd = d + moveLen[m] * (cost[k] + cost[nk]) / 2;
      if (nd < dist[nk]) { dist[nk] = nd; heap.push(nd, nk); }
    }
  }
  // Direction: minus the gradient, central differences where both neighbors are reachable.
  const dirX = new Float32Array(W * H), dirY = new Float32Array(W * H);
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? Infinity : dist[j * W + i];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i, d = dist[k];
      if (!Number.isFinite(d)) continue;
      const slope = (a, b) => {
        const fa = Number.isFinite(a), fb = Number.isFinite(b);
        if (fa && fb) return (b - a) / 2;
        if (fb) return b - d;
        if (fa) return d - a;
        return 0;
      };
      const gx = slope(at(i - 1, j), at(i + 1, j)), gy = slope(at(i, j - 1), at(i, j + 1));
      const g = Math.hypot(gx, gy);
      if (g > 0) { dirX[k] = -gx / g; dirY[k] = -gy / g; }
    }
  }
  return { W, H, dist, dirX, dirY };
}

// Walking direction at a point (bilinear blend of the four nearest cells), written into out.
function navDirection(field, x, y, out) {
  const { W, H, dirX, dirY } = field;
  const fx = x / NAV_CELL - 0.5, fy = y / NAV_CELL - 0.5;
  let i = Math.floor(fx), j = Math.floor(fy);
  const u = fx - i, v = fy - j;
  let ax = 0, ay = 0;
  for (const [di, dj, w] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]]) {
    const ii = Math.min(W - 1, Math.max(0, i + di)), jj = Math.min(H - 1, Math.max(0, j + dj));
    ax += dirX[jj * W + ii] * w;
    ay += dirY[jj * W + ii] * w;
  }
  const n = Math.hypot(ax, ay);
  if (n > 1e-6) { out[0] = ax / n; out[1] = ay / n; } else { out[0] = 0; out[1] = 0; }
}

if (typeof module !== 'undefined') {
  module.exports = { WORLD_W, WORLD_H, NAV_CELL, makePlan, makeScenario, rectWalls, segDist, navCosts, buildNavField, navDirection };
}
