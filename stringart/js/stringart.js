// String art: one thread wound around nails on a circle draws a picture. No DOM here (runs in Node too).
//
// The picture is a darkness map (0 - white, 1 - black) inside the circle. A thread from nail i to nail j darkens the
// pixels along that chord: each thread lets through (1 − opacity) of the light. The gain of a chord is how much it
// would reduce the squared difference from the picture. "Greedy": from the current nail always take the chord with
// the biggest gain; stop when no chord helps any more. "Ant colony": several ants try short chains of a few chords ahead, choosing each next
// nail with probability ∝ pheromone^α · gain^β; the first chord of the best chain is laid and the chords of good
// chains get pheromone, so the colony remembers which chords paid off.

// ---- pictures without files (so the same code runs in Node) ----
const PICTURES = {
  heart: 'Сердце', face: 'Лицо', spiral: 'Спираль', sun: 'Солнце',
};
function makeTarget(kind, S) {
  const t = new Float32Array(S * S);
  const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const x = (px + 0.5) / S * 2 - 1, y = 1 - (py + 0.5) / S * 2, r = Math.hypot(x, y);
    let d = 0;
    if (kind === 'heart') {
      const X = x * 1.7, Y = (y + 0.05) * 1.7, f = (X * X + Y * Y - 1) ** 3 - X * X * Y ** 3;
      d = f < 0 ? 0.35 + 0.6 * sm(0, 0.5, -f * 6) : 0;
    } else if (kind === 'face') {
      const head = (x / 0.62) ** 2 + (y / 0.8) ** 2;
      d = sm(1.05, 0.95, head) * 0.25;                                 // a light face
      d += Math.max(0, 1 - Math.abs(Math.sqrt(head) - 1) / 0.05) * 0.8; // its outline
      for (const ex of [-0.24, 0.24]) d += sm(0.09, 0.06, Math.hypot(x - ex, y - 0.18)) * 0.9;   // eyes
      const mouth = Math.hypot(x, (y + 0.15) * 1.4);
      if (y < -0.25) d += Math.max(0, 1 - Math.abs(mouth - 0.45) / 0.04) * 0.8;                 // smile
      d += sm(0.8, 0.95, r) * 0.6 * (y > 0.35 ? 1 : 0);                   // hair at the top
    } else if (kind === 'spiral') {
      const a = Math.atan2(y, x), v = Math.sin(a * 2 + r * 18);
      d = (0.5 + 0.5 * v) * (0.3 + 0.7 * r) * sm(0.98, 0.9, r);
    } else {
      d = sm(0.25, 0.2, r) * 0.9 + Math.max(0, Math.cos(Math.atan2(y, x) * 12)) * sm(0.3, 0.4, r) * sm(0.95, 0.75, r) * 0.7;
    }
    t[py * S + px] = r < 1 ? Math.min(1, d) : 0;
  }
  return t;
}

class StringArt {
  // params: { nails, opacity (how dark one thread is), method: 'greedy' | 'ants', ants, depth, minSkip }
  constructor(target, S, params, rng) {
    this.S = S;
    this.p = params;
    this.rng = rng;
    this.target = target;
    this.dark = new Float32Array(S * S);   // how dark the threads made each pixel so far
    const N = params.nails;
    this.N = N;
    this.nx = Float64Array.from({ length: N }, (_, i) => (S - 1) / 2 + Math.cos(2 * Math.PI * i / N - Math.PI / 2) * (S - 1) / 2);
    this.ny = Float64Array.from({ length: N }, (_, i) => (S - 1) / 2 + Math.sin(2 * Math.PI * i / N - Math.PI / 2) * (S - 1) / 2);
    this.lines = new Map();
    this.used = new Set();
    this.tau = new Float32Array(N * N).fill(1);
    this.seq = [0];
    this.cur = 0;
  }

