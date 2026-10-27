export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);

const FR = ['', '1/16', '1/8', '3/16', '1/4', '5/16', '3/8', '7/16', '1/2', '9/16', '5/8', '11/16', '3/4', '13/16', '7/8', '15/16'];
/** inches -> '4 1/8"' (nearest 1/16) or mm */
export function fmtLen(inches, unit = 'in') {
  if (inches === '' || inches == null || isNaN(inches)) return '';
  if (unit === 'mm') return (inches * 25.4).toFixed(1) + ' mm';
  const neg = inches < 0; let v = Math.abs(inches);
  let whole = Math.floor(v); let s16 = Math.round((v - whole) * 16);
  if (s16 === 16) { whole++; s16 = 0; }
  const f = FR[s16];
  const txt = (whole ? whole : '') + (whole && f ? ' ' : '') + f || '0';
  return (neg ? '-' : '') + txt + '"';
}
/** parse '4 1/8', '4-1/8', '4.125', '105mm', '1/4' -> inches (or NaN) */
export function parseLen(str) {
  let s = String(str).trim().toLowerCase().replace(/["”]/g, '');
  if (!s) return NaN;
  let mm = false;
  if (/mm$/.test(s)) { mm = true; s = s.replace(/mm$/, '').trim(); }
  s = s.replace(/-(?=\d+\/)/, ' ');
  let total = 0;
  for (const part of s.split(/\s+/)) {
    if (/^-?\d+\/\d+$/.test(part)) { const [a, b] = part.split('/').map(Number); total += (a / b) * (part.startsWith('-') ? 1 : 1); }
    else if (/^-?\d*\.?\d+$/.test(part)) total += parseFloat(part);
    else return NaN;
  }
  if (s.startsWith('-') && total > 0) total = -total;
  return mm ? total / 25.4 : total;
}
export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; return d; };
export const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
