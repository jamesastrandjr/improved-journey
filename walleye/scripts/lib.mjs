/* Parsers used by the report fetcher (and unit-tested offline). */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', deg: '°' };
export const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
export function htmlToText(html) {
  let h = String(html);
  const main = /<(main|article)[\s>][\s\S]*?<\/\1>/i.exec(h); if (main) h = main[0];
  h = h.replace(/<(script|style|nav|footer|header|aside|form|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(h).replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
const tag = (x, t) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i').exec(x); return m ? decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : ''; };
export function parseRss(xml) {
  const out = [], blocks = String(xml).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  blocks.forEach((b) => {
    const title = tag(b, 'title'); let link = tag(b, 'link'); if (!link) { const m = /<link[^>]*href="([^"]+)"/i.exec(b); link = m ? m[1] : ''; }
    const date = tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date');
    const body = tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    out.push({ title, link, t: date ? Date.parse(date) || null : null, text: htmlToText(body) });
  });
  return out;
}
/* NDBC realtime2 text file -> latest observation in US units */
export function parseNdbc(txt) {
  const lines = String(txt).trim().split(/\r?\n/); const head = lines.find((l) => l.startsWith('#')); if (!head) return null;
  const cols = head.replace(/^#/, '').trim().split(/\s+/), row = lines.find((l) => !l.startsWith('#')); if (!row) return null;
  const v = row.trim().split(/\s+/), g = (k) => { const i = cols.indexOf(k); return i >= 0 && v[i] !== 'MM' ? +v[i] : null; };
  const t = Date.UTC(+v[0], +v[1] - 1, +v[2], +v[3], +v[4]);
  const mph = (x) => (x == null ? null : +(x * 2.23694).toFixed(1)), ft = (x) => (x == null ? null : +(x * 3.28084).toFixed(1)), F = (x) => (x == null ? null : +((x * 9) / 5 + 32).toFixed(1));
  return { t, windDir: g('WDIR'), wind: mph(g('WSPD')), gust: mph(g('GST')), wave: ft(g('WVHT')), period: g('DPD'), pres: g('PRES'), airT: F(g('ATMP')), waterT: F(g('WTMP')) };
}
/* NWS nearshore/marine text: choose the zone block that mentions our towns */
export function pickZone(text, re = /LEZ14[78]|geneva|conneaut/i) {
  const blocks = String(text).split(/\n\s*\$\$\s*\n?/).map((b) => b.trim()).filter(Boolean);
  const hit = blocks.filter((b) => re.test(b)).slice(0, 2), use = hit.length ? hit : blocks.slice(0, 1);
  return use.join('\n\n').replace(/\n(?!\n)/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 1800);
}

/* ---------- ESRI ARC ASCII grid (an NCEI Grid Extract format) -> depth grid in feet ---------- */
export function parseAsc(text) {
  const lines = String(text).split(/\r?\n/), h = {}; let k = 0;
  for (; k < lines.length; k++) { const m = /^\s*([A-Za-z_]+)\s+(-?[\d.eE+-]+)\s*$/.exec(lines[k]); if (!m) break; h[m[1].toLowerCase()] = +m[2]; }
  const nx = h.ncols, ny = h.nrows, cell = h.cellsize, nodata = h.nodata_value ?? -9999;
  if (!nx || !ny || !cell) throw new Error('not an ARC ASCII grid (missing ncols/nrows/cellsize)');
  const west = h.xllcorner ?? h.xllcenter - cell / 2, south = h.yllcorner ?? h.yllcenter - cell / 2, v = new Float32Array(nx * ny).fill(NaN);
  let n = 0; for (; k < lines.length && n < nx * ny; k++) { const t = lines[k].trim(); if (!t) continue; for (const s of t.split(/\s+/)) { if (n >= nx * ny) break; const x = +s; v[n++] = x === nodata ? NaN : x; } }
  return { nx, ny, cell, west, north: south + ny * cell, v };
}
export function ascToDepth(asc, { units = 'm', mode = 'auto', surfaceM = 173.5, factor = 1, bbox = { west: -81.35, east: -80.55, south: 41.78, north: 42.35 } } = {}) {
  const valid = Array.from(asc.v).filter(Number.isFinite).sort((a, b) => a - b), med = valid[Math.floor(valid.length / 2)] ?? 0;
  if (mode === 'auto') mode = med > 90 ? 'elevation' : med < 0 ? 'negative' : 'depth';
  const toFt = units === 'ft' ? 1 : 3.28084, conv = (x) => (mode === 'elevation' ? (surfaceM - x) * (units === 'ft' ? 1 / 3.28084 : 1) * toFt : mode === 'negative' ? -x * toFt : x * toFt);
  // crop
  const i0 = Math.max(0, Math.floor((bbox.west - asc.west) / asc.cell)), i1 = Math.min(asc.nx, Math.ceil((bbox.east - asc.west) / asc.cell)), j0 = Math.max(0, Math.floor((asc.north - bbox.north) / asc.cell)), j1 = Math.min(asc.ny, Math.ceil((asc.north - bbox.south) / asc.cell));
  if (i1 <= i0 || j1 <= j0) throw new Error('grid does not overlap the Lake Erie fishing area');
  const nx = Math.floor((i1 - i0) / factor), ny = Math.floor((j1 - j0) / factor), d = new Float32Array(nx * ny).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0, c = 0; for (let dj = 0; dj < factor; dj++) for (let di = 0; di < factor; di++) { const x = asc.v[(j0 + j * factor + dj) * asc.nx + (i0 + i * factor + di)]; if (Number.isFinite(x)) { const f = conv(x); if (f > 0.3) { s += f; c++; } } }
    if (c >= (factor * factor) / 2) d[j * nx + i] = s / c;
  }
  return { mode, nx, ny, west: asc.west + i0 * asc.cell, north: asc.north - j0 * asc.cell, dlon: asc.cell * factor, dlat: asc.cell * factor, d };
}
export function encodeBathy(g, note) {
  const buf = Buffer.alloc(g.nx * g.ny * 2); g.d.forEach((v, k) => buf.writeInt16LE(Number.isFinite(v) ? Math.max(-32767, Math.min(32767, Math.round(v * 10))) : -32768, k * 2));
  return { v: 1, src: 'NCEI Great Lakes bathymetry', note, units: 'ft', west: g.west, north: g.north, dlon: g.dlon, dlat: g.dlat, nx: g.nx, ny: g.ny, b64: buf.toString('base64') };
}
