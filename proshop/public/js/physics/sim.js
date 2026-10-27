// Ball-on-lane simulator.
//
// The ball is a 3-D rigid body (orientation quaternion + world-frame angular momentum) whose
// principal moments come from RG / differential / intermediate differential, so flare ("axis
// migration") is a natural result of the physics instead of a fudge factor.  The only external
// force is Coulomb-style sliding friction at the contact point; the friction coefficient depends
// on the oil under the ball and on how much oil the ball itself has picked up on that part of its
// surface (that is what makes a wide, flaring track "fresher" than a narrow, stacked one).
//
// Frame: x to the bowler's right, y down-lane, z up.  A right-hander is simulated directly; a
// left-hander is the exact mirror image (the UI mirrors the drawing).

import { BALL_R, BOARD_W, FT, G, HALF_W, HEAD_PIN_Y, PIN_R, RPM, MPH, clamp, deg, rad, xToU, ARROWS_FT } from './units.js';
import { v3 } from './ball.js';

const NZ = 24;
const NLON = 48;
export const OILMAP = { NZ, NLON };

// tunable model constants (see README "Physics model")
const EPS_SLIP = 0.02; // m/s - friction regularisation
const PICK_RATE = 26; // ball surface oil pickup rate
const SHED_RATE = 3.5; // ball surface oil shed rate on dry lane
const LOAD_FRIC = 0.42; // max friction reduction from oil on the ball
const SPIN_DAMP = 0.002; // N m s - tiny damping of spin about the vertical axis

function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  q[0] /= l;
  q[1] /= l;
  q[2] /= l;
  q[3] /= l;
  return q;
}
function qRot(w, dt) {
  const mag = Math.hypot(w[0], w[1], w[2]);
  const a = mag * dt * 0.5;
  if (mag < 1e-12) return [1, 0, 0, 0];
  const s = Math.sin(a) / mag;
  return [Math.cos(a), w[0] * s, w[1] * s, w[2] * s];
}
export function quatToMat(q, m = new Float64Array(9)) {
  const [w, x, y, z] = q;
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y - w * z);
  m[2] = 2 * (x * z + w * y);
  m[3] = 2 * (x * y + w * z);
  m[4] = 1 - 2 * (x * x + z * z);
  m[5] = 2 * (y * z - w * x);
  m[6] = 2 * (x * z - w * y);
  m[7] = 2 * (y * z + w * x);
  m[8] = 1 - 2 * (x * x + y * y);
  return m;
}
function matToQuat(m) {
  const t = m[0] + m[4] + m[8];
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [0.25 * s, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = [(m[7] - m[5]) / s, 0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s];
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = [(m[2] - m[6]) / s, (m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s];
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s];
  }
  return qnorm(q);
}

/** world-frame unit rotation axis for the given delivery (direction of omega) */
export function releaseAxis(rotDeg, tiltDeg, launchAngle) {
  const phi = rad(rotDeg);
  const tau = rad(tiltDeg);
  // launch frame: n = right, t = down-lane.  Forward roll => omega points LEFT (-n).
  const ax = -Math.sin(phi) * Math.cos(tau);
  const ay = -Math.cos(phi) * Math.cos(tau);
  const az = -Math.sin(tau); // positive tilt = hand-side pole is raised
  const t = [Math.sin(launchAngle), Math.cos(launchAngle)];
  const n = [Math.cos(launchAngle), -Math.sin(launchAngle)];
  return [ax * n[0] + ay * t[0], ax * n[1] + ay * t[1], az];
}

