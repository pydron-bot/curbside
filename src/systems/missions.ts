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
 *
 * Two arcs share the phones: the main story (KEEP IT LOUD) rings from sunrise
 * to midnight from the city's phones, the Night Shift side story only after
 * dark from the docks-yard phone (arcRings, nextInArc).
 */
import type { BodyKind } from '../game/bodies';
import type { SceneId } from '../game/sceneStarter';
import type { VehicleArchetype } from '../entities/vehicle';
import type { WeaponKind } from './weapons';
import { SUNRISE, SUNSET } from '../render/timeOfDay';
import { districtAt, type District } from '../world/districts';
import { len2 } from '../core/len';

export interface DialogueLine {
  who: string;
  text: string;
}

/** Something the glue does when a step starts or ends. */
export type MissionAction =
  /** A car for the mission, kept until the mission ends: parked, or with `drive` driven by traffic AI (see SpawnCar). */
  | SpawnCar
  /**
   * Someone for the mission; `hostile` ones fight (armed: shoot) when the
   * player comes close. `body`: who they're drawn as (a story character's
   * own GLB and colours; a crowd body if left out).
   */
  | { do: 'spawnPed'; tag: string; x: number; z: number; shirt?: string; armed?: boolean; hostile?: boolean; body?: BodyKind }
  | { do: 'wanted'; stars: number }
  | { do: 'give'; weapon: WeaponKind }
  /** The tagged person gets into the player's car (off the street). */
  | { do: 'board'; tag: string }
  /**
   * The tagged car on the tagged truck's hook (both spawned): carried
   * behind it as the city's tows carry theirs, until it's let go (hookLetGo).
   */
  | { do: 'tow'; tag: string; truck: string }
  /** The passenger gets out beside the player's car and walks off. */
  | { do: 'alight'; tag: string }
  /**
   * One of the city's scenes started round (x, z) once the player is within
   * `r` m of it, and featured (nothing holds it off): a street race, a fight,
   * a fire. It may not start (no room, no people near); no step depends on it.
   */
  | SceneAction;

export interface SpawnCar {
  do: 'spawnCar';
  tag: string;
  archetype: VehicleArchetype;
  paint: string;
  x: number;
  z: number;
  heading: number;
  /** Driven by traffic AI (it stays pinned, so upkeep never recycles it). */
  drive?: boolean;
  /** With `drive`: waits parked until the player is this close (or it's hurt), m. */
  wait?: number;
  /** With `drive`: its cruising speed, m/s (traffic's own if left out). */
  cruise?: number;
  /** With `drive`: crossings (ix, iz) it heads for in turn, round and round (routeLeg); traffic's own turns if left out. */
  route?: ReadonlyArray<readonly [number, number]>;
}

/** The scenes a job can start (SceneStarter's, less the TEST menu's rain). */
export type MissionSceneId = Exclude<SceneId, 'rain'>;

export interface SceneAction {
  do: 'scene';
  scene: MissionSceneId;
  x: number;
  z: number;
  r?: number;
}

/**
 * Where a mayhem step's points count: anywhere in `district`, or else within
 * `r` m of the tagged car or person (of (x, z) without a tag, or once it's
 * gone). (x, z) is also where the radar points from outside.
 */
export interface MayhemArea {
  x: number;
  z: number;
  r?: number;
  district?: District;
  tag?: string;
}

/** A fail condition on a step: a tagged car wrecked, or left behind / gone, or a tagged person knocked down. */
export interface MissionFail {
  wrecked?: string;
  /** Fails when the tagged person is down (someone you're there to pick up). */
  down?: string;
  /** Fails when the tagged car is gone or further than LOST_RANGE from the player. */
  lost?: string;
  /** Fails when the tagged car's health drops below `below` of its max (SCRATCH_LINE if left out): don't scratch it. */
  damaged?: string;
  below?: number;
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
    /** Knock down every one of the tagged people (in any order). */
    | { kind: 'knockOutAll'; tags: string[] }
    /** Stay alive and free this long (the wanted level is the start actions' job). */
    | { kind: 'survive'; seconds: number }
    | { kind: 'loseHeat' }
    | { kind: 'collect'; points: ReadonlyArray<readonly [number, number]>; r?: number }
    /** Checkpoints at intersections (ix, iz), in order. */
    | { kind: 'race'; nodes: ReadonlyArray<readonly [number, number]> }
    /** Score this many chaos points (score awards, fed by the glue) in the area, or anywhere without one. */
    | { kind: 'mayhem'; points: number; near?: MayhemArea }
  );

