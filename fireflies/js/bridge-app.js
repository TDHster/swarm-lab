// Millennium Bridge page: the deck from above, charts, sliders, the Arup-style ramp, sound and the loop.
// The model is in bridge.js.

const SLIDERS = [
  { group: 'crowd', key: 'count', label: 'Людей на мосту', min: 0, max: 400, step: 10, value: 100 },
  { group: 'crowd', key: 'sigma', label: 'Разброс походок', min: 0.02, max: 0.3, step: 0.01, value: 0.1, fmt: v => v.toFixed(2) + ' Гц',
    title: 'Насколько у людей разная собственная частота раскачивания при ходьбе (среднее — 1 Гц)' },
  { group: 'crowd', key: 'C', label: 'Чувствительность C', min: 0, max: 150, step: 5, value: 80,
    title: 'Насколько человек подстраивает шаг под качание моста' },
  { group: 'bridge', key: 'zeta', label: 'Демпферы ζ', min: 0.005, max: 0.25, step: 0.005, value: 0.04, fmt: v => (v * 100).toFixed(1) + '%',
    title: 'Затухание колебаний моста. Гасители колебаний его увеличивают' },
  { group: 'view', key: 'speed', label: 'Скорость времени', min: 1, max: 20, step: 1, value: 5, fmt: v => '×' + v },
];

const $ = id => document.getElementById(id);
const params = {};
for (const s of SLIDERS) params[s.key] = s.value;

const DT = 0.005, EXAG = 100, IN_STEP = 0.3;   // model step, s; drawing exaggeration; "in step" = within ±0.3 rad
let br, running = true, ramp = false, rampAt = 0;
const aLog = [], nLog = [], rLog = [];   // one sample per 0.5 s of model time
const sliderInputs = {};

function start() {
  br = new Bridge({ ...params }, makeRng(+$('seed').value || 1));
  aLog.length = nLog.length = rLog.length = 0;
  setRamp(false);
}
function setRamp(on) {
  ramp = on;
  rampAt = br.t;
  $('btn-ramp').textContent = on ? '■ Остановить впуск' : 'Как в опыте Arup: +10 человек каждые 20 с';
}
function setCount(n) {
  params.count = n;
  br.setCount(n);
  sliderInputs.count.value = n;
  sliderInputs.count.dispatchEvent(new Event('sync'));
}

// Share of walkers within ±IN_STEP of the phase that pumps the deck (Ψ + α).
function inStepShare() {
  const target = br.psi + BRIDGE.ALPHA;
  let k = 0;
  for (const th of br.theta) { const d = Math.atan2(Math.sin(th - target), Math.cos(th - target)); if (Math.abs(d) < IN_STEP) k++; }
  return br.theta.length ? k / br.theta.length : 0;
}

// ---- drawing ---------------------------------------------------------------------------------
const field = $('field'), ctx = field.getContext('2d');
const chartA = $('chart-a'), actx = chartA.getContext('2d'), chartN = $('chart-n'), nctx = chartN.getContext('2d');
function resize() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [field, chartA, chartN]) { c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr); }
}
new ResizeObserver(resize).observe(field);

