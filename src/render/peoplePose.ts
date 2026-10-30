/**
 * Every person placed and posed for the frame: the player and the crowd
 * (officers and story characters included) get their interpolated spot and
 * heading, what they hold, and the state the simulation is in turned into
 * the right clip (characterModel.ts). Also the player's moments that only
 * exist on screen: ducking into a car before vanishing, rocking from a hit,
 * cheering a win. Reads the sim; changes nothing in it.
 */
import type { EventBus } from '../core/events';
import { lerpAngle, speed } from '../entities/vehicle';
import { STORY_BODIES } from '../game/bodies';
import type { Player } from '../game/player';
import type { CrowdPed, Vehicle } from '../game/population';
import { WEAPONS } from '../systems/weapons';
import type { CharacterModel } from './characterModel';

/** Share of the EnterCar clip spent stepping up to the door. */
const BOARD_STEP = 0.4;
/** How far from the car's centre the player stands to get in, m. */
const BOARD_DOOR = 1.45;
/** A car already moving this fast swallows the player at once, m/s. */
const BOARD_FAST = 4;
/** The gun stays up this long after the player's last shot, s... */
const AIM_LINGER = 1.2;
/** ...and is lowered while sprinting faster than this without aiming, m/s. */
const SPRINT_LOWER = 4;
/** A hit rocks the player back this long, s. */
const HURT_STAGGER = 0.22;
/** Story characters this close to a win cheer it, m. */
const CHEER_RANGE = 25;
const PLAYER_CHEER = 3;
const STORY_CHEER = 3.5;

export interface PeoplePoseDeps {
  bus: EventBus;
  player: Player;
  /** The player's body. */
  model: CharacterModel;
  crowd: readonly CrowdPed[];
  /** The gun is locked on to someone (it stays up). */
  locked(): boolean;
  /** In play (false behind the title). */
  playing(): boolean;
}

export class PeoplePose {
  /** The car the player is ducking into (shown at its door until the clip ends). */
  private boardCar: Vehicle | null = null;
  private boardTime = 0;
  private boardFor = 0;
  private readonly boardFrom = { x: 0, z: 0, heading: 0 };
  private sinceShot = Infinity;

  constructor(private readonly d: PeoplePoseDeps) {
    const bus = d.bus;
    bus.on('enterVehicle', () => this.board());
    bus.on('exitVehicle', () => (this.boardCar = null));
    bus.on('respawn', () => {
      this.boardCar = null;
      d.model.reset();
    });
    bus.on('shot', (e) => {
      if (e.byPlayer && !e.driveBy) this.sinceShot = 0;
    });
    bus.on('playerHurt', (e) => {
      const p = d.player;
      if (!p.driving && p.alive && !p.down && e.health > 0) d.model.stagger(HURT_STAGGER);
    });
    bus.on('celebrate', (e) => this.celebrate(e.x, e.z));
  }

  /**
   * Place and pose everyone for this frame. `dt` is the animation step (real
   * time, slowed by hit-stop), `alpha` the render interpolation between the
   * last two sim steps, `aimHeading` the player's deliberate aim or null.
   */
  update(dt: number, alpha: number, aimHeading: number | null): void {
    for (const c of this.d.crowd) poseCrowdPed(c, dt, alpha);
    this.posePlayer(dt, alpha, aimHeading);
  }

  private posePlayer(dt: number, alpha: number, aimHeading: number | null): void {
    const p = this.d.player;
    const m = this.d.model;
    const ped = p.ped;
    this.sinceShot += dt;
    if (this.boardCar) this.stepBoard(dt);
    else {
      m.root.position.set(lerp(p.prev.x, ped.x, alpha), 0, lerp(p.prev.z, ped.z, alpha));
      m.root.rotation.y = lerpAngle(p.prev.heading, ped.heading, alpha);
    }
    const held = this.boardCar ? null : p.arsenal.current;
    const moving = this.boardCar ? 0 : Math.hypot(ped.vx, ped.vz);
    // Guns are up while aiming, locked on, just fired or not sprinting; throwables are held low.
    const raised = held !== null && WEAPONS[held].mode !== 'throw' && (aimHeading !== null || this.d.locked() || this.sinceShot < AIM_LINGER || moving < SPRINT_LOWER);
    m.hold(held, raised);
    m.arrested = p.arrested;
    m.update(dt, moving, p.down, p.dead > 0 ? Infinity : p.stunned);
  }

