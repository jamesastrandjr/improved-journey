import { h, fmtLen, parseLen, getPath, setPath } from './dom.js';
import { COVERS, FINISHES, BALL_ARCHETYPES } from '../physics/ball.js';
import { PATTERN_PRESETS, SURFACES } from '../physics/lane.js';
import { STYLE_PRESETS } from '../state.js';

// ---- field definitions. path roots: "profile." and "fitting." ----
const opt = (arr) => arr.map(([v, l]) => ({ v, l }));

export function sections(S, bank) {
  const two = () => S.profile.style === 'twoHand';
  return {
    client: [
      { path: 'profile.name', label: 'Full name', type: 'text', ph: 'e.g. Pat Smith', wide: true },
      { path: 'profile.phone', label: 'Phone', type: 'tel' },
      { path: 'profile.email', label: 'Email', type: 'email' },
      { path: 'profile.hand', label: 'Throwing hand', type: 'seg', options: opt([['R', 'Right'], ['L', 'Left']]) },
      { path: 'profile.style', label: 'Delivery', type: 'seg', options: opt([['oneHand', 'One-handed'], ['twoHand', 'Two-handed']]) },
      { path: 'profile.average', label: 'League average', type: 'number', min: 0, max: 300, step: 1 },
      { path: 'profile.yearsBowling', label: 'Years bowling', type: 'number', min: 0, max: 80, step: 1 },
      { path: 'profile.level', label: 'Level', type: 'select', options: opt([['casual', 'Casual / recreational'], ['league', 'League bowler'], ['competitive', 'Tournament / competitive'], ['pro', 'Professional']]) },
      { path: 'profile.bodyWeightLb', label: 'Body weight (lb)', type: 'number', min: 40, max: 450, step: 1, hint: () => { const w = +S.profile.bodyWeightLb; return w ? `Rule of thumb ~10% of body weight -> about ${Math.min(16, Math.max(6, Math.round(w / 10)))} lb ball (max 16). Let comfort decide.` : 'Optional: used for a ball-weight suggestion.'; } },
      { path: 'profile.league', label: 'League / home house', type: 'text' },
      { path: 'profile.goals', label: 'Goals / what they want from a new ball', type: 'textarea', wide: true },
      { path: 'profile.health', label: 'Hand / wrist / injury notes', type: 'textarea', wide: true, ph: 'Thumb swelling, carpal tunnel, brace, etc.' },
      { path: 'profile.consent', label: 'Customer agrees to us storing these details', type: 'check', wide: true },
    ],
    grip: [
      { path: 'fitting.hand.gripType', label: 'Grip type', type: 'seg', options: opt([['conventional', 'Conventional'], ['semi', 'Semi-fingertip'], ['fingertip', 'Fingertip']]), wide: true },
      { path: 'fitting.hand.span', label: 'Span (thumb to fingers)', type: 'len', min: 2.5, max: 6.5, typical: [3.5, 5.0], hint: () => 'Inside edge of thumb hole to inside edge of finger holes, fit with hand relaxed.' },
      { path: 'fitting.hand.fingerSpacing', label: 'Finger hole spacing (centre to centre)', type: 'len', min: 0.5, max: 1.75, typical: [0.8, 1.3] },
      { path: 'fitting.hand.bridge', label: 'Bridge (between finger holes)', type: 'len', min: 0, max: 1, typical: [0.125, 0.5] },
      { path: 'fitting.hand.middleHole', label: 'Middle finger hole', type: 'len', min: 0.5, max: 1.2, typical: [0.7, 1.0] },
      { path: 'fitting.hand.ringHole', label: 'Ring finger hole', type: 'len', min: 0.5, max: 1.2, typical: [0.7, 1.0] },
      { path: 'fitting.hand.thumbHole', label: 'Thumb hole', type: 'len', min: 0.6, max: 1.8, typical: [0.85, 1.4], show: () => !two() },
      { path: 'fitting.hand.thumbStyle', label: 'Thumb style', type: 'select', options: opt([['round', 'Round'], ['ovalH', 'Oval (horizontal)'], ['ovalV', 'Oval (vertical)'], ['slug', 'Slug / insert'], ['insert', 'Adjustable insert']]), show: () => !two() },
      { path: 'fitting.hand.fingerPitchFwd', label: 'Finger pitch (+ forward / - reverse)', type: 'len', min: -0.75, max: 0.75, typical: [0, 0.5] },
      { path: 'fitting.hand.fingerPitchLat', label: 'Finger lateral pitch (+ right)', type: 'len', min: -0.5, max: 0.5, typical: [-0.25, 0.25] },
      { path: 'fitting.hand.thumbPitchRev', label: 'Thumb pitch (+ reverse / - forward)', type: 'len', min: -0.5, max: 0.75, typical: [0, 0.375], show: () => !two() },
      { path: 'fitting.hand.thumbPitchLat', label: 'Thumb lateral pitch (+ right)', type: 'len', min: -0.5, max: 0.5, typical: [-0.25, 0.25], show: () => !two() },
      { path: 'fitting.hand.handLength', label: 'Hand length (wrist to middle fingertip)', type: 'len', min: 5, max: 10, typical: [6.5, 9] },
      { path: 'fitting.hand.palmWidth', label: 'Palm width (across knuckles)', type: 'len', min: 2.5, max: 5, typical: [3, 4.5] },
      { path: 'fitting.hand.notes', label: 'Fit notes', type: 'textarea', wide: true, ph: 'Callus areas, finger fit feel, hole shape requests...' },
    ],
    delivery: [
      { path: 'fitting.delivery.type', label: 'Bowler style', type: 'seg', wide: true, options: opt([['stroker', 'Stroker'], ['tweener', 'Tweener'], ['cranker', 'Cranker'], ['twoHand', 'Two-hander'], ['custom', 'Custom']]), hint: () => 'Picking a style fills in TYPICAL numbers - replace them with measured values (Specto, camera, radar) when you have them.' },
      { path: 'fitting.delivery.source', label: 'Numbers are', type: 'seg', options: opt([['estimated', 'Estimated'], ['measured', 'Measured']]) },
      { path: 'fitting.delivery.speedMph', label: 'Ball speed at release (mph)', type: 'range', min: 8, max: 24, step: 0.1 },
      { path: 'fitting.delivery.revRpm', label: 'Rev rate (rpm)', type: 'range', min: 60, max: 600, step: 5 },
      { path: 'fitting.delivery.axisTilt', label: 'Axis tilt (deg)', type: 'range', min: 0, max: 40, step: 0.5, hint: () => 'How far the axis tips from horizontal. 0-8 low, 10-18 medium, 20+ high.' },
      { path: 'fitting.delivery.axisRotation', label: 'Axis rotation (deg)', type: 'range', min: 0, max: 90, step: 1, hint: () => '90 = pure forward roll (no side roll). Strokers 65-90, tweeners 50-70, crankers 30-55.' },
      { path: 'fitting.delivery.papOver', label: 'PAP - over (in)', type: 'len', min: 0.5, max: 7, typical: [3, 6], hint: () => 'Distance from grip centre toward the bowling-hand side.' },
      { path: 'fitting.delivery.papUp', label: 'PAP - up (in)', type: 'len', min: -3, max: 3.5, typical: [-1, 2.25], hint: () => '+ toward the finger holes, - toward the thumb.' },
      { path: 'fitting.delivery.loftFt', label: 'Loft - landing distance (ft)', type: 'number', min: 0.5, max: 8, step: 0.5 },
      { path: 'fitting.delivery.startBoard', label: 'Start board at foul line', type: 'number', min: 1, max: 39, step: 1, hint: () => 'Counted from the bowler\'s own side (1 = own gutter).' },
      { path: 'fitting.delivery.targetBoard', label: 'Target board at arrows (15 ft)', type: 'number', min: 1, max: 39, step: 0.5 },
    ],
    ball: [
      { path: 'fitting.ball.libId', label: 'Ball library', type: 'ballpick', wide: true },
      { path: 'fitting.ball.name', label: 'Ball name', type: 'text' },
      { path: 'fitting.ball.brand', label: 'Brand', type: 'text' },
      { path: 'fitting.ball.weightLb', label: 'Weight (lb)', type: 'number', min: 6, max: 16, step: 1 },
      { path: 'fitting.ball.cover', label: 'Coverstock', type: 'select', options: Object.entries(COVERS).map(([v, c]) => ({ v, l: c.label })) },
      { path: 'fitting.ball.grit', label: 'Surface finish', type: 'select', num: true, options: FINISHES.map((f) => ({ v: f.grit, l: f.label })) },
      { path: 'fitting.ball.rg', label: 'RG (low)', type: 'number', min: 2.4, max: 2.85, step: 0.01 },
      { path: 'fitting.ball.diff', label: 'Differential', type: 'number', min: 0, max: 0.09, step: 0.001 },
      { path: 'fitting.ball.intDiff', label: 'Intermediate diff (0 = symmetric)', type: 'number', min: 0, max: 0.06, step: 0.001, hint: () => 'In this model: how far the intermediate axis sits below the high-RG axis.' },
      { path: 'fitting.ball.coreAzimuth', label: 'Core orientation (deg)', type: 'number', min: 0, max: 90, step: 5, hint: () => 'Advanced. Where the high-RG axis sits around the pin (matters for asymmetric cores only).' },
      { path: 'fitting.ball.color', label: 'Display colour', type: 'color' },
      { path: 'layout', type: 'layout', wide: true },
      { path: 'fitting.layout.pinDistance', label: 'Pin to PAP (in)', type: 'len', min: 0, max: 6.5, typical: [2, 6] },
      { path: 'fitting.layout.valAngle', label: 'VAL angle (deg)', type: 'number', min: 0, max: 180, step: 1, hint: () => '0 = pin straight above the PAP, 90 = toward the grip centre, 180 = below. VAL sets pin buffer and hole/core interaction; flare comes from pin-to-PAP distance and core orientation.' },
      { path: 'fitting.layout.notes', label: 'Layout / driller notes', type: 'textarea', wide: true },
    ],
    lane: [
      { path: 'fitting.lane.preset', label: 'Oil pattern', type: 'select', wide: true, options: PATTERN_PRESETS.map((p) => ({ v: p.id, l: p.name })), hint: () => (PATTERN_PRESETS.find((p) => p.id === S.fitting.lane.preset) || {}).desc },
      { path: 'fitting.lane.lengthFt', label: 'Length (ft)', type: 'range', min: 20, max: 55, step: 1, show: () => S.fitting.lane.preset === 'custom' },
      { path: 'fitting.lane.volumeMl', label: 'Volume (mL)', type: 'range', min: 8, max: 40, step: 1, show: () => S.fitting.lane.preset === 'custom' },
      { path: 'fitting.lane.ratio', label: 'Ratio (middle : outside)', type: 'range', min: 1, max: 15, step: 0.5, show: () => S.fitting.lane.preset === 'custom' },
      { path: 'fitting.lane.shape', label: 'Shape', type: 'select', options: opt([['house', 'House (crowned)'], ['flat', 'Flat'], ['reverse', 'Reverse block']]), show: () => S.fitting.lane.preset === 'custom' },
      { path: 'fitting.lane.surface', label: 'Lane surface', type: 'select', options: Object.entries(SURFACES).map(([v, s]) => ({ v, l: s.label })) },
      { path: 'fitting.lane.games', label: 'Lane transition: games bowled', type: 'range', min: 0, max: 40, step: 1, hint: () => 'Oil breaks down where balls roll and carries down the lane.' },
      { path: 'fitting.lane.ballOil', label: 'Ball surface: clean -> oil-soaked', type: 'range', min: 0, max: 1, step: 0.05 },
    ],
  };
}

