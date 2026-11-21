// Termites: two classic stigmergy models on a grid. No DOM here (runs in Node too).
//
// Chips (Resnick, 1994): wander; bump into a chip with empty jaws - pick it up; bump into a chip while
// carrying one - put yours down next to it. Nothing says "make piles", yet piles grow and merge.
//
// Builders (after Bonabeau, Theraulaz, Deneubourg et al., 1998): a termite carries a soil pellet, walks
// up the smell of fresh building material and drops the pellet with a probability that grows with that
// smell. The smell spreads and fades. Optionally a queen in the middle smells too, and pellets are
// dropped mostly where her smell has a certain strength - which draws the wall of the royal chamber.

const TERM_W = 120;
const TERM_H = 70;
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

class Chips {
  // params: { count (termites), density (share of cells with a chip at start) }
  constructor(params, rng) {
    this.w = TERM_W;
    this.h = TERM_H;
    this.p = params;
    this.chip = new Uint8Array(TERM_W * TERM_H);
    this.reset(rng);
  }

  reset(rng) {
    this.rng = rng;
    const n = this.w * this.h;
    for (let k = 0; k < n; k++) this.chip[k] = rng() < this.p.density ? 1 : 0;
    this.n = this.p.count;
    this.tx = new Int16Array(this.n); this.ty = new Int16Array(this.n);
    this.dir = new Uint8Array(this.n); this.carry = new Uint8Array(this.n); this.cool = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.tx[i] = Math.floor(rng() * this.w); this.ty[i] = Math.floor(rng() * this.h); this.dir[i] = Math.floor(rng() * 8);
    }
    this.steps = 0;
  }

  move(i) {
    const r = this.rng();
    this.dir[i] = (this.dir[i] + (r < 0.33 ? 7 : r < 0.66 ? 1 : 0)) % 8;   // wiggle
    const [dx, dy] = DIRS[this.dir[i]];
    this.tx[i] = (this.tx[i] + dx + this.w) % this.w;
    this.ty[i] = (this.ty[i] + dy + this.h) % this.h;
  }

  step() {
    const w = this.w, chip = this.chip;
    for (let i = 0; i < this.n; i++) {
      this.move(i);
      if (this.cool[i] > 0) { this.cool[i]--; continue; }   // just acted: walk away first
      const k = this.ty[i] * w + this.tx[i];
      if (!chip[k]) continue;
      if (!this.carry[i]) {
        chip[k] = 0;
        this.carry[i] = 1;
        this.cool[i] = 10;
      } else {
        // Put the chip on a free neighboring cell, turn around and leave.
        const start = Math.floor(this.rng() * 8);
        for (let q = 0; q < 8; q++) {
          const [dx, dy] = DIRS[(start + q) % 8];
          const nk = ((this.ty[i] + dy + this.h) % this.h) * w + (this.tx[i] + dx + w) % w;
          if (!chip[nk]) { chip[nk] = 1; this.carry[i] = 0; break; }
        }
        this.dir[i] = (this.dir[i] + 4) % 8;
        this.cool[i] = 10;
      }
    }
    this.steps++;
  }

  // Piles: groups of chips touching each other (8 neighbors). Returns { piles, biggest, chips }.
  piles() {
    const w = this.w, h = this.h, seen = new Uint8Array(w * h), stack = [];
    let piles = 0, biggest = 0, chips = 0;
    for (let k = 0; k < w * h; k++) {
      if (!this.chip[k]) continue;
      chips++;
      if (seen[k]) continue;
      piles++;
      let size = 0;
      stack.push(k); seen[k] = 1;
      while (stack.length) {
        const c = stack.pop(), x = c % w, y = (c - x) / w;
        size++;
        for (const [dx, dy] of DIRS) {
          const nk = ((y + dy + h) % h) * w + (x + dx + w) % w;
          if (this.chip[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
        }
      }
      biggest = Math.max(biggest, size);
    }
    for (let i = 0; i < this.n; i++) chips += this.carry[i];
    return { piles, biggest, chips };
  }
}

class Builders {
  // params: { count, sensitivity (K: smell at which half the visits end with a drop), evaporation (0..1 per step),
  //           diffusion (0..1), follow (0..1: chance to step toward the strongest smell), queen (bool), chamber (cells) }
  constructor(params, rng) {
    this.w = TERM_W;
    this.h = TERM_H;
    this.p = params;
    const n = TERM_W * TERM_H;
    this.height = new Uint16Array(n);
    this.smell = new Float32Array(n);
    this.buf = new Float32Array(n);
    this.reset(rng);
  }

  reset(rng) {
    this.rng = rng;
    this.height.fill(0);
    this.smell.fill(0);
    this.n = this.p.count;
    this.tx = new Int16Array(this.n); this.ty = new Int16Array(this.n);
    for (let i = 0; i < this.n; i++) this.respawn(i);
    this.steps = 0;
    this.placed = 0;
  }

  respawn(i) {   // a fresh pellet: the termite starts again somewhere at random
    this.tx[i] = Math.floor(this.rng() * this.w);
    this.ty[i] = Math.floor(this.rng() * this.h);
  }

  // How much the queen's template allows building here: 1 on a ring at `chamber` cells from her, 0 far from it.
  template(x, y) {
    if (!this.p.queen) return 1;
    const r = Math.hypot(x - this.w / 2, y - this.h / 2);
    return Math.exp(-(((r - this.p.chamber) / 2.5) ** 2));
  }

  step() {
    const p = this.p, w = this.w, h = this.h, S = this.smell, rng = this.rng;
    const K2 = p.sensitivity * p.sensitivity;
    for (let i = 0; i < this.n; i++) {
      let x = this.tx[i], y = this.ty[i];
      // Walk: with probability `follow`, to the neighbor that smells strongest; otherwise at random.
      let best = -1, bx = 0, by = 0;
      if (rng() < p.follow) {
        for (const [dx, dy] of DIRS) {
          const v = S[((y + dy + h) % h) * w + (x + dx + w) % w];
          if (v > best) { best = v; bx = dx; by = dy; }
        }
      }
      if (best <= 0) { const d = DIRS[Math.floor(rng() * 8)]; bx = d[0]; by = d[1]; }
      x = (x + bx + w) % w; y = (y + by + h) % h;
      this.tx[i] = x; this.ty[i] = y;
      // Drop the pellet: rarely at random (that seeds the building), much more often where it smells.
      const k = y * w + x, s = S[k];
      const pDrop = (0.0005 + s * s / (s * s + K2)) * this.template(x, y);
      if (rng() < pDrop) {
        this.height[k]++;
        S[k] += 1;   // fresh material smells
        this.placed++;
        this.respawn(i);
      }
    }
    // Smell spreads to the 4 neighbors and fades.
    const d = p.diffusion, keep = 1 - p.evaporation, out = this.buf;
    for (let y = 0; y < h; y++) {
      const row = y * w, up = ((y + h - 1) % h) * w, down = ((y + 1) % h) * w;
      for (let x = 0; x < w; x++) {
        const k = row + x, l = row + (x + w - 1) % w, r = row + (x + 1) % w;
        out[k] = (S[k] + ((S[l] + S[r] + S[up + x] + S[down + x]) / 4 - S[k]) * d) * keep;
      }
    }
    this.buf = S;
    this.smell = out;
    this.steps++;
  }

  // Pillars: local maxima of height at least `minH` tall. Returns { pillars, spacing (mean nearest distance) }.
  pillars(minH = 5) {
    const w = this.w, h = this.h, H = this.height, peaks = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = H[y * w + x];
        if (v < minH) continue;
        let top = true;
        for (let dy = -2; dy <= 2 && top; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const u = H[((y + dy + h) % h) * w + (x + dx + w) % w];
          if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { top = false; break; }
        }
        if (top) peaks.push([x, y]);
      }
    }
    let sum = 0;
    for (const [x, y] of peaks) {
      let m = Infinity;
      for (const [u, v] of peaks) {
        if (u === x && v === y) continue;
        const dx = Math.min(Math.abs(u - x), w - Math.abs(u - x)), dy = Math.min(Math.abs(v - y), h - Math.abs(v - y));
        m = Math.min(m, Math.hypot(dx, dy));
      }
      if (Number.isFinite(m)) sum += m;
    }
    return { pillars: peaks.length, spacing: peaks.length > 1 ? sum / peaks.length : 0 };
  }

  // Share of all placed material within ±3 cells of the chamber ring (for the queen check).
  ringShare() {
    let ring = 0, all = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const v = this.height[y * this.w + x];
      if (!v) continue;
      all += v;
      if (Math.abs(Math.hypot(x - this.w / 2, y - this.h / 2) - this.p.chamber) <= 3) ring += v;
    }
    return all ? ring / all : 0;
  }
}

if (typeof module !== 'undefined') module.exports = { Chips, Builders, TERM_W, TERM_H };
