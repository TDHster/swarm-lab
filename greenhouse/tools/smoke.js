// Greenhouse without a browser: the numbers quoted on the page (sun 0.8, thresholds ±2 °C). Usage: node tools/smoke.js (~1 min)
const { makeRng } = require('../js/rng.js');
const { Greenhouse } = require('../js/greenhouse.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const SEEDS = [1, 2, 3];
const base = { sun: 0.8, thresholds: 'diverse', spread: 2, aim: 'bees', align: 1, heat: 0.3 };
const avg = (g, n) => { let m = 0, on = 0; for (let i = 0; i < n; i++) { g.step(); const s = g.stats(); m += s.mean; on += s.on; } return { mean: m / n, on: on / n }; };
const f1 = v => v.toFixed(1);

const res = {};
for (const aim of ['fixed', 'tunnel', 'bees']) {
  res[aim] = SEEDS.map(seed => {
    const g = new Greenhouse({ ...base, aim }, makeRng(seed));
    let tCool = Infinity;
    for (let i = 0; i < 5000; i++) { g.step(); if (tCool === Infinity && i % 10 === 0 && g.stats().mean < 33) tCool = g.t; }
    const end = avg(g, 2000), dir = g.fans.reduce((a, f) => a + Math.cos(f.a), 0) / g.fans.length;
    g.fans.forEach((f, i) => { if (i % 6 === 2 || i % 6 === 3) f.broken = true; });
    avg(g, 4000);
    return { tCool, end, dir, broken: avg(g, 2000).mean };
  });
}
const txt = a => res[a].map(r => f1(r.end.mean)).join(' / ');
check(res.fixed.every(r => r.end.mean > 37.5 && r.end.on > 23.5), `as installed: all fans on, ${txt('fixed')} °C`);
check(res.tunnel.every(r => r.end.mean < 32.6), `engineer's tunnel: ${txt('tunnel')} °C`);
check(res.bees.every(r => r.end.mean < 32.8 && r.tCool > 200 && r.tCool < 600 && Math.abs(r.dir) > 0.7),
  `bees: ${txt('bees')} °C, below 33 °C after ${res.bees.map(r => Math.round(r.tCool / 60) + ' min').join(', ')}; stream direction cos ${res.bees.map(r => r.dir.toFixed(2)).join(', ')}`);
const diff = SEEDS.map((_, k) => res.bees[k].broken - res.tunnel[k].broken);
check(diff.every(d => d > 0.1 && d < 1), `two middle columns broken: tunnel ${res.tunnel.map(r => f1(r.broken)).join('/')}, bees ${res.bees.map(r => f1(r.broken)).join('/')} °C (bees worse by ${diff.map(f1).join(', ')})`);
// Sun 0.5: equal vs spread thresholds.
const sun5 = SEEDS.map(seed => ['same', 'diverse'].map(th => { const g = new Greenhouse({ ...base, sun: 0.5, thresholds: th, spread: 3 }, makeRng(seed)); avg(g, 6000); return avg(g, 2000); }));
check(sun5.every(([s, d]) => s.on - d.on > 4 && d.mean - s.mean < 0.4),
  `sun 0.5: same thresholds ${sun5.map(([s]) => f1(s.on)).join('/')} fans at ${sun5.map(([s]) => f1(s.mean)).join('/')} °C, ±3 °C ${sun5.map(([, d]) => f1(d.on)).join('/')} fans at ${sun5.map(([, d]) => f1(d.mean)).join('/')} °C`);
// The stream direction is chosen by the fans themselves: over 8 seeds both ways occur.
const dirs = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => { const g = new Greenhouse({ ...base }, makeRng(seed)); for (let i = 0; i < 5000; i++) g.step(); return g.fans.reduce((a, f) => a + Math.cos(f.a), 0) / g.fans.length; });
check(dirs.filter(d => d < -0.7).length >= 1 && dirs.filter(d => d > 0.7).length >= 1, `stream direction over 8 seeds: ${dirs.filter(d => d < 0).length} left, ${dirs.filter(d => d > 0).length} right`);
process.exit(failed ? 1 : 0);
