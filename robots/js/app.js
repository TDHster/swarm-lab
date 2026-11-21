// Robot swarm page: drawing, sliders and the loop. The model is in swarm.js.

const $ = id => document.getElementById(id);
const params = { count: 150, shape: 'letter', noise: 0 };
let swarm, running = true, speedUp = 10;

const WORLD_W = 160, WORLD_H = 90;   // robot radii shown on the canvas
const field = $('field'), ctx = field.getContext('2d'), chart = $('chart'), cctx = chart.getContext('2d');
const COLORS = { wait: '#5f8f80', move: '#ff7ab6', joined: '#3ee6b0', seed: '#f5d76e' };
const counts = [];

function start() {
  swarm = new Swarm(params, makeRng(+$('seed').value || 1));
  counts.length = 0;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chart]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function draw() {
  const s = field.width / WORLD_W, dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, field.width, field.height);
  // The target shape, as everyone's shared picture, drawn where it really is (seed coordinates).
  const poly = SHAPES[params.shape].poly;
  ctx.fillStyle = 'rgba(62, 230, 176, 0.08)';
  ctx.strokeStyle = 'rgba(62, 230, 176, 0.5)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([5 * dpr, 4 * dpr]);
  ctx.beginPath();
  poly.forEach(([u, v], k) => (k ? ctx.lineTo((SEED_X + u) * s, (SEED_Y - v) * s) : ctx.moveTo((SEED_X + u) * s, (SEED_Y - v) * s)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  const showEst = $('show-est').checked;
  for (const b of swarm.r) {
    if (showEst && b.localized && b.state !== 'seed') {
      // Where the robot thinks it is: a line from the true position to the estimate.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(b.x * s, b.y * s);
      ctx.lineTo(b.ex * s, b.ey * s);
      ctx.stroke();
    }
    ctx.fillStyle = COLORS[b.state];
    ctx.beginPath();
    ctx.arc(b.x * s, b.y * s, 0.92 * s, 0, Math.PI * 2);
    ctx.fill();
    if ($('show-grad').checked && Number.isFinite(b.grad) && s > 5) {
      ctx.fillStyle = '#040a08';
      ctx.font = `${Math.round(s * 0.9)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.grad % 100), b.x * s, b.y * s);
    }
  }
}

function drawChart() {
  const w = chart.width, h = chart.height, dpr = window.devicePixelRatio || 1;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.fillStyle = '#040a08';
  cctx.fillRect(0, 0, w, h);
  cctx.fillStyle = '#86a89b';
  cctx.font = `${10 * dpr}px system-ui, sans-serif`;
  cctx.fillText('заполнено фигуры, 0–100%', 4 * dpr, 12 * dpr);
  if (counts.length < 2) return;
  cctx.strokeStyle = '#3ee6b0';
  cctx.lineWidth = 2 * dpr;
  cctx.beginPath();
  counts.forEach(([t, f], k) => {
    const x = t / counts[counts.length - 1][0] * w, y = h - 3 * dpr - f * (h - 18 * dpr);
    if (k) cctx.lineTo(x, y); else cctx.moveTo(x, y);
  });
  cctx.stroke();
}

// ---- controls ------------------------------------------------------------------------------
for (const [key, sh] of Object.entries(SHAPES)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = sh.label; o.selected = key === params.shape;
  $('shape').appendChild(o);
}
$('shape').onchange = e => { params.shape = e.target.value; start(); };
const bind = (id, key, fmt, restart) => {
  const input = $(id), out = $(id + '-out');
  const sync = () => { params[key] = +input.value; out.textContent = fmt(+input.value); };
  input.addEventListener('input', sync);
  if (restart) input.addEventListener('change', start);
  sync();
};
bind('count', 'count', v => String(v), true);
bind('noise', 'noise', v => (v * 100).toFixed(1) + '%', true);
$('speed').oninput = e => { speedUp = +e.target.value; $('speed-out').textContent = speedUp; };
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;

// ---- loop ------------------------------------------------------------------------------------
let lastStats = 0;
function frame(now) {
  if (running) {
    const t0 = performance.now();
    for (let k = 0; k < speedUp && performance.now() - t0 < 20; k++) swarm.step();
  }
  draw();
  if (now - lastStats > 400) {
    lastStats = now;
    const st = swarm.stats();
    counts.push([swarm.steps, st.fill]);
    drawChart();
    $('stats').innerHTML = `шагов <b>${swarm.steps}</b> · встали в фигуру <b>${st.joined}</b> · едут <b>${st.moving}</b>`
      + ` · ждут <b>${swarm.r.filter(b => b.state === 'wait').length}</b> · фигура заполнена на <b>${(st.fill * 100).toFixed(0)}%</b>`
      + ` · ошибка «где я» у вставших <b>${st.error.toFixed(1)}</b> радиуса`;
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
