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
const now = Date.now(), out = { generated: new Date(now).toISOString(), sources: [], items: [], buoys: [], nws: null };

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
for (const b of cfg.buoys) {
  try { const o = parseNdbc(await get(`https://www.ndbc.noaa.gov/data/realtime2/${b.id}.txt`)); if (o) out.buoys.push({ id: b.id, name: b.name, ...o }); out.sources.push({ id: 'ndbc-' + b.id, name: 'NDBC ' + b.name, url: `https://www.ndbc.noaa.gov/station_page.php?station=${b.id}`, status: o ? 'ok' : 'no data', count: o ? 1 : 0 }); }
  catch (e) { out.sources.push({ id: 'ndbc-' + b.id, name: 'NDBC ' + b.name, status: 'error: ' + e.message, count: 0 }); }
}
try {
  const list = await get(`https://api.weather.gov/products/types/${cfg.nws.product}/locations/${cfg.nws.office}`, 'json'), first = list['@graph'] && list['@graph'][0];
  const prod = await get(`https://api.weather.gov/products/${first.id}`, 'json');
  out.nws = { issued: prod.issuanceTime, text: pickZone(prod.productText || '') }; out.sources.push({ id: 'nws', name: 'NWS Cleveland nearshore forecast', status: 'ok', count: 1 });
} catch (e) { out.sources.push({ id: 'nws', name: 'NWS Cleveland nearshore forecast', status: 'error: ' + e.message, count: 0 }); }

out.items.sort((a, b) => b.t - a.t);
fs.mkdirSync(path.join(here, '../data'), { recursive: true });
fs.writeFileSync(path.join(here, '../data/reports.json'), JSON.stringify(out, null, 1));
console.log(out.sources.map((s) => `${s.status === 'ok' ? '✔' : '✖'} ${s.name}: ${s.status}${s.count ? ' (' + s.count + ')' : ''}`).join('\n'));
