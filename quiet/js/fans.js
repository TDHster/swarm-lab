// Server rack fans that get rid of their beating by themselves. No DOM here (runs in Node too).
//
// A fan hums at its blade-pass frequency f = blades × rpm / 60. Two fans at almost the same speed sound like one
// tone that swells and fades - beats, |f1 − f2| times a second. Slow throbbing (a few per second) is the most
// annoying; equal speeds are impossible to hold exactly (fans differ by a fraction of a percent).
// Each fan has a microphone and only knows how annoying the beating around it is. Its rule is the one bacteria use
// to find food (run and tumble): keep changing the speed in the same direction while it gets better; if it got
// worse, pick a new random direction. It never goes below the speed its server needs for cooling.
//
// Synchrophasing (mode 'sync'), as on propeller aircraft: one shared clock holds every fan at exactly the same speed,
// so there are no beats, and each fan only shifts the phase of its blades. Two close sources in anti-phase radiate
// much less than two independent ones. A fan's microphone sits at its hub: the part of the neighbours' tone that goes
// in step with its own blades is the power it pumps into the room, W_i = 1 + Σ_j sinc(k·r_ij)·cos(φ_i − φ_j).
// Each fan turns its phase part of the way towards the value that makes W_i smallest. Nobody decides who pairs with whom.

const BLADES = 7, RPM_NOMINAL = 3000, RPM_MIN = 2400, RPM_MAX = 4200;
const SPACING = 0.12;   // m between fan centres in the rack
const AIR = 0.1;        // power of the air rush (broadband) per fan, relative to its blade tone: phases do not touch it

// How annoying beats of Δ Hz are: most at ~4 Hz throbbing, fading towards a steady tone (Δ → 0)
// and towards a rough chord (Δ > 20 Hz).
function annoy(d) {
  if (d < 0.05) return 0;
  const x = Math.log(d / 4) / 0.9;
  return 1 / (1 + x * x);
}

