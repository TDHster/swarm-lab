// Resonator wall page: the wall seen from the front, the tone levels, sliders, sound, CSV export and the loop.
// The model is in wall.js.

const SLIDERS = [
  { group: 'rule', key: 'rate', label: 'Шаг винта', min: 0.01, max: 0.3, step: 0.01, value: 0.05, fmt: v => v.toFixed(2) + ' окт',
    title: 'На сколько ячейка сдвигает свою частоту за один шаг (в октавах)' },
  { group: 'rule', key: 'noise', label: 'Ошибка микрофона', min: 0, max: 0.5, step: 0.05, value: 0.1, fmt: v => '±' + Math.round(v * 100) + '%' },
  { group: 'cell', key: 'Q', label: 'Добротность Q', min: 2, max: 15, step: 1, value: 6,
    title: 'Насколько узкая полоса поглощения ячейки: больше Q — уже полоса' },
  { group: 'cell', key: 'speed', label: 'Шагов в секунду', min: 1, max: 30, step: 1, value: 4 },
];

const $ = id => document.getElementById(id);
const params = { rule: 'local', on: SOURCES.map(() => true) };
for (const s of SLIDERS) params[s.key] = s.value;

let wall, running = true, hover = -1;
const dbLog = [];

function start() {
  wall = new Wall(params, makeRng(+$('seed').value || 1));
  dbLog.length = 0;
}

const hueOf = f => Math.round(Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN) * 260);
const colorOf = (f, l = 58) => `hsl(${hueOf(f)} 75% ${l}%)`;

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chartS = $('chart-spec'), sctx = chartS.getContext('2d'), chartD = $('chart-db'), dctx = chartD.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chartS, chartD]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function geom() {
  const w = field.width, h = field.height, m = h * 0.06;
  const s = Math.min((w - 2 * m) / WALL_W, (h - 2 * m) / WALL_H);
  return { s, x0: (w - WALL_W * s) / 2, y0: (h - WALL_H * s) / 2 };
}

