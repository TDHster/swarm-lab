// Vicsek page: the field, the φ chart, the phase diagram sweep, sliders and the loop. The model is in model.js.

const SLIDERS = [
  { group: 'swarm', key: 'count', label: 'Частиц', min: 100, max: 4000, step: 100, value: 1000, restart: true },
  { group: 'swarm', key: 'density', label: 'Плотность', min: 0.1, max: 8, step: 0.1, value: 2, restart: true,
    title: 'Частиц на единицу площади. Соседей в радиусе 1 в среднем ≈ 3,14 × плотность' },
  { group: 'noise', key: 'eta', label: 'Шум η', min: 0, max: 6.28, step: 0.05, value: 1,
    fmt: v => `${v.toFixed(1)} ±${Math.round(v / 2 * 180 / Math.PI)}°`,
    title: 'Ошибка курса: случайный угол от −η/2 до +η/2. 6,28 — курс совсем случайный' },
  { group: 'noise', key: 'v0', label: 'Скорость v₀', min: 0, max: 1, step: 0.01, value: 0.3,
    title: 'Сдвиг за шаг (радиус соседства = 1). 0 — частицы стоят и только поворачиваются, как стрелки компаса' },
  { group: 'view', key: 'speed', label: 'Шагов за кадр', min: 1, max: 20, step: 1, value: 2 },
];

const $ = id => document.getElementById(id);
const params = { aspect: 16 / 9 };
for (const s of SLIDERS) params[s.key] = s.value;

let sim, running = true, phiAvg = 0;
const phiHistory = [], HISTORY = 600;

function start(ordered) {
  sim = new Vicsek(params, makeRng(+$('seed').value || 1));
  if (ordered) sim.align();
  phiHistory.length = 0;
  phiAvg = sim.order().phi;
  clearField = true;
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chart = $('chart'), cctx = chart.getContext('2d'), phase = $('phase'), pctx = phase.getContext('2d');
let clearField = true;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chart, phase]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
  clearField = true;
}
new ResizeObserver(resize).observe(field);

const BINS = 24, bins = Array.from({ length: BINS }, () => []);
const binColor = Array.from({ length: BINS }, (_, b) => `hsl(${Math.round(b * 360 / BINS)} 85% 62%)`);

function draw() {
  const s = field.width / sim.W, dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Trails: instead of clearing, darken the previous frame a little.
  ctx.fillStyle = $('trails').checked && !clearField ? 'rgba(4, 10, 8, 0.18)' : '#040a08';
  ctx.fillRect(0, 0, field.width, field.height);
  clearField = false;
  // Each particle is a short stroke along its heading; grouped by colour so each colour is one path.
  const half = Math.max(0.3 * s, 3 * dpr);
  for (const b of bins) b.length = 0;
  const { x, y, th, n } = sim;
  for (let i = 0; i < n; i++) {
    const b = Math.floor(((th[i] / (2 * Math.PI)) % 1 + 1) % 1 * BINS) % BINS;
    bins[b].push(i);
  }
  ctx.lineWidth = Math.max(1.5 * dpr, 0.12 * s);
  ctx.lineCap = 'round';
  bins.forEach((list, b) => {
    if (!list.length) return;
    ctx.strokeStyle = binColor[b];
    ctx.beginPath();
    for (const i of list) {
      const px = x[i] * s, py = y[i] * s, cx = Math.cos(th[i]) * half, cy = Math.sin(th[i]) * half;
      ctx.moveTo(px - cx, py - cy);
      ctx.lineTo(px + cx, py + cy);
    }
    ctx.stroke();
  });
}

