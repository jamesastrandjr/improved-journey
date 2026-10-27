// Turns the saved form data (profile + fitting) into a physics configuration.

import { buildBall } from './physics/ball.js';
import { buildLane, PATTERN_PRESETS } from './physics/lane.js';
import { clamp } from './physics/units.js';

const laneCache = new Map();

export function laneFrom(l) {
  const preset = PATTERN_PRESETS.find((p) => p.id === l.preset) || PATTERN_PRESETS[0];
  const pattern = l.preset === 'custom'
    ? { lengthFt: l.lengthFt, volumeMl: l.volumeMl, ratio: l.ratio, shape: l.shape, taper: l.taper, bufferFt: 3 }
    : preset.params;
  const key = JSON.stringify([pattern, l.surface, l.games]);
  let lane = laneCache.get(key);
  if (!lane) {
    lane = buildLane(pattern, { games: l.games, surface: l.surface });
    if (laneCache.size > 24) laneCache.clear();
    laneCache.set(key, lane);
  }
  return lane;
}

export function buildConfig(profile, f, overrides = {}) {
  const d = { ...f.delivery, ...(overrides.delivery || {}) };
  const layout = { ...f.layout, ...(overrides.layout || {}) };
  const ballSpec = { ...f.ball, ...(overrides.ball || {}) };
  const ball = buildBall(ballSpec, layout, d);
  const lane = laneFrom({ ...f.lane, ...(overrides.lane || {}) });
  return {
    hand: profile.hand === 'L' ? 'L' : 'R',
    ball,
    lane,
    ballOil: clamp(f.lane.ballOil ?? 0, 0, 1),
    delivery: {
      speedMph: clamp(+d.speedMph || 17, 5, 30),
      revRpm: clamp(+d.revRpm || 300, 20, 800),
      tiltDeg: clamp(+d.axisTilt || 0, 0, 80),
      rotDeg: clamp(+d.axisRotation || 0, 0, 90),
      loftFt: clamp(+d.loftFt || 3, 0.5, 8),
      startBoard: clamp(+d.startBoard || 15, 1, 39),
      targetBoard: clamp(+d.targetBoard || 10, 1, 39),
      phaseDeg: +d.releasePhase || 0,
    },
  };
}
