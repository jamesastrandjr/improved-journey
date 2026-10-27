/** minimal line chart on canvas. series: [{y:[], color, label, axis:0|1}], x: [] */
export function lineChart(canvas, x, series, { xLabel = '', yLabels = ['', ''], marks = [], xMax } = {}) {
  const p = canvas.parentElement, dpr = Math.min(2, devicePixelRatio || 1), W = p.clientWidth, H = p.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement); const grid = css.getPropertyValue('--line').trim() || '#2a3547', txt = css.getPropertyValue('--muted').trim() || '#8aa0b8';
  const L = 38, R = 34, T = 8, B = 20, w = W - L - R, h = H - T - B; const xm = xMax || x[x.length - 1] || 1;
  const rng = [0, 1].map((ax) => { const ys = series.filter((s) => (s.axis || 0) === ax).flatMap((s) => Array.from(s.y)); if (!ys.length) return null; let lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 1e-6) hi = lo + 1; const pad = (hi - lo) * 0.08; return [lo - pad, hi + pad]; });
  c.strokeStyle = grid; c.lineWidth = 1; c.font = '10px system-ui'; c.fillStyle = txt;
  for (let i = 0; i <= 4; i++) { const yy = T + (h * i) / 4; c.beginPath(); c.moveTo(L, yy); c.lineTo(L + w, yy); c.stroke(); }
  c.textAlign = 'center'; for (let ft = 0; ft <= xm; ft += 10) { const xx = L + (ft / xm) * w; c.fillText(ft, xx, H - 6); }
  [0, 1].forEach((ax) => { const r = rng[ax]; if (!r) return; c.textAlign = ax ? 'left' : 'right'; for (let i = 0; i <= 4; i++) { const v = r[1] - ((r[1] - r[0]) * i) / 4; c.fillText(v >= 100 ? v.toFixed(0) : v.toFixed(v < 1 ? 2 : 1), ax ? L + w + 4 : L - 4, T + (h * i) / 4 + 3); } });
  for (const m of marks) { const xx = L + (m.x / xm) * w; c.strokeStyle = m.color; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(xx, T); c.lineTo(xx, T + h); c.stroke(); c.setLineDash([]); }
  for (const s of series) {
    const r = rng[s.axis || 0]; c.strokeStyle = s.color; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < x.length; i += 2) { const xx = L + (x[i] / xm) * w, yy = T + h - ((s.y[i] - r[0]) / (r[1] - r[0])) * h; i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke();
  }
}
