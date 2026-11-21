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
process.exit(failed ? 1 : 0);
