// Shepherding page: the field, the dog's rules drawn on top, the "herd it yourself" mode, results and the loop.
// The model is in model.js.

const SLIDERS = [
  { group: 'sheep', key: 'sheep', label: 'Овец', min: 10, max: 150, step: 5, value: 50, restart: true },
  { group: 'sheep', key: 'cohesion', label: 'Сплочённость', min: 0, max: 3, step: 0.05, value: 1.05,
    title: 'Насколько убегающая овца тянется к центру ближайших соседей' },
  { group: 'sheep', key: 'neighbours', label: 'Смотрят на соседей', min: 0.05, max: 1, step: 0.05, value: 0.5,
    fmt: v => Math.round(v * 100) + '% стада', title: 'К скольким ближайшим соседям тянется овца — доля стада' },
  { group: 'sheep', key: 'fear', label: 'Пугливость', min: 10, max: 100, step: 5, value: 65,
    title: 'С какого расстояния овца замечает собаку и убегает (поле 160 × 90, личное пространство овцы — 2)' },
  { group: 'sheep', key: 'noise', label: 'Случайность', min: 0, max: 2, step: 0.05, value: 0.3 },
  { group: 'dog', key: 'dogSpeed', label: 'Скорость собаки', min: 0.5, max: 5, step: 0.1, value: 1.5,
    title: 'Овца бежит со скоростью 1' },
  { group: 'dog', key: 'speed', label: 'Шагов за кадр', min: 0.25, max: 10, step: 0.25, value: 0.5, fmt: v => String(v) },
];

const $ = id => document.getElementById(id);
const params = {};
for (const s of SLIDERS) params[s.key] = s.value;

let herd, running = true, mode = 'algo', cursor = null;
const pennedLog = [], runs = [];

