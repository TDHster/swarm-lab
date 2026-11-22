// UI and main loop: sliders are built from SLIDERS; the model runs `speedUp` steps per frame.

const SLIDERS = [
  { group: 'agent', key: 'sensorAngle', label: 'Угол сенсоров', min: 5, max: 90, step: 2.5, value: 22.5, unit: '°',
    title: 'Насколько в стороны смотрят левый и правый сенсоры' },
  { group: 'agent', key: 'sensorDist', label: 'Дальность сенсоров', min: 1, max: 40, step: 1, value: 9, unit: ' px',
    title: 'Как далеко впереди частица нюхает след' },
  { group: 'agent', key: 'turnAngle', label: 'Угол поворота', min: 5, max: 90, step: 2.5, value: 45, unit: '°',
    title: 'На сколько частица поворачивает за шаг' },
  { group: 'agent', key: 'stepSize', label: 'Шаг', min: 0.5, max: 3, step: 0.1, value: 1, unit: ' px' },
  { group: 'trail', key: 'deposit', label: 'Метка', min: 0.5, max: 20, step: 0.5, value: 5,
    title: 'Сколько следа частица оставляет за шаг' },
  { group: 'trail', key: 'decay', label: 'Затухание', min: 1, max: 50, step: 1, value: 10, unit: ' %/шаг',
    title: 'Какая доля следа исчезает за шаг' },
  { group: 'trail', key: 'diffusion', label: 'Диффузия', min: 0, max: 1, step: 0.05, value: 1,
    title: 'Насколько след расплывается за шаг (1 — полное размытие 3×3)' },
  { group: 'trail', key: 'foodStrength', label: 'Запах еды', min: 0, max: 300, step: 5, value: 100,
    title: 'Сколько следа каждый шаг испускает точка еды (клик по полю)' },
  { group: 'run', key: 'count', label: 'Частиц', min: 5000, max: 400000, step: 5000, value: 100000,
    fmt: v => (v / 1000) + ' тыс' },
  { group: 'run', key: 'speedUp', label: 'Шагов за кадр', min: 1, max: 5, step: 1, value: 1 },
  { group: 'run', key: 'gain', label: 'Яркость', min: 10, max: 400, step: 10, value: 150,
    title: 'Значение следа, которое рисуется самым ярким цветом (меньше — ярче)', fmt: v => String(v) },
];

// Parameter sets checked by eye (screenshots); everything not listed returns to the default.
const PRESETS = {
  network: { label: 'Сеть', start: 'random', values: {} },
  threads: { label: 'Нити', start: 'random', values: { sensorAngle: 45, sensorDist: 25, turnAngle: 22.5, decay: 5 } },
  cells: { label: 'Соты', start: 'random', values: { sensorAngle: 60, sensorDist: 12, turnAngle: 60, decay: 15 } },
  lace: { label: 'Кружево', start: 'random', values: { sensorAngle: 10, sensorDist: 5, turnAngle: 70, decay: 20 } },
  cities: { label: 'Города', start: 'random', values: {}, food: 12 },
};

const $ = id => document.getElementById(id);
const params = { start: 'random' };
for (const s of SLIDERS) params[s.key] = s.value;

const mold = new Mold(params, makeRng(1));
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
      if (s.key === 'count') mold.setCount(params.count);
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
  mold.reset(makeRng(+$('seed').value || 1));
}

function applyPreset(name) {
  const pr = PRESETS[name];
  for (const s of SLIDERS) {
    if (s.group === 'run') continue;   // presets change the model, not the count or the view
    setSlider(s.key, pr.values[s.key] ?? s.value);
  }
  params.start = $('start').value = pr.start;
  mold.food.length = 0;
  const rng = makeRng(+$('seed').value || 1);
  for (let k = 0; k < (pr.food || 0); k++) {
    mold.food.push({ x: 40 + rng() * (mold.w - 80), y: 30 + rng() * (mold.h - 60) });
  }
  restart();
}

function randomParams() {
  for (const s of SLIDERS) {
    if (s.group === 'run' || s.key === 'foodStrength') continue;
    const steps = Math.round((s.max - s.min) / s.step);
    setSlider(s.key, +(s.min + Math.floor(Math.random() * (steps + 1)) * s.step).toFixed(2));
  }
}

// ---- canvases ---------------------------------------------------------------------------------
const field = $('field'), overlay = $('overlay');
const fctx = field.getContext('2d'), octx = overlay.getContext('2d');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(field.clientWidth * dpr), h = Math.round(field.clientHeight * dpr);
  for (const c of [field, overlay]) { c.width = w; c.height = h; }
}
new ResizeObserver(resize).observe(field);

overlay.addEventListener('click', e => {
  const r = overlay.getBoundingClientRect();
  mold.toggleFood((e.clientX - r.left) / r.width * mold.w, (e.clientY - r.top) / r.height * mold.h);
});

// ---- buttons --------------------------------------------------------------------------------
function setRunning(on) {
  running = on;
  $('btn-run').textContent = on ? '⏸ Пауза' : '▶ Старт';
}
$('btn-run').onclick = () => setRunning(!running);
$('btn-reset').onclick = restart;
$('btn-random').onclick = randomParams;
$('btn-clear-food').onclick = () => { mold.food.length = 0; };
$('start').onchange = e => { params.start = e.target.value; restart(); };
for (const [name, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.onclick = () => applyPreset(name);
  $('presets').appendChild(b);
}
for (const [key, p] of Object.entries(PALETTES)) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = p.label;
  $('palette').appendChild(o);
}

// ---- pause while off screen ------------------------------------------------------------------
// No canvas in view (the visitor scrolled to the text) - nobody watches, so skip the work and keep the laptop cool.
const onScreen = new Set();
{
  const io = new IntersectionObserver(es => { for (const e of es) (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)); });
  for (const c of document.querySelectorAll('canvas')) io.observe(c);
}

// ---- loop -------------------------------------------------------------------------------------
let fpsFrames = 0, fpsTime = performance.now(), stepMs = 0;
function frame(now) {
  if (!onScreen.size) { fpsTime = now; fpsFrames = 0; requestAnimationFrame(frame); return; }
  if (running) {
    const t = performance.now();
    for (let k = 0; k < params.speedUp; k++) mold.step();
    stepMs = stepMs * 0.9 + (performance.now() - t) / params.speedUp * 0.1;
  }
  drawTrail(fctx, mold, $('palette').value, params.gain);
  drawOverlay(octx, mold, $('show-one').checked);

  fpsFrames++;
  if (now - fpsTime > 500) {
    const fps = fpsFrames * 1000 / (now - fpsTime);
    fpsFrames = 0;
    fpsTime = now;
    $('stats').innerHTML = `FPS <b>${fps.toFixed(0)}</b> · частиц <b>${mold.n.toLocaleString('ru')}</b>`
      + ` · шаг модели <b>${stepMs.toFixed(1)} мс</b> · шагов <b>${mold.steps}</b> · еды <b>${mold.food.length}</b>`;
  }
  requestAnimationFrame(frame);
}

buildSliders();
resize();
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
