/**
 * Road works: a few sites round the city, each closing the strip of road
 * between the kerb and a traffic lane for a stretch of a block: a ROAD
 * WORK sign, a taper of cones out from the kerb, a line of traffic barrels
 * with plastic barriers between them, cones closing the far end, and
 * behind them a trench and its spoil, steel plates, a skip, a mini digger
 * or a portable toilet. Pure data, from the city seed (via streetProps.ts).
 *
 * The site stays outside the lane: the barrels stand WORKS_EDGE from the
 * centreline, and the lane's traffic keeps to LANE_OFFSET ± 1.33 m (a bus),
 * so it passes without changing lanes; a driver pulling over for a siren
 * keeps to the lane along a closed kerb (world/signals.ts kerbWorks). Cones,
 * barrels, barriers and the sign are knockables; the skip, the digger and
 * the toilet are solid. Never on a race leg (`quiet`), near a reserved spot
 * (mission cars at the kerb, ramps) or on the outer ring road.
 */
import { BLOCKS_PER_SIDE, CORE_BLOCKS, CORE_OFFSET, inCoreBlock, type City, type Rect } from './city';
import { dirHeading, segmentKey, type Dir } from './roads';
import { blockSide, onRing, type BlockSide, type Placer } from './kerbs';
import type { StreetPropKind } from './streetProps';
import { len2 } from '../core/len';
import { mulberry32 } from './random';

export interface Roadworks {
  /** The lane whose kerb side is closed: travelling `dir` toward junction (ix, iz) (roads.ts). */
  ix: number;
  iz: number;
  dir: Dir;
  /** Where the site starts and ends along that lane (the sign to the last cone), m from the junction it starts at. */
  from: number;
  to: number;
  /** The closed strip, kerb to barrels (world). */
  area: Rect;
}

/** Sites in the city. */
export const ROADWORKS_COUNT = 18;
/** Barrel line: this far from the road's centreline (lane centre 4, a bus reaches 5.33), m. */
export const WORKS_EDGE = 5.95;
/** The kit inside the barrels stands this far from the centreline, m. */
const KIT_LINE = 7.15;
/** At least this far apart, m. */
const SPACING = 140;
/** Inside this stretch of the lane (clear of the junctions' mouths and crossings), m from its start. */
const FIRST = 18;
const LAST = 46;

type Item = [kind: StreetPropKind, along: number, inset: number, heading: number, phase: number];

/** The kit inside the barrels, and its length along the road, m. */
const KIT: ReadonlyArray<readonly [StreetPropKind, number]> = [
  ['work_trench', 3.6],
  ['steel_plate', 2.4],
  ['skip', 2.6],
  ['mini_digger', 2.8],
  ['portable_toilet', 1.1],
];
const LAYOUTS: ReadonlyArray<readonly number[]> = [
  [0, 1, 4],
  [2, 3],
  [3, 0, 1],
  [0, 2],
  [1, 0, 4],
  [4, 2, 3],
];

/** Is this side on the core city's outer ring road (the shipped city's edge)? */
function onCoreRing(s: BlockSide): boolean {
  const b = s.block;
  const lo = CORE_OFFSET;
  const hi = CORE_OFFSET + CORE_BLOCKS - 1;
  return (s.side === 0 && b.bz === lo) || (s.side === 2 && b.bz === hi) || (s.side === 3 && b.bx === lo) || (s.side === 1 && b.bx === hi);
}

/**
 * ROADWORKS_COUNT sites in the core city, from `rand`; a bigger city's ring
 * gets as many again per core-sized area from a stream of its own, so the
 * core's sites stay put.
 */