function initialOrientation(ball, aWorld, phaseDeg) {
  // body basis: b1 = PAP, b2 = pin projected perpendicular to PAP
  const b1 = ball.pap;
  let b2 = v3.sub(ball.pin, v3.scale(b1, v3.dot(ball.pin, b1)));
  if (v3.len(b2) < 1e-6) b2 = v3.sub([0, 1, 0], v3.scale(b1, b1[1]));
  b2 = v3.norm(b2);
  const b3 = v3.cross(b1, b2);
  // world basis: w1 = hand-side pole = -axis
  const w1 = v3.scale(aWorld, -1);
  let w2 = v3.sub([0, 0, 1], v3.scale(w1, w1[2]));
  if (v3.len(w2) < 1e-6) w2 = v3.sub([1, 0, 0], v3.scale(w1, w1[0]));
  w2 = v3.norm(w2);
  const ph = rad(phaseDeg || 0);
  const w3p = v3.cross(w1, w2);
  w2 = v3.add(v3.scale(w2, Math.cos(ph)), v3.scale(w3p, Math.sin(ph)));
  const w3 = v3.cross(w1, w2);
  // R = W * B^T
  const m = new Float64Array(9);
  const W = [w1, w2, w3];
  const B = [b1, b2, b3];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = W[0][r] * B[0][c] + W[1][r] * B[1][c] + W[2][r] * B[2][c];
  return matToQuat(m);
}

/**
 * Run one throw.
 * @param {{ball:object, delivery:object, lane:object, ballOil?:number}} cfg
 */
