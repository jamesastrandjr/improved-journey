import { FT, HALF_W, BOARD_W, HEAD_PIN_Y, BALL_R, PIN_R, LANE_W, ARROWS_FT } from '../physics/units.js';
import { PIN_LAYOUT } from '../physics/pins.js';
import { indexAtFt } from '../physics/sim.js';

const PHASE = { skid: '#38bdf8', hook: '#fb923c', roll: '#4ade80' };
export const GHOST_COLORS = ['#f472b6', '#a78bfa', '#fbbf24'];

export class LaneView {
  constructor(canvas, ballRenderer) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.br = ballRenderer;
    this.mode = 'overhead'; this.heat = 'oil'; this.hand = 'R';
    this.run = null; this.lane = null; this.ghosts = []; this.ballCfg = null; this._heatKey = '';
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }
  resize() {
    const p = this.c.parentElement, dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(200, p.clientWidth); this.H = Math.max(260, p.clientHeight);
    this.c.width = this.W * dpr; this.c.height = this.H * dpr; this.c.style.width = this.W + 'px'; this.c.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.dirty = true;
  }
  set(run, lane, ballCfg, hand, ghosts) { this.run = run; this.lane = lane; this.ballCfg = ballCfg; this.hand = hand; this.ghosts = ghosts || []; this._heatKey = ''; }

  // ------- oil / friction heat texture (cached) -------
  heatCanvas() {
    const lane = this.lane; const key = this.heat + '|' + (this.ballCfg?.ball.muDry) + '|' + (this.ballCfg?.ball.muOil) + '|' + lane.grid[1000] + lane.grid[2500] + lane.pattern.lengthFt + lane.games + lane.pattern.volumeMl;
    if (key === this._heatKey && this._heat) return this._heat;
    const cols = lane.nodesU, rows = lane.nodesY; const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows; const x = cv.getContext('2d'); const im = x.createImageData(cols, rows);
    const b = this.ballCfg?.ball;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const T = lane.grid[j * cols + i]; const phi = 1 - Math.exp(-T / 0.4); const o = (j * cols + i) * 4;
      if (this.heat === 'oil') { im.data[o] = 30; im.data[o + 1] = 120; im.data[o + 2] = 255; im.data[o + 3] = Math.min(210, T * 200); }
      else { const mu = b ? (b.muDry * lane.surfaceDry * (1 - phi) + b.muOil * phi) : 0.05; const t = Math.min(1, mu / (b ? b.muDry * 1.05 : 0.1)); im.data[o] = 40 + 215 * t; im.data[o + 1] = 90 + 40 * (1 - Math.abs(t - 0.5) * 2); im.data[o + 2] = 255 - 215 * t; im.data[o + 3] = 170; }
    }
    x.putImageData(im, 0, 0); this._heat = cv; this._heatKey = key; return cv;
  }

  // ------- main draw -------
  draw(tSec, pinFrame) {
    if (!this.lane) return;
    const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
    if (this.mode === 'chase') this.drawChase(tSec); else this.drawOverhead(tSec);
  }
  idx(tSec) { const s = this.run.samples; let lo = 0, hi = s.n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (s.t[m] < tSec) lo = m + 1; else hi = m; } return lo; }

  drawOverhead(tSec) {
    const { ctx, W, H } = this; const s = this.run.samples; const mir = this.hand === 'L';
    const top = 26, bot = 34; const ftPx = (H - top - bot) / 64;
    const laneW = Math.min(W - 70, 360); const bpx = laneW / 39; const cx = W / 2 - 6;
    const sx = (u) => cx + (mir ? u - 19.5 : 19.5 - u) * bpx;
    const sy = (ft) => H - bot - ft * ftPx;
    const L = sx(mir ? 0 : 39), Rr = sx(mir ? 39 : 0);
    // gutters & lane
    ctx.fillStyle = '#1b2230'; ctx.fillRect(L - 14, sy(66), laneW + 28, (66) * ftPx + 6);
    const g = ctx.createLinearGradient(0, 0, laneW, 0); g.addColorStop(0, '#d9b57c'); g.addColorStop(0.5, '#e6c68f'); g.addColorStop(1, '#d9b57c');
    ctx.fillStyle = g; ctx.fillRect(L, sy(64), laneW, 64 * ftPx);
    const hc = this.heatCanvas(); ctx.imageSmoothingEnabled = true;
    ctx.save(); ctx.beginPath(); ctx.rect(L, sy(64), laneW, 64 * ftPx); ctx.clip();
    ctx.translate(mir ? L + laneW : L, sy(0)); ctx.scale(mir ? -1 : 1, -1); ctx.drawImage(hc, 0, 0, laneW, 66 * ftPx); ctx.restore();
    // boards
    ctx.strokeStyle = 'rgba(70,45,10,.28)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let b = 0; b <= 39; b++) { const x = L + b * bpx; ctx.moveTo(x, sy(0)); ctx.lineTo(x, sy(62)); } ctx.stroke();
    // arrows, dots, foul line
    ctx.fillStyle = 'rgba(60,35,10,.8)';
    for (const b of [5, 10, 15, 20, 25, 30, 35]) { const x = sx(b - 0.5), y = sy(ARROWS_FT + (b < 20 ? b : 40 - b) * 0.0 + Math.abs(20 - b) * 0.35 - 1.4 * 0); ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x - 4, y + 5); ctx.lineTo(x + 4, y + 5); ctx.fill(); ctx.beginPath(); ctx.arc(x, sy(7), 1.8, 0, 7); ctx.fill(); }
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(L, sy(0)); ctx.lineTo(L + laneW, sy(0)); ctx.stroke();
    // labels
    ctx.fillStyle = 'rgba(160,175,195,.9)'; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    for (let ft = 0; ft <= 60; ft += 10) { ctx.fillText(ft + ' ft', L - 18, sy(ft) + 3); }
    ctx.textAlign = 'center'; for (const b of [1, 5, 10, 15, 20, 25, 30, 35, 39]) ctx.fillText(b, sx(b - 0.5), sy(0) + 14);
    ctx.fillText(mir ? 'boards from LEFT' : 'boards from RIGHT', cx, sy(0) + 27);
    // pins
    for (const p of PIN_LAYOUT) { const bx = cx + (x2u(p.x) - 19.5) * bpx * (mir ? 1 : -1) * 1; ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#475569'; ctx.beginPath(); ctx.arc(bx, sy(p.y / FT), 3.6, 0, 7); ctx.fill(); ctx.stroke(); }
    // ghosts
    this.ghosts.forEach((gh, k) => { ctx.strokeStyle = GHOST_COLORS[k % 3]; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.beginPath(); gh.path.forEach(([u, ft], i) => { const X = sx(u), Y = sy(ft); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke(); ctx.setLineDash([]); });
    // path to current time
    const cur = Math.min(s.n - 1, this.idx(tSec)); const hs = this.run.metrics.hookStartIdx, rs = this.run.metrics.rollStartIdx;
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const [a, b, col] of [[0, hs, PHASE.skid], [hs, rs, PHASE.hook], [rs, s.n - 1, PHASE.roll]]) {
      const e = Math.min(b, cur); if (e <= a) continue; ctx.strokeStyle = col; ctx.beginPath();
      for (let i = a; i <= e; i += 2) { const X = sx(s.u[i]), Y = sy(s.y[i] / FT); i === a ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); } ctx.lineTo(sx(s.u[e]), sy(s.y[e] / FT)); ctx.stroke();
    }
    // breakpoint marker
    const m = this.run.metrics; if (cur >= s.n - 2 || s.y[cur] / FT > m.breakFt) { ctx.strokeStyle = '#fff'; ctx.fillStyle = '#0b0f14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx(m.breakBoard - 0.5), sy(m.breakFt), 4, 0, 7); ctx.fill(); ctx.stroke(); }
    // ball
    const bx = sx(s.u[cur]), by = sy(s.y[cur] / FT), bs = 30;
    if (this.br && this.br.spec) { const q = [s.q[cur * 4], s.q[cur * 4 + 1], s.q[cur * 4 + 2], s.q[cur * 4 + 3]]; ctx.drawImage(this.br.render(q, null, { pitch: 1.2, mirror: mir }), bx - bs / 2, by - bs / 2, bs, bs); }
    else { ctx.fillStyle = '#0e7490'; ctx.beginPath(); ctx.arc(bx, by, 7, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(160,175,195,.7)'; ctx.textAlign = 'left'; ctx.fillText('lateral scale exaggerated', 8, 14);
  }

  drawChase(tSec) {
    const { ctx, W, H } = this; const s = this.run.samples; const mir = this.hand === 'L';
    const cur = Math.min(s.n - 1, this.idx(tSec));
    const bxW = (mir ? -1 : 1) * s.x[cur], byW = s.y[cur];
    const camY = byW - 2.2, camX = bxW * 0.6, camZ = 1.15, f = W * 1.5, hor = H * 0.3;
    // sky/room
    const sky = ctx.createLinearGradient(0, 0, 0, hor); sky.addColorStop(0, '#0b1020'); sky.addColorStop(1, '#1f2a44'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hor);
    ctx.fillStyle = '#10151f'; ctx.fillRect(0, hor, W, H - hor);
    const projX = (x, dy) => W / 2 + (f * (x - camX)) / dy; const projY = (z, dy) => hor + (f * (camZ - z)) / dy;
    const mx = mir ? -1 : 1; const hc = this.heatCanvas(); const rowsPerFt = 2; const hcW = hc.width, hcH = hc.height;
    for (let r = Math.ceil(hor) + 1; r < H; r += 2) {
      const dy = (f * camZ) / (r - hor); const y = camY + dy; if (y < -4.5 || y > HEAD_PIN_Y + 1.2) continue;
      const xl = projX(-HALF_W, dy), xr = projX(HALF_W, dy), gw = (xr - xl) * 0.12;
      ctx.fillStyle = '#0a0d14'; ctx.fillRect(xl - gw, r, gw, 2); ctx.fillRect(xr, r, gw, 2);
      if (y < 0) { ctx.fillStyle = '#7a5a34'; ctx.fillRect(xl, r, xr - xl, 2); continue; }
      ctx.fillStyle = Math.floor(y / 0.3) % 2 ? '#dcb97f' : '#d6b177'; ctx.fillRect(xl, r, xr - xl, 2);
      const row = Math.min(hcH - 1, Math.round((y / FT) * rowsPerFt));
      ctx.save(); if (mir) { ctx.translate(xl + xr, 0); ctx.scale(-1, 1); ctx.drawImage(hc, 0, row, hcW, 1, xl, r, xr - xl, 2); } else ctx.drawImage(hc, 0, row, hcW, 1, xl, r, xr - xl, 2); ctx.restore();
    }
    // board lines
    ctx.strokeStyle = 'rgba(70,45,10,.3)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let b = 0; b <= 39; b += 1) { const x = -HALF_W + b * BOARD_W; const y0 = Math.max(camY + 0.5, 0), y1 = Math.min(HEAD_PIN_Y + 1, camY + 30); const d0 = y0 - camY, d1 = y1 - camY; ctx.moveTo(projX(x, d0), projY(0, d0)); ctx.lineTo(projX(x, d1), projY(0, d1)); } ctx.stroke();
    // arrows + foul line
    const poly = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], i) => { const dy = y - camY; if (dy < 0.3) return; i ? ctx.lineTo(projX(x, dy), projY(0, dy)) : ctx.moveTo(projX(x, dy), projY(0, dy)); }); ctx.fill(); };
    for (const b of [5, 10, 15, 20, 25, 30, 35]) { const x = -HALF_W + (b - 0.5) * BOARD_W, y = ARROWS_FT * FT; poly([[x, y + 0.25], [x - 0.03, y - 0.1], [x + 0.03, y - 0.1]], 'rgba(60,35,10,.85)'); }
    if (camY < -0.1) poly([[-HALF_W, 0], [HALF_W, 0], [HALF_W, 0.04], [-HALF_W, 0.04]], '#ef4444');
    // pins
    for (const p of [...PIN_LAYOUT].sort((a, b) => b.y - a.y)) { const dy = p.y - camY; if (dy < 0.5) continue; const X = projX(mx * p.x, dy), Y0 = projY(0, dy), Y1 = projY(0.38, dy), w = (f * PIN_R) / dy; ctx.fillStyle = '#f1f5f9'; ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.roundRect(X - w * 0.9, Y1, w * 1.8, Y0 - Y1, w * 0.8); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#dc2626'; ctx.fillRect(X - w * 0.85, Y1 + (Y0 - Y1) * 0.16, w * 1.7, (Y0 - Y1) * 0.07); }
    // trail
    const trail = (a, b, col) => { const e = Math.min(b, cur); if (e <= a) return; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); let st = false; for (let i = a; i <= e; i += 3) { const dy = s.y[i] - camY; if (dy < 0.4) { st = false; continue; } const X = projX(mx * s.x[i], dy), Y = projY(0, dy); st ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); st = true; } ctx.stroke(); };
    const hs = this.run.metrics.hookStartIdx, rs = this.run.metrics.rollStartIdx; trail(0, hs, PHASE.skid); trail(hs, rs, PHASE.hook); trail(rs, s.n - 1, PHASE.roll);
    // ball
    const dy = Math.max(0.6, byW - camY), X = projX(mx * s.x[cur], dy), Y = projY(BALL_R, dy), rr = (f * BALL_R) / dy;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(X, projY(0, dy), rr * 0.9, rr * 0.28, 0, 0, 7); ctx.fill();
    if (this.br?.spec) { const q = [s.q[cur * 4], s.q[cur * 4 + 1], s.q[cur * 4 + 2], s.q[cur * 4 + 3]]; ctx.drawImage(this.br.render(q, null, { pitch: 0.25, mirror: mir }), X - rr, Y - rr, rr * 2, rr * 2); }
    ctx.fillStyle = 'rgba(200,210,225,.8)'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.fillText(`${(byW / FT).toFixed(0)} ft  ·  board ${(s.u[cur] + 0.5).toFixed(1)}`, 10, 18);
  }
}
const x2u = (x) => (HALF_W - x) / BOARD_W; // pin x (right-positive) -> u for a righty
void LANE_W; void indexAtFt;

