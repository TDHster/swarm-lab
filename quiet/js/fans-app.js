// Server fans page: the rack with spinning fans, the tone axis (or the phase arrows), charts, sound (WebAudio) and the loop.
// The model is in fans.js.

const SLIDERS = [
  { group: 'rack', key: 'fans', label: 'Вентиляторов', min: 2, max: 16, step: 1, value: 8, restart: true },
  { group: 'rack', key: 'speed', label: 'Шагов в секунду', min: 1, max: 20, step: 1, value: 2,
    title: 'Один шаг — полсекунды реального времени: 2 — как в жизни' },
  { group: 'rule', key: 'thrift', label: 'Цена энергии', min: 0, max: 0.5, step: 0.01, value: 0.05, fmt: v => v.toFixed(2),
    title: 'Насколько вентилятору «жалко» лишних оборотов. 0 — только тишина, любой ценой' },
  { group: 'rule', key: 'step', label: 'Шаг оборотов', min: 5, max: 60, step: 5, value: 20, fmt: v => v + ' об/мин' },
  { group: 'rule', key: 'hear', label: 'Слух микрофона', min: 0.5, max: 5, step: 0.5, value: 1.5, fmt: v => v + ' места',
    title: 'На каком расстоянии (в местах стойки) микрофон слышит соседа вполовину громкости' },
  { group: 'sync', key: 'eta', label: 'Шаг фазы η', min: 0.1, max: 1, step: 0.05, value: 0.3, fmt: v => v.toFixed(2),
    title: 'Какую часть пути к лучшей фазе вентилятор проходит за один шаг' },
  { group: 'sync', key: 'share', label: 'Подстраиваются за раз', min: 0.1, max: 1, step: 0.1, value: 0.5, fmt: v => Math.round(v * 100) + '%',
    title: 'Какая доля вентиляторов меняет фазу на каждом шаге (кто именно — наугад)' },
  { group: 'sync', key: 'jitter', label: 'Дрожание фазы', min: 0, max: 0.4, step: 0.02, value: 0.02, fmt: v => v.toFixed(2) + ' рад',
    title: 'Насколько неточно регулятор держит фазу лопастей' },
];

const $ = id => document.getElementById(id);
const params = { mode: 'plain', cols: 2 };
for (const s of SLIDERS) params[s.key] = s.value;

let rack, running = true, angles = [], syncAngle = 0;
const aLog = [], pLog = [], dLog = [];   // throbbing pairs, power %, blade tone in the room (dB)
const isSync = () => params.mode === 'sync';

function start() {
  rack = new Rack({ ...params }, makeRng(+$('seed').value || 1));
  rack.p = params;
  rack.setMode(params.mode);
  angles = new Array(rack.n).fill(0);
  aLog.length = pLog.length = dLog.length = 0;
  buildSound();
}

const F_LO = BLADES * RPM_MIN / 60, F_HI = BLADES * RPM_MAX / 60;
const colorOf = (f, l = 60) => `hsl(${Math.round((f - F_LO) / (F_HI - F_LO) * 260)} 75% ${l}%)`;
const pairs = () => { const out = []; for (let i = 0; i < rack.n; i++) for (let j = i + 1; j < rack.n; j++) out.push([i, j]); return out; };

