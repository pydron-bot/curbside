/**
 * The story-mission engine: a mission is data (missionsData.ts), a list of
 * steps — go somewhere, get in a car, deliver it, pick someone up, destroy
 * cars, knock someone out, survive the heat, lose the heat, collect things,
 * race checkpoints — each with a line of objective text, an optional timer
 * and fail conditions, plus actions to run as it starts and ends (spawn the
 * target, set the wanted level, hand over a gun...).
 *
 * MissionRun only keeps the rules: each step it reads the world through a
 * MissionView (positions and states by tag, provided by the glue) and says
 * when a step is done, the mission passed or failed. Pure logic, unit-tested.
 */
import type { VehicleArchetype } from '../entities/vehicle';
import type { WeaponKind } from './weapons';

export interface DialogueLine {
  who: string;
  text: string;
}

/** Something the glue does when a step starts or ends. */
export type MissionAction =
  /** A parked car (or, with `drive`, one driven by traffic AI) for the mission, kept until the mission ends. */
  | { do: 'spawnCar'; tag: string; archetype: VehicleArchetype; paint: string; x: number; z: number; heading: number; drive?: boolean }
  /** Someone for the mission; `hostile` ones fight (armed: shoot) when the player comes close. */
  | { do: 'spawnPed'; tag: string; x: number; z: number; shirt?: string; armed?: boolean; hostile?: boolean }
  | { do: 'wanted'; stars: number }
  | { do: 'give'; weapon: WeaponKind }
  /** The tagged person gets into the player's car (off the street). */
  | { do: 'board'; tag: string }
  /** The passenger gets out beside the player's car and walks off. */
  | { do: 'alight'; tag: string };

/** A fail condition on a step: a tagged car wrecked, or left behind / gone. */
export interface MissionFail {
  wrecked?: string;
  /** Fails when the tagged car is gone or further than LOST_RANGE from the player. */
  lost?: string;
  reason: string;
}

interface StepBase {
  /** Objective line for the HUD. */
  text: string;
  /** Seconds allowed for this step. */
  timer?: number;
  start?: MissionAction[];
  done?: MissionAction[];
  fail?: MissionFail[];
}

export type MissionStep = StepBase &
  (
    | { kind: 'goto'; x: number; z: number; r?: number; inCar?: boolean }
    /** Get into a car: the tagged one, or any of an archetype, or any at all. */
    | { kind: 'enter'; tag?: string; archetype?: VehicleArchetype }
    /** Bring a car (tagged, or of an archetype, or any) to (x, z) and stop. */
    | { kind: 'deliver'; x: number; z: number; r?: number; tag?: string; archetype?: VehicleArchetype; minHealth?: number }
    /** Stop beside the tagged person in a car so they can get in. */
    | { kind: 'pickup'; tag: string }
    | { kind: 'destroy'; tags: string[] }
    | { kind: 'knockOut'; tag: string }
    /** Stay alive and free this long (the wanted level is the start actions' job). */
    | { kind: 'survive'; seconds: number }
    | { kind: 'loseHeat' }
    | { kind: 'collect'; points: ReadonlyArray<readonly [number, number]>; r?: number }
    /** Checkpoints at intersections (ix, iz), in order. */
    | { kind: 'race'; nodes: ReadonlyArray<readonly [number, number]> }
  );

export interface MissionDef {
  id: string;
  title: string;
  /** Which payphone rings for it. */
  phone: string;
  intro: DialogueLine[];
  outro: DialogueLine[];
  reward: number;
  /** Pin the clock to this hour for the mission (a night job). */
  hour?: number;
  steps: MissionStep[];
}

/** The world as the engine sees it, refreshed by the glue each step. */
export interface MissionView {
  x: number;
  z: number;
  inCar: boolean;
  /** The mission tag of the car being driven, if it has one. */
  carTag: string | null;
  carArchetype: VehicleArchetype | null;
  /** Health of the car being driven, 0..1. */
  carHealth: number;
  speed: number;
  stars: number;
  vehicle(tag: string): { x: number; z: number; wrecked: boolean } | null;
  ped(tag: string): { x: number; z: number; down: boolean } | null;
}

export type MissionSignal =
  | { kind: 'step'; index: number; step: MissionStep; prev: MissionStep | null }
  /** Something counted toward the step (a parcel collected, a car destroyed, a checkpoint). */
  | { kind: 'progress' }
  | { kind: 'passed'; prev: MissionStep }
  | { kind: 'failed'; reason: string };

/** Default reach of a goto / deliver point, m. */
export const GOTO_RADIUS = 6;
export const COLLECT_RADIUS = 2.5;
/** A checkpoint is passed within this of the crossing's centre, m. */
export const MISSION_CHECKPOINT = 10;
/** Stop below this speed to deliver, m/s. */
export const DELIVER_SPEED = 3;
/** A pick-up: stop this close, below PICKUP_SPEED, for PICKUP_HOLD seconds. */
export const PICKUP_RANGE = 7;
export const PICKUP_SPEED = 2;
export const PICKUP_HOLD = 0.8;
/** A tagged car further than this from the player has been lost, m. */
export const LOST_RANGE = 320;
/** Heat must stay at zero this long to count as lost, s. */
const CLEAN_FOR = 0.5;
const BLOCK = 64;

export class MissionRun {
  index = -1;
  /** Seconds left on the step's timer, or null without one. */
  timeLeft: number | null = null;
  /** Seconds into the current step. */
  stepTime = 0;
  /** Per collect point: taken yet? */
  collected: boolean[] = [];
  /** Race steps: the next checkpoint index; pick-ups: time held beside them. */
  next = 0;
  held = 0;
  /** destroy steps: how many of the tags are wrecks. */
  destroyed = 0;
  state: 'running' | 'passed' | 'failed' = 'running';
  failReason = '';

