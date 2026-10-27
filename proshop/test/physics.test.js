import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFitting, defaultProfile } from '../public/js/state.js';
import { buildConfig } from '../public/js/model.js';
import { simulate } from '../public/js/physics/sim.js';
import { simulatePins, carryStats } from '../public/js/physics/pins.js';
import { autoAim, POCKET_BOARD } from '../public/js/physics/analysis.js';
import { HEAD_PIN_Y, BALL_R, PIN_R, HALF_W, BOARD_W, LB } from '../public/js/physics/units.js';
import { fmtLen, parseLen } from '../public/js/ui/dom.js';

const prof = defaultProfile();
const run = (mut, o) => { const f = defaultFitting(); mut?.(f); return simulate(buildConfig(prof, f, o)); };

test('ball reaches the pins, loses some speed, hooks toward the lane centre', () => {
  const r = run((f) => { f.delivery.targetBoard = 9; });
  assert.equal(r.status, 'pins');
  const m = r.metrics;
  assert.ok(m.pinSpeedMph < 17 && m.pinSpeedMph > 12, `pin speed ${m.pinSpeedMph}`);
  assert.ok(m.entryBoard > m.breakBoard + 5, 'hooks inward after the breakpoint');
  assert.ok(m.rollFt > m.skidFt, 'skid ends before roll');
});

test('more revs hook more; dry lane hooks earlier; plastic hooks less', () => {
  const base = run((f) => { f.delivery.targetBoard = 11; }).metrics;
  const revs = run((f) => { f.delivery.targetBoard = 11; f.delivery.revRpm = 520; }).metrics;
  assert.ok(revs.totalTurn > base.totalTurn, 'higher revs -> more heading change');
  const dry = run((f) => { f.delivery.targetBoard = 11; f.lane.preset = 'dry'; }).metrics;
  assert.ok(dry.skidFt < base.skidFt, 'dry lane skids less');
  const plastic = run((f) => { f.delivery.targetBoard = 11; Object.assign(f.ball, { cover: 'plastic', grit: 4000, diff: 0.01, intDiff: 0 }); }).metrics;
  assert.ok(plastic.totalTurn < base.totalTurn, 'plastic turns less');
});

test('symmetric ball with zero differential does not flare; asymmetric does', () => {
  const none = run((f) => Object.assign(f.ball, { diff: 0, intDiff: 0 }));
  const some = run((f) => Object.assign(f.ball, { diff: 0.056, intDiff: 0.022 }));
  assert.ok(none.metrics.flareIn < 0.5, `flare ${none.metrics.flareIn}`);
  assert.ok(some.metrics.flareIn > 2, `flare ${some.metrics.flareIn}`);
});

test('angular momentum is conserved when friction is switched off (rigid-body integrator check)', () => {
  const f = defaultFitting(); const cfg = buildConfig(prof, f);
  cfg.ball.muDry = 0; cfg.ball.muOil = 0; cfg.lane.surfaceDry = 0;
  const r = simulate(cfg); const s = r.samples;
  const speed = (i) => Math.hypot(s.vx[i], s.vy[i]);
  assert.ok(Math.abs(speed(s.n - 1) - speed(0)) < 0.02, 'no friction -> constant speed');
  assert.ok(Math.abs(s.rev[s.n - 1] - s.rev[0]) / s.rev[0] < 0.01, 'rev rate stays constant (energy conserved)');
});

test('left-hander is the exact mirror of a right-hander', () => {
  const a = run(null).metrics; const f = defaultFitting();
  const b = simulate(buildConfig({ ...prof, hand: 'L' }, f)).metrics;
  assert.ok(Math.abs(a.entryBoard - b.entryBoard) < 1e-6);
});

test('auto-aim finds a pocket line', () => {
  const f = defaultFitting();
  const res = autoAim((t) => buildConfig(prof, f, { delivery: { targetBoard: t } }), f.delivery.startBoard);
  assert.ok(res, 'line found');
  const r = simulate(buildConfig(prof, f, { delivery: { targetBoard: res.target } }));
  assert.ok(Math.abs(r.metrics.entryBoard - POCKET_BOARD) < 0.6);
});

test('pin deck: pocket hit strikes far more often than a thin hit', () => {
  const shot = (board) => {
    const a = (5.5 * Math.PI) / 180; const y0 = HEAD_PIN_Y - (BALL_R + PIN_R);
    const xh = HALF_W - (board - 0.5) * BOARD_W;
    return carryStats({ x: xh + Math.tan(a) * (HEAD_PIN_Y - y0), y: y0, vx: -6.8 * Math.sin(a), vy: 6.8 * Math.cos(a) }, 15 * LB, 30).strikePct;
  };
  assert.ok(shot(17.5) > 80);
  assert.ok(shot(13) < 20);
});

test('fraction parsing round-trips', () => {
  assert.equal(parseLen('4 1/8'), 4.125);
  assert.equal(parseLen('4-1/8"'), 4.125);
  assert.equal(parseLen('1/4'), 0.25);
  assert.ok(Math.abs(parseLen('105mm') - 4.1339) < 1e-3);
  assert.equal(fmtLen(4.125), '4 1/8"');
  assert.equal(fmtLen(0.8125), '13/16"');
});
