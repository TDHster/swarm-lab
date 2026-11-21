// Robot swarm without a browser: the numbers quoted on the page. Usage: node tools/smoke.js (~2 min)
const { makeRng } = require('../js/rng.js');
const { Swarm } = require('../js/swarm.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const run = (shape, noise, count = 180, steps = 40000, seed = 1) => {
  const s = new Swarm({ count, shape, noise }, makeRng(seed));
  for (let k = 0; k < steps; k++) s.step();
  return s.stats();
};

for (const shape of ['letter', 'house', 'square', 'arrow']) {
  const st = run(shape, 0);
  check(st.fill > 0.8 && st.trulyInside === 1 && st.error < 0.01,
    `${shape}, no noise: fill ${(st.fill * 100).toFixed(0)}%, everyone really inside, position error ${st.error.toFixed(3)}`);
}
const h2 = run('house', 0.02, 150), k1 = run('letter', 0.01, 150), k2 = run('letter', 0.02, 150);
check(h2.trulyInside > 0.9, `house, noise 2%: ${(h2.trulyInside * 100).toFixed(0)}% of robots inside the shape`);
check(k1.trulyInside < 0.9 && k2.trulyInside < 0.65, `letter K bends with noise: inside ${(k1.trulyInside * 100).toFixed(0)}% at 1%, ${(k2.trulyInside * 100).toFixed(0)}% at 2%`);
for (const count of [90, 110, 130, 150, 180]) {
  const st = run('letter', 0, count);
  check(st.fill > 0.9, `letter K with ${count} robots: fill ${(st.fill * 100).toFixed(0)}% (the old edge-following stalled at 55% with 110)`);
}
process.exit(failed ? 1 : 0);
