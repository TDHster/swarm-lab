// Drawing only: nothing here changes the swarm.
// The function is precomputed once into a heat map with contour lines; particles are drawn on top,
// moving smoothly from their previous to their current position during one iteration.

const MAP_RES = 480;
const HEAT_STOPS = ['#02070a', '#072830', '#0d4a50', '#1d6e62', '#4f8466', '#8a8456'];
const PSO_COLORS = {
  particle: '#ffffff',
  pbest: 'rgba(220, 239, 231, 0.45)',
  gbest: '#ff7ab6',
  trueMin: '#3ee6b0',
  inertia: '#5bb8ff',
  cognitive: '#f5d76e',
  social: '#ff7ab6',
};

const heatCache = {};

// Low values are dark (the valleys the swarm is looking for); log scale so that both deep pits
// and high ridges are visible. Contour lines every 1/14 of the log range.
function heatMap(fnKey) {
  if (heatCache[fnKey]) return heatCache[fnKey];
  const fn = FUNCTIONS[fnKey], [x0, x1, y0, y1] = fn.range, N = MAP_RES;
  const v = new Float64Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = x0 + (i + 0.5) / N * (x1 - x0), y = y1 - (j + 0.5) / N * (y1 - y0);
      const t = Math.log10(1 + Math.max(0, fn.f(x, y)));
      v[j * N + i] = t;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
  }
  const rgb = HEAT_STOPS.map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(N, N), d = img.data;
  const BANDS = 14, band = k => Math.floor((v[k] - lo) / (hi - lo + 1e-12) * BANDS);
  for (let k = 0; k < N * N; k++) {
    const t = (v[k] - lo) / (hi - lo + 1e-12), f = t * (rgb.length - 1);
    const a = Math.min(rgb.length - 2, Math.floor(f)), u = f - a;
    let shade = 1;
    const i = k % N;
    if ((i < N - 1 && band(k + 1) !== band(k)) || (k + N < N * N && band(k + N) !== band(k))) shade = 0.7;
    for (let c = 0; c < 3; c++) d[k * 4 + c] = (rgb[a][c] + (rgb[a + 1][c] - rgb[a][c]) * u) * shade;
    d[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (heatCache[fnKey] = canvas);
}

function arrowTo(ctx, x, y, dx, dy, color, width) {
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len, uy = dy / len, head = Math.min(9, len * 0.4) * width / 2;
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx - ux * head, y + dy - uy * head);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - ux * head - uy * head * 0.5, y + dy - uy * head + ux * head * 0.5);
  ctx.lineTo(x + dx - ux * head + uy * head * 0.5, y + dy - uy * head - ux * head * 0.5);
  ctx.fill();
}

// t in [0, 1]: how far along the current iteration the animation is.
function drawSwarm(ctx, sw, t, opts) {
  const W = ctx.canvas.width, H = ctx.canvas.height, dpr = opts.dpr;
  const [x0, x1, y0, y1] = sw.fn.range;
  const X = x => (x - x0) / (x1 - x0) * W, Y = y => (y1 - y) / (y1 - y0) * H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heatMap(sw.p.fn), 0, 0, W, H);

  if (opts.showMin) {
    ctx.strokeStyle = PSO_COLORS.trueMin;
    ctx.lineWidth = 2 * dpr;
    for (const [mx, my] of sw.fn.mins) {
      ctx.beginPath();
      ctx.arc(X(mx), Y(my), 9 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (opts.showPbest) {
    ctx.strokeStyle = PSO_COLORS.pbest;
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 0; i < sw.n; i++) {
      const px = X(sw.px[i]), py = Y(sw.py[i]);
      ctx.moveTo(px + 3 * dpr, py);
      ctx.arc(px, py, 3 * dpr, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  // Particles with a short tail along this iteration's move.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  for (let i = 0; i < sw.n; i++) {
    const ax = X(sw.ox[i]), ay = Y(sw.oy[i]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + (X(sw.x[i]) - ax) * t, ay + (Y(sw.y[i]) - ay) * t);
  }
  ctx.stroke();
  ctx.fillStyle = PSO_COLORS.particle;
  ctx.beginPath();
  for (let i = 0; i < sw.n; i++) {
    const ax = X(sw.ox[i]), ay = Y(sw.oy[i]);
    const cx = ax + (X(sw.x[i]) - ax) * t, cy = ay + (Y(sw.y[i]) - ay) * t;
    ctx.moveTo(cx + 3 * dpr, cy);
    ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
  }
  ctx.fill();

  // The swarm's best point.
  const gx = X(sw.gx), gy = Y(sw.gy), s = 8 * dpr;
  ctx.strokeStyle = PSO_COLORS.gbest;
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath();
  ctx.moveTo(gx - s, gy); ctx.lineTo(gx + s, gy);
  ctx.moveTo(gx, gy - s); ctx.lineTo(gx, gy + s);
  ctx.stroke();

  if (opts.showOne && sw.iter > 0) {
    // Particle #0: the three parts of its last velocity, drawn from where it was.
    const fi = sw.focusInfo, ox = X(sw.ox[0]), oy = Y(sw.oy[0]);
    const kx = W / (x1 - x0), ky = -H / (y1 - y0);
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(ox, oy); ctx.lineTo(X(sw.px[0]), Y(sw.py[0]));
    ctx.moveTo(ox, oy); ctx.lineTo(X(fi.guide[0]), Y(fi.guide[1]));
    ctx.stroke();
    ctx.setLineDash([]);
    arrowTo(ctx, ox, oy, fi.inertia[0] * kx, fi.inertia[1] * ky, PSO_COLORS.inertia, 3 * dpr);
    arrowTo(ctx, ox, oy, fi.cognitive[0] * kx, fi.cognitive[1] * ky, PSO_COLORS.cognitive, 3 * dpr);
    arrowTo(ctx, ox, oy, fi.social[0] * kx, fi.social[1] * ky, PSO_COLORS.social, 3 * dpr);
    arrowTo(ctx, ox, oy, X(sw.x[0]) - ox, Y(sw.y[0]) - oy, '#ffffff', 1.5 * dpr);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * dpr;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ox + (X(sw.x[0]) - ox) * t, oy + (Y(sw.y[0]) - oy) * t, 5.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// Convergence: log10 of the best value (yellow, left scale) and the swarm's spread (mint, 0..max).
function drawChart(ctx, history, dpr) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  if (history.length < 2) return;
  const logs = history.map(r => Math.log10(Math.max(1e-12, r.best)));
  let lo = Math.min(...logs), hi = Math.max(...logs);
  lo = Math.floor(lo); hi = Math.max(lo + 1, Math.ceil(hi));
  const sMax = Math.max(1e-9, ...history.map(r => r.spread));
  const pad = 4 * dpr, X = k => k / (history.length - 1) * w;
  ctx.strokeStyle = '#1f3a32';
  ctx.lineWidth = dpr;
  ctx.fillStyle = '#86a89b';
  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  for (let e = lo; e <= hi; e += step) {
    const y = h - pad - (e - lo) / (hi - lo) * (h - 2 * pad);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillText(`1e${e}`, 3 * dpr, Math.max(11 * dpr, y - 2 * dpr));
  }
  const line = (vals, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    vals.forEach((y, k) => (k ? ctx.lineTo(X(k), y) : ctx.moveTo(X(k), y)));
    ctx.stroke();
  };
  line(history.map(r => h - pad - (r.spread / sMax) * (h - 2 * pad)), '#3ee6b0');
  line(logs.map(v => h - pad - (v - lo) / (hi - lo) * (h - 2 * pad)), '#f5d76e');
}
