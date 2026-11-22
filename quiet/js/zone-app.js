// Quiet zone page: the room with moving waves (or the dB map), charts, sliders, sound and the loop. The model is in zone.js.

const SLIDERS = [
  { group: 'spk', key: 'speakers', label: 'Динамиков', min: 1, max: 12, step: 1, value: 6, rebuild: 'layout' },
  { group: 'spk', key: 'mu', label: 'Шаг подстройки', min: 0.05, max: 1, step: 0.05, value: 0.3, fmt: v => v.toFixed(2) },
  { group: 'spk', key: 'speed', label: 'Шагов за кадр', min: 1, max: 10, step: 1, value: 1 },
  { group: 'room', key: 'f', label: 'Частота гула', min: 30, max: 400, step: 10, value: 100, fmt: v => v + ' Гц', rebuild: 'maps' },
  { group: 'room', key: 'reflect', label: 'Отражение стен ρ', min: 0, max: 0.9, step: 0.1, value: 0.5, fmt: v => v.toFixed(1), rebuild: 'maps' },
];

const $ = id => document.getElementById(id);
const params = { listen: 'own', src: { x: 4.3, y: 3.5 } };
for (const s of SLIDERS) params[s.key] = s.value;

let zone, running = true, field0 = null, total = null, ear = null;   // ear: where we listen (null - at the pillow)
const zoneLog = [];

function start() {
  zone = new Zone(params);
  afterChange();
}
// Recompute the cached complex fields (total, and the hum alone).
function afterChange() {
  const n = zone.nx * zone.ny;
  field0 = zone.maps[0];
  total = new Float64Array(2 * n);
  for (let c = 0; c < n; c++) { const [re, im] = zone.at(c); total[2 * c] = re; total[2 * c + 1] = im; }
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chartD = $('chart-db'), dctx = chartD.getContext('2d'), chartS = $('chart-spk'), sctx = chartS.getContext('2d');
const off = document.createElement('canvas'), octx = off.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chartD, chartS]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function geom() {
  const h = field.height, s = h * 0.94 / ROOM_H;
  return { s, x0: (field.width - ROOM_W * s) / 2, y0: h * 0.03 };
}

