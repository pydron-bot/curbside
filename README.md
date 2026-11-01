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
no page or console errors, under 150 draw calls; then installability and an
offline boot from the service worker. ~3 min. CI (`.github/workflows/ci.yml`)
runs it with the unit tests, types and GLB contracts on every branch and pull
request; Pages (`pages.yml`) runs the tests and contracts before deploying
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
| Switch weapon (also in a car) | wheel, right click, Q / Tab (Shift+Tab back) | ⇄ | RB / LB |
| Enter / exit car | E / F / Enter | door button (pulses next to a car) | Y |
| Steer | A/D, ←/→ | **Point** (default): stick = where to go, push further = more gas; **Classic**: stick left/right | left stick |
| Gas / brake-reverse | W/S, ↑/↓ | pedal pad: GAS / BRAKE — slide between them without lifting | RT / LT |
| Handbrake (+ gas from a stop: burnout) | Space | HAND, or the DRIFT band (GAS + HAND with one thumb) | A |
| Nitro | Shift in a car | NOS (fills the button) | B |
| Pause | P / Esc | ❚❚ top centre (also automatic on app switch / portrait) | Start (B resumes) |
| Menus | arrows + Enter, Esc / Backspace back | tap | D-pad / left stick + A, B back |
| Next radio station | R | tap the "now playing" card (it shows as a chase comes in: tap it for the radio) | Select / View |

