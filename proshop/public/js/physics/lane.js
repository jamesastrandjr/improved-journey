// Lane + oil-pattern model.
//
// The oil pattern is a 2-D thickness field T(board, distance). 1.0 ~= the centre of a typical
// 24 mL / 40 ft league "house" shot. Friction comes from how much of the ball's contact patch
// is covered by oil: coverage = 1 - exp(-T / T0).  This is a deliberately simple, explainable
// model - it is NOT a measurement of a real lane machine's output.

import { BOARDS, clamp, smoothstep } from './units.js';

export const OIL_T0 = 0.4;
const STEP_FT = 0.5;
const NODES_U = BOARDS * 2 + 1; // half-board resolution
const NODES_Y = Math.round(66 / STEP_FT) + 1; // 0..66 ft

export const PATTERN_PRESETS = [
  {
    id: 'house',
    name: 'House shot (typical league)',
    desc: 'Heavy in the middle, very little oil on the outside boards - forgiving, rewards hitting the "track" area.',
    params: { lengthFt: 40, volumeMl: 24, ratio: 10, shape: 'house', taper: 0.8, bufferFt: 3 },
  },
  {
    id: 'houseHeavy',
    name: 'Heavy house (fresh, high volume)',
    desc: 'More oil everywhere. Balls skid longer - typical of a freshly oiled lane.',
    params: { lengthFt: 42, volumeMl: 30, ratio: 8, shape: 'house', taper: 0.72, bufferFt: 3 },
  },
  {
    id: 'houseShort',
    name: 'Short house (36 ft)',
    desc: 'Shorter oil means an earlier and stronger reaction.',
    params: { lengthFt: 36, volumeMl: 22, ratio: 10, shape: 'house', taper: 0.8, bufferFt: 3 },
  },
  {
    id: 'sportShort',
    name: 'Sport - short (35 ft, flat)',
    desc: 'Flat pattern, little room for error. Ball must be played closer to the oil line.',
    params: { lengthFt: 35, volumeMl: 22, ratio: 2, shape: 'flat', taper: 0.9, bufferFt: 2 },
  },
  {
    id: 'sportMedium',
    name: 'Sport - medium (39 ft, flat)',
    desc: 'Flat pattern with a medium length.',
    params: { lengthFt: 39, volumeMl: 25, ratio: 2, shape: 'flat', taper: 0.9, bufferFt: 2 },
  },
  {
    id: 'sportLong',
    name: 'Sport - long (45 ft, flat)',
    desc: 'Long and flat. Needs a lot of ball speed/rev to get the ball to turn.',
    params: { lengthFt: 45, volumeMl: 28, ratio: 2, shape: 'flat', taper: 0.92, bufferFt: 2 },
  },
  {
    id: 'reverse',
    name: 'Reverse block',
    desc: 'More oil outside than inside - the "inside" lines are dry and grabby, outside lines skid.',
    params: { lengthFt: 40, volumeMl: 26, ratio: 4, shape: 'reverse', taper: 0.8, bufferFt: 3 },
  },
  {
    id: 'dry',
    name: 'Bone-dry lane (no oil)',
    desc: 'Worst case for a drilling check: a lane that has had no oil applied. Balls hook very early.',
    params: { lengthFt: 0, volumeMl: 0, ratio: 1, shape: 'flat', taper: 1, bufferFt: 1 },
  },
  {
    id: 'custom',
    name: 'Custom pattern',
    desc: 'Set your own length, volume, ratio and shape.',
    params: { lengthFt: 40, volumeMl: 24, ratio: 10, shape: 'house', taper: 0.8, bufferFt: 3 },
  },
];

export const SURFACES = {
  synthetic: { label: 'Synthetic (HPL / urethane-coated)', dry: 1.0 },
  wood: { label: 'Wood', dry: 0.93 },
};

function plateauFor(shape) {
  if (shape === 'flat') return [0.78, 1.0];
  if (shape === 'reverse') return [0.28, 0.8];
  return [0.3, 0.82]; // house
}

