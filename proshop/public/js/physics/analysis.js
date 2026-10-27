import { simulate } from './sim.js';
import { buildBall } from './ball.js';

export const POCKET_BOARD = 17.5;

/** find target board at the arrows that puts the ball in the pocket. Returns {target, result} or null. */
export function autoAim(makeCfg, startBoard, { step = 1 } = {}) {
  const run = (t) => { const cfg = makeCfg(t); return simulate(cfg, { dt: 0.001, recordEvery: 8 }); };
  const score = (r) => (r.status === 'pins' ? r.metrics.entryBoard - POCKET_BOARD : r.status === 'gutterFar' ? 30 : -30);
  let best = null;
  let prev = null;
  for (let t = 2; t <= 30; t += step) {
    const r = run(t); const sc = score(r);
    if (prev && Math.sign(prev.sc) !== Math.sign(sc) && Math.abs(prev.sc) < 30 && Math.abs(sc) < 30) {
      let lo = prev.t, hi = t, slo = prev.sc;
      for (let k = 0; k < (step > 1 ? 5 : 7); k++) { const mid = (lo + hi) / 2; const sm = score(run(mid)); if (Math.sign(sm) === Math.sign(slo)) { lo = mid; slo = sm; } else hi = mid; }
      const tt = Math.round(((lo + hi) / 2) * 10) / 10; const rr = run(tt);
      const cand = { target: tt, result: rr, err: Math.abs(score(rr)) };
      if (!best || cand.result.metrics.entryAngle > best.result.metrics.entryAngle + 0.3) best = cand;
    }
    prev = { t, sc };
  }
  if (!best) return null;
  return { target: best.target, err: best.err };
}
export { buildBall };
