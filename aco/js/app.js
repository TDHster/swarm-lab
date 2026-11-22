// Delivery round page: map, pheromone, comparison with greedy / 2-opt / exact, sliders and the loop.

const SLIDERS = [
  { group: 'map', key: 'count', label: 'Адресов', min: 5, max: 150, step: 1, value: 50, restart: 'map' },
  { group: 'ants', key: 'ants', label: 'Муравьёв', min: 1, max: 100, step: 1, value: 30 },
  { group: 'ants', key: 'alpha', label: 'Память α', min: 0, max: 3, step: 0.1, value: 1,
    title: 'Насколько муравей доверяет феромону — опыту колонии. 0 — не доверяет совсем' },
  { group: 'ants', key: 'beta', label: 'Близость β', min: 0, max: 6, step: 0.5, value: 3,
    title: 'Насколько муравей предпочитает ближние адреса. 0 — расстояние не важно' },
  { group: 'ants', key: 'rho', label: 'Испарение ρ', min: 0.01, max: 0.5, step: 0.01, value: 0.05, fmt: v => Math.round(v * 100) + '%',
    title: 'Какая доля феромона испаряется за итерацию' },
  { group: 'run', key: 'speed', label: 'Итераций в секунду', min: 1, max: 60, step: 1, value: 10 },
];

const $ = id => document.getElementById(id);
const params = { localSearch: false };
for (const s of SLIDERS) params[s.key] = s.value;

let pts, d, N, colony, greedy, two, opt, running = true;

function newMap(seed) {
  pts = makeCities($('kind').value, params.count, makeRng(seed));
  setupMap();
}
function setupMap() {
  d = distanceMatrix(pts);
  N = pts.length;
  greedy = greedyTour(d, N);
  two = twoOpt(greedy, d, N);
  opt = N <= 14 ? heldKarp(d, N) : null;
  restartColony();
}
function restartColony() {
  colony = new AntColony(d, N, params, makeRng(Date.now() % 1e9));
  bestKnown = Math.min(tourLength(two, d, N), opt ? tourLength(opt, d, N) : Infinity);
}
let bestKnown = Infinity;

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d'), chart = $('chart'), cctx = chart.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chart]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function pathOf(tour, s) {
  ctx.beginPath();
  tour.forEach((k, i) => (i ? ctx.lineTo(pts[k].x * s, pts[k].y * s) : ctx.moveTo(pts[k].x * s, pts[k].y * s)));
  ctx.closePath();
}

