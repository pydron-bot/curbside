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
- **Branches:** `main` is the shipped game; work goes on a branch (CI checks
  it) and merges to `main` to deploy. Cleaned up 2026-10-31: every merged
  branch was deleted (local and on GitHub) and the `curbside-blender`
  worktree removed. Their tips, should one be wanted (`git branch <name>
  <sha>`; the commits are all in `main`'s history): claude/game-overhaul
  3c10413, claude/destruction-test 0e8bf2c, blender/assets 890beb8,
  stage1/audio cf04f04, stage1/core b83c520, stage2/look 556701e, stage2/ui
  9718d38, stage3/fx ebb1965, stage3/heat 5f3d532, stage4/feel 82848a5,
  stage4/play a38e987, stage5/qa 0faca68, stage6/assets 00c4d65,
  stage6/people 9d63f9c, stage6/world 3717b34.

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
4. **UI:** title over a live attract mode (framed right of the menu, cutting to
   city-scene highlights: README *Title highlights*), pause/settings/how-to, rotate card,
   touch overhaul (point-to-steer, pedal pad, twin-stick aim), mouse and
   gamepad aim, new HUD, radar with blips/waypoints, haptics (`src/ui/`).
5. **FX:** particle pools, skid marks, sparks, tracers, muzzle flashes,
   explosion sequence with debris/scorch, camera trauma/kicks/hit-stop, rain.
6. **Heat (M6):** 0–5 star wanted level, police pursuit AI, roadblocks, SWAT,
   helicopter, officers on foot, BUSTED, Pay 'n' Spray, traffic reactions.
7. **Progression (M7):** save + cash, bank-your-chaos, Chaos Run 2:00 with
   medals, frenzies, hidden packages, races, exports, taxi fares, thirteen
   payphone missions in two chapters (`docs/STORY.md`), safehouse shop, progress page.
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
draw calls; Pages serves the wasm compressed (770 KB for 2.02 MB) and the
second load came from the runtime cache; switching modes warmed in 3 ms.
One 10 s window after the second DESKTOP blast dipped to 57 fps / p99
26 ms (one hitch), then recovered. So `auto` now gives phones the
desktop style: `high` and `medium` are desktop, `low` stays scar-only (the
safety valve when DynamicResolution drops a tier, which it only does with
Settings → Graphics on Auto, the default), and PHONE stays on the switch to
compare against. Full numbers in README *Destruction test*.

**Done 2026-11-01:** the service worker's navigation fallback skips URLs
that name a file (`navigateFallbackDenylist` in `vite.config.ts`), so
opening `/curbside/og.jpg` (or any file added there later) on a device that
has played shows the file, not the game; `.html` and the bare game URL
still get the offline shell.

1. ~~Live touch tuning~~ [`touch-tuning`]: done 2026-10-31 (pause →
   DIAGNOSTICS → TOUCH TUNING; README *Controls*). Use it during the device
   pass and send the report: its `TUNE` line is the numbers to bake in.
2. **Real-device pass on an iPhone 15 Pro** (the user, ~1.5–2 h): turn on
   Settings → Perf overlay, follow [`device-checklist`] (the haptics /
   rumble / pad questions are answered by the probes in the Diagnostics
   sheet), then pause → DIAGNOSTICS → SHARE and send back the report (it
   carries the play log). Also look at cops at night: nobody has seen the
   new silver cap band on a phone yet.
   **The destruction test stays a test (off by default) until:**
   (a) **a 15+ minute soak on the phone** shows no throttling: Perf
   overlay on Full and Settings → Graphics on Auto (a fixed Med never
   drops to `low`), pause → DIAGNOSTICS → DESTRUCTION (TEST) → AUTO (now
   the desktop style on the phone), wait for `rapier … ready`, then play
   normally for 15+ minutes, BLOW A WALL every minute or two (3–4 m from
   the wall, facing it), drive through the piles and blow up a car chain
   beside a wall; watch the overlay for a tier drop to `low` (breaches go
   scar-only) or a resolution step, and for fps / p99 creeping as the
   phone warms; SHARE the report at the end (its samples are the
   timeline). Still open from the first run: with a Mac at hand, any GC
   sawtooth in the Safari timeline while a pile settles; and the boot
   `warm` event with the test on at boot (relaunch the app with AUTO
   saved) against one from an `off` session. On a desktop machine the
   same with DESKTOP (or `?destruction=desktop`), against the estimate of
   ≤ 1.3 ms physics p95. (b) **Rubble look polish**: done in the cloud
   2026-10-31 (desktop sizes skewed small, more core, per-chunk tint, a
   dust-and-gravel spill decal at the wall's foot; still one batch, no new
   program or draw call). Needs a look on the phone in daylight and at night
   during the soak.
   (c) Then decide whether the test goes on by default.
3. **Races and tuning**: the bot-vs-dev-time test
   (`tests/raceDevTime.test.ts`) and the seeded harnesses `tools/tune/chaos.mjs`
   and `heat.mjs` with baselines (README *Tuning harnesses*) are done
   2026-10-31. Still open: re-tune medals and 5-star escape from logged real
   play. Gold is reachable in any car (decided 2026-10-31): the dev time
   scales with the car on the line (`carPace` in `modes/races.ts`), and
   tightens if a faster one is taken mid-race (`RaceRun.takeCar`).
4. **Blender adjustment pass: done 2026-10-31** (rebuilt with the local
   Blender 5.2.3 LTS, `npm run assets`; the pip `bpy` recipe in
   `docs/BLENDER_TODO.md` gives the same files). The flying `rocket`,
   `grenade` and `molotov` models from weapons.glb [`rocket-projectile`,
   `render/combatLook.ts`, same shader program before and after the load];
   `GetUpFast` and a Throw that releases at 25% [`clips-getup-throw`;
   `GETUP_LEAD` 0.92, Throw from 0 at 1×]; held guns bigger across with a
   stripe on top, a bigger grenade and molotov, the launcher on the
   shoulder (rockets fly at 1.45 m) [`weapons-held`]; a big boxy slim
   backpack and Pike's pale collar [`characters-looks`]; lamp and signal
   tops, a lit police-lamp cap and safehouse shade, a lighter booth roof
   and a 17.2 m gantry at 1:1 [`props-world`]. Still for the device pass:
   whether all that reads on the phone, the heli's size at night, and the
   pickups' scale (left in code, [`pickups-debris`] skipped as low value).
5. **deeek.org landing page: done 2026-10-31.** The hub in
   `pydron-bot/pydron-bot.github.io` (`c7c1e80`): a wall of posters with
   Curbside featured, a "More soon" flyer and stills, a matching 404,
   favicon, touch icon, link-preview meta and `og.jpg`, `.nojekyll`; its
   README covers adding a project and the same-origin rules (no service
   worker or manifest at `/`) [`hub-screenshots`, `hub-page`,
   `hub-social-meta`, `shared-origin-landing`]. Curbside (`af2e1a3`):
   link-preview meta and `public/og.jpg`, and a MORE AT DEEEK.ORG link on
   the title [`curbside-og-meta`, `curbside-linkback`]. Left for the user
   on a real network: [`pages-domain-check`] (both URLs on the phone and
   desktop, Settings → Pages: DNS check and Enforce HTTPS, `www`
   redirects, a link preview in iMessage).
6. **Minor issues: all done 2026-10-31.** Left turns give way
   [`minor-junction-turns`] (README *Traffic lights*); the browser smoke
   test and CI [`smoke-ci`: `tools/smoke.mjs`, `.github/workflows/ci.yml`];
   M8's criteria in PLAN.md [`m8-closeout`]; branch cleanup
   [`repo-hygiene`]. Garbage [`anim-bake`, `hypot-hot-loops`,
   `sim-call-boxing`]: clips baked into Float32Arrays, `len2` for
   `Math.hypot`, allocation-free static contacts, indexed loops in
   `simulate`; headless V8 now allocates ~12 KB per sim step (was ~55) and
   ~1.1 KB per frame posing the crowd (was ~3.5); `tests/animBake.test.ts`
   checks the baked clips against three's interpolants. Home-screen icon
   [`icons-splash`]: rendered from the game (`tools/make-icons.mjs`: the
   car from above at night in its ring), with a 180 px apple-touch-icon and
   a PNG favicon; still to note on the device pass: how it looks on the
   home screen and what iOS shows at launch (no startup images yet). An
   INSTALL button on the title for Android / desktop Chrome and Edge
   (`ui/installPrompt.ts`, shown only while the browser offers
   `beforeinstallprompt`; iOS keeps its Add to Home Screen tip). The
   manifest keeps no explicit `id` (it defaults to the start URL, which is
   what installed copies already have).
7. **Music: done 2026-11-01** on `claude/music-7` (README *Audio*). Four
   new stations, each with four songs and their own instruments: SIDEWAYS
   808 (phonk: cowbell, sliding 808), GETAWAY 104.3 (funk / disco: slap,
   wah), DUBWISE 88.8 (dub: one drop, skanks, tape echo), INSERT COIN
   (chiptune; the one major-key station) [`music-stations`]. A title theme
   with a hand-written hook, and stings built on it: WASTED, BUSTED,
   mission start / passed / failed, a 3-2-1-GO count-in that drops the
   radio in on a chorus; stings follow the song's key and mode
   [`music-themes`]. A chase score from 3 stars that calms down when the
   cops are lost (R / a tap on its card skips it); on foot the car you left
   plays on where it stands, and you hear about one parked car in three,
   shopfronts (stations by district) and the VIPERS' boombox (phonk, cut
   with a scratch when they turn on you) faintly as you pass
   [`music-reactive`]. `tools/tune/music.mjs`, `stings.mjs` and
   `reactive.mjs` render it all offline to MP3 (seeded, repeatable).
   Reviewed adversarially (36 verified findings, all fixed, each with a
   test); 964 tests; smoke test passes. **For the device pass:** listen to
   every station, the theme, the chase and the stings on the phone (nothing
   has been heard by a person yet); walk NEON MILE past a hangout; check
   the levels on foot (cars and shops sit ~14 dB under the car radio, the
   boombox ~4 dB) and that the chase card fits; watch the Perf overlay
   while walking past shops (kits now warm from the unlock, gently in play;
   ~7 MB of drum buffers per session). Still kept for later: a living
   radio (DJ, idents, ads) [`music-radio-life`], recorded tracks
   [`music-recorded`], a police scanner station (with [`police-chatter`]).
