/**
 * The map editor's round 3 (W3-D): payphones added and the jobs they ring
 * for, custom frenzies, story spots, landmarks and pickups. What the
 * inventory (game/mapAnchors.ts) gains, the rules for story spots, the
 * checks (checkRound3, part of checkMapEdits) and the helpers the editor
 * asks (which jobs ring a phone, where a landmark can go). Pure: no
 * three.js, no DOM.
 */
import type { Anchor, AnchorInputs, MapProblem, SpotRule } from './mapAnchors';
import { blockAt, roadAt } from './mapAnchors';
import { frenzySpecProblems } from './modes/frenzyLimits';
import { placeDocks, placeSafehouse } from './modes/places';
import { buildMissions } from '../systems/missionsData';
import { arcOf, type MissionArc, type MissionDef } from '../systems/missions';
import { storyEditFits, storySpots, type StorySpot } from '../systems/storyEdits';
import { CORE_OFFSET, core, type City } from '../world/city';
import { bayFor, placeStation, sprayShopSlots } from '../world/landmarks';
import { placeHospital } from '../world/streetSpots';
import { LANDMARK_IDS, NO_EDITS, PICKUP_ITEMS, type LandmarkId, type MapEdits } from '../world/mapEdits';

type Point = { x: number; z: number };
const ORIGIN = { x: 0, z: 0 };

// --- The inventory's new groups ---

/** Shop doors and road works sites into the inventory (collectAnchors calls it). */
export function collectRound3(inputs: AnchorInputs, out: Anchor[]): void {
  inputs.shops?.forEach((s, i) => out.push({ id: `shop-${i}`, group: 'shop', label: s.neon ? 'Shop door (neon)' : 'Shop door', points: [{ x: s.x, z: s.z }] }));
  inputs.roadworks?.forEach((w, i) =>
    out.push({ id: `works-${i}`, group: 'roadworks', label: 'Road works', points: [{ x: (w.area.minX + w.area.maxX) / 2, z: (w.area.minZ + w.area.maxZ) / 2 }] }),
  );
}

// --- Story spots ---

let written: { jobs: MissionDef[]; spots: Map<string, StorySpot> } | null = null;
/** The jobs as written (no edits; the docks and safehouse at the origin: only ids, kinds and labels are read from it). */
function writtenJobs(): { jobs: MissionDef[]; spots: Map<string, StorySpot> } {
  if (!written) {
    const jobs = buildMissions(ORIGIN, ORIGIN, NO_EDITS);
    written = { jobs, spots: new Map(storySpots(jobs).map((s) => [s.id, s])) };
  }
  return written;
}

/** A story spot's rule: it moves (a parked car turns too), it never goes (the job needs it). */
export function storyRule(id: string): SpotRule | null {
  const s = writtenJobs().spots.get(id);
  if (!s) return null;
  return { group: 'story', label: s.label, movable: true, removable: false, turnable: s.heading !== undefined, why: 'its job needs it', generated: true };
}

/** What kind of story spot an id is (a point, a drive route, a race, a collect step), or null. */
export function storySpotKind(id: string): StorySpot['kind'] | null {
  return writtenJobs().spots.get(id)?.kind ?? null;
}

/** Story spot `id` as written, with the docks and safehouse where `city` and `edits` put them (a moved spot's "from", a turn's base). */
export function writtenStorySpot(city: City, edits: MapEdits, id: string): StorySpot | null {
  const job = id.slice(6, id.indexOf('/'));
  const m = buildMissions(placeDocks(city), placeSafehouse(edits), NO_EDITS).find((j) => j.id === job);
  return (m && storySpots([m]).find((s) => s.id === id)) ?? null;
}

// --- Jobs and their phones ---

export interface PhoneJob {
  id: string;
  title: string;
  arc: MissionArc;
  /** The phone it rings from on this map. */
  phone: string;
  /** The phone it was written for. */
  written: string;
}

/** Every job that rings a phone (not the cold open), in story order, with the phone the edits ring it from. */
export function phoneJobs(edits: MapEdits): PhoneJob[] {
  const now = buildMissions(ORIGIN, ORIGIN, edits);
  return writtenJobs()
    .jobs.map((m, i) => ({ m, now: now[i] }))
    .filter(({ m }) => !m.direct)
    .map(({ m, now: n }) => ({ id: m.id, title: m.title, arc: arcOf(m), phone: n.phone, written: m.phone }));
}

// --- Landmarks ---

