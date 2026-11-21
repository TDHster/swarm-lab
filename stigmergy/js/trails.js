// Human trail systems (Helbing, Keltsch & Molnár, 1997, Nature 388:47). No DOM here (runs in Node too).
//
// The lawn has a "comfort" G in every cell: 0 - untouched grass, 1 - bare trodden path (or pavement).
//   - every footstep tramples:   G += I·(1 − G)
//   - grass grows back:           G −= G / T          (T - how long the trail lasts without walkers)
// Walkers go from a random entrance to another one. Their direction mixes two wishes:
//   e = (goal − x)/|goal − x| + λ·∇V,   V = G blurred over the visibility radius σ
// i.e. "straight to the goal" plus "toward the nearby trail". Nobody plans the network - it is trodden in.

const TRAIL_W = 180;   // cells; 1 cell = 0.5 m, so the park is 90 x 52.5 m
const TRAIL_H = 105;
const CELL_M = 0.5;
const MAX_WALKERS = 2000;
const MAX_PULL = 0.9;   // trail pull relative to the goal pull (1)

class Park {
  // params: { trample (I), durability (T, steps), attraction (λ), visibility (σ, cells), spawnEvery (steps), noise }
  constructor(params, rng) {
    this.w = TRAIL_W;
    this.h = TRAIL_H;
    this.p = params;
    const n = TRAIL_W * TRAIL_H;
    this.G = new Float32Array(n);
    this.V = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.paved = new Uint8Array(n);   // pavement: always comfortable, never grows over
    this.entrances = [];              // { x, y } in cells
    for (const k of ['x', 'y', 'tx', 'ty', 'walked', 'direct']) this[k] = new Float32Array(MAX_WALKERS);
    this.reset(rng);
  }

  reset(rng) {
    this.rng = rng;
    this.G.fill(0);
    for (let k = 0; k < this.G.length; k++) if (this.paved[k]) this.G[k] = 1;
    this.V.fill(0);
    this.n = 0;
    this.steps = 0;
    this.arrived = 0;
    this.detourSum = 0;
  }

