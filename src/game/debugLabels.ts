/**
 * The playtest labels (settings.debugLabels): what the people and cars round
 * the player are up to, as short text with a colour category. The scenes
 * describe what they hold (Scene.describe(out): "MEDIC", "FIRE 54s",
 * "RACER 2/4"); describeWorld() then labels whatever's left from its flags
 * (gangs, the police, parked and crashed cars, dropped guns). LabelBoard
 * collects them, keeps the ones in view within range of the player and
 * sorts them nearest first; ui/labelsOverlay.ts draws them at ~5 Hz.
 *
 * Pure: no three.js, no DOM. Nothing here runs unless the labels are on.
 */
import type { PedMode } from '../systems/crowd';
import type { PoliceUnit } from '../systems/police';
import type { Drop } from '../world/drops';
import { DROP_LIFE } from '../world/drops';
import type { Rect } from '../world/city';
import { GANGS } from './gangs';
import { STORY_BODIES } from './bodies';
import { RIVALS } from '../systems/turfWar';
import type { CrowdPed, Vehicle } from './population';

/** Colour by category: emergency red, police blue, gangs their own, people amber, traffic grey, missions pink. */
export type LabelCat = 'emergency' | 'police' | 'gang' | 'people' | 'traffic' | 'mission';

/** Something a label hangs over that isn't a person or a car (a fire, a dropped gun, a dog). */
export interface LabelSpot {
  x: number;
  z: number;
  /** Pooled records (fires, drops) go out when this turns false. */
  alive?: boolean;
}

/** Where the scenes write their labels. The first label for a person or car wins. */
export interface LabelSink {
  ped(c: CrowdPed, text: string, cat: LabelCat, colour?: string): void;
  car(v: Vehicle, text: string, cat: LabelCat, colour?: string): void;
  spot(at: LabelSpot, text: string, cat: LabelCat, colour?: string): void;
  /** Would (x, z) get a label (in range and in view)? Check before building a text that changes. */
  wants(x: number, z: number): boolean;
}

export const LABEL_PED = 0;
export const LABEL_CAR = 1;
export const LABEL_SPOT = 2;
export type LabelKind = typeof LABEL_PED | typeof LABEL_CAR | typeof LABEL_SPOT;

export interface LabelRecord {
  kind: LabelKind;
  /** The CrowdPed, Vehicle or LabelSpot. */
  target: CrowdPed | Vehicle | LabelSpot;
  text: string;
  cat: LabelCat;
  /** A gang's colour (overrides the category's). */
  colour: string | null;
  /** Squared distance from the player when collected, m². */
  d2: number;
}

/** Labels shown at most (the overlay's pool). */
export const MAX_LABELS = 24;
/** Only things this close to the player get one, m. */
export const LABEL_RANGE = 60;

/**
 * The labels for one refresh: begin() with the player and the view, let the
 * scenes and describeWorld() write, finish() to sort. Records are pooled.
 */
export class LabelBoard implements LabelSink {
  readonly list: LabelRecord[] = [];
  count = 0;
  private fx = 0;
  private fz = 0;
  private r2 = LABEL_RANGE * LABEL_RANGE;
  private view: Rect | null = null;
  private margin = 2;

  /** A fresh refresh round (fx, fz): labels within `range` m and inside `view` (with `margin` m), if given. */
  begin(fx: number, fz: number, range = LABEL_RANGE, view: Rect | null = null, margin = 2): void {
    this.count = 0;
    this.fx = fx;
    this.fz = fz;
    this.r2 = range * range;
    this.view = view;
    this.margin = margin;
  }

  ped(c: CrowdPed, text: string, cat: LabelCat, colour?: string): void {
    this.put(LABEL_PED, c, c.agent.s.x, c.agent.s.z, text, cat, colour);
  }

  car(v: Vehicle, text: string, cat: LabelCat, colour?: string): void {
    this.put(LABEL_CAR, v, v.sim.x, v.sim.z, text, cat, colour);
  }

