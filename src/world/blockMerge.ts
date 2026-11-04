/**
 * Removed roads (W3-D round 3: streets): a road the map edits remove
 * becomes land, and the blocks either side of it one block. Merged blocks
 * stay rectangles of whole blocks (2×1, 2×2, 3×1...): a set of removals that
 * would make an L, leave a stub of road inside a merge, or take out the
 * outer ring road (there's no block beyond it) isn't applied; the game plays
 * those roads as closed and the checks name them. The editor never writes
 * one (removeRoad refuses with a reason, restoreRoad cuts a merge along a
 * whole line), so only a hand-edited file can.
 *
 * Everything here is in crossings (node (ix, iz) at world (ix·64, iz·64)): a
 * block is named by its north-west crossing, so block (ix, iz) lies between
 * crossings ix..ix+1 and iz..iz+1. Pure, no city import (roadRules.ts, a leaf,
 * uses it).
 */
import { roadKey, withEntry, type MapEdits, type Node, type RoadEdit } from './mapEdits';

/** A merged block: the blocks between crossing columns ix..ix+w and rows iz..iz+h (w × h blocks). */
export interface BlockMerge {
  ix: number;
  iz: number;
  w: number;
  h: number;
}

export interface MergePlan {
  /** Every merge the removals make, each a full rectangle with every road inside it removed. */
  merges: BlockMerge[];
  /** Removals that can't apply (the game plays them as closed roads), with why. */
  refused: Array<{ road: RoadEdit; why: string }>;
}

/** The two blocks (by north-west crossing) either side of road a–b: west then east, or north then south. Null if a–b isn't one road between two blocks (the outer ring road, off the map, not neighbours). */
export function blocksBeside(a: Node, b: Node, maxNode: number): [[number, number], [number, number]] | null {
  if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return null;
  const on = (v: number) => Math.abs(v) <= maxNode;
  if (![a[0], a[1], b[0], b[1]].every(on)) return null;
  if (a[0] === b[0]) {
    // North-south road at column ix: blocks west (ix - 1) and east (ix), row min(iz).
    const ix = a[0];
    const iz = Math.min(a[1], b[1]);
    if (Math.abs(ix) >= maxNode) return null;
    return [
      [ix - 1, iz],
      [ix, iz],
    ];
  }
  const iz = a[1];
  const ix = Math.min(a[0], b[0]);
  if (Math.abs(iz) >= maxNode) return null;
  return [
    [ix, iz - 1],
    [ix, iz],
  ];
}

/** Is a–b on the outer ring road (where it can't be removed)? */
export function onOuterRing(a: Node, b: Node, maxNode: number): boolean {
  return (a[0] === b[0] && Math.abs(a[0]) === maxNode) || (a[1] === b[1] && Math.abs(a[1]) === maxNode);
}

/** Every road inside a merge (between two of its blocks), as [a, b] crossings. */
export function innerRoads(m: BlockMerge): Array<[Node, Node]> {
  const out: Array<[Node, Node]> = [];
  for (let ix = m.ix + 1; ix < m.ix + m.w; ix++) for (let iz = m.iz; iz < m.iz + m.h; iz++) out.push([[ix, iz], [ix, iz + 1]]);
  for (let iz = m.iz + 1; iz < m.iz + m.h; iz++) for (let ix = m.ix; ix < m.ix + m.w; ix++) out.push([[ix, iz], [ix + 1, iz]]);
  return out;
}

const cellKey = (ix: number, iz: number) => `${ix},${iz}`;

