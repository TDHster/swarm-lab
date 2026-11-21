// Run the ant colony without a browser: invariants, and the double bridge - does the colony pick the short route?
// Usage: node tools/smoke.js
const { makeRng } = require('../js/rng.js');
const { Colony } = require('../js/model.js');

const base = { count: 500, evaporation: 5, diffusion: 0.1, sensorAngle: 35, sensorDist: 7, turn: 20,
  randomness: 0.25, speed: 1, memory: 300 };
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

function sumRect(f, c, x0, y0, x1, y1) {
  let s = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += f[y * c.w + x];
  return s / ((x1 - x0) * (y1 - y0));
}

function bridge(seed, steps, over = {}) {
  const c = new Colony({ ...base, ...over }, makeRng(seed));
  c.loadPreset('bridge');
  c.reset(makeRng(seed));
  const marks = [];
  const t = performance.now();
  for (let s = 1; s <= steps; s++) {
    c.step();
    if (s % 3600 === 0) marks.push(c.delivered);
  }
  c.ms = (performance.now() - t) / steps;
  // Mean "to food" pheromone per cell in the middle of each tunnel.
  c.short = sumRect(c.food, c, 125, 50, 185, 66);
  c.long = sumRect(c.food, c, 125, 150, 185, 166);
  c.marks = marks;
  return c;
}

const args = process.argv.slice(2);
const steps = +(args[0] || 21600);   // 6 minutes at 60 steps/s
let shortWins = 0;
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const c = bridge(seed, steps);
  let bad = '';
  for (let i = 0; i < c.n; i++) {
    if (Number.isNaN(c.x[i]) || c.blocked(c.x[i], c.y[i])) { bad = 'ant ' + i + ' in a wall or NaN'; break; }
  }
  check(!bad, `seed ${seed}: ants stay out of walls ${bad}`);
  const perMin = c.marks.map((v, k) => v - (c.marks[k - 1] || 0));
  console.log(`      delivered per minute: ${perMin.join(' ')}; to-food pheromone short ${c.short.toFixed(3)} / long ${c.long.toFixed(3)}; ${c.ms.toFixed(2)} ms/step`);
  if (c.short > 0.5 && c.short > 2 * c.long && perMin[perMin.length - 1] > 1000) shortWins++;
}
// Real colonies also sometimes lock onto the long branch; most should pick the short one.
check(shortWins >= 5, `short route wins in ${shortWins}/8 seeds`);

// Control: without pheromone memory the fork is a coin toss, so the win above is not geometry.
const ctrl = bridge(1, 10800, { evaporation: 99 });
check(ctrl.delivered < 4000, `no memory (99%/s evaporation): only ${ctrl.delivered} delivered in 3 min`);
process.exit(failed ? 1 : 0);
