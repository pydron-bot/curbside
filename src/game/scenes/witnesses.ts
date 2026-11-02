/**
 * Witnesses to the player's lesser crimes (systems/witnesses.ts has the
 * rules). Heat hands report() a crime that only passers-by saw (on
 * screen, no police near; knocking a civilian down or a carjacking).
 * Whoever saw it (close, facing that way) reacts: the nearest pulls out a
 * phone and calls it in (`phone`: posed holding it up, the look lights
 * its screen), now and then a second does too, others film it on theirs,
 * and the rest run. The call takes 3–5 s: it gets through (heat.called,
 * via deps.callIn, `witnessCall`) unless every caller is knocked down or
 * scared off, or the player gets out of range first. With nobody about
 * to see it, report() says no and heat counts the crime at once, as
 * before. Someone knocking down a fleeing mugger isn't reported at all.
 */
import { scare } from '../../systems/crowd';
import type { Crime } from '../../systems/wanted';
import { CALL_SECONDS, DELAYED_CRIMES, react, sees, stepCall, type CallState } from '../../systems/witnesses';
import { inRect, type CrowdPed } from '../population';
import type { Scene, SceneCtx } from '../cityLife';
import { witnessText, type LabelSink } from '../debugLabels';
import { handBack, roomFor } from './people';
import type { Muggings } from './muggings';
import { len2 } from '../../core/len';

/** At most this many react to one crime (the nearest). */
const MAX_WITNESSES = 5;
/** At most this many on the phone at once (callers and filmers). */
const MAX_PHONES = 6;
/** Callers per crime. */
const CALLERS_EACH = 2;
/** Filming lasts this long, s. */
const FILM_SECONDS = [4, 8] as const;
/** After a call gets through, they keep the phone up this long, s. */
const LINGER = 1.5;
/** A stamp (game/stamps.ts) gets at most this many filming it... */
const STAMP_FILMERS = 4;
/** ...for this long, s... */
const STAMP_FILM = [3, 5] as const;
/** ...none closer than this to the player (they're running from it, not filming), m. */
const STAMP_CLEAR = 6;
/** A new crime this close to one still being called in goes on the same call, m. */
const SAME_CALL = 30;
/** Crimes one call can carry. */
const CALL_CRIMES = 8;

/** One crime (or several close together) being called in. */
export interface Report {
  x: number;
  z: number;
  crimes: Crime[];
  /** Callers still on the line. */
  calling: number;
  through: boolean;
}

export interface Phone {
  ped: CrowdPed;
  role: 'call' | 'film';
  call: CallState;
  report: Report | null;
  /** Sim time they put it away (filming, or lingering after the call). */
  until: number;
}

export class Witnesses implements Scene {
  readonly kind = 'witnesses';
  readonly phones: Phone[] = [];
  /** The nearest who saw it (reused for each crime). */
  private readonly seen: CrowdPed[] = [];
  private readonly seenD: number[] = [];

  constructor(
    private readonly life: SceneCtx,
    private readonly muggings: Muggings | null = null,
  ) {}

  get running(): number {
    return this.phones.length;
  }

  /**
   * Heat's hook: `crime` at (x, z), seen only by passers-by. True if a
   * witness is calling it in (heat waits for the call), false to count it
   * now (nobody saw, or nobody could call).
   */
  report(crime: Crime, x: number, z: number): boolean {
    const life = this.life;
    if (!DELAYED_CRIMES.has(crime) || !life.d.playing()) return false;
    // The mugger on the run, taken down: everyone's glad.
    if (crime === 'assault' && this.muggings?.isMugger(x, z)) return true;
    // Another crime here while the last is still being called in: it goes on the same call.
    for (const p of this.phones) {
      const r = p.report;
      if (!r || r.through || r.calling === 0 || len2(r.x - x, r.z - z) > SAME_CALL) continue;
      if (r.crimes.length < CALL_CRIMES) r.crimes.push(crime);
      this.react(x, z, null);
      return true;
    }
    const report: Report = { x, z, crimes: [crime], calling: 0, through: false };
    this.react(x, z, report);
    return report.calling > 0;
  }

  step(dt: number): void {
    const life = this.life;
    const now = life.now;
    for (let i = this.phones.length - 1; i >= 0; i--) {
      const p = this.phones[i];
      const c = p.ped;
      const a = c.agent;
      const ok = life.present(c) && a.scene === true && a.mode !== 'down' && a.mode !== 'flee' && a.mode !== 'fight' && a.mode !== 'shoot';
      const r = p.report;
      if (p.role === 'call' && r && p.call.phase === 'calling') {
        const phase = stepCall(p.call, dt, ok && !r.through, life.distance(a.s.x, a.s.z));
        if (phase === 'through' && !r.through) this.through(r, c);
        if (phase !== 'calling') {
          r.calling--;
          p.until = now + (phase === 'through' ? LINGER : 0);
        }
      }
      if (!ok || (p.call.phase !== 'calling' && now >= p.until)) {
        this.putAway(p);
        this.phones.splice(i, 1);
        continue;
      }
      // Standing, watching the player.
      const at = life.d.player.position;
      life.walkTo(c, a.s.x, a.s.z);
      life.lookAt(c, at.x, at.z);
    }
  }

  reset(): void {
    for (const p of this.phones) this.putAway(p);
    this.phones.length = 0;
  }

