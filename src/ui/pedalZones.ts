/**
 * Hit-testing for the touch pedal pad. The pad is one element that tracks
 * every finger on it and asks, on each move, which pedal is under each one:
 * a thumb can roll from GAS onto BRAKE without lifting, and the band between
 * GAS and HAND presses both (drift with one thumb). Pure geometry, no DOM.
 */
export interface PedalCircle {
  x: number;
  y: number;
  r: number;
}

export interface PedalLayout {
  gas: PedalCircle;
  brake: PedalCircle;
  hand: PedalCircle;
  /** The GAS+HAND chord band. */
  chord: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface PedalState {
  gas: boolean;
  brake: boolean;
  hand: boolean;
}

/** A finger this many radii from the nearest pedal's centre still presses it (generous: thumbs are fat). */
export const PEDAL_REACH = 1.45;

/** Which pedals a finger at (x, y) presses; ORs into `out`. */
export function pedalsAt(x: number, y: number, layout: PedalLayout, out: PedalState): void {
  const c = layout.chord;
  if (x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY) {
    out.gas = out.hand = true;
    return;
  }
  const g = norm(x, y, layout.gas);
  const b = norm(x, y, layout.brake);
  const h = norm(x, y, layout.hand);
  const best = Math.min(g, b, h);
  if (best > PEDAL_REACH) return;
  if (best === g) out.gas = true;
  else if (best === b) out.brake = true;
  else out.hand = true;
}

/** The chord band: across the gap between HAND and GAS, as wide as the narrower of them. */
export function chordBetween(hand: PedalCircle, gas: PedalCircle): PedalLayout['chord'] {
  const upper = hand.y < gas.y ? hand : gas;
  const lower = upper === hand ? gas : hand;
  const half = Math.min(hand.r, gas.r) * 0.8;
  const cx = (hand.x + gas.x) / 2;
  return {
    minX: cx - half,
    maxX: cx + half,
    minY: upper.y + upper.r * 0.85,
    maxY: lower.y - lower.r * 0.85,
  };
}

function norm(x: number, y: number, c: PedalCircle): number {
  return Math.hypot(x - c.x, y - c.y) / c.r;
}
