# Handoff — Curbside overhaul (2026-10-30)

Notes for whoever picks this up next (a person or a fresh Claude session).
The *how it works* lives in `README.md` (one section per system, with APIs);
this file is the *where things stand* and *what's left*.

## Where it is

- **Live:** https://deeek.org/curbside/ — GitHub Pages, deployed by
  `.github/workflows/pages.yml` on every push to `main` (tests → build with
  `CURBSIDE_BASE=/curbside/` → deploy). The `github-pages` environment may ask
  for approval on the Actions run ("Review deployments"); remove required
  reviewers under Settings → Environments → github-pages to skip that.
- **Domain:** `deeek.org` is the custom domain of the user site
  `pydron-bot/pydron-bot.github.io` (GoDaddy DNS: four A records for `@` to
  185.199.108–111.153, CNAME `www` → `pydron-bot.github.io`). Project repos
  with Pages on the `pydron-bot` account appear at `deeek.org/<repo>/`. Don't
  set a custom domain on this repo; it inherits.
- **Branches:** `main` is the shipped game. `claude/game-overhaul` is the
  overhaul's integration branch (same as `main` after the final merge). The
  `stage*/…` branches are the per-stream work that was merged in; they can be
  deleted. `blender/assets` is the Blender session's branch (merged).

## What the overhaul did

Starting from the M5 sandbox, in stages, each built in parallel git worktrees,
independently reviewed and fixed, then merged and play-tested:

1. **Core:** event bus (`src/core/events.ts`), player state module, bug fixes
   (vehicle leak, explosion death chain, pause/input), off-screen spawning and
   denser streets, quality tiers + dynamic resolution, PWA update deferral,
   GL context-loss handling.
2. **Audio:** fully synthesised Web Audio — engine/gearbox, tyres, weapons,
   crashes, explosions, sirens, ambience, adaptive procedural music with radio
   stations (`src/audio/`).
3. **Look:** batched rendering (all people/cars/glows in a few draw calls), sun
   shadows, ACES + grade, shader-drawn roads/buildings, districts, 12-minute
   day/night, street light pools, desktop bloom (`src/render/look.ts`).
4. **UI:** title over a live attract mode, pause/settings/how-to, rotate card,
   touch overhaul (point-to-steer, pedal pad, twin-stick aim), mouse and
   gamepad aim, new HUD, radar with blips/waypoints, haptics (`src/ui/`).
5. **FX:** particle pools, skid marks, sparks, tracers, muzzle flashes,
   explosion sequence with debris/scorch, camera trauma/kicks/hit-stop, rain.
6. **Heat (M6):** 0–5 star wanted level, police pursuit AI, roadblocks, SWAT,
   helicopter, officers on foot, BUSTED, Pay 'n' Spray, traffic reactions.
7. **Progression (M7):** save + cash, bank-your-chaos, Chaos Run 2:00 with
   medals, frenzies, hidden packages, races, exports, taxi fares, eight
   payphone missions, safehouse shop, progress page.
8. **Feel:** handling (top speeds, cornering limit, drifts, burnouts, nitro),
   damage + armour, ped HP and combos, grenades/molotovs/rockets, drive-bys,
   stunt ramps.
9. **QA:** four adversarial playtests (iPhone flow, cross-system seams,
   performance/long sessions, desktop polish), ~30 fixes.
10. **Blender assets integrated:** 22 animation clips, 8 body GLBs (crowd mix,
    cop, story characters), weapons in hand, pigeons, street/rooftop props,
    landmarks, pickups, debris, 12 new vehicles incl. scooter and police bike
    (lean, rider, ejection), the helicopter model. Contracts and the Blender
    session's notes: `docs/BLENDER_TODO.md`.

Numbers at handoff (headless Chromium + SwiftShader, so no real frame rates):
606 tests; iPhone profile ('medium') ~38–56 draw calls in busy scenes,
desktop ('high') ~50–70, budget 150; no shader compiles after start-up.

## To do (in priority order)

1. **Real-device pass on an iPhone 15 Pro** (nothing here was run on real
   hardware): frame rate and heat (Settings → Show FPS), Safari toolbar vs
   home-screen app, silent switch + audio, haptics, a Bluetooth controller
   (rumble probably unsupported in iOS Safari), touch feel of point-to-steer
   and the pedal pad. Tune from what you find.
2. **Tune from real play:** Chaos Run medal lines (15k / 40k / 80k), race
   developer times (`DEV_SPEED` / `DEV_CORNER`), and whether 5 stars is too
   hard to escape (currently survivable via the helicopter's refuel window,
   resprays or wrecking pursuers).
3. **Blender adjustment pass:** look at the new art in game and fix scale /
   readability from 20–60 m up — see the "Code side integrated" notes at the
   end of `docs/BLENDER_TODO.md` (e.g. guns in hand are tiny, the helicopter
   silhouette is large at night on phones, a `GetUpFast` clip and an earlier
   `Throw` release were requested). The `rocket` projectile model isn't used
   yet.
4. **deeek.org landing page:** replace the placeholder `index.html` in
   `pydron-bot/pydron-bot.github.io` with a hub for all projects (Curbside
   first; any other Pages-enabled repo on the account lives at
   `deeek.org/<repo>/`).
5. **Known minor issues** (from the stream reviews; none block play):
   - SMASH is awarded when another car hits a stopped player.
   - Settings sheet scrolls slightly at 852×340 (Safari toolbar showing).
   - The context-lost "reload" button isn't reachable by keyboard/pad.
   - The radio "now playing" card can briefly overlap long score-feed lines.
   - No FRENZY FAILED banner if a frenzy ends behind the WASTED card.
   - Knock-over street furniture isn't solid to people; a bike at full
     nitro can tunnel through the thinnest props (0.4 m posts).
   - The HUD prompt says "STEAL THIS CAR" for bikes; the car marker ring is
     oversized around a scooter.
   - Long vehicles turning at junctions can still clip queued cars.
   - Desktop V8 sees ~10 KB/frame of number-boxing garbage in animation
     sampling (not expected on iPhone's JavaScriptCore).
6. **Ideas not started:** police radio chatter, more districts/landmarks,
   gangs/respect, a proper store of missions beyond the first eight, online
   leaderboard (would need a small backend; the game itself is static).

## Working conventions that worked

- Big features as **streams in separate git worktrees** (`git worktree add
  ../cs-<name> -b stage/<name>`, `ln -s ../curbside/node_modules`), one
  owner per file area, main.ts edits kept to wiring, CSS per stream; then an
  independent review-and-fix pass, then merge + a Playwright smoke test on
  desktop 1280×720 and iPhone 15 Pro landscape (852×393 @3x, also 852×340).
- Headless WebGL: `chromium.launch({ args: ['--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`. SwiftShader
  is ~1 fps: drive tests with `window.__ub` (game internals, `startGame()`,
  `fastForward(seconds)`) and judge draw calls/correctness, not fps.
- Kill dev servers by PID; `pkill -f "vite --port …"` matches the calling
  shell's own command line and kills it.