  // Pixels of the chord a-b (cached).
  chord(a, b) {
    if (a > b) [a, b] = [b, a];
    const key = a * this.N + b;
    let px = this.lines.get(key);
    if (!px) {
      const x0 = this.nx[a], y0 = this.ny[a], x1 = this.nx[b], y1 = this.ny[b];
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
      px = new Int32Array(n);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1 || 1);
        px[k] = Math.round(y0 + (y1 - y0) * t) * this.S + Math.round(x0 + (x1 - x0) * t);
      }
      this.lines.set(key, px);
    }
    return px;
  }

  allowed(a, b) {
    const d = Math.abs(a - b), skip = Math.min(d, this.N - d);
    return skip >= this.p.minSkip && !this.used.has(Math.min(a, b) * this.N + Math.max(a, b));
  }

  // How much laying the chord a-b would lower the squared error (positive - it helps).
  gain(a, b, dark) {
    const px = this.chord(a, b), op = this.p.opacity, t = this.target;
    let s = 0;
    for (let k = 0; k < px.length; k++) {
      const p = px[k], d = dark[p], nd = d + op * (1 - d);
      s += (d - t[p]) ** 2 - (nd - t[p]) ** 2;
    }
    return s;
  }

  lay(a, b, dark) {
    const px = this.chord(a, b), op = this.p.opacity;
    for (let k = 0; k < px.length; k++) dark[px[k]] += op * (1 - dark[px[k]]);
  }

  bestGreedy(from, res) {
    let best = -1, bg = -Infinity;
    for (let j = 0; j < this.N; j++) {
      if (!this.allowed(from, j)) continue;
      const g = this.gain(from, j, res);
      if (g > bg) { bg = g; best = j; }
    }
    return { j: best, g: bg };
  }

  // The colony: each ant plans `depth` chords ahead on a scratch copy of the threads; the best chain wins.
  bestAnts() {
    const { ants, depth } = this.p, alpha = 1, beta = 4, TOP = 12;
    let bestChain = null, bestScore = -Infinity;
    for (let a = 0; a < ants; a++) {
      const scratch = Float32Array.from(this.dark);
      let from = this.cur, score = 0;
      const chain = [];
      for (let d = 0; d < depth; d++) {
        // The TOP best next nails by gain, then a random pick weighted by pheromone and gain.
        const cand = [];
        for (let j = 0; j < this.N; j++) {
          if (!this.allowed(from, j) || chain.includes(j)) continue;
          cand.push([j, this.gain(from, j, scratch)]);
        }
        cand.sort((u, v) => v[1] - u[1]);
        cand.length = Math.min(cand.length, TOP);
        if (!cand.length) break;
        const w = cand.map(([j, g]) => Math.pow(this.tau[from * this.N + j], alpha) * Math.pow(Math.max(1e-6, g), beta));
        let r = this.rng() * w.reduce((x, y) => x + y), k = 0;
        while (k < w.length - 1 && (r -= w[k]) > 0) k++;
        const [j, g] = cand[k];
        if (g <= 0) break;
        this.lay(from, j, scratch);   // pretend the thread is laid, so the next chord of this chain sees it
        score += g;
        chain.push(j);
        from = j;
      }
      if (score > bestScore) { bestScore = score; bestChain = chain; }
    }
    // Pheromone: everything evaporates a little, chords of the best chain get more.
    if (bestChain) {
      let from = this.cur;
      for (const j of bestChain) { this.tau[from * this.N + j] += 0.5; this.tau[j * this.N + from] += 0.5; from = j; }
    }
    return bestChain && bestChain.length ? bestChain[0] : -1;
  }

  // Lay one more thread. Returns false when no chord improves the picture any more.
  step() {
    let j;
    if (this.p.method === 'ants') j = this.bestAnts();
    else { const b = this.bestGreedy(this.cur, this.dark); j = b.g > 0 ? b.j : -1; }
    if (j < 0) { this.done = true; return false; }
    this.lay(this.cur, j, this.dark);
    this.used.add(Math.min(this.cur, j) * this.N + Math.max(this.cur, j));
    if (this.p.method === 'ants' && this.seq.length % 20 === 0) for (let k = 0; k < this.tau.length; k++) this.tau[k] = 1 + (this.tau[k] - 1) * 0.9;
    this.cur = j;
    this.seq.push(j);
    return true;
  }

  // Mean squared difference from the picture inside the circle (blurred 3×3, as the eye sees it from afar).
  error() {
    const S = this.S, c = (S - 1) / 2;
    let s = 0, n = 0;
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      if (Math.hypot(x - c, y - c) > c - 2) continue;
      let r = 0, t = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = (y + dy) * S + x + dx; r += this.dark[p]; t += this.target[p]; }
      s += ((r - t) / 9) ** 2;
      n++;
    }
    return s / n;
  }
}

if (typeof module !== 'undefined') module.exports = { PICTURES, makeTarget, StringArt };
