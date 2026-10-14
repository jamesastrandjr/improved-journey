/* Lake-bottom engine: depth, slope, humps/drop-offs, contours, structure finder.
   Grid sources (best first): data/bathy.json built from the NCEI Great Lakes bathymetry grid, else NOAA ENC depth contours (coarse). */
(function (root, factory) {
  const api = factory(root.Data || null);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Bathy = api;
})(typeof self !== 'undefined' ? self : this, function (Data) {
  const FT = 3.28084, B = { ready: false, src: null, precision: null, grid: null };
  const rad = Math.PI / 180;

  /* ---------- grid + derived rasters ---------- */
  function setGrid(g, src, precision) {
    const { nx, ny } = g; g.slope = new Float32Array(nx * ny).fill(NaN); g.relief = new Float32Array(nx * ny).fill(NaN); g.tpi = new Float32Array(nx * ny).fill(NaN);
    const mLat = g.dlat * 110540, mLon = (j) => g.dlon * 111320 * Math.cos((g.north - (j + 0.5) * g.dlat) * rad), r = Math.max(1, Math.min(4, Math.round(300 / Math.max(g.dlat * 110540, g.dlon * 85000))));
    const d = g.d, at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? NaN : d[j * nx + i]);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = d[j * nx + i]; if (!Number.isFinite(c)) continue;
      const e = at(i + 1, j), w = at(i - 1, j), n = at(i, j - 1), s = at(i, j + 1), mx = mLon(j);
      const dzx = ((Number.isFinite(e) ? e : c) - (Number.isFinite(w) ? w : c)) / 2 / mx * 0.3048, dzy = ((Number.isFinite(s) ? s : c) - (Number.isFinite(n) ? n : c)) / 2 / mLat * 0.3048;
      g.slope[j * nx + i] = Math.atan(Math.hypot(dzx, dzy)) / rad;
      let mn = c, mxv = c, sum = 0, cnt = 0;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const v = at(i + di, j + dj); if (!Number.isFinite(v)) continue; if (v < mn) mn = v; if (v > mxv) mxv = v; sum += v; cnt++; }
      g.relief[j * nx + i] = mxv - mn; g.tpi[j * nx + i] = sum / cnt - c; // tpi > 0: shallower than surroundings (hump / rise)
    }
    B.grid = g; B.src = src; B.precision = precision; B.ready = true; memo = null;
  }
  function fromJson(j) {
    const { nx, ny } = j, d = new Float32Array(nx * ny);
    if (j.b64) { const bin = atob(j.b64), u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const dv = new DataView(u.buffer); for (let k = 0; k < nx * ny; k++) { const v = dv.getInt16(k * 2, true); d[k] = v === -32768 ? NaN : v / 10; } }
    else j.data.forEach((v, k) => (d[k] = v == null ? NaN : v));
    return { west: j.west, north: j.north, dlon: j.dlon, dlat: j.dlat, nx, ny, d };
  }

  const fx = (g, lon) => (lon - g.west) / g.dlon - 0.5, fy = (g, lat) => (g.north - lat) / g.dlat - 0.5;
  function sample(arr, g, lat, lon) {
    const x = fx(g, lon), y = fy(g, lat), i0 = Math.floor(x), j0 = Math.floor(y); let sw = 0, sv = 0;
    for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) {
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
      const v = arr[j * g.nx + i]; if (!Number.isFinite(v)) continue; const w = (1 - Math.abs(x - i)) * (1 - Math.abs(y - j)); sw += w; sv += w * v;
    }
    return sw > 0.45 ? sv / sw : NaN;
  }
  const depthAt = (lat, lon) => (B.ready ? sample(B.grid.d, B.grid, lat, lon) : NaN);
  const nearest = (arr, g, lat, lon) => { const i = Math.round(fx(g, lon)), j = Math.round(fy(g, lat)); return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? NaN : arr[j * g.nx + i]; };

  /* ---------- point info ---------- */
  let memo = null;
  function structureOf(slope, relief, tpi) { return Math.min(1, Math.min(1, relief / 15) * 0.55 + Math.min(1, slope / 2.5) * 0.3 + Math.min(1, Math.max(0, tpi) / 6) * 0.35); }
  function info(lat, lon) {
    if (!B.ready) return null;
    const key = lat.toFixed(5) + lon.toFixed(5); if (memo && memo.key === key) return memo.v;
    const g = B.grid, ft = depthAt(lat, lon); let v = null;
    if (Number.isFinite(ft)) {
      const slope = nearest(g.slope, g, lat, lon), relief = nearest(g.relief, g, lat, lon), tpi = nearest(g.tpi, g, lat, lon);
      const h = 0.0006, dLat = (depthAt(lat + h, lon) - depthAt(lat - h, lon)), dLon = (depthAt(lat, lon + h) - depthAt(lat, lon - h));
      const down = Number.isFinite(dLat) && Number.isFinite(dLon) ? (Math.atan2(dLon * Math.cos(lat * rad), dLat) / rad + 360) % 360 : null; // bearing toward deeper water
      const along = down == null ? null : (down + 90) % 180; // contour runs along this axis (0-180)
      const kind = slope >= 2.5 ? 'steep drop-off' : slope >= 1 ? 'sloping edge' : tpi >= 4 || relief >= 8 ? 'hump / rise' : tpi <= -4 ? 'hole / trough' : 'flat bottom';
      v = { ft, slope, relief, tpi, down, along, kind, structure: structureOf(slope, relief, tpi) };
    }
    memo = { key, v }; return v;
  }
  function quick(lat, lon) {
    if (!B.ready) return null; const g = B.grid, ft = depthAt(lat, lon); if (!Number.isFinite(ft)) return null;
    return { ft, structure: structureOf(nearest(g.slope, g, lat, lon), nearest(g.relief, g, lat, lon), nearest(g.tpi, g, lat, lon)), kind: '' };
  }
  const structureAt = (lat, lon) => { const i = info(lat, lon); return i ? i.structure : 0; };

  /* ---------- structure finder ---------- */
  function findSpots({ lo, hi, home, maxMi = 20, count = 6, minStructure = 0.35 }) {
    if (!B.ready) return [];
    const g = B.grid, stride = Math.max(1, Math.round(0.002 / g.dlat)), out = [];
    for (let j = 2; j < g.ny - 2; j += stride) for (let i = 2; i < g.nx - 2; i += stride) {
      const k = j * g.nx + i, ft = g.d[k]; if (!Number.isFinite(ft) || ft < lo - 6 || ft > hi + 6) continue;
      const st = structureOf(g.slope[k], g.relief[k], g.tpi[k]); if (st < minStructure) continue;
      const lat = g.north - (j + 0.5) * g.dlat, lon = g.west + (i + 0.5) * g.dlon, mi = home ? miles(home, { lat, lon }) : 0; if (mi > maxMi) continue;
      const fit = ft >= lo && ft <= hi ? 1 : 0.7; out.push({ lat, lon, ft, mi, st, kind: info(lat, lon).kind, val: st * fit - mi * 0.012 });
    }
    out.sort((a, b) => b.val - a.val); const pick = [];
    for (const c of out) { if (pick.every((p) => miles(p, c) > 1.6)) pick.push(c); if (pick.length >= count) break; }
    return pick;
  }
  function miles(a, b) { const R = 3958.8, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad, x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }

  /* ---------- contours (marching squares) ---------- */
  function contours(levels, stride = 1) {
    const g = B.grid, out = {}; if (!B.ready) return out;
    const ll = (x, y) => [g.north - (y + 0.5) * g.dlat, g.west + (x + 0.5) * g.dlon];
    for (const L of levels) {
      const segs = [];
      for (let j = 0; j + stride < g.ny; j += stride) for (let i = 0; i + stride < g.nx; i += stride) {
        const a = g.d[j * g.nx + i], b = g.d[j * g.nx + i + stride], c = g.d[(j + stride) * g.nx + i + stride], d = g.d[(j + stride) * g.nx + i];
        if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
        const code = (a >= L ? 8 : 0) + (b >= L ? 4 : 0) + (c >= L ? 2 : 0) + (d >= L ? 1 : 0); if (code === 0 || code === 15) continue;
        const t = (v1, v2) => (L - v1) / (v2 - v1), P = {
          top: () => ll(i + stride * t(a, b), j), right: () => ll(i + stride, j + stride * t(b, c)), bottom: () => ll(i + stride * t(d, c), j + stride), left: () => ll(i, j + stride * t(a, d)),
        };
        const T = { 1: [['left', 'bottom']], 2: [['bottom', 'right']], 3: [['left', 'right']], 4: [['top', 'right']], 5: [['top', 'left'], ['bottom', 'right']], 6: [['top', 'bottom']], 7: [['top', 'left']], 8: [['top', 'left']], 9: [['top', 'bottom']], 10: [['top', 'right'], ['left', 'bottom']], 11: [['top', 'right']], 12: [['left', 'right']], 13: [['bottom', 'right']], 14: [['left', 'bottom']] }[code];
        T.forEach(([e1, e2]) => segs.push([P[e1](), P[e2]()]));
      }
      if (segs.length) out[L] = segs;
    }
    return out;
  }

  /* ---------- depth shading canvas ---------- */
  function shadeCanvas(w = 300, h = 200, bounds) {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null; if (!c || !B.ready) return null; c.width = w; c.height = h;
    const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const lat = bounds.north - ((y + 0.5) / h) * (bounds.north - bounds.south), lon = bounds.west + ((x + 0.5) / w) * (bounds.east - bounds.west), d = depthAt(lat, lon), o = (y * w + x) * 4;
      if (!Number.isFinite(d)) { img.data[o + 3] = 0; continue; }
      const t = Math.min(1, d / 90); img.data[o] = Math.round(120 - 105 * t); img.data[o + 1] = Math.round(205 - 150 * t); img.data[o + 2] = Math.round(235 - 60 * t); img.data[o + 3] = 150;
    }
    ctx.putImageData(img, 0, 0); return c;
  }

  /* ---------- loaders ---------- */
  async function getJSON(url, ms = 15000) { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms); try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } }
  const BOUNDS = { west: -81.35, east: -80.55, south: 41.78, north: 42.35 };

  /* NOAA ENC depth contours + spot soundings from several chart scale bands -> one interpolated grid.
     Layer ids are looked up from each service's own layer list (only general-band contours = layer 64 is hard-coded). Finer bands and soundings weigh more. */
  const ENC_ROOT = 'https://encdirect.noaa.gov/arcgis/rest/services/encdirect/', BANDS = [['enc_approach', 3], ['enc_coastal', 2], ['enc_general', 1]];
  async function discover(service) {
    const j = await getJSON(`${ENC_ROOT}${service}/MapServer?f=json`, 10000), L = j.layers || [];
    const c = L.find((l) => /depth[_ ]?contour[_ ]?line/i.test(l.name)), sd = L.find((l) => /sounding/i.test(l.name) && !/line|area|bar/i.test(l.name));
    return { contour: c ? c.id : null, sounding: sd ? sd.id : null };
  }
  async function queryLayer(service, id, bb) {
    const base = `${ENC_ROOT}${service}/MapServer/${id}/query`, out = [];
    for (let off = 0; off < 6000; off += 1000) {
      const j = await getJSON(`${base}?where=1%3D1&geometry=${bb.west},${bb.south},${bb.east},${bb.north}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=4326&returnZ=true&f=geojson&resultRecordCount=1000&resultOffset=${off}`);
      out.push(...(j.features || [])); if (!(j.properties && j.properties.exceededTransferLimit) && (j.features || []).length < 1000) break;
    }
    return out;
  }
  async function loadEnc(opts = {}) {
    const bb = Object.assign({}, BOUNDS, opts.bounds), pts = [], used = [];
    for (const [svc, w] of BANDS) {
      let ids = null; try { ids = await discover(svc); } catch (e) {}
      if (!ids && svc === 'enc_general') ids = { contour: 64, sounding: null };
      if (!ids) continue;
      let n = 0;
      for (const [kind, id, wt] of [['contour', ids.contour, w], ['sounding', ids.sounding, w * 1.5]]) {
        if (id == null) continue;
        try { const f = await queryLayer(svc, id, bb), p = featsToPts(f, wt); n += p.length; pts.push(...p); } catch (e) {}
      }
      if (n) used.push(svc.replace('enc_', ''));
    }
    if (pts.length < 20) throw new Error('no chart depth data returned for that area');
    return Object.assign(gridFromPts(pts, bb), { label: used.join('+') });
  }
  /* GeoJSON features -> [lon, lat, depth, weight]; contour lines are densified, soundings keep their own z/depth value */
  function featsToPts(feats, weight = 1, cell = 0.003) {
    const pts = [];
    feats.forEach((f) => {
      const p = f.properties || {}, key = Object.keys(p).find((k) => /^valdco$/i.test(k)) || Object.keys(p).find((k) => /^(valsou|depth|dep\w*)$/i.test(k) && Number.isFinite(+p[k])), g = f.geometry; if (!g) return;
      const prop = key ? +p[key] : NaN;
      if (g.type === 'LineString' || g.type === 'MultiLineString') {
        if (!Number.isFinite(prop) || prop <= 0) return;
        (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach((ln) => { for (let k = 0; k < ln.length; k++) { pts.push([ln[k][0], ln[k][1], prop, weight]); if (k) { const [x0, y0] = ln[k - 1], [x1, y1] = ln[k], n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / (cell * 0.7)); for (let s = 1; s < n; s++) pts.push([x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, prop, weight]); } } });
      } else if (g.type === 'Point' || g.type === 'MultiPoint') {
        (g.type === 'Point' ? [g.coordinates] : g.coordinates).forEach((c) => { const v = Number.isFinite(c[2]) && c[2] > 0 ? c[2] : prop; if (Number.isFinite(v) && v > 0) pts.push([c[0], c[1], v, weight]); });
      }
    });
    return pts;
  }
  function gridFromContours(feats, bb, cell) { return gridFromPts(featsToPts(feats, 1), bb, cell); }
  function gridFromPts(pts, bb, cell = 0.0025) {
    if (pts.length < 20) throw new Error('no depth data in that area');
    const mx = pts.reduce((m, p) => Math.max(m, p[2]), 0), toFt = mx > 80 ? 1 : FT; // S-57 depths are metres; anything beyond Lake Erie's ~210 ft maximum cannot be metres
    const nx = Math.round((bb.east - bb.west) / cell), ny = Math.round((bb.north - bb.south) / cell), bin = 0.02, bins = new Map();
    pts.forEach((p) => { const k = Math.floor((p[0] - bb.west) / bin) + ',' + Math.floor((p[1] - bb.south) / bin); (bins.get(k) || bins.set(k, []).get(k)).push(p); });
    const d = new Float32Array(nx * ny).fill(NaN);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const lon = bb.west + (i + 0.5) * cell, lat = bb.north - (j + 0.5) * cell; if (lat < (Data ? Data.shoreLat(lon) : 41.868 + 0.28 * (lon + 80.95)) + 0.002) continue;
      const bx = Math.floor((lon - bb.west) / bin), by = Math.floor((lat - bb.south) / bin); let cand = [];
      for (let r = 1; r <= 4 && cand.length < 12; r++) { cand = []; for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { const a = bins.get(bx + dx + ',' + (by + dy)); if (a) cand.push(...a); } }
      if (!cand.length) continue;
      const near = cand.map((p) => ({ p, dd: ((p[0] - lon) * 0.74) ** 2 + (p[1] - lat) ** 2 + 1e-9 })).sort((a, b) => a.dd - b.dd).slice(0, 8);
      let sw = 0, sv = 0; near.forEach(({ p, dd }) => { const w = p[3] / dd; sw += w; sv += w * p[2]; }); d[j * nx + i] = (sv / sw) * toFt;
    }
    return { grid: { west: bb.west, north: bb.north, dlon: cell, dlat: cell, nx, ny, d }, features: pts.length };
  }

  async function load() {
    try { const j = await getJSON('data/bathy.json?ts=' + Math.floor(Date.now() / 3600000)); setGrid(fromJson(j), j.src || 'NCEI bathymetry grid', 'precise'); return B.src; } catch (e) {}
    try { const r = await loadEnc(); setGrid(r.grid, 'NOAA ENC chart (' + r.label + ')', 'coarse'); return B.src; } catch (e) { B.error = e.message; return null; }
  }

  /* walleye depth target (ft) from water temp, nudged toward depths anglers report */
  function target(T, rep) {
    const t = T < 45 ? [15, 35] : T < 55 ? [15, 40] : T < 62 ? [25, 50] : T < 68 ? [35, 58] : T < 74 ? [45, 70] : [55, 75];
    if (rep && rep.depth && rep.n) { const w = Math.min(0.7, 0.35 + 0.1 * rep.n); return [Math.round(t[0] * (1 - w) + (rep.depth[0] - 6) * w), Math.round(t[1] * (1 - w) + (rep.depth[1] + 6) * w)]; }
    return t;
  }

  return { B, FT, quick, setGrid, fromJson, depthAt, info, structureAt, findSpots, contours, shadeCanvas, load, loadEnc, featsToPts, gridFromPts, gridFromContours, target, BOUNDS };
});
