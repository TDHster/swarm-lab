// A lampshade grown by slime mould. No DOM here (runs in Node too).
//
// The shade is a sheet rolled into a cylinder. Its unrolled surface is a grid (RES mm per cell) that wraps around
// left-right. Jones' Physarum agents crawl on it, leaving trail; the trail becomes the material and the gaps become
// cut-outs. Then the pattern is made buildable: ribs widened to a minimum width, solid rims at the top and bottom,
// a solid seam to glue, tiny holes filled in, and loose islands (not joined to the rims) removed - they would fall
// out when cut.

const RES = 2;   // mm per cell

class Shade {
  // params: { diam (cm), height (cm), agents, sensorAngle, sensorDist, turnAngle, decay (%) }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    this.w = Math.round(Math.PI * params.diam * 10 / RES);
    this.h = Math.round(params.height * 10 / RES);
    this.trail = new Float32Array(this.w * this.h);
    this.tmp = new Float32Array(this.w * this.h);
    const n = params.agents;
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.a = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = rng() * this.w; this.y[i] = rng() * this.h; this.a[i] = rng() * Math.PI * 2; }
    this.steps = 0;
  }

  step() {
    const p = this.p, w = this.w, h = this.h, T = this.trail, rng = this.rng;
    const sa = p.sensorAngle * Math.PI / 180, ra = p.turnAngle * Math.PI / 180, so = p.sensorDist;
    const at = (x, y) => {
      x = x | 0; y = y | 0;
      if (y < 0 || y >= h) return -1;   // above and below the sheet: nothing to follow
      return T[y * w + ((x % w) + w) % w];
    };
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i], y = this.y[i];
      let a = this.a[i];
      const F = at(x + Math.cos(a) * so, y + Math.sin(a) * so);
      const L = at(x + Math.cos(a - sa) * so, y + Math.sin(a - sa) * so);
      const R = at(x + Math.cos(a + sa) * so, y + Math.sin(a + sa) * so);
      if (F > L && F > R) { /* straight on */ }
      else if (F < L && F < R) a += rng() < 0.5 ? -ra : ra;
      else if (L < R) a += ra;
      else if (R < L) a -= ra;
      let nx = x + Math.cos(a), ny = y + Math.sin(a);
      if (ny < 0 || ny >= h) { a = -a; ny = Math.min(h - 0.01, Math.max(0, y)); }   // bounce off the rims
      nx = (nx + w) % w;
      this.x[i] = nx; this.y[i] = ny; this.a[i] = a;
      T[(ny | 0) * w + (nx | 0)] += 5;
    }
    // Diffuse (3 × 3 mean, wrapping left-right) and decay.
    const keep = 1 - p.decay / 100, D = this.tmp;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { s += T[yy * w + (x + dx + w) % w]; c++; }
      }
      D[y * w + x] = s / c * keep;
    }
    this.trail.set(D);
    this.steps++;
  }
}

// Dilation radius (cells) for a wanted minimum rib (mm); the real minimum is (2r + 1) · RES.
function ribRadius(minRib) { return Math.max(0, Math.ceil((minRib / RES - 1) / 2)); }