Settings (title or pause menu): master / effects / music volume, sound with
the iPhone silent switch on, graphics quality, touch steering
(point / classic), left-handed layout (mirrors the controls and the HUD),
perf overlay (Off / FPS / Full); under TESTING, Test tools (TEST in the
pause menu, below). In the
header, VERSION HISTORY: every release from `core/changelog.ts`, newest
first (the version also shows top right on the title screen and on the
pause card). Playtest labels over what the city's people and cars are
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
off and calls the truck; the tow leaves a car for the truck; RAIN CROWD
turns the rain on; TURF WAR still waits for its holds). SAVE: +1 CRED
level, max perks, reset CRED, +$10,000, unlock all jobs, jump to any story
job (it becomes the next job; you land by its payphone), tutorial done /
reset, reset the save, export (share sheet, else clipboard) and import (a
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
  SMG, shotgun, grenades, molotovs and rockets, plus health, armour and
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
  traffic) with PLAY, a mode list other systems extend, settings, how to
  play, the best score and a small MORE AT DEEEK.ORG link to the hub (title
  only, never the pause menu); the first tap unlocks audio, shaders are warmed
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
(POINTS LOST on a bust, the HOSPITAL bill or CASH FINE). Circular north-up radar
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
  checkpoint races, hot-car exports, taxi fares and thirteen payphone missions in two chapters
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
owned), weapons (capped: pistol 120, SMG 300, shotgun 48, grenades 12,
molotovs 10, rockets 8).

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
carjack +0.35, a shot +0.05 (at most +0.5 per 5 s), an explosion you
caused +0.6 (not your own car going up, even after you bail out of it
burning: `explosion.ownCar`), clearly ramming a police car
+0.6 (bumps in a chase don't count, nor does smashing through a roadblock
or a chasing cop driving into you), bullets into one +0.15 (capped),
knocking down an officer +1 (at most +1 per 5 s), wrecking a police car
+1; stealing one sets at least 1★. Knocking a civilian down and carjacking
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
for losing a 3★+ chase. **Audio:** a star gained plays the star sting, a
chase lost or resprayed the success chime, BUSTED its own sting (cuffs,
cell door) with the world muffled; the wanted level is the music's
intensity floor; sirens wail, yelp when ramming, two-tone when boxing in
(the nearest five); the helicopter has a rotor loop (`audio.rotor(x, z)`);
honks are `horn` events. **HUD** (`ui/wantedHud.ts`, `wanted.css`): five
stars under the pause button that flash in with a "WANTED / HOT PURSUIT /
ROADBLOCKS / SWAT / CHOPPER" pop, blink while you're out of sight, fade
with "EVADED"; arrest and respray meters. Radar: flashing police cars,
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
heat.shops / heat.station                 // landmarks (world/landmarks.ts)
// Bus: { type: 'wanted', level, prev, reason } · { type: 'busted', fine } · { type: 'horn', x, z, duration }
//      { type: 'respray', x, z, cleared }; pedDown/explosion/bulletHit/enterVehicle carry `cop` / `police` flags.
```

## City life

The city getting on with its day around the player, none of it the
player's heat or score: the knocked out stay down until an ambulance takes
them to the hospital, cars stand parked at the kerbs and in the car parks,
and an armed person knocked out drops their gun for you to pick up. One
director, `CityLife` (`src/game/cityLife.ts`), runs it and the ambient
*scenes* built on it (`src/game/scenes/`); the rules are pure and tested
(`systems/cityScenes.ts`, `world/streetSpots.ts`, `world/drops.ts`).

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
  every 2–4 minutes (`LOUD`), where the VIPERS' turf meets a rival crew's
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
  `iceCreamServed`); it shuts after 16–40 s and drives on.
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
- **Scuffles** (at most two, LOUD holds): someone running (a ped fleeing,
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
- **Muggings** (every 90–180 s, LOUD holds): a passer-by on screen 10–40 m
  off is rushed by someone close by, who snatches their bag (`mugging`)
  and sprints corner to corner round the blocks, crossing at the corners
  (`nextCorner`), ringed in red; the victim shouts and points (waving,
  facing them) for 5 s. Knock the mugger over and the bag drops (a pulsing
  amber ring, 45 s): walk over it to hand it back (`bagReturned`, the
  victim cheers, **$50** through `deps.reward` → `progress.pay`; cash, not
  CRED). Knocking the mugger down isn't called in by passers-by. Ignored,
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
  back); then back in and off as traffic. 2 trucks at most; none behind
  the title, in an activity or the tutorial (fires there burn out by
  themselves). The look (`render/emergencyLook.ts` fireLook): bigger
  flame particles than a burning car's, smoke from 3 m downwind (it's
  drawn over the flames), embers, a flickering orange pool on the ground
  (brighter at night); arcing water drops (streaks in the smoke pool,
  started along their flight so a slow frame still shows a jet) and steam
  where they land. Nothing hurts anyone (a molotov's fire still does).
  Street events: `fire`, `fireTruck`, `hose` (the pump's hiss), `fireOut`.
- **Tow trucks** (`scenes/tows.ts`; `towPose`, `towPriority`, `winch` in
  `systems/emergency.ts`): every 45–90 s (none in an activity, while
  wanted, in the tutorial or behind the title) a tow truck (`tow_truck`,
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
  car. One at a time.
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

**Traffic scenes** (`claude/city-traffic`; rules pure and tested in
`systems/trafficScenes.ts`). Chases, races and accidents are `LOUD` (held
off by the title, an activity, wanted stars and the tutorial) and only one
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
  mode without an opponent (that would turn them on the player). Attack
  them or ram their cars and the usual crimes apply (they're `cop` peds
  and police-model cars); with any star the chase breaks off and its
  officers on foot are handed to the police as strays
  (`CityLifeDeps.enlist` → `heat.police.strays`), who then act under the
  normal rules (and bust a player who stands there). No chase starts while
  the player has stars.
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
  still standing, `ai` null, not the player's).
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
life.races.begin() · life.accidents.begin() · .towables(out) · life.doubleParking.begin(force?, job?)
// Street events: chase, suspectRuns, arrest, suspectDown, race, raceWon, accident, fight, doublePark.
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
// Holds: 'title' (attract), 'activity' (mission, race, frenzy, fare, Chaos Run), 'wanted', 'tutorial'.
// LOUD = all four (chases, races, brawls); IN_PLAY = ['title'].

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

**Adding a scene.** Write `src/game/scenes/<name>.ts` with a class that
implements `Scene`: in its constructor `life.clock.define(kind, spec)`
(pick its holds: `LOUD` for anything that could get in the player's way);
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
`SHELTERING`, `HANGING OUT`), the missions theirs (`MISSION: tag`, `VEX`,
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
  missions passed, unlocks, the first-run pointer reached. Every field is sanitised on load (a bad value
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
- **First run** (`game/tutorial.ts`): three pointers on the marker
  prompt, one at a time, whenever nothing nearer to hand has a prompt
  (on a phone, in a car only while it's stopped: the look-ahead puts a car
  driving up the screen right under the pill, from 5 m/s on, `pointerWaits`):
  STEAL A CAR (in the device's words: E, Y, the door button) until you
  drive one; DRIFT · NEAR MISS · SMASH · JUMP — CHAINS BANK AS CASH until
  the first chain banks; ANSWER THE RINGING PAYPHONE with the radar routed
  to it until a call is answered (which ends them all). Saved
  (`save.tutorial`); a save from before them with 2+ minutes of play skips
  them. The yellow sports car at the spawn waits on the centreline lined
  up on the ramp a block east. How to Play adds banking, heat, BUSTED,
  cash and the shop, where the activities are, and a radar
  legend (`ui/radarLegend.ts`, also at the foot of PROGRESS).
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
  ammo $150 / $400 / $300 (`arsenal.pickUp`). Something you can't afford
  shakes and flashes the cash red (and a haptic tick).
- **CHAOS RUN** (title, `modes/chaosRun.ts`, `chaosRunMode.ts`): a sports
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
- **Payphone missions** (`systems/missions.ts`, `missionsData.ts`,
  `modes/missionMode.ts`): a data-driven engine with steps goto, enter (a
  tagged car or an archetype), deliver, pickup, destroy, knockOut, survive,
  loseHeat, collect and race; each with objective text, an optional timer,
  fail conditions (a tagged car wrecked or left behind) and actions on start
  / end (spawn a car, parked or with `drive: true` pulling out into traffic
  with a lane-following driver while staying pinned, or a person; set the
  wanted level, hand over a gun, a passenger boards / alights). Thirteen jobs for the Graveyard Shift — VEX's
  tow crew and her mechanic LIL' TUNA — in two chapters: eight against
  DEACON PIKE's Chrome Saints, then five (*The Ledger*) against
  COMMISSIONER CLAMP and his city impound (script and cast in
  `docs/STORY.md`) — from four payphones; the one with a job waiting rings (a ripple of light,
  the bell within 55 m, 'M' on the radar with an arrow). Answer on foot or
  by stopping beside it: the call is a card, the job runs with its objective
  on the activity card and its targets marked (a step any sedan will do
  for rings and blips the three nearest, and the wrong car says NOT A
  SEDAN); MIDNIGHT EXPRESS, PAPER TRAIL and NO PARKING pin the clock at night (a fail or quit puts the
  hour back). Pay $500–$5,000; fail and the phone rings again. The last
  job of a chapter debriefs CHAPTER n COMPLETE (`chapter`, `endsChapter`),
  the very last STORY COMPLETE. Once all
  thirteen are passed the phones ring with them again in story order as
  REPEAT JOBs (`replayJob` / `replayReward`): half pay rounded to $50, no
  completion credit, the debrief says JOB DONE; `stats.jobsReplayed` counts
  them, keeps the rotation across sessions and shows as *Repeat jobs* on
  PROGRESS. A banner
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
  each, exports and taxi 10%, the Chaos Run 5%), cash, each activity's
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
- **Families** (`render/propBatch.ts`, `render/worldProps.ts`): several
  models merged into one geometry; each instance says which model it is
  and the vertex shader drops every other model's vertices, so a family is
  one draw call (and one in the shadow pass): `lamps`, `street` (traffic
  lights, furniture, road works, carts and shelters), `roofs`, `trees`, `landmarks`, `things` (pickups,
  frenzy tokens, packages, roadblock barriers and cones, knocked-over
  props in flight) and `debris`. Static instances are bucketed in 32 m
  cells and the buffers are refilled only when the view crosses a cell;
  per-frame ones are appended. One program for all of them.
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
- **Stand-ins** (`render/propStandIns.ts`): props.glb has no models yet for
  the round-2 kinds, so each is a few boxes (five faces each, no bottom)
  tagged with the material names the GLB will use, so they light the same
  (`blink_amber` blinks, `ad_panel` / `screen` / `stripe_*` are self-lit,
  `roadwork_sign` / `barrier_orange` catch the light, `paint` takes the
  tint); a GLB root of the same name replaces its stand-in. Contracts in
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
haptics.pulse(strength0to1, ms)                          // also fired by crash / explosion / shot / hurt events;
                                                         // haptics.enabled is off behind the title
```

Kinds: `objective`, `enemy`, `police`, `pickup`, `friend`, `shop`, `race`,
`marker` (each has a default colour).

