// Social force model (Helbing, Farkas & Vicsek, 2000): people as soft discs pushed by forces.
// No DOM here (runs in Node too). Units: meters, seconds, kilograms, newtons.
//
//   m·dv/dt = m·(v0·e − v)/τ              wish: walk at speed v0 in direction e
//           + Σ people  [A·e^((r−d)/B) + k·g]·n + κ·g·Δv_t·t     keep distance; when touching: body push and friction
//           + Σ walls   the same with the wall
// g = max(0, r − d) is the overlap, n points away from the other, t along the contact.

// In Node the plan helpers come from plan.js; in the browser they are already global.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./plan.js'));

const MASS = 80;
const TAU = 0.5;
const A_SOC = 2000;      // N, social repulsion strength
const B_SOC = 0.08;      // m, its range
const K_BODY = 1.2e5;    // kg/s², body compression
const KAPPA = 2.4e5;     // kg/(m·s), sliding friction
const DT = 1 / 300;      // s, integration step (forces are stiff)
const CUTOFF = 2.5;      // m beyond contact: social forces are negligible further away
const HERD_RADIUS = 1.5; // m, whose directions a person copies when herding
const LAMBDA = 0.3;      // anisotropy: people react to those behind them with this weight (Helbing & Johansson)
// Anticipation: the panic-paper repulsion acts only within centimeters and straight along the line
// between centers, so two people walking head-on just stop in front of each other. The elliptical
// force looks at the relative velocity and pushes sideways early (Johansson, Helbing & Shukla 2007).
const A_ELL = 80;       // N
const B_ELL = 0.5;      // m
const ELL_DT = 0.5;     // s
const MAX_PEOPLE = 2000;
const INJURY = 1600;     // N/m: compression at which Helbing et al. count a person as injured
const PRESS_TAU = 0.5;   // s, compression is averaged over this time (single-step spikes are not injuries)
const JITTER_TAU = 1;    // s, how often a person's random sway changes

class Crowd {
  // params: { v0 (m/s), herding (0..1), friction (bool), speedSpread (0..1), jitter (0..1, random sway) }
  constructor(plan, params, rng) {
    this.p = params;
    const n = MAX_PEOPLE;
    for (const k of ['x', 'y', 'vx', 'vy', 'r', 'ex', 'ey', 'nex', 'ney', 'fx', 'fy', 'press', 'pressAvg', 'speedK', 'fdx', 'fdy', 'jx', 'jy']) this[k] = new Float64Array(n);
    this.target = new Int8Array(n);   // -1: nearest exit, otherwise exit index; flows: flow index
    this.cellOf = new Int32Array(n);
    this.items = new Int32Array(n);
    this.setPlan(plan);
    this.reset(rng);
  }

  // A new plan (or an edited one): rebuild navigation fields. People stay where they are.
  setPlan(plan) {
    this.plan = plan;
    this.fields = [];
    if (!plan.flows && plan.exits.length) {
      const costs = navCosts(plan);
      this.fieldAll = buildNavField(plan, plan.exits.map((_, i) => i), costs);
      this.fields = plan.exits.map((_, i) => buildNavField(plan, [i], costs));
    } else {
      this.fieldAll = null;
    }
    // Keep exit counters when an edited plan has a different number of exits.
    if (this.out) this.out = plan.exits.map((_, k) => this.out[k] || []);
  }

  reset(rng) {
    this.rng = rng;
    this.n = 0;
    this.t = 0;
    this.out = this.plan.exits.map(() => []);   // exit times per exit
    this.maxPress = 0;
    this.injured = 0;
    this.everInjured = new Uint8Array(MAX_PEOPLE);
    for (const s of this.plan.spawns) this.spawnArea(s);
    this.startCount = this.n;
  }

