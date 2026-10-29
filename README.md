# Urban Blight

Top-down open-world crime/driving game for the browser — three.js, TypeScript,
Vite, installable as a PWA. Full plan: `PLAN.md` in the Google Drive folder
*GameDev / Urban Blight* (Drive holds the plan and art; code lives here).

## Run

Needs Node ≥ 22.12 (hive1: `~/.local/opt/node24/bin`, the system Node 20 is too old).

```sh
npm install          # if NODE_ENV=production is set, unset it first or dev deps are skipped
npm run dev          # vite --host, http://<host>:5173
npm test             # vitest (physics, loop)
npm run build        # typecheck + production build with service worker
npm run icons        # regenerate PWA icons
```

On hive1 the dev server runs as the transient user unit `urban-blight-dev`
(`systemctl --user status|restart|stop urban-blight-dev`); open
`http://hive1:5173` from a phone on the tailnet.

## Controls

| | Keyboard | Touch | Gamepad |
|---|---|---|---|
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
- Next: **M2 City v1** (procedural grid city, chunking, collision).

## Layout

```
src/core      loop, input
src/entities  vehicle physics (no three.js)
src/render    camera rig, meshes, dynamic resolution
src/world     ground / city
src/ui        touch controls, CSS
tests/        vitest
tools/        icon generator
blender/      (M3) procedural asset scripts
```
