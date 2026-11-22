// Greenhouse page: the heat map, fans, air tracers, charts, controls and the loop. The model is in greenhouse.js.

const SLIDERS = [
  { group: 'sun', key: 'sun', label: 'Солнце', min: 0.3, max: 1.2, step: 0.05, value: 0.8, fmt: v => v.toFixed(2) },
  { group: 'sun', key: 'speed', label: 'Шагов за кадр', min: 1, max: 40, step: 1, value: 1,
    title: 'Шаг модели ≈ секунда. 1 — видно, как вентиляторы разворачиваются; больше — быстрее к итогу' },
  { group: 'fan', key: 'spread', label: 'Разброс порогов', min: 0, max: 4, step: 0.5, value: 2, fmt: v => '±' + v + ' °C' },
];

const $ = id => document.getElementById(id);
const params = { thresholds: 'diverse', aim: 'bees', align: 1, heat: 0.3 };
for (const s of SLIDERS) params[s.key] = s.value;

let gh, running = true;
const meanLog = [], maxLog = [], onLog = [];
let tracers = [];

function start() {
  gh = new Greenhouse({ ...params }, makeRng(+$('seed').value || 1));
  gh.p = params;
  meanLog.length = maxLog.length = onLog.length = 0;
  tracers = Array.from({ length: 500 }, () => ({ x: Math.random() * GW, y: Math.random() * GH, age: Math.random() * 200 }));
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chartT = $('chart-t'), tctx = chartT.getContext('2d'), chartN = $('chart-n'), nctx = chartN.getContext('2d');
const heat = document.createElement('canvas');
heat.width = GW; heat.height = GH;
const trails = document.createElement('canvas');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chartT, chartN]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
  trails.width = field.width; trails.height = field.height;
}
new ResizeObserver(resize).observe(field);