function drawChart() {
  const w = chart.width, h = chart.height, dpr = window.devicePixelRatio || 1;
  const Y = v => h - 4 * dpr - v * (h - 18 * dpr);
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.fillStyle = '#040a08';
  cctx.fillRect(0, 0, w, h);
  cctx.font = `${10 * dpr}px system-ui, sans-serif`;
  cctx.fillStyle = '#86a89b';
  cctx.fillText('φ, от 0 до 1', 4 * dpr, 12 * dpr);
  // Where φ sits when everyone flies at random: √π/2 / √N ≈ 0.89/√N (the average length of a random walk).
  const noise = 0.886 / Math.sqrt(sim.n);
  cctx.strokeStyle = '#86a89b';
  cctx.setLineDash([4 * dpr, 4 * dpr]);
  cctx.lineWidth = dpr;
  cctx.beginPath(); cctx.moveTo(0, Y(noise)); cctx.lineTo(w, Y(noise)); cctx.stroke();
  cctx.setLineDash([]);
  cctx.fillText('вразнобой ≈ 0,9/√N', w - 100 * dpr, Y(noise) - 3 * dpr);
  if (phiHistory.length < 2) return;
  cctx.strokeStyle = '#3ee6b0';
  cctx.lineWidth = 2 * dpr;
  cctx.beginPath();
  phiHistory.forEach((v, k) => (k ? cctx.lineTo(k / (HISTORY - 1) * w, Y(v)) : cctx.moveTo(0, Y(v))));
  cctx.stroke();
}

// ---- phase diagram: a separate small swarm is run at 12 values of the chosen axis -----------
const AXES = {
  eta: { label: 'шум η', values: Array.from({ length: 12 }, (_, k) => 0.25 + k * 0.5), min: 0, max: 2 * Math.PI, log: false },
  density: { label: 'плотность', values: Array.from({ length: 12 }, (_, k) => 0.1 * Math.pow(80, k / 11)), min: 0.1, max: 8, log: true },
};
const WARM = 600, MEASURE = 600;
let sweep = null, curve = [], oldCurve = [];

function startSweep() {
  oldCurve = curve.axis === $('axis').value ? curve : [];
  curve = [];
  curve.axis = $('axis').value;
  curve.label = `N ${Math.min(1000, params.count)}, ` + (curve.axis === 'eta' ? `плотность ${params.density}` : `шум ${params.eta.toFixed(1)}`) + `, v₀ ${params.v0}`;
  sweep = { axis: curve.axis, k: -1, sim: null, t: 0, s: 0, base: { ...params, count: Math.min(1000, params.count) } };
  $('btn-sweep').textContent = '■ Стоп';
}
function stopSweep() { sweep = null; $('btn-sweep').textContent = 'Снять кривую'; }

// Advance the sweep for at most `budget` ms.
function workSweep(budget) {
  const t0 = performance.now();
  while (sweep && performance.now() - t0 < budget) {
    if (!sweep.sim) {
      sweep.k++;
      if (sweep.k >= AXES[sweep.axis].values.length) { stopSweep(); break; }
      const p = { ...sweep.base, [sweep.axis]: AXES[sweep.axis].values[sweep.k] };
      sweep.sim = new Vicsek(p, makeRng(1000 + sweep.k));
      sweep.t = 0; sweep.s = 0;
    }
    sweep.sim.step();
    sweep.t++;
    if (sweep.t > WARM) sweep.s += sweep.sim.order().phi;
    if (sweep.t === WARM + MEASURE) {
      curve.push([AXES[sweep.axis].values[sweep.k], sweep.s / MEASURE]);
      sweep.sim = null;
    }
  }
}

