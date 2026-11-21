// Plan evolution: where to cut doors in a hall so that people get out fast, if every door costs something.
// The same simple algorithm as in the "genetic" projects: three random plans, the worst dies, a child of
// the two others (crossover + one mutation) takes its place. Evaluations run in parallel Web Workers.

const POP = 16;
const SLOTS = 3;                        // up to three doors
const TRAIN_SEEDS = [1, 2, 3];          // evolution sees only these crowds...
const FRESH_SEEDS = [101, 102, 103, 104, 105, 106];   // ...and is checked on these, which it never sees
const PENALTY_CRUSH = 0.2;              // s per person compressed over 1600 N/m
const PENALTY_STUCK = 5;                // s per person still inside at 200 s

const $ = id => document.getElementById(id);
const rng = makeRng(Date.now() % 100000);
const settings = { v0: 1.5, cost: 10, width: 1.2, layout: 'groups' };

// ---- workers -------------------------------------------------------------------------------
const nWorkers = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
const workers = [];
const pending = new Map();
let nextId = 0, rr = 0;
function evaluate(genome, seeds) {
  return new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    workers[rr++ % workers.length].postMessage({ id, genome, seeds, v0: settings.v0, opts: { width: settings.width, layout: settings.layout } });
  });
}
function startWorkers() {
  try {
    for (let k = 0; k < nWorkers; k++) {
      const w = new Worker('js/worker.js');
      w.onmessage = ({ data }) => { pending.get(data.id)(data); pending.delete(data.id); };
      workers.push(w);
    }
  } catch (e) {
    $('status').textContent = 'Web Workers недоступны (страница открыта с диска?). Открой через сервер или на сайте.';
    return false;
  }
  return true;
}

// ---- genome ----------------------------------------------------------------------------------
const doors = g => g.filter(d => d.on).length;
const fitness = r => r.time + PENALTY_CRUSH * r.inj + PENALTY_STUCK * r.stuck + settings.cost * r.doors;
const randDoor = () => ({ side: Math.floor(rng() * 4), pos: rng(), on: rng() < 0.6 });
function randGenome() {
  const g = Array.from({ length: SLOTS }, randDoor);
  if (!doors(g)) g[0].on = true;
  return g;
}
// One blind mutation: open/close a door, slide it along its wall, or move it to a random place.
function mutate(g) {
  g = g.map(d => ({ ...d }));
  const d = g[Math.floor(rng() * g.length)], k = rng();
  if (k < 0.25) d.on = !d.on;
  else if (k < 0.7) d.pos = Math.min(1, Math.max(0, d.pos + (rng() - 0.5) * 0.3));
  else Object.assign(d, randDoor(), { on: true });
  if (!doors(g)) d.on = true;
  return g;
}
const crossover = (a, b) => a.map((d, i) => ({ ...(rng() < 0.5 ? d : b[i]) }));
const SIDE_RU = ['сверху', 'снизу', 'слева', 'справа'];
const describe = g => g.filter(d => d.on).map(d => `${SIDE_RU[d.side]} ${(d.pos * 100).toFixed(0)}%`).join(', ');

async function scored(g, seeds) {
  const r = await evaluate(g, seeds);
  return { g, r: { ...r, doors: doors(g) } };
}

// ---- evolution loop ------------------------------------------------------------------------
let pop = [], running = false, evals = 0, history = [], bestKey = '', tournaments = 0;
// Every start or reset gets a new token; a loop that wakes up with an old token quietly stops
// (otherwise a batch still in flight would write into a fresh population, or two loops would run).
let runToken = 0;
const baselines = [
  { name: 'одна дверь посередине правой стены', g: [{ side: 3, pos: 0.5, on: true }] },
  { name: 'по двери на каждой длинной стене', g: [{ side: 0, pos: 0.5, on: true }, { side: 1, pos: 0.5, on: true }] },
];

async function evaluateBaselines() {
  $('baselines').innerHTML = '<tr><td colspan="4" class="muted">считаю…</td></tr>';
  const rows = await Promise.all(baselines.map(b => scored(b.g, FRESH_SEEDS)));
  $('baselines').innerHTML = rows.map((s, k) => `<tr><td>${baselines[k].name}</td><td>${s.r.time.toFixed(1)} с</td>`
    + `<td>${s.r.doors}</td><td><b>${fitness(s.r).toFixed(1)}</b></td></tr>`).join('');
}

async function run() {
  const token = ++runToken;
  if (!pop.length) {
    $('status').textContent = `Первые ${POP} случайных планов…`;
    const first = await Promise.all(Array.from({ length: POP }, () => scored(randGenome(), TRAIN_SEEDS)));
    if (token !== runToken) return;
    pop = first;
    evals += POP;
    await onNewBest();
  }
  while (running && token === runToken) {
    // A batch: one tournament per worker, all children evaluated at once.
    const plans = [];
    const used = new Set();
    for (let k = 0; k < workers.length; k++) {
      const idx = [0, 1, 2].map(() => Math.floor(rng() * pop.length)).sort((a, b) => fitness(pop[a].r) - fitness(pop[b].r));
      if (used.has(idx[2])) continue;   // two tournaments must not kill the same plan
      used.add(idx[2]);
      plans.push({ worst: idx[2], g: mutate(crossover(pop[idx[0]].g, pop[idx[1]].g)) });
    }
    const kids = await Promise.all(plans.map(p => scored(p.g, TRAIN_SEEDS)));
    if (token !== runToken) return;
    plans.forEach((p, k) => { pop[p.worst] = kids[k]; });
    evals += kids.length;
    tournaments += kids.length;
    await onNewBest();
  }
}