export function simulate(cfg, opts = {}) {
  const dt = opts.dt ?? 0.0005;
  const recEvery = opts.recordEvery ?? 4;
  const { ball, delivery: dv, lane } = cfg;
  const R = BALL_R;
  const m = ball.massKg;
  const Iinv = ball.Iinv;
  const N = m * G;

  // ---------- release ----------
  const uS = dv.startBoard - 0.5;
  const uT = dv.targetBoard - 0.5;
  const slope = -((uT - uS) * BOARD_W) / (ARROWS_FT * FT); // dx/dy
  const theta = Math.atan(slope);
  const yLand = clamp(dv.loftFt ?? 3, 0.5, 8) * FT;
  let x = HALF_W - uS * BOARD_W + slope * yLand;
  let y = yLand;
  const v0 = dv.speedMph * MPH;
  let vx = v0 * Math.sin(theta);
  let vy = v0 * Math.cos(theta);

  const aW = releaseAxis(dv.rotDeg, dv.tiltDeg, theta);
  const Om = dv.revRpm * RPM;
  let q = initialOrientation(ball, aW, dv.phaseDeg);
  const Rm = new Float64Array(9);
  quatToMat(q, Rm);
  // angular momentum: omega_body0 = -Om * pap  (pap is the hand-side pole)
  const wb0 = v3.scale(ball.pap, -Om);
  const Lb0 = [0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Lb0[r] += ball.Imat[r * 3 + c] * wb0[c];
  let L = [0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) L[r] += Rm[r * 3 + c] * Lb0[c];

  // ball surface oil map (equal-area lat-lon on the grip frame)
  const oilMap = new Float32Array(NZ * NLON).fill(clamp(cfg.ballOil ?? 0, 0, 1) * 0.5);

  const muDryBall = ball.muDry * lane.surfaceDry;
  const muOilBall = ball.muOil;

  // scratch
  const Rt = new Float64Array(9);
  const out = { ax: 0, ay: 0, tx: 0, ty: 0, tz: 0, w: [0, 0, 0], wb: [0, 0, 0], ux: 0, uy: 0, mu: 0, phi: 0, load: 0, cz: 0, cx: 0, cy: 0 };

  function cellIndex(cx, cy, cz) {
    const i = Math.min(NZ - 1, Math.max(0, Math.floor(((cz + 1) / 2) * NZ)));
    let lon = Math.atan2(cy, cx);
    let j = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * NLON);
    if (j >= NLON) j = NLON - 1;
    return [i, j];
  }

  // derivatives for state (x,y,vx,vy,R,L); R given as matrix
  function deriv(px, py, pvx, pvy, Rmat, Lw) {
    // body angular momentum  Lb = R^T L ; wb = Iinv Lb ; w = R wb
    const Lbx = Rmat[0] * Lw[0] + Rmat[3] * Lw[1] + Rmat[6] * Lw[2];
    const Lby = Rmat[1] * Lw[0] + Rmat[4] * Lw[1] + Rmat[7] * Lw[2];
    const Lbz = Rmat[2] * Lw[0] + Rmat[5] * Lw[1] + Rmat[8] * Lw[2];
    const wbx = Iinv[0] * Lbx + Iinv[1] * Lby + Iinv[2] * Lbz;
    const wby = Iinv[3] * Lbx + Iinv[4] * Lby + Iinv[5] * Lbz;
    const wbz = Iinv[6] * Lbx + Iinv[7] * Lby + Iinv[8] * Lbz;
    const wx = Rmat[0] * wbx + Rmat[1] * wby + Rmat[2] * wbz;
    const wy = Rmat[3] * wbx + Rmat[4] * wby + Rmat[5] * wbz;
    const wz = Rmat[6] * wbx + Rmat[7] * wby + Rmat[8] * wbz;
    out.w[0] = wx;
    out.w[1] = wy;
    out.w[2] = wz;
    out.wb[0] = wbx;
    out.wb[1] = wby;
    out.wb[2] = wbz;
    // contact point (body frame) = R^T (0,0,-1)
    const cx = -Rmat[6];
    const cy = -Rmat[7];
    const cz = -Rmat[8];
    out.cx = cx;
    out.cy = cy;
    out.cz = cz;
    // slip velocity at contact
    const ux = pvx - R * wy;
    const uy = pvy + R * wx;
    out.ux = ux;
    out.uy = uy;
    // friction
    const u = xToU(px);
    const yFt = py / FT;
    const phi = lane.coverage(u, yFt);
    const [ci, cj] = cellIndex(cx, cy, cz);
    const load = oilMap[ci * NLON + cj];
    let mu = muDryBall * (1 - phi) + muOilBall * phi;
    mu *= 1 - LOAD_FRIC * load;
    out.mu = mu;
    out.phi = phi;
    out.load = load;
    const sm = Math.sqrt(ux * ux + uy * uy + EPS_SLIP * EPS_SLIP);
    const Fx = (-mu * N * ux) / sm;
    const Fy = (-mu * N * uy) / sm;
    out.ax = Fx / m;
    out.ay = Fy / m;
    out.tx = R * Fy;
    out.ty = -R * Fx;
    out.tz = -SPIN_DAMP * wz;
    return out;
  }

  // ---------- integrate ----------
  const maxSteps = Math.ceil(5 / dt);
  const yStop = HEAD_PIN_Y - (R + PIN_R);
  const nRec = Math.ceil(maxSteps / recEvery) + 2;
  const rec = {
    t: new Float32Array(nRec),
    x: new Float32Array(nRec),
    y: new Float32Array(nRec),
    vx: new Float32Array(nRec),
    vy: new Float32Array(nRec),
    u: new Float32Array(nRec),
    slip: new Float32Array(nRec),
    rev: new Float32Array(nRec),
    revFwd: new Float32Array(nRec),
    mu: new Float32Array(nRec),
    phi: new Float32Array(nRec),
    load: new Float32Array(nRec),
    q: new Float32Array(nRec * 4),
    axis: new Float32Array(nRec * 3), // omega direction in grip frame
    contact: new Float32Array(nRec * 3), // contact point in grip frame
  };
  let nr = 0;
  let t = 0;
  let status = 'timeout';
  const Rb = new Float64Array(9);
  const Rmid = new Float64Array(9);
  const axis0 = v3.norm(wb0);
  let maxAxisArc = 0;

  function record() {
    quatToMat(q, Rb);
    const d = deriv(x, y, vx, vy, Rb, L);
    rec.t[nr] = t;
    rec.x[nr] = x;
    rec.y[nr] = y;
    rec.vx[nr] = vx;
    rec.vy[nr] = vy;
    rec.u[nr] = xToU(x);
    rec.slip[nr] = Math.hypot(d.ux, d.uy);
    const wmag = Math.hypot(d.w[0], d.w[1], d.w[2]);
    rec.rev[nr] = wmag / RPM;
    // forward-roll component (about the axis perpendicular to travel)
    const sp = Math.hypot(vx, vy) || 1;
    rec.revFwd[nr] = (-(d.w[0] * vy - d.w[1] * vx) / sp) / RPM;
    rec.mu[nr] = d.mu;
    rec.phi[nr] = d.phi;
    rec.load[nr] = d.load;
    rec.q.set(q, nr * 4);
    const ab = v3.norm(d.wb.slice());
    rec.axis[nr * 3] = ab[0];
    rec.axis[nr * 3 + 1] = ab[1];
    rec.axis[nr * 3 + 2] = ab[2];
    rec.contact[nr * 3] = d.cx;
    rec.contact[nr * 3 + 1] = d.cy;
    rec.contact[nr * 3 + 2] = d.cz;
    const arc = Math.acos(clamp(v3.dot(ab, axis0), -1, 1));
    if (arc > maxAxisArc) maxAxisArc = arc;
    nr++;
  }

  let step = 0;
  while (step < maxSteps) {
    if (step % recEvery === 0) record();
    // midpoint (RK2)
    quatToMat(q, Rb);
    const d1 = deriv(x, y, vx, vy, Rb, L);
    // ball surface oil update (explicit, from step-start state)
    {
      const [ci, cj] = cellIndex(d1.cx, d1.cy, d1.cz);
      const phi = d1.phi;
      const pk = PICK_RATE * dt * phi;
      const sh = SHED_RATE * dt * (1 - phi);
      for (let di = -1; di <= 1; di++) {
        const ii = ci + di;
        if (ii < 0 || ii >= NZ) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = (cj + dj + NLON) % NLON;
          const w = (di === 0 ? 0.5 : 0.25) * (dj === 0 ? 0.5 : 0.25) * 4;
          const idx = ii * NLON + jj;
          const cur = oilMap[idx];
          oilMap[idx] = clamp(cur + pk * w * (1 - cur) - sh * w * cur, 0, 1);
        }
      }
    }
    const hx = x + 0.5 * dt * vx;
    const hy = y + 0.5 * dt * vy;
    const hvx = vx + 0.5 * dt * d1.ax;
    const hvy = vy + 0.5 * dt * d1.ay;
    const hL = [L[0] + 0.5 * dt * d1.tx, L[1] + 0.5 * dt * d1.ty, L[2] + 0.5 * dt * d1.tz];
    const hq = qnorm(qmul(qRot(d1.w, 0.5 * dt), q));
    quatToMat(hq, Rmid);
    const d2 = deriv(hx, hy, hvx, hvy, Rmid, hL);
    x += dt * hvx;
    y += dt * hvy;
    vx += dt * d2.ax;
    vy += dt * d2.ay;
    L[0] += dt * d2.tx;
    L[1] += dt * d2.ty;
    L[2] += dt * d2.tz;
    q = qnorm(qmul(qRot(d2.w, dt), q));
    t += dt;
    step++;
    if (Math.abs(x) > HALF_W) {
      status = x > 0 ? 'gutterOwn' : 'gutterFar';
      record();
      break;
    }
    if (y >= yStop) {
      status = 'pins';
      record();
      break;
    }
    if (vy < 0.2) {
      status = 'stalled';
      record();
      break;
    }
  }

  const n = nr;
  const sl = (a, c = 1) => a.subarray(0, n * c);
  const samples = {
    n,
    t: sl(rec.t),
    x: sl(rec.x),
    y: sl(rec.y),
    vx: sl(rec.vx),
    vy: sl(rec.vy),
    u: sl(rec.u),
    slip: sl(rec.slip),
    rev: sl(rec.rev),
    revFwd: sl(rec.revFwd),
    mu: sl(rec.mu),
    phi: sl(rec.phi),
    load: sl(rec.load),
    q: sl(rec.q, 4),
    axis: sl(rec.axis, 3),
    contact: sl(rec.contact, 3),
  };
  const result = { status, samples, oilMap, launchAngle: theta, flareIn: (maxAxisArc * R) / 0.0254 };
  result.metrics = computeMetrics(result, cfg);
  return result;
}

