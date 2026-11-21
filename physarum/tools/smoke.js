// Run the Physarum model without a browser: invariants, speed, and that a network (high contrast) forms.
// Usage: node tools/smoke.js
const { makeRng } = require('../js/rng.js');
const { Mold } = require('../js/model.js');

const base = { count: 100000, sensorAngle: 22.5, sensorDist: 9, turnAngle: 45, stepSize: 1, deposit: 5,
  decay: 10, diffusion: 1, foodStrength: 3, start: 'disk' };
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

// Contrast = std / mean of the trail map: ~0 for an even fog, large when trail sits on thin lines.
function contrast(m) {
  let s = 0, s2 = 0;
  for (const v of m.trail) { s += v; s2 += v * v; }
  const mean = s / m.trail.length;
  return Math.sqrt(s2 / m.trail.length - mean * mean) / mean;
}

for (const count of [50000, 100000, 200000]) {
  const m = new Mold({ ...base, count }, makeRng(1));
  const t = performance.now();
  for (let s = 0; s < 300; s++) m.step();
  const ms = (performance.now() - t) / 300;
  let bad = 0;
  for (let i = 0; i < m.n; i++) if (!(m.x[i] >= 0 && m.x[i] < m.w && m.y[i] >= 0 && m.y[i] < m.h)) bad++;
  check(bad === 0, `${count} agents: all inside the map, ${ms.toFixed(1)} ms/step, contrast ${contrast(m).toFixed(2)}`);
}
const fog = new Mold({ ...base, start: 'random', sensorDist: 0.1 }, makeRng(1));
const net = new Mold({ ...base, start: 'random' }, makeRng(1));
for (let s = 0; s < 600; s++) { fog.step(); net.step(); }
check(contrast(net) > 2 * contrast(fog),
  `sensors make a network: contrast ${contrast(fog).toFixed(2)} (blind) -> ${contrast(net).toFixed(2)}`);
process.exit(failed ? 1 : 0);
