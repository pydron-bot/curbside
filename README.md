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
npx -y -p playwright@1.63.0 node tools/smoke.mjs   # browser smoke test (docs/systems/testing.md)
```

Smoke test and tuning harnesses: [docs/systems/testing.md](docs/systems/testing.md).

On hive1 the dev server runs as the user unit `curbside-dev` (enabled, starts on boot;
`systemctl --user status|restart|stop curbside-dev`). Open
`https://hive1.tail078432.ts.net:8443` (tailscale serve → :5173) or
`http://hive1:5173` from a device on the tailnet.

## Layout

```
src/core      loop, input, event bus, settings
src/entities  vehicle physics (no three.js)
src/game      player, population, heat, progression (progress*.ts), modes/ (Chaos Run, activities), scenes/ (city life)
src/systems   gameplay rules, mostly pure and tested (traffic, crowd, police, weapons, missions, scene rules)
src/render    camera rig, meshes, dynamic resolution
src/world     city, roads, props, map edits (maps/city.json)
src/ui        title/pause/settings menus, touch controls, HUD, radar, radio card, CSS
src/audio     synthesised sound and music (pure models + Web Audio voices)
tests/        vitest
tools/        icon renderer (make-icons.mjs), smoke test, tuning harnesses
blender/      procedural asset scripts (lib/ helpers, generators/, build_assets.py)
```

## Systems

How each system works, its API and its budget: one file per system in
`docs/systems/`. Read the ones your task touches, not all of them.

| File | What it covers |
|---|---|
| [main-loop.md](docs/systems/main-loop.md) | `main.ts`: the order of a frame and a sim step, frame systems and their clocks, `window.__ub`, adding a system |
| [controls.md](docs/systems/controls.md) | Keyboard, touch and gamepad bindings; the TEST menu; Diagnostics (touch tuning, perf log, GPU breakdown, Low Power tests, bug reports) |
| [driving-and-combat.md](docs/systems/driving-and-combat.md) | Car handling, crashes, on foot, weapons (drive-bys, air horn, taser, stinger, smoke, sticky charge), stunts, character clips, simulation level of detail |
| [heat.md](docs/systems/heat.md) | Wanted stars, police response and pursuit, BUSTED, Pay 'n' Spray |
| [city-life.md](docs/systems/city-life.md) | The `CityLife` director, ambient city (knocked out, parking, crowds by hour and weather, dogs, turf), in-view meter, adding a scene, playtest labels, budget |
| [city-scenes.md](docs/systems/city-scenes.md) | Street scenes: buses, ice cream van, carts, buskers, scuffles, muggings, witnesses, fires, tows, alarms; Borrowed Blues; VAN NICKED |
| [city-incidents.md](docs/systems/city-incidents.md) | Traffic scenes (police chases, street races, accidents, double-parking); Your mess, their problem; the six incidents |
| [police-scanner.md](docs/systems/police-scanner.md) | The police scanner's lines, pings and subtitle |
| [progression.md](docs/systems/progression.md) | Save, cold open, CRED and perks, shop, Chaos Run, frenzies, packages, races, exports, taxi, missions, districts, gangs, PROGRESS |
| [audio.md](docs/systems/audio.md) | Synthesised sound: unlock, mix, spatial, events; music, stations, stings, chase music, music on foot |
| [look.md](docs/systems/look.md) | `Look`: draw calls, light, surfaces, neon city, the LOOK panel, phones vs desktop; people (bodies, clips, weapons in hand), pigeons |
| [world.md](docs/systems/world.md) | Props and families, city size, map edits and the map editor, street furniture, collision, traffic lights, pickups, vehicles, helicopter |
| [effects-and-camera.md](docs/systems/effects-and-camera.md) | Particles, marks, debris, fake lights, camera, hit-stop, weather, budgets, low-res smoke; named mayhem (stamps); the best-moment picture |
| [destruction-test.md](docs/systems/destruction-test.md) | Breachable walls and Rapier rubble (off by default) and its device numbers |
| [ui.md](docs/systems/ui.md) | Title highlights, observe mode |
| [testing.md](docs/systems/testing.md) | Smoke test; tuning harnesses (`tools/tune/`) |

Other docs: [docs/HANDOFF.md](docs/HANDOFF.md) (current state and open work),
[docs/HISTORY.md](docs/HISTORY.md) (what was built when),
[docs/PLAN.md](docs/PLAN.md) (design), [docs/V2_PLAN.md](docs/V2_PLAN.md) (V2 and
wave 3), [docs/BLENDER_TODO.md](docs/BLENDER_TODO.md) (GLB contracts),
[docs/BACKLOG.md](docs/BACKLOG.md) (scoped items with file:line findings),
[docs/STORY.md](docs/STORY.md), [docs/CRED.md](docs/CRED.md),
[docs/W3A_CITY.md](docs/W3A_CITY.md), [docs/W3D_MAP.md](docs/W3D_MAP.md).
