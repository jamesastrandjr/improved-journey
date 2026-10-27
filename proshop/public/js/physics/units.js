// Unit conversions and fixed geometry. All physics runs in SI (m, kg, s, rad).

export const IN = 0.0254;
export const FT = 0.3048;
export const LB = 0.45359237;
export const MPH = 0.44704;
export const RPM = (2 * Math.PI) / 60;
export const G = 9.80665;

export const BALL_R = 4.25 * IN; // 8.5 in max diameter

// Lane: 39 boards, 41.5 in wide, 60 ft foul line -> head pin
export const BOARDS = 39;
export const LANE_W = 41.5 * IN;
export const HALF_W = LANE_W / 2;
export const BOARD_W = LANE_W / BOARDS;
export const HEAD_PIN_Y = 60 * FT;
export const ARROWS_FT = 15;

// Pins
export const PIN_R = 2.383 * IN; // base footprint radius used for the circle model
export const PIN_M = 1.55;
export const PIN_ROW = 10.392 * IN;
export const PIN_COL = 6 * IN;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** continuous board coordinate u (0 = own gutter edge, 39 = far edge) -> metres from lane centre (+ = bowler's right edge side for a righty) */
export const uToX = (u) => HALF_W - u * BOARD_W;
export const xToU = (x) => (HALF_W - x) / BOARD_W;
/** board number (1..39) <-> continuous u at the centre of that board */
export const boardToU = (b) => b - 0.5;
export const uToBoard = (u) => u + 0.5;

export const mphToMs = (v) => v * MPH;
export const msToMph = (v) => v / MPH;
