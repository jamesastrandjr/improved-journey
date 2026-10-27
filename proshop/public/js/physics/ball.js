// Ball model: coverstock friction, mass properties (RG / differentials) and drilling layout geometry.
//
// Grip frame (G) - fixed in the ball, looking straight at the grip:
//   +x : to the right      +y : up, toward the finger holes      +z : out of the grip centre
// The origin of the grip is the midpoint between the thumb-hole centre and the finger-hole centre.
//
// Layout (dual-angle style):
//   PAP            : positive axis point, given as arc distance "over" (x) and "up" (y) from grip centre
//   pin-to-PAP     : arc distance from the PAP to the pin (the low-RG axis end)
//   VAL angle      : angle at the PAP between the vertical axis line (toward the fingers) and the
//                    line PAP -> pin, swinging toward the grip centre (90 = pin straight toward grip
//                    centre, 180 = straight down toward the thumb)
//   core azimuth   : where the high-RG axis sits around the pin, measured from the pin->PAP direction

import { BALL_R, IN, LB, clamp, rad } from './units.js';

export const COVERS = {
  plastic: { label: 'Plastic / polyester (spare)', dry: 0.62, oil: 0.85 },
  urethane: { label: 'Urethane', dry: 0.8, oil: 0.95 },
  reactiveSolid: { label: 'Reactive resin - solid', dry: 1.05, oil: 1.15 },
  reactiveHybrid: { label: 'Reactive resin - hybrid', dry: 1.0, oil: 1.0 },
  reactivePearl: { label: 'Reactive resin - pearl', dry: 0.95, oil: 0.85 },
  particle: { label: 'Particle / aggressive solid', dry: 1.1, oil: 1.3 },
};

export const FINISHES = [
  { label: 'Polished', grit: 10000 },
  { label: '4000 grit', grit: 4000 },
  { label: '3000 grit', grit: 3000 },
  { label: '2000 grit', grit: 2000 },
  { label: '1500 grit', grit: 1500 },
  { label: '1000 grit', grit: 1000 },
  { label: '500 grit', grit: 500 },
];

/** Generic ball archetypes. These are NOT real catalogue products - add your own with real specs in the Data Bank. */
export const BALL_ARCHETYPES = [
  { id: 'a-plastic', name: 'Spare ball (plastic)', brand: 'Generic', cover: 'plastic', grit: 4000, rg: 2.66, diff: 0.01, intDiff: 0, weightLb: 15, color: '#3c78d8' },
  { id: 'a-urethane', name: 'Urethane (benign)', brand: 'Generic', cover: 'urethane', grit: 2000, rg: 2.58, diff: 0.03, intDiff: 0, weightLb: 15, color: '#6b3fa0' },
  { id: 'a-ent', name: 'Entry reactive (symmetric)', brand: 'Generic', cover: 'reactiveHybrid', grit: 2000, rg: 2.57, diff: 0.028, intDiff: 0, weightLb: 15, color: '#d14b3c' },
  { id: 'a-solid-sym', name: 'Solid reactive - symmetric (smooth)', brand: 'Generic', cover: 'reactiveSolid', grit: 2000, rg: 2.56, diff: 0.04, intDiff: 0, weightLb: 15, color: '#1f8a5b' },
  { id: 'a-solid-asym', name: 'Solid reactive - asymmetric (strong)', brand: 'Generic', cover: 'reactiveSolid', grit: 1500, rg: 2.5, diff: 0.052, intDiff: 0.02, weightLb: 15, color: '#0e7490' },
  { id: 'a-pearl-asym', name: 'Pearl reactive - asymmetric (angular)', brand: 'Generic', cover: 'reactivePearl', grit: 3000, rg: 2.49, diff: 0.056, intDiff: 0.022, weightLb: 15, color: '#c026d3' },
  { id: 'a-pearl-sym', name: 'Pearl reactive - symmetric (length)', brand: 'Generic', cover: 'reactivePearl', grit: 4000, rg: 2.6, diff: 0.036, intDiff: 0, weightLb: 15, color: '#e8a317' },
  { id: 'a-particle', name: 'Particle - aggressive (heavy oil)', brand: 'Generic', cover: 'particle', grit: 500, rg: 2.52, diff: 0.048, intDiff: 0.012, weightLb: 15, color: '#111827' },
];

const v3 = {
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};
export { v3 };

/** point on the ball surface at arc offset (over, up) in inches from grip centre */
export function surfacePoint(overIn, upIn) {
  const s = Math.hypot(overIn, upIn);
  if (s < 1e-9) return [0, 0, 1];
  const a = (s * IN) / BALL_R;
  return [(Math.sin(a) * overIn) / s, (Math.sin(a) * upIn) / s, Math.cos(a)];
}

/** unit tangent at point p (on sphere) pointing toward q along the great circle */
function tangentToward(p, q) {
  const t = v3.sub(q, v3.scale(p, v3.dot(q, p)));
  return v3.len(t) < 1e-9 ? null : v3.norm(t);
}

