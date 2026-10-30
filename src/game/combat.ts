/**
 * Combat, game side: everything that resolves a shot, a punch, a throw, a
 * rocket, a blast or a fire against the player, the crowd and the traffic,
 * and reports it on the bus. main.ts reads the input and calls in; the
 * pure rules live in systems/ (weapons: arsenal, spread, lock-on, drive-by
 * aim; crowd: ped HP, stagger, knockouts; damage: crashes and blasts;
 * projectiles: what flies). No three.js.
 *
 * On foot: guns fire along a lock-on (hostiles first) or the aim, with
 * spread blooming as you hold the trigger; grenades and molotovs land where
 * you aim (the cursor, the stick's reach, or the locked target), rockets
 * fly. Punches chain jab, jab, hook: the hook knocks down. People go down
 * at 0 HP (a knockout, the only thing that scores KNOCKOUT). In a car, a
 * pistol or SMG fires out of either side window at the best target there.
 */
import type { EventBus } from '../core/events';
import { VEHICLE_SPECS } from '../entities/vehicle';
import {
  hurtPed,
  provoke,
  scare,
  setAlight,
  type HurtResult,
  type PedAgent,
} from '../systems/crowd';
import {
  BLASTS,
  applyDamage,
  blamesPlayer,
  blastDamage,
  ignite,
  markPlayerHit,
  type BlastKind,
} from '../systems/damage';
import { CAR_CIRCLE_OFFSETS, CAR_CIRCLE_RADIUS, carCircles } from '../systems/physics';
import { FIRE_RADIUS, MIN_THROW, Projectiles, clampThrowToWalls, throwTarget, type ProjectileWorld } from '../systems/projectiles';
import type { Award, Score } from '../systems/score';
import {
  DRIVE_BY_SPREAD,
  VEHICLE_SHARE,
  WEAPONS,
  autoAim,
  driveByAim,
  lockTarget,
  rayCircle,
  rayRect,
  type FireMode,
  type LockCandidate,
  type WeaponKind,
} from '../systems/weapons';
import type { StaticGrid } from '../world/collision';
import { ARMOUR_PICKUP, HEALTH_PICKUP, type PickupKind } from '../world/pickups';
import type { Player } from './player';
import type { CrowdPed, Vehicle } from './population';

/** Punches: reach (m), damage per combo step (jab, jab, hook), cooldowns (s). */
export const PUNCH_RANGE = 1.5;
export const PUNCH_DAMAGE = [22, 22, 40] as const;
const PUNCH_COOLDOWN = [0.26, 0.26, 0.55] as const;
/** The next punch continues the combo if thrown within this long, s. */
export const COMBO_WINDOW = 0.75;
/** The hook knocks them over at this push, m/s. */
const HOOK_KNOCK = 4.5;
/** Without an aim, a punch turns to someone this close in front (m, cos of the half-angle). */
const PUNCH_ASSIST = 2.4;
const PUNCH_ASSIST_COS = 0.3;
/** NPCs: a punch on the player, a bullet into the player, a car, another ped. */
export const NPC_PUNCH_DAMAGE = 9;
export const NPC_SHOT_DAMAGE = 8;
/** Beyond this, NPC bullets hit for less (m, damage). */
const NPC_FAR = 14;
const NPC_FAR_DAMAGE = 6;
/** NPC bullets hurt cars this much less than people (police chases stay survivable). */
const NPC_VEHICLE_SHARE = 0.45;
const NPC_PED_DAMAGE = 20;
export const NPC_SHOT_RANGE = 26;
/** Random aim error of NPC shooters, radians; a running target is harder to hit. */
export const NPC_SPREAD = 0.14;
const NPC_SPREAD_MOVING = 0.6;
/** The lock-on lets go this long after the last shot, s. */
const LOCK_LINGER = 0.6;
/** A deliberate aim (stick, mouse) locks within this half-angle of it, radians. */
export const LOCK_AIM_CONE = 0.35;
/** Running while shooting widens the spread this much. */
const RUN_SPREAD = 1.35;
/** Fire: damage per second to people standing in it, cars, and the player (s between the player's hurts). */
const FIRE_PED_DPS = 22;
const FIRE_CAR_DPS = 12;
const FIRE_PLAYER_DPS = 14;
const FIRE_PLAYER_TICK = 0.3;
/** People who walk into fire burn this long, s. */
const BURN_SECONDS = 3.5;
/**
 * Rockets don't lock on or snap to anything nearer than this, m: inside
 * their own blast it would be the player who got hurt (a deliberate aim
 * can still fire point-blank).
 */
