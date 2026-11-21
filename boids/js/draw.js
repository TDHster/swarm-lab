// Drawing only: nothing here changes the flock.
// Two stacked canvases: `trail` keeps fading copies of old frames (the trails),
// `overlay` is cleared every frame (obstacles, predator, the focused boid's forces).

const COLORS = {
  bg: '4, 10, 8',            // rgb of the field background, used for the trail fade
  boid: '#3ee6b0',
  obstacle: '#2a4a40',
  obstacleEdge: '#5f8f80',
  predator: '#ff7ab6',
  vision: '#dcefe7',
  sep: '#ff6b5e',
  ali: '#5bb8ff',
  coh: '#f5d76e',
  flee: '#ff7ab6',
  total: '#ffffff',
};
const HUE_BUCKETS = 24;
const BOID_LEN = 7, BOID_HALF_W = 3;

// Draw one triangle per boid pointing along its velocity, all of one color in a single path.
function addBoidPath(ctx, flock, i) {
  const x = flock.x[i], y = flock.y[i];
  const s = Math.hypot(flock.vx[i], flock.vy[i]) || 1;
  const ux = flock.vx[i] / s, uy = flock.vy[i] / s;
  ctx.moveTo(x + ux * BOID_LEN, y + uy * BOID_LEN);
  ctx.lineTo(x - ux * BOID_LEN * 0.5 - uy * BOID_HALF_W, y - uy * BOID_LEN * 0.5 + ux * BOID_HALF_W);
  ctx.lineTo(x - ux * BOID_LEN * 0.5 + uy * BOID_HALF_W, y - uy * BOID_LEN * 0.5 - ux * BOID_HALF_W);
  ctx.closePath();
}

// colorMode: 'mint' | 'heading' (hue = flight direction) | 'neighbors' (brighter = more neighbors).
function drawBoids(ctx, flock, scale, trails, colorMode) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(${COLORS.bg}, ${(1 - trails).toFixed(3)})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  if (colorMode === 'mint') {
    ctx.fillStyle = COLORS.boid;
    ctx.beginPath();
    for (let i = 0; i < flock.n; i++) addBoidPath(ctx, flock, i);
    ctx.fill();
    return;
  }
  // Group boids into buckets so each color is one fill call (thousands of fills would be slow).
  const buckets = Array.from({ length: HUE_BUCKETS }, () => []);
  for (let i = 0; i < flock.n; i++) {
    let b;
    if (colorMode === 'heading') {
      const a = Math.atan2(flock.vy[i], flock.vx[i]);
      b = Math.floor((a + Math.PI) / (2 * Math.PI) * HUE_BUCKETS) % HUE_BUCKETS;
    } else {
      b = Math.min(HUE_BUCKETS - 1, Math.floor(flock.nbCount[i] / 2));
    }
    buckets[b].push(i);
  }
  for (let b = 0; b < HUE_BUCKETS; b++) {
    if (!buckets[b].length) continue;
    const t = b / (HUE_BUCKETS - 1);
    ctx.fillStyle = colorMode === 'heading'
      ? `hsl(${Math.round(b * 360 / HUE_BUCKETS)}, 80%, 62%)`
      : `hsl(${Math.round(200 - 50 * t)}, 85%, ${Math.round(30 + 45 * t)}%)`;
    ctx.beginPath();
    for (const i of buckets[b]) addBoidPath(ctx, flock, i);
    ctx.fill();
  }
}

function arrow(ctx, x, y, dx, dy, color, width) {
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len, uy = dy / len, head = Math.min(6, len * 0.4);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
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

// The focused boid: its field of view, personal space, the neighbors it sees and the four forces.
// Forces are tiny (fractions of a pixel per frame), so they are drawn magnified.
function drawFocus(ctx, flock) {
  const i = flock.focus, p = flock.p, fi = flock.focusInfo;
  const x = flock.x[i], y = flock.y[i];
  const heading = Math.atan2(flock.vy[i], flock.vx[i]);
  const half = Math.min(Math.PI, p.fov * Math.PI / 360);
  const vision = Math.min(150, p.vision);

  ctx.fillStyle = 'rgba(220, 239, 231, 0.07)';
  ctx.strokeStyle = 'rgba(220, 239, 231, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (half < Math.PI) ctx.moveTo(x, y);
  ctx.arc(x, y, vision, heading - half, heading + half);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = COLORS.sep;
  ctx.beginPath();
  ctx.arc(x, y, Math.min(vision, p.personal), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(220, 239, 231, 0.35)';
  ctx.beginPath();
  for (const j of fi.neighbors) {
    let dx = flock.x[j] - x, dy = flock.y[j] - y;
    if (p.edges === 'wrap') {   // draw the line the short way, through the edge
      if (dx > flock.w / 2) dx -= flock.w; else if (dx < -flock.w / 2) dx += flock.w;
      if (dy > flock.h / 2) dy -= flock.h; else if (dy < -flock.h / 2) dy += flock.h;
    }
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.vision;
  for (const j of fi.neighbors) {
    ctx.beginPath();
    ctx.arc(flock.x[j], flock.y[j], 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const k = 300;   // force magnification for drawing
  arrow(ctx, x, y, fi.sep[0] * k, fi.sep[1] * k, COLORS.sep, 2);
  arrow(ctx, x, y, fi.ali[0] * k, fi.ali[1] * k, COLORS.ali, 2);
  arrow(ctx, x, y, fi.coh[0] * k, fi.coh[1] * k, COLORS.coh, 2);
  arrow(ctx, x, y, fi.flee[0] * k, fi.flee[1] * k, COLORS.flee, 2);
  arrow(ctx, x, y, fi.total[0] * k, fi.total[1] * k, COLORS.total, 1.2);

  ctx.fillStyle = COLORS.total;
  ctx.beginPath();
  addBoidPath(ctx, flock, i);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawOverlay(ctx, flock, scale, showFocus) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  for (const o of flock.obstacles) {
    ctx.fillStyle = COLORS.obstacle;
    ctx.strokeStyle = COLORS.obstacleEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const pr = flock.predator;
  if (pr) {
    ctx.strokeStyle = 'rgba(255, 122, 182, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.predator;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  if (showFocus) drawFocus(ctx, flock);
}

// Order over time: 0..1 line chart, newest on the right.
function drawChart(ctx, history, maxLen) {
  const w = ctx.canvas.width, h = ctx.canvas.height, dpr = w / ctx.canvas.clientWidth || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1f3a32';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  for (const v of [0.25, 0.5, 0.75]) { ctx.moveTo(0, h * (1 - v)); ctx.lineTo(w, h * (1 - v)); }
  ctx.stroke();
  ctx.fillStyle = '#86a89b';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText('1', 4 * dpr, 12 * dpr);
  ctx.fillText('0.5', 4 * dpr, h / 2 - 3 * dpr);
  if (history.length < 2) return;
  ctx.strokeStyle = COLORS.boid;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  const off = maxLen - history.length;
  history.forEach((v, k) => {
    const px = (off + k) / (maxLen - 1) * w, py = (1 - v) * (h - 4 * dpr) + 2 * dpr;
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
}
