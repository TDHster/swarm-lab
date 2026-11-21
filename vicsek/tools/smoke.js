// Vicsek model without a browser: the numbers quoted on the page. Usage: node tools/smoke.js (~30 s)
const { makeRng } = require('../js/rng.js');
const { Vicsek, measurePhi } = require('../js/model.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const base = { count: 1000, density: 2, aspect: 16 / 9, eta: 1, v0: 0.3 };
const phi = (over, seed = 1, warm = 1500, measure = 1000) => measurePhi({ ...base, ...over }, makeRng(seed), warm, measure).phi;
const f = v => v.toFixed(2);

// Invariants: speed is kept, everyone stays in the box, nothing is NaN.
{
  const v = new Vicsek({ ...base, eta: 3 }, makeRng(1));
  const x0 = Float64Array.from(v.x), y0 = Float64Array.from(v.y);
  v.step();
  let ok = true;
  for (let i = 0; i < v.n; i++) {
    let dx = Math.abs(v.x[i] - x0[i]), dy = Math.abs(v.y[i] - y0[i]);
    dx = Math.min(dx, v.W - dx); dy = Math.min(dy, v.H - dy);
    if (!(Math.abs(Math.hypot(dx, dy) - 0.3) < 1e-9 && v.x[i] >= 0 && v.x[i] < v.W && v.y[i] >= 0 && v.y[i] < v.H)) ok = false;
  }
  check(ok, 'one step: every particle moved exactly v0 and stayed in the box');
}

// Default settings: order appears quickly from a random start.
{
  const v = new Vicsek(base, makeRng(1));
  let k = 0;
  while (v.order().phi < 0.6 && k < 1000) { v.step(); k++; }
  const p = phi({});
  check(k < 200 && p > 0.9, `default (noise 1): φ 0.6 after ${k} steps, settles at ${f(p)}`);
}
// The noise sweep at density 2.
const byEta = [2, 3, 3.5, 5].map(eta => phi({ eta }));
check(byEta[0] > 0.6 && byEta[1] < 0.45 && byEta[2] < 0.15 && byEta[3] < 0.05,
  `noise 2 / 3 / 3.5 / 5: φ ${byEta.map(f).join(' / ')} (the transition is between 2.5 and 3.5)`);
// Density at fixed noise (the locust case).
const byRho = [0.25, 1, 4].map(density => phi({ eta: 2, density }));
check(byRho[0] < 0.12 && byRho[1] > 0.35 && byRho[2] > 0.7, `noise 2, density 0.25 / 1 / 4: φ ${byRho.map(f).join(' / ')}`);
// Moving helps: standing arrows (v0 = 0) vs flying ones.
const byV = [0, 1].map(v0 => phi({ eta: 2.5, v0 }, 1, 4000, 2000));
check(byV[0] < 0.3 && byV[1] > 0.55, `noise 2.5, speed 0 vs 1: φ ${byV.map(f).join(' vs ')}`);
// Full noise: φ is the random-walk level 1/√N.
for (const count of [100, 1600]) {
  const p = phi({ count, eta: 6.28 }, 1, 200, 2000);
  check(Math.abs(p * Math.sqrt(count) - 0.89) < 0.2, `full noise, N ${count}: φ ${p.toFixed(3)} ≈ 0.89/√N = ${(0.89 / Math.sqrt(count)).toFixed(3)}`);
}
// Small swarms blur the transition.
const small = phi({ count: 100, eta: 3.5 }), big = phi({ count: 3200, eta: 3.5 });
check(small > 0.2 && big < 0.1, `noise 3.5: φ ${f(small)} with 100 particles, ${f(big)} with 3200`);
process.exit(failed ? 1 : 0);
