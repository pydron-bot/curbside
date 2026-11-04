/**
 * The map editor's live rebuild (W3-D): the running game's city rebuilt in
 * place on new map edits, so VIEW IN 3D shows them and play goes on there
 * with no reload. The edits become the active map first (setActiveMap: the
 * placement defaults, the safehouse and the frenzy list follow), then the
 * world is rebuilt here: the city's blocks, buildings and trees (in place:
 * everything holding `city` sees them), districts, road rules and merges
 * (generateCity installs them), pickups, ramps, the dressing's props and
 * landmarks, collision, knockables, the ground, the changed 256 m chunks of
 * the city's meshes, the night glows and the radar. Then `remap` (main.ts)
 * has every system that placed things at boot place them again: the game
 * modes' spots, heat's bays and station, the city's life and its scenes,
 * park water, steam, pigeons and the TEST teleports.
 */
import type { Look } from '../render/look';
import type { Knockables } from '../systems/knockables';
import { generateCity, type City } from '../world/city';
import type { StaticGrid } from '../world/collision';
import { dressCity, type Dressing } from '../world/dressing';
import type { MapEdits } from '../world/mapEdits';
import type { Pickup } from '../world/pickups';
import { placeCityRamps, rampSolids, type Ramp } from '../world/ramps';
import { placePickups } from '../world/pickups';
import { setActiveMap } from '../world/shippedMap';
import type { Roadworks } from '../world/roadworks';

export interface LiveMapDeps {
  /** The game's city: rebuilt in place. */
  city: City;
  /** The game's ramps: replaced in place. */
  ramps: Ramp[];
  /** The game's pickups: replaced in place. */
  pickups: Pickup[];
  /** The game's dressing: its fields replaced. */
  dressing: Dressing;
  collision: StaticGrid;
  rampGrid: StaticGrid;
  knockables: Knockables;
  look: Look;
  radar: { refreshMap(): void };
  signals: { setRoadworks(r: readonly Roadworks[]): void };
  /** After the world: every system that placed things at boot places them again (main.ts). */
  remap(): void;
}

export class LiveMap {
  /** The edits the city now shows (what the map editor previews against). */
  edits: MapEdits;
  /** The city was rebuilt live (the page plays the editor's local edits now). */
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
    setActiveMap(edits);
    // Installs the edits' districts and road rules for the whole game, as at boot.
    const next = generateCity(city.seed, edits);
    replace(city.blocks, next.blocks);
    replace(city.buildings, next.buildings);
    replace(city.trees, next.trees);
    replace(city.obstacles, next.obstacles);
    city.edits = edits;
    replace(d.ramps, placeCityRamps(city.seed, edits));
    replace(d.pickups, placePickups(city.seed, edits));
    d.look.pickups.refresh();
    const dressing = dressCity(city, d.pickups, d.ramps);
    Object.assign(d.dressing, dressing);
    d.collision.reset([...city.obstacles, ...dressing.solids]);
    d.rampGrid.reset(rampSolids(d.ramps));
    d.knockables.replace(dressing.knockables);
    const chunks = d.look.rebuildCity(city, dressing.street, dressing.landmarks);
    d.signals.setRoadworks(dressing.street.roadworks);
    d.radar.refreshMap();
    d.remap();
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