  // Place people at random free spots in a rectangle (no overlaps with walls, columns or each other).
  spawnArea(s) {
    const rng = this.rng;
    for (let k = 0; k < s.count && this.n < MAX_PEOPLE; k++) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const r = 0.25 + rng() * 0.1;
        const x = s.x0 + r + rng() * (s.x1 - s.x0 - 2 * r), y = s.y0 + r + rng() * (s.y1 - s.y0 - 2 * r);
        if (!this.isFree(x, y, r)) continue;
        this.add(x, y, r, s, k);
        break;
      }
    }
  }

  isFree(x, y, r) {
    for (let i = 0; i < this.n; i++) if ((this.x[i] - x) ** 2 + (this.y[i] - y) ** 2 < (r + this.r[i]) ** 2) return false;
    for (const w of this.plan.walls) if (segDist(x, y, w).d < r) return false;
    for (const c of this.plan.columns) if (Math.hypot(x - c.x, y - c.y) < r + c.r) return false;
    return true;
  }

  add(x, y, r, s, k) {
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = 0; this.vy[i] = 0; this.r[i] = r;
    this.press[i] = 0;
    this.pressAvg[i] = 0;
    this.jx[i] = 0;
    this.jy[i] = 0;
    this.everInjured[i] = 0;
    // Individual desired speeds differ a little (±speedSpread/2).
    this.speedK[i] = 1 + ((this.rng() - 0.5) * (this.p.speedSpread ?? 0.2));
    if (s.flows) {
      this.target[i] = s.flows[k % s.flows.length];
      const f = this.plan.flows[this.target[i]];
      this.fdx[i] = f.dx; this.fdy[i] = f.dy;
    } else {
      // Those who do not know the spare exit head for exit 0 (the main one); the rest - to the nearest.
      this.target[i] = (s.aware !== undefined && this.rng() >= s.aware) ? 0 : -1;
    }
    this.ex[i] = 0; this.ey[i] = 0;
  }

  removeAt(i) {
    const last = --this.n;
    if (i === last) return;
    for (const k of ['x', 'y', 'vx', 'vy', 'r', 'ex', 'ey', 'press', 'pressAvg', 'speedK', 'fdx', 'fdy', 'jx', 'jy']) this[k][i] = this[k][last];
    this.target[i] = this.target[last];
    this.everInjured[i] = this.everInjured[last];
  }

  // Min-image offset on the glued (periodic) world.
  wrapD(d, L) {
    if (!this.plan.periodic) return d;
    return d > L / 2 ? d - L : d < -L / 2 ? d + L : d;
  }

  buildGrid() {
    const cell = 0.7 + CUTOFF;
    const cols = Math.max(1, Math.floor(WORLD_W / cell)), rows = Math.max(1, Math.floor(WORLD_H / cell));
    if (cols !== this.cols || rows !== this.rows) { this.cols = cols; this.rows = rows; this.start = new Int32Array(cols * rows + 1); }
    const start = this.start;
    start.fill(0);
    for (let i = 0; i < this.n; i++) {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(this.x[i] / WORLD_W * cols)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(this.y[i] / WORLD_H * rows)));
      this.cellOf[i] = cx + cy * cols;
      start[this.cellOf[i] + 1]++;
    }
    for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cols * rows);
    for (let i = 0; i < this.n; i++) this.items[fill[this.cellOf[i]]++] = i;
  }

  // Calls fn(j, dx, dy) for every other person in the 3x3 cells around person i.
  forNeighbors(i, fn) {
    const cols = this.cols, rows = this.rows, c = this.cellOf[i], cx = c % cols, cy = (c - cx) / cols;
    const per = this.plan.periodic;
    for (let oy = -1; oy <= 1; oy++) {
      let ny = cy + oy;
      if (ny < 0 || ny >= rows) { if (!per) continue; ny = (ny + rows) % rows; }
      for (let ox = -1; ox <= 1; ox++) {
        let nx = cx + ox;
        if (nx < 0 || nx >= cols) { if (!per) continue; nx = (nx + cols) % cols; }
        const cell = nx + ny * cols;
        for (let k = this.start[cell], e = this.start[cell + 1]; k < e; k++) {
          const j = this.items[k];
          if (j === i) continue;
          fn(j, this.wrapD(this.x[j] - this.x[i], WORLD_W), this.wrapD(this.y[j] - this.y[i], WORLD_H));
        }
      }
    }
  }

  // Desired direction: own (from the navigation map or the flow), mixed with neighbors' when herding.
  desired() {
    const tmp = [0, 0], h = this.p.herding || 0;
    const ownX = this.fx, ownY = this.fy;   // reuse force arrays as scratch before forces are computed
    for (let i = 0; i < this.n; i++) {
      if (this.plan.flows) { ownX[i] = this.fdx[i]; ownY[i] = this.fdy[i]; continue; }
      // No exits (an edited plan) - nowhere to go; a removed exit - head for the nearest one.
      const f = (this.target[i] >= 0 && this.fields[this.target[i]]) || this.fieldAll;
      if (f) navDirection(f, this.x[i], this.y[i], tmp); else { tmp[0] = 0; tmp[1] = 0; }
      ownX[i] = tmp[0]; ownY[i] = tmp[1];
    }
    const jit = this.p.jitter ?? 0.1, rng = this.rng;
    for (let i = 0; i < this.n; i++) {
      // Nervousness: a small random sway of the desired direction that changes about once per JITTER_TAU.
      if (rng() < DT / JITTER_TAU) {
        const a = rng() * Math.PI * 2, m = Math.sqrt(rng()) * jit;
        this.jx[i] = Math.cos(a) * m; this.jy[i] = Math.sin(a) * m;
      }
      let ex = ownX[i] + this.jx[i], ey = ownY[i] + this.jy[i];
      if (h > 0) {
        let sx = 0, sy = 0, cnt = 0;
        this.forNeighbors(i, (j, dx, dy) => {
          if (dx * dx + dy * dy < HERD_RADIUS * HERD_RADIUS) { sx += this.ex[j]; sy += this.ey[j]; cnt++; }
        });
        if (cnt) {
          const m = Math.hypot(sx, sy) || 1;
          ex = (1 - h) * ex + h * sx / m;
          ey = (1 - h) * ey + h * sy / m;
        }
      }
      const n = Math.hypot(ex, ey);
      this.nex[i] = n > 1e-9 ? ex / n : 0;
      this.ney[i] = n > 1e-9 ? ey / n : 0;
    }
    // Everyone copies neighbors' directions from the previous step, then all switch at once.
    for (let i = 0; i < this.n; i++) { this.ex[i] = this.nex[i]; this.ey[i] = this.ney[i]; }
  }

  // Force between a person and a contact point at distance d along unit normal (nx, ny) (pointing to the person).
  // Returns the radial body (compression) force for the pressure estimate.
  contact(i, overlap, nx, ny, dvt, out, social = 1) {
    const g = overlap > 0 ? overlap : 0;
    const radial = social * A_SOC * Math.exp(overlap / B_SOC) + K_BODY * g;
    const fric = this.p.friction === false ? 0 : KAPPA * g * dvt;
    out[0] += radial * nx - fric * ny;
    out[1] += radial * ny + fric * nx;
    return K_BODY * g;
  }

  // Force on a person at offset d = (dx, dy) from another whose relative displacement is y = (yx, yy):
  // b is the semi-minor axis of the ellipse through d with foci at the other and at the other shifted by y.
  ellipse(dx, dy, yx, yy, A, out) {
    const d = Math.hypot(dx, dy), ux = dx - yx, uy = dy - yy, du = Math.hypot(ux, uy), y = Math.hypot(yx, yy);
    const b = 0.5 * Math.sqrt(Math.max(1e-12, (d + du) ** 2 - y * y));
    const k = A * Math.exp(-b / (this.p.bEll ?? B_ELL)) * (d + du) / (2 * b) * 0.5;
    out[0] = k * (dx / d + (du > 1e-9 ? ux / du : 0));
    out[1] = k * (dy / d + (du > 1e-9 ? uy / du : 0));
  }

  step() {
    const n = this.n, p = this.p;
    if (!n) { this.t += DT; return; }
    this.buildGrid();
    this.desired();
    const FX = this.fx, FY = this.fy, X = this.x, Y = this.y, VX = this.vx, VY = this.vy, R = this.r;
    const press = this.press;
    for (let i = 0; i < n; i++) {
      const v0 = p.v0 * this.speedK[i];
      FX[i] = MASS * (v0 * this.ex[i] - VX[i]) / TAU;
      FY[i] = MASS * (v0 * this.ey[i] - VY[i]) / TAU;
      press[i] = 0;
    }
    const acc = [0, 0];
    for (let i = 0; i < n; i++) {
      this.forNeighbors(i, (j, dx, dy) => {
        if (j < i) return;   // each pair once, Newton's third law
        const rij = R[i] + R[j], d2 = dx * dx + dy * dy;
        if (d2 > (rij + CUTOFF) ** 2 || d2 < 1e-12) return;
        const d = Math.sqrt(d2), nx = -dx / d, ny = -dy / d;   // from j to i
        // Tangential velocity of j relative to i along t = (-ny, nx).
        const dvt = (VX[j] - VX[i]) * -ny + (VY[j] - VY[i]) * nx;
        // Body push and friction are mutual. Keep-away: the near part is mutual too, the far part is not -
        // a person cares more about whoever is ahead (weight 1) than behind (weight LAMBDA).
        acc[0] = 0; acc[1] = 0;
        const body = this.contact(i, rij - d, nx, ny, dvt, acc, 0);
        FX[i] += acc[0]; FY[i] += acc[1];
        FX[j] -= acc[0]; FY[j] -= acc[1];
        press[i] += body; press[j] += body;
        const near = A_SOC * Math.exp((rij - d) / B_SOC);
        FX[i] += near * nx; FY[i] += near * ny;
        FX[j] -= near * nx; FY[j] -= near * ny;
        const aE = this.p.aEll ?? A_ELL;
        if (aE > 0) {
          // Anticipation (elliptical specification II, Johansson, Helbing & Shukla 2007): the keep-away
          // force uses where the other will be in ELL_DT seconds relative to me, so people step aside early.
          this.ellipse(-dx, -dy, (VX[j] - VX[i]) * ELL_DT, (VY[j] - VY[i]) * ELL_DT, aE, acc);
          const wi = LAMBDA + (1 - LAMBDA) * (1 - (this.ex[i] * nx + this.ey[i] * ny)) / 2;   // j ahead of i: −n·e_i = 1
          FX[i] += acc[0] * wi; FY[i] += acc[1] * wi;
          this.ellipse(dx, dy, (VX[i] - VX[j]) * ELL_DT, (VY[i] - VY[j]) * ELL_DT, aE, acc);
          const wj = LAMBDA + (1 - LAMBDA) * (1 + (this.ex[j] * nx + this.ey[j] * ny)) / 2;
          FX[j] += acc[0] * wj; FY[j] += acc[1] * wj;
        }
      });
    }
    for (let i = 0; i < n; i++) {
      acc[0] = 0; acc[1] = 0;
      for (const w of this.plan.walls) {
        const q = segDist(X[i], Y[i], w);
        if (q.d > R[i] + CUTOFF || q.d < 1e-9) continue;
        const nx = (X[i] - q.cx) / q.d, ny = (Y[i] - q.cy) / q.d;
        press[i] += this.contact(i, R[i] - q.d, nx, ny, -(VX[i] * -ny + VY[i] * nx), acc);
      }
      for (const c of this.plan.columns) {
        const dx = X[i] - c.x, dy = Y[i] - c.y, dc = Math.hypot(dx, dy), d = dc - c.r;
        if (d > R[i] + CUTOFF || dc < 1e-9) continue;
        const nx = dx / dc, ny = dy / dc;
        press[i] += this.contact(i, R[i] - d, nx, ny, -(VX[i] * -ny + VY[i] * nx), acc);
      }
      FX[i] += acc[0]; FY[i] += acc[1];
    }

    // Semi-implicit Euler with a speed cap (people cannot run faster than ~1.3·v0).
    const vmax = Math.max(1.5, 1.3 * p.v0 * 1.1);
    let maxPress = 0, injured = 0;
    for (let i = 0; i < n; i++) {
      let vx = VX[i] + FX[i] / MASS * DT, vy = VY[i] + FY[i] / MASS * DT;
      const s = Math.hypot(vx, vy);
      if (s > vmax) { vx *= vmax / s; vy *= vmax / s; }
      VX[i] = vx; VY[i] = vy;
      let x = X[i] + vx * DT, y = Y[i] + vy * DT;
      if (this.plan.periodic) {
        x = (x + WORLD_W) % WORLD_W;
        y = (y + WORLD_H) % WORLD_H;
      }
      X[i] = x; Y[i] = y;
      // Compression as force per meter of body circumference (Helbing: > 1600 N/m injures).
      press[i] /= 2 * Math.PI * R[i];
      const pa = this.pressAvg[i] += (press[i] - this.pressAvg[i]) * DT / PRESS_TAU;
      if (pa > maxPress) maxPress = pa;
      if (pa > INJURY) { injured++; this.everInjured[i] = 1; }
    }
    this.maxPress = Math.max(this.maxPress, maxPress);
    this.injuredNow = injured;
    this.t += DT;

    // Exits: whoever stepped into an exit zone is out.
    for (let i = this.n - 1; i >= 0; i--) {
      for (let e = 0; e < this.plan.exits.length; e++) {
        const z = this.plan.exits[e];
        if (X[i] >= z.x0 && X[i] <= z.x1 && Y[i] >= z.y0 && Y[i] <= z.y1) {
          this.out[e].push(this.t);
          if (this.everInjured[i]) this.injured++;
          this.removeAt(i);
          break;
        }
      }
    }
  }

  totalOut() { return this.out.reduce((s, a) => s + a.length, 0); }

  // Everyone whose averaged compression has ever gone over INJURY: already out plus still inside.
  injuredTotal() {
    let k = this.injured;
    for (let i = 0; i < this.n; i++) k += this.everInjured[i];
    return k;
  }

  // People per second through each exit over the last `window` seconds.
  flows(window = 5) {
    return this.out.map(a => a.filter(t => t > this.t - window).length / Math.min(window, Math.max(this.t, 1e-9)));
  }

  // Lane order (Rex & Löwen): for each person, neighbors in a thin strip along the walking line;
  // ((same − opposite)/(same + opposite))², averaged. ~0.1-0.3 when mixed, 1 when lanes are clean.
  laneOrder() {
    if (!this.plan.flows) return 0;
    this.buildGrid();
    let sum = 0, cnt = 0;
    for (let i = 0; i < this.n; i++) {
      const fx = this.fdx[i], fy = this.fdy[i];
      let same = 0, opp = 0;
      this.forNeighbors(i, (j, dx, dy) => {
        // Distance across and along own walking direction.
        const along = dx * fx + dy * fy, across = -dx * fy + dy * fx;
        if (Math.abs(across) > 0.4 || Math.abs(along) > 3) return;
        if (this.target[j] === this.target[i]) same++; else opp++;
      });
      if (same + opp > 0) { sum += ((same - opp) / (same + opp)) ** 2; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  }

  // Local density (people/m²) and crowd pressure on a grid of `cell` meters (Helbing, Johansson &
  // Al-Abideen 2007): pressure = density × variance of velocity around the local mean. High pressure
  // means people are pushed around in a dense crowd - the warning sign before crowd disasters.
  localFields(cell, out) {
    const W = Math.ceil(WORLD_W / cell), H = Math.ceil(WORLD_H / cell), R = 1.25, s2 = 2 * 0.5 * 0.5;   // kernel σ = 0.5 m, cut at 2.5σ
    if (!out || out.W !== W) out = { W, H, cell, rho: new Float64Array(W * H), vx: new Float64Array(W * H), vy: new Float64Array(W * H), v2: new Float64Array(W * H), press: new Float64Array(W * H) };
    out.rho.fill(0); out.vx.fill(0); out.vy.fill(0); out.v2.fill(0);
    const norm = 1 / (Math.PI * s2);   // Gaussian kernel integrates to 1 person
    for (let i = 0; i < this.n; i++) {
      const i0 = Math.floor((this.x[i] - R) / cell), i1 = Math.floor((this.x[i] + R) / cell);
      const j0 = Math.floor((this.y[i] - R) / cell), j1 = Math.floor((this.y[i] + R) / cell);
      for (let j = j0; j <= j1; j++) {
        for (let k = i0; k <= i1; k++) {
          if (k < 0 || j < 0 || k >= W || j >= H) continue;
          const dx = (k + 0.5) * cell - this.x[i], dy = (j + 0.5) * cell - this.y[i];
          const w = norm * Math.exp(-(dx * dx + dy * dy) / s2), c = j * W + k;
          out.rho[c] += w; out.vx[c] += w * this.vx[i]; out.vy[c] += w * this.vy[i];
          out.v2[c] += w * (this.vx[i] ** 2 + this.vy[i] ** 2);
        }
      }
    }
    for (let c = 0; c < W * H; c++) {
      const r = out.rho[c];
      if (r < 1e-6) { out.press[c] = 0; continue; }
      const mx = out.vx[c] / r, my = out.vy[c] / r;
      out.press[c] = r * Math.max(0, out.v2[c] / r - mx * mx - my * my);
    }
    return out;
  }

  // Mean speed along the own walking direction (for flows) or overall.
  meanSpeed() {
    if (!this.n) return 0;
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      s += this.plan.flows ? this.vx[i] * this.fdx[i] + this.vy[i] * this.fdy[i] : Math.hypot(this.vx[i], this.vy[i]);
    }
    return s / this.n;
  }
}

if (typeof module !== 'undefined') module.exports = { Crowd, MASS, DT, INJURY, MAX_PEOPLE };
