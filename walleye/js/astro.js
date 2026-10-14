/* Astronomy + time helpers (sun, moon, solunar). Low-precision formulas, plenty good for fishing.
   All "ET strings" are America/New_York wall-clock: 'YYYY-MM-DDTHH:MM'. */
(function (G) {
  const TZ = 'America/New_York';
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- time helpers ---------- */
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  function etParts(d) {
    const o = {};
    fmt.formatToParts(d).forEach((p) => (o[p.type] = p.value));
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
  }
  function etStr(d) { const p = etParts(d); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; }
  function etDay(d) { return etStr(d).slice(0, 10); }
  function etToDate(s) {
    const [dt, tm] = s.split('T');
    const [y, m, d] = dt.split('-').map(Number);
    const [h, mi] = (tm || '00:00').split(':').map(Number);
    const target = Date.UTC(y, m - 1, d, h, mi);
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const p = etParts(new Date(guess));
      guess -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - target;
    }
    return new Date(guess);
  }
  function addDays(dayStr, n) { const [y, m, d] = dayStr.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
  function dayOfYear(dayStr) { const [y, m, d] = dayStr.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / dayMs); }

  /* ---------- sun / moon ---------- */
  const toDays = (date) => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
  function sunCoords(d) {
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    return { dec: declination(L, 0), ra: rightAscension(L, 0) };
  }
  function moonCoords(d) {
    const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
    const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
  }
  const LAT = 41.95, LON = -80.95;
  function sunAlt(date, lat = LAT, lon = LON) {
    const d = toDays(date), c = sunCoords(d);
    return altitude(siderealTime(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad;
  }
  function moonAlt(date, lat = LAT, lon = LON) {
    const d = toDays(date), c = moonCoords(d);
    return altitude(siderealTime(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad;
  }
  /* phase 0..1 (0 new, .5 full), illumination 0..1 */
  function moonPhase(date) {
    const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI, illum: (1 + Math.cos(inc)) / 2 };
  }
  const PHASE_NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const PHASE_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  function phaseIndex(p) { return Math.round(p * 8) % 8; }
  /* new/full moons are the strongest solunar days: 1 at new & full, 0 at quarters */
  function moonBoost(phase) { return 0.5 + 0.5 * Math.cos(4 * Math.PI * phase); }

  /* ---------- event scans ---------- */
  const cache = {};
  /* sun events for a local day */
  function sunEvents(dayStr) {
    const k = 's' + dayStr; if (cache[k]) return cache[k];
    const t0 = etToDate(dayStr + 'T00:00').getTime(), out = {};
    let prev = sunAlt(new Date(t0));
    const marks = [['dawn', -6, 1], ['sunrise', -0.833, 1], ['sunset', -0.833, -1], ['dusk', -6, -1]];
    for (let m = 5; m <= 1440; m += 5) {
      const t = t0 + m * 60000, a = sunAlt(new Date(t));
      marks.forEach(([name, th, dir]) => {
        if (out[name]) return;
        if (dir > 0 ? prev < th && a >= th : prev >= th && a < th) out[name] = new Date(t0 + (m - 5 + (5 * (th - prev)) / (a - prev)) * 60000);
      });
      prev = a;
    }
    return (cache[k] = out);
  }
  /* moon events inside [startMs, endMs]: rise/set (minor), transit/underfoot (major) */
  function moonEvents(startMs, endMs) {
    const out = [], step = 6 * 60000;
    let a0 = moonAlt(new Date(startMs - step)), a1 = moonAlt(new Date(startMs)), a2;
    for (let t = startMs; t <= endMs; t += step) {
      a2 = moonAlt(new Date(t + step));
      if (a0 < -0.5 && a1 >= -0.5) out.push({ t, type: 'minor', kind: 'moonrise' });
      if (a0 >= -0.5 && a1 < -0.5) out.push({ t, type: 'minor', kind: 'moonset' });
      if (a1 > a0 && a1 >= a2) out.push({ t, type: 'major', kind: 'overhead' });
      if (a1 < a0 && a1 <= a2) out.push({ t, type: 'major', kind: 'underfoot' });
      a0 = a1; a1 = a2;
    }
    return out;
  }
  /* 0..1 closeness to a solunar window; major = ±75min, minor = ±45min */
  function solunarAt(ms, events) {
    let best = { type: null, v: 0 };
    for (const ev of events) {
      const half = ev.type === 'major' ? 75 * 60000 : 45 * 60000, dist = Math.abs(ms - ev.t);
      if (dist <= half) {
        const v = (ev.type === 'major' ? 1 : 0.55) * (1 - 0.5 * (dist / half));
        if (v > best.v) best = { type: ev.type, v, kind: ev.kind };
      }
    }
    return best;
  }

  G.Astro = { TZ, pad, etParts, etStr, etDay, etToDate, addDays, dayOfYear, sunAlt, moonAlt, moonPhase, phaseIndex, PHASE_NAMES, PHASE_ICONS, moonBoost, sunEvents, moonEvents, solunarAt };
})(window);
