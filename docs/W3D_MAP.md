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


## Round 3: spots (branch `claude/w3d-spots`)

The owner's six asks, all in the file, the game, the checks and the
editor. With the committed (empty) map the game is byte-identical: every
`cityCore` fingerprint and existing test is untouched; the new pieces are
pinned in `tests/mapSpots.test.ts`.

### The file

Still version 2: new optional fields on spot entries and two optional
sections, `jobs` and `landmarks`, written only when they have entries (so
an older map, and the committed one, write the same bytes). Canonical as
before (each section sorted by id, keys in a fixed order), and parsing
drops what it can't read with a reason.

```json
{
  "version": 2,
  "seed": 1337,
  "blocks": [],
  "roads": [],
  "spots": [
    { "id": "fz-0", "add": "frenzy", "x": 44, "z": 9.5, "frenzy": { "goal": "wreck", "target": 9, "seconds": 70, "gift": "shotgun" } },
    { "id": "phone-0", "add": "phone", "x": 34, "z": 9.5 },
    { "id": "pickup-0", "x": 18, "z": 9.5 },
    { "id": "pickup-59", "add": "pickup", "x": 52, "z": 9.5, "pickup": "rocket" },
    { "id": "story:m3-saints/steps.0.start.0", "x": -218, "z": 261.5, "heading": 1.57 },
    { "id": "story:m4-parcels/steps.0.points", "points": [[100, 41], [130, 41], [160, 41]] },
    { "id": "story:s6-quietest/steps.0.start.0.route", "nodes": [[-1, -3], [-4, -4], [0, -6], [3, -5], [3, -2], [1, -1]] }
  ],
  "props": [],
  "jobs": [
    { "id": "s3-quiet", "phone": "phone-0" }
  ],
  "landmarks": [
    { "id": "spray-ne", "at": [12, 2] }
  ]
}
```

### 1. Payphones, and jobs on them

- PLACE → PAYPHONE adds `phone-<n>` (`newSpotId`; the shipped phones are
  words, so no clash). `placePayphones(edits)` lists the added ones after
  the city's, so the jobs, the booths (the dressing), the radar and the
  TEST menu all have them.
- **`jobs: [{ id, phone }]`** rings a story job from any phone, generated
  or added. Applied in `buildMissions(docks, safehouse, edits)`
  (`systems/storyEdits.ts editMissions`; the edits default to the map the
  page plays), which every reader goes through. Arcs: missionMode rings
  each arc's next job from that job's own `phone`, so a job's phone is
  per job, not per arc.
- **Editor:** a phone's panel lists the jobs it RINGS FOR (each goes to
  its spot; OWN PHONE puts a moved one back) and MOVE A JOB HERE (every
  job, with its arc and current phone). A story spot's panel has RINGS
  FROM, the job's phone. Setting a job back to the phone it was written
  for clears the entry.
- **Checks:** an added phone no job rings; a job naming a phone that isn't
  on the map, a job id nobody has, the cold open given a phone; a phone
  both arcs ring (the main story by day, the Night Shift after dark: both
  can ring at once, and one booth would carry two calls), blamed on the
  job moved there. An added phone can be removed (dropping its entry);
  the four generated ones still can't (`spotRules`: `removable` is
  `!generated` for phones and frenzies).

### 2. Custom frenzies

