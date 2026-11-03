# W3-A · A bigger city: groundwork and spike

Branch `claude/w3-city` (from `main` at 0.17.0). The plan is in
`docs/V2_PLAN.md` *W3-A*. This file covers what the groundwork changed, what
the spike measured, everything tied to a place in the city, and what the
owner has to decide next.

## What changed

**The city can be built bigger without moving anything in today's city.**

- **Size switch** (`world/city.ts`): `BLOCKS_PER_SIDE` is 16 (the shipped
  city) unless the page is opened with `?city=24` or `?city=32` (Node:
  `CURBSIDE_CITY=24`, for tests and tools). The allowed sizes are
  `CITY_SIZES`: the core plus whole 256 m render chunks of ring. Nothing
  else reads the URL, and the shipped game never sets it.
- **The core stays put.** Today's 16 × 16 city is the *core* (`CORE_BLOCKS`,
  `CORE_OFFSET`, `core(b)`, `inCoreBlock`). A bigger city is the core with a
  ring of blocks round it. The core is generated first from the seed's own
  stream and the ring afterwards from a stream of its own, so every block,
  building, tree, building plan, frontage and kerbside prop in the core comes
  out the same at any size. The same goes for the furniture: the core's kerbs
  and dumpsters are placed first, then the ring's. Road works and pickups put
  their usual number in the core, then add the same density in the ring from
  another stream. Districts are worked out in core blocks, so the core keeps
  its five; for now the ring carries the four quarters on outwards.
- **Hand-placed spots are written in core blocks**: the safehouse,
  payphones, frenzy tokens, the docks yard, the Pay 'n' Spray targets, the
  station, the hospital, the fixed bus stop, every story spawn in
  `missionsData.ts` (`corePavement`), gang hangouts, the starter pickups,
  and the TEST menu's district centres. Ramps and kickers stay on the
  core's inner roads. Spray-shop ids are core-relative (`spray-4-5` at any
  size). Race courses, `kerb()` spots and the spawn corner already used
  node coordinates centred on the origin, so they were already size-proof.
- **Pinned by a test** (`tests/cityCore.test.ts`): hashes of the core's
  blocks, buildings, trees, every hand-placed spot (missions included),
  hangouts, ramps, pickups, street props, landmark props, road works and
  bus stops. It passes at 16, 24 and 32 (`CURBSIDE_CITY=24 npx vitest run
  tests/cityCore.test.ts`). At 16 the whole generated world (city, plans,
  dressing, pickups, ramps, packages, hangouts) is byte-identical to
  `main`; that was checked by diffing a full JSON dump before and after.
- **Scale fixes:**
  - `segmentKey` (`world/roads.ts`) multiplied by a hard 1024, which
    collides once a city has more than 1,024 junctions (32 × 32 has 1,089).
    It now uses the real junction count. Nothing stores these keys, so the
    numbering change is invisible.
  - The low-res smoke pass's occluder boxes (`render/lowResFx.ts`) were
    one unculled batch of every building. They are now one batch per 256 m
    chunk, culled whole (`occluderChunks`, tested). In the shipped city
    that means up to a few small draws, only while the smoke pass runs,
    instead of one draw with 17k triangles.
  - The radar's map canvas (`ui/cityMap.ts`) keeps its side under 2,048 px
    (it would have been ~3,200 px, about 40 MB, at 32 × 32). The shipped
    city's stays at 1.5 px/m.
  - The baked contact-shadow texture (`world/ground.ts`) keeps its ~1.1 m
    texel as the ground grows (1,024 px for the core city).
  - A trial size saves apart (`curbside.save.city24`): its packages and
    pickups aren't the shipped city's, and a trial must not mark the real
    save's packages found.
