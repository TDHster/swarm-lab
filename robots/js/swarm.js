// Self-assembly of a robot swarm into a shape, after the Kilobot experiment
// (Rubenstein, Cornejo & Nagpal, Science 2014). No DOM here (runs in Node too).
// Units: robot radius = 1 (robots are discs of diameter 2). y grows downward like on the screen.
//
// Every robot only sees neighbors within COMM and measures distances to them (with noise). It knows:
//   gradient     - hop count from the four seed robots (min over stationary neighbors + 1);
//   position     - estimated from distances to neighbors that already know theirs (trilateration);
//   the shape    - the same picture for everyone, in seed coordinates.
// A robot starts moving when its gradient is the highest around and nobody near is moving; it follows
// the edge of the group; once inside the shape it stops when the next step would leave it, or when it is
// next to a stopped robot of the same gradient. The shape fills up in layers.

const COMM = 5.5;          // communication / distance sensing range
const EDGE_GAP = 2.3;      // center distance kept while edge-following
const SPEED = 0.25;        // per step
const SEED_X = 70, SEED_Y = 50;

// Shapes in seed coordinates (u to the right, v up), in robot radii. The seed must be INSIDE the shape at its
// lower-left corner: with the seed outside (we tried a star), robots enter right at the border, stop at once
// and plug the entrance.
const SHAPES = {
  square: { label: 'квадрат', poly: [[0, 0], [26, 0], [26, 26], [0, 26]] },
  house: { label: 'домик', poly: [[0, 0], [28, 0], [28, 18], [14, 32], [0, 18]] },
  arrow: { label: 'стрелка', poly: [[0, 0], [0, 10], [22, 10], [22, 20], [40, 5], [22, -10], [22, 0]] },
  letter: { label: 'буква К', poly: [[0, 0], [7, 0], [7, 12], [20, 0], [29, 0], [13, 15], [29, 30], [20, 30], [7, 18], [7, 30], [0, 30]] },
};

function inPolygon(poly, u, v) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

class Swarm {
  // params: { count, shape, noise (relative distance error), seed }
  constructor(params, rng) {
    this.p = params;
    this.reset(rng);
  }

  inShape(x, y) {
    return inPolygon(SHAPES[this.p.shape].poly, x - SEED_X, SEED_Y - y);
  }

  reset(rng) {
    this.rng = rng;
    const robots = [];
    // Four seed robots at the origin: their positions are known exactly.
    for (const [u, v] of [[0, 0], [2, 0], [1, 1.73], [3, 1.73]]) robots.push({ x: SEED_X + u + 1, y: SEED_Y - v - 1, state: 'seed' });
    // The rest: a hexagonally packed blob to the left of the seed, touching it.
    const n = this.p.count, rows = Math.ceil(Math.sqrt(n * 1.3));
    let placed = 0;
    for (let col = 0; placed < n; col++) {
      for (let row = 0; row < rows && placed < n; row++) {
        const x = SEED_X - 1 - col * 1.732, y = SEED_Y - rows + 2 + row * 2 + (col % 2);
        robots.push({ x, y, state: 'wait' });
        placed++;
      }
    }
    this.r = robots.map((b, id) => ({
      ...b, id, ex: b.state === 'seed' ? b.x : NaN, ey: b.state === 'seed' ? b.y : NaN,
      localized: b.state === 'seed', grad: b.state === 'seed' ? 0 : Infinity, inside: false,
    }));
    this.steps = 0;
    this.lastJoin = 0;
  }

  neighbors(a) {
    const out = [];
    for (const b of this.r) if (b !== a && (b.x - a.x) ** 2 + (b.y - a.y) ** 2 <= COMM * COMM) out.push(b);
    return out;
  }

