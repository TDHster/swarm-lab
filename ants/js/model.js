// Ant colony model: ants on a grid of cells with two pheromone fields. No DOM here - the same code
// runs in the browser and in Node (tools/smoke.js). Units: cells and steps (the app runs 60 steps/s × speed).
//
// An ant has two states. Searching: follows the "to food" pheromone, lays "to home".
// Carrying food: follows "to home", lays "to food". The amount it lays fades with the time since it left
// the nest or the food, so trails are strongest near their source and point back to it.

const GRID_W = 300;
const GRID_H = 175;
const CELL = 4;               // world pixels per cell (the world is 1200x700 like the other projects)
const MAX_ANTS = 4000;
const SOURCE_SENSE = 20;      // what a sensor "smells" on a food cell (searching) or in the nest (carrying)
const PHERO_MAX = 5;          // cap per cell, so a busy cell does not grow forever
const DEPOSIT = 0.5;          // pheromone laid per step by an ant that just left its source
const SENSE_MIN = 0.05;       // fainter scent is not noticed (otherwise ants get stuck on faint local peaks)
const RELEASE_STEPS = 2;      // ants leave the nest one by one, not as a single wave

class Colony {
  // params: { count, evaporation (% per second), diffusion (0..1 per step), sensorAngle (deg),
  //           sensorDist (cells), turn (deg), randomness (rad per step), speed (cells per step), memory (steps) }
  constructor(params, rng) {
    this.w = GRID_W;
    this.h = GRID_H;
    this.p = params;
    const n = GRID_W * GRID_H;
    this.home = new Float32Array(n);   // "to home" pheromone, laid by searching ants
    this.food = new Float32Array(n);   // "to food" pheromone, laid by ants carrying food
    this.buf = new Float32Array(n);    // scratch for diffusion
    this.walls = new Uint8Array(n);
    this.foodAmount = new Uint16Array(n);
    this.x = new Float32Array(MAX_ANTS);
    this.y = new Float32Array(MAX_ANTS);
    this.a = new Float32Array(MAX_ANTS);
    this.carrying = new Uint8Array(MAX_ANTS);
    this.strength = new Float32Array(MAX_ANTS);
    this.wait = new Uint16Array(MAX_ANTS);   // steps left before an ant leaves the nest
    this.nest = { x: GRID_W / 2, y: GRID_H / 2, r: 6 };
    this.delivered = 0;
    this.steps = 0;
    this.n = 0;
    this.rng = rng;
  }

  // Ants back to the nest, pheromones cleared; walls, food and the nest stay.
  reset(rng) {
    this.rng = rng;
    this.home.fill(0);
    this.food.fill(0);
    this.delivered = 0;
    this.steps = 0;
    this.n = 0;
    this.setCount(this.p.count);
  }

  setCount(count) {
    const n = Math.max(1, Math.min(MAX_ANTS, Math.round(count)));
    for (let i = this.n; i < n; i++) {
      const r = this.rng() * this.nest.r * 0.8, t = this.rng() * Math.PI * 2;
      this.x[i] = this.nest.x + Math.cos(t) * r;
      this.y[i] = this.nest.y + Math.sin(t) * r;
      this.a[i] = this.rng() * Math.PI * 2;
      this.carrying[i] = 0;
      this.strength[i] = 1;
      this.wait[i] = (i - this.n) * RELEASE_STEPS;
    }
    this.n = n;
  }

  inNest(x, y) {
    return (x - this.nest.x) ** 2 + (y - this.nest.y) ** 2 < this.nest.r ** 2;
  }

  blocked(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    return this.walls[(y | 0) * this.w + (x | 0)] === 1;
  }

