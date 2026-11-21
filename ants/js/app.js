// UI and main loop: sliders are built from SLIDERS, the model runs 60 steps per simulated second.

const SLIDERS = [
  { group: 'ant', key: 'sensorAngle', label: 'Угол сенсоров', min: 10, max: 90, step: 5, value: 35, unit: '°',
    title: 'Насколько в стороны смотрят левый и правый сенсоры' },
  { group: 'ant', key: 'sensorDist', label: 'Дальность сенсоров', min: 2, max: 20, step: 1, value: 7, unit: ' кл',
    title: 'Как далеко впереди муравей нюхает (в клетках поля)' },
  { group: 'ant', key: 'turn', label: 'Поворот за шаг', min: 5, max: 60, step: 5, value: 20, unit: '°',
    title: 'На сколько муравей поворачивает в сторону более сильного запаха' },
  { group: 'ant', key: 'randomness', label: 'Случайность', min: 0, max: 1, step: 0.05, value: 0.25, unit: ' рад',
    title: 'Случайное виляние на каждом шаге: без него нет разведки, с большим — тропы не держатся' },
  { group: 'phero', key: 'evaporation', label: 'Испарение', min: 0, max: 99, step: 0.5, value: 5, unit: ' %/с',
    title: 'Какая доля феромона исчезает за секунду' },
  { group: 'phero', key: 'diffusion', label: 'Диффузия', min: 0, max: 1, step: 0.05, value: 0.1,
    title: 'Насколько след расплывается в соседние клетки за шаг' },
  { group: 'phero', key: 'memory', label: 'Память метки', min: 30, max: 2000, step: 10, value: 300,
    fmt: v => (v / 60).toFixed(1) + ' с',
    title: 'Сила метки муравья уменьшается вдвое за это время после ухода из гнезда или от еды — поэтому тропа «показывает» на источник' },
  { group: 'colony', key: 'count', label: 'Муравьёв', min: 50, max: 4000, step: 50, value: 500,
    title: 'Новые муравьи выходят из гнезда по одному' },
  { group: 'colony', key: 'speedUp', label: 'Ускорение', min: 1, max: 10, step: 1, value: 2, unit: '×',
    title: 'Шагов модели за 1/60 секунды' },
  { group: 'colony', key: 'brushSize', label: 'Размер кисти', min: 1, max: 20, step: 1, value: 6, unit: ' кл' },
];

const MAPS = [
  { key: 'bridge', label: 'Два пути' },
  { key: 'field', label: 'Поле с едой' },
  { key: 'maze', label: 'Лабиринт' },
  { key: 'empty', label: 'Пусто' },
];

const STEP_MS = 1000 / 60;
const CHART_LEN = 180;   // seconds of simulated time on the chart

const $ = id => document.getElementById(id);
const params = { speed: 1 };
for (const s of SLIDERS) params[s.key] = s.value;

const colony = new Colony(params, makeRng(1));
let currentMap = 'bridge';
let running = true;
const perSecond = [];
let deliveredAtSecond = 0;

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
      if (s.key === 'count') colony.setCount(params.count);
    });
    $('group-' + s.group).appendChild(row);
  }
}

function setSlider(key, value) {
  const input = document.querySelector(`input[data-key="${key}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function restart() {
  colony.reset(makeRng(+$('seed').value || 1));
  perSecond.length = 0;
  deliveredAtSecond = 0;
}

function loadMap(key) {
  currentMap = key;
  colony.loadPreset(key);
  restart();
  for (const b of document.querySelectorAll('#maps button')) b.classList.toggle('active', b.dataset.map === key);
}

// ---- canvases ---------------------------------------------------------------------------------
const field = $('field'), overlay = $('overlay'), chart = $('chart');
const fctx = field.getContext('2d'), octx = overlay.getContext('2d'), cctx = chart.getContext('2d');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(field.clientWidth * dpr), h = Math.round(field.clientHeight * dpr);
  for (const c of [field, overlay]) { c.width = w; c.height = h; }
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
}
new ResizeObserver(resize).observe(field);

function toCell(e) {
  const r = overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * colony.w, y: (e.clientY - r.top) / r.height * colony.h };
}

// Drag to paint; the right button always erases. The nest brush moves the nest on click.
let painting = null;
function paintAt(e) {
  const p = toCell(e);
  if (painting === 'nest') {
    colony.paint('erase', p.x, p.y, colony.nest.r + 1);
    colony.nest = { x: p.x, y: p.y, r: colony.nest.r };
    return;
  }
  colony.paint(painting, p.x, p.y, params.brushSize);
}
overlay.addEventListener('pointerdown', e => {
  painting = e.button === 2 ? 'erase' : $('brush').value;
  overlay.setPointerCapture(e.pointerId);
  paintAt(e);
});
overlay.addEventListener('pointermove', e => { if (painting && painting !== 'nest') paintAt(e); });
overlay.addEventListener('pointerup', () => { painting = null; });
overlay.addEventListener('contextmenu', e => e.preventDefault());

// ---- buttons --------------------------------------------------------------------------------
function setRunning(on) {
  running = on;
  $('btn-run').textContent = on ? '⏸ Пауза' : '▶ Старт';
}
$('btn-run').onclick = () => setRunning(!running);
$('btn-reset').onclick = restart;
$('btn-reload').onclick = () => loadMap(currentMap);
for (const m of MAPS) {
  const b = document.createElement('button');
  b.textContent = m.label;
  b.dataset.map = m.key;
  b.onclick = () => loadMap(m.key);
  $('maps').appendChild(b);
}

// ---- loop -------------------------------------------------------------------------------------
function simulate(steps) {
  for (let k = 0; k < steps; k++) {
    colony.step();
    if (colony.steps % 60 === 0) {   // one simulated second
      perSecond.push(colony.delivered - deliveredAtSecond);
      deliveredAtSecond = colony.delivered;
      if (perSecond.length > CHART_LEN) perSecond.shift();
    }
  }
}

let last = performance.now(), acc = 0, fpsFrames = 0, fpsTime = last, fps = 0;
function frame(now) {
  const dt = Math.min(100, now - last);
  last = now;
  if (running) {
    acc += dt;
    let ticks = Math.floor(acc / STEP_MS);
    acc -= ticks * STEP_MS;
    if (ticks > 3) { ticks = 3; acc = 0; }
    simulate(ticks * params.speedUp);
  }
  drawGrid(fctx, colony, $('show-home').checked, $('show-food').checked);
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  drawAnts(octx, colony, $('show-ants').checked);
  drawChart(cctx, perSecond, CHART_LEN);

  fpsFrames++;
  if (now - fpsTime > 500) {
    fps = fpsFrames * 1000 / (now - fpsTime);
    fpsFrames = 0;
    fpsTime = now;
    let carrying = 0;
    for (let i = 0; i < colony.n; i++) carrying += colony.carrying[i];
    const t = Math.floor(colony.steps / 60);
    $('stats').innerHTML = `FPS <b>${fps.toFixed(0)}</b> · время <b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b>`
      + ` · муравьёв <b>${colony.n}</b> · несут еду <b>${carrying}</b> · принесено <b>${colony.delivered}</b>`
      + ` · осталось еды <b>${colony.foodLeft()}</b>`;
  }
  requestAnimationFrame(frame);
}

buildSliders();
resize();
loadMap('bridge');
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
