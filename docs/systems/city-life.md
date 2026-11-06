# City life

The scenes themselves are in [city-scenes.md](city-scenes.md) (people, Borrowed Blues, VAN NICKED), [city-incidents.md](city-incidents.md) (traffic scenes, Your mess, incidents) and [police-scanner.md](police-scanner.md).

The city getting on with its day around the player, none of it the
player's heat or score unless they join in (a mugger's bag, the
incidents' cash, awards and calls to the police): the knocked out stay down until an ambulance takes
them to the hospital, cars stand parked at the kerbs and in the car parks,
and an armed person knocked out drops their gun for you to pick up. One
director, `CityLife` (`src/game/cityLife.ts`), runs it and the ambient
*scenes* built on it (`src/game/scenes/`); the rules are pure and tested
(`systems/cityScenes.ts`, `world/streetSpots.ts`, `world/drops.ts`).

**The city doesn't stop for you** (V2-02; `systems/cityScenes.ts`,
`systems/routeAhead.ts`, tested). The busy scenes (chases, races,
accidents, scuffles, muggings, turf wars, tows; `BUSY`) are held off only
behind the title, during the cold open, and in an activity that
asks for a quiet city: a timed race, or a mission flagged `quiet` (or on a
checkpoint `race` step; `activityHolds`, `MissionMode.quiet`). Free roam,
Chaos Run, taxi fares and frenzies all get the living city. Wanted stars
no longer hold them: each busy kind's clock runs at `WANTED_PACE` of its
pace (1 with no stars, then 0.75, 0.6, 0.5, 0.4, 0.35 at 1–5 stars:
fewer, never none; `SceneClock.tick`), and while wanted at most
`WANTED_SCENE_CAP` of them run at once (high 4, medium 3, low 2: scene
cars on top of the police on a phone). Chases run on past a player wanted
for something else; only the player's own part in one (the chase handoff,
`systems/chaseHandoff.ts`) changes it. Fires keep their full pace (your
fires get their trucks); buskers still pack up for stars. **On the road
ahead:** while wanted, a scene that arrives by car (a race; a chase, now that
V2-03 lets one start while wanted: spec `ahead`) is put, at most once every 45 s, on a lane 60–150 m ahead
of the player's way (within 45°), off-screen, coming toward them
(`routeAheadSpot`, armed by `life.due()` for that step's `spawnCar()`),
and accidents and turf wars pick only traffic and borders within 60° of
the player's way (`life.onRoute`), so a pursuit runs into them. A
featured scene (the title's show) ignores all of it. Measured with the
in-view harness and a 5-star soak ([HISTORY.md](../HISTORY.md), *V2 in-view numbers*).

- **Knocked out stays down** (`scenes/medics.ts`): a passer-by (crowd
  upkeep's people and drivers thrown out of their cars: `PedAgent.street`)
  knocked out cold within 120 m is held down (`injured`: the down timer
  never runs out, so the get-up clip never starts) instead of getting up
  after 8 s. 3 s later an ambulance is called: one in traffic within 140 m
  takes it, else one comes from off-screen with lights and siren (traffic
  pulls over, StreetLife wails). It pulls up, a paramedic (white shirt)
  steps out of the door nearest them, kneels 2.2 s, and brings them back
  on a stretcher (the body slides a pace behind); anyone else lying within
  35 m goes on the same trip, then it drives off to the **hospital**
  (`placeHospital`: a built-up block near (10, 7), a red cross on the
  pavement, `+` on the radar), lights still on. At most 6 held down (more
  get up as before), 2 ambulances out; nobody comes in 100 s and they come
  round. Officers, gang members and story characters are other systems'
  and get up as before.
- **Parking** (`CityLife.maintain`, `Population.parkCar`): 10 cars
  (`PARKED_COUNT` × the tier's traffic scale) parked round the player,
  filled out of view 35–150 m off: at the kerb mid-block (`PARK_OFFSET`
  6.9 m from the centreline: 1 m clear of the lane, so traffic and
  pull-overs pass; 14–50 m before a junction, a car length apart), or,
  45% of picks with a car park in range, nose-in in a car park's painted
  bays (`carParkBays`: half the plazas, the same blocks and bays
  `world/ground.ts` paints, via the shared `lotRolls`). Clear of landmarks,
  spray bays, ramps, the bus shelters' bays, the hospital and the spawn corner. A
  `parked` car counts apart from abandoned cars and wrecks (its own cap,
  on top of the idle cap) and is recycled like any other once far off;
  getting in clears the flag. Common models only (no extra draw calls).
- **Dropped guns** (`world/drops.ts`, `CityLife.scanDrops`): anyone armed
  (an armed passer-by, a gang member with a gun, an officer, SWAT) knocked
  out drops what they carry (`CrowdPed.gun`, else a pistol) a step from
  where they fell: the pickups.glb crate model, small, in a pulsing amber
  ring. Walk over it to take it (`combat.collect`, the usual `pickup`
  event and feed line; left lying if you're full). 8 at most (the oldest
  goes), 45 s each. A civilian who dropped theirs fights with fists after.
  *Before this, nobody dropped anything: a knockout only knocked them
  over (`systems/crowd.ts` hurtPed / `game/combat.ts` resolve), and guns
  came from the sidewalk crates (`world/pickups.ts`), a frenzy's gift, a
  mission's hand-out or the Chaos Run's loadout.*
- **Crowds by the hour and the weather** (`game/cityMood.ts`, pure):
  `densityFor(district, hour, rain)` multiplies the crowd target: by day
  downtown and the old town are busiest and the docks quietest; from 18:00
  the crowd drains out of the docks, the suburbs and downtown into the
  Neon Mile (×1.3 at night) and the old town's bars, the quiet districts
  down to ×0.22–0.3; full rain takes 45% off every street. Crowd upkeep
  takes the density where the player is (`crowdScale`) and keeps spawns in
  proportion to each district's (`MaintainContext.spawnWeight`), so new
  people gather where the life is. *Before: the same 22 (× tier) people
  everywhere, day or night, rain or shine.*
- **Rain and night on the pavements** (`scenes/streetMood.ts`): in the rain
  (`render/fxWeather.ts` WeatherCycle: a shower every few minutes) walkers
  hurry (`rainPace`, up to ×1.5), 40% put up an umbrella (a canopy over
  their head, six colours), and up to 10 of the rest duck in under an
  awning on their own pavement (`world/shopSpots.ts`: from the same
  building plans the awnings are drawn from) and wait there, looking out
  at the road, until it stops. At night groups of 2–3 hang about under the
  neon (up to 4 groups at full nightlife, put down out of view 24–70 m
  off, most in the Neon Mile), and drift off as ordinary passers-by at
  dawn or after a minute or so.
- **Stray dogs** (`systems/dogs.ts` pure, `scenes/strayDogs.ts`): up to 4
  round the player (fewer downtown and in the Neon Mile than in the
  suburbs and the docks), put down out of view, trotting round the
  pavements and stopping to sniff. Anyone running past within 8 m (a
  passer-by or the player) is chased for up to 3.5 s or 22 m, barking
  (`street` 'bark'); gunfire within 32 m sends them bolting; a car through
  them, a blast or a punch knocks them over ('yelp') and they get up and
  run. They keep out of walls.
- **Pigeons land again** (`systems/pigeons.ts`): most spooked flocks (60%)
  wheel round and glide down 14–26 m on, away from the scare, and peck
  about there until spooked again; the rest fly off as before.
- **Gang turf flare-ups** (`systems/turfWar.ts` pure, `scenes/turfWar.ts`):
  every 2–4 minutes (`BUSY`), where the VIPERS' turf meets a rival crew's
  across a road (`RIVALS`, colours only: COBBLE KINGS in the old town,
  DOCK RATS at the docks, GLASS BOYS downtown), 2–4 of each walk in from
  either end of the pavement, square up and fight with fists (in 30%, one
  on each side has a pistol), 35–110 m from the player. The badly hurt may
  run for it; it's over when one side is all knocked out or gone, and the
  winners walk off. **Stepping in:** hit someone on one side (a punch, a
  shot, a knock-down) and that side turns on you while the other stands
  with you for the rest of the skirmish (they keep fighting the side you
  hit; hit both and both are on you); knocking a VIPER down costs respect
  as ever (`gangMode` hears the same `pedDown`). The knocked out are handed
  to the street (`street`), so the ambulances come for them.

**The director.** `main.ts` creates one and calls `step(dt)` every sim step
(after combat), `maintain(seed)` with population upkeep, `reset()` with a
fresh run; a car with a `scene` is driven by `v.scene.drive(v, obstacles,
dt)` before traffic (null hands it to traffic for that step), and every
crowd step asks `cityLife.targetFor(c)` for a ped's target (another ped,
else the player as before), routing their punches and shots through
`cityLife.punch(c)` / `shoot(c, dx, dz)`. Scenes register with
`life.add(scene)` (a `Scene`: `step(dt)`, `running`, `reset()`).

```ts
// Scheduling (systems/cityScenes.ts, pure): each scene defines its kind once
life.clock.define('ice', { every: [70, 140], cap: 1, first: 30, range: 110, hold: IN_PLAY });
life.due('ice', running)          // its clock has run down, under its cap, nothing holding it off
life.near('ice', x, z)            // within its range of the player (default SCENE_START_RANGE 150 m)
life.clock.start('ice', life.now) // wind the clock (or .defer(kind, now, s): nowhere to put one yet)
// Holds: 'title' (attract), 'activity' (a timed race, a `quiet` mission: activityHolds), 'wanted', 'opening' (the cold open).
// BUSY = title, activity, opening (+ pace: WANTED_PACE: slower while wanted, never held); LOUD = all four
// (no city scene now); IN_PLAY = ['title']. spec.ahead: arrives by car, may go on the road ahead while wanted.
// life.onRoute(x, z): for scenes picking among existing spots: only on a wanted player's way. life.busyRunning().
// life.featured = kind: the title's highlight (game/attractHighlights.ts) or a story job's scene (sceneStarter.ts
//   storyScenes) lifts every hold and the wanted pace for that kind alone;
// life.lively(kind): d.playing() or featured (use it, not d.playing(), for people gathering to a scene).
// subject?(out): Scene's optional hook for the highlights: where to look (x, z, vx, vz; cityLife watch()), false when over.

// A service vehicle's call-out (scenes/service.ts): ambulance, fire truck, tow truck, police
const run = ServiceRun.call(life, { archetype: 'firetruck', paint: '#c3191c', claimRange: 140, emergency: true,
  cruise: 16, top: 24, arrive: 26, timeout: 80, dwell?: 6, stopAtCar?: false, aheadShare?: 0.5 }, x, z);
run.goTo(x, z, heading?) · run.redirect(x, z) · run.leave(x?, z?) · run.rush()   // lights on while leaving
run.step(dt): 'drive' | 'onSite' | 'leave' | 'done' | 'failed'   // run.site: seconds on site; run.v: the vehicle
run.end()                                                          // stop now (reset)
// Claims one of that model in traffic within claimRange of the point, else brings one in off-screen
// (lane 75–140 m from the player, its `paint` livery: any model, tinted). Drives there with the police's
// pursuit logic (Errand: lanes far off, straight in within 38 m, ~7 m short of a person or at a car's end),
// holds still on site, drives off lights out (to a point, or as traffic), then hands back to traffic.

// People gathering (scenes/gathering.ts): queues and crowds
const g = new Gathering(life, { kind: 'queue', capacity: 5, draw: 30, joinChance: 0.6, serveEvery: 3.2, side: 2.2 });
const c = new Gathering(life, { kind: 'crowd', capacity: 8, draw: 25, joinChance: 0.5, stay: [10, 25], radius: 3, arc?: Math.PI });
g.at(x, z, heading) · g.recruit() /* ~1×/s */ · g.add(ped) · g.step(dt) /* → the one served / done, handed back */ · g.close()
g.release(ped)                        // out without handing back (to the bus door, into a scuffle)
spec.place?(i, out)                   // own places instead of the queue / ring (a shelter's line, a cart's queue)

// People and cars for scenes (cityLife.ts)
life.addPed(x, z, heading, outfit?, body?) · life.borrow(c) · life.giveBack(c) · life.removePed(c)
life.walkTo(c, x, z) · life.lookAt(c, x, z) · life.setOn(a, b, gun?, seconds?) · life.unfight(c) · life.opponentOf(c)
life.spawnCar(archetype, paint, aheadShare?) · life.placeCar(archetype, paint, x, z, heading) · life.release(v) · life.retire(v)
life.lost(v) · life.present(c) · life.distance(x, z) · life.inView(x, z, margin?) · life.crowded(x, z, gap)
life.rearOf(sim, out) · life.doorOf(sim) · life.emit(what, x, z) · life.hospital · life.stops · life.bays · life.drops
holdStill(sim) · stopped(sim) · pullIn(sim, x, z, heading, cruise, obstacles, left)   // scenes/service.ts
// Places (world/streetSpots.ts): roadPoint, pickParkingSpot, carParkBays, pickBay, queueSpot, crowdSpot, BUS_PULL_IN.
// Bus stops are the shelters only: life.stops = deps.busStops (dressing.street.busStops, world/streetStops.ts
// BusStop: wait spot, where a bus pulls in, its lane); deps.vendors the food carts (VendorSpot).
// Deps for the people: hour?() (the carts' rushes), reward?(cash, label) (a bag handed back), callIn?(crime) (heat.called).
// Flags: PedAgent.street (borrowable passer-by) / .scene (a scene's: upkeep leaves them) / .injured;
//        CrowdPed.phone (a witness on the phone: posed holding it up); Vehicle.ambient (brought in: the director
//        retires it) / .scene (its driver) / .parked.
// Bus: { type: 'street', what, x, z } (StreetWhat in core/events.ts; members for the planned scenes are reserved;
//      the atmosphere adds 'bark', 'yelp', 'turfWar'; the people 'busker', 'mugging', 'bagReturned', 'witnessCall').
// The mood (game/cityMood.ts): life.d.mood?.hour · .rain (0..1) · .raining · .nightlife (0..1: nightlifeFactor(hour),
//   0 by day, easing in 18:00–22:00, full till 03:00, gone by 06:00: the street races' cue) · .nightlifeAt(x, z)
//   (× NIGHTLIFE[district]: arts 1, oldtown 0.6, downtown 0.3) · .densityAt(x, z); pure: densityFor, nightlifeAt, rainPace.
// Atmosphere scenes: life.streetMood (shelterers, groups, umbrellas) · life.dogs.pack (dogs; startle, knock) · life.turfWar
//   (flare, borders; soon() starts one at the next step, holds permitting).
// Heat: HeatDeps.witnesses?(crime, x, z) → true to hold a lesser crime for a witness's call; heat.called(crime) lands it.
// Debug: each people scene has a `kind` and force(): __ub.cityLife.scenes.find((s) => s.kind === 'buses').force().
// Look (render/cityLifeLook.ts): cityLook.add({ update?(dt, view, fx), draw?(glows, view, props) }); the people's
//      coins, mugger ring, bag and phone screens are render/peopleLook.ts.
```

**How much of it is seen** (`systems/inViewMeter.ts`, pure, tested). The
director samples every scene with a `subject()` 4 times a second in play
(`CityLife.inViewMeter`): per kind, seconds with its subject on screen, how
many started, how many were seen at all and how many ended unseen, and the
quiet stretches with no incident (chase, race, accident, fight, mugging,
turf, fire, tow) in view (longest, and how many ran 90 s or more). Typed
arrays, so sampling allocates nothing. `__ub.inView()` returns a copy; the
session log gets an `inview` line every 2 minutes of play ("played 600 s ·
any 40 s · quiet max 95 s (1) · race 12/2/1/1 …": seconds/started/seen/
unseen). `tools/tune/inview.mjs` drives the phone view through free roam
and a pursuit with it ([*Tuning harnesses*](testing.md)); the numbers are in
[HISTORY.md](../HISTORY.md) (*V2 in-view numbers*).

**Adding a scene.** Write `src/game/scenes/<name>.ts` with a class that
implements `Scene`: in its constructor `life.clock.define(kind, spec)`
(pick its holds: `BUSY` with `pace: WANTED_PACE` for anything loud, so it
thins out rather than stops while the player is wanted; `ahead: true` if it
arrives by `spawnCar`);
in `step`, when `life.due(kind, running)` and you have a spot
(`life.near(kind, x, z)`, out of view if things appear there), start one
and `life.clock.start(kind, life.now)` (or `defer` and try later); drive
vehicles with `ServiceRun` (or your own `SceneDriver` on `v.scene`), people
with `Gathering`, `walkTo` / `setOn`; emit `street` events; hand everything
back in `reset()`. Register it with one line in `CityLife`'s constructor
(`this.add(new YourScene(this))`) and, if it draws, one `cityLook.add(...)`
in `main.ts`. For the playtest labels add a `describe(out)` (below). Only borrow `street` people, only take vehicles that are
`ai`-driven, unpinned (`life.d.keep`), not `police`, not the player's. No
per-step allocation (reuse records; no closures in `drive`).

**Playtest labels** (`settings.debugLabels`, default off; **Shift+L** on a
keyboard, `__ub.labels.toggle()`): small text over the people and cars
within 60 m in view that are doing something notable, nearest first, at
most 24. Each scene's optional `describe(out)` labels what it holds
(`MEDIC (treating)`, `PATIENT (waits 54s)`, `FIRE 54s (called)`,
`FIREFIGHTER (hosing)`, `TOW → car`, `ALARM 12s`, `CHASE: SUSPECT (car)`,
`CHASE COP`, `RACER 2/4`, `DRIVER (arguing)`, `DELIVERY 31s`, `COURIER
(parcel)`, `BUS → stop`, `BUS STOP 2`, `QUEUE 3`, `ICE CREAM (open 36s)`,
`VENDOR`, `BUSKER 80s`, `WATCHING`, `FIGHTER`, `ONLOOKER`, `MUGGER
(running)`, `VICTIM`, `BAG 31s`, `WITNESS (calling 2.1s)`, `DOG (chasing)`,
`SHELTERING`, `HANGING OUT`, `CASH VAN (stop 1/3)`, `GUARD (cash box)`,
`CASH $45`, `KEBAB (peak 40s)`, `DRUNK (arguing)`, `TAXI QUEUE 2`,
`HEARSE (procession)`, `MOURNER (after you 9s)`, `BURST HYDRANT 30s`,
`GAWPING`, `PLAYING IN IT`, `HEN DO (conga)`, `FILM SET ACTION · take 2 ·
80s`, `EXTRA (fake cop)`, `STAR CAR`), the missions theirs (`MISSION: tag`, `VEX`,
`MISSION CAR: tag`, `FARE`), then `describeWorld` the rest by their flags
(the player's police `COP (pursuit)` / `POLICE (roadblock)`, gangs and turf
crews in their colours `VIPERS (fighting)`, `INJURED`, `ON PHONE`, `KO`,
`FLEEING`, `PARKED`, `CRASHED (towable)`, `WRECK`, `EMPTY`, `DROP: pistol
31s`). Colours by category: emergency red, police blue, gangs their own,
people amber, traffic grey, missions pink. Text logic is pure and tested
(`game/debugLabels.ts`: `LabelBoard`, `pedLabel`, `carLabel`, `raceRank`);
the layer (`ui/labelsOverlay.ts`) is a fixed pool of DOM pills over the
canvas (`pointer-events: none`, no draw calls): collected and their text
written at 5 Hz only where it changed, projected every frame and moved by
`translate3d` from cached strings (no allocation, no layout reads), stepped
up clear of nearer ones. Off, the layer is hidden and nothing runs. Cost
(Chromium, iPhone profile, 24 labels, camera moving every frame): ~0.02 ms
of JS a frame (median), a refresh ~0.05 ms. `__ub.labels.list()` /
`.stats()` show what's up and the time taken.

```ts
describe(out: LabelSink): void {   // a Scene's, ~5 Hz while the labels are on
  for (const c of this.crews) out.car(c.run.v, 'FIRE TRUCK', 'emergency');
  if (out.wants(f.x, f.z)) out.spot(f, `FIRE ${secs(f.life - f.age)}`, 'emergency');   // build changing text only if wanted
}
```

**Budget.** No new mesh, program or draw call: the vehicles and people are
the usual batches, the drops go in the props' `things` family, light in
the shared glow batch. The umbrellas and dogs too go in `things`, as
stand-in models built in code (`render/critterModels.ts`: `dog`,
`dog_stride`, `umbrella`, replaced by props.glb roots of those names;
contract in `docs/BLENDER_TODO.md` §8): that family's call and its shadow
pass (+2) when nothing else of it is in view, else nothing; the turf crews
wear the crowd's own bodies. Measured on the iPhone profile, the fixed
seed's seven places after 20 s each (afternoon / 23:00 / 23:00 in rain),
two runs each: 41.0–42.4 / 44.0–44.7 / 44.3–45.6 calls on average (53 /
47–51 / 46–50 at most) before the atmosphere work, 40.3–42.9 / 42.6–44.3
/ 42.4–45.4 (54–55 / 45–50 / 46–51) with it (rain and the quiet
districts thin the crowd); taking the umbrellas and dogs out of a frozen
frame where they were the only `things` in view: −2. Live cars rise by the parked target (10 on
'high'/'medium', 8 on 'low') plus whatever scenes bring in; people by
those a scene holds. iPhone profile ('medium'), a fixed seed at seven
places round the city after 20 s each: 40.3 draw calls on average (54 at
most) before, 41.3 (50) with the base (a parked model not otherwise in
view costs its call and shadow pass). Smoke test (random seeds) 56 / 57 →
61 / 51 on the iPhone sizes, 74 → 70 on desktop: within run-to-run spread. The people (same
seven places, a run started, tutorial done): 41.9 (57) → 42.1 (56), with
2–13 people held; every people scene forced at once round one spot 36 →
43, most of it the bus and ice cream van models in view (forced one at a
time, each is within the frame-to-frame spread). Scene-made people take
the body of a passer-by already out (`streetBody`), so no new body batch
comes in.
The emergency scenes keep to that: flames, smoke, water and steam in
Effects' pools, the fire pools, beacon and indicators in the glow batch.
Same measure (its own seed and places): 40.7 (56) before, 40.1 (54)
with them. Worst case, a fire with its truck and crew, a tow truck with
a car on the hook and an alarm all in view: +6 (the fire truck's and tow
truck's batches, a call and a shadow pass each, and the firefighters'
`ped_stocky` body when no passer-by of that build is in view). Smoke
test 53 / 59 on the iPhone sizes, 69 on desktop.
Traffic scenes: no new mesh or program. A model not otherwise on screen
costs its call and shadow pass, so they keep to few: patrol cars only
(`police`, no SUV or police bike), the racers all `sports`, getaways
common models or the scooter, the bins in the `street` family (always
drawn); one incident at a time. Measured as the drop when a forced
scene's cars and people are hidden in the same frame, iPhone profile, at
the seven places: a bike chase plus a garbage truck at most +7, a race
chased by the police plus a truck +9, an accident plus a truck +4 (±3
frame noise). The same places unforced: 39.4–44.9 calls on average before,
44.3–57.0 after (most of it which traffic models are in view); smoke test
56 / 56 on the iPhone sizes, 68 on desktop.
Incidents: no new mesh, program or batch (the van, taxi, limo, sedans and
sports car are traffic models; everyone wears a passer-by's body already
drawn in view, `streetBody(life, true)`; water, cash, cones and lights in
Effects' pools, the glow batch and the `street` / `things` families).
iPhone profile, the seven places after 20 s, nothing forced: 39.5 (47)
calls before and after at 13:00, 42.1 (53) → 42.8 (53) at 02:00 with the
kebab shop open at two of them (the rest is the traffic the shifted
random stream brings). Each forced and watched, the drop when its people
and cars are hidden in the same frame: kebab 0, cash van 0, conga 0,
hydrant +2 (the passers-by who stopped to gawp), funeral +2 (the limo),
film shoot +2.