- **Tests made size-aware:** the eight tests that hard-coded 16 × 16 (block
  count, lamp count, the NE corner at node 8, "off the map" at node 9, the
  north edge at −500 m, downtown's share of the kerb carts). The whole
  suite passes at 16 and 24. At 32 one placement test fails (below).

## Spike: what a bigger city costs

`tools/tune/citySize.mjs` builds the game as Pages does, boots it at each
size in headless Chromium (SwiftShader), and records the following: boot
time (page start until the game's hooks exist, which covers generation,
dressing, meshes and textures); the JS heap after a GC; and draw calls and
triangles at the spawn corner, in the ring, and in observe mode at the
widest zoom. It runs on a loaded 4-core server, so read the boot times and
heap as ratios between sizes. The draw calls are what the iPhone would
issue.

Run 2026-11-02 (`--runs 2`, medians; build of this branch). Draw calls are
the peak over a few frames 15 s after arriving; observe is at 1,000 m
height turned 45°, over the middle and over the ring (at 16, the edge).

| Profile | Size | Side | Buildings | Street props | JS heap | Spawn dc | Ring dc | Observe ring dc | Observe middle dc |
|---|---|---|---|---|---|---|---|---|---|
| iPhone 852×393 (`medium`) | 16 × 16 | 1.0 km | 1,404 | 7,562 | 35 MB | 54 | 35 | 66 | 82 |
| | 24 × 24 | 1.5 km | 3,137 | 16,686 | 53 MB | 53 | 34 | 63 | 82 |
| | 32 × 32 | 2.0 km | 5,539 | 29,334 | 76 MB | 50 | 41 | 71 | 79 |
| Desktop 1280×720 (`high`) | 16 × 16 | | | | 35 MB | 71 | 47 | 78 | 94 |
| | 24 × 24 | | | | 53 MB | 70 | 52 | 79 | 96 |
| | 32 × 32 | | | | 76 MB | 69 | 64 | 96 | 98 |

World generation alone (city, building plans, dressing, ramps, pickups,
packages; Node, median of 5): **43 ms at 16, 82 ms at 24, 175 ms at 32**.
The whole headless boot (generation plus meshes, textures and GLBs, on
SwiftShader) was 6–11 s at every size, with run-to-run noise bigger than
the difference between sizes. No page errors at any size.

**What it says:**

- **Draw calls don't grow with the map.** In play they're within a few
  calls at every size, because the city draws in 256 m chunks and the
  props in 32 m cells. Observe at the widest zoom stays under 100 on
  desktop and around 80 on the iPhone profile. The budget is 150.
- **Memory and generation grow with area, and stay small.** The heap goes
  from 35 MB to 53 MB at 24 and 76 MB at 32. Generation goes from 43 ms to
  82 ms at 24 and 175 ms at 32 on this server; the iPhone check will give
  the device's figure. The baked textures add a little GPU memory: the
  contact-shadow bake is 2.2 MB at 24 and 3.7 MB at 32, up from 1 MB.
- **24 × 24 is comfortable on every measure; 32 × 32 is affordable.** The
  limit is content, as the plan said. A 2 km city with today's five
  districts stretched over it would be mostly the same streets again.
- **Not measured here:** real frame times and memory on the iPhone (needs
  the device), and the GPU cost of the bigger occluder and shadow sets.

## Everything tied to a place (the inventory)

This is also the dependency list W3-D's overlay needs. **Core** means it is
written in core blocks or centred nodes and stays put. **Edge** means it
follows the city's edge, wherever that is. **Whole map** means it is spread
over the whole city.

| What | Where in the code | Anchored | Note for a bigger city |
|---|---|---|---|
| Blocks, buildings, trees, plans, frontages | `world/city.ts`, `buildingPlans.ts`, `frontages.ts` | core + ring | Ring from its own stream |
| Districts | `world/districts.ts` `districtOf` | core | Ring carries the quarters outward for now; needs districts of its own |
| Safehouse, spawn corner | `game/modes/places.ts` | core | |
| Payphones (4), frenzy tokens (8) | `places.ts` | core | All in the core: the ring has none |
| Docks yard (exports, Vex) | `places.ts` `placeDocks` | core | |
| Pay 'n' Spray ×4, police station, hospital | `world/landmarks.ts`, `streetSpots.ts` | core | One per quarter of the *core* |
| Story spawns and routes (KEEP IT LOUD, Night Shift, chapter 2) | `systems/missionsData.ts` | core | s6's coach tour and s4's truck stay in the core |
| Gang hangouts | `game/gangs.ts` | core | |
| Race courses (6) | `game/modes/races.ts` | centred nodes | RING ROAD RUN and HARBOUR LOOP use the core's old ring road (node ±8): in a bigger city that's an ordinary road with lights and side streets |
| Ramps, kickers | `world/ramps.ts` | core | None in the ring yet |
| Weapon/health pickups | `world/pickups.ts` | core + ring | Ring gets the same density |
| Road works | `world/roadworks.ts` | core + ring | Ring gets the same density |
| Bus stops, carts, street furniture | `world/streetStops.ts`, `streetProps.ts` | core + ring (fixed stop: core) | |
| Hidden packages (40) | `game/modes/packages.ts` | whole map | Shuffled over every block, so they all move in a bigger city and saves record them by index: **needs a decision and a save migration before a bigger city ships** |
| Traffic lights | `world/signals.ts` | edge | The core's old edge junctions get lights in a bigger city |
| Walls, outer ring road, `MAX_NODE` | `city.ts`, `roads.ts` | edge | Traffic, police, route-ahead, observe clamps all follow it |
| Chaos Run start, taxi fares | `chaosRunMode.ts`, `taxiMode.ts` | whole map | A Chaos Run can start in the quiet ring; fares stay 250–700 m |
| Scenes, crowds, traffic, police | `game/cityLife.ts`, `population.ts`, … | round the focus | Size-free |

## Still to do (the content)

- **Decide the size and the ring's districts** (owner). The proposal stands:
  24 × 24 (1.5 km, 2.25× the area), with the ring as one or two new
  districts rather than four bigger quarters. For example a seafront along
  one side, the suburbs proper on another, and an elevated ring road for
  chases. A new district means a `District` entry, its style, the shaders'
  district index, the radar tint, a name for the area card and the scanner.
- **Packages:** keep 40 over the bigger map, or 40 in the core plus new ones
  in the ring. Either way, migrate saves that recorded packages by index.
- **Give the ring things to do:** payphones, frenzy tokens, ramps, a race or
  two (a real ring road), a Pay 'n' Spray, and scene spots. Then retune what
  was tuned to today's size: the Chaos Run start, export distances, incident
  pacing, police response and helicopter range.
- **Vendor queues:** `placeVendors` checks that a cart's first customer
  spot is free but doesn't claim the next two, so later furniture can land
  in the queue. It never happens in the shipped city or at 24 (the test
  checks every cart). At 32 it happens once in the ring, so that test fails
  at 32. Claiming the spots changes the core's furniture, so fix it when the
  ring's content is placed and the fingerprints are re-pinned on purpose.
  (Since W3-D's per-block streams, 2026-11-03, the draws at 32 happen to
  miss it and the test passes; the gap is still there.)
- **On the iPhone:** open the dev server with `?city=24` (and 32). Check the
  Diagnostics report's boot line, memory, and draw calls in the ring and in
  observe at the widest zoom.
