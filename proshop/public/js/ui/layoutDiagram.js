import { BALL_R, IN, rad, deg, clamp } from '../physics/units.js';
import { surfacePoint, pinPosition, gripGeometry, pinBuffer, v3 } from '../physics/ball.js';
import { fmtLen } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 30; // px per inch
const RPX = 4.25 * S;
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.append(e); return e; };
const proj = (p) => [p[0] * RPX, -p[1] * RPX];

/** draws the grip-face layout into svg. Returns geometry used for hit-testing. */
export function drawLayout(svg, st, { interactive = false, mono = false } = {}) {
  svg.textContent = '';
  const f = st.fitting;
  const grip = gripGeometry({ ...f.hand, style: st.profile.style });
  const pap = surfacePoint(+f.delivery.papOver || 0, +f.delivery.papUp || 0);
  const pin = pinPosition(pap, +f.layout.pinDistance || 0, +f.layout.valAngle || 0);
  const ink = mono ? '#111' : 'var(--ink)';
  const g = el('g', { transform: `translate(${RPX + 14},${RPX + 14})` }, svg);
  svg.setAttribute('viewBox', `0 0 ${RPX * 2 + 28} ${RPX * 2 + 28}`);
  el('circle', { r: RPX, fill: mono ? '#fff' : f.ball.color || '#0e7490', 'fill-opacity': mono ? 1 : 0.9, stroke: ink, 'stroke-width': 2 }, g);
  if (!mono) el('circle', { r: RPX, fill: 'url(#shade)' }, g);
  // track (great circle 90 deg from PAP)
  const pts = [];
  const u1 = v3.norm(v3.cross(pap, [0, 0, 1].map((x, i) => x + 0.001 * i)));
  const u2 = v3.cross(pap, u1);
  for (let a = 0; a <= 360; a += 4) { const c = v3.add(v3.scale(u1, Math.cos(rad(a))), v3.scale(u2, Math.sin(rad(a)))); if (c[2] > 0) pts.push(proj(c).join(',')); }
  el('polyline', { points: pts.join(' '), fill: 'none', stroke: mono ? '#555' : '#fff', 'stroke-opacity': 0.55, 'stroke-dasharray': '4 4' }, g);
  // holes
  const hole = (x, y, d, label) => { const [px, py] = proj(surfacePoint(x, y)); el('ellipse', { cx: px, cy: py, rx: (d / 2) * S, ry: (d / 2) * S * 0.96, fill: mono ? '#ddd' : '#0b0f14', stroke: ink, 'stroke-width': 1.5 }, g); if (label) { const t = el('text', { x: px, y: py + 4, 'text-anchor': 'middle', 'font-size': 10, fill: mono ? '#000' : '#9fb3c8' }, g); t.textContent = label; } };
  grip.fingers.forEach((fg, i) => hole(fg.x, fg.y, fg.d, i ? 'R' : 'M'));
  if (grip.thumb) hole(grip.thumb.x, grip.thumb.y, grip.thumb.d, 'T');
  // grip centre
  el('circle', { r: 3, fill: ink }, g);
  // VAL (vertical axis line through PAP) and pin line
  const [px, py] = proj(pap); const [qx, qy] = proj(pin);
  el('line', { x1: px, y1: py - RPX * 0.55, x2: px, y2: py + RPX * 0.55, stroke: ink, 'stroke-opacity': 0.5, 'stroke-dasharray': '2 4' }, g);
  el('line', { x1: px, y1: py, x2: qx, y2: qy, stroke: '#ffd166', 'stroke-width': 2 }, g);
  const papDot = el('circle', { cx: px, cy: py, r: 8, fill: '#22c55e', stroke: '#fff', 'stroke-width': 2, class: interactive ? 'drag' : '' }, g);
  const pinDot = el('circle', { cx: qx, cy: qy, r: 8, fill: '#ef4444', stroke: '#fff', 'stroke-width': 2, class: interactive ? 'drag' : '' }, g);
  for (const [x, y, t] of [[px, py, 'PAP'], [qx, qy, 'PIN']]) { const tx = el('text', { x: x + 11, y: y - 9, 'font-size': 11, 'font-weight': 700, fill: mono ? '#000' : '#fff', stroke: mono ? '#fff' : '#000', 'stroke-width': 3, 'paint-order': 'stroke' }, g); tx.textContent = t; }
  return { g, papDot, pinDot, pap, pin, grip, buffer: pinBuffer(pin, grip), origin: RPX + 14 };
}