  describe(out: LabelSink): void {
    for (const p of this.phones) {
      const s = p.ped.agent.s;
      if (out.wants(s.x, s.z)) out.ped(p.ped, witnessText(p.role, p.call.phase, p.call.needs - p.call.time), 'people');
    }
  }

  /** Debug (__ub): the passers-by nearest the player react as if they'd seen a crime right there (a call that counts for nothing). */
  force(): boolean {
    const at = this.life.d.player.position;
    const report: Report = { x: at.x, z: at.z, crimes: [], calling: 0, through: false };
    this.react(at.x, at.z, report, true);
    return this.phones.length > 0;
  }

  /**
   * Named mayhem (a `stamp` at (x, z)): the passers-by in view nearest it
   * stop and film it for a few seconds. Only people already on the street
   * (no new spawns) and within the scenes' people cap; no call is made.
   */
  film(x: number, z: number): number {
    const life = this.life;
    if (!life.d.playing()) return 0;
    const seen = this.seen;
    const seenD = this.seenD;
    seen.length = 0;
    seenD.length = 0;
    const view = life.view;
    for (const c of life.d.population.crowd) {
      const a = c.agent;
      // Walking about: anyone running, fighting or hurt has better things to do.
      if (!a.street || a.scene || a.role !== 'civilian' || a.mode !== 'walk' || a.injured || a.burning > 0) continue;
      if (!inRect(a.s.x, a.s.z, view, -1)) continue;
      const d = len2(a.s.x - x, a.s.z - z);
      if (d < STAMP_CLEAR) continue;
      let k = seen.length;
      if (k === STAMP_FILMERS && d >= seenD[k - 1]) continue;
      if (k === STAMP_FILMERS) k--;
      else {
        seen.push(c);
        seenD.push(d);
      }
      while (k > 0 && seenD[k - 1] > d) {
        seen[k] = seen[k - 1];
        seenD[k] = seenD[k - 1];
        k--;
      }
      seen[k] = c;
      seenD[k] = d;
    }
    let n = 0;
    for (let i = 0; i < seen.length && this.phones.length < MAX_PHONES && roomFor(life); i++) {
      const c = seen[i];
      life.borrow(c);
      c.phone = true;
      this.phones.push({
        ped: c,
        role: 'film',
        call: { phase: 'through', time: 0, needs: 0 },
        report: null,
        until: life.now + STAMP_FILM[0] + life.d.rand() * (STAMP_FILM[1] - STAMP_FILM[0]),
      });
      n++;
    }
    return n;
  }

  /** Whoever saw (x, z) reacts: callers on `report` (if any), filmers, runners. `all`: never mind which way they face. */
  private react(x: number, z: number, report: Report | null, all = false): void {
    const life = this.life;
    const rand = life.d.rand;
    const seen = this.seen;
    const seenD = this.seenD;
    seen.length = 0;
    seenD.length = 0;
    for (const c of life.d.population.crowd) {
      const a = c.agent;
      if (!a.street || a.scene || a.role !== 'civilian' || a.mode === 'down' || a.injured || a.burning > 0) continue;
      if (a.mode !== 'walk' && a.mode !== 'flee') continue;
      if (all ? len2(a.s.x - x, a.s.z - z) > 26 : !sees(a.s.x, a.s.z, a.s.heading, x, z)) continue;
      // Keep the nearest few, nearest first (insertion into a short list).
      const d = len2(a.s.x - x, a.s.z - z);
      let k = seen.length;
      if (k === MAX_WITNESSES && d >= seenD[k - 1]) continue;
      if (k === MAX_WITNESSES) k--;
      else {
        seen.push(c);
        seenD.push(d);
      }
      while (k > 0 && seenD[k - 1] > d) {
        seen[k] = seen[k - 1];
        seenD[k] = seenD[k - 1];
        k--;
      }
      seen[k] = c;
      seenD[k] = d;
    }
    for (let i = 0; i < seen.length; i++) {
      const c = seen[i];
      const room = this.phones.length < MAX_PHONES;
      const what = react(rand, i === 0, room && report !== null && report.calling < CALLERS_EACH);
      if (what === 'flee' || !room) {
        scare(c.agent, x, z, 4);
        continue;
      }
      life.borrow(c);
      c.phone = true;
      const needs = CALL_SECONDS[0] + rand() * (CALL_SECONDS[1] - CALL_SECONDS[0]);
      const film = FILM_SECONDS[0] + rand() * (FILM_SECONDS[1] - FILM_SECONDS[0]);
      if (what === 'call' && report) report.calling++;
      this.phones.push({
        ped: c,
        role: what === 'call' ? 'call' : 'film',
        call: { phase: what === 'call' ? 'calling' : 'through', time: 0, needs },
        report: what === 'call' ? report : null,
        until: life.now + film,
      });
    }
  }

  /** The call got through: the crimes count now. */
  private through(r: Report, caller: CrowdPed): void {
    r.through = true;
    for (const crime of r.crimes) this.life.d.callIn?.(crime);
    this.life.emit('witnessCall', caller.agent.s.x, caller.agent.s.z);
  }

  /** Phone away, back to their day (or left lying, if they were knocked down). */
  private putAway(p: Phone): void {
    handBack(this.life, p.ped);
  }
}