// ---- sound: every fan's blade tone, plus the air ----------------------------------------------
// In 'sync' mode all fans play one frequency with fixed phases, so they are heard as one tone (sumVoice)
// whose loudness follows the power they radiate; independent oscillators would mix with random phases instead.
let audio = null, voices = [], sumVoice = null, air = null;
function buildSound() {
  if (!audio) return;
  for (const v of voices) v.stop();
  // Blade-pass tone with a couple of overtones: closer to a real fan than a pure sine, and the beating stays.
  voices = Array.from({ length: rack.n }, (_, i) => toneVoice(audio, rack.freq(i), [1, 0.35, 0.15]));
  if (!sumVoice) sumVoice = toneVoice(audio, BLADES * RPM_NOMINAL / 60, [1, 0.35, 0.15]);
  // The air rush has AIR times the power of all the tones, as in the model. 4 makes up for the band-pass filter,
  // which keeps a small part of white noise (measured at the output: without it the air was 24.6 dB below the tones).
  air.g.gain.value = 4 * Math.sqrt(AIR) * 0.6 / Math.sqrt(rack.n);
}
function updateSound() {
  if (!audio) return;
  const sync = isSync(), solo = 0.6 / rack.n;   // n independent tones of `solo` add up to solo·√n
  voices.forEach((v, i) => v.set(sync ? 0 : solo, rack.freq(i)));
  sumVoice.set(sync ? solo * Math.sqrt(rack.n) * Math.pow(10, rack.toneDb() / 20) : 0);
}
const soundIsOn = soundToggle($('btn-sound'), a => {
  audio = a;
  air = noiseVoice(audio, 900, 0.7, 0);   // the rush of air: steady, it does not beat
  buildSound();
});

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chartA = $('chart-a'), actx = chartA.getContext('2d'), chartP = $('chart-p'), pctx = chartP.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chartA, chartP]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function draw(now, dt) {
  const w = field.width, h = field.height, dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  // The rack: 2 columns of fans.
  const rows = Math.ceil(rack.n / params.cols), cell = Math.min(h * 0.9 / rows, w * 0.36 / params.cols);
  const rx = w * 0.04, ry = (h - rows * cell) / 2, R = cell * 0.36;
  const pos = i => ({ x: rx + (rack.x[i] + 0.5) * cell, y: ry + (rack.y[i] + 0.5) * cell });
  ctx.fillStyle = '#0f1f1a';
  ctx.fillRect(rx - 6 * dpr, ry - 6 * dpr, params.cols * cell + 12 * dpr, rows * cell + 12 * dpr);
  // Pairs that cancel each other (sync): a teal line, the stronger the cancelling the brighter.
  if (isSync()) for (const [i, j] of pairs()) {
    const c = -rack.S[i][j] * Math.cos(rack.phase[i] - rack.phase[j]);
    if (c < 0.3) continue;
    ctx.strokeStyle = `rgba(62, 230, 176, ${Math.min(0.9, c).toFixed(2)})`;
    ctx.lineWidth = 3 * dpr;
    const p = pos(i), q = pos(j);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  // Throbbing pairs: a pink line that blinks at the beat rate.
  for (const [i, j] of pairs()) {
    const d = Math.abs(rack.freq(i) - rack.freq(j)), a = annoy(d);
    if (a < 0.3) continue;
    const blink = 0.5 + 0.5 * Math.cos(2 * Math.PI * d * now / 1000);
    ctx.strokeStyle = `rgba(255, 122, 182, ${(a * blink * 0.8).toFixed(2)})`;
    ctx.lineWidth = 3 * dpr;
    const p = pos(i), q = pos(j);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  for (let i = 0; i < rack.n; i++) {
    const { x, y } = pos(i), f = rack.freq(i);
    angles[i] += rack.rpm(i) / 60 / 40 * 2 * Math.PI * dt;   // drawn 40 times slower than real
    // Locked to the clock: the blades differ only by the phase (a tone phase φ is a turn by φ / blades).
    if (isSync()) angles[i] = syncAngle + rack.phase[i] / BLADES;
    ctx.fillStyle = '#08130f';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = colorOf(f);
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.fillStyle = colorOf(f, 45);
    for (let b = 0; b < BLADES; b++) {
      const a = angles[i] + b * 2 * Math.PI / BLADES;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, R * 0.85, a, a + 0.45);
      ctx.closePath();
      ctx.fill();
    }
    if (isSync()) {   // the phase arrow, as on the phase diagram on the right
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(rack.phase[i]) * R * 0.6, y - Math.sin(rack.phase[i]) * R * 0.6); ctx.stroke();
    }
    ctx.fillStyle = '#dcefe7';
    ctx.font = `${Math.max(9, Math.round(R * 0.32))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(rack.rpm(i))), x, y + R + Math.max(9, R * 0.32));
    ctx.textAlign = 'left';
  }
  if (isSync()) { drawPhasors(w * 0.42, w * 0.97, h, dpr); return; }
  // The tone axis.
  const ax0 = w * 0.42, ax1 = w * 0.97, ay = h * 0.62;
  const X = f => ax0 + (f - F_LO) / (F_HI - F_LO) * (ax1 - ax0);
  ctx.strokeStyle = '#86a89b';
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(ax0, ay); ctx.lineTo(ax1, ay); ctx.stroke();
  ctx.fillStyle = '#86a89b';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  for (let f = 300; f <= 480; f += 30) { ctx.fillText(String(f), X(f) - 10 * dpr, ay + 16 * dpr); ctx.fillRect(X(f), ay - 3 * dpr, dpr, 6 * dpr); }
  ctx.fillText('тон, Гц', ax1 - 40 * dpr, ay + 32 * dpr);
  ctx.fillText(`номинал ${(BLADES * RPM_NOMINAL / 60).toFixed(0)} Гц`, X(350) - 30 * dpr, ay - h * 0.42);
  ctx.setLineDash([3 * dpr, 3 * dpr]);
  ctx.beginPath(); ctx.moveTo(X(350), ay - h * 0.4); ctx.lineTo(X(350), ay); ctx.stroke();
  ctx.setLineDash([]);
  // Arcs between throbbing pairs on the axis, then the fans as dots.
  for (const [i, j] of pairs()) {
    const d = Math.abs(rack.freq(i) - rack.freq(j)), a = annoy(d);
    if (a < 0.3) continue;
    const x1 = X(rack.freq(i)), x2 = X(rack.freq(j)), mid = (x1 + x2) / 2, rr = Math.max(6 * dpr, Math.abs(x2 - x1) / 2);
    ctx.strokeStyle = `rgba(255, 122, 182, ${a.toFixed(2)})`;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(mid, ay - 8 * dpr, rr, Math.PI, 0); ctx.stroke();
  }
  for (let i = 0; i < rack.n; i++) {
    const f = rack.freq(i);
    ctx.fillStyle = colorOf(f);
    ctx.beginPath(); ctx.arc(X(f), ay - 8 * dpr - (i % 4) * 7 * dpr, 5 * dpr, 0, Math.PI * 2); ctx.fill();
  }
}

// Sync mode: the tones of all fans as arrows laid head to tail (what a person in front of the rack hears is their sum).
// The pink arrow is the sum: the closer the chain ends to where it started, the quieter the tone.
function drawPhasors(x0, x1, h, dpr) {
  const ph = rack.phase, n = rack.n;
  let re = 0, im = 0, reach = 1;
  for (let i = 0; i < n; i++) { re += Math.cos(ph[i]); im += Math.sin(ph[i]); reach = Math.max(reach, Math.hypot(re, im)); }
  const size = Math.min(x1 - x0, h * 0.8), L = size * 0.42 / reach, ox = (x0 + x1) / 2, oy = h * 0.52;
  ctx.strokeStyle = '#1f3a32';
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.arc(ox, oy, L, 0, Math.PI * 2); ctx.stroke();   // one fan's tone
  let x = ox, y = oy;
  for (let i = 0; i < n; i++) {
    const nx = x + Math.cos(ph[i]) * L, ny = y - Math.sin(ph[i]) * L;
    ctx.strokeStyle = colorOf(rack.freq(i));
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
    ctx.fillStyle = colorOf(rack.freq(i));
    ctx.beginPath(); ctx.arc(nx, ny, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
    x = nx; y = ny;
  }
  ctx.strokeStyle = '#ff7ab6';
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = '#ff7ab6';
  ctx.beginPath(); ctx.arc(ox, oy, 4 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#86a89b';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ['фазы тонов: стрелки подряд', 'розовая — их сумма', 'круг — один вентилятор']
    .forEach((t, k) => ctx.fillText(t, x0, h * 0.06 + k * 14 * dpr));
}

function drawChart(c, cx, data, max, color, label, line) {
  const w = c.width, h = c.height, dpr = window.devicePixelRatio || 1, n = 600;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = '#040a08';
  cx.fillRect(0, 0, w, h);
  cx.fillStyle = '#86a89b';
  cx.font = `${10 * dpr}px system-ui, sans-serif`;
  cx.fillText(label, 4 * dpr, 12 * dpr);
  const Y = v => h - 3 * dpr - Math.min(1, v / max) * (h - 18 * dpr);
  if (line !== undefined) {
    cx.strokeStyle = '#1f3a32';
    cx.beginPath(); cx.moveTo(0, Y(line)); cx.lineTo(w, Y(line)); cx.stroke();
  }
  const from = Math.max(0, data.length - n);
  if (data.length - from < 2) return;
  cx.strokeStyle = color;
  cx.lineWidth = 2 * dpr;
  cx.beginPath();
  for (let k = from; k < data.length; k++) (k > from ? cx.lineTo : cx.moveTo).call(cx, (k - from) / (n - 1) * w, Y(data[k]));
  cx.stroke();
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : String(v);
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => { params[s.key] = +input.value; out.textContent = fmt(s, +input.value); });
  if (s.restart) input.addEventListener('change', start);
  $('group-' + s.group).appendChild(row);
}
for (const b of document.querySelectorAll('#mode button')) {
  b.onclick = () => {
    params.mode = b.dataset.mode;
    for (const o of document.querySelectorAll('#mode button')) o.classList.toggle('active', o === b);
    rack.setMode(params.mode);
  };
}
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-swap').onclick = () => rack.replace(Math.floor(Math.random() * rack.n));

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
    for (; acc >= 1; acc--) { rack.step(); aLog.push(rack.listener()); pLog.push(rack.power() * 100); dLog.push(Math.max(0, 30 + rack.toneDb())); }
  }
  syncAngle += RPM_NOMINAL / 60 / 40 * 2 * Math.PI * dt;
  updateSound();
  draw(now, dt);
  const np = rack.n * (rack.n - 1) / 2;
  $('chart-a-title').textContent = isSync() ? 'Тон лопастей в комнате' : 'Пульсирующих пар';
  $('legend-right').textContent = isSync()
    ? 'Справа — фазы тонов. Бирюзовая линия — пара, которая гасит друг друга, стрелка на ступице — фаза лопастей.'
    : 'Справа — тоны всех вентиляторов на одной оси.';
  if (isSync()) drawChart(chartA, actx, dLog, 30, '#3ee6b0', '0 дБ вверху (как без синхрофаз) … −30 дБ внизу', 30);
  else drawChart(chartA, actx, aLog, Math.max(4, np / 2), '#ff7ab6', `0–${Math.max(4, np / 2)} пар (всего пар ${np})`);
  drawChart(chartP, pctx, pLog, 160, '#3ee6b0', '0–160% от всех на 3000 об/мин', 100);
  if (now - lastStats > 300) {
    lastStats = now;
    const db = v => (v > 0 ? '+' : '') + v.toFixed(1);
    $('stats').innerHTML = `время <b>${(rack.t / 2).toFixed(0)} с</b> · `
      + (isSync() ? `тон лопастей в комнате <b>${db(rack.toneDb())} дБ</b> · вместе с шумом воздуха <b>${db(rack.roomDb())} дБ</b>`
        : `пульсирующих пар <b>${rack.listener().toFixed(1)}</b> из ${np}`)
      + ` · мощность <b>${Math.round(rack.power() * 100)}%</b>`;
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