  spot(at: LabelSpot, text: string, cat: LabelCat, colour?: string): void {
    if (at.alive === false) return;
    this.put(LABEL_SPOT, at, at.x, at.z, text, cat, colour);
  }

  /** Is (x, z) worth a label (in range and in view)? Lets a caller skip building the text. */
  wants(x: number, z: number): boolean {
    const dx = x - this.fx;
    const dz = z - this.fz;
    if (dx * dx + dz * dz > this.r2) return false;
    const r = this.view;
    const m = this.margin;
    return !r || (x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m);
  }

  /** Already labelled this round? */
  has(target: object): boolean {
    for (let i = 0; i < this.count; i++) if (this.list[i].target === target) return true;
    return false;
  }

  /** Sort nearest first; the number to show (at most `max`). */
  finish(max = MAX_LABELS): number {
    const l = this.list;
    // Insertion sort: a few dozen records, no allocation.
    for (let i = 1; i < this.count; i++) {
      const r = l[i];
      let j = i - 1;
      while (j >= 0 && l[j].d2 > r.d2) {
        l[j + 1] = l[j];
        j--;
      }
      l[j + 1] = r;
    }
    return Math.min(this.count, max);
  }

  private put(kind: LabelKind, target: CrowdPed | Vehicle | LabelSpot, x: number, z: number, text: string, cat: LabelCat, colour?: string): void {
    if (!this.wants(x, z) || this.has(target)) return;
    let r = this.list[this.count];
    if (!r) this.list.push((r = { kind, target, text, cat, colour: null, d2: 0 }));
    r.kind = kind;
    r.target = target;
    r.text = text;
    r.cat = cat;
    r.colour = colour ?? null;
    const dx = x - this.fx;
    const dz = z - this.fz;
    r.d2 = dx * dx + dz * dz;
    this.count++;
  }
}

// --- Text ------------------------------------------------------------------------

/** Whole seconds left, "54s" (never negative). */
export function secs(t: number): string {
  return `${Math.max(0, Math.ceil(t))}s`;
}

/** Seconds to a tenth, "2.1s" (never negative). */
export function tenths(t: number): string {
  return `${Math.max(0, t).toFixed(1)}s`;
}

/** What someone's doing, as a suffix: " (fighting)", " (KO)"; "" walking about. */
export function modeSuffix(mode: PedMode, ko = false): string {
  switch (mode) {
    case 'fight':
      return ' (fighting)';
    case 'shoot':
      return ' (shooting)';
    case 'flee':
      return ' (fleeing)';
    case 'down':
      return ko ? ' (KO)' : ' (down)';
    default:
      return '';
  }
}

/** A gang or rival crew by id: its name and shirt colour ("VIPERS", "#8dff2e"). */
export function crewLabel(id: string): { name: string; colour: string } | null {
  for (const g of GANGS) if (g.id === id) return { name: g.name, colour: g.shirt };
  for (const c of RIVALS) if (c.id === id) return { name: c.name, colour: c.shirt };
  return null;
}

/** A witness on the phone: "WITNESS (calling 2.1s)", "(through)", "(filming)". */
export function witnessText(role: 'call' | 'film', phase: string, left: number): string {
  if (role === 'film') return 'WITNESS (filming)';
  if (phase === 'calling') return `WITNESS (calling ${tenths(left)})`;
  return phase === 'through' ? 'WITNESS (call through)' : 'WITNESS (call dropped)';
}

/** A queue's or a crowd's people: "QUEUE 1", "QUEUE 2"... front first (`numbered`), else all `word`. */
export function labelMembers(out: LabelSink, members: readonly CrowdPed[], word: string, numbered: boolean): void {
  for (let i = 0; i < members.length; i++) {
    const s = members[i].agent.s;
    if (out.wants(s.x, s.z)) out.ped(members[i], numbered ? `${word} ${i + 1}` : word, 'people');
  }
}

