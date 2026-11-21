// Ring road without a browser: the numbers quoted on the page. Usage: node tools/smoke.js (~15 s)
const { makeRng } = require('../js/rng.js');
const { Ring } = require('../js/model.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const base = { cars: 22, length: 230, v0: 15, T: 0.6, a: 1, b: 1.5, noise: 0.2, auto: 0 };
const DT = 0.1;
// Average speed (km/h) and stopped cars over the next `sec` seconds.
function avg(r, sec) {
  let m = 0, st = 0, k = 0, minGap = Infinity;
  for (let i = 0; i < sec / DT; i++) { r.step(DT); const s = r.stats(); m += s.mean; st += s.stopped; k++; minGap = Math.min(minGap, s.minGap); }
  return { kmh: m / k * 3.6, stopped: st / k, minGap };
}
const f1 = v => v.toFixed(1);

for (const seed of [1, 2, 3]) {
  const r = new Ring({ ...base }, makeRng(seed));
  let t = 0;
  while (r.stats().stopped === 0 || t < 20) { r.step(DT); t += DT; if (t > 600) break; }
  const jam = avg(r, 600);
  r.setAuto(1);
  let calm = 0, t2 = 0;
  while (t2 < 600 && calm < 30) { r.step(DT); t2 += DT; calm = r.stats().stopped ? 0 : calm + DT; }
  const after = avg(r, 300);
  check(t > 40 && t < 180 && jam.kmh < 13 && jam.stopped > 8 && t2 - 30 < 120 && after.kmh > 20 && after.stopped === 0 && jam.minGap > 0,
    `seed ${seed}: first stop at ${t.toFixed(0)} s; jam ${f1(jam.kmh)} km/h, ${f1(jam.stopped)} stopped; `
    + `one autopilot: calm after ${(t2 - 30).toFixed(0)} s, then ${f1(after.kmh)} km/h`);
}
const settle = (over, brake, seed = 1) => {
  const r = new Ring({ ...base, ...over }, makeRng(seed));
  avg(r, 200);
  if (brake) r.brake(0, 2);
  avg(r, 300);
  return avg(r, 300);
};
let s = settle({ noise: 0 });
check(Math.abs(s.kmh - 23.1) < 0.3 && s.stopped === 0, `perfect drivers: ${f1(s.kmh)} km/h, nobody stops`);
s = settle({ noise: 0 }, true);
check(s.kmh < 13 && s.stopped > 8, `perfect drivers + one 2 s brake: jam stays, ${f1(s.kmh)} km/h`);
s = settle({ cars: 18 });
check(s.kmh > 32 && s.stopped === 0, `18 cars: smooth, ${f1(s.kmh)} km/h`);
s = settle({ cars: 18 }, true);
check(s.stopped > 2, `18 cars + one brake: jam, ${f1(s.kmh)} km/h, ${f1(s.stopped)} stopped`);
s = settle({ cars: 20 });
check(s.stopped > 2, `20 cars: jam by itself, ${f1(s.stopped)} stopped`);
s = settle({ cars: 16 }, true);
check(s.stopped === 0, `16 cars + one brake: smooth again, ${f1(s.kmh)} km/h`);
s = settle({ a: 2 });
check(s.stopped === 0 && s.kmh > 22, `brisk drivers (a = 2): no jam, ${f1(s.kmh)} km/h`);
process.exit(failed ? 1 : 0);
