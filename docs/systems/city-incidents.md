# City life: traffic scenes and incidents

Scenes run by the `CityLife` director; the director, budgets and how to add a scene are in [city-life.md](city-life.md).

**Traffic scenes** (`claude/city-traffic`; rules pure and tested in
`systems/trafficScenes.ts`). Chases, races and accidents are `BUSY` (held
off by the title, a timed race or quiet mission and the cold open; races
and accidents fewer while you're wanted, and then on your way; chases
too, run past you by the handoff) and only one
of the three runs at a time (`incident(life)` in `scenes/chases.ts`).

- **Police chases** (`scenes/chases.ts`, every 100–200 s): a getaway car
  (sports, sedan or compact) or a scooter flat out in a panic through the
  lights with one or two patrol cars behind it, lights and siren on
  (traffic pulls over), ramming, PITting and boxing it in with the
  police's pursuit logic; or someone on foot running down the street
  (`fleeAxis`) from one or two officers, with a car following 40% of the
  time. Boxed in, the suspect gives up by the car (55% of the unarmed) or
  bolts. A runner out of breath (8–14 s) gives up; one caught running is
  tackled. Then they're cuffed (kneeling, hands on head: the player's
  `Arrested` clip), walked to a police car's back door (one is called for
  an arrest on foot) and driven off: **arrested**. A crash that leaves the
  car under 30% health, or an armed suspect (30%) shooting it out, leaves
  them knocked out on the street for the ambulance: **taken down**. Lost
  far off or over 110 s: **escaped**. Then the officers walk back to their
  cars and drive off.
  **Not the player's heat:** the chase's officers always have the suspect
  (or nobody) as their target, are no unit of `PoliceForce` (so they
  never see, bust or report the player), and are never left in a fighting
  mode without an opponent (that would turn them on the player). A chase
  runs on while the player is wanted for something else.
  **Joining in** (`systems/chaseHandoff.ts`, pure and tested; asked first
  thing every chase step: `continue | takeHeat | turnedOn | breakOff`):
  - **TAKE THE HEAT:** get in the getaway and the chase is yours. The
    radio has it at once (`tookGetaway` via `CityLifeDeps.callIn`: at
    least 2★), then the chase cars within 80 m become police units chasing
    you (`CityLifeDeps.adopt` → `heat.adopt` → `PoliceForce.adopt`, as
    many as the level's unit cap allows, off the director's list); any
    others go back to traffic with their lights off, so no car is left
    with a siren and nobody driving it. A siren whoop plays.
  - **Turned on:** attack its police (ram a car, shoot one, floor an
    officer, steal a car: bus `bulletHit`/`explosion`/`pedDown` near its
    cars and officers, `HeatDeps.rammedSceneCop`) and once you're wanted
    for it they come after you the same way (officers on foot to
    `heat.police.strays`), or from over 80 m off the chase just breaks
    off. A single bump that costs no star is shrugged off.
  - **CITIZEN'S ARREST:** ram or box the getaway so it stops within 12 m
    of a patrol car, within 5 s of your last touch on it
    (`damage.lastPlayerHit`): the suspect gives up even if armed, **$150**
    through `deps.reward` and the score award; ramming the getaway is no
    crime (its panicking driver doesn't count it), and one bump on each
    chase car within 3 s of touching the getaway is forgiven (touch
    steering is imprecise).
  - **HAVE-A-GO HERO:** a suspect on the run (or a mugger) carries
    `PedAgent.suspect` (cleared once they give up or are cuffed): flooring
    them isn't an assault, and the first time a chase pays the award (so
    does throwing the rider off a getaway scooter). Tased (*Driving and
    combat*, the taser), a suspect on foot gives up where they fell, armed
    or not, kneels once up and waits for the officers; their cuffs within
    30 s are a CITIZEN'S ARREST as well (`Chase.tasedAt`,
    `chaseHandoff.tasedArrest`).
  Score kinds `takeTheHeat`, `citizensArrest`, `haveAGo` go through
  `CityLifeDeps.award`, each with a street event of the same name.