/** A stray dog by what it's doing. */
export function dogText(mode: string): string {
  switch (mode) {
    case 'chase':
      return 'DOG (chasing)';
    case 'flee':
      return 'DOG (bolting)';
    case 'down':
      return 'DOG (knocked over)';
    case 'sniff':
      return 'DOG (sniffing)';
    default:
      return 'DOG';
  }
}

/** A street racer: the fields raceRank reads (scenes/streetRaces.ts Racer fits). */
export interface RaceCar {
  leg: number;
  done: boolean;
  v: { sim: { x: number; z: number; heading: number } };
}

/**
 * Where racer `i` is placed among those still racing, 1 = leading: more
 * route nodes reached is ahead; on the same leg, whoever is further along
 * this one's heading. 0 if it's out.
 */
export function raceRank(racers: readonly RaceCar[], i: number): number {
  const me = racers[i];
  if (!me || me.done) return 0;
  const s = me.v.sim;
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  let rank = 1;
  for (let j = 0; j < racers.length; j++) {
    const o = racers[j];
    if (j === i || o.done) continue;
    if (o.leg > me.leg || (o.leg === me.leg && (o.v.sim.x - s.x) * fx + (o.v.sim.z - s.z) * fz > 0)) rank++;
  }
  return rank;
}

/** How many are still racing. */
export function racing(racers: readonly RaceCar[]): number {
  let n = 0;
  for (const r of racers) if (!r.done) n++;
  return n;
}

/** The player's police by unit: "COP (pursuit)", "SWAT (roadblock)", "COP (returning)". */
export function officerText(unit: Pick<PoliceUnit, 'kind' | 'role' | 'dismissed'>): string {
  const who = unit.kind === 'swat' ? 'SWAT' : 'COP';
  return `${who} (${unit.dismissed ? 'returning' : unit.role})`;
}

/** A police unit's vehicle: "POLICE (pursuit)", "SWAT VAN (roadblock)", "POLICE BIKE (returning)". */
export function unitCarText(unit: Pick<PoliceUnit, 'kind' | 'role' | 'dismissed'>): string {
  const what = unit.kind === 'swat' ? 'SWAT VAN' : unit.kind === 'bike' ? 'POLICE BIKE' : 'POLICE';
  return `${what} (${unit.dismissed ? 'returning' : unit.role})`;
}

/** A dropped gun: "DROP: pistol 31s". */
export function dropText(d: Pick<Drop, 'kind' | 'at'>, now: number): string {
  return `DROP: ${d.kind} ${secs(DROP_LIFE - (now - d.at))}`;
}

/** Scratch result of the fallbacks (read at once). */
export interface Label {
  text: string;
  cat: LabelCat;
  colour: string | null;
}

/**
 * Someone no scene described, by their flags: a story character, a gang
 * member, an officer, the hurt, the scared, a scene's person; null for an
 * ordinary passer-by walking about.
 */
export function pedLabel(c: CrowdPed, out: Label): Label | null {
  const a = c.agent;
  out.colour = null;
  const body = c.model.bodyKind;
  if (STORY_BODIES.includes(body)) return set(out, `${body.toUpperCase()}${modeSuffix(a.mode, a.ko)}`, 'mission');
  if (a.gang) {
    const crew = crewLabel(a.gang);
    set(out, `${crew?.name ?? a.gang.toUpperCase()}${modeSuffix(a.mode, a.ko)}`, 'gang');
    out.colour = crew?.colour ?? null;
    return out;
  }
  if (a.role === 'cop') return set(out, `COP${modeSuffix(a.mode, a.ko)}`, 'police');
  if (a.injured) return set(out, 'INJURED', 'emergency');
  if (c.phone) return set(out, 'ON PHONE', 'people');
  if (a.burning > 0) return set(out, 'ON FIRE', 'emergency');
  if (a.mode === 'down') return set(out, a.ko ? 'KO' : 'DOWN', 'people');
  if (a.mode === 'fight') return set(out, 'HOSTILE', 'people');
  if (a.mode === 'shoot') return set(out, 'SHOOTING', 'people');
  if (a.cower > 0) return set(out, 'COWERING', 'people');
  if (a.mode === 'flee') return set(out, 'FLEEING', 'people');
  if (a.scene) return set(out, 'SCENE', 'people');
  return null;
}

