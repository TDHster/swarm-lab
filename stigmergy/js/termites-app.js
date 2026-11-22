// Termites page: two modes (chips / builders), drawing, sliders and the loop. Models are in termites.js.

const MODES = {
  chips: {
    label: 'Кучи щепок',
    sliders: [
      { key: 'count', label: 'Термитов', min: 20, max: 1000, step: 20, value: 300, restart: true },
      { key: 'density', label: 'Щепок на старте', min: 0.05, max: 0.4, step: 0.01, value: 0.15, restart: true, fmt: v => Math.round(v * 100) + '%' },
    ],
  },
  builders: {
    label: 'Столбы и камера',
    sliders: [
      { key: 'count', label: 'Термитов', min: 20, max: 1000, step: 20, value: 300, restart: true },
      { key: 'follow', label: 'Идти на запах', min: 0, max: 1, step: 0.05, value: 0.5,
        title: 'Вероятность шагнуть туда, где сильнее пахнет свежей кладкой (иначе — случайный шаг)' },
      { key: 'sensitivity', label: 'Порог запаха', min: 0.5, max: 10, step: 0.5, value: 3,
        title: 'При таком запахе комочек роняют с вероятностью 1/2 за шаг' },
      { key: 'evaporation', label: 'Выветривание', min: 0.005, max: 0.1, step: 0.005, value: 0.02, fmt: v => (v * 100).toFixed(1) + '%/шаг' },
      { key: 'diffusion', label: 'Расплывание', min: 0.05, max: 1, step: 0.05, value: 0.3 },
      { key: 'chamber', label: 'Радиус камеры', min: 8, max: 30, step: 1, value: 18, fmt: v => v + ' кл' },
    ],
  },
};

const $ = id => document.getElementById(id);
let mode = 'chips', model, running = true, speedUp = 5;
const params = { chips: {}, builders: { queen: false } };
for (const [m, d] of Object.entries(MODES)) for (const s of d.sliders) params[m][s.key] = s.value;

