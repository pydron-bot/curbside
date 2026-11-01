/**
 * Something stopped in a traffic lane (a double-parked truck, two cars
 * after a crash): the traffic behind queues up as it does behind anything,
 * leans on the horn after a while (`horn` events: audio sounds them), and
 * now and then the driver at the front of the queue pulls out round it
 * through the oncoming lane when that's clear (traffic's own overtaking,
 * held on until it's past: systems/trafficScenes.ts canPassAround). The
 * rest wait. A scene steps one while its vehicle stands there.
 */
import { CAR_BODY } from '../../entities/vehicle';
import { PASS_SHARE, canPassAround, laneGapAhead, pastBlocker, type Pose } from '../../systems/trafficScenes';
import type { Vehicle } from '../population';
import type { SceneCtx } from '../cityLife';

/** Cars queued this far behind the tail (nose to tail) honk, m. */
const QUEUE_REACH = 40;
/** Queued this long before the first honk, s; then every so often. */
const HONK_AFTER = 2.5;
const HONK_EVERY = [3, 7] as const;
/** The front of the queue decides whether to go round after this long stopped, s. */
const PASS_AFTER = 1.2;
/** How far off its tail's line a queued car still counts as in its lane, m. */
const LANE = 1.6;
/** Further than this from the player, nobody's queuing that the player would see or hear, m. */
const NEAR = 110;

export class LaneBlock {
  /** The last of it (the queue forms behind), and the first (a passing car is past once clear of it). */
  tail: Vehicle | null = null;
  head: Vehicle | null = null;
  /** Cars going round it now. */
  readonly passing: Vehicle[] = [];
  /** Honks so far (tests, __ub). */
  honks = 0;
  private readonly waits = new Map<Vehicle, number>();
  private readonly decided = new WeakSet<Vehicle>();
  /** Drivers who decided to wait it out. */
  private readonly stay = new WeakSet<Vehicle>();
  private readonly poses: Pose[] = [];
  private scan = 0;

  constructor(private readonly life: SceneCtx) {}

  /** Block the lane with `tail` .. `head` (the same vehicle for a truck). */
  set(tail: Vehicle, head: Vehicle): void {
    this.tail = tail;
    this.head = head;
    this.scan = 0;
  }

  /** It's gone: the queue's on its own again (passers finish their pass by themselves). */
  clear(): void {
    this.tail = this.head = null;
    this.passing.length = 0;
    this.waits.clear();
  }

  step(dt: number): void {
    const tail = this.tail;
    const head = this.head;
    if (!tail || !head) return;
    // Hold each passer out in the other lane until it's clear of the front.
    const reach = head.sim.body?.reach ?? CAR_BODY.reach;
    for (let i = this.passing.length - 1; i >= 0; i--) {
      const v = this.passing[i];
      if (!v.ai || v.scene || !v.mesh.root.visible || pastBlocker(v.sim, head.sim, reach, 3) || v.ai.phase !== 'approach') {
        this.passing.splice(i, 1);
        continue;
      }
      v.ai.overtaking = Math.max(v.ai.overtaking, 0.5);
    }
    if ((this.scan -= dt) > 0) return;
    const every = 0.25;
    this.scan = every;
    const life = this.life;
    if (life.distance(tail.sim.x, tail.sim.z) > NEAR) return;
    const poses = this.poses;
    poses.length = 0;
    for (const v of life.d.vehicles) poses.push(v.sim);
    const length = 2 * (tail.sim.body?.reach ?? CAR_BODY.reach);
    let front: Vehicle | null = null;
    let frontGap = Infinity;
    for (const v of life.d.vehicles) {
      const ai = v.ai;
      if (!ai || v === tail || v === head || v.scene || v.police || v.pursuit || v.emergency || ai.mood !== 'calm' || v === life.d.player.driving) continue;
      if (Math.abs(v.sim.x - tail.sim.x) > QUEUE_REACH + length || Math.abs(v.sim.z - tail.sim.z) > QUEUE_REACH + length) continue;
      const gap = laneGapAhead(v.sim, tail.sim, QUEUE_REACH + length / 2, LANE);
      const stopped = gap >= 0 && v.sim.vx * v.sim.vx + v.sim.vz * v.sim.vz < 1;
      if (!stopped) {
        this.waits.delete(v);
        continue;
      }
      const w = (this.waits.get(v) ?? 0) + every;
      this.waits.set(v, w);
      if (w > HONK_AFTER && ai.hornCooldown <= 0) {
        ai.hornCooldown = HONK_EVERY[0] + life.d.rand() * (HONK_EVERY[1] - HONK_EVERY[0]);
        this.honks++;
        life.d.bus.emit({ type: 'horn', x: v.sim.x, z: v.sim.z, duration: 0.3 + life.d.rand() * 0.6 });
      }
      if (gap < frontGap) {
        frontGap = gap;
        front = v;
      }
    }
    // The front of the queue: go round, or wait (each driver decides once).
    if (!front || this.passing.includes(front) || (this.waits.get(front) ?? 0) < PASS_AFTER) return;
    if (!this.decided.has(front)) {
      this.decided.add(front);
      if (life.d.rand() >= PASS_SHARE) this.stay.add(front);
    }
    if (this.stay.has(front)) return;
    if (front.ai!.phase === 'approach' && canPassAround(front.sim, tail.sim, poses, length, LANE)) {
      this.passing.push(front);
      front.ai!.overtaking = 0.5;
      this.waits.delete(front);
    }
  }
}
