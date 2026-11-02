/**
 * Fires and the fire trucks that put them out. A car blowing up leaves its
 * wreck burning, and a grenade or rocket going off against a building sets
 * the wall alight (systems/emergency.ts FireBoard: they flare up, burn for
 * FIRE_LIFE and die down; MAX_FIRES at once). A fire near the player calls
 * a fire truck (ServiceRun: one in traffic close by, else one from
 * off-screen with lights and siren). It pulls up, the siren stops (the
 * lights keep flashing), two firefighters step down and hose it out
 * (render/emergencyLook.ts draws the flames, the water and the steam),
 * walk back, and it drives off. Unattended fires burn out on their own.
 *
 * Faked light and particles only; the fires hurt nobody (a molotov's
 * still does: systems/projectiles.ts). Held off behind the title, in a
 * timed race or a mission that asks (fires burn out by themselves) and in
 * the tutorial; MAX_TRUCKS at once. Stars don't slow it: your fires get
 * their trucks.
 */
import type { VehicleState } from '../../entities/vehicle';
import { FireBoard, wallFireAt, type Fire } from '../../systems/emergency';
import { BUSY } from '../../systems/cityScenes';
import type { CrowdPed, Vehicle } from '../population';
import { watch, type Scene, type SceneCtx, type Subject } from '../cityLife';
import { ServiceRun, type ServiceSpec } from './service';
import { len2 } from '../../core/len';
import { secs, type LabelSink } from '../debugLabels';

/** Most trucks out at once. */
export const MAX_TRUCKS = 2;
/** A truck is called once a fire has burned this long, s... */
const CALL_DELAY = 4;
/** ...if it's this close to the player, m... */
const CALL_RANGE = 150;
/** ...and has this long still to burn, s. */
const MIN_LEFT = 20;
/** A grenade or rocket this close to a building's wall sets it alight, m; the fire sits this far out from the face. */
const WALL_RANGE = 4.5;
const WALL_OUT = 0.9;
/** A car's blast is matched to the wreck within this, m. */
const WRECK_MATCH = 3;
/** Firefighters hose from either side of the fire: this far toward the truck and this far out to the side, m. */
const HOSE_BACK = 2;
const HOSE_SIDE = 4.2;
/** A firefighter wedged on the way starts hosing anyway after this long, s (from up to HOSE_REACH m). */
const WALK_GIVE_UP = 6;
export const HOSE_REACH = 14;
/** Back at the truck, or given up walking back, after this long, s. */
const PACK_UP = 8;
const CREW = 2;
/** subject(): with the truck within this of its fire, frame them both (fully from 20 m closer), m. */
const FRAME_TRUCK = 40;
const FIREFIGHTER = { shirt: '#b8902e', pants: '#2a2a28', hair: '#e2b81c', shoes: '#1a1a1a' };

export const FIRE_TRUCK: ServiceSpec = {
  archetype: 'firetruck',
  paint: '#c3191c',
  claimRange: 140,
  emergency: true,
  cruise: 16,
  top: 24,
  arrive: 22,
  timeout: 80,
  aheadShare: 0.4,
};

/** On site: the crew walking out, hosing, walking back. */
type Work = 'walk' | 'hose' | 'pack';

export interface FireCrew {
  run: ServiceRun;
  fire: Fire;
  fireId: number;
  work: Work;
  timer: number;
  /** The crew has stepped down from the truck. */
  out: boolean;
  /** The firefighters (null until on site, or once back in the truck). */
  readonly men: (CrowdPed | null)[];
  /** Which of them is hosing now (the look draws their jets). */
  readonly hosing: boolean[];
  /** The truck was stolen from under them: they hose on by hand, then walk off (V2-09). */
  stranded: boolean;
}

export class FireCrews implements Scene {
  readonly board = new FireBoard();
  readonly crews: FireCrew[] = [];
  /** The wreck each fire slot burns on (null: a wall). */
  private readonly cars: (Vehicle | null)[] = [];
  private scan = 0;
  private readonly at = { x: 0, z: 0 };

  /** The director's fire scene (for the look and the other scenes). */
  static of(life: SceneCtx): FireCrews | null {
    for (const s of life.scenes) if (s instanceof FireCrews) return s;
    return null;
  }

