// UI and main loop: builds the sliders from SLIDERS, runs the model at a fixed 60 steps/s, draws.

const SLIDERS = [
  { group: 'rules', key: 'separation', label: 'Разделение', min: 0, max: 3, step: 0.1, value: 1.5,
    title: 'Отлетать от тех, кто ближе «личного пространства»' },
  { group: 'rules', key: 'alignment', label: 'Выравнивание', min: 0, max: 3, step: 0.1, value: 1,
    title: 'Лететь в ту же сторону, что и видимые соседи' },
  { group: 'rules', key: 'cohesion', label: 'Сплочённость', min: 0, max: 3, step: 0.1, value: 1,
    title: 'Лететь к центру видимых соседей' },
  { group: 'sense', key: 'vision', label: 'Радиус зрения', min: 10, max: 150, step: 5, value: 50, unit: ' px',
    title: 'Дальше этого птица соседей не видит' },
  { group: 'sense', key: 'personal', label: 'Личное пространство', min: 5, max: 60, step: 1, value: 20, unit: ' px',
    title: 'Ближе этого соседи отталкивают (правило разделения)' },
  { group: 'sense', key: 'fov', label: 'Угол обзора', min: 30, max: 360, step: 10, value: 270, unit: '°',
    title: 'Сектор впереди, в котором видны соседи; позади — слепая зона' },
  { group: 'move', key: 'count', label: 'Птиц', min: 50, max: 3000, step: 50, value: 600,
    title: 'Меняется на ходу: новые птицы появляются в случайных местах' },
  { group: 'move', key: 'maxSpeed', label: 'Скорость', min: 1, max: 8, step: 0.5, value: 3.5, unit: ' px/кадр' },
  { group: 'move', key: 'maxForce', label: 'Резкость поворота', min: 0.02, max: 0.5, step: 0.01, value: 0.1,
    title: 'Наибольшее изменение скорости за кадр: маленькая — плавные дуги, большая — дёрганые броски' },
  { group: 'world', key: 'fear', label: 'Страх хищника', min: 0, max: 3, step: 0.1, value: 1.5,
    title: 'Насколько сильно птицы удирают от курсора' },
  { group: 'world', key: 'trails', label: 'Шлейфы', min: 0, max: 0.95, step: 0.05, value: 0.75,
    title: 'Чем больше, тем дольше гаснет след' },
];

const PRESETS = {
  flock: { label: 'Стая', values: {} },   // defaults
  fish: { label: 'Косяк рыб', values: { separation: 2, alignment: 2.5, cohesion: 0.6, vision: 40, personal: 14,
    fov: 300, maxSpeed: 3, maxForce: 0.08 } },
  gnats: { label: 'Мошкара', values: { separation: 0.6, alignment: 0, cohesion: 2.5, vision: 80, personal: 10,
    fov: 360, maxSpeed: 4, maxForce: 0.3 } },
  chaos: { label: 'Без правил', values: { separation: 0, alignment: 0, cohesion: 0 } },
};

const PREDATOR_RADIUS = 120;
const OBSTACLE_RADIUS = 32;
const STEP_MS = 1000 / 60;
const CHART_LEN = 600;   // 10 s of history

const $ = id => document.getElementById(id);
const params = { edges: 'wrap' };
for (const s of SLIDERS) params[s.key] = s.value;

let flock = new Flock(params, makeRng(+$('seed').value || 1));
let running = true;
const orderHistory = [];

// ---- sliders -----------------------------------------------------------------------------
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
      params[s.key] = +input.value;
      out.textContent = fmt(s, +input.value);
      if (s.key === 'count') flock.setCount(params.count);
    });
    $('group-' + s.group).appendChild(row);
  }
}