function draw() {
  const w = field.width, h = field.height, dpr = window.devicePixelRatio || 1;
  const x0 = w * 0.04, x1 = w * 0.96, cy = h / 2, half = h * 0.09;
  const mPerPx = half * 2 / 4 * EXAG;   // the deck is 4 m wide; sideways motion is drawn EXAG times larger
  const shift = u => br.X * Math.sin(Math.PI * u) * mPerPx;   // first lateral mode: still at the ends, most in the middle
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06141c';   // the river
  ctx.fillRect(0, 0, w, h);
  // Banks and piers.
  ctx.fillStyle = '#0f1f1a';
  ctx.fillRect(0, 0, x0, h);
  ctx.fillRect(x1, 0, w - x1, h);
  // Rest position.
  ctx.strokeStyle = 'rgba(134, 168, 155, 0.5)';
  ctx.setLineDash([6 * dpr, 5 * dpr]);
  ctx.lineWidth = dpr;
  ctx.strokeRect(x0, cy - half, x1 - x0, half * 2);
  ctx.setLineDash([]);
  // The deck, bent.
  ctx.fillStyle = '#1f3a32';
  ctx.strokeStyle = '#3ee6b0';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  for (let k = 0; k <= 40; k++) { const u = k / 40; ctx.lineTo(x0 + u * (x1 - x0), cy - half + shift(u)); }
  for (let k = 40; k >= 0; k--) { const u = k / 40; ctx.lineTo(x0 + u * (x1 - x0), cy + half + shift(u)); }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Walkers.
  const target = br.psi + BRIDGE.ALPHA, r = Math.max(2.5 * dpr, h * 0.008);
  const groups = [[], []];
  for (let i = 0; i < br.theta.length; i++) {
    const d = Math.atan2(Math.sin(br.theta[i] - target), Math.cos(br.theta[i] - target));
    groups[Math.abs(d) < IN_STEP ? 1 : 0].push(i);
  }
  groups.forEach((list, g) => {
    ctx.fillStyle = g ? '#ff7ab6' : '#9fb8ae';
    ctx.beginPath();
    for (const i of list) {
      const u = br.pos[i] / BRIDGE.LENGTH, x = x0 + u * (x1 - x0);
      const y = cy + br.side[i] * half * 0.8 + shift(u) + Math.sin(br.theta[i]) * r * 0.8;   // own sway, a little
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  });
  ctx.fillStyle = '#86a89b';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText('центральный пролёт, 144 м (вид сверху)', x0 + 8 * dpr, cy - half - 8 * dpr - Math.abs(br.X) * mPerPx);
}

function drawChart(c, cx, series, label, extra) {
  const w = c.width, h = c.height, dpr = window.devicePixelRatio || 1, n = 600;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.fillStyle = '#040a08';
  cx.fillRect(0, 0, w, h);
  cx.font = `${10 * dpr}px system-ui, sans-serif`;
  cx.fillStyle = '#86a89b';
  cx.fillText(label, 4 * dpr, 12 * dpr);
  const Y = v => h - 3 * dpr - Math.min(1, Math.max(0, v)) * (h - 18 * dpr);
  if (extra) extra(Y);
  for (const [data, max, color] of series) {
    const from = Math.max(0, data.length - n);
    if (data.length - from < 2) continue;
    cx.strokeStyle = color;
    cx.lineWidth = 2 * dpr;
    cx.beginPath();
    for (let k = from; k < data.length; k++) (k > from ? cx.lineTo : cx.moveTo).call(cx, (k - from) / (n - 1) * w, Y(data[k] / max));
    cx.stroke();
  }
}

// ---- controls ------------------------------------------------------------------------------
const fmt = (s, v) => s.fmt ? s.fmt(v) : String(v);
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (s.title) row.title = s.title;
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output>${fmt(s, s.value)}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  sliderInputs[s.key] = input;
  input.addEventListener('sync', () => { out.textContent = fmt(s, +input.value); });
  input.addEventListener('input', () => {
    params[s.key] = +input.value;
    out.textContent = fmt(s, +input.value);
    if (s.key === 'count') br.setCount(params.count);
    else if (s.key === 'sigma') br.setSigma(params.sigma);
    else if (s.key !== 'speed') br.p[s.key] = params[s.key];
  });
  $('group-' + s.group).appendChild(row);
}
$('btn-run').onclick = () => { running = !running; $('btn-run').textContent = running ? '⏸ Пауза' : '▶ Старт'; };
$('btn-reset').onclick = start;
$('btn-ramp').onclick = () => {
  if (ramp) { setRamp(false); return; }
  if (params.count >= 400) setCount(0);
  setRamp(true);
};