  constructor(private readonly life: SceneCtx) {
    for (let i = 0; i < this.board.fires.length; i++) this.cars.push(null);
    life.clock.define('fire', { every: [4, 8], cap: MAX_TRUCKS, first: 3, range: CALL_RANGE, hold: BUSY });
    life.d.bus.on('explosion', (e) => {
      if (e.source === 'grenade' || e.source === 'rocket') this.wallFire(e.x, e.z);
      else this.carFire(e.x, e.z);
    });
  }

  get running(): number {
    return this.crews.length;
  }

  step(dt: number): void {
    const board = this.board;
    board.step(dt);
    // Fires on wrecks go where the wreck is pushed; a wreck recycled takes its fire with it.
    for (let i = 0; i < board.fires.length; i++) {
      const f = board.fires[i];
      const car = this.cars[i];
      if (!f.alive || !car) continue;
      if (!car.mesh.root.visible || !car.damage.wrecked) {
        board.drop(f);
        this.cars[i] = null;
        continue;
      }
      f.x = car.sim.x;
      f.z = car.sim.z;
    }
    if ((this.scan -= dt) <= 0) {
      this.scan = 0.5;
      this.dispatch();
    }
    for (let i = this.crews.length - 1; i >= 0; i--) {
      if (this.stepCrew(this.crews[i], dt)) continue;
      this.crews.splice(i, 1);
    }
  }

  reset(): void {
    for (const c of this.crews) this.endCrew(c);
    this.crews.length = 0;
    this.board.clear();
    this.cars.fill(null);
  }

  /** Debug (TEST menu): a truck for the burning fire nearest the player now, whatever holds them off. */
  force(): boolean {
    const life = this.life;
    if (this.crews.length >= MAX_TRUCKS) return false;
    const at = life.d.focus();
    const f = this.board.toCall(at.x, at.z, CALL_RANGE, 0, MIN_LEFT);
    const run = f && ServiceRun.call(life, FIRE_TRUCK, f.x, f.z);
    if (!f || !run) return false;
    f.claimed = true;
    this.crews.push({ run, fire: f, fireId: f.id, work: 'walk', timer: 0, out: false, men: [null, null], hosing: [false, false], stranded: false });
    life.emit('fireTruck', run.v.sim.x, run.v.sim.z);
    return true;
  }

  /** The fire a crew's called to, framed with its truck once it's close; nothing once they're leaving. */
  subject(out: Subject): boolean {
    const c = this.crews[0];
    if (!c || c.run.phase === 'leave' || c.run.phase === 'done' || c.run.phase === 'failed') return false;
    const f = c.fire;
    const t = c.run.v.sim;
    if (!f.alive || f.id !== c.fireId) return watch(out, t.x, t.z, t.vx, t.vz);
    // The truck coming in: the camera meets it halfway.
    const k = 0.5 * Math.max(0, Math.min(1, (FRAME_TRUCK - len2(t.x - f.x, t.z - f.z)) / 20));
    return watch(out, f.x + (t.x - f.x) * k, f.z + (t.z - f.z) * k, t.vx * k, t.vz * k);
  }

  describe(out: LabelSink): void {
    for (const c of this.crews) {
      if (!c.stranded) out.car(c.run.v, c.run.phase === 'drive' ? 'FIRE TRUCK → fire' : 'FIRE TRUCK', 'emergency');
      for (let i = 0; i < c.men.length; i++) {
        const m = c.men[i];
        if (m) out.ped(m, c.hosing[i] ? 'FIREFIGHTER (hosing)' : 'FIREFIGHTER', 'emergency');
      }
    }
    for (const f of this.board.fires) if (f.alive && out.wants(f.x, f.z)) out.spot(f, `FIRE ${secs(f.life - f.age)}${f.claimed ? ' (called)' : ''}`, 'emergency');
  }

  /** A car went up at (x, z): its wreck burns on. */
  private carFire(x: number, z: number): void {
    let wreck: Vehicle | null = null;
    let best = WRECK_MATCH;
    for (const v of this.life.d.vehicles) {
      if (!v.damage.wrecked) continue;
      const d = len2(v.sim.x - x, v.sim.z - z);
      if (d < best) {
        best = d;
        wreck = v;
      }
    }
    const f = this.ignite(wreck ? wreck.sim.x : x, wreck ? wreck.sim.z : z, false);
    const i = this.board.fires.indexOf(f);
    if (this.board.fresh || wreck) this.cars[i] = wreck;
  }

