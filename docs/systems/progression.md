# Progression

Goals and a reason to keep playing (M7). Everything hangs off one
`ProgressDirector` (`src/game/progressDirector.ts`); `main.ts` creates it and
calls `step(dt)` per sim step, `update(dt)` per frame, multiplies the sim's
time by `simScale()`, holds the player's car while `holdControls`, ignores
gameplay input while `blocksInput`, keeps `pinned` cars out of traffic
recycling, and routes `HeatDeps.pay`, RESTART and quit-to-title through it.
The rules are pure, tested modules; the runtimes that put them on screen
are `src/game/modes/*Mode.ts`.

- **Play log** (`game/playLog.ts`): local tuning telemetry, never sent
  anywhere. A ring of the last 200 results in `curbside.playlog` (JSON
  array): Chaos Runs (score, medal, elapsed, end), races (time, dev, ratio,
  medal or fail reason) and chases of 2+ stars (peak, seconds at five
  stars, duration, lost / busted / wasted / respray / reset), each stamped
  with build, device (touch / keys / pad) and quality tier. It listens to
  `wanted` and `activityEnd` (emitted by RaceMode and ChaosRunMode) and
  writes only when an entry is added. `__ub.playLog.export()` / `clear()`.
- **Save** (`game/progressSave.ts`): one versioned JSON record,
  `curbside.save`: cash, lifetime stats, best score per mode, medals, race
  times, packages found, frenzies beaten, export orders, taxi streak,
  missions passed, unlocks, whether the cold open has run (`opening`; the
  old first-run pointers' `tutorial` step is kept for older builds). Every field is sanitised on load (a bad value
  falls back alone, NaN or negative cash can't get in, a newer save keeps
  what this build understands and carries the rest through untouched,
  never lowering `v`, so an older tab or a stale PWA can't wipe it; ids
  this build doesn't have, such as a package past 40 or an unknown
  frenzy, mission or export order, are dropped at boot by `pruneSave`
  so they can't count); corrupt JSON is kept aside as
  `curbside.save.corrupt`; blocked storage never throws. The old
  `curbside.best` carries over into a fresh save only (the score HUD still
  writes it, Chaos Runs included, so a save never reads it again); the
  director puts the save's free-roam best on the score at boot and keeps it
  as it's beaten. Writes are batched (every 4 s while dirty)
  and flushed on pause, app switch, page hide and the end of anything that
  pays. `Progress` (`game/progress.ts`) owns it: `earn`, `spend`, `charge`,
  bests, medals, unlocks, and lifetime stats counted off the bus.
- **The cold open** (V2-07; rules and geometry in `game/opening.ts`, pure
  and tested; the runtime `game/modes/openingMode.ts`, `OpeningMode` in the
  director's modes, its city side `openingStage` wired in main.ts). PLAY
  on a save that hasn't had it (`openingDue`: `save.opening` false) drops
  the player at the bus shelter nearest the safehouse with room ahead of it
  and not on the south side of its road (`pickOpeningStop`, `southSide`:
  the tilted camera would see the building, not the player), standing at
  the shelter's end, as a bus pulls in
  22 m back (`Buses.force(stop, back)`). The getaway's road is cleared of
  traffic and parked cars (`onOpeningRoad`; the screen has only just cut
  there). A staged chase (`Chases.stage`, a sedan and two units 30 and 44 m
  behind it) waits 62 m up the far lane for 2 s with its sirens going, then
  comes flat out, swerves across and piles into the kerb 11 m ahead of the
  stop (on reaching it, on hitting anything on the way, or 6 s after setting
  off: about 5.4 s after PLAY): a crash, half its health gone (smoking),
  stopped dead; its driver runs, and it's an abandoned car (off the
  director's list). The units pull up 22 m short of it; nobody comes in
  45 s and they leave it. The crash starts story job **s1, WRONG STOP**
  (`direct`, `MissionMode.beginNow(job, lend)`: the getaway lent as its
  `getaway` car): GET IN · LOSE THE HEAT. Getting in is TAKE THE HEAT
  through the chase handoff (2 stars, its cops yours, the stamp); with no
  chase to hand over (chases off, `Chases.enabled = false`, or no room for a
  unit: the **fallback**, a crashed sedan already at the kerb; or a chase
  that gave up on the car) the opening calls it in itself (`tookGetaway`,
  the `takeTheHeat` award and street event). It has run once the player is
  in the car (`save.opening`, flushed); a respawn before that (WASTED on the
  pavement) starts it over, a quit leaves it due, and a getaway wrecked
  before anyone's in it ends it (s1 failed; the story goes on from s2). It's armed by any
  respawn (PLAY, RESTART, after WASTED) and starts on the next sim step,
  unless a Chaos Run took the run. While it's on (`OpeningMode.holding`)
  the busy scenes hold off (`CityLifeDeps.opening`). Settings → REPLAY
  OPENING forgets it and starts a run; a passed s1 replays as a repeat job.
  A save from before the cold open with 2+ minutes of play is a veteran's
  (`migrateSave`): `opening` true, PLAY as before. Once the opening has
  run, an s1 not passed no longer holds the main story's phones
  (`nextInArc(…, skipDirect)`). The three first-run pointers it replaced
  are gone. The yellow sports car at the spawn waits on the centreline
  lined up on the ramp a block east. How to Play adds banking, heat,
  BUSTED, cash and the shop, where the activities are, and a radar legend
  (`ui/radarLegend.ts`, also at the foot of PROGRESS).
- **Side modes wait for story job 2** (`sideModesOpen`): Chaos Run (on
  the title), frenzies, races, exports and taxi fares are hidden, and not
  offered in the street (`ModeCtx.sideModes`), until `s2-noise` is passed
  ("SIDE JOBS OPEN · CHAOS RUN ON THE TITLE" when it happens, then a line
  naming the street ones) or the save has the `sideModes` unlock (a
  veteran's save, at migration). Hidden packages, the shop and the
  payphones are there from the start.
- **Prune for newcomers** (V2-17; `titleOffer`, `pastOpening`,
  `stillToCome` in `game/opening.ts`, tested in `tests/newcomer.test.ts`):
  a fresh save's title is PLAY and SETTINGS (plus INSTALL where the
  browser offers it, the version, the hub link and the iPhone install
  tip). Past the cold open (`save.opening`, or a passed job or the side
  modes, so REPLAY OPENING doesn't take a played save's title back): OBSERVE,
  CHARACTER and HOW TO PLAY (in the pause menu from the start). Past
  `s2-noise`: CHAOS RUN. OBSERVE, on the title and in the pause menu, also
  shows whenever Test tools are on (a testing mode); otherwise it's never
  offered mid cold open. The gates are `TitleScreen.gateExtras`,
  `addEntry(…, shown)` and `PauseOverlay.addButton(…, shown)`, checked as
  the menu opens and on a settings change (`ProgressDirector.offer`).
  What's locked is said rather than appearing silently: PROGRESS opens
  with STILL TO COME (OBSERVE after the getaway; Chaos Run, races,
  frenzies, exports and taxi fares after MAKE SOME NOISE) and leaves the
  locked modes' rows and bests out until then; "OBSERVE OPEN · WATCH THE
  CITY FROM THE TITLE" comes in the feed once, when the getaway's heat is
  lost and nothing's running; How to Play's *Activities* names the gate.
  A veteran's save sees everything as before.
- **Bank your chaos** (`game/progressBank.ts`): when a combo chain ends (the
  combo window has run out and no drift is sliding), its points become cash:
  points / 10 × (1 + 0.5 × the highest wanted level during the chain), with
  a "BANKED $X" feed line. WASTED or BUSTED before then loses the chain
  ("CHAIN LOST"). WASTED also costs a $200 hospital bill; BUSTED fines 25%
  of your cash (the share the bust takes off the score), at most $1,500.
- **CRED and perks** (`game/cred.ts` rules, `game/credKeeper.ts`,
  `ui/perkCard.ts`; design in `docs/CRED.md`): every life earns CRED when
  it ends, from its points (a bust's fine still counts), time alive, peak
  stars and cash earned from jobs, fares and races (not banked chains, whose
  points already count): about 130 for a good three minutes, about 250 for
  a wild five minutes at 5 stars. The WASTED /
  BUSTED card shows +CRED and a level bar (LEVEL UP stamped on a new one).
  Levels cost 100 CRED, then 50 more each. A level reached holds the respawn:
  1.7 s into the death screen LEVEL UP freezes the game and offers three of
  eight perks (seeded by the level, so a reload shows the same three), four
  ranks each: TOUGH +15 max health, KEVLAR 25 armour at the start of each
  life, BODYWORK −10% damage to your car, NITRO JUNKIE +15% nitro gains,
  SLIPPERY +15% time for a cop to cuff you, GHOST −8% time out of sight to
  lose a star, HUSTLER −20% on hospital bills and fines, BANKER +10% on
  banked chains (per rank). Picked levels and ranks are saved
  (`save.cred`); a level not picked waits for the next death screen; once
  every perk is maxed a level pays $500. The effects are knobs on the
  systems (`Nitro.fill`, `BustMeter.slow`, `Wanted.evadeScale`,
  `DamageState.taken` on the car you drive), set every sim step from
  `CredKeeper.fx`, which is NEUTRAL during a Chaos Run or a race so bests
  and medals stay comparable. PROGRESS lists the level and every rank.
- **Cash HUD**: under the score's BEST line, a rolling counter with a
  "+$600" / "−$400" chip and the register's ching; the title shows CASH
  beside BEST.
- **Pay 'n' Spray** now costs `SPRAY_COST` ($400, $100 with the spray card).
  Driving in says the price; broke means "NO CASH, NO SPRAY".
- **Shop** (`game/modes/shop.ts`): stand on the glowing safehouse door 16 m
  east of the spawn corner ('H' on the radar), or SHOP in the pause menu
  within 45 m of it. TOUGH SKIN (+50 max health, the stand-in for body
  armour: `Player.maxHealth`, the health bar shows the share) $3,000;
  PAY 'N' SPRAY CARD $1,500; PACKAGE SCANNER $2,000; pistol / SMG / shotgun
  ammo $150 / $400 / $300, BODY ARMOUR $600, GRENADES $500, and a crate's
  worth of the W3-B weapons: AIR HORN $200, TASER $450, STINGERS $500,
  SMOKE GRENADES $600 (`arsenal.pickUp`, drawn as you buy); STICKY CHARGES
  (+2) $700 once RIBBON CUTTING is passed (`ShopItem.after`: `canBuy`
  says 'locked' and the sheet leaves it out until then). Something you can't afford
  shakes and flashes the cash red (and a haptic tick).
- **CHAOS RUN** (title, once the side modes are open; `modes/chaosRun.ts`, `chaosRunMode.ts`): a sports
  car at a random crossing and the same loadout every run (`CHAOS_LOADOUT`:
  a pistol, whatever free roam or the shop left in your pockets; RETRY too),
  3-2-1 with the car held, then 2:00 on the clock
  top centre; +5 s per explosion you cause (not your own car, even one you
  bailed out of), +3 s each time a chain reaches
  ×5 ("+5 S" pops beside the timer); the last ten seconds count down out
  loud in red tenths (the last five as smaller red digits up top, off the
  car). The BEST line shows the run's own best (`Hud.setBest`); leaving the
  run zeroes the score and puts free roam's back, so a run never counts
  toward free roam. Heat is live. Time up slows the city to a freeze-frame,
  the chain still running is banked, and the results card comes up: score,
  medal (bronze 15,000 / silver
  40,000 / gold 80,000), best and NEW BEST, the breakdown (drift, near miss,
  smash, hit & run, KO, carjack, boom, cops) and RETRY / FREE ROAM / TITLE.
  WASTED or BUSTED ends the run early (results after the respawn). The best
  and medal are saved and shown on the title; RESTART in the pause menu
  starts a fresh run. The medal lines are the review's (bronze is a run
  that keeps its car and chains a few stunts). Bot baselines from
  `tools/tune/chaos.mjs` ([*Tuning harnesses*](testing.md)) put a mindless driver at
  bronze 1 run in 5 to 1 in 2 and never silver.
- **Frenzies** (`modes/frenzies.ts`, `frenzyMode.ts`): eight spinning purple
  gems on pavements ('!' on the radar). Touch one, 3-2-1, then: KNOCK DOWN 15
  in 60 s (with an SMG), NEAR MISS ×8 in 60 s, CARJACK 5 in 120 s, DRIFT
  3,000 in 40 s, WRECK 6 CARS in 90 s (with a shotgun), HIT & RUN ×10 in
  60 s, SMASH ×12 in 50 s, a ×8 COMBO in 45 s. They count the same bus events
  as the score. $1,000 the first time (the gem turns gold), $150 a replay.
- **Hidden packages** (`modes/packages.ts`, `packageMode.ts`): 40 green
  parcels at fixed places (`PACKAGE_SPOTS`, worked out once by
  `generatePackages` from the unedited core city): about half deep in
  alleys (with a straight person-wide way out to the street), the rest in
  park interiors and plaza corners, at least 20 m apart and in every
  quarter. Fixed so a map edit never moves them and the save, which keeps
  found ones by index, stays right; the map edits can move, remove or add
  them (`pkg-<index>`, `placePackages`). $100 each, "PACKAGES 12/40";
  every tenth is a perk: a pistol every life, banked chains +25%, an SMG
  every life, health that refills when you lie low. Only on the radar
  with the scanner.
- **Checkpoint races** (`modes/races.ts`, `raceMode.ts`): six courses of 8–12
  crossings authored as data (DOWNTOWN DASH, HARBOUR LOOP, OLD TOWN
  SCRAMBLE, NEON NIGHTS, CUL-DE-SAC CRAWL, RING ROAD RUN), 'R' on the radar.
  Drive onto the chequered line with no stars ("LOSE THE HEAT FIRST"
  otherwise): the car lines up, 3-2-1, then gates of
  light (the next-but-one small), a radar route to the next checkpoint and
  the time against gold on the card. Medals against a developer time from
  the course (straights at 36 m/s, 1.2 s a corner, 2 s to launch) in the
  sports car, scaled for the car on the line so gold is in reach in any
  (`carPace`: top speed and grip; a sedan ×1.22, a bus ×1.81; a faster
  car taken mid-race tightens it, `RaceRun.takeCar`): gold
  ×1.05, silver ×1.2, bronze ×1.4, paying $800 / $400 / $200 the first time
  (a tenth on a repeat). A clean braking-aware bot in an empty city
  (`tests/raceDevTime.test.ts`) does every course in ×0.88–0.91 of dev in
  the sports car (gold with ~15% to spare for traffic and mistakes), and
  every other car (corners at a speed set by its grip) ×0.88–0.93 of its own
  dev time (the limo ×1.0: the bot clips kerbs in it); the test fails if a
  handling change moves that, so re-tune `DEV_SPEED` / `DEV_CORNER` (`modes/races.ts`) or its
  bounds on purpose. `RACE_REPORT=1 npx vitest run tests/raceDevTime.test.ts`
  prints every course in three cars. Out of the car for 8 s, wrecking the car, WASTED,
  BUSTED or 2.5× the dev time ends it.
- **Hot-car exports** (`modes/exports.ts`, `exportMode.ts`): a drive-in bay
  on an open lot at the docks ('$' on the radar, pulsing with an arrow when
  you're in a car on the list). An eight-car order list ("YELLOW SPORTS",
  "A TAXI", "A POLICE CAR", "ANY VAN"...); stop in the bay with no stars and
  at least half health: compact 300, sedan 400, van / pickup 500, taxi 600,
  sports 900, police 1,500 (+25% for a colour order) × health; the car is
  craned away (`Vehicle.exported`: nobody gets back in to sell it twice).
  Nothing sells while an activity runs ("DROP YOUR FARE FIRST", "FINISH
  THE JOB FIRST"), and a car that sat in the bay during one (the first
  payphone job delivers its sedan there) sells only after it drives out
  and back in.
  The whole list pays $5,000 and a new one comes in.
- **Taxi fares** (`modes/taxi.ts`, `taxiMode.ts`): driving a taxi puts you
  on duty. A pedestrian ahead stops and waves under a yellow marker; stop
  beside them for a second and they get in. The destination is 250–700 m
  away on a pavement (radar route, a beacon), time 15 s + 1 s per 11 m;
  fare $50 + $0.6/m × (1 + time to spare); every fifth fare in a row +$500.
  They bail at 2★ or if the cab loses a quarter of its health.
- **Borrowed Blues duty** (V2-09; `modes/serviceMode.ts`, rules in
  `systems/serviceTools.ts`; the tools themselves are [*City life*](city-life.md),
  [*Borrowed Blues*](city-scenes.md)): in a stolen fire truck, ice cream van or tow truck
  (free roam, nothing else on) you're on duty: the activity card names the
  vehicle and how to work its tool on the device in use (`HOLD J OR CLICK
  TO HOSE`, `HOLD HOSE · DRAG IT TO AIM`, `CHIME ON · QUEUE 4`, `TO THE
  DOCKS YARD 230 M · $120`), and the feed says so as you get in. **Fire
  duty:** each fire your hose puts out pays $40 (`FIRE OUT`), every third
  in a row +$120 and a banner. **The tow side job:** a car on the hook
  routes the radar to the docks yard (`Y`, the export garage's lot; a ring
  and beacon there); stopped with it inside 16 m of the yard's middle for
  a second (or WINCH pressed there) it's delivered: $150 CLEAN (health
  ≥ 70%), $120 DENTED (≥ 40%), $90 BATTERED, $60 SCRAP (a burnt-out
  shell), every third in a row +$150. The car's left in the yard (retired
  once unseen) and never pays twice. Getting out loses either streak, as
  a cab's does. **Vex's tow contract:** after dark (sunset to sunrise, as
  the Night Shift), 8 s on duty in a tow truck with nothing hooked and
  going under 4 m/s, at most once every 150 s, Vex rings (the call card,
  `☾ TOW CONTRACT`, two calls in turn, lines in `serviceMode.ts` and
  `docs/STORY.md`): a crashed sedan, compact or pickup (30–50% health,
  `towable`, pinned) is left askew at a kerb 110–260 m off, on the radar
  (☾, an arrow) and ringed in the street; get it to the yard within 240 s
  for $250 on top of the yard's price, or CONTRACT LOST (too slow, or the
  wreck gone or driven off).