function drawPhase() {
  const w = phase.width, h = phase.height, dpr = window.devicePixelRatio || 1, ax = AXES[$('axis').value];
  const L = 28 * dpr, B = 18 * dpr;
  const X = v => L + (ax.log ? Math.log(v / ax.min) / Math.log(ax.max / ax.min) : (v - ax.min) / (ax.max - ax.min)) * (w - L - 6 * dpr);
  const Y = v => h - B - v * (h - B - 8 * dpr);
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.fillStyle = '#040a08';
  pctx.fillRect(0, 0, w, h);
  pctx.font = `${10 * dpr}px system-ui, sans-serif`;
  pctx.fillStyle = '#86a89b';
  pctx.strokeStyle = '#1f3a32';
  pctx.lineWidth = dpr;
  for (const v of [0, 0.5, 1]) {
    pctx.beginPath(); pctx.moveTo(L, Y(v)); pctx.lineTo(w, Y(v)); pctx.stroke();
    pctx.fillText(String(v), 4 * dpr, Y(v) + 3 * dpr);
  }
  const ticks = ax.log ? [0.1, 0.3, 1, 3, 8] : [0, 1, 2, 3, 4, 5, 6];
  for (const t of ticks) pctx.fillText(String(t), X(t) - 3 * dpr, h - 5 * dpr);
  pctx.textAlign = 'right';
  pctx.fillText(ax.label + ' →', w - 6 * dpr, 12 * dpr);
  pctx.textAlign = 'left';
  pctx.fillText('φ', L - 12 * dpr, 12 * dpr);
  const line = (pts, color) => {
    if (!pts.length) return;
    pctx.strokeStyle = color; pctx.fillStyle = color; pctx.lineWidth = 2 * dpr;
    pctx.beginPath();
    pts.forEach(([a, f], k) => (k ? pctx.lineTo(X(a), Y(f)) : pctx.moveTo(X(a), Y(f))));
    pctx.stroke();
    for (const [a, f] of pts) { pctx.beginPath(); pctx.arc(X(a), Y(f), 3 * dpr, 0, Math.PI * 2); pctx.fill(); }
  };
  if (oldCurve.axis === $('axis').value) line(oldCurve, '#5f8f80');
  if (curve.axis === $('axis').value) line(curve, '#3ee6b0');
  // Where the field is now (the average of the last ~100 steps).
  const now = params[$('axis').value];
  if (now >= ax.min) {
    pctx.fillStyle = '#ff7ab6';
    pctx.beginPath(); pctx.arc(X(Math.min(ax.max, now)), Y(phiAvg), 5 * dpr, 0, Math.PI * 2); pctx.fill();
  }
  if (sweep) {
    pctx.fillStyle = '#f5d76e';
    pctx.fillText(`снимаю точку ${sweep.k + 1} из ${ax.values.length}…`, L + 6 * dpr, 14 * dpr);
  }
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : (s.step < 1 ? v.toFixed(s.step < 0.1 ? 2 : 1) : String(v));
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => { params[s.key] = +input.value; out.textContent = fmt(s, +input.value); });
  if (s.restart) input.addEventListener('change', () => start(false));
  $('group-' + s.group).appendChild(row);
}
$('group-view').appendChild($('trails').closest('label'));   // the checkbox goes after the sliders
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = () => start(false);
$('btn-align').onclick = () => start(true);
$('btn-sweep').onclick = () => (sweep ? stopSweep() : startSweep());
$('axis').onchange = () => { stopSweep(); drawPhase(); };
$('trails').onchange = () => { clearField = true; };

// ---- loop ------------------------------------------------------------------------------------
let lastStats = 0;
function frame(now) {
  if (running) {
    const t0 = performance.now();
    for (let k = 0; k < params.speed && performance.now() - t0 < 25; k++) {
      sim.step();
      const f = sim.order().phi;
      phiAvg += (f - phiAvg) / 100;
      phiHistory.push(f);
      if (phiHistory.length > HISTORY) phiHistory.shift();
    }
  }
  if (sweep) workSweep(12);
  draw();
  drawChart();
  drawPhase();
  if (now - lastStats > 300) {
    lastStats = now;
    $('stats').innerHTML = `шаг <b>${sim.steps}</b> · частиц <b>${sim.n}</b> · соседей в среднем <b>≈ ${(Math.PI * params.density).toFixed(1)}</b>`
      + ` · порядок φ <b>${sim.order().phi.toFixed(2)}</b> (среднее за ~100 шагов <b>${phiAvg.toFixed(2)}</b>)`;
  }
  requestAnimationFrame(frame);
}
resize();
start(false);
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
