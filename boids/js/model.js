// Boids model (Craig Reynolds, 1987): agents, a neighbor grid and the three steering rules.
// No DOM here - the same code runs in the browser and in Node (tools/smoke.js).
// Units: world pixels and frames (the app runs a fixed 60 steps per second).

const WORLD_W = 1200;
const WORLD_H = 700;
const MAX_BOIDS = 3000;
const MAX_VISION = 150;       // keeps the grid at least 3 cells wide, so 3x3 cells never repeat
const OBSTACLE_MARGIN = 30;   // boids start turning away this far from an obstacle's edge
const WALL_MARGIN = 60;       // and this far from a wall (walls mode)
const FOCUS_MAX_NEIGHBORS = 64;

class Flock {
  // params: { count, separation, alignment, cohesion, vision, personal, fov, maxSpeed, maxForce,
  //           fear, edges: 'wrap' | 'walls' } - the app may change any of them between steps.
  constructor(params, rng) {
    this.w = WORLD_W;
    this.h = WORLD_H;
    this.p = params;
    this.x = new Float32Array(MAX_BOIDS);
    this.y = new Float32Array(MAX_BOIDS);
    this.vx = new Float32Array(MAX_BOIDS);
    this.vy = new Float32Array(MAX_BOIDS);
    this.ax = new Float32Array(MAX_BOIDS);
    this.ay = new Float32Array(MAX_BOIDS);
    this.nbCount = new Uint16Array(MAX_BOIDS);   // neighbors seen on the last step
    this.cellOf = new Int32Array(MAX_BOIDS);
    this.cellItems = new Int32Array(MAX_BOIDS);
    this.cellStart = null;
    this.cols = 0;
    this.rows = 0;
    this.obstacles = [];      // { x, y, r }
    this.predator = null;     // { x, y, r } or null
    this.focus = 0;           // index of the boid whose forces are recorded for drawing
    this.focusInfo = { neighbors: [], sep: [0, 0], ali: [0, 0], coh: [0, 0], flee: [0, 0], total: [0, 0] };
    this.stats = { order: 0, meanNeighbors: 0 };
    this.reset(rng);
  }

  reset(rng) {
    this.rng = rng;
    this.n = 0;
    this.setCount(this.p.count);
  }

  // Add boids at random places or drop the last ones; the rest keep flying.
  setCount(count) {
    const n = Math.max(1, Math.min(MAX_BOIDS, Math.round(count)));
    for (let i = this.n; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const s = this.p.maxSpeed * (0.5 + 0.5 * this.rng());
      this.x[i] = this.rng() * this.w;
      this.y[i] = this.rng() * this.h;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
    }
    this.n = n;
    if (this.focus >= n) this.focus = 0;
  }

