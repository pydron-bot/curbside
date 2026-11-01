/**
 * Car alarms. Bump into a parked car (any car's crash against it), shoot
 * it, or set a blast off close by, and its alarm goes off: the indicators
 * flash (render/emergencyLook.ts) and the siren sounds in cycles (a
 * `street` 'alarm' event every ALARM_CYCLE s, which GameAudio plays).
 * It stops after ALARM_SECONDS, or as soon as the car's driven off (it
 * stops being `parked`), towed, wrecked or recycled. MAX_ALARMS at once
 * (systems/emergency.ts AlarmBoard). Not behind the title.
 */
import { AlarmBoard, MAX_ALARMS, alarmPattern, onBody } from '../../systems/emergency';
import { IN_PLAY } from '../../systems/cityScenes';
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

  private setOff(v: Vehicle): void {
    const life = this.life;
    if (v.damage.wrecked || v === life.d.player.driving) return;
    if (!this.board.sounding(v) && !life.due('alarm', this.board.count)) return;
    this.board.trigger(v, alarmPattern(v.sim.x, v.sim.z));
    life.clock.start('alarm', life.now);
  }
}