  /** A grenade or rocket by a wall: the building's face catches. */
  private wallFire(x: number, z: number): void {
    if (!wallFireAt(this.life.d.city.buildings, x, z, WALL_RANGE, WALL_OUT, this.at)) return;
    const f = this.ignite(this.at.x, this.at.z, true);
    if (this.board.fresh) this.cars[this.board.fires.indexOf(f)] = null;
  }

  private ignite(x: number, z: number, building: boolean): Fire {
    const f = this.board.start(x, z, building);
    if (this.board.fresh) this.life.emit('fire', f.x, f.z);
    return f;
  }

  /** Send a truck to the nearest fire nobody's coming for. */
  private dispatch(): void {
    const life = this.life;
    if (this.board.burning === 0 || !life.due('fire', this.crews.length)) return;
    const at = life.d.focus();
    const f = this.board.toCall(at.x, at.z, CALL_RANGE, CALL_DELAY, MIN_LEFT);
    if (!f) return;
    const run = ServiceRun.call(life, FIRE_TRUCK, f.x, f.z);
    if (!run) {
      life.clock.defer('fire', life.now, 2);
      return;
    }
    life.clock.start('fire', life.now);
    f.claimed = true;
    this.crews.push({ run, fire: f, fireId: f.id, work: 'walk', timer: 0, out: false, men: [null, null], hosing: [false, false], stranded: false });
    life.emit('fireTruck', run.v.sim.x, run.v.sim.z);
  }

  /** One crew's step; false when it's over (and tidied up). */
  private stepCrew(c: FireCrew, dt: number): boolean {
    const run = c.run;
    const f = c.fire;
    const burning = f.alive && f.id === c.fireId;
    if (c.stranded) return this.onFoot(c, burning, dt);
    if (run.phase === 'drive') {
      // Burnt out before it got there: back to the station, lights off.
      if (!burning) run.leave();
      else run.goTo(f.x, f.z);
    }
    const phase = run.step(dt);
    if (phase === 'done' || phase === 'failed') {
      // The player took the truck mid-job: the crew's left on the pavement, hosing on by hand.
      if (c.out && burning && run.v === this.life.d.player.driving && this.strand(c)) return true;
      this.endCrew(c);
      return false;
    }
    if (phase === 'onSite') this.work(c, burning, dt);
    return true;
  }

  /** On site: out of the truck, hose it down, back in, off. */
  private work(c: FireCrew, burning: boolean, dt: number): void {
    const life = this.life;
    const v = c.run.v;
    const f = c.fire;
    if (!c.out) {
      c.out = true;
      // Pulled up: the wail stops (traffic needn't give way), the lights flash on.
      v.emergency = false;
      for (let i = 0; i < CREW; i++) {
        const door = this.doorOf(v.sim, i === 0 ? 1 : -1);
        c.men[i] = life.addPed(door.x, door.z, v.sim.heading, FIREFIGHTER, 'ped_stocky');
      }
    }
    c.timer += dt;
    if (c.work !== 'pack' && !burning) {
      // Out (hosed or burnt out): back to the truck.
      c.work = 'pack';
      c.timer = 0;
    }
    let hoses = 0;
    let home = 0;
    for (let i = 0; i < CREW; i++) {
      const m = c.men[i];
      c.hosing[i] = false;
      if (!m) {
        home++;
        continue;
      }
      if (!life.present(m)) {
        c.men[i] = null;
        home++;
        continue;
      }
      if (m.agent.mode === 'down') {
        // Knocked over: the rest carry on without them (they're picked up when the truck goes).
        if (c.work === 'pack') home++;
        continue;
      }
      const s = m.agent.s;
      if (c.work === 'pack') {
        const door = this.doorOf(v.sim, i === 0 ? 1 : -1);
        life.walkTo(m, door.x, door.z);
        if (len2(s.x - door.x, s.z - door.z) < 1.1 || c.timer > PACK_UP) {
          life.removePed(m);
          c.men[i] = null;
          home++;
        }
        continue;
      }
      // Their spot: either side of the fire, a little toward the truck.
      this.stand(v.sim, f, i === 0 ? 1 : -1);
      const dist = len2(s.x - this.at.x, s.z - this.at.z);
      const reach = len2(s.x - f.x, s.z - f.z);
      if (dist < 1 || (c.timer > WALK_GIVE_UP && reach < HOSE_REACH)) {
        life.walkTo(m, s.x, s.z);
        life.lookAt(m, f.x, f.z);
        c.hosing[i] = true;
        hoses++;
      } else life.walkTo(m, this.at.x, this.at.z);
    }
    if (c.work === 'walk' && hoses > 0) {
      c.work = 'hose';
      life.emit('hose', f.x, f.z);
    }
    if (hoses > 0 && this.board.hose(f, dt, hoses)) {
      life.emit('fireOut', f.x, f.z);
      c.work = 'pack';
      c.timer = 0;
    }
    if (c.work === 'pack' && home >= CREW) c.run.leave();
    else if (c.work !== 'pack' && c.timer > WALK_GIVE_UP * 3 && hoses === 0) {
      // Nobody could get to it: off they go.
      c.work = 'pack';
      c.timer = 0;
    }
  }

