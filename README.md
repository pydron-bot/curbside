# Curbside

_Formerly "Urban Blight" (renamed 2026-10-29; other games already use that name)._

Top-down open-world crime/driving game for the browser — three.js, TypeScript,
Vite, installable as a PWA. Full plan: `docs/PLAN.md` (mirrored as `PLAN.md` in the Google Drive folder
*GameDev / Curbside*, which also holds art; code lives here).

**Play:** https://deeek.org/curbside/ (deployed from `main` by
`.github/workflows/pages.yml`). Current state and the to-do list:
`docs/HANDOFF.md`.

## Run

Needs Node ≥ 22.12 (hive1: `~/.local/opt/node24/bin`, the system Node 20 is too old).

```sh
npm install          # if NODE_ENV=production is set, unset it first or dev deps are skipped
npm run dev          # vite --host, http://<host>:5173
npm test             # vitest: the pure logic (~800 tests)
npm run build        # typecheck + production build with service worker
npx -y -p playwright@1.63.0 node tools/make-icons.mjs   # re-render the PWA icons from the game (dev server up)
npm run assets       # rebuild GLBs from blender/ (needs `blender` on PATH; add `-- --thumbs` for previews)
npx -y -p playwright@1.63.0 node tools/smoke.mjs   # browser smoke test (see below)
```

**Smoke test** (`tools/smoke.mjs`): builds the game as Pages does, serves it
and plays it headless (Chromium + SwiftShader) on desktop 1280×720 and the
iPhone 15 Pro profile at 852×393 and 852×340: boot, a run, 30 s simulated,
no page or console errors, under 150 draw calls, and a named-mayhem stamp
(`__ub.stamp(id)`, held mid-show) clear of the stars, radar, status,
activity card and score feed (on the phones in a Chaos Run too), and the
police scanner's subtitle (`__ub.scanner.say()`) clear of all that, the
stamp, the radio's card and the thumbs, on foot and in a car; a fresh
save's title is PLAY and SETTINGS (OBSERVE too with Test tools on) and
gains OBSERVE, CHARACTER and HOW TO PLAY after the cold open; the
best-moment picture on WASTED (a forced stamp, then death: the photo and
caption inside the view, clear of WASTED's title, numbers and timer, the
pause button, corners and thumbs; SHARE gives the mocked share sheet a
JPEG, a refused share saves it, the respawn frees it); then
installability and an offline boot from the service worker. ~20 min
locally (software rendering); `--only desktop|852x393|852x340|pwa` runs one
profile. CI (`.github/workflows/ci.yml`) runs the four profiles as parallel
jobs, beside the unit tests, types and GLB contracts, on every branch and
pull request; Pages (`pages.yml`) runs the tests and contracts before deploying
main.

On hive1 the dev server runs as the user unit `curbside-dev` (enabled, starts on boot;
`systemctl --user status|restart|stop curbside-dev`). Open
`https://hive1.tail078432.ts.net:8443` (tailscale serve → :5173) or
`http://hive1:5173` from a device on the tailnet.

## Controls

| | Keyboard & mouse | Touch | Gamepad |
|---|---|---|---|
| Walk / run (on foot) | WASD / arrows, Shift sprints | left stick (appears under the thumb): push further to run | left stick, A sprints |
| Aim (on foot) | mouse (crosshair cursor) | right half: drag the aim stick | right stick |
| Punch / fire (hold for SMG) | left click, Space / J | FIRE button; push the aim stick past half-way; tap the right half | RT or X |
| Throw a grenade / molotov | aim with the mouse (it lands at the cursor), click | drag the aim stick (further = further, full push = full range) and let go; or FIRE | right stick, RT / X |
| Drive-by (pistol / SMG) | left click / J in a car | car FIRE button (inboard of the pedals) | X |
| A stolen service vehicle's tool: hose (fire truck, hold; aim with the mouse), chime (ice cream van), winch (tow truck) | left click / J (instead of the drive-by) | the car FIRE button becomes HOSE / CHIME / WINCH; drag it to aim the hose | X (right stick aims the hose) |
| Switch weapon (also in a car) | wheel, right click, Q / Tab (Shift+Tab back) | ⇄ | RB / LB |
| Enter / exit car | E / F / Enter | door button (pulses next to a car) | Y |
| Steer | A/D, ←/→ | **Point** (default): stick = where to go, push further = more gas; **Classic**: stick left/right | left stick |
| Gas / brake-reverse | W/S, ↑/↓ | pedal pad: GAS / BRAKE — slide between them without lifting | RT / LT |
| Handbrake (+ gas from a stop: burnout) | Space | HAND, or the DRIFT band (GAS + HAND with one thumb) | A |
| Nitro | Shift in a car | NOS (fills the button) | B |
| Pause | P / Esc | ❚❚ top centre (also automatic on app switch / portrait) | Start (B resumes) |
| Menus | arrows + Enter, Esc / Backspace back | tap | D-pad / left stick + A, B back |
| Next radio station | R | tap the "now playing" card (it shows as a chase comes in: tap it for the radio) | Select / View |

OBSERVE (on the title and in the pause menu, once the cold open has run or
with Test tools on) is a free camera over the city with no player: its
controls are under *UI → Observe mode*.

Settings (title or pause menu): master / effects / music volume, sound with
the iPhone silent switch on, graphics quality, touch steering
(point / classic), left-handed layout (mirrors the controls and the HUD),
perf overlay (Off / FPS / Full); under TESTING, Test tools (TEST in the
pause menu, below). In the
header, VERSION HISTORY: every release from `core/changelog.ts`, newest
first (the version also shows top right on the title screen and on the
pause card), and STORY · REPLAY OPENING: a fresh run straight into the
cold open (`SettingsPanel.addLink`; in a run it asks TAP AGAIN first,
since it throws the run away). Playtest labels over what the city's people and cars are
doing: `settings.debugLabels`, Shift+L (see *City life*).

**TEST menu** (Settings → Test tools; `game/testTools.ts` the actions,
`ui/testMenu.ts` the sheet, `ui/teleportMap.ts` the map): a TEST chip in
the pause card's corner (it costs the card no row) opens a tabbed sheet of
big buttons, keyboard / pad navigable, Back to the pause menu, ▶ to play.
Each button acts at once and says what it did (a strip on the sheet and the
HUD feed). PLAYER: god mode (hits land but take no health, the police never
cuff you, the heart turns gold; it moved here from Settings, same
`settings.godMode`), heal and full armour, every weapon full, wanted 0–5,
clear. CARS: spawn any of the 19 vehicles beside you (on the nearest lane;
GET IN puts you in it), repair the car you're in, flip / unstick (onto the
nearest clear lane). WORLD: dawn / noon / golden hour / dusk / midnight,
freeze the clock, rain on / off / auto (at once, not over the ramp), slow
motion 0.25× / 0.5× / 1× (it scales the sim's time like a hit-stop, people,
pigeons and combat effects with it; the camera and audio keep real time),
LABELS (`settings.debugLabels`). MAP: the whole city (the radar's
drawing); tap a spot to go to the nearest road or pavement there (with the
car: the nearer lane, facing its traffic, out of the junction), or SAFEHOUSE,
HOSPITAL, NEON MILE, DOCKS. SCENES: start any city scene near you now (the
scenes' `force()` / `begin()` / `soon()`; the fire blows up a car 11–24 m
off and calls the truck; the tow leaves a car for the truck; DOGS CHASE A
RUNNER sets a passer-by running past a dog or two; RAIN CROWD turns the
rain on; TURF WAR still waits for its holds). The starting is
`game/sceneStarter.ts` (`SceneStarter.start(id, x, z, heading)`), shared
with the title's highlights. SAVE: +1 CRED
level, max perks, reset CRED, +$10,000, unlock all jobs, jump to any story
job, grouped by arc and chapter (it becomes its arc's next job; you land
by its payphone, and the clock jumps to 21:00 for a Night Shift job by day), opening done /
reset (the next PLAY has the cold open), reset the save, export (share sheet, else clipboard) and import (a
pasted save, sanitised like a loaded one: `migrateSave`, `pruneSave`);
reset and import write the save and reload. Destructive ones take a second
press. Anything but LABELS and EXPORT is a cheat: `player.markCheated()`
taints the life like god mode (`Player.tainted`: CredKeeper pays no CRED,
no free-roam or Chaos Run best or medal), a TEST tag shows by the heart, and
respawning clears it (slow motion or god mode left on taint the next life
too). Turning Test tools off turns god mode and slow motion off. Pure and
tested: `game/testSpots.ts` (teleport snapping, spawn spots), `game/saveTools.ts`
(the save edits, export / import). Nothing drawn in normal play: the
spawned cars and scenes are the usual batches.

**Touch tuning** (for the device session): with the Perf overlay on (or
`?debug`), pause → DIAGNOSTICS → TOUCH TUNING has −/+ steppers for stick
radius, point-to-steer gain and deadzone, classic steer deadzone and expo,
drive / walk / aim deadzones, aim radius, pedal reach and pedal size, and
RESET (`core/touchTuning.ts`, `ui/tuningProbe.ts`). Changes apply at once
(resume and drive, pause and adjust) and are saved in `curbside.tune`;
every value is clamped to a range. Tuning applies only while the overlay is
on: turn it off and the shipped feel is back. The report's `TUNE` line and
`tune` JSON list the values that differ from the defaults, the numbers to
bake in as new constants.

**Perf log** (`ui/diagnostics.ts`, `core/sessionLog.ts`): every 10 s
(every 2 s for the first 30 s, the start-up) the session log samples frame times, tier, ratio and draw calls, and `n`: what
was on screen (`core/sceneCounts.ts`, filled by `render/sceneCensus.ts`
from counters the pools and batches already keep): live fire / smoke
particles, big ones (over 2.5 m) and their **fill** (quad area over the
visible ground, nearer the camera counting bigger: screens of overdraw),
glows drawn and their fill, fires (in view / burning), burning cars,
explosions in the last 10 s, rubble drawn / live, people and cars drawn /
shown, and the city scenes running by kind. Frames are also judged in 1 s
windows: one whose p95 is over 25 ms logs a **dip** with the same counts
and the window's JS p95 (`js`: high means the main thread was the
bottleneck, low the GPU or the browser; at most one per 5 s; the newest 60
kept in `dips`), so a drop names what was on screen. The frame that spans
an app switch (any `visibilitychange`) is kept out of the dips and the
frame stats. Each model file logs an `asset` event as it arrives, and
holds dynamic resolution off for 2 s (its uploads and first draws). The Full overlay shows the counts on two more lines
(`fx hot/soft big fill · glow n (fill) · fire seen/all burn boom`,
`ppl · cars · scenes`), the Diagnostics summary an `ON SCREEN` line and the
recent dips. Nothing is allocated per frame.

**Report bug** (`ui/bugReport.ts`): with test tools on
(`settings.testTools`), the Perf overlay on or `?debug`, a bug button sits
in the pause card's top corner (the Diagnostics sheet has a REPORT BUG tab
too). It captures the moment: the game view (one frame rendered through
`Look` and copied in the same task, 960 px wide JPEG; no
`preserveDrawingBuffer`), position, heading, vehicle, health, wanted level,
time of day, weather, tier and activity, the on-screen counts, the last
30 s of bus events (a preallocated 600-slot ring, `core/eventTrail.ts`,
rows `[secondsAgo, type, x, z, value, word, byPlayer]`) and the whole
Diagnostics report. Type a note, then SHARE: the JPEG and a JSON file go
to the share sheet (`navigator.share` with files; `.txt` if JSON is
refused). Cancelling is just noted; no share API or a refusal saves both
files instead; COPY copies the JSON. The smoke test runs the flow with the
share sheet mocked.

## Status

- **M0 Setup** — done, verified on a phone over Tailscale: Vite 8 + three 0.186 + TS + vite-plugin-pwa, Vitest.
- **M1 Drive a box** — done: fixed-timestep loop with render interpolation,
  arcade car physics (`src/entities/vehicle.ts`, pure + unit-tested),
  speed-zoom chase camera, keyboard/touch/gamepad input, placeholder road-grid
  world with non-colliding blocks, dynamic resolution, pause on background.
- **M3 Blender pipeline** — started: `blender/build_assets.py` runs generators headless;
  `characters.py` builds eight bodies (the player, three street bodies, the
  cop, Vex, Lil' Tuna, Deacon Pike: rigid parts on one 8-bone armature, 22
  clips each) → `public/assets/*.glb`, each drawn as one GPU-skinned batch
  (see *Look → People*).
  `vehicles.py` builds five parametric cars (sedan, compact, sports, van,
  police) → `public/assets/vehicles.glb`; the game tints the `paint` material
  per car and steers the `*_wheel_F*` nodes. Each archetype has its own
  handling (`VEHICLE_SPECS`). Road tiles and building kits still to do.
- **M4 On foot** — started: screen-relative walking/sprinting
  (`src/entities/pedestrian.ts`), enter/exit any nearby slow car, three parked
  cars to take. Punching and weapons still to do.
- **M2 City v1** — done: seeded 16×16-block city (`src/world/city.ts`) with
  lot subdivision, alleys, parks/trees, plazas and boundary walls; rendered as
  per-chunk instanced meshes with shader-painted windows; cars and the player
  collide with buildings, trees, walls and each other (`src/systems/physics.ts`).
- **M5 Living city** — v1 done: AI traffic (`src/systems/traffic.ts`) drives
  the right-hand lanes of the road grid (`src/world/roads.ts`), turns at
  intersections, brakes for cars/people ahead, with a gridlock breaker;
  sidewalk crowd (`src/systems/crowd.ts`) strolls blocks, crosses at
  crosswalks, dodges speeding cars, gets knocked down and runs.
  `src/game/population.ts` keeps ~16 cars / ~14 peds around the player.
  Carjacking: E next to an AI car throws the driver out.
  Car models are merged per material on load (~8 draw calls per car).
- **Damage** (`src/systems/damage.ts`, `src/render/effects.ts`): crashes
  cost health (bar under the speedo); smoking → burning → explosion →
  charred wreck; blasts damage/shove cars, set close ones alight and knock
  people down; NPC drivers bail out of burning cars; your own car throws
  you clear. Tuned in *Driving and combat* below.
- **Punching**: jab, jab, hook combos; the hook knocks down.
- **Chaos score** (`src/systems/score.ts`, `src/ui/scoreHud.ts`): drifts,
  near misses, smashes, hit-and-runs, knockouts, carjacks and explosions
  score points; anything within 3 s of the last event raises a ×2…×10
  combo. Best score is kept in localStorage (`curbside.best`).
- **Weapons** (`src/systems/weapons.ts`, `src/world/pickups.ts`): pistol,
  SMG, shotgun, grenades, molotovs, rockets, the air horn, the taser, the stinger and smoke grenades, plus health, armour and
  ammo crates on sidewalks (respawn 30 s); hitscan with lock-on and spread
  bloom, tracers, walls stop bullets, cars take damage; drive-bys.
- **Fighting back** (`src/systems/crowd.ts`): peds are calm (70%),
  fighters (20%) or armed (10%); provoke one and they punch or shoot back
  (shooters hit your car too). Player health; at 0 → WASTED, respawn, lose
  weapons, run score resets (best kept). A fresh run (PLAY, RESTART, quit
  to title) also starts empty-handed; package perks re-arm on `respawn`.
- Traffic 24 cars incl. new **taxi** and **pickup**; crowd 22, spawned
  just off-screen (never inside the camera's ground rectangle) and
  concentrated near the player; parked/abandoned cars are capped and
  everything is recycled, so the car list stays bounded. The five cars
  parked at the spawn corner are put back on every respawn.
- **Event bus** (`src/core/events.ts`): the simulation emits crash,
  explosion, shot, bulletHit, punch, pedDown, carjack, enter/exitVehicle,
  pickup, award, weaponSwitch, playerHurt/Died, respawn and pause events;
  presentation (HUD, effects, audio) subscribes. Player transitions live
  in `src/game/player.ts`.
- **Quality tiers** (`src/render/quality.ts`): high / medium / low, 'auto'
  picks medium on phones. Each tier has its own pixel-ratio cap, so
  `DynamicResolution` steps down e.g. medium@1.5x → low@1.25x → low@1x on
  a phone (never below 1x on high-DPI screens), keeps going past effects-only
  steps that don't help a fill-bound GPU, and treats a steady 30 Hz (Low
  Power Mode) as a cap, not overload.
- App updates wait for the fresh run after WASTED, the title screen
  going to the background, a return after 10+ minutes away, or "restart
  now" on the pause screen (never a plain app switch mid-run); a lost WebGL context pauses until it's restored (back
  on the pause menu, the city is redrawn and every program compiled behind
  it at once, not on RESUME), and offers RELOAD THE GAME (save flushed
  first) if no restore comes within 6 s.
  `?debug` in the URL shows fps / pixel ratio / draw calls.
- **Audio** (`src/audio/`): fully synthesised Web Audio, no sound files —
  engine with a gearbox, tyres, guns, impacts, explosions, fire, sirens,
  city ambience, stingers tuned to the music, and an adaptive procedural
  soundtrack on seven radio stations. See *Audio* below.
- **Look** (`src/render/look.ts` and friends): ACES tone mapping with a
  light grade, a sun shadow map fitted to the view every frame, a 12-minute
  day/night cycle (starts late afternoon → golden hour → night), analytic
  ground and building shaders (road markings, kerbs, paving, roofs by type,
  windows, shopfronts, five district palettes), rooftop props, street lamps
  that light the ground at night, neon, headlights, desktop bloom — with
  every person, car and glow batched into a handful of draw calls. See
  *Look* below.
- **Front door, controls and HUD** (`src/ui/`, see *UI* below): a title
  screen over a live attract mode (the city runs, the camera cruises after
  traffic and now and then cuts to a city scene: *Title highlights* under
  *UI*) with PLAY, a mode list other systems extend, settings, how to
  play, the best score and a small MORE AT DEEEK.ORG link to the hub (title
  only, never the pause menu). A fresh save's title is PLAY and SETTINGS
  only (*Prune for newcomers* under *Progression*); the first tap unlocks audio, shaders are warmed
  behind it; a one-time "Add to Home Screen" tip on iPhone Safari. Pause
  menu (resume, settings, how to play, restart, quit to title) that still
  offers waiting app updates and covers a lost GL context. A rotate-your-
  phone card in portrait that pauses, then 3-2-1 back in landscape. All
  menus work with touch, keyboard and gamepad.
- **Touch overhaul**: floating sticks with expo curves and rescaled
  deadzones whose origin follows a thumb past the rim, clamped to the safe
  area; continuous walk → run; *point-where-you-want-to-go* steering
  (`src/core/steering.ts`: heading error → steer, lift on sharp turns,
  three-point turns, backs off walls) with auto-gas; one pedal pad you can
  slide across, with a GAS+HAND drift band (~59 × 52 px, reaching into
  both pedals); twin-stick aim with auto-aim
  snapping within ~15°; inline-SVG icons; left-handed mirror; iOS gesture
  blocking; haptics (gamepad rumble, Android vibrate, the iOS 18 switch
  tick) driven by bus events. Mouse aim and gamepad right-stick aim on
  desktop; prompts follow the device in use.
- **HUD**: score with a punch on every award and a draining combo ring, a
  two-line feed that merges repeats; segmented health; an arc speedometer
  with the car's health inside it; weapon and ammo; a vmin-sized damage
  vignette; a WASTED screen with the life's stats and what it cost
(POINTS LOST on a bust, the HOSPITAL bill or CASH FINE) and a photo of
  the life's best stamped moment to share (*Best moment*, below). Circular north-up radar
  (the city pre-rendered once, traffic, pickups, hostiles, blips and a
  waypoint route, zooming out with speed, ≤30 Hz) and red edge chevrons for
  off-screen attackers.
- **Juice** (`src/render/fx*.ts`, see *Effects and camera* below): every
  crash, shot, knockout and explosion has particles, light, sound and a
  camera response. Skid marks and tyre smoke (the player's drift smoke
  warms to gold, then pink, as the points pile up), sparks and scrapes,
  glass and panels flying, thick tracers and muzzle flares (NPCs too),
  shell casings, a blast sequence with flash, shockwave ring, fireball,
  smoke column, debris and a scorch; cars lean, dip, squash and hop;
  trauma shake, kicks, FOV punches and a brief hit-stop on big moments; a
  per-axis look-ahead that shows ~1.5 s of road; screen-edge flashes at ×5
  and ×10; rain showers that wet the streets.
- **M6 Heat** (`src/systems/wanted.ts`, `police.ts`, `pursuit.ts`,
  `arrest.ts`, `src/game/heat.ts`; see *Heat* below): a 0–5 star wanted
  level from witnessed crimes; police units that spawn off-screen ahead,
  chase, ram, PIT and box you in, get out and arrest you or shoot;
  roadblocks, SWAT vans and a searchlight helicopter; BUSTED (fine,
  weapons gone, released at the police station); Pay 'n' Spray bays;
  traffic that panics, rages, honks and pulls over for sirens.
