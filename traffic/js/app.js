// Ring road page: the ring, the time × place diagram, charts, sliders, click-to-brake and the loop.
// The model is in model.js.

const SLIDERS = [
  { group: 'road', key: 'cars', label: 'Машин на кольце', min: 10, max: 30, step: 1, value: 22, restart: true,
    title: 'Кольцо 230 м, как в опыте Сугиямы' },
  { group: 'drivers', key: 'a', label: 'Разгон a', min: 0.5, max: 3, step: 0.1, value: 1, fmt: v => v.toFixed(1) + ' м/с²',
    title: 'Насколько бодро водитель разгоняется' },
  { group: 'drivers', key: 'T', label: 'Дистанция T', min: 0.4, max: 2, step: 0.1, value: 0.6, fmt: v => v.toFixed(1) + ' с',
    title: 'Время до передней машины, которое водитель хочет держать (зазор = 2 м + скорость × T)' },
  { group: 'drivers', key: 'noise', label: 'Неровность', min: 0, max: 1, step: 0.05, value: 0.2, fmt: v => v.toFixed(2) + ' м/с²',
    title: 'Случайная добавка к ускорению: никто не держит педаль идеально' },
  { group: 'auto', key: 'auto', label: 'Автопилотов', min: 0, max: 3, step: 1, value: 0 },
  { group: 'auto', key: 'speed', label: 'Скорость времени', min: 1, max: 10, step: 1, value: 3, fmt: v => '×' + v },
];

const $ = id => document.getElementById(id);
const params = { length: 230, v0: 15, b: 1.5 };
for (const s of SLIDERS) params[s.key] = s.value;

const DT = 0.1, TRACE = 120, TRACE_DT = 0.5;   // model step; the diagram shows 120 s, a sample every 0.5 s
let ring, running = true;
const trace = [], vLog = [], sLog = [];

function start() {
  ring = new Ring({ ...params }, makeRng(+$('seed').value || 1));
  trace.length = vLog.length = sLog.length = 0;
}

const speedColor = v => `hsl(${Math.round(Math.min(1, v * 3.6 / 50) * 120)} 75% 55%)`;

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chartV = $('chart-v'), vctx = chartV.getContext('2d'), chartS = $('chart-s'), sctx = chartS.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chartV, chartS]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function ringGeom() {
  const h = field.height, R = h * 0.38;
  return { cx: h * 0.5, cy: h * 0.5, R };
}

