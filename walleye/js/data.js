/* Data layer: Open-Meteo (weather + marine), NOAA CO-OPS (live gauge), NWS (alerts), RainViewer (radar).
   If the network is unreachable we synthesize API-shaped demo data so the app stays fully explorable. */
(function (G) {
  const { Astro, Model } = G;
  const HOME = { lat: 41.8665, lon: -80.9545, name: 'Geneva State Park Marina' };
  const FISH_CENTER = { lat: 41.98, lon: -80.95 };
  const shoreLat = (lon) => 41.868 + 0.28 * (lon + 80.95); // coastline approximation along Ohio's NE shore

  /* --- sample grid that follows the coast, from 2 mi offshore to ~18 mi --- */
  const GRID_LONS = [-81.2, -81.1, -81.0, -80.9, -80.8, -80.7];
  const GRID_ROWS = 5, ROW_OFF = 0.04, ROW_STEP = 0.055;
  const gridPoints = [];
  GRID_LONS.forEach((lon, u) => { for (let v = 0; v < GRID_ROWS; v++) gridPoints.push({ u, v, lon, lat: +(shoreLat(lon) + ROW_OFF + v * ROW_STEP).toFixed(4) }); });

  const FC_HOURLY = 'temperature_2m,precipitation_probability,precipitation,weather_code,pressure_msl,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
  const UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York&past_days=1&forecast_days=10';
  const fcUrl = (lats, lons, hourly, extra = '') => `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${hourly}&${UNITS}${extra}`;
  const maUrl = (lats, lons, hourly) => `https://marine-api.open-meteo.com/v1/marine?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=${hourly}&length_unit=imperial&timezone=America%2FNew_York&past_days=1&forecast_days=10`;
  const coops = (station, product) => `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=${product}&application=walleye_should_i_fish&station=${station}&date=latest&units=english&time_zone=lst_ldt&format=json`;

  async function getJSON(url, ms = 12000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const asArr = (j) => (Array.isArray(j) ? j : [j]);
  const num = (v, d = 0) => (v == null || Number.isNaN(+v) ? d : +v);

  /* ====================================================================
     DEMO GENERATOR — mimics the Open-Meteo response shapes
     ==================================================================== */
  const Demo = {
    times() {
      const today = Astro.etDay(new Date()), start = Astro.addDays(today, -1), out = [];
      for (let d = 0; d < 11; d++) for (let h = 0; h < 24; h++) out.push(`${Astro.addDays(start, d)}T${Astro.pad(h)}:00`);
      return out;
    },
    at(i, t, lat, lon) {
      const hr = +t.slice(11, 13), day = t.slice(0, 10), doy = Astro.dayOfYear(day);
      const phi = i / (24 * 3.1) + 0.62, S = Math.sin, C = Math.cos, TP = 2 * Math.PI;
      const pres = 1015 + 9 * S(TP * phi) + 2 * S(TP * phi * 2.3 + 1);
      const off = Math.max(0, lat - shoreLat(lon));
      let wind = 3.5 + 13 * (0.5 - 0.5 * S(TP * phi)) + 3 * S((TP * (hr - 8)) / 24) + 2.5 * S(lon * 40 + i / 9) + off * 6;
      wind = Math.max(0.5, wind + 3.5 * Math.max(0, S(TP * phi * 0.5 + 2.2)));
      const dir = (((200 + 150 * S(TP * phi * 0.9 + 0.6) + 12 * S(lon * 30)) % 360) + 360) % 360;
      const cloud = Math.min(100, Math.max(0, 50 + 45 * S(TP * phi + 2)));
      const pop = cloud > 78 ? 65 : cloud > 60 ? 30 : 5;
      const precip = pop >= 60 ? 0.03 + 0.02 * S(i) ** 2 : 0;
      const code = wind > 25 && pop >= 60 ? 95 : pop >= 60 ? 61 : cloud > 60 ? 3 : cloud > 25 ? 2 : 0;
      const air = 50 + 24 * C((TP * (doy - 203)) / 365) + 7 * S((TP * (hr - 9)) / 24);
      const wave = Model.estimateWave(wind * 0.9, dir) * (0.7 + 0.5 * Math.min(1, off * 5));
      return { temperature_2m: air, precipitation_probability: pop, precipitation: precip, weather_code: code, pressure_msl: pres, cloud_cover: cloud, visibility: cloud > 88 && hr < 9 ? 1800 : 24000, wind_speed_10m: wind, wind_direction_10m: dir, wind_gusts_10m: wind * 1.35 + 2, wave_height: wave, wave_direction: dir, wave_period: 2.5 + wave * 1.4 };
    },
    forecast(url, marine) {
      const p = new URL(url).searchParams, models = p.get('models') ? p.get('models').split(',') : null, lats = p.get('latitude').split(',').map(Number), lons = p.get('longitude').split(',').map(Number), vars = p.get('hourly').split(','), times = Demo.times();
      const res = lats.map((lat, k) => {
        const hourly = { time: times };
        vars.forEach((v) => (hourly[v] = []));
        if (models) { vars.length = 0; ['wind_speed_10m', 'wind_gusts_10m'].forEach((v) => models.forEach((m, mi) => { vars.push(v + '_' + m); hourly[v + '_' + m] = []; })); }
        times.forEach((t, i) => {
          const o = Demo.at(i, t, lat, lons[k]);
          vars.forEach((v) => {
            if (!models) return hourly[v].push(+o[v].toFixed(2));
            const m = models.findIndex((x) => v.endsWith('_' + x)), base = v.startsWith('wind_gusts') ? o.wind_gusts_10m : o.wind_speed_10m;
            hourly[v].push(+Math.max(0, base + Math.sin(i * 0.09 + m * 2.1) * (0.6 + (i / 24) * 0.9)).toFixed(2));
          });
        });
        return { latitude: lat, longitude: lons[k], hourly };
      });
      return res.length === 1 ? res[0] : res;
    },
  };

  Demo.reports = () => {
    const now = Date.now();
    return {
      generated: new Date(now).toISOString(), demo: true,
      sources: [{ id: 'sample', name: 'SAMPLE data (not a real report)', status: 'demo', count: 2 }],
      items: [
        { source: 'SAMPLE report', id: 'sample', title: 'Sample: central basin walleye', url: '', t: now - 20 * 3600000, sample: true, text: 'Walleye bite was good off Fairport. Trolling crawler harnesses with planer boards in 45-55 feet, steady action with a limit by noon.' },
        { source: 'SAMPLE report', id: 'sample', title: 'Sample: Geneva slower', url: '', t: now - 70 * 3600000, sample: true, text: 'Walleye were scattered and slow off Geneva after the cold front. Tough day, a few fish in 50 fow on stickbaits.' },
      ],
      buoys: [{ id: '45005', name: 'SAMPLE buoy', t: now - 40 * 60000, wind: 11, windDir: 250, gust: 15, wave: 1.4, pres: 1015, airT: 55, waterT: 61.5, sample: true }],
      nws: { issued: new Date(now - 3 * 3600000).toISOString(), text: 'SAMPLE TEXT — Geneva-on-the-Lake to Conneaut OH: SW winds 10 to 15 kt becoming W 10 kt. Waves 1 to 3 ft. (This is demo text, not a real forecast.)' },
    };
  };

  /* ====================================================================
     LOAD
     ==================================================================== */
  async function load() {
    const t0 = Date.now(), sources = {};
    const attempt = async (name, fn) => { try { const v = await fn(); sources[name] = 'live'; return v; } catch (e) { sources[name] = 'down'; return null; } };
    const gl = gridPoints.map((p) => p.lat), go = gridPoints.map((p) => p.lon);

    const [fc, ma, gfc, gma, wT, wW, wA, wP, alerts, radar, mdl, repJ, nwsP] = await Promise.all([
      attempt('weather', () => getJSON(fcUrl([FISH_CENTER.lat], [FISH_CENTER.lon], FC_HOURLY))),
      attempt('waves', () => getJSON(maUrl([FISH_CENTER.lat], [FISH_CENTER.lon], 'wave_height,wave_direction,wave_period'))),
      attempt('windfield', () => getJSON(fcUrl(gl, go, 'wind_speed_10m,wind_direction_10m,wind_gusts_10m'), 18000)),
      attempt('wavefield', () => getJSON(maUrl(gl, go, 'wave_height'), 18000)),
      attempt('gauge', async () => { try { return await getJSON(coops('9063063', 'water_temperature')); } catch (e) { return await getJSON(coops('9063053', 'water_temperature')); } }),
      attempt('gaugeWind', () => getJSON(coops('9063063', 'wind'))),
      attempt('gaugeAir', () => getJSON(coops('9063063', 'air_temperature'))),
      attempt('gaugePres', () => getJSON(coops('9063063', 'air_pressure'))),
      attempt('alerts', () => getJSON(`https://api.weather.gov/alerts/active?point=${FISH_CENTER.lat},${FISH_CENTER.lon}`)),
      attempt('radar', () => getJSON('https://api.rainviewer.com/public/weather-maps.json')),
      attempt('models', () => getJSON(fcUrl([FISH_CENTER.lat], [FISH_CENTER.lon], 'wind_speed_10m,wind_gusts_10m', '&models=gfs_seamless,ecmwf_ifs025,icon_seamless'))),
      attempt('reports', () => getJSON('data/reports.json?ts=' + Math.floor(Date.now() / 600000), 8000)),
      attempt('nws', async () => { const l = await getJSON('https://api.weather.gov/products/types/NSH/locations/CLE'); return getJSON('https://api.weather.gov/products/' + l['@graph'][0].id); }),
    ]);

    let demo = false;
    let fcR = fc, maR = ma, gfcR = gfc, gmaR = gma, mdlR = mdl, repR = repJ;
    if (!fc) {
      demo = true;
      fcR = Demo.forecast(fcUrl([FISH_CENTER.lat], [FISH_CENTER.lon], FC_HOURLY));
      maR = Demo.forecast(maUrl([FISH_CENTER.lat], [FISH_CENTER.lon], 'wave_height,wave_direction,wave_period'));
      gfcR = Demo.forecast(fcUrl(gl, go, 'wind_speed_10m,wind_direction_10m,wind_gusts_10m'));
      gmaR = Demo.forecast(maUrl(gl, go, 'wave_height'));
      mdlR = Demo.forecast(fcUrl([FISH_CENTER.lat], [FISH_CENTER.lon], 'wind_speed_10m,wind_gusts_10m', '&models=gfs_seamless,ecmwf_ifs025,icon_seamless'));
      repR = Demo.reports();
      Object.keys(sources).forEach((k) => { if (['weather', 'waves', 'windfield', 'wavefield'].includes(k)) sources[k] = 'demo'; });
      sources.models = 'demo'; sources.reports = 'demo'; sources.nws = 'demo';
    }

    const f = asArr(fcR)[0].hourly, times = f.time, n = times.length;
    const D = { demo, sources, times, n, ms: times.map((t) => Astro.etToDate(t).getTime()), h: {}, fetchedAt: new Date() };
    ['temperature_2m', 'precipitation_probability', 'precipitation', 'weather_code', 'pressure_msl', 'cloud_cover', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'].forEach((k) => (D.h[k] = f[k] ? f[k].map((v) => num(v, k === 'visibility' ? 24000 : 0)) : new Array(n).fill(0)));

    // waves: marine model where it has data, otherwise a wind-based estimate
    const mh = maR ? asArr(maR)[0].hourly : null, mIdx = new Map(mh ? mh.time.map((t, i) => [t, i]) : []);
    D.waveEst = new Array(n).fill(false);
    D.h.wave = times.map((t, i) => {
      const mi = mIdx.get(t), v = mi != null && mh.wave_height ? mh.wave_height[mi] : null;
      if (v == null) { D.waveEst[i] = true; return Model.estimateWave(D.h.wind_speed_10m[i], D.h.wind_direction_10m[i]); }
      return +v;
    });
    D.h.wavePer = times.map((t, i) => { const mi = mIdx.get(t); return mi != null && mh.wave_period && mh.wave_period[mi] != null ? +mh.wave_period[mi] : 3 + D.h.wave[i] * 1.3; });
    if (D.waveEst.filter(Boolean).length > n * 0.5 && sources.waves === 'live') sources.waves = 'estimated';

    // spatial field
    D.grid = null;
    if (gfcR) {
      const gf = asArr(gfcR), gm = gmaR ? asArr(gmaR) : null, ok = gf.length === gridPoints.length;
      if (ok) {
        D.grid = gridPoints.map((p, k) => {
          const h = gf[k].hourly, mt = gm && gm[k] ? new Map(gm[k].hourly.time.map((t, i) => [t, i])) : null;
          const wind = h.wind_speed_10m.map((v) => num(v)), dir = h.wind_direction_10m.map((v) => num(v)), gust = h.wind_gusts_10m.map((v) => num(v));
          const wave = times.map((t, i) => {
            const mi = mt ? mt.get(t) : null, v = mi != null ? gm[k].hourly.wave_height[mi] : null;
            return v == null ? Model.estimateWave(wind[i], dir[i]) : +v;
          });
          return { ...p, wind, dir, gust, wave };
        });
      }
    }

    // multi-model agreement on wind
    D.spread = new Array(n).fill(null); D.wMin = new Array(n).fill(null); D.wMax = new Array(n).fill(null);
    if (mdlR) {
      const mh2 = asArr(mdlR)[0].hourly, keys = Object.keys(mh2).filter((k) => k.startsWith('wind_speed_10m_')), idx2 = new Map(mh2.time.map((t, i) => [t, i]));
      if (keys.length >= 2) times.forEach((t, i) => { const j = idx2.get(t); if (j == null) return; const v = keys.map((k) => mh2[k][j]).filter((x) => x != null); if (v.length >= 2) { D.wMin[i] = Math.min(...v); D.wMax[i] = Math.max(...v); D.spread[i] = D.wMax[i] - D.wMin[i]; } });
      else sources.models = 'down';
    }
    // reports file (from the scheduled fetcher), buoys, nws text
    D.reports = repR && repR.items ? repR : { items: [], sources: [], buoys: [], nws: null, missing: true };
    D.reports.items.forEach((it) => { if (!it.analysis && it.text) it.analysis = G.Reports.analyze(it.text); if (it.analysis && !it.analysis.snippet) it.analysis.snippet = ''; if (it.sample) it.analysis.walleye = true; });
    D.nws = nwsP && nwsP.productText ? { issued: nwsP.issuanceTime, text: nwsP.productText } : D.reports.nws ? { issued: D.reports.nws.issued, text: D.reports.nws.text, fromFile: true } : null;
    if (D.nws && !D.nws.fromFile && !demo) { const blocks = D.nws.text.split(/\n\s*\$\$\s*\n?/).map((b) => b.trim()).filter(Boolean); D.nws.text = (blocks.find((b) => /geneva|ashtabula|conneaut|fairport|ripley|painesville/i.test(b)) || blocks[0] || '').replace(/\n(?!\n)/g, ' ').replace(/\s{2,}/g, ' ').slice(0, 1400); }
    D.buoys = (D.reports.buoys || []).filter((b) => Date.now() - b.t < 4 * 3600000);

    // live gauge (NOAA CO-OPS)
    const lastV = (j, key = 'v') => { const d = j && j.data && j.data[j.data.length - 1]; return d ? d : null; };
    const obs = { station: 'NOAA Ashtabula gauge' };
    const wt = lastV(wT); if (wt) { obs.waterT = +wt.v; obs.waterTime = wt.t; obs.station = (wT.metadata && wT.metadata.name) || obs.station; }
    const ww = lastV(wW); if (ww) { obs.wind = +ww.s * 1.15078; obs.windDir = +ww.d; obs.gust = ww.g != null ? +ww.g * 1.15078 : null; }
    const wa = lastV(wA); if (wa) obs.airT = +wa.v;
    const wp = lastV(wP); if (wp) obs.pres = +wp.v;
    if (demo) { const i = Astro.etDay(new Date()); Object.assign(obs, { waterT: Model.climoWaterT(i) + 0.4, wind: null, demo: true, station: 'demo' }); }
    D.obs = obs;

    // alerts
    D.alerts = [];
    if (alerts && alerts.features) {
      D.alerts = alerts.features.map((f) => f.properties).filter((p) => p && p.event).map((p) => ({
        event: p.event, headline: p.headline || p.event, severity: p.severity,
        from: new Date(p.onset || p.effective || Date.now()).getTime(), to: new Date(p.ends || p.expires || Date.now() + 864e5).getTime(),
      }));
    }
    if (demo) D.alerts = [];

    // radar
    D.radar = radar && radar.radar ? { host: radar.host || 'https://tilecache.rainviewer.com', frames: [...(radar.radar.past || []), ...(radar.radar.nowcast || [])] } : null;

    // astro + derived
    const nowMs = Date.now();
    D.nowIdx = 0;
    for (let i = 0; i < n; i++) if (D.ms[i] <= nowMs) D.nowIdx = i;
    D.sunAlt = D.ms.map((m) => Astro.sunAlt(new Date(m + 1800000)));
    D.moon = D.ms.map((m) => Astro.moonPhase(new Date(m + 1800000)).phase);
    const moonEv = Astro.moonEvents(D.ms[0] - 3600000, D.ms[n - 1] + 7200000);
    D.moonEvents = moonEv;
    D.sol = D.ms.map((m) => Astro.solunarAt(m + 1800000, moonEv));
    D.pTrend3 = D.h.pressure_msl.map((p, i) => (i >= 3 ? p - D.h.pressure_msl[i - 3] : 0));
    const today = Astro.etDay(new Date());
    const bw = D.buoys.find((b) => b.waterT != null), baseW = obs.waterT != null ? obs.waterT : bw ? bw.waterT : Model.climoWaterT(today);
    D.waterBase = baseW; D.waterLive = (obs.waterT != null || !!bw) && !demo; if (obs.waterT == null && bw) { obs.waterT = bw.waterT; obs.station = bw.name + ' (buoy)'; }
    D.waterT = times.map((t) => Math.max(33, baseW + (Model.climoWaterT(t.slice(0, 10)) - Model.climoWaterT(today))));
    D.loadMs = Date.now() - t0;
    return D;
  }

  /* ---- spatial interpolation (inverse-distance on the sample grid) ---- */
  function interp(D, i, lat, lon) {
    if (!D.grid) return null;
    let sw = 0, w_ = 0, g_ = 0, wv_ = 0, sx = 0, sy = 0;
    const arr = D.grid.map((p) => { const dx = (p.lon - lon) * 0.74, dy = p.lat - lat; return { p, d2: dx * dx + dy * dy + 1e-5 }; }).sort((a, b) => a.d2 - b.d2).slice(0, 4);
    for (const { p, d2 } of arr) {
      const w = 1 / d2; sw += w; w_ += w * p.wind[i]; g_ += w * p.gust[i]; wv_ += w * p.wave[i];
      sx += w * Math.sin((p.dir[i] * Math.PI) / 180); sy += w * Math.cos((p.dir[i] * Math.PI) / 180);
    }
    return { wind: w_ / sw, gust: g_ / sw, wave: wv_ / sw, dir: ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360 };
  }

  /* report signal for hour i: full strength for now/past, fading with a ~33h half-life into the future */
  function repFor(D, i) {
    const a = D.repAgg; if (!a || !a.n) return null;
    const hrs = Math.max(0, (D.ms[i] - Date.now()) / 3600000), decay = Math.exp(-hrs / 48), lab = G.Reports.label(a.signal)[1].toLowerCase();
    const age = Math.round((Date.now() - a.newest) / 3600000), ageT = age < 36 ? age + 'h' : Math.round(age / 24) + 'd';
    return { signal: a.signal * decay, n: a.n, note: `Anglers report a ${lab} bite (${a.n} report${a.n > 1 ? 's' : ''}, newest ${ageT} ago)${hrs > 24 ? ' — stale by then' : ''}` };
  }

  /* ---- build the model's hour record for index i at a spot ---- */
  function hourRecord(D, i, spot) {
    const H = D.h, sp = spot ? interp(D, i, spot.lat, spot.lon) : null;
    const al = D.alerts.filter((a) => D.ms[i] + 1800000 >= a.from && D.ms[i] + 1800000 <= a.to);
    return {
      t: D.times[i], i,
      temp: H.temperature_2m[i], pop: H.precipitation_probability[i], precip: H.precipitation[i], code: H.weather_code[i], pres: H.pressure_msl[i], cloud: H.cloud_cover[i], vis: H.visibility[i],
      wind: sp ? sp.wind : H.wind_speed_10m[i], dir: sp ? sp.dir : H.wind_direction_10m[i], gust: sp ? sp.gust : H.wind_gusts_10m[i], wave: sp ? sp.wave : H.wave[i], wavePer: H.wavePer[i],
      rep: repFor(D, i), spread: D.spread[i], waveEst: D.waveEst[i], pTrend3: D.pTrend3[i], waterT: D.waterT[i], sunAlt: D.sunAlt[i], moonPhase: D.moon[i], sol: D.sol[i], alerts: al,
    };
  }

  /* ---- distance helpers ---- */
  function miles(a, b) {
    const R = 3958.8, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function bearing(a, b) {
    const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  /* ---- seasonal "potential" for any calendar day (typical weather, best light) ---- */
  const climoCache = {};
  function climoDay(dayStr) {
    const method = (G.S && G.S.method) || 'troll', ck = method + dayStr;
    if (climoCache[ck]) return climoCache[ck];
    const doy = Astro.dayOfYear(dayStr), ev = Astro.sunEvents(dayStr), waterT = Model.climoWaterT(dayStr);
    const noon = Astro.etToDate(dayStr + 'T12:00'), mp = Astro.moonPhase(noon).phase;
    const air = 50 + 24 * Math.cos((2 * Math.PI * (doy - 203)) / 365);
    const slots = [ev.sunrise ? new Date(ev.sunrise.getTime() + 1800000) : null, ev.sunset ? new Date(ev.sunset.getTime() - 2400000) : null, noon].filter(Boolean);
    let best = 0, bestEv = null, slot = 'dawn', slotTime = '';
    const names = ['dawn', 'dusk', 'midday'];
    slots.forEach((dt, k) => {
      const h = { temp: air, pop: 15, precip: 0, code: 2, pres: 1016, cloud: 55, vis: 24000, wind: 10, dir: 250, gust: 15, wave: 1.5, pTrend3: -0.8, waterT, sunAlt: Astro.sunAlt(dt), moonPhase: mp, sol: { type: null, v: 0 }, alerts: [] };
      const e = Model.evaluate(h, { boat: 'mid', method });
      if (e.bite > best) { best = e.bite; bestEv = e; slot = names[k]; slotTime = dt.toLocaleTimeString('en-US', { timeZone: Astro.TZ, hour: 'numeric', minute: '2-digit' }); }
    });
    return (climoCache[ck] = { score: best, waterT, moon: mp, ev, slot, slotTime, factors: bestEv && bestEv.factors });
  }

  G.Data = { HOME, FISH_CENTER, shoreLat, gridPoints, GRID_LONS, GRID_ROWS, ROW_OFF, ROW_STEP, load, interp, hourRecord, miles, bearing, climoDay, Demo };
})(window);
