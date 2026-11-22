// UI and main loop: sliders are built from SLIDERS; the swarm makes `rate` iterations per second,
// and particles glide between iterations so the motion is easy to follow.

const SLIDERS = [
  { group: 'rule', key: 'w', label: 'Инерция w', min: 0, max: 1.2, step: 0.01, value: 0.72,
    title: 'Какую долю прежней скорости частица сохраняет: мало — тормозит и топчется, много — проскакивает' },
  { group: 'rule', key: 'c1', label: 'Своя память c1', min: 0, max: 3, step: 0.05, value: 1.49,
    title: 'Тяга к своей лучшей точке' },
  { group: 'rule', key: 'c2', label: 'Рой c2', min: 0, max: 3, step: 0.05, value: 1.49,
    title: 'Тяга к лучшей точке роя (или соседей — при кольце)' },
  { group: 'rule', key: 'vmax', label: 'Предел скорости', min: 1, max: 100, step: 1, value: 20, unit: '%',
    title: 'Наибольший шаг за итерацию, в процентах от ширины поля' },
  { group: 'run', key: 'count', label: 'Частиц', min: 2, max: 200, step: 1, value: 30,
    title: 'Меняется на ходу: новые частицы появляются в случайных местах' },
  { group: 'run', key: 'rate', label: 'Итераций в секунду', min: 1, max: 60, step: 1, value: 5 },
];

const PRESETS = {
  classic: { label: 'Классика', values: {} },
  alone: { label: 'Каждый сам за себя', values: { c2: 0 } },
  herd: { label: 'Только за лидером', values: { c1: 0 } },
  noInertia: { label: 'Без инерции', values: { w: 0 } },
  slippery: { label: 'Без трения', values: { w: 1 } },
};

const $ = id => document.getElementById(id);
const params = { fn: 'rastrigin', topology: 'global' };
for (const s of SLIDERS) params[s.key] = s.value;

const swarm = new Swarm(params, makeRng(1));
let running = true;

const fmt = (s, v) => s.fmt ? s.fmt(v) : (s.step < 1 ? v.toFixed(s.step < 0.1 ? 2 : 1) : String(v)) + (s.unit || '');

function buildSliders() {
  for (const s of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'slider';
    if (s.title) row.title = s.title;
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}"
      value="${s.value}" data-key="${s.key}"><output>${fmt(s, s.value)}</output>`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.addEventListener('input', () => {
      params[s.key] = +input.value;
      out.textContent = fmt(s, +input.value);
      if (s.key === 'count') swarm.setCount(params.count);
    });
    $('group-' + s.group).appendChild(row);
  }
}

function setSlider(key, value) {
  const input = document.querySelector(`input[data-key="${key}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

let sinceStep = 0;
function restart() {
  swarm.reset(makeRng(+$('seed').value || 1));
  sinceStep = 0;
}

function applyPreset(name) {
  for (const s of SLIDERS) {
    if (s.group === 'run') continue;
    setSlider(s.key, PRESETS[name].values[s.key] ?? s.value);
  }
  restart();
}

// ---- canvases ---------------------------------------------------------------------------------
const field = $('field'), chart = $('chart');
const fctx = field.getContext('2d'), cctx = chart.getContext('2d');
let dpr = 1;

function resize() {
  dpr = window.devicePixelRatio || 1;
  field.width = Math.round(field.clientWidth * dpr);
  field.height = Math.round(field.clientHeight * dpr);
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
}
new ResizeObserver(resize).observe(field);

// ---- buttons --------------------------------------------------------------------------------
function setRunning(on) {
  running = on;
  $('btn-run').textContent = on ? '⏸ Пауза' : '▶ Старт';
}
$('btn-run').onclick = () => setRunning(!running);
$('btn-step').onclick = () => { setRunning(false); swarm.step(); sinceStep = Infinity; };
$('btn-reset').onclick = restart;
$('btn-new-seed').onclick = () => { $('seed').value = 1 + Math.floor(Math.random() * 9999); restart(); };
$('fn').onchange = e => { params.fn = e.target.value; restart(); };
$('topology').onchange = e => { params.topology = e.target.value; };
for (const [key, f] of Object.entries(FUNCTIONS)) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = f.label;
  o.selected = key === params.fn;
  $('fn').appendChild(o);
}
for (const [name, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.onclick = () => applyPreset(name);
  $('presets').appendChild(b);
}

// ---- pause while off screen ------------------------------------------------------------------
// No canvas in view (the visitor scrolled to the text) - nobody watches, so skip the work and keep the laptop cool.
const onScreen = new Set();
{
  const io = new IntersectionObserver(es => { for (const e of es) (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)); });
  for (const c of document.querySelectorAll('canvas')) io.observe(c);
}

// ---- loop -------------------------------------------------------------------------------------
const fmtNum = v => (v === 0 ? '0' : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(2) : v.toPrecision(4));
let last = performance.now();
function frame(now) {
  if (!onScreen.size) { last = now; requestAnimationFrame(frame); return; }
  const dt = Math.min(100, now - last);
  last = now;
  const interval = 1000 / params.rate;
  if (running) {
    sinceStep += dt;
    if (sinceStep >= interval) {
      swarm.step();
      sinceStep = sinceStep >= 2 * interval ? 0 : sinceStep - interval;
    }
  }
  const t = Math.min(1, sinceStep / interval);
  drawSwarm(fctx, swarm, t, {
    dpr, showPbest: $('show-pbest').checked, showMin: $('show-min').checked, showOne: $('show-one').checked,
  });
  drawChart(cctx, swarm.history, dpr);
  const miss = swarm.missDistance();
  $('stats').innerHTML = `итерация <b>${swarm.iter}</b> · лучшее значение <b>${fmtNum(swarm.gf)}</b>`
    + ` · до минимума <b class="${miss < 0.01 ? 'good' : ''}">${(miss * 100).toFixed(miss < 0.01 ? 3 : 1)}%</b> ширины`
    + ` · вычислений функции <b>${swarm.evals}</b>`;
  requestAnimationFrame(frame);
}

buildSliders();
resize();
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