/** Which story a job belongs to: the main story, or the Night Shift side story. */
export type MissionArc = 'main' | 'night';

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
  /** Story chapter (1 if left out); the last job of one says CHAPTER n COMPLETE. */
  chapter?: number;
  /** Hold the city's busy scenes off for the whole job (a timed run); left out, the city carries on round it. */
  quiet?: boolean;
  /** The main story if left out. */
  arc?: MissionArc;
  /** Starts without a payphone (the glue begins it itself, as the cold open does): never rings, and has no call (`phone` ''). */
  direct?: boolean;
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
  /** A tagged car: where, wrecked yet, and its health 0..1 (full if left out). */
  vehicle(tag: string): { x: number; z: number; wrecked: boolean; health?: number } | null;
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
/** A `damaged` fail's line, share of max health: below it the car counts as scratched. */
export const SCRATCH_LINE = 0.9;
/** Heat must stay at zero this long to count as lost, s. */
const CLEAN_FOR = 0.5;
const BLOCK = 64;
/** For steps without fail conditions (no new array every step). */
const NO_FAILS: readonly MissionFail[] = [];

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
  /** destroy and knockOutAll steps: how many of the tags are wrecks / down. */
  destroyed = 0;
  /** mayhem steps: points scored in the area so far. */
  mayhem = 0;
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
    for (const f of s.fail ?? NO_FAILS) {
      if (f.wrecked) {
        const car = v.vehicle(f.wrecked);
        if (!car || car.wrecked) return this.fail(f.reason);
      }
      if (f.down && v.ped(f.down)?.down) return this.fail(f.reason);
      if (f.lost) {
        const car = v.vehicle(f.lost);
        if (!car || len2(car.x - v.x, car.z - v.z) > LOST_RANGE) return this.fail(f.reason);
      }
      if (f.damaged) {
        const car = v.vehicle(f.damaged);
        if (car && (car.health ?? 1) < (f.below ?? SCRATCH_LINE)) return this.fail(f.reason);
      }
    }
    return this.check(s, dt, v);
  }

  /**
   * Points scored (a score award), with the player at (x, z): a mayhem step
   * counts them if they're in its area. The step passes on the next update
   * (an award comes mid-step, while other systems are halfway through theirs).
   */
  award(points: number, v: MissionView): void {
    const s = this.step;
    if (this.state !== 'running' || !s || s.kind !== 'mayhem' || points <= 0) return;
    if (!s.near || inArea(s.near, v.x, v.z, v)) this.mayhem += points;
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
        if ((s.inCar && !v.inCar) || len2(v.x - s.x, v.z - s.z) > (s.r ?? GOTO_RADIUS)) return null;
        return this.advance(s);
      case 'enter':
        return v.inCar && this.carMatches(s.tag, s.archetype, v) ? this.advance(s) : null;
      case 'deliver': {
        if (!v.inCar || !this.carMatches(s.tag, s.archetype, v)) return null;
        if (len2(v.x - s.x, v.z - s.z) > (s.r ?? GOTO_RADIUS) || v.speed > DELIVER_SPEED) return null;
        if (s.minHealth !== undefined && v.carHealth < s.minHealth) return this.fail('THE CAR IS TOO BADLY DAMAGED');
        return this.advance(s);
      }
      case 'pickup': {
        const p = v.ped(s.tag);
        const near = !!p && !p.down && v.inCar && v.speed < PICKUP_SPEED && len2(p.x - v.x, p.z - v.z) < PICKUP_RANGE;
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
      case 'knockOutAll': {
        let n = 0;
        for (const tag of s.tags) if (v.ped(tag)?.down) n++;
        if (n === s.tags.length) return this.advance(s);
        if (n !== this.destroyed) {
          this.destroyed = n;
          return { kind: 'progress' };
        }
        return null;
      }
      case 'mayhem':
        return this.mayhem >= s.points ? this.advance(s) : null;
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
          if (len2(v.x - px, v.z - pz) < r) {
            this.collected[i] = true;
            got = true;
          }
        }
        if (this.collected.every(Boolean)) return this.advance(s);
        return got ? { kind: 'progress' } : null;
      }
      case 'race': {
        const [ix, iz] = s.nodes[this.next];
        if (len2(v.x - ix * BLOCK, v.z - iz * BLOCK) > MISSION_CHECKPOINT) return null;
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
    this.mayhem = 0;
    this.collected = s.kind === 'collect' ? s.points.map(() => false) : [];
    return { kind: 'step', index: this.index, step: s, prev };
  }
}

