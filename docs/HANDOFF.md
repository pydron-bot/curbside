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

Re-planned 2026-10-30 after a scoping pass: every item below was checked
against the code. **`docs/BACKLOG.md` has the details for each one** (cause
with file:line, proposed fix, risks, how to verify, what the user must
decide), under the id in brackets here.

**Done in the 2026-10-30 session:** settings sheet fits at 852×340; the
context-lost RELOAD button is reachable by keyboard/pad; long score-feed
lines wrap clear of the radio card; FRENZY FAILED queues behind
WASTED/BUSTED; bikes say STEAL THIS BIKE / GET ON and the marker ring fits
small vehicles; SMASH and bike HIT & RUN only when the player did the
ramming (head-ons still count); a build id in Settings and on the pause card;
the screen stays awake while playing; GLBs get precache revisions, so an
installed app picks up new art; stored settings are sanitised at boot.
Then: frame-time stats (fps, p50/p95/p99/max, hitches/min, JS p95) and a
Settings → Perf overlay choice (Off / FPS / Full; `?debug` forces Full)
[`perf-overlay` and `overlay-in-app`, minus `DynamicResolution.state()`, a
third overlay line and the DIAGNOSTICS button, which go with `diag-report`];
crowd members well off-screen aren't posed [`pose-offscreen`]; small
instance buffers upload whole and empty car batches not at all
[`upload-ranges`]; car batches share one precompiled shadow-depth material
[`shadow-depth-flip`]; the Old Town race no longer runs into the back of a
stunt ramp, with a test for every course; asset builds run under pip `bpy`
[`toolchain-bpy`]. Then: a session perf log (`curbside.diag`) and a
DIAGNOSTICS sheet on the pause card (shown while the Perf overlay is on, or
with `?debug`) whose SHARE / COPY report includes the play log
[`diag-report`, minus an alive marker and event-driven audio state]; app
updates no longer reload mid-run on an app switch or after a bust, only on
the title, after WASTED, or after 10+ minutes away [`update-reloads-midrun`];
a local play log of Chaos Runs, races and chases (`curbside.playlog`, via a
new `activityEnd` event) [`tune-telemetry`, core fields only]. Then:
haptics / rumble / live gamepad probes in the Diagnostics sheet
[`input-probes`]; fast vehicles are swept against static obstacles (no
more tunnelling through posts and bollards) and standing street furniture
is solid to people [`minor-props`]; races start with nitro at
`NITRO_START`; a timed-out Chaos Run is scored at the freeze, never below
the HUD; the radar tints by the real districts; muzzle flashes start at the
bore; Blender pass round 1: rooftop hut/tank tops in the GLB (no more
`PART_COLOURS`), paler pigeons with near-white wings, a silver cop cap band
and chest badge (SWAT too) [part of `characters-looks` / `props-world`].

**Done since (2026-10-31):** menu buttons act on a tap made with a thumb
still down (`src/ui/tap.ts`), **confirmed on the iPhone: it works every
time**. The destruction test (README *Destruction test*, off by default)
had its first device run: DESKTOP forced on the iPhone 15 Pro (home-screen
app, iOS 18.7, `medium` at 1.50x, build `0e8bf2c`, one 151 s session) held
59.9 fps, frame p99 18 ms, 0 hitches/min overall, with 145 bodies (none
awake once settled), physics avg 0.28 ms (worst second 0.58 ms) and 46–59
draw calls; Pages gzips the wasm (770 KB for 2.02 MB) and the second load
came from the runtime cache; switching modes warmed in 3 ms. One 10 s
window after the second DESKTOP blast dipped to 57 fps / p99 26 ms (one
hitch), then recovered. So `auto` now gives phones the desktop style:
`high` and `medium` are desktop, `low` stays scar-only (the safety valve
when DynamicResolution drops a tier), and PHONE stays on the switch to
compare against. Full numbers in README *Destruction test*.

1. **Optional before the device pass:** live touch tuning
   [`touch-tuning`].
2. **Real-device pass on an iPhone 15 Pro** (the user, ~1.5–2 h): turn on
   Settings → Perf overlay, follow [`device-checklist`] (the haptics /
   rumble / pad questions are answered by the probes in the Diagnostics
   sheet), then pause → DIAGNOSTICS → SHARE and send back the report (it
   carries the play log). Also look at cops at night: nobody has seen the
   new silver cap band on a phone yet.
   **The destruction test stays a test (off by default) until:**
   (a) **a 15+ minute soak on the phone** shows no throttling: Perf
   overlay on Full, pause → DIAGNOSTICS → DESTRUCTION (TEST) → AUTO (now
   the desktop style on the phone), wait for `rapier … ready`, then play
   normally for 15+ minutes, BLOW A WALL every minute or two (3–4 m from
   the wall, facing it), drive through the piles and blow up a car chain
   beside a wall; watch the overlay for a tier drop to `low` (breaches go
   scar-only) or a resolution step, and for fps / p99 creeping as the
   phone warms; SHARE the report at the end (its samples are the
   timeline). (b) **Rubble look polish** (cloud): reviewers said the
   chunks read as clean boxes rather than broken masonry; make them read
   as broken brick and concrete, still one batch and no new program.
   (c) Then decide whether the test goes on by default.
3. **Races and tuning** (cloud): the bot-vs-dev-time test [`tune-race-dev-times`]; commit
   the `__ub` bot harnesses [`tune-chaos-medals`, `tune-five-star-escape`].
   Re-tune medals and 5-star escape only from logged real play.
4. **Blender adjustment pass** (cloud): the pip `bpy` 5.2.3 module rebuilds
   every committed GLB headless (recipe in `docs/BLENDER_TODO.md`). Then: fly the `rocket` model
   [`rocket-projectile`], GetUp/Throw timing [`clips-getup-throw`], held
   weapons [`weapons-held`], slim backpack / Pike's collar
   [`characters-looks`], lamp and signal heads, police sign, safehouse door,
   booth roof, gantry span [`props-world`].
5. **deeek.org landing page** (cloud, after the user picks branding, the
   project list and the image): [`hub-screenshots`], [`hub-page`],
   [`hub-social-meta`], [`curbside-og-meta`], [`curbside-linkback`];
   same-origin rules [`shared-origin-landing`]; live HTTPS/domain check is
   the user's [`pages-domain-check`].
6. **Remaining minor issues:** left
   turns give way to the opposite queue (the real cause of the junction
   clipping) [`minor-junction-turns`]; animation sampling garbage
   [`anim-bake`], `Math.hypot` and call boxing in the sim
   [`hypot-hot-loops`, `sim-call-boxing`] (V8 only; wait for the device
   timeline). Also: a committed browser smoke test in CI [`smoke-ci`],
   branch/worktree cleanup [`repo-hygiene`], close out M8 in PLAN.md
   [`m8-closeout`], a real home-screen icon [`icons-splash`].
7. **Ideas:** district names + an area card first [`districts-landmarks`
   phase A], since chatter and gang turf need them; then police radio
   chatter [`police-chatter`]; missions after the eighth (payphones never
   ring again today; the `drive` spawn option is ignored) [`missions-store`];
   gangs [`gangs-respect`]; leaderboard needs a decision on any backend
   [`online-leaderboard`].

Smaller things found on the way (details in BACKLOG.md): README still
describes an `AnimationMixer` that's gone; the Old Town race's leg 1 has a
launch ramp landing at a corner checkpoint (is that a feature?).

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
