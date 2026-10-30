/**
 * AI drivers. Each follows lane waypoints from intersection to intersection,
 * steering with pure pursuit and producing the same VehicleControls a player
 * would, so AI cars use the exact same physics. Pure pursuit has no notion of
 * walls, so a driver that stops closing on its waypoint backs out and turns,
 * and one shoved far off its lane picks a fresh route from where it is.
 *
 * Drivers react to the player too: one hit hard may panic (drive flat out,
 * honking, through corners and gaps it would normally wait for), fly into a
 * road rage (the game hands it a pursuit controller) or bail out; anyone
 * held up by the player leans on the horn; and a siren coming up behind
 * makes them pull over to the kerb and slow.
 */
import { forwardSpeed, wrapAngle, type VehicleControls, type VehicleState } from '../entities/vehicle';
import { BLOCK_SIZE } from '../world/city';
import {
  DIR_VEC,
  LANE_OFFSET,
  MAX_NODE,
  rightOf,
  canLeave,
  chooseTurn,
  dirHeading,
  entryPoint,
  exitPoint,
  lanePoint,
  nodeValid,
  reverse,
  type Dir,
} from '../world/roads';

export interface AiDriver {
  /** Intersection being driven toward. */
  ix: number;
  iz: number;
  dir: Dir;
  /** Direction to take at (ix, iz). */
  next: Dir;
  phase: 'approach' | 'turning';
  /** Seconds spent blocked; long waits make the driver push through. */
  waited: number;
  pushThrough: number;
  cruise: number;
  /** Speed it takes corners at, m/s (police corner harder than traffic). */
  turnSpeed: number;
  /** Closest the car has got to the current waypoint, m. */
  progress: number;
  /** Seconds trying to move without getting closer to the waypoint. */
  stuck: number;
  /** Seconds left backing out after getting stuck. */
  reversing: number;
  /** Seconds since the driver last made real progress (for recycling hopeless cars). */
  stalled: number;
  /** Times it has backed out since last making real progress. */
  attempts: number;
  /** Closest it got to the waypoint before the current trouble, m. */
  bestProgress: number;
  /** How they feel about the player: 'panic' drives flat out honking, 'rage' is chasing them. */
  mood: Mood;
  /** Seconds left in that mood. */
  moodTimer: number;
  /** Seconds left pulled over for a siren. */
  yielding: number;
  /** Seconds held up by the player (on foot or in a car) in its lane. */
  blockedByPlayer: number;
  hornCooldown: number;
  /** Set when the driver honks this step (its length, s); the caller sounds it and clears it. */
  honk: number;
  /** In a hurry (police on a call): leaves half the gap and overtakes whatever's in the way. */
  urgent: boolean;
  /** Seconds left in the oncoming lane, overtaking. */
  overtaking: number;
}

export type Mood = 'calm' | 'panic' | 'rage';

export interface Obstacle {
  x: number;
  z: number;
  /** Half-width used for the "is it in my lane" test. */
  halfWidth: number;
  /** It's the player (or their car): being held up by it gets a honk. */
  player?: boolean;
}

export const CRUISE_SPEED = 12;
export const TURN_SPEED = 6;
const WAYPOINT_RADIUS = 4;
/** Must close this much on the waypoint to count as progress, m. */
const PROGRESS_STEP = 0.5;
/** No progress for this long while trying to move = stuck. */
export const STUCK_SECONDS = 1.5;
const REVERSE_SECONDS = 1;
const REVERSE_THROTTLE = -0.7;
/** Further than this from the lane line (shoved by a crash or blast): re-route. */
export const REROUTE_DISTANCE = 20;
/** This far past the waypoint it was approaching: re-route rather than U-turn. */
const OVERSHOOT_DISTANCE = 12;
/** On approach, steer for a point this far ahead along the lane line, m. */
const LOOKAHEAD = 10;
/** Stuck this long, or backed out this often, without real progress: give up. */
const HOPELESS_SECONDS = 10;
const HOPELESS_ATTEMPTS = 6;
/** Panicking drivers go this much over their cruise speed... */
const PANIC_SPEED = 2;
/** ...and leave half the usual gap. */
const PANIC_GAP = 0.45;
export const PANIC_SECONDS = 10;
export const RAGE_SECONDS = 12;
/** Held up by the player this long: honk, s. */
export const HONK_AFTER = 1.5;
/** Pulling over: this far toward the kerb from the lane centre, m, and no faster than this, m/s. */
const YIELD_SHIFT = 3;
const YIELD_SPEED = 3;
/** A siren behind within this distance (same way) makes drivers pull over, m. */
export const YIELD_RANGE = 40;
/** Overtaking: this far left of our lane line (into the oncoming lane), for at least this long. */
const OVERTAKE_SHIFT = 2 * LANE_OFFSET;
const OVERTAKE_SECONDS = 1.6;

