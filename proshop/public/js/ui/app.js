import { h, $, fmtLen, debounce } from './dom.js';
import { Bank } from '../bank.js';
import { defaultProfile, defaultFitting, migrateFitting, migrateProfile, STYLE_PRESETS, newId } from '../state.js';
import { buildConfig } from '../model.js';
import { simulate, indexAtFt } from '../physics/sim.js';
import { simulatePins, carryStats, entryFromRun } from '../physics/pins.js';
import { autoAim, POCKET_BOARD } from '../physics/analysis.js';
import { BALL_ARCHETYPES, buildBall, gripBuffer } from '../physics/ball.js';
import { FT, MPH } from '../physics/units.js';
import { sections, buildForm } from './form.js';
import { createLayoutDiagram, drawLayout } from './layoutDiagram.js';
import { BallRenderer } from './ballView.js';
import { LaneView, PinView, GHOST_COLORS } from './laneView.js';
import { lineChart } from './charts.js';
import { advise } from '../advice.js';

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

export function start() {
  const bank = new Bank();
  const S = { profile: defaultProfile(), fitting: defaultFitting(), clientId: null, fittingId: null };
  const UI = { unit: store('lanelab.unit') || 'in', speed: 0.5, t: 0, playing: false, pinK: 0, pinSeed: 1, dirty: false };
  let run = null, cfg = null, pinRun = null, carry = null;
  const tabs = ['client', 'grip', 'delivery', 'ball'];
  let tab = 'client';

  // ---------- DOM refs ----------
  const R = {}; document.querySelectorAll('[id]').forEach((e) => { R[e.id] = e; });
  document.documentElement.dataset.theme = store('lanelab.theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const ballR = new BallRenderer(170);
  const laneV = new LaneView(R.laneCanvas, ballR);
  const pinV = new PinView(R.pinCanvas);
  const ballCanvasCtx = R.ballCanvas.getContext('2d');

  // ---------- form construction ----------
  const defs = sections(S, bank);
  const layoutHost = h('div', { class: 'layouthost' });
  const ctx = {
    unit: () => UI.unit, layoutHost,
    pickBall: (id) => pickBall(id),
    saveBallToLibrary: () => { const b = { ...S.fitting.ball }; delete b.libId; const rec = bank.putBall({ ...b, id: S.fitting.ball.libId && bank.db.balls[S.fitting.ball.libId] ? S.fitting.ball.libId : undefined }); S.fitting.ball.libId = rec.id; forms.ball.refresh(); toast('Ball saved to your library'); },
    layoutRefresh: () => layout?.refresh(),
  };
  let layout;
  const forms = {};
  const onChange = (path) => {
    if (path === 'fitting.delivery.type') applyStyle();
    else if (path.startsWith('fitting.delivery.') && !['type', 'source'].includes(path.split('.').pop()) && S.fitting.delivery.type !== 'custom' && !['startBoard', 'targetBoard', 'loftFt'].includes(path.split('.').pop())) { S.fitting.delivery.type = 'custom'; S.fitting.delivery.source = 'measured'; }
    if (path === 'profile.style' && S.profile.style === 'twoHand' && S.fitting.delivery.type !== 'twoHand') { S.fitting.delivery.type = 'twoHand'; applyStyle(); forms.delivery?.refresh(); }
    if (path === 'profile.hand') laneV.hand = S.profile.hand;
    UI.dirty = true; scheduleSim(); scheduleSave(); updateChips();
    if (path.includes('delivery.pap') || path.includes('layout.') || path.includes('ball.color') || path.includes('hand.')) layout?.refresh();
    Object.values(forms).forEach((f) => f.refresh());
  };
  function applyStyle() {
    const pr = STYLE_PRESETS[S.fitting.delivery.type]; if (!pr) return;
    Object.assign(S.fitting.delivery, pr); S.fitting.delivery.source = 'estimated';
    forms.delivery?.refresh(); layout?.refresh();
  }
  function pickBall(id) {
    const b = BALL_ARCHETYPES.find((x) => x.id === id) || bank.db.balls[id]; if (!b) return;
    const keep = S.fitting.ball.weightLb;
    Object.assign(S.fitting.ball, { libId: id, name: b.name, brand: b.brand || '', cover: b.cover, grit: b.grit, rg: b.rg, diff: b.diff, intDiff: b.intDiff, color: b.color || '#0e7490', weightLb: b.weightLb && b.id !== undefined && bank.db.balls[id] ? b.weightLb : keep });
    onChange('fitting.ball.libId');
  }
  function buildAllForms() {
    const d = sections(S, bank);
    layout = null; layoutHost.textContent = '';
    forms.client = buildForm(R.formClient, d.client, S, { onChange, bank, ctx });
    forms.grip = buildForm(R.formGrip, d.grip, S, { onChange, bank, ctx });
    forms.delivery = buildForm(R.formDelivery, d.delivery, S, { onChange, bank, ctx });
    forms.ball = buildForm(R.formBall, d.ball, S, { onChange, bank, ctx });
    forms.lane = buildForm(R.formLane, d.lane, S, { onChange, bank, ctx });
    layout = createLayoutDiagram(layoutHost, S, onChange, () => UI.unit);
  }
  R.tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
  function setTab(t) { tab = t; R.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); R.formPanes.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t)); }

  // ---------- simulation ----------
  const scheduleSim = debounce(() => simulateNow(false), 90);
  function simulateNow(animate) {
    cfg = buildConfig(S.profile, S.fitting);
    run = simulate(cfg);
    ballR.setSpec(S, cfg.ball);
    laneV.hand = S.profile.hand;
    laneV.set(run, cfg.lane, cfg, S.profile.hand, ghostsToDraw());
    pinRun = null; carry = null;
    if (run.status === 'pins') pinRun = simulatePins(entryFromRun(run), cfg.ball.massKg, UI.pinSeed, true);
    pinV.load(null, S.profile.hand); pinV.draw(0);
    UI.pinK = 0;
    renderMetrics(); renderCharts(); renderAdvice();
    if (animate) { UI.t = 0; UI.playing = true; } else { UI.t = run.samples.t[run.samples.n - 1]; UI.playing = false; if (pinRun) { pinV.load(pinRun.frames, S.profile.hand); UI.pinK = pinRun.frames.length - 1; } }
    R.timeline.max = String(Math.round(run.samples.t[run.samples.n - 1] * 1000));
    clearTimeout(simulateNow._c); simulateNow._c = setTimeout(computeCarry, 500);
    kick();
  }
  function computeCarry() {
    if (!run || run.status !== 'pins') { R.carryBox.textContent = '—'; return; }
    carry = carryStats(entryFromRun(run), cfg.ball.massKg, 24);
    R.carryBox.innerHTML = `<b>${carry.strikePct.toFixed(0)}%</b> strike odds · avg ${carry.avgPins.toFixed(1)} pins` + (carry.top.length ? `<div class="sub">Common leaves: ${carry.top.map((t) => `${t.leave} (${t.pct.toFixed(0)}%)`).join(', ')}</div>` : '');
  }
  function ghostsToDraw() { return (S.fitting.ghosts || []).map((g, i) => ({ ...g, color: GHOST_COLORS[i % 3] })); }

  // ---------- animation ----------
  let raf = 0, last = 0;
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now) {
    raf = 0; if (!run) return;
    const dt = (now - last) / 1000; last = now;
    const end = run.samples.t[run.samples.n - 1];
    if (UI.playing) {
      UI.t += dt * UI.speed;
      if (UI.t >= end) { UI.t = end; UI.playing = false; if (pinRun) { pinV.load(pinRun.frames, S.profile.hand); UI.pinK = 0; UI.pinPlay = true; } }
    }
    if (UI.pinPlay && pinRun) { UI.pinK += Math.max(1, Math.round(dt * 60 * UI.speed * 2)); if (UI.pinK >= pinRun.frames.length - 1) { UI.pinK = pinRun.frames.length - 1; UI.pinPlay = false; showLeave(); } }
    laneV.draw(UI.t); pinV.draw(UI.pinK);
    const i = Math.min(run.samples.n - 1, laneV.idx(UI.t)); drawBall(i); R.timeline.value = String(Math.round(UI.t * 1000));
    const s = run.samples; R.live.textContent = `${(s.y[i] / FT).toFixed(0)} ft · board ${(s.u[i] + 0.5).toFixed(1)} · ${(Math.hypot(s.vx[i], s.vy[i]) / MPH).toFixed(1)} mph · ${s.rev[i].toFixed(0)} rpm · slip ${s.slip[i].toFixed(1)} m/s`;
    if (UI.playing || UI.pinPlay) raf = requestAnimationFrame(frame);
  }
  function drawBall(i) {
    const s = run.samples; const q = [s.q[i * 4], s.q[i * 4 + 1], s.q[i * 4 + 2], s.q[i * 4 + 3]];
    const cv = ballR.render(q, run.oilMap, { pitch: 0.35, mirror: S.profile.hand === 'L' });
    const c = ballCanvasCtx; c.clearRect(0, 0, 170, 170); c.drawImage(cv, 0, 0);
  }
  function showLeave() { R.leave.textContent = pinRun.strike ? 'STRIKE!' : `${pinRun.down} pins · leave ${pinRun.leave}`; R.leave.className = 'leave ' + (pinRun.strike ? 'strike' : ''); }
  function throwBall() { UI.pinSeed = (Math.random() * 1e9) | 0; simulateNow(true); R.leave.textContent = ''; }

  // ---------- metrics / charts / advice ----------
  function renderMetrics() {
    const m = run.metrics, pins = run.status === 'pins';
    const card = (k, v, sub, cls = '') => h('div', { class: 'card ' + cls }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 'sub' }, sub) : null);
    const miss = m.entryBoard - POCKET_BOARD;
    const statusTxt = { pins: '', gutterOwn: 'Gutter (own side)', gutterFar: 'Gutter (over-hooked)', stalled: 'Stalled', timeout: 'Timed out' }[run.status];
    R.metrics.textContent = '';
    R.metrics.append(
      card('Entry board', pins ? m.entryBoard.toFixed(1) : '—', pins ? (Math.abs(miss) <= 1 ? 'in the pocket' : miss > 0 ? 'high' : 'light') : statusTxt, pins && Math.abs(miss) <= 1 ? 'good' : ''),
      card('Entry angle', pins ? m.entryAngle.toFixed(1) + '°' : '—', 'goal 4–7°', pins && m.entryAngle >= 4 && m.entryAngle <= 7.5 ? 'good' : ''),
      card('Breakpoint', `b${m.breakBoard.toFixed(1)}`, `at ${m.breakFt.toFixed(0)} ft`),
      card('Total hook', pins ? m.totalHook.toFixed(1) + ' bd' : '—', 'break → entry'),
      card('Skid / Hook / Roll', `${m.skidFt.toFixed(0)} / ${m.hookFt.toFixed(0)} / ${m.rollFt.toFixed(0)}`, 'ft where each phase ends'),
      card('Speed at pins', m.pinSpeedMph.toFixed(1) + ' mph', `−${m.speedLossPct.toFixed(0)}% from release`),
      card('Flare', m.flareIn.toFixed(1) + '"', 'axis migration'),
      card('Backend angle', m.backendAngle.toFixed(1) + '°', `max turn in 10 ft @ ${m.backendStartFt.toFixed(0)} ft`),
    );
    const bar = (label, val, max) => h('div', { class: 'rbar' }, h('span', null, label), h('i', null, h('b', { style: { width: Math.max(2, Math.min(100, (val / max) * 100)) + '%' } })));
    R.rating.textContent = ''; R.rating.append(bar('Length', m.skidFt, 45), bar('Hook', Math.abs(m.totalTurn), 14), bar('Angularity', m.backendAngle, 8), bar('Flare', m.flareIn, 8));
    R.titleLine.textContent = `${S.fitting.ball.name || 'Ball'} · ${S.fitting.ball.weightLb} lb · ${cfg.lane.pattern.lengthFt ? cfg.lane.pattern.lengthFt + ' ft pattern' : 'dry lane'}`;
  }
  function renderCharts() {
    const s = run.samples; const ft = Array.from(s.y, (v) => v / FT);
    lineChart(R.chart1, ft, [{ y: Array.from(s.u, (u) => u + 0.5), color: '#38bdf8', label: 'board' }], { marks: [{ x: run.metrics.skidFt, color: '#fb923c' }, { x: run.metrics.rollFt, color: '#4ade80' }], xMax: 60 });
    lineChart(R.chart2, ft, [{ y: Array.from(s.vy, (v) => Math.hypot(v, 0) / MPH), color: '#fbbf24', axis: 0 }, { y: s.rev, color: '#f472b6', axis: 1 }], { xMax: 60 });
    lineChart(R.chart3, ft, [{ y: s.mu, color: '#ef4444', axis: 0 }, { y: s.slip, color: '#a78bfa', axis: 1 }], { xMax: 60 });
  }
  function renderAdvice() {
    const list = advise(S, run, cfg.ball); R.advice.textContent = '';
    for (const a of list) R.advice.append(h('li', { class: a.level }, h('b', null, a.title + ': '), a.text));
    if (!list.length) R.advice.append(h('li', { class: 'info' }, 'No flags.'));
  }

  // ---------- toolbar actions ----------
  R.btnThrow.onclick = throwBall;
  R.btnAim.onclick = () => {
    R.btnAim.disabled = true; R.btnAim.textContent = 'Aiming…';
    setTimeout(() => {
      const res = autoAim((t) => buildConfig(S.profile, S.fitting, { delivery: { targetBoard: t } }), S.fitting.delivery.startBoard);
      R.btnAim.disabled = false; R.btnAim.textContent = 'Auto-aim to pocket';
      if (!res) { toast('No line from this start board reaches the pocket on this condition.', true); return; }
      S.fitting.delivery.targetBoard = res.target; forms.delivery.refresh(); onChange('fitting.delivery.targetBoard'); throwBall(); toast(`Target ${res.target} at the arrows puts it in the pocket`);
    }, 20);
  };
  R.btnPin.onclick = () => {
    if (!run) return; const g = S.fitting.ghosts; if (g.length >= 3) g.shift();
    const s = run.samples; const path = []; for (let i = 0; i < s.n; i += 3) path.push([s.u[i] + 0.5 - 0.5, s.y[i] / FT]);
    g.push({ label: `${S.fitting.ball.name} (${S.fitting.lane.preset})`, path, entry: run.metrics.entryBoard, angle: run.metrics.entryAngle });
    laneV.ghosts = ghostsToDraw(); renderGhosts(); UI.dirty = true; scheduleSave(); laneV.draw(UI.t);
  };
  R.btnClearGhosts.onclick = () => { S.fitting.ghosts = []; laneV.ghosts = []; renderGhosts(); scheduleSave(); laneV.draw(UI.t); };
  function renderGhosts() { R.ghosts.textContent = ''; S.fitting.ghosts.forEach((g, i) => R.ghosts.append(h('span', { class: 'chip', style: { borderColor: GHOST_COLORS[i % 3] } }, `${g.label} → b${g.entry.toFixed(1)} / ${g.angle.toFixed(1)}°`))); }
  R.viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; laneV.mode = b.dataset.v; R.viewSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); laneV.draw(UI.t); });
  R.heatSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; laneV.heat = b.dataset.v; laneV._heatKey = ''; R.heatSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); laneV.draw(UI.t); });
  R.speedSel.onchange = () => { UI.speed = +R.speedSel.value; };
  R.timeline.oninput = () => { UI.playing = false; UI.t = +R.timeline.value / 1000; UI.pinPlay = false; laneV.draw(UI.t); drawBall(Math.min(run.samples.n - 1, laneV.idx(UI.t))); };
  R.btnPlay.onclick = () => { if (UI.playing) { UI.playing = false; } else { if (UI.t >= run.samples.t[run.samples.n - 1] - 0.01) UI.t = 0; UI.playing = true; kick(); } };
  R.btnLayoutLab.onclick = () => layoutLab();
  window.addEventListener('resize', debounce(() => { if (run) { renderCharts(); laneV.draw(UI.t); } }, 120));

  // ---------- layout lab ----------
  async function layoutLab() {
    const box = R.labResults; box.textContent = 'Testing layouts…'; R.labDlg.showModal();
    const base = JSON.parse(JSON.stringify(S.fitting)); const asym = base.ball.intDiff > 0.004;
    const pins = [2.5, 3.25, 4, 4.75, 5.5], cores = asym ? [0, 45, 90] : [0]; const rows = []; const total = pins.length * cores.length;
    for (const pd of pins) for (const ca of cores) {
      await new Promise((r) => setTimeout(r, 0));
      // choose the VAL (nearest the current one) that keeps a healthy pin buffer
      let va = null; for (const cand of [base.layout.valAngle, ...[75, 90, 60, 105, 45, 120, 30, 135, 15, 150].filter((v) => v !== base.layout.valAngle)]) if (gripBuffer(S, pd, cand) >= 1) { va = cand; break; }
      if (va == null) { rows.push({ ok: false }); continue; }
      const mk = (t) => buildConfig(S.profile, base, { layout: { pinDistance: pd, valAngle: va }, ball: { coreAzimuth: ca }, delivery: { targetBoard: t } });
      const aim = autoAim(mk, base.delivery.startBoard, { step: 3 });
      if (!aim) { rows.push({ ok: false }); continue; }
      const m = simulate(mk(aim.target), { dt: 0.001, recordEvery: 8 }).metrics;
      rows.push({ pd, va, ca, ok: true, target: aim.target, angle: m.entryAngle, flare: m.flareIn, bp: m.breakFt, bb: m.breakBoard });
      box.textContent = `Testing layouts… ${rows.length}/${total}`;
    }
    const good = rows.filter((r) => r.ok).sort((a, b) => Math.abs(a.angle - 6) - Math.abs(b.angle - 6));
    box.textContent = '';
    box.append(h('p', { class: 'muted' }, `Each layout is thrown on the current lane with Auto-aim to the pocket from start board ${base.delivery.startBoard}, ranked by entry angle closest to 6°. VAL is auto-chosen to keep at least 1" of pin buffer.${asym ? '' : ' (This ball is symmetric, so core orientation is not scanned.)'}`));
    const tb = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Pin–PAP', 'Core', 'VAL', 'Target', 'Break', 'Entry angle', 'Flare', ''].map((t) => h('th', null, t)))));
    const body = h('tbody'); tb.append(body);
    for (const r of good.slice(0, 12)) body.append(h('tr', null, h('td', null, fmtLen(r.pd, UI.unit)), h('td', null, r.ca + '°'), h('td', null, r.va + '°'), h('td', null, r.target), h('td', null, `b${r.bb.toFixed(0)} @ ${r.bp.toFixed(0)}ft`), h('td', null, r.angle.toFixed(1) + '°'), h('td', null, r.flare.toFixed(1) + '"'), h('td', null, h('button', { class: 'btn small', onclick: () => { S.fitting.layout.pinDistance = r.pd; S.fitting.layout.valAngle = r.va; S.fitting.ball.coreAzimuth = r.ca; S.fitting.delivery.targetBoard = r.target; R.labDlg.close(); forms.ball.refresh(); forms.delivery.refresh(); onChange('fitting.layout.pinDistance'); } }, 'Apply'))));
    box.append(good.length ? tb : h('p', null, 'No tested layout reached the pocket from this start board.'));
  }

  // ---------- persistence ----------
  function results() { const m = run?.metrics; return m ? { entryBoard: +m.entryBoard.toFixed(1), entryAngle: +m.entryAngle.toFixed(1), breakBoard: +m.breakBoard.toFixed(1), breakFt: +m.breakFt.toFixed(0), flareIn: +m.flareIn.toFixed(1), pinSpeedMph: +m.pinSpeedMph.toFixed(1), status: run.status } : null; }
  function saveNow() {
    if (!UI.dirty) return;
    const blank = !S.profile.name && !S.clientId && JSON.stringify(S.fitting) === JSON.stringify(UI.pristine);
    if (blank) return;
    const now = bank.getClient(S.clientId);
    const crec = bank.putClient({ id: S.clientId || undefined, createdAt: now?.createdAt, profile: { ...S.profile } });
    S.clientId = crec.id;
    const old = bank.getFitting(S.fittingId);
    const frec = bank.putFitting({ id: S.fittingId || undefined, createdAt: old?.createdAt, clientId: crec.id, label: S.fitting.label || '', data: JSON.parse(JSON.stringify(S.fitting)), results: results() });
    S.fittingId = frec.id; UI.dirty = false; store('lanelab.last', JSON.stringify({ c: S.clientId, f: S.fittingId }));
    R.saveState.dataset.s = 'saved'; setSaveText();
    updateChips();
  }
  const saveDebounced = debounce(saveNow, 700);
  function scheduleSave() { R.saveState.dataset.s = 'saving'; R.saveText.textContent = 'Saving…'; saveDebounced(); }
  function setSaveText() {
    const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const where = bank.mode === 'online' ? 'saved to data bank' : bank.mode === 'offline' ? 'saved on this device — will sync' : 'saved in this browser';
    if (R.saveState.dataset.s === 'saving') return;
    R.saveText.textContent = `${S.profile.name || 'Unnamed'} · ${where} ${t}`;
  }
  bank.on((mode, pending) => { R.bankMode.dataset.m = mode; R.bankMode.textContent = mode === 'online' ? 'Server connected' : mode === 'offline' ? `Offline (${pending} queued)` : 'Browser storage'; if (R.saveState.dataset.s !== 'saving') setSaveText(); });
  window.addEventListener('beforeunload', () => saveDebounced.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveDebounced.flush(); });

  function updateChips() { R.clientChip.textContent = S.profile.name || 'New client'; }
  function loadFitting(clientId, fittingId) {
    const c = bank.getClient(clientId); if (!c) return;
    const f = bank.getFitting(fittingId) || bank.listFittings(clientId)[0];
    S.clientId = c.id; S.profile = migrateProfile(c.profile); S.fitting = f ? migrateFitting(f.data) : defaultFitting(); S.fittingId = f ? f.id : null;
    afterLoad();
  }
  function newClient() {
    saveDebounced.flush(); S.clientId = null; S.fittingId = null; S.profile = defaultProfile(); S.fitting = defaultFitting(); afterLoad(); setTab('client');
  }
  function newFitting() { saveDebounced.flush(); const keep = S.clientId; S.fittingId = null; S.fitting = defaultFitting(); S.fitting.hand = { ...S.fitting.hand }; afterLoad(); UI.dirty = true; if (keep) saveNow(); }
  function afterLoad() {
    UI.pristine = JSON.parse(JSON.stringify(defaultFitting())); UI.dirty = false;
    for (const k of Object.keys(S)) {} 
    Object.assign(defs, {}); buildAllForms(); renderGhosts(); updateChips(); simulateNow(true); setSaveText(); R.saveState.dataset.s = 'saved';
  }

  // ---------- data bank dialog ----------
  function renderBank() {
    const q = R.bankSearch.value; const list = bank.listClients(q); R.clientList.textContent = '';
    if (!list.length) R.clientList.append(h('p', { class: 'muted' }, q ? 'No matches.' : 'No saved clients yet. Fill in the form and it saves itself.'));
    for (const c of list) {
      const row = h('div', { class: 'crow' + (c.id === S.clientId ? ' cur' : '') },
        h('div', { class: 'cmain', onclick: () => { loadFitting(c.id); R.bankDlg.close(); } }, h('b', null, c.profile.name || 'Unnamed'), h('span', { class: 'muted' }, ` ${c.profile.phone || ''} ${c.profile.email || ''}`), h('div', { class: 'muted small' }, `${c.fittingCount} fitting${c.fittingCount === 1 ? '' : 's'} · updated ${new Date(c.updatedAt).toLocaleDateString()}`)),
        h('button', { class: 'btn small danger', onclick: () => { if (confirm(`Delete ${c.profile.name || 'this client'} and all their fittings?`)) { bank.deleteClient(c.id); if (c.id === S.clientId) newClient(); renderBank(); } } }, 'Delete'));
      R.clientList.append(row);
      if (c.id === S.clientId) for (const f of bank.listFittings(c.id)) R.clientList.append(h('div', { class: 'frow' + (f.id === S.fittingId ? ' cur' : ''), onclick: () => { loadFitting(c.id, f.id); R.bankDlg.close(); } }, `${new Date(f.updatedAt).toLocaleString()} · ${f.data?.ball?.name || ''} ${f.results ? `· entry b${f.results.entryBoard}, ${f.results.entryAngle}°` : ''}`));
    }
    R.ballList.textContent = '';
    const balls = bank.listBalls(); if (!balls.length) R.ballList.append(h('p', { class: 'muted' }, 'No custom balls yet - use "Save this ball to library" on the Ball tab.'));
    for (const b of balls) R.ballList.append(h('div', { class: 'crow' }, h('div', { class: 'cmain', onclick: () => { pickBall(b.id); R.bankDlg.close(); setTab('ball'); } }, h('b', null, `${b.brand || ''} ${b.name}`), h('span', { class: 'muted small' }, ` RG ${b.rg} · diff ${b.diff} · int ${b.intDiff}`)), h('button', { class: 'btn small danger', onclick: () => { bank.deleteBall(b.id); renderBank(); } }, 'Remove')));
    R.bankStatus.textContent = bank.mode === 'online' ? 'Connected to the LaneLab server — every save is also written to the SQLite database.' : bank.mode === 'offline' ? `Server unreachable — ${bank.outbox.length} change(s) queued and will sync automatically.` : 'Data is stored in this browser (localStorage). Run the LaneLab server to also keep it in a shared SQLite database — see README.';
  }
  R.btnBank.onclick = () => { saveDebounced.flush(); renderBank(); R.bankDlg.showModal(); };
  R.bankSearch.oninput = renderBank;
  R.btnNewClient.onclick = () => { newClient(); R.bankDlg.close(); };
  R.btnNewFitting.onclick = () => { newFitting(); R.bankDlg.close(); toast('Started a new fitting for this client'); };
  const download = (name, text, type) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
  R.btnExport.onclick = () => download(`lanelab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bank.exportAll(), null, 1), 'application/json');
  R.btnCsv.onclick = () => download('lanelab-clients.csv', bank.clientsCsv(), 'text/csv');
  R.fileImport.onchange = async () => { try { const f = R.fileImport.files[0]; const n = bank.importAll(JSON.parse(await f.text())); toast(`Imported ${n} record(s)`); renderBank(); } catch (e) { toast('Import failed: ' + e.message, true); } R.fileImport.value = ''; };
  R.btnToken.onclick = () => { const t = prompt('Server access token (LANELAB_TOKEN):', bank.token || ''); if (t != null) { bank.token = t; store('lanelab.token', t); bank.connect(); } };

  // ---------- header buttons ----------
  R.btnTheme.onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store('lanelab.theme', t); renderCharts(); laneV.draw(UI.t); };
  R.btnUnit.onclick = () => { UI.unit = UI.unit === 'in' ? 'mm' : 'in'; store('lanelab.unit', UI.unit); R.btnUnit.textContent = UI.unit; Object.values(forms).forEach((f) => f.refresh()); layout.refresh(); };
  R.btnUnit.textContent = UI.unit;
  R.btnPrint.onclick = () => { saveDebounced.flush(); buildSheet(); setTimeout(() => window.print(), 50); };

  function buildSheet() {
    const f = S.fitting, p = S.profile, hnd = f.hand, d = f.delivery, L = fmtLen, u = UI.unit;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const geo = drawLayout(svg, S, { mono: true });
    const row = (k, v) => h('tr', null, h('th', null, k), h('td', null, v ?? ''));
    R.sheet.textContent = '';
    R.sheet.append(
      h('h1', null, 'Ball Drilling Work Order'), h('div', { class: 'sub' }, `Date ${new Date().toLocaleDateString()} · ${p.name || 'Unnamed'} · ${p.phone || ''} ${p.email || ''}`),
      h('div', { class: 'cols' },
        h('div', null, h('h2', null, 'Grip'), h('table', null, row('Hand', p.hand === 'R' ? 'Right' : 'Left'), row('Grip type', hnd.gripType), row('Span', L(hnd.span, u)), row('Finger spacing (c-c)', L(hnd.fingerSpacing, u)), row('Bridge', L(hnd.bridge, u)), row('Middle hole', L(hnd.middleHole, u)), row('Ring hole', L(hnd.ringHole, u)), p.style === 'twoHand' ? null : row('Thumb hole', `${L(hnd.thumbHole, u)} (${hnd.thumbStyle})`), row('Finger pitch fwd / lat', `${L(hnd.fingerPitchFwd, u)} / ${L(hnd.fingerPitchLat, u)}`), p.style === 'twoHand' ? null : row('Thumb pitch rev / lat', `${L(hnd.thumbPitchRev, u)} / ${L(hnd.thumbPitchLat, u)}`)),
          h('h2', null, 'Layout'), h('table', null, row('PAP over / up', `${L(d.papOver, u)} / ${L(d.papUp, u)}`), row('Pin to PAP', L(f.layout.pinDistance, u)), row('VAL angle', f.layout.valAngle + '°'), row('Pin buffer', L(Math.max(0, geo.buffer), u)), row('Axis tilt / rotation', `${d.axisTilt}° / ${d.axisRotation}°`), row('Rev / speed', `${d.revRpm} rpm / ${d.speedMph} mph (${d.source})`))),
        h('div', null, h('h2', null, 'Ball'), h('table', null, row('Ball', `${f.ball.brand} ${f.ball.name}`), row('Weight', f.ball.weightLb + ' lb'), row('RG / Diff / Int', `${f.ball.rg} / ${f.ball.diff} / ${f.ball.intDiff}`), row('Surface', f.ball.grit >= 10000 ? 'Polished' : f.ball.grit + ' grit')), svg)),
      h('h2', null, 'Notes'), h('p', null, [p.goals, p.health, hnd.notes, f.layout.notes].filter(Boolean).join(' · ') || '—'),
      h('div', { class: 'sig' }, h('span', null, 'Driller signature'), h('span', null, 'Customer signature')));
  }

  // ---------- toast ----------
  function toast(msg, bad) { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); R.toasts.append(t); setTimeout(() => t.remove(), 3800); }

  // ---------- boot ----------
  setTab('client');
  const lastRaw = store('lanelab.last'); let lastSel = null; try { lastSel = JSON.parse(lastRaw); } catch { /* none */ }
  UI.pristine = JSON.parse(JSON.stringify(defaultFitting()));
  buildAllForms(); renderGhosts();
  if (lastSel && bank.getClient(lastSel.c)) loadFitting(lastSel.c, lastSel.f); else { updateChips(); simulateNow(true); }
  bank.connect().then(() => { setSaveText();  });
  R.saveState.dataset.s = 'saved'; setSaveText();
  window.__lanelab = { S, bank, get run() { return run; }, simulateNow };
}