// From trail to a buildable cut pattern. opts: { open (share of the area to cut, before the clean-up),
// minRib (mm), minHole (mm²), rim (mm), seam (mm) }. Returns { mask (1 = material), w, h, stats }.
function makeMask(shade, opts) {
  const { w, h, trail } = shade, n = w * h;
  // Threshold at the quantile that leaves `open` of the area as gaps.
  const sorted = Float32Array.from(trail).sort();
  const thr = sorted[Math.min(n - 1, Math.floor(opts.open * n))];
  let mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) mask[k] = trail[k] >= thr ? 1 : 0;
  // Widen every rib: dilate by a disc of radius r, so ribs become at least 2r + 1 cells wide.
  const r = ribRadius(opts.minRib);
  if (r > 0) {
    const out = new Uint8Array(n), disc = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) disc.push([dx, dy]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (const [dx, dy] of disc) { const yy = y + dy; if (yy >= 0 && yy < h) out[yy * w + (x + dx + w) % w] = 1; }
    }
    mask = out;
  }
  // Rims and the glue seam are solid.
  const rim = Math.round(opts.rim / RES), seam = Math.round(opts.seam / RES);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y < rim || y >= h - rim || x < seam) mask[y * w + x] = 1;
  // Corner pinches (a 2 × 2 chequer: material touching material only at a corner) are zero-width joints that would
  // tear: fill them.
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) {
      const a = y * w + x, b = y * w + (x + 1) % w, c = a + w, d = b + w;
      if (mask[a] === mask[d] && mask[b] === mask[c] && mask[a] !== mask[b]) { mask[a] = mask[b] = mask[c] = mask[d] = 1; changed = true; }
    }
  }
  // Material not joined to the rims (8-connected) would fall out: remove it.
  const seen = new Uint8Array(n), stack = [];
  for (let x = 0; x < w; x++) { stack.push(x); seen[x] = 1; }
  while (stack.length) {
    const c = stack.pop(), x = c % w, y = (c - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      const q = ny * w + (x + dx + w) % w;
      if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
    }
  }
  let islands = 0;
  for (let k = 0; k < n; k++) if (mask[k] && !seen[k]) { mask[k] = 0; islands++; }
  // Components of gaps (4-connected; the seam stops wrapping): fill the small ones.
  const label = new Int32Array(n).fill(-1), holes = [];
  const minHole = opts.minHole / (RES * RES);
  for (let s = 0; s < n; s++) {
    if (mask[s] || label[s] >= 0) continue;
    const id = holes.length, stack = [s], cells = [];
    label[s] = id;
    while (stack.length) {
      const c = stack.pop(); cells.push(c);
      const x = c % w, y = (c - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (ny < 0 || ny >= h) continue;
        const q = ny * w + (nx + w) % w;
        if (!mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    holes.push(cells);
  }
  let filled = 0;
  for (const cells of holes) if (cells.length < minHole) { for (const c of cells) mask[c] = 1; filled++; }
  let open = 0;
  for (let k = 0; k < n; k++) if (!mask[k]) open++;
  const holeCount = holes.length - filled;
  return { mask, w, h, stats: { open: open / n, holes: holeCount, filled, islandCells: islands } };
}

// Outlines of the cut-outs as closed polygons (in cells), traced along cell edges and then smoothed.
function outlines(m) {
  const { mask, w, h } = m, hole = (x, y) => x >= 0 && x < w && y >= 0 && y < h && !mask[y * w + x];
  // Directed edges with the hole on the left; keyed by their start vertex.
  const out = new Map(), key = (x, y) => y * (w + 1) + x;
  const add = (x0, y0, x1, y1) => { const k = key(x0, y0); if (!out.has(k)) out.set(k, []); out.get(k).push([x1, y1]); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hole(x, y)) continue;
    if (!hole(x, y - 1)) add(x + 1, y, x, y);
    if (!hole(x, y + 1)) add(x, y + 1, x + 1, y + 1);
    if (!hole(x - 1, y)) add(x, y, x, y + 1);
    if (!hole(x + 1, y)) add(x + 1, y + 1, x + 1, y);
  }
  const loops = [];
  for (const [k0, list] of out) {
    while (list.length) {
      const loop = [];
      let x = k0 % (w + 1), y = Math.floor(k0 / (w + 1)), px = null, py = null;
      for (let guard = 0; guard < 1e6; guard++) {
        loop.push([x, y]);
        const opts = out.get(key(x, y));
        if (!opts || !opts.length) break;
        // At a pinch point (two ways out) take the sharpest left turn, so each loop stays one hole.
        let pick = 0;
        if (opts.length > 1 && px !== null) {
          const dx = x - px, dy = y - py;
          let best = -Infinity;
          opts.forEach(([nx, ny], i) => { const ex = nx - x, ey = ny - y, cross = dx * ey - dy * ex, dot = dx * ex + dy * ey; const sc = cross * 2 + dot; if (sc > best) { best = sc; pick = i; } });
        }
        const [nx, ny] = opts.splice(pick, 1)[0];
        px = x; py = y; x = nx; y = ny;
        if (key(x, y) === k0 && !(out.get(k0) || []).length) break;
        if (key(x, y) === k0 && loop.length > 2) break;
      }
      // Loops under one cell are tracing leftovers at diagonal pinch points, not real cut-outs.
      if (loop.length > 3) { const sm = smooth(loop); if (polygonArea(sm) >= 1) loops.push(sm); }
    }
  }
  return loops;
}

// Cell-edge outlines are staircases. First Douglas-Peucker with 0.7 cells turns the stairs into straight slopes,
// then Chaikin corner cutting (three times) rounds the corners.
function smooth(pts) {
  // Split the closed loop at its first point and the point farthest from it, simplify both halves.
  let far = 0, fd = -1;
  pts.forEach((q, i) => { const d = (q[0] - pts[0][0]) ** 2 + (q[1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } });
  let p = dp(pts.slice(0, far + 1), 0.7).slice(0, -1).concat(dp(pts.slice(far).concat([pts[0]]), 0.7).slice(0, -1));
  for (let it = 0; it < 3; it++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = q;
  }
  return p;
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  let idx = 0, md = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / len;
    if (d > md) { md = d; idx = i; }
  }
  if (md <= tol) return [a, b];
  return dp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(dp(pts.slice(idx), tol));
}

function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

if (typeof module !== 'undefined') module.exports = { RES, Shade, makeMask, ribRadius, outlines, polygonArea };