- **M7 Progression** (`src/game/progress*.ts`, `src/game/modes/`,
  `src/systems/missions*.ts`; see *Progression* below): a versioned save
  with cash, lifetime stats, bests and medals; chains bank into cash (lose
  the chain if WASTED or BUSTED, plus a hospital bill or fine); a CHAOS RUN
  2:00 mode with medals and a results card; frenzies, hidden packages,
  checkpoint races, hot-car exports, taxi fares, fire and tow duty in a
  stolen service vehicle (V2-09) and payphone missions (the
  main story, KEEP IT LOUD, and the thirteen-job Night Shift side story)
  in free roam; a safehouse shop; PROGRESS in the pause menu.
- **Feel** (`src/entities/vehicle.ts`, `src/game/combat.ts`,
  `src/systems/projectiles.ts`, `src/world/ramps.ts`, see *Driving and
  combat* below): exact top speeds, a cornering limit, drifts, burnouts,
  glancing walls, nitro; rebalanced damage and body armour; ped hit
  points, knockouts, punch combos, lock-on; grenades, molotovs, rockets;
  drive-bys; optional character clips; stunt ramps with STUNT awards.
- **World and vehicle models** (`src/render/propModels.ts`, `propBatch.ts`,
  `worldProps.ts`, `heliModel.ts`; `src/world/streetProps.ts`,
  `landmarkProps.ts`, `dressing.ts`, `signals.ts`, `roadworks.ts`,
  `streetStops.ts`, `frontages.ts`; see *World* below):
  props.glb, pickups.glb, debris.glb and heli.glb replace the box
  stand-ins — street lamps, traffic lights that traffic obeys, street
  furniture you can knock flying (parking meters, planters, bike racks,
  recycling bins, café tables, vending machines and ATMs too), road-works
  sites traffic drives past, bus shelters and food carts with spots for
  queues, rooftop kit, trees by district, booths,
  the station, race gantries, the export bay, the safehouse door, pickups,
  frenzy tokens, ramps and kickers, car-part debris in the car's paint and a
  modelled police helicopter — in seven instanced families. Twelve more
  vehicles (muscle car, limo, police SUV, SWAT truck, ambulance, fire
  truck, garbage truck, tow truck, ice cream van, bus, scooter, police
  bike) with their own handling, health and collision bodies; emergency
  calls with right of way; two-wheelers that lean, carry a rider and
  throw them off in a hard crash.
- **City life** (`src/game/cityLife.ts`, `src/game/scenes/`; see *City
  life* below): the knocked out stay down for an ambulance to the
  hospital, parked cars at the kerbs and in the car parks, guns dropped by
  the armed; a scheduler and two primitives (service vehicle call-outs,
  queues and crowds) for the ambient scenes to come.
- **M8 Ship** — live on GitHub Pages at deeek.org/curbside/ (served from a
  sub-path: `CURBSIDE_BASE`, `publicUrl()`). Next: a real-device
  performance pass and the to-do list in `docs/HANDOFF.md`.

## Driving and combat

Numbers come from scratch sims of the real `stepVehicle` /
`collideVehicleStatic` (and the tests pin them).

