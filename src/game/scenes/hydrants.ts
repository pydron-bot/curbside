/**
 * Burst hydrants. Knock a hydrant over (anyone's car: a `crash` with prop
 * 'hydrant') and it geysers for 40 s (systems/incidents.ts
 * geyserStrength: a moment to build, full, easing off over the last 8):
 * a column of water and a wet sheen round it (render/incidentsLook.ts),
 * and a gush (`hydrant`) every few seconds. The spray knocks over anyone
 * who walks into it (the player too, on foot), throws scooter riders off
 * (CityLifeDeps.throwRider) and shoves cars aside. People gather well back
 * to gawp (a Gathering crowd, pointing and cheering), or by day when it's
 * dry a few play in it, running round the edge and now and then getting
 * bowled over. Holds: HOLD below.
 */
import { IN_PLAY, type SceneHold } from '../../systems/cityScenes';
import { knockDown, type PedAgent } from '../../systems/crowd';
import {
  GAWP_RADIUS,
  HYDRANT_CLOCK,
  HYDRANT_KNOCK_EVERY,
  HYDRANT_SECONDS,
  geyserStrength,
  kerbOf,
  playsInIt,
  sprayReach,
  type Kerb,
} from '../../systems/incidents';
import { isBike } from '../../entities/vehicle';
import type { CrowdPed, Vehicle } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { labelMembers, secs, type LabelSink } from '../debugLabels';
import { Gathering } from './gathering';
import { handBack, roomFor, streetBody } from './people';
import { len2 } from '../../core/len';

/** Nobody's in the road or fighting: it waits only on someone playing. */
const HOLD: readonly SceneHold[] = IN_PLAY;
/** Kids playing in it by day. */
const KIDS = 3;
const KID_OUTFITS = [
  { shirt: '#ffd23a', pants: '#3a6fd0' },
  { shirt: '#ff6a3a', pants: '#2b2b2b' },
  { shirt: '#3ad0b5', pants: '#7d4fc9' },
];
/** A gush every this long while it's going hard, s. */
const GUSH_EVERY = 3.5;
/** Cars in the spray are shoved aside this hard, m/s². */
const CAR_SHOVE = 6;
/** The player's slot in the knock-down times (not a crowd agent). */
const PLAYER_KEY = {} as PedAgent;

interface Kid {
  ped: CrowdPed;
  /** Round the edge: where on the circle, and which way. */
  angle: number;
  dir: number;
}

export interface Burst {
  x: number;
  z: number;
  age: number;
  /** How hard it's going now (0..1) and how far it reaches (m): the look reads these. */
  strength: number;
  reach: number;
  crowd: Gathering;
  kids: Kid[];
  gushIn: number;
  recruitIn: number;
}

export class Hydrants implements Scene {
  readonly kind = 'hydrant';
  readonly bursts: Burst[] = [];
  /** When each person was last bowled over (so the spray knocks once in a while, not every step). */
  private readonly knocked = new WeakMap<PedAgent, number>();
  private readonly bikes = new WeakMap<Vehicle, number>();
  /** The kids playing in it: soaked and laughing, never bowled over (or they'd run off). */
  private readonly kidsIn = new WeakSet<PedAgent>();
  private readonly kerb: Kerb = { x: 0, z: 0, laneX: 0, laneZ: 0, heading: 0 };

  constructor(private readonly life: SceneCtx) {
    life.clock.define('hydrant', { ...HYDRANT_CLOCK, hold: HOLD });
    life.d.bus.on('crash', (e) => {
      if (e.prop === 'hydrant' && life.due('hydrant', this.bursts.length) && life.near('hydrant', e.x, e.z)) this.start(e.x, e.z);
    });
  }

  get running(): number {
    return this.bursts.length;
  }