- PLACE → FRENZY TOKEN adds `fz-<n>` with a `frenzy: { goal, target,
  seconds, gift? }` (it starts as KNOCK DOWN 15 in 60 s). Its panel sets
  the goal (any `FrenzyGoal`; a new goal takes that goal's defaults), the
  target and time (number fields, clamped and stepped to the goal's
  limits) and the gift (none or any weapon but the story's sticky charge).
  `needsCar` follows from the goal as the shipped eight's do (near miss,
  drift, hit & run, smash), and the HUD title is worded the same way
  (`frenzyTitle`: "WRECK 9 CARS", "DRIFT 3,000"; a test checks it
  reproduces all eight shipped titles).
- **Limits** (`game/modes/frenzyLimits.ts FRENZY_LIMITS`): knock-downs
  3–40 in 20–180 s, wrecks 2–20 in 20–180 s, drift 500–10,000 points (in
  hundreds) in 15–120 s, near misses, hit & runs 3–30 and smashes 3–40 in
  20–120 s, carjacks 2–12 in 30–240 s, a combo ×3–×10 (frenzyCredit caps
  it at 10) in 20–120 s; seconds in 5s. `parseMapEdits` clamps and says
  so, drops an unknown goal; `checkRound3` flags anything off in a file
  written by hand.
- **In the game:** `frenzyList(edits)` is the shipped eight then the
  map's; `ACTIVE_FRENZIES` (this page's map) is what frenzyMode,
  progressDirector (completion, the PROGRESS row, the save's prune) and
  the TEST menu's import read; `placeFrenzyTokens` places the tokens. A
  custom frenzy plays exactly as a shipped one: token, 3-2-1, the count,
  $1,000 the first time, gold, saved by id. A preview on `?map=local`
  keeps its custom frenzies' ids in the save; the shipped map prunes
  them (as packages do).

### 3. Story spots

- Every job spot the inventory walks is a spot edit on the inventory's own
  id, `story:<job>/<path>` (the path into the job's definition: stable for
  a given `missionsData.ts`, and the label says what it is: "SAINTS'
  PAINT: saintcar"). A point takes `x`, `z` (and `heading` for a parked
  car: R turns it a quarter); a drive route (`.route`, the crossings
  `via`) and a race step (`.nodes`) take `nodes`, the crossings in order;
  a collect step (`.points`) takes `points`. Not removable.
- Applied in `buildMissions` (`storyEdits.ts`, walking the same way as
  `storyAnchors`; a test keeps the ids equal), so the game, the dressing's
  reserved kerbs and the inventory read the moved spot. Jobs it doesn't
  touch are untouched; an edited job is a deep copy that shares no lists,
  so moving one path never moves another that happened to share an array.
- **Editor:** points drag; a route, race or collect step shows numbered
  handles at its crossings or points: a crossing drags and snaps to the
  nearest crossing, a collect point goes where it's dropped. Back as
  written clears the edit.
- **Checks:** the wrong shape (x on a route, a list of the wrong length);
  a spot written on the road (a parked car, a kerb) moved off it, or a
  pavement or lot spot moved into it; plus the existing ones, now blamed
  on the edit: inside a building, off the map, a mayhem area outside the
  district it was written for, a race leg off its road, a route heading
  for a crossing off the map or one closures cut off.

### 4. Landmarks

- **`landmarks: [{ id, at }]`** moves the docks yard, the four spray bays
  (`spray-nw`, `spray-ne`, `spray-sw`, `spray-se`: the quarter each
  serves, `SPRAY_SLOTS`) or the station and hospital to core block `at`.
  The placement functions read `city.edits`, so everything that places
  from them follows: the bays and their booths, the export garage, the
  station's sign, keep-out zones and furniture clearance (the dressing),
  heat's shops and station, the hospital's doors and ambulance bay
  (cityLife), the docks' delivery zone, Vex's spot beside it, the radar
  and the TEST teleports.
- **Same shape:** a bay goes on an open lot's road edge (`bayFor`: the side
  facing the centre if clear, else any clear side); the station and
  hospital on a built-up block, on the side they're written for. A moved
  bay's block is taken first, so the generated ones place round it.
  Something that doesn't fit stays where the city puts it and
  `checkRound3` says why (not built up, built up, no room for a bay,
  another landmark took that lot).
- **Editor:** drag a landmark: every block it fits is ringed green while
  you drag (`landmarkBlocks`), and the drop snaps to the block under the
  cursor; back on the block the city gives it clears the entry
  (`landmarkHome`). AS GENERATED in its panel too. Not removable.

### 5. Pickups

