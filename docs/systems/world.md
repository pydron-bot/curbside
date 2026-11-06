# World

The Blender models for the street, the landmarks and the vehicles
(`public/assets/props.glb`, `pickups.glb`, `debris.glb`, `heli.glb` and the
new roots in `vehicles.glb`; see `docs/BLENDER_TODO.md`). Until a GLB
arrives the old box stand-ins draw; when it does they're dropped for good
and every new program is compiled behind the current frame.

- **Prop models** (`render/propModels.ts`): each GLB root is merged into
  one geometry with a colour and a *surface class* per vertex, taken from
  its material name: `lamp` glows at night, `light_red/amber/green` follow
  the signal cycle, `police_lamp` pulses, signs and crate stripes are
  self-lit, hazard paint catches the light, the ramp deck gets chevrons,
  red tips blink, `searchlight`/`siren_*` flash, `frenzy` takes the
  instance tint, `booth_roof` can be cut away.
- **Families** (`render/propBatch.ts`, `render/propChunks.ts`,
  `render/worldProps.ts`): a family's models are packed one after another
  into a vertex texture (RGBA32UI, two texels a vertex: position and
  surface class; normal and colour as half floats), and each prop is drawn
  as a few *chunks*, instances of a fixed run of vertices (the size picked
  per family from its models: 126 for `street`, 156 for `roofs`, a whole
  288 for `lamps`) that the vertex shader pulls from its own model's
  stretch, dropping the run past the model's end. So a prop runs only its
  own model (rounded up to whole chunks), and a family is still one draw
  call (and one in the shadow pass) with no WebGL extension: `lamps`,
  `street` (traffic lights, furniture, road works, carts and shelters),
  `roofs`, `trees`, `landmarks`, `things` (pickups, frenzy tokens,
  packages, roadblock barriers and cones, knocked-over props in flight)
  and `debris`. Static instances are bucketed in 32 m cells and the
  buffers (a copy per chunk) are refilled only when the view crosses a
  cell; per-frame ones are appended. One program for all of them, each
  family with its own vertex texture. Not `BatchedMesh`: it draws every
  instance as its own draw (on iOS through `WEBGL_multi_draw`, which
  Safari has had since 15 but ANGLE's Metal backend runs as a loop of
  draws; without it, as Firefox is, one WebGL call per prop), and it has
  no per-instance attributes for the props' phase, road, glow and tint.
- **Lamp short lists** (`world/streetLamps.ts` `lampsNear`,
  `render/shaderLib.ts` `lampList` / `UB_LAMP_LIST`): each prop, rubble
  chunk and flying car part carries the (at most two) street-lamp heads
  whose light can reach any of it, worked out on the CPU when it's placed
  (every frame for the moving ones), and lights from those at night
  instead of `ubStreetLight`'s walk of eight lamps per fragment. Every lamp
  left out is out of reach, so it's the same light at a quarter of the
  terms (`tests/lampList.test.ts` checks it against the lattice); lamps
  stand 16 m apart and never at a corner, so every street prop qualifies,
  and anything bigger that more lamps reach walks the lattice as before.
  Same program per family (a per-instance branch, no switch mid-play);
  rubble uses a `lampList` variant of the city's prop material, one more
  program compiled at start-up. The fx debris boxes were already on plain
  Lambert with no lamp light.
- **City size** (`world/city.ts`, W3-A groundwork; `docs/W3A_CITY.md`):
  the shipped city is 16 × 16 blocks, the *core*. `?city=24` or
  `?city=32` in the URL (`CURBSIDE_CITY` under Node) builds a ring of
  blocks round it, and the core comes out block for block the same: it's
  generated first from the seed's stream, the ring from its own, and
  hand-placed spots are written in core blocks (`core()`,
  `corePavement`). `tests/cityCore.test.ts` pins the core's fingerprint at
  any size. A trial size saves under `curbside.save.city24`.
