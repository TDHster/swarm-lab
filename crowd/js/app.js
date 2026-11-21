// UI and main loop: scenarios, sliders (built from SLIDERS), heat maps, the plan constructor
// and the table of finished runs for comparing designs.

const SCENARIOS = {
  hall: { label: 'Выход из зала', uses: ['count', 'door', 'column'], count: 200 },
  two: { label: 'Два выхода', uses: ['count', 'door', 'aware'], count: 300 },
  corridor: { label: 'Встречный коридор', uses: ['count'], count: 40 },
  crossing: { label: 'Перекрёсток потоков', uses: ['count'], count: 250 },
};

// live: applied on the fly; otherwise the scenario is rebuilt and restarted.
const SLIDERS = [
  { group: 'people', key: 'v0', label: 'Желаемая скорость', min: 0.5, max: 6, step: 0.1, value: 1.3, unit: ' м/с', live: true,
    title: '1.3 м/с — обычный шаг; 2–3 — торопятся; 4–6 — паника, бег и толкотня' },
  { group: 'people', key: 'herding', label: 'Стадность', min: 0, max: 0.8, step: 0.05, value: 0, live: true,
    title: 'Какую долю своего направления человек заменяет направлением соседей: 0 — идёт своим путём, 0.8 — почти слепо за толпой' },
  { group: 'people', key: 'jitter', label: 'Нервозность', min: 0, max: 0.5, step: 0.05, value: 0.1, live: true,
    title: 'Случайное отклонение от желаемого направления, меняется примерно раз в секунду' },
  { group: 'scene', key: 'count', label: 'Людей', min: 20, max: 600, step: 10, value: 200 },
  { group: 'scene', key: 'door', label: 'Ширина двери', min: 0.6, max: 3, step: 0.1, value: 1.2, unit: ' м' },
  { group: 'scene', key: 'aware', label: 'Знают про запасной', min: 0, max: 100, step: 10, value: 100, unit: '%',
    title: 'Остальные идут к главному выходу, даже если запасной ближе' },
  { group: 'run', key: 'speedUp', label: 'Ускорение', min: 1, max: 8, step: 1, value: 2, unit: '×', live: true },
];
const STEPS_PER_FRAME = 5;   // 5 × 1/300 s = one 1/60 s frame of simulated time
const HEAT_CELL = 0.5;

const $ = id => document.getElementById(id);
const values = {};
for (const s of SLIDERS) values[s.key] = s.value;
const params = { v0: values.v0, herding: values.herding, jitter: values.jitter, speedUp: values.speedUp, friction: true };

let scenario = 'hall';
let plan, crowd, heat, heatAvg, heatMax, history, recorded, lastSample;
let running = true;

// ---- scenario --------------------------------------------------------------------------------
function opts() {
  return { count: values.count, door: values.door, column: $('column').checked, aware: values.aware / 100 };
}

function load(name, keepCount) {
  scenario = name;
  if (!keepCount) setSlider('count', SCENARIOS[name].count, true);
  plan = makeScenario(name, opts());
  for (const s of SLIDERS) {
    const row = document.querySelector(`input[data-key="${s.key}"]`).closest('.slider');
    row.style.display = s.group === 'scene' && !SCENARIOS[name].uses.includes(s.key) ? 'none' : '';
  }
  $('column-row').style.display = SCENARIOS[name].uses.includes('column') ? '' : 'none';
  for (const b of document.querySelectorAll('#scenarios button')) b.classList.toggle('active', b.dataset.key === name);
  for (const el of document.querySelectorAll('[data-hint]')) el.hidden = el.dataset.hint !== name;
  crowd = new Crowd(plan, params, makeRng(+$('seed').value || 1));
  restartStats();
}

function restart() {
  crowd.reset(makeRng(+$('seed').value || 1));
  restartStats();
}

function restartStats() {
  heatAvg = null;
  heatMax = null;
  history = [];
  recorded = false;
  lastSample = -1;
}

// ---- sliders -------------------------------------------------------------------------------
const fmt = (s, v) => (s.step < 1 ? v.toFixed(s.step < 0.1 ? 2 : 1) : String(v)) + (s.unit || '');

function buildSliders() {
  for (const s of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'slider';
    if (s.title) row.title = s.title;
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}"
      value="${s.value}" data-key="${s.key}"><output>${fmt(s, s.value)}</output>`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.addEventListener('input', () => {
      values[s.key] = +input.value;
      out.textContent = fmt(s, +input.value);
      if (s.key in params) params[s.key] = values[s.key];
    });
    // Scene sliders rebuild the scenario when released (not on every pixel of a drag).
    if (!s.live) input.addEventListener('change', () => load(scenario, true));
    $('group-' + s.group).appendChild(row);
  }
}

function setSlider(key, value, silent) {
  const input = document.querySelector(`input[data-key="${key}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  if (!silent) input.dispatchEvent(new Event('change'));
}

// ---- canvases --------------------------------------------------------------------------------
const field = $('field'), chart = $('chart');
const fctx = field.getContext('2d'), cctx = chart.getContext('2d');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  field.width = Math.round(field.clientWidth * dpr);
  field.height = Math.round(field.clientHeight * dpr);
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
}
new ResizeObserver(resize).observe(field);