function draw(now) {
  const dpr = window.devicePixelRatio || 1, { s, x0, y0 } = geom();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, field.width, field.height);
  const cw = WALL_W / COLS * s, ch = WALL_H / ROWS * s;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(9, Math.round(ch * 0.24))}px system-ui, sans-serif`;
  for (let i = 0; i < wall.n; i++) {
    const col = i % COLS, row = Math.floor(i / COLS), f = wall.freq(i);
    const x = x0 + col * cw, y = y0 + (ROWS - 1 - row) * ch;   // row 0 at the floor
    ctx.fillStyle = colorOf(f, 30);
    ctx.fillRect(x + 1.5 * dpr, y + 1.5 * dpr, cw - 3 * dpr, ch - 3 * dpr);
    ctx.strokeStyle = i === hover ? '#ffffff' : colorOf(f);
    ctx.lineWidth = (i === hover ? 2.5 : 1.5) * dpr;
    ctx.strokeRect(x + 1.5 * dpr, y + 1.5 * dpr, cw - 3 * dpr, ch - 3 * dpr);
    // The neck, and the depth label.
    ctx.fillStyle = '#040a08';
    ctx.beginPath(); ctx.arc(x + cw / 2, y + ch * 0.32, Math.min(cw, ch) * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dcefe7';
    ctx.fillText(depthFor(f).toFixed(1), x + cw / 2, y + ch * 0.7);
  }
  // Sources: circles with rings expanding at a pace that hints at their pitch.
  SOURCES.forEach((src, k) => {
    const x = x0 + src.u * s, y = y0 + (WALL_H - src.v) * s, r = Math.max(8 * dpr, s * 0.25 / src.d);
    const on = params.on[k];
    ctx.strokeStyle = colorOf(src.f);
    if (on) {
      const amp = Math.sqrt(wall.E[k] / src.P);   // quieter tone - fainter rings
      for (let q = 0; q < 3; q++) {
        const ph = ((now / 1000) * src.f / 100 + q / 3) % 1;
        ctx.globalAlpha = (1 - ph) * amp;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(x, y, r + ph * s * 0.8, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = on ? colorOf(src.f) : '#3a4a44';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#040a08';
    ctx.font = `bold ${Math.round(r * 0.7)}px system-ui, sans-serif`;
    ctx.fillText(String(src.f), x, y);
    ctx.fillStyle = '#dcefe7';
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.fillText(`${src.name}${on ? '' : ' (выкл.)'}`, x, y + r + 10 * dpr);
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawSpectrum() {
  const c = chartS, cx = sctx, w = c.width, h = c.height, dpr = window.devicePixelRatio || 1;
  const X = f => 8 * dpr + Math.log(f / 70) / Math.log(340 / 70) * (w - 16 * dpr);
  const Y = db => 14 * dpr + Math.min(1, -db / 15) * (h - 34 * dpr);   // 0 dB at the top, -15 dB at the bottom
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = '#040a08';
  cx.fillRect(0, 0, w, h);
  cx.font = `${10 * dpr}px system-ui, sans-serif`;
  cx.fillStyle = '#86a89b';
  cx.fillText('столбик — насколько стена приглушила тон (до −15 дБ)', 4 * dpr, 10 * dpr);
  SOURCES.forEach((src, k) => {
    const x = X(src.f), db = wall.toneDb(k);
    cx.fillStyle = colorOf(src.f);
    if (Number.isFinite(db)) cx.fillRect(x - 9 * dpr, Y(0), 18 * dpr, Y(db) - Y(0));
    cx.fillStyle = '#dcefe7';
    cx.textAlign = 'center';
    cx.fillText(Number.isFinite(db) ? db.toFixed(1) : 'выкл', x, Math.min(h - 22 * dpr, Y(Number.isFinite(db) ? db : 0) + 12 * dpr));
    cx.textAlign = 'left';
  });
  // Where the cells are tuned: small ticks along the bottom.
  for (let i = 0; i < wall.n; i++) {
    const f = wall.freq(i);
    cx.fillStyle = colorOf(f);
    cx.fillRect(X(f) - dpr, h - 12 * dpr, 2 * dpr, 8 * dpr);
  }
  cx.fillStyle = '#86a89b';
  for (const f of [80, 100, 160, 250, 310]) cx.fillText(String(f), X(f) - 8 * dpr, h - 14 * dpr);
}

function drawDb() {
  const w = chartD.width, h = chartD.height, dpr = window.devicePixelRatio || 1;
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.fillStyle = '#040a08';
  dctx.fillRect(0, 0, w, h);
  dctx.fillStyle = '#86a89b';
  dctx.font = `${10 * dpr}px system-ui, sans-serif`;
  dctx.fillText('0 … −12 дБ относительно комнаты без стены', 4 * dpr, 12 * dpr);
  if (dbLog.length < 2) return;
  const n = 400, from = Math.max(0, dbLog.length - n);
  dctx.strokeStyle = '#3ee6b0';
  dctx.lineWidth = 2 * dpr;
  dctx.beginPath();
  for (let k = from; k < dbLog.length; k++) {
    const x = (k - from) / (n - 1) * w, y = 18 * dpr + Math.min(1, -dbLog[k] / 12) * (h - 22 * dpr);
    (k > from ? dctx.lineTo : dctx.moveTo).call(dctx, x, y);
  }
  dctx.stroke();
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : String(v);
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => { params[s.key] = +input.value; out.textContent = fmt(s, +input.value); wall.update(); });
  $('group-' + s.group).appendChild(row);
}
SOURCES.forEach((src, k) => {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox" checked> ${src.name}, ${src.f} Гц`;
  l.querySelector('input').onchange = e => { params.on[k] = e.target.checked; wall.update(); };
  $('srcs').appendChild(l);
});
$('rule').onchange = e => { params.rule = e.target.value; };
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;
$('btn-csv').onclick = () => {
  const lines = ['ряд (снизу);столбец (слева);частота, Гц;глубина коробки, см'];
  for (let i = 0; i < wall.n; i++) lines.push(`${Math.floor(i / COLS) + 1};${i % COLS + 1};${wall.freq(i).toFixed(0)};${depthFor(wall.freq(i)).toFixed(1)}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
  a.download = 'resonator-wall.csv';
  a.click();
};
field.addEventListener('pointermove', e => {
  const r = field.getBoundingClientRect(), dpr = field.width / r.width, { s, x0, y0 } = geom();
  const u = ((e.clientX - r.left) * dpr - x0) / s, v = WALL_H - ((e.clientY - r.top) * dpr - y0) / s;
  hover = u >= 0 && u < WALL_W && v >= 0 && v < WALL_H ? Math.floor(v / WALL_H * ROWS) * COLS + Math.floor(u / WALL_W * COLS) : -1;
});
field.addEventListener('pointerleave', () => { hover = -1; });

// ---- sound: the three hums, each as loud as it is in the room now ---------------------------
let hums = null;
const soundIsOn = soundToggle($('btn-sound'), audio => { hums = SOURCES.map(src => toneVoice(audio, src.f)); });
function updateSound() {
  if (!hums) return;
  const bypass = $('bypass').checked;
  // Sound pressure goes as the square root of the energy.
  SOURCES.forEach((src, k) => hums[k].set(params.on[k] ? 0.4 * Math.sqrt(bypass ? src.P : wall.E[k]) : 0));
}

// ---- pause while off screen ------------------------------------------------------------------
// No canvas in view (the visitor scrolled to the text) - nobody watches, so skip the work and keep the laptop cool.
const onScreen = new Set();
{
  const io = new IntersectionObserver(es => { for (const e of es) (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)); });
  for (const c of document.querySelectorAll('canvas')) io.observe(c);
}

// ---- loop ------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), lastStats = 0;
function frame(now) {
  if (!onScreen.size && !soundIsOn()) { last = now; requestAnimationFrame(frame); return; }   // still listening
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    acc += dt * params.speed;
    for (; acc >= 1; acc--) { wall.step(); dbLog.push(wall.levelDb()); }
  }
  updateSound();
  draw(now);
  drawSpectrum();
  drawDb();
  if (now - lastStats > 250) {
    lastStats = now;
    const c = wall.counts();
    let txt = `шаг <b>${wall.t}</b> (≈ ${(wall.t / 2).toFixed(0)} с) · громкость <b>${wall.levelDb().toFixed(1)} дБ</b> · ячеек на тонах <b>${c.join(' / ')}</b>`;
    if (hover >= 0) txt += ` · ячейка: <b>${wall.freq(hover).toFixed(0)} Гц, глубина ${depthFor(wall.freq(hover)).toFixed(1)} см</b>`;
    $('stats').innerHTML = txt;
  }
  requestAnimationFrame(frame);
}
resize();
start();
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
