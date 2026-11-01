/**
 * Ambulances for the knocked out. Anyone off the street (a passer-by, a
 * driver out of their car) knocked out cold stays down instead of getting
 * up a few seconds later (`injured`), and an ambulance is called
 * (ServiceRun: one in traffic close by takes it, else one comes from
 * off-screen with its lights and siren). It pulls up, a paramedic walks
 * out to them, kneels a moment, and brings them back to the doors on a
 * stretcher (the body slides along a pace behind). Anyone else lying
 * close by is collected on the same trip; then it drives off to the
 * hospital (world/streetSpots.ts placeHospital), lights still on.
 *
 * Bounded: at most MAX_PATIENTS held down at once (anyone over that gets
 * up as before), two ambulances out; a patient no ambulance has reached
 * in PATIENT_WAIT comes round and walks off. Officers, gang members and
 * story characters are other systems' and get up as before.
 */
import type { VehicleState } from '../../entities/vehicle';
import type { CrowdPed } from '../population';
import { STORY_BODIES } from '../bodies';
import { IN_PLAY } from '../../systems/cityScenes';
import type { Scene, SceneCtx } from '../cityLife';
import { ServiceRun, type ServiceSpec } from './service';
import { len2 } from '../../core/len';
import { secs, type LabelSink } from '../debugLabels';

/** Most people held down waiting at once. */
export const MAX_PATIENTS = 6;
/** An ambulance is called this long after someone goes down, s. */
const CALL_DELAY = 3;
/** Nobody came in this long: they come round on their own, s. */
export const PATIENT_WAIT = 100;
/** Only people knocked out this close to the player are held for the ambulance, m. */
const HOLD_RANGE = 120;
/** Another patient this close is collected on the same trip, m. */
const SAME_TRIP = 35;
/** The paramedic kneels by the patient this long, s. */
const TREAT = 2.2;
/** The paramedic gets on with it after this long walking out (wedged), s. */
const WALK_GIVE_UP = 10;
/** No paramedic (knocked over themselves): loaded anyway after this, s. */
const NO_MEDIC_LOAD = 4;
const PARAMEDIC = { shirt: '#eef2f4', pants: '#1f3a6b', hair: '#2a2a2a' };

export const AMBULANCE: ServiceSpec = {
  archetype: 'ambulance',
  paint: '#f4f4f0',
  claimRange: 140,
  emergency: true,
  cruise: 18,
  top: 26,
  arrive: 13,
  timeout: 75,
  aheadShare: 0.4,
};

interface Patient {
  ped: CrowdPed;
  since: number;
  claimed: boolean;
}

/** The paramedic's part on site: walking out, treating, carrying back. */
type Care = 'walk' | 'treat' | 'carry';

interface Crew {
  run: ServiceRun;
  patient: Patient | null;
  paramedic: CrowdPed | null;
  care: Care;
  timer: number;
}

export class Medics implements Scene {
  readonly patients: Patient[] = [];
  readonly crews: Crew[] = [];
  private scan = 0;
  private readonly door = { x: 0, z: 0 };

  constructor(private readonly life: SceneCtx) {
    // Calls go out whenever someone's down (in play: behind the title nobody's hurt for long).
    life.clock.define('medic', { every: [2, 5], cap: 2, first: 2, range: HOLD_RANGE, hold: IN_PLAY });
  }

  get running(): number {
    return this.crews.length;
  }

  step(dt: number): void {
    const life = this.life;
    if ((this.scan -= dt) <= 0) {
      this.scan = 0.25;
      this.findPatients();
      this.dispatch();
    }
    for (let i = this.crews.length - 1; i >= 0; i--) {
      if (this.stepCrew(this.crews[i], dt)) continue;
      this.crews.splice(i, 1);
    }
    // Patients that are gone (taken off, recycled), or that waited too long.
    const now = life.now;
    for (let i = this.patients.length - 1; i >= 0; i--) {
      const p = this.patients[i];
      const a = p.ped.agent;
      if (!life.present(p.ped) || !a.injured) {
        this.patients.splice(i, 1);
        continue;
      }
      if (!p.claimed && now - p.since > PATIENT_WAIT) this.letUp(p, i);
    }
  }

