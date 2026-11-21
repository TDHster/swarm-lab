// Particle swarm optimization (Kennedy & Eberhart, 1995) on 2D test functions. No DOM here - the same
// code runs in the browser and in Node (tools/smoke.js). One step = one iteration of the whole swarm.

const TAU = Math.PI * 2;

// Classic test functions: all have the minimum value 0. `mins` - where the global minima are.
const FUNCTIONS = {
  sphere: {
    label: 'Сфера (одна яма)', range: [-5.12, 5.12, -5.12, 5.12], mins: [[0, 0]],
    f: (x, y) => x * x + y * y,
  },
  rastrigin: {
    label: 'Растригин (сетка ловушек)', range: [-5.12, 5.12, -5.12, 5.12], mins: [[0, 0]],
    f: (x, y) => 20 + x * x - 10 * Math.cos(TAU * x) + y * y - 10 * Math.cos(TAU * y),
  },
  ackley: {
    label: 'Экли (рябь вокруг воронки)', range: [-5, 5, -5, 5], mins: [[0, 0]],
    f: (x, y) => -20 * Math.exp(-0.2 * Math.sqrt(0.5 * (x * x + y * y)))
      - Math.exp(0.5 * (Math.cos(TAU * x) + Math.cos(TAU * y))) + Math.E + 20,
  },
  rosenbrock: {
    label: 'Розенброк (изогнутый овраг)', range: [-2, 2, -1, 3], mins: [[1, 1]],
    f: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
  },
  himmelblau: {
    label: 'Химмельблау (4 равных ямы)', range: [-5, 5, -5, 5],
    mins: [[3, 2], [-2.805118, 3.131312], [-3.779310, -3.283186], [3.584428, -1.848126]],
    f: (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2,
  },
  schwefel: {
    label: 'Швефель (обманщик)', range: [-500, 500, -500, 500], mins: [[420.9687, 420.9687]],
    f: (x, y) => 837.9658 - x * Math.sin(Math.sqrt(Math.abs(x))) - y * Math.sin(Math.sqrt(Math.abs(y))),
  },
};
const MAX_PARTICLES = 500;

class Swarm {
  // params: { fn, count, w (inertia), c1 (own memory), c2 (swarm), vmax (% of range), topology: 'global' | 'ring' }
  constructor(params, rng) {
    this.p = params;
    const n = MAX_PARTICLES;
    for (const k of ['x', 'y', 'vx', 'vy', 'px', 'py', 'pf', 'f', 'ox', 'oy']) this[k] = new Float64Array(n);
    this.focusInfo = { inertia: [0, 0], cognitive: [0, 0], social: [0, 0], guide: [0, 0] };
    this.reset(rng);
  }

  get fn() { return FUNCTIONS[this.p.fn]; }

  reset(rng) {
    this.rng = rng;
    this.iter = 0;
    this.evals = 0;
    this.n = 0;
    this.gf = Infinity;
    this.gx = 0;
    this.gy = 0;
    this.history = [];   // { best, spread } per iteration
    this.setCount(this.p.count);
    this.record();
  }

  // Random positions over the whole range, small random velocities; pbest = start point.
  setCount(count) {
    const n = Math.max(2, Math.min(MAX_PARTICLES, Math.round(count)));
    const [x0, x1, y0, y1] = this.fn.range, rng = this.rng;
    for (let i = this.n; i < n; i++) {
      this.x[i] = x0 + rng() * (x1 - x0);
      this.y[i] = y0 + rng() * (y1 - y0);
      this.vx[i] = (rng() - 0.5) * (x1 - x0) * 0.1;
      this.vy[i] = (rng() - 0.5) * (y1 - y0) * 0.1;
      this.ox[i] = this.x[i];
      this.oy[i] = this.y[i];
      this.f[i] = this.pf[i] = this.eval(this.x[i], this.y[i]);
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      if (this.pf[i] < this.gf) { this.gf = this.pf[i]; this.gx = this.px[i]; this.gy = this.py[i]; }
    }
    this.n = n;
  }

  eval(x, y) {
    this.evals++;
    return this.fn.f(x, y);
  }

  // Whose best point particle i follows: the whole swarm's, or the best of itself and its two ring neighbors.
  guide(i) {
    if (this.p.topology !== 'ring') return [this.gx, this.gy];
    let b = i;
    for (const j of [(i + this.n - 1) % this.n, (i + 1) % this.n]) if (this.pf[j] < this.pf[b]) b = j;
    return [this.px[b], this.py[b]];
  }

  step() {
    const p = this.p, rng = this.rng, [x0, x1, y0, y1] = this.fn.range;
    const vmaxX = (x1 - x0) * p.vmax / 100, vmaxY = (y1 - y0) * p.vmax / 100;
    const guides = [];
    for (let i = 0; i < this.n; i++) guides.push(this.guide(i));   // all from the same iteration

    for (let i = 0; i < this.n; i++) {
      const [gx, gy] = guides[i];
      const r1x = rng(), r1y = rng(), r2x = rng(), r2y = rng();
      // v = w·v + c1·r1·(pbest − x) + c2·r2·(guide − x)
      const ix = p.w * this.vx[i], iy = p.w * this.vy[i];
      const cx = p.c1 * r1x * (this.px[i] - this.x[i]), cy = p.c1 * r1y * (this.py[i] - this.y[i]);
      const sx = p.c2 * r2x * (gx - this.x[i]), sy = p.c2 * r2y * (gy - this.y[i]);
      let vx = ix + cx + sx, vy = iy + cy + sy;
      vx = Math.max(-vmaxX, Math.min(vmaxX, vx));
      vy = Math.max(-vmaxY, Math.min(vmaxY, vy));
      if (i === 0) {
        const fi = this.focusInfo;
        fi.inertia[0] = ix; fi.inertia[1] = iy; fi.cognitive[0] = cx; fi.cognitive[1] = cy;
        fi.social[0] = sx; fi.social[1] = sy; fi.guide[0] = gx; fi.guide[1] = gy;
      }
      this.ox[i] = this.x[i];
      this.oy[i] = this.y[i];
      let x = this.x[i] + vx, y = this.y[i] + vy;
      // Walls: a particle that hits the edge stops there (that velocity component is zeroed).
      if (x < x0) { x = x0; vx = 0; } else if (x > x1) { x = x1; vx = 0; }
      if (y < y0) { y = y0; vy = 0; } else if (y > y1) { y = y1; vy = 0; }
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      const f = this.f[i] = this.eval(x, y);
      if (f < this.pf[i]) { this.pf[i] = f; this.px[i] = x; this.py[i] = y; }
    }
    for (let i = 0; i < this.n; i++) {
      if (this.pf[i] < this.gf) { this.gf = this.pf[i]; this.gx = this.px[i]; this.gy = this.py[i]; }
    }
    this.iter++;
    this.record();
  }

  // Spread: mean distance to the swarm's center, as a share of the range width.
  record() {
    let mx = 0, my = 0;
    for (let i = 0; i < this.n; i++) { mx += this.x[i]; my += this.y[i]; }
    mx /= this.n; my /= this.n;
    let d = 0;
    for (let i = 0; i < this.n; i++) d += Math.hypot(this.x[i] - mx, this.y[i] - my);
    const [x0, x1] = this.fn.range;
    this.history.push({ best: this.gf, spread: d / this.n / (x1 - x0) });
    if (this.history.length > 1000) this.history.shift();
  }

  // Distance from the swarm's best point to the nearest true minimum, as a share of the range width.
  missDistance() {
    const [x0, x1] = this.fn.range;
    return Math.min(...this.fn.mins.map(([mx, my]) => Math.hypot(this.gx - mx, this.gy - my))) / (x1 - x0);
  }
}

if (typeof module !== 'undefined') module.exports = { Swarm, FUNCTIONS, MAX_PARTICLES };