function computeMetrics(res, cfg) {
  const s = res.samples;
  const n = s.n;
  const m = { status: res.status };
  const last = n - 1;
  const ftOf = (i) => s.y[i] / FT;

  // breakpoint = farthest-outside board after the ball has settled into its line (y > 8 ft)
  let bpI = 0;
  let minU = Infinity;
  for (let i = 0; i < n; i++) {
    if (ftOf(i) < 6) continue;
    if (s.u[i] < minU) {
      minU = s.u[i];
      bpI = i;
    }
  }
  m.breakBoard = minU + 0.5;
  m.breakFt = ftOf(bpI);

  // arrows (15 ft)
  const arrowsI = indexAtFt(s, 15);
  m.arrowsBoard = s.u[arrowsI] + 0.5;

  // entry at head pin y
  const speed = Math.hypot(s.vx[last], s.vy[last]);
  m.pinSpeedMph = speed / MPH;
  m.revAtPins = s.rev[last];
  if (res.status === 'pins') {
    const dy = HEAD_PIN_Y - s.y[last];
    const xh = s.x[last] + (s.vx[last] / s.vy[last]) * dy;
    m.entryBoard = xToU(xh) + 0.5;
    m.entryX = xh;
    // inward (toward the lane centre / hook direction) positive
    m.entryAngle = -deg(Math.atan(s.vx[last] / s.vy[last]));
  } else {
    m.entryBoard = s.u[last] + 0.5;
    m.entryAngle = -deg(Math.atan(s.vx[last] / s.vy[last]));
  }
  m.totalHook = m.entryBoard - m.breakBoard;

  // phases by slip speed relative to the initial slip
  const s0 = Math.max(0.3, s.slip[0]);
  let hookStart = -1;
  let rollStart = -1;
  for (let i = 0; i < n; i++) {
    const r = s.slip[i] / s0;
    if (hookStart < 0 && r < 0.8) hookStart = i;
    if (rollStart < 0 && r < 0.12) {
      rollStart = i;
      break;
    }
  }
  if (hookStart < 0) hookStart = last;
  if (rollStart < 0) rollStart = last;
  m.skidFt = ftOf(hookStart);
  m.rollFt = ftOf(rollStart);
  m.hookFt = Math.max(0, m.rollFt - m.skidFt);
  m.hookStartIdx = hookStart;
  m.rollStartIdx = rollStart;
  m.initialSlip = s0;

  // heading change over a 10 ft window ("backend angle")
  let best = 0;
  let bestFt = 0;
  const head = (i) => -deg(Math.atan2(s.vx[i], s.vy[i]));
  for (let i = 0; i < n; i++) {
    const j = indexAtFt(s, ftOf(i) + 10);
    if (j <= i) break;
    const d = head(j) - head(i);
    if (d > best) {
      best = d;
      bestFt = ftOf(i);
    }
  }
  m.backendAngle = best;
  m.backendStartFt = bestFt;
  m.launchHeading = head(0);
  m.totalTurn = head(last) - head(0);
  m.flareIn = res.flareIn;
  m.timeS = s.t[last];
  m.speedLossPct = (1 - speed / Math.hypot(s.vx[0], s.vy[0])) * 100;
  m.maxMu = 0;
  for (let i = 0; i < n; i++) if (s.mu[i] > m.maxMu) m.maxMu = s.mu[i];
  return m;
}

export function indexAtFt(s, ft) {
  const target = ft * FT;
  let lo = 0;
  let hi = s.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.y[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