// ---- constructor -----------------------------------------------------------------------------
const snap = v => Math.round(v * 4) / 4;   // 25 cm grid
let drag = null;

function toWorld(e) {
  const r = field.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * WORLD_W, y: (e.clientY - r.top) / r.height * WORLD_H };
}

function planChanged() {
  crowd.setPlan(plan);
  $('plan-note').textContent = 'План изменён: «Сброс» расставит людей заново по зонам старта.';
}

field.addEventListener('pointerdown', e => {
  const tool = $('tool').value;
  if (tool === 'none') return;
  if (plan.flows) { $('plan-note').textContent = 'В коридоре и на перекрёстке план не редактируется — выбери зал.'; return; }
  const p = toWorld(e);
  try { field.setPointerCapture(e.pointerId); } catch { /* synthetic events in tests have no real pointer */ }
  drag = { tool, x0: snap(p.x), y0: snap(p.y), x1: snap(p.x), y1: snap(p.y) };
});
field.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = toWorld(e);
  drag.x1 = snap(p.x); drag.y1 = snap(p.y);
});
field.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
  if (d.tool === 'wall') {
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 0.2) return;
    plan.walls.push({ x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1 });
  } else if (d.tool === 'column') {
    plan.columns.push({ x: d.x0, y: d.y0, r: 0.4 });
  } else if (d.tool === 'exit') {
    if (x1 - x0 < 0.3 || y1 - y0 < 0.3) return;
    plan.exits.push({ x0, y0, x1, y1, label: `выход ${plan.exits.length + 1}` });
  } else if (d.tool === 'people') {
    if (x1 - x0 < 0.6 || y1 - y0 < 0.6) return;
    const sp = { x0, y0, x1, y1, count: Math.round((x1 - x0) * (y1 - y0) * 1.2), target: -1 };
    plan.spawns.push(sp);
    crowd.spawnArea(sp);
    crowd.startCount = crowd.n + crowd.totalOut();
  } else if (d.tool === 'gap') {
    // Cut a doorway: in every wall that the dragged line lies along, remove the part between its ends.
    const next = [];
    for (const w of plan.walls) {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const on = (x, y) => segDist(x, y, { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }).d < 0.3;
      if (len < 1e-6 || !on(d.x0, d.y0) || !on(d.x1, d.y1)) { next.push(w); continue; }
      const t = (x, y) => ((x - w.x1) * (w.x2 - w.x1) + (y - w.y1) * (w.y2 - w.y1)) / (len * len);
      const ta = Math.max(0, Math.min(t(d.x0, d.y0), t(d.x1, d.y1))), tb = Math.min(1, Math.max(t(d.x0, d.y0), t(d.x1, d.y1)));
      const pt = q => ({ x: w.x1 + (w.x2 - w.x1) * q, y: w.y1 + (w.y2 - w.y1) * q });
      if (ta * len > 0.05) { const e = pt(ta); next.push({ x1: w.x1, y1: w.y1, x2: e.x, y2: e.y }); }
      if ((1 - tb) * len > 0.05) { const e = pt(tb); next.push({ x1: e.x, y1: e.y, x2: w.x2, y2: w.y2 }); }
    }
    plan.walls = next;
  } else if (d.tool === 'erase') {
    const px = d.x1, py = d.y1;
    plan.walls = plan.walls.filter(w => segDist(px, py, w).d > 0.3);
    plan.columns = plan.columns.filter(c => Math.hypot(c.x - px, c.y - py) > c.r + 0.2);
    plan.exits = plan.exits.filter(z => !(px >= z.x0 && px <= z.x1 && py >= z.y0 && py <= z.y1));
    plan.spawns = plan.spawns.filter(z => !(px >= z.x0 && px <= z.x1 && py >= z.y0 && py <= z.y1));
    for (let i = crowd.n - 1; i >= 0; i--) if (Math.hypot(crowd.x[i] - px, crowd.y[i] - py) < 0.8) crowd.removeAt(i);
  }
  planChanged();
});

// ---- buttons ---------------------------------------------------------------------------------
function setRunning(on) {
  running = on;
  $('btn-run').textContent = on ? '⏸ Пауза' : '▶ Старт';
}
$('btn-run').onclick = () => setRunning(!running);
$('btn-reset').onclick = () => { restart(); $('plan-note').textContent = ''; };
$('btn-scenario').onclick = () => { load(scenario, true); $('plan-note').textContent = ''; };
$('column').onchange = () => load(scenario, true);
$('friction').onchange = e => { params.friction = e.target.checked; };
$('btn-clear-runs').onclick = () => { $('runs').innerHTML = ''; };
for (const [key, sc] of Object.entries(SCENARIOS)) {
  const b = document.createElement('button');
  b.textContent = sc.label;
  b.dataset.key = key;
  b.onclick = () => { load(key); $('plan-note').textContent = ''; };
  $('scenarios').appendChild(b);
}