export class PinView {
  constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.frames = null; this.size(); new ResizeObserver(() => this.size()).observe(canvas.parentElement); }
  size() { const p = this.c.parentElement, dpr = Math.min(2, devicePixelRatio || 1); this.W = p.clientWidth; this.H = p.clientHeight; this.c.width = this.W * dpr; this.c.height = this.H * dpr; this.c.style.width = this.W + 'px'; this.c.style.height = this.H + 'px'; this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.draw(0, true); }
  load(frames, hand) { this.frames = frames; this.hand = hand; }
  draw(k, standing) {
    const { ctx, W, H } = this; ctx.clearRect(0, 0, W, H);
    const sc = Math.min(W / 1.1, H / 0.95), cx = W / 2, mir = this.hand === 'L' ? -1 : 1, y0 = HEAD_PIN_Y - 0.22;
    const X = (x) => cx + mir * x * sc, Y = (y) => H - 12 - (y0 + 0.95 - y) * sc * 1 + 0;
    const Yf = (y) => 14 + (y - y0) * sc;
    ctx.fillStyle = '#d9b57c'; ctx.fillRect(cx - HALF_W * sc, 0, LANE_W * sc, H); ctx.fillStyle = '#0a0d14'; ctx.fillRect(0, 0, cx - HALF_W * sc, H); ctx.fillRect(cx + HALF_W * sc, 0, W, H);
    ctx.fillStyle = '#090b10'; ctx.fillRect(cx - HALF_W * sc, Yf(HEAD_PIN_Y + 0.9), LANE_W * sc, H);
    if (!this.frames) { for (const p of PIN_LAYOUT) { ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#475569'; ctx.beginPath(); ctx.arc(X(p.x), Yf(p.y), PIN_R * sc, 0, 7); ctx.fill(); ctx.stroke(); } return; }
    const fr = this.frames[Math.min(k, this.frames.length - 1)];
    fr.forEach(([x, y, down, gone], i) => {
      if (gone && i) return;
      if (i === 0) { ctx.fillStyle = '#0e7490'; ctx.beginPath(); ctx.arc(X(x), Yf(y), BALL_R * sc, 0, 7); ctx.fill(); return; }
      ctx.fillStyle = down ? 'rgba(248,250,252,.35)' : '#f8fafc'; ctx.strokeStyle = down ? '#94a3b8' : '#334155'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(x), Yf(y), PIN_R * sc, 0, 7); ctx.fill(); ctx.stroke();
      if (!down) { ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(X(x), Yf(y), PIN_R * sc * 0.45, 0, 7); ctx.fill(); }
      ctx.fillStyle = down ? '#475569' : '#0f172a'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(i, X(x), Yf(y) + 3.5);
    });
  }
}
