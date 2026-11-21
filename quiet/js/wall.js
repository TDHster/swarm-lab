// A wall of tunable Helmholtz resonators that finds the room's hum by itself. No DOM here (runs in Node too).
//
// The room has a few tonal sources (a transformer, a compressor, an extractor fan). The wall is a grid of cells;
// each cell is a box with a neck and a movable bottom, so it absorbs a narrow band around its own frequency
// (deeper box - lower frequency). Each cell has a microphone and hears mostly the sources near it. Every tick
// it turns its screw a little towards the tone it should fight. The rule decides which tone that is.
//
// Room acoustics, simplified: tone k keeps energy E_k = P_k / (α0 + γ · Σ_i w_ik · a_i(f_k)), where w_ik is how
// strongly cell i couples to source k (falls with distance) and a_i(f) is the cell's absorption curve.

const WALL_W = 6, WALL_H = 3, COLS = 12, ROWS = 6;      // the wall, m, and the grid of cells
const F_MIN = 80, F_MAX = 310;                          // what the cells can reach, Hz
const ALPHA0 = 1, GAMMA = 0.5, R0 = 1.2, BROADBAND = 0.03;
const SOURCES = [
  { name: 'трансформатор', f: 100, P: 1.0, u: 1.0, v: 0.6, d: 1.2 },
  { name: 'компрессор', f: 160, P: 0.8, u: 4.8, v: 0.5, d: 1.5 },
  { name: 'вытяжка', f: 250, P: 0.6, u: 3.2, v: 2.7, d: 0.8 },
];

// Depth of the box (cm) for a given frequency: f = c/2π · √(S / (V · L_eff)), V = face² · depth.
// Face 10 × 10 cm, neck 2 cm wide and 3 cm long (L_eff = L + 0.85·d).
const CELL = { face: 0.10, neckD: 0.02, neckL: 0.03 };
function depthFor(f) {
  const S = Math.PI * (CELL.neckD / 2) ** 2, L = CELL.neckL + 0.85 * CELL.neckD, w = 2 * Math.PI * f / 343;
  return S / (CELL.face ** 2 * L * w * w) * 100;
}

class Wall {
  // params: { rule: 'room' | 'local', rate (octaves per tick), Q, noise (mic error), on: [bool per source] }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    this.n = COLS * ROWS;
    this.u = new Float64Array(this.n);
    this.v = new Float64Array(this.n);
    this.lf = new Float64Array(this.n);      // log2 of the cell's frequency
    this.target = new Int8Array(this.n).fill(-1);
    for (let i = 0; i < this.n; i++) {
      this.u[i] = (i % COLS + 0.5) * WALL_W / COLS;
      this.v[i] = (Math.floor(i / COLS) + 0.5) * WALL_H / ROWS;
      this.lf[i] = Math.log2(F_MIN) + rng() * Math.log2(F_MAX / F_MIN);   // installed untuned
    }
    this.w = SOURCES.map(s => Float64Array.from({ length: this.n }, (_, i) => {
      const r2 = (this.u[i] - s.u) ** 2 + (this.v[i] - s.v) ** 2 + s.d ** 2;
      return 1 / (1 + r2 / (R0 * R0));
    }));
    this.t = 0;
    this.switches = 0;   // how often cells changed their mind (a measure of dithering)
    this.update();
  }

  freq(i) { return Math.pow(2, this.lf[i]); }

  // Absorption of cell i at frequency f: a resonance curve of quality Q.
  absorb(i, f) {
    const fi = this.freq(i), x = this.p.Q * (f / fi - fi / f);
    return 1 / (1 + x * x);
  }

  // Energy of each tone in the room now.
  update() {
    this.E = SOURCES.map((s, k) => {
      if (!this.p.on[k]) return 0;
      let sum = 0;
      for (let i = 0; i < this.n; i++) sum += this.w[k][i] * this.absorb(i, s.f);
      return s.P / (ALPHA0 + GAMMA * sum);
    });
  }

  // Total level in dB relative to the room with no cells at all (all sources on).
  levelDb() {
    const ref = SOURCES.reduce((a, s) => a + s.P / ALPHA0, 0) + BROADBAND;
    return 10 * Math.log10((this.E.reduce((a, b) => a + b, 0) + BROADBAND) / ref);
  }
  toneDb(k) { return this.p.on[k] ? 10 * Math.log10(this.E[k] * ALPHA0 / SOURCES[k].P) : -Infinity; }

  step() {
    const { n, p, rng } = this, K = SOURCES.length;
    const roomLoudest = this.E.indexOf(Math.max(...this.E));
    const next = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      let best = -1, bs = 0;
      for (let k = 0; k < K; k++) {
        if (!p.on[k]) continue;
        // What the cell's microphone hears of tone k (with measurement error).
        const heard = (p.rule === 'room' ? this.E[k] : this.E[k] * this.w[k][i]) * (1 + p.noise * (rng() * 2 - 1));
        const score = heard;
        if (p.rule === 'room') best = roomLoudest, bs = 1;
        else if (score > bs) { bs = score; best = k; }
      }
      next[i] = best;
    }
    for (let i = 0; i < n; i++) {
      if (next[i] !== this.target[i]) { if (this.target[i] >= 0) this.switches++; this.target[i] = next[i]; }
      if (next[i] < 0) continue;
      const goal = Math.log2(SOURCES[next[i]].f), d = goal - this.lf[i];
      this.lf[i] += Math.sign(d) * Math.min(Math.abs(d), p.rate);
    }
    this.t++;
    this.update();
  }

  // How many cells sit on each tone (within its absorption half-width).
  counts() {
    return SOURCES.map(s => { let c = 0; for (let i = 0; i < this.n; i++) if (this.absorb(i, s.f) > 0.5) c++; return c; });
  }
}

if (typeof module !== 'undefined') module.exports = { WALL_W, WALL_H, COLS, ROWS, F_MIN, F_MAX, SOURCES, CELL, depthFor, Wall };
