# Curbside

_Formerly "Urban Blight" (renamed 2026-10-29; other games already use that name)._

Top-down open-world crime/driving game for the browser — three.js, TypeScript,
Vite, installable as a PWA. Full plan: `docs/PLAN.md` (mirrored as `PLAN.md` in the Google Drive folder
*GameDev / Curbside*, which also holds art; code lives here).

## Run

Needs Node ≥ 22.12 (hive1: `~/.local/opt/node24/bin`, the system Node 20 is too old).

```sh
npm install          # if NODE_ENV=production is set, unset it first or dev deps are skipped
npm run dev          # vite --host, http://<host>:5173
npm test             # vitest (physics, loop)
npm run build        # typecheck + production build with service worker
npm run icons        # regenerate PWA icons
npm run assets       # rebuild GLBs from blender/ (needs `blender` on PATH; add `-- --thumbs` for previews)
```

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
| Switch weapon | wheel, right click, Q / Tab (Shift+Tab back) | ⇄ | RB / LB |
| Enter / exit car | E / F / Enter | door button (pulses next to a car) | Y |
| Steer | A/D, ←/→ | **Point** (default): stick = where to go, push further = more gas; **Classic**: stick left/right | left stick |
| Gas / brake-reverse | W/S, ↑/↓ | pedal pad: GAS / BRAKE — slide between them without lifting | RT / LT |
| Handbrake | Space | HAND, or the DRIFT band (GAS + HAND with one thumb) | A |
| Pause | P / Esc | ❚❚ top centre (also automatic on app switch / portrait) | Start (B resumes) |
| Menus | arrows + Enter, Esc / Backspace back | tap | D-pad / left stick + A, B back |
| Next radio station | R | tap the "now playing" card | — |

Settings (title or pause menu): master / effects / music volume, sound with
the iPhone silent switch on, graphics quality, touch steering
(point / classic), left-handed layout (mirrors the controls and the HUD),
vibration, show FPS.

## Status

- **M0 Setup** — done, verified on a phone over Tailscale: Vite 8 + three 0.186 + TS + vite-plugin-pwa, Vitest.
- **M1 Drive a box** — done: fixed-timestep loop with render interpolation,
  arcade car physics (`src/entities/vehicle.ts`, pure + unit-tested),
  speed-zoom chase camera, keyboard/touch/gamepad input, placeholder road-grid
  world with non-colliding blocks, dynamic resolution, pause on background.
- **M3 Blender pipeline** — started: `blender/build_assets.py` runs generators headless;
  `characters.py` builds the player (rigid parts on an armature, Idle + Walk
  clips) → `public/assets/player.glb`, loaded with GLTFLoader + AnimationMixer.
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
  charred wreck; blasts damage/shove cars and knock people down; NPC
  drivers bail out of burning cars; your own car throws you clear.
- **Punching**: knocks down whoever is in front, scares bystanders.
- **Chaos score** (`src/systems/score.ts`, `src/ui/scoreHud.ts`): drifts,
  near misses, smashes, hit-and-runs, knockouts, carjacks and explosions
  score points; anything within 3 s of the last event raises a ×2…×10
  combo. Best score is kept in localStorage (`curbside.best`).
- **Weapons** (`src/systems/weapons.ts`, `src/world/pickups.ts`): pistol,
  SMG, shotgun and health crates on sidewalks (respawn 30 s); hitscan with
  aim assist, tracers, walls stop bullets, cars take damage.
- **Fighting back** (`src/systems/crowd.ts`): peds are calm (70%),
  fighters (20%) or armed (10%); provoke one and they punch or shoot back
  (shooters hit your car too). Player health; at 0 → WASTED, respawn, lose
  weapons, run score resets (best kept).
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
- App updates wait for respawn, the page being hidden, or "restart now" on
  the pause screen; a lost WebGL context pauses until it's restored.
  `?debug` in the URL shows fps / pixel ratio / draw calls.
- **Audio** (`src/audio/`): fully synthesised Web Audio, no sound files —
  engine with a gearbox, tyres, guns, impacts, explosions, fire, sirens,
  city ambience, stingers tuned to the music, and an adaptive procedural
  soundtrack on three radio stations. See *Audio* below.
- **Front door, controls and HUD** (`src/ui/`, see *UI* below): a title
  screen over a live attract mode (the city runs, the camera cruises after
  traffic) with PLAY, a mode list other systems extend, settings, how to
  play and the best score; the first tap unlocks audio, shaders are warmed
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
  slide across, with a GAS+HAND drift band; twin-stick aim with auto-aim
  snapping within ~15°; inline-SVG icons; left-handed mirror; iOS gesture
  blocking; haptics (gamepad rumble, Android vibrate, the iOS 18 switch
  tick) driven by bus events. Mouse aim and gamepad right-stick aim on
  desktop; prompts follow the device in use.
- **HUD**: score with a punch on every award and a draining combo ring, a
  two-line feed that merges repeats; segmented health; an arc speedometer
  with the car's health inside it; weapon and ammo; a vmin-sized damage
  vignette; a WASTED screen with the life's stats. Circular north-up radar
  (the city pre-rendered once, traffic, pickups, hostiles, blips and a
  waypoint route, zooming out with speed, ≤30 Hz) and red edge chevrons for
  off-screen attackers.
- Next: **M6 Heat** (wanted level, police).

## Layout

```
src/core      loop, input
src/entities  vehicle physics (no three.js)
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

## UI

Plain DOM over the canvas, one stylesheet per area (`tokens.css` for the
shared palette and safe-area edges, `title.css`, `menu.css`, `hud.css`,
`radar.css`, `touch.css`). `FrontDoor` (`src/ui/frontDoor.ts`) owns the
flow between title, pause, settings, how-to, rotate and countdown and
routes keyboard / gamepad navigation (`Input.consumeNav`) to whichever
screen is on top; `main.ts` hands it a few hooks. The HUD only writes to
the DOM what changed since the last frame; nothing in the per-frame paths
allocates.

Safe areas come from `env(safe-area-inset-*)` through `--safe-t/r/b/l` on
`:root`; a test can override those to emulate a notched phone
(`safeArea.ts` reads them back for JS layout). The touch layout is checked
at 852×393 and 852×340 (Safari's toolbar showing).

API for other systems:

```ts
frontDoor.title.addMode({ id, label, sub?, onSelect })   // a mode under PLAY (e.g. CHAOS RUN); removeMode(id)
radar.setBlip(id, { x, z, kind?, colour?, icon?, pulse?, edgeArrow?, size? })
radar.removeBlip(id)
radar.setWaypoint(x, z) / radar.clearWaypoint()          // route along the roads + rim arrow when off-radar
hud.score.notice(text, kind?)                            // a feed line without points
haptics.pulse(strength0to1, ms)                          // also fired by crash / explosion / shot / hurt events
```

Kinds: `objective`, `enemy`, `police`, `pickup`, `friend`, `shop`, `race`,
`marker` (each has a default colour).

