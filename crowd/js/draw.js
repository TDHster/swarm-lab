// Drawing only: nothing here changes the crowd. World in meters, y down; scale = canvas px per meter.

const CROWD_COLORS = {
  floor: '#040a08',
  wall: '#c9d8d1',
  column: '#5f8f80',
  exit: 'rgba(62, 230, 176, 0.18)',
  exitEdge: '#3ee6b0',
  spawn: 'rgba(220, 239, 231, 0.05)',
  flows: ['#5bb8ff', '#ff7ab6'],
  exits: ['#3ee6b0', '#f5d76e', '#5bb8ff', '#ff7ab6'],
};

// Compression (N/m) → color: calm mint, then yellow, red at the injury level and above.
function pressColor(p) {
  const t = Math.min(1, p / INJURY);
  if (t < 0.05) return '#cfe9df';
  const h = 50 - 50 * t;   // 50 (yellow) → 0 (red)
  return `hsl(${h.toFixed(0)}, 90%, ${(62 - 10 * t).toFixed(0)}%)`;
}

// Heat map from a scalar grid: transparent at 0, then yellow → red; `top` maps to full red.
let heatCanvas = null, heatImage = null;
function drawHeat(ctx, grid, values, top, s) {
  if (!heatCanvas || heatCanvas.width !== grid.W || heatCanvas.height !== grid.H) {
    heatCanvas = document.createElement('canvas');
    heatCanvas.width = grid.W;
    heatCanvas.height = grid.H;
    heatImage = heatCanvas.getContext('2d').createImageData(grid.W, grid.H);
  }
  const d = heatImage.data;
  for (let c = 0; c < values.length; c++) {
    const t = Math.min(1, values[c] / top);
    d[c * 4] = 255;
    d[c * 4 + 1] = Math.round(230 * (1 - t));
    d[c * 4 + 2] = Math.round(80 * (1 - t));
    d[c * 4 + 3] = Math.round(200 * Math.min(1, t * 1.5));
  }
  heatCanvas.getContext('2d').putImageData(heatImage, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heatCanvas, 0, 0, grid.W * grid.cell * s, grid.H * grid.cell * s);
}

// opts: { colorMode: 'press' | 'speed' | 'target', heat: null | { grid, values, top }, preview }
function drawCrowd(ctx, crowd, opts) {
  const s = ctx.canvas.width / WORLD_W, plan = crowd.plan;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = CROWD_COLORS.floor;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const sp of plan.spawns) {
    if (sp.flows) continue;
    ctx.fillStyle = CROWD_COLORS.spawn;
    ctx.fillRect(sp.x0 * s, sp.y0 * s, (sp.x1 - sp.x0) * s, (sp.y1 - sp.y0) * s);
  }
  if (opts.heat) drawHeat(ctx, opts.heat.grid, opts.heat.values, opts.heat.top, s);

  plan.exits.forEach((e, k) => {
    ctx.fillStyle = CROWD_COLORS.exit;
    ctx.strokeStyle = CROWD_COLORS.exits[k % 4];
    ctx.lineWidth = Math.max(1, 0.04 * s);
    ctx.fillRect(e.x0 * s, e.y0 * s, (e.x1 - e.x0) * s, (e.y1 - e.y0) * s);
    ctx.strokeRect(e.x0 * s, e.y0 * s, (e.x1 - e.x0) * s, (e.y1 - e.y0) * s);
    ctx.fillStyle = CROWD_COLORS.exits[k % 4];
    ctx.font = `${Math.max(10, 0.4 * s)}px system-ui, sans-serif`;
    ctx.fillText(`${e.label || 'выход'} ${crowd.out[k] ? crowd.out[k].length : 0}`, e.x0 * s, e.y0 * s - 0.15 * s);
  });

  ctx.strokeStyle = CROWD_COLORS.wall;
  ctx.lineWidth = Math.max(2, 0.15 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const w of plan.walls) { ctx.moveTo(w.x1 * s, w.y1 * s); ctx.lineTo(w.x2 * s, w.y2 * s); }
  ctx.stroke();
  ctx.fillStyle = CROWD_COLORS.column;
  for (const c of plan.columns) {
    ctx.beginPath();
    ctx.arc(c.x * s, c.y * s, c.r * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // People: true size, colored by the chosen mode, with a short line showing where they walk.
  for (let i = 0; i < crowd.n; i++) {
    let color;
    if (opts.colorMode === 'speed') {
      const t = Math.min(1, Math.hypot(crowd.vx[i], crowd.vy[i]) / Math.max(0.5, crowd.p.v0));
      color = `hsl(${(210 - 50 * t).toFixed(0)}, 80%, ${(35 + 35 * t).toFixed(0)}%)`;
    } else if (opts.colorMode === 'target') {
      color = plan.flows ? CROWD_COLORS.flows[crowd.target[i] % 2]
        : crowd.target[i] < 0 ? '#dcefe7' : CROWD_COLORS.exits[crowd.target[i] % 4];
    } else {
      color = pressColor(crowd.pressAvg[i]);
    }
    const x = crowd.x[i] * s, y = crowd.y[i] * s, r = crowd.r[i] * s;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = Math.max(1, 0.05 * s);
  ctx.beginPath();
  for (let i = 0; i < crowd.n; i++) {
    const x = crowd.x[i] * s, y = crowd.y[i] * s, r = crowd.r[i] * s * 0.8;
    ctx.moveTo(x, y);
    ctx.lineTo(x + crowd.ex[i] * r, y + crowd.ey[i] * r);
  }
  ctx.stroke();

  const pv = opts.preview;   // shape being drawn with the constructor tools
  if (pv) {
    ctx.strokeStyle = '#ff7ab6';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (pv.kind === 'line') { ctx.moveTo(pv.x0 * s, pv.y0 * s); ctx.lineTo(pv.x1 * s, pv.y1 * s); }
    else ctx.rect(Math.min(pv.x0, pv.x1) * s, Math.min(pv.y0, pv.y1) * s, Math.abs(pv.x1 - pv.x0) * s, Math.abs(pv.y1 - pv.y0) * s);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Line chart: series = [{ values, color }], shared y from `bottom` to `top`; x from 0 to tMax.
function drawLines(ctx, series, tMax, top, label, bottom = 0, xUnit = ' с') {
  const w = ctx.canvas.width, h = ctx.canvas.height, dpr = w / (ctx.canvas.clientWidth || w);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#86a89b';
  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  ctx.fillText(label, 4 * dpr, 12 * dpr);
  ctx.fillText(`${tMax.toFixed(0)}${xUnit}`, w - 44 * dpr, h - 4 * dpr);
  if (bottom) ctx.fillText(bottom.toFixed(0), 4 * dpr, h - 4 * dpr);
  for (const sr of series) {
    if (sr.values.length < 2) continue;
    ctx.strokeStyle = sr.color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    sr.values.forEach(([t, v], k) => {
      const x = t / Math.max(1e-9, tMax) * w, y = h - 3 * dpr - (v - bottom) / Math.max(1e-9, top - bottom) * (h - 18 * dpr);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}
