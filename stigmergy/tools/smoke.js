// Stigmergy models without a browser: the numbers quoted on the pages.
// Usage: node tools/smoke.js   (~1 min)
const { makeRng } = require('../js/rng.js');
const { Park } = require('../js/trails.js');
const { Chips, Builders } = require('../js/termites.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

// Trails: more attraction -> longer walks (people follow trails), and nobody gets trapped.
const detour = lam => {
  const p = new Park({ trample: 0.08, durability: 4000, attraction: lam, visibility: 6, spawnEvery: 2, noise: 0.15 }, makeRng(1));
  p.loadPreset('four');
  for (let s = 0; s < 40000; s++) p.step();
  return { d: p.meanDetour(), n: p.n };
};
const t0 = detour(0), t8 = detour(8), t20 = detour(20);
check(t0.d < 1.03 && t8.d > 1.1 && t20.d > t8.d, `trails: detour ${t0.d.toFixed(2)} / ${t8.d.toFixed(2)} / ${t20.d.toFixed(2)} at λ 0 / 8 / 20`);
check(t20.n < 200, `trails: walkers do not get trapped (${t20.n} on the way at λ 20)`);

// Chips: conserved, piles merge.
const c = new Chips({ count: 300, density: 0.15 }, makeRng(1));
const p0 = c.piles();
for (let s = 0; s < 20000; s++) c.step();
const p1 = c.piles();
check(p1.chips === p0.chips, `chips conserved: ${p0.chips} -> ${p1.chips}`);
check(p1.piles < p0.piles / 5 && p1.biggest > 10 * p0.biggest, `piles merge: ${p0.piles} -> ${p1.piles}, biggest ${p0.biggest} -> ${p1.biggest}`);

// Builders: pillars appear; spacing follows evaporation and diffusion; no pillars without following the smell.
const base = { count: 300, sensitivity: 3, evaporation: 0.02, diffusion: 0.3, follow: 0.5, queen: false, chamber: 18 };
const build = (over, steps = 6000) => { const b = new Builders({ ...base, ...over }, makeRng(1)); const line = []; while (b.steps < steps) { b.step(); if (b.steps % 1000 === 0) line.push(b.pillars().pillars); } return { b, r: b.pillars(), line }; };
const B = build({}), E = build({ evaporation: 0.05 }), D = build({ diffusion: 0.6 }), F = build({ follow: 0 }), Q = build({ queen: true });
console.log(`      pillars every 1000 steps: ${B.line.join(' ')}`);
check(B.r.pillars > 15, `builders: ${B.r.pillars} pillars, spacing ${B.r.spacing.toFixed(1)}`);
check(E.r.spacing < B.r.spacing && D.r.spacing > B.r.spacing, `spacing: evaporation 5% ${E.r.spacing.toFixed(1)} < base ${B.r.spacing.toFixed(1)} < diffusion 0.6 ${D.r.spacing.toFixed(1)}`);
check(F.r.pillars === 0, `no following the smell -> no pillars (${F.b.placed} pellets placed)`);
check(Q.b.ringShare() > 0.8, `queen: ${(Q.b.ringShare() * 100).toFixed(0)}% of material on the chamber ring, ${Q.r.pillars} peaks`);
process.exit(failed ? 1 : 0);
