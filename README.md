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
npm run icons        # regenerate PWA icons
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
| Next radio station | R | tap the "now playing" card | Select / View |

Settings (title or pause menu): master / effects / music volume, sound with
the iPhone silent switch on, graphics quality, touch steering
(point / classic), left-handed layout (mirrors the controls and the HUD),
vibration, perf overlay (Off / FPS / Full).

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
  soundtrack on three radio stations. See *Audio* below.
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
  checkpoint races, hot-car exports, taxi fares and eight payphone missions
  in free roam; a safehouse shop; PROGRESS in the pause menu.
- **Feel** (`src/entities/vehicle.ts`, `src/game/combat.ts`,
  `src/systems/projectiles.ts`, `src/world/ramps.ts`, see *Driving and
  combat* below): exact top speeds, a cornering limit, drifts, burnouts,
  glancing walls, nitro; rebalanced damage and body armour; ped hit
  points, knockouts, punch combos, lock-on; grenades, molotovs, rockets;
  drive-bys; optional character clips; stunt ramps with STUNT awards.
- **World and vehicle models** (`src/render/propModels.ts`, `propBatch.ts`,
  `worldProps.ts`, `heliModel.ts`; `src/world/streetProps.ts`,
  `landmarkProps.ts`, `dressing.ts`, `signals.ts`; see *World* below):
  props.glb, pickups.glb, debris.glb and heli.glb replace the box
  stand-ins — street lamps, traffic lights that traffic obeys, street
  furniture you can knock flying, rooftop kit, trees by district, booths,
  the station, race gantries, the export bay, the safehouse door, pickups,
  frenzy tokens, ramps and kickers, car-part debris in the car's paint and a
  modelled police helicopter — in seven instanced families. Twelve more
  vehicles (muscle car, limo, police SUV, SWAT truck, ambulance, fire
  truck, garbage truck, tow truck, ice cream van, bus, scooter, police
  bike) with their own handling, health and collision bodies; emergency
  calls with right of way; two-wheelers that lean, carry a rider and
  throw them off in a hard crash.
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
knockout: down 8 s, then they run with no grudge. Only a knockout scores
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
`Fall` → `Down` → `GetUp`, the get-up timed to end as they're allowed up;
`Arrested` when BUSTED; `EnterCar` at the driver's door before the body
vanishes; `Hail`, `Cower`, `Cheer`, `Ride`. See *Look → People*.