export function placeRoadworks(city: City, rand: () => number, placer: Placer, quiet: ReadonlySet<number>): Roadworks[] {
  const coreSides: BlockSide[] = [];
  const ringSides: BlockSide[] = [];
  for (const b of city.blocks) {
    const inCore = inCoreBlock(b.bx, b.bz);
    for (let side = 0; side < 4; side++) {
      const s = blockSide(b, side);
      if (inCore) {
        if (!onCoreRing(s)) coreSides.push(s);
      } else if (!onRing(s)) ringSides.push(s);
    }
  }
  const out: Roadworks[] = [];
  placeSites(coreSides, ROADWORKS_COUNT, rand, placer, quiet, out);
  const ring = Math.round((ROADWORKS_COUNT * (BLOCKS_PER_SIDE ** 2 - CORE_BLOCKS ** 2)) / CORE_BLOCKS ** 2);
  if (ring > 0) placeSites(ringSides, out.length + ring, mulberry32(Math.floor(rand() * 2 ** 32) ^ 0x7e1a9), placer, quiet, out);
  return out;
}

function placeSites(sides: readonly BlockSide[], upTo: number, rand: () => number, placer: Placer, quiet: ReadonlySet<number>, out: Roadworks[]): void {
  for (let tries = 0; tries < 600 && out.length < upTo; tries++) {
    const s = sides[Math.floor(rand() * sides.length)];
    // The work area is barrels every 3 m: 9, 12 or 15 m of them.
    const length = 9 + Math.floor(rand() * 3) * 3;
    const from = FIRST + rand() * (LAST - FIRST - 10.5 - length);
    const layout = LAYOUTS[Math.floor(rand() * LAYOUTS.length)];
    const flip = rand() < 0.5 ? Math.PI : 0;
    if (quiet.has(segmentKey(s.fromX, s.fromZ, s.ix, s.iz))) continue;
    const mid = s.at(s.tFor(from + 5 + length / 2), 7);
    if (out.some((w) => len2((w.area.minX + w.area.maxX) / 2 - mid.x, (w.area.minZ + w.area.maxZ) / 2 - mid.z) < SPACING)) continue;

    const ahead = dirHeading(s.dir);
    const items: Item[] = [['roadwork_sign', from, 7.2, ahead + Math.PI, 0]];
    [7.6, 7.05, 6.5, WORKS_EDGE].forEach((inset, k) => items.push(['traffic_cone', from + 2.5 + 2 * k, inset, 0, 0]));
    const a = from + 9;
    const b = a + length;
    for (let j = 0; j <= length / 3; j++) {
      // The lamps on top blink in a run along the line.
      items.push(['traffic_barrel', a + 3 * j, WORKS_EDGE, ahead, j * 0.17]);
      if (a + 3 * j < b) items.push(['work_barrier', a + 3 * j + 1.5, WORKS_EDGE, ahead + Math.PI / 2, j * 0.17 + 0.5]);
    }
    items.push(['traffic_cone', b + 1.5, 6.6, 0, 0], ['traffic_cone', b + 1.5, 7.5, 0, 0]);
    let at = a + 0.8;
    for (const k of layout) {
      const [kind, len] = KIT[k];
      if (at + len > b - 0.6) break;
      items.push([kind, at + len / 2, KIT_LINE, ahead + (kind === 'mini_digger' ? flip : 0), 0]);
      at += len + 0.6;
    }
    // Everything clear, or no site here.
    const points = items.map(([kind, along, inset]) => ({ kind, ...s.at(s.tFor(along), inset) }));
    if (!points.every((p) => placer.clearRoad(p.x, p.z, p.kind === 'traffic_cone' || p.kind === 'traffic_barrel' ? 0.3 : 0.9))) continue;
    items.forEach(([kind, , , heading, phase], i) => placer.put(kind, points[i].x, points[i].z, heading, 1, phase));
    const c0 = s.at(s.tFor(from), 5.7);
    const c1 = s.at(s.tFor(b + 1.5), 8);
    out.push({
      ix: s.ix,
      iz: s.iz,
      dir: s.dir,
      from,
      to: b + 1.5,
      area: { minX: Math.min(c0.x, c1.x), minZ: Math.min(c0.z, c1.z), maxX: Math.max(c0.x, c1.x), maxZ: Math.max(c0.z, c1.z) },
    });
  }
}
