# Curbside — Project Plan

An original, mobile-friendly, top-down open-world crime/driving game in the browser, in the spirit of the classic top-down genre: near-overhead camera, dense city blocks, steal-and-drive vehicles, missions from payphones, wanted levels. Installable as a PWA, rendered with three.js, assets authored procedurally with Blender Python.

_Plan written 2026-10-29 as "Urban Blight"; renamed **Curbside** the same day (other games already use the old name). The Google Drive copy and `docs/PLAN.md` in the code repo are kept in sync._

---

## 0. Status (2026-10-30)

| # | Milestone | State |
|---|---|---|
| M0 | Setup | ✅ Done — verified on iPhone, incl. home-screen app over HTTPS |
| M1 | Drive a box | ✅ Done |
| M2 | City v1 | ✅ Done — seeded 16×16-block city, chunked instancing, collision |
| M3 | Blender pipeline | ✅ Characters (8 bodies, 22 clips), 22 vehicles incl. bikes and the helicopter, props, pickups, weapons, debris; road tiles/buildings are shader-drawn instead |
| M4 | On foot | ✅ Walk/run, enter/exit, carjacking, punch combos, guns, grenades, molotovs, rockets |
| M5 | Living city | ✅ Traffic with signals and reactions, crowds, pigeons, damage → fire → explosion chains |
| M6 | Heat | ✅ 0–5 stars, pursuit AI, roadblocks, SWAT, helicopter, BUSTED, Pay 'n' Spray |
| M7 | Missions & HUD | ✅ Eight payphone missions, Chaos Run, frenzies, packages, races, exports, taxi, cash, shop, save, radar, new HUD and menus |
| M8 | Ship as PWA | 🟡 Live at https://deeek.org/curbside/ (GitHub Pages); deploy, offline boot and installability verified by `tools/smoke.mjs` in CI; still to do: the real-device performance pass (and a real home-screen icon, `icons-splash`) |

The overhaul that took M5 to here is summarised in `docs/HANDOFF.md`, which
also holds the prioritised to-do list.

**Where it runs:** live at https://deeek.org/curbside/ (deployed from `main` by GitHub Pages). Code at `~/dev/curbside` on hive1 (git, pushed to `pydron-bot/curbside`). Dev server is the `curbside-dev` user service; play at `https://hive1.tail078432.ts.net:8443` (tailnet only). Drive keeps this plan and any source art.

---

## 1. Environment (hive1)

| Tool | Status | Notes |
|---|---|---|
| Node.js / npm | 24 LTS ✔ | User-local at `~/.local/opt/node24` (system Node 20 is too old). Unset `NODE_ENV` before `npm install`. |
| Git | ✔ | Repo at `~/dev/curbside`. |
| Blender | 5.2.3 LTS ✔ | User-local at `~/.local/opt/blender`, `blender` on PATH. Headless works; EEVEE thumbnails are software-rendered (slow) until the user is in the `render`/`video` groups. |
| Hosting (dev) | ✔ | `tailscale serve --https=8443` → Vite on :5173. |

The original Windows notes still apply if working there: Blender at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, and keep `node_modules` out of Google Drive.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | Safer refactors as systems grow. |
| Bundler / dev server | Vite | Fast HMR, trivial static build, LAN dev server for testing on a phone (`vite --host`). |
| Renderer | three.js (WebGLRenderer, pin exact version) | Mature, small, great glTF support. Keep WebGPURenderer as a later opt-in — WebGL2 is the safe mobile baseline. |
| Physics | Custom arcade 2D physics on the XZ plane | Top-down game is effectively 2D: circle/OBB vs. static grid collision is cheap and tunable. Avoid a full 3D engine. Fallback if needed: Rapier 2D (WASM). The destruction test's rubble is a deliberate exception: Rapier 3D, lazy-loaded, presentation only (it never moves cars or people). |
| PWA | `vite-plugin-pwa` (Workbox) | Generates manifest + service worker, precaches the build and GLB assets for offline play. |
| Audio | Web Audio API (or Howler.js) | Must unlock on first touch (iOS). |
| Assets | glTF binary (`.glb`) exported from Blender, Draco or Meshopt compressed, KTX2 textures | Small downloads, fast GPU upload on mobile. |
| Testing | Vitest for pure logic (traffic, wanted level, physics) | Rendering verified manually in browser + on device. |