/** Is (x, z) in a mayhem step's area? */
export function inArea(a: MayhemArea, x: number, z: number, v: MissionView): boolean {
  if (a.district) return districtAt(x, z) === a.district;
  let cx = a.x;
  let cz = a.z;
  if (a.tag) {
    const t = v.vehicle(a.tag) ?? v.ped(a.tag);
    if (t) {
      cx = t.x;
      cz = t.z;
    }
  }
  return len2(x - cx, z - cz) <= (a.r ?? MAYHEM_RADIUS);
}

/** A mayhem area without a radius reaches this far, m. */
export const MAYHEM_RADIUS = 120;

/** A repeat job pays this share of the story reward (rounded to $50). */
export const REPLAY_PAY = 0.5;

export function replayReward(def: MissionDef): number {
  return Math.max(50, Math.round((def.reward * REPLAY_PAY) / 50) * 50);
}

/**
 * Once every story job is passed the phones ring with them again, in story
 * order, as REPEAT JOBs: `replays` is how many have been done (saved, so the
 * rotation carries on across sessions). Null while the story isn't done.
 */
export function replayJob(missions: readonly MissionDef[], passed: readonly string[], replays: number): MissionDef | null {
  if (missions.length === 0 || missions.some((m) => !passed.includes(m.id))) return null;
  return missions[Math.max(0, Math.floor(replays)) % missions.length];
}

