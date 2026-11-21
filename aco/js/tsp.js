// The delivery round (travelling salesman): city maps and the classic non-swarm methods to compare with.
// No DOM here (runs in Node too). Points are in a 120 x 70 km area; index 0 is the depot.

const AREA_W = 120;
const AREA_H = 70;

// kind: 'random' | 'clusters' | 'circle' | 'grid'
function makeCities(kind, n, rng) {
  const pts = [{ x: AREA_W / 2, y: AREA_H / 2 }];   // depot in the middle
  if (kind === 'circle') {
    for (let k = 0; k < n; k++) {
      const a = Math.PI * 2 * k / n;
      pts.push({ x: AREA_W / 2 + Math.cos(a) * 30, y: AREA_H / 2 + Math.sin(a) * 30 });
    }
    pts[0] = { x: AREA_W / 2 + 30, y: AREA_H / 2 - 4 };   // depot on the ring, a little aside
  } else if (kind === 'grid') {
    const cols = Math.ceil(Math.sqrt(n * AREA_W / AREA_H)), rows = Math.ceil(n / cols);
    for (let k = 0; k < n; k++) {
      pts.push({ x: 10 + (k % cols) * (AREA_W - 20) / Math.max(1, cols - 1), y: 8 + Math.floor(k / cols) * (AREA_H - 16) / Math.max(1, rows - 1) });
    }
  } else if (kind === 'clusters') {
    const centers = Array.from({ length: 5 }, () => ({ x: 12 + rng() * (AREA_W - 24), y: 10 + rng() * (AREA_H - 20) }));
    for (let k = 0; k < n; k++) {
      const c = centers[k % centers.length], r = Math.sqrt(rng()) * 7, a = rng() * Math.PI * 2;
      pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
  } else {
    for (let k = 0; k < n; k++) pts.push({ x: 4 + rng() * (AREA_W - 8), y: 4 + rng() * (AREA_H - 8) });
  }
  return pts;
}

function distanceMatrix(pts) {
  const n = pts.length, d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i * n + j] = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
  return d;
}

// Length of a closed tour (array of point indices, the return to the start is implied).
function tourLength(tour, d, n) {
  let s = 0;
  for (let k = 0; k < tour.length; k++) s += d[tour[k] * n + tour[(k + 1) % tour.length]];
  return s;
}

// Greedy: from the depot, always drive to the nearest address not visited yet.
function greedyTour(d, n) {
  const used = new Uint8Array(n), tour = [0];
  used[0] = 1;
  for (let k = 1; k < n; k++) {
    const last = tour[tour.length - 1];
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) if (!used[j] && d[last * n + j] < bd) { bd = d[last * n + j]; best = j; }
    tour.push(best);
    used[best] = 1;
  }
  return tour;
}

// 2-opt: while reversing some piece of the tour makes it shorter, do it. Removes all crossings.
function twoOpt(tour, d, n) {
  const t = tour.slice(), m = t.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < m - 1; i++) {
      for (let j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue;
        const a = t[i], b = t[i + 1], c = t[j], e = t[(j + 1) % m];
        const delta = d[a * n + c] + d[b * n + e] - d[a * n + b] - d[c * n + e];
        if (delta < -1e-9) {
          for (let l = i + 1, r = j; l < r; l++, r--) { const x = t[l]; t[l] = t[r]; t[r] = x; }
          improved = true;
        }
      }
    }
  }
  return t;
}

// Exact optimum by dynamic programming over subsets (Held-Karp): only for small maps (n ≤ 14 points).
function heldKarp(d, n) {
  if (n > 14) return null;
  const FULL = 1 << (n - 1), dp = new Float64Array(FULL * n).fill(Infinity), from = new Int8Array(FULL * n).fill(-1);
  for (let j = 1; j < n; j++) dp[(1 << (j - 1)) * n + j] = d[j];
  for (let mask = 1; mask < FULL; mask++) {
    for (let j = 1; j < n; j++) {
      const v = dp[mask * n + j];
      if (!(mask & (1 << (j - 1))) || v === Infinity) continue;
      for (let k = 1; k < n; k++) {
        if (mask & (1 << (k - 1))) continue;
        const nm = mask | (1 << (k - 1)), nv = v + d[j * n + k];
        if (nv < dp[nm * n + k]) { dp[nm * n + k] = nv; from[nm * n + k] = j; }
      }
    }
  }
  let best = Infinity, last = -1;
  for (let j = 1; j < n; j++) { const v = dp[(FULL - 1) * n + j] + d[j * n]; if (v < best) { best = v; last = j; } }
  const tour = [];
  let mask = FULL - 1;
  while (last > 0) { tour.push(last); const p = from[mask * n + last]; mask &= ~(1 << (last - 1)); last = p; }
  tour.push(0);
  return tour.reverse();
}

if (typeof module !== 'undefined') module.exports = { AREA_W, AREA_H, makeCities, distanceMatrix, tourLength, greedyTour, twoOpt, heldKarp };
