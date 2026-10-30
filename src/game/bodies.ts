/**
 * Which body a person is drawn with. Each body is its own GLB (same rig and
 * clips, a different silhouette) and its own instanced batch, so the choice
 * costs one draw call per body on screen, not per person. Pure data: the
 * crowd, the police and the missions pick bodies here; render/ loads them.
 */

export type BodyKind = 'player' | 'ped_slim' | 'ped_stocky' | 'ped_coat' | 'cop' | 'vex' | 'tuna' | 'pike';

/** Every body, in the order their batches are drawn. */
export const BODY_KINDS: readonly BodyKind[] = ['player', 'ped_slim', 'ped_stocky', 'ped_coat', 'cop', 'vex', 'tuna', 'pike'];

/** Story characters: they keep the colours they were built with (no random outfit). */
export const STORY_BODIES: readonly BodyKind[] = ['vex', 'tuna', 'pike'];

/**
 * The street crowd's mix. The player's own body is in it too (in other
 * clothes): the yellow jacket stays the player's alone.
 */
export const CROWD_BODIES: ReadonlyArray<readonly [BodyKind, number]> = [
  ['player', 0.28],
  ['ped_slim', 0.26],
  ['ped_stocky', 0.24],
  ['ped_coat', 0.22],
];

/** A body for someone on the pavement. */
export function pickCrowdBody(rand: () => number): BodyKind {
  let r = rand();
  for (const [kind, w] of CROWD_BODIES) if ((r -= w) <= 0) return kind;
  return CROWD_BODIES[CROWD_BODIES.length - 1][0];
}

/** Where a body's GLB is served from. */
export function bodyUrl(kind: BodyKind): string {
  return `/assets/${kind}.glb`;
}

/**
 * Ball caps (ped_stocky wears one in its `hair` slot): brighter than hair
 * colours, so the cap reads as a cap from 25 m up.
 */
export const CAP_COLOURS = ['#c0392b', '#1f3a7a', '#2e7d4f', '#e8e4d8', '#1a1a1a', '#e08a1e', '#6a2c91'];
