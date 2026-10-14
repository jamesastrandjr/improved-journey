/* Interactive map: the pulsing "should I fish" dot, live score heat-field, wind arrows, radar, run rings, catch pins. */
(function (G) {
  const { Astro, Model, Data } = G;
  const $ = (s) => document.querySelector(s);
  let contourLayer, labelLayer, shadeLayer, structLayer, map, dot, dotEl, homeMarker, heat, windLayer, windEls = [], rings, ringsLbl, catchLayer, seaMarks, bases = {}, baseKey, radarLayers = [], radarTimer = null, radarIdx = 0, lake;
  const HB = L.latLngBounds([41.78, -81.3], [42.24, -80.6]);

  /* ---------- color ramp ---------- */
  const STOPS = [[0, [255, 59, 92]], [36, [255, 154, 60]], [52, [255, 210, 63]], [68, [156, 240, 74]], [82, [44, 240, 163]], [100, [44, 240, 163]]];
  function ramp(s) {
    s = Math.max(0, Math.min(100, s));
    for (let i = 1; i < STOPS.length; i++) if (s <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = (s - a) / (b - a || 1);
      return ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
    }
    return STOPS[STOPS.length - 1][1];
  }
  const rampCss = (s) => `rgb(${ramp(s).join(',')})`;

  function windColor(w) { return w < 8 ? '#7fd8ff' : w < 15 ? '#5ff0b0' : w < 22 ? '#ffd23f' : '#ff5c7a'; }

  function init() {
    map = L.map('map', { zoomControl: true, attributionControl: true, zoomSnap: 0.25, minZoom: 7, maxZoom: 16, preferCanvas: true }).fitBounds([[41.8, -81.25], [42.2, -80.65]]);
    window._map = map;

    // always-there vector lake so the map still reads when tiles are slow/offline
    const shore = [];
    for (let lon = -82; lon <= -79.8; lon += 0.1) shore.push([Data.shoreLat(lon), lon]);
    map.createPane('lake'); map.getPane('lake').style.zIndex = 150;
    lake = L.polygon([...shore, [43.2, -79.8], [43.2, -82]], { pane: 'lake', stroke: false, fillColor: '#0c3552', fillOpacity: 1, interactive: false }).addTo(map);
    L.polyline(shore, { pane: 'lake', color: '#3d7ea6', weight: 2, opacity: 0.9, interactive: false }).addTo(map);

    const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 16, attribution: '© OpenStreetMap · © CARTO' });
    const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 16, attribution: '© OpenStreetMap · © CARTO' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Imagery © Esri' });
    const noaa = L.tileLayer('https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png', { maxZoom: 16, attribution: 'Charts: NOAA' });
    bases = { dark, sat, noaa, light };
    seaMarks = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 16, attribution: '© OpenSeaMap' });

    // paint panes above tiles
    map.createPane('heat'); map.getPane('heat').style.zIndex = 350; map.getPane('heat').style.mixBlendMode = 'normal';
    map.createPane('radar'); map.getPane('radar').style.zIndex = 360; map.getPane('radar').style.pointerEvents = 'none';

    heat = L.imageOverlay(blank(), HB, { pane: 'heat', opacity: 0.8, interactive: false }).addTo(map);
    windLayer = L.layerGroup().addTo(map);
    rings = L.layerGroup().addTo(map);
    catchLayer = L.layerGroup().addTo(map);
    map.createPane('shade'); map.getPane('shade').style.zIndex = 340; map.getPane('shade').style.pointerEvents = 'none';
    contourLayer = L.layerGroup(); labelLayer = L.layerGroup(); structLayer = L.layerGroup();
    map.on('zoomend', () => applyLabels());

    // wind arrow field
    Data.gridPoints.forEach((p) => {
      const m = L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="warr"><svg viewBox="0 0 24 24"><path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="#7fd8ff" stroke="#031018" stroke-width="1.4" stroke-linejoin="round"/></svg><span></span></div>` }) });
      m.addTo(windLayer); windEls.push(m);
    });

    // home port
    homeMarker = L.marker([S.home.lat, S.home.lon], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: '<div class="homepin">⚓</div>' }), zIndexOffset: 500, keyboard: false })
      .bindTooltip('', { permanent: true, direction: 'bottom', offset: [0, 10], className: 'homelbl' }).addTo(map);

    // THE DOT
    dot = L.marker([S.spot.lat, S.spot.lon], {
      draggable: true, zIndexOffset: 1000, autoPan: true, title: 'Drag me — or click anywhere on the water',
      icon: L.divIcon({ className: '', iconSize: [64, 64], iconAnchor: [32, 32], html: '<div class="dotwrap" id="dotw"><i class="ring r1"></i><i class="ring r2"></i><div class="core"><b id="dotNum">–</b></div><div class="tag" id="dotTag">…</div></div>' }),
    }).addTo(map);
    dot.on('drag', (e) => G.App.setSpot(e.latlng, false));
    dot.on('dragend', () => G.App.setSpot(dot.getLatLng(), true));
    map.on('click', (e) => G.App.setSpot(e.latlng, true, true));
    dotEl = () => $('#dotw');

    buildLayerUI();
    applyLayers();
    updateHome();
    updateSpot();
    setTimeout(() => map.invalidateSize(), 50);
  }

  function blank() { const c = document.createElement('canvas'); c.width = c.height = 2; return c.toDataURL(); }

  /* ---------- layer chips ---------- */
  function buildLayerUI() {
    const el = $('#layers');
    el.innerHTML = `<div class="seg" id="baseSeg">${[['dark', 'Dark'], ['sat', 'Satellite'], ['noaa', 'NOAA chart'], ['light', 'Light']].map(([k, n]) => `<button data-b="${k}">${n}</button>`).join('')}</div>` +
      [['heat', '🔥 Bite map'], ['contours', '📐 Contours'], ['depth', '🌊 Depth shade'], ['struct', '🎯 Structure'], ['wind', '💨 Wind'], ['radar', '📡 Radar'], ['rings', '◎ Run rings'], ['catches', '🐟 Catches'], ['sea', '⛯ Sea marks']].map(([k, n]) => `<button class="chip" data-l="${k}">${n}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-b]'), l = e.target.closest('[data-l]');
      if (b) { S.base = b.dataset.b; applyLayers(); G.App.save(); }
      if (l) { const k = l.dataset.l; S.layers[k] = !S.layers[k]; applyLayers(); G.App.save(); if (k === 'radar' && S.layers.radar) loadRadar(); }
    });
  }
  function applyLayers() {
    Object.entries(bases).forEach(([k, lyr]) => { const on = k === S.base; if (on && !map.hasLayer(lyr)) lyr.addTo(map).bringToBack(); if (!on && map.hasLayer(lyr)) map.removeLayer(lyr); });
    document.querySelectorAll('#baseSeg button').forEach((b) => b.classList.toggle('on', b.dataset.b === S.base));
    document.querySelectorAll('#layers .chip').forEach((b) => b.classList.toggle('on', !!S.layers[b.dataset.l]));
    toggle(contourLayer, S.layers.contours); applyLabels(); toggle(structLayer, S.layers.struct); if (shadeLayer) toggle(shadeLayer, S.layers.depth);
    toggle(heat, S.layers.heat); toggle(windLayer, S.layers.wind); toggle(rings, S.layers.rings); toggle(catchLayer, S.layers.catches); toggle(seaMarks, S.layers.sea);
    $('#legend').style.display = S.layers.heat ? 'flex' : 'none';
    if (S.layers.radar) loadRadar(); else stopRadar();
  }
  function toggle(l, on) { if (on && !map.hasLayer(l)) l.addTo(map); if (!on && map.hasLayer(l)) map.removeLayer(l); }

  /* ---------- radar ---------- */
  function stopRadar() { clearInterval(radarTimer); radarTimer = null; radarLayers.forEach((l) => map.removeLayer(l.layer)); radarLayers = []; $('#radarLbl').style.display = 'none'; }
  function loadRadar() {
    const D = S.D;
    if (!D || !D.radar || !D.radar.frames.length) { $('#radarLbl').style.display = 'block'; $('#radarLbl').textContent = D && D.demo ? 'Radar unavailable in demo mode' : 'Radar feed unavailable'; return; }
    if (radarLayers.length) return;
    const frames = D.radar.frames.slice(-10);
    radarLayers = frames.map((f) => ({ f, layer: L.tileLayer(`${D.radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { pane: 'radar', opacity: 0, maxNativeZoom: 7, maxZoom: 16, tileSize: 256 }).addTo(map) }));
    radarIdx = Math.max(0, radarLayers.length - 1 - 2);
    $('#radarLbl').style.display = 'block';
    const step = () => {
      radarLayers.forEach((l, i) => l.layer.setOpacity(i === radarIdx ? 0.62 : 0));
      const f = radarLayers[radarIdx].f, d = new Date(f.time * 1000), fut = f.time * 1000 > Date.now() + 60000;
      $('#radarLbl').textContent = `📡 Radar · ${d.toLocaleTimeString('en-US', { timeZone: Astro.TZ, hour: 'numeric', minute: '2-digit' })}${fut ? ' (forecast)' : ''}`;
      radarIdx = (radarIdx + 1) % radarLayers.length;
    };
    step(); radarTimer = setInterval(step, 700);
  }

  /* ---------- bottom: contours, depth shade, structure markers ---------- */
  function applyLabels() { if (!map || !labelLayer) return; const on = S.layers.contours && map.getZoom() >= 11; if (on && !map.hasLayer(labelLayer)) labelLayer.addTo(map); if (!on && map.hasLayer(labelLayer)) map.removeLayer(labelLayer); }
  function updateBathy() {
    const B = G.Bathy; contourLayer.clearLayers(); labelLayer.clearLayers(); if (shadeLayer) { map.removeLayer(shadeLayer); shadeLayer = null; }
    if (!B || !B.B.ready) { updateStructure(); return; }
    const g = B.B.grid, stride = Math.max(1, Math.round(0.0022 / g.dlat)), levels = []; for (let L = 10; L <= 100; L += 5) levels.push(L);
    const cs = B.contours(levels, stride), r = L.canvas({ padding: 0.3 });
    Object.entries(cs).forEach(([lv, segs]) => {
      const L_ = +lv, major = L_ % 25 === 0, tens = L_ % 10 === 0;
      L.polyline(segs, { renderer: r, color: major ? '#d6efff' : '#9fd8ff', weight: major ? 1.8 : tens ? 1.1 : 0.7, opacity: major ? 0.8 : 0.5, interactive: false, smoothFactor: 1 }).addTo(contourLayer);
      if (tens) { const step = Math.max(1, Math.floor(segs.length / 5)); for (let k = Math.floor(step / 2); k < segs.length; k += step) { const m = [(segs[k][0][0] + segs[k][1][0]) / 2, (segs[k][0][1] + segs[k][1][1]) / 2]; L.marker(m, { interactive: false, icon: L.divIcon({ className: 'ctlbl', html: `${L_}`, iconSize: [24, 12], iconAnchor: [12, 6] }) }).addTo(labelLayer); } }
    });
    const bounds = { west: g.west, east: g.west + g.nx * g.dlon, north: g.north, south: g.north - g.ny * g.dlat }, cv = B.shadeCanvas(300, Math.round(300 * (bounds.north - bounds.south) / ((bounds.east - bounds.west) * 0.74)), bounds);
    if (cv) shadeLayer = L.imageOverlay(cv.toDataURL(), [[bounds.south, bounds.west], [bounds.north, bounds.east]], { pane: 'shade', opacity: 0.65, interactive: false });
    applyLayers(); updateStructure();
  }
  function updateStructure() {
    structLayer.clearLayers();
    (S.structSpots || []).forEach((p, k) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="stpin">${k + 1}</div>` }) })
      .bindTooltip(`${Math.round(p.ft)} ft · ${p.kind} · ${p.mi.toFixed(1)} mi`, { direction: 'top' }).on('click', () => G.App.setSpot({ lat: p.lat, lng: p.lon }, true)).addTo(structLayer));
  }

  /* ---------- home + rings ---------- */
  function updateHome() {
    homeMarker.setLatLng([S.home.lat, S.home.lon]).setTooltipContent(S.home.name || 'Home port');
    rings.clearLayers();
    [3, 6, 10, 15, 20].forEach((mi) => {
      L.circle([S.home.lat, S.home.lon], { radius: mi * 1609.34, color: '#cfe8f4', weight: 1, opacity: 0.35, dashArray: '4 6', fill: false, interactive: false }).addTo(rings);
      const eta = Math.round((mi / S.speed) * 60);
      L.marker([S.home.lat + mi / 69, S.home.lon], { interactive: false, icon: L.divIcon({ className: 'ringlbl', html: `${mi} mi · ${eta} min`, iconSize: [0, 0] }) }).addTo(rings);
    });
  }

  /* ---------- the dot + spot card ---------- */
  function updateSpot() {
    if (!dot) return;
    dot.setLatLng([S.spot.lat, S.spot.lon]);
    const d = Data.miles(S.home, S.spot), b = Data.bearing(S.home, S.spot), eta = Math.round((d / S.speed) * 60);
    S.dist = d;
    const saved = S.spots.find((s) => Data.miles(s, S.spot) < 0.15);
    const bi = G.Bathy && G.Bathy.info(S.spot.lat, S.spot.lon), bl = bi ? `<div class="m">📐 <b>${Math.round(bi.ft)} ft</b> · ${bi.kind}${bi.slope >= 0.5 ? ' · ' + bi.slope.toFixed(1) + '° slope' : ''}${bi.relief >= 4 ? ' · ' + Math.round(bi.relief) + ' ft relief' : ''}</div>` : '';
    $('#spotCard').innerHTML = `<div class="t">📍 ${saved ? '⭐ ' + esc(saved.name) : 'Your fishing spot'}</div>
      <div class="m">${d.toFixed(1)} mi ${Model.compass(b)} of ${esc(S.home.name || 'port')} · ~${eta} min run · ${S.spot.lat.toFixed(4)}°, ${S.spot.lon.toFixed(4)}°</div>${bl}
      <div class="acts"><button class="mini" data-a="save">${saved ? '★ Remove spot' : '☆ Save spot'}</button><button class="mini" data-a="home">⚓ Make home port</button><button class="mini" data-a="gps">📍 Dot → my GPS</button><button class="mini" data-a="fit">⌖ Re-center</button></div>`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function updateDot() {
    const el = dotEl && dotEl(); if (!el || !S.ev[S.idx]) return;
    const ev = S.ev[S.idx], v = Model.verdict(ev), col = ev.level >= 2 ? '#ff3b5c' : v.color;
    el.style.setProperty('--c', col);
    el.classList.toggle('nogo', ev.level >= 2);
    $('#dotNum').textContent = ev.level >= 2 ? '✕' : ev.score;
    $('#dotTag').textContent = v.title;
  }

  /* ---------- time-dependent fields ---------- */
  function updateField() {
    const D = S.D, i = S.idx; if (!D || !S.rec[i]) return;
    updateDot();
    // evaluate each grid cell
    const base = S.rec[i];
    S.cell = D.grid ? D.grid.map((p) => {
      const r = Object.assign({}, base, { depth: null, wind: p.wind[i], gust: p.gust[i], dir: p.dir[i], wave: p.wave[i] });
      const ev = Model.evaluate(r, { boat: S.boat, method: S.method, distMi: Data.miles(S.home, p) });
      return { score: ev.score, level: ev.level, wind: p.wind[i], dir: p.dir[i], wave: p.wave[i] };
    }) : null;
    if (S.layers.heat && S.cell) paintHeat();
    if (S.layers.wind) windEls.forEach((m, k) => {
      const c = S.cell && S.cell[k], el = m.getElement(); if (!c || !el) return;
      const arr = el.querySelector('svg'), lab = el.querySelector('span');
      arr.style.transform = `rotate(${(c.dir + 180) % 360}deg) scale(${0.7 + Math.min(c.wind, 30) / 40})`;
      arr.querySelector('path').setAttribute('fill', windColor(c.wind));
      lab.textContent = Math.round(c.wind);
    });
  }

  const HW = 160, HH = 110, hc = document.createElement('canvas');
  hc.width = HW; hc.height = HH;
  function paintHeat() {
    const ctx = hc.getContext('2d'), img = ctx.createImageData(HW, HH), cells = S.cell, rows = Data.GRID_ROWS, cols = Data.GRID_LONS.length;
    const west = HB.getWest(), east = HB.getEast(), north = HB.getNorth(), south = HB.getSouth();
    const at = (u, v) => cells[u * rows + v], tgt = G.Bathy && G.Bathy.B.ready ? G.Bathy.target(S.D.waterT[S.idx], S.D.repAgg) : null;
    for (let y = 0; y < HH; y++) {
      const lat = north - ((y + 0.5) / HH) * (north - south);
      for (let x = 0; x < HW; x++) {
        const lon = west + ((x + 0.5) / HW) * (east - west), dLat = lat - Data.shoreLat(lon);
        const o = (y * HW + x) * 4;
        if (dLat < 0.004) { img.data[o + 3] = 0; continue; }
        const uf = (lon - Data.GRID_LONS[0]) / 0.1, vf = (dLat - Data.ROW_OFF) / Data.ROW_STEP;
        const u = Math.max(0, Math.min(cols - 1, uf)), v = Math.max(0, Math.min(rows - 1, vf));
        const u0 = Math.floor(u), v0 = Math.floor(v), u1 = Math.min(cols - 1, u0 + 1), v1 = Math.min(rows - 1, v0 + 1), fu = u - u0, fv = v - v0;
        const s = (at(u0, v0).score * (1 - fu) + at(u1, v0).score * fu) * (1 - fv) + (at(u0, v1).score * (1 - fu) + at(u1, v1).score * fu) * fv;
        let sAdj = s; const Bq = G.Bathy;
        if (Bq && Bq.B.ready && tgt) { const q = Bq.quick(lat, lon); if (q) sAdj = s + (Model.depthScore({ ft: q.ft, lo: tgt[0], hi: tgt[1], structure: q.structure, kind: '' }).s - 0.6) * 15; }
        const [r, g, b] = ramp(sAdj);
        let a = Math.min(1, (dLat - 0.004) / 0.03) * 0.62;
        const edgeU = Math.max(0, Math.abs(uf - (cols - 1) / 2) - (cols - 1) / 2) / 0.9, edgeV = Math.max(0, vf - (rows - 1)) / 1.2;
        a *= Math.max(0, 1 - Math.max(edgeU, edgeV));
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    heat.setUrl(hc.toDataURL());
  }

  /* ---------- catches ---------- */
  function updateCatches() {
    catchLayer.clearLayers();
    S.logs.forEach((c) => {
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="catchpin">🐟</div>' }) })
        .bindPopup(`<b>${c.n} walleye</b>${c.big ? ` · biggest ${c.big}"` : ''}<br>${new Date(c.at).toLocaleString('en-US', { timeZone: Astro.TZ, dateStyle: 'medium', timeStyle: 'short' })}<br>Score ${c.score} · wind ${Math.round(c.wind)} mph · waves ${c.wave.toFixed(1)} ft${c.method ? '<br>' + esc(c.method) : ''}`).addTo(catchLayer);
    });
    S.spots.forEach((s) => {
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="catchpin">⭐</div>' }) })
        .bindTooltip(esc(s.name), { direction: 'top' }).on('click', () => G.App.setSpot({ lat: s.lat, lng: s.lon }, true)).addTo(catchLayer);
    });
  }

  $('#spotCard').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    G.App.spotAction(a.dataset.a);
  });

  let meMarker;
  function locate(cb) {
    if (!navigator.geolocation) return alert('Geolocation not available');
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!meMarker) meMarker = L.marker(ll, { interactive: false, icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="mebeacon"></div>' }) }).addTo(map);
      else meMarker.setLatLng(ll);
      S.me = ll; map.panTo(ll); if (cb) cb(ll);
    }, () => alert('Could not get your location — check browser permission.'), { enableHighAccuracy: true, timeout: 10000 });
  }

  G.MapView = {
    locate,
    init, updateBathy, updateStructure, updateSpot, updateHome, updateField, updateCatches, ramp, rampCss, loadRadar,
    flyTo: (lat, lon) => map.panTo([lat, lon]),
    fit: () => map.fitBounds([[41.8, -81.25], [42.2, -80.65]]),
    invalidate: () => map && map.invalidateSize(),
  };
})(window);