class Rack {
  // params: { fans, mode: 'plain' | 'plan' | 'swarm' | 'sync', hear (mic range, rack units), step (rpm per step), cols,
  //           thrift (how much a fan cares about its extra power),
  //           sync mode: eta (share of the way to the best phase per step), share (fans adjusting per step), jitter (rad) }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    const n = params.fans, cols = params.cols || 2;
    this.n = n;
    this.x = Float64Array.from({ length: n }, (_, i) => i % cols);
    this.y = Float64Array.from({ length: n }, (_, i) => Math.floor(i / cols));
    this.err = Float64Array.from({ length: n }, () => (rng() * 2 - 1) * 0.007);   // manufacturing spread
    this.cmd = new Float64Array(n).fill(RPM_NOMINAL);   // commanded rpm
    this.dir = Float64Array.from({ length: n }, () => (rng() < 0.5 ? -1 : 1));
    this.last = new Float64Array(n).fill(Infinity);
    this.t = 0;
    // sinc(k·r_ij): how strongly the tones of fans i and j add up in the room (1 for the fan itself).
    const k = 2 * Math.PI * (BLADES * RPM_NOMINAL / 60) / 343;
    this.S = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => {
      const kr = k * SPACING * Math.hypot(this.x[i] - this.x[j], this.y[i] - this.y[j]);
      return kr < 1e-9 ? 1 : Math.sin(kr) / kr;
    }));
    this.phase = null;   // blade phases, drawn on the first switch to 'sync' (other modes do not use the rng for them)
    this.setMode(params.mode);
  }

  setMode(mode) {
    this.p.mode = mode;
    if (mode === 'plain') this.cmd.fill(RPM_NOMINAL);
    if (mode === 'plan') {
      // The engineer's fix: fixed steps of 5% between fans, around the nominal speed.
      for (let i = 0; i < this.n; i++) this.cmd[i] = Math.min(RPM_MAX, Math.max(RPM_MIN, RPM_NOMINAL * (1 + 0.05 * (i - (this.n - 1) / 2))));
    }
    if (mode === 'sync' && !this.phase) this.phase = Float64Array.from({ length: this.n }, () => this.rng() * 2 * Math.PI);
    this.last.fill(Infinity);
  }

  // A technician swaps fan i: the new one has its own manufacturing error and starts at the nominal speed.
  replace(i) {
    this.err[i] = (this.rng() * 2 - 1) * 0.007;
    this.cmd[i] = RPM_NOMINAL;
    this.last[i] = Infinity;
    if (this.p.mode === 'sync') this.phase[i] = this.rng() * 2 * Math.PI;   // a new fan starts at any phase
  }

  rpm(i) { return this.cmd[i] * (1 + this.err[i]); }
  freq(i) { return BLADES * this.rpm(i) / 60; }

  // How much fan i's microphone picks up fan j.
  w(i, j) { const d2 = (this.x[i] - this.x[j]) ** 2 + (this.y[i] - this.y[j]) ** 2; return 1 / (1 + d2 / (this.p.hear * this.p.hear)); }

  // Beating heard at fan i, and by a person standing in front of the rack (hears every pair equally).
  heardAt(i) { let s = 0; for (let j = 0; j < this.n; j++) if (j !== i) s += this.w(i, j) * annoy(Math.abs(this.freq(i) - this.freq(j))); return s; }
  listener() {
    let s = 0;
    for (let i = 0; i < this.n; i++) for (let j = i + 1; j < this.n; j++) s += annoy(Math.abs(this.freq(i) - this.freq(j)));
    return s;   // "throbbing pairs": 0 - none, every pair adds up to 1 (throbbing at the worst rate)
  }
  // Blade tone in the room, dB relative to the same fans running independently (no fixed phases): 10·log(W / n).
  // In a room with echo the level everywhere follows the radiated power W.
  toneDb() {
    if (this.p.mode !== 'sync') return 0;
    let w = 0;
    for (let i = 0; i < this.n; i++) for (let j = 0; j < this.n; j++) w += this.S[i][j] * Math.cos(this.phase[i] - this.phase[j]);
    return 10 * Math.log10(Math.max(1e-6, w / this.n));
  }
  // The same together with the air rush, which no phase can cancel.
  roomDb() { return 10 * Math.log10((Math.pow(10, this.toneDb() / 10) + AIR) / (1 + AIR)); }

  gauss() { return Math.sqrt(-2 * Math.log(1 - this.rng())) * Math.cos(2 * Math.PI * this.rng()); }

  // Fan power relative to all fans at the nominal speed (power grows as rpm³).
  power() { let s = 0; for (let i = 0; i < this.n; i++) s += (this.rpm(i) / RPM_NOMINAL) ** 3; return s / this.n; }

  step() {
    if (this.p.mode === 'swarm') {
      // What a fan feels: the beating it hears plus the cost of running away from the nominal speed.
      const now = Array.from({ length: this.n }, (_, i) => this.heardAt(i) + this.p.thrift * ((this.cmd[i] - RPM_NOMINAL) / (0.1 * RPM_NOMINAL)) ** 2);
      for (let i = 0; i < this.n; i++) {
        // Worse than last time: tumble (random new direction). Better: keep running.
        if (now[i] > this.last[i] + 1e-9) this.dir[i] = this.rng() < 0.5 ? -1 : 1;
        this.last[i] = now[i];
        // Bigger steps when it feels worse, tiny ones when all is well.
        this.cmd[i] = Math.min(RPM_MAX, Math.max(RPM_MIN, this.cmd[i] + this.p.step * Math.min(1, now[i]) * this.dir[i]));
      }
    }
    if (this.p.mode === 'sync') {
      const ph = this.phase, next = ph.slice();
      for (let i = 0; i < this.n; i++) {
        if (this.rng() > this.p.share) continue;   // not every fan adjusts at the same moment
        // The phase that pumps the least power into the room: opposite to the neighbours' tone, weighted by sinc.
        let c = 0, s = 0;
        for (let j = 0; j < this.n; j++) if (j !== i) { c += this.S[i][j] * Math.cos(ph[j]); s += this.S[i][j] * Math.sin(ph[j]); }
        const best = Math.atan2(s, c) + Math.PI, d = best - ph[i];
        next[i] = ph[i] + this.p.eta * Math.atan2(Math.sin(d), Math.cos(d));
      }
      // The clock is not perfect: phases wander a little.
      for (let i = 0; i < this.n; i++) ph[i] = next[i] + this.p.jitter * this.gauss();
    }
    // Fans drift a little by themselves (temperature, bearings).
    for (let i = 0; i < this.n; i++) this.err[i] = Math.max(-0.01, Math.min(0.01, this.err[i] + (this.rng() * 2 - 1) * 0.0002));
    // The shared clock: the speed controller cancels the fan's own error, so every fan turns at exactly the nominal speed.
    if (this.p.mode === 'sync') for (let i = 0; i < this.n; i++) this.cmd[i] = RPM_NOMINAL / (1 + this.err[i]);
    this.t++;
  }
}

if (typeof module !== 'undefined') module.exports = { BLADES, RPM_NOMINAL, RPM_MIN, RPM_MAX, SPACING, AIR, annoy, Rack };