export function buildForm(container, defs, S, { onChange, bank, ctx = {} }) {
  container.textContent = '';
  const rows = [];
  const grid = h('div', { class: 'fgrid' });
  container.append(grid);

  const commit = (path, val, redraw = false) => {
    setPath(S, path, val);
    onChange(path, val);
    if (redraw) refresh();
  };

  for (const d of defs) {
    const wrap = h('div', { class: 'field' + (d.wide ? ' wide' : '') });
    const label = d.label ? h('label', null, d.label) : null;
    const hintEl = h('div', { class: 'hint' });
    let input, sync;
    const get = () => getPath(S, d.path);
    if (d.type === 'text' || d.type === 'tel' || d.type === 'email') {
      input = h('input', { type: d.type, placeholder: d.ph || '', autocomplete: 'off', oninput: (e) => commit(d.path, e.target.value) });
      sync = () => { if (document.activeElement !== input) input.value = get() ?? ''; };
    } else if (d.type === 'textarea') {
      input = h('textarea', { rows: 2, placeholder: d.ph || '', oninput: (e) => commit(d.path, e.target.value) });
      sync = () => { if (document.activeElement !== input) input.value = get() ?? ''; };
    } else if (d.type === 'number') {
      input = h('input', { type: 'number', min: d.min, max: d.max, step: d.step, inputmode: 'decimal', oninput: (e) => { const v = e.target.value === '' ? '' : +e.target.value; commit(d.path, v); } });
      sync = () => { if (document.activeElement !== input) input.value = get() ?? ''; };
    } else if (d.type === 'range') {
      const num = h('input', { type: 'number', min: d.min, max: d.max, step: d.step, class: 'rnum' });
      const rng = h('input', { type: 'range', min: d.min, max: d.max, step: d.step });
      rng.oninput = () => { num.value = rng.value; commit(d.path, +rng.value); };
      num.oninput = () => { if (num.value !== '') { rng.value = num.value; commit(d.path, +num.value); } };
      input = h('div', { class: 'rangebox' }, rng, num);
      sync = () => { const v = get(); rng.value = v; if (document.activeElement !== num) num.value = v; };
    } else if (d.type === 'len') {
      const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'len', autocomplete: 'off' });
      const step = (dir) => { const cur = +get() || 0; const v = Math.round((cur + dir / 16) * 16) / 16; commit(d.path, clampv(v, d)); inp.value = fmtLen(get(), ctx.unit()); };
      inp.onchange = () => { const v = parseLen(inp.value); if (!isNaN(v)) commit(d.path, clampv(v, d)); else if (inp.value.trim() === '') commit(d.path, ''); inp.value = fmtLen(get(), ctx.unit()); check(); };
      inp.onkeydown = (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); step(1); } if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); } };
      input = h('div', { class: 'lenbox' }, h('button', { type: 'button', class: 'step', 'aria-label': 'decrease 1/16', onclick: () => step(-1) }, '-'), inp, h('button', { type: 'button', class: 'step', 'aria-label': 'increase 1/16', onclick: () => step(1) }, '+'));
      sync = () => { if (document.activeElement !== inp) inp.value = fmtLen(get(), ctx.unit()); };
    } else if (d.type === 'select') {
      input = h('select', { onchange: (e) => commit(d.path, d.num ? +e.target.value : e.target.value, true) }, d.options.map((o) => h('option', { value: o.v }, o.l)));
      sync = () => { input.value = get(); };
    } else if (d.type === 'seg') {
      const btns = d.options.map((o) => h('button', { type: 'button', 'data-v': o.v, onclick: () => commit(d.path, o.v, true) }, o.l));
      input = h('div', { class: 'seg' }, btns);
      sync = () => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(get())));
    } else if (d.type === 'check') {
      input = h('input', { type: 'checkbox', onchange: (e) => commit(d.path, e.target.checked) });
      sync = () => { input.checked = !!get(); };
      wrap.classList.add('check');
    } else if (d.type === 'color') {
      input = h('input', { type: 'color', oninput: (e) => commit(d.path, e.target.value) });
      sync = () => { input.value = get() || '#0e7490'; };
    } else if (d.type === 'ballpick') {
      const sel = h('select', { onchange: (e) => ctx.pickBall(e.target.value) });
      sync = () => {
        const saved = bank.listBalls();
        sel.textContent = '';
        sel.append(h('option', { value: '' }, '- choose from library or edit fields below -'));
        sel.append(h('optgroup', { label: 'Generic archetypes' }, BALL_ARCHETYPES.map((b) => h('option', { value: b.id }, b.name))));
        if (saved.length) sel.append(h('optgroup', { label: 'Your ball library' }, saved.map((b) => h('option', { value: b.id }, `${b.brand ? b.brand + ' ' : ''}${b.name}`))));
        sel.value = get() || '';
      };
      const save = h('button', { type: 'button', class: 'btn small', onclick: () => ctx.saveBallToLibrary() }, 'Save to library');
      input = h('div', { class: 'ballpick' }, sel, save);
    } else if (d.type === 'layout') {
      input = ctx.layoutHost;
      sync = () => ctx.layoutRefresh?.();
    }
    const check = () => {
      if (d.typical) { const v = +get(); const bad = !isNaN(v) && get() !== '' && (v < d.typical[0] || v > d.typical[1]); wrap.classList.toggle('warn', bad); hintEl.textContent = bad ? `Unusual - typical range ${fmtLen(d.typical[0], ctx.unit())} to ${fmtLen(d.typical[1], ctx.unit())}. Double-check the measurement.` : (d.hint ? d.hint() || '' : ''); }
      else hintEl.textContent = d.hint ? d.hint() || '' : '';
    };
    wrap.append(...[label, input, hintEl].filter(Boolean));
    if (d.type === 'check') { wrap.textContent = ''; wrap.append(h('label', { class: 'chk' }, input, d.label)); }
    grid.append(wrap);
    rows.push({ d, wrap, sync, check });
    input.addEventListener?.('input', check);
    input.addEventListener?.('change', check);
  }
  function refresh() {
    for (const r of rows) {
      r.wrap.style.display = r.d.show && !r.d.show() ? 'none' : '';
      r.sync();
      r.check();
    }
  }
  refresh();
  return { refresh };
}
function clampv(v, d) { return Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, v)); }
export { STYLE_PRESETS };
