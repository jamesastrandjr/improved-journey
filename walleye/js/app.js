/* App controller: state, rendering, interaction. */
(function (G) {
  const { Astro, Model, Data, MapView } = G;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TZ = Astro.TZ, REFRESH_MS = 10 * 60 * 1000;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const DEF = { boat: 'mid', method: 'troll', hours: 'twilight', tripLen: 6, checks: { date: '', done: {} }, speed: 20, thr: 70, notify: false, base: 'dark', layers: { heat: true, wind: true, radar: false, rings: true, catches: true, sea: false }, home: Data.HOME, spot: { lat: 41.95, lon: -80.95 }, logs: [], spots: [], notified: [] };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('wsif.v1') || '{}'); } catch (e) {}
  const S = (G.S = Object.assign({ D: null, idx: 0, follow: true, rec: [], ev: [], rank: [], windows: [], days: [], playing: false, month: new Date().getMonth(), calDay: null, nextRefresh: Date.now() + REFRESH_MS }, JSON.parse(JSON.stringify(DEF)), saved));
  S.layers = Object.assign({}, DEF.layers, S.layers);

  function save() {
    try { localStorage.setItem('wsif.v1', JSON.stringify({ boat: S.boat, method: S.method, hours: S.hours, setup: true, tripLen: S.tripLen, checks: S.checks, speed: S.speed, thr: S.thr, notify: S.notify, base: S.base, layers: S.layers, home: S.home, spot: S.spot, logs: S.logs, spots: S.spots, notified: S.notified.slice(-30) })); } catch (e) {}
  }

  /* ---------- formatting ---------- */
  const fT = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const fH = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric' });
  const fD = (ms, o = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(ms).toLocaleDateString('en-US', Object.assign({ timeZone: TZ }, o));
  const dayMs = (day) => Astro.etToDate(day + 'T12:00').getTime();
  const fDay = (day, o) => fD(dayMs(day), o);
  const rel = (ms) => { const m = Math.round((ms - Date.now()) / 60000), a = Math.abs(m), h = Math.floor(a / 60); const t = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${a % 60}m` : `${a}m`; return m >= 0 ? 'in ' + t : t + ' ago'; };
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); };
  const inHg = (hpa) => (hpa * 0.02953).toFixed(2);
  const wx = (code, sunAlt, cloud) => {
    if (code >= 95) return '⛈️'; if (code >= 85) return '🌨️'; if (code >= 71) return '❄️'; if (code >= 80) return '🌦️'; if (code >= 61) return '🌧️'; if (code >= 51) return '🌦️'; if (code >= 45) return '🌫️';
    if (code === 3 || cloud > 80) return '☁️'; if (code === 2 || cloud > 40) return sunAlt < 0 ? '☁️' : '⛅'; return sunAlt < 0 ? '🌙' : '☀️';
  };
  const colorFor = (ev) => (ev.level >= 2 ? '#ff3b5c' : Model.verdict(ev).color);
  const rampC = (s) => MapView.rampCss(s);

  /* ====================================================================
     COMPUTE
     ==================================================================== */
  function recompute() {
    const D = S.D; if (!D) return;
    S.dist = Data.miles(S.home, S.spot);
    S.rec = []; S.ev = []; S.rank = [];
    for (let i = 0; i < D.n; i++) {
      const r = Data.hourRecord(D, i, S.spot), ev = Model.evaluate(r, { boat: S.boat, method: S.method, distMi: S.dist });
      S.rec.push(r); S.ev.push(ev); S.rank.push(ev.score * (D.sunAlt[i] < -6 ? Model.HOURS[S.hours].night : 1));
    }
    // days
    const today = Astro.etDay(new Date()), byDay = {};
    D.times.forEach((t, i) => { (byDay[t.slice(0, 10)] = byDay[t.slice(0, 10)] || []).push(i); });
    S.days = Object.keys(byDay).filter((d) => d >= today).slice(0, 10).map((day) => {
      const idxs = byDay[day].filter((i) => i >= D.nowIdx);
      let best = idxs[0];
      idxs.forEach((i) => { if (S.rank[i] > S.rank[best]) best = i; });
      let s = best, e = best; const lim = S.rank[best] - 9;
      while (s - 1 >= idxs[0] && S.rank[s - 1] >= lim) s--;
      while (e + 1 <= idxs[idxs.length - 1] && S.rank[e + 1] >= lim) e++;
      const mid = byDay[day][12] != null ? byDay[day][12] : best;
      return { day, idxs, all: byDay[day], best, s, e, score: S.ev[best].score, level: S.ev[best].level, emoji: wx(D.h.weather_code[mid], 30, D.h.cloud_cover[mid]), wind: S.rec[best].wind, wave: S.rec[best].wave };
    });
    // prime windows
    const runs = [];
    const mk = (thr) => { const out = []; let cur = null; for (let i = D.nowIdx; i < D.n; i++) { if (S.rank[i] >= thr && S.ev[i].level < 2) { if (!cur) cur = { s: i, e: i, peak: i }; cur.e = i; if (S.rank[i] > S.rank[cur.peak]) cur.peak = i; } else if (cur) { out.push(cur); cur = null; } } if (cur) out.push(cur); return out; };
    let w = mk(S.thr); S.windowsFallback = false;
    if (!w.length) { const mx = Math.max(...S.rank.slice(D.nowIdx)); w = mk(Math.max(40, mx - 6)); S.windowsFallback = true; }
    S.windows = w.sort((a, b) => S.rank[b.peak] - S.rank[a.peak]).slice(0, 5).map((r) => ({ ...r, avg: Math.round(S.rank.slice(r.s, r.e + 1).reduce((a, b) => a + b, 0) / (r.e - r.s + 1)) }));
  }

  /* ====================================================================
     RENDER: verdict
     ==================================================================== */
  let numTween;
  function fishSvg(mood) {
    const eye = mood === 'sleepy' ? '<path d="M24 27 q4 4 8 0" stroke="#04141d" stroke-width="2.4" fill="none" stroke-linecap="round"/>' : mood === 'picky' ? '<circle cx="28" cy="27" r="4.4" fill="#fff"/><circle cx="28.8" cy="28" r="2.2" fill="#04141d"/><path d="M22 22.6 L34 25" stroke="#04141d" stroke-width="2.2" stroke-linecap="round"/>' : '<circle cx="28" cy="27" r="4.8" fill="#fff"/><circle cx="29" cy="27" r="2.6" fill="#04141d"/><circle cx="29.8" cy="26" r=".9" fill="#fff"/>';
    const mouth = mood === 'hungry' ? '<path d="M12 31 L22 34 L13 38 Z" fill="#04141d" opacity=".75"/>' : mood === 'picky' ? '<path d="M12 33 L21 34" stroke="#04141d" stroke-width="2" stroke-linecap="round"/>' : '<path d="M12 34 Q16 37 21 34" stroke="#04141d" stroke-width="2" fill="none" stroke-linecap="round"/>';
    const z = mood === 'sleepy' ? '<text x="34" y="16" font-size="10" fill="#cfe8f4" font-family="sans-serif" font-weight="700">z<animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite"/></text><text x="44" y="8" font-size="7" fill="#cfe8f4" font-family="sans-serif" font-weight="700">z<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin=".8s" repeatCount="indefinite"/></text>' : '';
    return `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${mood === 'hungry' ? 3 : 1.5};0 0" dur="${mood === 'hungry' ? 1.2 : 2.6}s" repeatCount="indefinite"/>
      <g><animateTransform attributeName="transform" type="rotate" values="${mood === 'hungry' ? '-5 96 30;5 96 30;-5 96 30' : '-2 96 30;2 96 30;-2 96 30'}" dur="${mood === 'hungry' ? 0.7 : 2}s" repeatCount="indefinite"/>
      <path d="M92 28 L116 8 L108 30 L116 52 L92 33 Z" fill="var(--vc)" opacity=".75"/></g>
      <path d="M10 31 C26 8 66 6 94 27 C66 54 26 54 10 31 Z" fill="var(--vc)"/>
      <path d="M26 20 C46 14 68 18 86 28" stroke="#fff" stroke-opacity=".28" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M50 18 L56 9 L66 19 Z" fill="var(--vc)" opacity=".8"/>
      ${[44, 54, 64, 74].map((x) => `<path d="M${x} 28 q4 3 0 8" stroke="#04141d" stroke-opacity=".18" stroke-width="2.4" fill="none"/>`).join('')}
      ${eye}${mouth}${z}</g>`;
  }

  function renderVerdict() {
    const D = S.D, i = S.idx, ev = S.ev[i], rec = S.rec[i]; if (!ev) return;
    const v = Model.verdict(ev), col = colorFor(ev);
    document.documentElement.style.setProperty('--vc', col);
    $('#vTitle').textContent = v.title;
    $('#vSub').textContent = ev.level >= 2 ? ev.reasons.filter((r) => r.lv === 2)[0].msg : v.sub;
    const ms = D.ms[i], now = Date.now();
    $('#vWhen').innerHTML = `<b>${fD(ms, { weekday: 'long', month: 'short', day: 'numeric' })} · ${fT(ms)}</b> · ${ms <= now && now < ms + 3600000 ? '<span style="color:var(--vc)">● right now</span>' : rel(ms)}`;
    $('#fish').innerHTML = fishSvg(v.mood);
    const arc = $('#ringArc'); arc.style.strokeDashoffset = 351.9 * (1 - ev.score / 100);
    const from = +$('#vNum').textContent || 0, to = ev.score, t0 = performance.now();
    cancelAnimationFrame(numTween);
    const tick = (t) => { const k = Math.min(1, (t - t0) / 500); $('#vNum').textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) numTween = requestAnimationFrame(tick); };
    numTween = requestAnimationFrame(tick);

    // chips
    const good = ev.factors.filter((f) => f.s >= 0.85).sort((a, b) => b.s * b.w - a.s * a.w).slice(0, 2), bad = ev.factors.filter((f) => f.s <= 0.55).sort((a, b) => (1 - b.s) * b.w - (1 - a.s) * a.w).slice(0, 2);
    $('#vWhy').innerHTML = [...ev.reasons.sort((a, b) => b.lv - a.lv).slice(0, 2).map((r) => `<span class="tag2 ${r.lv >= 2 ? 'b' : 'w'}">${r.lv >= 2 ? '⛔' : '⚠️'} ${esc(r.msg)}</span>`), ...good.map((f) => `<span class="tag2 g">${f.icon} ${esc(f.note)}</span>`), ...bad.map((f) => `<span class="tag2 w">${f.icon} ${esc(f.note)}</span>`)].join('');

    $('#vTip').innerHTML = `<b>${Model.METHODS[S.method].label.split(' (')[0]} · ${Model.BOATS[S.boat].label.split(' ·')[0]} boat</b> — ${esc(Model.tip(rec, S.method))}`;
    // next window
    const nx = $('#nextWin'), w = S.windows.slice().sort((a, b) => a.s - b.s).find((r) => r.e >= D.nowIdx);
    if (w) {
      const inside = D.nowIdx >= w.s && D.nowIdx <= w.e, sMs = D.ms[w.s], eMs = D.ms[w.e] + 3600000;
      nx.style.display = 'flex';
      nx.innerHTML = `<div class="big">${inside ? 'IN IT' : rel(sMs).replace('in ', '')}</div><div><b>${inside ? 'Prime window open now' : S.windowsFallback ? 'Best upcoming window' : 'Next prime window'}</b><small>${fD(sMs)} · ${fT(sMs)} – ${fT(eMs)} · peak ${S.ev[w.peak].score}</small></div><span style="margin-left:auto;color:var(--tx3)">→</span>`;
      nx.onclick = () => selectIdx(w.peak, true);
    } else nx.style.display = 'none';
  }

  /* ====================================================================
     RENDER: alerts, tiles, factors
     ==================================================================== */
  function renderAlerts() {
    const D = S.D, out = [];
    if (D.demo) out.push(`<div class="alert note-demo"><span>🧪</span><div><b>Demo data</b>Couldn't reach the live weather services from here, so you're seeing a realistic simulated forecast. Everything is fully interactive — open this on a connection that can reach Open-Meteo / NOAA for the real thing.</div></div>`);
    const act = D.alerts.filter((a) => a.to > Date.now());
    act.forEach((a) => { const lv = Model.alertLevel(a.event); out.push(`<div class="alert ${lv >= 2 ? 'bad' : ''}"><span>${lv >= 2 ? '🚨' : '⚠️'}</span><div><b>${esc(a.event)}</b>${esc(a.headline)}</div></div>`); });
    $('#alerts').innerHTML = out.join('');
    $('#alerts').style.display = out.length ? 'flex' : 'none';
    $('#alerts').style.flexDirection = 'column'; $('#alerts').style.gap = '8px';
  }

  function dial(dir, speed) {
    const rot = (dir + 180) % 360;
    return `<svg class="dial" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/><text x="24" y="9" text-anchor="middle" font-size="7" fill="#8fa9b8" font-family="sans-serif">N</text><g style="transform:rotate(${rot}deg);transform-origin:24px 24px;transition:transform .5s"><path d="M24 11 L30 33 L24 28.5 L18 33 Z" fill="${speed < 8 ? '#7fd8ff' : speed < 15 ? '#5ff0b0' : speed < 22 ? '#ffd23f' : '#ff5c7a'}"/></g></svg>`;
  }
  function renderTiles() {
    const D = S.D, i = S.idx, r = S.rec[i]; if (!r) return;
    const day = D.times[i].slice(0, 10), se = Astro.sunEvents(day), ms = D.ms[i];
    const live = D.waterLive && Math.abs(i - D.nowIdx) <= 1;
    const tr = r.pTrend3, arrow = tr < -0.6 ? '↘' : tr > 0.6 ? '↗' : '→';
    const mi = Astro.phaseIndex(r.moonPhase), sol = D.moonEvents.filter((e) => e.type === 'major' && e.t >= D.ms[i] - 3 * 3600000 && e.t > ms - 3600000).slice(0, 1)[0];
    const tiles = [
      ['Wind', `${dial(r.dir, r.wind)}<div class="v">${Math.round(r.wind)} <small>mph ${Model.compass(r.dir)}</small></div><div class="s">gusts ${Math.round(r.gust)}</div>`],
      ['Waves', `<div class="v" style="margin-top:12px">${r.wave.toFixed(1)} <small>ft</small></div><div class="s">${r.waveEst ? '~' : ''}${Math.round(r.wavePer || 3)} s period<br>${r.wave < 1 ? 'flat-ish' : r.wave < 2.5 ? 'light chop' : r.wave < 4 ? 'choppy' : 'rough'}</div>${r.waveEst ? '<span class="badge est">EST</span>' : ''}`],
      ['Air', `<div class="v" style="margin-top:6px">${Math.round(r.temp)}°<small>F</small></div><div class="s" style="font-size:22px;margin-top:2px">${wx(r.code, r.sunAlt, r.cloud)}</div>`],
      ['Water', `<div class="v" style="margin-top:6px">${r.waterT.toFixed(0)}°<small>F</small></div><div class="s">${live ? D.obs.station : 'seasonal model'}</div><span class="badge ${live ? '' : 'est'}">${live ? 'LIVE' : 'MODEL'}</span>`],
      ['Pressure', `<div class="v" style="margin-top:6px">${inHg(r.pres)} <small>inHg</small></div><div class="s">${arrow} ${tr > 0 ? '+' : ''}${tr.toFixed(1)} hPa / 3h</div>`],
      ['Sky', `<div class="v" style="margin-top:6px">${Math.round(r.cloud)}<small>% cloud</small></div><div class="s">${Math.round(r.pop)}% rain · ${r.vis >= 16000 ? 'clear vis' : (r.vis / 1609).toFixed(1) + ' mi vis'}</div>`],
      ['Sun', `<div class="v" style="margin-top:6px;font-size:14px">↑ ${se.sunrise ? fT(se.sunrise) : '—'}<br>↓ ${se.sunset ? fT(se.sunset) : '—'}</div><div class="s">${r.sunAlt > 0 ? 'sun up' : r.sunAlt > -6 ? 'twilight' : 'dark'}</div>`],
      ['Moon', `<div class="v" style="margin-top:4px;font-size:26px">${Astro.PHASE_ICONS[mi]}</div><div class="s">${Astro.PHASE_NAMES[mi]}${sol ? '<br>major ' + fT(sol.t) : ''}</div>`],
    ];
    const o = D.obs;
    $('#tiles').innerHTML = tiles.map(([k, h]) => `<div class="tile"><div class="k">${k}</div>${h}</div>`).join('') +
      (o && !o.demo && (o.wind != null || o.waterT != null) ? `<div class="foot" style="grid-column:1/-1;padding:2px">📡 Gauge right now${o.wind != null ? ` · wind ${Math.round(o.wind)} mph ${Model.compass(o.windDir)}` : ''}${o.airT != null ? ` · air ${Math.round(o.airT)}°` : ''}${o.waterT != null ? ` · water ${o.waterT.toFixed(1)}°` : ''}${o.pres != null ? ` · ${inHg(o.pres)} inHg` : ''}</div>` : '');
    $('#condWhen').textContent = `at ${S.dist.toFixed(1)} mi out`;
  }

  let openFac = null;
  function renderFactors() {
    const ev = S.ev[S.idx]; if (!ev) return;
    $('#factors').innerHTML = ev.factors.map((f) => `<div class="fac ${openFac === f.id ? 'open' : ''}" data-f="${f.id}"><span>${f.icon}</span><div class="n"><span>${f.label}</span><i>${Math.round(f.w * 100)}% weight</i></div><div class="sc">${Math.round(f.s * 100)}</div><div class="bar"><div style="width:${f.s * 100}%;background:${rampC(f.s * 100)}"></div></div><div class="ex">${esc(f.note)}</div></div>`).join('') +
      (ev.level > 0 ? `<div class="foot" style="margin-top:6px">Safety cap applied: ${ev.reasons.map((r) => esc(r.msg)).join(' · ')}. Raw bite ${ev.bite} → ${ev.score}.</div>` : '');
  }
  $('#factors').addEventListener('click', (e) => { const f = e.target.closest('[data-f]'); if (!f) return; openFac = openFac === f.dataset.f ? null : f.dataset.f; renderFactors(); });

  /* ====================================================================
     RENDER: day planner (SVG)
     ==================================================================== */
  function curDay() { return S.D.times[S.idx].slice(0, 10); }
  function renderDayTabs() {
    $('#dayTabs').innerHTML = S.days.map((d) => `<button class="dtab ${d.day === curDay() ? 'on' : ''}" data-d="${d.day}"><small>${fDay(d.day, { weekday: 'short' })}</small><b>${fDay(d.day, { day: 'numeric' })}</b><i style="background:${d.level >= 2 ? '#ff3b5c' : rampC(d.score)}"></i></button>`).join('');
  }
  $('#dayTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; const d = S.days.find((x) => x.day === b.dataset.d); if (d) selectIdx(d.best, true); });

  const SW = 720, X0 = 8, PW = SW - 16, HWID = PW / 24;
  function renderStrip() {
    const D = S.D, day = curDay(), all = D.times.map((t, i) => (t.slice(0, 10) === day ? i : -1)).filter((i) => i >= 0), i0 = all[0];
    const x = (hr) => X0 + hr * HWID;
    let g = '';
    // sky band
    const t0 = Astro.etToDate(day + 'T00:00').getTime();
    for (let q = 0; q < 96; q++) {
      const a = Astro.sunAlt(new Date(t0 + q * 900000 + 450000)), c = a > 8 ? '#4aa8dc' : a > 0 ? '#e8a455' : a > -6 ? '#7a4a8a' : a > -12 ? '#2a2655' : '#0b1430';
      g += `<rect x="${x(q / 4).toFixed(1)}" y="14" width="${(HWID / 4 + 0.5).toFixed(1)}" height="22" fill="${c}"/>`;
    }
    const se = Astro.sunEvents(day);
    if (se.sunrise) { const h = (se.sunrise - t0) / 3600000; g += `<text x="${x(h)}" y="31" font-size="18" text-anchor="middle">🌅</text><text x="${x(h)}" y="11" font-size="13" fill="#cfe8f4" text-anchor="middle">${fT(se.sunrise)}</text>`; }
    if (se.sunset) { const h = (se.sunset - t0) / 3600000; g += `<text x="${x(h)}" y="31" font-size="18" text-anchor="middle">🌇</text><text x="${x(h)}" y="11" font-size="13" fill="#cfe8f4" text-anchor="middle">${fT(se.sunset)}</text>`; }
    // solunar
    D.moonEvents.filter((e) => e.t > t0 - 3600000 && e.t < t0 + 25 * 3600000).forEach((e) => {
      const h = (e.t - t0) / 3600000, half = e.type === 'major' ? 1.25 : 0.75;
      g += `<rect x="${x(Math.max(0, h - half))}" width="${x(Math.min(24, h + half)) - x(Math.max(0, h - half))}" y="40" height="9" rx="3" fill="${e.type === 'major' ? '#ffd23f' : '#c9b46a'}" opacity="${e.type === 'major' ? 0.85 : 0.5}"/>`;
    });
    // score bars
    const BASE = 168, BH = 108;
    [25, 50, 75].forEach((v) => (g += `<line x1="${X0}" x2="${SW - 8}" y1="${BASE - (v / 100) * BH}" y2="${BASE - (v / 100) * BH}" stroke="rgba(255,255,255,.07)"/>`));
    g += `<line x1="${X0}" x2="${SW - 8}" y1="${BASE - (S.thr / 100) * BH}" y2="${BASE - (S.thr / 100) * BH}" stroke="var(--vc)" stroke-dasharray="3 4" opacity=".5"/><text x="${SW - 10}" y="${BASE - (S.thr / 100) * BH - 3}" font-size="13" fill="var(--vc)" text-anchor="end" opacity=".8">prime ${S.thr}</text>`;
    for (let hr = 0; hr < 24; hr++) {
      const i = i0 + hr; if (i >= D.n || D.times[i].slice(0, 10) !== day) continue;
      const ev = S.ev[i], h = Math.max(3, (ev.score / 100) * BH), past = i < D.nowIdx, sel = i === S.idx;
      g += `<rect x="${(x(hr) + 2).toFixed(1)}" y="${(BASE - h).toFixed(1)}" width="${(HWID - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${colorFor(ev)}" opacity="${past ? 0.28 : sel ? 1 : 0.78}" ${ev.level >= 2 ? 'stroke="#ff3b5c" stroke-dasharray="3 2"' : ''}/>`;
      if (ev.level >= 2) g += `<text x="${x(hr) + HWID / 2}" y="${BASE - h - 3}" font-size="14" text-anchor="middle" fill="#ff3b5c">✕</text>`;
      if (sel) g += `<text x="${x(hr) + HWID / 2}" y="${BASE - h - 5}" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">${ev.score}</text>`;
    }
    // wind / wave band
    const WB = 232, WH = 46, wmax = Math.max(20, ...all.map((i) => S.rec[i].gust)), hmax = Math.max(4, ...all.map((i) => S.rec[i].wave));
    g += `<text x="${X0}" y="184" font-size="12" fill="#8fa9b8">WIND mph · WAVES ft</text>`;
    g += all.map((i, hr) => `<rect x="${(x(hr) + 5).toFixed(1)}" y="${(WB - (S.rec[i].wave / hmax) * WH).toFixed(1)}" width="${(HWID - 10).toFixed(1)}" height="${((S.rec[i].wave / hmax) * WH).toFixed(1)}" fill="#4fd1ff" opacity=".28"/>`).join('');
    g += `<polyline fill="none" stroke="#ffd23f" stroke-width="1.5" stroke-dasharray="3 3" opacity=".8" points="${all.map((i, hr) => `${(x(hr) + HWID / 2).toFixed(1)},${(WB - (S.rec[i].gust / wmax) * WH).toFixed(1)}`).join(' ')}"/>`;
    g += `<polyline fill="none" stroke="#5ff0b0" stroke-width="2.2" stroke-linejoin="round" points="${all.map((i, hr) => `${(x(hr) + HWID / 2).toFixed(1)},${(WB - (S.rec[i].wind / wmax) * WH).toFixed(1)}`).join(' ')}"/>`;
    // hour labels
    for (let hr = 0; hr < 24; hr += 3) g += `<text x="${x(hr) + HWID / 2}" y="249" font-size="14" fill="#8fa9b8" text-anchor="middle">${hr === 0 ? '12a' : hr < 12 ? hr + 'a' : hr === 12 ? '12p' : hr - 12 + 'p'}</text>`;
    // now + cursor
    if (D.times[D.nowIdx].slice(0, 10) === day) { const h = (Date.now() - t0) / 3600000; g += `<line x1="${x(h)}" x2="${x(h)}" y1="52" y2="${WB}" stroke="#fff" stroke-opacity=".5" stroke-dasharray="2 3"/><text x="${x(h)}" y="${BASE + 11 + 0}" font-size="8" fill="#fff" opacity=".0">now</text>`; }
    if (S.idx >= i0 && S.idx < i0 + 24) { const hr = S.idx - i0; g += `<rect x="${x(hr)}" y="50" width="${HWID}" height="${WB - 50 + 2}" rx="6" fill="none" stroke="var(--vc)" stroke-width="2" style="filter:drop-shadow(0 0 5px var(--vc))"/>`; }
    if (S.idx >= i0 && S.idx < i0 + 24) { const hr = S.idx - i0, len = Math.min(S.tripLen, 24 - hr); g += `<rect x="${x(hr)}" y="50" width="${len * HWID}" height="${WB - 50 + 2}" rx="6" fill="var(--vc)" opacity=".09"/><rect x="${x(hr)}" y="${BASE + 4}" width="${len * HWID}" height="4" rx="2" fill="var(--vc)" opacity=".8"/>`; }
    $('#strip').innerHTML = g;
    $('#stripLegend').innerHTML = `<span><i style="background:#ffd23f"></i>major solunar</span><span><i style="background:#c9b46a"></i>minor</span><span><i style="background:#5ff0b0"></i>wind</span><span><i style="background:#4fd1ff;opacity:.5"></i>waves</span><span style="margin-left:auto">⛔ ✕ = unsafe for your boat</span>`;
  }
  (function stripDrag() {
    const svg = $('#strip'); let down = false;
    const pick = (e) => {
      const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * SW, hr = Math.max(0, Math.min(23, Math.floor((vx - X0) / HWID))), day = curDay(), i0 = S.D.times.findIndex((t) => t.slice(0, 10) === day);
      if (i0 >= 0 && i0 + hr < S.D.n) selectIdx(i0 + hr, true, true);
    };
    svg.addEventListener('pointerdown', (e) => { down = true; svg.setPointerCapture(e.pointerId); pick(e); });
    svg.addEventListener('pointermove', (e) => down && pick(e));
    svg.addEventListener('pointerup', () => (down = false));
  })();

  /* ====================================================================
     RENDER: windows + outlook
     ==================================================================== */
  function renderWindows() {
    const D = S.D;
    $('#windows').innerHTML = (S.windowsFallback ? `<div class="foot" style="padding:0 0 8px">Nothing reaches your prime threshold (${S.thr}) in the next 10 days — here are the best available windows.</div>` : '') +
      (S.windows.map((w) => {
        const pe = S.ev[w.peak], c = colorFor(pe), sMs = D.ms[w.s], eMs = D.ms[w.e] + 3600000;
        return `<div class="win" style="--c:${c}" data-i="${w.peak}"><div class="p">${pe.score}</div><div class="w"><b>${fD(sMs, { weekday: 'long', month: 'short', day: 'numeric' })}</b><small>${fT(sMs)} – ${fT(eMs)} · ${Math.round(S.rec[w.peak].wind)} mph ${Model.compass(S.rec[w.peak].dir)} · ${S.rec[w.peak].wave.toFixed(1)} ft · ${rel(sMs)}</small></div><button class="cal" data-ics="${w.peak}" title="Add to calendar">📅</button></div>`;
      }).join('') || '<div class="empty">No windows found.</div>') + `<div class="foot" style="padding:2px 0 0">Ranking uses your trip-hours setting: night hours count ${Math.round(Model.HOURS[S.hours].night * 100)}%.</div>`;
  }
  $('#windows').addEventListener('click', (e) => { const c = e.target.closest('[data-ics]'); if (c) { e.stopPropagation(); const w = S.windows.find((x) => x.peak === +c.dataset.ics); return windowIcs(w); } const w = e.target.closest('[data-i]'); if (w) selectIdx(+w.dataset.i, true); });

  function renderOutlook() {
    const D = S.D;
    $('#outlook').innerHTML = S.days.map((d) => {
      const ev = S.ev[d.best], c = colorFor(ev), sMs = D.ms[d.s];
      return `<div class="oc ${d.day === curDay() ? 'on' : ''}" style="--c:${c}" data-i="${d.best}"><small>${fDay(d.day, { weekday: 'short' })}</small><div class="d">${fDay(d.day, { month: 'short', day: 'numeric' })}</div><div class="e">${d.emoji}</div><div class="sc">${ev.level >= 2 ? '✕' : ev.score}</div><div class="m">${fH(sMs)}–${fH(D.ms[d.e] + 3600000)}<br>${Math.round(d.wind)} mph · ${d.wave.toFixed(1)} ft</div></div>`;
    }).join('');
  }
  $('#outlook').addEventListener('click', (e) => { const w = e.target.closest('[data-i]'); if (w) selectIdx(+w.dataset.i, true); });

  /* ====================================================================
     RENDER: season (year grid, month calendar, detail)
     ==================================================================== */
  const MONTH_TIPS = [
    'Ice and bitter cold. Lake Erie boats are mostly parked — a good time to service gear and study the charts.',
    'Last ice. Walleye are deep and lethargic and access is limited. Planning season.',
    'Ice-out and first open water. Fish stage near river mouths and warm discharges. Cold-water immersion risk is serious — dress for the water, not the air.',
    'Pre-spawn / post-spawn staging. Fish are shallower near reefs and river mouths; stickbaits and jigs. Watch the water temp climb into the 40s–50s.',
    'Post-spawn feeding frenzy as water reaches the 50s. Prime time starts — trolling stickbaits and crawler harnesses.',
    'Fish spread across the central basin. Troll harnesses and spoons with divers and planer boards; early and late light is best.',
    'Thermocline sets up and fish suspend. Troll spoons and harnesses, dawn and dusk key. Stay safe around pop-up storms.',
    'Warm and stable. Follow the thermocline; wind-driven upwellings can reset the bite overnight.',
    'Cooling water kicks off the fall feed. Fish move shallower and school up — one of the best months.',
    'Fall bite: reefs and structure, trolling and jigging. Cold, windy days — dress in layers and mind the forecast.',
    'Late-season trophy fish, short weather windows and big storms. Cold-water safety is critical.',
    'Ice forming, most boats done. Safety first.',
  ];
  function dispScore(day) {
    const f = S.days.find((d) => d.day === day);
    if (f) return { s: f.level >= 2 ? 0 : f.score, fc: true, level: f.level };
    return { s: Data.climoDay(day).score, fc: false, level: 0 };
  }
  function renderYear() {
    const yr = +Astro.etDay(new Date()).slice(0, 4), today = Astro.etDay(new Date());
    let h = '';
    for (let m = 0; m < 12; m++) {
      h += `<div class="mh ${m === S.month ? 'on' : ''}" data-m="${m}">${MONTHS[m].slice(0, 3)}</div>`;
      const dim = new Date(yr, m + 1, 0).getDate();
      for (let d = 1; d <= 31; d++) {
        if (d > dim) { h += '<div class="yc none"></div>'; continue; }
        const day = `${yr}-${Astro.pad(m + 1)}-${Astro.pad(d)}`, sc = dispScore(day);
        h += `<div class="yc ${sc.fc ? 'fc' : ''} ${day === today ? 'today' : ''} ${day === S.calDay ? 'sel' : ''}" data-day="${day}" style="background:${sc.level >= 2 ? '#ff3b5c' : rampC(sc.s)};opacity:${sc.fc ? 1 : 0.8}" title="${fDay(day, { month: 'short', day: 'numeric' })} · ${sc.fc ? 'forecast best' : 'typical potential'} ${sc.s}"></div>`;
      }
    }
    $('#yearGrid').innerHTML = h;
  }
  function renderMonth() {
    const yr = +Astro.etDay(new Date()).slice(0, 4), today = Astro.etDay(new Date());
    $('#monthTabs').innerHTML = MONTHS.map((n, m) => `<button data-m="${m}" class="${m === S.month ? 'on' : ''}">${n.slice(0, 3)}</button>`).join('');
    const first = new Date(Date.UTC(yr, S.month, 1)).getUTCDay(), dim = new Date(yr, S.month + 1, 0).getDate();
    let h = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="dh">${d}</div>`).join('');
    for (let k = 0; k < first; k++) h += '<div class="cc empty"></div>';
    for (let d = 1; d <= dim; d++) {
      const day = `${yr}-${Astro.pad(S.month + 1)}-${Astro.pad(d)}`, sc = dispScore(day), c = Data.climoDay(day), mi = Astro.phaseIndex(c.moon);
      h += `<div class="cc ${sc.fc ? 'fc' : ''} ${day === today ? 'today' : ''} ${day === S.calDay ? 'sel' : ''}" data-day="${day}"><div class="dn">${d}</div><div class="s" style="color:${sc.level >= 2 ? '#ff3b5c' : rampC(sc.s)}">${sc.level >= 2 ? '✕' : sc.s}</div><div class="mo">${Astro.PHASE_ICONS[mi]}</div></div>`;
    }
    $('#calendar').innerHTML = h;
  }
  function renderDetail() {
    const day = S.calDay || Astro.etDay(new Date()), c = Data.climoDay(day), f = S.days.find((d) => d.day === day), mi = Astro.phaseIndex(c.moon), se = c.ev, m = +day.slice(5, 7) - 1;
    let body;
    if (f) {
      const ev = S.ev[f.best], D = S.D;
      body = `<div class="kv"><span>🎯 Best: <b>${fT(D.ms[f.s])}–${fT(D.ms[f.e] + 3600000)}</b></span><span>Score <b>${ev.level >= 2 ? 'unsafe' : ev.score}</b></span><span>${Math.round(f.wind)} mph ${Model.compass(S.rec[f.best].dir)}</span><span>${f.wave.toFixed(1)} ft</span></div><p>Live forecast day. Tap to load the best hour on the map.</p><div class="row" style="margin-top:8px"><button class="btn pri" data-go="${f.best}">Show it on the map</button></div>`;
    } else {
      const slotWhy = c.slot === 'dawn' ? `first light (~${c.slotTime})` : c.slot === 'dusk' ? `the evening bite (~${c.slotTime})` : 'midday';
      body = `<div class="kv"><span>Potential <b style="color:${rampC(c.score)}">${c.score}</b></span><span>🌡️ water ~<b>${Math.round(c.waterT)}°F</b></span><span>${Astro.PHASE_ICONS[mi]} ${Astro.PHASE_NAMES[mi]}</span>${se.sunrise ? `<span>↑ ${fT(se.sunrise)} ↓ ${fT(se.sunset)}</span>` : ''}</div><p>Beyond the 10-day forecast this is the <i>typical</i> potential for the date — water temp, light, and moon with average weather. Best bet: <b>${slotWhy}</b>.</p>`;
    }
    $('#dayDetail').innerHTML = `<h3>${fDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>${body}<p><b>${MONTHS[m]}:</b> ${MONTH_TIPS[m]}</p><p style="font-size:11px;color:var(--tx3)">General guidance — local reports and ODNR regulations always win.</p>`;
  }
  function renderSeason() { renderYear(); renderMonth(); renderDetail(); }
  function pickDay(day) {
    S.calDay = day; S.month = +day.slice(5, 7) - 1;
    renderSeason();
  }
  $('#yearGrid').addEventListener('click', (e) => { const c = e.target.closest('[data-day]'), m = e.target.closest('[data-m]'); if (c) pickDay(c.dataset.day); else if (m) { S.month = +m.dataset.m; renderSeason(); } });
  $('#monthTabs').addEventListener('click', (e) => { const m = e.target.closest('[data-m]'); if (m) { S.month = +m.dataset.m; renderSeason(); } });
  $('#calendar').addEventListener('click', (e) => { const c = e.target.closest('[data-day]'); if (c) pickDay(c.dataset.day); });
  $('#dayDetail').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) selectIdx(+b.dataset.go, true); });

  /* ====================================================================
     TIME SELECTION
     ==================================================================== */
  function renderTime(light) {
    const D = S.D; if (!D) return;
    const r = $('#scrubRange'); r.value = S.idx; r.style.setProperty('--p', ((S.idx - r.min) / (r.max - r.min || 1)) * 100 + '%');
    const ms = D.ms[S.idx];
    $('#scrubTime').textContent = `${fD(ms, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fT(ms)}`;
    $('#scrubRel').textContent = S.idx === D.nowIdx ? '● now' : rel(ms);
    renderVerdict(); renderTrip(); renderTiles(); renderFactors(); renderStrip(); renderClock();
    MapView.updateField();
    if (!light) { renderDayTabs(); renderOutlook(); }
    else { document.querySelectorAll('.dtab').forEach((b) => b.classList.toggle('on', b.dataset.d === curDay())); document.querySelectorAll('.oc').forEach((b) => b.classList.toggle('on', S.days.find((d) => d.best === +b.dataset.i && d.day === curDay()) !== undefined)); }
  }
  function selectIdx(i, user, light) {
    const D = S.D; i = Math.max(0, Math.min(D.n - 1, i));
    if (user) S.follow = i === D.nowIdx;
    S.idx = i; renderTime(light);
  }

  /* ====================================================================
     SPOT / HOME / LOG
     ==================================================================== */
  let spotTimer;
  function setSpot(ll, final, fromClick) {
    const lat = ll.lat, lon = ll.lng != null ? ll.lng : ll.lon;
    if (lat < Data.shoreLat(lon) - 0.012) { if (fromClick) toast("That's land — pick a spot out on the lake 🌊"); return; }
    S.spot = { lat, lon };
    if (final) { recompute(); MapView.updateSpot(); renderAll(); save(); }
    else { // cheap live preview while dragging
      const r = Data.hourRecord(S.D, S.idx, S.spot), d = Data.miles(S.home, S.spot); S.dist = d;
      S.rec[S.idx] = r; S.ev[S.idx] = Model.evaluate(r, { boat: S.boat, method: S.method, distMi: d });
      renderVerdict(); renderTiles(); renderFactors(); MapView.updateField(); MapView.updateSpot();
    }
  }
  function spotAction(a) {
    if (a === 'home') {
      const name = prompt('Name this launch / home port:', S.home.name === Data.HOME.name ? 'My ramp' : S.home.name); if (name === null) return;
      S.home = { lat: S.spot.lat, lon: S.spot.lon, name: name || 'Home port' }; MapView.updateHome(); recompute(); MapView.updateSpot(); renderAll(); save(); toast('Home port moved ⚓');
    } else if (a === 'save') {
      const ex = S.spots.findIndex((s) => Data.miles(s, S.spot) < 0.15);
      if (ex >= 0) { S.spots.splice(ex, 1); toast('Spot removed'); }
      else { const name = prompt('Name this spot:', 'Spot ' + (S.spots.length + 1)); if (name === null) return; S.spots.push({ lat: S.spot.lat, lon: S.spot.lon, name: name || 'Spot' }); toast('Spot saved ⭐'); }
      MapView.updateSpot(); MapView.updateCatches(); save(); renderLog();
    } else if (a === 'fit') MapView.fit();
    else if (a === 'gps') MapView.locate((pos) => setSpot(pos, true, true));
  }

  function openModal(html) { $('#sheet').innerHTML = html; $('#modal').classList.add('show'); }
  function closeModal() { $('#modal').classList.remove('show'); }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

  function logModal() {
    const r = S.rec[S.idx];
    openModal(`<h3>🐟 Log a catch</h3><div class="foot" style="padding:0">Saved with the conditions at your dot: score ${S.ev[S.idx].score}, ${Math.round(r.wind)} mph ${Model.compass(r.dir)}, ${r.wave.toFixed(1)} ft, water ${r.waterT.toFixed(0)}°F.</div>
      <label>How many walleye?</label><input id="lgN" type="number" min="0" value="3"/>
      <label>Biggest (inches)</label><input id="lgB" type="number" min="0" placeholder="optional"/>
      <label>Method / lure</label><input id="lgM" placeholder="e.g. crawler harness, 1.8 mph"/>
      <div class="row"><button class="btn" data-close>Cancel</button><button class="btn pri" id="lgSave">Save catch</button></div>`);
    $('#lgSave').onclick = () => {
      S.logs.unshift({ id: Date.now(), at: S.D.ms[S.idx] <= Date.now() ? S.D.ms[S.idx] : Date.now(), lat: S.spot.lat, lon: S.spot.lon, n: +$('#lgN').value || 0, big: +$('#lgB').value || 0, method: $('#lgM').value.trim(), score: S.ev[S.idx].score, wind: r.wind, wave: r.wave, waterT: r.waterT, pres: r.pres, sunAlt: r.sunAlt });
      save(); closeModal(); renderLog(); MapView.updateCatches(); toast('Logged! The lake remembers 🎣');
    };
  }
  function renderLog() {
    $('#logCount').textContent = `${S.logs.length} trips · ${S.spots.length} spots`;
    const rows = S.logs.slice(0, 6).map((c) => `<div class="logrow"><span style="font-size:18px">🐟</span><div><b>${c.n} walleye${c.big ? ` · ${c.big}"` : ''}</b><div style="color:var(--tx2);font-size:11.5px">${fD(c.at)} ${fT(c.at)} · score ${c.score} · ${Math.round(c.wind)} mph · ${c.wave.toFixed(1)} ft${c.method ? ' · ' + esc(c.method) : ''}</div></div><button class="x" data-del="${c.id}">✕</button></div>`).join('');
    const sp = S.spots.map((s, i) => `<div class="logrow"><span style="font-size:18px">⭐</span><div><b>${esc(s.name)}</b><div style="color:var(--tx2);font-size:11.5px">${Data.miles(S.home, s).toFixed(1)} mi ${Model.compass(Data.bearing(S.home, s))}</div></div><button class="mini" style="margin-left:auto" data-spot="${i}">Go</button><button class="x" data-delspot="${i}" style="margin-left:0">✕</button></div>`).join('');
    $('#logList').innerHTML = rows + sp || '<div class="empty">No catches yet. Tap the button when the rod bends — over time this shows what <i>your</i> best conditions look like.</div>';
    const n = S.logs.length;
    if (n >= 3) {
      const avg = (k) => S.logs.reduce((a, c) => a + c[k], 0) / n, w = S.logs.filter((c) => c.n > 0);
      $('#logInsight').innerHTML = `📈 Across ${n} trips you averaged <b>${Math.round(avg('score'))}</b> score · ${Math.round(avg('wind'))} mph wind · ${avg('wave').toFixed(1)} ft waves · ${Math.round(avg('waterT'))}°F water. ${w.length < n ? `${n - w.length} skunked trip(s) are part of the data too.` : ''}`;
    } else $('#logInsight').textContent = '';
  }
  $('#logList').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'), ds = e.target.closest('[data-delspot]'), g = e.target.closest('[data-spot]');
    if (d) { S.logs = S.logs.filter((c) => c.id !== +d.dataset.del); save(); renderLog(); MapView.updateCatches(); }
    if (ds) { S.spots.splice(+ds.dataset.delspot, 1); save(); renderLog(); MapView.updateCatches(); MapView.updateSpot(); }
    if (g) { const s = S.spots[+g.dataset.spot]; setSpot({ lat: s.lat, lng: s.lon }, true); MapView.flyTo(s.lat, s.lon); }
  });
  $('#logBtn').onclick = logModal;
  $('#exportBtn').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ logs: S.logs, spots: S.spots, home: S.home }, null, 2)], { type: 'application/json' })); a.download = 'walleye-log.json'; a.click();
  };

  /* ---------- settings ---------- */
  function settingsModal(first) {
    openModal(`<h3>${first ? '🎣 Tell me how you fish' : '⚙ Settings'}</h3>${first ? '<div class="foot" style="padding:0">These tailor the safety limits, the wind/wave sweet spot, rankings and tips to <i>your</i> trips. Change them anytime in ⚙.</div>' : ''}
      <label>Your boat (sets the safety limits)</label><select id="stBoat">${Object.entries(Model.BOATS).map(([k, b]) => `<option value="${k}" ${k === S.boat ? 'selected' : ''}>${b.label} — waves ≤ ${b.wave} ft, gusts ≤ ${b.gust} mph</option>`).join('')}</select>
      <label>How you fish</label><select id="stMethod">${Object.entries(Model.METHODS).map(([k, m]) => `<option value="${k}" ${k === S.method ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
      <label>When you go out</label><select id="stHours">${Object.entries(Model.HOURS).map(([k, m]) => `<option value="${k}" ${k === S.hours ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
      <label>Cruise speed (mph) — for run times</label><input id="stSpd" type="number" min="5" max="60" value="${S.speed}"/>
      <label>"Prime window" threshold: <span id="thrV">${S.thr}</span></label><input id="stThr" type="range" min="50" max="90" value="${S.thr}"/>
      <label><input id="stNotify" type="checkbox" style="width:auto" ${S.notify ? 'checked' : ''}/> Notify me when a prime window is within 3 hours (while this tab is open)</label>
      <div class="row" style="justify-content:space-between"><button class="btn" id="stSrc">Data sources</button><span><button class="btn" data-close>Cancel</button> <button class="btn pri" id="stSave">Save</button></span></div>`);
    $('#stThr').oninput = (e) => ($('#thrV').textContent = e.target.value);
    $('#stSrc').onclick = sourcesModal;
    $('#stSave').onclick = async () => {
      S.boat = $('#stBoat').value; S.method = $('#stMethod').value; S.hours = $('#stHours').value; S.speed = +$('#stSpd').value || 20; S.thr = +$('#stThr').value; S.notify = $('#stNotify').checked;
      if (S.notify && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      if (S.notify && (!('Notification' in window) || Notification.permission === 'denied')) { S.notify = false; toast('Notifications are blocked by the browser'); }
      save(); closeModal(); MapView.updateHome(); recompute(); MapView.updateSpot(); renderAll();
    };
  }
  function sourcesModal() {
    const D = S.D, nm = { weather: 'Open-Meteo forecast', waves: 'Open-Meteo marine waves', windfield: 'Wind field (map)', wavefield: 'Wave field (map)', gauge: 'NOAA water-temp gauge', gaugeWind: 'NOAA wind gauge', gaugeAir: 'NOAA air-temp gauge', gaugePres: 'NOAA pressure gauge', alerts: 'NWS alerts', radar: 'RainViewer radar' };
    openModal(`<h3>📡 Data sources</h3>${Object.entries(D.sources).map(([k, v]) => `<div class="logrow"><span>${v === 'live' ? '🟢' : v === 'demo' ? '🧪' : v === 'estimated' ? '🟡' : '🔴'}</span><b>${nm[k] || k}</b><span style="margin-left:auto;color:var(--tx2)">${v === 'down' ? (k.startsWith('gauge') || k === 'alerts' || k === 'radar' ? 'unavailable (fallback in use)' : 'unavailable') : v}</span></div>`).join('')}<div class="foot">Loaded ${D.fetchedAt.toLocaleTimeString()} in ${D.loadMs} ms. Refreshes automatically every 10 minutes.</div><div class="row"><button class="btn pri" data-close>Close</button></div>`);
  }
  $('#settingsBtn').onclick = () => settingsModal(false);
  $('#livePill').onclick = () => S.D && sourcesModal();

  /* ====================================================================
     NOTIFICATIONS
     ==================================================================== */
  function maybeNotify() {
    if (!S.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const w = S.windows.slice().sort((a, b) => a.s - b.s).find((r) => S.D.ms[r.e] + 3600000 > Date.now() && S.D.ms[r.s] - Date.now() < 3 * 3600000 && !S.windowsFallback);
    if (!w) return;
    const key = String(S.D.ms[w.s]); if (S.notified.includes(key)) return;
    S.notified.push(key); save();
    new Notification(`🎣 Walleye window: ${S.ev[w.peak].score}`, { body: `${fD(S.D.ms[w.s])} ${fT(S.D.ms[w.s])}–${fT(S.D.ms[w.e] + 3600000)} · ${Math.round(S.rec[w.peak].wind)} mph, ${S.rec[w.peak].wave.toFixed(1)} ft` });
  }

  /* ====================================================================
     LOAD / REFRESH / PLAY
     ==================================================================== */
  let loading = false;
  async function refresh(manual) {
    if (loading) return; loading = true;
    $('#refreshBtn').classList.add('spin'); $('#liveTxt').textContent = 'Updating…';
    try {
      const prev = S.D && S.D.times[S.idx], D = await Data.load();
      S.D = D; S.nextRefresh = Date.now() + REFRESH_MS;
      const r = $('#scrubRange'); r.min = D.nowIdx; r.max = D.n - 1;
      const keep = prev ? D.times.indexOf(prev) : -1;
      S.idx = S.follow || keep < D.nowIdx ? D.nowIdx : keep;
      recompute(); renderAll(); applyHash(); maybeNotify(); if (S.layers.radar) MapView.loadRadar();
      if (manual) toast(D.demo ? 'Still offline — showing demo data' : 'Fresh data loaded ✔');
    } catch (e) { console.error(e); toast('Update failed — ' + e.message); }
    loading = false; $('#refreshBtn').classList.remove('spin');
  }
  function renderAll() {
    renderAlerts(); renderWindows(); renderSeason(); renderLog(); renderTime(false); renderChecklist(); MapView.updateCatches();
  }
  function updateLive() {
    const D = S.D, pill = $('#livePill'); if (!D) return;
    $('#clock').textContent = new Date().toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const left = Math.max(0, S.nextRefresh - Date.now()), m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    pill.classList.toggle('demo', D.demo);
    $('#liveTxt').innerHTML = D.demo ? `<b>DEMO DATA</b> · offline` : `<b>LIVE</b> · ${D.fetchedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · next ${m}:${String(s).padStart(2, '0')}`;
    if (left === 0 && !loading) refresh(false);
    // roll the "now" hour forward while following
    let ni = 0; for (let i = 0; i < D.n; i++) if (D.ms[i] <= Date.now()) ni = i;
    if (ni !== D.nowIdx) { const wasNow = S.idx === D.nowIdx; D.nowIdx = ni; $('#scrubRange').min = ni; recompute(); if (S.follow || wasNow) S.idx = ni; renderAll(); }
  }

  let playTimer;
  function setPlaying(on) {
    S.playing = on; $('#playBtn').textContent = on ? '❚❚' : '▶'; clearInterval(playTimer);
    if (on) playTimer = setInterval(() => { if (S.idx >= S.D.n - 1) return setPlaying(false); selectIdx(S.idx + 1, true, true); }, 180);
  }
  $('#playBtn').onclick = () => setPlaying(!S.playing);
  $('#nowBtn').onclick = () => { S.follow = true; setPlaying(false); selectIdx(S.D.nowIdx); };
  $('#scrubRange').addEventListener('input', (e) => { setPlaying(false); selectIdx(+e.target.value, true, true); });
  $('#refreshBtn').onclick = () => refresh(true);

  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(e.target.tagName) || !S.D || $('#modal').classList.contains('show')) return;
    const k = e.key;
    if (k === 'ArrowRight') selectIdx(S.idx + 1, true, true);
    else if (k === 'ArrowLeft') selectIdx(Math.max(S.D.nowIdx, S.idx - 1), true, true);
    else if (k === 'ArrowDown' || k === 'ArrowUp') { const di = S.days.findIndex((d) => d.day === curDay()), nd = S.days[di + (k === 'ArrowDown' ? 1 : -1)]; if (nd) selectIdx(nd.best, true); e.preventDefault(); }
    else if (k === ' ') { setPlaying(!S.playing); e.preventDefault(); }
    else if (k.toLowerCase() === 'r') refresh(true);
  });


  /* ====================================================================
     EXTRAS: trip planner, bite clock, best spot, checklist, share, calendar
     ==================================================================== */
  function tripStats(start, len) {
    const D = S.D, n = Math.max(1, Math.min(len, D.n - start));
    let sum = 0, peak = 0, maxW = 0, maxG = 0, unsafeAt = -1, cautionAt = -1, why = '';
    for (let k = 0; k < n; k++) {
      const i = start + k, ev = S.ev[i], r = S.rec[i];
      sum += ev.score; peak = Math.max(peak, ev.score); maxW = Math.max(maxW, r.wave); maxG = Math.max(maxG, r.gust);
      if (ev.level >= 2 && unsafeAt < 0) { unsafeAt = i; why = (ev.reasons.find((x) => x.lv === 2) || {}).msg || ''; }
      if (ev.level >= 1 && cautionAt < 0) cautionAt = i;
    }
    const runMin = Math.round((S.dist / S.speed) * 60);
    return { n, avg: Math.round(sum / n), peak, maxW, maxG, unsafeAt, cautionAt, why, runMin, endMs: D.ms[start + n - 1] + 3600000, returnBy: unsafeAt >= 0 ? D.ms[unsafeAt] - (runMin + 15) * 60000 : null };
  }
  function renderTrip() {
    const D = S.D, st = tripStats(S.idx, S.tripLen), startMs = D.ms[S.idx], se = Astro.sunEvents(curDay());
    let msg;
    if (st.unsafeAt === S.idx) msg = ['bad', `⛔ <b>Unsafe at launch.</b> ${esc(st.why)}`];
    else if (st.unsafeAt >= 0 && st.returnBy < startMs + 45 * 60000) msg = ['bad', `⛔ Conditions turn unsafe at ${fT(D.ms[st.unsafeAt])} — not worth the ${st.runMin}-minute run out.`];
    else if (st.unsafeAt >= 0) msg = ['warn', `⏱ <b>Be docked by ${fT(st.returnBy)}.</b> ${esc(st.why)} at ${fT(D.ms[st.unsafeAt])} (${st.runMin} min run + 15 min buffer).`];
    else if (st.cautionAt >= 0) msg = ['warn', `⚠️ Gets sporty around ${fT(D.ms[st.cautionAt])} — keep an eye on the sky.`];
    else msg = ['ok', '✅ Clear for the whole trip.'];
    const dark = se.sunset && st.endMs > se.sunset.getTime() + 1800000 && D.ms[S.idx] < se.sunset.getTime() ? ` 🌇 Sunset is ${fT(se.sunset)} — plan to run home in the dark or leave earlier.` : '';
    $('#tripWhen').textContent = `${fT(startMs)} → ${fT(st.endMs)}`;
    $('#trip').innerHTML = `<div class="chips">${[3, 4, 6, 8, 10].map((h) => `<button class="chip2 ${h === S.tripLen ? 'on' : ''}" data-len="${h}">${h} h</button>`).join('')}<button class="chip2" data-best="1">✨ Best start today</button></div>
      <div class="tstats"><div><b style="color:${rampC(st.avg)}">${st.avg}</b><small>avg score</small></div><div><b style="color:${rampC(st.peak)}">${st.peak}</b><small>peak</small></div><div><b>${st.maxW.toFixed(1)}<small style="font-size:11px"> ft</small></b><small>max waves</small></div><div><b>${Math.round(st.maxG)}<small style="font-size:11px"> mph</small></b><small>max gusts</small></div></div>
      <div class="tmsg ${msg[0]}">${msg[1]}${dark}</div>
      <div class="row" style="gap:6px;margin-top:6px"><button class="mini" data-tcal="1">📅 Add trip to calendar</button><span class="foot" style="padding:0">Launch = the hour on the scrubber · ${S.dist.toFixed(1)} mi run</span></div>`;
  }
  $('#trip').addEventListener('click', (e) => {
    const l = e.target.closest('[data-len]'), b = e.target.closest('[data-best]'), c = e.target.closest('[data-tcal]');
    if (l) { S.tripLen = +l.dataset.len; save(); renderTrip(); renderStrip(); renderChecklist(); }
    if (b) {
      const d = S.days.find((x) => x.day === curDay()); if (!d) return;
      let best = null;
      d.idxs.forEach((i) => { const st = tripStats(i, S.tripLen); if (st.unsafeAt >= 0 && st.returnBy < D_ms(i) + 3600000) return; const sc = st.avg * (D_night(i)); if (!best || sc > best.sc) best = { i, sc }; });
      if (best) { selectIdx(best.i, true); toast(`Best ${S.tripLen}-hour start today: ${fT(S.D.ms[best.i])}`); } else toast('No safe trip of that length today');
    }
    if (c) { const st = tripStats(S.idx, S.tripLen); ics(`🎣 Walleye trip (score ${st.avg})`, S.D.ms[S.idx], st.endMs, `Avg bite ${st.avg}, max waves ${st.maxW.toFixed(1)} ft, max gusts ${Math.round(st.maxG)} mph.${st.returnBy ? ' Be docked by ' + fT(st.returnBy) + '.' : ''}`); }
  });
  const D_ms = (i) => S.D.ms[i], D_night = (i) => (S.D.sunAlt[i] < -6 ? Model.HOURS[S.hours].night : 1);

  /* ---- bite clock ---- */
  function arc(cx, cy, r1, r2, a0, a1) {
    const p = (r, a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
    const [x1, y1] = p(r2, a0), [x2, y2] = p(r2, a1), [x3, y3] = p(r1, a1), [x4, y4] = p(r1, a0);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r2} ${r2} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}L${x3.toFixed(1)} ${y3.toFixed(1)}A${r1} ${r1} 0 0 0 ${x4.toFixed(1)} ${y4.toFixed(1)}Z`;
  }
  function renderClock() {
    const D = S.D; if (!D) return;
    const day = curDay(), i0 = D.times.findIndex((t) => t.slice(0, 10) === day), t0 = Astro.etToDate(day + 'T00:00').getTime(), cx = 130, cy = 130;
    let g = '';
    for (let hr = 0; hr < 24; hr++) {
      const i = i0 + hr, ev = S.ev[i]; if (!ev) continue;
      const a0 = hr * 15 + 1, a1 = hr * 15 + 14, sel = i === S.idx, past = i < D.nowIdx;
      g += `<path d="${arc(cx, cy, 70 + (sel ? 0 : 4), 104 - (sel ? -4 : (1 - ev.score / 100) * 26), a0, a1)}" fill="${colorFor(ev)}" opacity="${past ? 0.3 : sel ? 1 : 0.85}" ${sel ? 'stroke="#fff" stroke-width="1.5"' : ''}/>`;
    }
    for (let q = 0; q < 96; q++) {
      const al = Astro.sunAlt(new Date(t0 + q * 900000 + 450000)), c = al > 8 ? '#4aa8dc' : al > 0 ? '#e8a455' : al > -6 ? '#7a4a8a' : '#101a3a';
      g += `<path d="${arc(cx, cy, 58, 65, q * 3.75, q * 3.75 + 3.75)}" fill="${c}"/>`;
    }
    [['12a', 0], ['6a', 90], ['12p', 180], ['6p', 270]].forEach(([t, a]) => { const x = cx + 120 * Math.sin((a * Math.PI) / 180), y = cy - 120 * Math.cos((a * Math.PI) / 180); g += `<text x="${x}" y="${y + 4}" font-size="11" fill="#8fa9b8" text-anchor="middle">${t}</text>`; });
    const se = Astro.sunEvents(day);
    [[se.sunrise, '🌅'], [se.sunset, '🌇']].forEach(([d, ic]) => { if (!d) return; const a = ((d - t0) / 3600000) * 15, x = cx + 49 * Math.sin((a * Math.PI) / 180), y = cy - 49 * Math.cos((a * Math.PI) / 180); g += `<text x="${x}" y="${y + 5}" font-size="13" text-anchor="middle">${ic}</text>`; });
    if (D.times[D.nowIdx].slice(0, 10) === day) { const a = ((Date.now() - t0) / 3600000) * 15; g += `<line x1="${cx}" y1="${cy}" x2="${cx + 108 * Math.sin((a * Math.PI) / 180)}" y2="${cy - 108 * Math.cos((a * Math.PI) / 180)}" stroke="#fff" stroke-opacity=".4" stroke-dasharray="2 3"/>`; }
    const ev = S.ev[S.idx];
    g += `<text x="${cx}" y="${cy - 2}" font-family="Anton,Impact,sans-serif" font-size="40" text-anchor="middle" fill="${colorFor(ev)}">${ev.level >= 2 ? '✕' : ev.score}</text><text x="${cx}" y="${cy + 18}" font-size="12" fill="#cfe8f4" text-anchor="middle">${fT(D.ms[S.idx])}</text>`;
    $('#biteClock').innerHTML = g;
  }
  $('#biteClock').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.2) return;
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360, i0 = S.D.times.findIndex((t) => t.slice(0, 10) === curDay());
    selectIdx(i0 + Math.floor(deg / 15), true, true);
  });

  /* ---- best spot finder ---- */
  function bestSpot() {
    const D = S.D, i = S.idx; let best = null;
    const tryPt = (lat, lon, label) => {
      if (lat < Data.shoreLat(lon) + 0.02) return;
      const d = Data.miles(S.home, { lat, lon }), r = Data.hourRecord(D, i, { lat, lon }), ev = Model.evaluate(r, { boat: S.boat, method: S.method, distMi: d });
      const val = ev.score - Math.max(0, d - 8) * 0.8 - (ev.level >= 1 ? 4 : 0); // gentle pull toward shorter runs
      if (!best || val > best.val) best = { lat, lon, d, ev, val, label };
    };
    for (let lon = -81.2; lon <= -80.69; lon += 0.04) for (let k = 0; k < 10; k++) tryPt(Data.shoreLat(lon) + 0.04 + k * 0.03, lon);
    S.spots.forEach((sp) => tryPt(sp.lat, sp.lon, sp.name));
    if (!best) return toast('No spot found');
    setSpot({ lat: best.lat, lng: best.lon }, true); MapView.flyTo(best.lat, best.lon);
    toast(`🎯 ${best.label ? '⭐ ' + best.label : 'Best bite'}: ${best.ev.score} at ${best.d.toFixed(1)} mi ${Model.compass(Data.bearing(S.home, best))}`);
  }
  $('#bestSpotBtn').onclick = bestSpot;

  /* ---- checklist ---- */
  const CHECK = [
    ['pfd', 'Life jackets on everyone (worn, not stowed)'], ['plan', 'Float plan shared: where, when you\'re back, who to call'], ['fuel', 'Fuel: ⅓ out, ⅓ back, ⅓ reserve'], ['vhf', 'VHF radio / charged phone in a dry bag'],
    ['kill', 'Kill-switch lanyard clipped on'], ['gear', 'Throwable cushion, extinguisher, horn, anchor, first-aid'], ['lic', 'Fishing license + ODNR regs checked'], ['plug', 'Drain plug in'],
    ['cold', 'Exposure layers / immersion protection', (r) => r.waterT < 55, (r) => `Water is ${r.waterT.toFixed(0)}°F — cold-water shock is the #1 risk`],
    ['rain', 'Rain gear', (r) => r.pop >= 40 || r.precip > 0.02, (r) => `${Math.round(r.pop)}% rain chance`],
    ['sun', 'Polarized glasses, sunscreen, hat', (r, t) => r.cloud < 50 && r.sunAlt > 10, () => 'Sunny out there'],
    ['lights', 'Nav lights + headlamp', (r, t) => t.dark, () => 'Trip runs into twilight/dark'],
    ['fog', 'GPS track + fog horn, run slow', (r) => r.vis < 5000, () => 'Reduced visibility'],
    ['wind', 'Secure loose gear, check bilge pump', (r, t) => t.maxG > 17 || t.maxW > 2, (r, t) => `Gusts ${Math.round(t.maxG)} mph / waves ${t.maxW.toFixed(1)} ft`],
    ['radar', 'Check radar & the NWS marine forecast right before leaving', (r) => r.code >= 80 || r.pop >= 50, () => 'Showers/storms in the mix'],
  ];
  function renderChecklist() {
    if (!S.D || !S.rec[S.idx]) return;
    const today = Astro.etDay(new Date()); if (S.checks.date !== today) S.checks = { date: today, done: {} };
    const r = S.rec[S.idx], st = tripStats(S.idx, S.tripLen), se = Astro.sunEvents(curDay()), t = { maxG: st.maxG, maxW: st.maxW, dark: !!(se.sunset && st.endMs > se.sunset.getTime() - 1800000) || S.D.sunAlt[S.idx] < 0 };
    const items = CHECK.filter((c) => !c[2] || c[2](r, t));
    const done = items.filter((c) => S.checks.done[c[0]]).length;
    $('#chkCount').textContent = `${done}/${items.length} ready`;
    $('#checklist').innerHTML = items.map((c) => `<div class="chk ${S.checks.done[c[0]] ? 'done' : ''} ${c[2] ? 'cond' : ''}" data-k="${c[0]}"><i>✓</i><div><span>${c[1]}</span>${c[3] ? `<small>${esc(c[3](r, t))}</small>` : ''}</div></div>`).join('') + (done === items.length ? '<div class="ready">ALL SET — TIGHT LINES! 🎣</div>' : '');
  }
  $('#checklist').addEventListener('click', (e) => { const c = e.target.closest('[data-k]'); if (!c) return; S.checks.done[c.dataset.k] = !S.checks.done[c.dataset.k]; save(); renderChecklist(); });

  /* ---- share / calendar ---- */
  function shareUrl() { const u = new URL(location.href); u.hash = `t=${S.D.times[S.idx]}&lat=${S.spot.lat.toFixed(4)}&lon=${S.spot.lon.toFixed(4)}`; return u.toString(); }
  $('#shareBtn').onclick = async () => {
    const ev = S.ev[S.idx], r = S.rec[S.idx], v = Model.verdict(ev), D = S.D;
    const text = `🎣 Lake Erie walleye · ${fD(D.ms[S.idx])} ${fT(D.ms[S.idx])}: ${v.title} (${ev.score}) — ${Math.round(r.wind)} mph ${Model.compass(r.dir)}, ${r.wave.toFixed(1)} ft, water ${r.waterT.toFixed(0)}°F`;
    try { if (navigator.share) { await navigator.share({ title: 'Should I Fish?', text, url: shareUrl() }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + '\n' + shareUrl()); toast('Copied to clipboard 📋'); } catch (e) { prompt('Copy this link:', shareUrl()); }
  };
  function ics(title, startMs, endMs, desc) {
    const f = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShouldIFish//EN', 'BEGIN:VEVENT', `UID:${startMs}-${Date.now()}@shouldifish`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(startMs)}`, `DTEND:${f(endMs)}`, `SUMMARY:${title}`, `DESCRIPTION:${desc.replace(/\n/g, '\\n')}`, 'BEGIN:VALARM', 'TRIGGER:-PT90M', 'ACTION:DISPLAY', 'DESCRIPTION:Walleye window soon', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/calendar' })); a.download = 'walleye-trip.ics'; a.click();
    toast('Calendar file ready 📅');
  }
  function windowIcs(w) { if (!w) return toast('No window to add'); const D = S.D; ics(`🎣 Walleye window (peak ${S.ev[w.peak].score})`, D.ms[w.s], D.ms[w.e] + 3600000, `Peak ${S.ev[w.peak].score} · ${Math.round(S.rec[w.peak].wind)} mph ${Model.compass(S.rec[w.peak].dir)} · ${S.rec[w.peak].wave.toFixed(1)} ft`); }
  $('#icsBtn').onclick = () => windowIcs(S.windows.slice().sort((a, b) => a.s - b.s).find((r) => r.e >= S.D.nowIdx));
  function applyHash() {
    if (!location.hash || S.hashDone) return; S.hashDone = true;
    const h = new URLSearchParams(location.hash.slice(1)), t = h.get('t'), lat = +h.get('lat'), lon = +h.get('lon');
    if (lat && lon && lat > 41 && lat < 43) { S.spot = { lat, lon }; recompute(); MapView.updateSpot(); }
    if (t && S.D.times.includes(t)) { S.follow = false; S.idx = Math.max(S.D.nowIdx, S.D.times.indexOf(t)); }
    renderAll();
  }

  G.App = { setSpot, spotAction, save, refresh };

  /* ---------- boot ---------- */
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  MapView.init();
  window.addEventListener('resize', () => MapView.invalidate());
  refresh(false).then(() => { setInterval(updateLive, 1000); updateLive(); if (!saved.setup) { settingsModal(true); save(); } });
})(window);
