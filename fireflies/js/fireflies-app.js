// Fireflies page: the forest, charts, sliders, the click-to-scramble and the loop. The model is in fireflies.js.

const SLIDERS = [
  { group: 'swarm', key: 'count', label: 'Светлячков', min: 50, max: 1000, step: 10, value: 300, restart: true },
  { group: 'swarm', key: 'spread', label: 'Разброс периодов', min: 0, max: 0.3, step: 0.01, value: 0.03, fmt: v => '±' + Math.round(v * 100) + '%',
    title: 'Насколько собственные часы светлячков идут по-разному' },
  { group: 'rule', key: 'radius', label: 'Радиус зрения', min: 0.5, max: 4, step: 0.1, value: 1.5,
    title: 'Чьи вспышки светлячок видит. Поле — 16 × 9 таких единиц' },
  { group: 'rule', key: 'eps', label: 'Связь ε', min: 0, max: 0.1, step: 0.005, value: 0.03,
    title: 'Насколько вспышка соседа подталкивает фазу: фаза += ε · фаза' },
  { group: 'view', key: 'speed', label: 'Скорость времени', min: 0.25, max: 4, step: 0.25, value: 1, fmt: v => '×' + v },
];

const $ = id => document.getElementById(id);
const params = {};
for (const s of SLIDERS) params[s.key] = s.value;

const DT = 0.01, GLOW = 0.15;   // model step and how long a flash is drawn, s
const SHAKE_R = 2;   // a click knocks fireflies within this radius out of rhythm
let ff, running = true, shake = null, shakeAt = -1e9, mouse = null;
const flashLog = [], rLog = [];   // per 0.05 s: flashes, and r

function start() {
  ff = new Fireflies({ ...params }, makeRng(+$('seed').value || 1));
  flashLog.length = rLog.length = 0;
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chartF = $('chart-flash'), fctx = chartF.getContext('2d'), chartR = $('chart-r'), rctx = chartR.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chartF, chartR]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function draw() {
  const s = field.width / FIELD_W, dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#030806';
  ctx.fillRect(0, 0, field.width, field.height);
  // Dim bodies first, then the glows added on top.
  ctx.fillStyle = '#3c5a3a';
  ctx.beginPath();
  for (let i = 0; i < ff.n; i++) { ctx.moveTo(ff.x[i] * s + 2 * dpr, ff.y[i] * s); ctx.arc(ff.x[i] * s, ff.y[i] * s, 2 * dpr, 0, Math.PI * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  const glowR = Math.max(10 * dpr, 0.35 * s);
  for (let i = 0; i < ff.n; i++) {
    const age = ff.t - ff.lastFlash[i];
    if (age > GLOW) continue;
    const k = 1 - age / GLOW, x = ff.x[i] * s, y = ff.y[i] * s;
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, `rgba(245, 240, 138, ${0.9 * k})`);
    g.addColorStop(0.25, `rgba(200, 235, 90, ${0.35 * k})`);
    g.addColorStop(1, 'rgba(120, 200, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // The shaken area: a pink ring that fades.
  const ta = ff.t - shakeAt;
  if (shake && ta < 0.6) {
    ctx.strokeStyle = `rgba(255, 122, 182, ${1 - ta / 0.6})`;
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath(); ctx.arc(shake.x * s, shake.y * s, SHAKE_R * s, 0, Math.PI * 2); ctx.stroke();
  }
  if (mouse && $('show-r').checked) {
    ctx.strokeStyle = 'rgba(62, 230, 176, 0.5)';
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(mouse.x * s, mouse.y * s, params.radius * s, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawSeries(c, cx, data, max, color, label, bars) {
  const w = c.width, h = c.height, dpr = window.devicePixelRatio || 1, n = 200;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = '#040a08';
  cx.fillRect(0, 0, w, h);
  cx.fillStyle = '#86a89b';
  cx.font = `${10 * dpr}px system-ui, sans-serif`;
  cx.fillText(label, 4 * dpr, 12 * dpr);
  const Y = v => h - 3 * dpr - Math.min(1, v / max) * (h - 18 * dpr);
  const from = Math.max(0, data.length - n), bw = w / n;
  cx.fillStyle = cx.strokeStyle = color;
  if (bars) {
    for (let k = from; k < data.length; k++) { const y = Y(data[k]); cx.fillRect((k - from) * bw, y, Math.max(1, bw - dpr), h - 3 * dpr - y); }
  } else if (data.length - from > 1) {
    cx.lineWidth = 2 * dpr;
    cx.beginPath();
    for (let k = from; k < data.length; k++) (k > from ? cx.lineTo : cx.moveTo).call(cx, (k - from) * bw, Y(data[k]));
    cx.stroke();
  }
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : (s.step < 1 ? v.toFixed(s.step < 0.01 ? 3 : s.step < 0.1 ? 2 : 1) : String(v));
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => {
    params[s.key] = +input.value;
    out.textContent = fmt(s, +input.value);
    if (s.key === 'radius' || s.key === 'eps') ff.p[s.key] = params[s.key];
  });
  if (s.restart) input.addEventListener('change', start);
  if (s.key === 'spread') input.addEventListener('change', () => ff.setSpread(params.spread));
  $('group-' + s.group).appendChild(row);
}
$('group-view').appendChild($('show-r').closest('label'));
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;
const toField = e => { const r = field.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * FIELD_W, y: (e.clientY - r.top) / r.height * FIELD_H }; };
field.addEventListener('pointerdown', e => { shake = toField(e); shakeAt = ff.t; ff.scramble(shake.x, shake.y, SHAKE_R); });
field.addEventListener('pointermove', e => { mouse = toField(e); });
field.addEventListener('pointerleave', () => { mouse = null; });

// ---- sound: every flash is a short chirp (real fireflies are silent - think of crickets) -------
let audio = null;
soundToggle($('btn-sound'), a => { audio = a; });
// Each firefly has its own pitch and sits left or right in the stereo field, as it sits in the forest.
const pitchOf = i => 2000 * Math.pow(2, (i * 0.618034 % 1) * 0.7);

// ---- loop ------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), lastStats = 0, binT = 0, binFlashes = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const hits = [];
  if (running) {
    acc += dt * params.speed;
    for (let j = 0; acc >= DT; j++) {
      binFlashes += ff.step(DT);
      if (soundOn(audio)) for (const i of ff.fired) hits.push({ at: 0.03 + j * DT / params.speed, i });
      acc -= DT;
      binT += DT;
      if (binT >= 0.05 - 1e-9) {
        flashLog.push(binFlashes);
        rLog.push(ff.order());
        if (flashLog.length > 400) { flashLog.shift(); rLog.shift(); }
        binT = 0; binFlashes = 0;
      }
    }
  }
  if (soundOn(audio)) {
    const base = 0.8 / Math.sqrt(ff.n);   // all flashing at once must not be deafening
    playHits(hits, (h, g) => chirp(audio, audio.currentTime + h.at, pitchOf(h.i), ff.x[h.i] / FIELD_W * 1.6 - 0.8, base * g));
  }
  draw();
  drawSeries(chartF, fctx, flashLog, ff.n, '#f5f08a', 'вспышек за 0,05 с, до N', true);
  drawSeries(chartR, rctx, rLog, 1, '#3ee6b0', 'r, от 0 до 1', false);
  if (now - lastStats > 300) {
    lastStats = now;
    $('stats').innerHTML = `время <b>${ff.t.toFixed(0)} с</b> · светлячков <b>${ff.n}</b> · синхронность r <b>${ff.order().toFixed(2)}</b>`;
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
