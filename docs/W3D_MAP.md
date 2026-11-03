# W3-D · Map editor: groundwork

Branch `claude/w3-map` (from `main` at 0.19.0). The plan is in
`docs/V2_PLAN.md` *W3-D*. This covers the plan's first step (the inventory
and the overrides file, before any UI), what it found and what comes next.
No UI yet, and the shipped city is unchanged: the committed map file is
empty, and `tests/cityCore.test.ts` still pins the core at 16, 24 and 32.

## The map file

`src/world/maps/city.json`, read by `world/shippedMap.ts` and passed to
`generateCity(1337, SHIPPED_MAP)` in `main.ts`.

```json
{
  "version": 1,
  "seed": 1337,
  "blocks": [
    { "at": [9, 3], "kind": "carpark" },
    { "at": [5, 6], "kind": "park", "district": "oldtown" },
    { "at": [-2, 17], "district": "arts", "variant": -4 }
  ]
}
```

- **Blocks are in core blocks**, like every hand-placed spot: (0, 0) is the
  shipped city's north-west block, and a bigger city's ring is negative or
  ≥ 16. An edit stays put whatever size the city is built at.
- **`kind`**: `buildings`, `park`, `plaza` (open) or `carpark` (a plaza
  painted with bays). **`district`**: a repaint. **`variant`**: any integer;
  rerolls the block's buildings or trees.
- **Canonical text** (`serializeMapEdits`): blocks sorted north to south,
  then west to east, one per line, keys in a fixed order. The same edits
  always write the same bytes, so a commit's diff reads as the edits. A test
  checks the committed file is canonical.
- **Reading never throws** (`parseMapEdits`): anything malformed is dropped
  with a reason (unknown kind or district, bad coordinates, a block edited
  twice: the later wins). An unknown `version` loads as no edits rather than
  a wrong city. The tests fail on any problem in the committed file.
- **Helpers for the editor:** `diffMapEdits(base, local)` lists what local
  edits change against the file (before/after per block, for the diff and
  revert); `withBlockEdit` sets or clears one block and returns new edits
  (undo keeps the old object).

**Why bundled, not `public/maps/` as the plan said:** the boot is
synchronous (`main.ts` builds the city at the top level), the file is
small, the offline PWA gets it with the code, and the tests import the
same file the game does. `publicUrl` loading would mean an async boot for
no gain. The editor's local edits will sit in `localStorage` until EXPORT.

## How edits apply

Inside `generateCity(seed, edits)`, block by block in the usual order:

- **A block whose kind changes, or with a variant,** draws its generated
  content from the seed's stream as usual and throws it away (so the stream
  stays in step), then is rebuilt from a stream of its own
  (`blockSeed(seed, bx, bz, variant)`). Every other block's buildings and
  trees come out exactly as unedited (tested).
- **A repaint** keeps the block's footprints (the stream doesn't depend on
  the district) and takes the new district's heights and colours.
  `paintDistricts` installs the repaints for `districtOf`, so `districtAt`
  agrees everywhere (scanner, area card, mayhem areas, scenes). It's
  module state, set by each `generateCity`: the last city built is the one
  the game plays, and tests that edit regenerate a plain city after.
- **Car park or plaza**: `Block.carPark` moves the block's lot byte across
  `lotBytes`' 128 line, keeping the rest of the byte for the ground's look,
  so the ground, the bays, ice cream and buskers all agree.

## The inventory (`game/mapAnchors.ts`)

`collectAnchors(city, { ramps, busStops })` lists everything tied to a
place: 193 in the shipped city.

| Group | Count | From |
|---|---|---|
| safehouse, payphones, frenzy tokens | 1, 4, 8 | `modes/places.ts` |
| docks yard, Pay 'n' Spray, station, hospital (doors and ambulance bay) | 1, 4, 1, 2 | `places.ts`, `landmarks.ts`, `streetSpots.ts` |
| gang hangouts | 5 | `gangs.ts` |
| race courses | 6 | `modes/races.ts` (routes) |
| story jobs | 57 | `missionsData.ts`, walked: spawns, targets, scene actions, mayhem areas (with their district), drive routes, race steps, collect points |
| ramps and kickers | 18 | `world/ramps.ts` |
| bus stops | 86 | `dressCity(...).street.busStops` |

Story spots are found by walking each job's definition (anything with `x`
and `z`, `route`, a race step's `nodes`, a collect step's `points`), so a
new job's spots join the overlay with no change here.

