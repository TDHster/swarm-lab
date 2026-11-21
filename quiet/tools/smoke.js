// "Silence by swarm" pages without a browser: the numbers quoted on the pages. Usage: node tools/smoke.js
const { makeRng } = require('../js/rng.js');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const SEEDS = [1, 2, 3];

// ---- the resonator wall (one step = half a second) ----
{
  const { Wall, SOURCES, depthFor } = require('../js/wall.js');
  const P = { rule: 'local', rate: 0.05, Q: 6, noise: 0.1 };
  const settle = w => { const lv = []; for (let t = 0; t < 400; t++) { w.step(); lv.push(w.levelDb()); } return lv; };
  // Within 0.2 dB of the final level, for good.
  const settledAt = lv => { const end = lv[lv.length - 1]; let k = lv.length - 1; while (k > 0 && Math.abs(lv[k - 1] - end) < 0.2) k--; return k; };
  const d = [80, 310].map(depthFor);
  check(Math.abs(d[0] - 31) < 1 && Math.abs(d[1] - 2.1) < 0.2, `box depth: 80 Hz ${d[0].toFixed(1)} cm, 310 Hz ${d[1].toFixed(1)} cm`);
  for (const seed of SEEDS) {
    const w = new Wall({ ...P, on: [1, 1, 1] }, makeRng(seed));
    const start = w.levelDb(), lv = settle(w), t1 = settledAt(lv), c = w.counts();
    w.p.on = [1, 0, 1]; w.update();
    const lv2 = settle(w), t2 = settledAt(lv2);
    const room = new Wall({ ...P, rule: 'room', on: [1, 1, 1] }, makeRng(seed));
    const rl = settle(room).slice(-100), rm = rl.reduce((a, b) => a + b) / rl.length;
    check(start > -4.5 && start < -2.5 && lv[399] < -6.8 && t1 < 120 && Math.abs(c[0] - 28) <= 2 && Math.abs(c[1] - 26) <= 2 && Math.abs(c[2] - 17) <= 2
      && lv2[399] < -9.3 && t2 < 60 && rm > -4.5 && room.switches > 10000,
      `wall seed ${seed}: untuned ${start.toFixed(1)} dB → ${lv[399].toFixed(2)} dB after ${t1 / 2} s, cells ${c.join('/')}; `
      + `compressor off → ${lv2[399].toFixed(2)} dB in ${t2 / 2} s; shared room mic ${rm.toFixed(1)} dB (${room.switches} switches)`);
  }
}

// ---- the quiet zone ----
{
  const { Zone } = require('../js/zone.js');
  const base = { f: 100, speakers: 6, listen: 'own', mu: 0.3, reflect: 0.5, src: { x: 4.3, y: 3.5 } };
  const run = (over, steps = 600) => {
    const z = new Zone({ ...base, ...over });
    for (let t = 0; t < steps; t++) z.step();
    let a10 = 0;
    for (let c = 0; c < z.nx * z.ny; c++) {
      const [re, im] = z.at(c), p0 = z.maps[0][2 * c] ** 2 + z.maps[0][2 * c + 1] ** 2;
      if (10 * Math.log10((re * re + im * im) / p0) < -10) a10++;
    }
    return { ...z.report(), spot: a10 * 0.05 * 0.05 };
  };
  const f1 = v => v.toFixed(1);
  let r = run({}), quick = run({}, 60);
  check(r.zone < -15 && r.spot > 1.2 && Math.abs(r.room) < 0.2 && quick.zone < -14, `zone 100 Hz: pillow ${f1(r.zone)} dB (${f1(quick.zone)} after 60 steps), quiet spot ${r.spot.toFixed(2)} m², room ${r.room.toFixed(2)} dB`);
  r = run({ f: 50 });
  check(r.zone < -18 && r.spot > 1.5, `50 Hz: ${f1(r.zone)} dB, spot ${r.spot.toFixed(2)} m²`);
  r = run({ f: 200 });
  check(r.zone > -6 && r.spot < 0.6, `200 Hz: only ${f1(r.zone)} dB, spot ${r.spot.toFixed(2)} m²`);
  r = run({ f: 400 });
  check(r.zone > 0 && r.room > 2, `400 Hz: pillow ${f1(r.zone)} dB, room ${f1(r.room)} dB`);
  const k2 = run({ speakers: 2 }), k4 = run({ speakers: 4 }), k10 = run({ speakers: 10 });
  check(k2.zone > -11 && k2.zone < -9 && k4.zone < -15.5 && Math.abs(k10.zone - k4.zone) < 1, `speakers 2 / 4 / 10: ${[k2, k4, k10].map(x => f1(x.zone)).join(' / ')} dB`);
  const bad = run({ speakers: 10, listen: 'all' }), ok = run({ speakers: 10, listen: 'own' });
  check(!(bad.zone < 0) && ok.zone < -15, `10 speakers, step 0.3: all mics → ${f1(bad.zone)}, own mic → ${f1(ok.zone)} dB`);
  const moved = new Zone({ ...base });
  for (let t = 0; t < 600; t++) moved.step();
  moved.p.src = { x: 0.6, y: 3.5 }; moved.rebuild();
  for (let t = 0; t < 120; t++) moved.step();
  check(moved.report().zone < -15, `hum moved: back to ${f1(moved.report().zone)} dB after 120 steps`);
}
process.exit(failed ? 1 : 0);