  // Measured distance: the true one with a relative error; `times` measurements averaged.
  measure(a, b, times = 1) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    let e = 0;
    for (let k = 0; k < times; k++) e += this.rng() * 2 - 1;
    return d * (1 + this.p.noise * e / times);
  }

  // Hop-count gradient over stationary robots, from the seed (breadth-first, as messages would spread).
  updateGradient() {
    const still = this.r.filter(b => b.state !== 'move');
    for (const b of still) if (b.state !== 'seed') b.grad = Infinity;
    const queue = still.filter(b => b.state === 'seed');
    while (queue.length) {
      const a = queue.shift();
      for (const b of still) {
        if (b.grad <= a.grad + 1) continue;
        if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 > COMM * COMM) continue;
        b.grad = a.grad + 1;
        queue.push(b);
      }
    }
  }

  // Trilateration: from distances d_i to neighbors at known (x_i, y_i), subtracting the circle equations
  // pairwise gives a linear system; solve it by least squares. Unique unless the neighbors stand in a line -
  // then the robot waits (a guess there could land on the mirror image, and the error would spread).
  localize(a, nb) {
    const refs = nb.filter(b => b.localized && b.state !== 'move');
    if (refs.length < 3) return false;
    // A standing robot averages many measurements (it has time); a moving one gets a single one per step.
    const times = a.state === 'move' ? 1 : 8;
    const r0 = refs[0], d0 = this.measure(a, r0, times);
    let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0;
    for (let k = 1; k < refs.length; k++) {
      const b = refs[k], d = this.measure(a, b, times);
      const ax = 2 * (b.ex - r0.ex), ay = 2 * (b.ey - r0.ey);
      const rhs = d0 * d0 - d * d + b.ex * b.ex - r0.ex * r0.ex + b.ey * b.ey - r0.ey * r0.ey;
      s11 += ax * ax; s12 += ax * ay; s22 += ay * ay; t1 += ax * rhs; t2 += ay * rhs;
    }
    const det = s11 * s22 - s12 * s12;
    // Collinear (or nearly) neighbors: the smaller eigenvalue of the system is tiny.
    const tr = s11 + s22, lmin = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
    if (lmin < 4) return a.localized;
    const x = (s22 * t1 - s12 * t2) / det, y = (s11 * t2 - s12 * t1) / det;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return a.localized;
    // All neighbors are within COMM, so a solution farther than that from them is a numerical accident.
    const cx = refs.reduce((t, b) => t + b.ex, 0) / refs.length, cy = refs.reduce((t, b) => t + b.ey, 0) / refs.length;
    if (Math.hypot(x - cx, y - cy) > COMM + 1) return a.localized;
    if (a.state === 'move' && a.localized) {
      // A moving robot gets one noisy fix per step: blend it into its running estimate (which follows the
      // robot's own motion) instead of jumping to it - otherwise the estimate jitters in and out of the shape.
      a.ex += (x - a.ex) * 0.2;
      a.ey += (y - a.ey) * 0.2;
    } else {
      a.ex = x;
      a.ey = y;
    }
    a.localized = true;
    return true;
  }

  step() {
    if (this.steps % 3 === 0) this.updateGradient();
    const moving = this.r.filter(b => b.state === 'move');

    for (const a of this.r) {
      if (a.state === 'seed' || a.state === 'move') continue;
      const nb = this.neighbors(a);
      // Standing robots fix their position once. Re-estimating it again and again from each other made a loop
      // ("I from you, you from me") that blew even rounding errors up to whole robot sizes.
      if (!a.localized) this.localize(a, nb);
      // Start rule: localized, the highest gradient around (ties: higher id), nobody near is moving.
      if (a.state === 'wait' && a.localized && Number.isFinite(a.grad)) {
        let top = true;
        for (const b of nb) {
          if (b.state === 'move') { top = false; break; }
          if (b.state === 'wait' && (b.grad > a.grad || (b.grad === a.grad && b.id > a.id))) { top = false; break; }
        }
        if (top) { a.state = 'move'; a.inside = false; moving.push(a); }
      }
    }

    for (const a of moving) this.moveOne(a);
    this.steps++;
  }

  moveOne(a) {
    const nb = this.neighbors(a);
    const still = nb.filter(b => b.state !== 'move');
    // Own gradient while moving: one more than the lowest stationary neighbor.
    let gmin = Infinity;
    for (const b of still) gmin = Math.min(gmin, b.grad);
    a.grad = gmin + 1;
    // Edge following: keep EDGE_GAP to the nearest stationary robot, going around the group clockwise.
    let q = null, qd = Infinity;
    for (const b of still) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < qd) { qd = d; q = b; } }
    let dx = 0, dy = 0;
    if (q) {
      const ux = (a.x - q.x) / qd, uy = (a.y - q.y) / qd;
      dx = -uy + 1.5 * (EDGE_GAP - qd) * ux;
      dy = ux + 1.5 * (EDGE_GAP - qd) * uy;
      const m = Math.hypot(dx, dy) || 1;
      dx = dx / m * SPEED; dy = dy / m * SPEED;
    }
    // Queue politely: a moving robot right ahead means wait (pushing it only wedges both in corners).
    // Two robots heading around different neighbors can each see the other "ahead" and wait forever, with the
    // whole queue behind them (found: robots 50 and 60 at 110 robots). If we were waiting for each other,
    // the one with the smaller id goes first.
    const ahead = nb.find(b => b.state === 'move' && Math.hypot(b.x - a.x, b.y - a.y) < EDGE_GAP
      && (b.x - a.x) * dx + (b.y - a.y) * dy > 0 && !(b.waitsFor === a.id && a.id < b.id));
    if (ahead) { a.waitsFor = ahead.id; return; }
    a.waitsFor = -1;
    // Stuck in a notch for a long time: back out, away from the neighbors.
    if (this.steps - (a.progressAt ?? this.steps) > 300 && still.length) {
      const cx = still.reduce((t, b) => t + b.x, 0) / still.length, cy = still.reduce((t, b) => t + b.y, 0) / still.length;
      const m = Math.hypot(a.x - cx, a.y - cy) || 1;
      dx = (a.x - cx) / m * SPEED; dy = (a.y - cy) / m * SPEED;
      a.progressAt = this.steps - 250;   // a few steps back, then try following the edge again
    }
    // Where the robot thinks it is (odometry between position fixes).
    const ox = a.x, oy = a.y;
    if (!this.localize(a, nb) && Number.isFinite(a.ex)) { /* keep the last estimate */ }
    if (Number.isFinite(a.ex)) {
      // Stop rules only while really inside: edge-following corrections or a push can carry a robot out again,
      // and then it must keep going until it re-enters (otherwise it would park outside the shape).
      const insideNow = inPolygon(SHAPES[this.p.shape].poly, a.ex - SEED_X, SEED_Y - a.ey);
      a.inside = insideNow;
      if (insideNow) {
        const aheadIn = inPolygon(SHAPES[this.p.shape].poly, a.ex + dx * 4 - SEED_X, SEED_Y - (a.ey + dy * 4));
        const sameLayer = still.some(b => b.state !== 'wait' && b.grad >= a.grad && Math.hypot(a.x - b.x, a.y - b.y) < EDGE_GAP + 0.3);
        if (!aheadIn || sameLayer) {
          a.state = 'joined';
          this.lastJoin = this.steps;
          return;
        }
      }
    }
    a.x += dx; a.y += dy;
    // Bodies do not overlap: push out of anyone closer than a diameter.
    for (const b of nb) {
      const ddx = a.x - b.x, ddy = a.y - b.y, d = Math.hypot(ddx, ddy);
      if (d < 2 && d > 1e-6) { a.x = b.x + ddx / d * 2; a.y = b.y + ddy / d * 2; }
    }
    if (Number.isFinite(a.ex)) { a.ex += a.x - ox; a.ey += a.y - oy; }
    // Progress: moved half a radius away from where it was last time we checked.
    if (!a.mark || Math.hypot(a.x - a.mark.x, a.y - a.mark.y) > 0.5) { a.mark = { x: a.x, y: a.y }; a.progressAt = this.steps; }
  }

  stats() {
    const poly = SHAPES[this.p.shape].poly;
    let cells = 0, covered = 0, err = 0, joined = 0, inside = 0;
    const placed = this.r.filter(b => b.state === 'joined' || b.state === 'seed');
    for (let u = 0.5; u < 45; u += 1) for (let v = -15; v < 40; v += 1) {
      if (!inPolygon(poly, u, v)) continue;
      cells++;
      const x = SEED_X + u, y = SEED_Y - v;
      if (placed.some(b => (b.x - x) ** 2 + (b.y - y) ** 2 < 1.6 * 1.6)) covered++;
    }
    for (const b of this.r) {
      if (b.state !== 'joined') continue;
      joined++;
      err += Math.hypot(b.ex - b.x, b.ey - b.y);
      if (inPolygon(poly, b.x - SEED_X, SEED_Y - b.y)) inside++;
    }
    return { joined, moving: this.r.filter(b => b.state === 'move').length, fill: covered / cells,
      error: joined ? err / joined : 0, trulyInside: joined ? inside / joined : 1 };
  }
}

if (typeof module !== 'undefined') module.exports = { Swarm, SHAPES, SEED_X, SEED_Y, COMM, inPolygon };
