// The delivery round without a browser: invariants and the comparison quoted on the page.
// Usage: node tools/smoke.js [--table]
const { makeRng } = require('../js/rng.js');
const T = require('../js/tsp.js');
const { AntColony } = require('../js/aco.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const isTour = (t, n) => t.length === n && new Set(t).size === n && t[0] === 0;
const base = { ants: 30, alpha: 1, beta: 3, rho: 0.05, localSearch: false };

function compare(kind, n, seed, iters, over = {}) {
  const pts = T.makeCities(kind, n - 1, makeRng(seed)), d = T.distanceMatrix(pts), N = pts.length;
  const g = T.greedyTour(d, N), g2 = T.twoOpt(g, d, N);
  const c = new AntColony(d, N, { ...base, ants: Math.min(N, over.localSearch ? 15 : 30), ...over }, makeRng(seed + 100));
  const t0 = performance.now();
  for (let k = 0; k < iters; k++) c.iterate();
  const ms = (performance.now() - t0) / iters;
  const opt = T.heldKarp(d, N);
  return { N, greedy: T.tourLength(g, d, N), two: T.tourLength(g2, d, N), aco: c.bestLen, opt: opt ? T.tourLength(opt, d, N) : null, ms, c, d, g2 };
}

// Invariants.
const small = compare('random', 12, 1, 100);
check(isTour(small.c.best, small.N), 'ACO round visits every address once and starts at the depot');
check(Math.abs(small.opt - Math.min(small.opt, small.aco, small.two, small.greedy)) < 1e-6, `Held-Karp is never beaten: optimum ${small.opt.toFixed(1)}`);
check(small.aco <= small.opt * 1.001, `12 addresses: ACO finds the optimum (${small.aco.toFixed(1)} vs ${small.opt.toFixed(1)})`);
const big = compare('random', 60, 2, 150);
check(big.aco < big.greedy, `60 addresses: ACO ${big.aco.toFixed(0)} beats greedy ${big.greedy.toFixed(0)}`);

if (process.argv.includes('--table')) {
  const pct = (v, ref) => ((v / ref - 1) * 100).toFixed(1) + '%';
  console.log('\nLength over the best known (Held-Karp optimum for 12; best of all methods otherwise):');
  for (const [kind, n, iters] of [['random', 12, 100], ['random', 50, 300], ['random', 100, 300], ['clusters', 60, 300]]) {
    for (const seed of [1, 2, 3]) {
      const a = compare(kind, n, seed, iters), b = compare(kind, n, seed, Math.round(iters / 5), { localSearch: true });
      const ref = a.opt ?? Math.min(a.greedy, a.two, a.aco, b.aco);
      console.log(`${kind} ${n} seed ${seed}: greedy +${pct(a.greedy, ref)}, 2-opt +${pct(a.two, ref)}, ACO(${iters} it) +${pct(a.aco, ref)}`
        + ` [${a.ms.toFixed(1)} ms/it], ACO+2opt(${Math.round(iters / 5)} it) +${pct(b.aco, ref)} [${b.ms.toFixed(1)} ms/it]${a.opt ? ' (exact)' : ''}`);
    }
  }
}
process.exit(failed ? 1 : 0);
