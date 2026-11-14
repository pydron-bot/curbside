/**
 * The dodge roll (V3 stage 6, P9): on foot, about ROLL_DISTANCE m in
 * ROLL_SECONDS the way you're pushing (the way you face if you aren't),
 * during which nothing lands on you (Player.hurt and knockDown ignore it),
 * then a short cooldown. Pure: it moves the player's PedState itself while
 * it runs, in place of stepPedestrian; collisions follow as usual.
 */
import type { MoveInput, PedState } from '../entities/pedestrian';

/** How far a roll carries you, m... */
export const ROLL_DISTANCE = 4;
/** ...in this long, s (the Roll clip's own length, BLENDER_TODO §18). */
export const ROLL_SECONDS = 0.35;
/** After a roll ends, this long before the next, s. */
export const ROLL_COOLDOWN = 1.2;
/** Coming out of it at a run, m/s (the clip ends on Run's first frame). */
export const ROLL_EXIT_SPEED = 5;
/** Stick pushed less than this: roll the way you face. */
const STICK_DEADZONE = 0.2;

export class Roll {
  /** Seconds left in the roll (0: not rolling). */
  time = 0;
  /** Seconds before another roll may start. */
  cooldown = 0;
  /** Unit direction of travel (world x, z). */
  dirX = 0;
  dirZ = 1;

  get active(): boolean {
    return this.time > 0;
  }

  /** 0..1 how far through its cooldown (1: ready), for the button. */
  get readiness(): number {
    return this.cooldown <= 0 ? 1 : 1 - Math.min(1, this.cooldown / (ROLL_SECONDS + ROLL_COOLDOWN));
  }

  /**
   * Start a roll: along the stick (screen-relative, as stepPedestrian reads
   * it: screen-up is world -Z), or along `heading` with the stick at rest.
   * False while one is running or cooling down.
   */
  start(move: MoveInput, heading: number): boolean {
    if (this.time > 0 || this.cooldown > 0) return false;
    const mag = Math.hypot(move.x, move.y);
    if (mag > STICK_DEADZONE) {
      this.dirX = move.x / mag;
      this.dirZ = -move.y / mag;
    } else {
      this.dirX = Math.sin(heading);
      this.dirZ = Math.cos(heading);
    }
    this.time = ROLL_SECONDS;
    this.cooldown = ROLL_SECONDS + ROLL_COOLDOWN;
    return true;
  }

  /** The clocks, every sim step (on foot or not). */
  tick(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /**
   * Move `s` this step if rolling (true), facing the roll; the last step
   * covers only what's left, so a roll is ROLL_DISTANCE however the steps fall.
   */
  move(s: PedState, dt: number): boolean {
    if (this.time <= 0) return false;
    const step = Math.min(dt, this.time);
    const speed = ROLL_DISTANCE / ROLL_SECONDS;
    s.x += this.dirX * speed * step;
    s.z += this.dirZ * speed * step;
    s.heading = Math.atan2(this.dirX, this.dirZ);
    this.time -= step;
    const exit = this.time > 0 ? speed : ROLL_EXIT_SPEED;
    s.vx = this.dirX * exit;
    s.vz = this.dirZ * exit;
    return true;
  }

  /** Stop at once (respawn, getting in a car, knocked out of it some other way). */
  reset(): void {
    this.time = 0;
    this.cooldown = 0;
  }
}