function setSlider(key, value) {
  const input = document.querySelector(`input[data-key="${key}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input'));   // same path as a user drag
}

function applyPreset(name) {
  for (const s of SLIDERS) {
    if (s.group === 'world' || s.key === 'count') continue;   // presets change the rules, not the view
    setSlider(s.key, PRESETS[name].values[s.key] ?? s.value);
  }
}

function randomParams() {
  for (const s of SLIDERS) {
    if (s.group === 'world' || s.key === 'count') continue;
    const steps = Math.round((s.max - s.min) / s.step);
    setSlider(s.key, +(s.min + Math.floor(Math.random() * (steps + 1)) * s.step).toFixed(2));
  }
}

// ---- canvases --------------------------------------------------------------------------------
const trail = $('trail'), overlay = $('overlay'), chart = $('chart');
const tctx = trail.getContext('2d'), octx = overlay.getContext('2d'), cctx = chart.getContext('2d');
let scale = 1;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(trail.clientWidth * dpr), h = Math.round(trail.clientHeight * dpr);
  for (const c of [trail, overlay]) { c.width = w; c.height = h; }
  scale = w / flock.w;
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
}
new ResizeObserver(resize).observe(trail);

function toWorld(e) {
  const r = overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * flock.w, y: (e.clientY - r.top) / r.height * flock.h };
}

// Move = predator (if enabled). A click without dragging = obstacle on/off or pick a boid.
let downAt = null;
overlay.addEventListener('pointermove', e => {
  if (!$('predator-on').checked || (e.pointerType === 'touch' && !downAt)) return;
  const p = toWorld(e);
  flock.predator = { x: p.x, y: p.y, r: PREDATOR_RADIUS };
});
overlay.addEventListener('pointerleave', () => { flock.predator = null; });
overlay.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
overlay.addEventListener('pointerup', e => {
  const moved = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6;
  downAt = null;
  if (e.pointerType === 'touch') flock.predator = null;
  if (moved) return;
  const p = toWorld(e);
  if ($('click-mode').value === 'focus') {
    flock.focus = flock.nearestBoid(p.x, p.y);
    $('focus-on').checked = true;
    return;
  }
  const hit = flock.obstacles.findIndex(o => Math.hypot(o.x - p.x, o.y - p.y) < o.r);
  if (hit >= 0) flock.obstacles.splice(hit, 1);
  else flock.obstacles.push({ x: p.x, y: p.y, r: OBSTACLE_RADIUS });
});

// ---- buttons -------------------------------------------------------------------------------
function setRunning(on) {
  running = on;
  $('btn-run').textContent = on ? '⏸ Пауза' : '▶ Старт';
}
$('btn-run').onclick = () => setRunning(!running);
$('btn-step').onclick = () => { setRunning(false); simulate(1); };
$('btn-reset').onclick = () => {
  flock.reset(makeRng(+$('seed').value || 1));
  orderHistory.length = 0;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, trail.width, trail.height);
};
$('btn-random').onclick = randomParams;
$('btn-clear').onclick = () => { flock.obstacles.length = 0; };
$('edges').onchange = e => { params.edges = e.target.value; };
for (const [name, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.onclick = () => applyPreset(name);
  $('presets').appendChild(b);
}

// ---- loop -----------------------------------------------------------------------------------
function simulate(steps) {
  for (let k = 0; k < steps; k++) {
    flock.step();
    orderHistory.push(flock.stats.order);
    if (orderHistory.length > CHART_LEN) orderHistory.shift();
  }
}

let last = performance.now(), acc = 0, fpsFrames = 0, fpsTime = last, fps = 0;
function frame(now) {
  const dt = Math.min(100, now - last);
  last = now;
  if (running) {
    acc += dt;
    let steps = Math.floor(acc / STEP_MS);
    acc -= steps * STEP_MS;
    if (steps > 3) { steps = 3; acc = 0; }   // too slow: drop time instead of piling up work
    simulate(steps);
  }
  drawBoids(tctx, flock, scale, params.trails, $('color-mode').value);
  drawOverlay(octx, flock, scale, $('focus-on').checked);

  fpsFrames++;
  if (now - fpsTime > 500) {
    fps = fpsFrames * 1000 / (now - fpsTime);
    fpsFrames = 0;
    fpsTime = now;
    $('stats').innerHTML = `FPS <b>${fps.toFixed(0)}</b> · птиц <b>${flock.n}</b> · порядок <b>${flock.stats.order.toFixed(2)}</b>`
      + ` · соседей в среднем <b>${flock.stats.meanNeighbors.toFixed(1)}</b>`;
  }
  drawChart(cctx, orderHistory, CHART_LEN);
  requestAnimationFrame(frame);
}

buildSliders();
resize();
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
