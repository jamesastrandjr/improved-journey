/* The "Should I fish?" brain: turns weather + sky + water into a bite score and a safety call. */
(function (G) {
  const { Astro } = G;

  const pl = (x, pts) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
    }
    return pts[pts.length - 1][1];
  };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  const BOATS = {
    small: { label: 'Small · ≤18 ft', wave: 2.0, gust: 20 },
    mid: { label: 'Mid · 18–24 ft', wave: 3.0, gust: 25 },
    large: { label: 'Large · 24 ft+', wave: 4.5, gust: 30 },
  };
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

  /* Central-basin surface water temp (°F) when no buoy/gauge reading is available */
  function climoWaterT(dayStr) { return 53 + 22 * Math.cos((2 * Math.PI * (Astro.dayOfYear(dayStr) - 215)) / 365); }

  /* rough fetch-limited wave guess when the marine model has no data (ft). wind from S = off-shore => tiny waves */
  function estimateWave(wind, dirFrom) {
    const fetch = clamp(0.4 + 0.6 * Math.max(0, Math.cos(((dirFrom - 20) * Math.PI) / 180)), 0.3, 1); // N/NNE = full fetch, S = shore
    return Math.max(0.1, 0.03 * Math.pow(wind, 1.45) * fetch);
  }

  /* NWS alert -> severity (2 = no-go, 1 = caution) */
  const ALERT_RULES = [
    [/gale warning|storm warning|hurricane|special marine|tornado|severe thunderstorm warning|hazardous seas|waterspout/i, 2],
    [/small craft|gale watch|storm watch|dense fog|marine weather statement|lakeshore flood|high wind|thunderstorm watch|beach hazards|rip current/i, 1],
  ];
  function alertLevel(ev) { for (const [re, lv] of ALERT_RULES) if (re.test(ev)) return lv; return 0; }

  /* ---- individual factors: each returns {s:0..1, note} ---- */
  function fWater(T) {
    const s = pl(T, [[32, 0.05], [40, 0.2], [48, 0.5], [54, 0.75], [58, 0.92], [62, 1], [68, 1], [72, 0.86], [76, 0.62], [80, 0.38], [86, 0.2]]);
    const note = T < 40 ? 'Ice-cold water — walleye are lethargic' : T < 48 ? 'Cold water, fish are slow and deep' : T < 55 ? 'Cool water — pre-spawn/late-fall feeding mode' : T <= 68 ? 'Prime walleye temperature range' : T <= 74 ? 'Warm — fish suspend, work the thermocline' : 'Very warm — fish are deep and sluggish';
    return { s, note };
  }
  function fLight(h) {
    const a = h.sunAlt;
    let s = pl(a, [[-90, 0.6], [-18, 0.6], [-8, 0.8], [-3, 1], [8, 1], [18, 0.85], [35, 0.62], [90, 0.5]]);
    if (a > 8) s += (h.cloud / 100) * 0.2 + (Math.min(h.wave, 3) / 3) * 0.1;
    s = clamp(s);
    const note = a < -8 ? 'Dark — night bite, fewer boats' : a < 8 ? 'Low light — the walleye window' : h.cloud > 70 ? 'Bright but overcast — fish stay shallower and active' : a > 30 ? 'High sun — fish sink deeper and get picky' : 'Mid-light, decent';
    return { s, note };
  }
  function fChop(h, opts) {
    const m = METHODS[(opts && opts.method) || 'troll'];
    const w = pl(h.wind, m.wind), v = pl(h.wave, m.wave);
    const note = m.key === 'jig' && (h.wind > 12 || h.wave > 2) ? 'Too much wind/chop to hold a vertical jig' : m.key === 'drift' && h.wind < 5 ? 'Not enough wind to drift' : h.wave < 0.5 && h.wind < 4 ? 'Glass calm — clear water, spooky fish' : h.wave <= 2.5 && h.wind >= 5 && h.wind <= 16 ? 'A walleye chop — ideal' : h.wave > 3.5 ? 'Big waves — rough and sloppy' : 'Workable chop';
    return { s: 0.5 * w + 0.5 * v, note };
  }
  function fPressure(h) {
    let s = pl(h.pTrend3, [[-8, 0.55], [-4, 0.85], [-1.5, 1], [-0.5, 0.9], [0.5, 0.8], [1.5, 0.7], [3, 0.5], [6, 0.35]]);
    if (h.pres > 1028) s *= 0.88; else if (h.pres < 1000) s *= 0.92;
    const t = h.pTrend3;
    const note = t < -4 ? 'Pressure crashing — storm incoming (bite hot, but watch the sky)' : t < -0.8 ? 'Falling pressure — fish feed ahead of the front' : t > 3 ? 'Post-front pressure spike — bite shuts down' : t > 1 ? 'Rising pressure — bite slowing' : 'Steady pressure — consistent bite';
    return { s: clamp(s), note };
  }
  function fDir(h) {
    if (h.wind < 4) return { s: 0.8, note: 'Light air, direction is a non-factor' };
    const s = pl(h.dir, [[0, 0.55], [45, 0.35], [90, 0.3], [135, 0.5], [180, 0.8], [225, 0.95], [270, 1], [315, 0.7], [360, 0.55]]);
    const note = s >= 0.9 ? `${compass(h.dir)} wind — "west wind, fish bite best"` : s <= 0.4 ? `${compass(h.dir)} wind — "east wind, fish bite least"` : `${compass(h.dir)} wind — neutral`;
    return { s, note };
  }
  function fSky(h) {
    let s = 0.55 + 0.4 * Math.pow(h.cloud / 100, 0.8);
    if (h.precip > 0.15) s *= 0.7; else if (h.precip > 0.02) s *= 0.95;
    if (h.pop >= 70) s *= 0.93;
    if (h.code >= 95) s = 0.1;
    const note = h.code >= 95 ? 'Thunderstorms' : h.precip > 0.15 ? 'Heavy rain' : h.cloud > 70 ? 'Overcast — walleye love it' : h.cloud < 20 ? 'Cloudless bluebird sky' : 'Partly cloudy';
    return { s: clamp(s), note };
  }
  function fMoon(h) {
    const s = clamp(0.4 + 0.3 * Astro.moonBoost(h.moonPhase) + (h.sol.type === 'major' ? 0.3 * h.sol.v : h.sol.type === 'minor' ? 0.2 * h.sol.v : 0));
    const note = h.sol.type === 'major' ? 'Major solunar period — moon overhead/underfoot' : h.sol.type === 'minor' ? 'Minor solunar period — moon rise/set' : Astro.moonBoost(h.moonPhase) > 0.8 ? 'Near new/full moon — stronger solunar days' : 'Quiet moon';
    return { s, note };
  }

  /* fishing method — changes the wind/wave sweet spot and the tips shown */
  const METHODS = {
    troll: { key: 'troll', label: 'Trolling (planer boards, harnesses, stickbaits)', wind: [[0, 0.45], [4, 0.7], [8, 1], [16, 1], [20, 0.85], [25, 0.5], [32, 0.2], [40, 0]], wave: [[0, 0.55], [0.5, 0.8], [1, 1], [3, 1], [4, 0.6], [5.5, 0.2], [8, 0]] },
    jig: { key: 'jig', label: 'Jigging / vertical (reefs & structure)', wind: [[0, 0.7], [3, 0.95], [6, 1], [10, 0.8], [14, 0.45], [18, 0.2], [25, 0]], wave: [[0, 0.9], [1, 1], [1.5, 0.8], [2.5, 0.4], [3.5, 0.1], [5, 0]] },
    drift: { key: 'drift', label: 'Drifting (crawler harness / spinner rigs)', wind: [[0, 0.3], [4, 0.6], [8, 1], [14, 1], [18, 0.6], [24, 0.2], [32, 0]], wave: [[0, 0.6], [0.5, 0.85], [1, 1], [2.5, 1], [3.5, 0.5], [5, 0.1], [8, 0]] },
  };
  const HOURS = {
    day: { label: 'Daytime only', night: 0.4 },
    twilight: { label: 'Dawn & dusk lover (some night)', night: 0.8 },
    any: { label: 'Anytime — night bite too', night: 1 },
  };
  /* starting-point tips for the selected method, from water temp & light */
  function tip(h, method) {
    const T = h.waterT, low = h.sunAlt < 8 || h.cloud > 70;
    if (method === 'troll') {
      const spd = T < 50 ? '1.0–1.5' : T < 60 ? '1.5–2.0' : T < 70 ? '1.8–2.4' : '2.0–2.6';
      return `Troll ~${spd} mph. ${T < 55 ? 'Shallower stickbaits near structure.' : T < 70 ? 'Crawler harnesses / spoons on planer boards; ' + (low ? 'run them shallower in this light.' : 'divers to get below the glare.') : 'Spoons on divers to find the thermocline; fish are deep.'}`;
    }
    if (method === 'jig') return `${T < 50 ? 'Slow, small jigs tight to the bottom' : T < 65 ? 'Jig & minnow or blade baits over reefs' : 'Heavier jigs deeper off structure'}; ${h.wind > 10 ? 'wind makes holding position hard — use the drift sock.' : 'light air — hold position and work the bottom.'}`;
    return `Drift ~${T < 55 ? '0.8–1.2' : '1.0–1.6'} mph with ${T < 55 ? 'jig-and-crawler' : 'crawler harnesses'}; ${h.wind < 6 ? 'drift sock out for more speed.' : 'let the wind do the work.'}`;
  }

  function fReports(h) {
    const r = h.rep, sig = r.signal;
    return { s: clamp(0.5 + 0.5 * sig), note: r.note };
  }

  const FACTORS = [
    { id: 'water', label: 'Water temp', w: 0.18, fn: fWater, arg: (h) => h.waterT, icon: '🌡️' },
    { id: 'light', label: 'Light', w: 0.24, fn: fLight, icon: '🌅' },
    { id: 'chop', label: 'Wind & waves', w: 0.16, fn: fChop, icon: '🌊' },
    { id: 'pressure', label: 'Pressure', w: 0.12, fn: fPressure, icon: '📉' },
    { id: 'dir', label: 'Wind direction', w: 0.06, fn: fDir, icon: '🧭' },
    { id: 'sky', label: 'Sky', w: 0.06, fn: fSky, icon: '☁️' },
    { id: 'moon', label: 'Moon / solunar', w: 0.08, fn: fMoon, icon: '🌙' },
    { id: 'reports', label: 'Angler reports', w: 0.1, fn: fReports, icon: '📣', optional: true },
  ];

  /* h: merged hour record. opts: {boat, distMi, alerts} */
  function evaluate(h, opts = {}) {
    const boat = BOATS[opts.boat || 'mid'];
    const factors = FACTORS.filter((f) => !f.optional || h.rep).map((f) => { const r = f.fn(f.arg ? f.arg(h) : h, opts); return { id: f.id, label: f.label, icon: f.icon, w: f.w, s: r.s, note: r.note }; });
    const waterS = factors[0].s;
    const bite = Math.min(100, Math.round(Math.pow(factors.reduce((a, f) => a + f.s * f.w, 0) / factors.reduce((a, f) => a + f.w, 0), 1.55) * (0.45 + 0.55 * waterS) * 100));

    // ----- safety -----
    const reasons = [];
    let level = 0;
    const bump = (lv, msg) => { level = Math.max(level, lv); reasons.push({ lv, msg }); };
    if (h.code >= 95) bump(2, 'Thunderstorms in the forecast — get off the lake');
    if (h.wave > boat.wave) bump(2, `Waves ${h.wave.toFixed(1)} ft exceed your ${boat.wave} ft comfort limit`);
    else if (h.wave > boat.wave * 0.7) bump(1, `Waves building to ${h.wave.toFixed(1)} ft`);
    if (h.gust > boat.gust) bump(2, `Gusts to ${Math.round(h.gust)} mph exceed your ${boat.gust} mph limit`);
    else if (h.gust > boat.gust * 0.75) bump(1, `Gusty — up to ${Math.round(h.gust)} mph`);
    if (h.vis != null && h.vis < 800) bump(2, 'Dense fog — visibility under ½ mile');
    else if (h.vis != null && h.vis < 3200) bump(1, 'Reduced visibility');
    if (h.pop >= 60 && h.precip > 0.05) bump(1, 'Rain likely');
    if (h.temp < 28) bump(1, 'Freezing — spray ice & cold exposure');
    if (h.waterT < 40) bump(1, 'Cold-water immersion risk — PFD & layers');
    if (h.pTrend3 < -5) bump(1, 'Rapidly falling pressure — squalls possible');
    if (opts.distMi > 8 && h.wave > boat.wave * 0.5) bump(1, `Long run (${opts.distMi.toFixed(0)} mi) home in building seas`);
    for (const al of h.alerts || []) { const lv = alertLevel(al.event); if (lv) bump(lv, `NWS: ${al.event}`); }

    const score = level >= 2 ? Math.min(bite, 12) : level === 1 ? Math.round(bite * 0.88) : bite;
    return { bite, score, level, reasons, factors };
  }

  const VERDICTS = [
    { min: 82, key: 'send', title: 'SEND IT', sub: 'Everything lines up. Go fish.', color: '#2cf0a3', mood: 'hungry' },
    { min: 68, key: 'go', title: 'GO FISH', sub: 'Solid conditions — a good day on the water.', color: '#9cf04a', mood: 'hungry' },
    { min: 52, key: 'maybe', title: 'WORTH A LOOK', sub: 'Decent. Pick your window carefully.', color: '#ffd23f', mood: 'picky' },
    { min: 36, key: 'meh', title: 'MEH', sub: 'The fish are picky. Better days are coming.', color: '#ff9a3c', mood: 'picky' },
    { min: 0, key: 'skip', title: 'SKIP IT', sub: 'Stay dry — the lake will still be there.', color: '#ff6b6b', mood: 'sleepy' },
  ];
  const NOGO = { key: 'nogo', title: 'NOPE', sub: 'Unsafe. Do not launch.', color: '#ff3b5c', mood: 'sleepy' };
  function verdict(ev) {
    if (ev.level >= 2) return NOGO;
    return VERDICTS.find((v) => ev.score >= v.min);
  }
  function scoreColor(score, level) {
    if (level >= 2) return '#ff3b5c';
    return verdict({ level: 0, score }).color;
  }

  G.Model = { METHODS, HOURS, tip, pl, clamp, BOATS, FACTORS, compass, climoWaterT, estimateWave, alertLevel, evaluate, verdict, scoreColor, VERDICTS, NOGO };
})(window);