/** What describeWorld needs to know about the player's cars. */
export interface CarContext {
  driving: Vehicle | null;
  lastDriven: Vehicle | null;
  /** Cars an activity holds (a mission's, the Chaos Run's). */
  pinned: readonly Vehicle[];
}

/** A car no scene described, by its flags; null for ordinary traffic (and the player's own). */
export function carLabel(v: Vehicle, ctx: CarContext, out: Label): Label | null {
  out.colour = null;
  if (v === ctx.driving) return null;
  if (ctx.pinned.includes(v)) return set(out, 'ACTIVITY CAR', 'mission');
  if (v.damage.wrecked || v.charred) return set(out, v.damage.burning ? 'WRECK (burning)' : 'WRECK', 'traffic');
  if (v.towable) return set(out, 'CRASHED (towable)', 'traffic');
  if (v.damage.burning) return set(out, 'ON FIRE', 'emergency');
  if (v.police) return set(out, v.emergency ? 'POLICE (lights)' : 'POLICE', 'police');
  if (v.pursuit) return set(out, 'ROAD RAGE', 'traffic');
  if (v.emergency) return set(out, 'EMERGENCY', 'emergency');
  if (v.tipped) return set(out, 'BIKE (tipped)', 'traffic');
  if (v.exported) return set(out, 'EXPORT', 'traffic');
  if (v.parked) return set(out, 'PARKED', 'traffic');
  if (v === ctx.lastDriven) return set(out, 'YOUR LAST CAR', 'traffic');
  if (!v.ai) return set(out, 'EMPTY', 'traffic');
  if (v.scene) return set(out, 'SCENE CAR', 'traffic');
  if (v.ai.mood === 'panic') return set(out, 'PANICKING', 'traffic');
  return null;
}

function set(out: Label, text: string, cat: LabelCat): Label {
  out.text = text;
  out.cat = cat;
  return out;
}

/** Everything describeWorld reads. */
export interface LabelWorld extends CarContext {
  crowd: readonly CrowdPed[];
  vehicles: readonly Vehicle[];
  /** The player's police (heat.police). */
  police: { readonly units: readonly PoliceUnit[]; readonly strays: readonly CrowdPed[] };
  drops: readonly Drop[];
  /** Sim time, s. */
  now: number;
}

const scratch: Label = { text: '', cat: 'people', colour: null };

/**
 * After the scenes: the player's police, dropped guns, then everyone and
 * everything else by their flags (anything already labelled keeps its own).
 */
export function describeWorld(out: LabelBoard, w: LabelWorld): void {
  for (const u of w.police.units) {
    if (u.vehicle && out.wants(u.vehicle.sim.x, u.vehicle.sim.z)) out.car(u.vehicle, unitCarText(u), 'police');
    for (const o of u.officers) if (out.wants(o.agent.s.x, o.agent.s.z)) out.ped(o, officerText(u), 'police');
  }
  for (const o of w.police.strays) out.ped(o, 'COP (stray)', 'police');
  for (const d of w.drops) if (d.alive && out.wants(d.x, d.z)) out.spot(d, dropText(d, w.now), 'people');
  for (const c of w.crowd) {
    const s = c.agent.s;
    if (!out.wants(s.x, s.z) || out.has(c)) continue;
    const l = pedLabel(c, scratch);
    if (l) out.ped(c, l.text, l.cat, l.colour ?? undefined);
  }
  for (const v of w.vehicles) {
    if (!out.wants(v.sim.x, v.sim.z) || out.has(v) || !v.mesh.root.visible) continue;
    const l = carLabel(v, w, scratch);
    if (l) out.car(v, l.text, l.cat);
  }
}