const LAUNCHER_MIN_AIM = 8;
/** An unaimed throw goes this share of the weapon's range (or onto someone in front within it). */
const THROW_LOB = 0.5;
/** A blast that sets the player's own car alight leaves at least this long to get out, s. */
const PLAYER_CAR_FUSE = 3;
/** Explosions further than this from the player don't score KABOOM, m. */
const BOOM_SCORE_RANGE = 60;
/** Gunfire scares people within this, m; armed ones within ARMED_JOIN may join in. */
const SCARE_RANGE = 25;
const ARMED_JOIN = 18;

export interface CombatDeps {
  bus: EventBus;
  player: Player;
  vehicles: readonly Vehicle[];
  crowd: readonly CrowdPed[];
  grid: StaticGrid;
  rand: () => number;
  score: Score;
  award(a: Award | null): void;
  /** Throw an NPC driver out of their car, running from (fromX, fromZ). */
  ejectDriver(v: Vehicle, fromX: number, fromZ: number): void;
  /** Sim time, s. */
  now(): number;
  /** False behind the title: nobody's after the (hidden) player. */
  playing(): boolean;
  /** Where the camera looks (explosion distance for the effects). */
  focus(): { x: number; z: number };
  /** Wanted stars: with any, the police count as hostile for lock-on. */
  stars(): number;
  /** The player's body, for punch and recoil poses (optional: tests leave it out). */
  pose?: { punch(step: number): void; shoot(): void };
}

/** How the player is aiming this frame (see main.ts). */
export interface AimInput {
  /** World heading of a deliberate aim (stick, mouse, right stick), or null. */
  heading: number | null;
  /** Aim stick deflection 0..1 (throw distance on a stick). */
  reach: number;
  /** The ground point under the mouse cursor, when the mouse aims. */
  ground: { x: number; z: number } | null;
}

/** What a bullet hit (traceBullet reuses one record: read it before the next trace). */
interface Hit {
  kind: 'none' | 'ped' | 'vehicle' | 'player';
  ped: CrowdPed | null;
  v: Vehicle | null;
}

/** A lock-on / drive-by candidate with what it is. */
interface Candidate extends LockCandidate {
  ped: CrowdPed | null;
  car: Vehicle | null;
}

const PED_HIT_RADIUS = 0.45;