  /** Just got in: step to the driver's door and duck in (EnterCar), then vanish. */
  private board(): void {
    const p = this.d.player;
    const m = this.d.model;
    const car = p.driving;
    const shown = m.root.visible && this.d.playing() && car !== null;
    const takes = shown ? m.enterCar() : 0;
    if (!shown || takes <= 0 || speed(car.sim) > BOARD_FAST) {
      m.root.visible = false;
      return;
    }
    this.boardCar = car;
    this.boardTime = 0;
    this.boardFor = takes;
    this.boardFrom.x = m.root.position.x;
    this.boardFrom.z = m.root.position.z;
    this.boardFrom.heading = m.root.rotation.y;
  }

  private stepBoard(dt: number): void {
    const car = this.boardCar!;
    const m = this.d.model;
    this.boardTime += dt;
    if (this.boardTime >= this.boardFor || speed(car.sim) > BOARD_FAST || !car.mesh.root.visible) {
      this.boardCar = null;
      m.root.visible = false;
      return;
    }
    // The driver's door (as driverDoorPosition, without the garbage): left of the car, a little forward.
    const h = car.sim.heading;
    const doorX = car.sim.x + Math.cos(h) * BOARD_DOOR + Math.sin(h) * 0.3;
    const doorZ = car.sim.z - Math.sin(h) * BOARD_DOOR + Math.cos(h) * 0.3;
    const k = Math.min(1, this.boardTime / (this.boardFor * BOARD_STEP));
    const e = 1 - (1 - k) * (1 - k);
    const from = this.boardFrom;
    m.root.position.set(lerp(from.x, doorX, e), 0, lerp(from.z, doorZ, e));
    // Facing the car, into the door.
    m.root.rotation.y = lerpAngle(from.heading, Math.atan2(car.sim.x - doorX, car.sim.z - doorZ), e);
  }

  /** A win: the player (on foot) and any story character close by cheer. */
  private celebrate(x: number, z: number): void {
    const p = this.d.player;
    if (!p.driving && p.alive && !p.down && this.d.model.root.visible) this.d.model.cheer(PLAYER_CHEER);
    for (const c of this.d.crowd) {
      if (!STORY_BODIES.includes(c.model.bodyKind) || c.agent.mode === 'down') continue;
      if (Math.hypot(c.agent.s.x - x, c.agent.s.z - z) < CHEER_RANGE) c.model.cheer(STORY_CHEER);
    }
  }
}

/** One crowd member (officers too): where they are, what they hold, what they're doing. */
function poseCrowdPed(c: CrowdPed, dt: number, alpha: number): void {
  const a = c.agent;
  const s = a.s;
  const m = c.model;
  m.root.position.set(lerp(c.prev.x, s.x, alpha), 0, lerp(c.prev.z, s.z, alpha));
  m.root.rotation.y = lerpAngle(c.prev.heading, s.heading, alpha);
  // Shooters draw (SWAT an SMG, everyone else a pistol); a hit makes them reel.
  const shooting = a.mode === 'shoot';
  m.hold(shooting ? (c.gun ?? 'pistol') : null, shooting);
  m.cowering = a.cower > 0 && a.mode === 'flee';
  if (a.stagger > 0) m.stagger(a.stagger);
  const down = a.mode === 'down';
  m.update(dt, Math.hypot(s.vx, s.vz), down, down ? a.timer : Infinity);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