- **Map edits** (`world/mapEdits.ts`, `game/mapAnchors.ts`, W3-D
  groundwork; `docs/W3D_MAP.md`): the owner's edits to the generated city
  live in `src/world/maps/city.json` (bundled; empty today), read by
  `parseMapEdits` (never throws, reports what it drops) and applied by
  `generateCity(seed, edits)`: a block's kind (buildings, park, plaza, car
  park, empty lot: waste ground with junk, a broken line of bollards and
  no carts or buskers), a district repaint (same footprints, the new
  district for `districtOf`/`districtAt` everywhere), a building style
  (another district's look for its buildings and pavement, `Block.style`,
  the district kept for the game) and a variant reroll, in core blocks. An edited block is rebuilt from its own stream, so other blocks
  don't move. `collectAnchors` lists everything tied to a place (spots,
  jobs' spawns and routes, races, hangouts, ramps, bus stops);
  `dependentsOf` says what relies on a block, road segment or junction and
  `checkAnchors` what an edit breaks. `tests/mapAnchors.test.ts` runs the
  checks on the committed map. The dressing is placed block by block from
  streams keyed by core block (`keyedStream`), and the building plans and
  shopfront furniture by where each building stands (`buildingStream`), so
  an edit moves nothing outside its own block (`tests/mapLocality.test.ts`)
  and the core's furniture is the same at any city size.
  The rest of version 2 is live too. **Roads**: `generateCity` installs
  the closures and one-ways (`world/roadRules.ts`, like `paintDistricts`)
  and `roads.ts` `canLeave` reads them, so every router keeps them
  (traffic's turns and spawns, `turnToward`/`routeToward` for pursuits,
  jobs and buses, street races, kerb and scene spots; a car knocked onto a
  closed road drives off it); no road works, bus stops or roadblocks on a
  closed road or a one-way's empty lane; road-works barriers and barrels
  across both ends of a closed road (knockable: the player isn't bound);
  the radar hatches closed roads and arrows one-ways. **Spots**:
  `placeSafehouse`, `placePayphones`, `placeFrenzyTokens`, `placeHangouts`,
  `placeCityRamps` (ids `ramp-<n>`) and `placePackages` (`pkg-<n>`) apply
  moves, turns and removals (`world/spotEdits.ts`), defaulting to
  `ACTIVE_MAP`; the dressing reads `city.edits`. A spot entry with `add`
  adds a new ramp, kicker, gang hangout or package (`addedSpots`; ids from
  `newSpotId`, past every generated one). `spotRules(id)` says what may
  move or go (and whether the city generates it). **Props**:
  `placeStreetProps` removes a generated prop of the edit's kind within
  `PROP_MATCH` (its room stays claimed) and adds props last
  (`propEditable`: not lamps or traffic lights). **Checks**:
  `checkMapEdits(city, edits, anchors, { street })` adds to `checkAnchors`
  courses over closed roads or against one-ways, drive routes that can't
  get round, bus stops cut off, crossings traffic can't reach or leave,
  bad spot and prop edits (an added spot reusing an id or with the wrong
  kind of id, a package count other than 40), each naming the edit at fault; `editsOn` lists
  the edits on a pick (`tests/mapEditsApply.test.ts`).
- **Map editor** (`ui/mapEditor.ts`, logic in `game/mapEditorState.ts`;
  TEST → MAP → MAP EDITOR, desktop only; its code loads the first time it
  opens, so `await __ub.mapEditor.open()` before reading `.editor`): the city top-down on a canvas
  (drag or arrows to pan, wheel to zoom), every anchor as a labelled icon
  and, zoomed in, the street props. Click a block (kind, district,
  building style, REROLL, height), a road (open, closed, one-way, FLIP), a
  crossing, a spot (drag to move, Del removes where `spotRule` allows,
  ramps turn) or a prop (remove, put back); click again in the same place
  for what's stacked under it (`picksAt`, `nextPick`). PLACE adds a street
  prop or a new spot (stunt ramp, kicker, gang hangout, hidden package). The selection's dependents
  (`dependentsOf`) are drawn (courses and job routes as lines) and listed;
  `problemsFor` runs every check after each edit and turns breakages red.
  Ctrl+Z / Ctrl+Shift+Z, edits saved locally (`curbside.map.local`), CHANGES
  against the shipped file with REVERT and RESET ALL, EXPORT (downloads and
  copies `city.json` to commit as `src/world/maps/city.json`), VIEW IN 3D
  and PLAY ON EDITS. The preview puts the game's district repaints back
  after every build.
  VIEW IN 3D rebuilds the running city in place (`game/liveMap.ts`): the
  city's blocks, buildings and trees (in place, so every holder sees
  them), districts and road rules, ramps, dressing, collision and
  knockables (`StaticGrid.reset`, `Knockables.replace`), and through
  `Look.rebuildCity` the ground's lot texture and contact shadows, the
  building plans, the city mesh's changed 256 m chunks only
  (`CityMesh.rebuild` hashes each chunk's contents), every static prop
  (`WorldProps.rebuild`), the searchlights, neon reflections and smoke
  occluders, then the radar (`refreshMap`). Same materials, so no new
  shader programs. Observe mode opens over the selection. The edits become
  the page's map first (`setActiveMap`, `world/shippedMap.ts`: a live
  binding, with `onActiveMap` for what's derived from it, `SAFEHOUSE` and
  `ACTIVE_FRENZIES`), and after the world `main.ts remapGame` has every
  system that placed things at boot place them again: pickups
  (`PickupMesh.refresh`), the game modes (`ProgressDirector.remap`: what's
  running stops as on quitting, then each `Mode.remap`: the docks, jobs and
  phones, the opening's job, frenzy tokens, packages, hangouts and crews),
  heat's spray bays and station and their blips, the city's life
  (`CityLife.remap`: shelters, carts, keep-outs, the hospital, car-park
  bays, then each `Scene.remap`), park water, steam vents, pigeons' landing
  map and the TEST teleports; cars and people now inside something solid
  go, and upkeep fills the streets again. So play goes on on the edits with
  no reload, and the URL says `?map=local` (a reload keeps them). PLAY ON
  EDITS still reloads on them.
- **IMPORT** (map editor bar, or a file dropped on the editor): a city.json
  read by `importMapText` (`game/mapEditorState.ts`: not JSON, no
  `version` or an unknown one is refused with the reason; anything else
  goes through `parseMapEdits`) replaces the local edits as one undo step;
  the entries it skipped are listed under IMPORT: SKIPPED
  (`tests/mapImport.test.ts`).
- **Map editor, round 3: spots** (`game/mapSpots.ts`, `systems/storyEdits.ts`,
  `game/sceneHosts.ts`, `ui/mapEditorSpots.ts`; `tests/mapSpots.test.ts`;
  docs/W3D_MAP.md *Round 3*): PLACE adds payphones (`phone-<n>`), frenzy
  tokens (`fz-<n>`, with their own goal, target, seconds and gift:
  `frenzyList(edits)` / `ACTIVE_FRENZIES` is what every frenzy count
  reads) and pickups of any kind (`pickup-<n>`; the generated crates are
  `pickup-0..58`, `placePickups`). A phone's panel lists the jobs it rings
  for and MOVES A JOB HERE; a story spot's panel picks the phone its job
  RINGS FROM (the optional `jobs` section). Every story job's spots move
  (spot edits on the inventory's `story:<job>/<path>` ids, applied in
  `buildMissions`; drive routes and race steps drag crossing by
  crossing, snapping, collect steps point by point; parked cars turn).
  The docks yard, the spray bays, the station and the hospital drag to
  another block of their shape (the optional `landmarks` section; the
  blocks they fit are ringed while dragging) and take their props and
  keep-out with them. Shop doors and road works are zoomed-in anchors; a
  block or road lists what the run-time scenes could pick there (CAN
  HOST). The checks add a job on a missing phone, an added phone no job
  rings, a phone both arcs ring, a frenzy outside its goal's limits
  (`frenzyLimits.ts`), a parked car off the road or a pavement spot in
  it, a landmark that doesn't fit where it's moved.
- **Streets** (map edits round 3; `docs/W3D_MAP.md` *Round 3: streets*): a
  road entry `{ "a", "b", "pedestrian": true }` paves it over (no traffic:
  `RoadRules` shuts both lanes, so every router keeps off; bollards across
  both ends, planters, benches, bins and café tables down the middle from
  a stream of its own; people stroll down it, `crowd.ts strollCorner`; the
  ground draws the district's paving with a drainage channel; the end
  junctions lose that arm's signal poles, and their lights if fewer than
  three roads are left). `"removed": true` makes it land: the blocks either
  side merge (`world/blockMerge.ts planMerges`: whole rectangles only, never
  the outer ring; the rest play as closed and the checks say why), taking
  the north-west block's kind, district and look (`Block.merge`,
  `mergedAway`, `blockSpan`), filled from a stream of their own so the rest
  of the city is unchanged. The ground reads a per-block road map
  (`uRoadMap`, skipped by a uniform with no street edits); the lamps along
  a removed road go, posts and light (`uDarkLamps`, 8 merges). Editor: the
  road panel's STREET row (PEDESTRIAN, REMOVE; REMOVE refused with a reason
  on the ring or for an L, and putting a removed road back cuts its merge
  along that whole line: `removeRoad`, `restoreRoad`); a merged block is
  selected and edited as one (`tests/mapStreets.test.ts`).