/**
 * Place a new AI car on a random lane. Returns null if the pick was off-map.
 * `t` is how far (0..1) along the segment leading to (ix, iz) to start.
 */
export function spawnAi(
  ix: number,
  iz: number,
  dir: Dir,
  t: number,
  rand: () => number,
): { driver: AiDriver; x: number; z: number; heading: number } | null {
  const v = DIR_VEC[dir];
  // The segment must exist: both its ends are on the map.
  if (!nodeValid(ix - v.x, iz - v.z) || !canLeave(ix - v.x, iz - v.z, dir)) return null;
  const along = -BLOCK_SIZE * (1 - t) - 12 * t; // stay out of both intersections
  const p = lanePoint(ix, iz, dir, Math.min(-12, along));
  return {
    driver: createDriver(ix, iz, dir, rand),
    x: p.x,
    z: p.z,
    heading: dirHeading(dir),
  };
}

/** A fresh driver heading for intersection (ix, iz) in `dir` (place the car yourself). */
export function createDriver(ix: number, iz: number, dir: Dir, rand: () => number): AiDriver {
  return {
    ix,
    iz,
    dir,
    next: chooseTurn(ix, iz, dir, rand),
    phase: 'approach',
    waited: 0,
    pushThrough: 0,
    cruise: CRUISE_SPEED * (0.85 + rand() * 0.3),
    turnSpeed: TURN_SPEED,
    progress: Infinity,
    stuck: 0,
    reversing: 0,
    stalled: 0,
    attempts: 0,
    bestProgress: Infinity,
    mood: 'calm',
    moodTimer: 0,
    yielding: 0,
    blockedByPlayer: 0,
    hornCooldown: 0,
    honk: 0,
    urgent: false,
    overtaking: 0,
  };
}

/** Reused output of driveAi (consume it before the next call). */
const controls: VehicleControls = { throttle: 0, steer: 0, handbrake: false };
const waypoint = { x: 0, z: 0 };
const aim = { x: 0, z: 0 };

/** The point the driver is heading for: the entry to (ix, iz), or the exit when turning. */
function currentWaypoint(ai: AiDriver): { x: number; z: number } {
  return ai.phase === 'approach' ? entryPoint(ai.ix, ai.iz, ai.dir, waypoint) : exitPoint(ai.ix, ai.iz, ai.next, waypoint);
}

/**
 * Advance the driver's route and return controls for this step. The returned
 * object is reused: pass it to stepVehicle before calling again.
 */
