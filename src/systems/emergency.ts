/**
 * The rules behind the city's emergency scenes (game/scenes/fireCrews.ts,
 * tows.ts, alarms.ts): fires that flare up, burn and die down or are hosed
 * out; which fire a truck is sent to; a towed car trailing on the hook;
 * which car a tow truck takes; car alarms that sound for a while, repeat
 * their cycle and flash. Pure logic, no three.js, tested in
 * tests/emergency.test.ts. Everything is preallocated: no allocation per
 * step.
 */
import { len2 } from '../core/len';

// --- Fires ------------------------------------------------------------------

export interface Fire {
  /** Changes every time the slot is reused (a crew checks it still has the fire it was sent to). */
  id: number;
  x: number;
  z: number;
  /** 0..1: how big it is (it flares up, burns, dies down or is hosed out). */
  strength: number;
  age: number;
  /** Burns out on its own after this long, s. */
  life: number;
  /** Against a building (a blast by a wall), not a wreck. */
  building: boolean;
  /** A fire truck is on its way or at it. */
  claimed: boolean;
  alive: boolean;
  /** Went out (burnt out) on the last step(). */
  ended: boolean;
}

/** Most fires burning at once (a new one past this takes the oldest's place). */
export const MAX_FIRES = 6;
/** A fire left alone burns this long, s. */
export const FIRE_LIFE = 75;
/** It takes this long to flare up to full, s. */
export const FIRE_FLARE = 2.5;
/** It dies down over the last this-many seconds of its life, s. */
export const FIRE_FADE = 12;
/** One hose puts out a full fire in this long, s (two, half). */
export const HOSE_SECONDS = 7;
/** A new fire this close to a burning one feeds it instead, m. */
export const FIRE_MERGE = 5;

/** The fires burning in the city: started by blasts, put out by fire trucks or by time. */
export class FireBoard {
  readonly fires: Fire[] = [];
  /** Whether the last start() lit a new fire (rather than feeding one). */
  fresh = false;
  private nextId = 1;

  constructor(capacity = MAX_FIRES) {
    for (let i = 0; i < capacity; i++) {
      this.fires.push({ id: 0, x: 0, z: 0, strength: 0, age: 0, life: 0, building: false, claimed: false, alive: false, ended: false });
    }
  }

  /** A fire at (x, z); one already burning close by flares up again instead (`fresh` false). */
  start(x: number, z: number, building: boolean): Fire {
    for (const f of this.fires) {
      if (!f.alive || len2(f.x - x, f.z - z) > FIRE_MERGE) continue;
      f.life = Math.max(f.life, f.age + FIRE_LIFE);
      f.building ||= building;
      this.fresh = false;
      return f;
    }
    // A free slot, else the one that's been burning longest.
    let slot = this.fires[0];
    for (const f of this.fires) {
      if (!f.alive) {
        slot = f;
        break;
      }
      if (f.age > slot.age) slot = f;
    }
    slot.id = this.nextId++;
    slot.x = x;
    slot.z = z;
    slot.age = 0;
    slot.life = FIRE_LIFE;
    slot.strength = 0.4;
    slot.building = building;
    slot.claimed = false;
    slot.alive = true;
    slot.ended = false;
    this.fresh = true;
    return slot;
  }

  /** Burn for `dt`: flare up, then die down at the end of its life (`ended` on the step one goes out). */
  step(dt: number): void {
    for (const f of this.fires) {
      f.ended = false;
      if (!f.alive) continue;
      f.age += dt;
      const left = f.life - f.age;
      const cap = Math.min(1, Math.max(0, left / FIRE_FADE));
      // Grows to full while young; a hose holds it down (it never grows back past where it was).
      if (f.age < FIRE_FLARE + 1) f.strength = Math.min(cap, f.strength + dt / FIRE_FLARE);
      else f.strength = Math.min(f.strength, cap);
      if (left <= 0 || f.strength <= 0) {
        f.alive = false;
        f.strength = 0;
        f.ended = true;
      }
    }
  }

  /** `hoses` on it for `dt`: true on the step that puts it out. */
  hose(f: Fire, dt: number, hoses = 1): boolean {
    if (!f.alive) return false;
    f.strength = Math.max(0, f.strength - (dt * hoses) / HOSE_SECONDS);
    // Hosed down is out for good: no flaring back.
    f.age = Math.max(f.age, FIRE_FLARE + 1);
    if (f.strength > 0.02) return false;
    f.strength = 0;
    f.alive = false;
    return true;
  }

  /** Put it out now, silently (its wreck was recycled). */
  drop(f: Fire): void {
    f.alive = false;
    f.strength = 0;
    f.claimed = false;
  }