function start() {
  model = mode === 'chips' ? new Chips(params.chips, makeRng(Date.now() % 1e9)) : new Builders(params.builders, makeRng(Date.now() % 1e9));
  counts.length = 0;
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const img = document.createElement('canvas');
img.width = TERM_W; img.height = TERM_H;
const ictx = img.getContext('2d'), data = ictx.createImageData(TERM_W, TERM_H);
const SOIL = [32, 26, 20], CHIP = [214, 170, 92], CLAY = [236, 214, 170];

function draw() {
  const d = data.data, n = TERM_W * TERM_H, showSmell = $('show-smell').checked;
  let top = 1;
  if (mode === 'builders') for (let k = 0; k < n; k++) if (model.height[k] > top) top = model.height[k];
  for (let k = 0; k < n; k++) {
    let c;
    if (mode === 'chips') c = model.chip[k] ? CHIP : SOIL;
    else {
      // sqrt: low walls stay visible next to tall pillars
      const t = Math.sqrt(model.height[k] / top);
      c = [0, 1, 2].map(q => SOIL[q] + (CLAY[q] - SOIL[q]) * t);
      if (showSmell) { const s = Math.min(1, model.smell[k] / 6); c = [c[0] + 200 * s, c[1] + 40 * s, c[2] + 120 * s]; }
    }
    d[k * 4] = c[0]; d[k * 4 + 1] = c[1]; d[k * 4 + 2] = c[2]; d[k * 4 + 3] = 255;
  }
  ictx.putImageData(data, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, field.width, field.height);
  const s = field.width / TERM_W;
  for (const carrying of [0, 1]) {
    ctx.fillStyle = mode === 'chips' ? (carrying ? '#ff7ab6' : '#3ee6b0') : '#3ee6b0';
    ctx.beginPath();
    for (let i = 0; i < model.n; i++) {
      if (mode === 'chips' && model.carry[i] !== carrying) continue;
      if (mode === 'builders' && carrying) continue;
      ctx.rect(model.tx[i] * s + s * 0.25, model.ty[i] * s + s * 0.25, s * 0.5, s * 0.5);
    }
    ctx.fill();
  }
  if (mode === 'builders' && model.p.queen) {
    const cx = TERM_W / 2 * s, cy = TERM_H / 2 * s;
    ctx.strokeStyle = 'rgba(255, 122, 182, 0.6)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, model.p.chamber * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff7ab6';
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 2.2, s * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

const chart = $('chart'), cctx = chart.getContext('2d');
const counts = [];
function drawChart() {
  const w = chart.width, h = chart.height, dpr = window.devicePixelRatio || 1;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.fillStyle = '#040a08';
  cctx.fillRect(0, 0, w, h);
  if (counts.length < 2) return;
  const top = Math.max(...counts.map(r => r[1])) * 1.05 || 1;
  cctx.strokeStyle = '#f5d76e';
  cctx.lineWidth = 2 * dpr;
  cctx.beginPath();
  counts.forEach(([t, v], k) => {
    const x = t / counts[counts.length - 1][0] * w, y = h - 3 * dpr - v / top * (h - 18 * dpr);
    if (k) cctx.lineTo(x, y); else cctx.moveTo(x, y);
  });
  cctx.stroke();
  cctx.fillStyle = '#86a89b';
  cctx.font = `${10 * dpr}px system-ui, sans-serif`;
  cctx.fillText(mode === 'chips' ? `число куч (сверху ${Math.round(top)})` : `число столбов (сверху ${Math.round(top)})`, 4 * dpr, 12 * dpr);
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  field.width = Math.round(field.clientWidth * dpr);
  field.height = Math.round(field.clientHeight * dpr);
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
}
new ResizeObserver(resize).observe(field);

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : (s.step < 1 ? v.toFixed(s.step < 0.1 ? 3 : 2) : String(v));
function buildSliders() {
  $('group-model').querySelectorAll('.slider.dyn').forEach(el => el.remove());
  for (const s of MODES[mode].sliders) {
    const row = document.createElement('label');
    row.className = 'slider dyn';
    if (s.title) row.title = s.title;
    const v = params[mode][s.key];
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}"><output>${fmt(s, v)}</output>`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.addEventListener('input', () => { params[mode][s.key] = +input.value; out.textContent = fmt(s, +input.value); });
    if (s.restart) input.addEventListener('change', start);
    $('group-model').appendChild(row);
  }
  $('queen-row').style.display = mode === 'builders' ? '' : 'none';
  $('smell-row').style.display = mode === 'builders' ? '' : 'none';
  for (const el of document.querySelectorAll('[data-hint]')) el.hidden = el.dataset.hint !== mode;
}
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('active', b.dataset.key === m);
  buildSliders();
  start();
}
for (const [key, d] of Object.entries(MODES)) {
  const b = document.createElement('button');
  b.textContent = d.label;
  b.dataset.key = key;
  b.onclick = () => setMode(key);
  $('modes').appendChild(b);
}
$('queen').onchange = e => { params.builders.queen = e.target.checked; start(); };
$('speed').oninput = e => { speedUp = +e.target.value; $('speed-out').textContent = speedUp; };
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;

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
  if (running) for (let k = 0; k < speedUp; k++) model.step();
  draw();
  if (now - lastStats > 500) {
    lastStats = now;
    if (mode === 'chips') {
      const p = model.piles();
      counts.push([model.steps, p.piles]);
      $('stats').innerHTML = `шагов <b>${model.steps}</b> · куч <b>${p.piles}</b> · самая большая <b>${p.biggest}</b> щепок · всего щепок <b>${p.chips}</b> (не меняется)`;
    } else {
      const p = model.pillars();
      counts.push([model.steps, p.pillars]);
      $('stats').innerHTML = `шагов <b>${model.steps}</b> · уложено комочков <b>${model.placed}</b> · столбов <b>${p.pillars}</b>`
        + ` · среднее расстояние до соседнего <b>${p.spacing.toFixed(1)} кл</b>` + (model.p.queen ? ` · на стене камеры <b>${(model.ringShare() * 100).toFixed(0)}%</b> глины` : '');
    }
    drawChart();
  }
  requestAnimationFrame(frame);
}
resize();
setMode('chips');
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
