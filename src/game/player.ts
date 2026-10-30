/**
 * The player's state and every transition between on foot, driving and dead,
 * in one place. These used to be loose functions in main.ts that called each
 * other mid-change (explode → hurt → die → exit, then exit again), which is
 * how a car blowing up under a wounded player threw a TypeError, and how a
 * dead player could climb into a car and respawn in it.
 *
 * Rules kept here: you can only get in while alive and on your feet; getting
 * out is a no-op on foot; dying gets you out of the car first; a knock-down
 * never shortens a stun (or death) already running; respawn always lands you
 * on foot. An arrest drags you out of the car and holds you, cuffed on the
 * ground, until release. Each transition emits its GameEvent. Pure logic,
 * no three.js.
 */
import type { EventBus } from '../core/events';
import { createPedState, type PedState } from '../entities/pedestrian';
import { driverDoorPosition } from '../entities/vehicle';
import { Arsenal } from '../systems/weapons';
import type { Vehicle } from './population';

export const MAX_HEALTH = 100;
/** Seconds lying "wasted" before respawning. */
export const RESPAWN_SECONDS = 3;
/** Seconds held after an arrest before release at the police station. */
export const BUSTED_SECONDS = 3.5;
/** Your own car blowing up under you: thrown clear, hurt and dazed (once, not also hit by the blast). */
export const OWN_CAR_BLAST_DAMAGE = 35;
const OWN_CAR_THROW_SPEED = 4;
const OWN_CAR_STUN = 2.5;

export type KnockCause = 'vehicle' | 'punch' | 'shot' | 'blast';

export class Player {
  readonly ped: PedState;
  /** Last sim step's ped state, for render interpolation. */
  readonly prev: PedState;
  /** Vehicle being driven, or null when on foot. */
  driving: Vehicle | null = null;
  /** The car last got out of: Population keeps it around rather than recycling it. */
  lastDriven: Vehicle | null = null;
  /** Seconds left lying on the ground. */
  stunned = 0;
  punchCooldown = 0;
  health = MAX_HEALTH;
  /** Seconds until respawn while "wasted"; 0 when alive. */
  dead = 0;
  /** Seconds left in custody after an arrest; 0 when free. */
  custody = 0;
  readonly arsenal = new Arsenal();

  constructor(
    private readonly bus: EventBus,
    x: number,
    z: number,
    heading = Math.PI,
  ) {
    this.ped = createPedState(x, z, heading);
    this.prev = { ...this.ped };
  }

  get alive(): boolean {
    return this.dead <= 0;
  }

  /** Busted and being held (lying cuffed until release). */
  get arrested(): boolean {
    return this.custody > 0;
  }

  /** Alive and on their feet: free to punch, shoot, get in or out. */
  get ready(): boolean {
    return this.alive && this.stunned <= 0;
  }

  /** Lying on the ground (stunned or dead). */
  get down(): boolean {
    return this.stunned > 0 || this.dead > 0;
  }

  /** Where the player is: their car while driving. */
  get position(): { x: number; z: number; vx: number; vz: number } {
    return this.driving ? this.driving.sim : this.ped;
  }

  /** Could they get into a car right now (range and speed are the caller's call)? */
  get canEnter(): boolean {
    return this.ready && this.driving === null;
  }

  /** Get in. Refused while dead, stunned or already driving, or if it's a wreck. */
  enter(v: Vehicle): boolean {
    if (!this.canEnter || v.damage.wrecked) return false;
    this.driving = v;
    this.bus.emit({ type: 'enterVehicle', archetype: v.archetype, police: v.archetype === 'police' || v.police === true });
    return true;
  }

  /**
   * Get out beside the driver's door, moving at (vx, vz) (thrown clear).
   * A no-op on foot. Returns the car left.
   */
  exit(vx = 0, vz = 0): Vehicle | null {
    const v = this.driving;
    if (!v) return null;
    const door = driverDoorPosition(v.sim);
    Object.assign(this.ped, { x: door.x, z: door.z, heading: v.sim.heading, vx, vz });
    Object.assign(this.prev, this.ped);
    this.driving = null;
    this.lastDriven = v;
    this.bus.emit({ type: 'exitVehicle', archetype: v.archetype });
    return v;
  }

