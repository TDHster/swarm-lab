// Drawing only: nothing here changes the mold.
// The trail map is colored through a lookup table (1024 colors) into an image of the map's size,
// then stretched over the canvas. Food points and the "one particle" view go on an overlay.

const PALETTES = {
  slime: { label: 'слизевик', stops: ['#040a08', '#3a2a06', '#c8961e', '#f5d76e', '#fffbe6'] },
  mint: { label: 'мята', stops: ['#040a08', '#073a2c', '#18a37a', '#3ee6b0', '#eafff7'] },
  neon: { label: 'неон', stops: ['#06030c', '#3a0d5c', '#b03aa8', '#ff7ab6', '#fff0f7'] },
  ice: { label: 'лёд', stops: ['#03060c', '#0b2a5a', '#2a7fd0', '#7fd6ff', '#f2fbff'] },
};
const LUT_SIZE = 1024;

const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// Packed RGBA (little-endian: 0xAABBGGRR) for each LUT index; brightness follows 1 - e^(-4x).
function buildLut(stops) {
  const rgb = stops.map(hexRgb), lut = new Uint32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (1 - Math.exp(-4 * i / (LUT_SIZE - 1))) / (1 - Math.exp(-4));
    const f = t * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(f)), u = f - k;
    const c = [0, 1, 2].map(j => Math.round(rgb[k][j] + (rgb[k + 1][j] - rgb[k][j]) * u));
    lut[i] = (255 << 24 | c[2] << 16 | c[1] << 8 | c[0]) >>> 0;
  }
  return lut;
}

const lutCache = {};
let mapCanvas = null, mapImage = null, mapPixels = null;

// gain: trail value that maps to the brightest color.
function drawTrail(ctx, mold, paletteKey, gain) {
  const w = mold.w, h = mold.h;
  if (!mapCanvas) {
    mapCanvas = document.createElement('canvas');
    mapCanvas.width = w;
    mapCanvas.height = h;
    mapImage = mapCanvas.getContext('2d').createImageData(w, h);
    mapPixels = new Uint32Array(mapImage.data.buffer);
  }
  const lut = lutCache[paletteKey] || (lutCache[paletteKey] = buildLut(PALETTES[paletteKey].stops));
  const T = mold.trail, k = (LUT_SIZE - 1) / gain, top = LUT_SIZE - 1;
  for (let i = 0; i < T.length; i++) {
    const v = (T[i] * k) | 0;
    mapPixels[i] = lut[v > top ? top : v];
  }
  mapCanvas.getContext('2d').putImageData(mapImage, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mapCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Food points and, optionally, particle #0 with its three sensors (the strongest one is highlighted).
function drawOverlay(ctx, mold, showOne) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const s = ctx.canvas.width / mold.w;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.strokeStyle = '#ff7ab6';
  ctx.lineWidth = 3 / s;
  for (const f of mold.food) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (!showOne) return;

  const p = mold.p, x = mold.x[0], y = mold.y[0], a = mold.a[0];
  const sa = p.sensorAngle * Math.PI / 180, so = p.sensorDist;
  const sensors = [-sa, 0, sa].map(d => {
    const sx = x + Math.cos(a + d) * so, sy = y + Math.sin(a + d) * so;
    const ix = ((sx | 0) % mold.w + mold.w) % mold.w, iy = ((sy | 0) % mold.h + mold.h) % mold.h;
    return { x: sx, y: sy, v: mold.trail[iy * mold.w + ix] };
  });
  const best = Math.max(...sensors.map(q => q.v));
  ctx.lineWidth = 2 / s;
  for (const q of sensors) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.fillStyle = q.v === best ? '#ff7ab6' : 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(q.x, q.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.stroke();
}
