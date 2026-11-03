# Look harnesses (screenshots for visual work)

Quick Playwright scripts used to build and check the 0.22–0.25 look work
(neon city, night and day flourishes). They drive a **dev server on port
5343**: `npx vite --port 5343 --strictPort` from the repo root, then run
them from any folder with the globally installed Playwright, e.g.

```sh
NODE_PATH=$(npm root -g) node tools/look/spot.mjs out/x desktop arts:150:-448:22
```

- `views.mjs <outdir> [both|phone|desktop] [only]`: the standard 18 views
  (spawn, downtown (0, 8), arts (224, −248)) × (day 13:00, dusk 18:42,
  night 22:00) on phone (852×393, render scale 0.5) and desktop (1280×720),
  plus the title; prints draw calls per view.
- `spot.mjs <prefix> <phone|desktop> name:x:z:hour[:car[:rain[:sirens]]] ...`:
  teleport, set the hour (time frozen), optional car to spawn, `rain`, and N
  nearby cars with sirens on; logs console errors (catches GLSL failures).
- `obs.mjs <prefix> name:x:z:height:hour ...`: OBSERVE mode from the pause
  menu with the free camera at (x, z) and a height (roofs from above).
  Note: the free camera at yaw 0 faces the other way from play, so roof
  numbers read upside down there.
- `anim.mjs <prefix> x z`: 16 frames at a spot at 22:00, for a GIF.
- `sheet.py <dir> <phone|desktop> <out.png>`: a 3×3 contact sheet of a
  `views.mjs` set.

Useful handles on `window.__ub`: `testTools.teleport/setHour/setRain/
spawn/wanted`, `look.time.speed = 0` (freeze time), `look.glows.eye`
(camera position), `look.flyovers.sendNow(kind, x, z, heading, ahead)`,
`effects.explode(x, z)`, `player.hurt(1e6)` / `player.arrest(fine)`,
`observe.cam` (x, z, height, yaw).

Gotchas: SwiftShader is slow (a screenshot can take ~1 s, so fast things
like a plane's shadow are missed unless re-placed before each shot);
`pkill -f "<pattern>"` in the same shell command matches that shell and
kills it (kill the dev server by saved PID instead).
