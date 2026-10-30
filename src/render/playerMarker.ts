/**
 * Sizes for the driving marker (Look.addMarker), from how far the vehicle's
 * body reaches (CarBody.reach, m). Pure, so it's unit-tested.
 */

/** A sedan's reach: the marker was tuned on it (CAR_BODY). */
const SEDAN_REACH = 2.36;
/** The ring sprite's line sits at 0.82 of its half-size (glowSprites ring). */
const RING_LINE = 0.41;
/** Clearance between the body and the ring's line, m. */
const CLEAR = 0.3;
/** Today's sedan ring and chevron offset: the most it gets, so a bus's ring still reads as "you". */
const RING_MAX = 6.4;
const AHEAD_MAX = 3.4;

export interface DriveMarker {
  /** Ring sprite width = height, m. */
  ring: number;
  /** Chevron centre ahead of the vehicle's centre, m. */
  ahead: number;
  /** Chevron scale (1 = the sedan's). */
  chevron: number;
}

/** Fill `out` (no allocation: called every frame). */
export function driveMarker(reach: number, out: DriveMarker): DriveMarker {
  out.ring = Math.min(RING_MAX, (reach + CLEAR) / RING_LINE);
  out.ahead = Math.min(AHEAD_MAX, reach + 1.04);
  out.chevron = Math.min(1, Math.max(0.6, reach / SEDAN_REACH));
  return out;
}
