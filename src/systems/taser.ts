/**
 * The taser (W3-B): held, aimed and locked on like a pistol, but each
 * cartridge (ammo, topped up by crates) fires one pair of darts on wires
 * that stops at the first person, car or wall in its short reach. Whoever
 * it reaches is stunned: knocked down where they stand for TASER_STUN s,
 * no damage, then up again. Pure and tested (tests/taser.test.ts);
 * game/combat.ts tase() traces the darts, reports a `taser` event (audio,
 * the wire's look) and the knock-down as an ordinary `pedDown` (cause
 * 'taser'), so what it means is the same as any other floor:
 *
 * - **A fleeing suspect or a mugger** (`PedAgent.suspect`): not an assault.
 *   A mugger drops the bag (scenes/muggings.ts: hand it back, HAVE-A-GO
 *   HERO). A chase's suspect on foot pays HAVE-A-GO HERO as any floor does,
 *   and gives up where they fell (armed or not): kneeling once they're up,
 *   for the chase's officers to cuff, which is the player's CITIZEN'S ARREST
 *   (scenes/chases.ts, chaseHandoff.ts tasedArrest).
 * - **A police officer**: still a crime (heat's `copDown`), and an attack
 *   on a city chase's police like any other (the handoff rules).
 * - **Anyone else**: an assault, called in by witnesses like a punch.
 */
import { knockDown, type PedAgent } from './crowd';
import { WEAPONS } from './weapons';

/** How far the darts fly, m (the weapon's range). */
export const TASER_RANGE = WEAPONS.taser.range;
/** Down this long, s (a punch's knock-down is 2.5, a knockout 8). */
export const TASER_STUN = 4;
/** They fold where they stand: this slow a slide away from the darts, m/s. */
export const TASER_PUSH = 0.8;
/** The darts take someone this close to their line, m (a little more forgiving than a bullet's 0.45). */
export const TASER_HIT_RADIUS = 0.55;
/** People this close to someone tased step back from it for this long (m, s). */
export const TASER_SCARE = 7;
export const TASER_SCARE_SECONDS = 3;

/**
 * Stun `p`, hit by darts fired from (fromX, fromZ): down TASER_STUN s, no
 * hit points lost. Ordinary people get up provoked (fighters come at you,
 * the calm run); a suspect's scene and the police decide for theirs.
 * False if they're already down (nothing to stun).
 */
export function stun(p: PedAgent, fromX: number, fromZ: number): boolean {
  if (p.mode === 'down') return false;
  knockDown(p, fromX, fromZ, TASER_PUSH, TASER_STUN);
  p.stagger = 0;
  if (!p.suspect && p.role !== 'cop') p.provoked = true;
  return true;
}