const BUILT: ReadonlySet<LandmarkId> = new Set<LandmarkId>(['station', 'hospital']);

/** Why landmark `id` can't stand on core block `at` (null: it fits). */
export function landmarkFit(city: City, id: LandmarkId, at: readonly [number, number]): string | null {
  const b = city.blocks.find((q) => q.bx === core(at[0]) && q.bz === core(at[1]));
  if (!b) return `block ${at[0]},${at[1]} is off the map`;
  if (BUILT.has(id)) return b.kind === 'buildings' ? null : `needs a built-up block (block ${at[0]},${at[1]} is ${b.kind === 'plaza' ? 'open' : `a ${b.kind}`})`;
  if (b.kind === 'buildings') return `needs an open lot (a plaza, car park, park or empty lot), and block ${at[0]},${at[1]} is built up`;
  return bayFor(b.bx, b.bz, city) ? null : `no room for a bay on block ${at[0]},${at[1]} (something's in the way on every side)`;
}

/** The core block a landmark anchor stands on (a bay in its lot, a door on its block's pavement). */
export function anchorBlock(a: Anchor): readonly [number, number] | null {
  const p = a.points[0];
  const b = p && blockAt(p.x, p.z);
  return b ? [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET] : null;
}

/**
 * The core blocks landmark `id` could move to on this city: the shape fits
 * (landmarkFit) and, for a bay, no other bay landmark stands there. The
 * editor rings them while one is dragged.
 */
export function landmarkBlocks(city: City, id: LandmarkId, anchors: readonly Anchor[]): Array<readonly [number, number]> {
  const taken = new Set<string>();
  if (!BUILT.has(id)) for (const a of anchors) if (a.landmark && a.landmark !== id && !BUILT.has(a.landmark)) taken.add(String(anchorBlock(a)));
  const out: Array<readonly [number, number]> = [];
  for (const b of city.blocks) {
    const at = [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET] as const;
    if (BUILT.has(id) ? b.kind !== 'buildings' : b.kind === 'buildings' || taken.has(String(at))) continue;
    if (!landmarkFit(city, id, at)) out.push(at);
  }
  return out;
}

// --- The checks ---

/**
 * What round 3's edits break (empty for the committed map): a job rung
 * from a phone that isn't there, or the cold open given one; an added
 * phone no job rings; a phone both arcs ring (two calls at once at one
 * booth); an added frenzy outside its goal's limits; an added pickup of no
 * kind; a story spot edit of the wrong shape, a parked car moved off the
 * road or a pavement spot into it; a landmark that doesn't fit where it's
 * moved (it stays where the city put it). `anchors` are collectAnchors'.
 */
