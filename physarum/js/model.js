// Physarum model (Jeff Jones, 2010): many particles on a trail map. No DOM here - the same code runs
// in the browser and in Node (tools/smoke.js). Units: trail-map pixels and steps.
//
// Each particle: sense the trail at three points ahead, turn toward the strongest, step, drop trail.
// The map: blur a little (diffusion) and fade (decay). That is all - networks grow from this loop.

const MAP_W = 600;
const MAP_H = 350;
const MAX_AGENTS = 400000;
const FOOD_RADIUS = 3;

class Mold {
  // params: { count, sensorAngle (deg), sensorDist (px), turnAngle (deg), stepSize (px), deposit,
  //           decay (% per step), diffusion (0..1), foodStrength, start: 'disk' | 'ring' | 'random' | 'center' }
  constructor(params, rng) {
    this.w = MAP_W;
    this.h = MAP_H;
    this.p = params;
    this.trail = new Float32Array(MAP_W * MAP_H);
    this.tmp = new Float32Array(MAP_W * MAP_H);
    this.out = new Float32Array(MAP_W * MAP_H);
    this.x = new Float32Array(MAX_AGENTS);
    this.y = new Float32Array(MAX_AGENTS);
    this.a = new Float32Array(MAX_AGENTS);
    this.food = [];   // { x, y }: points that keep emitting trail, like oat flakes in the experiments
    this.n = 0;
    this.steps = 0;
    this.reset(rng);
  }

  reset(rng) {
    this.rng = rng;
    this.trail.fill(0);
    this.n = 0;
    this.steps = 0;
    this.setCount(this.p.count);
  }

  // New particles appear according to the start mode.
  setCount(count) {
    const n = Math.max(1, Math.min(MAX_AGENTS, Math.round(count)));
    const cx = this.w / 2, cy = this.h / 2, R = Math.min(this.w, this.h) * 0.4, rng = this.rng;
    for (let i = this.n; i < n; i++) {
      const t = rng() * Math.PI * 2;
      let x, y, a;
      if (this.p.start === 'disk') {          // filled disk, everyone heading outward
        const r = Math.sqrt(rng()) * R;
        x = cx + Math.cos(t) * r; y = cy + Math.sin(t) * r; a = t;
      } else if (this.p.start === 'ring') {   // thin ring, heading inward
        const r = R * (0.95 + 0.05 * rng());
        x = cx + Math.cos(t) * r; y = cy + Math.sin(t) * r; a = t + Math.PI;
      } else if (this.p.start === 'center') { // a point in the middle, random headings
        x = cx + (rng() - 0.5) * 4; y = cy + (rng() - 0.5) * 4; a = t;
      } else {
        x = rng() * this.w; y = rng() * this.h; a = t;
      }
      this.x[i] = x; this.y[i] = y; this.a[i] = a;
    }
    this.n = n;
  }

  step() {
    const p = this.p, w = this.w, h = this.h, T = this.trail, rng = this.rng;
    const X = this.x, Y = this.y, A = this.a;
    const sa = p.sensorAngle * Math.PI / 180, ra = p.turnAngle * Math.PI / 180;
    const so = p.sensorDist, ss = p.stepSize, dep = p.deposit;
    // Sensor and turn directions are the heading rotated by fixed angles: rotate the (cos, sin) pair
    // with precomputed values instead of calling cos/sin eight times per particle.
    const cS = Math.cos(sa), sS = Math.sin(sa), cR = Math.cos(ra), sR = Math.sin(ra);

    for (let i = 0, n = this.n; i < n; i++) {
      const x = X[i], y = Y[i];
      let a = A[i];
      let c = Math.cos(a), s = Math.sin(a);
      // Sample the trail at three sensors (wrapping around the edges: the map is a torus).
      let sx = (x + c * so) | 0, sy = (y + s * so) | 0;
      sx = sx < 0 ? sx + w : sx >= w ? sx - w : sx; sy = sy < 0 ? sy + h : sy >= h ? sy - h : sy;
      const F = T[sy * w + sx];
      sx = (x + (c * cS + s * sS) * so) | 0; sy = (y + (s * cS - c * sS) * so) | 0;   // heading - sa
      sx = sx < 0 ? sx + w : sx >= w ? sx - w : sx; sy = sy < 0 ? sy + h : sy >= h ? sy - h : sy;
      const L = T[sy * w + sx];
      sx = (x + (c * cS - s * sS) * so) | 0; sy = (y + (s * cS + c * sS) * so) | 0;   // heading + sa
      sx = sx < 0 ? sx + w : sx >= w ? sx - w : sx; sy = sy < 0 ? sy + h : sy >= h ? sy - h : sy;
      const R = T[sy * w + sx];

      // Jones' rule: keep going if the front is best; if the front is worst, turn either way at random;
      // otherwise turn toward the stronger side.
      let turn = 0;
      if (F > L && F > R) turn = 0;
      else if (F < L && F < R) turn = rng() < 0.5 ? -1 : 1;
      else if (L < R) turn = 1;
      else if (R < L) turn = -1;
      if (turn) {
        a += turn * ra;
        const c2 = c * cR - turn * s * sR;
        s = s * cR + turn * c * sR;
        c = c2;
      }

      let nx = x + c * ss, ny = y + s * ss;
      if (nx < 0) nx += w; else if (nx >= w) nx -= w;
      if (ny < 0) ny += h; else if (ny >= h) ny -= h;
      X[i] = nx; Y[i] = ny; A[i] = a;
      T[(ny | 0) * w + (nx | 0)] += dep;
    }

    // Food keeps emitting trail, so the network links the food points.
    for (const f of this.food) {
      for (let dy = -FOOD_RADIUS; dy <= FOOD_RADIUS; dy++) {
        for (let dx = -FOOD_RADIUS; dx <= FOOD_RADIUS; dx++) {
          if (dx * dx + dy * dy > FOOD_RADIUS * FOOD_RADIUS) continue;
          const x = ((f.x | 0) + dx + w) % w, y = ((f.y | 0) + dy + h) % h;
          T[y * w + x] += p.foodStrength;
        }
      }
    }

    this.diffuseAndDecay();
    this.steps++;
  }

  // 3x3 mean blur (two passes: rows, then columns), mixed with the old value by `diffusion`, then decay.
  diffuseAndDecay() {
    const w = this.w, h = this.h, T = this.trail, S = this.tmp, O = this.out;
    const d = this.p.diffusion, keep = 1 - this.p.decay / 100;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      S[row] = T[row + w - 1] + T[row] + T[row + 1];
      for (let x = 1; x < w - 1; x++) S[row + x] = T[row + x - 1] + T[row + x] + T[row + x + 1];
      S[row + w - 1] = T[row + w - 2] + T[row + w - 1] + T[row];
    }
    for (let y = 0; y < h; y++) {
      const row = y * w, up = (y === 0 ? h - 1 : y - 1) * w, down = (y === h - 1 ? 0 : y + 1) * w;
      for (let x = 0; x < w; x++) {
        const k = row + x;
        const mean = (S[up + x] + S[k] + S[down + x]) / 9;
        O[k] = (T[k] + (mean - T[k]) * d) * keep;
      }
    }
    this.out = T;
    this.trail = O;
  }

  toggleFood(x, y) {
    const hit = this.food.findIndex(f => Math.hypot(f.x - x, f.y - y) < 8);
    if (hit >= 0) this.food.splice(hit, 1); else this.food.push({ x, y });
  }
}

if (typeof module !== 'undefined') module.exports = { Mold, MAP_W, MAP_H, MAX_AGENTS };
