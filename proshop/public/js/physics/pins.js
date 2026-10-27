// 2-D pin-deck simulation (top view). Circles + impulses: approximate, meant for a believable
// "what would this entry do" picture, not a certified carry predictor.
import { BALL_R, HALF_W, HEAD_PIN_Y, PIN_COL, PIN_M, PIN_R, PIN_ROW, clamp, xToU } from './units.js';

export const PIN_LAYOUT = (() => {
  const out = [];
  let n = 1;
  for (let row = 0; row < 4; row++) for (let j = 0; j <= row; j++) out.push({ n: n++, x: (-row + 2 * j) * PIN_COL, y: HEAD_PIN_Y + row * PIN_ROW });
  return out;
})();
const ADJ = { 1: [2, 3], 2: [1, 3, 4, 5], 3: [1, 2, 5, 6], 4: [2, 5, 7, 8], 5: [2, 3, 4, 6, 8, 9], 6: [3, 5, 9, 10], 7: [4, 8], 8: [4, 5, 7, 9], 9: [5, 6, 8, 10], 10: [6, 9] };

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** entry: {x,y,vx,vy} ball centre state when it reaches the pins (y ~ head pin - contact distance) */
export function simulatePins(entry, ballMassKg, seed = 1, record = false) {
  const rnd = mulberry(seed);
  const jit = () => (rnd() - 0.5) * 0.006;
  const bodies = PIN_LAYOUT.map((p) => ({ n: p.n, x: p.x + jit(), y: p.y + jit(), vx: 0, vy: 0, r: PIN_R, m: PIN_M, down: false, gone: false, hit: false }));
  const ball = { n: 0, x: entry.x + jit(), y: entry.y, vx: entry.vx, vy: entry.vy, r: BALL_R, m: ballMassKg, ball: true };
  const all = [ball, ...bodies];
  const dt = 0.0005;
  const frames = [];
  const KNOCK = 0.45;
  const E_BALL = 0.6, E_PIN = 0.8, DECEL = 1.2;
  const pitY = HEAD_PIN_Y + 3 * PIN_ROW + 0.32;
  for (let step = 0; step < 5200; step++) {
    if (record && step % 20 === 0) frames.push(all.map((b) => [b.x, b.y, b.down ? 1 : 0, b.gone ? 1 : 0]));
    for (const b of all) {
      if (b.gone) continue;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (!b.ball) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) { const ns = Math.max(0, sp - DECEL * dt); b.vx *= ns / sp; b.vy *= ns / sp; }
        if (b.y > pitY || Math.abs(b.x) > HALF_W + 0.1) { b.gone = true; b.down = true; }
        else if (b.down && b.r < PIN_R * 2.3) b.r += 0.00035; // a fallen pin sweeps wider
      }
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.gone || b.gone) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), md = a.r + b.r;
      if (d >= md || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      const pen = md - d, im = 1 / a.m + 1 / b.m;
      a.x -= nx * pen * (1 / a.m) / im; a.y -= ny * pen * (1 / a.m) / im;
      b.x += nx * pen * (1 / b.m) / im; b.y += ny * pen * (1 / b.m) / im;
      if (rel >= 0) continue;
      const e = a.ball || b.ball ? E_BALL : E_PIN;
      const jn = (-(1 + e) * rel) / im;
      a.vx -= (jn * nx) / a.m; a.vy -= (jn * ny) / a.m;
      b.vx += (jn * nx) / b.m; b.vy += (jn * ny) / b.m;
      const speed = -rel;
      for (const p of [a, b]) if (!p.ball) { p.hit = true; if (speed > KNOCK || (a.down || b.down) && speed > KNOCK * 0.5) p.down = true; }
    }
    if (step > 1200 && all.every((b) => b.gone || Math.hypot(b.vx, b.vy) < 0.02)) break;
  }
  const standing = bodies.filter((b) => !b.down).map((b) => b.n);
  if (record) frames.push(all.map((b) => [b.x, b.y, b.down ? 1 : 0, b.gone ? 1 : 0]));
  return { standing, down: 10 - standing.length, leave: leaveName(standing), frames, strike: standing.length === 0 };
}

export function isSplit(standing) {
  if (standing.length < 2 || standing.includes(1)) return false;
  const seen = new Set([standing[0]]); const q = [standing[0]];
  while (q.length) { const c = q.pop(); for (const n of ADJ[c]) if (standing.includes(n) && !seen.has(n)) { seen.add(n); q.push(n); } }
  return seen.size < standing.length || standing.some((s) => !ADJ[s].some((n) => standing.includes(n)) );
}
export function leaveName(standing) {
  if (!standing.length) return 'Strike';
  const s = standing.slice().sort((a, b) => a - b).join('-');
  return (isSplit(standing) ? 'Split ' : '') + (standing.length === 1 ? s + ' pin' : s);
}

/** Monte Carlo strike odds + common leaves. */
export function carryStats(entry, massKg, trials = 24) {
  let strikes = 0, pins = 0; const leaves = {};
  for (let i = 0; i < trials; i++) {
    const r = simulatePins(entry, massKg, 101 + i * 7919);
    if (r.strike) strikes++;
    pins += r.down; leaves[r.leave] = (leaves[r.leave] || 0) + 1;
  }
  const top = Object.entries(leaves).filter(([k]) => k !== 'Strike').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ leave: k, pct: (v / trials) * 100 }));
  return { strikePct: (strikes / trials) * 100, avgPins: pins / trials, top };
}

export function entryFromRun(res) {
  const s = res.samples, i = s.n - 1;
  return { x: s.x[i], y: s.y[i], vx: s.vx[i], vy: s.vy[i] };
}
export { clamp, xToU };
