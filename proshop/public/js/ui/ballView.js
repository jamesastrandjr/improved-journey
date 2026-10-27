import { v3 } from '../physics/ball.js';
import { surfacePoint, gripGeometry } from '../physics/ball.js';
import { OILMAP } from '../physics/sim.js';
import { quatToMat } from '../physics/sim.js';

const hex = (c) => { const n = parseInt((c || '#0e7490').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** Software sphere renderer: draws the ball in its true 3-D orientation with holes, pin, PAP and the oil track. */
export class BallRenderer {
  constructor(size) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(size, size);
    this.R = new Float64Array(9);
    this.setSpec(null);
  }
  setSpec(st, ball) {
    if (!st) { this.spec = null; return; }
    const g = gripGeometry({ ...st.fitting.hand, style: st.profile.style });
    const toC = (x, y, d) => ({ c: surfacePoint(x, y), cos: Math.cos((d / 2) / 4.25) });
    this.holes = [...g.fingers.map((f) => toC(f.x, f.y, f.d)), ...(g.thumb ? [toC(g.thumb.x, g.thumb.y, g.thumb.d)] : [])];
    this.pap = ball.pap; this.pin = ball.pin;
    this.rgb = hex(st.fitting.ball.color);
    this.spec = true;
  }
  /** q: grip->world quaternion. view: pitch (rad) of camera looking down-lane from behind. */
  render(q, oilMap, { pitch = 0.35, mirror = false } = {}) {
    const n = this.size, d = this.img.data; const R = quatToMat(q, this.R);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const [br, bg, bb] = this.rgb || [14, 116, 144];
    const holes = this.holes || [];
    const NZ = OILMAP.NZ, NL = OILMAP.NLON;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * 2 - 1, b = 1 - ((j + 0.5) / n) * 2, r2 = a * a + b * b;
      const o = (j * n + i) * 4;
      if (r2 > 1) { d[o + 3] = 0; continue; }
      const c = Math.sqrt(1 - r2);
      // camera frame: right=x, up (tilted), toward-camera = -y(rotated by pitch)
      const nx = mirror ? -a : a, ny = -(c * cp - b * sp), nz = c * sp + b * cp;
      // grip-frame normal = R^T n
      const gx = R[0] * nx + R[3] * ny + R[6] * nz, gy = R[1] * nx + R[4] * ny + R[7] * nz, gz = R[2] * nx + R[5] * ny + R[8] * nz;
      let cr = br, cg = bg, cb = bb;
      if (oilMap) {
        const zi = Math.min(NZ - 1, Math.floor(((gz + 1) / 2) * NZ));
        let jj = Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * NL); if (jj >= NL) jj = NL - 1;
        const L = oilMap[zi * NL + jj];
        if (L > 0.02) { const k = Math.min(1, L * 1.4) * 0.55; cr += (200 - cr) * k; cg += (235 - cg) * k; cb += (255 - cb) * k; }
      }
      let dark = false, mark = 0;
      for (const h of holes) if (gx * h.c[0] + gy * h.c[1] + gz * h.c[2] > h.cos) { dark = true; break; }
      if (!dark && this.pap) {
        if (gx * this.pap[0] + gy * this.pap[1] + gz * this.pap[2] > 0.9975) mark = 1;
        else if (gx * this.pin[0] + gy * this.pin[1] + gz * this.pin[2] > 0.9975) mark = 2;
      }
      const lum = 0.35 + 0.65 * Math.max(0, 0.45 * (-ny) * -1 + 0.6 * nz * 0 + (c * 0.7 + b * 0.5 - a * 0.25));
      const spec = Math.pow(Math.max(0, c * 0.75 + b * 0.45 - a * 0.3 - 0.45), 3) * 90;
      if (dark) { cr = 12; cg = 14; cb = 18; }
      else if (mark === 1) { cr = 34; cg = 197; cb = 94; }
      else if (mark === 2) { cr = 239; cg = 68; cb = 68; }
      d[o] = Math.min(255, cr * lum + spec); d[o + 1] = Math.min(255, cg * lum + spec); d[o + 2] = Math.min(255, cb * lum + spec); d[o + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}