**Driving** (`entities/vehicle.ts`, pure). Each car reaches exactly its
`maxSpeed` flat out (the engine's taper is solved against drag 0.04):
sedan 33 m/s, compact 30, sports 42, van 27, taxi 32, pickup 31, police 34
(0–100 km/h: sports 2.3 s, police 3.4, sedan 4.3). Grip turns a car only
as fast as its lateral limit (`latAccel`, 16 van … 26 sports, yaw ≤ a/v):
a right angle flat out at 28 m/s runs 36 m on and scrubs speed, so brake
or drift; town speeds don't notice. The handbrake kicks the rear loose
(`slide` = 1): on the throttle the drift holds (sedan ~28°, sports ~37°,
van ~17°), countersteer straightens it, lifting off grips it up in a
fraction of a second, and part of the scrubbed sideways speed goes into
forward speed so drifts keep their pace. Handbrake + throttle from a stop
is a burnout (smoke, donuts with the wheel) that charges in 0.9 s and
launches the car ~40% quicker to 20 m/s. Per archetype: steering response
15 sports … 6 van (twitchy vs heavy), mass 0.85 compact … 1.6 van (who
shoves whom). Nitro (`game/nitro.ts`): ×1.7 power and ×1.25 top speed for
3.2 s a tank; the tank fills by drifting (0.14/s), near misses (+0.15)
and stunts (+0.3). Directional touch steering brakes into corners it
can't take on grip (16 m/s for a right angle, more for gentle bends).

**Walls and crashes** (`systems/physics.ts`, `systems/damage.ts`). A wall
stops only the speed into it; the speed along it is scrubbed by up to 45%
with the square of the hit, and a nose-in glance swings the car parallel:
at 25 m/s a 5° glance keeps its pace, 15° keeps ~20 m/s, head-on stops.
Crashes cost nothing below 6 m/s, then 2.6 HP per m/s: a traffic sedan
(100 HP) smokes after one 28 m/s head-on and burns after a third 20 m/s
hit. In a car-on-car crash the rammer takes 30% of what the car it hits
takes (65% each head-on), scaled by mass. The player's own car takes
`PLAYER_CRASH_SHARE` (60%) of crash damage, since smashing is what scores:
a 21 m/s wall hit costs a sports car 26% instead of 43%, ramming a parked
car at 28 m/s ~10 HP (6 such rams and a sedan still isn't on fire), two
28 m/s head-ons into buildings leave it smoking. The Chaos Run's sports car
has ×1.5 health (135). Health: sedan 100, compact and sports 90,
van 140, police 130, taxi 100, pickup 125; fire at 20%, burning 4.5 s.
Blasts (`BLASTS`): a car going up does 85 at the centre to 0 at 9 m and
sets cars within 4.8 m (of their nearest part) alight on a 0.5–1.9 s fuse
instead, so a jam goes up in a rippling chain (your own car gets 3–4 s to
bail out); grenades 105 / 8 m, rockets 160 / 10 m. Landing a jump
costs 3 HP per m/s of vertical speed over 10. NPC bullets do 8 to the
player (6 beyond 14 m) and 45% of that to cars, so 4★ chases are
survivable, and spread 60% wider at a running target.

**The player** (`game/player.ts`): body armour (0–100) soaks every hit
first and is lost on death; health creeps back to 40 at 4/s after 6 s
unhurt. Crates: health +50, armour +50, ammo (half a clip for each gun
owned, 3 blasts for an air horn, 2 taser cartridges), weapons (capped: pistol 120, SMG 300,
shotgun 48, grenades 12, molotovs 10, rockets 8, air horn 12, taser 8, stinger 4,
smoke grenades 6).

**On foot** (`game/combat.ts`, `systems/crowd.ts`, `systems/weapons.ts`).
Everyone, officers included, has 100 HP: pistol 34 (3 hits), SMG 15 (~7),
shotgun 7 × 16 (one blast up close, thinner at range). A hit staggers for
0.3 s (no walking, no attacking, the next attack pushed back); 0 HP is a
knockout: down 8 s, then they run with no grudge (a passer-by
knocked out near you stays down for the ambulance instead: *City life*;
anyone armed drops their gun). Only a knockout scores
KNOCKOUT. Punches chain jab (22), jab (22), hook (40, knocks down) within
0.75 s. Firing locks on: hostiles (fighters, shooters, police while
wanted) at any angle first, else the best target in a 90° cone; with a
deliberate aim only within ~20° of it; it lets go 0.6 s after the last
shot, and you strafe while locked (a red ring marks the target). Spread
blooms per shot (pistol +0.04, SMG +0.03 rad) and settles in about a
second; running widens it. Grenades land where you aim (the cursor, the
stick's reach, or a target near the aim line; unaimed, a lob of half the
range or onto someone in front within it), bounce and go off after
2 s; molotovs burst into a 3.2 m fire for 6 s that sets people running
alight (22 HP/s) and cooks cars (12 HP/s); rockets fly at 26 m/s, arm
after 3 m and blow up on the first thing they touch (75 m max); their
lock-on and aim assist ignore anything within 8 m (inside their own blast). While a
grenade or molotov is in hand, a landing ring and a dotted arc show
where it will land, 1 m short of any wall on the way (`clampThrowToWalls`:
it would bounce back off it; the ring turns red when a wall cuts it short,
and a throw a wall would drop within 3 m of your own feet doesn't go) (a touch tap on FIRE throws right there). On touch
the aim stick only aims a throwable (it never auto-fires one): let go to
throw where the ring is, or slide back to the centre first to cancel.

**Drive-bys**: in a car, FIRE shoots a pistol or SMG (picking one if
something else is held) out of whichever side window has the best target
within 1.2 rad of square (hostiles first), with ×1.5 spread; an aim
(mouse, right stick) picks the window. Never hits your own car; heat
applies like any gunfire.

**The air horn** (W3-B, `systems/airHorn.ts`, `Combat.blowHorn`): held,
aimed and fired like a pistol (on foot only, no lock-on); a crate is a
canister of 6 blasts (12 at most; an ammo crate adds 3), one every 1.1 s.
A blast is a cone 14 m long and ±0.5 rad (~29°) wide, the hose's maths
(`serviceTools.coneHit`, its jet ±0.23 rad), and a wall between stops it
for whoever's behind (`hornClear`, the hose's `clipJet` per target). No
damage and no knock-downs: within 2.5 m people reel (a 0.45 s stagger,
pushed back) and cover their ears; within 8 m they cover their ears for
0.7 s (the cower pose) and then run; further off they scatter for 4 s.
The police, anyone fighting, the fallen and the burning don't budge.
Drivers in the cone (not the police, not one in a rage) stamp on the brake
for 0.8–2 s (40% jerk the wheel ±0.6 as they do), sit stalled, then honk
back (`traffic.startleDriver`). Parked cars in the cone go off
(`scenes/alarms.ts`; the first blast that sets one off in 40–70 s is a
chain of the player's: blast, alarm, DOMINO ×2; `LOUD`: not while wanted),
pigeons and stray dogs scatter, and a scanner line goes out (NOISE
COMPLAINT IN …, 90 s cooldown). Heat: a public-order nuisance, +0.1 a
witnessed blast, at most +0.2 per 5 s, so a whole canister never makes a
star. The sound is a synthesised three-reed chord (`sfx.airHorn`); the look
is three pale shock rings down the cone from Effects' pooled fake lights
(no draw call of its own). Pickups: a pink-ringed crate (the ammo box
model until `pickups.glb` has a `crate_horn`); in the hand, nothing shows
until `weapons.glb` has an `air_horn` root.

**The taser** (W3-B, `systems/taser.ts`, `Combat.tase`): held, aimed and
locked on like a pistol (on foot only; with it in hand the lock-on flags a
fleeing suspect, a mugger or a chase's runner, as hostile, so it picks
them out first); a crate is 4 cartridges (8 at most; an ammo crate adds 2),
one shot every 1.4 s. Each shot is a pair of darts 8 m along the lock or
the aim that stops at the first person (0.55 m either side of the line),
car or wall: whoever it reaches is stunned, knocked down where they stand
(a 0.8 m/s slide) for 4 s with no hit points lost (so never a KNOCKOUT),
then up: ordinary people provoked (fighters come at you, the calm run),
officers back on the job. People within 7 m step back for 3 s; it's no
gunshot, so nobody else panics and no `shot` goes out. It's reported as a
`taser` event (hit or miss, where the darts stopped) and then an ordinary
`pedDown` (cause `taser`), so it means what any floor means: a civilian is
an assault (+0.3, witnesses phone it in), an officer is still a crime
(`copDown`, +1, and an attack on a city chase's police: the handoff
rules), and a fleeing suspect is a have-a-go, not an assault. A mugger
drops the bag (hand it back: HAVE-A-GO HERO, $50); a chase's suspect on foot
pays HAVE-A-GO HERO and **gives up to you**, armed or not: they kneel once
they're up (a shoot-out with the officers is over), and when the officers
cuff them within 30 s it's your **CITIZEN'S ARREST** too ($150,
`chaseHandoff.tasedArrest`). The look is two thin wires from the taser in
hand to the darts, shooting out in 0.06 s and crackling blue-white for
0.8 s (0.25 s on a miss): streaks in the hot particle batch like tracers
(`Effects.wire`, at most 4 at once), with sparks and a cold flicker on the
ground from Effects' pooled fake lights, so no draw call and no real
light. The sound is the cartridge's pop, then ~0.8 s of the current's dry
ticking over a thin buzz (`sfx.taser`, one gated noise source). Pickups:
an electric-blue-ringed crate (the ammo box until `pickups.glb` has a
`crate_taser`); in the hand, nothing shows until `weapons.glb` has a
`taser` root.

**The stinger** (W3-B, `systems/stinger.ts`, `Combat.throwIt` /
`dropStinger`): a folding spike strip, thrown like a grenade on foot (16 m
at most, the landing ring as usual) or, the one throwable that goes out of
a car, dropped 1.2 m behind the back bumper. A crate is 2 (4 at most). On a
straight road it squares itself across one carriageway (`ROAD_WIDTH / 2`,
more if it lands over the middle) and stays on the tarmac; in a junction or
off the road it lies square to the throw or the drive. At most 3 are down
(the oldest is pulled up), each for 40 s or 6 cars. Any car whose wheels
cross it on the ground (one in the air over it is spared) gets its tyres
burst (`tyresBurst`): a slew (a yaw kick up to 1.4 rad/s and the rear let
loose, full from 20 m/s), then life on the rims, kept on `DamageState`
until a respray or another car (`FLAT_*` in `entities/vehicle.ts`: half the
top speed, less grip and brakes, a pull to one side). Traffic brakes hard
and sits 1.5–3 s, then limps on; police in a chase limp on and fall
behind, so it shakes a chase without a shot. A police car's tyres on your
strip pay **SPIKED** (300) and a scanner line (UNIT DOWN TO ITS RIMS IN …,
60 s cooldown). Heat: a civilian's tyres are a nuisance, a patrol car's an
attack on the police, and nothing once you're already wanted (it mustn't
restart the clock it's there to beat); your own car's tyres are free. The
look is the one flat prop, built in code (`render/stingerLook.ts`: a black
hinged strip, yellow hinge blocks, two rows of spikes, drawn above life
size across like guns in hand), one instanced mesh that draws only while a
strip is down or flying; it unrolls from the middle in 0.3 s, tumbles
folded in flight, glints in headlights, and in hand a ghost shows where it
would lie. Flats scrape rim streaks and sparks (`fxDriving`). The sound is
the sections slapping out (`sfx`, ~0.45 s) and the burst's double bang,
hiss and flapping rubber that slows with the car (~1.3 s). Pickups: a
steel-ringed crate (the ammo box until `pickups.glb` has a
`crate_stinger`); in the hand, nothing shows until `weapons.glb` has a
`stinger` root.

**The smoke grenade** (W3-B, `systems/smoke.ts`, `Combat.pourSmoke` /
`stepSmoke`): thrown like a grenade (20 m at most, the grenade's arc and
bounce); a crate is 2 (6 at most). It hisses into life 1.2 s after the
throw and pours a cloud that billows from 2.5 m to 6.5 m across in 1.5 s
(a road and a pavement either side), thick for 9 s, then thins away over
2.5 s, which is only the look: a thinning cloud does nothing. At most 2
clouds at once (another throw replaces the oldest). **Sight**
(`systems/sight.ts` `sees`, `SmokeView.blocks`): nobody sees into, out of
or through a thick cloud beyond arm's length (2.5 m), so a police car or
officer inside one or looking through it loses you and drops into search,
and the helicopter's spotlight finds nothing but smoke while you're in
one. **Police cars** that drive into it are confused (`Daze`, one per
unit in `systems/police.ts`): a third each crawl to a stop, stop dead with
their hazards blinking, or take a wrong turn at the next junction
(`wrongWay`, at most 9 m/s, forgotten after 12 s), so a chase visibly
scatters; a crawl or a stop ends 0.6 s after they're out of it, a wrong
turn is taken whatever the cloud does. **Officers on foot** (and anyone
fighting or shooting) stop and cough, no running, no shots; **people**
cough and walk out of it; **traffic** brakes hard and sits there until
it's clear (rear-end shunts welcome). The player's cloud puts a scanner
line out (SMOKE ON THE STREET IN …, 60 s cooldown); it's no crime. The
look (`render/smokeLook.ts`) is billows from Effects' soft smoke pool in
the low-resolution pass like every other smoke, scaled by the tier's
`particleScale` (about 17 live per cloud on low, 26 on medium, 34 on
high, under the low tier's `smokeMax`), so it adds no draw call while
anything else smokes and one otherwise; emission stops 1.2 s before the
cloud stops being thick, so it thins as its effect ends. The budget check
is `tools/tune/mayhem.mjs --scenario smoke --seconds 12` (two clouds on
the player on foot). The sound is the cap's pop and ~3 s of gas hiss over
a low rush (`sfx.smokePop`), and coughs (`sfx.cough`, deeper for an
officer, one at a time). Pickups: a pale-grey-ringed crate (the grenade
crate until `pickups.glb` has a `crate_smoke`); in the hand, nothing shows
until `weapons.glb` has a `smoke_grenade` root.

**Stunts** (`world/ramps.ts`, `systems/stunts.ts`). Ten stunt ramps
(6 × 3.2 m, 1.6 m lip, matching the `ramp` model in props.glb) on road
centrelines just past a junction (one a block east of the spawn corner),
and eight smaller kickers (2.5 × 2.2 m, 0.6 m lip, the `kicker` model)
at least 120 m from any ramp; traffic in their lanes never touches them.
A car lined up on the front climbs the slope and flies off the lip with
vy = 0.36 × speed off a ramp, 0.24 × off a kicker (a drop at a crawl):
~1 s and ~28 m at 28 m/s off a ramp.
A ramp's sides and back are solid to cars and people alike.
Airborne: gravity 22, no grip or steering, cars pass over people and
other cars, the body pitches with the arc, the contact shadow stays on
the road. STUNT = 1000/s of airtime + 20/m + 500 per half-turn of spin
(GREAT ≥ 2000, INSANE ≥ 3500, 180/360 prefixes); jumps over 0.9 s get a
beat of slow motion near the top.

**Character clips** (`render/characterModel.ts`, `characterAnim.ts`):
every gameplay state plays its Blender clip, found by name (each missing
one falls back to a procedural fake): Idle/Walk/Run by speed; the aim per
weapon (pistol `Aim`, SMG/shotgun `AimBoth`, launcher `AimRocket`; a gun is
lowered while sprinting unaimed) with its `Shoot*` kick per shot; the jab,
left hook and uppercut of the combo (`Punch`, `Punch2`, `Uppercut`);
`Throw` for grenades and molotovs; `Stagger` on a hit; knocked down
`Fall` → `Down` → `GetUp`, the get-up timed to end as they're allowed up
(`GetUpFast` after a short knock-down);
`Arrested` when BUSTED; `EnterCar` at the driver's door before the body
vanishes; `Hail`, `Cower`, `Cheer`, `Ride`. See *Look → People*.

**Budget**: ramps +1 draw call (+1 in the shadow pass) when in view,
projectiles +1 only while something flies; rings, arcs, fire glows and
shadows go into the shared glow and shadow meshes. Measured with
`?debug`: 43–56 calls on the iPhone profile in fights, chases, jumps and
night rain, 55–69 on desktop (a 5-star chase with grenade spam). Combat
allocates nothing per bullet. The sim's per-step hot paths avoid garbage
too (sidewalk corners into a reused point, `len2` (`core/len.ts`) in place
of `Math.hypot`, which V8 doesn't inline and allocates for, cheap rejects
before the per-car / per-crate work, static contacts into reused objects,
indexed loops in `simulate`, last-step state copied field by field). In
headless Chromium (V8) on 2026-10-31 a sim step allocated ~12 KB (from
~55) and posing the crowd ~1.1 KB a frame (from ~3.5); what remains is
mostly V8 number boxing, which JSC on the iPhone doesn't do (it NaN-boxes
doubles).

**Simulation level of detail** (`systems/simLod.ts`, pure, tested). The
street's ambient agents think every step only where the player could see or
reach them: on screen (the visible ground plus 10 m, wider than the draw
cull) or within 25 m. Off screen within 80 m they tick at 15 Hz, further at
5 Hz, each on its own round-robin bucket (a clock per agent, `newSimClock`)
so the work spreads evenly over the steps, and a tick integrates all the
time owed since the last one, so they cover the same ground; back at the
full rate the debt is paid at once, 10 m before anyone can see it.
`SimLod.begin(x, z, view)` once a step, `tier(x, z)`, `due(clock, tier, dt,
pinned)` → the dt to integrate (0: skip this step), `settle(clock)` to
think now between ticks.

- **Traffic** (`main.ts driveCar`): a calm driver off screen runs `driveAi`
  (the obstacle scans) on its tick and `holdAi` between, which keeps the last
  decision but still steers for the lane every step and brakes within the
  room it had (the stop line, the car ahead), so it stops where it would
  have; reaching a waypoint makes it think at once. Within 25 m of a
  junction, or crossing one, a far driver thinks at 15 Hz, not 5
  (`nearJunction`: lights and cross traffic). Physics, ramps and every
  collision stay every step for every vehicle.
- **Walkers** (`stepCrowdPed` with the owed dt): street people and a scene's
  people; their car and wall collisions, and the pavement's side-steps
  (`scenes/pavement.ts`), run on their ticks too. Posing already skips
  whoever is off screen (`PeoplePose`).
- **Stray dogs** (`scenes/strayDogs.ts`, `DogPack.stepDog`): the runners and
  cars are gathered only on a step some dog ticks.
- **Always every step**: the player's car, police units and officers, road
  ragers and panicking drivers (`fullRateDriver`: mood, `urgent`, pulling over
  for a siren, held up by the player), any car a scene is driving (chases,
  races, call-outs, the bus), anyone fighting, shooting, reeling or on fire,
  people other systems own (gangs, story characters, fares: `fullRatePed`), a
  dog on a chase, and anything within 25 m. The scene director, heat, combat
  and pigeons (per frame, ~0.02 ms) are left as they were.

The schedule is deterministic (a step counter and the order agents were
made in), so seeded harness runs still repeat, though not with the old
numbers (agents now draw on the shared random stream in another order).
`__ub.simLod.enabled = false` runs everything every step, for A/B checks;
`__ub.simProfile` (`core/sectionTimes.ts`) times the sim by system:
`start()`, then `summary()` (mean, p95, max JS ms per frame) or `last(i)`.
Measured 2026-11-01 on the iPhone profile (852×393, 'medium') in headless
Chromium, rendering stubbed, scenes forced (`fight`, `iceCream`,
`chaseCar`, `race`, `ambulance`, `dogs` and ten more), LOD on and off in
alternate blocks of 150 frames (so both sample the same city), median of
three runs, JS ms per frame, mean (top 1% of frames dropped) / p95, and the
whole sim step's median:

| | downtown, day | Neon Mile, 23:00 | Neon Mile, 3★ |
|---|---|---|---|
| traffic AI | 0.110 / 0.21 → 0.090 / 0.18 | 0.134 / 0.18 → 0.099 / 0.16 | 0.138 / 0.25 → 0.099 / 0.16 |
| crowd step | 0.062 / 0.12 → 0.037 / 0.08 | 0.070 / 0.12 → 0.040 / 0.08 | 0.096 / 0.14 → 0.051 / 0.10 |
| crowd collisions | 0.060 / 0.12 → 0.028 / 0.06 | 0.074 / 0.14 → 0.030 / 0.06 | 0.091 / 0.14 → 0.044 / 0.09 |
| whole sim step (p50) | 0.515 → 0.445 | 0.470 → 0.395 | 0.575 → 0.450 |

Off screen about three quarters of the crowd and over half the moving
traffic tick slow. Vehicle physics, collisions, posing, scenes, heat and
pigeons are unchanged within noise. Behaviour, LOD off / on: nothing on
screen moved more than a stride a frame either way (45 s chasing round at
up to 32 m/s, and the title's cruise); ambient traffic over 16 seeds ×
300 s: 482 / 484 AI crashes (71 / 68 more than 80 m off), 114 / 132
people knocked down, mean speed 5.14 / 5.27 m/s, stopped 40% / 39% of the
time; scenes forced every 40 s for 240 s (six seeds): ice creams served
122 / 135, chases ended by arrests and take-downs as before; the people a
bus stop, a busker and the carts gathered while 70 m off screen stand on
the same spots either way.

API for other systems:

```ts
player.armour / player.addArmour(n)        // 0..MAX_ARMOUR (100); returns what was taken (a shop can sell it)
combat.collect(kind)                        // apply a pickup (false = can't use it now)
combat.blast('grenade' | 'rocket' | 'car', x, z, byPlayer)   // an explosion through the normal blast path
combat.projectiles.throw('grenade' | 'molotov', x, z, toX, toZ, byPlayer) / .fireRocket(x, z, dx, dz, byPlayer)
combat.projectiles.addFire(x, z, byPlayer)  // a fire patch
combat.lock / combat.marker                 // the lock-on target, the throw marker (.blocked: a wall cut it short)
nitro.charge / nitro.add(amount)            // 0..1 tank
hurtPed(agent, damage, fromX, fromZ, knock?) // systems/crowd.ts: 'none' | 'hit' | 'down' | 'ko'
ramps (world/ramps.ts: placeRamps, rampAt, rideRamps) · StuntTracker (systems/stunts.ts)
// Bus: { type: 'jump', x, z, speed, airtime, involvesPlayer } · { type: 'land', x, z, impact, involvesPlayer }
//      { type: 'stunt', x, z, airtime, distance, spin, points, label } · { type: 'boost', on, x, z }
//      { type: 'throw', x, z, toX, toZ, weapon, byPlayer } · { type: 'ignite', x, z, radius, byPlayer }
//      explosion.source ('vehicle' | 'grenade' | 'rocket'), shot.driveBy, punch.combo, pedDown.ko / cause 'fire',
//      playerHurt.armour / .absorbed.
```

## Heat

Mayhem has a cost now. **Wanted level** (`systems/wanted.ts`, pure): heat
0–5, stars = floor(heat). A crime counts if it's on screen or within 60 m
of any police (car, officer, helicopter): knocking someone down +0.3
(with your own car: `stepCrowdPed` reports the car that hit them, so a
unit running down its officer beside you isn't on you),
carjack +0.35, a shot +0.05 (at most +0.5 per 5 s), an air horn blast
+0.1 (a nuisance: at most +0.2 per 5 s), tasing someone as knocking them
down (an officer +1), a civilian's tyres on your stinger as a nuisance
(a patrol car's as shooting at the police; nothing while you're wanted),
an explosion you
caused +0.6 (not your own car going up, even after you bail out of it
burning: `explosion.ownCar`), clearly ramming a police car
+0.6 (bumps in a chase don't count, nor does smashing through a roadblock
or a chasing cop driving into you), bullets into one +0.15 (capped),
knocking down an officer +1 (at most +1 per 5 s), wrecking a police car
+1; stealing one sets at least 1★, and taking a police chase's getaway
at least 2★ (`tookGetaway`; both in `CRIME_FLOOR`: they count unseen).
Flooring a fleeing suspect (a chase's, a mugger: `pedDown.suspect`) isn't
an assault. Knocking a civilian down and carjacking
seen only by passers-by (no police near) wait for one of them to phone it
in, 3–5 s, and can be stopped (City life, *Witnesses*). Civilian crimes stop at 3★; 4–5★ need
attacks on the police. Below a star, heat fades after 10 quiet seconds.
A new star (or a witnessed crime) is called in: for 8 s dispatch tracks
you while units respond, and the evasion clock waits. **Evasion:** once no
cop has seen you for 1.5 s the stars blink; after 6 s + 3 s per star out
of sight one star drops, and the clock restarts on the next (3★ ≈ 36 s
unseen). Sightings and witnessed crimes reset it; the radio keeps units on
your real position for 2 s after each sighting.

**Response** (`systems/police.ts`): units by stars 2 / 3 / 4 / 6 / 7 (at
1–2★ half of them may be a police bike, one officer, never more than one
on the road; from 3★ half the cars are police SUVs; SWAT trucks from 4★,
220 HP), arriving one at a time on a lane 75–140 m
away from where the police believe you are (your real position only
while they're seeing or tracking you, so breaking line of sight works),
out of view, heading your way and already rolling (mostly ahead on a
fresh call, from all round mid-chase, so outrunning them can work). Sight:
each car sees you within 20 m, or 62 m with a clear line past buildings
(officers 15 / 40 m), checked 4×/s per unit (one ray per car) and shared
over the radio. Units 210 m from the last sighting out of view, or wedged
for good, recycle and a fresh one comes. 1–2★ follow and box you in; from 3★ they ram and PIT, and every
25 s at speed a roadblock (2–3 cars across the road 120–170 m ahead,
mid-block, officers behind them) goes up; from 4★ passengers shoot at your
car (every ~2 s within 20 m); 5★ adds the helicopter
(`systems/helicopter.ts`): a shadow and a searchlight that keeps you seen
while it's on you, flying at 27 m/s so a fast car can outrun it, and
leaving to refuel for 30 s after every 45 s on station (longer than the
21 s unseen that drops a star at 5★). Stopped near you, officers get out (crowd peds
with role 'cop', navy uniforms through the outfit palette): they run you
down at 5 m/s (you sprint at 6), go for your door if your car is stopped,
and shoot from 2★ at someone armed or running (from 3★ on sight), but
never at someone standing still with empty hands: they come to cuff
them, so giving up is always a way out alive. When the heat drops, spare
units collect their officers (waiting at most 12 s for them) and go back
to patrolling as traffic. A unit whose car is wrecked, on fire or stolen
fights on on foot. Police cars are lent by Population (`takeVehicle`,
flagged `police`, so traffic upkeep leaves them alone).

**Pursuit driving** (`systems/pursuit.ts`, pure): without its own clear
view, or over 70 m away, follow the lanes junction to junction toward
where you are (or were last seen) — driveAi in a hurry: half the gap,
12 m/s corners, overtaking through the oncoming lane, the turn at each
junction chosen toward the goal, and traffic's unstick logic; in view,
steer for an intercept point (lead = gap ÷ closing speed, ≤ 1.2 s),
swerving round cars, settling 10 m behind; from behind or alongside only
(never head-on: an oncoming pursuer slows, passes and turns), ram at 5 m/s
over your speed every 2.6 s and PIT the rear quarter; box in a stopped car
(near end, far end, sides). Backs out of walls like traffic.

**Busted** (`systems/arrest.ts`): on foot, an officer within 1.3 m for 1 s
while you're slower than 2.8 m/s (0.5 s if you're knocked down); in a car,
under 1 m/s for 2 s with a police car touching or an officer at your door.
A meter under the stars shows the grip; it waits while a 3-2-1 holds the
car (`HeatDeps.held`). Busted: 25% of the run score
fined (`HeatDeps.bustFine`; none in a Chaos Run, where being cut short is
the cost, so its results add up), weapons taken, held 3.5 s (BUSTED
screen, blue: points lost and the cash fine), then released on
the steps of the police station (blue marker, ★ on the radar). Dying also
clears the heat.

**Pay 'n' Spray** (`world/landmarks.ts`): four bays on open lots, one per
quarter of the city (glowing gates, 'S' on the radar; the nearest pulses
and points the way while you're wanted). Stop inside for 2 s: new paint,
fully repaired, and the heat is gone, unless the police saw you drive in.
It costs `SPRAY_COST` ($400, $100 with the shop's spray card), charged
through `HeatDeps.pay`: broke means no respray.

**Traffic reacts** (`systems/traffic.ts`): hit a driver hard and 55% panic
(twice cruise speed, half the gap, honking, through corners) for 10 s,
25% road-rage after you with the pursuit controller for 12 s (no arrests),
20% stop and bail out. Drivers held up by you honk after 1.5 s, panic near
gunfire, and pull over to the kerb and slow for a siren behind them (or
coming head-on).

**Score:** COP RAM 200, COP CAR WRECKED 750, EVADED 1,000 × peak stars
for losing a 3★+ chase; joining a city police chase (City life, *Traffic
scenes*): TAKE THE HEAT 500, CITIZEN'S ARREST 400, HAVE-A-GO HERO 250.
Officers never fire on a player with no stars (`holdsFire`, checked in
main.ts's crowd step: a scene's officer whose own fight is over would
otherwise fall back on the player). **Audio:** a star gained plays the star sting, a
chase lost or resprayed the success chime, BUSTED its own sting (cuffs,
cell door) with the world muffled; the wanted level is the music's
intensity floor; sirens wail, yelp when ramming, two-tone when boxing in
(the nearest five); the helicopter has a rotor loop (`audio.rotor(x, z)`);
honks are `horn` events. **HUD** (`ui/wantedHud.ts`, `wanted.css`): five
stars under the pause button that flash in with a "WANTED / HOT PURSUIT /
ROADBLOCKS / SWAT / CHOPPER" pop, blink while you're out of sight, fade
with "EVADED"; arrest and respray meters. The police scanner calls each
star with your car's colour and the district (City life, *Police
scanner*). Radar: flashing police cars,
officers, the helicopter. All the faked light (searchlight, bays, station)
goes through the shared glow batch (`render/heatLook.ts`): no extra draw
calls beyond one instanced police-car mesh.

**Tuning** was done headless: a copy of the sim loop drives a getaway car
against each level over many seeds (`__ub.fastForward(seconds)` does the
same in the browser). Over 3 minutes, a sports car whose driver turns
away from the police at each junction shakes a 3★ chase about half the
time (and drops at least a star in all but 1 in 8), and gets 5★ down to
4★ or 3★ about 3 times in 4; a reckless driver taking random turns
escapes far less often (drops a star at 3★ about 1 time in 2). Resprays
and wrecking pursuers are the other ways out. Most damage in a chase
comes from the player's own crashes.

API for other systems:

```ts
heat.wanted.level / .heat / .searching    // read the stars
heat.wanted.commit(crime, witnessed)      // report a crime ('assault', 'carjack', 'gunfire', ...)
heat.wanted.force(stars)                  // scripted chases, missions
heat.wanted.clear(reason)                 // e.g. a mission's reward
heat.called(crime)                        // a witness's call got through (HeatDeps.witnesses held it: City life, Witnesses)
heat.police.units / .heli / .seen          // read the response
heat.adopt(v, aboard)                     // a scene's police car joins the pursuit (police.adopt, within the level's unit cap)
heat.shops / heat.station                 // landmarks (world/landmarks.ts)
// Bus: { type: 'wanted', level, prev, reason } · { type: 'busted', fine } · { type: 'horn', x, z, duration }
//      { type: 'respray', x, z, cleared }; pedDown/explosion/bulletHit/enterVehicle carry `cop` / `police` flags.
```

## City life

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
in-view harness and a 5-star soak (HANDOFF, *V2 in-view numbers*).

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

**People** (`scenes/buses.ts`, `iceCream.ts`, `vendors.ts`, `buskers.ts`,
`fights.ts`, `muggings.ts`, `witnesses.ts`, `pavement.ts`; rules in
`systems/streetPeople.ts` and `systems/witnesses.ts`, tested). The scenes
hold at most 24 people between them (`scenes/people.ts` PEOPLE_CAP: on
top of the crowd's own count, so past it queues and crowds stop drawing
people in).

- **Bus stops**: the 86 shelters (`dressing.street.busStops`, `life.stops`)
  are the only stops. The four nearest within 110 m gather riders over
  time: passers-by drift over and wait in a line along the front facing
  the road (a Gathering crowd placed by `shelterSpot`, 4–5 each, giving up
  after 70–150 s), and one coming into range out of view may already have
  one or two waiting. A bus near the player (in traffic, or brought in
  every 45–90 s while people wait and none is about) turns at junctions
  toward the nearest shelter with riders (`routeToward`), pulls in at its
  bay (`pullIn` to stopX/Z), hisses open (`busStop`): one or two step off
  the middle door and walk on, the riders walk to the front door and
  vanish into it, and it pulls out once they're aboard (4–14 s). It stops
  at an empty shelter 30% of the time.
- **The ice cream van**: one in traffic within 150 m (or one brought in
  every 90–180 s) pulls in mid-block at the kerb (`BUS_PULL_IN`), beside a
  park or open plaza (anywhere else 25% of the time), every 30–60 s;
  `iceCream` plays the jingle; passers-by queue at the hatch on the
  pavement side (Gathering queue, 6, one served every 3.2 s: a cheer and
  `iceCreamServed`); it shuts after 16–40 s and drives on. Take it while
  it's open and the queue comes after you: *VAN NICKED*, below.
- **Food carts** (`dressing.street.vendors`): the five nearest within 90 m
  get a vendor at `vendorX/Z` (put there out of view) and a queue at the
  serving side, served every 4.5 s. How readily people join follows the
  hour (`cartBusyness`: a lunch peak at 13:00 and an evening one at
  18:30, near nothing in the small hours); a cart coming into range at a
  busy hour may already have a customer or two. A kerb cart's first
  customer stands on the walking line; the rest step off it toward the
  shopfronts (`cartSpot`), and **walkers step round** anyone a scene holds
  standing (`Pavement`: eased across their way, `sidestep`, before the
  static collision), so nobody walks through a queue or jams on it.
- **Buskers**: every 50–120 s (not while wanted) a busker sets up at the
  edge of an open plaza or a park 25–90 m off, out of view, facing the
  pavement, and dances (the Cheer clip, a wave every few beats) for
  70–110 s; up to 7 passers-by watch in an arc in front (Gathering crowd)
  for 12–28 s each, and now and then one tips: a coin glints in an arc
  into the hat (`peopleLook`).
- **Scuffles** (at most two, `BUSY`): someone running (a ped fleeing,
  or the player sprinting) barges a walker (`barges`): the player knocks
  them into whoever's beside them and those two square up; a fleeing ped
  is gone after by the one they barged (any temper, or a calm one 40% of
  the time). Also a stray round from someone else's gun (a temper, or one
  in three, goes for a passer-by who fired it) and someone pushing in at a
  cart or the ice cream van (`Fights.queueJump`). A shove each way, then
  the one shoved backs down and walks off (35% if calm, 10% if not), or
  6–10 s of fists (`setOn` both ways; knocked over, the other stands over
  them till they're up). 30% end in a knockout (the loser starts low), the
  ambulance comes for them; otherwise the more hurt walks off and the
  other raises a fist. Up to 7 watch in a ring (Gathering crowd).
- **Muggings** (every 90–180 s, `BUSY`): a passer-by on screen 10–40 m
  off is rushed by someone close by, who snatches their bag (`mugging`)
  and sprints corner to corner round the blocks, crossing at the corners
  (`nextCorner`), ringed in red; the victim shouts and points (waving,
  facing them) for 5 s. Knock the mugger over and the bag drops (a pulsing
  amber ring, 45 s): walk over it to hand it back (`bagReturned`, the
  victim cheers: HAVE-A-GO HERO, the `haveAGo` award and **$50** through
  `deps.reward` → `progress.pay`; cash, not CRED; the taser floors one
  too). Knocking the mugger
  down isn't an assault (`PedAgent.suspect` while they run) nor called in
  by passers-by. Ignored,
  they get away (65 m clear, or 35 s).
- **Witnesses** (`heat.ts` hook `witnesses`, `scenes/witnesses.ts`): a
  **lesser crime** (`DELAYED_CRIMES`: knocking a civilian down, a
  carjacking) that only passers-by saw (on screen, no police within 60 m)
  goes to whoever saw it: within 26 m and facing within 75° of it (or
  right beside it), the five nearest. The nearest calls it in on their
  phone (the one-handed aim pose with nothing in the hand, `CrowdPed.phone`,
  and a lit screen in the glow batch); one in five of the rest calls too
  (at most two per crime), half film it, the rest run. The call takes
  3–5 s; it gets through (`heat.called(crime)`: the heat lands and the
  police get a fix on you, `witnessCall`) unless every caller is knocked
  down or scared off, or you get 45 m from them first. A second crime
  close by while a call is on goes on the same call. With nobody who saw
  it (or no phone free: 6 at once), heat counts it at once as before.
  Gunfire, explosions and everything against the police stay immediate.
  After a named-mayhem stamp (Effects and camera, *Named mayhem*),
  `witnesses.film(x, z)` stops up to four passers-by walking in view (not
  within 6 m) to film it for 3–5 s: people already on the street, inside
  the scenes' people cap and the 6 phones, no call made.
- **Fires and fire trucks** (`scenes/fireCrews.ts`; rules in
  `systems/emergency.ts` FireBoard): a car that blows up leaves its wreck
  burning (the fire follows it if it's shoved), a grenade or rocket within
  4.5 m of a building sets the wall alight. A fire flares up over 2.5 s,
  burns 75 s and dies down over the last 12 (a blast within 5 m feeds it
  instead); 6 at most (a new one takes the oldest's place). After 4 s a
  fire within 150 m with 20 s still to burn calls a fire truck
  (ServiceRun, `#c3191c`, lights and siren). It pulls up, the siren stops
  (lights on), two firefighters (`ped_stocky`, tan coat, yellow helmet)
  step down, walk to either side of the fire and hose it: 7 s for a full
  fire with one hose, half that with two (hosed down, it never flares
  back); then back in and off as traffic (take the truck while they're
  out and they hose on by hand: *Borrowed Blues*). 2 trucks at most; none behind
  the title, in a timed race or quiet mission, or the cold open (fires there burn out by
  themselves). The look (`render/emergencyLook.ts` fireLook): bigger
  flame particles than a burning car's, smoke from 3 m downwind (it's
  drawn over the flames), embers, a flickering orange pool on the ground
  (brighter at night); arcing water drops (streaks in the smoke pool,
  started along their flight so a slow frame still shows a jet) and steam
  where they land. Nothing hurts anyone (a molotov's fire still does).
  Street events: `fire`, `fireTruck`, `hose` (the pump's hiss), `fireOut`.
- **Tow trucks** (`scenes/tows.ts`; `towPose`, `towPriority`, `winch` in
  `systems/emergency.ts`): every 45–90 s (`BUSY`: none in a timed race,
  the cold open or behind the title; less often while wanted) a tow truck (`tow_truck`,
  `#e8b923`, claimed in traffic within 140 m or brought in) comes for a
  car within 110 m: a wreck whose fire is out (the player's included)
  (or a crash or dumped getaway car flagged `towable`) first, then an abandoned car, then, one pick in two, a parked one;
  never a car still burning, a bike or anything longer than a pickup, an
  activity's car, or the car the player just left unless it's a wreck. It
  drives over, then lines up 3 m to the side of the car and just beyond
  it, tail to it, facing the way it came (`pullIn`), so the car goes on
  the hook by its nose or its back; winches it up over 2.5 s (`tow`
  event) and drives off as calm traffic with the car trailing like a
  trailer (no speed of its own, so no skids). The amber beacon on the cab
  turns throughout (towLook). Both are retired once far and unseen (or
  40 s towing unseen). Take the truck, knock its driver out or get into
  the towed car and the tow's off: the car stays, an ordinary abandoned
  car. One at a time (a crash's own follow-on tow, V2-10, may come while
  another's out: two at most).
- **Car alarms** (`scenes/alarms.ts`, `AlarmBoard`): a crash against a
  parked car (any car's: the contact point on its body, ±0.6 m), a bullet
  into one, or a blast within 14 m sets its alarm off: the four
  indicators flash amber at 2 Hz with a wash on the road (alarmLook), and
  a `street` event `alarm` every 1.6 s plays one cycle of its siren
  (`sfx.carAlarm`: whoops, a hi-lo two-tone, or chirps and two honks, one
  per spot, through a little distorted horn speaker). It stops after
  20 s, or when the car's driven off (getting in clears `parked`), towed,
  wrecked or recycled; set off again, it starts over. 4 at once; not
  behind the title.

**Borrowed Blues** (V2-09; `scenes/serviceTools.ts`, rules pure and
tested in `systems/serviceTools.ts`, `tests/serviceTools.test.ts`). Steal
a service vehicle and its tool works, on one action slot (the fire
button's: left click / J, the pad's X, the touch car FIRE button showing
the tool's icon and name; no drive-by from these three). `main.ts` hands
the press, the hold and the aim to `cityLife.tools.control()` each frame
and caps the player's throttle through `tools.limit()`; the pay is
*Progression*, *Borrowed Blues duty*.

- **Hose (fire truck):** held, the roof monitor (0.45 × the body's reach
  ahead, 2.7 m up) sprays a cone 16 m long, ±13° (`hoseHit`), cut short by
  the first building in its way (`clipJet`). It points where you aim (the
  mouse cursor, the right stick, or a drag on the touch HOSE button, read
  like the twin-stick aim pad), else at a burning fire within 60° of the
  nose, else straight on (`hoseHeading`). Everyone in it is knocked flat
  and back along the jet (6 m/s at the nozzle, half at the far end, down
  2.2 s, each at most once in 1.4 s: `pedDown`, cause `water`, the
  player's: assault, as a punch); a moving bike's rider is thrown off;
  cars are shoved along it (9 m/s²); a car that has caught (burning down
  to its blast) is doused, its health lifted just over the fire line
  (`douse`); a fire it reaches goes out at three crew hoses' pace (a full
  fire in ~2.3 s; `FireBoard.hose`, `street` `fireOut`). The jet is
  Effects' soft pool (64 drops a second at 17 m/s, streaks along their
  flight) with steam where it lands on a fire and a splash off the road
  (`render/emergencyLook.ts` `toolsLook`). **Stranded crews:** take a fire
  truck from a fire while its crew is out and the two firefighters stay
  on the pavement, wave after it and hose on by hand at a crew's pace, so
  the borrowed monitor beats them to it if you're quick; out (or burnt
  out), they walk off as passers-by.
- **Chime (ice cream van):** a press plays the jingle (and again every
  6 s, for 30 s; press again to stop it). Parked (under 0.8 m/s) while it
  plays, the van anchors a queue at its hatch (a `Gathering` queue, up to
  9, recruited from calm passers-by within 45 m, `roomFor` permitting)
  that's never served: it waits there, a lure, while you get out and do
  what you like. Drive the van 6 m off and they run after it (*VAN
  NICKED*, below: unpaid, it's your queue); 15 s after the chime stops
  they're let go, walking on (`Chime`).
- **Winch (tow truck):** a press, stopped (under 3 m/s), hooks the car
  whose nearer end is closest to the hook (0.6 m behind the truck's tail)
  within 4.5 m (`hookDistance`): a wreck whose fire is out, a crash or
  dumped getaway left `towable`, or an abandoned car; never a parked one,
  one someone's driving or a scene's using, a police car, a bike, anything
  burning or longer than a pickup, or one already delivered (`hookable`).
  It's winched on over 1.6 s (the truck held to a crawl) and trails on the
  hook as the city's tows do (`towPose` as a trailer: it follows the
  truck's own path through a turn, < 1 m inside it on a 9 m radius, so it
  doesn't swing out over the kerb; `towedPose`), carried with no speed of
  its own; the truck is held to 15 m/s with no nitro (`capThrottle`). A
  press away from the yard drops it where it is; stopped in the docks
  yard, it's delivered (`tool` `deliver` with its condition). Get out and
  the car stays hooked to the parked truck; get into another vehicle and
  it's dropped. An amber beacon turns on the cab while a car's on.
- **The guard:** the player's borrowed vehicle (the one they're in, or
  left standing as their last) and the car on its hook are never taken by
  the city: `CityLife.keeps(v)` (`d.keep` plus `tools.guards(v)`) is what
  `ServiceRun.call`'s claim, the ice cream van and bus scenes' adoption,
  the tow trucks' pick, the double-parking and accident picks ask, a city
  tow truck on its way drops a car the player hooks first, and population
  upkeep keeps the hooked car. Ambulance, bus and police duty wait for a
  later version.

```ts
life.tools.control(pressed, held, aimHeading | null)   // main.ts, every frame (the fire slot in one of the three)
life.tools.limit(controls)                              // the player's controls, each step: the tow cap
life.tools.truck · .tool · .hooked · .delivered · .yard · .hosing · .chime · .queue · .guards(v)
life.keeps(v)                                            // no scene may take it (an activity's, or the guard's)
// Events: { type: 'tool', tool: 'hose' | 'chime' | 'winch', what, x, z, condition?, wrecked? } with what:
//   hoseOn · spray (the pump, every 1.1 s) · hoseOff · fireOut · chime · queue · release · hook · unhook · deliver · noHook.
```

**Budget:** no mesh, program or batch: the jet and steam are the soft
pool's particles, the beacon and the yard's ring the glow batch, the
queue people already on the street. iPhone profile (852×393, `medium`),
the ice cream van and a busker forced beside the spawn, a borrowed fire
truck turned on the five people in reach and hosing for 60 frames: 49
draw calls before the truck, 60 with it in view (its model and shadow
pass), 58.8 on average (61 at most) while it hosed and knocked four of
them flat.

**VAN NICKED** (V2-12; rules pure and tested in `systems/vanNicked.ts`,
`tests/crashers.test.ts`; `scenes/vanNicked.ts`). Drive off in an ice
cream van while people are queueing at it and the queue comes after you
on foot.

- **Whose queue:** the city's van taken while it's open (`IceCream` hands
  its queue to `life.vanNicked.take()` as the player gets in) pays
  `vanNicked` (300) and its stamp with two or more queueing, once (a van
  the player's left has no driver to open it again). The player's own
  chime queue (*Borrowed Blues*) chases the same way when they drive off
  from it, and pays nothing (it's your van, and the chime is free).
- **Off after it:** they stand staring until the van's 5 m from where it
  stood (`NICK_OFF`; 8 s of it not going and they walk on, unpaid), then
  `street` `vanNicked` (a record scratch: the van's music dragged to a
  stop; the scanner's QUEUE IN PURSUIT line) and they run at the player
  (in the van or out of it, at an officer's 5 m/s, in a ring round them:
  `surroundSpot`), waving their arms. Each gives up after 9–15 s of their
  own, or once the player's 32 m ahead of them; a 1.6 s glare and they
  walk on as passers-by. Caught up, they stand round you waving; nobody
  throws a punch.
- **Not heat:** held by the scene (`agent.scene`), they're no witness and
  make no call; none of it touches the police. They aren't `suspect`
  either: knocking one down (hosed, run over, punched) is an assault like
  anyone else's, and they drop out of the chase (handed back to the
  street, so the ambulance comes for the knocked out). The carjack itself
  is a carjack as ever.
- **Ice cream after all:** one who reaches the van parked with its chime
  playing (`tools.chime.on` and anchored) joins the chime queue there.

```ts
life.vanNicked.take(van, gathering, own, moving) → n   // drain a queue into the chase (IceCream on the theft, ServiceTools on the chime's release)
life.vanNicked.chasers · .van · .chasing · .own · .counts { city, own, paid, gaveUp, queued }
```

A headless check, `tools/tune/crashers.mjs` (*Tuning harnesses*):
2026-11-02, the dev server, two runs of 12 races and 6 vans (the rendered
frames make runs differ a little). Races (a sports car put beside the
leader, a bot driving the route): all 24 joined, won 9 and 7 (in 10–16
s), the rest beaten; the RACE CRASHER stamp on every win; every prize
pulled up 10–20 m past the line (before the fix to finish it there,
100–250 m back where it was when the player crossed), its driver out
5–20 s after the win, and taken through the real enter button with no
carjack. Vans (the van forced open beside the player, taken through the
enter button and driven off at half throttle): 12 queues of 6, all chased
from 1.25 s, VAN NICKED paid and stamped, the nearest chaser 1.4–2.7 m
from the van, all given up in 5–12 s, and no star from any of it (one
passer-by's call, about the carjack). **Budget:** nothing new drawn: the
chasers are the queue (people already out), the markers and the prize's
ring the glow batch.

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
  and `LOUD` (*Driving and combat*, the air horn).
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

A headless check, `tools/tune/mess.mjs` (*Tuning harnesses*): 2026-11-02,
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
and a pursuit with it (*Tuning harnesses*); the numbers are in HANDOFF
(*V2 in-view numbers*).

**Police scanner** (V2-11; rules and lines pure and tested in
`systems/scanner.ts`, `tests/scanner.test.ts`; the bus wiring in
`game/scanner.ts`, the subtitle in `ui/scannerHud.ts` and `scanner.css`).
The city's street events become short dispatcher lines ("RTC IN COBBLE
ROW. TWO CARS, TWO TEMPERS.") with a radar ping on the incident:

- **Topics:** each street event worth a call (`STREET_TOPICS`: chase,
  race, accident, scuffle, mugging, turf war, fire, the cash van and its
  spilled cash, chucking-out time, the funeral, a burst hydrant, the
  conga, the film shoot, shots fired (V2-10); as chatter a double-parked
  lorry, a car alarm, a busker, the ice cream van; and the closing lines: an arrest, a suspect
  down, a citizen's arrest, a bag handed back; V2-12's gatecrashing: a
  race joined and won (both 3, said over the race's ping; the win closes
  it) and a van nicked (2)) has a priority (1 chatter,
  2 an incident, 3 a spilled cash van, 4 the player's own), a cooldown
  (45–240 s) and one or two lines, `{place}` the district
  (`DISTRICT_NAMES`). Nothing over 220 m off; at most 64 characters with
  the longest district and car (a test).
- **One at a time:** one line waits, the heavier offer winning (a newer
  one of the same weight replaces it), dropped 6 s after it was offered.
  Lines go out `GAP` apart by the stars (6, 7, 8, 9, 11, 14 s at 0–5★);
  the player's own wait only for the one on screen (4.5 s). An offer
  within 40 m of a ping is the same incident (a fight at an accident, the
  cash van's next stop) and is said only if it outranks it.
- **While wanted:** street lines below an incident aren't said from 1★,
  and from 4★ only the spilled cash van gets through (at 5★ one line every
  14 s at most; a waiting line that no longer makes the cut when the
  stars go up is dropped). A star gained names who's sent, the car and
  the district ("ALL UNITS, NEON MILE: RED SALOON. IN A HURRY."; 5★
  "EVERYONE TO NEON MILE, CHOPPER UP. RED SALOON."): the colour from
  `exports.colourName`, the model in the dispatcher's words (SALOON,
  HATCHBACK, BIN LORRY; police and emergency vehicles "STOLEN PANDA CAR"),
  `SUSPECT ON FOOT` on foot (`describeSuspect`). Crossing into another
  district (checked twice a second, 30 s cooldown) and getting into
  another vehicle (15 s) are called too; losing the stars, a respray and a
  bust each have a line; a star dropping or dying, none.
- **Pings:** a topic with a `scene` (CityLife's label for it) drops an
  orange `!` on the radar where it happened (pulsing, pinned to the rim
  when off it), two at most (a third takes the oldest no heavier). It
  follows the scene's `subject()` while that's within 90 m (a chase, a
  conga), and goes when the scene's `running` is 0 (after a 2 s grace), a
  closing event comes within 140 m (`fireOut`, `raceWon`, `arrest`,
  `suspectDown`, `citizensArrest`, `bagReturned`) or its time is up (40–150
  s; a fire, whose scene counts trucks, only by that and `fireOut`).
  Asked 4× a second.
- **Out:** `Scanner.step()` once a frame emits the line as `scanner {kind,
  text, priority, x, z, hold}`. Listeners: the subtitle and `GameAudio`
  (a squelch, a few syllables of radio burble and a roger pip,
  non-positional, `sfx.squelch`); the session log gets a `scanner` line.
  Nothing behind the title (the show's scenes stay quiet); a fresh run
  starts clean.
- **Subtitle:** one element, `SCANNER` and an on-air light over the line
  (two lines at most), faded in for its `hold` (3.2–5.5 s by length) on
  the frame clock, so it waits while paused. On touch it runs along the
  bottom edge between the resting steer stick (edge + 150 px) and the
  right thumb's buttons (edge + 292 px: the pedal pad and FIRE in a car,
  the resting aim pad on foot), under the marker prompt, mirrored
  left-handed; on keyboard and pad it's centred above the prompts (bottom
  + 98 px). Blue edge for the player's own lines, orange for the cash, amber
  for the rest. The smoke test holds it up with three stars, a stamp and
  the radio's card, on foot and in a car, and checks it's clear of them
  all (`iphone-852x340-scanner.png`).
- **Off:** Settings → Display → Police scanner (`settings.scanner`,
  default on), or `scanner.setEnabled(false)` from outside (observe mode):
  nothing said, pings off the radar, the subtitle down.

```ts
scanner.setEnabled(on)                // with the setting: off hides it all (observe mode)
scanner.say(topic?)                   // a line now near the player's, whatever the rules (__ub.scanner.say('fire'))
scanner.feed.pings · .stars · .said   // the two ping slots, the stars it knows, lines so far
// Event: { type: 'scanner', kind: ScannerTopic, text, priority: 1..4, x, z, hold }
```

**Budget:** no mesh, draw call or program; one DOM element written when
a line comes or goes, two radar blips set only when they move; nothing
allocated per frame.

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

## Progression

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
  SMOKE GRENADES $600 (`arsenal.pickUp`, drawn as you buy). Something you can't afford
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
  `tools/tune/chaos.mjs` (*Tuning harnesses* below) put a mindless driver at
  bronze 1 run in 5 to 1 in 2 and never silver.
- **Frenzies** (`modes/frenzies.ts`, `frenzyMode.ts`): eight spinning purple
  gems on pavements ('!' on the radar). Touch one, 3-2-1, then: KNOCK DOWN 15
  in 60 s (with an SMG), NEAR MISS ×8 in 60 s, CARJACK 5 in 120 s, DRIFT
  3,000 in 40 s, WRECK 6 CARS in 90 s (with a shotgun), HIT & RUN ×10 in
  60 s, SMASH ×12 in 50 s, a ×8 COMBO in 45 s. They count the same bus events
  as the score. $1,000 the first time (the gem turns gold), $150 a replay.
- **Hidden packages** (`modes/packages.ts`, `packageMode.ts`): 40 green
  parcels, seeded from the city: about half deep in alleys (with a straight
  person-wide way out to the street), the rest in park interiors and plaza
  corners, at least 20 m apart and in every quarter. $100 each,
  "PACKAGES 12/40"; every tenth is a perk: a pistol every life, banked
  chains +25%, an SMG every life, health that refills when you lie low.
  Only on the radar with the scanner.
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
  `systems/serviceTools.ts`; the tools themselves are *City life*,
  *Borrowed Blues*): in a stolen fire truck, ice cream van or tow truck
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
  timer, fail conditions (a tagged car wrecked, left behind or scratched:
  `damaged`, under `below` of its health, 90% by default, the moment it
  is; a tagged person knocked down) and actions on start / end (spawn a
  car, parked or with `drive: true` pulling out into traffic with a
  lane-following driver while staying pinned, or a person; set the wanted
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
  - **Driven cars** (`SpawnCar`, glue in `MissionMode.tendCars`): with
    `drive`, `wait: m` keeps it parked until the player is that close (or
    it's hurt), `cruise` sets its pace, and `route` gives it crossings to
    tour in turn, round and round (`routeLeg` moves on as it heads into
    each; `routeToward`, as a pursuit steers, picks the turn for the next).
    A mayhem area with a `tag` follows its car: on the radar throughout
    (the route redrawn only once it has gone 24 m), ringed in the street.
  - **The hook** (`{ do: 'tow', tag, truck }`, `hookLetGo`): the car rides
    behind the truck as the city's tows carry theirs (`towPose`, no speed
    of its own) until it's let go where it stands: the truck's driver gone
    (wrecked, carjacked, bailed), the player in the car, or the truck
    caught standing (under 2 m/s) with the player within 24 m for 1.2 s
    (`CATCH_*`). Not a tool the player works: towing is never a main-story
    verb (*Borrowed Blues* is the side job).
  - **Two arcs** (`arc` on `MissionDef`, `arcRings`, `nextInArc`). The main
    story, **KEEP IT LOUD** (`arc: 'main'`, ids `s1`–`s6`: DOREEN of the
    ice cream van, LIONEL the busker, against MAYOR LULL's Quiet Streets
    Act: WRONG STOP, the cold open; MAKE SOME NOISE in Cobble Row; QUIET
    PLEASE; NINETY-NINE PROBLEMS, Doreen's van off the Graveyard Shift's
    hook without a scratch; RIBBON CUTTING, the Mayor's limo; QUIETEST
    CITY, 5,000 round the judges' touring coach with a race, a fire and a
    turf flare-up on its route), rings from sunrise to midnight from the
    city's three phones. The
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

## Tuning harnesses

`tools/tune/` drives the real game headless (Playwright + SwiftShader on the
dev server, through `window.__ub`, bots in place of `input.readVehicle`, no
game-code change). The page draws no frames, its clock is fixed and
`Math.random` is seeded, so the same seeds repeat exactly: change a knob, run
again, compare. Bots are a lower bound and a relative check, never the
verdict on difficulty; real play (the Diagnostics report's play log) is.
Playwright isn't a game dependency: run with
`npx -y -p playwright@1.63.0 node tools/tune/<harness>.mjs …` (or set
`PLAYWRIGHT` to a directory with it installed), with `npm run dev` up.
`SIM_LOD=off` runs every agent every step (*Simulation level of detail*):
since it came in the runs draw randomness in another order, so the figures
below shift within the bots' noise. 2026-11-01, 20 each, LOD on / off:
5-star chases, car lost 19 / 20, busted 1 / 0, median end 26 / 24 s; Chaos Run
medians rammer 9.0k / 5.3k, weaver 15.3k / 19.1k, drifter 7.5k / 10.2k.

- **`chaos.mjs [runs=20] [--bot rammer|weaver|drifter|all] [--seed 1]`**:
  Chaos Runs; score percentiles, medals, how runs ended, points by category.
  ~1.5 s a run. Baseline 2026-10-31 (20 runs each, seed 1): rammer median
  6.5k (p75 11.3k, max 24.5k), 4 bronze; weaver 12.7k (22.6k, 30.1k), 10
  bronze; drifter 7.8k (12.4k, 33.3k), 4 bronze; no silver or gold. Boom and
  smash are half to three quarters of the points (the weaver: drift 39%).
- **`heat.mjs [chases=20] [--stars 5] [--secs 180] [--tough] [--perks] [--seed 1]`**:
  chases from a built-up 3 stars to `--stars`, a junction-to-junction
  evader; escapes, busts, wrecks, time to each lower star, crashes, shots
  taken, helicopter time on you. `--tough` keeps the car healthy to test
  the evasion rules alone. Baseline 2026-10-31 (20 chases, 5 stars): stock
  sports car lost in 18, busted 2, median end 26 s, 1 drop to 4 stars;
  tough car: none escaped, 12 down to 4 stars (median 84 s), 3 to 3 stars,
  2 busted. `--perks` maxes every CRED perk; 2026-11-01 (12 chases each,
  seed 1): stock car lost at a median 33 s without, 45 s with; tough car
  2 of 12 down to 3 stars with them, none without; no escapes either way.
- **`inview.mjs [--roam 1200] [--pursuit 300] [--stars 2] [--seed 1] [--view 852x393]`**:
  how much of the living city a driving player sees (*City life*, the
  in-view meter). A junction-to-junction bot drives the phone view through
  `--roam` seconds of free roam (stars cleared as they come), then a
  `--stars` pursuit (kept there, evading the police like `heat.mjs`), in
  1/8 s `fastForward` chunks, moving the camera and the clock between them;
  per segment: seconds with an incident in view, how often one came into
  view after a quiet spell and the gaps (median, p90, longest), and per
  kind seconds in view, started, seen, ended unseen. ~1 min a run. The
  numbers, before and after the city stopped holding off for stars, are in
  HANDOFF (*V2 in-view numbers*).
- **`mess.mjs [runs=8] [--shots 4] [--seed 1]`**: *Your mess, their
  problem* (City life). Each run: a fresh game, 20 s of traffic, a muscle
  car put 14 m behind a calm driver 40–90 m off and driven into its back;
  the adopted crash followed for 70 s (driver out, patrol on site, tow
  called, DOMINO awards, seconds the driver stood within 8 m of the player:
  `fastForward` doesn't move the camera, so the view isn't asked). Then
  `--shots` runs of the gunfire chain beside a parked car (a player `shot`
  on the bus, as combat sends it): its links, awards and stars. A few
  seconds a run. Numbers under *City life*.
- **`crashers.mjs [runs=6] [--vans 6] [--seed 1]`**: *RACE CRASHER* and
  *VAN NICKED* (City life). Races: a street race begun by the spawn (no
  police), a sports car put in the oncoming lane beside its leader,
  rolling, and a bot that drives the route junction to junction (13 m/s
  into the turns, nitro on the straights): joined, won or beaten, how
  long, the stamp (one rendered frame after the win), the prize pulled up
  and how far past the line, then the player put at its door and the real
  enter button pressed (`stepFrame` with `consumeAction`): in, and whether
  that was a carjack. Vans: the ice cream van forced open beside the
  player, its queue left 6 s to fill, taken through the enter button and
  driven straight off at half throttle: the queue, the chase starting, the
  award and stamp, the nearest a chaser got, when they'd all given up, and
  the stars and witness calls. A few seconds a run. Numbers under *City
  life*.
- **`music.mjs <out-dir> [station-id …]`**: renders stations offline
  (`audioLib.mjs`: the game's own audio modules on an OfflineAudioContext
  in the page, ticked like the 25 ms timer) to MP3 (WAV without ffmpeg) for
  listening, with the songs heard and RMS / peak per 5 s window. `SECONDS`
  (90), `SCRIPT` (intensity steps, `0:1,24:3,48:5,72:0`), `MODE=menu`.
  Needs no game page, only the dev server (`URL=http://localhost:5173/`).
  The audio renders repeat too (`audioLib.mjs` seeds `Math.random` afresh
  for each, and renders every drum kit it will play before it starts): the
  same figures every run, the WAVs a 16-bit step apart in a few samples
  (the browser's own float rounding).
  Baseline 2026-11-01 (90 s, default script, raw music output): every
  station at −14.6 to −14.7 dBFS overall, about −18 at intensity 1, −15 at
  3 and −13 at 5; peaks at about 0 dBFS (the music bus and limiter follow in
  the game). New stations should land within a dB of that. The four added
  2026-11-01 do: SIDEWAYS 808 −14.6, GETAWAY 104.3 −15.1, DUBWISE 88.8
  −15.2 and INSERT COIN −14.8 overall, peaks at most +0.7 dBFS (as
  NIGHTDRIVE's +0.6). `MODE=menu` renders sit at −15.3 to −18.5.
- **`stings.mjs <out-dir> [name …]`**: renders the title theme and the
  stings built on its hook the same way, at the voice levels the game plays
  them: `theme`, `wasted`, `busted`, `mission-start`, `mission-passed`,
  `mission-failed`, `count-in` (3-2-1-GO at the real 1 s spacing) and
  `count-in-radio` (the same over the radio at the game's music / SFX
  balance: held down under the count, dropping in on GO). `SECONDS` (the
  theme, 60), `KEY` (MIDI, 45 = A), `INDEX` (the payphone job), `RADIO`,
  `MAJOR` (1 the major spelling, 0 minor; unset: minor for `KEY`, and
  `count-in-radio` follows the radio's song, as the game does). The major
  spellings are as loud as the minor (in D, 2026-11-01: count-in −21.7
  dBFS, mission start −18.8, failed −20.7; RMS within 0.1 dB, peaks within
  0.6); over INSERT COIN `count-in-radio` is −22.2 either way, with no F
  rubbing against its F# any more.
  Baseline 2026-11-01 (raw, key A, seeded): the theme −16.8 dBFS overall
  (about −18 in its intro and first hook, −15.5 in the hook with drums;
  the stations' menu tiers, above, −15.3 to −18.5), peak −1.8; WASTED −14.1
  (the old one −13.5), BUSTED −16.6 (old −16.9 to −18.4), peaking at +1.2
  and +1.5 dBFS from their slam and clang layers (the old ones +3.5 to +4.9
  and +1.6 to +2.1; the limiter follows in the game); mission start −18.8,
  passed −19.4, failed −20.7 now its landing tonic holds (peaks −5.7,
  −4.7, −7.7); the count's hits
  peak at −10, −8 and −5.5 and GO at −4.7.

- **`reactive.mjs <out-dir> [chase|on-foot …]`**: the music that reacts
  to play, through the same modules: `chase` is the radio (NIGHTDRIVE) at
  1 star, then wanted 3, 4, 5 and lost (`SCRIPT` "seconds:stars,…",
  `RADIO`); `on-foot` walks past a parked car, a shopfront and a boombox
  (cut with its scratch) through the street chain. Baseline 2026-11-01
  (raw): the chase −14.5 dBFS at 3 stars, −15.2 at 4 (its verse), −13.7 at
  5, peaks −1 dBFS; on music.mjs's default intensity script −15.9 overall
  (−16 to −18 at 1, −14.4 to −16 at 3, −13.6 to −15 at 5, the stations
  −18, −15, −13), its hook −5 to −6 dB against the rest (the theme's −4).
  On foot: a parked car peaks at gain 0.2 against the car radio (−14 dB)
  2.5 m off, a shop 0.19 at 3.5 m, the boombox 0.6 at 4 m and still 0.05 at
  26 m; a switch is silent for about 0.5 s.
- **`mayhem.mjs [--tier medium|low|high|all] [--time day|night|both] [--scenario mayhem|single|drive|pursuit] [--no-city-fires] [--step 50] [--dpr 3] [--shot dir] [--shots 2,17] [--fx auto|off|on] [--fx-scale 0.25]`**:
  heavy mayhem on the iPhone profile (unlike the others it renders: real
  frames stepped by `__ub.stepFrame(ms)`, Rapier loaded, god mode and the
  destruction test on). Blows up four cars and three walls round the
  player, two more cars at 8 s, two more and a wall at 16 s, and runs to
  36 s (fires, fire trucks, hoses); `single` is one car. Reports peak live
  particles, the transparent fill projected from the camera (screens of
  overdraw; SwiftShader can't time the GPU), glows and their fill, draw
  calls, fires and rubble. `--dpr 1` is faster and gives the same fill
  (a share of the screen). `drive` blows nothing up: a bot drives the
  nearest car round, handbraking into turns (tyre smoke); `pursuit`
  drives the same way at 5 stars (god mode, the car kept whole) with a
  busy scene started round it every 5 s through the TEST menu's starter
  (race, chase, accident, scuffle, tow, turf war, fire: past the holds and
  the wanted cap, a worst case), reporting the busy scenes and police
  units at their peak too. 2026-11-02, medium, 40 s, `--step 100 --dpr 1`:
  draw calls peak 76 / average 60 by day, 68 / 61 at night (7 units, 2–3
  busy scenes at once); `drive` alone 56 / 47. Smoke work is
  the soft particles' fill, or offscreen their fill × scale² × 1.25 plus
  the composite's tiles; `--fx off|on` forces the low-resolution smoke
  path off or on, `--fx-scale` tries another scale (dev server only), and
  `--shots` saves the frames at those seconds (with `--fx auto`, each
  also from the same frame with smoke at full and at low resolution).
  JS ms is the median frame. Numbers under *Effects and camera*.
- **`story.mjs [--job s4|s5|s6|all] [--shot dir]`**: KEEP IT LOUD's jobs
  4–6 from the ringing payphone (the TEST tools' jump, then the call and
  LET'S GO) to the debrief, with a bot driving and the police kept off (a
  bot doesn't run). s4 follows the Shift's truck about 17 m back until
  it's caught standing, or after 45 s parks across its lane, then takes
  the van and drives the last 45 m to Doreen (the van's health at the
  end); s5 rams the Mayor's limo (blows it up after 150 s, and says so);
  s6 follows the coach for a lap (the crossings it took, the scenes
  featured, what the street saw), then rams the traffic round it (the
  real points counted; any short of 5,000 after 360 s are added, and
  said). Then PROGRESS's two story rows and their bars (`--shot`: a
  screenshot). 2026-11-02: all three passed; s4 caught at the block
  (48 s; never at a light in 45 s of following), the van at 98–100%;
  s5 in 28–44 s of ramming; s6's coach took the whole tour in order and
  round again, its race, fire and turf flare-up started, 3,100–5,700
  real points over runs.

- **`citySize.mjs [--sizes 16,24,32] [--runs 2] [--only desktop|iphone] [--no-build]`**:
  the W3-A spike. Builds and serves the game like the smoke test, boots it
  at each `?city=` size, and reports boot time (to `window.__ub`), JS heap
  after a GC, and draw calls at the spawn, in the ring and in observe at
  the widest zoom. Numbers in `docs/W3A_CITY.md`.

## Layout

```
src/core      loop, input, event bus, settings
src/entities  vehicle physics (no three.js)
src/game      player, population, heat, progression (progress*.ts) and modes/ (Chaos Run, activities)
src/render    camera rig, meshes, dynamic resolution
src/world     ground / city
src/ui        title/pause/settings menus, touch controls, HUD, radar, radio card, CSS
src/audio     synthesised sound and music (pure models + Web Audio voices)
tests/        vitest
tools/        icon renderer (make-icons.mjs), smoke test, tuning harnesses
blender/      procedural asset scripts (lib/ helpers, generators/, build_assets.py)
```

## Audio

Everything is synthesised at runtime with the Web Audio API: no audio files,
no dependencies. `GameAudio` (`src/audio/gameAudio.ts`) owns it all; `main.ts`
only creates it, feeds it one mutable `AudioFrame` per frame and forwards pause.

- **Unlock and lifecycle.** One `AudioContext`, created on the first
  tap / click / key (iOS needs a user gesture; a one-sample silent buffer
  completes the unlock). Only that happens inside the gesture handler: noise
  buffers, the reverb impulse and the graph are built in the next few tasks,
  so the first touch doesn't drop frames. Interrupted or suspended contexts
  resume on the next gesture. A hidden page suspends it; pausing silences the
  world and muffles the music (UI sounds still play), and 45 s of pause
  suspends it to save battery. Master volume at 0 keeps the context
  suspended; music volume at 0 stops the sequencer and unhooks the music
  graph, so muted music costs no CPU.
- **iOS audio session.** On iOS 16.4+ `navigator.audioSession.type` is
  `'playback'`, so the silent switch doesn't mute the game (setting
  `ignoreSilentSwitch`; false → `'ambient'`). `'playback'` also stops other
  apps' audio, so while the game is turned all the way down (master 0, or
  SFX and music both 0) it drops to `'ambient'` and the player's own music
  keeps playing. A sound-settings screen should explain the toggle as "Play
  sound with the silent switch on".
- **Mix.** World sounds (muted on pause, muffled by close blasts, hits and
  death, with a synthetic street reverb) and UI/stingers → SFX bus; music →
  its own bus; both → master → glue compressor → limiter. Bus gains follow
  `settings.masterVolume / sfxVolume / musicVolume` (squared slider curve).
  The world muffle and the music duck are each one merged state (`Dip` in
  `mix.ts`): the deepest pull wins and the longest hold is kept, so a hurt in
  the same frame as a close blast or the killing blow can't cut the blast's
  deafening or the WASTED muffle short.
- **Spatial.** One-shots are placed relative to the camera focus: inverse
  distance falloff with a floor (far events are quiet, not silent), stereo pan
  by screen x, air-absorption lowpass and more reverb with distance. Sirens
  also get doppler.
- **Budget.** One-shots are capped per category (oldest stolen) and overall,
  rate-gated per event type (a 30-car chain reaction makes two booms), and
  every node is disconnected when its voice ends; `audio.debug` shows live
  node and voice counts. Continuous voices push parameters at ~45 Hz.
- **Events.** It subscribes to every `GameEvent` on the bus (`src/core/events.ts`);
  nothing in the simulation calls it directly.
- **Title theme and stings.** The game has a tune of its own: a two-bar
  hook in A minor (`themes.ts`: a falling call on a 3+3+2, the flat sixth
  sighing on to the fifth, then a climb home), written out note for note
  (a song's `melody` plays as written instead of a composed lead). On the
  title GameAudio's `'menu'` plays it as a theme instead of the station's
  menu tier: a station off the dial with its own chords and a 30-bar loop
  that builds a little (intro, the hook, the beat comes in, the hook with
  drums, a breath; 72 s at 100 BPM). `'game'` brings the radio back with
  its next song (its first, at boot); `audio.station`, the saved station
  and the NOW PLAYING card stay the radio's (a retune on the title is kept
  for the game, and a station heard on foot doesn't carry over: off the
  game the music is put back on the radio's station, silently under the
  theme). Every sting and UI sound is tuned to the key the music is
  in (the song's own, transposition included), and to its mode: a song is
  major when its tonic chords have the major third (or, with no tonic
  chord, when its chords hold the key's major third rather than its minor
  one; `songMajor` in `stations.ts`, `Arranger.major` next to `key`, the
  next song's mid-switch). INSERT COIN's four songs and GETAWAY's dominant
  blues (Hot Wire Strut) are major, everything else minor. Over a major
  song the count-in goes I - IV - V to a major GO, a job starts on the hook
  re-spelled major and fails on to the relative minor (sad, but no minor
  third against the radio's major one), awards climb the major
  pentatonic, KABOOM stabs a major tenth and a UI fail falls through the
  fourth; minor songs get exactly what they had. WASTED and BUSTED stay
  minor (the music stops). The new stings quote the
  hook: WASTED (heavy, then the tape sags) and BUSTED (cold, sinking to the
  flat fifth) over their slam and clang; a payphone job starts on a bar of
  heist pulse under the hook, passes on it in the major, fails on it losing
  its nerve (the starts cycle four leads and tempos by job, the passes
  three, the fails two; the radio dips under them); the 3-2-1-GO before a
  Chaos Run, race or frenzy is a hit per number, building over a riser to
  the tonic with the music held down, and GO lands a big hit; in a car it
  drops the radio back in hard on a chorus, a few layers up (on foot the
  street plays on: a frenzy started on foot runs to whatever is playing
  nearby, or to silence). Getting into a car puts the radio back on your
  station at once, so a run's count-in is in its key. Scores are
  pure data (`stings.ts`), played by one gliding lead and bass per sting,
  chord stabs and takes of the radio's own drum kit.
- **The chase.** From 3 stars the radio gives way to a score of the game's
  own (`music/chase.ts`), off the dial like the theme: the hook on a brass
  lead over a breakbeat, a reese bass pushing octaves and saw stabs on the
  hook's 3+3+2, E minor, 141 BPM at 3 stars up to 150 at 5 (two cues, the
  second a minor third up, alternating each time round its 36-bar loop: the
  hook in every chorus, a driving verse, a two-bar breath). It comes in on
  the next bar line, risen into over what's left of the bar and landing on
  a crash, with no static (it's score, not a retune), and follows the
  wanted level and play through the usual intensity floor; at one or two
  stars it carries on, calmer. When the police lose you (back to 0 stars:
  evaded, resprayed) it calms down, two drumless bars of the hook, and
  hands back to the radio's next song; back to 3 stars during those, it
  carries on (at one or two it hands back all the same). WASTED and BUSTED
  fade the music out as before (and it stays out: a death clears the stars
  before the music hears of it, so the chase is dropped only once the
  music is off) and drop the chase; after respawn it's the radio, or what
  the street plays, with the respawn sting in its key. R (or tapping the
  card) during a chase is the player's call: the chase drops for the next
  station and stays away for the rest of that chase, until the stars are
  back to 0 and up to 3 again. It plays in your ears on foot too, never
  through the street below; on foot its last bar fades out, so the street
  takes over from silence, not with the radio's next song in your ears. The
  radio card names it while it plays: it drops in as the chase comes in and
  when you get into a car during one, CURBSIDE PURSUIT in the police's red
  and blue over `NOW PLAYING · R FOR RADIO` (`TAP FOR RADIO` on touch), and
  that tap or R is the skip (`audio.playingScore`, `audio.onScoreChange`).
  The mechanism is the theme's: an `Arranger`
  plays a `Theme` instead of the radio (`theme` in 'menu', `score` in
  'game'), and a Theme without a set tempo or tiers follows the intensity
  under its own form, section rules (`shape`) and `outro`.
- **Music on foot.** Out of the car the radio isn't in your ears: you hear
  music faintly from the street as you pass it (`streetMusic.ts`), one
  station at a time on the one music player, through a street chain on the
  music path (`StreetChain` in `loops.ts`: a lowpass, a pan and a gain;
  open in the car, the chase and the title). The car you got out of plays
  your station where you left it, so its radio fades as you walk away (and
  comes back as you walk back), unless it's a police car or SUV, a SWAT
  van, an ambulance, a fire truck or a two-wheeler (no radio worth hearing,
  like those at the kerb); about one in three parked cars has its radio on
  (nobody in it, not police, not wrecked or burning; the station a hash of
  where it's first heard parked, kept while it stays about there, so a
  nudge from traffic or a blast doesn't retune it or switch it off; moved
  6 m it's been re-parked and picks again: the van by the spawn point plays
  the first station); half the neon-lit shopfronts and a quarter of those
  with awnings play their district (NEON MILE funk or phonk, GLASS HEIGHTS
  synthwave or breaks, COBBLE ROW lo-fi, RUSTWATER DOCKS dub, MAPLE FLATS
  chiptune or lo-fi, a fifth or two of each with something else; 591 in
  the city, in a 32 m grid built once); and each VIPERS hangout's boombox plays
  SIDEWAYS 808 while its crew stands about calm, loud enough to carry 30 m
  or so. When the crew turns on you or gets knocked about it's cut with a
  record scratch, and back once they've settled for 12 s (`gangMode` emits
  `'boombox'` events, `{ id, x, z, on, cut }`; `stepBoombox` in `gangs.ts`).
  Each emitter falls off with distance to silence at its range and is
  muffled, as if through a car body or a shop door, until you're close, and
  panned by where it is; levels against the car radio (1): your car 0.5,
  parked cars and shops 0.34 up close (about −14 dB at a few metres), the
  boombox 0.62. The loudest is heard, but another station takes over only
  when it's 1.6× louder than the loudest playing the current one, so
  walking between two doesn't flap; the change fades out, retunes quietly
  from the top of a phrase and fades back in. Nothing in range for 4 s and
  the music goes dormant (no notes booked) until something is. Stepping out
  of the car carries the radio on from your ears down to the street; after
  WASTED or BUSTED (the music was off) and after the chase, the street
  starts from silence instead. Getting into a car puts the radio back on
  your station (with the usual static when that's a change, seamless when
  it's already playing it) and NOW PLAYING as usual; songs heard from the
  street never pop the card. R on foot retunes the car radio for next time
  and shows the card with its name (by your own car you hear it retune).
  The street is scanned every 0.2 s with nothing allocated but a parked
  car's record the first time it's heard (`ParkedRadios`).
- **Music.** A look-ahead scheduler (25 ms timer, 0.12 s ahead on the audio
  clock) plays original songs in seven styles: NIGHTDRIVE FM (synthwave),
  BREAKNECK 99.1 (breakbeat), LOW TIDE (lo-fi), SIDEWAYS 808 (phonk),
  GETAWAY 104.3 (funk and disco), DUBWISE 88.8 (dub) and INSERT COIN
  (chiptune), four songs each (made-up
  titles and artists, `stations.ts` `songs`), each in its own key with its
  own verse and chorus chords and melody. A song runs through a form (intro
  4 bars, verse 8, chorus 8, break 4, chorus 8, outro 4; `sequencer.ts`
  `FORM` / `shapeTier`): while calm the intro and outro are drumless, the
  melody waits for the chorus and the break drops to chords and arp; from
  intensity 3 (a chase) every section plays in full. Then the next song;
  retuning picks up a station with its next song. Intensity 0–5 layers in
  kick, snare, arps, lead, crashes and risers, opens the filter and lifts
  the tempo; changes land on bar lines with a fill, tempo glides. It follows
  chaos (combos, explosions, speed) above a floor set with `setIntensity`.
  `'menu'` mode plays the title theme (or, with no theme set, the station's
  drumless menu tier). Drums play
  from a kit rendered per station sound (`drumKit.ts`: layered, saturated
  hits, 808-style metal hats, a four-hand clap, up to three takes each in
  round robin, one crash take shared by every kit), rendered a take at a
  time and never two in a frame: in idle time from the moment audio
  unlocks, whatever is on screen (`MusicPlayer.warmKits`: the radio's kit,
  then the chase's, then the rest, the two shared crash takes before any
  other; behind the title a take 40 ms after the last, in play gently,
  150 ms apart, so with PLAY as the first tap every kit is in some 15-20 s
  into play; nothing warms while the music is at volume 0), or a take a frame when a station is heard before its kit is
  in (warming waits for it); the live drum voices stand in until each part
  is in. The
  NOW PLAYING card shows the song and artist (`audio.song`,
  `audio.onSongChange`) and drops in for each new song while you drive.
- **Station instruments.** Each station's `StationSound` picks its
  timbres; the mono bass and lead are reshaped per station (no extra
  oscillators): an 808 (sine boom, slides, a drive patched into the bass
  chain only while it plays), slap bass (thumb, popped octaves, ghost notes
  and a fret click), a deep sub, the 8-bit stepped triangle; pulse-wave,
  brass and melodica leads; per-note cowbell, pulse arps, reggae skanks,
  auto-wah guitar chops and an 8-bit pad. Custom oscillator shapes
  (`waves.ts`) are built once per context. Patterns add `~` (hold and
  slide into the next note, across the bar line too), `g` (ghost note) and
  `4` (fourth) for bass and `r` / `t` (32nd and triplet rolls) for drums;
  phonk's arp yields to the lead so one cowbell plays riff and melody. Dub
  sets its own echo (send, feedback, a darker repeat) and throws the
  rimshot, skanks and each section's last bar into it. The kits add a hard
  kick, a reggae rimshot and the chip kit (an LFSR noise channel, its
  93-step metallic mode for hats, a stepped-triangle kick, 4-bit volume).
  New stations go on the end of `STATIONS`: the saved station is an index.

| Module | What |
|---|---|
| `carSound.ts` | 5-speed gearbox / RPM model, per-archetype engine profiles, squeal and road-noise amounts (pure, tested) |
| `mix.ts`, `voices.ts`, `chaos.ts` | falloff/pan/doppler math, voice limiter and rate gate, chaos → intensity (pure, tested) |
| `music/theory.ts`, `music/stations.ts`, `music/sequencer.ts` | chords, voice leading, lead composer, station data, step clock and arranger (pure, tested) |
| `music/drumKit.ts`, `music/waves.ts` | rendered drum kits and the chip noise channel, custom oscillator shapes (pure, tested) |
| `synth.ts` | noise buffers, node-tracking `Voice`, envelopes, reverb impulse |
| `sfx.ts`, `loops.ts`, `music/musicPlayer.ts` | one-shot recipes, continuous voices (engine, tyres, fire, ambience, sirens), music instruments |
| `music/themes.ts`, `music/stings.ts` | the title theme and its hook; the stings built on it as scores in the song's key and mode (pure, tested), played by `sfx.playSting` |
| `music/chase.ts`, `streetMusic.ts` | the chase score and when it plays; music on foot: emitters, falloff, muffle and pan, stations by district and hash, the switch with its hysteresis, the shop grid, the boomboxes (pure, tested) |

API for other systems:

```ts
audio.update(dt, frame)              // per frame: listener x/z, player car (describeCar) or null, footSpeed, health, vehicles (fires)
                                     // and the cars driven and last got out of (playerCar, lastCar: radios on foot)
audio.streetShops(buildings, plans)  // once at wiring: the shopfronts that play music on foot
audio.siren(id, x, z, on, style?)    // call every frame while it sounds; 'twoTone' | 'wail' | 'yelp'; stale ids fade out after 1 s
audio.horn(x, z, duration?)
audio.ui('click' | 'confirm' | 'back' | 'countdown' | 'go' | 'success' | 'fail' | 'cash' | 'star')
audio.countIn(n)                     // a run's 3-2-1-GO: 3, 2, 1 as each number shows, 0 on GO
audio.missionCue('start' | 'passed' | 'failed', index)  // a payphone job's music (index: the job's)
audio.setPaused(bool)
audio.setIntensity(0..5)             // music floor, e.g. the wanted level
audio.setMusicMode('game' | 'menu' | 'off')
audio.nextStation()                  // also R / tapping the radio card (mid-chase: drops the chase)
audio.playingScore                   // the chase is playing instead of the radio
audio.onScoreChange(fn)              // fn(true) as the chase comes in, fn(false) when the radio's back
audio.unlock()                       // call from a title screen's tap
audio.debug                          // state, voices, nodes, engine, music, street (on foot), chaos, muffle
```

To audition sounds without playing, render them offline: every recipe takes
a `Voice` on any `BaseAudioContext`, so an `OfflineAudioContext` in the dev
page can render and analyse them (`window.__ub.audio` and `__ub.events` are
exposed for emitting test events).

## Look

Everything visual outside the HUD hangs off one `Look` object
(`src/render/look.ts`): `main.ts` creates it, calls `look.update(dt, player)`
and `look.render(camera)` each frame. No real-time light is ever added or
removed (that would recompile every lit material), every program is compiled
on the first frame and again after a restored GL context (night-only meshes
included; on desktop against the HDR target the scene really draws into),
and quality-tier changes only resize or idle things. Every car model's
geometry is uploaded at load, not when that model first drives into view,
and the whole city is drawn once with culling off before the first real
frame (and after a restored context), so no chunk uploads its buffers
the first time it comes into view.

- **Draw calls.** All people wearing one body are one GPU-skinned
  `InstancedMesh` (`characterModel.ts`: the GLB's rigid parts merged at
  load, bones and palette per person in a float texture; see *People*
  below), all cars one instanced mesh
  per model (`vehicleBatch.ts`: paint, steering, brake lights, charring and
  sirens are per-instance attributes), all contact shadows one mesh
  (`contactShadows.ts`) and all faked lights one additive mesh
  (`glowSprites.ts`: headlight beams, tail/brake lights, siren wash, the
  player marker: a ring on foot, round the car a ring that dims at speed
  but never goes out plus a chevron ahead of the bumper, pickup rings). The city is ~5 instanced meshes per 256 m
  chunk. Measured in Chromium (whole frame, incl. shadow pass), iPhone
  15 Pro profile ('medium'): 40 draw calls on foot at spawn, 44–56 driving
  a busy street by day or night, rain included (each car model in view
  costs one call, plus one in the shadow pass); desktop ('high') is 55–69
  including ~14 for bloom; 'low' (no shadow map) 22–27. Programs: 18 on
  phones, 27 on desktop, none compiled after start-up over a full day.
  About 160–250k triangles on the phone (most at night), ~245k on desktop,
  most of it the instanced city in both passes. The destruction test (off
  by default, *Destruction test* below) adds one rubble batch, +1 call
  (+1 in the shadow pass with the desktop style, which `auto` uses on
  phones too) while chunks are on screen; its craters are drawn by the
  building shader, at no call.
- **Light.** `timeOfDay.ts` (pure, tested) keyframes sun/moon direction,
  colour and strength, sky and ground fill, fog, exposure, reflection
  strength and a shared `uNight` (night keeps a strong blue moon and sky
  fill so streets stay readable on phones, which have no bloom to lift
  them); `sceneLighting.ts` applies it to one
  `DirectionalLight`, one `HemisphereLight` and a faint ambient.
  `sunShadow.ts` fits an orthographic PCF shadow box to the visible ground
  every frame, snapped to whole texels (no shimmer); map size comes from the
  tier (2048 / 1024 / off). Tone mapping is ACES plus a grade
  (`post.ts`, installed as `CustomToneMapping`: no extra pass).
- **Surfaces.** `shaderLib.ts` holds the shared uniforms (`uTime`,
  `uNight`, and `uWetness`, which the weather in `fxWeather.ts` drives)
  and GLSL (integer hash, noise, anti-aliased lines, and `ubStreetLight`,
  which lights ground, walls, cars and people from the lamp layout in
  `world/streetLamps.ts` analytically).
  `world/ground.ts` draws the whole ground in one shader that follows the
  city constants exactly; `world/cityMesh.ts` draws buildings, roofs,
  rooftop props, awnings, neon, lamps and trees; `world/districts.ts` and
  `world/buildingPlans.ts` (pure, tested) decide districts, heights,
  palettes, roof types, props and shopfronts.
- **Phones vs desktop.** Phones render straight to the canvas: no
  full-screen passes, glow comes from additive sprites, a CSS vignette
  frames the view. Desktops render into a half-float buffer so the 'high'
  tier can bloom (threshold follows the time of day: only real lights bloom
  by day). Cars' paint and glass alone reflect a PMREM studio environment.
  On the medium and low tiers heavy smoke is drawn at half resolution and
  composited back (*Low-resolution smoke* under *Effects and camera*).
  Bloom is left as it is: phones never bloom (no HDR pipeline), and
  desktop 'high' runs `UnrealBloomPass` from half resolution (5 mips,
  linear-sampled taps, 13 passes, ~2.2 screens written). Its bright pass is
  sanitised (`sanitizeBloomInput` in `render/post.ts`): NaN texels become 0
  and the rest are capped at `BLOOM_INPUT_MAX` (64), because the blur would
  otherwise spread one NaN or overflowed pixel into big black blocks (seen
  on desktop Chrome, 0.13.0). One source was the headlight cone in
  `glowSprites.ts`: its v interpolates a hair past 1 along the quad's far
  edge, and `pow(1 - v)` was NaN there, a 1 px black line across the road
  12.7 m ahead of a car even after the sanitising; v is clamped now.


### People

Everyone in the city is drawn from the Blender bodies in `public/assets/`
(rebuild scripts in `blender/`, contracts in `docs/BLENDER_TODO.md`):

- **Bodies, one batch each** (`render/characterBodies.ts`,
  `characterModel.ts`, `game/bodies.ts`): `player` and `player_f` (the
  player's two bodies, picked on the title screen with CHARACTER and saved
  as `settings.character`; `characters.setBody(model, kind)` moves a model
  between batches at once), the street bodies
  `ped_slim` (backpack), `ped_stocky` (ball cap) and `ped_coat` (long coat or
  dress), `cop`, and the story characters `vex`, `tuna` and `pike`. Each GLB
  is one `CharacterBatch`: one draw call plus its shadow pass, and none at
  all while nobody wearing it is on screen (people more than 8 m outside
  the visible ground are left out, so the crowd walking just off-screen
  costs nothing). Batches grow as needed. Palette slots by material suffix:
  `skin`, `hair` (the ball cap, the cop's cap crown), `shirt` (coats too),
  `pants` (the backpack, Vex's overalls), `shoes` (the cop's brim, belt and
  holster, Tuna's headphones), and a fixed-colour `badge` for later.
- **Who wears what.** The crowd is a mix of `player` / `player_f` / `ped_slim` /
  `ped_stocky` / `ped_coat` (14/14/26/24/22%) in the street palettes (caps get
  brighter colours than hair); pooled models only come back as the same
  body, dressed from scratch (nothing of their last outfit carries over;
  when the pool is full the longest-waiting model goes). Officers on foot wear `cop` in police blue with a navy cap (SWAT in
  charcoal, with SMGs). Lil' Tuna (both pick-ups) wears `tuna`; Vex waits
  at the docks yard for every delivery there; Deacon Pike guards his car in
  LAST CALL; the Collector wears Pike's coat in white. Story characters
  keep their own colours; only the friendly ones cheer.
- **Clips** (`characterAnim.ts`): the 23 clips are baked at load into
  Float32Arrays per body (each track's own 24 fps keys; anything not evenly
  keyed and linear is resampled at 30 fps) and sampled by hand with inline
  nlerp/slerp (no `AnimationMixer` per person, no three.js interpolants, no
  garbage per frame) into three layers: legs (Idle/Walk/Run on one gait phase at the
  authored `walkSpeed` / `runSpeed`), a whole-body layer (Fall, Down, GetUp / GetUpFast,
  Arrested, Cower, Cheer, EnterCar, Ride, Stagger: these move the root
  bone, so the instance is never tipped while they play) and the arms,
  chest and head (aims, shots, punches, Throw, Hail), crossfaded by weight.
  `render/peoplePose.ts` turns the simulation's state into them every
  frame, outside `main.ts`. Hit-stop freezes people with the world; a hit's
  Stagger follows the sim's countdown rising, so a card freezing the sim
  doesn't restart it. Models load through `publicUrl()` (`core/paths.ts`),
  so they work under deeek.org/curbside/.
- **Weapons in hand** (`render/heldWeapons.ts`): `weapons.glb`'s pistol,
  SMG, shotgun, grenade, molotov and launcher merged into ONE instanced
  draw call (each instance shows only its own model); each follows its
  holder's right fist, along the arm when lowered and straight ahead when
  aimed. Muzzle flashes and tracers start at the end of the barrel (the
  `muzzle` extra). Hidden in cars, while down, kneeling or just thrown.
- **Moments.** Gunfire right beside a timid bystander makes them cower
  before they run; anyone knocked down falls on their back away from the
  hit (a second knock where they lie doesn't spin them round); the player
  ducks into the driver's door before vanishing (put straight into a car
  elsewhere, as a Chaos Run does, they're simply in), rocks
  back from hits, kneels with hands on head when BUSTED, and cheers a
  passed mission or a Chaos Run medal (event `celebrate`) with any story
  character nearby; hailing fares and waiting mission characters wave.
- **Pigeons** (`systems/pigeons.ts` pure, `render/pigeonMesh.ts`): up to
  three flocks settle out of view on plazas, parks and the kerb side of
  pavements and scatter at a passing car, a runner, the player walking up,
  gunfire, blasts and horns (most come down again a little way off: *City
  life*): one instanced draw call with the `Flap` clip
  sampled into the vertex shader, a contact shadow each, none when no bird
  is in view.
- **Budget** (`?debug`, whole frame): each body on screen costs 2 calls
  (scene and shadow pass), the weapons in hand 1 and the pigeons 1 while
  any are in view; nothing for anyone off screen. iPhone profile
  ('medium'), the moments measured before this work: on foot at the spawn
  44 → 42, a fight among six people with an SMG 44 → 49, driving a busy
  street 48 → 53; the posing scenes 41–50 (two officers on foot 49–57, the
  three story bodies together 44–48). Desktop ('high'): 58 / 60 / 64 →
  63 / 67 / 69, scenes 55–70. Per frame, posing allocates nothing.
- **For other code**: `look.characters.create(outfit, body)`;
  `model.hold(weapon, aiming)`, `model.armed` (the aim pose),
  `model.arrested` / `cowering` / `riding` (Ride: put the root at the
  bike's `<arch>_seat` minus 0.75 m), `model.punch(step)`, `shoot()`,
  `throw()`, `stagger(s)` (an event) / `followStagger(s)` (a sim countdown,
  every frame), `hail(s)`, `cheer(s)`, `enterCar()` (returns its
  length), `reset()`, `hasClip(name)`, `update(dt, speed, down, downLeft)`;
  `population.addPed(agent, outfit?, body?)`; CrowdPed `gun`; bus event
  `celebrate`.

## World

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

## Effects and camera

Everything that makes an action land lives in `src/render/fx*.ts` and
`effects.ts`, driven by `FxDirector` (`fxDirector.ts`), which subscribes to
the event bus. `main.ts` only creates it, scales the time it feeds the sim
by `fx.simScale(dt)` (hit-stop) and calls `fx.update(dt, controls, focusX,
focusZ, playing)` once per frame after placing cars and people.

- **Particles** (`fxParticles.ts`, pure and tested): struct-of-arrays pools
  with a free list, nothing allocated per particle or per frame. Each
  particle has drag, gravity, spin, optional ground bounce and stretch
  along its velocity, and a colour/opacity ramp over its life: fire runs
  white → yellow → orange → red and hands off to smoke as it dies, smoke
  fades in and out (it no longer shrinks), sparks streak, embers flicker.
  Sprites come from a 4×4 atlas drawn on a canvas at start-up
  (`fxAtlas.ts`: fbm puffs, flame, spark, star, ring, tracer, muzzle flare,
  dust). Two camera-facing instanced draws, fire then smoke over it, with
  premultiplied blending so one shader does both alpha smoke and additive
  light: stacked flames saturate to yellow-orange, not white. Smoke is
  dimmed by the sky at night, and thins on screen over the player on foot
  (`effects.seeThrough`, a uniform), so a blast's smoke cloud, your own
  car's included, never hides your character. Counts scale with the tier's
  `particleScale`; explosions close together share one budget.
- **Ground marks** (`fxDecals.ts`): skid ribbons, scorches, bullet pocks
  and scrapes are quads in one ring-buffered mesh that fades them in the
  vertex shader (skids ~22 s, scorches ~75 s in their own 32-slot ring).
  Transparent and drawn first among transparents, i.e. after the ground;
  not drawn at all while no mark is alive. Scrapes dim at night (they're
  unlit).
- **Debris** (`fxDebris.ts`): panels in the exploding car's paint, chips,
  glass and brass casings as one instanced lit box mesh with bounce,
  friction and spin.
- **Fake lights**: ground flashes, shockwave rings, muzzle splashes, pickup
  rings and burning-car glows go into the shared glow mesh through
  `look.addGlowSource` (no draw call, no real lights).
- **Cars** (`fxCarBody.ts`, `fxDriving.ts`): bodies lean out of turns, dip
  under braking, squat on launch, lurch on impacts and hop and tumble in
  blasts, applied to the car root (Euler order YXZ) after main.ts places
  it. Rear wheels lay skid marks when sliding, handbraking, braking hard
  or spinning up; tyre smoke on a real slide; dust off park lawns; wind
  streaks past the player above ~65% of top speed; damaged cars smoke,
  burning ones flame with embers and a flickering glow (stronger at
  night), wrecks burn down and smoulder.
- **Camera** (`cameraRig.ts`, `fxMotion.ts`): trauma shake (smooth noise ×
  trauma², slight roll), directional kicks on springs, FOV punches; fed by
  crashes (by impact), explosions (by distance), gunfire (a little recoil)
  and getting hurt; behind the title only the flash plays. Look-ahead per screen axis, soft-limited to a share of
  what's visible on that axis, with velocity feed-forward so it never
  trails the car. Measured on the iPhone profile at 86 km/h: 1.45 s of road
  ahead driving up the screen (car at 79% of the height), 1.36 s driving
  down (car at 23%), 2.8 s across (car at 32% / 68% of the width); the car
  never reaches the bottom corners where the thumbs are. On foot the
  camera sits at 20–24 m on a phone and 27–31 m on a desktop (a 16:9
  screen sees less across: ~42 × 23 m, so 22–24 m NPC gunfights stay in
  view), and lifts 5 m (desktop 7 m) with a gun out and 3.5 m in a recent
  fight. Mouse aim leans the view toward the cursor (`rig.aimAt`: 30% of
  the cursor's ground offset, at most 8 m, eased), so you see what you
  shoot at.
  `prefers-reduced-motion` keeps a third of the shake, no roll or FOV
  punches, and softer exposure and combo-edge flashes. A blast out of
  sight (over 55 m from the view centre) doesn't flash the screen.
- **Hit-stop** (`HitStop` in `fxMotion.ts`): 40–80 ms of near-frozen sim on
  close or player-caused explosions, heavy crashes and knockouts; overlaps
  keep the longest hold and a cooldown stops chains turning into slow
  motion. Shake and the HUD keep real time; the camera's follow slows with
  the sim (`rig.timeScale`), so the view freezes with the car instead of
  running on ahead of it. Crash sparks start just above roof height so the
  hit's first frames aren't hidden inside the two cars.
- **Weather** (`fxWeather.ts`): every few minutes a shower of a minute or
  two eases in; streets get wet behind it (`uWetness`) and dry slowly:
  everything darkens, and ~3 m puddles gather along the gutters (few
  mid-road, hardly any on pavements) with a faint sky sheen by day and a
  cool one at night. Rain is one instanced draw animated in the vertex
  shader (world-anchored streaks that fan out from the view centre, plus
  small faint splash rings); exposure dips a little; `audio.setRain` adds
  a hiss-and-patter loop.
- **Overlay** (`src/ui/fxOverlay.ts`, `fx.css`): screen-edge flashes at the
  ×5 and ×10 combo, animated with the Web Animations API.
- **Stamps**: on a `stamp` event the director holds the sim for 0.12 s
  (the stamp slams down in it), flashes the edges in the stamp's ink and
  adds a little shake. See *Named mayhem* below.

Budget: at most 5 draw calls for all of it (fire, smoke, debris, ground
marks, rain), each skipped when empty, and no program
compiled after start-up (they are all built at warm-up). Measured in
Chromium with `?debug`, whole frame (iPhone 15 Pro profile, 'medium' tier,
then desktop 'high'):

| Moment | iPhone | Desktop |
|---|---|---|
| One car exploding next to you (before → during) | 43 → 45 | 56 → 59 |
| Five-car chain reaction, peak | 51 → 55 | 66 → 67 |
| SMG and shotgun fight with two armed NPCs | 52 | 61–63 |
| Mid-drift with skid marks and tyre smoke | 47–51 | 61–63 |
| Rain, day / night | 44 / 48 | 60 / 63 |

A five-car chain peaks at ~280 fire, ~180 smoke and ~60 debris particles
on the phone tier (pools hold 900 / 700 / 128).

**Particle budgets** (`quality.ts`, applied by `Effects.applyBudget`). On a
phone the cost of mayhem is fill, not draw calls or JS: big translucent
quads stacked over the screen. `Effects.fill` estimates it each frame
(each drawn quad's area over the visible ground's, a quad counting bigger
the nearer it is to the camera: screens of overdraw). It matches a count
projected through the camera for one blast (5.6 vs 5.4) and reads high
while a chain's smoke is high up (8.7 vs 5.7), which only makes the
budget act a little early. Over the tier's fill budget, big particles
(over 2.5 m) age up to 4× as fast (fully at 1.5× the budget) and new
smoke is held to `smokeMaxOver`; in a chain (another blast within ~¼ s)
the later blasts' smoke and their fireballs' after-smoke are held to it
at once and live 0.65 of their life, since a chain's smoke peaks seconds
after the budget could see it. Fires on screen beyond `fullFires` share
that many fires' flames, smoke and embers, and only the first
`chainLights` blasts of a chain get fake lights. High is the look as
designed (no budget); one car blowing up stays under the medium budget,
so normal play looks the same.

| Tier | particleScale | live fire / smoke | fill budget | smoke max (always / over) | full-rate fires | chain lights |
|---|---|---|---|---|---|---|
| high | 1 | 900 / 700 | none | – / – | all | all |
| medium | 0.75 | 700 / 500 | 7 screens | – / 5 m | 3 | 3 |
| low | 0.5 | 480 / 340 | 4 screens | 4.5 / 3.5 m | 2 | 2 |

Measured with `tools/tune/mayhem.mjs` (iPhone profile, 36 s: four cars and
three walls at once, two cars at 8 s, two cars and a wall at 16 s; six
fires, fire trucks; god mode, destruction test on; peaks unless noted).
Fill is projected through the camera, in screens (`--dpr 1`: fill and
draw calls don't depend on it); before = 0.11.0 with the logging only:

| Tier, time | live fire / smoke | fill peak | fill mean | glows (fill) | draw calls |
|---|---|---|---|---|---|
| medium, day | 327 / 295 → 277 / 256 | 15.2 → 5.7 | 2.32 → 1.25 | 46 (9.7) → 42 (4.9) | 56 → 56 |
| medium, night | 317 / 295 → 277 / 256 | 15.2 → 5.7 | 2.39 → 1.32 | 50 (9.8) → 50 (5.0) | 59 → 59 |
| low, day | 186 / 133 → 169 / 115 | 8.7 → 2.4 | 1.57 → 0.69 | 43 (8.4) → 39 (3.6) | 32 → 32 |
| low, night | 197 / 133 → 169 / 115 | 8.7 → 2.4 | 1.57 → 0.70 | 52 (8.5) → 52 (3.8) | 35 → 35 |
| one car, medium | 66 / 50 → same | 5.4 → 5.4 | 1.33 → 1.33 | 27 (1.6) → same | 47 |
| one car, low | 46 / 33 → same | 3.8 → 1.6 | 0.95 → 0.56 | 27 (1.6) → same | 27 |

Nearly all of it is smoke: the blasts' columns and the fireballs'
after-smoke (up to ~10 m quads, rising toward the camera); flames are
under 0.1 screens even with six fires. Without the living city's fires
(`--no-city-fires`, medium, night) the same run peaks at 14.5 with a mean
of 1.96: its fires (each wreck and hit wall burns 75 s) add ~20% to the
mean fill, ~20% more live fire particles and eight glows, but the peak is
the blasts', as it was before the city.

**Low-resolution smoke** (`render/lowResFx.ts`; the pure plan, cost model
and switch in `lowResFxPlan.ts`, tested). On tiers with `fxScale` under 1
(medium and low: 0.5; high draws them with the scene) the soft particles
(smoke, dust) can render before the scene into a half-size target with no
MSAA: colour plus their alpha-weighted view depth, depth-tested against
every building as an instanced box (one depth-only draw). A composite then
lays them over the scene, one instance per covered tile of a 16×8 grid,
with `gl_FragDepth` at the smoke's mean depth less 3 m, tested against the
real depth: crisp building edges, no halo, and cars don't notch it. Each
frame it projects the particles' quads to tiles and goes offscreen only
when that saves fill (with hysteresis), so normal driving costs nothing. On
phones the target is flagged as an XR target so the particles tone-map and
encode as on the canvas; it needs `EXT_color_buffer_(half_)float`, else
smoke stays full size. The programs are precompiled with the scene's
(`Look.precompile`, also after a lost context) and the target follows the
drawing buffer. `look.lowFx.mode` (`auto`, `off`, `on`) is for tests and
screenshots. Smoke work is in full-resolution screens of fragment work
(offscreen: fill × scale² × 1.25 for the depth output, plus the composite's
tiles); 0.12.0 → 0.12.1, same seed, day, iPhone profile:

| Run, tier | smoke fill → work, peak | mean | frames offscreen | draw calls (peak) |
|---|---|---|---|---|
| mayhem, medium | 7.41 → 3.06 | 1.25 → 0.79 | 50% | 60 → 60 |
| mayhem, low | 2.40 → 1.50 | 0.59 → 0.51 | 20% | 31 → 33 |
| one car, medium | 5.60 → 2.04 | 0.55 → 0.28 | 85% | 52 → 54 |
| one car, low | 1.61 → 0.74 | 0.23 → 0.18 | 36% | 29 → 31 |
| driving (tyre smoke), medium | 0.35 → 0.34 | 0.06 → 0.06 | 0% | 58 → 58 |

Shots of the same frame drawn both ways differ by under 1/255 on average.
Low stays at half scale: a quarter roughly halves its smoke work again but
softens the smoke visibly. The occluder boxes ignore breach holes, parapets,
rooftop kit and trees; the XR-target flag leans on three r186 internals
(recheck on an upgrade).

API for other systems:

```ts
effects.explode(x, z, paint?)              // the whole blast sequence (FxDirector does this on 'explosion')
effects.sparks(x, y, z, n, lo, hi, dirX, dirZ) / effects.embers(x, z, n, lo, hi)
effects.muzzleFlash(x, z, dirX, dirZ, power) / effects.tracer(x1, z1, x2, z2, kind)
effects.burst(x, z, r, g, b, n, radius)    // sparkle + ring (pickups, rewards)
effects.light(x, y, z, r0, r1, r, g, b, life, GLOW.disc | GLOW.ring)  // a fake light
effects.seeThrough(x, y, z, radius)        // thin smoke over a point on screen (FxDirector: the player on foot)
effects.decals.stamp(x, z, r, angle, opacity, life, DECAL.scorch)
rig.addTrauma(0..1); rig.kick(dirX, dirZ, metres); rig.punchFov(degrees)
fx.hitStop.hit(seconds, slow?)             // slow the sim for a moment
fx.setRain(true | false, seconds?)         // start or stop a shower (missions, debug)
fx.overlay.edgeFlash(cssColour, strength)
```

### Named mayhem (stamps)

The player's biggest bits of chaos get a name stamped across the middle of
the screen, and passers-by in view stop and film it. Rules and table in
`systems/stamps.ts` (pure, `tests/stamps.test.ts`), the bus wiring in
`game/stamps.ts`, the element in `ui/stampHud.ts` and `stamp.css`.

| Stamp | For | Weight |
|---|---|---|
| BONFIRE NIGHT | six cars going up in one chain | 9 |
| TAKE THE HEAT | the chase handoff (V2-03, via `show`) | 8 |
| CITIZEN'S ARREST | the chase handoff (V2-03, via `show`) | 8 |
| ENDANGERED PANDAS | three police cars wrecked in one pursuit | 7 |
| HEALTH AND SAFETY | a blast of yours within 20 m of a fire crew hosing | 7 |
| BARBECUE SEASON | three cars going up in a chain (each within 2.5 s of the last) | 6 |
| FARES PLEASE | three people knocked down by your bus within 3 s | 6 |
| BLUES AND TWOS | five stars (once a pursuit) | 6 |
| BANK HOLIDAY | four car-on-car crashes within 3 s and 30 m of one of yours (only your first counts) | 5 |
| ABSOLUTE SCENES | the combo reaching ×10 | 5 |
| NOTHING TO SEE HERE | shaking off a chase of 3+ stars (the EVADED bonus) | 5 |
| HAVE-A-GO HERO | the mugging bag handed back (V2-03, via `show`) | 5 |
| RACE CRASHER | a street race joined and won (V2-12, its award) | 6 |
| VAN NICKED | the city's ice cream van driven off from its queue (V2-12, its award) | 4 |
| NEIGHBOURHOOD WATCH | three gang members knocked down within 5 s | 4 |
| FREQUENT FLYER | a STUNT worth 3,500+ | 4 |
| BOWLED OVER | four people knocked down by a car within 3 s | 3 |
| LAST ORDERS | three people punched down within 6 s | 3 |

- **Detector** (`StampDetector`): reads `explosion`, `award`, `crash`,
  `pedDown`, `wanted`, `stunt` and `street` (hose / fireOut) for the
  player's own doing only, with fixed-size windows (`Burst`: n within a
  span, fires once and re-arms after a gap; `Chain`: links within a gap).
  Car explosions only count toward a chain (a grenade on an empty road
  doesn't). A respawn or a bust forgets what's half-counted.
- **One at a time** (`StampArbiter`): at most one every 4 s; the heaviest
  offer in a frame wins; a heavier one within 0.6 s of a lighter one
  replaces it; anything else waits out the cooldown and is dropped once
  1.5 s old.
- **Out**: `Stamps.step()` once a frame emits the winner as `stamp {id, x,
  z}` (the player's position), only in play, alive and free. Listeners:
  the HUD, the fx director (hit-stop, edge flash), `GameAudio` (a rubber
  stamp thunk and a quick chord, the music ducked) and the witnesses
  (filming). Stamps are on in every mode, the Chaos Run included.
- **HUD**: one element built once; a stamp swaps its text and restarts a
  CSS animation (two copies of the keyframes, swapped, so no reflow):
  a 1.9 s slam, hold and fade, nothing running between stamps. Centred
  across, its top under the stars and their pop line (stepping down with
  them under the activity card and the radio's card) or at 42%,
  whichever is lower; a size down at 360 px tall and under, and again
  under the activity card on the phones (clear of the NOS button). Ink: red for
  mayhem, cyan for the have-a-go moments, blue for the police ones.

```ts
stamps.show('takeTheHeat')     // name a moment (cooldown and weights apply)
stamps.force('barbecueSeason') // now, whatever the cooldown (debug)
STAMPS[id]                      // { label, sub, weight, tone }
__ub.stamp('neighbourhoodWatch') // force one from the console / smoke test
```

### Best moment (the WASTED picture)

The life's best stamp is photographed as it lands and shown on WASTED /
BUSTED with its caption, to share. Ranking, caption and file name in
`systems/bestMoment.ts` (pure, `tests/bestMoment.test.ts`); the capture,
card and share in `ui/momentCard.ts` and `moment.css`.

- **Best**: the heaviest stamp of the life (the table's weight); a later
  heavier one replaces it, a tie keeps the first. A respawn (or a bust's
  release, PLAY, the title) starts a new life. No stamp, no picture.
- **Capture**: on the frame the better stamp lands (inside its hit-stop),
  `moment.afterRender()`, called in `main.ts` right after
  `look.render(camera)`, copies the WebGL canvas into one 2D canvas at most
  800 px wide (`MOMENT_WIDTH`) in the same task: no extra render pass, no
  `preserveDrawingBuffer`, and every other frame it is one branch. The
  canvas is reused for the life (≈1.2 MB at 800×369) and zero-sized on
  respawn. Headless Chromium copies in 0.1–1.5 ms; the session log gets a
  `moment` line with the copy's ms (and the JPEG's size and time).
- **Card**: on WASTED / BUSTED the title and numbers step left
  (`#wasted.has-moment`) and the photo sits on the right, tilted, with the
  stamp's name in its ink, its line in lower case and where and when
  (`NEON MILE · 21:07`, the district and the game clock); at 360 px tall
  and under a size down with a wider crop, centred between the score and
  the thumbs. The score's feed lines hide while it shows (the card has the
  numbers; they'd run into its corner). It drops in with the numbers.
- **Share**: the JPEG (quality 0.85, the caption burnt into a dark band at
  the foot, `curbside-<stamp>-<yyyymmdd-hhmmss>.jpg`) is encoded once, on
  WASTED, with `toBlob`; SHARE is live once it's ready. It goes through the
  bug report's path (`shareFiles`, then `saveFiles` if the sheet refuses or
  is missing): SHARED, SHARE again after a cancel, or SAVED. While the
  sheet is up the respawn waits (`moment.simScale()` is 0 and the timer bar
  pauses; at most 60 s). Touch, mouse and VoiceOver; no pad binding.

```ts
__ub.moment.picture   // the life's photo (a canvas) or null
__ub.moment.best      // BestMoment: { has, moment: { id, x, z, hour } }
__ub.moment.copyMs    // the last copy's cost; encodeMs: the JPEG's
```

## Destruction test

A prototype, **off by default**: a combat blast near a building blows a
crater out of its facade and throws rubble onto the pavement, with real
rigid-body physics (Rapier 3D, `@dimforge/rapier3d` 0.20, loaded only when
the test is on). It stays a test until a 15+ minute soak on the iPhone
shows no throttling and the rubble reads as broken masonry rather than
clean boxes (`docs/HANDOFF.md`).

- **Same rules everywhere** (`systems/breaches.ts`, pure, tested):
  `BreachSystem` listens for `explosion` (cars, grenades, rockets; molotovs
  make none) and, while the test is on and a run is being played (never in
  attract), emits `breach` for the nearest building face within reach.
  Where (the face's nearest point, 1.3–1.8 m up by kind, above the shop
  windows; a crater that would reach a shopfront awning goes above it, at
  least 2.8 m + half its radius and under the roof line, since the
  near-overhead camera can't see under an awning), how big (radius by
  kind, strength and distance, capped at 45% of the face and 2.4 m; depth
  ≤ 1 m and ≤ 30% of the building) and the seed
  come from the blast and the city (awnings from `planBuildings`) alone, with no randomness, tier or
  device input, and only `+ − × ÷ sqrt round imul` (bit-identical in every
  engine). Blasts on an existing crater grow it; 32 slots, the oldest goes.
  Building collision is unchanged: a breach is a shallow scar, not a hole
  you can drive into. No score, heat or haptics: the explosion already did
  all that.
- **Presentation** (`render/destruction.ts`) subscribes to `breach`: the
  scar, dust, and either Rapier chunks or debris chips. Rubble is
  presentation only: cars push it (each car within 14 m of live rubble is
  a kinematic proxy of two boxes, its body up to the hood line and its
  cabin, sized from its model in `vehicles.glb` and driven from `v.sim`;
  a proxy only moves once its car has moved ~1 cm or turned, so a parked
  car lets the pile beside it sleep), nothing in the rubble world is ever
  written back, and people have no proxy (chunks may clip them). The
  blast's own debris is lumps of the wall, not car panels, when it
  breaches one with no car in it.
- **The scar** is drawn by the building shader itself
  (`render/breachScars.ts`, behind `#ifdef CURBSIDE_BREACH`): two `vec4` per
  slot, a per-building bit mask in the vertex stage and half an ellipsoid
  with a ragged rim in the fragment stage, so it costs no draw call, is lit
  like the wall (sun, shadows, street lamps, bloom), wraps round a corner
  and never z-fights. With the test off the city draws with the program it
  always had; on at boot the variant is the one compiled at boot; switched
  on mid-session (always from the paused sheet) it compiles once, behind
  the card (+1 program for the session), and switched off after a boot
  with it on, the plain program does the same. Scars last the run (a
  fresh run or switching off clears them).
- **Rubble** (`rubbleBatch.ts`, `rubblePhysics.ts`, `rubblePlan.ts`): one
  `InstancedMesh` of rough faceted lumps (one hand-built hull: uneven
  corner cuts, pulled in, sheared, each face broken round a raised or
  dented point, facet normals tilted, so no face is one evenly lit square)
  on the city's prop material (no new program): blocks, plates and shards
  in the breached wall's colour (each with 15–45% of the core showing
  through, its tint wandering a little), some bare concrete or brick core,
  scorched near the centre and a share more at random, shaded 0.35–0.85;
  under them a **spill** on the pavement (`DECAL.spill` / `spillBrick` in
  the ground-decal layer, its own ring after the scorches, so no draw call
  or program of its own: dust and angular gravel stones with a shadow each,
  densest at the wall, 200 s, in every style including `low`); +1 draw
  call (+1 in the shadow pass in the desktop style) while any is on
  screen, and its buffers go up only on frames where something drawn
  changed (a settled pile uploads nothing). About
  60% slump: they start in the crater's lower half and barely leave the
  wall, so the pile lies at its foot; the rest fly, most not far (the
  phone style's heavy chunks hop at most 2 m/s). Under a raised crater
  they start past the awning. Its own fixed 1/60 clock fed with
  sim-scaled time (pause, cards and hit-stop freeze it), at most two steps a frame, none
  while nothing is awake and no car near it moves. Nearby buildings become
  static boxes. One breach spawns per frame (a chain queues, 8 at most).
  Awake bodies come from Rapier's active islands, their poses through its
  scratch-buffer getters into one `Float32Array`; drawing reads the typed
  arrays by slot and allocates nothing. Rapier calls do box their handle
  and float arguments in V8 (pose reads ~112 B per awake body per step,
  moving car proxies), bounded and gone once the pile sleeps.

| Per style | Desktop (`auto` on `high` and `medium`) | Phone (forced only) | Low (`auto` on `low`: scar + particles) |
|---|---|---|---|
| Chunks per breach | 14–40, 0.12–0.4 m skewed small (a heap of bits round a few lumps; 30% plates, 20% shards to 0.5 m), 45% core, 6% scorched | 3–7, 0.4–0.84 m (25% plates, 25% shards to 1.1 m), half core, 15% scorched, plus 4 chips | none: 4–10 debris chips |
| Live bodies at most | 200 (the oldest crumble away) | 36 | 0 |
| Life | 120 s, then removed once out of view | 7 s, then crumbles away (0.6 s: settles 4 cm and darkens, then flattens and shrinks into the pavement) | chips ~3 s |
| Settling | Rapier sleep; forced after 10 s unless a moving car is within 6 m | gone at 7.6 s | – |
| Car proxies | 6 | 3 | – |
| Rubble shadows | sun shadows (+1 call); contact shadows on the `low` tier, which has no shadow map | contact shadows (no call) | – |
| Dust (tinted by the wall) | a cloud of 26 puffs (to 3.8 m, 2.5–4.5 s), a ring at the foot and a haze over the pile (6–9 s) | a puff of 7 (to 2.2 m, 1–1.6 s) | a puff of 5 |
| Scar | rich: looks into the cavity (view-ray depth), shaded darker than the wall, cut floor slabs, rebar, a faint room light deep inside at full night only, a rim glowing hot for 3 s and embers along it for ~7 s, a wide chunky pale lower lip, wider darker soot | flat bowl, its lower half lit core, dark only at the upper back; broken chipped lip, chunky below; soot | flat |
| Scars drawn at once | 32 | 16 | 16 |

A breach beyond the last view + 20 m gets its scar but no rubble or dust.
`auto` is the desktop style on `high` and `medium`, so phones get it too
(an iPhone 15 Pro held 60 fps with it: *Measured on the device* below),
and scar-only on `low`. It follows the **live** tier per breach: with
Settings → Graphics on Auto (the default), DynamicResolution stepping a
struggling device down to `low` makes later breaches scar-only (the safety
valve) and restyles and re-caps the scars already on the walls, climbing
back undoes that, and `medium` ↔ `high` changes nothing. A fixed Med or
High never steps the tier (only the resolution), so it keeps the desktop
style. Rubble from before a drop to `low` lives out its life, on contact
shadows (`low` has no shadow map). PHONE and DESKTOP force a style on any
device; PHONE stays for comparison. Switched from the desktop style
(DESKTOP, or AUTO on `high` / `medium`) to PHONE, a phone breach evicts at
most its own chunk count, so the old pile thins out breach by breach, and
the batch keeps sun shadows while any desktop chunk is alive.

- **Switch.** `settings.destruction`: `off` / `auto` / `phone` /
  `desktop`, sanitised at boot. There is no Settings row: pause →
  DIAGNOSTICS (shown with the Perf overlay on, or `?debug`) →
  DESTRUCTION (TEST) has the four pads, **BLOW A WALL** (`ui/blowWall.ts`:
  a harmless rocket blast 1.4 m off the camera-facing wall ahead within
  25 m whose crater will show: on screen, below the top 12% and clear of
  the pause button and radar; on a phone stand 3–4 m from the wall.
  Nobody hurt, no heat; it goes off as the sheet closes, throwing lumps of
  the wall) and a live readout.
  BLOW A WALL says why instead with the test off, while Rapier is loading,
  or with no crater that would show (`__ub.blowWall()` then falls back to
  the nearest face within 40 m). `?destruction=<mode>` (bare = `auto`)
  overrides for the session without saving it; using the pads drops the
  override.
- **Loading.** Rapier is a lazy chunk (`rubbleLoader.ts`): loaded behind
  the title when the test is on at boot, or as it is switched on, never at
  a breach. The download starts at once (the build names the hashed files
  in a `curbside-rapier` meta tag in `index.html`, and they are fetched
  into the browser's or the service worker's cache); the import that
  evaluates them (the wasm instantiated on the main thread), the memory
  reserve, the warm-up and the rubble world wait for a pause or the title.
  Warm-up runs a throwaway world through every code path (the cold first
  step, 35–40 ms in Chromium, happens there) and DynamicResolution ignores
  those frames. Resume before a slow download lands and the readout stays
  at `rapier loading` (breaches get the `low` look) until the next pause,
  when the rest happens behind the card. The files
  (`assets/rapier-*.js` 34 KB and `rapier_wasm3d_bg-*.wasm` 774 KB gzip)
  are **not precached**: Workbox caches them on first use
  (`curbside-rapier`, CacheFirst, ignoring `Vary`), so phones that never
  turn the test on never download them, and it works offline after.
  If loading fails, or Rapier throws mid-play, breaches fall back to the
  `low` look and live chunks crumble away; the game carries on.
- **Measuring.** The Full perf overlay adds `rubble <live> · phys
  <avg>/<p95> ms` (physics per stepped frame: steps with their car-proxy
  moves, pose reads);
  `(q)` marks a coarse timer (WebKit rounds `performance.now()` to ~1 ms),
  when the readout's worst-second average is the number to read. The
  Diagnostics report has a `DESTRUCTION` summary line, `destruction` (all
  the stats) and `rapierFiles` (Resource Timing: transfer, encoded and
  decoded size, so a gzipped wasm and a cache hit are visible) in its
  JSON; session events log `destruction <mode> <style>`, `rapier ready
  <load>+<import>+<warm> ms` / `rapier failed`, `blow-wall …` and `warm <ms>`
  (shader warm-ups, at boot and on switching); samples add `rubble` and
  `physP95` while the test is on.
- **Budget** (headless Chromium + SwiftShader on 4 shared CPUs, BLOW A
  WALL at building 772's south face, by day): rubble adds +1 draw call
  while any is on screen (+1 more in the shadow pass in the desktop
  style), and the blast's own particles 2–4 for a few seconds. Desktop 61
  before, 64 at the blast, 60–64 over the next 5 s; iPhone profile with
  the phone style 45 → 46, then 38–46 (`auto` there is now the desktop
  style: 31 bodies, 44–53 calls, no new program); `low` 28 → 35 (chips
  and particles). People and traffic moving in
  and out of view swing these by ±5 between frames, so compare at the
  same moment (round 1's review measured 62 → 68 and 48 → 53, with car
  panels flying). Programs: with the test on at boot as many as off (34
  desktop, 25 iPhone profile, 23 `low`: the crater variant takes the city
  program's place); switched on mid-session +1 (35 / 26), or off after a
  boot with it on +1 (the plain program, behind the card), then nothing
  more compiles (breaches, merges, night, tier changes). Rapier's import
  (from cache) ~70 ms and warm-up 150–360 ms behind the card; the
  download, ~1.6 s at 4 Mbit/s for the ~770 KB wasm Pages sends (4.1 s
  served uncompressed), happens during play if need be. Physics per
  stepped frame while a breach settles: desktop 34 bodies avg 0.17 / p95
  0.5 ms, phone 7 bodies avg 0.10 / p95 0.3 ms; a desktop breach spawns
  in 1–6 ms, a phone one in 0.7 ms (BLOW A WALL, from 1.4 m, now throws 31
  and 6). A settled pile costs no steps and no uploads, with or without a
  parked car by it. The device is what counts:
- **Measured on the device** (one 2.5-minute session, build `0e8bf2c`:
  iPhone 15 Pro, home-screen app, iOS 18.7, tier `medium` at 1.50x,
  DESKTOP forced): 59.9 fps, frame p50 17 / p95 17 / p99 18 ms, JS p95
  4 ms, 0 hitches/min overall (one hitch in the session, below); 145
  rubble bodies alive, none awake once settled; physics avg 0.28 ms,
  worst one-second average 0.58 ms (p95 reads 1.00 ms only because iOS
  timers have 1 ms resolution, the `(q)` flag); 46–59 draw calls with
  rubble (budget 150). Rapier load 880 + import 33 + warm 34 ms; Pages
  serves the wasm compressed (770 KB transferred for 2.02 MB decoded,
  ~222 ms), and the second load came from the runtime cache; switching
  modes warmed in 3 ms (no shader compile).
  One 10 s window after the second DESKTOP blast dipped to 57 fps, p99
  26 ms (one hitch), then recovered. Not measured yet: thermal throttling
  over 10+ minutes.

Test hooks on `window.__ub`:

```ts
__ub.destruction.setMode('desktop')      // off | auto | phone | desktop (saved; drops ?destruction)
await __ub.destruction.whenReady()       // 'ready' | 'failed' | 'idle'
__ub.blowWall()                          // the harmless blast at the wall ahead, now; the face or null
__ub.destruction.stats()                 // style, rapier, live/awake/sinking/drawn, scars, phys avg/p95/max…
__ub.destruction.settle(seconds)         // step rubble now, no render
__ub.destruction.lastBreach              // {x, y, z}: aim the camera, crop screenshots
__ub.breaches.slots / .count             // the sim's craters
__ub.setQualityTier('low')               // force a tier ('auto' follows it)
```

## UI

Plain DOM over the canvas, one stylesheet per area (`tokens.css` for the
shared palette and safe-area edges, `title.css`, `menu.css`, `hud.css`,
`radar.css`, `touch.css`). `FrontDoor` (`src/ui/frontDoor.ts`) owns the
flow between title, pause, settings, how-to, rotate and countdown and
routes keyboard / gamepad navigation (`Input.consumeNav`) to whichever
screen is on top; `main.ts` hands it a few hooks. The HUD only writes to
the DOM what changed since the last frame; nothing in the per-frame paths
allocates.

Buttons act on taps, not clicks. A browser only makes a click from a lone
finger, and in play a thumb is nearly always on the stick or the pedals, so
`onTap(el, fn)` (`src/ui/tap.ts`; the decision, `tapTracker.ts`, is
unit-tested) judges touch and pen presses from pointer events: lifted within
14 px of where it landed, within 1.5 s, still over the button, its list not
scrolling (nor flung just before). `fn` runs in the touchend that follows (a
user gesture on every engine) and that touchend is cancelled, so no click
acts twice or lands on whatever the tap uncovered. With several fingers on
buttons the first to lift as a tap acts and the rest lift as nothing; a lone
finger held longer than 1.5 s is left to the browser's click, as before.
Mouse, keyboard and VoiceOver still arrive as click. `onTap` drops focus
before `fn` (so Enter can't click a mouse-focused button as well).
`MenuNav.add` uses it for every item; a new one-off button should too, never
a bare `click` listener.

Safe areas come from `env(safe-area-inset-*)` through `--safe-t/r/b/l` on
`:root`; a test can override those to emulate a notched phone
(`safeArea.ts` reads them back for JS layout). The touch layout is checked
at 852×393 and 852×340 (Safari's toolbar showing).

API for other systems:

```ts
// Look
look.time.set(22); look.time.speed = 0   // pin the clock (missions); speed is game hours per second
look.time.hour                           // current hour, 0..24
look.cars.setSiren(vehicle, on)          // police light bar + red/blue wash on the road
look.lighting.sky                        // current SkyState (night, exposure, ...)
worldUniforms.uWetness.value = 0..1      // wet roads (shaderLib.ts)
look.exposureBoost = 1.8                 // flash multiplier on the sky's exposure (ease it back to 1 yourself)
look.addGlowSource((glows, view) => …)   // add faked lights each frame: glows.addFlat / addUpright (glowSprites.ts)

// UI
frontDoor.title.addMode({ id, label, sub?, onSelect })   // a mode under PLAY (e.g. CHAOS RUN); removeMode(id).
                                                         // Picking it starts a fresh run like PLAY, then calls
                                                         // onSelect() to set the mode up on top of it.
frontDoor.play(mode?)                                    // the PLAY path itself (closes the title, fresh run)
onTap(el, fn, { clickOnly? })                            // a button that works with a thumb on the stick (tap.ts)
radar.setBlip(id, { x, z, kind?, colour?, icon?, pulse?, edgeArrow?, size? })
radar.removeBlip(id)
radar.setWaypoint(x, z) / radar.clearWaypoint()          // route along the roads + rim arrow when off-radar
hud.score.notice(text, kind?)                            // a feed line without points
scanner.setEnabled(on)                                   // the police scanner's lines and pings (City life, Police scanner)
haptics.pulse(strength0to1, ms)                          // also fired by crash / explosion / shot / hurt events;
                                                         // haptics.enabled is off behind the title
```

Kinds: `objective`, `enemy`, `police`, `pickup`, `friend`, `shop`, `race`,
`marker` (each has a default colour).

**Title highlights** (`game/attractHighlights.ts`; when and which is
`ui/attractShow.ts`, pure and tested; the camera is `ui/titleCamera.ts`).
Behind the title the camera cruises after traffic (`ui/attract.ts`); after
10–14 s, then every 15–25 s of cruising, it cuts to something happening:
a police chase (the getaway; a scooter one in four), a street race (the
leader, then the winner), a car fire and its truck (framed together as the
truck comes in), a turf war, an accident and the argument, the ice cream
van and its queue, a bus pulling in at a stop, a busker and the crowd, a
mugging (the mugger), stray dogs after a runner. A shuffled round, never the
same twice running. The scene is started round the camera with the TEST
menu's `SceneStarter`; `CityLife.featured` lifts its holds (the title, the
cold open) and its people gather (`lively`), every other scene
stays held, so there's one at a time. It's followed through its
`subject()` until that says it's over (then 3 s more) or for 25–40 s; one
with nothing to show 8 s after starting, or that won't start, is skipped
for the next (four refusals in a row: cruise again). Close by and on
screen the camera glides over; otherwise the city fades out over 0.3 s
(`.title-fade`, under the menu), the camera jumps and the streets are
filled round it, and it fades back in over 0.5 s. A caption fades in for
~4.5 s under the version, top right (`POLICE CHASE` / `NEON MILE`: the
district). A scene the show moved on from is reset once out of view (or
after 30 s); the fire, the turf war and the dogs wind down by themselves.
Highlights start only with the title open (not under Settings or How to
play). PLAY stops the show, clears `featured` and resets every scene with
the run (no title actors, no stars).
**Framing:** what the camera follows sits in the middle of the free area
right of the menu column, not the screen centre: `TitleScreen.menuRight`
(`.title-main`'s right edge in px, measured by a ResizeObserver, never per
frame) → half of it in px (`freeCentreOffsetPx`, capped at 70% of the width)
→ ground metres through the rig's camera (`groundPerPx`: height, tilt, FOV,
aspect; exact on the ground line through the look point, checked against the
projection at 852×393, 852×340, 1280×720 and 1920×1080) taken off the
camera's x, eased (`TitleFraming`, 2.5/s) as the layout changes or the
title closes. A gentler look-ahead behind the title (`LEAD_ATTRACT`; FxDirector
only sets the lead in play) and no lead of the attract camera's own on a
highlight keep a racer at 30 m/s in that area on a 340 px-high screen; in
play the rig is as before.

```ts
__ub.highlights.show.phase / .current   // 'cruise' | 'cue' | 'watch' | 'linger'; the highlight id
__ub.highlights.show.timing             // SHOW_TIMING: cruise, first, settle, watch, linger, tries (mutable for a test)
```

### Observe mode

OBSERVE (`ui/observeMode.ts`; the pure logic is `game/observe.ts`, tested
in `tests/observe.test.ts`) hands you the camera over the live city with
no player: no HUD, radar, score, stars or touch controls
(`body[data-scene='observe']`). It's on the title beside CHAOS RUN
(`TitleScreen.addEntry`: laid out like a mode, starts no run) and in the
pause menu (`PauseOverlay.addButton`), both once the cold open has run or
whenever Test tools are on (`ObserveDeps.offered`, from
`ProgressDirector.offer`).

| | Keyboard & mouse | Touch | Gamepad |
|---|---|---|---|
| Pan | WASD / arrows, or drag | one-finger drag | left stick |
| Zoom | wheel, Z / X (or + / −) | pinch | right stick up / down |
| Rotate | Q / E | two-finger twist | right stick left / right |
| Follow a car or person | click it; F or Enter: what's in the middle | tap it | A: what's in the middle |
| Next incident / start one / time / rain | N / I / T / U | the strip | Y / X / RB / LB |
| Leave | Esc, or EXIT | EXIT | B or Start |

**Camera.** `ObserveCamera` holds where it looks, its height and its yaw
(`CameraRig.yaw` turns the view; 0, as in play, keeps screen-up along
world −Z). A held pan eases to a speed of 0.9 m/s per m of height, at most
70 m/s (the streets fill round the camera at that pace); a drag keeps the
ground under the finger (`groundPerPx`); wheel and pinch zoom by a factor.
Every frame it's clamped: the focus stays over the city (±`HALF_EXTENT`),
the height between 12 m over open street and the tier's cap, and 8 m over
the tallest roof within 14 m of where the camera itself is (behind the
look point by its tilt, a little ahead of a pan: `roofFloor`). The rig
eases to it with no look-ahead and a quicker zoom (7/s); over 46 m
`Look.fogPush` pushes the fog out by the difference so the streets stay as
clear as from play height.

**Zoom-out per tier** (`OBSERVE_MAX_HEIGHT`): high 150 m, medium 130 m, low
100 m. Draw calls grow slowly with height; what bounds it is the streets
(the crowd lives within 60 m of the focus, traffic within 160 m) and the
phone's fill. Measured (SwiftShader, a fire and a chase on, worst of noon,
22:00 and 03:00, rotated 0° and 45°): `medium` at 852×393 peaks at 84 draw
calls at 130 m (81 at 110 m), `high` at 1280×720 at 108 at 150 m. The
smoke test checks the widest zoom, turned 45°, on every profile.

**The city lives with nobody playing.** The attract camera stands in as the
focus (`attract.active`: heat, combat, the crowd's target, stamps and the
marker all see "not playing") and is moved with this camera
(`attract.jump`), so Population, the scenes, `simLod`, the sound and the
pigeons work round where you look. `CityLifeDeps.observing` makes
`CityLife.live` true: no title, tutorial or activity holds, nor stars, and
people gather (`lively`) and fights, muggings, the food carts' rushes and
the ambulances' patients start as in play; anything that waits on the
player (`d.playing()`: handing a bag back, the film shoot made real, turf
on you) stays off. Over 64 m, `Population.maintain` keeps its spawns out
of a view shrunk about the focus to what 64 m sees (`spawnShield`,
`MaintainContext.spawnView`), not all of it: from high up the spawn rings
lie inside the view and the streets would empty (someone may appear at the
far edge, a few pixels tall). Nothing vanishes inside the real view. After
a long pan (over 110 m), once the camera slows, the streets are filled
round it (`maintainPopulation(true)`).

**Follow.** A tap or click (under 10 px and 450 ms) picks the car or person
under it (`pickFollow`: footprint plus a slop that grows with the zoom,
nearest edge first, a person over a car about as near); the camera rides
along (velocity fed forward, the gap closed, up to 80 m/s) until you pan
or drag, or it's recycled. NEXT INCIDENT visits the running scenes with a
`subject()` in turn (`nextLive`) and follows it: close and on screen it
glides, otherwise it fades across like the title's cut (0.3 s out, jump,
streets filled, 0.5 s in) with a caption (`POLICE CHASE` / `NEON MILE`).
Nothing on: it starts one of the title's highlights near the camera (its
hours kept), as the show would.

**Start.** START opens a palette of every city scene (the TEST menu's
`SCENES` but rain, the V2 incidents included), started round the camera
with `SceneStarter.start` like the TEST menu but with no test tools and no
taint. A scene with a subject is followed into view (one that has nothing
to show yet, a turf war gathering or a fight squaring up, is waited on for
up to 10 s); the ambulance, the alarm and the food carts happen round the
point. Some need the spot (an accident wants two cars close, a bus a
shelter near), as in the TEST menu. TIME moves the day on to the next of
dawn, noon, golden hour, dusk, night and the small hours (`nextHour`);
RAIN starts or stops a shower at once (for 10 minutes, then the weather's
own cycle).

**No UI in the way.** One strip (EXIT, NEXT INCIDENT, FOLLOW / LET GO,
START, TIME, RAIN), key or pad hints under it, a result line over it; it
fades after 4 s without input (`IdleFade`; not while the palette is open)
and comes back on any key, mouse move, touch or stick. The district's
name shows top right as you cross into it. Labels hide under 700 px wide,
the hints at 340 px high.

**Leaving** (EXIT, Esc, Start or B: `ObserveMode` is a sheet on FrontDoor's
stack, the palette over it) restores what you came from. From the title:
its camera and show start again where you are, its menu opens. From a
paused run: the run was held all along. `holdsRun` makes main.ts skip
heat, score, stunts, nitro, the activity's clocks (`progress.step`,
`simScale`) and the player's own step and collisions, and treat the
player's car, the activity's cars, the police units' cars and any road
rager after the player as held (`held(v)`): not driven, not hit, not hurt,
put back where they were each step. On the way out each held car's state
and damage, the player on foot, the hour and the weather are put back as
they were on the way in, the streets are filled round the player, the
camera snaps back to its spot and height, and the pause menu is up again.
An app switch while observing doesn't pause (nothing to lose; from the
title it's also a safe point for an app update).

```ts
__ub.observe.enterFromTitle() / .enterFromRun() / .exit()
__ub.observe.cam                          // ObserveCamera: x, z, height, yaw (clamped every frame)
__ub.observe.next() / .spawn(sceneId) / .nudgeTime() / .toggleRain()
__ub.observe.active / .holdsRun / .held(vehicle)
```

