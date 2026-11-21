// A quiet zone around a pillow made by several cheap speakers that each listen to their own microphone.
// No DOM here (runs in Node too).
//
// One tone (a hum) fills a 5 × 4 m bedroom. Sound is computed as a steady wave: every point has a complex amplitude
// p = Σ q_s · G(point, s) over all sources s (the hum and the speakers), G = e^{-ikr}/(4πr) plus mirror images in the
// four walls (first reflections, reflection factor ρ). A speaker changes its own complex amplitude q (loudness and
// phase) by a small gradient step that lowers |p|² at the microphones it can hear: its own, its neighbours', or all.

const ROOM_W = 5, ROOM_H = 4, GRID = 0.05, C_SOUND = 343;
const HEAD = { x: 2.5, y: 0.75 }, ZONE_R = 0.3;

class Zone {
  // params: { f (Hz), speakers, listen: 'own' | 'neighbors' | 'all', mu (step), reflect (0..0.9), src: {x, y} }
  constructor(params) {
    this.p = params;
    this.nx = Math.round(ROOM_W / GRID);
    this.ny = Math.round(ROOM_H / GRID);
    this.layout();
  }

  // Speakers on an arc around the head (the headboard is the top wall), each with a microphone
  // 60% of the way from the speaker to the head.
  layout() {
    const K = this.p.speakers;
    this.spk = [];
    this.mic = [];
    for (let j = 0; j < K; j++) {
      const a = Math.PI * (K === 1 ? 0.5 : 0.1 + 0.8 * j / (K - 1));
      const sx = HEAD.x + Math.cos(a) * 0.7, sy = HEAD.y + Math.sin(a) * 0.6 - 0.25;
      this.spk.push({ x: sx, y: Math.max(0.1, sy) });
    }
    for (const s of this.spk) this.mic.push({ x: s.x + (HEAD.x - s.x) * 0.6, y: s.y + (HEAD.y - s.y) * 0.6 });
    this.q = this.spk.map(() => [0, 0]);   // complex amplitudes (re, im), start silent
    this.rebuild();
  }

  // Complex transfer from a source at (sx, sy) to (x, y), with first wall reflections.
  green(sx, sy, x, y) {
    const k = 2 * Math.PI * this.p.f / C_SOUND, rho = this.p.reflect;
    let re = 0, im = 0;
    const add = (ix, iy, g) => {
      const r = Math.max(0.05, Math.hypot(x - ix, y - iy));
      re += g * Math.cos(-k * r) / (4 * Math.PI * r);
      im += g * Math.sin(-k * r) / (4 * Math.PI * r);
    };
    add(sx, sy, 1);
    if (rho > 0) {
      add(-sx, sy, rho); add(2 * ROOM_W - sx, sy, rho);
      add(sx, -sy, rho); add(sx, 2 * ROOM_H - sy, rho);
    }
    return [re, im];
  }

  // Precompute the field of every source over the room and at the microphones.
  rebuild() {
    const { nx, ny } = this, n = nx * ny;
    const src = this.p.src, all = [src, ...this.spk];
    this.maps = all.map(s => {
      const m = new Float64Array(2 * n);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const [re, im] = this.green(s.x, s.y, (i + 0.5) * GRID, (j + 0.5) * GRID);
        m[2 * (j * nx + i)] = re; m[2 * (j * nx + i) + 1] = im;
      }
      return m;
    });
    // G[m][s]: from source s (0 = hum, 1.. = speakers) to microphone m.
    this.G = this.mic.map(mc => all.map(s => this.green(s.x, s.y, mc.x, mc.y)));
    this.zoneCells = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (Math.hypot((i + 0.5) * GRID - HEAD.x, (j + 0.5) * GRID - HEAD.y) < ZONE_R) this.zoneCells.push(j * nx + i);
    }
  }

  // Which microphones speaker j listens to.
  heard(j) {
    const K = this.spk.length, l = this.p.listen;
    if (l === 'all') return [...Array(K).keys()];
    if (l === 'neighbors') return [j - 1, j, j + 1].filter(m => m >= 0 && m < K);
    return [j];
  }

  micPressure(m) {
    const g = this.G[m];
    let re = g[0][0], im = g[0][1];   // the hum, strength 1
    this.q.forEach(([a, b], j) => { const [gr, gi] = g[j + 1]; re += a * gr - b * gi; im += a * gi + b * gr; });
    return [re, im];
  }

  // One adaptation step for every speaker at once (normalised LMS).
  step() {
    const K = this.spk.length, pm = this.mic.map((_, m) => this.micPressure(m)), next = [];
    for (let j = 0; j < K; j++) {
      let gr = 0, gi = 0, norm = 1e-12;
      for (const m of this.heard(j)) {
        const [a, b] = this.G[m][j + 1], [pr, pi] = pm[m];
        gr += a * pr + b * pi;   // conj(G) · p
        gi += a * pi - b * pr;
        norm += a * a + b * b;
      }
      const mu = this.p.mu / norm;
      next.push([this.q[j][0] - mu * gr, this.q[j][1] - mu * gi]);
    }
    this.q = next;
  }

  // Complex pressure in grid cell c.
  at(c) {
    let re = this.maps[0][2 * c], im = this.maps[0][2 * c + 1];
    this.q.forEach(([a, b], j) => { const m = this.maps[j + 1]; re += a * m[2 * c] - b * m[2 * c + 1]; im += a * m[2 * c + 1] + b * m[2 * c]; });
    return [re, im];
  }

  // dB change (vs the hum alone) at the pillow zone, at the microphones, and over the whole room.
  report() {
    const n = this.nx * this.ny;
    const db = (cells, withQ) => {
      let s = 0, s0 = 0;
      for (const c of cells) {
        const [re, im] = this.at(c);
        s += re * re + im * im;
        s0 += this.maps[0][2 * c] ** 2 + this.maps[0][2 * c + 1] ** 2;
      }
      return 10 * Math.log10(s / s0);
    };
    let mic = 0, mic0 = 0;
    this.mic.forEach((_, m) => { const [a, b] = this.micPressure(m); mic += a * a + b * b; mic0 += this.G[m][0][0] ** 2 + this.G[m][0][1] ** 2; });
    const all = Array.from({ length: n }, (_, c) => c);
    const power = this.q.reduce((s, [a, b]) => s + a * a + b * b, 0);
    return { zone: db(this.zoneCells), mic: 10 * Math.log10(mic / mic0), room: db(all), power };
  }
}

if (typeof module !== 'undefined') module.exports = { ROOM_W, ROOM_H, GRID, HEAD, ZONE_R, Zone };
