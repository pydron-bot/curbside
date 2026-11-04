/**
 * The map edits applied to the story jobs (W3-D round 3): a job rung from
 * another payphone (the `jobs` section), and a job's spots moved (spot
 * edits whose ids are the inventory's: `story:<job>/<path>`, the path to
 * the spot in the job's definition). A point moves (and a parked car
 * turns); a drive route's crossings (`via`), a race step's checkpoints and
 * a collect step's points are replaced as lists. buildMissions runs its
 * jobs through here, so the game, the dressing's reserved kerbs and the
 * inventory all read the moved spots. Pure.
 *
 * The walk is game/mapAnchors.ts storyAnchors' (the same ids; a test keeps
 * them equal): anything with x and z, a `route`, a race step's `nodes`, a
 * collect step's `points`.
 */
import type { MissionDef } from './missions';
import { jobPhone, type MapEdits, type SpotEdit } from '../world/mapEdits';
import { spotEdit } from '../world/spotEdits';

/** What kind of story spot an id is: a point, a drive route's crossings, a race's checkpoints, a collect step's points. */
export type StorySpotKind = 'point' | 'via' | 'nodes' | 'points';

export interface StorySpot {
  id: string;
  kind: StorySpotKind;
  /** The job's id. */
  job: string;
  /** For the editor's list: the job's title and what it is ("QUIET PLEASE: lionel"). */
  label: string;
  /** A point's place; a list's first. */
  x: number;
  z: number;
  /** A parked car's facing (it can be turned). */
  heading?: number;
  /** The crossings (via, nodes) or points (points), as written. */
  list?: ReadonlyArray<readonly [number, number]>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNodeList = (v: unknown): v is Array<[number, number]> => Array.isArray(v) && v.length > 0 && v.every((n) => Array.isArray(n) && n.length === 2 && isNum(n[0]) && isNum(n[1]));

/**
 * Visit every spot of job `m` (the object holding it, and for lists the key
 * it sits under). The same walk as mapAnchors' storyAnchors.
 */
function walkJob(m: MissionDef, visit: (s: StorySpot, holder: Record<string, unknown>) => void): void {
  const walk = (v: unknown, path: string, key: string) => {
    if (Array.isArray(v)) return v.forEach((c, i) => walk(c, `${path}.${i}`, key));
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    const what = String(o.tag ?? o.do ?? o.kind ?? key);
    const base = `story:${m.id}/${path}`;
    if (isNum(o.x) && isNum(o.z)) visit({ id: base, kind: 'point', job: m.id, label: `${m.title}: ${what}`, x: o.x, z: o.z, ...(isNum(o.heading) ? { heading: o.heading } : {}) }, o);
    if (isNodeList(o.route)) visit({ id: `${base}.route`, kind: 'via', job: m.id, label: `${m.title}: ${what} route`, x: o.route[0][0], z: o.route[0][1], list: o.route }, o);
    if (o.kind === 'race' && isNodeList(o.nodes)) visit({ id: `${base}.nodes`, kind: 'nodes', job: m.id, label: `${m.title}: race`, x: o.nodes[0][0], z: o.nodes[0][1], list: o.nodes }, o);
    if (o.kind === 'collect' && isNodeList(o.points)) visit({ id: `${base}.points`, kind: 'points', job: m.id, label: `${m.title}: collect`, x: o.points[0][0], z: o.points[0][1], list: o.points }, o);
    for (const [k, c] of Object.entries(o)) {
      if (k === 'intro' || k === 'outro' || k === 'route' || k === 'nodes' || k === 'points') continue;
      walk(c, `${path}.${k}`, k);
    }
  };
  walk(m.steps, 'steps', 'step');
}

/** Every story spot of these jobs, in the inventory's order. */
export function storySpots(missions: readonly MissionDef[]): StorySpot[] {
  const out: StorySpot[] = [];
  for (const m of missions) walkJob(m, (s) => out.push(s));
  return out;
}

const LIST_KEY: Readonly<Record<Exclude<StorySpotKind, 'point'>, string>> = { via: 'route', nodes: 'nodes', points: 'points' };

/** Does spot edit `e` fit a spot of this kind (a point takes x, z and a heading; a list its own list, as long)? */
export function storyEditFits(s: StorySpot, e: SpotEdit): string | null {
  if (e.add || e.removed) return "a job's spot can't be added or removed";
  if (s.kind === 'point') {
    if (e.nodes || e.points) return 'is a point: move it with x and z';
    if (e.heading !== undefined && s.heading === undefined) return 'has no facing to turn';
    return null;
  }
  if (e.x !== undefined || e.heading !== undefined) return `is a list of ${s.kind === 'points' ? 'points' : 'crossings'}: move them with "${s.kind === 'points' ? 'points' : 'nodes'}"`;
  const list = s.kind === 'points' ? e.points : e.nodes;
  const other = s.kind === 'points' ? e.nodes : e.points;
  if (other || !list) return `takes "${s.kind === 'points' ? 'points' : 'nodes'}"`;
  if (list.length !== s.list!.length) return `has ${s.list!.length} ${s.kind === 'points' ? 'points' : 'crossings'}, not ${list.length}`;
  return null;
}

/**
 * The jobs as the map edits leave them: rung from the phones the `jobs`
 * section names (not a direct job: it rings none), their spots moved. Jobs
 * the edits don't touch are the same objects; with no edits, the same array.
 */
export function editMissions(missions: MissionDef[], edits: MapEdits): MissionDef[] {
  const jobs = edits.jobs ?? [];
  const story = edits.spots.some((s) => s.id.startsWith('story:'));
  if (jobs.length === 0 && !story) return missions;
  return missions.map((m) => {
    const phone = jobPhone(edits, m.id);
    const touched = story && edits.spots.some((s) => s.id.startsWith(`story:${m.id}/`));
    if (!touched && (phone === undefined || m.direct)) return m;
    // A deep copy that shares nothing (a list used twice in the data is two lists here, so moving one leaves the other).
    const copy = JSON.parse(JSON.stringify(m)) as MissionDef;
    if (phone !== undefined && !m.direct) copy.phone = phone;
    if (touched) {
      walkJob(copy, (s, o) => {
        const e = spotEdit(edits, s.id);
        if (!e || storyEditFits(s, e)) return;
        if (s.kind === 'point') {
          if (e.x !== undefined && e.z !== undefined) {
            o.x = e.x;
            o.z = e.z;
          }
          if (e.heading !== undefined) o.heading = e.heading;
        } else o[LIST_KEY[s.kind]] = (s.kind === 'points' ? e.points! : e.nodes!).map((n) => [n[0], n[1]]);
      });
    }
    return copy;
  });
}
