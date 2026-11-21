// Run PSO without a browser: invariants and success rates over many seeds.
// Usage: node tools/smoke.js [--table]   (--table prints the full comparison used for the page hints)
const { makeRng } = require('../js/rng.js');
const { Swarm, FUNCTIONS } = require('../js/model.js');

const base = { fn: 'rastrigin', count: 30, w: 0.72, c1: 1.49, c2: 1.49, vmax: 20, topology: 'global' };
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

// Share of seeds where the swarm ends within 1% of the range from a true minimum.
function successRate(over, iters = 200, seeds = 60) {
  let ok = 0, iterSum = 0;
  for (let s = 1; s <= seeds; s++) {
    const sw = new Swarm({ ...base, ...over }, makeRng(s));
    let hit = -1;
    for (let k = 0; k < iters; k++) {
      sw.step();
      if (hit < 0 && sw.missDistance() < 0.01) hit = sw.iter;
    }
    if (sw.missDistance() < 0.01) { ok++; iterSum += hit; }
  }
  return { rate: ok / seeds, iters: ok ? iterSum / ok : NaN };
}

// Invariants: everyone stays inside the range, best never gets worse, no NaN.
for (const fn of Object.keys(FUNCTIONS)) {
  const sw = new Swarm({ ...base, fn }, makeRng(7));
  let worse = false, out = false;
  const [x0, x1, y0, y1] = FUNCTIONS[fn].range;
  for (let k = 0; k < 150; k++) {
    const before = sw.gf;
    sw.step();
    if (sw.gf > before) worse = true;
    for (let i = 0; i < sw.n; i++) if (!(sw.x[i] >= x0 && sw.x[i] <= x1 && sw.y[i] >= y0 && sw.y[i] <= y1)) out = true;
  }
  check(!worse && !out && Number.isFinite(sw.gf), `${fn}: inside the range, best only improves (best ${sw.gf.toExponential(2)})`);
}
check(successRate({ fn: 'sphere' }).rate === 1, 'sphere: found in every seed');

if (process.argv.includes('--table')) {
  const rows = [
    ['classic', {}],
    ['c2=0 (own memory only)', { c2: 0 }],
    ['c1=0 (swarm only)', { c1: 0 }],
    ['w=0 (no inertia)', { w: 0 }],
    ['w=1 (no friction)', { w: 1 }],
    ['ring topology', { topology: 'ring' }],
    ['10 particles', { count: 10 }],
    ['100 particles', { count: 100 }],
  ];
  const fns = ['rastrigin', 'ackley', 'rosenbrock', 'himmelblau', 'schwefel'];
  console.log('\nsuccess rate (iterations to hit) over 60 seeds, 200 iterations:');
  console.log(''.padEnd(26) + fns.map(f => f.padEnd(16)).join(''));
  for (const [name, over] of rows) {
    const cells = fns.map(fn => {
      const r = successRate({ ...over, fn });
      return `${(r.rate * 100).toFixed(0)}% (${isNaN(r.iters) ? '-' : r.iters.toFixed(0)})`.padEnd(16);
    });
    console.log(name.padEnd(26) + cells.join(''));
  }
}
process.exit(failed ? 1 : 0);