// ---- sound: footsteps, and the deck creaking as it swings -------------------------------------
// One sway (θ from 0 to 2π) is two steps, so a walker steps each time θ passes a multiple of π.
let audio = null, creak = null, stepIdx = [];
soundToggle($('btn-sound'), a => {
  audio = a;
  const osc = audio.createOscillator(), lp = audio.createBiquadFilter(), g = audio.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 70;
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  g.gain.value = 0;
  osc.connect(lp).connect(g).connect(audio.master);
  osc.start();
  creak = g;
});
function collectSteps(hits, at) {
  for (let i = 0; i < br.theta.length; i++) {
    const k = Math.floor(br.theta[i] / Math.PI);
    if (stepIdx[i] !== undefined && k !== stepIdx[i]) hits.push({ at, i, left: k % 2 === 0 });
    stepIdx[i] = k;
  }
  stepIdx.length = br.theta.length;
}

// ---- loop ------------------------------------------------------------------------------------
let acc = 0, last = performance.now(), lastStats = 0, sampleT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const hits = [];
  if (running) {
    acc += dt * params.speed;
    const t0 = performance.now();
    for (let j = 0; acc >= DT && performance.now() - t0 < 25; j++) {
      br.step(DT);
      if (soundOn(audio)) collectSteps(hits, 0.03 + j * DT / params.speed);
      acc -= DT;
      if (ramp && br.t - rampAt >= 20) {
        rampAt = br.t;
        if (params.count >= 400) setRamp(false); else setCount(params.count + 10);
      }
      sampleT += DT;
      if (sampleT >= 0.5) {
        sampleT = 0;
        aLog.push(br.A * 100);
        nLog.push(br.theta.length);
        rLog.push(inStepShare());
      }
    }
    if (acc > 1) acc = 0;   // too slow for this speed: drop instead of piling up
  }
  if (soundOn(audio)) {
    const n = Math.max(1, br.theta.length);
    playHits(hits, (h, g) => thud(audio, audio.currentTime + h.at, h.left ? -0.3 : 0.3, 1.2 / Math.sqrt(n) * g));
    // The creak swells while the deck moves fastest; ±5 cm of sway is full volume. Squared and kept quiet:
    // a steady creak drowns the rhythm of the steps, which is what we want to hear.
    const speed = Math.min(1, Math.abs(br.V) / (0.05 * BRIDGE.OMEGA));
    creak.gain.setTargetAtTime(running ? 0.12 * speed * speed : 0, audio.currentTime, 0.03);
  } else stepIdx = [];   // sound off: forget, so that turning it on does not play a burst of stale steps
  draw();
  const aMax = Math.max(3, ...aLog.slice(-600));
  drawChart(chartA, actx, [[aLog, aMax, '#3ee6b0']], `амплитуда, 0–${aMax.toFixed(0)} см (последние 5 мин)`);
  const nc = criticalCrowd(params);
  drawChart(chartN, nctx, [[nLog, 400, '#ff7ab6'], [rLog, 1, '#f5d76e']], 'людей 0–400 (розовая) · в такт 0–100% (жёлтая)', Y => {
    if (nc > 400) return;
    const dpr = window.devicePixelRatio || 1;
    nctx.strokeStyle = 'rgba(255, 122, 182, 0.6)';
    nctx.setLineDash([4 * dpr, 4 * dpr]);
    nctx.lineWidth = dpr;
    nctx.beginPath(); nctx.moveTo(0, Y(nc / 400)); nctx.lineTo(chartN.width, Y(nc / 400)); nctx.stroke();
    nctx.setLineDash([]);
    nctx.fillStyle = '#ff7ab6';
    nctx.fillText('порог Nc', chartN.width - 50 * dpr, Y(nc / 400) - 3 * dpr);
  });
  if (now - lastStats > 300) {
    lastStats = now;
    $('stats').innerHTML = `время <b>${br.t.toFixed(0)} с</b> · людей <b>${br.theta.length}</b> · раскачка <b>±${(br.A * 100).toFixed(1)} см</b>`
      + ` · в такт <b>${Math.round(inStepShare() * 100)}%</b> · критическая толпа по формуле <b>≈ ${Math.round(nc)}</b>`;
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