/** Which merges a set of removed roads makes (`maxNode`: the city's outer ring road, roads.ts MAX_NODE). */
export function planMerges(removed: readonly RoadEdit[], maxNode: number): MergePlan {
  const refused: MergePlan['refused'] = [];
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // Path halving is plenty for a few dozen blocks.
    parent.set(k, r);
    return r;
  };
  const add = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  const valid: RoadEdit[] = [];
  for (const r of removed) {
    const pair = blocksBeside(r.a, r.b, maxNode);
    if (!pair) {
      refused.push({ road: r, why: onOuterRing(r.a, r.b, maxNode) ? "the outer ring road can't be removed (there's no block beyond it)" : 'not a road between two blocks' });
      continue;
    }
    valid.push(r);
    const [p, q] = pair.map(([x, z]) => cellKey(x, z));
    add(p);
    add(q);
    parent.set(find(p), find(q));
  }
  const removedKeys = new Set(valid.map((r) => roadKey(r.a, r.b)));
  const groups = new Map<string, Array<[number, number]>>();
  for (const k of parent.keys()) {
    const root = find(k);
    const [x, z] = k.split(',').map(Number);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push([x, z]);
  }
  const merges: BlockMerge[] = [];
  const bad = new Map<string, string>();
  for (const cells of groups.values()) {
    const ix = Math.min(...cells.map((c) => c[0]));
    const iz = Math.min(...cells.map((c) => c[1]));
    const m: BlockMerge = { ix, iz, w: Math.max(...cells.map((c) => c[0])) - ix + 1, h: Math.max(...cells.map((c) => c[1])) - iz + 1 };
    let why: string | null = null;
    if (cells.length !== m.w * m.h) why = "the blocks it joins don't make a rectangle (an L or a gap): merged blocks are whole rectangles";
    else {
      const left = innerRoads(m).find(([a, b]) => !removedKeys.has(roadKey(a, b)));
      if (left) why = `the road ${left[0].join(',')} – ${left[1].join(',')} inside the merged blocks is still there: remove it too`;
    }
    if (why) for (const [x, z] of cells) bad.set(cellKey(x, z), why);
    else merges.push(m);
  }
  for (const r of valid) {
    const pair = blocksBeside(r.a, r.b, maxNode)!;
    const why = bad.get(cellKey(pair[0][0], pair[0][1]));
    if (why) refused.push({ road: r, why });
  }
  merges.sort((p, q) => p.iz - q.iz || p.ix - q.ix);
  return { merges, refused };
}

/** The merge holding block (ix, iz) (by its north-west crossing), or that block alone. */
function mergeHolding(merges: readonly BlockMerge[], ix: number, iz: number): BlockMerge {
  return merges.find((m) => ix >= m.ix && ix < m.ix + m.w && iz >= m.iz && iz < m.iz + m.h) ?? { ix, iz, w: 1, h: 1 };
}

const removedRoads = (edits: MapEdits) => edits.roads.filter((r) => r.removed);

/**
 * The editor's REMOVE on road a–b: the blocks (or merged blocks) either side
 * become one, every road inside the new rectangle removed with it. Refused,
 * with a reason the panel shows, on the outer ring or where the two sides
 * don't line up into a rectangle.
 */
export function removeRoad(edits: MapEdits, a: Node, b: Node, maxNode: number): { edits: MapEdits } | { refused: string } {
  if (onOuterRing(a, b, maxNode)) return { refused: "The outer ring road can't be removed: there's no block beyond it." };
  const pair = blocksBeside(a, b, maxNode);
  if (!pair) return { refused: 'Not a road between two blocks.' };
  const { merges } = planMerges(removedRoads(edits), maxNode);
  const p = mergeHolding(merges, ...pair[0]);
  const q = mergeHolding(merges, ...pair[1]);
  const u: BlockMerge = { ix: Math.min(p.ix, q.ix), iz: Math.min(p.iz, q.iz), w: 0, h: 0 };
  u.w = Math.max(p.ix + p.w, q.ix + q.w) - u.ix;
  u.h = Math.max(p.iz + p.h, q.iz + q.h) - u.iz;
  if (p !== q && u.w * u.h !== p.w * p.h + q.w * q.h) {
    return { refused: `That would make an L-shaped block (${p.w}×${p.h} beside ${q.w}×${q.h}): merged blocks are whole rectangles. Make the two sides the same length first.` };
  }
  let out = edits;
  for (const [x, y] of innerRoads(u)) {
    const [s, t] = roadKey(x, y).split('|').map((n) => n.split(',').map(Number) as [number, number]);
    out = withEntry(out, 'roads', roadKey(x, y), { a: s, b: t, removed: true });
  }
  return { edits: out };
}

/**
 * Put road a–b back (`entry`: what it becomes; none: open as generated). A
 * removed road inside a merge cuts the merge along the road's whole line, so
 * both sides stay rectangles: every removed road on that line comes back
 * open, and a–b becomes `entry`.
 */
export function restoreRoad(edits: MapEdits, a: Node, b: Node, maxNode: number, entry?: RoadEdit): MapEdits {
  const key = roadKey(a, b);
  const pair = blocksBeside(a, b, maxNode);
  const own = edits.roads.find((r) => roadKey(r.a, r.b) === key);
  let out = edits;
  if (pair && own?.removed) {
    const { merges } = planMerges(removedRoads(edits), maxNode);
    const m = merges.find((x) => innerRoads(x).some(([p, q]) => roadKey(p, q) === key));
    if (m) {
      const vertical = a[0] === b[0];
      for (const [p, q] of innerRoads(m)) {
        const sameLine = vertical ? p[0] === q[0] && p[0] === a[0] : p[1] === q[1] && p[1] === a[1];
        if (sameLine) out = withEntry(out, 'roads', roadKey(p, q));
      }
    }
  }
  return withEntry(out, 'roads', key, entry);
}