  constructor(readonly def: MissionDef) {}

  get step(): MissionStep | null {
    return this.def.steps[this.index] ?? null;
  }

  /** Start the first step. */
  begin(): MissionSignal {
    return this.advance(null);
  }

  /** One sim step: returns a signal when something changed. */
  update(dt: number, v: MissionView): MissionSignal | null {
    const s = this.step;
    if (this.state !== 'running' || !s) return null;
    this.stepTime += dt;
    if (this.timeLeft !== null) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) return this.fail('OUT OF TIME');
    }
    for (const f of s.fail ?? []) {
      if (f.wrecked) {
        const car = v.vehicle(f.wrecked);
        if (!car || car.wrecked) return this.fail(f.reason);
      }
      if (f.lost) {
        const car = v.vehicle(f.lost);
        if (!car || Math.hypot(car.x - v.x, car.z - v.z) > LOST_RANGE) return this.fail(f.reason);
      }
    }
    return this.check(s, dt, v);
  }

  /** The mission is off (WASTED, BUSTED, quit). */
  fail(reason: string): MissionSignal {
    this.state = 'failed';
    this.failReason = reason;
    return { kind: 'failed', reason };
  }

  private check(s: MissionStep, dt: number, v: MissionView): MissionSignal | null {
    switch (s.kind) {
      case 'goto':
        if ((s.inCar && !v.inCar) || Math.hypot(v.x - s.x, v.z - s.z) > (s.r ?? GOTO_RADIUS)) return null;
        return this.advance(s);
      case 'enter':
        return v.inCar && this.carMatches(s.tag, s.archetype, v) ? this.advance(s) : null;
      case 'deliver': {
        if (!v.inCar || !this.carMatches(s.tag, s.archetype, v)) return null;
        if (Math.hypot(v.x - s.x, v.z - s.z) > (s.r ?? GOTO_RADIUS) || v.speed > DELIVER_SPEED) return null;
        if (s.minHealth !== undefined && v.carHealth < s.minHealth) return this.fail('THE CAR IS TOO BADLY DAMAGED');
        return this.advance(s);
      }
      case 'pickup': {
        const p = v.ped(s.tag);
        const near = !!p && !p.down && v.inCar && v.speed < PICKUP_SPEED && Math.hypot(p.x - v.x, p.z - v.z) < PICKUP_RANGE;
        this.held = near ? this.held + dt : 0;
        return this.held >= PICKUP_HOLD ? this.advance(s) : null;
      }
      case 'destroy': {
        let n = 0;
        for (const tag of s.tags) if (v.vehicle(tag)?.wrecked) n++;
        if (n === s.tags.length) return this.advance(s);
        if (n !== this.destroyed) {
          this.destroyed = n;
          return { kind: 'progress' };
        }
        return null;
      }
      case 'knockOut':
        return v.ped(s.tag)?.down ? this.advance(s) : null;
      case 'survive':
        return this.stepTime >= s.seconds ? this.advance(s) : null;
      case 'loseHeat':
        this.held = v.stars === 0 ? this.held + dt : 0;
        return this.held >= CLEAN_FOR ? this.advance(s) : null;
      case 'collect': {
        const r = s.r ?? COLLECT_RADIUS;
        let got = false;
        for (let i = 0; i < s.points.length; i++) {
          if (this.collected[i]) continue;
          const [px, pz] = s.points[i];
          if (Math.hypot(v.x - px, v.z - pz) < r) {
            this.collected[i] = true;
            got = true;
          }
        }
        if (this.collected.every(Boolean)) return this.advance(s);
        return got ? { kind: 'progress' } : null;
      }
      case 'race': {
        const [ix, iz] = s.nodes[this.next];
        if (Math.hypot(v.x - ix * BLOCK, v.z - iz * BLOCK) > MISSION_CHECKPOINT) return null;
        this.next++;
        return this.next >= s.nodes.length ? this.advance(s) : { kind: 'progress' };
      }
    }
  }

  private carMatches(tag: string | undefined, archetype: VehicleArchetype | undefined, v: MissionView): boolean {
    if (tag) return v.carTag === tag;
    if (archetype) return v.carArchetype === archetype;
    return true;
  }

  /** Finish step `prev` (null at the start) and begin the next, or pass the mission. */
  private advance(prev: MissionStep | null): MissionSignal {
    this.index++;
    const s = this.step;
    if (!s) {
      this.state = 'passed';
      return { kind: 'passed', prev: prev! };
    }
    this.stepTime = 0;
    this.timeLeft = s.timer ?? null;
    this.next = 0;
    this.held = 0;
    this.destroyed = 0;
    this.collected = s.kind === 'collect' ? s.points.map(() => false) : [];
    return { kind: 'step', index: this.index, step: s, prev };
  }
}

/** Every tag a mission spawns (cars and people), for clean-up. */
export function missionTags(def: MissionDef): { cars: string[]; peds: string[] } {
  const cars = new Set<string>();
  const peds = new Set<string>();
  for (const s of def.steps) {
    for (const a of [...(s.start ?? []), ...(s.done ?? [])]) {
      if (a.do === 'spawnCar') cars.add(a.tag);
      if (a.do === 'spawnPed') peds.add(a.tag);
    }
  }
  return { cars: [...cars], peds: [...peds] };
}