  /** Take damage (not while in custody). Returns true if it killed. */
  hurt(amount: number): boolean {
    if (!this.alive || this.arrested || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.bus.emit({ type: 'playerHurt', amount, health: this.health });
    if (this.health > 0) return false;
    this.die();
    return true;
  }

  /**
   * Knocked flat for `seconds`, sliding at `push` m/s away from (fromX, fromZ).
   * Never shortens a stun or death already running.
   */
  knockDown(fromX: number, fromZ: number, push: number, seconds: number, cause: KnockCause, byPlayer: boolean): void {
    this.stunned = Math.max(this.stunned, seconds);
    if (this.driving) return;
    const dx = this.ped.x - fromX;
    const dz = this.ped.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.ped.vx = (dx / d) * push;
    this.ped.vz = (dz / d) * push;
    this.bus.emit({ type: 'pedDown', x: this.ped.x, z: this.ped.z, cause, byPlayer, isPlayer: true });
  }

  /**
   * The car they're in blew up: thrown clear out of the driver's side, hurt
   * and dazed. The caller skips the ordinary blast damage for them.
   */
  ownCarExploded(): void {
    const v = this.driving;
    if (!v) return;
    // Out first, so dying from the damage below doesn't try to get out again.
    const side = v.sim.heading + Math.PI / 2;
    this.exit(Math.sin(side) * OWN_CAR_THROW_SPEED, Math.cos(side) * OWN_CAR_THROW_SPEED);
    this.stunned = Math.max(this.stunned, OWN_CAR_STUN);
    this.bus.emit({ type: 'pedDown', x: this.ped.x, z: this.ped.z, cause: 'blast', byPlayer: true, isPlayer: true });
    this.hurt(OWN_CAR_BLAST_DAMAGE);
  }

  /**
   * Busted: dragged out of the car, weapons taken, held on the ground for
   * BUSTED_SECONDS. Refused while dead or already held. `fine` is the points
   * the run lost, passed on in the 'busted' event.
   */
  arrest(fine = 0): boolean {
    if (!this.alive || this.arrested) return false;
    this.exit();
    this.custody = BUSTED_SECONDS;
    this.stunned = Math.max(this.stunned, BUSTED_SECONDS);
    this.ped.vx = this.ped.vz = 0;
    this.arsenal.clear();
    this.bus.emit({ type: 'busted', fine });
    return true;
  }

  /**
   * Advance timers one sim step. Returns true when it's time to respawn
   * (after dying) or be released (after an arrest; check `arrested` first).
   */
  step(dt: number): boolean {
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    // Stuns wear off on foot (nobody is stunned at the wheel).
    if (!this.driving && this.stunned > 0) this.stunned = Math.max(0, this.stunned - dt);
    this.arsenal.step(dt);
    if (this.custody > 0) {
      this.custody = Math.max(0, this.custody - dt);
      return this.custody === 0;
    }
    return this.dead > 0 && (this.dead -= dt) <= 0;
  }

  /** Back on your feet at (x, z) with full health and no weapons. Always on foot. */
  respawn(x: number, z: number, heading = Math.PI): void {
    this.driving = null;
    this.dead = 0;
    this.custody = 0;
    this.stunned = 0;
    this.punchCooldown = 0;
    this.health = MAX_HEALTH;
    Object.assign(this.ped, { x, z, vx: 0, vz: 0, heading });
    Object.assign(this.prev, this.ped);
    this.bus.emit({ type: 'respawn' });
  }

  private die(): void {
    this.exit();
    this.dead = RESPAWN_SECONDS;
    this.stunned = Math.max(this.stunned, RESPAWN_SECONDS);
    this.arsenal.clear();
    this.bus.emit({ type: 'playerDied' });
  }
}