- **Placement** (`world/streetProps.ts`, `world/landmarkProps.ts`,
  `world/dressing.ts`; pure, tested, from the city seed): street lamps
  with the arm over the road (the analytic night lighting follows the new
  head); traffic lights on 70% of the inner junctions; furniture per block
  side by district, in ten slots 3 m apart (hydrants, benches, bins,
  bollards, newspaper boxes, mailboxes, parking meters, planters, bike
  racks, recycling bins, now and then an abandoned shopping cart or a
  stray traffic barrel; about 3.8 a side downtown, 3.0 in the arts
  quarter, 2.7 in the old town, 2.1 in the suburbs, 1.6 in the
  industrial quarter, up from 2.6–1.1), payphones, dumpsters at alley mouths,
  bollards round plazas, park trees by district (round, tall, palms);
  rooftop kit fitted to the building plans (AC units, vents, water tanks,
  dishes, stair huts, antennas with a blinking tip; the huts' tar-grey and
  the tanks' weathered-board tops read from above); spray booths with
  their mouth to the street (the roof opens while you're inside), the
  export bay, the police sign and the safehouse door on their walls (both
  lamps glow at night), race-start gantries with barriers and cones, ramp
  and kicker models. Against the shopfronts (`world/frontages.ts`, from
  the building plans): café tables with umbrellas outside shops with no
  awning (an awning would hide them; most in the old town and the arts
  quarter), vending machines (four colours, the instance tint) and ATMs at
  the ends of shop windows. Nothing lands on a pickup, a payphone, a race
  start, the station or the safehouse door, in a bay's mouth, or on
  anything placed before it (a bucketed room check, `world/kerbs.ts`
  `Placer`); kerb things stay a metre off the line people walk down,
  wall things a person's width.
- **Road works** (`world/roadworks.ts`): 18 sites round the city, each
  closing the strip of road between the kerb and a traffic lane for 20–26
  m of a block: a ROAD WORK A-frame facing the traffic, a taper of four
  cones out from the kerb, traffic barrels every 3 m (their lamps blink in
  a run along the line) with plastic barriers between them, two cones
  closing the far end, and behind them a mix of a trench and its spoil,
  steel plates, a skip, a mini digger and a portable toilet. The barrels
  stand `WORKS_EDGE` (5.95 m) from the centreline and a lane's traffic
  keeps to 4 ± 1.33 m (a bus), so traffic drives past without changing
  lanes; a driver pulling over for a siren stays in its lane along a
  closed kerb (`SignalView.kerbWorks`, set from `TrafficSignals.setRoadworks`
  in `main.ts`). Sites stay 18–46 m into a block (clear of the junctions
  and of a right-turning bus's swing), off race legs, the spawn corner, the
  ramps' run-ups and every car a mission parks at the kerb, and off the
  outer ring. `tests/roadworks.test.ts` drives a car and a bus past every
  site, straight on, turning in from either side and pulling over for a
  siren: nothing knocked, nothing hit. `dressing.street.roadworks`:
  `{ ix, iz, dir, from, to, area }` (the lane, as `roads.ts` names it, how
  far along it the site runs, the closed strip as a world rect).
- **Food carts and bus stops** (`world/streetStops.ts`): hot dog carts,
  coffee carts and fruit stands on the kerb line serving the pavement
  (about a third of downtown's block sides; a few in the arts quarter and
  the old town) and just inside the parks and open plazas (not the car
  parks); 86 bus shelters on the building side of the pavement, open to
  the road, beside lanes with no works (most downtown and in the suburbs;
  one where Deacon Pike waits in Maple Flats). For people code (queues, a
  bus that stops), pure and the same every game:
  - `dressing.street.vendors: VendorSpot[]` — `{ kind ('food_cart_hotdog'
    | 'food_cart_coffee' | 'fruit_stand'), x, z, heading` (the serving
    side's facing, vehicle convention)`, serveX, serveZ` (where the first
    customer stands, facing the cart)`, queueX, queueZ` (unit step the
    queue grows along, down the pavement, away from the vendor)`, vendorX,
    vendorZ` (the vendor's spot, at the cart's end)`, setting ('kerb' |
    'park' | 'plaza') }`. The first three queue places are clear of
    anything solid; a kerb cart's queue stands on the walking line, so
    walkers will need to step round it.
  - `dressing.street.busStops: BusStop[]` — `{ x, z, heading` (the shelter,
    facing the road)`, waitX, waitZ` (in front of it under the roof's edge,
    clear of the walking line)`, stopX, stopZ, stopHeading` (where a bus
    pulls in, by the kerb beside it)`, dir, ix, iz }` (its lane, travelling
    `dir` toward junction (ix, iz)).
- **Stand-ins** (`render/propStandIns.ts`): props.glb has had models for all
  twenty round-2 kinds since 0.13.0 (10–120 tris each), so these now only
  draw for a kind the GLB lacks; each is a few boxes (five faces each, no bottom)
  tagged with the material names the GLB will use, so they light the same
  (`blink_amber` blinks, `ad_panel` / `screen` / `stripe_*` are self-lit,
  `roadwork_sign` / `barrier_orange` catch the light, `paint` takes the
  tint); a GLB root of the same name replaces its stand-in (a heavier real
  model costs only its own instances, not the family's). Contracts in
  `docs/BLENDER_TODO.md` §10.
- **Collision**: lamp posts, signal poles, bollards, dumpsters, planters,
  food carts and fruit stands, vending machines, ATMs, bus shelters (back
  and ends; open at the front, so people can stand inside), skips, mini
  diggers, portable toilets, payphones, booth and bay walls, gantry pillars
  and long barriers go into the `StaticGrid`. Hydrants, bins, newspaper
  boxes, mailboxes, benches, parking meters, recycling bins, bike racks,
  café tables, shopping carts and the road works' cones, barrels, barriers
  and signs, and race cones are *knockables* (`systems/knockables.ts`): a
  car through one at over 3 m/s sends it flying (`render/knockFx.ts`: a
  tumbling copy, dust and sparks, a 14 s geyser from a hydrant) and it's
  back 60 s later once out of sight. Long ones (benches, bike racks, café
  tables, work barriers, signs) meet people and cars as their box, so a
  barrier beside a lane is only hit by a car that leaves it. Roadblock
  barriers and cones go flying the same way. Steel plates and trenches are
  drawn only.
- **Traffic lights** (`world/signals.ts`, pure, tested): a 24 s two-phase
  cycle (9 s green, 2 s amber, a beat of all-red), offset per junction,
  stepped with the simulation. The lenses are lit in the shader from one
  uniform; the lit lens throws a glow and, at night, its colour on the
  lanes. AI traffic stops for red, and for amber it can stop for, and
  queues behind; panicking and urgent drivers (police, emergency calls)
  run them. Drivers see a long vehicle as a point per body circle
  (`traffic.ts: vehicleObstacles`), and a long driver keeps its gap from
  its own nose, so a bus or fire truck in a queue neither rams the car
  ahead nor gets driven into. **Turns give way** (calm drivers; panic and
  urgent ones don't): a left-turner waits at the line until nothing moving
  on the oncoming approach would arrive before it clears the crossing
  (longer for a long vehicle), and after a stop it gives the oncoming queue
  a 1.2 s beat to pull away; stopped oncoming cars (a queue, the opposite
  left-turner) don't count, so nobody waits on each other. A right-turner
  waits while anyone is already heading into its road. Once a turner pulls
  away from the line on green it is committed. Followers never go faster
  than they could stop from in the gap ahead, and waiting behind a car
  facing the same way trips the gridlock breaker 8× later (32 s, not 4: a
  queue moves on, a wreck or a car left in the lane doesn't). A busy-junction
  Monte Carlo (`tests/junctionTurns.test.ts`: 4 cars an approach, random
  turns, 40 runs with and without a long vehicle per queue) went from 49 and
  107 contacts to none, everyone through within three light cycles.
- **Pickups, tokens, debris**: pickups are the pickups.glb models (drawn
  ×1.7 so they read from the camera) with their rings and bob; frenzy
  tokens spin and bob in the frenzy's colour; an explosion throws a run of
  car parts (door, hood, bumper, wheel, panels) in the car's paint.
- **Vehicles** (`entities/vehicle.ts`): muscle car, limo, police SUV, SWAT
  truck, ambulance, fire truck, garbage truck, tow truck, ice cream van,
  bus, scooter and police bike, each with its own handling, health, engine
  sound, skid wheels and a collision body sized to the model (a row of
  circles: a 12 m bus is five, a bike is two narrow ones;
  `VEHICLE_BODIES`, `physics.ts: bodyOf / carCircles / bodyDistance`).
  Traffic mixes them in by `TRAFFIC_MIX` (buses, limos, the trucks and the
  vans are rare), taxis, ambulances, fire trucks and the rest in their
  livery. Half the ambulances and fire trucks are on a call: lights,
  siren, 17 m/s, and traffic pulls over for them as for the police (take
  one and its lights go off). The ice cream van plays its jingle every 9 s
  within 70 m.
- **Two-wheelers**: the scooter and the police bike get off the line and
  turn quicker than a car, lean into turns (`bikeLean`, from the sideways
  pull; upright in the air), and carry a rider (`CharacterModel.riding`
  plays `Ride`, seated on the model's `<arch>_seat`). An impact over
  8 m/s throws the rider over the bars (knocked flat, hurt if it's you;
  a hit-and-run if your car did it) and leaves the bike on its side,
  scraping to a stop; whoever gets on stands it up. A police bike's light
  flare and road wash are bike-sized. A scooter is parked at the spawn corner and a few ride
  in traffic.
- **Police helicopter** (`render/heliModel.ts`): heli.glb as one mesh, one
  draw call and no shadow pass (the shadow and the searchlight pool on the
  ground stay faked); the rotors spin in the vertex shader, the
  searchlight glows and the belly strobes flash. It flies at a share of
  the camera's height on the line from the camera to its ground position,
  so it's always over its own shadow on screen.
- **Budget** (whole frame, `?debug`): on the iPhone 15 Pro profile 41 on
  foot by day, 42 at night, 43–49 driving (44 / 47 / 50 / 47 before); on
  desktop 55 / 58 on foot, 51–55 driving (57 / 60 / 63 / 60 before) —
  the families replaced more stand-in meshes than they add. Busy scenes:
  a signalled junction at night 43 (phone) / 60 (desktop), six heavy
  vehicles in view 53 / 69, a 5-star chase with the helicopter 59–64 on
  desktop. Programs: 30 on desktop, none compiled after start-up (the
  helicopter included: it is drawn speck-small for two frames on load). No
  light is ever added; nothing allocates per frame (knock-overs and debris
  write into preallocated buffers).
  Street props round 2 (iPhone profile, same spots before → after, on foot,
  2026-11-01): spawn 49 → 49, a road-works site 43 → 43, a downtown street
  with carts 33 → 33, a plaza 36 → 36; wider views (camera at 32–45 m)
  31–51 → 32–52 (a call or three either way with the people in view). No
  new draw call or program; the cost is vertices: the street family went
  from 3,276 to 5,976 vertices per instance (every instance runs every
  model's, the others dropped early), and 17–88 street instances are in
  view (capacity 1,100), so the scene's submitted triangles rose about 1.6×
  (e.g. 253k → 438k on the plaza).
  Vertex pulling (iPhone profile, 852×393, medium tier, on foot, seed 7,
  2026-11-01; whole-frame triangles submitted by day, and the prop
  families' vertex-shader runs, lit and shadow pass): spawn 190k → 47k
  triangles (props 475k → 45k vertices), a road-works site 294k → 32k
  (854k → 68k), a downtown street 125k → 48k (267k → 35k), a plaza 304k →
  49k (834k → 67k); night the same. Draw calls unchanged (props 6–10 of
  24–46); programs 22 → 23 (the rubble variant), none compiled after
  start-up. Screenshots at the same spots, day and night, match to a few
  stray shadow-edge pixels; rubble and car parts drawn from their lamp
  lists and forced onto the lattice in the same frame match exactly.

`dressCity(city, pickups, ramps)` → `{ street, landmarks, solids,
knockables }` is the one call `main.ts` makes before building the
collision grid; `look.props` (`WorldProps`) is the renderer side:
`setLandmarks`, `knock(id)` / `restore(id)`, `begin(view, …)` / `end()`,
and the `things` / `debris` families other presenters add to per frame
(`addMatrix`, `add`). `TrafficSignals` (`main.ts: signals`) is passed to
`driveAi` and to the renderer.
