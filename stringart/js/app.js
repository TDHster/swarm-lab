// String art page: the board, the picture, sliders, photo upload, exports and the loop. The model is in stringart.js.

const S = 300;   // model resolution: the board is S × S points
const SLIDERS = [
  { group: 'board', key: 'diam', label: 'Диаметр доски', min: 20, max: 80, step: 5, value: 40, fmt: v => v + ' см', restart: true },
  { group: 'board', key: 'thread', label: 'Толщина нити', min: 0.1, max: 1, step: 0.05, value: 0.2, fmt: v => v.toFixed(2) + ' мм', restart: true },
  { group: 'board', key: 'nails', label: 'Гвоздей', min: 100, max: 300, step: 10, value: 200, restart: true },
  { group: 'algo', key: 'minSkip', label: 'Пропуск соседей', min: 5, max: 40, step: 1, value: 10, restart: true,
    title: 'Нить не натягивается к гвоздям ближе этого: короткие хорды у края не нужны' },
  { group: 'algo', key: 'contrast', label: 'Контраст', min: 0.5, max: 3, step: 0.1, value: 1, fmt: v => v.toFixed(1), restart: true },
  { group: 'algo', key: 'speed', label: 'Нитей за кадр', min: 1, max: 100, step: 1, value: 10 },
];

const $ = id => document.getElementById(id);
const params = { method: 'greedy', ants: 8, depth: 3 };
for (const s of SLIDERS) params[s.key] = s.value;

let art, base = null, target, running = true, photo = null;
const errLog = [];

// Darkness map from a preset or a photo, with contrast around the middle grey.
function makePicture() {
  base = photo ? fromPhoto(photo) : makeTarget($('pic').value, S);
  const c = (S - 1) / 2;
  target = new Float32Array(S * S);
  for (let p = 0; p < S * S; p++) {
    const x = p % S, y = Math.floor(p / S);
    target[p] = Math.hypot(x - c, y - c) > c ? 0 : Math.min(1, Math.max(0, (base[p] - 0.5) * params.contrast + 0.5));
  }
}
function fromPhoto(img) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), k = Math.max(S / img.width, S / img.height);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  g.drawImage(img, (S - img.width * k) / 2, (S - img.height * k) / 2, img.width * k, img.height * k);
  const d = g.getImageData(0, 0, S, S).data, t = new Float32Array(S * S);
  for (let p = 0; p < S * S; p++) t[p] = 1 - (0.299 * d[4 * p] + 0.587 * d[4 * p + 1] + 0.114 * d[4 * p + 2]) / 255;
  return t;
}

function start() {
  makePicture();
  params.opacity = Math.min(0.9, params.thread / (params.diam * 10 / S));
  art = new StringArt(target, S, params, makeRng(1));
  errLog.length = 0;
  errLog.push(art.error());
  boardCtx = null;
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d'), chart = $('chart'), cctx = chart.getContext('2d');
const board = document.createElement('canvas');
let boardCtx = null, drawnLines = 0;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chart]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
  boardCtx = null;
}
new ResizeObserver(resize).observe(field);

// The board is drawn incrementally: each new thread is one stroke with alpha = opacity (light × (1 − opacity)).
function syncBoard(side) {
  const k = side / S;
  if (!boardCtx || board.width !== Math.round(side)) {
    board.width = board.height = Math.round(side);
    boardCtx = board.getContext('2d');
    boardCtx.fillStyle = '#f4f1e8';
    boardCtx.beginPath(); boardCtx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2); boardCtx.fill();
    drawnLines = 0;
  }
  boardCtx.strokeStyle = `rgba(20, 20, 24, ${art.p.opacity})`;
  boardCtx.lineWidth = k;
  for (; drawnLines < art.seq.length - 1; drawnLines++) {
    const a = art.seq[drawnLines], b = art.seq[drawnLines + 1];
    boardCtx.beginPath();
    boardCtx.moveTo((art.nx[a] + 0.5) * k, (art.ny[a] + 0.5) * k);
    boardCtx.lineTo((art.nx[b] + 0.5) * k, (art.ny[b] + 0.5) * k);
    boardCtx.stroke();
  }
}