`placePickups(seed, edits)` gives the crates ids (the core's scatter
`pickup-0..55`, the three starters `pickup-56..58`, a bigger city's ring
`pickup-ring-<n>`) and applies spot edits: move, remove, and add
(`pickup-<n>` with `pickup: <kind>`, PLACE → PICKUP: <KIND>; an added
one's panel changes its kind). The generated crates don't depend on the
blocks (they scatter by the seed), so they didn't need pinning as
packages did; with no edits they're exactly `generatePickups`'. main.ts
plays `placePickups(1337, ACTIVE_MAP)`. The pavement check applies (a
crate moved into the road is flagged).

### 6. Inventory and overlay

- Shop doors (`world/shopSpots.ts`: the awnings the scenes use, ~1,600)
  and the 18 road works sites join the inventory (`collectAnchors` inputs
  `shops`, `roadworks`; `collectRound3`). They're detail groups: drawn
  (shop doors as dots) and picked only zoomed in, unless they're a
  dependent or the selection. The editor's preview keeps them in
  `Preview.extras`, apart from `anchors`.
- **CAN HOST** (`game/sceneHosts.ts`): a selected block or road lists what
  the run-time scenes could pick there, worked out with the preview's
  districts and road rules: shelter from the rain (awnings), the night
  crowd under the neon, kebab chucking-out time (neon shops in Neon Mile
  and Cobble Row), a burst hydrant, buskers and the ice cream van's stop
  (a park or a plaza that isn't a car park), and on a road each kerb
  traffic can reach (ice cream van, cash run, funeral) and the downtown
  ones a film shoot can use. Close a road and its kerb scenes go from the
  list.

### Not done, or done differently

- **Landmarks are a section of their own, not spot edits.** They move
  block to block (the file holds a block, not a point), and the editor's
  `spotRule` still says the station isn't a free spot (an existing test
  pins it).
- **The four generated phones can't be removed** even with no job on
  them (the rule is per id; an existing test pins `phone-docks` as fixed).
  An idle generated phone isn't a problem.
- **A spray bay's side** follows `bayFor` (the side facing the centre if
  clear); the file can't pick a side.
- **Story spots that share a place** (Doreen and her pitch, the mayhem
  area and the scene in it) are separate entries and move separately.
- **Consecutive main-story jobs on one phone** (the shipped data never
  does it; the missions test checks the data) isn't a check: it's the
  owner's call on an edited map.
- **VIEW IN 3D** doesn't redo round 3's spots live (liveMap is being
  reworked); PLAY ON EDITS / `?map=local` applies all of them.

**Checked end to end** (headless, `vite preview`): placing a phone and
moving QUIET PLEASE to it, a WRECK 9 CARS frenzy with a shotgun, a rocket
pickup and a moved crate, the Saints' car moved along its kerb, the coach
route's last crossing dragged, the north-east spray bay dragged to the car
park at (12, 2); then `?map=local`: the job rings from `phone-0`, nine
frenzy tokens with WRECK 9 CARS among them, the Saints' car and the coach
route where they were moved, the spray booth on the new lot and none on
the old, 60 pickups with the rocket. `tools/smoke.mjs` does the same on
desktop (`mapSpotsCheck`).

## Round 3: streets (branch `claude/w3d-roads`)

The owner's "can we edit or remove streets?": two new states for a road
segment (between two neighbouring crossings), next to open, closed and
one-way, in the road panel's STREET row and the crossing panel's four
roads.

**Format.** In the `roads` section, exclusive with `closed`/`oneWay`
(written smaller crossing first, no direction):

```json
{ "a": [-3, -3], "b": [-3, -2], "pedestrian": true }
{ "a": [-3, -1], "b": [-3, 0], "removed": true }
```

Parsing keeps one state per entry (removed, then pedestrian, then closed,
then one-way wins, with a problem saying so); canonical text, CHANGES
("Road …: pedestrian street", "Road …: removed (blocks merged)"), REVERT
and undo as for any road edit. `MAP_EDITS_VERSION` stays 2 (an older build
reads the entries as "changes nothing" and drops them).

**Pedestrian street.** `RoadRules` shuts both lanes, so `canLeave` (and so
every router audited for closures: turns, spawns, routes, buses, races,
parking and kerb scenes, road works, bus stops, roadblocks) treats it as
closed. It's drawn as the district's paving across the whole carriageway
with a drainage channel down the middle (no lane markings, stop lines or
crossings); the junctions keep their own markings. Eight bollards across
each end (9.6 m from the crossing, 1.5 m gaps: people walk through, cars
stop, but for a 2.4 m gap in the middle a car can just squeeze through;
none at an end whose crossing has no road left), and down the middle
planters, benches, bins, bike racks and pairs of café tables
(`dressPedestrianStreet`, a stream keyed by the street). People walking
the blocks either side stroll down it, each on their own line 0–7 m out
into it (`crowd.ts strollCorner`, from their pace: no extra draw). The end
crossings lose that arm's signal pole, and their lights altogether when
fewer than three roads are left (`hasSignals`). The radar paves it with a
dashed line and bollard bars; a crossing with no road left is paved.