function geom() {
  const w = field.width, h = field.height, s = Math.min((w - 20) / GW, (h - 20) / GH);
  return { s, x0: (w - GW * s) / 2, y0: (h - GH * s) / 2 };
}
// 26 °C blue → green → yellow → 42 °C red.
function tempColor(t) {
  const u = Math.min(1, Math.max(0, (t - 26) / 16));
  const stops = [[30, 100, 150], [50, 120, 70], [220, 190, 60], [220, 60, 50]];
  const f = u * 3, i = Math.min(2, Math.floor(f)), k = f - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function draw() {
  const dpr = window.devicePixelRatio || 1, { s, x0, y0 } = geom();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, field.width, field.height);
  // Heat map.
  const g = heat.getContext('2d'), img = g.createImageData(GW, GH);
  for (let k = 0; k < GW * GH; k++) { const [r, gg, b] = tempColor(gh.T[k]); img.data[4 * k] = r; img.data[4 * k + 1] = gg; img.data[4 * k + 2] = b; img.data[4 * k + 3] = 255; }
  g.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heat, x0, y0, GW * s, GH * s);
  // Air tracers: short fading trails.
  const tg = trails.getContext('2d');
  tg.globalCompositeOperation = 'destination-out';
  tg.fillStyle = 'rgba(0,0,0,0.12)';
  tg.fillRect(0, 0, trails.width, trails.height);
  tg.globalCompositeOperation = 'source-over';
  tg.strokeStyle = 'rgba(255,255,255,0.7)';
  tg.lineWidth = 1.2 * dpr;
  tg.beginPath();
  for (const p of tracers) {
    const k = Math.min(GH - 1, Math.floor(p.y)) * GW + Math.min(GW - 1, Math.floor(p.x)), u = gh.vx[k], v = gh.vy[k];
    const nx = p.x + u * 2.5, ny = p.y + v * 2.5;
    if (Math.hypot(u, v) > 0.02) { tg.moveTo(x0 + p.x * s, y0 + p.y * s); tg.lineTo(x0 + nx * s, y0 + ny * s); }
    p.x = nx; p.y = ny; p.age++;
    if (p.x < 0 || p.x >= GW || p.y < 0 || p.y >= GH || p.age > 200) { p.x = Math.random() * GW; p.y = Math.random() * GH; p.age = 0; }
  }
  tg.stroke();
  ctx.drawImage(trails, 0, 0);
  // Walls with the two openings.
  ctx.strokeStyle = '#dcefe7';
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + VENT.y0 * s); ctx.lineTo(x0, y0); ctx.lineTo(x0 + GW * s, y0); ctx.lineTo(x0 + GW * s, y0 + VENT.y0 * s);
  ctx.moveTo(x0 + GW * s, y0 + VENT.y1 * s); ctx.lineTo(x0 + GW * s, y0 + GH * s); ctx.lineTo(x0, y0 + GH * s); ctx.lineTo(x0, y0 + VENT.y1 * s);
  ctx.stroke();
  ctx.fillStyle = '#dcefe7';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.save(); ctx.translate(x0 + 12 * dpr, y0 + (VENT.y0 + VENT.y1) / 2 * s); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('проём', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(x0 + GW * s - 6 * dpr, y0 + (VENT.y0 + VENT.y1) / 2 * s); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('проём', 0, 0); ctx.restore();
  // Fans.
  const R = Math.max(7 * dpr, s * 1.4);
  for (const f of gh.fans) {
    const x = x0 + f.x * s, y = y0 + f.y * s;
    ctx.fillStyle = 'rgba(4, 10, 8, 0.65)';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = f.broken ? '#ff4d6d' : f.on ? '#dcefe7' : '#55635d';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    if (f.broken) {
      ctx.beginPath(); ctx.moveTo(x - R * 0.6, y - R * 0.6); ctx.lineTo(x + R * 0.6, y + R * 0.6); ctx.moveTo(x + R * 0.6, y - R * 0.6); ctx.lineTo(x - R * 0.6, y + R * 0.6); ctx.stroke();
      continue;
    }
    const c = Math.cos(f.a), sn = Math.sin(f.a);
    ctx.beginPath(); ctx.moveTo(x - c * R * 0.7, y - sn * R * 0.7); ctx.lineTo(x + c * R * 1.6, y + sn * R * 1.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + c * R * 1.6, y + sn * R * 1.6);
    ctx.lineTo(x + c * R * 1.0 - sn * R * 0.45, y + sn * R * 1.0 + c * R * 0.45);
    ctx.lineTo(x + c * R * 1.0 + sn * R * 0.45, y + sn * R * 1.0 - c * R * 0.45);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
}

function drawChart(c, cx, series, lo, hi, label, line) {
  const w = c.width, h = c.height, dpr = window.devicePixelRatio || 1, n = 600;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = '#040a08';
  cx.fillRect(0, 0, w, h);
  cx.fillStyle = '#86a89b';
  cx.font = `${10 * dpr}px system-ui, sans-serif`;
  cx.fillText(label, 4 * dpr, 12 * dpr);
  const Y = v => h - 3 * dpr - Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * (h - 18 * dpr);
  if (line !== undefined) {
    cx.strokeStyle = 'rgba(255, 122, 182, 0.6)';
    cx.setLineDash([4 * dpr, 4 * dpr]);
    cx.beginPath(); cx.moveTo(0, Y(line)); cx.lineTo(w, Y(line)); cx.stroke();
    cx.setLineDash([]);
  }
  for (const [data, color] of series) {
    const from = Math.max(0, data.length - n);
    if (data.length - from < 2) continue;
    cx.strokeStyle = color;
    cx.lineWidth = 2 * dpr;
    cx.beginPath();
    for (let k = from; k < data.length; k++) (k > from ? cx.lineTo : cx.moveTo).call(cx, (k - from) / (n - 1) * w, Y(data[k]));
    cx.stroke();
  }
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : String(v);
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => {
    params[s.key] = +input.value;
    out.textContent = fmt(s, +input.value);
    if (s.key === 'spread') gh.setThresholds();
  });
  $('group-' + s.group).appendChild(row);
}
$('thresholds').onchange = e => { params.thresholds = e.target.value; gh.setThresholds(); };
for (const b of document.querySelectorAll('#aim button')) {
  b.onclick = () => {
    for (const o of document.querySelectorAll('#aim button')) o.classList.toggle('active', o === b);
    gh.setAim(b.dataset.aim);
    gh.flow();
  };
}
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = () => { start(); gh.setAim(params.aim); };
$('btn-fix').onclick = () => { for (const f of gh.fans) f.broken = false; };
// Click on a fan: break it (or repair it).
field.addEventListener('pointerdown', e => {
  const r = field.getBoundingClientRect(), dpr = field.width / r.width, { s, x0, y0 } = geom();
  const x = ((e.clientX - r.left) * dpr - x0) / s, y = ((e.clientY - r.top) * dpr - y0) / s;
  let best = null, bd = 2.5;
  for (const f of gh.fans) { const d = Math.hypot(f.x - x, f.y - y); if (d < bd) { bd = d; best = f; } }
  if (best) { best.broken = !best.broken; gh.flow(); }
});

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
  if (running) {
    const t0 = performance.now();
    for (let k = 0; k < params.speed && performance.now() - t0 < 30; k++) {
      gh.step();
      if (gh.t % 10 === 0) {
        const st = gh.stats();
        meanLog.push(st.mean); maxLog.push(st.max); onLog.push(st.on);
        if (meanLog.length > 2000) { meanLog.shift(); maxLog.shift(); onLog.shift(); }
      }
    }
  }
  draw();
  drawChart(chartT, tctx, [[maxLog, '#ff7ab6'], [meanLog, '#3ee6b0']], 26, 44, '26–44 °C · средняя (зелёная), максимум (розовая), пунктир — 32 °C', 32);
  drawChart(chartN, nctx, [[onLog, '#dcefe7']], 0, 24, '0–24');
  if (now - lastStats > 300) {
    lastStats = now;
    const st = gh.stats(), m = Math.floor(gh.t / 60);
    $('stats').innerHTML = `время <b>${m} мин ${gh.t % 60} с</b> · средняя <b>${st.mean.toFixed(1)} °C</b> · максимум <b>${st.max.toFixed(1)} °C</b>`
      + ` · жарче 32 °C <b>${Math.round(st.hot * 100)}%</b> площади · работает <b>${st.on}</b> из ${gh.fans.filter(f => !f.broken).length}`;
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