- **Payphone missions** (`systems/missions.ts`, `missionsData.ts`,
  `modes/missionMode.ts`): a data-driven engine with steps goto, enter (a
  tagged car or an archetype), deliver, pickup, destroy, knockOut,
  knockOutAll (several people, in any order, counted 0/2), survive,
  loseHeat, collect, race and mayhem (score this many chaos points in an
  area: a district, a radius round a point, or round a tagged car or
  person; anywhere without one); each with objective text, an optional
  timer (`timeout` says what running out means: THE SPIT WENT COLD; OUT
  OF TIME if left out), fail conditions (a tagged car wrecked, left behind or scratched:
  `damaged`, under `below` of its health, 90% by default, the moment it
  is; a tagged person knocked down; `reach`: one of `by`, standing, within
  2 m of the tagged person, OPEN MIC's wardens getting to Lionel) and
  actions on start / end (spawn a
  car, parked or with `drive: true` pulling out into traffic with a
  lane-following driver while staying pinned, or a person; `parked: true`
  flags a car as one of the city's parked ones, so a bump, a bullet or a
  blast sets its alarm off (ALARM CALL's five); `{ do: 'drive', tag,
  cruise?, route? }` changes a driven car's pace or route mid-job, and
  pulls one still waiting out at once (LOUDEST CITY's convoy speeding up);
  a person with `walkTo: tag` marches (a walk, never a run: the crowd
  agent's `march`) at another job person and keeps at it, back on the march
  after a scuffle they gave up, still walking off screen, until knocked
  down; `delay: s` brings one on that long after the action (waves); set the wanted
  level, hand over a gun, a passenger boards / alights; start a city
  scene; put a car on a truck's hook). Score awards feed a
  mayhem step (`MissionRun.award(points, view)`, counted where the player
  is; the step passes on its next update, never mid-award); the HUD shows
  `MAKE COBBLE ROW LOUD · 1,200 / 2,500` and the radar points at the area
  from outside it.
  - **Scenes a job starts** (`{ do: 'scene', scene, x, z, r? }`,
    `MissionScenes`): waits until the player is within `r` (110 m) of the
    point, starts the scene through the TEST menu's `SceneStarter`
    (`storyScenes(cityLife, starter)`, wired in main.ts with
    `missions.useScenes`), re-rolls once after 4 s if it couldn't start,
    then gives up quietly: no step depends on one. A started scene is
    `CityLife.featured`, so no hold keeps it off (not even the player's
    stars, apart from a chase's); the job unfeatures it when it ends, by a
    pass, a fail, WASTED, BUSTED or a quit. One featured kind at a time
    (the last started).
  - **Lines during a step** (`{ do: 'say', lines, first?, every? }`,
    `MissionTalk`): the first `first` s in (4), then one every `every` s
    (12), in order; when the step ends the rest are dropped. Each goes out
    as a `voice {who, text, hold}` event, shown on the scanner's subtitle
    under the speaker's name (`ScannerHud`, tone `story`); while it's up
    the dispatcher holds his own (`ScannerFeed.step(.., hold)`,
    `ScannerDeps.busy`). Not heard: GameAudio ignores it. At most 72
    characters a line (two lines of the phone's subtitle; a test).
  - **Driven cars** (`SpawnCar`, glue in `MissionMode.tendCars`): with
    `drive`, `wait: m` keeps it parked until the player is that close (or
    it's hurt), `cruise` sets its pace, and `route` gives it crossings to
    tour in turn, round and round (`routeLeg` moves on as it heads into
    each; `routeToward`, as a pursuit steers, picks the turn for the next).
    A mayhem area with a `tag` follows its car: on the radar throughout
    (the route redrawn only once it has gone 24 m), ringed in the street.
    A convoy is cars on one route at one pace, spawned nose to tail; the
    lead's `wait` is longer than a follower's plus the gap to it, so
    however the player comes at them the lead pulls out first.
  - **The hook** (`{ do: 'tow', tag, truck }`, `hookLetGo`): the car rides
    behind the truck as the city's tows carry theirs (`towPose`, no speed
    of its own) until it's let go where it stands: the truck's driver gone
    (wrecked, carjacked, bailed), the player in the car, or the truck
    caught standing (under 2 m/s) with the player within 24 m for 1.2 s
    (`CATCH_*`). Not a tool the player works: towing is never a main-story
    verb ([*Borrowed Blues*](city-scenes.md) is the side job).
  - **Two arcs** (`arc` on `MissionDef`, `arcRings`, `nextInArc`). The main
    story, **KEEP IT LOUD** (`arc: 'main'`, ids `s1`–`s6`: DOREEN of the
    ice cream van, LIONEL the busker, against MAYOR LULL's Quiet Streets
    Act: WRONG STOP, the cold open; MAKE SOME NOISE in Cobble Row; QUIET
    PLEASE; NINETY-NINE PROBLEMS, Doreen's van off the Graveyard Shift's
    hook without a scratch; RIBBON CUTTING, the Mayor's limo; QUIETEST
    CITY, 5,000 round the judges' touring coach with a race, a fire and a
    turf flare-up on its route; then chapter 2, `chapter: 2`, the Kerb
    Removal Order: NO KERB, NO CURBSIDE, DONER, OPEN MIC, PLANNING
    PERMISSION, ALARM CALL and LOUDEST CITY), rings from sunrise to
    midnight from the city's three phones. The
    **Night Shift** side story (`arc: 'night'`, the old Graveyard Shift jobs
    `m1`–`m13` with their ids, so saves keep their progress: VEX's tow crew
    and LIL' TUNA, eight jobs against DEACON PIKE's Chrome Saints, then
    five, *The Ledger*, against COMMISSIONER CLAMP) rings only after dark
    (sunset to sunrise) from the docks-yard phone (`NIGHT_PHONE`), with a
    moon (☾) on the radar and *☾ NIGHT SHIFT* on the call card. So in the
    evening both can ring at once, never at the same phone. Each arc rings
    for its own first job not passed, in data order (an id this build
    hasn't got is skipped); a `direct` job (s1, the cold open's: no phone,
    no call) never rings (the glue starts it with
    `missions.beginNow(def, lend?)`, a car already on the street lent as one
    of its tagged cars) and nothing else in its arc rings until it's
    passed, or until the glue has had its go (`skipDirect`: the cold open
    has run). Script and cast in `docs/STORY.md`.
  Answer on foot or by stopping beside a ringing phone (the nearest, if
  two are; a ripple of light, the bell within 55 m, 'M' or '☾' on the radar
  with an arrow): the call is a card, the job runs with its objective
  on the activity card and its targets marked (a step any sedan will do
  for rings and blips the three nearest, and the wrong car says NOT A
  SEDAN); MIDNIGHT EXPRESS, PAPER TRAIL, NO PARKING and QUIETEST CITY pin the clock at night (a fail or quit puts the
  hour back). Pay $300–$5,000; fail and the phone rings again. No main
  story job sets stars, and only s1 asks you to lose the ones its getaway
  brought. The last job of a chapter
  debriefs CHAPTER n COMPLETE (`chapter`, `endsChapter` over its arc), an
  arc's very last STORY COMPLETE or NIGHT SHIFT COMPLETE. Once an arc's
  jobs are all passed its phone rings with them again in order as REPEAT
  JOBs (`replayJob` / `replayReward`): half pay rounded to $50, no
  completion credit, the debrief says JOB DONE; `stats.jobsReplayed` counts
  them (both arcs share the count), keeps the rotation across sessions and
  shows as *Repeat jobs* on PROGRESS. Completion's 30% story share is the
  main story's alone; PROGRESS shows *Main story: Keep It Loud* and *Night
  Shift* as separate rows. A banner
  raised while WASTED / BUSTED is up (MISSION FAILED, RACE OVER) waits for
  the respawn.
- **Districts and the area card** (`world/districts.ts` DISTRICT_NAMES /
  districtAt, `modes/areaMode.ts`, `ui/areaCard.ts`): settle in a new
  district for 1.2 s and its name shows under the radar for ~3 s (GLASS
  HEIGHTS, COBBLE ROW, NEON MILE, RUSTWATER DOCKS, MAPLE FLATS:
  placeholders), with whose turf it is (red while they're hostile).
- **Gangs** (`game/gangs.ts` rules, `modes/gangMode.ts`): the VIPERS (lime
  shirts) run NEON MILE from five pavement hangouts of three (one armed),
  put on the street within 70 m in crowd bodies (no extra draw calls).
  Respect −100..100 per gang, saved (`save.respect`): −6 for knocking one
  over, −10 for a knockout (and that crew comes for you); +2 / +3 for an
  officer down / a police car blown up on their turf, up to +40; a grudge
  fades a point every 20 s. Below −25 they attack on sight; from +50 they
  let anything go. Feed lines on each change and standing; a respect bar on
  PROGRESS. Free roam only. Members carry `agent.gang`, and `pedDown`
  carries `gang`.
- **Activity HUD** (`ui/progressHud.ts`, `progress.css`): a compact card top
  centre under the pause button (what, a big timer, the goal and counter;
  the wanted stars step down under it, the radio card pushes it down), a
  banner mid-screen for 3-2-1-GO / PASSED / FAILED (on a phone a held
  3-2-1 drops onto the car, clear of the card's clock), and a prompt pill above
  the HUD prompt for nearby markers. Checked at 1280×720, 852×393 and
  852×340 with the iPhone's safe areas.
- **PROGRESS** in the pause menu (`ui/progressScreens.ts`): completion %
  (`game/progressStats.ts`: story 30%, frenzies, packages and races 15%
  each, exports and taxi 10%, the Chaos Run 5%), cash, STILL TO COME while
  anything's locked, each activity's
  progress, the export list, bests with medals, and the lifetime stats
  (up / down scroll it on a keyboard or gamepad).

Cards (results, calls, the shop on the street) freeze the sim and take the
input; FrontDoor routes keyboard / pad navigation to them. Free roam's best
run score is saved per mode too (`best.free`). HUD text is rebuilt only when
what it says changes (`KeyedText`), so nothing allocates per frame. Markers are glow
quads in the shared batch; packages, payphone booths, parcels and frenzy
gems are two instanced meshes using the pickup crates' program, drawn only
while one is in view (+1–2 draw calls then, +1–2 in the shadow pass;
nothing compiled after start-up). Measured in Chromium (iPhone 15 Pro
profile, 'medium'): 36–38 draw calls on foot beside a package or a frenzy
gem, 45–47 driving in a Chaos Run; desktop ('high') 56–67 during missions.

API for other systems:

```ts
progress.progress.earn(amount, reason) / spend(cost, reason) / charge(...)  // cash (Progress)
progress.progress.has(unlock) / unlock(id) / recordBest(mode, score) / recordMedal(id, medal)
progress.pay(amount, reason, feedLabel)        // earn with a feed line
progress.busy                                  // the exclusive activity running, or null
progress.spawnCar(archetype, paint, x, z, h) / unpin(v)   // a parked car kept from recycling
progress.ui.banner(text, tone, sub?) / ui.activity(label) / ui.timer(s) / ui.goal(text)
frontDoor.openPanel(panel) / closePanel(panel) // route menu navigation to a screen
pause.addButton(label, icon, onActivate)       // a button in the pause menu
title.addInfo(element)                         // a line under the title's best score
player.maxHealth                               // a life's starting health
```
