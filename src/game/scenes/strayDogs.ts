/**
 * Stray dogs (rules in systems/dogs.ts): a few round the player, more in
 * the suburbs and the docks than downtown, put down on a pavement out of
 * view and taken off once far behind. They chase runners (passers-by and
 * the player), barking (`street` 'bark'), bolt from gunfire, and are
 * knocked over by cars, blasts and punches ('yelp'). Ambient: nothing
 * holds them off. Drawn by render/atmosphereLook.ts in the props' `things`
 * family.
 */
import { DogPack, type Dog, type DogCar, type DogRunner, type DogWorld } from '../../systems/dogs';
import { cornerPoint, scare } from '../../systems/crowd';
import { newSimClock } from '../../systems/simLod';
import { StaticGrid } from '../../world/collision';
import { BLOCKS_PER_SIDE, BLOCK_SIZE, HALF_EXTENT } from '../../world/city';
import { districtAt, type District } from '../../world/districts';
import type { Scene, SceneCtx, Subject } from '../cityLife';
import type { CrowdPed } from '../population';
import { dogText, type LabelSink } from '../debugLabels';
import { len2 } from '../../core/len';

/** Most dogs about at once, × the area's share. */
export const MAX_DOGS = 4;
const AREA: Readonly<Record<District, number>> = { residential: 1, industrial: 1, oldtown: 0.75, arts: 0.5, downtown: 0.4 };
/** Put down this far from the player, m (out of view); taken off past DOG_DROP (out of view). */
const DOG_RING = [30, 70] as const;
const DOG_DROP = 100;
/** Coats in the look's palette. */
export const DOG_COATS = 5;
/** Runners and cars further than this from the player don't matter to any dog, m. */
const CARE = 90;
/** Blasts knock dogs over within this and scare them within SCARE, m; a punch lands within PUNCH. */
const BLAST = 8;
const BLAST_SCARE = 45;
const PUNCH = 1;
/** chaseRunner: a passer-by within this of the player runs for this long, m / s. */
const RUNNER_RANGE = 45;
const RUNNER_SECONDS = 9;

export class StrayDogs implements Scene {
  readonly pack: DogPack;
  private readonly grid: StaticGrid;
  private readonly runners: DogRunner[] = [];
  private readonly cars: DogCar[] = [];
  private readonly runnerPool: DogRunner[] = [];
  private readonly carPool: DogCar[] = [];
  private readonly corner = { x: 0, z: 0 };
  private readonly world: DogWorld;
  /** Someone chaseRunner() set running. */
  private chased: CrowdPed | null = null;

