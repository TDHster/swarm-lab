// Lampshade page: growth, the unrolled pattern, the lit lamp, shadows on the wall, sliders and the SVG export.
// The model is in lamp.js.

const PRESETS = {
  lace: { label: 'Кружево', values: { sensorAngle: 10, sensorDist: 5, turnAngle: 45, decay: 30 } },
  fine: { label: 'Мелкая сетка', values: { sensorAngle: 10, sensorDist: 3, turnAngle: 45, decay: 30 } },
  cells: { label: 'Крупные соты', values: { sensorAngle: 10, sensorDist: 7, turnAngle: 90, decay: 30 } },
  veins: { label: 'Прожилки', values: { sensorAngle: 22.5, sensorDist: 7, turnAngle: 90, decay: 20 } },
};
const SLIDERS = [
  { group: 'size', key: 'diam', label: 'Диаметр', min: 10, max: 40, step: 1, value: 20, fmt: v => v + ' см', restart: true },
  { group: 'size', key: 'height', label: 'Высота', min: 10, max: 40, step: 1, value: 25, fmt: v => v + ' см', restart: true },
  { group: 'grow', key: 'sensorDist', label: 'Дальность сенсоров', min: 2, max: 12, step: 1, value: 5, fmt: v => v * RES + ' мм', restart: true },
  { group: 'grow', key: 'sensorAngle', label: 'Угол сенсоров', min: 5, max: 60, step: 2.5, value: 10, fmt: v => v + '°', restart: true },
  { group: 'grow', key: 'turnAngle', label: 'Поворот', min: 15, max: 90, step: 5, value: 45, fmt: v => v + '°', restart: true },
  { group: 'grow', key: 'decay', label: 'Выветривание', min: 5, max: 40, step: 1, value: 30, fmt: v => v + '%', restart: true },
  { group: 'grow', key: 'steps', label: 'Шагов роста', min: 50, max: 600, step: 10, value: 200 },
  { group: 'cut', key: 'open', label: 'Ажурность', min: 0.3, max: 0.85, step: 0.05, value: 0.6, fmt: v => Math.round(v * 100) + '%' },
  { group: 'cut', key: 'minRib', label: 'Мин. перемычка', min: 2, max: 10, step: 2, value: 2, fmt: v => (2 * ribRadius(v) + 1) * RES + ' мм' },
  { group: 'cut', key: 'minHole', label: 'Мин. прорезь', min: 4, max: 200, step: 4, value: 20, fmt: v => v + ' мм²' },
  { group: 'cut', key: 'rim', label: 'Ободок', min: 4, max: 30, step: 2, value: 10, fmt: v => v + ' мм' },
];
const SEAM = 10, OVERLAP = 10, DENSITY = 0.76;   // mm, mm, agents per cell

const $ = id => document.getElementById(id);
const params = {};
for (const s of SLIDERS) params[s.key] = s.value;

let shade, cut, running = true, rot = 0, loops = null;

function start() {
  params.agents = Math.round(DENSITY * Math.round(Math.PI * params.diam * 10 / RES) * Math.round(params.height * 10 / RES));
  shade = new Shade({ ...params }, makeRng(+$('seed').value || 1));
  recut();
}
function recut() {
  cut = makeMask(shade, { open: params.open, minRib: params.minRib, minHole: params.minHole, rim: params.rim, seam: SEAM });
  loops = null;   // outlines are traced only for the export
  wallDirty = true;
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  field.width = Math.round(field.clientWidth * dpr);
  field.height = Math.round(field.clientHeight * dpr);
  wallDirty = true;
}
new ResizeObserver(resize).observe(field);

const pat = document.createElement('canvas'), lampC = document.createElement('canvas'), wallC = document.createElement('canvas');
let wallDirty = true;

