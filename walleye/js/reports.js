/* Fishing-report reader: turns free text (from any site, or pasted by you) into a "bite chatter" signal
   plus the facts anglers mention (depths, lures, areas). Shared by the browser and the Node fetcher. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Reports = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const POS = [
    [/limited out|limits? (?:of|came|by)|limit(?:ed)? (?:out|catch)/i, 2.5], [/hot (?:bite|action|fishing)|on fire|fired up|stacked|loaded|bonanza|banner|wide open|lights[- ]out/i, 2.5],
    [/excellent|outstanding|fantastic|phenomenal/i, 2], [/good (?:bite|fishing|action|catches|numbers|day)/i, 1.6], [/great|terrific/i, 1.5], [/\bgood\b|\bdecent\b|\bokay\b/i, 0.8], [/steady|consistent|solid|productive/i, 1],
    [/numbers|picking up|improv|turned on|turning on/i, 1], [/\b(?:caught|catching|landed|boated)\b/i, 0.5], [/strong/i, 0.8], [/\bnice (?:fish|catch|walleyes?|eyes)\b/i, 1],
  ];
  const NEG = [
    [/\bslow(?:ed|er|ly)?\b/i, 1.5], [/tough|difficult|challenging|struggl|grind/i, 1.5], [/poor|sluggish|lethargic|dismal/i, 1.8], [/skunk/i, 2],
    [/scattered|spotty|hit[- ]or[- ]miss|inconsistent/i, 1], [/lockjaw|shut ?down|bite (?:was|has been|is) off|off bite/i, 2], [/dirty|muddy|murky|blown out|stained|turbid/i, 1],
    [/sloppy|small craft|blown out|rough water|rough seas/i, 0.7], [/cold front|post[- ]?frontal|bluebird/i, 1], [/no fish|nothing|few fish|zero|nada/i, 1.5],
  ];
  const NEGATORS = /(?:\bnot|n't|\bnever|\bno|\bwithout|\bhardly)\s+(?:\w+\s+){0,2}$/i;
  const LOCAL = /geneva|ashtabula|conneaut|fairport|painesville|madison|perry\b|ohio[- ]pa\b|ohio[- ]pennsylvania|central basin|grand river|lake county|eastlake|willowick|wickliffe|cleveland|euclid|mentor|harpersfield|saybrook|lorain|vermilion|avon point/i;
  const WEST = /western basin|west(?:ern)? end|maumee|toledo|port clinton|sandusky|catawba|put[- ]in[- ]bay|bass islands?|reefs? complex|pelee|monroe|turtle island|niagara bar/i;
  const AREAS = ['Geneva', 'Ashtabula', 'Conneaut', 'Fairport', 'Painesville', 'Madison', 'Perry', 'Cleveland', 'Grand River', 'Eastlake', 'Lorain', 'Vermilion', 'Central basin', 'Ohio-PA line'];
  const LURES = [['crawler harness', /(?:crawler|worm) ?harness|spinner rig|harnesses/i], ['stickbaits', /stick ?baits?|reef ?runner|rapala|husky jerk|jerkbait|bandit|storm|thunderstick/i], ['spoons', /\bspoons?\b/i], ['jigs', /\bjig(?:s|ging)?\b|blade ?baits?|vertical/i],
    ['planer boards', /planer|boards?\b/i], ['divers', /diver|dipsy|jet diver|snap ?weight|lead ?core|leadcore/i], ['crankbaits', /crank ?baits?|shad rap|deep diving/i], ['minnows', /minnows?/i]];

  const sentences = (t) => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => s.length > 3);

  function scoreSentence(s) {
    let sc = 0; const pos = [], neg = [];
    POS.forEach(([re, w]) => { const m = re.exec(s); if (m) { const neg_ = NEGATORS.test(s.slice(Math.max(0, m.index - 22), m.index)); if (neg_) { sc -= w * 0.8; neg.push('not ' + m[0].toLowerCase()); } else { sc += w; pos.push(m[0].toLowerCase()); } } });
    NEG.forEach(([re, w]) => { const m = re.exec(s); if (m) { const neg_ = NEGATORS.test(s.slice(Math.max(0, m.index - 22), m.index)); if (neg_) { sc += w * 0.6; pos.push('not ' + m[0].toLowerCase()); } else { sc -= w; neg.push(m[0].toLowerCase()); } } });
    return { sc, pos, neg };
  }

  function analyze(text) {
    text = String(text || '');
    const sents = sentences(text); let sum = 0; const pos = [], neg = []; const scored = [];
    sents.forEach((s) => { const r = scoreSentence(s); sum += r.sc; pos.push(...r.pos); neg.push(...r.neg); scored.push({ s, sc: r.sc, walleye: /walleye|\beyes\b|marble ?eyes/i.test(s) }); });
    const walleyeMentions = (text.match(/walleye|\beyes\b|marble ?eyes/gi) || []).length;
    const west = (text.match(new RegExp(WEST.source, 'gi')) || []).length, local = (text.match(new RegExp(LOCAL.source, 'gi')) || []).length;
    const rel = local > 0 && west <= local ? 1 : west > local ? 0.35 : 0.6;
    const wf = walleyeMentions ? 1 : 0.3;
    const signal = Math.tanh(sum / 4) * rel * wf;
    // facts
    const depths = []; const dre = /(\d{2,3})(?:\s*(?:-|–|to)\s*(\d{2,3}))?\s*(?:ft\.?|feet|foot|fow|'|f\.o\.w)/gi; let m;
    while ((m = dre.exec(text))) { const a = +m[1], b = m[2] ? +m[2] : a; if (a >= 10 && b <= 110 && a <= b) depths.push([a, b]); }
    const lures = LURES.filter(([, re]) => re.test(text)).map(([n]) => n);
    const areas = AREAS.filter((a) => new RegExp('\\b' + a.replace('-', '[- ]'), 'i').test(text));
    // best snippet: strongest walleye-related sentences
    const pick = scored.filter((x) => x.walleye || Math.abs(x.sc) > 0).sort((a, b) => Math.abs(b.sc) - Math.abs(a.sc)).slice(0, 2).map((x) => x.s);
    const snippet = (pick.length ? pick : sents.slice(0, 2)).join(' ').slice(0, 300);
    return { signal: +signal.toFixed(3), walleye: walleyeMentions > 0, relevance: rel, pos: [...new Set(pos)].slice(0, 6), neg: [...new Set(neg)].slice(0, 6), depths, lures, areas, snippet };
  }

  const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const top = (arr, k) => { const c = {}; arr.forEach((x) => (c[x] = (c[x] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, k).map((e) => e[0]); };

  /* items: [{t:ms, analysis, weight?}] -> blended signal with recency decay */
  function aggregate(items, nowMs, halfLifeDays = 4) {
    let sw = 0, ss = 0, newest = 0; const lo = [], hi = [], lures = [], areas = [];
    items.forEach((it) => {
      const a = it.analysis; if (!a) return; const age = Math.max(0, (nowMs - it.t) / 864e5); if (age > 21) return;
      const w = Math.pow(0.5, age / halfLifeDays) * (it.weight || 1) * (a.walleye || it.weight ? 1 : 0.3);
      sw += w; ss += w * a.signal; newest = Math.max(newest, it.t);
      a.depths.forEach(([x, y]) => { lo.push(x); hi.push(y); }); lures.push(...a.lures); areas.push(...a.areas);
    });
    const n = items.filter((it) => it.analysis && (nowMs - it.t) / 864e5 <= 21).length;
    return { n, signal: n ? ss / (sw + 0.5) : 0, newest, depth: lo.length ? [Math.round(median(lo)), Math.round(median(hi))] : null, lures: top(lures, 3), areas: top(areas, 3) };
  }
  function label(sig) { return sig >= 0.5 ? ['🔥', 'HOT'] : sig >= 0.2 ? ['🙂', 'GOOD'] : sig > -0.2 ? ['😐', 'MIXED'] : sig > -0.5 ? ['🐌', 'SLOW'] : ['🥶', 'TOUGH']; }

  /* NWS marine text -> first-period wave range (ft) and wind (kt). Text looks like ".TODAY...SW winds 10 to 15 knots. Waves 1 to 3 feet." */
  function parseNwsText(text) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const m = /waves?\s+(?:around\s+|occasionally\s+)?(?:(\d+)\s*(?:to|-)\s*(\d+)|(\d+))\s*(?:feet|foot|ft)(\s+or less)?/i.exec(t);
    const w = /winds?\s+(?:\w+\s+){0,3}?(\d+)(?:\s*(?:to|-)\s*(\d+))?\s*knots?/i.exec(t);
    let waves = null;
    if (m) { const a = m[1] ? +m[1] : +m[3], b = m[2] ? +m[2] : a; waves = m[4] ? [0, a] : [a, b]; }
    return { waves, windKt: w ? [+w[1], w[2] ? +w[2] : +w[1]] : null };
  }
  /* GLERL ERDDAP csv (header row of names, optional units row) -> latest Erie value in °F */
  function parseGlsea(csv) {
    const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean); if (lines.length < 2) return null;
    const cols = lines[0].split(',').map((c) => c.trim()), ei = cols.findIndex((c) => /^erie$/i.test(c)); if (ei < 0) return null;
    const ti = cols.findIndex((c) => /^time$/i.test(c)), yi = cols.findIndex((c) => /^year$/i.test(c)), di = cols.findIndex((c) => /^day$/i.test(c));
    let best = null;
    lines.slice(1).forEach((l) => {
      const v = l.split(','), c = parseFloat(v[ei]); if (!Number.isFinite(c)) return;
      const t = ti >= 0 ? Date.parse(v[ti]) : yi >= 0 && di >= 0 ? Date.UTC(+v[yi], 0, 1) + (+v[di] - 1) * 864e5 : NaN; if (!Number.isFinite(t)) return;
      if (!best || t > best.t) best = { t, erieF: +((c * 9) / 5 + 32).toFixed(1) };
    });
    return best;
  }

  return { analyze, aggregate, label, parseNwsText, parseGlsea, POS, NEG };
});
