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

## Status and next (2026-11-03)

Built and integrated on `claude/w3-map` (the engine and editor branches
merged): every version 2 section plays in the game, the editor edits all
of it, and the overlay shows dependents and problems (`checkMapEdits`,
through the editor's `problemsFor`). Checked end to end headless: local
edits (a road closed on DOWNTOWN DASH, a one-way, a bench) show in
CHANGES with the race in red; VIEW IN 3D reloads on them, with the
closure's 12 barriers and the bench in the dressing and 0 of 1,525 car
samples on the closed road over 60 s. Smoke: 102 checks OK.

Integration notes: the editor's preview restores the running game's
district paint *and* road rules (`restoreGameMap`; both are module state
`generateCity` installs); hydrants and food carts (hundreds) draw and pick
only zoomed in (`anchorShown`), unless they're a dependent, a problem or
the selection.

Still open:
- **On the iPhone:** the cold open's new shelter (66 m from the safehouse).
- **Not editable yet:** adding payphones and frenzy tokens (each is tied
  to jobs or a frenzy written in code: a new one needs its job or frenzy
  first), story spots (jobs are data in `missionsData.ts`).
- **Live rebuild gaps:** VIEW IN 3D's in-place rebuild doesn't redo what
  the game modes placed at boot, the city's scenes, bus stops and carts,
  the fountains' spray, the pigeons' map or the TEST teleport map; play
  after it reloads instead (below).

## Round 2 (2026-11-03, branch `claude/w3d-map-2`, 0.28.0)

The four "later" items and the packages, as the owner picked them:

- **Click again to cycle.** `picksAt(p, …)` lists everything at a point
  (spots nearest first, then props, then the road or block under them);
  a click again within a few pixels of the last steps down it
  (`nextPick`), and the toast says "2 OF 3 HERE". A press on the selected
  thing drags it even when it's lower in the stack.
- **Hidden packages are spots.** They stand at a fixed list
  (`PACKAGE_SPOTS`: what `generatePackages` gives for the unedited core
  city, same order, so saves by index are unchanged), so block edits no
  longer move them; ids `pkg-<index>`, movable and removable. The checks
  want 40 in all (the perks and 100% count 40). `pruneSave` keeps the
  indices of the shipped map's packages and this page's (a `?map=local`
  preview shares the save, so a package the edits remove isn't pruned).
  In a bigger city (W3-A) the packages are now the core's 40.
- **New spots.** A spot entry with `add` (`ramp`, `kicker`, `hangout`,
  `package`) adds one: `{ "id": "ramp-18", "add": "kicker", "x": 120,
  "z": 64, "heading": 1.57 }`. Ids come from `newSpotId` (past every
  generated and edited id with that prefix: `ramp-<n>`, `<gang>-<n>`,
  `pkg-<n>`; a package's number is its save index). Added ramps face
  along the road they stand on unless turned; an added hangout's crew
  lines up along the nearer street. Checks: an added id the city already
  has, an id of the wrong kind (`pkg-41` as a ramp), a move of an id
  nobody generated or added. PLACE's SPOTS group adds them; REMOVE drops
  the entry (AS GENERATED doesn't apply).
- **Empty lots and building style.** Block kind `lot`: a real `BlockKind`
  (so nothing that looks for plazas, parks or buildings picks it up):
  waste ground in the ground shader (dirt, gravel, weeds, a slab of what
  stood there, ruts from the bollard gap, puddles), a broken line of
  bollards and 4–8 bits of junk (dumpsters, barrels, carts, cones, bins),
  no carts or buskers, no packages generated on it. Block `style`: the
  buildings (and pavement paving) take that district's look, heights and
  shopfronts from the same random draws, so the footprints stay; the
  block keeps its district for everything else (`Block.style`). A style
  equal to the block's district is cleared.
- **VIEW IN 3D rebuilds in place** (`game/liveMap.ts`, README → *Map
  editor*): ~0.2 s on SwiftShader for one changed chunk, no new programs
  (the smoke test checks). Then observe mode over the selection. Because
  the modes' spots aren't redone, leaving the pause for play (or PLAY
  from the title) after a live rebuild reloads on `?map=local`; PLAY ON
  EDITS does that straight away (the old VIEW IN 3D).

## Roads, spots and props in the game (2026-11-03, branch `claude/w3d-engine`)

Every version 2 section now changes the game, not just the file. With the
committed (empty) map the city is byte-identical: the `cityCore`
fingerprints are untouched.

**Roads.** `generateCity` installs the edits' closures and one-ways
(`world/roadRules.ts`, module state like `paintDistricts`), and
`roads.ts` `canLeave` reads them: the road graph is the one choke point.
Audited every router: traffic's turns (`chooseTurn`), spawns (`spawnAi`,
population, police, route-ahead), `rerouteAi` (on a closed road it drives
off whichever way it can), pursuit and job routes and buses (`routeToward`
→ `roads.ts turnToward`), street races (`raceRoute`), the lost police
car's wrong turns (`smoke.ts`), kerb and scene spots (`segmentValid`:
parking, ice cream, cash run, film shoot, funeral), road works and bus
stops (none on a closed road or a one-way's empty lane), police roadblocks
(none on a closed road) and the chaos run's start. A dead end turns
traffic back (`chooseTurn`'s U-turn). The player isn't bound: a closed
road gets six road-works barriers and two blinking barrels across each end
(12 m from the crossing, past the stop line and the people's crossing),
street props with solids and knockables like a works site's, so no new
models or batches. The radar (`ui/cityMap.ts`) dims and hatches a closed
road and draws arrows down a one-way.

**Spots.** `world/spotEdits.ts` applies a spot edit; the placement
functions take `edits` (default `ACTIVE_MAP`, so modes, markers and the
radar agree with no wiring): `placeSafehouse` (`SAFEHOUSE` is the active
map's), `placePayphones`, `placeFrenzyTokens`, `placeHangouts(gangs,
edits)` (the crew moves with its hangout), `placeCityRamps(seed, edits)`
(ramps then kickers, ids `ramp-<n>` by that order; a heading turns a ramp
to the nearest quarter, ramps being axis-aligned). The dressing reads
`city.edits` (`City` now carries the edits it was built with). The
safehouse door faces whichever road its pavement runs along.

| Spot | Move | Turn | Remove | Why not |
|---|---|---|---|---|
| `safehouse` | yes | no | no | the shop; jobs drop off at it |
| `phone-*` | yes | no | no | story jobs ring them |
| `fz-*` | yes | no | no | each frenzy counts toward 100% |
| `vipers-<n>` (hangouts) | yes | no | yes | (a gang with none left is a check problem) |
| `ramp-<n>` | yes | quarter turns | yes | |

That's `spotRules(id)` in `game/mapAnchors.ts`; anything else (docks,
spray bays, story spots) is null: not in the file's reach.

**Props.** `placeStreetProps` takes the edits' props and closed roads. A
removal takes out the first generated prop of its kind within
`PROP_MATCH` and keeps its room claimed, so nothing else moves in; added
props and the closure barriers come after everything generated.
`STREET_PROP_KINDS` and `propEditable(kind)` are the palette (no lamps or
traffic lights: the night lighting and the signals are planned from them).
What couldn't be applied is in `street.propEditProblems`.

**Checks.** `checkMapEdits(city, edits, anchors, { street })` returns
`MapProblem { id, label, problem, edit?: { section, key }, at? }`
(`checkAnchors`' findings included, so it's the one list to show):

- a race course (or a job's race step) down a closed road or the wrong
  way down a one-way;
- a job's drive route (`via`) its car can't drive: a leg cut off, or the
  game's own turn-by-turn steering circling a closure it can't see round
  (simulated with `turnToward`);
- a bus stop on a closed lane or a crossing cut off, and Pike's fixed stop
  closed;
- crossings traffic can't get to, or can get to but not leave (a one-way
  trap), against the biggest strongly connected part of the network;
- a spot edit naming no spot, or one the file can't edit; removing a spot
  the game needs; a heading for a spot with no facing; a pavement spot
  moved into the road or a ramp moved off it; a gang with every hangout
  removed (a moved spot inside a building or off the map comes from
  `checkAnchors`, blamed on the spot edit);
- a prop removal that matched nothing, or a kind that can't be edited.

`anchors` must come from `collectAnchors(city, { ramps, busStops, edits })`
for the same edits. `editsOn(edits, pick)` lists the edits on a block,
road or junction for the overlay's panel.

**Inventory.** `collectAnchors` also takes vendor carts
(`street.vendors`) and hydrants (any can burst), carries bus stops' lanes
and ramps' ids, flags moved spots, and lists the TEST menu's Neon Mile
teleport (the arts blocks' middle, snapped to the pavement). Not added:
kebab, film-shoot and hydrant-scene spots are picked near the player at
run time, not fixed; hidden packages stay out (owner's call).

**Checked in the game:** a headless run on `vite preview` with `?map=local`
closing (0, −1)–(0, 0) and (−1, 0)–(0, 0) by the spawn corner and making
(0, 0)→(0, 1) one-way: 60 one-second samples, 1,556 AI car-samples
around the player, none on either closed road (the barriers stood, 16
props); on the one-way, 5 with the flow and 3 samples of one tow truck
turning round to head south mid-block (its route was legal). Cars parked
by the spawn corner's own placement stay where they're put.

## The editor (branch `claude/w3d-editor`)

A desktop 2D editor rather than a live 3D rebuild: TEST → MAP → MAP EDITOR
(hidden on touch screens) pauses the run and opens the whole city top-down.
`ui/mapEditor.ts` draws and wires; the logic is in `game/mapEditorState.ts`
(no DOM, no three.js; `tests/mapEditorState.test.ts`).

- **Preview:** every edit rebuilds the edited city (`generateCity`,
  `dressCity`, `collectAnchors`, spot edits applied, then the checks), about
  90 ms after the last change (a slider drag is one undo step, on release).
  ~45 ms for the city, ~140 ms in all on a slow machine. `generateCity`
  installs its district repaints for the whole game, so `buildPreview` puts
  back the running game's (`paintDistricts(ACTIVE_MAP.blocks)`) before it
  returns; the tests and the smoke test check `districtOf` is unchanged
  after the editor closes.
- **Controls:** drag (or arrows / WASD) to pan, wheel (or + / −) to zoom, 0
  to fit; click to select; drag a selected movable spot or added prop to
  move it; Del removes it; R / Shift+R turns a ramp or added prop; Esc stops
  placing, then deselects, then closes; Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y). The
  editor takes the keyboard while open, so the game's Input never sees it
  (Backspace would back out of the menu).
- **Panel:** a block's kind, district, REROLL (variant + 1) and GENERATED
  LAYOUT, height ×0.4–1.6, AS GENERATED; a road's OPEN / CLOSED / ONE-WAY
  either way and FLIP; a crossing's four roads; a spot's REMOVE, PUT BACK,
  AS GENERATED and (ramps) TURN; a prop's REMOVE / PUT BACK / TURN. A field
  set back to what the city generates is cleared, so a block set back is
  no edit at all. PLACE (street prop kinds) then click the map.
- **Overlay:** `dependentsOf(anchors, pick)` for the selected block, road
  or crossing: ringed in cyan, courses as lines through every crossing,
  job drive routes dashed through the crossings they steer for, listed with
  labels (click one to go to it). A selected spot shows its own course and
  what shares its place.
- **Problems:** `problemsFor(city, edits, anchors)` is the one place the
  checks come from: `checkAnchors`, plus a course over a closed road or the
  wrong way up a one-way street, a spot on a closed road, a drive route
  heading for a crossing every road into is closed, a removed spot the game
  needs, an edit to a spot the map can't move, an added prop inside a
  building. Red on the map (rings, roads) and in the list.
- **Files:** local edits auto-save to `curbside.map.local` (cleared when
  they match the shipped file). CHANGES is `diffMapEdits(SHIPPED_MAP,
  local)` with REVERT per entry and RESET ALL; EXPORT downloads `city.json`,
  copies it and shows it in a box ("commit as src/world/maps/city.json").
  VIEW IN 3D saves and reloads on `?map=local&look=x,z`: the game boots on
  the local edits and enters observe mode over the selection (or the view's
  centre); SHIPPED MAP goes back.
- **Seams for the map engine:** `spotRule(id)` (a conservative stand-in:
  the safehouse and payphones move but stay; frenzy tokens, hangouts and
  ramps move and go; nothing else is a spot) and `problemsFor` (to call
  `checkMapEdits`). The preview shows prop edits and spot moves itself
  (removed props as red crosses, added ones green); both are idempotent
  once the engine applies them in `dressCity` / `collectAnchors`.
- Undo keeps up to 200 MapEdits snapshots. (VIEW IN 3D now rebuilds in
  place: see *Round 2* above.)

