/**
 * Seagulls over the docks (pure; tests/gulls.test.ts): a few small flocks
 * wheeling over the water's edge along the industrial quarter's coast (the
 * city's south-east sides), each gull on its own wide, slowly breathing
 * circle, mostly gliding with a bout of wing beats now and then, banked
 * into the turn. Where a gull is is a function of time alone: nothing to
 * step, nothing to save. render/gullMesh.ts draws them.
 */
import { HALF_EXTENT, ROAD_WIDTH } from '../world/city';
import { mulberry32 } from '../world/random';

export interface GullSpec {
  /** The middle of its circle, m. */
  cx: number;
  cz: number;
  /** Circle radius, m, and how much it breathes in and out. */
  r: number;
  dr: number;
  /** Angular speed, rad/s (negative: clockwise). */
  w: number;
  /** Where on the circle at time 0, rad, and its own beat offset, s. */
  phase: number;
  beat: number;
  /** Height, m. */
  y: number;
}

export interface GullPose {
  x: number;
  y: number;
  z: number;
  /** Facing (sin h, cos h), as the pigeons. */
  heading: number;
  /** Banked into the turn, rad. */
  bank: number;
  /** Gliding on still wings (false: in a bout of wing beats). */
  gliding: boolean;
  /** Wing beat phase, 0..1, while beating. */
  flap: number;
}

/** Where the sea starts past the city's last road, m (world/ground.ts shore: about 16 m of grass and rocks). */
export const SHORE = HALF_EXTENT + ROAD_WIDTH / 2 + 16;
/** Flocks along the south (+Z) and east (+X) coasts of the industrial quarter, as fractions of the half extent. */
const FLOCKS: ReadonlyArray<readonly [number, number]> = [
  [0.3, 1],
  [0.72, 1],
  [1, 1],
  [1, 0.72],
  [1, 0.3],
];

export function planGulls(seed: number): GullSpec[] {
  const rand = mulberry32((seed ^ 0x6a11) >>> 0);
  const out: GullSpec[] = [];
  for (const [fx, fz] of FLOCKS) {
    // Over the water's edge: on the shore line, or the corner.
    const cx = fx >= 1 ? SHORE : fx * HALF_EXTENT;
    const cz = fz >= 1 ? SHORE : fz * HALF_EXTENT;
    const n = 3 + Math.floor(rand() * 3);
    const dir = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      out.push({
        cx: cx + (rand() - 0.5) * 14,
        cz: cz + (rand() - 0.5) * 14,
        r: 10 + rand() * 14,
        dr: 2 + rand() * 4,
        w: dir * (0.22 + rand() * 0.14),
        phase: rand() * Math.PI * 2,
        beat: rand() * 30,
        y: 11 + rand() * 7,
      });
    }
  }
  return out;
}

/** Gull g at time t (s). */
export function gullPose(g: GullSpec, t: number, out: GullPose): GullPose {
  const a = g.phase + g.w * t;
  const r = g.r + g.dr * Math.sin(t * 0.13 + g.beat);
  out.x = g.cx + Math.cos(a) * r;
  out.z = g.cz + Math.sin(a) * r;
  out.y = g.y + 1.2 * Math.sin(t * 0.4 + g.beat * 1.7);
  // Moving along the circle: the derivative of (cos a, sin a) times w.
  const vx = -Math.sin(a) * g.w;
  const vz = Math.cos(a) * g.w;
  out.heading = Math.atan2(vx, vz);
  out.bank = -Math.sign(g.w) * 0.32;
  // Mostly gliding; a bout of beats for about a second and a half in every eight.
  const bout = (((t + g.beat) % 8) + 8) % 8;
  out.gliding = bout >= 1.5;
  out.flap = out.gliding ? 0 : (bout * 2.6) % 1;
  return out;
}
