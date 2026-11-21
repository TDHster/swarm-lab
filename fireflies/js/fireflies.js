// Fireflies: pulse-coupled oscillators (Mirollo & Strogatz 1990, after Peskin's heart pacemaker model, 1975).
// No DOM here (runs in Node too).
//
// Each firefly has an inner clock - a phase from 0 to 1 that grows at its own rate (period about 1 s).
// At 1 it flashes and starts again from 0. A firefly that sees a flash within its vision radius jumps ahead:
// phase += ε · phase (the closer it was to flashing, the bigger the jump). If the jump reaches 1, it flashes
// too, in the same instant - and its flash can push others over the edge. That chain is what glues groups together.

const FIELD_W = 16, FIELD_H = 9;   // the forest, in "vision units" (the radius slider is in the same units)

class Fireflies {
  // params: { count, radius (vision), eps (nudge), spread (period spread, e.g. 0.05 = ±5%) }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    const n = params.count;
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.phase = new Float64Array(n);
    this.period = new Float64Array(n);
    this.lastFlash = new Float64Array(n).fill(-1e9);
    for (let i = 0; i < n; i++) {
      this.x[i] = rng() * FIELD_W;
      this.y[i] = rng() * FIELD_H;
      this.phase[i] = rng();
      this.period[i] = 1 + params.spread * (rng() * 2 - 1);
    }
    this.t = 0;
    this.flashesNow = 0;
  }

  // Natural periods are re-drawn when the spread slider moves (positions and phases are kept).
  setSpread(spread) {
    this.p.spread = spread;
    for (let i = 0; i < this.n; i++) this.period[i] = 1 + spread * (this.rng() * 2 - 1);
  }

  // Knock the fireflies within `r` of (x, y) out of rhythm: random phases. Returns how many.
  scramble(x, y, r) {
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (Math.hypot(this.x[i] - x, this.y[i] - y) > r) continue;
      this.phase[i] = this.rng();
      k++;
    }
    return k;
  }

  // A flash by firefly `from` at (x, y): neighbours jump ahead; those pushed over the edge join the queue.
  nudge(x, y, from, fired, queue) {
    const r2 = this.p.radius * this.p.radius, eps = this.p.eps, ph = this.phase;
    for (let j = 0; j < this.n; j++) {
      if (j === from || fired[j]) continue;
      const dx = this.x[j] - x, dy = this.y[j] - y;
      if (dx * dx + dy * dy > r2) continue;
      ph[j] += eps * ph[j];
      if (ph[j] >= 1) { fired[j] = 1; queue.push(j); }
    }
  }

  step(dt) {
    const n = this.n, ph = this.phase, fired = new Uint8Array(n), queue = [];
    this.t += dt;
    for (let i = 0; i < n; i++) {
      ph[i] += dt / this.period[i];
      if (ph[i] >= 1) { fired[i] = 1; queue.push(i); }
    }
    // Flashes spread in a chain within the same instant; those who flashed now ignore the rest (refractory).
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      ph[i] = 0;
      this.lastFlash[i] = this.t;
      this.nudge(this.x[i], this.y[i], i, fired, queue);
    }
    for (const i of queue) ph[i] = 0;
    this.flashesNow = queue.length;
    return queue.length;
  }

  // How synchronous: r = |average of e^(2πi·phase)|, 1 - all clocks show the same, ~0 - spread evenly.
  order() {
    let c = 0, s = 0;
    for (let i = 0; i < this.n; i++) { c += Math.cos(2 * Math.PI * this.phase[i]); s += Math.sin(2 * Math.PI * this.phase[i]); }
    return Math.hypot(c, s) / this.n;
  }
}

if (typeof module !== 'undefined') module.exports = { FIELD_W, FIELD_H, Fireflies };