export function driveAi(
  ai: AiDriver,
  car: VehicleState,
  obstacles: Obstacle[],
  rand: () => number,
  dt: number,
): VehicleControls {
  ai.hornCooldown = Math.max(0, ai.hornCooldown - dt);
  ai.yielding = Math.max(0, ai.yielding - dt);
  // Rage is timed by whoever is running the chase; panic wears off here.
  if (ai.mood === 'panic' && (ai.moodTimer -= dt) <= 0) ai.mood = 'calm';
  const panic = ai.mood === 'panic';
  if (ai.phase === 'approach' && offRoute(ai, car)) rerouteAi(ai, car, rand);
  let target = currentWaypoint(ai);
  if (Math.hypot(target.x - car.x, target.z - car.z) < WAYPOINT_RADIUS) {
    ai.progress = ai.bestProgress = Infinity;
    ai.stuck = ai.stalled = ai.attempts = 0;
    if (ai.phase === 'approach') {
      ai.phase = 'turning';
    } else {
      // Through the intersection: now heading for the next one.
      ai.dir = ai.next;
      const v = DIR_VEC[ai.dir];
      ai.ix += v.x;
      ai.iz += v.z;
      ai.next = chooseTurn(ai.ix, ai.iz, ai.dir, rand);
      ai.phase = 'approach';
    }
    target = currentWaypoint(ai);
  }
  const distToWaypoint = Math.hypot(target.x - car.x, target.z - car.z);

  // Pure pursuit. On approach, chase a point a little ahead on the lane line
  // rather than the far waypoint, so a car knocked sideways merges back onto
  // the road instead of cutting across the pavement into a building corner.
  let ax = target.x;
  let az = target.z;
  if (ai.phase === 'approach') {
    const v = DIR_VEC[ai.dir];
    const along = (car.x - target.x) * v.x + (car.z - target.z) * v.z;
    const ahead = Math.min(0, along + LOOKAHEAD);
    aim.x = target.x + v.x * ahead;
    aim.z = target.z + v.z * ahead;
    if (ai.yielding > 0 || ai.overtaking > 0) {
      // Pull over (hug the kerb), or pull out into the oncoming lane to pass.
      const r = rightOf(ai.dir);
      const shift = ai.overtaking > 0 ? -OVERTAKE_SHIFT : YIELD_SHIFT;
      aim.x += r.x * shift;
      aim.z += r.z * shift;
    }
    ax = aim.x;
    az = aim.z;
  }
  const desired = Math.atan2(ax - car.x, az - car.z);
  const diff = wrapAngle(desired - car.heading);
  const steer = Math.max(-1, Math.min(1, -diff * 2.5));

  if (ai.reversing > 0) {
    // Back out with opposite lock: steering flips in reverse, so this swings
    // the nose toward the waypoint. Already lined up (nose in a corner)?
    // Swing a different way each time so the next try takes another line.
    ai.reversing -= dt;
    controls.throttle = REVERSE_THROTTLE;
    controls.steer = Math.abs(steer) > 0.3 ? -steer : ai.attempts % 2 ? 0.8 : -0.8;
    controls.handbrake = false;
    return controls;
  }

  // Slow for turns (and while about to make one); panic only slows for the sharpest.
  const turning = ai.next !== ai.dir;
  let wantSpeed = panic ? ai.cruise * PANIC_SPEED : ai.cruise;
  const turnSpeed = ai.turnSpeed;
  if (panic) {
    if (Math.abs(diff) > 0.9) wantSpeed = Math.min(wantSpeed, turnSpeed * 1.8);
  } else {
    // In a hurry, brake later and harder into the corner.
    const brakeIn = ai.urgent ? 0.7 : 0.3;
    if (ai.phase === 'turning' && turning) wantSpeed = turnSpeed;
    else if (ai.phase === 'approach' && turning && distToWaypoint < 22 + turnSpeed) wantSpeed = turnSpeed + distToWaypoint * brakeIn;
    if (Math.abs(diff) > 0.6) wantSpeed = Math.min(wantSpeed, turnSpeed);
  }
  if (ai.yielding > 0 && ai.phase === 'approach') wantSpeed = Math.min(wantSpeed, YIELD_SPEED);
  if (panic && ai.hornCooldown <= 0) honk(ai, 0.2 + rand() * 0.25, 0.8 + rand());

  // Brake for anything in our path (in a hurry: pass it if the other lane is clear).
  const vF = forwardSpeed(car);
  if (ai.overtaking > 0) {
    ai.overtaking -= dt;
    if (ai.phase !== 'approach') ai.overtaking = 0;
  }
  if (ai.pushThrough > 0) {
    ai.pushThrough -= dt;
  } else {
    const hurry = panic || ai.urgent;
    const safe = 3 + Math.max(0, vF) * (hurry ? PANIC_GAP : 0.9);
    let gap = clearDistance(car, obstacles, ai.overtaking > 0 ? -OVERTAKE_SHIFT : 0);
    if (ai.urgent && ai.overtaking <= 0 && ai.phase === 'approach' && gap < safe * 1.8 && !blockerIsPlayer) {
      const passing = clearDistance(car, obstacles, -OVERTAKE_SHIFT);
      if (passing > safe * 1.8) {
        ai.overtaking = OVERTAKE_SECONDS;
        gap = passing;
      }
    }
    if (gap < safe) {
      wantSpeed = 0;
      ai.waited += dt;
      ai.blockedByPlayer = blockerIsPlayer ? ai.blockedByPlayer + dt : 0;
      if (ai.blockedByPlayer > HONK_AFTER && ai.hornCooldown <= 0) honk(ai, 0.5 + rand() * 0.5, 2 + rand());
      if (ai.waited > 4) {
        // Gridlock breaker: ignore blockers briefly (physics still prevents overlap).
        ai.pushThrough = 1.5;
        ai.waited = 0;
      }
    } else {
      ai.waited = 0;
      ai.blockedByPlayer = 0;
      wantSpeed = Math.min(wantSpeed, Math.max(0, (gap - safe) * 0.8 + 2));
    }
  }

  trackProgress(ai, distToWaypoint, wantSpeed, dt);

  let throttle = Math.max(-1, Math.min(1, (wantSpeed - vF) * 0.4));
  // Our physics reverses on brake at a standstill; AI never wants that.
  if (vF < 0.6 && throttle < 0) throttle = 0;
  controls.throttle = throttle;
  controls.steer = steer;
  controls.handbrake = false;
  return controls;
}

