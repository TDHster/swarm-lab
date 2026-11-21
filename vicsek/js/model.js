// Vicsek model (Vicsek et al., Phys. Rev. Lett. 1995): the simplest swarm with a phase transition.
// No DOM here (runs in Node too).
//
// N particles in a box with wrap-around edges, all with the same speed v0. Every step each particle takes
// the average heading of everyone within radius R = 1 (itself included) and adds noise: a random angle,
// uniform in [-η/2, η/2]. Then all move one step. Order parameter φ = |average velocity| / v0:
// 1 - everyone flies the same way, ~0 - everyone flies their own way (for N particles about 1/√N).

const R = 1;

class Vicsek {
  // params: { count, density, aspect (box width / height), eta (noise, 0..2π), v0 (speed) }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    const n = params.count, aspect = params.aspect || 1;
    this.n = n;
    this.H = Math.sqrt(n / params.density / aspect);
    this.W = this.H * aspect;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.th = new Float64Array(n);
    this.nth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = rng() * this.W;
      this.y[i] = rng() * this.H;
      this.th[i] = (rng() * 2 - 1) * Math.PI;
    }
    // Cell grid with cells of at least R: neighbours of a particle are only in its cell and the 8 around it.
    this.cx = Math.max(3, Math.floor(this.W / R));
    this.cy = Math.max(3, Math.floor(this.H / R));
    this.head = new Int32Array(this.cx * this.cy);
    this.next = new Int32Array(n);
    this.steps = 0;
  }

  // Everyone turns to the same random heading (to start from the ordered state).
  align() {
    const a = (this.rng() * 2 - 1) * Math.PI;
    this.th.fill(a);
  }

  step() {
    const { n, x, y, th, nth, W, H, cx, cy, head, next, rng } = this;
    const eta = this.p.eta, v0 = this.p.v0;
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const c = Math.floor(y[i] / H * cy) % cy * cx + Math.floor(x[i] / W * cx) % cx;
      next[i] = head[c];
      head[c] = i;
    }
    const cos = new Float64Array(n), sin = new Float64Array(n);
    for (let i = 0; i < n; i++) { cos[i] = Math.cos(th[i]); sin[i] = Math.sin(th[i]); }
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x[i] / W * cx) % cx, gy = Math.floor(y[i] / H * cy) % cy;
      let sx = 0, sy = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ry = (gy + oy + cy) % cy;
        for (let ox = -1; ox <= 1; ox++) {
          for (let j = head[ry * cx + (gx + ox + cx) % cx]; j >= 0; j = next[j]) {
            let dx = x[j] - x[i], dy = y[j] - y[i];
            // Wrap-around: the nearest copy of the neighbour.
            if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
            if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
            if (dx * dx + dy * dy <= R * R) { sx += cos[j]; sy += sin[j]; }
          }
        }
      }
      nth[i] = Math.atan2(sy, sx) + eta * (rng() - 0.5);
    }
    for (let i = 0; i < n; i++) {
      th[i] = nth[i];
      x[i] = (x[i] + v0 * Math.cos(th[i]) + W) % W;
      y[i] = (y[i] + v0 * Math.sin(th[i]) + H) % H;
    }
    this.steps++;
  }

  // Order parameter φ (0..1) and the average heading.
  order() {
    let sx = 0, sy = 0;
    for (let i = 0; i < this.n; i++) { sx += Math.cos(this.th[i]); sy += Math.sin(this.th[i]); }
    return { phi: Math.hypot(sx, sy) / this.n, dir: Math.atan2(sy, sx) };
  }
}

// Average φ at one noise level: run `warm` steps, then average over `measure` steps.
function measurePhi(params, rng, warm, measure, ordered) {
  const v = new Vicsek(params, rng);
  if (ordered) v.align();
  for (let k = 0; k < warm; k++) v.step();
  let s = 0, s2 = 0;
  for (let k = 0; k < measure; k++) { v.step(); const f = v.order().phi; s += f; s2 += f * f; }
  const m = s / measure;
  return { phi: m, sd: Math.sqrt(Math.max(0, s2 / measure - m * m)) };
}

if (typeof module !== 'undefined') module.exports = { R, Vicsek, measurePhi };