  /**
   * The fire to send a truck to: unclaimed, burning at least `delay` s,
   * with `minLeft` s still to burn, nearest (x, z) within `range`. Null if none.
   */
  toCall(x: number, z: number, range: number, delay: number, minLeft: number): Fire | null {
    let best: Fire | null = null;
    let bestD = range;
    for (const f of this.fires) {
      if (!f.alive || f.claimed || f.age < delay || f.life - f.age < minLeft) continue;
      const d = len2(f.x - x, f.z - z);
      if (d <= bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /** Anything burning within `r` m of (x, z)? */
  burningNear(x: number, z: number, r: number): boolean {
    for (const f of this.fires) if (f.alive && len2(f.x - x, f.z - z) < r) return true;
    return false;
  }

  get burning(): number {
    let n = 0;
    for (const f of this.fires) if (f.alive) n++;
    return n;
  }

  clear(): void {
    for (const f of this.fires) {
      f.alive = false;
      f.claimed = false;
      f.ended = false;
      f.strength = 0;
    }
  }
}

/**
 * Where a blast at (x, z) sets a building's wall alight: the nearest point
 * on any of `rects` within `range` m, stepped `out` m back toward the
 * blast (so the fire sits against the face, not inside). Written into
 * `into`; false if no wall is in range.
 */
export function wallFireAt(
  rects: readonly { minX: number; minZ: number; maxX: number; maxZ: number }[],
  x: number,
  z: number,
  range: number,
  out: number,
  into: { x: number; z: number },
): boolean {
  let best = range;
  let found = false;
  for (const r of rects) {
    const cx = Math.max(r.minX, Math.min(r.maxX, x));
    const cz = Math.max(r.minZ, Math.min(r.maxZ, z));
    const d = len2(x - cx, z - cz);
    if (d >= best) continue;
    best = d;
    found = true;
    if (d < 1e-3) {
      // Inside (a rocket into the wall): out through the nearest face.
      const dl = x - r.minX;
      const dr = r.maxX - x;
      const dn = z - r.minZ;
      const ds = r.maxZ - z;
      const m = Math.min(dl, dr, dn, ds);
      into.x = m === dl ? r.minX - out : m === dr ? r.maxX + out : x;
      into.z = m === dn ? r.minZ - out : m === ds ? r.maxZ + out : z;
    } else {
      into.x = cx + ((x - cx) / d) * out;
      into.z = cz + ((z - cz) / d) * out;
    }
  }
  return found;
}

// --- Tows -------------------------------------------------------------------

export interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** Gap between a tow truck's tail and the towed car's nose, m. */
export const TOW_GAP = 0.6;

/**
 * Where a towed car rides, like a trailer: its nose on the hook at the
 * truck's tail (`truckReach` behind its middle), its body trailing back
 * along the line from where it was (`car`, last step) to the hook, so it
 * follows the truck's path through a turn rather than swinging wide.
 * `rear`: hooked by its back end (it trails facing away from the truck).
 * Written into `out` (may be `car`).
 */
export function towPose(truck: Pose, truckReach: number, carReach: number, car: Pose, out: Pose, rear = false): Pose {
  const hx = truck.x - Math.sin(truck.heading) * (truckReach + TOW_GAP);
  const hz = truck.z - Math.cos(truck.heading) * (truckReach + TOW_GAP);
  let dx = hx - car.x;
  let dz = hz - car.z;
  let d = len2(dx, dz);
  if (d < 1e-3) {
    dx = Math.sin(truck.heading);
    dz = Math.cos(truck.heading);
    d = 1;
  }
  out.heading = Math.atan2(dx, dz) + (rear ? Math.PI : 0);
  out.x = hx - (dx / d) * carReach;
  out.z = hz - (dz / d) * carReach;
  return out;
}

/** Smoothstep 0..1: the winch taking up the slack, then easing the car home. */
export function winch(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  return t * t * (3 - 2 * t);
}

/** What a tow truck sees of a car it might take. */
export interface TowLook {
  wrecked: boolean;
  /** Still on fire (or a fire burning on it): the fire truck first. */
  burning: boolean;
  /** Parked at the kerb or in a bay by upkeep. */
  parked: boolean;
  /** m from the player. */
  distance: number;
}

/**
 * How much a tow truck wants a car (higher first; below 0: leave it).
 * Wrecks first, then abandoned cars, then parked ones (`parkedOk`: a roll
 * that lets this pick take a parked car at all); nearer first within a
 * kind. Nothing still burning, nothing beyond `range`.
 */
export function towPriority(c: TowLook, range: number, parkedOk: boolean): number {
  if (c.burning || c.distance > range) return -1;
  const near = 1 - c.distance / (range + 1);
  if (c.wrecked) return 3 + near;
  if (!c.parked) return 2 + near;
  return parkedOk ? 1 + near : -1;
}

// --- Car alarms -------------------------------------------------------------

export interface Alarm<T> {
  car: T | null;
  /** Seconds left sounding. */
  left: number;
  /** Seconds since it went off. */
  age: number;
  /** Until the next cycle of the sound, s. */
  next: number;
  /** Which sound (0..ALARM_PATTERNS-1). */
  pattern: number;
  alive: boolean;
  /** A new cycle of the sound starts this step (the scene emits it). */
  cycled: boolean;
}

/** An alarm sounds this long once set off (unless the car's driven off), s. */
export const ALARM_SECONDS = 20;
/** One cycle of its sound, s (the street event repeats at this). */
export const ALARM_CYCLE = 1.6;
/** Most alarms sounding at once (a new one past this silences the oldest). */
export const MAX_ALARMS = 4;
/** Different alarm sounds. */
export const ALARM_PATTERNS = 3;
/** The indicators flash this many times a second. */
export const ALARM_FLASH_HZ = 2;

/** Car alarms going off: set off by a bump or a shot, sounding ALARM_SECONDS in cycles, flashing. */
export class AlarmBoard<T> {
  readonly alarms: Alarm<T>[] = [];

  constructor(capacity = MAX_ALARMS) {
    for (let i = 0; i < capacity; i++) this.alarms.push({ car: null, left: 0, age: 0, next: 0, pattern: 0, alive: false, cycled: false });
  }

  /** Set off `car`'s alarm (`pattern`: its sound). Already sounding: it starts over. Returns the alarm. */
  trigger(car: T, pattern: number): Alarm<T> {
    let slot: Alarm<T> | null = null;
    for (const a of this.alarms) {
      if (a.alive && a.car === car) {
        a.left = ALARM_SECONDS;
        return a;
      }
    }
    for (const a of this.alarms) {
      if (!a.alive) {
        slot = a;
        break;
      }
      if (!slot || a.left < slot.left) slot = a;
    }
    const a = slot!;
    a.car = car;
    a.left = ALARM_SECONDS;
    a.age = 0;
    a.next = 0;
    a.pattern = ((pattern % ALARM_PATTERNS) + ALARM_PATTERNS) % ALARM_PATTERNS;
    a.alive = true;
    a.cycled = false;
    return a;
  }

  /** Time passes: `cycled` set on alarms starting a new cycle of their sound (the first on the step after trigger). */
  step(dt: number): void {
    for (const a of this.alarms) {
      a.cycled = false;
      if (!a.alive) continue;
      a.age += dt;
      a.left -= dt;
      if (a.left <= 0) {
        this.end(a);
        continue;
      }
      a.next -= dt;
      if (a.next <= 0) {
        a.next += ALARM_CYCLE;
        if (a.next <= 0) a.next = ALARM_CYCLE;
        a.cycled = true;
      }
    }
  }

  /** Is `car`'s alarm going? */
  sounding(car: T): boolean {
    for (const a of this.alarms) if (a.alive && a.car === car) return true;
    return false;
  }

  /** Silence `car` (driven off, towed, gone). */
  stop(car: T): void {
    for (const a of this.alarms) if (a.alive && a.car === car) this.end(a);
  }

  end(a: Alarm<T>): void {
    a.alive = false;
    a.car = null;
    a.cycled = false;
  }

  clear(): void {
    for (const a of this.alarms) this.end(a);
  }

  get count(): number {
    let n = 0;
    for (const a of this.alarms) if (a.alive) n++;
    return n;
  }
}

/** Are an alarm's indicators lit `age` s after it went off? (On for the first half of each flash.) */
export function alarmLit(age: number): boolean {
  return (age * ALARM_FLASH_HZ) % 1 < 0.5;
}

/** The sound an alarm makes for a car at (x, z) (stable per spot, so a car keeps its own). */
export function alarmPattern(x: number, z: number): number {
  return Math.abs(Math.floor(x * 0.7) * 31 + Math.floor(z * 0.7) * 17) % ALARM_PATTERNS;
}

/**
 * Is (px, pz) on or within `margin` m of a car's body (centre, heading,
 * half-length `reach`, `halfWidth`)? The point a crash or a bullet names.
 */
export function onBody(x: number, z: number, heading: number, reach: number, halfWidth: number, px: number, pz: number, margin: number): boolean {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const dx = px - x;
  const dz = pz - z;
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  return Math.abs(along) <= reach + margin && Math.abs(across) <= halfWidth + margin;
}
