/**
 * What the city's scenes can pick on each block and road (W3-D round 3).
 * Many scenes choose their spot at run time near the player rather than
 * from a fixed list: a kebab shop with its neon on in Neon Mile or Cobble
 * Row, shelter under any awning in the rain, a night crowd under the neon,
 * a film shoot at a downtown kerb, an ice cream van, a cash run or a
 * funeral at any kerb traffic can reach, buskers in a park or plaza, a
 * hydrant to burst. So an edit that takes a shop, a kerb or a plaza away
 * takes a place those scenes could have used: the editor lists them as
 * "can host" beside what relies on the selection. Pure.
 */
import type { MapPick, Node } from './mapAnchors';
import { blockAt } from './mapAnchors';
import { FILM_DISTRICT, KEBAB_DISTRICTS } from '../systems/incidents';
import { isCarPark, lotBytes, type City } from '../world/city';
import { districtAt } from '../world/districts';
import { roadKey } from '../world/mapEdits';
import { MAX_NODE, type Dir } from '../world/roads';
import { PARK_OFFSET, roadPoint, segmentValid } from '../world/streetSpots';

export interface SceneHost {
  /** What could happen here, as the editor says it. */
  scene: string;
  /** How many places for it (shops, kerbs, hydrants). */
  count: number;
}

type Point = { x: number; z: number };

/** The key a pick's hosts are kept under: `block:bx,bz` or `road:<roadKey>` (city block indices; crossings). */
export function hostKey(pick: MapPick): string | null {
  if (pick.kind === 'block') return `block:${pick.bx},${pick.bz}`;
  if (pick.kind === 'segment') return `road:${roadKey(pick.a, pick.b)}`;
  return null;
}

/**
 * Every block's and road's hosts in `city`. Call it with the city's
 * district paint and road rules installed (the map editor's buildPreview
 * does): districtAt and segmentValid read them.
 */
export function sceneHosts(city: City, shops: ReadonlyArray<Point & { neon: boolean }>, hydrants: readonly Point[]): Map<string, SceneHost[]> {
  const out = new Map<string, SceneHost[]>();
  const add = (key: string, scene: string, n = 1) => {
    let list = out.get(key);
    if (!list) out.set(key, (list = []));
    const h = list.find((x) => x.scene === scene);
    if (h) h.count += n;
    else list.push({ scene, count: n });
  };
  const blockKey = (p: Point) => {
    const b = blockAt(p.x, p.z);
    return b ? `block:${b.bx},${b.bz}` : null;
  };
  for (const s of shops) {
    const k = blockKey(s);
    if (!k) continue;
    add(k, 'shelter from the rain (awning)');
    if (!s.neon) continue;
    add(k, 'night crowd under the neon');
    if (KEBAB_DISTRICTS.includes(districtAt(s.x, s.z))) add(k, 'kebab chucking-out (neon shop)');
  }
  for (const h of hydrants) {
    const k = blockKey(h);
    if (k) add(k, 'burst hydrant');
  }
  const bytes = lotBytes(city);
  city.blocks.forEach((b, i) => {
    if (b.kind === 'park' || (b.kind === 'plaza' && !isCarPark(city, bytes, i))) {
      add(`block:${b.bx},${b.bz}`, 'buskers');
      add(`block:${b.bx},${b.bz}`, 'ice cream van stops by it');
    }
  });
  // Each road's two kerbs: a lane traffic can reach is a kerb the street scenes can use.
  const p = { x: 0, z: 0 };
  for (let ix = -MAX_NODE; ix <= MAX_NODE; ix++) {
    for (let iz = -MAX_NODE; iz <= MAX_NODE; iz++) {
      const from: Node = [ix, iz];
      for (const [to, dir] of [
        [[ix + 1, iz], 1],
        [[ix, iz + 1], 2],
      ] as Array<[Node, Dir]>) {
        if (Math.abs(to[0]) > MAX_NODE || Math.abs(to[1]) > MAX_NODE) continue;
        const key = `road:${roadKey(from, to)}`;
        // Toward `to` going `dir`, and back toward `from` the other way.
        for (const [n, d] of [
          [to, dir],
          [from, ((dir + 2) % 4) as Dir],
        ] as Array<[Node, Dir]>) {
          if (!segmentValid(n[0], n[1], d)) continue;
          add(key, 'ice cream van, cash run, funeral (kerb)');
          roadPoint(n[0], n[1], d, 30, PARK_OFFSET, p);
          if (districtAt(p.x, p.z) === FILM_DISTRICT) add(key, 'film shoot (downtown kerb)');
        }
      }
    }
  }
  return out;
}
