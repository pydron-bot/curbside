# Curbside

_Formerly "Urban Blight" (renamed 2026-10-29; other games already use that name)._

Top-down open-world crime/driving game for the browser — three.js, TypeScript,
Vite, installable as a PWA. Full plan: `PLAN.md` in the Google Drive folder
*GameDev / Urban Blight* (the Drive folder keeps the old name; Drive holds the plan and art; code lives here).

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

| | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Walk (on foot) | WASD / arrows | left-half joystick | left stick |
| Sprint (on foot) | Shift | push joystick to the rim | A |
| Enter / exit car | E / F / Enter | ENTER / EXIT | Y |
| Steer | A/D, ←/→ | left-half joystick | left stick |
| Gas / brake-reverse | W/S, ↑/↓ | GAS / BRAKE | RT / LT |
| Handbrake | Space | HAND | A |
| Pause | P / Esc | — (auto on app switch) | — |

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
- Next: **M6 Heat** (wanted level, police) or finish **M4** (punching).

## Layout

```
src/core      loop, input
src/entities  vehicle physics (no three.js)
src/render    camera rig, meshes, dynamic resolution
src/world     ground / city
src/ui        touch controls, CSS
tests/        vitest
tools/        icon generator
blender/      procedural asset scripts (lib/ helpers, generators/, build_assets.py)
```