function draw() {
  const s = field.width / AREA_W, dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, field.width, field.height);

  if ($('show-tau').checked && colony.iter > 0) {
    // Pheromone: brighter roads carry more of it. Grouped into 8 levels so each level is one stroke.
    const span = colony.tauMax - colony.tauMin, levels = Array.from({ length: 8 }, () => []);
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const t = (colony.tau[i * N + j] - colony.tauMin) / span;
      if (t > 0.08) levels[Math.min(7, Math.floor(t * 8))].push(i, j);
    }
    levels.forEach((pairs, l) => {
      if (!pairs.length) return;
      ctx.strokeStyle = `rgba(255, 122, 182, ${(0.12 + 0.6 * l / 7).toFixed(2)})`;
      ctx.lineWidth = (0.8 + 2.2 * l / 7) * dpr;
      ctx.beginPath();
      for (let q = 0; q < pairs.length; q += 2) { ctx.moveTo(pts[pairs[q]].x * s, pts[pairs[q]].y * s); ctx.lineTo(pts[pairs[q + 1]].x * s, pts[pairs[q + 1]].y * s); }
      ctx.stroke();
    });
  }
  const show = $('show').value;
  const ref = show === 'greedy' ? greedy : show === 'two' ? two : show === 'opt' ? opt : null;
  if (ref) {
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.strokeStyle = show === 'opt' ? '#3ee6b0' : '#5bb8ff';
    ctx.lineWidth = 2 * dpr;
    pathOf(ref, s);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (colony.best) {
    ctx.strokeStyle = '#f5d76e';
    ctx.lineWidth = 2.5 * dpr;
    pathOf(colony.best, s);
    ctx.stroke();
  }
  ctx.fillStyle = '#dcefe7';
  for (let k = 1; k < N; k++) { ctx.beginPath(); ctx.arc(pts[k].x * s, pts[k].y * s, 3.5 * dpr, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ff7ab6';
  ctx.fillRect(pts[0].x * s - 6 * dpr, pts[0].y * s - 6 * dpr, 12 * dpr, 12 * dpr);
}

function drawChart() {
  const w = chart.width, h = chart.height, dpr = window.devicePixelRatio || 1, H = colony.history;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.fillStyle = '#040a08';
  cctx.fillRect(0, 0, w, h);
  const gl = tourLength(greedy, d, N), lo = bestKnown * 0.98, hi = gl * 1.05;
  const Y = v => h - 4 * dpr - (Math.min(hi, v) - lo) / (hi - lo) * (h - 18 * dpr);
  const X = k => k / Math.max(10, H.length - 1) * w;
  const hline = (v, color, label) => {
    cctx.strokeStyle = color; cctx.setLineDash([4 * dpr, 4 * dpr]); cctx.lineWidth = dpr;
    cctx.beginPath(); cctx.moveTo(0, Y(v)); cctx.lineTo(w, Y(v)); cctx.stroke(); cctx.setLineDash([]);
    cctx.fillStyle = color; cctx.font = `${10 * dpr}px system-ui, sans-serif`; cctx.fillText(label, w - 70 * dpr, Y(v) - 3 * dpr);
  };
  hline(gl, '#86a89b', 'жадный');
  hline(tourLength(two, d, N), '#5bb8ff', '2-opt');
  if (opt) hline(tourLength(opt, d, N), '#3ee6b0', 'оптимум');
  if (H.length > 1) {
    cctx.strokeStyle = 'rgba(245, 215, 110, 0.35)'; cctx.lineWidth = dpr;
    cctx.beginPath(); H.forEach((r, k) => (k ? cctx.lineTo(X(k), Y(r.iter)) : cctx.moveTo(X(k), Y(r.iter)))); cctx.stroke();
    cctx.strokeStyle = '#f5d76e'; cctx.lineWidth = 2 * dpr;
    cctx.beginPath(); H.forEach((r, k) => (k ? cctx.lineTo(X(k), Y(r.best)) : cctx.moveTo(X(k), Y(r.best)))); cctx.stroke();
  }
}

function updateTable() {
  bestKnown = Math.min(bestKnown, colony.bestLen);
  const row = (name, len, note = '') => `<tr><td>${name}</td><td>${len.toFixed(1)} км</td><td>${len <= bestKnown * 1.00001 ? '<b class="good">лучший</b>' : '+' + ((len / bestKnown - 1) * 100).toFixed(1) + '%'}</td><td class="muted">${note}</td></tr>`;
  let html = row('жадный (к ближайшему)', tourLength(greedy, d, N), 'мгновенно')
    + row('жадный + 2-opt', tourLength(two, d, N), 'распутать перекрёстки');
  if (colony.best) html += row(`муравьи${params.localSearch ? ' + 2-opt' : ''}`, colony.bestLen, `итерация ${colony.iter}`);
  if (opt) html += row('точный оптимум', tourLength(opt, d, N), 'перебор (Хелд–Карп)');
  $('table').innerHTML = html;
  $('stats').innerHTML = `адресов <b>${N - 1}</b> + склад · итерация <b>${colony.iter}</b> · лучший маршрут муравьёв <b>${colony.best ? colony.bestLen.toFixed(1) : '—'} км</b>`
    + (opt ? '' : ' · точный оптимум считаем только до 13 адресов');
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : (s.step < 1 ? v.toFixed(s.step < 0.1 ? 2 : 1) : String(v));
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => { params[s.key] = +input.value; out.textContent = fmt(s, +input.value); });
  if (s.restart) input.addEventListener('change', () => newMap(+$('seed').value || 1));
  $('group-' + s.group).appendChild(row);
}
$('kind').onchange = () => newMap(+$('seed').value || 1);
$('ls').onchange = e => { params.localSearch = e.target.checked; restartColony(); };
$('btn-new').onclick = () => { $('seed').value = 1 + Math.floor(Math.random() * 9999); newMap(+$('seed').value); };
$('btn-restart').onclick = restartColony;
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
// Click on the map: add an address, or remove the one under the cursor. The colony starts over.
field.addEventListener('click', e => {
  const r = field.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * AREA_W, y = (e.clientY - r.top) / r.height * AREA_H;
  const hit = pts.findIndex((p, k) => k > 0 && Math.hypot(p.x - x, p.y - y) < 2);
  if (hit > 0) pts.splice(hit, 1); else pts.push({ x, y });
  setupMap();
});

// ---- pause while off screen ------------------------------------------------------------------
// No canvas in view (the visitor scrolled to the text) - nobody watches, so skip the work and keep the laptop cool.
const onScreen = new Set();
{
  const io = new IntersectionObserver(es => { for (const e of es) (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)); });
  for (const c of document.querySelectorAll('canvas')) io.observe(c);
}

// ---- loop ------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), lastTable = 0;
function frame(now) {
  if (!onScreen.size) { last = now; requestAnimationFrame(frame); return; }
  const dt = Math.min(200, now - last);
  last = now;
  if (running) {
    acc += dt * params.speed / 1000;
    const t0 = performance.now();
    while (acc >= 1 && performance.now() - t0 < 25) { colony.iterate(); acc -= 1; }
    if (acc > 3) acc = 0;   // too slow for this speed: drop instead of piling up
  }
  draw();
  drawChart();
  if (now - lastTable > 300) { lastTable = now; updateTable(); }
  requestAnimationFrame(frame);
}
resize();
newMap(1);
requestAnimationFrame(frame);

// Phones: tap a settings group title to open or close it (collapsed by CSS on narrow screens).
for (const fs of document.querySelectorAll('.groups fieldset')) {
  fs.querySelector('legend').addEventListener('click', () => fs.classList.toggle('open'));
}