---

## 3. Core design (MVP scope)

- **Camera:** high perspective camera looking almost straight down (slight tilt for building parallax), zooms out with vehicle speed — the signature feel of the genre.
- **Player on foot:** walk/run, punch, enter/exit vehicles, pick up weapons.
- **Vehicles:** arcade handling (accel, brake, grip/drift, handbrake), damage → smoke → fire → explode. 4–6 archetypes (compact, sedan, van, sports, police, bus).
- **City:** tile-based, generated from a grid of blocks: roads, intersections, sidewalks, buildings of varying heights, parks, a waterfront. Start with one ~1 km² district.
- **Traffic & pedestrians:** cars follow lane graph built from road tiles; pedestrians wander sidewalks, flee from danger.
- **Wanted level:** 0–5 heat; police spawn and pursue; lose heat by breaking line of sight / respray shop.
- **Missions:** data-driven (JSON) — go to X, steal Y, deliver Z, eliminate target, with timers.
- **Economy:** cash/score, respawn at hospital on death, arrested → lose weapons.
- **Save:** localStorage/IndexedDB for progress.

Out of scope for MVP: multiplayer, multiple districts, radio stations, gangs/respect system (good post-MVP additions).

---

## 4. Mobile & performance targets

- **Target:** 60 fps on a mid-range 2022 Android phone; 30 fps floor. Budget: < 150 draw calls, < 300k triangles on screen, < 30 MB initial download.
- **Controls:** left virtual joystick (move/steer), right-side buttons (accelerate/attack, brake/jump, enter/exit car, handbrake). Keyboard + gamepad on desktop via the same input abstraction.
- **Rendering tricks:**
  - `InstancedMesh` for repeated props (lamps, trees, parked cars, building modules).
  - Chunked city (e.g. 64×64 m chunks), frustum culling per chunk, only nearby chunks active for AI.
  - Texture atlases + one or two shared materials for the city → few draw calls.
  - Baked lighting/AO into vertex colors or atlases in Blender; one directional light, cheap or no real-time shadows (blob shadows under cars/peds).
  - Dynamic resolution: drop `renderer.setPixelRatio` when frame time climbs; cap at 2.
- **PWA:** fullscreen/landscape via manifest `display: "fullscreen"`, `orientation: "landscape"`; handle iOS safe-area insets; pause on `visibilitychange`. iOS home-screen apps report rotated sizes late — size the canvas from layout every frame, not on `resize`.

---

## 5. Project structure

```
curbside/
  index.html
  vite.config.ts            # vite-plugin-pwa config
  docs/PLAN.md              # this plan
  public/
    icons/                  # PWA icons (192, 512, maskable)
    assets/                 # exported .glb (output of Blender pipeline)
  src/
    main.ts                 # bootstrap, renderer, game loop
    core/                   # loop (fixed-timestep), input
    game/                   # population (traffic/crowd spawning)
    render/                 # camera rig, models, dynamic resolution
    world/                  # city generator, roads, collision grid, ground
    entities/               # vehicle, pedestrian
    systems/                # physics, traffic AI, crowd (later: wanted level, missions, damage)
    ui/                     # touch controls, CSS (plain DOM overlay)
  blender/
    lib/                    # shared helpers (materials, export)
    generators/             # one script per asset family
    build_assets.py         # runs all generators headless, exports GLBs
  tests/
```

---

## 6. Blender Python asset pipeline

Goal: every game asset is reproducible from a script — tweak a parameter, rebuild, refresh the browser.

