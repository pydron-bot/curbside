/**
 * Car alarms. Bump into a parked car (any car's crash against it), shoot
 * it, or set a blast off close by, and its alarm goes off: the indicators
 * flash (render/emergencyLook.ts) and the siren sounds in cycles (a
 * `street` 'alarm' event every ALARM_CYCLE s, which GameAudio plays).
 * It stops after ALARM_SECONDS, or as soon as the car's driven off (it
 * stops being `parked`), towed, wrecked or recycled. MAX_ALARMS at once
 * (systems/emergency.ts AlarmBoard). Not behind the title.
 *
 * The player's air horn (W3-B) sets off every parked car in its cone, and
 * the first blast that does since its clock ran down is a chain of the
 * player's (Your Mess, Their Problem): the blast, then the alarm, DOMINO
 * ×2. LOUD: not while wanted, in an activity or the cold open. Every blast
 * also goes out as a `noise` street event (the scanner's noise complaint).
 */
import type { EventOf } from '../../core/events';
import { HORN_CHAIN_EVERY, hornHit } from '../../systems/airHorn';
import { AlarmBoard, MAX_ALARMS, alarmPattern, onBody } from '../../systems/emergency';
import { IN_PLAY, LOUD } from '../../systems/cityScenes';
import type { Vehicle } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import { len2 } from '../../core/len';
import { secs, type LabelSink } from '../debugLabels';

/** A crash or bullet within this of a parked car's body is a hit on it, m. */
const HIT_MARGIN = 0.6;
/** A blast this close sets every parked car's alarm off, m. */
const BLAST_RANGE = 14;

export class CarAlarms implements Scene {
  readonly board = new AlarmBoard<Vehicle>();

  /** The director's alarms (for the look). */
  static of(life: SceneCtx): CarAlarms | null {
    for (const s of life.scenes) if (s instanceof CarAlarms) return s;
    return null;
  }

  constructor(private readonly life: SceneCtx) {
    life.clock.define('alarm', { every: [0, 0], cap: MAX_ALARMS, first: 0, hold: IN_PLAY });
    life.clock.define('airHorn', { every: HORN_CHAIN_EVERY, cap: 1, first: 0, hold: LOUD });
    const bus = life.d.bus;
    bus.on('crash', (e) => {
      if (e.against === 'vehicle') this.hit(e.x, e.z, HIT_MARGIN);
    });
    bus.on('bulletHit', (e) => {
      if (e.target === 'vehicle') this.hit(e.x, e.z, HIT_MARGIN);
    });
    bus.on('explosion', (e) => {
      for (const v of life.d.vehicles) if (v.parked && len2(v.sim.x - e.x, v.sim.z - e.z) < BLAST_RANGE) this.setOff(v);
    });
    bus.on('airHorn', (e) => this.horn(e));
  }

  /** An air horn blast: parked cars in its cone go off; the player's first in a while starts a chain. */
  private horn(e: EventOf<'airHorn'>): void {
    const life = this.life;
    if (!life.d.playing()) return;
    if (e.byPlayer) life.emit('noise', e.x, e.z);
    let first: Vehicle | null = null;
    for (const v of life.d.vehicles) {
      if (!v.parked) continue;
      const s = v.sim;
      if (hornHit(e.x, e.z, e.dirX, e.dirZ, s.x, s.z, s.body?.halfWidth ?? 1, e.reach) < 0) continue;
      // One already going doesn't start a chain (no DOMINO for the same alarm twice).
      const was = this.board.sounding(v);
      if (this.setOff(v) && !was && !first) first = v;
    }
    if (!first || !e.byPlayer || !life.due('airHorn', 0)) return;
    life.clock.start('airHorn', life.now);
    const cause = life.chain(null, 'airHorn', e.x, e.z, 'player');
    life.chain(cause, 'alarm', first.sim.x, first.sim.z);
  }

  get running(): number {
    return this.board.count;
  }

  step(dt: number): void {
    const board = this.board;
    if (board.count === 0) return;
    board.step(dt);
    const p = this.life.d.player;
    for (const a of board.alarms) {
      const v = a.car;
      if (!a.alive || !v) continue;
      // Driven off, towed, burning, recycled: it stops.
      if (!v.parked || v === p.driving || v.damage.wrecked || !v.mesh.root.visible) {
        board.end(a);
        continue;
      }
      if (a.cycled) this.life.emit('alarm', v.sim.x, v.sim.z);
    }
  }

  reset(): void {
    this.board.clear();
  }

  /** Debug (TEST menu): the parked car nearest the player (`car`, if given) goes off now. */
  force(car: Vehicle | null = null): boolean {
    let best = 80;
    if (!car) {
      for (const v of this.life.d.vehicles) {
        if (!v.parked || v.damage.wrecked) continue;
        const d = this.life.distance(v.sim.x, v.sim.z);
        if (d < best) {
          best = d;
          car = v;
        }
      }
    }
    if (!car) return false;
    this.board.trigger(car, alarmPattern(car.sim.x, car.sim.z));
    return true;
  }

  describe(out: LabelSink): void {
    for (const a of this.board.alarms) {
      const v = a.car;
      if (a.alive && v && out.wants(v.sim.x, v.sim.z)) out.car(v, `ALARM ${secs(a.left)}`, 'emergency');
    }
  }

  /** A crash or a bullet at (x, z): any parked car it touched goes off. */
  private hit(x: number, z: number, margin: number): void {
    for (const v of this.life.d.vehicles) {
      if (!v.parked) continue;
      const s = v.sim;
      if (onBody(s.x, s.z, s.heading, s.body?.reach ?? 2.4, s.body?.halfWidth ?? 1, x, z, margin)) this.setOff(v);
    }
  }

  /** Set `v`'s alarm off (or keep it going); false if it can't (wrecked, the player's, too many). */
  private setOff(v: Vehicle): boolean {
    const life = this.life;
    if (v.damage.wrecked || v === life.d.player.driving) return false;
    if (!this.board.sounding(v) && !life.due('alarm', this.board.count)) return false;
    this.board.trigger(v, alarmPattern(v.sim.x, v.sim.z));
    life.clock.start('alarm', life.now);
    return true;
  }
}
