// Ant colony optimization for the delivery round: Max-Min Ant System (Stützle & Hoos, 2000).
// No DOM here (runs in Node too).
//
// Every iteration each ant builds a whole round: from its current point it picks the next address with
// probability ∝ τ^α · (1/d)^β - pheromone on the road (what the colony learned) times closeness (common sense).
// Then pheromone evaporates everywhere (ρ), and the best round adds 1/length to its roads. Pheromone is kept
// between τmin and τmax, so no road is ever forgotten completely - that keeps the colony exploring.

class AntColony {
  // params: { ants, alpha, beta, rho, localSearch (bool: polish each ant's round with 2-opt) }
  constructor(d, n, params, rng) {
    this.d = d;
    this.n = n;
    this.p = params;
    this.rng = rng;
    this.tau = new Float64Array(n * n);
    this.weight = new Float64Array(n * n);
    this.reset();
  }

  reset() {
    const n = this.n;
    this.iter = 0;
    this.best = null;
    this.bestLen = Infinity;
    this.iterBest = null;
    this.history = [];
    // Start with a high pheromone level (τmax of the greedy round): early on all roads look equally good.
    const g = tourLength(greedyTour(this.d, n), this.d, n);
    this.setBounds(g);
    this.tau.fill(this.tauMax);
  }

  setBounds(len) {
    this.tauMax = 1 / (this.p.rho * len);
    this.tauMin = this.tauMax / (2 * this.n);
  }

  // One round by one ant, starting from a random point (a round is a cycle, the start does not matter).
  buildTour() {
    const n = this.n, d = this.d, tau = this.tau, w = this.weight, rng = this.rng;
    const used = new Uint8Array(n), tour = new Array(n);
    let cur = Math.floor(rng() * n);
    tour[0] = cur;
    used[cur] = 1;
    const probs = new Float64Array(n);
    for (let k = 1; k < n; k++) {
      let sum = 0;
      const row = cur * n;
      for (let j = 0; j < n; j++) {
        const v = used[j] ? 0 : w[row + j];
        probs[j] = v;
        sum += v;
      }
      let r = rng() * sum, next = -1;
      for (let j = 0; j < n; j++) {
        if (!probs[j]) continue;
        r -= probs[j];
        if (r <= 0) { next = j; break; }
      }
      if (next < 0) for (let j = n - 1; j >= 0; j--) if (!used[j]) { next = j; break; }   // rounding guard
      tour[k] = next;
      used[next] = 1;
      cur = next;
    }
    // Rotate so that the round starts at the depot (only for drawing and comparing).
    const z = tour.indexOf(0);
    return tour.slice(z).concat(tour.slice(0, z));
  }

  iterate() {
    const n = this.n, d = this.d, p = this.p;
    // Attractiveness of every road: τ^α · (1/d)^β.
    for (let k = 0; k < n * n; k++) {
      const dist = d[k] || 1e-9;
      this.weight[k] = Math.pow(this.tau[k], p.alpha) * Math.pow(1 / dist, p.beta);
    }
    let iterBest = null, iterLen = Infinity;
    this.tours = [];
    for (let a = 0; a < p.ants; a++) {
      let t = this.buildTour();
      if (p.localSearch) t = twoOpt(t, d, n);
      const len = tourLength(t, d, n);
      this.tours.push(t);
      if (len < iterLen) { iterLen = len; iterBest = t; }
    }
    if (iterLen < this.bestLen) {
      this.bestLen = iterLen;
      this.best = iterBest;
      this.setBounds(iterLen);
    }
    this.iterBest = iterBest;
    this.iterLen = iterLen;
    // Evaporate, then the iteration's best ant lays pheromone (every 10th iteration - the best ever round).
    const tau = this.tau, keep = 1 - p.rho;
    for (let k = 0; k < n * n; k++) tau[k] *= keep;
    const layer = this.iter % 10 === 9 ? this.best : iterBest, add = 1 / tourLength(layer, d, n);
    for (let k = 0; k < n; k++) {
      const a = layer[k], b = layer[(k + 1) % n];
      tau[a * n + b] += add;
      tau[b * n + a] += add;
    }
    for (let k = 0; k < n * n; k++) tau[k] = Math.min(this.tauMax, Math.max(this.tauMin, tau[k]));
    this.iter++;
    this.history.push({ best: this.bestLen, iter: iterLen });
  }
}

if (typeof module !== 'undefined') {
  Object.assign(globalThis, require('./tsp.js'));
  module.exports = { AntColony };
}