- **Run headless:** `npm run assets` (= `blender -b --factory-startup -P blender/build_assets.py -- --out public/assets`, add `-- --thumbs` for previews).
- **Generators (procedural, low-poly, stylised):**
  - `vehicles.py` — ✅ parametric car bodies (sedan, compact, sports, van, police); separate front wheels; `paint` material tinted per car at runtime.
  - `characters.py` — ✅ low-poly person, rigid parts on an armature, Idle + Walk clips; outfits recoloured at runtime.
  - `buildings.py` — modular building kit (walls, roofs, rooftop props) + full building variants by height/footprint; texture atlas for windows.
  - `road_tiles.py` — straight, corner, T, cross, dead-end, crosswalk; sized to the city grid.
  - `props.py` — lamp posts, trees, bins, hydrants, payphones.
- **Conventions:** 1 unit = 1 m, Y-up on export (glTF default), origin at ground centre, models face Blender −Y (game +Z), `col_*` objects for collision shapes exported as metadata, `socket_*` empties for attachment points.
- **Export:** glTF binary, apply modifiers, one GLB per family. Compression (Draco/Meshopt) and KTX2 once assets grow.
- **Preview:** `--thumbs` renders an EEVEE PNG per generator into `blender/thumbs/`.

---

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | **Setup** | Node installed, repo created (outside Drive or with sync excluded), Vite + three.js + TS + PWA plugin running; `vite --host` opens on a phone. |
| M1 | **Drive a box** | Top-down camera, flat ground, a box car with arcade handling, keyboard + touch joystick, fixed-timestep loop. |
| M2 | **City v1** | Procedural grid city from primitive placeholder geometry, chunking + instancing, collision against buildings. |
| M3 | **Blender pipeline** | `build_assets.py` produces GLBs for vehicles, road tiles, buildings; game loads them and replaces placeholders. |
| M4 | **On foot** | Player character, enter/exit vehicles, steal parked cars. |
| M5 | **Living city** | Lane graph, traffic AI, pedestrians, collisions/damage/explosions. |
| M6 | **Heat** | Wanted level, police spawning and pursuit, arrest/death respawn. |
| M7 | **Missions & HUD** | Mission system from JSON, payphone triggers, minimap/arrow, cash, pause menu, save. |
| M8 | **Ship as PWA** | Icons, offline caching verified, installable (browser install UI; iOS Add to Home Screen tip), scripted PWA checks in place of the old Lighthouse PWA pass (Lighthouse 12+ dropped that category: `tools/smoke.mjs` checks installability and an offline boot), performance pass on real devices, deploy (GitHub Pages). |
| M9+ | **Post-MVP** | More districts, gangs/respect, weapons variety, radio/audio, day-night, WebGPU path. |

---

## 8. Suggested parallel work (for agents/sessions later)

These streams are largely independent and can run in parallel:
1. **Blender asset generators** (`blender/`) — no dependency on game code beyond the conventions in §6.
2. **City generator + collision grid** (`src/world/`).
3. **Touch controls + HUD** (`src/ui/`, `src/core/input`).
4. **Vehicle handling tuning** (`src/entities/vehicle`).

---

## 9. Decisions

- **Name:** ✅ Curbside (was Urban Blight).
- **Code location:** ✅ hive1 local disk + GitHub (`pydron-bot/curbside`); Drive for the plan and art.
- **Art direction:** flat-shaded low-poly (in use); building windows are shader-painted rather than atlased. Revisit atlases for facades later.
- **Building height:** capped at 12 m so roofs stay well below the on-foot camera (20 m).
- **Open:** fictional city name, districts and tone; hosting target for the shipped PWA.

---

## 10. Next steps

Full list with context in `docs/HANDOFF.md`. In short:

1. Real-device pass on an iPhone 15 Pro (frame rate, audio/silent switch, haptics, controller, touch feel) and tuning from it.
2. Tune from real play: Chaos Run medals, race times, 5-star difficulty.
3. Blender adjustment pass from in-game readability (notes at the end of `docs/BLENDER_TODO.md`).
4. A landing page at the root of deeek.org for all projects (`pydron-bot/pydron-bot.github.io`; Curbside first).
5. The minor known issues listed in `docs/HANDOFF.md`.
