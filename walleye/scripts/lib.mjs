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