  reset(): void {
    for (const c of this.crews) this.endCrew(c);
    this.crews.length = 0;
    for (const p of this.patients) {
      p.ped.agent.injured = false;
      p.ped.agent.scene = false;
    }
    this.patients.length = 0;
  }

  describe(out: LabelSink): void {
    for (const c of this.crews) {
      const leaving = c.run.phase === 'leave';
      out.car(c.run.v, leaving ? 'AMBULANCE (to hospital)' : c.patient ? 'AMBULANCE → patient' : 'AMBULANCE', 'emergency');
      if (c.paramedic) out.ped(c.paramedic, c.care === 'treat' ? 'MEDIC (treating)' : c.care === 'carry' ? 'MEDIC (stretcher)' : 'MEDIC', 'emergency');
    }
    for (const p of this.patients) {
      const s = p.ped.agent.s;
      if (out.wants(s.x, s.z)) out.ped(p.ped, p.claimed ? 'PATIENT' : `PATIENT (waits ${secs(PATIENT_WAIT - (this.life.now - p.since))})`, 'emergency');
    }
  }

  /** Passers-by knocked out cold near the player stay down as patients (up to the cap). */
  private findPatients(): void {
    const life = this.life;
    // Behind the title nobody calls an ambulance: people get up as before.
    if (this.patients.length >= MAX_PATIENTS || !life.d.playing()) return;
    for (const c of life.d.population.crowd) {
      const a = c.agent;
      if (a.mode !== 'down' || !a.ko || a.injured || !a.street || a.scene || a.role !== 'civilian') continue;
      if (STORY_BODIES.includes(c.model.bodyKind) || !life.near('medic', a.s.x, a.s.z)) continue;
      a.injured = true;
      life.borrow(c);
      this.patients.push({ ped: c, since: life.now, claimed: false });
      if (this.patients.length >= MAX_PATIENTS) return;
    }
  }

  /** Send an ambulance to the longest-waiting patient nobody is coming for. */
  private dispatch(): void {
    const life = this.life;
    let p: Patient | null = null;
    for (const q of this.patients) if (!q.claimed && life.now - q.since > CALL_DELAY && (!p || q.since < p.since)) p = q;
    if (!p || !life.due('medic', this.crews.length)) return;
    const s = p.ped.agent.s;
    const run = ServiceRun.call(life, AMBULANCE, s.x, s.z);
    if (!run) {
      life.clock.defer('medic', life.now, 2);
      return;
    }
    life.clock.start('medic', life.now);
    p.claimed = true;
    this.crews.push({ run, patient: p, paramedic: null, care: 'walk', timer: 0 });
    life.emit('ambulance', run.v.sim.x, run.v.sim.z);
  }

  /** One crew's step; false when it's over (and tidied up). */
  private stepCrew(c: Crew, dt: number): boolean {
    const life = this.life;
    const run = c.run;
    const p = c.patient;
    if (run.phase !== 'leave' && (!p || !life.present(p.ped) || !p.ped.agent.injured)) {
      // The patient's gone (taken, recycled): any other close by? Else off.
      this.nextOrLeave(c);
    }
    if (run.phase === 'drive' && c.patient) run.goTo(c.patient.ped.agent.s.x, c.patient.ped.agent.s.z);
    const phase = run.step(dt);
    if (phase === 'done' || phase === 'failed') {
      this.endCrew(c);
      return false;
    }
    if (phase === 'onSite' && c.patient) this.care(c, dt);
    return true;
  }