- **What relies on a pick** (`dependentsOf(anchors, pick)`, the overlay's
  query): a pick is a block, a road segment between two crossings, or a
  junction. A spot relies on the block whose pavement or lot it's on, or
  the segment or junction it's parked on (`blockAt`, `roadAt`). A race
  relies on every segment and crossing of its course. A job's drive route
  (`via`) relies on the crossings it steers for: the car takes traffic's
  roads between them (`routeToward`), so the segments aren't fixed. A
  district claim (a mayhem area) also relies on the block `districtAt`
  reads, which for a spot on a road is the block to its south-east.
- **What an edit breaks** (`checkAnchors(city, anchors)`): a duplicate id,
  a spot off the map or inside a building, a job written for a district its
  spot is no longer in, a course leg that turns off its road or leaves the
  map, a drive route heading for a crossing off the map. Empty for the
  committed map (tested); a repaint of Cobble Row's mayhem block shows up as
  `written for oldtown, but its spot is in arts`.

Not in the inventory yet: scene spots (vendors, shelters, hydrants, the
film shoot's), the TEST menu's teleports, frontages' shop doors, road
works, pickups and hidden packages. Packages are shuffled over every
block, so any block edit moves them (and saves record them by index, the
same problem W3-A has).

## Furniture stays local (fixed 2026-11-03)

**Found:** the blocks stayed local, but the dressing drew from streams
shared across the whole city. One block made a park moved about 750 street
props more than a block away; made buildings, about 640; made a car park,
about 2,600, and it added 11 bus stops. The building plans (roof kit,
shopfronts, awnings, neon) were seeded by each building's index in the
city, so a block that gained or lost a building re-rolled every later
building's look too.

**Fixed:** everything placed per block now draws from a stream of its own
(`keyedStream(seed, salt, bx, bz)` in `world/random.ts`, keyed by core
block): kerb furniture, dumpsters, bus stops and food carts. Café tables,
vending machines, ATMs and the building plans are keyed by where each
building stands (`buildingStream`), not its index. Road works were already
independent of block kinds (they pick from every kerb, whatever the block)
and are unchanged. Keying by core block also keeps W3-A's guarantee for
free: the core's furniture is the same at any city size.

`tests/mapLocality.test.ts` pins it: six edits (buildings to park, to car
park, park to buildings, a car park opened up, a reroll, a repaint), and
every prop, bus stop, cart, road works site and building plan outside the
edited block's cell is exactly as before. (An edit that changes which open
lot is nearest a Pay 'n' Spray target or the docks moves that landmark and
its keep-out zone, on purpose; the test picks blocks that don't.)

**The one-time reshuffle:** every street prop, bus stop, cart, café table
and rooftop in the shipped city is re-rolled once (same rules and
densities, different draws): 93 bus stops instead of 86. The blocks,
buildings, trees, hand-placed spots, ramps, pickups, landmark props and
road works are unchanged. The `cityCore` fingerprints for props and stops
are re-pinned, and new ones pin the carts and building plans.

**The cold open moved:** it plays at the shelter nearest the safehouse
that suits it, which is now at (74.5, −36.5), 66 m from the safehouse,
instead of (117.5, −29.8), 100 m. It meets every rule the tests check
(not a south-side shelter, room for the crash ahead, player, crash and
getaway placed clear), but it's a different street: it needs a look on the
iPhone (STEAL THIS CAR over the bus, the bus nose against the crash).

Still not local: hidden packages are shuffled over every block, so any
block edit moves them (and saves record them by index; the same decision
W3-A needs).

## Next

1. ~~Per-block dressing streams~~ (done, above). Check the cold open's new
   street on the iPhone.
2. **The editor shell** (desktop, an EDIT entry with Test tools on, on
   observe mode's free camera): pick a block, set its kind, district and
   variant from a side panel; undo/redo over `withBlockEdit`; local edits in
   `localStorage`; EXPORT writes the canonical file; the diff list with
   revert. Rebuilding: the whole city at first (43 ms to generate at 16),
   then only the touched block's chunk, now that edits are local.
3. **The overlay**: draw `dependentsOf` for the pick and list it in the
   panel; run `checkAnchors` on every edit and turn breakages red.
4. **More in the file** (version 2+): building height and style, an empty
   lot, then props, ramps, payphones and spawn points (by anchor id), then
   roads (closures and one-way streets) last, as the plan says.
5. **The rest of the inventory** (scene spots, test spots, packages).
