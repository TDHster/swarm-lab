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
const h1 = run('house', 0.01), k1 = run('letter', 0.01), h2 = run('house', 0.02);
check(h1.fill > 0.85, `house, noise 1%: fill ${(h1.fill * 100).toFixed(0)}%`);
check(k1.fill < 0.75, `letter, noise 1%: thin legs suffer, fill ${(k1.fill * 100).toFixed(0)}%`);
check(h2.fill < 0.6, `house, noise 2%: falls apart, fill ${(h2.fill * 100).toFixed(0)}%`);
process.exit(failed ? 1 : 0);