export class Combat {
  readonly projectiles = new Projectiles();
  /** Who the gun is locked on to (a ped), while firing. */
  lock: CrowdPed | null = null;
  /** Where a throw would land now (the landing marker), while one is ready; `blocked`: a wall cut it short. */
  readonly marker = { x: 0, z: 0, show: false, blocked: false };
  /** The player's current combo step (0..2) and the time left to continue it. */
  comboStep = -1;
  comboTimer = 0;
  private sinceShot = Infinity;
  private firePlayerTimer = 0;
  private readonly playerLit = new Set<PedAgent>();
  private readonly candidates: Candidate[] = [];
  private candidateCount = 0;
  private readonly circles = [
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 0 },
  ];
  private readonly dir = { x: 0, z: 0 };
  /** Reused for autoAim (a view of the first candidateCount candidates) and ray tests. */
  private readonly aimTargets: Candidate[] = [];
  private readonly ray = { x: 0, z: 0, r: 0 };
  private readonly hit: Hit = { kind: 'none', ped: null, v: null };
  private readonly target = { x: 0, z: 0 };
  private readonly world: ProjectileWorld;

  constructor(private readonly d: CombatDeps) {
    this.world = {
      grid: d.grid,
      rocketHits: (x, z, r, byPlayer) => this.rocketHits(x, z, r, byPlayer),
      bottleHits: (x, z, y) => y < 1.3 && this.carAt(x, z, 0.1) !== null,
      explode: (kind, x, z, byPlayer) => this.blast(kind, x, z, byPlayer),
      ignite: (x, z, byPlayer) => d.bus.emit({ type: 'ignite', x, z, radius: FIRE_RADIUS, byPlayer }),
    };
  }

  /** Drop everything in flight and any lock (a fresh run, the title). */
  reset(): void {
    this.projectiles.clear();
    this.playerLit.clear();
    this.lock = null;
    this.marker.show = false;
    this.comboStep = -1;
    this.comboTimer = 0;
    this.sinceShot = Infinity;
  }

  /** One sim step: things in flight, fires, people burning, the combo clock. */
  step(dt: number): void {
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.sinceShot += dt;
    this.projectiles.step(dt, this.world);
    this.stepFires(dt);
  }

  // --- Aim ------------------------------------------------------------------

  /**
   * Per frame, on foot: keep or drop the lock-on, and place the throw marker.
   * `firing`: the trigger is down (or the aim stick pushed to fire).
   */
  updateAim(firing: boolean, aim: AimInput): void {
    const p = this.d.player;
    const kind = p.arsenal.current;
    const spec = kind ? WEAPONS[kind] : null;
    if (!spec || p.driving || !p.ready) {
      this.lock = null;
      this.marker.show = false;
      return;
    }
    // Lock-on: guns and launchers, while firing (and a moment after).
    if (spec.mode !== 'throw' && (firing || this.sinceShot < LOCK_LINGER)) {
      const near = minAim(spec.mode);
      if (!this.lockValid(spec.range * 1.2, aim.heading, near)) this.lock = firing ? this.acquireLock(spec.range, aim.heading, near) : null;
    } else this.lock = null;
    // Throwables always show where they'd land, aimed or not (a tap on FIRE
    // throws to the same spot, so touch players see it first too).
    if (spec.mode === 'throw') {
      this.marker.blocked = this.throwPoint(spec.range, aim, this.target);
      this.marker.x = this.target.x;
      this.marker.z = this.target.z;
      this.marker.show = true;
    } else this.marker.show = false;
  }

  /** Heading to face while locked on, or null. */
  lockHeading(): number | null {
    const l = this.lock;
    if (!l) return null;
    const p = this.d.player.ped;
    return Math.atan2(l.agent.s.x - p.x, l.agent.s.z - p.z);
  }

  private lockValid(range: number, aimHeading: number | null, near: number): boolean {
    const l = this.lock;
    if (!l || l.agent.mode === 'down' || !this.d.crowd.includes(l)) return false;
    const p = this.d.player.ped;
    const dx = l.agent.s.x - p.x;
    const dz = l.agent.s.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range || dist < near) return false;
    if (aimHeading === null || dist < 0.5) return true;
    const cos = (dx * Math.sin(aimHeading) + dz * Math.cos(aimHeading)) / dist;
    return cos > Math.cos(LOCK_AIM_CONE * 1.6);
  }

  private acquireLock(range: number, aimHeading: number | null, near: number): CrowdPed | null {
    const p = this.d.player.ped;
    this.gatherPeds(near);
    const i = lockTarget(p.x, p.z, aimHeading ?? p.heading, this.candidates, this.candidateCount, range, aimHeading === null ? 0 : LOCK_AIM_CONE);
    return i >= 0 ? this.candidates[i].ped : null;
  }

  // --- Firing on foot ---------------------------------------------------------

  /** Pull the trigger on foot: fire, throw or launch the current weapon. Returns true if it went. */
  fire(aim: AimInput): boolean {
    const p = this.d.player;
    const kind = p.arsenal.current;
    if (!kind || p.driving || !p.ready || !p.arsenal.ready) return false;
    const spec = WEAPONS[kind];
    if (spec.mode === 'throw') return this.throwIt(kind as 'grenade' | 'molotov', aim);
    // Spread before this shot's bloom; running sprays more.
    const moving = Math.hypot(p.ped.vx, p.ped.vz) > 3.5;
    const spread = p.arsenal.spread * (moving ? RUN_SPREAD : 1);
    if (!p.arsenal.tryFire()) return false;
    this.sinceShot = 0;
    const { x, z } = p.ped;
    this.aimDirection(spec.range, aim.heading, this.dir, minAim(spec.mode));
    p.ped.heading = Math.atan2(this.dir.x, this.dir.z);
    const ox = x + this.dir.x * 0.6;
    const oz = z + this.dir.z * 0.6;
    this.d.pose?.shoot();
    if (spec.mode === 'launcher') {
      const a = Math.atan2(this.dir.x, this.dir.z) + (this.d.rand() * 2 - 1) * spread;
      this.projectiles.fireRocket(ox, oz, Math.sin(a), Math.cos(a), true);
      this.d.bus.emit({ type: 'shot', x: ox, z: oz, dirX: Math.sin(a), dirZ: Math.cos(a), weapon: kind, byPlayer: true });
    } else {
      this.d.bus.emit({ type: 'shot', x: ox, z: oz, dirX: this.dir.x, dirZ: this.dir.z, weapon: kind, byPlayer: true });
      this.firePellets(kind, ox, oz, Math.atan2(this.dir.x, this.dir.z), spread, x, z);
    }
    this.alarm(x, z);
    return true;
  }

  /** Where a shot goes: the lock, else the aim (snapping to a target near it), else assisted facing. */
  private aimDirection(range: number, aimHeading: number | null, out: { x: number; z: number }, near: number): void {
    const p = this.d.player.ped;
    const l = this.lock;
    if (l) {
      const dx = l.agent.s.x - p.x;
      const dz = l.agent.s.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      out.x = dx / d;
      out.z = dz / d;
      return;
    }
    this.gatherAll(null, near);
    const targets = this.aimTargets;
    targets.length = 0;
    for (let i = 0; i < this.candidateCount; i++) targets.push(this.candidates[i]);
    if (aimHeading !== null) autoAim(p.x, p.z, aimHeading, targets, range, 0.26, out);
    else autoAim(p.x, p.z, p.heading, targets, range, undefined, out);
  }

  private throwIt(kind: 'grenade' | 'molotov', aim: AimInput): boolean {
    const p = this.d.player;
    const { x, z } = p.ped;
    const blocked = this.throwPoint(WEAPONS[kind].range, aim, this.target);
    // Hugging a wall and throwing into it would drop it at your own feet: no throw (the ring shows red there).
    if (blocked && Math.hypot(this.target.x - x, this.target.z - z) < MIN_THROW) return false;
    if (!p.arsenal.tryFire()) return false;
    this.sinceShot = 0;
    p.ped.heading = Math.atan2(this.target.x - x, this.target.z - z);
    this.d.pose?.punch(1);
    this.projectiles.throw(kind, x, z, this.target.x, this.target.z, true);
    this.d.bus.emit({ type: 'throw', x, z, toX: this.target.x, toZ: this.target.z, weapon: kind, byPlayer: true });
    return true;
  }

  /**
   * Where a throw lands, short of any wall in the way (true if one cut it
   * short): the marker shows what will really happen, not a spot behind a
   * building that the grenade would bounce back from.
   */
  private throwPoint(range: number, aim: AimInput, out: { x: number; z: number }): boolean {
    this.aimThrow(range, aim, out);
    const p = this.d.player.ped;
    return clampThrowToWalls(p.x, p.z, out, this.d.grid);
  }

  /** Where a throw is aimed: the cursor, a locked or assisted target, the stick's reach, or ahead. */
  private aimThrow(range: number, aim: AimInput, out: { x: number; z: number }): void {
    const p = this.d.player.ped;
    if (aim.ground) {
      throwTarget(p.x, p.z, aim.ground.x, aim.ground.z, range, out);
      return;
    }
    const heading = aim.heading ?? p.heading;
    // Without an aim it's a lob to a sensible distance (on screen, even
    // looking up a landscape phone), or onto someone in front within it.
    const lob = range * THROW_LOB;
    // Someone near the aim line within reach: land on them.
    this.gatherPeds();
    const i = lockTarget(p.x, p.z, heading, this.candidates, this.candidateCount, aim.heading === null ? lob : range, aim.heading === null ? 0.5 : LOCK_AIM_CONE);
    if (i >= 0 && (aim.heading === null || aim.reach >= 0.9)) {
      const c = this.candidates[i];
      throwTarget(p.x, p.z, c.x, c.z, range, out);
      return;
    }
    const reach = aim.heading !== null ? 4 + (range - 4) * Math.min(1, aim.reach) : lob;
    throwTarget(p.x, p.z, p.x + Math.sin(heading) * reach, p.z + Math.cos(heading) * reach, range, out);
  }

  // --- Drive-bys ------------------------------------------------------------------

  /**
   * FIRE in a car: a pistol or SMG out of whichever side window has the best
   * target (or toward the aim, if there is one). Picks the best drive-by gun
   * when holding something else. Returns true if a shot went.
   */
  driveBy(aimHeading: number | null): boolean {
    const p = this.d.player;
    const car = p.driving;
    if (!car || !p.alive) return false;
    let kind = p.arsenal.current;
    if (!kind || !WEAPONS[kind].driveBy) {
      kind = p.arsenal.driveByGun();
      if (!kind) return false;
      p.arsenal.current = kind;
    }
    if (!p.arsenal.ready) return false;
    const spread = p.arsenal.spread * DRIVE_BY_SPREAD;
    if (!p.arsenal.tryFire()) return false;
    const s = car.sim;
    this.gatherAll(car);
    // An aim picks the side (sin of the aim relative to the car: + is the
    // left window), and the direction if there's nothing there to snap to.
    const side = aimHeading === null ? 0 : Math.sin(aimHeading - s.heading) >= 0 ? 1 : -1;
    const i = driveByAim(s.x, s.z, s.heading, this.candidates, this.candidateCount, WEAPONS[kind].range, this.dir, side);
    if (i < 0 && aimHeading !== null) {
      this.dir.x = Math.sin(aimHeading);
      this.dir.z = Math.cos(aimHeading);
    }
    const ox = s.x + this.dir.x * 1.2;
    const oz = s.z + this.dir.z * 1.2;
    this.d.bus.emit({ type: 'shot', x: ox, z: oz, dirX: this.dir.x, dirZ: this.dir.z, weapon: kind, byPlayer: true, driveBy: true });
    this.firePellets(kind, ox, oz, Math.atan2(this.dir.x, this.dir.z), spread, s.x, s.z);
    this.alarm(s.x, s.z);
    return true;
  }

  // --- Punches --------------------------------------------------------------------

  /** Throw the next punch of the combo (jab, jab, hook). */
  punch(aimHeading: number | null): void {
    const p = this.d.player;
    if (p.driving || !p.ready || p.punchCooldown > 0) return;
    const step = this.comboTimer > 0 ? (this.comboStep + 1) % 3 : 0;
    this.comboStep = step;
    this.comboTimer = COMBO_WINDOW;
    p.punchCooldown = PUNCH_COOLDOWN[step];
    if (aimHeading !== null) p.ped.heading = aimHeading;
    else this.faceNearest();
    this.d.pose?.punch(step);
    const { x, z, heading } = p.ped;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let landed = false;
    for (const c of this.d.crowd) {
      const a = c.agent;
      const dx = a.s.x - x;
      const dz = a.s.z - z;
      const d = Math.hypot(dx, dz);
      if (d < PUNCH_RANGE && (dx * fx + dz * fz) / (d || 1) > 0.4 && a.mode !== 'down') {
        landed = true;
        const res = hurtPed(a, PUNCH_DAMAGE[step], x, z, step === 2 ? HOOK_KNOCK : 0);
        this.resolve(c, res, 'punch', x, z, true);
      } else if (d < 10) scare(a, x, z, 3);
    }
    this.d.bus.emit({ type: 'punch', x: x + fx * 0.6, z: z + fz * 0.6, hit: landed, byPlayer: true, combo: step });
  }

  /** Without an aim, swing at whoever's closest in front (within a step or two). */
  private faceNearest(): void {
    const p = this.d.player.ped;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    let best: PedAgent | null = null;
    let bestD = PUNCH_ASSIST;
    for (const c of this.d.crowd) {
      const a = c.agent;
      if (a.mode === 'down') continue;
      const dx = a.s.x - p.x;
      const dz = a.s.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && (dx * fx + dz * fz) / (d || 1) > PUNCH_ASSIST_COS) {
        bestD = d;
        best = a;
      }
    }
    if (best) p.heading = Math.atan2(best.s.x - p.x, best.s.z - p.z);
  }

  // --- NPCs -----------------------------------------------------------------------

  /** A hostile ped's punch at the player (in reach or not). */
  npcPunch(c: CrowdPed): void {
    const p = this.d.player;
    if (p.driving || !p.alive || !this.d.playing()) return;
    const hit = Math.hypot(p.ped.x - c.agent.s.x, p.ped.z - c.agent.s.z) < PUNCH_RANGE + 0.2;
    this.d.bus.emit({ type: 'punch', x: c.agent.s.x, z: c.agent.s.z, hit, byPlayer: false });
    c.model.punch();
    if (hit) p.hurt(NPC_PUNCH_DAMAGE);
  }

  /** An NPC (an armed ped, the police) shoots from (sx, sz) along unit (dirX, dirZ). */
  npcShoot(sx: number, sz: number, dirX: number, dirZ: number): void {
    const p = this.d.player;
    // A target on the move is harder to hit.
    const at = p.position;
    const moving = Math.min(1, Math.hypot(at.vx, at.vz) / 6);
    const a = Math.atan2(dirX, dirZ) + (this.d.rand() * 2 - 1) * NPC_SPREAD * (1 + NPC_SPREAD_MOVING * moving);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const ox = sx + dx * 0.6;
    const oz = sz + dz * 0.6;
    this.d.bus.emit({ type: 'shot', x: ox, z: oz, dirX: dx, dirZ: dz, weapon: null, byPlayer: false });
    const hit = this.traceBullet(ox, oz, dx, dz, NPC_SHOT_RANGE, false);
    if (hit.kind === 'player') {
      const far = Math.hypot(p.ped.x - sx, p.ped.z - sz) > NPC_FAR;
      p.hurt(far ? NPC_FAR_DAMAGE : NPC_SHOT_DAMAGE);
    } else if (hit.v) applyDamage(hit.v.damage, NPC_SHOT_DAMAGE * NPC_VEHICLE_SHARE);
    else if (hit.ped) {
      // Stray rounds hurt bystanders too (nobody scores for them).
      const res = hurtPed(hit.ped.agent, NPC_PED_DAMAGE, sx, sz);
      this.resolve(hit.ped, res, 'shot', sx, sz, false);
    }
  }

  // --- Blasts and fire ------------------------------------------------------------

  /**
   * A car blew up (main.ts chars the model first). Hurts and shoves what's
   * around it, sets close cars alight, scores KABOOM near the player.
   */
  vehicleExploded(v: Vehicle): void {
    const p = this.d.player;
    const ownCar = p.driving === v;
    const byPlayer = ownCar || blamesPlayer(v.damage, this.d.now());
    this.blast('car', v.sim.x, v.sim.z, byPlayer, v, ownCar);
    if (this.d.playing()) {
      const at = p.position;
      if (Math.hypot(at.x - v.sim.x, at.z - v.sim.z) < BOOM_SCORE_RANGE) this.d.award(this.d.score.award('boom'));
    }
    if (ownCar) {
      // The slide (if any) dies with the car; you're thrown clear and hurt once.
      this.d.score.endDrift(false);
      p.ownCarExploded();
    }
  }

  /** An explosion of `kind` at (x, z): the event, then damage, fire and shoves all round. */
  blast(kind: BlastKind, x: number, z: number, byPlayer: boolean, source: Vehicle | null = null, ownCar = false): void {
    const b = BLASTS[kind];
    const d = this.d;
    const f = d.focus();
    d.bus.emit({
      type: 'explosion',
      x,
      z,
      distance: Math.hypot(f.x - x, f.z - z),
      byPlayer,
      ownCar,
      police: source !== null && (source.archetype === 'police' || source.police === true),
      source: kind === 'car' ? 'vehicle' : kind,
    });
    const p = d.player;
    if (!p.driving && !ownCar && d.playing()) {
      const dist = Math.hypot(p.ped.x - x, p.ped.z - z);
      if (dist < b.radius) {
        p.hurt(blastDamage(dist, b.radius, b.playerDamage));
        p.knockDown(x, z, 6, 2, 'blast', byPlayer);
      }
    }
    const now = d.now();
    for (const v of d.vehicles) {
      if (v === source || v.damage.wrecked) continue;
      const dist = this.nearestPart(v, x, z);
      if (dist >= b.radius) continue;
      const dmg = blastDamage(dist, b.radius, b.carDamage);
      // Close cars catch fire and go up after a short fuse, so a jam goes in a
      // rippling chain (not all on the next step); the player's own car leaves
      // time to bail. The rest just take the damage.
      if (dist < b.igniteRadius) ignite(v.damage, v === p.driving ? PLAYER_CAR_FUSE + d.rand() : 0.5 + d.rand() * 1.4);
      else applyDamage(v.damage, dmg);
      // A chain reaction is still the player's doing.
      if (byPlayer) markPlayerHit(v.damage, now);
      const push = (dmg / b.carDamage) * b.push / VEHICLE_SPECS[v.archetype].mass;
      const cd = Math.hypot(v.sim.x - x, v.sim.z - z) || 1;
      v.sim.vx += ((v.sim.x - x) / cd) * push;
      v.sim.vz += ((v.sim.z - z) / cd) * push;
    }
    for (const c of d.crowd) {
      const a = c.agent;
      const dist = Math.hypot(a.s.x - x, a.s.z - z);
      if (dist < b.radius) {
        const res = hurtPed(a, blastDamage(dist, b.radius, b.pedDamage), x, z, 6);
        this.resolve(c, res, 'blast', x, z, byPlayer);
      } else if (dist < 30) scare(a, x, z, 4);
    }
  }

  /** People, cars and the player in a molotov's fire burn. */
  private stepFires(dt: number): void {
    const d = this.d;
    const p = d.player;
    let playerInFire = false;
    for (const f of this.projectiles.fires) {
      if (!f.alive) continue;
      const r = f.radius * Math.min(1, 0.4 + f.age * 3); // the fuel spreads out quickly
      for (const c of d.crowd) {
        const a = c.agent;
        if (a.mode === 'down' && a.burning <= 0) continue;
        if (Math.hypot(a.s.x - f.x, a.s.z - f.z) < r) {
          if (a.burning <= 0 && a.mode !== 'down') scare(a, f.x, f.z, 2);
          setAlight(a, BURN_SECONDS);
          if (f.byPlayer) this.playerLit.add(a);
        }
      }
      for (const v of d.vehicles) {
        if (v.damage.wrecked || this.nearestPart(v, f.x, f.z) > r) continue;
        applyDamage(v.damage, FIRE_CAR_DPS * dt);
        if (f.byPlayer) markPlayerHit(v.damage, d.now());
      }
      if (!p.driving && p.alive && Math.hypot(p.ped.x - f.x, p.ped.z - f.z) < r) playerInFire = true;
    }
    // The player: hurt in ticks, not every step (one flash and sound per tick).
    if (playerInFire && d.playing()) {
      this.firePlayerTimer -= dt;
      if (this.firePlayerTimer <= 0) {
        this.firePlayerTimer = FIRE_PLAYER_TICK;
        p.hurt(FIRE_PLAYER_DPS * FIRE_PLAYER_TICK);
      }
    } else this.firePlayerTimer = 0;
    // Anyone on fire loses HP until it goes out.
    for (const c of d.crowd) {
      const a = c.agent;
      if (a.burning <= 0) {
        if (this.playerLit.size > 0) this.playerLit.delete(a);
        continue;
      }
      if (a.mode === 'down') continue;
      a.hp -= FIRE_PED_DPS * dt;
      if (a.hp <= 0) {
        a.hp = 1;
        const res = hurtPed(a, 1, a.s.x - a.s.vx, a.s.z - a.s.vz, 3);
        this.resolve(c, res, 'fire', a.s.x, a.s.z, this.playerLit.has(a));
      }
    }
  }

  // --- Pickups --------------------------------------------------------------------

  /** Walk into a crate: apply it. False leaves it there (already full). */
  collect(kind: PickupKind): boolean {
    const p = this.d.player;
    if (kind === 'health') {
      if (p.health >= p.maxHealth) return false;
      p.health = Math.min(p.maxHealth, p.health + HEALTH_PICKUP);
      return true;
    }
    if (kind === 'armour') return p.addArmour(ARMOUR_PICKUP) > 0;
    if (kind === 'ammo') return p.arsenal.addAmmo();
    const have = p.arsenal.ammo.get(kind) ?? 0;
    if (have >= WEAPONS[kind].maxAmmo) return false;
    p.arsenal.pickUp(kind);
    p.arsenal.current = kind;
    return true;
  }

  // --- Internals ------------------------------------------------------------------

  /** Trace `pellets` of `kind` from (ox, oz) around `heading`, resolving hits for the player. */
  private firePellets(kind: WeaponKind, ox: number, oz: number, heading: number, spread: number, fromX: number, fromZ: number): void {
    const w = WEAPONS[kind];
    const d = this.d;
    for (let i = 0; i < w.pellets; i++) {
      const a = heading + (d.rand() * 2 - 1) * spread;
      const hit = this.traceBullet(ox, oz, Math.sin(a), Math.cos(a), w.range, true);
      if (hit.ped) {
        const res = hurtPed(hit.ped.agent, w.damage, fromX, fromZ);
        this.resolve(hit.ped, res, 'shot', fromX, fromZ, true);
      } else if (hit.v) {
        applyDamage(hit.v.damage, w.damage * VEHICLE_SHARE);
        markPlayerHit(hit.v.damage, d.now());
        if (hit.v.ai && d.rand() < 0.25) d.ejectDriver(hit.v, fromX, fromZ);
      }
    }
  }

  /**
   * What a hit did to a ped: a knock-down or knockout is reported (pedDown);
   * a knockout by the player scores KNOCKOUT; anyone left standing reacts.
   */
  private resolve(c: CrowdPed, res: HurtResult, cause: 'punch' | 'shot' | 'blast' | 'fire', fromX: number, fromZ: number, byPlayer: boolean): void {
    if (res === 'none') return;
    const a = c.agent;
    if (res === 'down' || res === 'ko') {
      this.d.bus.emit({ type: 'pedDown', x: a.s.x, z: a.s.z, cause, byPlayer, cop: a.role === 'cop', ko: res === 'ko' });
    }
    if (res === 'ko') {
      if (byPlayer) this.d.award(this.d.score.award('knockout'));
      if (this.lock === c) this.lock = null;
      return;
    }
    if (byPlayer) provoke(a, fromX, fromZ);
    else if (res === 'hit') scare(a, fromX, fromZ, 3);
  }

  /** Gunfire: most people run; armed ones nearby join in. */
  private alarm(x: number, z: number): void {
    const d = this.d;
    for (const c of d.crowd) {
      const a = c.agent;
      const dist = Math.hypot(a.s.x - x, a.s.z - z);
      if (dist > SCARE_RANGE) continue;
      if (a.temper === 'armed' && dist < ARMED_JOIN && d.rand() < 0.5) provoke(a, x, z);
      else scare(a, x, z, 4);
    }
  }

  /**
   * Nearest thing a bullet from (ox, oz) along unit (dx, dz) hits within range.
   * Reports where it stopped as a bulletHit event.
   */
  traceBullet(ox: number, oz: number, dx: number, dz: number, range: number, shooterIsPlayer: boolean): Hit {
    const d = this.d;
    let best = range;
    let wall = false;
    const hit = this.hit;
    hit.kind = 'none';
    hit.ped = null;
    hit.v = null;
    for (const r of d.grid.near(ox + (dx * range) / 2, oz + (dz * range) / 2, range / 2 + 1)) {
      const t = rayRect(ox, oz, dx, dz, r);
      if (t < best) {
        best = t;
        wall = true;
      }
    }
    for (const c of d.crowd) {
      if (c.agent.mode === 'down') continue;
      const t = rayCircle(ox, oz, dx, dz, this.circle(c.agent.s.x, c.agent.s.z, PED_HIT_RADIUS));
      if (t > 0.3 && t < best) {
        best = t;
        hit.kind = 'ped';
        hit.ped = c;
      }
    }
    const own = d.player.driving;
    for (const v of d.vehicles) {
      if (shooterIsPlayer && v === own) continue;
      for (const q of carCircles(v.sim, this.circles)) {
        const t = rayCircle(ox, oz, dx, dz, this.circle(q.x, q.z, CAR_CIRCLE_RADIUS * 0.9));
        if (t > 0.3 && t < best) {
          best = t;
          hit.kind = 'vehicle';
          hit.ped = null;
          hit.v = v;
        }
      }
    }
    const p = d.player;
    if (!shooterIsPlayer && !p.driving && p.alive && d.playing()) {
      const t = rayCircle(ox, oz, dx, dz, this.circle(p.ped.x, p.ped.z, PED_HIT_RADIUS));
      if (t > 0.3 && t < best) {
        best = t;
        hit.kind = 'player';
        hit.ped = null;
        hit.v = null;
      }
    }
    d.bus.emit({
      type: 'bulletHit',
      x: ox + dx * best,
      z: oz + dz * best,
      target: hit.kind !== 'none' ? hit.kind : wall ? 'wall' : 'none',
      fromX: ox,
      fromZ: oz,
      byPlayer: shooterIsPlayer,
      police: hit.v !== null && (hit.v.archetype === 'police' || hit.v.police === true),
    });
    return hit;
  }

  /** The reused ray-test circle, set to (x, z, r). */
  private circle(x: number, z: number, r: number): { x: number; z: number; r: number } {
    this.ray.x = x;
    this.ray.z = z;
    this.ray.r = r;
    return this.ray;
  }

  private rocketHits(x: number, z: number, r: number, byPlayer: boolean): boolean {
    const d = this.d;
    for (const c of d.crowd) {
      if (c.agent.mode !== 'down' && Math.hypot(c.agent.s.x - x, c.agent.s.z - z) < r + 0.35) return true;
    }
    const own = d.player.driving;
    for (const v of d.vehicles) {
      if (byPlayer && v === own) continue;
      if (this.nearestPart(v, x, z) < r * 0.8) return true;
    }
    const p = d.player;
    return !byPlayer && !p.driving && p.alive && Math.hypot(p.ped.x - x, p.ped.z - z) < r + 0.35;
  }

  /** A car whose body covers (x, z) (within `pad` m), or null. */
  private carAt(x: number, z: number, pad: number): Vehicle | null {
    for (const v of this.d.vehicles) if (this.nearestPart(v, x, z) < pad) return v;
    return null;
  }

  /** Distance from (x, z) to the surface of the car's body (0 inside), m. */
  private nearestPart(v: Vehicle, x: number, z: number): number {
    const s = v.sim;
    if (Math.abs(s.x - x) > 12 || Math.abs(s.z - z) > 12) return Math.hypot(s.x - x, s.z - z) - CAR_CIRCLE_OFFSETS[2] - CAR_CIRCLE_RADIUS;
    let best = Infinity;
    for (const q of carCircles(s, this.circles)) best = Math.min(best, Math.hypot(q.x - x, q.z - z));
    return Math.max(0, best - CAR_CIRCLE_RADIUS);
  }

  /** Lock-on candidates: every ped on their feet (not within `near` m of the player), hostiles flagged. */
  private gatherPeds(near = 0): void {
    this.candidateCount = 0;
    const wanted = this.d.stars() > 0;
    const me = this.d.player.ped;
    for (const c of this.d.crowd) {
      const a = c.agent;
      if (a.mode === 'down' || (near > 0 && Math.hypot(a.s.x - me.x, a.s.z - me.z) < near)) continue;
      const hostile = a.mode === 'fight' || a.mode === 'shoot' || (a.role === 'cop' && wanted);
      this.push(a.s.x, a.s.z, hostile, c, null);
    }
  }

  /** Peds plus cars (not `except`, not wrecks): police cars are hostile while wanted. */
  private gatherAll(except: Vehicle | null = null, near = 0): void {
    this.gatherPeds(near);
    const wanted = this.d.stars() > 0;
    const me = this.d.player.ped;
    for (const v of this.d.vehicles) {
      if (v === except || v.damage.wrecked) continue;
      if (near > 0 && Math.hypot(v.sim.x - me.x, v.sim.z - me.z) < near) continue;
      this.push(v.sim.x, v.sim.z, wanted && (v.archetype === 'police' || v.police === true), null, v);
    }
  }

  private push(x: number, z: number, hostile: boolean, ped: CrowdPed | null, car: Vehicle | null): void {
    let c = this.candidates[this.candidateCount];
    if (!c) c = this.candidates[this.candidateCount] = { x: 0, z: 0, hostile: false, vehicle: false, ped: null, car: null };
    c.x = x;
    c.z = z;
    c.hostile = hostile;
    c.vehicle = car !== null;
    c.ped = ped;
    c.car = car;
    this.candidateCount++;
  }
}

/** How close a weapon's lock-on and aim assist may pick targets, m. */
function minAim(mode: FireMode): number {
  return mode === 'launcher' ? LAUNCHER_MIN_AIM : 0;
}