const preview = document.createElement('canvas');
function draw() {
  const w = field.width, h = field.height, dpr = window.devicePixelRatio || 1, side = h * 0.94, x0 = h * 0.03, y0 = h * 0.03;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  syncBoard(side);
  ctx.drawImage(board, x0, y0);
  const k = side / S;
  ctx.fillStyle = '#86a89b';
  for (let i = 0; i < art.N; i++) ctx.fillRect(x0 + (art.nx[i] + 0.5) * k - dpr, y0 + (art.ny[i] + 0.5) * k - dpr, 2 * dpr, 2 * dpr);
  if (art.seq.length > 1) {
    const a = art.seq[art.seq.length - 2], b = art.cur;
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(x0 + (art.nx[a] + 0.5) * k, y0 + (art.ny[a] + 0.5) * k); ctx.lineTo(x0 + (art.nx[b] + 0.5) * k, y0 + (art.ny[b] + 0.5) * k); ctx.stroke();
  }
  // The picture, to the right.
  if (preview.width !== S || preview.height !== S) { preview.width = S; preview.height = S; }   // a new canvas is 300 × 150
  const pg = preview.getContext('2d'), img = pg.createImageData(S, S);
  for (let p = 0; p < S * S; p++) {
    const v = 244 - target[p] * 224;
    img.data[4 * p] = v; img.data[4 * p + 1] = v - 3; img.data[4 * p + 2] = v - 12; img.data[4 * p + 3] = 255;
  }
  pg.putImageData(img, 0, 0);
  const ps = Math.min(w - side - x0 * 3, side * 0.6);
  if (ps > 40) {
    ctx.save();
    ctx.beginPath(); ctx.arc(side + x0 * 2 + ps / 2, y0 + ps / 2, ps / 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(preview, side + x0 * 2, y0, ps, ps);
    ctx.restore();
    ctx.fillStyle = '#86a89b';
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.fillText('картинка', side + x0 * 2, y0 + ps + 16 * dpr);
  }
}

function drawChart() {
  const w = chart.width, h = chart.height, dpr = window.devicePixelRatio || 1;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.fillStyle = '#040a08';
  cctx.fillRect(0, 0, w, h);
  cctx.fillStyle = '#86a89b';
  cctx.font = `${10 * dpr}px system-ui, sans-serif`;
  cctx.fillText('по каждым 50 нитям', 4 * dpr, 12 * dpr);
  if (errLog.length < 2) return;
  const max = errLog[0], n = Math.max(20, errLog.length);
  cctx.strokeStyle = '#3ee6b0';
  cctx.lineWidth = 2 * dpr;
  cctx.beginPath();
  errLog.forEach((e, k) => (k ? cctx.lineTo : cctx.moveTo).call(cctx, k / (n - 1) * w, h - 3 * dpr - e / max * (h - 18 * dpr)));
  cctx.stroke();
}

// Thread length, mm (+10% for wrapping around the nails).
function threadLength() {
  const mmPerPx = params.diam * 10 / (S - 1);
  let s = 0;
  for (let k = 1; k < art.seq.length; k++) s += Math.hypot(art.nx[art.seq[k]] - art.nx[art.seq[k - 1]], art.ny[art.seq[k]] - art.ny[art.seq[k - 1]]);
  return s * mmPerPx * 1.1;
}

function updateOut() {
  const m = threadLength() / 1000;
  $('out').innerHTML = `доска ⌀ <b>${params.diam} см</b>, гвоздей <b>${art.N}</b> (шаг ${(Math.PI * params.diam * 10 / art.N).toFixed(1)} мм),
    нитей <b>${art.seq.length - 1}</b>, нить ≈ <b>${m < 1000 ? Math.round(m) + ' м' : (m / 1000).toFixed(2) + ' км'}</b>${art.done ? ' · <b class="good">готово</b>' : ''}`;
  $('seq').value = art.seq.map(i => i + 1).join(' ');
}

// ---- controls ------------------------------------------------------------------------------
for (const [key, label] of Object.entries(PICTURES)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = label;
  $('pic').appendChild(o);
}
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
$('pic').onchange = () => { photo = null; $('file').value = ''; start(); };
$('method').onchange = e => { params.method = e.target.value; start(); };
$('file').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { photo = img; start(); };
  img.src = URL.createObjectURL(f);
};
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;
const download = (name, text, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
};
$('btn-seq').onclick = () => {
  const lines = [`Стринг-арт: доска ${params.diam} см, ${art.N} гвоздей (номер 1 — сверху, дальше по часовой стрелке),`,
    `нитей ${art.seq.length - 1}, нить ≈ ${(threadLength() / 1000).toFixed(0)} м. Порядок гвоздей:`, ''];
  for (let k = 0; k < art.seq.length; k += 10) lines.push(`${String(k + 1).padStart(5)}: ` + art.seq.slice(k, k + 10).map(i => i + 1).join(' → '));
  download('string-art-order.txt', lines.join('\n'), 'text/plain');
};
$('btn-svg').onclick = () => {
  const D = params.diam * 10, m = 15, R = D / 2, c = R + m, out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${D + 2 * m}mm" height="${D + 2 * m}mm" viewBox="0 0 ${D + 2 * m} ${D + 2 * m}">`);
  out.push(`<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="#999" stroke-width="0.3"/>`);
  out.push(`<path d="M${c - 5} ${c} H${c + 5} M${c} ${c - 5} V${c + 5}" stroke="#999" stroke-width="0.3"/>`);
  for (let i = 0; i < art.N; i++) {
    const a = 2 * Math.PI * i / art.N - Math.PI / 2, x = c + Math.cos(a) * R, y = c + Math.sin(a) * R;
    const tx = c + Math.cos(a) * (R + 5), ty = c + Math.sin(a) * (R + 5);
    out.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.7" fill="#000"/>`);
    out.push(`<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-size="2.5" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(1)} ${tx.toFixed(2)} ${ty.toFixed(2)})">${i + 1}</text>`);
  }
  out.push(`<text x="${m}" y="${m - 5}" font-size="4" font-family="sans-serif">Шаблон доски ⌀${params.diam} см, ${art.N} гвоздей. Печатать в масштабе 100%.</text>`);
  out.push('</svg>');
  download('string-art-board.svg', out.join('\n'), 'image/svg+xml');
};

// ---- loop ------------------------------------------------------------------------------------
let lastOut = 0;
function frame(now) {
  if (running && !art.done) {
    const t0 = performance.now(), per = params.method === 'ants' ? Math.max(1, Math.round(params.speed / 10)) : params.speed;
    for (let k = 0; k < per && performance.now() - t0 < 30; k++) {
      if (!art.step()) break;
      if ((art.seq.length - 1) % 50 === 0) errLog.push(art.error());
    }
    if (art.done) errLog.push(art.error());
  }
  draw();
  drawChart();
  if (now - lastOut > 300) {
    lastOut = now;
    updateOut();
    $('stats').innerHTML = `нитей <b>${art.seq.length - 1}</b> · ошибка <b>${errLog[errLog.length - 1].toFixed(3)}</b> (было ${errLog[0].toFixed(3)})`
      + ` · плотность нити <b>${art.p.opacity.toFixed(2)}</b>${art.done ? ' · <b>ни одна хорда больше не улучшает — стоп</b>' : ''}`;
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