- **Street races** (`scenes/streetRaces.ts`, every 90–170 s, then
  `raceOdds(hour)`: all at 22–4 h, 60% in the evening and before dawn, 25%
  by day, else put off 20–45 s; `CityLifeDeps.hour` is `look.time.hour`,
  times `nightlife()`: 0.75 + 0.75 × the mood's `nightlifeAt` the player,
  so 0.75× by day or in a quiet district, 1.5× in the Neon Mile at night): 3–5 sports cars in racing colours line up off-screen and race a
  4–6 junction route (`raceRoute`, mostly straight) at ~29 m/s as urgent
  traffic (through the lights, overtaking in the oncoming lane), lighting
  nitro on straights (a real boost, and exhaust flares in
  `render/trafficLook.ts`). The first past the last junction wins (a long
  horn, `raceWon`); they slow into traffic. 30% of races draw the police:
  the back marker is handed to the chase scene (`chases.pursue(v)`).
  **RACE CRASHER** (V2-12; rules pure and tested in
  `systems/raceCrasher.ts`, `tests/crashers.test.ts`): pull onto a race's
  line and you're in it: on the road into one of its junctions, its way
  round (within 35°), at 10 m/s or more, a racer still in it within 30 m,
  with at least two junctions to come and nobody home (`routeLeg`,
  `joinsRace`; `street` `raceJoin`: a racer leans on the horn, and the
  scanner's GATECRASHER line). No rubber-banding: the racers drive as they
  always do, never slowing for you or catching up. Pass each junction in
  turn from the one you joined toward (within 12 m of its middle,
  `passes`); its next one is marked on the road (a magenta chevron the way
  out and a ring, gold at the finish: `RaceLook`) and pulses on the radar
  (`game/crasherBlips.ts`, pinned to the rim off it). Through the last one
  first and you've won: the `raceCrasher` award (750) and stamp, `street`
  `raceCrasher`. **The prize** is the leader's ride: the racer furthest
  ahead of the rest when you cross (further down the route, then nearer
  its next junction: `ahead`) races on to the line, pulls up past it
  (10–20 m in the harness), and its driver gets out and walks off, the car
  left with nobody in it, so you get in with no carjack. Ringed in gold
  and a `★` on the radar; kept from every scene (`CityLife.keeps`) and
  from Population's recycling for 90 s (`PRIZE_KEEP`) or until you take
  it. Held up 2.5 s short of the line, or not over it 20 s after the win,
  it pulls up where it is. Beaten to the line (or out of your car, or the
  race over), you're out of it with nothing. One race at a time, as ever.
  (A Chaos Run tallies RACE CRASHER under STUNTS, VAN NICKED under
  CARJACK: `categoryOf`.)
- **Accidents** (`scenes/accidents.ts`, every 80–160 s): a car finds the
  one 3–30 m ahead in its lane mid-block; that one brakes hard, this one
  doesn't. Both are left smoking (health 32–52%, below `SMOKE_AT`, above
  `FIRE_AT`) with hazards blinking; the drivers get out and argue beside
  the cars (a step in, a step back); 35% come to blows (`setOn`, `fight`
  event). A patrol car comes (`ServiceRun`, lights on), the officer walks
  over and breaks it up, has a word, and everyone leaves; a driver knocked
  out goes to the ambulance. The cars stay in the lane, abandoned and
  **flagged for a tow**: `Vehicle.towable` (set on crashed cars and dumped
  getaways, cleared when recycled; `accidents.towables(out)` lists the ones
  still standing, `ai` null, not the player's). Your own crashes become
  accidents too: *Your mess, their problem*, below.
- **Double-parked trucks** (`scenes/doubleParking.ts`, every 45–100 s,
  held by the title and activities): a delivery van (parcel brown or
  white) or a garbage truck in traffic pulls in 26–44 m before the next
  junction, a little toward the parked cars, hazards on, for 20–40 s: the
  courier carries parcels (`package`) from the back doors to the shopfront,
  the two-man crew (hi-vis) wheel the bins put out at the kerb
  (`trash_bin`) to the truck and back. Not on a lane with road works
  (`kerbWorks`), within 18 m of a bus stop, or near a landmark or spray
  bay (`CityLifeDeps.avoid`). With no truck about one is brought into
  traffic off-screen and stops once it finds a spot.
- **The queue behind** (`scenes/laneBlock.ts`, for the trucks and the
  crashed cars): traffic queues as it does behind anything; anyone stopped
  2.5 s honks (`horn` events, every 3–7 s); the front of the queue decides
  once whether to go round (60%) and does when the oncoming lane is empty
  for 60 m (`canPassAround`), traffic's own overtaking held on until it's
  3 m past the front (`tests/trafficScenes.test.ts` drives a sedan round a
  garbage truck: no contact).

```ts
life.chases.begin(kind?) · .pursue(v) · .chases · .ended   // 'car' | 'bike' | 'foot'; counts by outcome
life.chases.joined · .rammed(v) · .isGetaway(v)               // how the player joined in; heat's ram hook; a getaway still chased
life.races.begin() · life.accidents.begin() · .towables(out) · life.doubleParking.begin(force?, job?)
life.races.crashing · .prize { v, finishing, handed } · .prized(v) · .crashed { joined, won, lost }   // RACE CRASHER; race.crasher { next, out, won }
// Street events: chase, suspectRuns, arrest, suspectDown, takeTheHeat, citizensArrest, haveAGo, race, raceWon, raceJoin, raceCrasher, accident, fight, doublePark.
```

**Your mess, their problem** (V2-10; rules pure and tested in
`systems/mess.ts`, `tests/mess.test.ts`; `scenes/accidents.ts`,
`scenes/shotsFired.ts`, `scenes/patrol.ts`). The city takes over what the
player starts and carries it on without them.

- **Your crash, adopted:** hit an ordinary calm driver at 9 m/s or more
  (`ADOPT_IMPACT`; heat's `adoptCrash` hook, asked before that driver's
  panic / rage / bail roll) and their car stops where it is, hazards on.
  1.2 s later the driver gets out and has it out with you: over to your
  window (or face to face on foot), jabbing a finger, while you're within
  30 m of the crash; gone, they glare after you from their door. A patrol
  comes (lights on), the officer walks over and takes a statement, gets
  back in and leaves; then a tow truck comes for their car (through
  SceneStarter, below: the city's own tows leave it till then,
  `accidents.waiting(v)`, and it may be the second tow out). A patrol not
  there in 25 s is stood down and the tow asked for anyway. Traffic
  queues and goes round (LaneBlock); `street` `accident` gives the
  scanner its RTC line and ping. **Adopt rules** (`adoptVerdict`): one at
  a time; spaced by the `mess` clock (20–40 s; `BUSY` with `WANTED_PACE`:
  never behind the title, in the cold open or a quiet activity); an
  ordinary car only (calm traffic: not police, a bike, a service vehicle,
  a scene's or an activity's, anything `CityLife.keeps`, longer than the
  hook takes, burning, or the player's own or last car); and **not on a
  busy street**: 6 or more other cars within 30 m (a jam would gridlock),
  or another site within 60 m (a city crash left standing, a double-parked
  truck). Otherwise the usual reactions. **The player's car is never
  held, flagged `towable` or towed**; a second hit on the adopted car is
  the same crash. The scene's over when the tow has the car, the player
  takes it, it burns, it's 190 m off, or after 150 s.
- **Shots fired:** the player's gunfire with no stars on (`LOUD`: not
  while wanted, the real police are coming anyway; one chain at a time,
  90–150 s apart) sets off the alarm of a parked car within 25 m of the
  shots; once the volley stops (2 s quiet, or 6 s in) a passer-by walking
  within 40 m who heard it calls it in (`Witnesses.heard`: the phone pose,
  no crime on the call, the gunfire's heat landed already, and it goes
  through wherever the player's gone), `street` `shotsFired` (a scanner
  line: SHOTS FIRED IN …), and a patrol comes, the officer walks to the
  spot, has a slow look round for 6 s and they leave. Nobody to make the
  call: it ends there.
- **The air horn:** a blast that sets a parked car's alarm off is a chain
  of the player's too (blast, alarm: DOMINO ×2), at most once in 40–70 s
  and `LOUD` ([*Driving and combat*](driving-and-combat.md), the air horn).
- **The patrol and your heat** (`Patrol`, `patrolArrives`): the patrol at
  your mess is the scene's, not a `PoliceForce` unit, so it never sees,
  chases or busts you; a player already gone gets nothing. Only if you're
  wanted **and** still within 30 m when it pulls up does it join your
  pursuit (`CityLifeDeps.adopt` → `heat.adopt`, within the force's unit
  cap; it's a unit from then on, under the usual rules: the bust meter
  still needs you stopped beside an officer). The crash itself is no crime
  (ramming civilians never was); running the arguing driver down is
  assault as ever.
- **DOMINO** (`Cause`, `CityLife.chain`): every scene one thing sets off
  carries a cause, its chain's `root` (`'player'` or `'city'`) and `depth`
  (the root 1, each link one more, capped at `DOMINO_CAP` 4). Each link
  emits `domino {root, depth, what, x, z}`; main pays the player's from
  depth 2 (`dominoAward`: score kind `domino`, all bonus, 100 / 200 / 400
  at ×2 / ×3 / ×4, the feed label `DOMINO ×N`; none while WASTED or
  BUSTED, Chaos Run counts it as smash). Your crash: crash ×1, patrol ×2,
  tow ×3. Your shots: shots ×1, alarm ×2, call ×3, patrol ×4. The city's
  own accidents chain the same way (accident, patrol), rooted in the city:
  they never pay. **Through SceneStarter:** `start(id, x, z, heading,
  ignore, cause)` / `follow(id, x, z, cause)` start a scene as the next
  link of `cause` (`starter.caused` is it), using only what's there: the
  tow takes a towable car within 30 m of the point, the alarm a parked car
  within 25 m, a fire won't start; `CityLifeDeps.follow` is how scenes ask
  (main wires it to the TEST menu's starter).

```ts
life.accidents.adopt(v, impact) → boolean · .mine · .verdict · .waiting(v)   // heat's adoptCrash; 'adopt' | 'soft' | 'held' | 'one' | 'car' | 'busy'
life.shotsFired.shot(x, z) · .call · .counts { started, called, arrived }     // the bus's player 'shot' calls shot()
life.chain(by: Cause | null, what, x, z, root = 'city') → Cause               // emits `domino`
starter.follow(id, x, z, cause) → Cause | null                                // CityLifeDeps.follow; starter.start(…, cause)
Patrol.call(life, x, z) · .step(dt) → 'coming' | 'onSite' | 'joined' | 'gone' · .out() · .leave() · .end()
// Events: { type: 'domino', root, depth, what, x, z }; street 'shotsFired'. Score kind 'domino'. HeatDeps.adoptCrash?(v, impact).
```

A headless check, `tools/tune/mess.mjs` ([*Tuning harnesses*](testing.md)): 2026-11-02,
8 seeds, the built game: 6 crashes adopted (2 seeds found no calm car on
a straight to aim at), the driver out at 1 s and at the player's window
for 33–55 s of each, the patrol on site in 5 (8–17 s; one stood down),
the tow called in all 6 (14–25 s), DOMINO ×2 and ×3 paid; 3 of 3 shots
chains ran alarm, call and patrol (DOMINO ×2, ×3, ×4) with no star.
**Budget:** no mesh, batch or program; the patrol car and tow truck are
traffic models (a police car and the tow truck, each a call and a shadow
pass if not already in view), the driver and officer wear crowd bodies,
the hazards are the glow batch. Nothing allocated per step (records and
the chain's cause only when a link happens).

**Incidents** (V2-13; rules pure and tested in `systems/incidents.ts`,
`tests/incidents.test.ts`). Six more things that happen whether you're
there or not, each with an obvious way to join in or wreck it. One of
each at a time, never back to back (each clock's wait is longer than the
incident lasts), only at their hours (the game clock: 30 s a game hour),
within the 24-person `PEOPLE_CAP`. Each scene's holds are its `HOLD`
constant at the top of the file (`BUSY` with `WANTED_PACE` for the van,
the kebab shop, the funeral and the conga: they carry on, fewer, while
you're wanted; `IN_PLAY` for the hydrant and the film shoot).

- **Cash-in-transit van** (`scenes/cashRun.ts`, 08:00–18:00, every
  220–360 s): an armoured van (the ordinary `van` in `#4a5560`) brought
  into traffic does three kerb stops mid-block, hazards on: a guard in a
  dark uniform and pale helmet steps out of the back (`cashRun`: its back
  doors), carries the box (`package`) to the shop door, waits inside 3 s
  and carries it back. **Wreck it:** knock the guard down while he's out,
  ram the van under 45% health (or wreck it, set it alight) or drive off
  in it, and cash spills (`cashSpill`): 5 bundles from the van, 2 from the
  box, the `cash` model in a pulsing green ring for 40 s, $30–70 each,
  picked up on foot (1.3 m) or driving over (2.6 m) through
  `deps.reward`. When it's the player's doing (they drove off in it,
  hurt the van in the last 10 s, or flattened the guard themselves:
  `robbedByPlayer`; a van the traffic hit spills for anyone and blames
  nobody): **CASH GRAB** (300, `deps.award`), the guard and his mate from the cab come at you with
  their fists for 18 s, and it's called in (four `assault` calls through
  `deps.callIn`: one star). The van's left in the road, towable.
- **Kebab chucking-out time** (`scenes/kebab.ts`, 00:45–03:30 in the Neon
  Mile and Cobble Row, every 150–260 s): a neon shopfront 18–90 m off
  spills out over 75–105 s (`kebabPhase`: spill, peak, drain), up to 8 at
  once out of the door (`kebab`: a hand bell rung twice), swaying about
  the pavement out front, lurching sideways and singing (a cheer); 40%
  queue at the kerb for a taxi (`kerbOf`: the kerb straight out from the
  shop), and a taxi (one in traffic within 130 m, else brought in) pulls
  up every 10–18 s for the front one or two. A fifth of the way in two
  have words face to face, and 45% of the time it comes to blows
  (`Fights.start`: the shove, the fists, a ring watching). Then they drift
  home. **Join in:** they're drunk, half of them `fighter`s: shove one and
  it's on (provoked, they're let go swinging: `people.ts` letGo). The
  shop's strip light spills warm onto the pavement at night.
- **Funeral procession** (`scenes/funeral.ts`, 09:00–16:00, every
  240–400 s): a black `limo` for the hearse and two or three black sedans
  at 5.5 m/s, 8.5 m apart; the hearse drives as calm traffic (lights,
  turns) and waits for anyone dropping back, the family's cars follow its
  exact line (`Trail`, `backOf`, `followSpeed`); calm traffic doesn't
  overtake, so it queues behind. A bell tolls every 9 s near it
  (`funeral`). **Wreck it:** cut through the line between two of its
  cars (`cutsThrough`), hit one, or take one: they stop, two mourners in
  black get out of each car and come at you for 16 s (**NO RESPECT**,
  250), then walk back, get in and carry on (without a car you took).
- **Burst hydrant** (`scenes/hydrants.ts`, any time a hydrant is knocked
  over by any car: the `crash` event's `prop`, every 45–60 s at most):
  it geysers for 40 s (`geyserStrength`: build, full, easing off over
  the last 8; a `hydrant` gush every 3.5 s), a column of water drops and
  mist (`render/incidentsLook.ts`) over a wet sheen. The spray (up to
  2.5 m) bowls over anyone in it, at most once in 3 s each (the player
  too, on foot), throws scooter riders off (`deps.throwRider`, as a hard
  crash does) and shoves cars aside. Up to 8 gather to gawp 5.5 m back,
  pointing and cheering; by day when it's dry three kids in bright tops
  play round the edge, soaked and whooping. Other hydrants knocked in the
  meantime spray as before (`knockFx`, 14 s).
- **Hen or stag conga** (`scenes/conga.ts`, 20:00–02:30 where the
  district's `NIGHTLIFE` is at least 0.3, every 180–300 s): six to nine in
  matching tops (hens in pink, stags in green: `PARTY_OUTFITS`) put down
  at a pavement corner out of view 28–85 m off, conga round the block a
  pace apart, the leader walking the corners and the rest on its line, a
  lurch to the side every fourth beat and the chant every 3.4 s
  (`conga`: da-da-da, da-da-da-HEY). **Join in:** a fight within 24 m
  and a third of the line piles in (`setOn` the fighters), rejoining the
  tail after; a blast, a hard crash or a knockout of yours within 45 m and
  the whole line stops and cheers. Drive through them and those flattened
  drop out. 70–110 s, then they go on their way.
- **Film shoot** (`scenes/filmShoot.ts`, 08:00–23:00 in Glass Heights,
  every 240–400 s): a set roped off at a kerb out of view 30–110 m off
  (the parking strip and the pavement, `SET_HALF` 18 × 5.2 m, so the lane
  stays open; 14 `traffic_cone`s along its ends and road side, a hard
  white wash of film light): the star car (a red `sports`), the picture
  car (a grey sedan), a director (red beret), a clapper, and two extras
  as police in the force's colours with a tell (a passer-by's build, no
  kit, the shirt a costume-shop blue, the cap the wrong blue). Passers-by
  watch from either end. Each 26 s take: marks, ACTION (`action`: the
  clapperboard and a brass stab), the extras run at the picture car, the
  staged blast at 14 s (`pyro`: Effects' explosion, nothing hurt, the
  car left smoking), the crowd cheers, CUT, re-dressed. **Make it real:**
  steal either car, knock someone down on the set, fire a gun within
  30 m or set off a real blast within 22 m, or drive onto it fast or into
  its cars: **THAT'S A WRAP** (400), the extras, crew and crowd scatter,
  and the real police get the call (one star). 100–140 s.

All six are in the TEST menu's scenes (`CASH-IN-TRANSIT VAN`, `KEBAB
CHUCKING-OUT`, `FUNERAL PROCESSION`, `BURST HYDRANT`, `CONGA LINE`, `FILM
SHOOT`: each scene's `force()`, any hour, any district) and the title's
highlights (`CASH RUN`, `CHUCKING-OUT TIME`, `FUNERAL`, `BURST MAIN`,
`CONGA`, `ON SET`; `Highlight.hours` keeps the night's to the title's
night and the day's to its day).

```ts
// CityLifeDeps (main.ts wires them): award?(kind) → score.award ('cashGrab' | 'wrapped' | 'noRespect'),
//   throwRider?(v) → main's throwRider, knockHydrant?(x, z, range) → knockables.nearest + knock + knockProp.
// Events: crash.prop (the knocked prop's kind); street: cashRun, cashSpill, kebab, funeral, hydrant, conga, action, pyro.
// Knockables.nearest(kind, x, z, range) · .knock(item); people.ts streetBody(life, onScreen?) · letGo(life, c).
```
