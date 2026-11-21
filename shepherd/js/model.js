// Shepherding: one dog herds a flock into a pen (Strömbom et al., J. R. Soc. Interface 11, 2014).
// No DOM here (runs in Node too). Lengths are in "sheep personal spaces" (r_a = 2).
//
// A sheep blends five pulls into its heading: keep going (inertia), towards the centre of its nearest neighbours,
// away from sheep that are too close, away from the dog if it is near, and a little randomness. Far from the dog
// sheep just graze (rarely step). The dog has only two rules: if the flock is compact, get behind it (on the side
// away from the pen) and push; if one sheep strays, get behind that sheep and push it back to the others.

const FIELD_W = 160, FIELD_H = 90;
const PEN = { x: FIELD_W - 30, y: 0, w: 30, h: 30 };   // the pen in the top-right corner
const TARGET = { x: PEN.x + PEN.w / 2, y: PEN.y + PEN.h / 2 };
const R_A = 2;          // personal space of a sheep
const SHEEP_SPEED = 1, GRAZE_P = 0.05;

class Herd {
  // params: { sheep, dogSpeed, fear (r_s: how far a sheep notices the dog), cohesion (c), noise (e),
  //           neighbours (share of the flock a sheep keeps close to, 0..1) }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    const n = params.sheep;
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.hx = new Float64Array(n);   // heading (unit vector)
    this.hy = new Float64Array(n);
    // The flock starts in the lower-left part of the field, the dog in the middle.
    for (let i = 0; i < n; i++) {
      this.x[i] = 15 + rng() * 50;
      this.y[i] = 40 + rng() * 40;
      const a = rng() * Math.PI * 2;
      this.hx[i] = Math.cos(a); this.hy[i] = Math.sin(a);
    }
    this.dog = { x: 80, y: 45, hx: 1, hy: 0, mode: 'collect', aim: null };
    this.manual = null;   // a point the visitor's dog runs to (cursor), or null for the algorithm
    this.t = 0;
    this.doneAt = -1;
  }

  centre() {
    let sx = 0, sy = 0;
    for (let i = 0; i < this.n; i++) { sx += this.x[i]; sy += this.y[i]; }
    return { x: sx / this.n, y: sy / this.n };
  }

  inPen(i) { return this.x[i] >= PEN.x && this.y[i] <= PEN.y + PEN.h; }
  penned() { let k = 0; for (let i = 0; i < this.n; i++) if (this.inPen(i)) k++; return k; }

  stepDog() {
    const d = this.dog, p = this.p, g = this.centre();
    let goal;
    if (this.manual) {
      goal = this.manual;
      d.mode = 'manual';
    } else {
      // Is the flock compact? Everyone within f(N) = r_a · N^(2/3) of the centre.
      const f = R_A * Math.pow(this.n, 2 / 3);
      let far = -1, fd = 0;
      for (let i = 0; i < this.n; i++) {
        const di = Math.hypot(this.x[i] - g.x, this.y[i] - g.y);
        if (di > fd) { fd = di; far = i; }
      }
      if (fd <= f) {
        // Drive: stand behind the flock, on the line from the pen through the centre.
        const ux = g.x - TARGET.x, uy = g.y - TARGET.y, ul = Math.hypot(ux, uy) || 1;
        const back = R_A * Math.sqrt(this.n);
        goal = { x: g.x + ux / ul * back, y: g.y + uy / ul * back };
        d.mode = 'drive';
      } else {
        // Collect: stand behind the furthest sheep, on the line from the centre through it.
        const ux = this.x[far] - g.x, uy = this.y[far] - g.y, ul = Math.hypot(ux, uy) || 1;
        goal = { x: this.x[far] + ux / ul * R_A, y: this.y[far] + uy / ul * R_A };
        d.mode = 'collect';
      }
    }
    d.aim = goal;
    // Too close to any sheep: wait (rushing in would scatter them). Not for the visitor's dog.
    let tooClose = false;
    if (!this.manual) for (let i = 0; i < this.n; i++) if (Math.hypot(this.x[i] - d.x, this.y[i] - d.y) < 3 * R_A) { tooClose = true; break; }
    let gx = goal.x - d.x, gy = goal.y - d.y;
    const gl = Math.hypot(gx, gy);
    if (gl < 1e-6) return;
    const step = this.manual ? Math.min(p.dogSpeed, gl) : tooClose ? 0.05 : p.dogSpeed;
    let hx = gx / gl, hy = gy / gl;
    if (!this.manual) { const a = this.rng() * Math.PI * 2; hx += 0.3 * Math.cos(a); hy += 0.3 * Math.sin(a); const l = Math.hypot(hx, hy); hx /= l; hy /= l; }
    d.x = Math.min(FIELD_W, Math.max(0, d.x + hx * step));
    d.y = Math.min(FIELD_H, Math.max(0, d.y + hy * step));
  }

  step() {
    const { n, x, y, hx, hy, p, rng, dog } = this;
    const nx = new Float64Array(n), ny = new Float64Array(n), moves = new Uint8Array(n);
    const k = Math.max(1, Math.min(n - 1, Math.round(p.neighbours * n)));
    const dist = new Float64Array(n), idx = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < n; i++) {
      const dd = Math.hypot(x[i] - dog.x, y[i] - dog.y), scared = dd < p.fear;
      // Far from the dog a sheep grazes: it moves only now and then, at random.
      if (!scared && rng() > GRAZE_P) continue;
      moves[i] = 1;
      // Repulsion from sheep inside the personal space.
      let rax = 0, ray = 0;
      for (let j = 0; j < n; j++) {
        dist[j] = Math.hypot(x[j] - x[i], y[j] - y[i]);
        if (j !== i && dist[j] < R_A && dist[j] > 0) { rax += (x[i] - x[j]) / dist[j]; ray += (y[i] - y[j]) / dist[j]; }
      }
      const ral = Math.hypot(rax, ray); if (ral > 0) { rax /= ral; ray /= ral; }
      let vx, vy;
      if (scared) {
        // Attraction to the centre of the k nearest neighbours.
        idx.sort((a, b) => dist[a] - dist[b]);
        let cx = 0, cy = 0;
        for (let q = 1; q <= k; q++) { cx += x[idx[q]]; cy += y[idx[q]]; }
        cx = cx / k - x[i]; cy = cy / k - y[i];
        const cl = Math.hypot(cx, cy); if (cl > 0) { cx /= cl; cy /= cl; }
        const sx = (x[i] - dog.x) / dd, sy = (y[i] - dog.y) / dd;
        const a = rng() * Math.PI * 2;
        vx = 0.5 * hx[i] + p.cohesion * cx + 2 * rax + 1 * sx + p.noise * Math.cos(a);
        vy = 0.5 * hy[i] + p.cohesion * cy + 2 * ray + 1 * sy + p.noise * Math.sin(a);
      } else {
        const a = rng() * Math.PI * 2;
        vx = 2 * rax + Math.cos(a); vy = 2 * ray + Math.sin(a);
      }
      const l = Math.hypot(vx, vy) || 1;
      nx[i] = vx / l; ny[i] = vy / l;
    }
    for (let i = 0; i < n; i++) {
      if (!moves[i]) continue;
      hx[i] = nx[i]; hy[i] = ny[i];
      x[i] = Math.min(FIELD_W - 0.5, Math.max(0.5, x[i] + hx[i] * SHEEP_SPEED));
      y[i] = Math.min(FIELD_H - 0.5, Math.max(0.5, y[i] + hy[i] * SHEEP_SPEED));
    }
    this.stepDog();
    this.t++;
    if (this.doneAt < 0 && this.penned() === n) this.doneAt = this.t;
  }
}

if (typeof module !== 'undefined') module.exports = { FIELD_W, FIELD_H, PEN, TARGET, R_A, Herd };
