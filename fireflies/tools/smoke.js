// Fireflies and the Millennium Bridge without a browser: the numbers quoted on the pages.
// Usage: node tools/smoke.js (~1 min)
const { makeRng } = require('../js/rng.js');
const { Fireflies } = require('../js/fireflies.js');
const { Bridge, criticalCrowd } = require('../js/bridge.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const SEEDS = [1, 2, 3, 4];

// ---- fireflies: time until r > 0.9, and r over the last 20 s of 180 s ----
const DT = 0.01;
function fly(over, seed) {
  const f = new Fireflies({ count: 300, radius: 1.5, eps: 0.03, spread: 0.03, ...over }, makeRng(seed));
  let tSync = Infinity, rs = 0, k = 0;
  for (let s = 0; s < 18000; s++) {
    f.step(DT);
    const r = f.order();
    if (tSync === Infinity && r > 0.9) tSync = f.t;
    if (s >= 16000) { rs += r; k++; }
  }
  return { tSync, r: rs / k, f };
}
const runs = (over) => SEEDS.map(s => fly(over, s));
const fmtT = rs => rs.map(x => (x.tSync === Infinity ? '—' : x.tSync.toFixed(0) + 's')).join(' ');
const fmtR = rs => rs.map(x => x.r.toFixed(2)).join(' ');

// The default is what visitors see first, so it gets more seeds: the sync time varies a lot.
let rs = [1, 2, 3, 4, 5, 6, 7, 8].map(s => fly({}, s));
check(rs.every(x => x.tSync > 15 && x.tSync < 60 && x.r > 0.95), `fireflies default: sync after ${fmtT(rs)}, r ${fmtR(rs)}`);
rs = runs({ eps: 0 });
check(rs.every(x => x.r < 0.1), `eps 0: never (r ${fmtR(rs)})`);
rs = runs({ count: 150 });
check(rs.every(x => x.r > 0.3 && x.r < 0.7), `150 fireflies: groups only, r ${fmtR(rs)}`);
rs = runs({ count: 600 });
check(rs.every(x => x.tSync < 10), `600 fireflies: sync after ${fmtT(rs)}`);
rs = runs({ spread: 0.1 });
check(rs.every(x => x.r > 0.35 && x.r < 0.95), `spread ±10%: on the edge, r ${fmtR(rs)}`);
rs = runs({ spread: 0.2 });
check(rs.every(x => x.r < 0.35), `spread ±20%: no sync, r ${fmtR(rs)}`);
rs = runs({ radius: 3 });
check(rs.every(x => x.tSync < 3), `radius 3: sync after ${fmtT(rs)}`);
// A shaken patch heals.
const heal = SEEDS.map(seed => {
  const f = fly({}, seed).f;
  f.scramble(8, 4.5, 2);
  let t = 0;
  while (f.order() < 0.95 && t < 60) { f.step(DT); t += DT; }
  return t;
});
check(heal.every(t => t < 30), `shaken patch back in rhythm after ${heal.map(t => t.toFixed(1) + 's').join(' ')}`);

// ---- the bridge ----
const BDT = 0.005;
const base = { zeta: 0.04, C: 80, sigma: 0.1 };
function walk(over, seconds, seed = 1) {
  const b = new Bridge({ ...base, count: 100, ...over }, makeRng(seed));
  let amax = 0, t1cm = Infinity;
  for (let k = 0; k < seconds / BDT; k++) {
    b.step(BDT);
    if (b.t > seconds - 60) amax = Math.max(amax, b.A);
    if (t1cm === Infinity && b.A > 0.01) t1cm = b.t;
  }
  let inStep = 0;
  for (const th of b.theta) { const d = th - b.psi - Math.PI / 2; if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.3) inStep++; }
  return { amax, t1cm, inStep: inStep / b.theta.length };
}
check(Math.abs(criticalCrowd({ ...base }) - 165) < 3, `critical crowd by the formula: ${criticalCrowd({ ...base }).toFixed(0)}`);
let w = walk({}, 300);
check(w.amax < 0.003 && w.inStep < 0.2, `100 walkers: sway ${(w.amax * 1000).toFixed(1)} mm, in step ${(w.inStep * 100).toFixed(0)}% (chance ≈ 10%)`);
w = walk({ count: 300 }, 300);
check(w.amax > 0.015 && w.t1cm < 40 && w.inStep > 0.5, `300 walkers: 1 cm after ${w.t1cm.toFixed(0)} s, sway ${(w.amax * 100).toFixed(1)} cm, in step ${(w.inStep * 100).toFixed(0)}%`);
w = walk({ count: 300, zeta: 0.2 }, 300);
check(w.amax < 0.001 && Math.abs(criticalCrowd({ ...base, zeta: 0.2 }) - 827) < 5, `dampers 20%: 300 walkers sway ${(w.amax * 100).toFixed(2)} cm, Nc ${criticalCrowd({ ...base, zeta: 0.2 }).toFixed(0)}`);
w = walk({ count: 300, sigma: 0.3 }, 300);
check(w.amax < 0.005, `walking spread 0.3 Hz: 300 walkers sway ${(w.amax * 100).toFixed(2)} cm, Nc ${criticalCrowd({ ...base, sigma: 0.3 }).toFixed(0)}`);
// Arup-style ramp: +10 walkers every 20 s; at what crowd does the sway pass 1 cm?
const onset = [1, 2, 3].map(seed => {
  const b = new Bridge({ ...base, count: 0 }, makeRng(seed));
  for (let k = 0; b.t < 1000; k++) {
    if (k % 4000 === 0) b.setCount(b.theta.length + 10);
    b.step(BDT);
    if (b.A > 0.01) return b.theta.length;
  }
  return Infinity;
});
check(onset.every(n => n >= 190 && n <= 230), `Arup ramp: sway passes 1 cm at ${onset.join(' / ')} walkers`);
process.exit(failed ? 1 : 0);