function start() {
  herd = new Herd({ ...params }, makeRng(+$('seed').value || 1));
  pennedLog.length = 0;
  $('result').textContent = '';
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d'), chart = $('chart'), cctx = chart.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chart]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function draw() {
  const s = field.width / FIELD_W, dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b1d14';
  ctx.fillRect(0, 0, field.width, field.height);
  // The pen.
  ctx.fillStyle = 'rgba(62, 230, 176, 0.12)';
  ctx.fillRect(PEN.x * s, PEN.y * s, PEN.w * s, PEN.h * s);
  ctx.strokeStyle = '#3ee6b0';
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(PEN.x * s, PEN.y * s, PEN.w * s, PEN.h * s);
  ctx.fillStyle = '#3ee6b0';
  ctx.font = `${12 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('загон', TARGET.x * s, (PEN.y + PEN.h) * s + 14 * dpr);
  ctx.textAlign = 'left';

  const d = herd.dog, g = herd.centre();
  if ($('show-rules').checked) {
    // "Compact" circle around the flock centre, and where the dog is heading.
    ctx.strokeStyle = 'rgba(220, 239, 231, 0.35)';
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(g.x * s, g.y * s, R_A * Math.pow(herd.n, 2 / 3) * s, 0, Math.PI * 2); ctx.stroke();
    if (d.aim) {
      ctx.strokeStyle = 'rgba(255, 122, 182, 0.6)';
      ctx.beginPath(); ctx.moveTo(d.x * s, d.y * s); ctx.lineTo(d.aim.x * s, d.aim.y * s); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // Sheep: yellow when running from the dog.
  const r = Math.max(2.5 * dpr, 0.9 * s);
  for (const scared of [false, true]) {
    ctx.fillStyle = scared ? '#f5d76e' : '#dcefe7';
    ctx.beginPath();
    for (let i = 0; i < herd.n; i++) {
      if ((Math.hypot(herd.x[i] - d.x, herd.y[i] - d.y) < params.fear) !== scared) continue;
      ctx.moveTo(herd.x[i] * s + r, herd.y[i] * s);
      ctx.arc(herd.x[i] * s, herd.y[i] * s, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // The dog.
  ctx.fillStyle = '#ff7ab6';
  ctx.beginPath(); ctx.arc(d.x * s, d.y * s, r * 1.5, 0, Math.PI * 2); ctx.fill();
  if ($('show-rules').checked) {
    ctx.fillStyle = '#ff7ab6';
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    const label = { collect: 'собираю', drive: 'гоню', manual: 'к курсору' }[d.mode];
    ctx.fillText(label, d.x * s + r * 2, d.y * s - r * 1.5);
  }
}

function drawChart() {
  const w = chart.width, h = chart.height, dpr = window.devicePixelRatio || 1;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.fillStyle = '#040a08';
  cctx.fillRect(0, 0, w, h);
  cctx.fillStyle = '#86a89b';
  cctx.font = `${10 * dpr}px system-ui, sans-serif`;
  cctx.fillText(`0–${herd.n} овец · по шагам`, 4 * dpr, 12 * dpr);
  if (pennedLog.length < 2) return;
  const tMax = Math.max(500, pennedLog.length);
  cctx.strokeStyle = '#3ee6b0';
  cctx.lineWidth = 2 * dpr;
  cctx.beginPath();
  pennedLog.forEach((v, k) => (k ? cctx.lineTo : cctx.moveTo).call(cctx, k / tMax * w, h - 3 * dpr - v / herd.n * (h - 18 * dpr)));
  cctx.stroke();
}

function showRuns() {
  $('runs').innerHTML = runs.map(r => `<tr><td>${r.who}</td><td>${r.n}</td><td>${r.steps}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">пока пусто</td></tr>';
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : (s.step < 1 ? v.toFixed(s.step < 0.1 ? 2 : 1) : String(v));
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => {
    params[s.key] = +input.value;
    out.textContent = fmt(s, +input.value);
    if (!s.restart && s.key !== 'speed') herd.p[s.key] = params[s.key];
  });
  if (s.restart) input.addEventListener('change', start);
  $('group-' + s.group).appendChild(row);
}
$('group-dog').appendChild($('show-rules').closest('label'));
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;
for (const b of document.querySelectorAll('#mode button')) {
  b.onclick = () => {
    mode = b.dataset.mode;
    for (const o of document.querySelectorAll('#mode button')) o.classList.toggle('active', o === b);
    start();
  };
}
const toField = e => { const r = field.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * FIELD_W, y: (e.clientY - r.top) / r.height * FIELD_H }; };
field.addEventListener('pointermove', e => { cursor = toField(e); });
field.addEventListener('pointerdown', e => { cursor = toField(e); });

// ---- loop ------------------------------------------------------------------------------------
let lastStats = 0, acc = 0;
function frame(now) {
  if (running && herd.doneAt < 0) {
    herd.manual = mode === 'manual' ? (cursor || { x: herd.dog.x, y: herd.dog.y }) : null;
    acc += params.speed;   // fractional speeds: a step every few frames
    for (; acc >= 1 && herd.doneAt < 0; acc--) {
      herd.step();
      pennedLog.push(herd.penned());
    }
    if (herd.doneAt >= 0) {
      $('result').textContent = `Все ${herd.n} в загоне за ${herd.doneAt} шагов.`;
      runs.unshift({ who: mode === 'manual' ? 'вы' : 'алгоритм', n: herd.n, steps: herd.doneAt });
      runs.length = Math.min(runs.length, 8);
      showRuns();
    }
  }
  draw();
  drawChart();
  if (now - lastStats > 300) {
    lastStats = now;
    const mtxt = { collect: 'собирает отбившихся', drive: 'гонит стадо', manual: 'бежит к курсору' }[herd.dog.mode];
    $('stats').innerHTML = `шаг <b>${herd.t}</b> · в загоне <b>${herd.penned()}</b> из ${herd.n} · собака <b>${mtxt}</b>`;
  }
  requestAnimationFrame(frame);
}
resize();
showRuns();
start();
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