// Unrolled pattern: while growing show the trail, with the cut mask on top.
function drawPattern() {
  const { w, h } = shade;
  if (pat.width !== w || pat.height !== h) { pat.width = w; pat.height = h; }
  const g = pat.getContext('2d'), img = g.createImageData(w, h), T = shade.trail;
  let max = 0;
  for (let k = 0; k < T.length; k += 7) max = Math.max(max, T[k]);
  for (let k = 0; k < w * h; k++) {
    const t = Math.min(1, T[k] / (max || 1) * 2), m = cut.mask[k];
    const r = m ? 42 + 60 * t : 245, gg = m ? 32 + 40 * t : 226, b = m ? 24 + 20 * t : 180;
    img.data[4 * k] = r; img.data[4 * k + 1] = gg; img.data[4 * k + 2] = b; img.data[4 * k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// The lamp seen from the side, slowly turning: holes glow, paper glows dimly.
function drawLamp(W, H) {
  lampC.width = W; lampC.height = H;
  const g = lampC.getContext('2d'), img = g.createImageData(W, H), { w, h, mask } = cut;
  const R = Math.min(W * 0.4, H * 0.42 * params.diam / params.height), LH = R * 2 * params.height / params.diam;
  const cx = W / 2, top = (H - LH) / 2;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const k = 4 * (py * W + px), u = (px - cx) / R, v = (py - top) / LH;
    let r = 10, gg = 14, b = 12;
    if (Math.abs(u) < 1 && v >= 0 && v < 1) {
      const th = Math.asin(u), col = Math.floor((((th + rot) / (2 * Math.PI)) % 1 + 1) % 1 * w), row = Math.floor(v * h);
      const shadeK = Math.sqrt(1 - u * u);
      if (mask[row * w + col]) { r = 70 + 60 * shadeK; gg = 38 + 34 * shadeK; b = 14 + 10 * shadeK; }   // lit paper
      else { r = 255; gg = 214 + 20 * shadeK; b = 140 + 40 * shadeK; }   // a hole: the bulb shows through
    }
    img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// Light on a wall 60 cm from the lamp's axis: trace from the bulb (at mid-height) through the shade to the wall.
function drawWall(W, H) {
  wallC.width = W; wallC.height = H;
  const g = wallC.getContext('2d'), img = g.createImageData(W, H), { w, h, mask } = cut;
  const R = params.diam * 5, LH = params.height * 10, Dw = 600, zc = LH / 2;   // mm
  const spanY = 4000, spanZ = spanY * H / W;   // the visible wall, mm
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const y = (px / W - 0.5) * spanY, z = zc + (0.5 - py / H) * spanZ;   // z up
    const dh = Math.hypot(Dw, y), t = R / dh, zs = zc + (z - zc) * t;
    let light;
    if (zs < 0 || zs >= LH) light = 0.55;   // through the open top or bottom
    else {
      const th = Math.atan2(y, Dw) + rot + Math.PI;   // the side of the shade that faces the wall
      const col = Math.floor(((th / (2 * Math.PI)) % 1 + 1) % 1 * w), row = Math.floor((1 - zs / LH) * h);
      light = mask[Math.min(h - 1, Math.max(0, row)) * w + col] ? 0.06 : 1;
    }
    const d2 = (dh * dh + (z - zc) ** 2) / (Dw * Dw), I = Math.min(1, light / d2 * 0.9);
    const k = 4 * (py * W + px);
    img.data[k] = 18 + 237 * I; img.data[k + 1] = 16 + 200 * I; img.data[k + 2] = 14 + 120 * I; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function draw() {
  const w = field.width, h = field.height, dpr = window.devicePixelRatio || 1, m = 8 * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  // Top: the unrolled sheet.
  const ph = Math.min(h * 0.42, (w - 2 * m) * shade.h / shade.w), pw = ph * shade.w / shade.h, px = (w - pw) / 2;
  drawPattern();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(pat, px, m, pw, ph);
  ctx.fillStyle = '#86a89b';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText(`развёртка ${Math.round(Math.PI * params.diam * 10)} × ${params.height * 10} мм`, px, m + ph + 14 * dpr);
  // Bottom: lamp and wall, small offscreen images scaled up.
  const by = m + ph + 24 * dpr, bh = h - by - m, lw = bh * 0.8, ww = w - lw - 3 * m;
  drawLamp(Math.round(lw / (2 * dpr)), Math.round(bh / (2 * dpr)));
  ctx.drawImage(lampC, m, by, lw, bh);
  if (wallDirty || running) { drawWall(Math.round(ww / (2 * dpr)), Math.round(bh / (2 * dpr))); wallDirty = false; }
  ctx.drawImage(wallC, 2 * m + lw, by, ww, bh);
  ctx.fillStyle = '#86a89b';
  ctx.fillText('лампа', m + 4 * dpr, by + 14 * dpr);
  ctx.fillText('стена в 60 см', 2 * m + lw + 4 * dpr, by + 14 * dpr);
}

function updateOut() {
  const C = Math.PI * params.diam * 10, st = cut.stats;
  $('out').innerHTML = `лист <b>${Math.round(C + OVERLAP)} × ${params.height * 10} мм</b> (окружность + ${OVERLAP} мм на склейку) ·
    прорезей <b>${st.holes}</b> · ажурность после чистки <b>${Math.round(st.open * 100)}%</b> ·
    залито мелких <b>${st.filled}</b> · удалено «островков» <b>${st.islandCells * RES * RES} мм²</b> ·
    перемычки от <b>${(2 * ribRadius(params.minRib) + 1) * RES} мм</b>`;
}

// ---- SVG for the laser: outer contour, cut-outs (red = cut), glue line (blue = score/engrave) ----
function svg() {
  if (!loops) loops = outlines(cut);
  const C = Math.PI * params.diam * 10, H = params.height * 10, Wsheet = C + OVERLAP;
  const sx = C / cut.w, sy = H / cut.h, f = v => v.toFixed(2), out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(Wsheet)}mm" height="${H}mm" viewBox="0 0 ${f(Wsheet)} ${H}">`);
  out.push(`<g fill="none" stroke="#ff0000" stroke-width="0.1">`);
  out.push(`<rect x="0" y="0" width="${f(Wsheet)}" height="${H}"/>`);
  for (const L of loops) out.push(`<path d="M${L.map(([x, y]) => f(x * sx) + ' ' + f(y * sy)).join(' L')} Z"/>`);
  out.push('</g>');
  out.push(`<path d="M${f(C)} 0 V${H}" stroke="#0000ff" stroke-width="0.1" stroke-dasharray="2 2" fill="none"/>`);
  out.push('</svg>');
  return out.join('\n');
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : String(v);
const inputs = {};
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  inputs[s.key] = { input, out, s };
  input.addEventListener('input', () => { params[s.key] = +input.value; out.textContent = fmt(s, +input.value); });
  if (s.restart) input.addEventListener('change', () => { setPresetButton(null); start(); });
  else if (s.group === 'cut') input.addEventListener('change', recut);
  $('group-' + s.group).appendChild(row);
}
function setPresetButton(name) { for (const b of document.querySelectorAll('#presets button')) b.classList.toggle('active', b.dataset.name === name); }
for (const [name, pr] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = pr.label;
  b.dataset.name = name;
  b.onclick = () => {
    for (const [k, v] of Object.entries(pr.values)) { const it = inputs[k]; it.input.value = v; params[k] = v; it.out.textContent = fmt(it.s, v); }
    setPresetButton(name);
    start();
    running = true;
  };
  $('presets').appendChild(b);
}
setPresetButton('lace');
$('btn-run').onclick = () => { running = !running; };
$('btn-reset').onclick = () => { start(); running = true; };
$('btn-svg').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg()], { type: 'image/svg+xml' }));
  a.download = `lampshade-${params.diam}x${params.height}cm.svg`;
  a.click();
};

// ---- loop ------------------------------------------------------------------------------------
let frames = 0, lastOut = 0;
function frame(now) {
  if (running && shade.steps < params.steps) {
    const t0 = performance.now();
    for (let k = 0; k < 4 && shade.steps < params.steps && performance.now() - t0 < 30; k++) shade.step();
    if (++frames % 10 === 0 || shade.steps >= params.steps) recut();
  }
  const growing = running && shade.steps < params.steps;
  $('btn-run').textContent = growing ? '⏸ Пауза' : shade.steps >= params.steps ? '✓ Выросло' : '▶ Расти';
  rot += 0.003;
  draw();
  if (now - lastOut > 300) {
    lastOut = now;
    updateOut();
    $('stats').innerHTML = `шаг роста <b>${shade.steps}</b> из ${params.steps} · слизевиков <b>${shade.n.toLocaleString('ru')}</b>`
      + ` · прорезей <b>${cut.stats.holes}</b>`;
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