**Removed road.** The road becomes land and the blocks either side one
block. Decisions:

- *Rectangles only, refused in the editor.* REMOVE (`blockMerge.ts
  removeRoad`) merges the two sides (each a block or a merge) when their
  union is a rectangle, removing every road inside it (two stacked 2×1s
  plus the road between make a 2×2 and take its last inner road too);
  otherwise it's refused with the reason shown under the button ("That
  would make an L-shaped block…"). The outer ring road is refused ("there's
  no block beyond it"). Putting a removed road back (any other mode) cuts
  its merge along that whole grid line, so both sides stay rectangles
  (`restoreRoad`). A hand-edited file can still hold a bad set: those
  removals aren't applied (they play as closed roads, barriers and all) and
  `checkMapEdits` names each with why. A crossing whose every arm is
  removed (the middle of a 2×2) is land.
- *The north-west block decides.* The merge takes its north-west block's
  kind, district, style, variant and height (its edit, if any); the
  editor's block panel selects and edits the merge as that block (a click
  anywhere on it picks it; the panel says "Merged block, 2×1 blocks").
  Edits on the merge's other blocks don't apply and are flagged.
- *Local.* Every block of the merge still draws its generated content from
  the city stream and throws it away; the north-west block fills the whole
  interior from `blockSeed(…) ^ MERGE_SALT` (a park gets trees for its
  area). `tests/mapLocality.test.ts` pins a 2×1, a 2×2 and a pedestrian
  street: every prop, bus stop, cart, road works site, building and plan
  outside the edited cells as before.

`Block.merge` (on every block of it: the north-west block's indices and
the size) carries the merge; every member has the merge's kind, district
and whole `interior`; `mergedAway(b)` is true for all but the north-west
block, which the placing modules dress. `blockSpan(bx, bz)` and
`RoadRules.mergeAt/sideStreet/streetAt/crossingStands` answer for code
without the city. `installMap(edits)` (city.ts) installs districts, road
rules and the merges' repaints; the editor's `restoreGameMap` uses it.

**Drawing.** The ground shader gets one more data texture, `uRoadMap`
(per block: its four sides' state, 2 bits each, and its place in a merge),
and a uniform `uStreets`; with no street edits `uStreets` is 0 and the
shader takes the old path (one uniform branch: same look, same cost). A
side that isn't a road moves the block's kerb box out past the cell edge
(a junction corner stays road unless both its sides are gone), and a
merged block's lot (park paths, plaza fountain, car-park bays, waste
ground) spans the whole merge from its centre. Street lamps along a
removed road go: no posts (`generateStreetLamps`, `lampsNear`) and no
light (`uDarkLamps`, up to 8 merged interiors in the shared world
uniforms, skipped by the lattice in `ubStreetLight` and the ground's lamp
glints; a ninth merge keeps pools of light with no post, and the checks
say so). No new shader programs: compiled once at boot, updated by
uniforms and texture data (`refreshGround`).

**BLOCK_SIZE audit** (the 53 files that assume the 64 m grid):

