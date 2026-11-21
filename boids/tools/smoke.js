// Run the boids model without a browser: checks invariants and that the rules do what they claim.
// Usage: node tools/smoke.js
const { makeRng } = require('../js/rng.js');
const { Flock } = require('../js/model.js');

const base = { count: 600, separation: 1.5, alignment: 1, cohesion: 1, vision: 50, personal: 20,
  fov: 270, maxSpeed: 3.5, maxForce: 0.1, fear: 1, edges: 'wrap' };
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

function run(params, steps, setup) {
  const f = new Flock({ ...base, ...params }, makeRng(1));
  if (setup) setup(f);
  const t = performance.now();
  for (let s = 0; s < steps; s++) f.step();
  f.ms = (performance.now() - t) / steps;
  return f;
}

function sane(f) {
  for (let i = 0; i < f.n; i++) {
    const v = [f.x[i], f.y[i], f.vx[i], f.vy[i]];
    if (v.some(Number.isNaN)) return 'NaN at boid ' + i;
    if (f.x[i] < 0 || f.x[i] > f.w || f.y[i] < 0 || f.y[i] > f.h) return 'out of world: boid ' + i;
    if (Math.hypot(f.vx[i], f.vy[i]) > f.p.maxSpeed + 1e-3) return 'too fast: boid ' + i;
  }
  return '';
}

const flock = run({}, 600);
check(!sane(flock), 'default flock stays sane ' + sane(flock));
check(flock.stats.order > 0.5, `default flock gets ordered: order=${flock.stats.order.toFixed(2)}`);
const chaos = run({ separation: 0, alignment: 0, cohesion: 0 }, 600);
check(chaos.stats.order < 0.2, `no rules -> no order: order=${chaos.stats.order.toFixed(2)}`);
const walls = run({ edges: 'walls' }, 600, f => f.obstacles.push({ x: 600, y: 350, r: 60 }));
check(!sane(walls), 'walls + obstacle stay sane ' + sane(walls));
let inside = 0;
for (let i = 0; i < walls.n; i++) if (Math.hypot(walls.x[i] - 600, walls.y[i] - 350) < 60 - 1e-3) inside++;
check(inside === 0, 'nobody inside the obstacle: ' + inside);
// Mean distance to the nearest neighbor: separation should keep boids apart.
function nearestGap(f) {
  let sum = 0;
  for (let i = 0; i < f.n; i++) {
    let best = Infinity;
    for (let j = 0; j < f.n; j++) if (j !== i) best = Math.min(best, Math.hypot(f.x[j] - f.x[i], f.y[j] - f.y[i]));
    sum += best;
  }
  return sum / f.n;
}
const crowd = nearestGap(run({ cohesion: 3, separation: 0 }, 300));
const spaced = nearestGap(run({ cohesion: 3, separation: 3 }, 300));
check(spaced > crowd * 2, `separation spreads boids: nearest neighbor ${crowd.toFixed(1)} -> ${spaced.toFixed(1)} px`);
const big = run({ count: 3000 }, 120);
check(!sane(big), `3000 boids sane, ${big.ms.toFixed(2)} ms/step`);
const counted = run({}, 10, f => { f.setCount(100); });
check(counted.n === 100, 'setCount shrinks the flock');
process.exit(failed ? 1 : 0);