  // Presets: entrances on the park edge, optionally pavement.
  loadPreset(name) {
    this.paved.fill(0);
    const W = this.w, H = this.h;
    if (name === 'three') {
      this.entrances = [{ x: 20, y: H - 12 }, { x: W - 20, y: H - 12 }, { x: W / 2, y: 10 }];
    } else if (name === 'four') {
      this.entrances = [{ x: 15, y: 12 }, { x: W - 15, y: 12 }, { x: 15, y: H - 12 }, { x: W - 15, y: H - 12 }];
    } else if (name === 'plaza') {
      // A square lawn with paved paths only around it: the classic place for a diagonal shortcut.
      const x0 = 40, y0 = 15, x1 = W - 40, y1 = H - 15;
      this.entrances = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }];
      this.pave(x0, y0, x1, y0); this.pave(x0, y1, x1, y1); this.pave(x0, y0, x0, y1); this.pave(x1, y0, x1, y1);
    } else if (name === 'six') {
      this.entrances = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI * 2 * k / 6 + 0.3;
        this.entrances.push({ x: W / 2 + Math.cos(a) * 75, y: H / 2 + Math.sin(a) * 42 });
      }
    }
    this.reset(this.rng);
  }

  // A straight paved strip 2 cells (1 m) wide between two points.
  pave(x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len * 2));
    for (let q = 0; q <= n; q++) {
      const x = x0 + (x1 - x0) * q / n, y = y0 + (y1 - y0) * q / n;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) this.setPaved(Math.round(x) + dx, Math.round(y) + dy, 1);
    }
  }

  setPaved(i, j, v) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    const k = j * this.w + i;
    this.paved[k] = v;
    if (v) this.G[k] = 1;
  }

  spawn() {
    const E = this.entrances;
    if (E.length < 2 || this.n >= MAX_WALKERS) return;
    const a = Math.floor(this.rng() * E.length);
    let b = Math.floor(this.rng() * (E.length - 1));
    if (b >= a) b++;
    const i = this.n++;
    this.x[i] = E[a].x + (this.rng() - 0.5) * 2;
    this.y[i] = E[a].y + (this.rng() - 0.5) * 2;
    this.tx[i] = E[b].x;
    this.ty[i] = E[b].y;
    this.walked[i] = 0;
    this.direct[i] = Math.hypot(this.tx[i] - this.x[i], this.ty[i] - this.y[i]);
  }

  // V = G blurred with three box blurs (≈ Gaussian of width σ): how visible the trails are from each cell.
  blurField() {
    const r = Math.max(1, Math.round(this.p.visibility / 1.7)), w = this.w, h = this.h;
    let src = this.G, dst = this.V;
    for (let pass = 0; pass < 3; pass++) {
      this.boxBlur(src, this.tmp, w, h, r, 1, w);   // rows
      this.boxBlur(this.tmp, dst, h, w, r, w, 1);   // columns
      src = dst;
    }
  }

  // Running-sum box blur along lines: `len` cells per line with stride `step`, lines `stride` apart.
  boxBlur(src, dst, len, lines, r, step, stride) {
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      let sum = 0, cnt = 0;
      for (let k = 0; k <= Math.min(r, len - 1); k++) { sum += src[base + k * step]; cnt++; }
      for (let k = 0; k < len; k++) {
        dst[base + k * step] = sum / cnt;
        const add = k + r + 1, rem = k - r;
        if (add < len) { sum += src[base + add * step]; cnt++; }
        if (rem >= 0) { sum -= src[base + rem * step]; cnt--; }
      }
    }
  }

  step() {
    const p = this.p, w = this.w, h = this.h, G = this.G, V = this.V;
    if (this.steps % p.spawnEvery === 0) this.spawn();
    if (this.steps % 4 === 0) this.blurField();   // the trail picture changes slowly

    for (let i = this.n - 1; i >= 0; i--) {
      const x = this.x[i], y = this.y[i];
      let gx = this.tx[i] - x, gy = this.ty[i] - y;
      const d = Math.hypot(gx, gy);
      if (d < 1.5) {   // arrived
        this.arrived++;
        this.detourSum += this.walked[i] / Math.max(1, this.direct[i]);
        this.removeAt(i);
        continue;
      }
      gx /= d; gy /= d;
      const ci = Math.min(w - 2, Math.max(1, x | 0)), cj = Math.min(h - 2, Math.max(1, y | 0)), k = cj * w + ci;
      // Gradient of trail visibility; scaled by σ so λ means the same at any visibility radius.
      const vx = (V[k + 1] - V[k - 1]) / 2 * p.visibility, vy = (V[k + w] - V[k - w]) / 2 * p.visibility;
      // The pull toward trails is capped below the pull toward the goal: a walker may swerve to a trail,
      // but never walks away from the goal (otherwise strong attraction traps walkers on trails forever).
      let ax = p.attraction * vx, ay = p.attraction * vy;
      const am = Math.hypot(ax, ay);
      if (am > MAX_PULL) { ax *= MAX_PULL / am; ay *= MAX_PULL / am; }
      let ex = gx + ax, ey = gy + ay;
      const a = (this.rng() - 0.5) * p.noise;
      const c = Math.cos(a), s = Math.sin(a);
      [ex, ey] = [ex * c - ey * s, ex * s + ey * c];
      const e = Math.hypot(ex, ey) || 1;
      // Walking is easier on trodden ground: speed 0.6..1 cells per step depending on comfort.
      const speed = 0.6 + 0.4 * G[k];
      this.x[i] = x + ex / e * speed;
      this.y[i] = y + ey / e * speed;
      this.walked[i] += speed;
      const nk = (Math.min(h - 1, Math.max(0, this.y[i] | 0))) * w + Math.min(w - 1, Math.max(0, this.x[i] | 0));
      if (!this.paved[nk]) G[nk] += p.trample * (1 - G[nk]);
    }

    // Grass regrows everywhere except pavement.
    const fade = 1 - 1 / Math.max(1, p.durability);
    for (let k = 0; k < G.length; k++) if (!this.paved[k]) G[k] *= fade;
    this.steps++;
  }

  removeAt(i) {
    const last = --this.n;
    for (const k of ['x', 'y', 'tx', 'ty', 'walked', 'direct']) this[k][i] = this[k][last];
  }

  // Trodden lawn (not pavement) with comfort above `level`, in square meters.
  trailArea(level = 0.3) {
    let c = 0;
    for (let k = 0; k < this.G.length; k++) if (!this.paved[k] && this.G[k] > level) c++;
    return c * CELL_M * CELL_M;
  }

  meanDetour() { return this.arrived ? this.detourSum / this.arrived : 1; }
}

if (typeof module !== 'undefined') module.exports = { Park, TRAIL_W, TRAIL_H, CELL_M };