/** The job closes its chapter and another chapter follows it (the story's very last job doesn't). */
export function endsChapter(missions: readonly MissionDef[], def: MissionDef): boolean {
  const next = missions[missions.indexOf(def) + 1];
  return missions.includes(def) && next !== undefined && (next.chapter ?? 1) !== (def.chapter ?? 1);
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

// --- Driven cars: a hook, a route ---------------------------------------------------

/** A hooked car is let go once its truck has stood this long, this slow, with the player this close: caught. */
export const CATCH_RANGE = 24;
export const CATCH_SPEED = 2;
export const CATCH_HOLD = 1.2;

/** What a 'tow' action's hook needs to know each step. */
export interface HookView {
  /** Someone's at the truck's wheel: not wrecked, not the player's, its driver still in (or waiting to pull out). */
  driven: boolean;
  /** The player is in the car on the hook. */
  taken: boolean;
  /** The truck's speed, m/s, and the player's distance from it, m. */
  speed: number;
  distance: number;
}

/**
 * Does the hook let its car go this step? At once if the truck's driver is
 * gone (wrecked, carjacked, bailed out) or the player is in the car; or once
 * the player has caught the truck standing (a red light, boxed in) for
 * CATCH_HOLD: the crew gives it up. `held` carries the time caught.
 */
export function hookLetGo(hook: { held: number }, dt: number, v: HookView): boolean {
  if (!v.driven || v.taken) return true;
  hook.held = v.speed < CATCH_SPEED && v.distance < CATCH_RANGE ? hook.held + dt : 0;
  return hook.held >= CATCH_HOLD;
}

/**
 * A routed car's leg: the index of the crossing it heads for. Arriving
 * toward that crossing (its driver's next one is it) moves it on to the
 * next, round and round, so the turn taken there already heads for the one after.
 */
export function routeLeg(route: ReadonlyArray<readonly [number, number]>, leg: number, ix: number, iz: number): number {
  if (route.length === 0) return 0;
  const at = route[leg % route.length];
  return at[0] === ix && at[1] === iz ? (leg + 1) % route.length : leg % route.length;
}

// --- The two arcs ---------------------------------------------------------------

/** The Night Shift's phone (the docks yard's); the main story never rings it. */
export const NIGHT_PHONE = 'phone-docks';

export function arcOf(def: MissionDef): MissionArc {
  return def.arc ?? 'main';
}

/**
 * Does `arc`'s phone ring at `hour`? The Night Shift only after dark; the
 * main story by day and in the evening (sunrise to midnight).
 */
export function arcRings(arc: MissionArc, hour: number): boolean {
  return arc === 'night' ? hour >= SUNSET || hour < SUNRISE : hour >= SUNRISE;
}

/**
 * What `arc` has next: its first job not passed (in data order, so a job
 * this build hasn't got is simply skipped), or once all are passed a REPEAT
 * JOB (replayJob over the jobs that ring). Null when there's nothing to ring
 * for: a `direct` job is next (the glue starts that), or the arc has none.
 * `skipDirect`: the glue has had its go at the direct jobs (the cold open
 * has run), so one not passed no longer holds the arc up.
 */
export function nextInArc(
  missions: readonly MissionDef[],
  arc: MissionArc,
  passed: readonly string[],
  replays: number,
  skipDirect = false,
): { job: MissionDef; replay: boolean } | null {
  const jobs = missions.filter((m) => arcOf(m) === arc);
  const story = jobs.find((m) => !passed.includes(m.id) && !(skipDirect && m.direct));
  if (story) return story.direct ? null : { job: story, replay: false };
  const job = replayJob(
    jobs.filter((m) => !m.direct),
    passed,
    replays,
  );
  return job ? { job, replay: true } : null;
}

// --- Scenes a job starts ---------------------------------------------------------

/** What the 'scene' action needs from the city (game/sceneStarter.ts storyScenes). */
export interface SceneHost {
  /** Start `id` round (x, z) and feature it (nothing holds it off); false if it couldn't start. */
  start(id: MissionSceneId, x: number, z: number): boolean;
  /** Stop featuring what start() featured (the job is over). */
  unfeature(): void;
}

/** A 'scene' action starts within this of the player, m (unless it says). */
export const SCENE_REACH = 110;
/** A scene that couldn't start is tried once more this long after, s. */
export const SCENE_REROLL = 4;

/**
 * A job's scenes: each waits for the player to come within reach of its
 * point, then is tried, and re-rolled once if it couldn't start; after
 * that it's dropped quietly. One at a time, in order. end() (a pass, a
 * fail, WASTED, BUSTED, quit) drops the rest and stops featuring.
 */
export class MissionScenes {
  readonly pending: SceneAction[] = [];
  /** Tries at the first pending one. */
  private tries = 0;
  private wait = 0;
  /** One started, so something is featured. */
  private featuring = false;

  request(a: SceneAction): void {
    this.pending.push(a);
  }

  /** One sim step, the player at (x, z). Returns the scene that started, if one did. */
  step(dt: number, x: number, z: number, host: SceneHost | null): SceneAction | null {
    const a = this.pending[0];
    if (!a || !host) return null;
    if ((this.wait -= dt) > 0 || len2(x - a.x, z - a.z) > (a.r ?? SCENE_REACH)) return null;
    this.tries++;
    if (host.start(a.scene, a.x, a.z)) {
      this.featuring = true;
      this.next();
      return a;
    }
    if (this.tries >= 2) this.next();
    else this.wait = SCENE_REROLL;
    return null;
  }

  end(host: SceneHost | null): void {
    this.pending.length = 0;
    this.tries = 0;
    this.wait = 0;
    if (this.featuring) host?.unfeature();
    this.featuring = false;
  }

  private next(): void {
    this.pending.shift();
    this.tries = 0;
    this.wait = 0;
  }
}