  constructor(private readonly life: SceneCtx) {
    this.pack = new DogPack(life.d.rand, {
      bark: (d: Dog) => life.emit('bark', d.x, d.z),
      yelp: (d: Dog) => life.emit('yelp', d.x, d.z),
    });
    this.grid = new StaticGrid(life.d.city.obstacles);
    const grid = this.grid;
    this.world = {
      runners: this.runners,
      cars: this.cars,
      blocked: (x, z, r) => {
        const near = grid.near(x, z, r);
        for (let i = 0; i < near.length; i++) {
          const o = near[i];
          if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) return true;
        }
        return false;
      },
    };
    life.clock.define('dog', { every: [2, 5], cap: MAX_DOGS, first: 1 });
    const bus = life.d.bus;
    bus.on('shot', (e) => this.pack.startle(e.x, e.z));
    bus.on('explosion', (e) => {
      this.pack.knock(e.x, e.z, BLAST);
      this.pack.startle(e.x, e.z, BLAST_SCARE);
    });
    bus.on('punch', (e) => {
      if (e.byPlayer) this.pack.knock(e.x, e.z, PUNCH);
    });
  }

  get running(): number {
    return this.pack.dogs.length;
  }

  step(dt: number): void {
    const life = this.life;
    const at = life.d.focus();
    // Far behind and out of sight: off the street.
    const dogs = this.pack.dogs;
    for (let i = dogs.length - 1; i >= 0; i--) {
      const d = dogs[i];
      if (len2(d.x - at.x, d.z - at.z) > DOG_DROP && !life.inView(d.x, d.z, 4)) this.pack.remove(d);
    }
    const want = Math.max(1, Math.round(MAX_DOGS * AREA[districtAt(at.x, at.z)]));
    if (dogs.length < want && life.due('dog', dogs.length)) this.putDown(at.x, at.z);
    if (dogs.length === 0) return;
    const lod = life.d.lod;
    if (!lod) {
      this.gather(at.x, at.z);
      this.pack.step(dt, this.world);
      return;
    }
    // Off screen each on its own tick (a chase every step); nobody due, nothing to gather.
    let due = false;
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i];
      if (lod.due((d.lod ??= newSimClock()), lod.tier(d.x, d.z), dt, d.mode === 'chase') > 0) due = true;
    }
    if (!due) return;
    this.gather(at.x, at.z);
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i];
      if (d.lod!.dt > 0) this.pack.stepDog(d, d.lod!.dt, this.world);
    }
  }

  reset(): void {
    this.pack.clear();
    this.chased = null;
  }

  /** Debug (TEST menu): a dog on the pavement nearest the player now (in view), up to the cap. */
  force(): boolean {
    if (this.pack.dogs.length >= MAX_DOGS) return false;
    const at = this.life.d.focus();
    return this.putNear(at.x, at.z, 12, 13) !== null;
  }

  /**
   * The TEST menu and the title's highlights: a passer-by on screen near
   * the player breaks into a run, a dog or two put down just behind them.
   * Null with nobody to run (or no pavement for a dog).
   */
  chaseRunner(): CrowdPed | null {
    const life = this.life;
    const at = life.d.focus();
    let ped: CrowdPed | null = null;
    let best = RUNNER_RANGE;
    for (const c of life.d.population.crowd) {
      const a = c.agent;
      if (!a.street || a.scene || a.role !== 'civilian' || a.mode !== 'walk' || a.injured || !life.inView(a.s.x, a.s.z, -4)) continue;
      const d = len2(a.s.x - at.x, a.s.z - at.z);
      if (d < best) {
        best = d;
        ped = c;
      }
    }
    if (!ped) return null;
    const s = ped.agent.s;
    let dog: Dog | null = null;
    for (let i = 0; i < 2; i++) {
      // Room for them: the furthest dog out of view goes.
      if (this.pack.dogs.length >= MAX_DOGS) this.dropFurthest(at.x, at.z);
      if (this.pack.dogs.length >= MAX_DOGS) break;
      dog = this.putNear(s.x, s.z, 4 + i * 2, 4) ?? dog;
    }
    if (!dog) return null;
    scare(ped.agent, dog.x, dog.z, RUNNER_SECONDS);
    this.chased = ped;
    return ped;
  }

  /** The runner chaseRunner() set off, while they're still running. */
  subject(out: Subject): boolean {
    const c = this.chased;
    if (!c || !this.life.present(c) || c.agent.mode !== 'flee') {
      this.chased = null;
      return false;
    }
    const s = c.agent.s;
    out.x = s.x;
    out.z = s.z;
    out.vx = s.vx;
    out.vz = s.vz;
    return true;
  }

  describe(out: LabelSink): void {
    for (const d of this.pack.dogs) out.spot(d, dogText(d.mode), 'people');
  }

  /** A dog on the pavement of the block at (x, z), as near `want` m from it as can be (within `slack`). */
  private putNear(x: number, z: number, want: number, slack: number): Dog | null {
    const clamp = (v: number) => Math.max(0, Math.min(BLOCKS_PER_SIDE - 1, Math.floor((v + HALF_EXTENT) / BLOCK_SIZE)));
    const bx = clamp(x);
    const bz = clamp(z);
    let best = Infinity;
    let edge = -1;
    let sx = 0;
    let sz = 0;
    // Along the block's four pavement edges.
    for (let e = 0; e < 4; e++) {
      for (let t = 0.1; t < 0.95; t += 0.1) {
        const p = cornerPoint(bx, bz, e, this.corner);
        const px = p.x;
        const pz = p.z;
        const q = cornerPoint(bx, bz, e + 1, this.corner);
        const ex = px + (q.x - px) * t;
        const ez = pz + (q.z - pz) * t;
        const d = Math.abs(len2(ex - x, ez - z) - want);
        if (d < best && d < slack && !this.world.blocked(ex, ez, 0.5)) {
          best = d;
          edge = e;
          sx = ex;
          sz = ez;
        }
      }
    }
    if (edge < 0) return null;
    return this.pack.add(sx, sz, bx, bz, edge + 1, Math.floor(this.life.d.rand() * DOG_COATS));
  }

  /** Take off the dog furthest from (x, z) that's out of view. */
  private dropFurthest(x: number, z: number): void {
    let far: Dog | null = null;
    let farD = 0;
    for (const d of this.pack.dogs) {
      const dist = len2(d.x - x, d.z - z);
      if (dist > farD && !this.life.inView(d.x, d.z, 4)) {
        farD = dist;
        far = d;
      }
    }
    if (far) this.pack.remove(far);
  }

  /** A dog somewhere on a pavement in the ring round the player, out of view. */
  private putDown(x: number, z: number): void {
    const life = this.life;
    const r = life.d.rand;
    const a = r() * Math.PI * 2;
    const dist = DOG_RING[0] + r() * (DOG_RING[1] - DOG_RING[0]);
    const tx = x + Math.sin(a) * dist;
    const tz = z + Math.cos(a) * dist;
    const bx = Math.floor((tx + HALF_EXTENT) / BLOCK_SIZE);
    const bz = Math.floor((tz + HALF_EXTENT) / BLOCK_SIZE);
    if (bx < 0 || bz < 0 || bx >= BLOCKS_PER_SIDE || bz >= BLOCKS_PER_SIDE || r() > AREA[districtAt(tx, tz)]) {
      life.clock.defer('dog', life.now, 0.5);
      return;
    }
    // Somewhere along one of the block's four pavement edges.
    const edge = Math.floor(r() * 4);
    const t = 0.1 + r() * 0.8;
    const p = cornerPoint(bx, bz, edge, this.corner);
    const px = p.x;
    const pz = p.z;
    const q = cornerPoint(bx, bz, edge + 1, this.corner);
    const sx = px + (q.x - px) * t;
    const sz = pz + (q.z - pz) * t;
    if (life.inView(sx, sz, 5) || this.world.blocked(sx, sz, 0.5)) {
      life.clock.defer('dog', life.now, 0.5);
      return;
    }
    this.pack.add(sx, sz, bx, bz, edge + 1, Math.floor(r() * DOG_COATS));
    life.clock.start('dog', life.now);
  }

  /** This step's runners (anyone on foot moving fast near the player) and moving cars. */
  private gather(x: number, z: number): void {
    const d = this.life.d;
    const runners = this.runners;
    const cars = this.cars;
    runners.length = 0;
    cars.length = 0;
    for (const c of d.population.crowd) {
      const s = c.agent.s;
      if (c.agent.mode === 'down' || s.vx * s.vx + s.vz * s.vz < 9) continue;
      if (Math.abs(s.x - x) > CARE || Math.abs(s.z - z) > CARE) continue;
      this.runner(s.x, s.z, s.vx, s.vz, c.agent);
    }
    const p = d.player;
    if (d.playing() && p.alive && !p.driving) this.runner(p.ped.x, p.ped.z, p.ped.vx, p.ped.vz, p);
    for (const v of d.vehicles) {
      const s = v.sim;
      if (s.vx * s.vx + s.vz * s.vz < 9 || !v.mesh.root.visible) continue;
      if (Math.abs(s.x - x) > CARE || Math.abs(s.z - z) > CARE) continue;
      const i = cars.length;
      const car = this.carPool[i] ?? (this.carPool[i] = { x: 0, z: 0, vx: 0, vz: 0, reach: 0, half: 0 });
      car.x = s.x;
      car.z = s.z;
      car.vx = s.vx;
      car.vz = s.vz;
      car.reach = s.body?.reach ?? 2.3;
      car.half = s.body?.halfWidth ?? 1;
      cars.push(car);
    }
  }

  private runner(x: number, z: number, vx: number, vz: number, ref: unknown): void {
    const i = this.runners.length;
    const r = this.runnerPool[i] ?? (this.runnerPool[i] = { x: 0, z: 0, vx: 0, vz: 0, ref: null });
    r.x = x;
    r.z = z;
    r.vx = vx;
    r.vz = vz;
    r.ref = ref;
    this.runners.push(r);
  }
}