**Budget**: ramps +1 draw call (+1 in the shadow pass) when in view,
projectiles +1 only while something flies; rings, arcs, fire glows and
shadows go into the shared glow and shadow meshes. Measured with
`?debug`: 43–56 calls on the iPhone profile in fights, chases, jumps and
night rain, 55–69 on desktop (a 5-star chase with grenade spam). Combat
allocates nothing per bullet. The sim's per-step hot paths avoid garbage
too (sidewalk corners into a reused point, squared distances instead of
`Math.hypot` in the per-car / per-crate loops, last-step state copied
field by field); what remains per frame is mostly three.js's per-person
`AnimationMixer` and V8 number boxing (JSC NaN-boxes doubles, so less on
the iPhone).

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
+1; stealing one sets at least 1★. Civilian crimes stop at 3★; 4–5★ need
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
heat.police.units / .heli / .seen          // read the response
heat.shops / heat.station                 // landmarks (world/landmarks.ts)
// Bus: { type: 'wanted', level, prev, reason } · { type: 'busted', fine } · { type: 'horn', x, z, duration }
//      { type: 'respray', x, z, cleared }; pedDown/explosion/bulletHit/enterVehicle carry `cop` / `police` flags.
```

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
  (`carPace`: top speed and grip; a sedan ×1.22, a bus ×1.81): gold
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
  / end (spawn a car or a person, set the wanted level, hand over a gun, a
  passenger boards / alights). Eight jobs for the Graveyard Shift — VEX's
  tow crew, her mechanic LIL' TUNA, against DEACON PIKE's Chrome Saints —
  from four payphones; the one with a job waiting rings (a ripple of light,
  the bell within 55 m, 'M' on the radar with an arrow). Answer on foot or
  by stopping beside it: the call is a card, the job runs with its objective
  on the activity card and its targets marked (a step any sedan will do
  for rings and blips the three nearest, and the wrong car says NOT A
  SEDAN); MIDNIGHT EXPRESS pins the clock at night (a fail or quit puts the
  hour back). Pay $500–$5,000; fail and the phone rings again. A banner
  raised while WASTED / BUSTED is up (MISSION FAILED, RACE OVER) waits for
  the respawn.
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
- **`heat.mjs [chases=20] [--stars 5] [--secs 180] [--tough] [--seed 1]`**:
  chases from a built-up 3 stars to `--stars`, a junction-to-junction
  evader; escapes, busts, wrecks, time to each lower star, crashes, shots
  taken, helicopter time on you. `--tough` keeps the car healthy to test
  the evasion rules alone. Baseline 2026-10-31 (20 chases, 5 stars): stock
  sports car lost in 18, busted 2, median end 26 s, 1 drop to 4 stars;
  tough car: none escaped, 12 down to 4 stars (median 84 s), 3 to 3 stars,
  2 busted.

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
tools/        icon generator
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
- **Music.** A look-ahead scheduler (25 ms timer, 0.12 s ahead on the audio
  clock) plays original 8-bar progressions in three styles: NIGHTDRIVE FM
  (synthwave), BREAKNECK 99.1 (breakbeat), LOW TIDE (lo-fi). Intensity 0–5
  layers in kick, snare, arps, lead, crashes and risers, opens the filter and
  lifts the tempo; changes land on bar lines with a fill, tempo glides. It
  follows chaos (combos, explosions, speed) above a floor set with
  `setIntensity`. `'menu'` mode is a drumless arrangement for a title screen.

| Module | What |
|---|---|
| `carSound.ts` | 5-speed gearbox / RPM model, per-archetype engine profiles, squeal and road-noise amounts (pure, tested) |
| `mix.ts`, `voices.ts`, `chaos.ts` | falloff/pan/doppler math, voice limiter and rate gate, chaos → intensity (pure, tested) |
| `music/theory.ts`, `music/stations.ts`, `music/sequencer.ts` | chords, voice leading, lead composer, station data, step clock and arranger (pure, tested) |
| `synth.ts` | noise buffers, node-tracking `Voice`, envelopes, reverb impulse |
| `sfx.ts`, `loops.ts`, `music/musicPlayer.ts` | one-shot recipes, continuous voices (engine, tyres, fire, ambience, sirens), music instruments |

API for other systems:

```ts
audio.update(dt, frame)              // per frame: listener x/z, player car (describeCar) or null, footSpeed, health, vehicles (fires)
audio.siren(id, x, z, on, style?)    // call every frame while it sounds; 'twoTone' | 'wail' | 'yelp'; stale ids fade out after 1 s
audio.horn(x, z, duration?)
audio.ui('click' | 'confirm' | 'back' | 'countdown' | 'go' | 'success' | 'fail' | 'cash' | 'star')
audio.setPaused(bool)
audio.setIntensity(0..5)             // music floor, e.g. the wanted level
audio.setMusicMode('game' | 'menu' | 'off')
audio.nextStation()                  // also R / tapping the radio card
audio.unlock()                       // call from a title screen's tap
audio.debug                          // state, voices, nodes, engine, music
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
  `characterModel.ts`, `game/bodies.ts`): `player`, the street bodies
  `ped_slim` (backpack), `ped_stocky` (ball cap) and `ped_coat` (long coat or
  dress), `cop`, and the story characters `vex`, `tuna` and `pike`. Each GLB
  is one `CharacterBatch`: one draw call plus its shadow pass, and none at
  all while nobody wearing it is on screen (people more than 8 m outside
  the visible ground are left out, so the crowd walking just off-screen
  costs nothing). Batches grow as needed. Palette slots by material suffix:
  `skin`, `hair` (the ball cap, the cop's cap crown), `shirt` (coats too),
  `pants` (the backpack, Vex's overalls), `shoes` (the cop's brim, belt and
  holster, Tuna's headphones), and a fixed-colour `badge` for later.
- **Who wears what.** The crowd is a mix of `player` / `ped_slim` /
  `ped_stocky` / `ped_coat` (28/26/24/22%) in the street palettes (caps get
  brighter colours than hair); pooled models only come back as the same
  body, dressed from scratch (nothing of their last outfit carries over;
  when the pool is full the longest-waiting model goes). Officers on foot wear `cop` in police blue with a navy cap (SWAT in
  charcoal, with SMGs). Lil' Tuna (both pick-ups) wears `tuna`; Vex waits
  at the docks yard for every delivery there; Deacon Pike guards his car in
  LAST CALL; the Collector wears Pike's coat in white. Story characters
  keep their own colours; only the friendly ones cheer.
- **Clips** (`characterAnim.ts`): the 22 clips are sampled by hand from
  shared interpolants (no `AnimationMixer` per person, no objects made
  per frame) into three layers: legs (Idle/Walk/Run on one gait phase at the
  authored `walkSpeed` / `runSpeed`), a whole-body layer (Fall, Down, GetUp,
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
  gunfire, blasts and horns: one instanced draw call with the `Flap` clip
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
  lights and furniture), `roofs`, `trees`, `landmarks`, `things` (pickups,
  frenzy tokens, packages, roadblock barriers and cones, knocked-over
  props in flight) and `debris`. Static instances are bucketed in 32 m
  cells and the buffers are refilled only when the view crosses a cell;
  per-frame ones are appended. One program for all of them.
- **Placement** (`world/streetProps.ts`, `world/landmarkProps.ts`,
  `world/dressing.ts`; pure, tested, from the city seed): street lamps
  with the arm over the road (the analytic night lighting follows the new
  head); traffic lights on 70% of the inner junctions; furniture per block
  side by district (hydrants, benches, bins, bollards, newspaper boxes,
  mailboxes, payphones; busiest downtown), dumpsters at alley mouths,
  bollards round plazas, park trees by district (round, tall, palms);
  rooftop kit fitted to the building plans (AC units, vents, water tanks,
  dishes, stair huts, antennas with a blinking tip; the huts' tar-grey and
  the tanks' weathered-board tops read from above); spray booths with
  their mouth to the street (the roof opens while you're inside), the
  export bay, the police sign and the safehouse door on their walls (both
  lamps glow at night), race-start gantries with barriers and cones, ramp
  and kicker models. Nothing lands on a pickup, a payphone, a race start,
  the station or the safehouse door, or in a bay's mouth.
- **Collision**: lamp posts, signal poles, bollards, dumpsters, payphones,
  booth and bay walls, gantry pillars and long barriers go into the
  `StaticGrid`. Hydrants, bins, newspaper boxes, mailboxes, benches and
  race cones are *knockables* (`systems/knockables.ts`): a car through
  one at over 3 m/s sends it flying (`render/knockFx.ts`: a tumbling copy,
  dust and sparks, a 14 s geyser from a hydrant) and it's back 60 s later
  once out of sight. Roadblock barriers and cones go flying the same way.
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