  step(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (this.stepOne(this.bursts[i], dt)) continue;
      this.end(this.bursts[i]);
      this.bursts.splice(i, 1);
    }
  }

  reset(): void {
    for (const b of this.bursts) this.end(b);
    this.bursts.length = 0;
  }

  describe(out: LabelSink): void {
    for (const b of this.bursts) {
      if (out.wants(b.x, b.z)) out.spot(b, `BURST HYDRANT ${secs(HYDRANT_SECONDS - b.age)}`, 'emergency');
      labelMembers(out, b.crowd.members, 'GAWPING', false);
      for (const k of b.kids) out.ped(k.ped, 'PLAYING IN IT', 'people');
    }
  }

  subject(out: Subject): boolean {
    const b = this.bursts[0];
    return b !== undefined && b.strength > 0.15 && watch(out, b.x, b.z);
  }

  /** Debug (TEST menu) and the title's show: the hydrant nearest the player bursts now (or a water main at the kerb, with none near). */
  force(): boolean {
    const life = this.life;
    if (this.bursts.length > 0) return false;
    const at = life.d.focus();
    const h = life.d.knockHydrant?.(at.x, at.z, 70);
    if (this.bursts.length > 0) return true;
    if (h) {
      this.start(h.x, h.z);
      return true;
    }
    const spots = life.streetMood.spots;
    const i = life.streetMood.grid.nearest(at.x, at.z, 60, (j) => life.distance(spots[j].x, spots[j].z) > 8);
    if (i < 0) return false;
    const s = spots[i];
    const k = kerbOf(s.x, s.z, s.outX, s.outZ, this.kerb);
    this.start(k.x, k.z);
    return true;
  }

  private start(x: number, z: number): Burst {
    const life = this.life;
    life.clock.start('hydrant', life.now);
    const b: Burst = {
      x,
      z,
      age: 0,
      strength: 0,
      reach: 0,
      crowd: new Gathering(life, { kind: 'crowd', capacity: 8, draw: 30, joinChance: 0.6, stay: [10, 22], radius: GAWP_RADIUS }),
      kids: [],
      gushIn: 0,
      recruitIn: 1.5,
    };
    b.crowd.at(x, z);
    this.bursts.push(b);
    const hour = life.d.hour?.() ?? life.d.mood?.hour ?? 13;
    if (playsInIt(hour, life.d.mood?.raining ?? false) && roomFor(life, KIDS + 2)) {
      // Kids come running from along the pavement (out of the spray's reach).
      for (let i = 0; i < KIDS; i++) {
        const a = (i / KIDS) * Math.PI * 2;
        const ped = life.addPed(x + Math.sin(a) * 9, z + Math.cos(a) * 9, a + Math.PI, KID_OUTFITS[i % KID_OUTFITS.length], streetBody(life, true));
        ped.agent.street = true;
        this.kidsIn.add(ped.agent);
        b.kids.push({ ped, angle: a, dir: i % 2 ? 1 : -1 });
      }
    }
    return b;
  }

  /** One burst's step; false once it's dry. */
  private stepOne(b: Burst, dt: number): boolean {
    const life = this.life;
    b.age += dt;
    b.strength = geyserStrength(b.age);
    b.reach = sprayReach(b.strength);
    if (b.age >= HYDRANT_SECONDS) return false;
    if (b.strength > 0.3 && (b.gushIn -= dt) <= 0) {
      b.gushIn = GUSH_EVERY;
      life.emit('hydrant', b.x, b.z);
    }
    this.spray(b, dt);
    // The gawpers: well back, pointing now and then.
    if ((b.recruitIn -= dt) <= 0) {
      b.recruitIn = 1;
      if (b.age < HYDRANT_SECONDS - 10 && life.lively('hydrant') && roomFor(life, 2)) b.crowd.recruit();
      for (const c of b.crowd.members) {
        const r = life.d.rand();
        if (r < 0.12) c.model.hail(1.2);
        else if (r < 0.2) c.model.cheer(1.4);
      }
    }
    b.crowd.step(dt);
    this.play(b, dt);
    return true;
  }

  /** The kids: round and round the edge, a cheer, now and then straight through it. */
  private play(b: Burst, dt: number): void {
    const life = this.life;
    for (let i = b.kids.length - 1; i >= 0; i--) {
      const k = b.kids[i];
      const a = k.ped.agent;
      if (!life.present(k.ped) || !a.scene || a.mode === 'flee' || a.mode === 'fight' || a.mode === 'shoot') {
        handBack(life, k.ped);
        b.kids.splice(i, 1);
        continue;
      }
      if (a.mode === 'down') continue;
      k.angle += k.dir * dt * 0.9;
      // Round the edge, ducking in and out of it.
      const r = b.strength > 0.1 ? b.reach + 0.2 + 0.7 * Math.sin(b.age * 0.7 + i * 2) : 3;
      life.walkTo(k.ped, b.x + Math.sin(k.angle) * r, b.z + Math.cos(k.angle) * r);
      life.lookAt(k.ped, b.x, b.z);
      const wet = len2(a.s.x - b.x, a.s.z - b.z) < b.reach;
      if (wet && a.stagger <= 0 && life.d.rand() < 1.2 * dt) {
        // Soaked: a stagger out of it, and a whoop.
        a.stagger = 0.45;
        a.s.vx = ((a.s.x - b.x) / (b.reach || 1)) * 2.5;
        a.s.vz = ((a.s.z - b.z) / (b.reach || 1)) * 2.5;
        k.ped.model.cheer(1.2);
      } else if (life.d.rand() < 0.25 * dt) k.ped.model.cheer(1.2);
    }
  }

  /** The spray: anyone in reach bowled over, bikes' riders thrown, cars shoved. */
  private spray(b: Burst, dt: number): void {
    const life = this.life;
    const reach = b.reach;
    if (reach <= 0) return;
    const now = life.now;
    for (const c of life.d.population.crowd) {
      const a = c.agent;
      const s = a.s;
      if (Math.abs(s.x - b.x) > reach || Math.abs(s.z - b.z) > reach || a.mode === 'down' || this.kidsIn.has(a)) continue;
      if (len2(s.x - b.x, s.z - b.z) > reach || now - (this.knocked.get(a) ?? -1e9) < HYDRANT_KNOCK_EVERY) continue;
      this.knocked.set(a, now);
      knockDown(a, b.x, b.z, 3.5 * b.strength + 1, 2);
    }
    const p = life.d.player;
    if (!p.driving && p.alive && !p.down && len2(p.ped.x - b.x, p.ped.z - b.z) < reach && now - (this.knocked.get(PLAYER_KEY) ?? -1e9) >= HYDRANT_KNOCK_EVERY) {
      this.knocked.set(PLAYER_KEY, now);
      p.knockDown(b.x, b.z, 3 * b.strength + 1, 1.2, 'punch', false);
    }
    for (const v of life.d.vehicles) {
      const s = v.sim;
      const r = reach + (s.body?.halfWidth ?? 1);
      if (Math.abs(s.x - b.x) > r || Math.abs(s.z - b.z) > r || s.y > 0.5) continue;
      const d = len2(s.x - b.x, s.z - b.z);
      if (d > r) continue;
      if (isBike(v.archetype)) {
        if (v.tipped || s.vx * s.vx + s.vz * s.vz < 4 || now - (this.bikes.get(v) ?? -1e9) < HYDRANT_KNOCK_EVERY) continue;
        this.bikes.set(v, now);
        life.d.throwRider?.(v);
        continue;
      }
      // A car driving through gets a shove sideways.
      const k = (CAR_SHOVE * b.strength * dt) / (d || 1);
      s.vx += (s.x - b.x) * k;
      s.vz += (s.z - b.z) * k;
    }
  }

  private end(b: Burst): void {
    b.crowd.close();
    for (const k of b.kids) handBack(this.life, k.ped);
    b.kids.length = 0;
  }
}