export function createLayoutDiagram(host, st, onChange, unit) {
  const svg = el('svg', { class: 'layoutsvg', role: 'img', 'aria-label': 'Grip layout diagram' });
  const defs = el('defs', {}, svg);
  const rg = el('radialGradient', { id: 'shade', cx: '35%', cy: '30%', r: '75%' }, defs);
  el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': 0.28 }, rg);
  el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': 0.35 }, rg);
  const cap = document.createElement('div'); cap.className = 'diagcap';
  host.append(svg, cap);
  let geo, drag = null;
  const render = () => {
    const old = svg.querySelector('g'); const keepDefs = defs;
    const tmp = document.createElementNS(NS, 'svg');
    geo = drawLayout(tmp, st, { interactive: true });
    old?.remove(); svg.append(geo.g);
    const buf = geo.buffer;
    cap.innerHTML = `<b>Grip face</b> (fingers up). Drag the <span style="color:#22c55e">PAP</span> or the <span style="color:#ef4444">pin</span>.<br>Pin buffer: <b>${fmtLen(Math.max(0, buf), unit())}</b>${buf < 0.75 ? ' <span class="bad">- under 3/4" is tight</span>' : ''} &middot; PAP over/up: ${fmtLen(+st.fitting.delivery.papOver, unit())} / ${fmtLen(+st.fitting.delivery.papUp, unit())} &middot; Pin-PAP ${fmtLen(+st.fitting.layout.pinDistance, unit())} @ ${Math.round(+st.fitting.layout.valAngle)}&deg;`;
  };
  const toFace = (e) => {
    const r = svg.getBoundingClientRect(); const k = (RPX * 2 + 28) / r.width;
    const x = ((e.clientX - r.left) * k - (RPX + 14)) / RPX, y = -((e.clientY - r.top) * k - (RPX + 14)) / RPX;
    const m = Math.hypot(x, y); const s = m > 0.98 ? 0.98 / m : 1;
    const X = x * s, Y = y * s; return [X, Y, Math.sqrt(Math.max(0, 1 - X * X - Y * Y))];
  };
  svg.addEventListener('pointerdown', (e) => {
    const t = e.target; if (t.classList?.contains('drag')) { drag = t === geo.papDot ? 'pap' : 'pin'; svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toFace(e);
    if (drag === 'pap') {
      const over = Math.asin(clamp(p[0], -1, 1)) * BALL_R / IN, up = Math.asin(clamp(p[1], -1, 1)) * BALL_R / IN;
      st.fitting.delivery.papOver = Math.round(clamp(over, 0.5, 7) * 16) / 16; st.fitting.delivery.papUp = Math.round(clamp(up, -3, 3.5) * 16) / 16;
      onChange('fitting.delivery.papOver'); 
    } else {
      const pap = geo.pap; const dist = Math.acos(clamp(v3.dot(p, pap), -1, 1)) * BALL_R / IN;
      const tang = (a, b) => { const t = v3.sub(b, v3.scale(a, v3.dot(a, b))); return v3.norm(t); };
      const up = tang(pap, [0, 1, 0]), cen = tang(pap, [0, 0, 1]);
      const dir = tang(pap, p);
      let val = deg(Math.atan2(v3.dot(dir, cen), v3.dot(dir, up))); val = Math.abs(val);
      st.fitting.layout.pinDistance = Math.round(clamp(dist, 0, 6.5) * 16) / 16; st.fitting.layout.valAngle = Math.round(val);
      onChange('fitting.layout.pinDistance');
    }
    render();
  });
  const end = () => { drag = null; };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  render();
  return { refresh: render };
}
