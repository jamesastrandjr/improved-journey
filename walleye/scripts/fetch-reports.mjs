/* Gathers fishing reports, offshore buoy obs and the NWS nearshore forecast into data/reports.json.
   Runs on a schedule in GitHub Actions (server-side, so no browser CORS limits). Node 18+. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { htmlToText, parseRss, parseNdbc, pickZone } from './lib.mjs';
const require = createRequire(import.meta.url), Reports = require('../js/reports.js');
const here = path.dirname(fileURLToPath(import.meta.url)), cfg = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8'));
const UA = 'ShouldIFish-LakeErieWalleye/1.0 (personal fishing planner; polite, low-volume)';
const get = async (url, type = 'text') => { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/geo+json,application/json' : '*/*' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return type === 'json' ? r.json() : r.text(); };
const now = Date.now(), out = { generated: new Date(now).toISOString(), sources: [], items: [], buoys: [], nws: null, gauge: null, glsea: null };

for (const s of cfg.reports.filter((x) => x.enabled !== false)) {
  const st = { id: s.id, name: s.name, url: s.url, status: 'ok', count: 0 };
  try {
    const body = await get(s.url); let entries = [];
    if (s.type === 'rss') entries = parseRss(body).slice(0, 8);
    else {
      const text = htmlToText(body); const dm = /([A-Z][a-z]+ \d{1,2},? \d{4})/.exec(text), t = dm ? Date.parse(dm[1]) : null;
      entries = [{ title: s.name, link: s.url, t: t || now, text }];
    }
    entries.forEach((e) => {
      const a = Reports.analyze(e.text);
      if (!a.walleye && !/lake erie|fishing/i.test(e.text + e.title)) return;
      const t = e.t || now; if (now - t > 21 * 864e5) return;
      out.items.push({ source: s.name, id: s.id, title: e.title.slice(0, 120), url: e.link || s.url, t, analysis: a }); st.count++;
    });
    if (!st.count) st.status = 'no recent walleye content';
  } catch (e) { st.status = 'error: ' + e.message; }
  out.sources.push(st);
}
// NOAA CO-OPS gauge (copy for when the browser can't reach it)
for (const st of cfg.coops.stations) {
  try {
    const q = async (product) => { const j = await get(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=${product}&application=ShouldIFish&station=${st.id}&date=latest&units=english&time_zone=gmt&format=json`, 'json'); const d = j.data && j.data[j.data.length - 1]; return d || null; };
    const [wt, wi, at, pr] = await Promise.all(['water_temperature', 'wind', 'air_temperature', 'air_pressure'].map((p) => q(p).catch(() => null)));
    if (!wt && !wi) throw new Error('no data');
    out.gauge = { id: st.id, name: st.name, t: Date.parse((wt || wi).t.replace(' ', 'T') + ':00Z'), waterT: wt ? +wt.v : null, wind: wi ? +wi.s * 1.15078 : null, windDir: wi ? +wi.d : null, gust: wi && wi.g ? +wi.g * 1.15078 : null, airT: at ? +at.v : null, pres: pr ? +pr.v : null };
    out.sources.push({ id: 'coops-' + st.id, name: 'NOAA CO-OPS ' + st.name, status: 'ok', count: 1 }); break;
  } catch (e) { out.sources.push({ id: 'coops-' + st.id, name: 'NOAA CO-OPS ' + st.name, status: 'error: ' + e.message, count: 0 }); }
}
// satellite lake-average surface temp (best effort - dataset syntax not verified from my sandbox)
try {
  const since = new Date(now - 6 * 864e5).toISOString().slice(0, 10); let g = null, last;
  for (const q of [`?time,Erie&time>=${since}T00:00:00Z`, `?Year,Day,Erie&Year>=${new Date(now).getUTCFullYear()}`]) { try { g = Reports.parseGlsea(await get(cfg.glsea.url + q)); if (g) break; } catch (e) { last = e; } }
  if (!g) throw last || new Error('no rows'); out.glsea = g; out.sources.push({ id: 'glsea', name: 'GLERL satellite lake-average temp', status: 'ok', count: 1 });
} catch (e) { out.sources.push({ id: 'glsea', name: 'GLERL satellite lake-average temp', status: 'error: ' + e.message, count: 0 }); }
for (const b of cfg.buoys) {
  try { const o = parseNdbc(await get(`https://www.ndbc.noaa.gov/data/realtime2/${b.id}.txt`)); if (o) out.buoys.push({ id: b.id, name: b.name, central: !!b.central, ...o }); out.sources.push({ id: 'ndbc-' + b.id, name: 'NDBC ' + b.name, url: `https://www.ndbc.noaa.gov/station_page.php?station=${b.id}`, status: o ? 'ok' : 'no data', count: o ? 1 : 0 }); }
  catch (e) { out.sources.push({ id: 'ndbc-' + b.id, name: 'NDBC ' + b.name, status: 'error: ' + e.message, count: 0 }); }
}
try {
  const zones = {};
  for (const z of cfg.nws.zones) zones[z.toUpperCase()] = (await get(`https://tgftp.nws.noaa.gov/data/forecasts/marine/near_shore/le/${z}.txt`)).replace(/\r/g, '').trim().slice(0, 2500);
  const issued = (/(\d{3,4} (?:AM|PM) E[SD]T [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4})/.exec(Object.values(zones)[0]) || [])[1] || null;
  out.nws = { issued, zones, text: Object.entries(zones).map(([k, v]) => k + ': ' + pickZone(v, /./)).join('\n\n') }; out.sources.push({ id: 'nws', name: 'NWS nearshore forecast (LEZ147/148)', status: 'ok', count: Object.keys(zones).length });
} catch (e) { out.sources.push({ id: 'nws', name: 'NWS nearshore forecast (LEZ147/148)', status: 'error: ' + e.message, count: 0 }); }

out.items.sort((a, b) => b.t - a.t);
fs.mkdirSync(path.join(here, '../data'), { recursive: true });
fs.writeFileSync(path.join(here, '../data/reports.json'), JSON.stringify(out, null, 1));
console.log(out.sources.map((s) => `${s.status === 'ok' ? '✔' : '✖'} ${s.name}: ${s.status}${s.count ? ' (' + s.count + ')' : ''}`).join('\n'));