  // Brush: 'food' | 'wall' | 'erase' in a circle of radius r cells. Nothing is painted over the nest.
  paint(type, cx, cy, r, amount = 60) {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.h - 1, cy + r); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.w - 1, cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        if (this.inNest(x + 0.5, y + 0.5) && type !== 'erase') continue;
        const k = y * this.w + x;
        if (type === 'food') { if (!this.walls[k]) this.foodAmount[k] = amount; }
        else if (type === 'wall') { this.walls[k] = 1; this.foodAmount[k] = 0; this.home[k] = 0; this.food[k] = 0; }
        else { this.walls[k] = 0; this.foodAmount[k] = 0; }
      }
    }
  }

  wallRect(x0, y0, x1, y1, value) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.walls[y * this.w + x] = value;
  }

  clearMap() {
    this.walls.fill(0);
    this.foodAmount.fill(0);
  }

  loadPreset(name) {
    this.clearMap();
    if (name === 'field') {
      this.nest = { x: 150, y: 88, r: 6 };
      this.paint('food', 45, 40, 9);
      this.paint('food', 255, 45, 7);
      this.paint('food', 235, 140, 8);
    } else if (name === 'bridge') {
      // The double bridge experiment (Deneubourg et al., 1990): two routes of different length
      // from the same fork. Everything is rock except the nest chamber, the two tunnels and the food chamber.
      this.nest = { x: 40, y: 88, r: 6 };
      this.wallRect(0, 0, GRID_W, GRID_H, 1);
      this.wallRect(12, 58, 72, 118, 0);     // nest chamber
      this.wallRect(72, 80, 116, 96, 0);     // corridor to the fork: rock straight ahead, turn up or down
      this.wallRect(100, 50, 116, 166, 0);   // the fork column
      this.wallRect(100, 50, 212, 66, 0);    // upper branch (short)
      this.wallRect(100, 150, 212, 166, 0);  // lower branch (longer)
      this.wallRect(196, 50, 212, 166, 0);   // both meet again
      this.wallRect(212, 80, 228, 96, 0);    // corridor to the food
      this.wallRect(228, 58, 288, 118, 0);   // food chamber
      this.paint('food', 262, 88, 10, 5000);
    } else if (name === 'maze') {
      this.nest = { x: 25, y: 25, r: 6 };
      for (let k = 0; k < 4; k++) {
        const x = 60 + k * 55;
        if (k % 2 === 0) this.wallRect(x, 0, x + 8, 135, 1); else this.wallRect(x, 40, x + 8, GRID_H, 1);
      }
      this.paint('food', 275, 150, 9, 5000);
    } else {
      this.nest = { x: 150, y: 88, r: 6 };
    }
  }

  // What one sensor smells: the pheromone this ant follows, plus a strong signal from its goal.
  // Walls and the edge smell "negative", so ants turn away from them.
  sense(x, y, carrying) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    const k = (y | 0) * this.w + (x | 0);
    if (this.walls[k]) return -1;
    const v = carrying ? this.home[k] : this.food[k];
    const scent = v < SENSE_MIN ? 0 : v;
    if (carrying) return scent + (this.inNest(x, y) ? SOURCE_SENSE : 0);
    return scent + (this.foodAmount[k] > 0 ? SOURCE_SENSE : 0);
  }

  step() {
    const p = this.p, w = this.w, rng = this.rng;
    const sa = p.sensorAngle * Math.PI / 180, sd = p.sensorDist, turn = p.turn * Math.PI / 180;
    const fade = Math.pow(0.5, 1 / Math.max(1, p.memory));
    const X = this.x, Y = this.y, A = this.a;

    for (let i = 0; i < this.n; i++) {
      if (this.wait[i] > 0) { this.wait[i]--; continue; }
      const c = this.carrying[i];
      let a = A[i];
      const L = this.sense(X[i] + Math.cos(a - sa) * sd, Y[i] + Math.sin(a - sa) * sd, c);
      const F = this.sense(X[i] + Math.cos(a) * sd, Y[i] + Math.sin(a) * sd, c);
      const R = this.sense(X[i] + Math.cos(a + sa) * sd, Y[i] + Math.sin(a + sa) * sd, c);
      if (F < L || F < R) a += L > R ? -turn : turn;   // turn toward the stronger side
      a += (rng() * 2 - 1) * p.randomness;              // and wander a little

      const nx = X[i] + Math.cos(a) * p.speed, ny = Y[i] + Math.sin(a) * p.speed;
      if (this.blocked(nx, ny)) {
        // Bumped into a wall: pick a random open direction. Turning straight back instead makes ants
        // slide along walls and pile up there (persistent walkers accumulate at walls).
        for (let t = 0; t < 8; t++) {
          const b = rng() * Math.PI * 2;
          if (!this.blocked(X[i] + Math.cos(b) * sd * 0.5, Y[i] + Math.sin(b) * sd * 0.5)) { a = b; break; }
        }
      } else {
        X[i] = nx; Y[i] = ny;
      }
      A[i] = a;

      const k = (Y[i] | 0) * w + (X[i] | 0);
      const home = this.inNest(X[i], Y[i]);
      // No marks inside the nest: "to food" scent dropped there by carriers makes a local peak,
      // and searching ants end up circling in the nest instead of leaving it.
      if (!home) {
        const field = c ? this.food : this.home;
        field[k] = Math.min(PHERO_MAX, field[k] + DEPOSIT * this.strength[i]);
      }
      this.strength[i] *= fade;

      if (!c && this.foodAmount[k] > 0) {
        this.foodAmount[k]--;
        this.carrying[i] = 1;
        A[i] += Math.PI;
        this.strength[i] = 1;
      } else if (home) {
        if (c) {
          this.delivered++;
          this.carrying[i] = 0;
          A[i] += Math.PI;
        }
        this.strength[i] = 1;
      }
    }

    // Evaporation (% per second at 60 steps/s) and diffusion (a share of each cell spreads to 4 neighbors).
    const keep = Math.pow(1 - Math.min(99, p.evaporation) / 100, 1 / 60);
    this.home = this.spread(this.home, p.diffusion, keep);
    this.food = this.spread(this.food, p.diffusion, keep);
    this.steps++;
  }

  // Returns the new field; the old array becomes the scratch buffer (no allocation per step).
  spread(f, d, keep) {
    const w = this.w, h = this.h, out = this.buf, walls = this.walls;
    if (d <= 0) {
      for (let k = 0; k < f.length; k++) f[k] *= keep;
      return f;
    }
    for (let y = 0; y < h; y++) {
      const row = y * w, up = y > 0 ? row - w : row, down = y < h - 1 ? row + w : row;
      for (let x = 0; x < w; x++) {
        const k = row + x;
        if (walls[k]) { out[k] = 0; continue; }
        const l = x > 0 ? k - 1 : k, r = x < w - 1 ? k + 1 : k;
        const avg = (f[l] + f[r] + f[up + x] + f[down + x]) * 0.25;
        out[k] = (f[k] + (avg - f[k]) * d) * keep;
      }
    }
    this.buf = f;
    return out;
  }

  foodLeft() {
    let s = 0;
    for (let k = 0; k < this.foodAmount.length; k++) s += this.foodAmount[k];
    return s;
  }
}

if (typeof module !== 'undefined') module.exports = { Colony, GRID_W, GRID_H, CELL, MAX_ANTS };
