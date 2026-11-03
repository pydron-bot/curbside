/**
 * The map editor's live rebuild (W3-D): the running game's city rebuilt in
 * place on new map edits, so VIEW IN 3D shows them without a reload. What's
 * rebuilt is what the city looks like and what moves through it: the city's
 * blocks, buildings and trees (in place: everything holding `city` sees
 * them), districts and road rules (generateCity installs them), ramps, the
 * dressing's props and landmarks, collision, knockables, the ground, the
 * changed 256 m chunks of the city's meshes, the night glows and the radar.
 *
 * What isn't: what the game modes placed at boot (payphones, frenzy tokens,
 * packages, hangouts, the safehouse, jobs), the city's own life (bus stops,
 * carts, scenes) and the like. So once the city has been rebuilt live it's
 * only for looking at (observe mode); `dirty` tells main.ts that leaving the
 * pause for play must reload on the local edits, where all of it agrees.
 */
import type { Look } from '../render/look';
import type { Knockables } from '../systems/knockables';
import { generateCity, type City } from '../world/city';
import type { StaticGrid } from '../world/collision';
import { dressCity, type Dressing } from '../world/dressing';
import type { MapEdits } from '../world/mapEdits';
import type { Pickup } from '../world/pickups';
import { placeCityRamps, rampSolids, type Ramp } from '../world/ramps';
import type { Roadworks } from '../world/roadworks';

export interface LiveMapDeps {
  /** The game's city: rebuilt in place. */
  city: City;
  /** The game's ramps: replaced in place. */
  ramps: Ramp[];
  pickups: readonly Pickup[];
  /** The game's dressing: its fields replaced. */
  dressing: Dressing;
  collision: StaticGrid;
  rampGrid: StaticGrid;
  knockables: Knockables;
  look: Look;
  radar: { refreshMap(): void };
  signals: { setRoadworks(r: readonly Roadworks[]): void };
}

export class LiveMap {
  /** The edits the city now shows (what the map editor previews against). */
  edits: MapEdits;
  /** The city was rebuilt live: playing on it needs a reload. */
  dirty = false;

  constructor(
    private readonly d: LiveMapDeps,
    edits: MapEdits,
  ) {
    this.edits = edits;
  }

  /** Rebuild the city on `edits`; how many 256 m chunks were rebuilt and how long it took, ms. */
  apply(edits: MapEdits): { chunks: number; ms: number } {
    const t0 = performance.now();
    const d = this.d;
    const city = d.city;
    // Installs the edits' districts and road rules for the whole game, as at boot.
    const next = generateCity(city.seed, edits);
    replace(city.blocks, next.blocks);
    replace(city.buildings, next.buildings);
    replace(city.trees, next.trees);
    replace(city.obstacles, next.obstacles);
    city.edits = edits;
    replace(d.ramps, placeCityRamps(city.seed, edits));
    const dressing = dressCity(city, d.pickups as Pickup[], d.ramps);
    Object.assign(d.dressing, dressing);
    d.collision.reset([...city.obstacles, ...dressing.solids]);
    d.rampGrid.reset(rampSolids(d.ramps));
    d.knockables.replace(dressing.knockables);
    const chunks = d.look.rebuildCity(city, dressing.street, dressing.landmarks);
    d.signals.setRoadworks(dressing.street.roadworks);
    d.radar.refreshMap();
    this.edits = edits;
    this.dirty = true;
    return { chunks, ms: performance.now() - t0 };
  }
}

/** Swap an array's contents, keeping the array (others hold it). */
function replace<T>(into: T[], from: readonly T[]): void {
  into.length = 0;
  for (const x of from) into.push(x);
}