/** pin position (unit vector, grip frame) from PAP + pin-to-PAP distance + VAL angle */
export function pinPosition(pap, pinDistIn, valDeg) {
  const alpha = (pinDistIn * IN) / BALL_R;
  let up = tangentToward(pap, [0, 1, 0]);
  if (!up) up = tangentToward(pap, [0, 0, 1]) || [0, 1, 0];
  let cen = tangentToward(pap, [0, 0, 1]);
  if (!cen) cen = v3.norm(v3.cross(pap, up));
  const val = rad(valDeg);
  const dir = v3.add(v3.scale(up, Math.cos(val)), v3.scale(cen, Math.sin(val)));
  const d = v3.norm(v3.sub(dir, v3.scale(pap, v3.dot(dir, pap))));
  return v3.norm(v3.add(v3.scale(pap, Math.cos(alpha)), v3.scale(d, Math.sin(alpha))));
}

/** angle (rad) of the hole centres from the grip centre, for drawing + pin-buffer maths */
export function gripGeometry(h) {
  const span = h.span ?? 4.125;
  const thumbD = h.thumbHole ?? 1.0;
  const fingerD = h.middleHole ?? 0.82;
  const cc = span + (thumbD + fingerD) / 2; // centre-to-centre
  const sp = (h.fingerSpacing ?? 1.0) / 2;
  return {
    cc,
    fingers: [
      { x: -sp, y: cc / 2, d: h.middleHole ?? 0.82 },
      { x: sp, y: cc / 2, d: h.ringHole ?? 0.82 },
    ],
    thumb: h.style === 'twoHand' ? null : { x: 0, y: -cc / 2, d: thumbD },
  };
}

/** pin buffer = distance (inches, along the surface) from the pin to the nearest finger-hole edge */
export function pinBuffer(pin, grip) {
  let best = Infinity;
  for (const f of grip.fingers) {
    const c = surfacePoint(f.x, f.y);
    const ang = Math.acos(clamp(v3.dot(c, pin), -1, 1));
    const dist = (ang * BALL_R) / IN - f.d / 2;
    if (dist < best) best = dist;
  }
  return best;
}

/**
 * Build the physical ball used by the simulator.
 * @param {object} b      ball spec  {weightLb,cover,grit,rg,diff,intDiff,coreAzimuth}
 * @param {object} lay    layout     {pinDistance,valAngle}
 * @param {object} d      delivery   {papOver,papUp}
 */
export function buildBall(b, lay, d) {
  const massKg = clamp(b.weightLb ?? 15, 6, 16) * LB;
  const rg = clamp(b.rg ?? 2.55, 2.4, 2.85);
  const diff = clamp(b.diff ?? 0.04, 0, 0.09);
  const intDiff = clamp(b.intDiff ?? 0, 0, diff);
  const cover = COVERS[b.cover] || COVERS.reactiveHybrid;
  const grit = clamp(b.grit ?? 2000, 200, 12000);

  const pap = surfacePoint(d.papOver ?? 4.5, d.papUp ?? 0.5);
  const pin = pinPosition(pap, lay.pinDistance ?? 4.5, lay.valAngle ?? 45);

  // principal axes: e1 = pin (low RG), e3 = high RG axis (90 deg from pin), e2 = intermediate
  const tp = tangentToward(pin, pap) || v3.norm(v3.cross(pin, [1, 0, 0]));
  const side = v3.cross(pin, tp);
  const g = rad(b.coreAzimuth ?? 0);
  const e3 = v3.add(v3.scale(tp, Math.cos(g)), v3.scale(side, Math.sin(g)));
  const e2 = v3.cross(pin, e3);

  const rgMin = rg * IN;
  const rgMax = (rg + diff) * IN;
  const rgInt = (rg + diff - intDiff) * IN; // intDiff = how far the intermediate axis sits BELOW the high axis
  const I = [massKg * rgMin * rgMin, massKg * rgInt * rgInt, massKg * rgMax * rgMax];
  const axes = [pin, e2, e3];
  // inverse inertia tensor in the grip frame (row-major 3x3)
  const Iinv = new Float64Array(9);
  for (let k = 0; k < 3; k++) {
    const e = axes[k];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Iinv[r * 3 + c] += (e[r] * e[c]) / I[k];
  }
  const Imat = new Float64Array(9);
  for (let k = 0; k < 3; k++) {
    const e = axes[k];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Imat[r * 3 + c] += I[k] * e[r] * e[c];
  }

  // friction scalars
  const gritDry = clamp(Math.pow(2000 / grit, 0.18), 0.7, 1.35);
  const gritOil = clamp(Math.pow(2000 / grit, 0.3), 0.6, 1.6);
  return {
    massKg,
    rg,
    diff,
    intDiff,
    cover: b.cover,
    grit,
    muDry: 0.14 * cover.dry * gritDry,
    muOil: 0.004 * cover.oil * gritOil,
    pap,
    pin,
    axes,
    I,
    Iinv,
    Imat,
    pinDistance: lay.pinDistance ?? 4.5,
    valAngle: lay.valAngle ?? 45,
    papOver: d.papOver ?? 4.5,
    papUp: d.papUp ?? 0.5,
  };
}

/** pin buffer (in) for a candidate layout given full app state */
export function gripBuffer(st, pinDist, val) {
  const pap = surfacePoint(+st.fitting.delivery.papOver || 0, +st.fitting.delivery.papUp || 0);
  return pinBuffer(pinPosition(pap, pinDist, val), gripGeometry({ ...st.fitting.hand, style: st.profile.style }));
}
