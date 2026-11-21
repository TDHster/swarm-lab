// Shepherding without a browser: the numbers quoted on the page. Usage: node tools/smoke.js (~1 min)
const { makeRng } = require('../js/rng.js');
const { Herd, FIELD_W, FIELD_H } = require('../js/model.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const base = { sheep: 50, dogSpeed: 1.5, fear: 65, cohesion: 1.05, noise: 0.3, neighbours: 0.5 };
const SEEDS = [1, 2, 3, 4];
function run(over, seed, max = 8000) {
  const h = new Herd({ ...base, ...over }, makeRng(seed));
  let inField = true;
  while (h.doneAt < 0 && h.t < max) {
    h.step();
    for (let i = 0; i < h.n; i++) if (!(h.x[i] >= 0 && h.x[i] <= FIELD_W && h.y[i] >= 0 && h.y[i] <= FIELD_H)) inField = false;
  }
  return { steps: h.doneAt, penned: h.penned(), inField };
}
const all = over => SEEDS.map(s => run(over, s));
const txt = rs => rs.map(r => (r.steps < 0 ? `— (${r.penned})` : r.steps)).join(' ');

let rs = all({});
check(rs.every(r => r.steps > 200 && r.steps < 800 && r.inField), `default, 50 sheep: penned after ${txt(rs)} steps`);
for (const sheep of [10, 100]) {
  rs = all({ sheep });
  check(rs.every(r => r.steps > 0 && r.steps < 1500), `${sheep} sheep: ${txt(rs)}`);
}
rs = all({ cohesion: 0 });
check(rs.every(r => r.steps < 0 && r.penned === 0), `cohesion 0: never (${txt(rs)})`);
rs = all({ cohesion: 0.5 });
check(rs.every(r => r.steps > 1000 && r.steps < 4000), `cohesion 0.5: ${txt(rs)}`);
rs = all({ neighbours: 0.05 });
check(rs.every(r => r.steps < 0), `neighbours 5% (3 of 50): never (${txt(rs)})`);
rs = all({ sheep: 100, neighbours: 0.25 });
check(rs.every(r => r.steps < 0), `100 sheep, neighbours 25%: never (${txt(rs)})`);
rs = all({ fear: 10 });
check(rs.every(r => r.steps < 0), `fear 10: never (${txt(rs)})`);
rs = all({ fear: 20 });
check(rs.every(r => r.steps > 600 && r.steps < 4500), `fear 20: ${txt(rs)}`);
process.exit(failed ? 1 : 0);
