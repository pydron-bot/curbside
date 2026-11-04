/**
 * Dressing the city: the landmark models and the street furniture together,
 * placed once at boot from the same deterministic placements the rules use
 * (Pay 'n' Spray bays, the station, the docks, the safehouse, payphones,
 * frenzy tokens, races, ramps, pickups), so furniture keeps clear of every
 * marker and bay mouth. main.ts adds `solids` to the collision grid and
 * hands the rest to the renderer (render/worldProps.ts) and the knockables
 * to systems/knockables.ts. The city's map edits (W3-D, `city.edits`) move
 * the spots, close roads (barriers across both ends) and add or remove
 * props. Pure data.
 */
import { placeDocks, placeFrenzyTokens, placePayphones, placeSafehouse } from '../game/modes/places';
import { NO_EDITS } from './mapEdits';
import { RACES, legDir, nodeX, nodeZ } from '../game/modes/races';
import type { City, Rect } from './city';
import { placeSprayShops, placeStation, shopRect } from './landmarks';
import { placeLandmarkProps, type Landmarks } from './landmarkProps';
import type { KnockableItem } from '../systems/knockables';
import type { Ramp } from './ramps';
import { MAX_NODE, dirHeading, segmentKey } from './roads';
import { RoadRules } from './roadRules';
import { placeStreetProps, type StreetProps } from './streetProps';
import { buildMissions } from '../systems/missionsData';

export interface Dressing {
  street: StreetProps;
  landmarks: Landmarks;
  /** Everything solid, for the collision grid. */
  solids: Rect[];
  /** What a car knocks flying (ids: street props by index, landmark props from LANDMARK_KNOCK_ID up). */
  knockables: KnockableItem[];
}

/** Knockable ids of landmark props start here (street props use their own index). */
export const LANDMARK_KNOCK_ID = 1 << 20;

export function dressCity(city: City, pickups: ReadonlyArray<{ x: number; z: number }>, ramps: readonly Ramp[]): Dressing {
  const shops = placeSprayShops(city);
  const docks = placeDocks(city);
  const station = placeStation(city);
  const edits = city.edits ?? NO_EDITS;
  const safehouse = placeSafehouse(edits);
  const payphones = placePayphones(edits);
  const raceStarts = RACES.map((r) => ({ x: nodeX(r.nodes[0]), z: nodeZ(r.nodes[0]), heading: dirHeading(legDir(r.nodes[0], r.nodes[1])) }));
  const landmarks = placeLandmarkProps({ city, shops, docks, station, safehouse, payphones, raceStarts, ramps });
  const avoid = [
    ...landmarks.avoid,
    ...pickups.map((p) => ({ x: p.x, z: p.z, r: 1.6 })),
    ...placeFrenzyTokens(edits).map((t) => ({ x: t.x, z: t.z, r: 2.5 })),
    ...payphones.map((p) => ({ x: p.x, z: p.z, r: 2 })),
    { x: safehouse.x, z: safehouse.z, r: 3.5 },
    { x: station.x, z: station.z, r: 4 },
    ...raceStarts.map((r) => ({ x: r.x, z: r.z, r: 10 })),
  ];
  // The bays and a lane in front of each mouth, out to the road.
  const keepOut = [...shops, docks].map((s) => {
    const r = shopRect(s, 2);
    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    const reach = 9;
    return {
      minX: Math.min(r.minX, r.minX + fx * reach),
      minZ: Math.min(r.minZ, r.minZ + fz * reach),
      maxX: Math.max(r.maxX, r.maxX + fx * reach),
      maxZ: Math.max(r.maxZ, r.maxZ + fz * reach),
    };
  });
  // Things in the road keep off the spawn corner (its parked cars), the ramps' run-ups and every car a mission parks.
  const reserve = [{ x: 0, z: 0, r: 70 }, ...ramps.map((r) => ({ x: r.x, z: r.z, r: 30 }))];
  for (const m of buildMissions(docks, safehouse)) {
    for (const step of m.steps) {
      for (const a of [...(step.start ?? []), ...(step.done ?? [])]) if (a.do === 'spawnCar') reserve.push({ x: a.x, z: a.z, r: 6 });
    }
  }
  // No road works on a race's legs.
  const quietRoads = new Set<number>();
  for (const race of RACES) {
    for (let i = 1; i < race.nodes.length; i++) {
      let [x, z] = race.nodes[i - 1];
      const [tx, tz] = race.nodes[i];
      const sx = Math.sign(tx - x);
      const sz = Math.sign(tz - z);
      while (x !== tx || z !== tz) {
        quietRoads.add(segmentKey(x, z, x + sx, z + sz));
        x += sx;
        z += sz;
      }
    }
  }
  // Closures (and removals that can't apply, played as closed) and pedestrian streets (round 3), as the road rules read them.
  const rules = new RoadRules(edits.roads, MAX_NODE);
  const street = placeStreetProps(city, { avoid, keepOut, reserve, quietRoads, closedRoads: rules.closed, propEdits: edits.props, pedestrianRoads: rules.pedestrian });
  const knockables: KnockableItem[] = [
    ...street.knockables.map((k) => ({ id: k.prop, kind: street.props[k.prop].kind, x: k.x, z: k.z, radius: k.radius, hx: k.hx, hz: k.hz })),
    ...landmarks.knockables.map((k) => ({ id: LANDMARK_KNOCK_ID + k.prop, kind: landmarks.props[k.prop].kind, x: k.x, z: k.z, radius: k.radius })),
  ];
  return { street, landmarks, solids: [...street.solids, ...landmarks.solids], knockables };
}
