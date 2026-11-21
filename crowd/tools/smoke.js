// Run the crowd model without a browser: invariants plus the numbers quoted on the page.
// Usage: node tools/smoke.js           - quick checks (~1 min)
//        node tools/smoke.js --table   - full table for the page hints (~15 min)
const { makeRng } = require('../js/rng.js');
const { makeScenario } = require('../js/plan.js');
const { Crowd } = require('../js/model.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const base = { v0: 1.34, herding: 0 };

function evacuate(name, opts, params, seed, tmax = 400) {
  const c = new Crowd(makeScenario(name, { count: 200, door: 1.2, column: false, aware: 1, ...opts }), { ...base, ...params }, makeRng(seed));
  while (c.n > 0 && c.t < tmax) c.step();
  const ts = c.out[0].slice().sort((a, b) => a - b);
  const a = ts[Math.floor(ts.length * 0.2)], b = ts[Math.floor(ts.length * 0.8)];
  return { c, time: c.t, left: c.n, flow: ts.length > 20 ? ts.length * 0.6 / (b - a) : 0 };
}

function flowRun(name, count, seed, params = {}) {
  const c = new Crowd(makeScenario(name, { count }), { ...base, ...params }, makeRng(seed));
  let o = 0, v = 0, k = 0;
  while (c.t < 90) {
    c.step();
    if (c.t > 60 && Math.round(c.t / 0.5) !== Math.round((c.t - 1 / 300) / 0.5)) { o += c.laneOrder(); v += c.meanSpeed(); k++; }
  }
  return { order: o / k, speed: v / k, c };
}

// Quick checks.
const h = evacuate('hall', {}, {}, 1);
check(h.left === 0, `hall: everyone out in ${h.time.toFixed(0)} s`);
check(h.flow / 1.2 > 1.3 && h.flow / 1.2 < 1.9, `door flow ${(h.flow / 1.2).toFixed(2)} people/(m·s) - real data 1.3-1.9`);
// Calm walking: at most a person or two squeezed at the door jamb (seed 1 has 2 of 200).
check(h.c.injuredTotal() <= 2, `calm walking: ${h.c.injuredTotal()} of 200 over 1600 N/m (door jamb)`);
const crowdOk = (() => {
  const c = new Crowd(makeScenario('hall', { count: 200, door: 1.2 }), base, makeRng(2));
  for (let k = 0; k < 3000; k++) c.step();
  for (let i = 0; i < c.n; i++) if (!(c.x[i] > 2.5 && c.x[i] < 18.6 && c.y[i] > 2.4 && c.y[i] < 15.1) || Number.isNaN(c.vx[i])) return false;
  return true;
})();
check(crowdOk, 'nobody leaks through walls in 10 s');
const lanes = flowRun('corridor', 40, 1);
check(lanes.order > 0.8 && lanes.speed > 1.1, `corridor, 40 people: lanes form (order ${lanes.order.toFixed(2)}, speed ${lanes.speed.toFixed(2)} m/s)`);

if (process.argv.includes('--table')) {
  const seeds = [1, 2, 3, 4];
  const avg = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  console.log('\nHall 15×12 m, 200 people, door 1.2 m - "faster is slower" and the column:');
  for (const v0 of [1, 1.34, 2, 3, 4, 5]) {
    for (const column of [false, true]) {
      const rs = seeds.map(s => evacuate('hall', { column }, { v0 }, s));
      console.log(`  v0 ${v0} ${column ? 'column' : '      '}: time ${avg(rs, r => r.time).toFixed(0)} s (${rs.map(r => r.time.toFixed(0)).join('/')}),`
        + ` door flow ${avg(rs, r => r.flow).toFixed(2)}/s, max compression ${avg(rs, r => r.c.maxPress).toFixed(0)} N/m,`
        + ` over 1600: ${avg(rs, r => r.c.injuredTotal()).toFixed(0)}, stuck ${rs.map(r => r.left).join('/')}`);
    }
  }
  console.log('\nTwo exits, 300 people, door 1.2 m:');
  for (const aware of [1, 0.5, 0]) {
    for (const herding of [0, 0.6]) {
      const rs = seeds.slice(0, 3).map(s => evacuate('two', { count: 300, aware }, { herding }, s));
      console.log(`  know the spare exit ${aware * 100}%, herding ${herding}: time ${avg(rs, r => r.time).toFixed(0)} s,`
        + ` main/spare ${rs.map(r => r.c.out[0].length + ':' + r.c.out[1].length).join(' ')}, stuck ${rs.map(r => r.left).join('/')}`);
    }
  }
  console.log('\nCorridor 30×4 m, counterflow (lane order before → after, speed):');
  for (const count of [40, 60, 80, 120]) {
    const rs = [1, 2].map(s => flowRun('corridor', count, s));
    console.log(`  ${count} people (${(count / 120).toFixed(2)}/m²): order ${rs.map(r => r.order.toFixed(2)).join('/')}, speed ${rs.map(r => r.speed.toFixed(2)).join('/')} m/s`);
  }
  console.log('\nCrossing (30×17.5 m, glued edges):');
  for (const count of [150, 300, 450]) {
    const rs = [1, 2].map(s => flowRun('crossing', count, s));
    console.log(`  ${count} people (${(count / 525).toFixed(2)}/m²): speed ${rs.map(r => r.speed.toFixed(2)).join('/')} m/s`);
  }
}
process.exit(failed ? 1 : 0);