/** raw (un-normalised) oil thickness at continuous board position u and distance yFt */
function rawThickness(p, u, yFt) {
  if (p.lengthFt <= 0 || p.volumeMl <= 0) return 0;
  const a = Math.abs((u - 19.5) / 19.5); // 0 centre .. 1 gutter
  const [e0, e1] = plateauFor(p.shape);
  const plateau = 1 - smoothstep(e0, e1, a);
  const lo = 1 / Math.max(1, p.ratio);
  let lat;
  if (p.shape === 'reverse') lat = lo + (1 - lo) * (1 - plateau);
  else lat = lo + (1 - lo) * plateau;
  lat *= 1 - smoothstep(0.9, 1.0, a); // gutter boards never get much oil

  // length: shorter oil on the outside (the "tree" shape)
  const taper = clamp(p.taper ?? 0.5, 0.2, 1);
  const plateauL = 1 - smoothstep(0.45, 0.95, a);
  const endLen = p.lengthFt * (taper + (1 - taper) * plateauL);
  if (yFt >= endLen + 0.5) return 0;
  const buf = Math.max(0.5, p.bufferFt ?? 3);
  const fade = 1 - smoothstep(endLen - buf, endLen + 0.5, yFt);
  const front = yFt < endLen * 0.6 ? 1 : 1 - 0.45 * ((yFt - endLen * 0.6) / (endLen * 0.4));
  return lat * front * fade;
}

let refIntegral = null;
function integralOf(p) {
  let s = 0;
  for (let i = 0; i < NODES_U; i++) {
    for (let j = 0; j < NODES_Y; j++) s += rawThickness(p, i / 2, j * STEP_FT);
  }
  return s;
}
function refInt() {
  if (refIntegral == null) refIntegral = integralOf(PATTERN_PRESETS[0].params);
  return refIntegral;
}

/**
 * Build a lane model.
 * @param {object} pattern  {lengthFt, volumeMl, ratio, shape, taper, bufferFt}
 * @param {object} cond     {games, surface}
 */
export function buildLane(pattern, cond = {}) {
  const p = { ...PATTERN_PRESETS[0].params, ...pattern };
  const games = Math.max(0, cond.games ?? 0);
  const surface = SURFACES[cond.surface] ? cond.surface : 'synthetic';
  const traffic = cond.trafficBoard ?? 10;

  const grid = new Float32Array(NODES_U * NODES_Y);
  const intg = integralOf(p);
  const k = intg > 0 ? (p.volumeMl / 24) * (refInt() / intg) : 0;
  const bd = 0.5 * (1 - Math.exp(-games / 8));
  const cd = 0.3 * (1 - Math.exp(-games / 10));

  for (let i = 0; i < NODES_U; i++) {
    const u = i / 2;
    const played = Math.exp(-(((u - traffic) / 4) ** 2));
    const endC = p.lengthFt;
    for (let j = 0; j < NODES_Y; j++) {
      const y = j * STEP_FT;
      let t = rawThickness(p, u, y) * k;
      if (games > 0 && p.lengthFt > 0) {
        t *= 1 - bd * played * (1 - smoothstep(endC * 0.85, endC + 6, y) * 0.5);
        // carry-down: oil moved past the end of the pattern
        const past = y - endC * (p.taper + (1 - p.taper) * 0.8);
        if (past > 0 && past < 16) t += cd * played * Math.max(0, 1 - past / 16) * (p.volumeMl / 24);
      }
      grid[j * NODES_U + i] = t;
    }
  }

  function thickness(u, yFt) {
    const fu = clamp(u, 0, BOARDS) * 2;
    const fy = clamp(yFt, 0, 66) / STEP_FT;
    const i0 = Math.min(NODES_U - 2, Math.floor(fu));
    const j0 = Math.min(NODES_Y - 2, Math.floor(fy));
    const tu = fu - i0;
    const ty = fy - j0;
    const a = grid[j0 * NODES_U + i0];
    const b = grid[j0 * NODES_U + i0 + 1];
    const c = grid[(j0 + 1) * NODES_U + i0];
    const d = grid[(j0 + 1) * NODES_U + i0 + 1];
    return a * (1 - tu) * (1 - ty) + b * tu * (1 - ty) + c * (1 - tu) * ty + d * tu * ty;
  }
  const coverage = (u, yFt) => 1 - Math.exp(-thickness(u, yFt) / OIL_T0);

  return {
    pattern: p,
    games,
    surface,
    surfaceDry: SURFACES[surface].dry,
    thickness,
    coverage,
    grid,
    nodesU: NODES_U,
    nodesY: NODES_Y,
    stepFt: STEP_FT,
    /** summary numbers used in the UI */
    stats() {
      let sum = 0;
      let max = 0;
      for (let i = 0; i < grid.length; i++) {
        sum += grid[i];
        if (grid[i] > max) max = grid[i];
      }
      return { maxThickness: max, meanThickness: sum / grid.length };
    },
  };
}
