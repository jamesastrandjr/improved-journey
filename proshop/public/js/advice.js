// Plain-English pro-shop notes derived from the measurements and the simulated throw.
import { gripGeometry, pinBuffer, surfacePoint, pinPosition } from './physics/ball.js';
import { POCKET_BOARD } from './physics/analysis.js';

export function advise(S, run, ball) {
  const out = []; const add = (level, title, text) => out.push({ level, title, text });
  const { profile: p, fitting: f } = S; const m = run?.metrics; const d = f.delivery;

  // ---- fit / measurement sanity ----
  const two = p.style === 'twoHand';
  const wt = +p.bodyWeightLb;
  if (wt) { const rec = Math.min(16, Math.max(6, Math.round(wt / 10))); if (f.ball.weightLb > rec + 1) add('warn', 'Ball weight', `${f.ball.weightLb} lb is heavier than the ~10%-of-body-weight guideline (${rec} lb). A lighter ball can improve speed and reduce strain.`); }
  const h = f.hand;
  if (!two && h.span && h.thumbHole && h.thumbHole > 1.5) add('info', 'Thumb hole', 'Large thumb hole - consider a slug/insert so the thumb releases cleanly without swelling gaps.');
  if (h.gripType === 'fingertip' && h.span < 3.9) add('info', 'Span', 'Fingertip grips normally measure a longer span than conventional. Re-check the span.');
  if (h.fingerSpacing && h.middleHole && h.ringHole && h.fingerSpacing - (h.middleHole + h.ringHole) / 2 < 0.12) add('warn', 'Bridge', 'Finger holes are almost touching (thin bridge). Confirm spacing before drilling.');
  const grip = gripGeometry({ ...h, style: p.style });
  if (ball) { const pb = pinBuffer(ball.pin, grip); if (pb < 0.75) add('warn', 'Pin buffer', `Pin buffer is only ${pb.toFixed(2)}" - under 3/4" the pin sits close to the finger holes (core is weakened and ball may be unstable).`); }
  if (d.source === 'estimated') add('info', 'Estimated numbers', 'Speed, revs, axis and PAP are typical values for this style. Measure them (Specto / camera / radar / PAP finding) for a trustworthy layout.');

  if (!m) return out;
  // ---- reaction ----
  if (run.status === 'gutterOwn') add('warn', 'Line', 'This line puts the ball in the gutter before it can hook. Move the target inside or start further in.');
  else if (run.status === 'gutterFar') add('warn', 'Over-hook', 'The ball hooks across the whole lane and falls off the far side - too much traction for this condition. Consider a weaker surface/cover, or play deeper in the oil.');
  else if (run.status === 'stalled') add('warn', 'Stalled', 'Ball speed is too low to reach the pins.');
  if (run.status === 'pins') {
    const miss = m.entryBoard - POCKET_BOARD;
    if (Math.abs(miss) <= 1) add('good', 'Pocket', `Entry on board ${m.entryBoard.toFixed(1)} - right in the pocket (17.5).`);
    else add('info', 'Line', `Entry on board ${m.entryBoard.toFixed(1)}: ${miss > 0 ? 'high (hits the headpin)' : 'light (3-pin first, 10-pin leaves)'}. Use Auto-aim to find the target that hits the pocket.`);
    if (m.entryAngle < 3) add('warn', 'Entry angle', `Entry angle ${m.entryAngle.toFixed(1)}° is on the low side - weaker carry. A stronger ball, stronger surface, or a more angular layout would add backend.`);
    else if (m.entryAngle > 7.5) add('info', 'Entry angle', `Entry angle ${m.entryAngle.toFixed(1)}° is very high - great carry potential but the ball may be overreacting (less forgiving).`);
    else add('good', 'Entry angle', `Entry angle ${m.entryAngle.toFixed(1)}° is in the productive 4-7° window.`);
  }
  if (m.rollFt > 55) add('warn', 'Length', `Ball does not finish rolling until ~${m.rollFt.toFixed(0)} ft - very long/skiddy. Consider a stronger surface or lower-RG, higher-diff ball.`);
  if (m.skidFt < 14 && f.lane.preset !== 'dry') add('warn', 'Early reaction', `Ball starts hooking by ${m.skidFt.toFixed(0)} ft - it will feel early and may burn up. A weaker/polished surface would give more length.`);
  if (m.flareIn < 2 && ball && ball.diff > 0.02) add('info', 'Flare', `Only ${m.flareIn.toFixed(1)}" of flare. A different pin-to-PAP distance (try 3.25"-4.5") would increase it.`);
  if (m.flareIn > 6.5) add('info', 'Flare', `${m.flareIn.toFixed(1)}" of flare is a lot - good on long patterns, but the ball can lose energy through the lane.`);
  if (d.revRpm / d.speedMph > 28) add('info', 'Rev-to-speed', 'High rev-to-speed ratio - the ball reads the lane early. Slow the ball less or use a smoother cover.');
  if (d.revRpm / d.speedMph < 12) add('info', 'Rev-to-speed', 'Low rev-to-speed ratio - the ball will skid long. Look for more length-friendly traction (strong surface) or a flatter pattern.');
  if (m.speedLossPct > 26) add('warn', 'Speed loss', `The ball loses ${m.speedLossPct.toFixed(0)}% of its speed before the pins - a sign of heavy skidding drag.`);
  return out;
}
export { surfacePoint, pinPosition };
