# Handoff

Where things stand and what's open, for whoever picks this up next (a
person or a fresh Claude session). Keep it short: when an item ships, move
its notes to [HISTORY.md](HISTORY.md) and drop it here. How each system works
is in [`docs/systems/`](systems/) (index in the README); per-release notes in
`src/core/changelog.ts`.

## Where it is (2026-11-06)

- **Live:** **0.32.2** at https://deeek.org/curbside/, deployed by
  `.github/workflows/pages.yml` on every push to `main` (tests → build with
  `CURBSIDE_BASE=/curbside/` → deploy). The `github-pages` environment may
  ask for approval on the Actions run ("Review deployments").
- **Domain:** `deeek.org` is the custom domain of the user site
  `pydron-bot/pydron-bot.github.io` (the hub page); project repos with Pages
  on that account appear at `deeek.org/<repo>/`. Don't set a custom domain
  on this repo; it inherits.
- **Branches:** `main` is the shipped game. Work goes on a branch (`ci.yml`
  checks it: tests, types, GLB contracts, smoke test) and merges to `main` to
  deploy. Old stream branches are kept on GitHub; everything shipped is in
  `main`'s history.
- **Latest work (0.29–0.32):** map editor round 3 and IMPORT
  ([W3D_MAP.md](W3D_MAP.md)); dappled tree shadows; Diagnostics tools for
  hunting iPhone slowness: GPU BREAKDOWN (0.31.0) and LOW POWER TESTS
  (0.32.0), plus a frame "tail" stat; the player's pose in bug reports
  (0.32.1), then a fix for getting up tilted after being thrown off a bike
  (0.32.2). **Ask the owner** whether the "lying flat while aiming" report
  is gone with 0.32.2, and what LOW POWER TESTS showed on the phone.

## Open work, in priority order

1. **Real-device pass on the iPhone 15 Pro** (the owner, ~1.5–2 h; steps in
   [BACKLOG.md](BACKLOG.md) `device-checklist`). Settings → Perf overlay on
   Full, play, then pause → DIAGNOSTICS → SHARE and send the report (it
   carries the play log). Nothing below has been seen on a real phone:
   - *Look:* lamp streaks and neon reflections, rooftop neon at 852×340,
     searchlights, steam, cloud-shadow darkness, sun glints, the 5-star edge
     glow, the VHS glitch on WASTED/BUSTED, tree sway, fountain spray, dawn
     mist, billboards, gull size, the LOOK panel's sliders in Safari, the
     cop's silver cap band at night.
   - *Controls and UI:* BOOM's spot on touch at 852×393 and 852×340 (on foot,
     in a car, left-handed); HOSE drag-to-aim; observe pinch/twist; the
     scanner's 11 px text; the Settings sheet at 852×340; SHARE within
     WASTED's 3 s; the home-screen icon and launch screen; TOUCH TUNING's
     `TUNE` line (the numbers to bake in).
   - *Play:* the cold open (STEAL THIS CAR over the bus); s4 fairness, s5
     grenades on touch, s6 pace; chapter 2's timers; CRED pacing; how the
     witnesses' delayed heat feels; RACE CRASHER, VAN NICKED, adopted crashes
     and DOMINO pay; whether bodies, dogs, umbrellas, phone screens, coins,
     cuffed suspects, the taser's wires, the stinger strip and a stuck charge
     read at phone scale.
   - *Audio:* every station, the title theme, chase music and stings (no
     person has heard them yet); levels on foot; an ambient chase's sirens.
   - *Performance:* two smoke clouds; the Neon Mile's night crowd; walking
     past shops (drum kits warm in play).
   - **Destruction test soak** (decides whether it goes on by default): 15+
     minutes on Auto graphics with DESTRUCTION (TEST) → AUTO, BLOW A WALL
     every minute or two, watching for a tier drop or creeping p99 as the
     phone warms; SHARE at the end. Then the owner decides. Full procedure
     and the first run's numbers: [destruction-test.md](systems/destruction-test.md).
2. **1.0.0** after the device pass (the owner's call).
3. **Tuning from real play:** medals and the 5-star escape, from the play
   logs the device pass sends back ([testing.md](systems/testing.md) has the
   harnesses and baselines).
4. **Waiting on the owner:**
   - A `look.json` from the LOOK panel: commit it as `src/render/look.json` as
     it is (a test checks it's canonical; if hand-edited, re-serialise with
     `serialiseLookFile(parseLookFile(...))`), bump the version, ship. A
     constant with no slider: add a spec to `LOOK_SPECS`, or to `SHADER_LOOK`
     with its `LK_*` macro (keep `uLook` within 16 floats).
   - Map editor: the frenzy limits (`frenzyLimits.ts`) and whether the
     rectangle rule (REMOVE refused for an L) suits.
   - A bigger city (W3-A): the decisions listed in [W3A_CITY.md](W3A_CITY.md).
   - Which W3-E ideas, if any ([V2_PLAN.md](V2_PLAN.md) *W3-E*).
   - Any backend for an online leaderboard (`online-leaderboard` in BACKLOG).
   - The Old Town race's leg 1 lands a ramp jump at a corner checkpoint: keep
     it as a feature?
5. **Next features (chosen, not started):** W3-C, four street scenes (QUIET
   PLEASE march, roadworks, bin day with a tipper for Borrowed Blues, delivery
   rush; [V2_PLAN.md](V2_PLAN.md)).
6. **Known gaps, low priority:** a police car retired by the police system
   takes its sticky charge with it; ambient police cars aren't on the radar;
   the scooter stands in for a motorcycle; a tow can clip a neighbour in a
   tight car park; thrown props don't start scuffles; no busker music or
   visible bags; no scaffolding, work van or water barriers; later audio
   ideas (`music-radio-life`, `music-recorded`, `police-chatter`).

## Working conventions

- Big features as **streams in separate git worktrees** (`git worktree add
  ../cs-<name> -b <branch>`, `ln -s ../curbside/node_modules`), one owner per
  file area, `main.ts` edits kept to wiring; then an independent
  review-and-fix pass, then merge and the smoke test. At most three streams
  at once on a 4-core machine (the smoke test is CPU-bound); give each its
  own smoke port and scratch dir (`smoke.mjs` starts `vite preview` with its
  output ignored, so a taken port silently tests another stream's build).
  GitHub CI, uncontended, is the arbiter before `main`.
- **Hotspots** (keep edits small, expect merge conflicts): `src/main.ts`
  (register looks and `__ub` entries at the construction site, per
  [main-loop.md](systems/main-loop.md)),
  `core/events.ts`, `game/cityLife.ts` (one `add` line per scene),
  `audio/gameAudio.ts`, `game/population.ts`, `systems/crowd.ts`,
  `core/changelog.ts`.
- **Headless WebGL:** `chromium.launch({ args: ['--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`. SwiftShader
  runs at ~1 fps: drive tests through `window.__ub` (`startGame()`,
  `fastForward(seconds)`) and judge draw calls and correctness, not fps.
- Kill dev servers by PID: `pkill -f "vite --port …"` matches the calling
  shell's own command line and kills it.
