// A greenhouse cooled by fans that behave like fanning honeybees. No DOM here (runs in Node too).
//
// The greenhouse is a grid of air cells. The sun heats it; heat leaves through two openings in the end walls
// (an intake on the left, an exhaust on the right) and a little through the glass. Air moves only where fans blow:
// every fan that is on makes a jet ahead of it and a weak suction behind. Temperature is carried by that flow
// (advection) and spreads (diffusion).
// A fan, like a fanning bee, switches on when its own spot gets hotter than its threshold and off when it cools
// below the threshold minus 0.5 °C. Thresholds are equal for all, or differ from fan to fan (as between bees of
// different patrilines). Orientation: fixed as installed, all towards the exhaust (the engineer's tunnel), or turning
// to line up with the airflow around it and towards the heat (as bees line up at the hive entrance).

const GW = 60, GH = 30, CELL = 0.5;              // grid and cell size, m (a 30 × 15 m greenhouse)
const T_OUT = 26, T_STRESS = 32;                  // outside air, and the heat stress line for plants, °C
const VENT = { y0: 10, y1: 20 };                  // rows of the openings in the left and right walls
const U = 0.4, JET = 14;                          // jet speed (cells per step) and reach (cells)

class Greenhouse {
  // params: { sun, thresholds: 'same' | 'diverse', spread (°C, for diverse), aim: 'fixed' | 'tunnel' | 'bees' }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    this.T = new Float32Array(GW * GH).fill(36);   // the house has warmed up before the fans start
    this.tmp = new Float32Array(GW * GH);
    this.vx = new Float32Array(GW * GH);
    this.vy = new Float32Array(GW * GH);
    // 4 rows × 6 fans hanging under the roof.
    this.fans = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      this.fans.push({ x: 6 + c * 9.5, y: 4.5 + r * 7, a: rng() * Math.PI * 2, on: false, u: rng(), broken: false });
    }
    this.setThresholds();
    this.setAim(params.aim);
    this.t = 0;
    this.switches = 0;
    this.flow();
  }

  // Thresholds from 30 °C: all the same, or spread evenly over ±spread (each fan keeps its own u in 0..1).
  setThresholds() {
    for (const f of this.fans) f.th = this.p.thresholds === 'same' ? 30 : 30 + (f.u * 2 - 1) * this.p.spread;
  }
  setAim(aim) {
    this.p.aim = aim;
    if (aim === 'tunnel') for (const f of this.fans) f.a = 0;   // towards the exhaust on the right
    if (aim === 'fixed') for (const f of this.fans) f.a = this.fanSeed(f);
  }
  // The "as installed" direction is fixed per fan (derived from its own random number, so it is repeatable).
  fanSeed(f) { return f.u * 7919 % (Math.PI * 2); }

  // Air velocity: the sum of all running fans' jets.
  flow() {
    this.vx.fill(0); this.vy.fill(0);
    for (const f of this.fans) {
      if (!f.on || f.broken) continue;
      const c = Math.cos(f.a), s = Math.sin(f.a);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const dx = x + 0.5 - f.x, dy = y + 0.5 - f.y, along = dx * c + dy * s, across = dx * -s + dy * c;
        let m;
        if (along >= 0) { const w = 1.2 + 0.25 * along; m = U * Math.exp(-along / JET) * Math.exp(-across * across / (2 * w * w)); }
        else m = 0.4 * U * Math.exp(along / 3) * Math.exp(-across * across / 4.5);   // suction behind the fan
        this.vx[y * GW + x] += m * c;
        this.vy[y * GW + x] += m * s;
      }
    }
    // Clamp the speed so the advection step stays stable.
    for (let k = 0; k < GW * GH; k++) {
      const sp = Math.hypot(this.vx[k], this.vy[k]);
      if (sp > 0.45) { this.vx[k] *= 0.45 / sp; this.vy[k] *= 0.45 / sp; }
    }
  }

  isVent(x, y) { return (x === 0 || x === GW - 1) && y >= VENT.y0 && y < VENT.y1; }
  at(x, y) { return this.T[Math.min(GH - 1, Math.max(0, Math.floor(y))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(x)))]; }

  step() {
    const { T, tmp, vx, vy, p } = this;
    // Sun: stronger in the middle of the house (less shade from the walls).
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const k = y * GW + x, mid = Math.exp(-((x - GW / 2) ** 2) / 400 - ((y - GH / 2) ** 2) / 200);
      // Upwind advection, diffusion (walls are closed), heating and the slow loss through the glass.
      const u = vx[k], v = vy[k];
      const Tx = u > 0 ? (x > 0 ? T[k] - T[k - 1] : 0) : (x < GW - 1 ? T[k + 1] - T[k] : 0);
      const Ty = v > 0 ? (y > 0 ? T[k] - T[k - GW] : 0) : (y < GH - 1 ? T[k + GW] - T[k] : 0);
      let lap = 0;
      if (x > 0) lap += T[k - 1] - T[k]; if (x < GW - 1) lap += T[k + 1] - T[k];
      if (y > 0) lap += T[k - GW] - T[k]; if (y < GH - 1) lap += T[k + GW] - T[k];
      tmp[k] = T[k] - u * Tx - v * Ty + 0.1 * lap + p.sun * 0.028 * (0.6 + 0.8 * mid) - 0.002 * (T[k] - T_OUT);
      // The openings mix with outside air, faster when air flows through them.
      if (this.isVent(x, y)) tmp[k] += (T_OUT - tmp[k]) * Math.min(1, 0.05 + 2 * Math.hypot(u, v));
    }
    T.set(tmp);
    // Fans decide (every step) whether to run; orientation is updated every 10 steps.
    let changed = false;
    for (const f of this.fans) {
      if (f.broken) { f.on = false; continue; }
      const here = this.at(f.x, f.y), want = f.on ? here > f.th - 0.5 : here > f.th;
      if (want !== f.on) { f.on = want; changed = true; this.switches++; }
    }
    if (p.aim === 'bees' && this.t % 10 === 0) { this.turnLikeBees(); changed = true; }
    if (changed) this.flow();
    this.t++;
  }

  // A bee-like fan turns a little towards the air already flowing past it (made by the others)
  // and towards the hotter side; the result lines the fans up into streams.
  turnLikeBees() {
    for (const f of this.fans) {
      if (f.broken) continue;
      const k = Math.floor(f.y) * GW + Math.floor(f.x), c = Math.cos(f.a), s = Math.sin(f.a);
      // The others' flow here = total minus my own jet at my spot (U along my heading when on).
      const ox = this.vx[k] - (f.on ? U * c : 0), oy = this.vy[k] - (f.on ? U * s : 0);
      const gx = (this.at(f.x + 2, f.y) - this.at(f.x - 2, f.y)) / 4, gy = (this.at(f.x, f.y + 2) - this.at(f.x, f.y - 2)) / 4;
      const dx = ox * this.p.align + gx * this.p.heat, dy = oy * this.p.align + gy * this.p.heat;
      if (Math.hypot(dx, dy) < 1e-6) continue;
      let d = Math.atan2(dy, dx) - f.a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.a += Math.max(-0.35, Math.min(0.35, d)) + (this.rng() - 0.5) * 0.1;
    }
  }

  stats() {
    let hot = 0, sum = 0, max = -Infinity;
    for (let k = 0; k < GW * GH; k++) { const t = this.T[k]; sum += t; if (t > T_STRESS) hot++; if (t > max) max = t; }
    return { hot: hot / (GW * GH), mean: sum / (GW * GH), max, on: this.fans.filter(f => f.on).length };
  }
}

if (typeof module !== 'undefined') module.exports = { GW, GH, CELL, T_OUT, T_STRESS, VENT, Greenhouse };
