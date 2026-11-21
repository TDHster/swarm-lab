// Lampshade without a browser: buildability checks and the numbers quoted on the page. Usage: node tools/smoke.js (~30 s)
const { makeRng } = require('../js/rng.js');
const { RES, Shade, makeMask, outlines, polygonArea } = require('../js/lamp.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const PRESETS = {
  lace: { sensorAngle: 10, sensorDist: 5, turnAngle: 45, decay: 30 },
  fine: { sensorAngle: 10, sensorDist: 3, turnAngle: 45, decay: 30 },
  cells: { sensorAngle: 10, sensorDist: 7, turnAngle: 90, decay: 30 },
  veins: { sensorAngle: 22.5, sensorDist: 7, turnAngle: 90, decay: 20 },
};
const CUT = { open: 0.6, minRib: 2, minHole: 20, rim: 10, seam: 10 };
function grow(pr, steps = 200, seed = 1, size = { diam: 20, height: 25 }) {
  const w = Math.round(Math.PI * size.diam * 10 / RES), h = Math.round(size.height * 10 / RES);
  const s = new Shade({ ...size, agents: Math.round(0.76 * w * h), ...pr }, makeRng(seed));
  for (let k = 0; k < steps; k++) s.step();
  return s;
}
// Every material cell is joined to the rims; rims and seam solid.
function buildable(m) {
  const { mask, w, h } = m, seen = new Uint8Array(w * h), st = [];
  for (let x = 0; x < w; x++) { seen[x] = 1; st.push(x); }
  while (st.length) {
    const c = st.pop(), x = c % w, y = (c - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ny = y + dy; if (ny < 0 || ny >= h) continue;
      const q = ny * w + (x + dx + w) % w;
      if (mask[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
  }
  for (let k = 0; k < w * h; k++) if (mask[k] && !seen[k]) return false;
  for (let x = 0; x < w; x++) if (!mask[x] || !mask[(h - 1) * w + x]) return false;
  for (let y = 0; y < h; y++) if (!mask[y * w]) return false;
  return true;
}
const res = {};
for (const [name, pr] of Object.entries(PRESETS)) {
  const counts = [1, 2, 3].map(seed => {
    const m = makeMask(grow(pr, 200, seed), CUT);
    if (!buildable(m)) return null;
    const L = outlines(m);
    let area = 0; for (const l of L) area += polygonArea(l);
    return { holes: m.stats.holes, open: m.stats.open, loops: L.length, ratio: area / (m.stats.open * m.w * m.h) };
  });
  res[name] = counts;
  check(counts.every(c => c && c.holes >= 25 && c.loops === c.holes && Math.abs(c.ratio - 1) < 0.02),
    `${name}: buildable, ${counts.map(c => c && c.holes).join('/')} cut-outs, open ${counts.map(c => c && Math.round(c.open * 100)).join('/')}%, one cut outline per hole, area ±2%`);
}
check(Math.min(...res.fine.map(c => c.holes)) > Math.max(...res.cells.map(c => c.holes)), 'fine net has more cut-outs than big cells');
// Thicker ribs: fewer, smaller openings.
const s = grow(PRESETS.lace);
const r2 = makeMask(s, CUT), r6 = makeMask(s, { ...CUT, minRib: 6 }), r10 = makeMask(s, { ...CUT, minRib: 10 });
check(r6.stats.open < r2.stats.open && r10.stats.open < r6.stats.open && buildable(r10),
  `ribs 2 / 6 / 10 mm: open ${[r2, r6, r10].map(m => Math.round(m.stats.open * 100)).join(' / ')}%, cut-outs ${[r2, r6, r10].map(m => m.stats.holes).join(' / ')}`);
// Growing longer coarsens the network.
const long = makeMask(grow(PRESETS.lace, 500), CUT);
check(long.stats.holes < r2.stats.holes, `lace after 200 / 500 steps: ${r2.stats.holes} / ${long.stats.holes} cut-outs (the network coarsens)`);
process.exit(failed ? 1 : 0);
