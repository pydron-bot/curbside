/**
 * Gangs on the street (rules in game/gangs.ts). Each hangout's crew stands
 * about on its pavement: they're only put there when you come within
 * MATERIALISE of it (the crowd recycles anyone far from the player), and
 * again after being recycled, in the gang's colours and the crowd's own
 * bodies (no extra draw calls).
 *
 * Respect moves with bus events: knocking one of them over costs it (and
 * the rest of that crew comes for you), hurting the police on their turf
 * earns a little. Below the hostile line they attack on sight; at friendly
 * they let anything go. Free roam only: a Chaos Run has the streets to
 * itself.
 */
import type { GlowSprites } from '../../render/glowSprites';
import type { ProgressProps } from '../../render/progressLook';
import { provoke, spawnPed } from '../../systems/crowd';
import type { Rect } from '../../world/city';
import { districtAt } from '../../world/districts';
import {
  COP_CAR_GAIN,
  COP_DOWN_GAIN,
  DOWN_COST,
  GANGS,
  KO_COST,
  afterCopHurt,
  afterMemberDown,
  createBoombox,
  forgive,
  placeHangouts,
  stepBoombox,
  standing,
  type Boombox,
  type GangDef,
  type Hangout,
  type Standing,
} from '../gangs';
import type { CrowdPed } from '../population';
import type { SaveData } from '../progressSave';
import type { Mode, ModeCtx } from './context';
import { len2 } from '../../core/len';

/** Crews appear when you're this close to their hangout, m. */
const MATERIALISE = 70;
/** Hostile crews turn on you this close, m. */
const SIGHT = 18;
/** A crew backs up one of its own knocked over this close to them, m. */
const BACKUP = 30;

interface Member {
  hangout: Hangout;
  /** Index of the hangout. */
  slot: number;
  /** Where they stand (and walk back to after a fight). */
  homeX: number;
  homeZ: number;
  armed: boolean;
  body: GangDef['bodies'][number];
  ped: CrowdPed | null;
}

/** A gang's respect from the save (0 if it has none yet). */
export function respectOf(save: SaveData, gang: string): number {
  return save.respect[gang] ?? 0;
}

export class GangMode implements Mode {
  readonly hangouts: Hangout[];
  private readonly members: Member[] = [];
  /** Seconds toward the next point of a fading grudge, per gang. */
  private readonly carry = new Map<string, number>();
  /** Each hangout's boombox, and this step's crew there: on the street, in trouble. */
  private readonly boomboxes: Boombox[];
  private readonly present: Uint8Array;
  private readonly trouble: Uint8Array;

  constructor(private readonly ctx: ModeCtx) {
    this.hangouts = placeHangouts();
    this.boomboxes = this.hangouts.map(() => createBoombox());
    this.present = new Uint8Array(this.hangouts.length);
    this.trouble = new Uint8Array(this.hangouts.length);
    this.hangouts.forEach((h, slot) => {
      h.members.forEach((m, i) => {
        this.members.push({
          hangout: h,
          slot,
          homeX: m.x,
          homeZ: m.z,
          // One in each crew carries a gun.
          armed: i === 0,
          body: h.gang.bodies[i % h.gang.bodies.length],
          ped: null,
        });
      });
    });
    const bus = ctx.deps.bus;
    bus.on('pedDown', (e) => {
      if (!e.byPlayer || e.isPlayer || !this.ctx.freeRoam) return;
      if (e.gang) {
        this.memberDown(e.gang, e.x, e.z, e.ko === true);
        return;
      }
      if (e.cop) this.copHurt(e.x, e.z, COP_DOWN_GAIN);
    });
    bus.on('explosion', (e) => {
      if (e.byPlayer && e.police && this.ctx.freeRoam) this.copHurt(e.x, e.z, COP_CAR_GAIN);
    });
  }

  respect(gang: string): number {
    return respectOf(this.ctx.progress.data, gang);
  }

  standing(gang: string): Standing {
    return standing(this.respect(gang));
  }

  step(dt: number): void {
    const ctx = this.ctx;
    if (!ctx.freeRoam) {
      this.clear();
      return;
    }
    for (const g of GANGS) this.fade(g, dt);
    const pop = ctx.deps.population;
    const at = ctx.deps.player.position;
    this.present.fill(0);
    this.trouble.fill(0);
    for (const m of this.members) {
      if (m.ped && !pop.crowd.includes(m.ped)) m.ped = null;
      if (!m.ped) {
        if (len2(at.x - m.homeX, at.z - m.homeZ) > MATERIALISE) continue;
        m.ped = this.materialise(m);
      }
      const a = m.ped.agent;
      this.present[m.slot] = 1;
      if (a.mode !== 'arrest' && a.mode !== 'walk') this.trouble[m.slot] = 1;
      if (a.mode === 'down' || a.mode === 'flee') continue;
      // A fight over (or a scare passed): back to the corner.
      if (a.mode === 'walk') {
        a.mode = 'arrest';
        a.goalX = m.homeX;
        a.goalZ = m.homeZ;
      }
      if (a.mode === 'arrest' && ctx.live && this.standing(m.hangout.gang.id) === 'hostile' && len2(at.x - a.s.x, at.z - a.s.z) < SIGHT) {
        provoke(a, at.x, at.z);
      }
    }
    for (let i = 0; i < this.hangouts.length; i++) {
      const change = stepBoombox(this.boomboxes[i], this.present[i] === 1, this.trouble[i] === 1, dt);
      if (change) this.boombox(i, change);
    }
  }

