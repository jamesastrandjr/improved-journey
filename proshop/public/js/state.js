// Default data shapes + migration. Everything here is plain JSON so it can be stored as-is in the data bank.

export const SCHEMA_VERSION = 1;

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function defaultProfile() {
  return {
    name: '',
    phone: '',
    email: '',
    hand: 'R', // dominant throwing hand
    style: 'oneHand', // oneHand | twoHand
    average: '',
    yearsBowling: '',
    level: 'league', // casual | league | competitive | pro
    bodyWeightLb: '',
    league: '',
    goals: '',
    health: '',
    consent: false,
  };
}

export function defaultFitting() {
  return {
    v: SCHEMA_VERSION,
    label: '',
    hand: {
      gripType: 'conventional', // conventional | semi | fingertip
      span: 4.125,
      fingerSpacing: 1.0,
      bridge: 0.25,
      thumbHole: 1.0,
      middleHole: 0.8125,
      ringHole: 0.8125,
      thumbStyle: 'round', // round | ovalH | ovalV | slug | insert
      fingerPitchFwd: 0.0,
      fingerPitchLat: 0.0,
      thumbPitchRev: 0.125,
      thumbPitchLat: 0.0,
      handLength: '',
      palmWidth: '',
      notes: '',
    },
    delivery: {
      type: 'tweener', // stroker | tweener | cranker | twoHand | custom
      source: 'estimated', // estimated | measured
      speedMph: 17,
      revRpm: 380,
      axisTilt: 13,
      axisRotation: 58,
      papOver: 4.5,
      papUp: 0.75,
      loftFt: 3,
      startBoard: 15,
      targetBoard: 10,
      releasePhase: 0,
    },
    ball: {
      libId: 'a-pearl-asym',
      name: 'Pearl reactive - asymmetric (angular)',
      brand: 'Generic',
      weightLb: 15,
      cover: 'reactivePearl',
      grit: 3000,
      rg: 2.49,
      diff: 0.056,
      intDiff: 0.022,
      coreAzimuth: 0,
      color: '#c026d3',
    },
    layout: {
      pinDistance: 4.5,
      valAngle: 75,
      notes: '',
    },
    lane: {
      preset: 'house',
      lengthFt: 40,
      volumeMl: 24,
      ratio: 10,
      shape: 'house',
      taper: 0.5,
      surface: 'synthetic',
      games: 0,
      ballOil: 0,
    },
    ghosts: [],
    notes: '',
  };
}

/** typical delivery values by style. These are starting points for walk-ins that have not been measured. */
export const STYLE_PRESETS = {
  stroker: { speedMph: 17.5, revRpm: 270, axisTilt: 5, axisRotation: 74, papOver: 5.0, papUp: 0.25, startBoard: 20, targetBoard: 12 },
  tweener: { speedMph: 17, revRpm: 380, axisTilt: 13, axisRotation: 58, papOver: 4.5, papUp: 0.75, startBoard: 15, targetBoard: 10 },
  cranker: { speedMph: 16, revRpm: 460, axisTilt: 17, axisRotation: 50, papOver: 4.0, papUp: 1.25, startBoard: 12, targetBoard: 8 },
  twoHand: { speedMph: 17, revRpm: 480, axisTilt: 20, axisRotation: 38, papOver: 4.25, papUp: 1.5, startBoard: 15, targetBoard: 10 },
};

/** shallow-ish merge of stored data over defaults so older records keep working as fields are added */
export function migrateFitting(data) {
  const d = defaultFitting();
  const out = { ...d, ...(data || {}) };
  for (const k of ['hand', 'delivery', 'ball', 'layout', 'lane']) out[k] = { ...d[k], ...((data && data[k]) || {}) };
  out.ghosts = Array.isArray(out.ghosts) ? out.ghosts : [];
  out.v = SCHEMA_VERSION;
  return out;
}
export function migrateProfile(p) {
  return { ...defaultProfile(), ...(p || {}) };
}