8. **Ideas:** district names + an area card first [`districts-landmarks`
   phase A], since chatter and gang turf need them; then police radio
   chatter [`police-chatter`]; missions after the eighth [`missions-store`]: driven
   target cars (`drive: true`) and REPEAT JOB replays at half pay are done
   2026-10-31; chapter 2, *The Ledger* (five jobs against Commissioner
   Clamp, script in `docs/STORY.md`), done 2026-11-01: play it on the
   phone and tune its timers;
   gangs [`gangs-respect`]: district names (placeholders), the area card and one gang (VIPERS, NEON MILE, respect) done 2026-10-31 on `claude/gangs`; leaderboard needs a decision on any backend
   [`online-leaderboard`].

9. **CRED and perks: done 2026-11-01** on `claude/cred-perks` (README
   *Progression*, design in `docs/CRED.md`). Every life earns CRED; a level
   holds the WASTED / BUSTED screen for a pick of three perks (eight perks,
   four ranks each), off in the Chaos Run and races. **For the device
   pass:** tap a pick on the phone, feel the pacing (first level after a
   life or two?), and watch whether stars give too much CRED.

10. **Living city, the shared base: done 2026-11-01** on
   `claude/living-city` (README *City life*). The knocked out stay down
   and an ambulance takes them to the hospital (new, `+` on the radar);
   parked cars at the kerbs and in the car parks' painted bays; anyone
   armed knocked out drops their gun to pick up (before: nobody dropped
   anything). Under them: the `CityLife` director with a pure scheduler
   (cooldowns, caps, range from the player; holds for the title, an
   activity, wanted stars and the tutorial), a service-vehicle call-out
   (`scenes/service.ts` ServiceRun) and queues/crowds
   (`scenes/gathering.ts` Gathering), typed `street` events. iPhone
   profile ~41 draw calls on average at a fixed seed (40 before), no new
   mesh or program; smoke OK (61 / 51 iPhone, 70 desktop).
   **Being built on it in parallel** (one worktree each, branched from
   this base): fires and fire trucks, police chases, street races, the ice
   cream van's queue, bus stops, tow trucks, scuffles between people; and
   the extras (witnesses, traffic accidents, car alarms, muggings,
   performers and stands, gang flare-ups, double-parked trucks, crowds by
   time and weather, stray dogs). A first draft of the scenes, written
   before the work was split, is on the local branch
   `claude/living-city-scenes-draft` (`4301862`, not pushed): a starting
   point, not reviewed against this base's APIs.
   **Atmosphere: done 2026-11-01** on `claude/city-atmosphere` (README
   *City life*): crowds by the hour and the weather (`game/cityMood.ts`
   `densityFor`; the Neon Mile and the old town fill at night, the docks
   and suburbs empty, rain thins every street), umbrellas, sheltering
   under awnings and hurrying in the rain, groups under the neon at
   night, a `nightlife` factor for the street races (`life.d.mood`), stray
   dogs that chase runners and bark, pigeons that land again, and gang
   turf flare-ups on the VIPERS' borders with colours-only rival crews
   (step in and the side you didn't hit stands with you). Umbrellas and
   dogs are code-built stand-ins in the props' `things` family (+2 calls
   at most; Blender contract in `BLENDER_TODO.md` §8.8). **For the device
   pass:** do the dogs and umbrellas read from the street camera; is a
   skirmish (10–20 s) too short; the night crowd in the Neon Mile (up to
   ~30 people plus the groups) on the phone's CPU.
   **Hotspots** (keep edits to these small): `core/events.ts` (the
   `StreetWhat` members for the planned scenes are already there),
   `game/cityLife.ts` (one `this.add(...)` line per scene), `main.ts` (one
   `cityLook.add(...)` per scene that draws), `game/population.ts` and
   `systems/crowd.ts` (the `street` / `scene` / `injured` / `ambient` /
   `parked` flags), `audio/gameAudio.ts` (`onStreet`). **For the device
   pass:** does a knocked-out body lying there read on the phone; are the
   parked cars in the way on foot or in a chase; the drop ring at night.
   **Emergency services: done 2026-11-01** on `claude/city-emergency`
   (README *City life*): fires on exploded cars and on walls hit by a
   grenade or rocket, put out by a fire truck's two firefighters with
   hoses (or burning out by themselves); tow trucks taking wrecks,
   abandoned and parked cars away on the hook; car alarms from a bump, a
   shot or a blast (flashing indicators, a synthesised alarm). Rules pure
   and tested (`systems/emergency.ts`, `tests/emergency.test.ts`); a new
   `StreetWhat` member, `alarm`. No new mesh or program; worst case +6
   draw calls on the iPhone profile (fire truck and tow truck in view,
   with the firefighters' body). **For the device pass:** the flames and
   the hose jets in daylight and at night, the alarm's level against the
   radio, a tow in a tight car park (the car on the hook can clip a
   neighbour: it's carried, not simulated).

11. **Street props, round 2: done 2026-11-01** on `claude/street-props`
   (README *World*: *Placement*, *Road works*, *Food carts and bus stops*,
   *Collision*, *Stand-ins*). Denser, more varied kerbs (parking meters,
   planters, bike racks, recycling bins, shopping carts; café tables,
   vending machines and ATMs against shopfronts); 18 road-works sites at
   the kerb that traffic drives past in its lane (pulling over for a siren
   too); food carts and fruit stands; 86 bus shelters. All in the `street`
   family, so no new draw call (iPhone profile, same spots before → after: 49 → 49 at the spawn, 43 → 43 at a works site, 33 → 33 downtown); box stand-ins until props.glb
   has the models (contracts: `docs/BLENDER_TODO.md` §10). **For the
   people stream:** `dressing.street.vendors` (serve point, queue
   direction, vendor spot) and `dressing.street.busStops` (wait spot, where
   a bus pulls in, its lane) are used by item 12 (the shelters are now
   the only bus stops; walkers step round a kerb cart's queue). **For the device pass:**
   whether the stand-ins read from the phone's camera, and the street
   family's vertex cost (5,976 vertices per instance, was 3,276; every
   instance runs every model's vertices, dropped early) in a busy downtown
   view. Not done: scaffolding, a work van, water barriers.

12. **City people: done 2026-11-01** on `claude/city-people` (README *City
   life*, *People*; built on item 10's base). The bus shelters are the only
   bus stops (`placeBusStops` is gone; CityLife takes the shelters and the
   carts through its deps). Buses pull in at shelters where people have
   gathered, riders board through the front door and a few get off; the
   ice cream van stops by parks and plazas and serves a queue; food carts
   get a vendor and a queue, busiest at lunch and in the evening, and
   walkers step round people standing on the pavement; buskers draw a
   crowd that tips; scuffles start from a barge (a fleeing ped, the player
   sprinting), stray fire or a queue-jumper, with a ring of onlookers and
   now and then a knockout for the ambulance; muggings, with a bag to win
   back for $50; and witnesses: knocking a civilian down or a carjacking
   seen only by passers-by is phoned in after 3–5 s, which knocking the
   caller down or getting 45 m away stops (`HeatDeps.witnesses`,
   `heat.called`; no witness, the old immediate heat). No new mesh, program
   or draw call (iPhone profile, fixed seed, seven places: 41.9 → 42.1
   on average, 57 → 56 at most; README *City life* budget). **Shared-file edits:** `cityLife.ts` (deps
   `busStops`, `vendors`, `hour?`, `reward?`, `callIn?`; the `witnesses`
   field; eight `add` lines), `main.ts` (those deps, the heat hook,
   `cityLook.add(peopleLook(...))`), `heat.ts` (the hook and `called`),
   `events.ts` (four `StreetWhat` members), `population.ts`
   (`CrowdPed.phone`), `peoplePose.ts` (one line), `gathering.ts` (`place`,
   `release`); the scenes' shared bits are `scenes/people.ts`. **For the device pass:** do the phone screens, the mugger's
   ring and the coins read on the phone; is a bus at a shelter in the way
   on foot; how the delayed heat feels (tune `CALL_SECONDS`, `SEE_RANGE`,
   `CALL_RANGE` in `systems/witnesses.ts`). Not done: thrown or knocked
   objects starting scuffles (no event carries who a knocked prop hit),
   people carrying a visible bag, a busker's music.

13. **City traffic: done 2026-11-01** on `claude/city-traffic` (README
   *City life*, *Traffic scenes*). Ambient police chases (car, scooter or
   on foot; arrested, taken down for the ambulance, or escaped) that never
   touch the player's heat (attack the officers and the usual crimes
   apply; any star breaks the chase off and its officers join the police
   as strays); night-weighted street races with nitro, sometimes chased;
   rear-end accidents (smoke, hazards, an argument, sometimes a fight, a
   patrol car breaks it up; the cars stay flagged `Vehicle.towable` for
   the tow-truck stream); double-parked delivery vans and garbage trucks
   with a queue that honks and goes round. One incident (chase, race,
   accident) at a time; a forced scene costs at most +9 draw calls on the
   iPhone profile; smoke OK (56 / 56 iPhone, 68 desktop). Merged with the
   others: races read the mood's nightlife where the player is
   (`nightlife()` in `scenes/streetRaces.ts`), and tows take `towable`
   crashes first.
   **For the device pass:** are the sirens of a chase you're not in too
   much; does a cuffed suspect read at phone scale; are races too fast to
   follow on foot; how often the queue behind a truck blocks your own run.
   Not done: a proper motorcycle model (the scooter stands in); ambient
   police cars aren't on the radar.

Smaller things found on the way (details in BACKLOG.md): the Old Town race's leg 1 has a
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