export function checkRound3(city: City, edits: MapEdits, anchors: readonly Anchor[]): MapProblem[] {
  const out: MapProblem[] = [];
  const phones = new Map(anchors.filter((a) => a.group === 'payphone').map((a) => [a.id, a]));

  // Jobs and phones.
  const jobs = new Map(writtenJobs().jobs.map((m) => [m.id, m]));
  for (const j of edits.jobs ?? []) {
    const edit = { section: 'jobs' as const, key: j.id };
    const m = jobs.get(j.id);
    if (!m) out.push({ id: `job:${j.id}`, label: j.id, problem: `no story job has the id "${j.id}"`, edit });
    else if (m.direct) out.push({ id: `job:${j.id}`, label: m.title, problem: 'starts without a call (the cold open): it rings no phone', edit });
    else if (!phones.has(j.phone)) out.push({ id: `job:${j.id}`, label: m.title, problem: `rings from "${j.phone}", which isn't a payphone on the map`, edit });
  }
  const ringing = new Map<string, PhoneJob[]>();
  for (const j of phoneJobs(edits)) ringing.set(j.phone, [...(ringing.get(j.phone) ?? []), j]);
  for (const a of phones.values()) {
    const list = ringing.get(a.id) ?? [];
    if (a.added && list.length === 0) out.push({ id: a.id, label: a.label, problem: 'no job rings it (move a job to it, or remove it)', edit: { section: 'spots', key: a.id }, at: a.points[0] });
    const arcs = new Set(list.map((j) => j.arc));
    if (arcs.size > 1) {
      // Blame a job the edits moved here (the written data never mixes arcs on one phone).
      const moved = list.find((j) => j.phone !== j.written);
      out.push({
        id: a.id,
        label: a.label,
        problem: 'both the main story and the Night Shift ring it: after dark both calls would come to one booth',
        ...(moved ? { edit: { section: 'jobs' as const, key: moved.id } } : {}),
        at: a.points[0],
      });
    }
  }

  // Added frenzies and pickups.
  for (const e of edits.spots) {
    const edit = { section: 'spots' as const, key: e.id };
    const at = e.x !== undefined && e.z !== undefined ? { x: e.x, z: e.z } : undefined;
    if (e.add === 'frenzy') for (const p of frenzySpecProblems(e.frenzy)) out.push({ id: e.id, label: `Frenzy ${e.id}`, problem: p, edit, at });
    if (e.add === 'pickup' && !PICKUP_ITEMS.includes(e.pickup!)) out.push({ id: e.id, label: `Pickup ${e.id}`, problem: `has no kind the game knows (${JSON.stringify(e.pickup)})`, edit, at });
  }

  // Story spots: the right shape, and on the road or off it as written.
  const storyEdits = edits.spots.filter((e) => e.id.startsWith('story:'));
  if (storyEdits.length) {
    const docks = placeDocks(city);
    const asWritten = new Map(storySpots(buildMissions(docks, placeSafehouse(edits), NO_EDITS)).map((s) => [s.id, s]));
    for (const e of storyEdits) {
      const s = asWritten.get(e.id);
      if (!s) continue; // checkMapEdits: no spot has the id
      const edit = { section: 'spots' as const, key: e.id };
      const bad = storyEditFits(s, e);
      // A turn of a spot with no facing is checkMapEdits' own finding.
      if (bad && !(e.heading !== undefined && s.heading === undefined && s.kind === 'point')) {
        out.push({ id: e.id, label: s.label, problem: bad, edit });
        continue;
      }
      if (bad) continue;
      const pairs: Array<[Point, Point]> =
        s.kind === 'point' ? (e.x !== undefined ? [[s, { x: e.x, z: e.z! }]] : []) : s.kind === 'points' ? s.list!.map(([x, z], i) => [{ x, z }, { x: e.points![i][0], z: e.points![i][1] }]) : [];
      for (const [from, to] of pairs) {
        const was = roadAt(from.x, from.z) !== null;
        const is = roadAt(to.x, to.z) !== null;
        if (was && !is) out.push({ id: e.id, label: s.label, problem: `must stand on a road (a car parks or waits there) but is at ${to.x.toFixed(1)}, ${to.z.toFixed(1)}`, edit, at: to });
        else if (!was && is) out.push({ id: e.id, label: s.label, problem: `stands in the road at ${to.x.toFixed(1)}, ${to.z.toFixed(1)} (it was written for the pavement or a lot)`, edit, at: to });
      }
    }
  }

  // Landmarks: where they're moved, and that they got there.
  for (const l of edits.landmarks ?? []) {
    const edit = { section: 'landmarks' as const, key: l.id };
    const a = anchors.find((x) => x.landmark === l.id);
    const label = a?.label ?? l.id;
    if (!LANDMARK_IDS.includes(l.id)) {
      out.push({ id: `landmark:${l.id}`, label, problem: `no landmark has the id "${l.id}"`, edit });
      continue;
    }
    const why = landmarkFit(city, l.id, l.at);
    const now = a && anchorBlock(a);
    if (why) out.push({ id: a?.id ?? `landmark:${l.id}`, label, problem: `${why}: it stays where the city put it`, edit, at: a?.points[0] });
    else if (!now || now[0] !== l.at[0] || now[1] !== l.at[1]) {
      out.push({ id: a?.id ?? `landmark:${l.id}`, label, problem: `another landmark took block ${l.at[0]},${l.at[1]}: it stays where the city put it`, edit, at: a?.points[0] });
    }
  }
  return out;
}

/** The core block the city puts landmark `id` on with no landmark edits (a move back there clears the edit). */
export function landmarkHome(city: City, id: LandmarkId): readonly [number, number] | null {
  const bare: City = { ...city, edits: { ...(city.edits ?? NO_EDITS), landmarks: undefined } };
  const p = id === 'docks' ? placeDocks(bare) : id === 'station' ? placeStation(bare) : id === 'hospital' ? placeHospital(bare) : sprayShopSlots(bare).find((s) => s.slot === id)?.shop;
  const b = p && blockAt(p.x, p.z);
  return b ? [b.bx - CORE_OFFSET, b.bz - CORE_OFFSET] : null;
}