  /** On site: the paramedic out to the patient, a moment with them, then back to the doors with them on the stretcher. */
  private care(c: Crew, dt: number): void {
    const life = this.life;
    const v = c.run.v;
    const ps = c.patient!.ped.agent.s;
    const door = this.doorFacing(v.sim, ps.x, ps.z);
    c.paramedic ??= life.addPed(door.x, door.z, Math.atan2(ps.x - door.x, ps.z - door.z), PARAMEDIC);
    const m = c.paramedic;
    if (!life.present(m) || m.agent.mode === 'down') {
      // Knocked over themselves: loaded anyway after a beat.
      if ((c.timer += dt) > NO_MEDIC_LOAD) this.load(c);
      return;
    }
    const ms = m.agent.s;
    if (c.care === 'walk') {
      life.walkTo(m, ps.x, ps.z);
      // Close enough, or held up too long (wedged on the far side of something): on with it.
      if (len2(ms.x - ps.x, ms.z - ps.z) < 1.1 || (c.timer += dt) > WALK_GIVE_UP) {
        c.care = 'treat';
        c.timer = 0;
        life.walkTo(m, ms.x, ms.z);
        life.lookAt(m, ps.x, ps.z);
      }
      return;
    }
    if (c.care === 'treat') {
      if ((c.timer += dt) > TREAT) {
        c.care = 'carry';
        c.timer = 0;
      }
      return;
    }
    // The stretcher: the patient comes along a pace behind the paramedic.
    c.timer += dt;
    life.walkTo(m, door.x, door.z);
    const dx = ps.x - ms.x;
    const dz = ps.z - ms.z;
    const d = len2(dx, dz) || 1;
    if (d > 1.2) {
      ps.x = ms.x + (dx / d) * 1.2;
      ps.z = ms.z + (dz / d) * 1.2;
    }
    ps.vx = ps.vz = 0;
    if (len2(ms.x - door.x, ms.z - door.z) < 1 || c.timer > 14) this.load(c);
  }

  /** In the back with them: the patient and the paramedic off the street; the next one or the hospital. */
  private load(c: Crew): void {
    const life = this.life;
    const p = c.patient;
    if (p) {
      const s = p.ped.agent.s;
      life.emit('patientLoaded', s.x, s.z);
      life.removePed(p.ped);
      const i = this.patients.indexOf(p);
      if (i >= 0) this.patients.splice(i, 1);
    }
    c.patient = null;
    if (c.paramedic) life.removePed(c.paramedic);
    c.paramedic = null;
    this.nextOrLeave(c);
  }

  /** Another patient close by and unclaimed: go to them; else off to the hospital, lights on. */
  private nextOrLeave(c: Crew): void {
    const v = c.run.v;
    if (c.patient) c.patient.claimed = false;
    c.patient = null;
    let best: Patient | null = null;
    let bestD = SAME_TRIP;
    for (const q of this.patients) {
      if (q.claimed) continue;
      const d = len2(q.ped.agent.s.x - v.sim.x, q.ped.agent.s.z - v.sim.z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    c.care = 'walk';
    c.timer = 0;
    if (best) {
      best.claimed = true;
      c.patient = best;
      c.run.redirect(best.ped.agent.s.x, best.ped.agent.s.z);
      return;
    }
    const h = this.life.hospital;
    c.run.leave(h.bayX, h.bayZ);
    c.run.rush();
  }

  /**
   * The ambulance's door nearest (x, z): the back doors, or a side door if
   * the patient's off to that side (so the paramedic never has to walk
   * round the ambulance, which people can't path round).
   */
  private doorFacing(s: VehicleState, x: number, z: number): { x: number; z: number } {
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const along = (x - s.x) * fx + (z - s.z) * fz;
    const across = (x - s.x) * fz - (z - s.z) * fx;
    const reach = s.body?.reach ?? 2.4;
    const half = s.body?.halfWidth ?? 1;
    if (along < -reach * 0.5) return this.life.rearOf(s, this.door);
    const side = across >= 0 ? 1 : -1;
    const back = Math.max(-reach + 0.8, Math.min(reach - 0.8, along));
    this.door.x = s.x + fx * back + fz * side * (half + 0.9);
    this.door.z = s.z + fz * back - fx * side * (half + 0.9);
    return this.door;
  }

  /** Off the call: the patient (if still waiting) free for another crew, the paramedic gone, the ambulance back in traffic. */
  private endCrew(c: Crew): void {
    if (c.patient) c.patient.claimed = false;
    if (c.paramedic && this.life.present(c.paramedic)) this.life.removePed(c.paramedic);
    c.paramedic = null;
    c.run.end();
  }

  /** Nobody came: they come round and walk off. */
  private letUp(p: Patient, i: number): void {
    const a = p.ped.agent;
    a.injured = false;
    a.timer = Math.min(a.timer, 1.5);
    a.scene = false;
    const k = this.life.people.indexOf(p.ped);
    if (k >= 0) this.life.people.splice(k, 1);
    this.patients.splice(i, 1);
  }
}