function draw() {
  const w = field.width, h = field.height, dpr = window.devicePixelRatio || 1, L = params.length;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  // The ring road.
  const { cx, cy, R } = ringGeom(), lane = Math.max(14 * dpr, R * 0.12);
  ctx.strokeStyle = '#1f3a32';
  ctx.lineWidth = lane;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  // Cars, as arcs of the road (a car is 4.5 m of 230). Position 0 at the top, driving clockwise.
  const carAng = CAR_LEN / L * Math.PI * 2;
  for (let k = 0; k < ring.n; k++) {
    const a0 = ring.x[k] / L * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = ring.isAuto[k] ? '#5bb8ff' : speedColor(ring.v[k]);
    ctx.lineWidth = lane * 0.7;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0 - carAng * 0.92, a0); ctx.stroke();
    if (ring.acc[k] < -1) {   // brake lights at the back
      const ab = a0 - carAng * 0.92;
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(cx + Math.cos(ab) * R, cy + Math.sin(ab) * R, lane * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#86a89b';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('кольцо 230 м', cx, cy - 4 * dpr);
  ctx.fillText('едут по часовой', cx, cy + 12 * dpr);
  ctx.textAlign = 'left';

  // Time × place diagram: x - time (last 120 s), y - place on the ring (top = 0 m).
  const x0 = h * 1.02, x1 = w - 8 * dpr, y0 = 18 * dpr, y1 = h - 18 * dpr;
  ctx.strokeStyle = '#1f3a32';
  ctx.lineWidth = dpr;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = '#86a89b';
  ctx.fillText('место на кольце ↓   время →  (последние 2 мин)', x0, y0 - 5 * dpr);
  const dot = Math.max(1.5 * dpr, (y1 - y0) / L * 1.6);
  trace.forEach((snap, j) => {
    const x = x1 - (trace.length - 1 - j) / (TRACE / TRACE_DT) * (x1 - x0);
    for (let k = 0; k < snap.x.length; k++) {
      ctx.fillStyle = snap.auto[k] ? '#5bb8ff' : speedColor(snap.v[k]);
      ctx.fillRect(x - dot / 2, y0 + snap.x[k] / L * (y1 - y0) - dot / 2, dot, dot);
    }
  });
}

function drawChart(c, cx, data, max, color, label) {
  const w = c.width, h = c.height, dpr = window.devicePixelRatio || 1, n = 600;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = '#040a08';
  cx.fillRect(0, 0, w, h);
  cx.fillStyle = '#86a89b';
  cx.font = `${10 * dpr}px system-ui, sans-serif`;
  cx.fillText(label, 4 * dpr, 12 * dpr);
  const from = Math.max(0, data.length - n);
  if (data.length - from < 2) return;
  const Y = v => h - 3 * dpr - Math.min(1, v / max) * (h - 18 * dpr);
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
  input.addEventListener('input', () => {
    params[s.key] = +input.value;
    out.textContent = fmt(s, +input.value);
    if (s.key === 'auto') ring.setAuto(params.auto);
    else if (!s.restart && s.key !== 'speed') ring.p[s.key] = params[s.key];
  });
  if (s.restart) input.addEventListener('change', start);
  $('group-' + s.group).appendChild(row);
}
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;
// Click on the ring: the nearest car brakes hard for 2 s.
field.addEventListener('pointerdown', e => {
  const r = field.getBoundingClientRect(), dpr = field.width / r.width;
  const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr, { cx, cy } = ringGeom();
  if (px > field.height) return;   // the diagram side
  const ang = (Math.atan2(py - cy, px - cx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2), at = ang / (Math.PI * 2) * params.length;
  let best = 0, bd = Infinity;
  for (let k = 0; k < ring.n; k++) {
    let d = Math.abs(ring.x[k] - CAR_LEN / 2 - at);
    d = Math.min(d, params.length - d);
    if (d < bd) { bd = d; best = k; }
  }
  ring.brake(best, 2);
});

// ---- loop ------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), lastStats = 0, sampleT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    acc += dt * params.speed;
    while (acc >= DT) {
      ring.step(DT);
      acc -= DT;
      sampleT += DT;
      if (sampleT >= TRACE_DT - 1e-9) {
        sampleT = 0;
        trace.push({ x: Float64Array.from(ring.x), v: Float64Array.from(ring.v), auto: Uint8Array.from(ring.isAuto) });
        if (trace.length > TRACE / TRACE_DT) trace.shift();
        const st = ring.stats();
        vLog.push(st.mean * 3.6);
        sLog.push(st.stopped);
      }
    }
  }
  draw();
  drawChart(chartV, vctx, vLog, 50, '#3ee6b0', '0–50 км/ч, последние 5 мин');
  drawChart(chartS, sctx, sLog, ring.n, '#ff7ab6', `0–${ring.n} машин`);
  if (now - lastStats > 300) {
    lastStats = now;
    const st = ring.stats();
    $('stats').innerHTML = `время <b>${Math.floor(ring.t / 60)}:${String(Math.floor(ring.t % 60)).padStart(2, '0')}</b>`
      + ` · средняя скорость <b>${(st.mean * 3.6).toFixed(0)} км/ч</b> · разброс скоростей <b>±${(st.sd * 3.6).toFixed(0)}</b>`
      + ` · стоят <b>${st.stopped}</b> из ${ring.n}`;
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