  // Counting sort of boids into square-ish cells at least `vision` wide:
  // all neighbors of a boid are then in its own cell or the 8 around it.
  buildGrid(vision) {
    const cols = Math.max(1, Math.floor(this.w / vision));
    const rows = Math.max(1, Math.floor(this.h / vision));
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      this.cellStart = new Int32Array(cols * rows + 1);
    }
    const start = this.cellStart;
    start.fill(0);
    const cw = this.w / cols, ch = this.h / rows;
    for (let i = 0; i < this.n; i++) {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(this.x[i] / cw)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(this.y[i] / ch)));
      const c = cx + cy * cols;
      this.cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cols * rows);
    for (let i = 0; i < this.n; i++) this.cellItems[fill[this.cellOf[i]]++] = i;
  }

  // Reynolds steering: turn the current velocity toward `desired` direction at full speed,
  // but no harder than maxForce. Writes the result into out[0], out[1].
  steer(dx, dy, vx, vy, out) {
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { out[0] = 0; out[1] = 0; return; }
    let fx = dx / len * this.p.maxSpeed - vx;
    let fy = dy / len * this.p.maxSpeed - vy;
    const f = Math.hypot(fx, fy);
    if (f > this.p.maxForce) { fx *= this.p.maxForce / f; fy *= this.p.maxForce / f; }
    out[0] = fx; out[1] = fy;
  }

  step() {
    const p = this.p, n = this.n, w = this.w, h = this.h;
    const wrap = p.edges === 'wrap';
    const vision = Math.min(MAX_VISION, Math.max(5, p.vision));
    const personal = Math.min(vision, p.personal);
    this.buildGrid(vision);
    const r2 = vision * vision, s2 = personal * personal;
    const cosHalf = p.fov >= 360 ? -2 : Math.cos(p.fov * Math.PI / 360);
    const cols = this.cols, rows = this.rows, start = this.cellStart, items = this.cellItems;
    const X = this.x, Y = this.y, VX = this.vx, VY = this.vy;
    const tmp = [0, 0];
    const fi = this.focusInfo;
    let totalNeighbors = 0;

    for (let i = 0; i < n; i++) {
      const xi = X[i], yi = Y[i], vxi = VX[i], vyi = VY[i];
      const speed = Math.hypot(vxi, vyi);
      const isFocus = i === this.focus;
      if (isFocus) fi.neighbors.length = 0;
      let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, count = 0;
      const c = this.cellOf[i], cx = c % cols, cy = (c - cx) / cols;

      for (let oy = -1; oy <= 1; oy++) {
        let ny = cy + oy;
        if (ny < 0 || ny >= rows) { if (!wrap) continue; ny = (ny + rows) % rows; }
        for (let ox = -1; ox <= 1; ox++) {
          let nx = cx + ox;
          if (nx < 0 || nx >= cols) { if (!wrap) continue; nx = (nx + cols) % cols; }
          const cell = nx + ny * cols;
          for (let k = start[cell], end = start[cell + 1]; k < end; k++) {
            const j = items[k];
            if (j === i) continue;
            let dx = X[j] - xi, dy = Y[j] - yi;
            if (wrap) {
              // On a torus the neighbor may be closer "through" the edge.
              if (dx > w / 2) dx -= w; else if (dx < -w / 2) dx += w;
              if (dy > h / 2) dy -= h; else if (dy < -h / 2) dy += h;
            }
            const d2 = dx * dx + dy * dy;
            if (d2 > r2 || d2 < 1e-12) continue;
            const d = Math.sqrt(d2);
            // Field of view: neighbors behind the boid (outside the cone) are not seen.
            if (vxi * dx + vyi * dy < cosHalf * speed * d) continue;
            count++;
            aliX += VX[j]; aliY += VY[j];
            cohX += dx; cohY += dy;
            if (d2 < s2) { sepX -= dx / d2; sepY -= dy / d2; }   // 1/d: the closer, the stronger
            if (isFocus && fi.neighbors.length < FOCUS_MAX_NEIGHBORS) fi.neighbors.push(j);
          }
        }
      }

      let ax = 0, ay = 0;
      let sx = 0, sy = 0, lx = 0, ly = 0, hx = 0, hy = 0;
      if (count > 0) {
        this.steer(sepX, sepY, vxi, vyi, tmp); sx = tmp[0] * p.separation; sy = tmp[1] * p.separation;
        this.steer(aliX, aliY, vxi, vyi, tmp); lx = tmp[0] * p.alignment; ly = tmp[1] * p.alignment;
        this.steer(cohX, cohY, vxi, vyi, tmp); hx = tmp[0] * p.cohesion; hy = tmp[1] * p.cohesion;
        ax = sx + lx + hx; ay = sy + ly + hy;
      }

      // Fear: run straight away from the predator, harder the closer it is.
      let fx = 0, fy = 0;
      const pr = this.predator;
      if (pr && p.fear > 0) {
        let dx = xi - pr.x, dy = yi - pr.y;
        if (wrap) {
          if (dx > w / 2) dx -= w; else if (dx < -w / 2) dx += w;
          if (dy > h / 2) dy -= h; else if (dy < -h / 2) dy += h;
        }
        const d = Math.hypot(dx, dy);
        if (d < pr.r) {
          this.steer(dx, dy, vxi, vyi, tmp);
          const k = p.fear * (1 - d / pr.r) * 3;
          fx = tmp[0] * k; fy = tmp[1] * k;
          ax += fx; ay += fy;
        }
      }

      // Obstacles and walls: steer away when close (not a rule of the flock, just the world).
      for (const o of this.obstacles) {
        const dx = xi - o.x, dy = yi - o.y;
        const gap = Math.hypot(dx, dy) - o.r;
        if (gap < OBSTACLE_MARGIN) {
          this.steer(dx, dy, vxi, vyi, tmp);
          const k = 4 * (1 - Math.max(0, gap) / OBSTACLE_MARGIN);
          ax += tmp[0] * k; ay += tmp[1] * k;
        }
      }
      if (!wrap) {
        let wx = 0, wy = 0;
        if (xi < WALL_MARGIN) wx = 1; else if (xi > w - WALL_MARGIN) wx = -1;
        if (yi < WALL_MARGIN) wy = 1; else if (yi > h - WALL_MARGIN) wy = -1;
        if (wx || wy) {
          this.steer(wx, wy, vxi, vyi, tmp);
          ax += tmp[0] * 2; ay += tmp[1] * 2;
        }
      }

      this.ax[i] = ax; this.ay[i] = ay;
      this.nbCount[i] = count;
      totalNeighbors += count;
      if (isFocus) {
        fi.sep[0] = sx; fi.sep[1] = sy; fi.ali[0] = lx; fi.ali[1] = ly;
        fi.coh[0] = hx; fi.coh[1] = hy; fi.flee[0] = fx; fi.flee[1] = fy;
        fi.total[0] = ax; fi.total[1] = ay;
      }
    }

    // Move everyone only after all forces are known, so the result does not depend on boid order.
    const maxS = p.maxSpeed, minS = p.maxSpeed * 0.4;
    let ordX = 0, ordY = 0;
    for (let i = 0; i < n; i++) {
      let vx = VX[i] + this.ax[i], vy = VY[i] + this.ay[i];
      const s = Math.hypot(vx, vy);
      if (s > maxS) { vx *= maxS / s; vy *= maxS / s; }
      else if (s < minS) {
        if (s < 1e-9) { vx = minS; vy = 0; } else { vx *= minS / s; vy *= minS / s; }
      }
      let x = X[i] + vx, y = Y[i] + vy;
      if (wrap) {
        if (x < 0) x += w; else if (x >= w) x -= w;
        if (y < 0) y += h; else if (y >= h) y -= h;
      } else {
        if (x < 0) { x = 0; vx = Math.abs(vx); } else if (x > w) { x = w; vx = -Math.abs(vx); }
        if (y < 0) { y = 0; vy = Math.abs(vy); } else if (y > h) { y = h; vy = -Math.abs(vy); }
      }
      // A boid that got inside an obstacle is put back on its edge.
      for (const o of this.obstacles) {
        const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
        if (d < o.r) {
          const k = d > 1e-6 ? o.r / d : 0;
          x = o.x + (k ? dx * k : o.r); y = o.y + (k ? dy * k : 0);
        }
      }
      X[i] = x; Y[i] = y; VX[i] = vx; VY[i] = vy;
      const sp = Math.hypot(vx, vy);
      ordX += vx / sp; ordY += vy / sp;
    }
    // Order (polarization): 1 - everyone flies the same way, ~0 - directions are random.
    this.stats.order = Math.hypot(ordX, ordY) / n;
    this.stats.meanNeighbors = totalNeighbors / n;
  }

  nearestBoid(x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.x[i] - x) ** 2 + (this.y[i] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
}

if (typeof module !== 'undefined') module.exports = { Flock, WORLD_W, WORLD_H, MAX_BOIDS };