  /** A hangout's boombox started or stopped: audio plays it (simulation emits, presentation subscribes). */
  private boombox(i: number, change: 'on' | 'off' | 'cut'): void {
    const h = this.hangouts[i];
    this.ctx.deps.bus.emit({ type: 'boombox', id: h.id, x: h.x, z: h.z, on: change === 'on', cut: change === 'cut' });
  }

  private materialise(m: Member): CrowdPed {
    const ctx = this.ctx;
    const agent = spawnPed(0, 0, 0, 0, ctx.deps.rand);
    Object.assign(agent.s, { x: m.homeX, z: m.homeZ, vx: 0, vz: 0, heading: ctx.deps.rand() * Math.PI * 2 });
    agent.temper = m.armed ? 'armed' : 'fighter';
    agent.gang = m.hangout.gang.id;
    // 'arrest' with a goal is how the crowd keeps someone standing at a spot.
    agent.mode = 'arrest';
    agent.goalX = m.homeX;
    agent.goalZ = m.homeZ;
    const g = m.hangout.gang;
    return ctx.deps.population.addPed(agent, { shirt: g.shirt, pants: g.pants }, m.body);
  }

  /** The player knocked one of `gang` over at (x, z): respect, and the crew nearby comes for them. */
  private memberDown(gang: string, x: number, z: number, ko: boolean): void {
    const g = GANGS.find((d) => d.id === gang);
    if (!g) return;
    const before = this.standing(gang);
    this.setRespect(g, afterMemberDown(this.respect(gang), ko));
    this.ctx.notice(`${g.name} RESPECT −${ko ? KO_COST : DOWN_COST}`, 'lost');
    if (this.standing(gang) === 'friendly') return;
    const at = this.ctx.deps.player.position;
    for (const m of this.members) {
      const a = m.ped?.agent;
      if (!a || m.hangout.gang !== g || a.mode === 'down') continue;
      if (len2(a.s.x - x, a.s.z - z) < BACKUP) provoke(a, at.x, at.z);
    }
    this.announce(g, before);
  }

  /** The player hurt the police at (x, z): the gang whose turf it is likes that. */
  private copHurt(x: number, z: number, gain: number): void {
    const g = GANGS.find((d) => d.turf === districtAt(x, z));
    if (!g) return;
    const before = this.standing(g.id);
    const r = afterCopHurt(this.respect(g.id), gain);
    if (r === this.respect(g.id)) return;
    this.setRespect(g, r);
    this.ctx.notice(`${g.name} RESPECT +${gain}`, 'progress');
    this.announce(g, before);
  }

  /** A grudge fading with time played. */
  private fade(g: GangDef, dt: number): void {
    const r = this.respect(g.id);
    if (r >= 0) return;
    const f = forgive(r, this.carry.get(g.id) ?? 0, dt);
    this.carry.set(g.id, f.carry);
    if (f.respect !== r) {
      const before = standing(r);
      this.setRespect(g, f.respect);
      this.announce(g, before);
    }
  }

  private setRespect(g: GangDef, r: number): void {
    const save = this.ctx.progress.data;
    if (r === 0) delete save.respect[g.id];
    else save.respect[g.id] = r;
    this.ctx.progress.markDirty();
  }

  /** A feed line when the gang's standing changes. */
  private announce(g: GangDef, before: Standing): void {
    const now = this.standing(g.id);
    if (now === before) return;
    if (now === 'hostile') this.ctx.notice(`THE ${g.name} WANT YOU DEAD`, 'lost');
    else if (now === 'friendly') this.ctx.notice(`THE ${g.name} RESPECT YOU`, 'progress');
    else if (before === 'hostile') this.ctx.notice(`THE ${g.name} HAVE COOLED OFF`, 'progress');
  }

  /** Crews off the street (a Chaos Run, the title), and their music with them. */
  private clear(): void {
    const pop = this.ctx.deps.population;
    for (const m of this.members) {
      if (m.ped && pop.crowd.includes(m.ped)) pop.removePed(m.ped);
      m.ped = null;
    }
    for (let i = 0; i < this.boomboxes.length; i++) {
      if (stepBoombox(this.boomboxes[i], false, false, 0)) this.boombox(i, 'off');
    }
  }

  hud(): boolean {
    return false;
  }

  prompt(): string | null {
    return null;
  }

  glow(_g: GlowSprites, _props: ProgressProps, _view: Rect): void {}

  reset(): void {
    this.clear();
    this.carry.clear();
  }
}
