// String art without a browser: the numbers quoted on the page (S = 300 as on the page). Usage: node tools/smoke.js (~1 min)
const { makeRng } = require('../js/rng.js');
const { makeTarget, StringArt } = require('../js/stringart.js');

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const S = 300, base = { nails: 200, opacity: 0.15, minSkip: 10, method: 'greedy', ants: 8, depth: 3 };
function run(pic, over = {}) {
  const a = new StringArt(makeTarget(pic, S), S, { ...base, ...over }, makeRng(1));
  const e0 = a.error(), t0 = Date.now();
  while (a.step());
  return { lines: a.seq.length - 1, e0, e: a.error(), ms: Date.now() - t0, a };
}
const g = {};
for (const pic of ['heart', 'face', 'spiral', 'sun']) {
  g[pic] = run(pic);
  const r = g[pic];
  check(r.e < r.e0 / 2 && r.a.used.size === r.lines, `${pic}: stops by itself after ${r.lines} threads, error ${r.e0.toFixed(3)} → ${r.e.toFixed(3)}, no chord twice`);
}
check(g.heart.lines > 850 && g.heart.lines < 1100 && g.face.lines < 800 && g.sun.lines < 450 && g.spiral.lines > 900,
  `heart ~970, face ~680, sun ~380, spiral ~1000 threads: ${g.heart.lines} / ${g.face.lines} / ${g.sun.lines} / ${g.spiral.lines}`);
let worst = 0, slow = Infinity;
for (const pic of ['heart', 'face', 'spiral', 'sun']) {
  const r = run(pic, { method: 'ants' });
  worst = Math.max(worst, Math.abs(r.e / g[pic].e - 1));
  slow = Math.min(slow, r.ms / Math.max(1, g[pic].ms));
  console.log(`      ants ${pic}: ${r.lines} threads, error ${r.e.toFixed(4)} vs greedy ${g[pic].e.toFixed(4)}`);
}
check(worst < 0.03 && slow > 5, `the colony is no better than greedy (max difference ${(worst * 100).toFixed(1)}%) and ≥ ${slow.toFixed(0)}× slower`);
const thick = run('heart', { opacity: 0.3 }), thin = run('heart', { opacity: 0.075 });
check(thick.lines < g.heart.lines && thin.lines > g.heart.lines, `thread opacity 0.3 / 0.15 / 0.075: ${thick.lines} / ${g.heart.lines} / ${thin.lines} threads`);
process.exit(failed ? 1 : 0);