- *Changed:* `city.ts` (merges), `roadRules.ts`, `ground.ts`,
  `shaderLib.ts` (lamps), `streetLamps.ts`, `signals.ts`, `streetProps.ts`
  (no kerb furniture along a removed road, a merge dressed once, bollards
  and dressing on pedestrian streets, dumpsters by merge), `kerbs.ts`
  (`sideStreet`, `sideRemoved`), `streetStops.ts` (carts), `buildingPlans.ts`
  (street faces round the merge), `dressing.ts`, `crowd.ts`
  (`cornerPoint` is the merge's, crossings only straight over a road,
  strolling), `population.ts` (edge length), `landmarks.ts` (spray bays
  and the station on a merge's outside), `streetSpots.ts` (hospital),
  `parkWater.ts` (one fountain or sprinkler set per merge),
  `fxDriving.ts` (grass across a merged park), `neonReflect.ts` (no damp
  road on land or paving), `pigeons.ts` (landing spots round a merge),
  `steamVents.ts`, `stringLights.ts` (none on a removed road),
  `buskers.ts`, `cityMap.ts` (radar), `mapAnchors.ts` (`blockAt`,
  `roadAt`, `districtBlockAt` see merges; checks), `mapEditorState.ts`,
  `mapEditor.ts`.
- *Fine as they are* (they go through `canLeave`/`segmentValid`/`isClosed`
  or `cornerPoint`, or work on crossings a course names): `roads.ts`,
  `traffic.ts`, `routeAhead.ts`, `police.ts` (roadblocks skip `isClosed`),
  `incidents.ts`, `trafficScenes.ts`, `doubleParking.ts`, `funeral.ts`,
  `filmShoot.ts`, `cashRun.ts`, `iceCream.ts` (per-block kinds: members
  carry the merge's), `conga.ts`, `strayDogs.ts`, `muggings`, `pickups`,
  `places.ts`, `races.ts`, `raceCrasher.ts`, `crasherBlips.ts`,
  `trafficLook.ts`, `radarRoute.ts`, `stinger.ts`, `opening.ts`, `gangs.ts`,
  `ramps.ts`, `missionsData.ts`, `missionMode.ts` (courses, routes and
  spots over a removed or pedestrian road are check problems, not moved),
  `packages.ts` (fixed spots; checked), `testSpots.ts`, `landmarkProps.ts`,
  `frontages.ts` (shopfronts come from the plans), `cityMesh.ts` (lamp
  stand-ins from `generateStreetLamps`), `districts.ts` (merges repaint
  through `paintDistricts`), `pigeonMesh.ts`.

**Checks** (`checkMapEdits`, so the editor's problems list too): a removal
that can't apply (ring, L, a road left inside), a course or a job's race
step down a pedestrian street or a removed road, a spot or job spot (any
anchor point) or an added prop standing on a removed road, a drive route
heading for a crossing inside a merge, a block edit on a merge's other
block, more than 8 merges (lamps). Connectivity treats both as closed, and
crossings with no road left drop out of the network check. The editor adds
"stands on a pedestrian street" for a spot parked on one, and draws the
course legs red.

**VIEW IN 3D** rebuilds them in place: the ground's road map and
`uStreets`, the dark lamps, the city mesh's chunks, the props (bollards,
dressing, signal poles), the radar, and the crowd and traffic read the
installed rules. What it doesn't redo (as before): the scenes' block maps
(ice cream, pigeons' ground, tyre dust on grass) until PLAY ON EDITS, and
cars already on a road it removes or paves stay where they are (a parked
car, one finishing the block); nothing new drives on (the smoke test
checks, leaving those out).

**Checked in the game** (headless on `vite preview`, `?map=local` with a
pedestrian street (1, 1)–(2, 1), a 2×1 merge ((1, −1)–(1, 0) removed) and
a 2×2 round crossing (−2, −2)): 41 shader programs with and without the
edits; three 60 s runs round them, 4,913 car samples within 150 m, none on
the pedestrian street or a removed road; 179 people-samples on the
pedestrian street (111 of them in its middle 12 m); 16 bollards; no lamp
posts in the merge; buildings across the old road; the end crossings'
poles for the gone arms missing and the rest standing. Draw calls and
triangles (desktop, observe, top-down, same views; traffic and people
differ run to run):

| View | Shipped map | With the edits |
|---|---|---|
| 400 m up over the centre | 76 calls, 272k tris | 80, 274k |
| 70 m over the pedestrian street | 54, 128k | 56, 133k |
| 70 m over the 2×1 merge | 64, 143k | 55, 136k |
| 110 m over the 2×2 merge | 81, 210k | 75, 169k |

The edits add no draw calls of their own (bollards and dressing are
instances in the prop batches; the road map is a texture on the ground's
one draw).

**Not done / open:**
- Merged blocks' lamps: only the first 8 merges put their light out.
- The scenes' per-block maps (ice cream vans' nice blocks, the pigeons'
  ground, tyre dust on grass) are built at boot, so after VIEW IN 3D
  they're the boot city's until PLAY ON EDITS (as for any block edit).
- Hand-placed spots on a removed road (a frenzy token, a job's scene, a
  race start) are flagged, not moved: the owner moves them or picks
  another road.
