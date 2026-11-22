// Trails page: drawing, sliders, brushes and the loop. The model is in trails.js.

const SLIDERS = [
  { key: 'attraction', label: 'Тяга к тропе λ', min: 0, max: 30, step: 1, value: 8,
    title: '0 — каждый идёт строго по прямой к цели; больше — охотнее сворачивает на заметную тропу' },
  { key: 'visibility', label: 'Видимость тропы', min: 2, max: 20, step: 1, value: 6, fmt: v => (v * 0.5).toFixed(1) + ' м',
    title: 'С какого расстояния тропа «притягивает»' },
  { key: 'durability', label: 'Живучесть тропы', min: 500, max: 20000, step: 500, value: 4000,
    fmt: v => (v / 1000).toFixed(1) + 'k шагов', title: 'За сколько шагов модели тропа без пешеходов заметно зарастает' },
  { key: 'trample', label: 'Вытаптывание', min: 0.01, max: 0.3, step: 0.01, value: 0.08,
    title: 'Насколько один шаг портит траву' },
  { key: 'spawnEvery', label: 'Новый пешеход раз в', min: 1, max: 20, step: 1, value: 2, fmt: v => v + ' шаг.' },
  { key: 'speedUp', label: 'Шагов за кадр', min: 1, max: 40, step: 1, value: 10 },
];
const PRESETS = [
  { key: 'four', label: 'Четыре угла' },
  { key: 'three', label: 'Три входа' },
  { key: 'six', label: 'Шесть входов' },
  { key: 'plaza', label: 'Газон с дорожками по краю' },
];

const $ = id => document.getElementById(id);
const params = { noise: 0.15 };
for (const s of SLIDERS) params[s.key] = s.value;
const park = new Park(params, makeRng(1));
let running = true;

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const img = document.createElement('canvas');
img.width = park.w; img.height = park.h;
const ictx = img.getContext('2d'), data = ictx.createImageData(park.w, park.h);
const GRASS = [46, 110, 60], SOIL = [196, 164, 112], PAVE = [150, 156, 160];

function draw() {
  const d = data.data;
  for (let k = 0; k < park.G.length; k++) {
    const c = park.paved[k] ? PAVE : null, g = Math.min(1, park.G[k]);
    for (let q = 0; q < 3; q++) d[k * 4 + q] = c ? c[q] : GRASS[q] + (SOIL[q] - GRASS[q]) * g;
    d[k * 4 + 3] = 255;
  }
  ictx.putImageData(data, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;   // keep cells crisp: trails are a few cells wide
  ctx.drawImage(img, 0, 0, field.width, field.height);
  const s = field.width / park.w;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < park.n; i++) { ctx.moveTo(park.x[i] * s + 2, park.y[i] * s); ctx.arc(park.x[i] * s, park.y[i] * s, Math.max(1.5, s * 0.6), 0, Math.PI * 2); }
  ctx.fill();
  for (const e of park.entrances) {
    ctx.fillStyle = '#ff7ab6';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x * s, e.y * s, Math.max(6, s * 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (drag && drag.tool === 'pave') {
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(drag.x0 * s, drag.y0 * s);
    ctx.lineTo(drag.x1 * s, drag.y1 * s);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  field.width = Math.round(field.clientWidth * dpr);
  field.height = Math.round(field.clientHeight * dpr);
}
new ResizeObserver(resize).observe(field);

// ---- brushes ---------------------------------------------------------------------------------
let drag = null;
function toCell(e) {
  const r = field.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * park.w, y: (e.clientY - r.top) / r.height * park.h };
}
field.addEventListener('pointerdown', e => {
  const p = toCell(e), tool = $('tool').value;
  try { field.setPointerCapture(e.pointerId); } catch { /* synthetic events in tests */ }
  if (tool === 'entrance') {
    const hit = park.entrances.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < 4);
    if (hit >= 0) park.entrances.splice(hit, 1); else park.entrances.push({ x: p.x, y: p.y });
    return;
  }
  drag = { tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  if (tool === 'unpave') unpaveAt(p);
});
field.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = toCell(e);
  drag.x1 = p.x; drag.y1 = p.y;
  if (drag.tool === 'unpave') unpaveAt(p);
});
field.addEventListener('pointerup', () => {
  if (drag && drag.tool === 'pave' && Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) > 1) park.pave(drag.x0, drag.y0, drag.x1, drag.y1);
  drag = null;
});
function unpaveAt(p) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) park.setPaved(Math.round(p.x) + dx, Math.round(p.y) + dy, 0);
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : (s.step < 1 ? v.toFixed(2) : String(v));
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => { params[s.key] = +input.value; out.textContent = fmt(s, +input.value); });
  $(s.key === 'speedUp' || s.key === 'spawnEvery' ? 'group-run' : 'group-model').appendChild(row);
}
function loadPreset(key) {
  park.loadPreset(key);
  for (const b of document.querySelectorAll('#presets button')) b.classList.toggle('active', b.dataset.key === key);
}
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.dataset.key = p.key;
  b.onclick = () => loadPreset(p.key);
  $('presets').appendChild(b);
}
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
// Every restart is a new random history: trails depend on who happened to walk first.
$('btn-reset').onclick = () => park.reset(makeRng(Date.now() % 1e9));

// ---- pause while off screen ------------------------------------------------------------------
// No canvas in view (the visitor scrolled to the text) - nobody watches, so skip the work and keep the laptop cool.
const onScreen = new Set();
{
  const io = new IntersectionObserver(es => { for (const e of es) (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)); });
  for (const c of document.querySelectorAll('canvas')) io.observe(c);
}

// ---- loop ------------------------------------------------------------------------------------
let lastStats = 0;
function frame(now) {
  if (!onScreen.size) { requestAnimationFrame(frame); return; }
  if (running) for (let k = 0; k < params.speedUp; k++) park.step();
  draw();
  if (now - lastStats > 500) {
    lastStats = now;
    $('stats').innerHTML = `шагов <b>${park.steps}</b> · пешеходов <b>${park.n}</b> · дошли <b>${park.arrived}</b>`
      + ` · вытоптано <b>${park.trailArea().toFixed(0)} м²</b> · путь длиннее прямого на <b>${((park.meanDetour() - 1) * 100).toFixed(0)}%</b>`;
  }
  requestAnimationFrame(frame);
}
resize();
loadPreset('four');
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