function best() {
  return pop.reduce((a, b) => (fitness(b.r) < fitness(a.r) ? b : a));
}

// When the best plan changes: check it on fresh crowds, record both numbers, restart the preview.
async function onNewBest() {
  const b = best(), key = JSON.stringify(b.g);
  $('status').textContent = `оценено планов: ${evals} · турниров: ${tournaments}`;
  if (key === bestKey) { history.push({ evals, train: fitness(b.r), fresh: history.length ? history[history.length - 1].fresh : null }); drawHistory(); return; }
  bestKey = key;
  const fresh = await scored(b.g, FRESH_SEEDS);
  history.push({ evals, train: fitness(b.r), fresh: fitness(fresh.r) });
  $('best-info').innerHTML = `<b>${describe(b.g)}</b><br>на обучающих толпах: ${b.r.time.toFixed(1)} с, оценка ${fitness(b.r).toFixed(1)}`
    + `<br>на свежих толпах: ${fresh.r.time.toFixed(1)} с, оценка <b>${fitness(fresh.r).toFixed(1)}</b>`
    + (fresh.r.inj > 0.5 ? `<br>сжатых сильнее 1600 Н/м: ${fresh.r.inj.toFixed(1)}` : '');
  drawHistory();
  preview(b.g);
}

// ---- preview: the best plan's evacuation, played back -------------------------------------------
const field = $('field'), fctx = field.getContext('2d'), chart = $('chart'), cctx = chart.getContext('2d');
let shown = null;
function preview(g) {
  shown = new Crowd(makeDoorRoom(g, { width: settings.width, layout: settings.layout }), { v0: settings.v0, herding: 0 }, makeRng(FRESH_SEEDS[0]));
}
function resize() {
  const dpr = window.devicePixelRatio || 1;
  field.width = Math.round(field.clientWidth * dpr);
  field.height = Math.round(field.clientHeight * dpr);
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
}
new ResizeObserver(resize).observe(field);

function drawHistory() {
  if (!history.length) return;
  const vals = history.flatMap(h => (h.fresh === null ? [h.train] : [h.train, h.fresh]));
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.1);
  const maxE = Math.max(10, evals);
  drawLines(cctx, [
    { values: history.map(h => [h.evals, h.train]), color: '#f5d76e' },
    { values: history.filter(h => h.fresh !== null).map(h => [h.evals, h.fresh]), color: '#3ee6b0' },
  ], maxE, hi + pad, `оценка лучшего плана, с (меньше — лучше); сверху ${(hi + pad).toFixed(0)}`, Math.max(0, lo - pad), ' планов');
}

function frame() {
  if (shown) {
    for (let k = 0; k < 10 && shown.n > 0; k++) shown.step();   // 2× real time
    if (shown.n === 0 && shown.t > 0) shown.reset(makeRng(FRESH_SEEDS[0]));
    drawCrowd(fctx, shown, { colorMode: 'press', heat: null });
  }
  requestAnimationFrame(frame);
}

// ---- controls ------------------------------------------------------------------------------
function bindSlider(id, key, fmtFn) {
  const input = $(id), out = $(id + '-out');
  const sync = () => { settings[key] = +input.value; out.textContent = fmtFn(+input.value); };
  input.addEventListener('input', sync);
  input.addEventListener('change', reset);
  sync();
}
function reset() {
  running = false;
  runToken++;
  $('btn-run').textContent = '▶ Эволюция';
  pop = []; evals = 0; history = []; bestKey = ''; tournaments = 0;
  $('best-info').textContent = '';
  cctx.clearRect(0, 0, chart.width, chart.height);
  shown = null;
  evaluateBaselines();
  $('status').textContent = 'Настройки изменены — запусти эволюцию заново.';
}
bindSlider('v0', 'v0', v => v.toFixed(1) + ' м/с');
bindSlider('cost', 'cost', v => v + ' с');
bindSlider('width', 'width', v => v.toFixed(1) + ' м');
$('layout').onchange = e => { settings.layout = e.target.value; reset(); };
$('btn-run').onclick = () => {
  running = !running;
  $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Эволюция';
  if (running) run(); else runToken++;   // pause: the loop in flight finishes its batch's await and stops
};
$('btn-reset').onclick = reset;

resize();
if (startWorkers()) {
  $('workers').textContent = workers.length;
  evaluateBaselines();
  preview(baselines[0].g);
}
requestAnimationFrame(frame);
