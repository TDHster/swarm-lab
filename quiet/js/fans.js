// Server rack fans that get rid of their beating by themselves. No DOM here (runs in Node too).
//
// A fan hums at its blade-pass frequency f = blades × rpm / 60. Two fans at almost the same speed sound like one
// tone that swells and fades - beats, |f1 − f2| times a second. Slow throbbing (a few per second) is the most
// annoying; equal speeds are impossible to hold exactly (fans differ by a fraction of a percent).
// Each fan has a microphone and only knows how annoying the beating around it is. Its rule is the one bacteria use
// to find food (run and tumble): keep changing the speed in the same direction while it gets better; if it got
// worse, pick a new random direction. It never goes below the speed its server needs for cooling.

const BLADES = 7, RPM_NOMINAL = 3000, RPM_MIN = 2400, RPM_MAX = 4200;

// How annoying beats of Δ Hz are: most at ~4 Hz throbbing, fading towards a steady tone (Δ → 0)
// and towards a rough chord (Δ > 20 Hz).
function annoy(d) {
  if (d < 0.05) return 0;
  const x = Math.log(d / 4) / 0.9;
  return 1 / (1 + x * x);
}

class Rack {
  // params: { fans, mode: 'plain' | 'plan' | 'swarm', hear (mic range, rack units), step (rpm per step), cols,
  //           thrift (how much a fan cares about its extra power) }
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
    this.setMode(params.mode);
  }

  setMode(mode) {
    this.p.mode = mode;
    if (mode === 'plain') this.cmd.fill(RPM_NOMINAL);
    if (mode === 'plan') {
      // The engineer's fix: fixed steps of 5% between fans, around the nominal speed.
      for (let i = 0; i < this.n; i++) this.cmd[i] = Math.min(RPM_MAX, Math.max(RPM_MIN, RPM_NOMINAL * (1 + 0.05 * (i - (this.n - 1) / 2))));
    }
    this.last.fill(Infinity);
  }

  // A technician swaps fan i: the new one has its own manufacturing error and starts at the nominal speed.
  replace(i) {
    this.err[i] = (this.rng() * 2 - 1) * 0.007;
    this.cmd[i] = RPM_NOMINAL;
    this.last[i] = Infinity;
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
    // Fans drift a little by themselves (temperature, bearings).
    for (let i = 0; i < this.n; i++) this.err[i] = Math.max(-0.01, Math.min(0.01, this.err[i] + (this.rng() * 2 - 1) * 0.0002));
    this.t++;
  }
}

if (typeof module !== 'undefined') module.exports = { BLADES, RPM_NOMINAL, RPM_MIN, RPM_MAX, annoy, Rack };