function draw(now) {
  const dpr = window.devicePixelRatio || 1, { s, x0, y0 } = geom(), nx = zone.nx, ny = zone.ny;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, field.width, field.height);
  // The field, one pixel per grid cell, then scaled up smoothly.
  if (off.width !== nx) { off.width = nx; off.height = ny; }
  const img = octx.createImageData(nx, ny), d = img.data;
  // Brightness scale: the hum's amplitude at the pillow.
  const hc = Math.floor(HEAD.y / GRID) * nx + Math.floor(HEAD.x / GRID);
  const ref = Math.hypot(field0[2 * hc], field0[2 * hc + 1]) * 1.5;
  const ph = now / 1000 * 2 * Math.PI * 0.8, cs = Math.cos(ph), sn = Math.sin(ph), wave = $('view').value === 'wave';
  for (let c = 0; c < nx * ny; c++) {
    const re = total[2 * c], im = total[2 * c + 1];
    let r, g, b;
    if (wave) {
      const v = Math.tanh((re * cs - im * sn) / ref);   // instantaneous pressure
      if (v > 0) { r = 40 + 215 * v; g = 20 + 102 * v; b = 30 + 152 * v; } else { r = 10; g = 30 - 200 * v; b = 40 - 200 * v; }
    } else {
      const db = 10 * Math.log10((re * re + im * im) / (field0[2 * c] ** 2 + field0[2 * c + 1] ** 2));
      const t = Math.max(-1, Math.min(1, db / 20));
      if (t < 0) { r = 15; g = 40 - 30 * t; b = 60 - 180 * t; } else { r = 60 + 190 * t; g = 30; b = 30; }
    }
    d[4 * c] = r; d[4 * c + 1] = g; d[4 * c + 2] = b; d[4 * c + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, x0, y0, ROOM_W * s, ROOM_H * s);
  ctx.strokeStyle = '#86a89b';
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(x0, y0, ROOM_W * s, ROOM_H * s);
  // Bed, quiet zone, speakers, microphones, the hum.
  ctx.strokeStyle = 'rgba(220, 239, 231, 0.5)';
  ctx.lineWidth = dpr;
  ctx.strokeRect(x0 + (HEAD.x - 0.8) * s, y0 + 0.1 * s, 1.6 * s, 2.1 * s);
  ctx.setLineDash([5 * dpr, 4 * dpr]);
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x0 + HEAD.x * s, y0 + HEAD.y * s, ZONE_R * s, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  zone.spk.forEach((p, j) => {
    const a = Math.hypot(...zone.q[j]);
    ctx.fillStyle = '#3ee6b0';
    const r = 5 * dpr + Math.min(10 * dpr, a * 40 * dpr);
    ctx.fillRect(x0 + p.x * s - r / 2, y0 + p.y * s - r / 2, r, r);
    ctx.fillStyle = '#ff7ab6';
    ctx.beginPath(); ctx.arc(x0 + zone.mic[j].x * s, y0 + zone.mic[j].y * s, 3 * dpr, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#f5d76e';
  ctx.beginPath(); ctx.arc(x0 + params.src.x * s, y0 + params.src.y * s, 9 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#dcefe7';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText('гул', x0 + params.src.x * s + 12 * dpr, y0 + params.src.y * s + 4 * dpr);
  ctx.fillText('кровать', x0 + (HEAD.x - 0.75) * s, y0 + 2.1 * s);
  ctx.fillText('комната 5 × 4 м', x0 + 6 * dpr, y0 + ROOM_H * s - 6 * dpr);
  if (hum && ear) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(x0 + ear.x * s, y0 + ear.y * s, 7 * dpr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText('ухо', x0 + ear.x * s + 10 * dpr, y0 + ear.y * s - 8 * dpr);
  }
}

function drawCharts() {
  const dpr = window.devicePixelRatio || 1;
  let w = chartD.width, h = chartD.height;
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.fillStyle = '#040a08';
  dctx.fillRect(0, 0, w, h);
  dctx.fillStyle = '#86a89b';
  dctx.font = `${10 * dpr}px system-ui, sans-serif`;
  dctx.fillText('+10 … −25 дБ (0 — без динамиков)', 4 * dpr, 12 * dpr);
  const Y = v => 16 * dpr + (10 - Math.max(-25, Math.min(10, v))) / 35 * (h - 20 * dpr);
  dctx.strokeStyle = '#1f3a32';
  dctx.beginPath(); dctx.moveTo(0, Y(0)); dctx.lineTo(w, Y(0)); dctx.stroke();
  if (zoneLog.length > 1) {
    const n = 600, from = Math.max(0, zoneLog.length - n);
    dctx.strokeStyle = '#3ee6b0';
    dctx.lineWidth = 2 * dpr;
    dctx.beginPath();
    for (let k = from; k < zoneLog.length; k++) (k > from ? dctx.lineTo : dctx.moveTo).call(dctx, (k - from) / (n - 1) * w, Y(zoneLog[k]));
    dctx.stroke();
  }
  w = chartS.width; h = chartS.height;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.fillStyle = '#040a08';
  sctx.fillRect(0, 0, w, h);
  const amps = zone.q.map(q => Math.hypot(...q)), max = Math.max(0.05, ...amps), bw = w / amps.length;
  sctx.fillStyle = '#3ee6b0';
  amps.forEach((a, j) => { const bh = Math.min(1, a / max) * (h - 20 * dpr); sctx.fillRect(j * bw + 3 * dpr, h - 4 * dpr - bh, bw - 6 * dpr, bh); });
  sctx.fillStyle = '#86a89b';
  sctx.font = `${10 * dpr}px system-ui, sans-serif`;
  sctx.fillText('слева направо — по дуге вокруг подушки', 4 * dpr, 12 * dpr);
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : String(v);
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => { params[s.key] = +input.value; out.textContent = fmt(s, +input.value); });
  if (s.rebuild === 'layout') input.addEventListener('change', () => { zone.layout(); zoneLog.length = 0; afterChange(); });
  if (s.rebuild === 'maps') input.addEventListener('change', () => { zone.rebuild(); afterChange(); });
  $('group-' + s.group).appendChild(row);
}
$('listen').onchange = e => { params.listen = e.target.value; };
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = () => { zone.q = zone.spk.map(() => [0, 0]); zoneLog.length = 0; afterChange(); };
const toRoom = e => {
  const r = field.getBoundingClientRect(), dpr = field.width / r.width, { s, x0, y0 } = geom();
  return { x: ((e.clientX - r.left) * dpr - x0) / s, y: ((e.clientY - r.top) * dpr - y0) / s };
};
field.addEventListener('pointerdown', e => {
  const { x, y } = toRoom(e);
  if (x < 0.1 || x > ROOM_W - 0.1 || y < 0.1 || y > ROOM_H - 0.1) return;
  params.src = { x, y };
  zone.rebuild();
  afterChange();
});

// The ear follows the mouse over the room; off the room (and on phones) it is back at the pillow.
field.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const p = toRoom(e);
  ear = p.x > 0 && p.x < ROOM_W && p.y > 0 && p.y < ROOM_H ? p : null;
});
field.addEventListener('pointerleave', () => { ear = null; });

// ---- sound: the hum at the ear, as loud as the model says ------------------------------------
let hum = null;
soundToggle($('btn-sound'), audio => { hum = toneVoice(audio, params.f); });
function updateSound() {
  if (!hum) return;
  const p = ear || HEAD, c = Math.min(zone.ny - 1, Math.floor(p.y / GRID)) * zone.nx + Math.min(zone.nx - 1, Math.floor(p.x / GRID));
  const hc = Math.floor(HEAD.y / GRID) * zone.nx + Math.floor(HEAD.x / GRID);
  const ref = Math.hypot(field0[2 * hc], field0[2 * hc + 1]);   // gain 0.3 = the hum alone at the pillow
  const amp = $('bypass').checked ? Math.hypot(field0[2 * c], field0[2 * c + 1]) : Math.hypot(total[2 * c], total[2 * c + 1]);
  hum.set(Number.isFinite(amp) ? 0.3 * Math.min(3, amp / ref) : 0.9, params.f);
}

// ---- loop ------------------------------------------------------------------------------------
let lastStats = 0;
function frame(now) {
  if (running) {
    for (let k = 0; k < params.speed; k++) zone.step();
    afterChange();
    const rep = zone.report();
    zoneLog.push(Number.isFinite(rep.zone) ? rep.zone : 99);
    if (zoneLog.length > 2000) zoneLog.shift();
  }
  updateSound();
  draw(now);
  drawCharts();
  if (now - lastStats > 300) {
    lastStats = now;
    const rep = zone.report(), blown = !Number.isFinite(rep.zone) || rep.zone > 40;
    $('stats').innerHTML = blown
      ? '<b style="color:#ff7ab6">разнос: динамики раскачивают друг друга — уменьши шаг и нажми «Выключить динамики»</b>'
      : `у подушки <b>${rep.zone >= 0 ? '+' : ''}${rep.zone.toFixed(1)} дБ</b> · в среднем по комнате <b>${rep.room >= 0 ? '+' : ''}${rep.room.toFixed(1)} дБ</b>`
        + ` · длина волны <b>${(343 / params.f).toFixed(1)} м</b>`;
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
