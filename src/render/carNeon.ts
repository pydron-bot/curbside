/**
 * Neon under cars (pure, tests/carNeon.test.ts): which cars come with an
 * underglow and in what colour, the title's pink, cyan and violet leading.
 * Sports cars always have one; a few other civilian cars do at random;
 * police, emergency and work vehicles never. CarBatch rolls it when a car is
 * made or recycled and draws it as a glow under the body.
 */
import type { VehicleArchetype } from '../entities/vehicle';

/** Underglow colours (sRGB hex), weighted toward the logo's pink and cyan. */
export const UNDERGLOW_COLOURS: readonly number[] = [0xff2d95, 0x22e4ff, 0xb14bff, 0xff2d95, 0x22e4ff, 0x3dff8b];

/** Odds of an underglow by model; anything not listed never has one. */
const ODDS: Partial<Record<VehicleArchetype, number>> = {
  sports: 1,
  muscle: 0.3,
  compact: 0.12,
  limo: 0.2,
  scooter: 0.15,
  pickup: 0.08,
  sedan: 0.05,
};

/** The underglow for a new car from two uniform rolls in [0, 1): a colour (sRGB hex), or -1 for none. */
export function pickUnderglow(archetype: VehicleArchetype, roll: number, colourRoll: number): number {
  if (roll >= (ODDS[archetype] ?? 0)) return -1;
  return UNDERGLOW_COLOURS[Math.min(UNDERGLOW_COLOURS.length - 1, Math.floor(colourRoll * UNDERGLOW_COLOURS.length))];
}

/** A light trail's length behind a car at this speed (m/s), m: none below 9 m/s, capped at 7 m. */
export function trailLength(speed: number): number {
  const s = Math.abs(speed);
  return s < 9 ? 0 : Math.min(7, 1.5 + (s - 9) * 0.35);
}
