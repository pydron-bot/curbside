# Destruction test

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
