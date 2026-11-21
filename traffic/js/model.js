// Phantom traffic jam on a ring road (after Sugiyama et al. 2008: 22 cars on a 230 m circle).
// No DOM here (runs in Node too).
//
// Human drivers follow the Intelligent Driver Model (Treiber, Hennecke, Helbing 2000): speed up towards the
// desired speed, keep a safe time gap to the car ahead, brake harder when closing in fast - plus a little random
// unsteadiness (nobody holds the pedal perfectly). With gentle acceleration a small wobble grows from car to car
// backwards: a stop-and-go wave that moves against the traffic although nobody caused it.
// An "autopilot" car does not chase the car ahead: it drives at the average speed of the recent past and only
// keeps a safe distance (like the controller in Stern et al. 2018, where one such car dissolved the waves).

const CAR_LEN = 4.5;   // m
const AUTO_MEMORY = 30, AUTO_CATCH = 2, AUTO_GAP = 8;   // autopilot: averaging window (s), catch-up limit (m/s), gap (m)

class Ring {
  // params: { cars, length (m), v0 (desired, m/s), T (time gap, s), a (acceleration, m/s²), b (comfortable braking),
  //           noise (m/s², random unsteadiness), auto (number of autopilot cars) }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    const n = params.cars;
    this.n = n;
    this.x = new Float64Array(n);    // position along the ring, m (car k+1 is ahead of car k)
    this.v = new Float64Array(n);
    this.acc = new Float64Array(n);
    this.avg = new Float64Array(n);  // the autopilot's slow running average of its own speed
    this.isAuto = new Uint8Array(n);
    this.brakeUntil = new Float64Array(n);   // a forced brake by the visitor, until this time
    for (let k = 0; k < n; k++) { this.x[k] = k * params.length / n; this.v[k] = 0; }
    this.setAuto(params.auto || 0);
    this.t = 0;
  }

  // Autopilots are spread evenly around the ring.
  setAuto(m) {
    this.p.auto = m;
    this.isAuto.fill(0);
    for (let j = 0; j < m; j++) this.isAuto[Math.floor(j * this.n / m)] = 1;
  }

  gap(k) {
    const ahead = (k + 1) % this.n;
    let g = this.x[ahead] - this.x[k] - CAR_LEN;
    if (g < -this.p.length / 2) g += this.p.length;
    return g;
  }

  gauss() { return Math.sqrt(-2 * Math.log(1 - this.rng())) * Math.cos(2 * Math.PI * this.rng()); }

  // Intelligent Driver Model acceleration.
  idm(v, gap, dv, a, T) {
    const p = this.p, s0 = 2;
    const sStar = s0 + Math.max(0, v * T + v * dv / (2 * Math.sqrt(a * p.b)));
    return a * (1 - Math.pow(v / p.v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
  }

  step(dt) {
    const { n, x, v, acc, p } = this;
    for (let k = 0; k < n; k++) {
      const ahead = (k + 1) % n, g = this.gap(k), dv = v[k] - v[ahead];
      let a;
      if (this.t < this.brakeUntil[k]) {
        a = -4;   // the visitor pressed the brake
      } else if (this.isAuto[k]) {
        // Autopilot: aim at the recent average speed (plus a little more if the gap ahead has grown large, so it
        // does not fall behind), but never closer than a calm IDM driver would allow.
        this.avg[k] += (v[k] - this.avg[k]) * dt / AUTO_MEMORY;
        const target = this.avg[k] + Math.min(AUTO_CATCH, Math.max(0, 0.1 * (g - AUTO_GAP)));
        a = Math.min(0.5 * (target - v[k]), this.idm(v[k], g, dv, 1.5, p.T));
      } else {
        a = this.idm(v[k], g, dv, p.a, p.T) + p.noise * this.gauss();
      }
      acc[k] = Math.max(-9, a);
    }
    for (let k = 0; k < n; k++) {
      v[k] = Math.max(0, v[k] + acc[k] * dt);
      x[k] = (x[k] + v[k] * dt) % p.length;
    }
    this.t += dt;
  }

  brake(k, seconds) { this.brakeUntil[k] = this.t + seconds; }

  stats() {
    let s = 0, s2 = 0, stopped = 0, minGap = Infinity;
    for (let k = 0; k < this.n; k++) { s += this.v[k]; s2 += this.v[k] ** 2; if (this.v[k] < 0.5) stopped++; minGap = Math.min(minGap, this.gap(k)); }
    const m = s / this.n;
    return { mean: m, sd: Math.sqrt(Math.max(0, s2 / this.n - m * m)), stopped, minGap };
  }
}

if (typeof module !== 'undefined') module.exports = { CAR_LEN, Ring };