/**
 * Wanting to move but not closing on the waypoint (nose in a wall, wedged on
 * a kerb) for STUCK_SECONDS starts a reverse. Standing still on purpose
 * (queueing behind a car) doesn't count.
 */
function trackProgress(ai: AiDriver, dist: number, wantSpeed: number, dt: number) {
  if (wantSpeed < 1) {
    ai.stuck = 0;
    return;
  }
  if (Number.isNaN(ai.progress)) {
    ai.progress = dist; // fresh baseline after backing out
    return;
  }
  if (dist < ai.progress - PROGRESS_STEP) {
    ai.progress = dist;
    ai.stuck = 0;
    if (ai.attempts === 0 || dist < ai.bestProgress - PROGRESS_STEP * 4) {
      // Genuinely further along than before the trouble started.
      ai.stalled = 0;
      ai.attempts = 0;
      ai.bestProgress = dist;
    }
    return;
  }
  ai.stuck += dt;
  ai.stalled += dt;
  if (ai.stuck > STUCK_SECONDS) {
    ai.stuck = 0;
    ai.reversing = REVERSE_SECONDS;
    ai.attempts++;
    ai.progress = NaN;
  }
}

/** Wedged somewhere it can't drive out of: better recycled (when nobody's looking). */
export function isHopeless(ai: AiDriver): boolean {
  return ai.stalled > HOPELESS_SECONDS || ai.attempts >= HOPELESS_ATTEMPTS;
}

/** Is an approaching car far from its lane line, or well past its waypoint? */
function offRoute(ai: AiDriver, car: VehicleState): boolean {
  const e = entryPoint(ai.ix, ai.iz, ai.dir, aim);
  const v = DIR_VEC[ai.dir];
  const rx = car.x - e.x;
  const rz = car.z - e.z;
  const along = rx * v.x + rz * v.z;
  const lateral = Math.abs(rx * v.z - rz * v.x);
  return lateral > REROUTE_DISTANCE || along > OVERSHOOT_DISTANCE;
}

/**
 * Pick a fresh route from where the car is now: the nearest road line, in the
 * direction the car is roughly facing, toward the next intersection ahead.
 */