  /** Left behind by their truck: a wave after it, and on with the job. False if nobody's left to. */
  private strand(c: FireCrew): boolean {
    let any = false;
    for (const m of c.men) {
      if (!m || !this.life.present(m)) continue;
      any = true;
      if (m.agent.mode !== 'down') m.model.hail(1.6);
    }
    c.stranded = any;
    return any;
  }

  /**
   * A stranded crew: each firefighter in reach hoses from where they stand
   * (the rest walk in closer), at a crew's pace, so a borrowed fire truck's
   * monitor beats them to it if the player's quick. Out (or burnt out),
   * they walk off as passers-by. False once over.
   */
  private onFoot(c: FireCrew, burning: boolean, dt: number): boolean {
    const life = this.life;
    const f = c.fire;
    let hoses = 0;
    let left = 0;
    for (let i = 0; i < CREW; i++) {
      const m = c.men[i];
      c.hosing[i] = false;
      if (!m) continue;
      if (!life.present(m)) {
        c.men[i] = null;
        continue;
      }
      left++;
      if (!burning || m.agent.mode === 'down') continue;
      const s = m.agent.s;
      const d = len2(s.x - f.x, s.z - f.z) || 1;
      if (d < HOSE_REACH) {
        life.walkTo(m, s.x, s.z);
        life.lookAt(m, f.x, f.z);
        c.hosing[i] = true;
        hoses++;
      } else life.walkTo(m, f.x + ((s.x - f.x) / d) * 6, f.z + ((s.z - f.z) / d) * 6);
    }
    if (hoses > 0 && this.board.hose(f, dt, hoses)) {
      life.emit('fireOut', f.x, f.z);
      burning = false;
    }
    if (burning && left > 0) return true;
    if (f.id === c.fireId) f.claimed = false;
    for (let i = 0; i < CREW; i++) {
      const m = c.men[i];
      c.men[i] = null;
      c.hosing[i] = false;
      if (!m || !life.present(m)) continue;
      // Ordinary people from here (the crowd recycles them once far off).
      m.agent.street = true;
      life.giveBack(m);
    }
    return false;
  }

  /**
   * Where firefighter `side` (±1) stands to hose fire `f` from truck `s`
   * (into `at`): beside the fire, a little toward the truck's nose, clear of
   * the truck.
   */
  private stand(s: VehicleState, f: Fire, side: number): void {
    const nose = (s.body?.reach ?? 4.6) - 0.5;
    let dx = s.x + Math.sin(s.heading) * nose - f.x;
    let dz = s.z + Math.cos(s.heading) * nose - f.z;
    const d = len2(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const k = Math.min(HOSE_BACK, d);
    this.at.x = f.x + dx * k + dz * side * HOSE_SIDE;
    this.at.z = f.z + dz * k - dx * side * HOSE_SIDE;
  }

  /** The truck's cab door on `side` (+1 the driver's), into `at`. */
  private doorOf(s: VehicleState, side: number): { x: number; z: number } {
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const out = (s.body?.halfWidth ?? 1.2) + 0.7;
    const along = (s.body?.reach ?? 4.6) * 0.45;
    this.at.x = s.x + fz * side * out + fx * along;
    this.at.z = s.z - fx * side * out + fz * along;
    return this.at;
  }

  /** Off the call: the fire free for another truck, the crew gone, the truck back in traffic. */
  private endCrew(c: FireCrew): void {
    if (c.fire.id === c.fireId) c.fire.claimed = false;
    for (let i = 0; i < CREW; i++) {
      const m = c.men[i];
      if (m && this.life.present(m)) this.life.removePed(m);
      c.men[i] = null;
      c.hosing[i] = false;
    }
    c.run.end();
  }
}