// ---- stats -----------------------------------------------------------------------------------
function sample() {
  // Every 0.5 s of simulated time: chart points; every 0.25 s: heat maps (smoothed and max).
  const t = crowd.t;
  if (Math.floor(t * 4) === lastSample) return;
  lastSample = Math.floor(t * 4);
  heat = crowd.localFields(HEAT_CELL, heat);
  if (!heatAvg || heatAvg.length !== heat.rho.length) { heatAvg = new Float64Array(heat.rho.length); heatMax = new Float64Array(heat.rho.length); }
  for (let c = 0; c < heat.rho.length; c++) {
    heatAvg[c] += (heat.rho[c] - heatAvg[c]) * 0.3;
    if (heatAvg[c] > heatMax[c]) heatMax[c] = heatAvg[c];
  }
  if (lastSample % 2) return;
  if (plan.flows) history.push([t, crowd.laneOrder(), crowd.meanSpeed()]);
  else history.push([t, ...crowd.out.map(a => a.length)]);
}

function maxOf(a) { let m = 0; for (const v of a) if (v > m) m = v; return m; }

function recordRun() {
  if (recorded || plan.flows || crowd.n > 0 || crowd.startCount === 0) return;
  recorded = true;
  const o = opts(), sc = SCENARIOS[scenario];
  const what = [`${crowd.startCount} чел.`];
  if (sc.uses.includes('door')) what.push(`дверь ${o.door} м`);
  if (sc.uses.includes('column') && o.column) what.push('колонна');
  if (sc.uses.includes('aware')) what.push(`знают ${values.aware}%`);
  const row = document.createElement('tr');
  row.innerHTML = `<td>${sc.label}${$('plan-note').textContent ? ' (изменён)' : ''}</td><td>${what.join(', ')}</td>`
    + `<td>${params.v0.toFixed(1)}</td><td>${params.herding.toFixed(2)}</td><td><b>${crowd.t.toFixed(0)} с</b></td>`
    + `<td>${crowd.out.map(a => a.length).join(' / ')}</td><td>${maxOf(heatMax).toFixed(1)}</td><td>${crowd.injuredTotal()}</td>`;
  $('runs').prepend(row);
  while ($('runs').children.length > 12) $('runs').lastChild.remove();
}

function updateStats() {
  const parts = [`время <b>${crowd.t.toFixed(1)} с</b>`];
  if (plan.flows) {
    parts.push(`людей <b>${crowd.n}</b>`, `порядок полос <b>${crowd.laneOrder().toFixed(2)}</b>`,
      `средняя скорость вперёд <b>${crowd.meanSpeed().toFixed(2)} м/с</b>`);
  } else {
    parts.push(`внутри <b>${crowd.n}</b>`, `вышли <b>${crowd.totalOut()}</b>`,
      `поток <b>${crowd.flows().map(f => f.toFixed(1)).join(' + ')} чел/с</b>`);
  }
  parts.push(`плотность до <b>${maxOf(heatAvg || []).toFixed(1)} чел/м²</b>`, `сжатых сильнее 1600 Н/м <b>${crowd.injuredNow || 0}</b>`);
  $('stats').innerHTML = parts.join(' · ');
}

function drawChart() {
  if (plan.flows) {
    drawLines(cctx, [
      { values: history.map(r => [r[0], r[1]]), color: '#3ee6b0' },
      { values: history.map(r => [r[0], r[2] / 1.5]), color: '#f5d76e' },
    ], Math.max(10, crowd.t), 1, 'порядок полос 0…1 (бирюза), скорость 0…1.5 м/с (жёлтая)');
  } else {
    const total = Math.max(1, crowd.startCount);
    drawLines(cctx, plan.exits.map((_, k) => ({ values: history.map(r => [r[0], r[k + 1] || 0]), color: CROWD_COLORS.exits[k % 4] })),
      Math.max(10, crowd.t), total, `вышло через каждый выход, из ${total}`);
  }
}

// ---- loop ------------------------------------------------------------------------------------
function frame() {
  if (running) {
    const t0 = performance.now();
    for (let k = 0; k < STEPS_PER_FRAME * params.speedUp; k++) {
      crowd.step();
      sample();
      if (performance.now() - t0 > 14) break;   // too many people for this speed-up: slow down instead of freezing
    }
    recordRun();
  }
  const mode = $('heat').value;
  const heatOpt = !heatAvg || mode === 'none' ? null
    : mode === 'max' ? { grid: heat, values: heatMax, top: 6 }
    : mode === 'pressure' ? { grid: heat, values: heat.press, top: 1 }
    : { grid: heat, values: heatAvg, top: 6 };
  drawCrowd(fctx, crowd, {
    colorMode: $('color-mode').value, heat: heatOpt,
    preview: drag && drag.tool !== 'column' && drag.tool !== 'erase'
      ? { kind: drag.tool === 'wall' || drag.tool === 'gap' ? 'line' : 'rect', x0: drag.x0, y0: drag.y0, x1: drag.x1, y1: drag.y1 } : null,
  });
  drawChart();
  updateStats();
  requestAnimationFrame(frame);
}

buildSliders();
resize();
load('hall');
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