export function rerouteAi(ai: AiDriver, car: VehicleState, rand: () => number): void {
  const clampNode = (n: number) => Math.max(-MAX_NODE, Math.min(MAX_NODE, n));
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  // Closer to a north-south road (x on a multiple of BLOCK_SIZE) or an east-west one?
  const offX = Math.abs(car.x - Math.round(car.x / BLOCK_SIZE) * BLOCK_SIZE);
  const offZ = Math.abs(car.z - Math.round(car.z / BLOCK_SIZE) * BLOCK_SIZE);
  let dir: Dir = offX < offZ ? (fz < 0 ? 0 : 2) : fx > 0 ? 1 : 3;
  for (let attempt = 0; attempt < 2; attempt++) {
    const v = DIR_VEC[dir];
    // The road line we'll drive along...
    const ix0 = v.x === 0 ? clampNode(Math.round(car.x / BLOCK_SIZE)) : 0;
    const iz0 = v.z === 0 ? clampNode(Math.round(car.z / BLOCK_SIZE)) : 0;
    // ...and the first intersection on it whose entry point is still ahead.
    const pos = v.x !== 0 ? car.x : car.z;
    const sign = v.x !== 0 ? v.x : v.z;
    let n = sign > 0 ? Math.ceil(pos / BLOCK_SIZE) : Math.floor(pos / BLOCK_SIZE);
    const e = (k: number) => entryPoint(v.x !== 0 ? k : ix0, v.z !== 0 ? k : iz0, dir);
    const ahead = (k: number) => {
      const p = e(k);
      return (p.x - car.x) * v.x + (p.z - car.z) * v.z > 2;
    };
    if (!ahead(n)) n += sign;
    const ix = v.x !== 0 ? n : ix0;
    const iz = v.z !== 0 ? n : iz0;
    if (Math.abs(ix) <= MAX_NODE && Math.abs(iz) <= MAX_NODE && canLeave(ix - v.x, iz - v.z, dir)) {
      ai.ix = ix;
      ai.iz = iz;
      ai.dir = dir;
      ai.next = chooseTurn(ix, iz, dir, rand);
      ai.phase = 'approach';
      ai.progress = Infinity;
      ai.bestProgress = Infinity;
      ai.stuck = 0;
      return;
    }
    dir = reverse(dir); // off the edge of the map that way: turn round
  }
}

/** Whether the nearest obstacle the last clearDistance() found was the player. */
let blockerIsPlayer = false;

/**
 * Distance to the nearest obstacle ahead within our lane width, or Infinity.
 * `shift` checks a parallel line that far to our right instead (negative:
 * left, e.g. the oncoming lane when overtaking).
 */
export function clearDistance(car: VehicleState, obstacles: Obstacle[], shift = 0): number {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let best = Infinity;
  blockerIsPlayer = false;
  for (const o of obstacles) {
    const rx = o.x - car.x;
    const rz = o.z - car.z;
    const along = rx * fx + rz * fz;
    if (along <= 0.5 || along > 30) continue;
    // Signed offset to our right (heading north, right is +x).
    const lateral = Math.abs(rz * fx - rx * fz - shift);
    if (lateral < 1.1 + o.halfWidth && along - 2.4 < best) {
      best = along - 2.4;
      blockerIsPlayer = o.player === true;
    }
  }
  return best;
}

function honk(ai: AiDriver, duration: number, cooldown: number): void {
  ai.honk = duration;
  ai.hornCooldown = cooldown;
}

export type HitReaction = 'panic' | 'rage' | 'bail';

/**
 * The player just hit this driver hard: 55% panic for PANIC_SECONDS, 25%
 * road rage for RAGE_SECONDS (the caller hands the car a pursuit controller),
 * 20% stop and bail out (the caller ejects them). Sets the mood; returns which.
 */
export function reactToHit(ai: AiDriver, rand: () => number): HitReaction {
  const r = rand();
  if (r < 0.55) {
    ai.mood = 'panic';
    ai.moodTimer = PANIC_SECONDS;
    ai.hornCooldown = 0;
    return 'panic';
  }
  if (r < 0.8) {
    ai.mood = 'rage';
    ai.moodTimer = RAGE_SECONDS;
    return 'rage';
  }
  return 'bail';
}

/** Scared off by gunfire or a chase nearby: drive away fast (doesn't shorten a longer panic). */
export function scareDriver(ai: AiDriver, seconds: number): void {
  if (ai.mood === 'rage') return;
  ai.mood = 'panic';
  ai.moodTimer = Math.max(ai.moodTimer, seconds);
}

/**
 * Should a driver in `car` pull over for a siren in `siren`? Yes if it's
 * coming up behind in the same direction within YIELD_RANGE, or heading
 * straight at us close ahead.
 */
export function shouldYield(car: VehicleState, siren: VehicleState): boolean {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const rx = siren.x - car.x;
  const rz = siren.z - car.z;
  const along = rx * fx + rz * fz;
  const lateral = Math.abs(rx * fz - rz * fx);
  if (lateral > 7) return false;
  const turn = Math.abs(wrapAngle(siren.heading - car.heading));
  if (along < -2 && along > -YIELD_RANGE) return turn < 0.8;
  return along > 2 && along < 30 && turn > 2.3;
}
