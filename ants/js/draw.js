// Drawing only: nothing here changes the colony.
// The grid (pheromones, walls, food) is painted into a small offscreen image, one pixel per cell,
// and stretched over the field. Ants and the nest go on top at full resolution.

const ANT_COLORS = {
  bg: [4, 10, 8],
  home: [91, 184, 255],     // "to home" pheromone
  food: [255, 122, 182],    // "to food" pheromone
  wall: [24, 40, 34],
  foodPile: [245, 215, 110],
  ant: '#dcefe7',
  antCarrying: '#f5d76e',
  nest: '#8a5a32',
  nestEdge: '#d8b98a',
};

let gridImage = null, gridCanvas = null;

function drawGrid(ctx, colony, showHome, showFood) {
  const w = colony.w, h = colony.h;
  if (!gridCanvas || gridCanvas.width !== w) {
    gridCanvas = document.createElement('canvas');
    gridCanvas.width = w;
    gridCanvas.height = h;
    gridImage = gridCanvas.getContext('2d').createImageData(w, h);
  }
  const d = gridImage.data, C = ANT_COLORS, bg = C.bg;
  for (let k = 0, o = 0; k < w * h; k++, o += 4) {
    let r = bg[0], g = bg[1], b = bg[2];
    if (colony.walls[k]) {
      r = C.wall[0]; g = C.wall[1]; b = C.wall[2];
    } else if (colony.foodAmount[k] > 0) {
      const t = 0.45 + 0.55 * Math.min(1, colony.foodAmount[k] / 60);
      r = C.foodPile[0] * t; g = C.foodPile[1] * t; b = C.foodPile[2] * t;
    } else {
      // 1 - e^(-v): faint traces stay visible, busy trails do not burn out to white.
      if (showHome) {
        const t = (1 - Math.exp(-colony.home[k] * 0.8)) * 0.75;
        r += C.home[0] * t; g += C.home[1] * t; b += C.home[2] * t;
      }
      if (showFood) {
        const t = (1 - Math.exp(-colony.food[k] * 0.8)) * 0.75;
        r += C.food[0] * t; g += C.food[1] * t; b += C.food[2] * t;
      }
    }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;   // Uint8Clamped: overflow clamps at 255
  }
  gridCanvas.getContext('2d').putImageData(gridImage, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(gridCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawAnts(ctx, colony, showAnts) {
  const s = ctx.canvas.width / colony.w;   // canvas pixels per cell
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const nest = colony.nest;
  ctx.fillStyle = ANT_COLORS.nest;
  ctx.strokeStyle = ANT_COLORS.nestEdge;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(nest.x, nest.y, nest.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (!showAnts) return;

  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  for (const carrying of [0, 1]) {
    ctx.strokeStyle = carrying ? ANT_COLORS.antCarrying : ANT_COLORS.ant;
    ctx.beginPath();
    for (let i = 0; i < colony.n; i++) {
      if (colony.carrying[i] !== carrying || colony.wait[i] > 0) continue;
      const x = colony.x[i], y = colony.y[i], dx = Math.cos(colony.a[i]) * 0.9, dy = Math.sin(colony.a[i]) * 0.9;
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
    }
    ctx.stroke();
  }
}

// Food delivered per second, newest on the right; light line - raw, bold - 5 s average.
function drawChart(ctx, perSecond, maxLen) {
  const w = ctx.canvas.width, h = ctx.canvas.height, dpr = w / (ctx.canvas.clientWidth || w);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#040a08';
  ctx.fillRect(0, 0, w, h);
  const top = Math.max(10, ...perSecond) * 1.1;
  ctx.fillStyle = '#86a89b';
  ctx.font = `${11 * dpr}px system-ui, sans-serif`;
  ctx.fillText(`${Math.round(top)}/с`, 4 * dpr, 12 * dpr);
  if (perSecond.length < 2) return;
  const off = maxLen - perSecond.length;
  const px = k => (off + k) / (maxLen - 1) * w, py = v => h - v / top * (h - 4 * dpr) - 2 * dpr;
  ctx.strokeStyle = 'rgba(245, 215, 110, 0.35)';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  perSecond.forEach((v, k) => (k ? ctx.lineTo(px(k), py(v)) : ctx.moveTo(px(k), py(v))));
  ctx.stroke();
  ctx.strokeStyle = '#f5d76e';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  perSecond.forEach((_, k) => {
    const from = Math.max(0, k - 4), part = perSecond.slice(from, k + 1);
    const v = part.reduce((a, b) => a + b, 0) / part.length;
    if (k) ctx.lineTo(px(k), py(v)); else ctx.moveTo(px(k), py(v));
  });
  ctx.stroke();
}
