# Testing and tuning

Unit tests: `npm test` (vitest, `tests/`). Below: the browser smoke test and the headless tuning harnesses.

## Smoke test

**Smoke test** (`tools/smoke.mjs`): builds the game as Pages does, serves it
and plays it headless (Chromium + SwiftShader) on desktop 1280×720 and the
iPhone 15 Pro profile at 852×393 and 852×340: boot, a run, 30 s simulated,
no page or console errors, under 150 draw calls, and a named-mayhem stamp
(`__ub.stamp(id)`, held mid-show) clear of the stars, radar, status,
activity card and score feed (on the phones in a Chaos Run too), and the
police scanner's subtitle (`__ub.scanner.say()`) clear of all that, the
stamp, the radio's card and the thumbs, on foot and in a car; a fresh
save's title is PLAY and SETTINGS (OBSERVE too with Test tools on) and
gains OBSERVE, CHARACTER and HOW TO PLAY after the cold open; the
best-moment picture on WASTED (a forced stamp, then death: the photo and
caption inside the view, clear of WASTED's title, numbers and timer, the
pause button, corners and thumbs; SHARE gives the mocked share sheet a
JPEG, a refused share saves it, the respawn frees it); then
installability and an offline boot from the service worker. About 6 min
locally: the canvas is drawn at 0.35× its pixel ratio (`--scale`, the
page's `?renderScale=`), since software rendering costs by the pixel and
draw calls, tiers and the HUD are the same at any scale (checked with
seeded frames at 1× and 0.35×: identical calls and triangles); it was
~18 min at full size. `--scale 1` for sharp screenshots of the 3D view;
`--only desktop|852x393|852x340|pwa` runs one profile; `--jobs 2` builds
once and runs two profiles at a time (5.6 min against 6.2 on a 4-core
machine: they share the cores, so it pays only on a bigger one). Each
profile's time is in the output. CI (`.github/workflows/ci.yml`) runs the four profiles as parallel
jobs, beside the unit tests, types and GLB contracts, on every branch and
pull request; Pages (`pages.yml`) runs the tests and contracts before deploying
main.

## Tuning harnesses

`tools/tune/` drives the real game headless (Playwright + SwiftShader on the
dev server, through `window.__ub`, bots in place of `input.readVehicle`, no
game-code change). The page draws no frames, its clock is fixed and
`Math.random` is seeded, so the same seeds repeat exactly: change a knob, run
again, compare. Bots are a lower bound and a relative check, never the
verdict on difficulty; real play (the Diagnostics report's play log) is.
Playwright isn't a game dependency: run with
`npx -y -p playwright@1.63.0 node tools/tune/<harness>.mjs …` (or set
`PLAYWRIGHT` to a directory with it installed), with `npm run dev` up.
`SIM_LOD=off` runs every agent every step ([*Simulation level of detail*](driving-and-combat.md)):
since it came in the runs draw randomness in another order, so the figures
below shift within the bots' noise. 2026-11-01, 20 each, LOD on / off:
5-star chases, car lost 19 / 20, busted 1 / 0, median end 26 / 24 s; Chaos Run
medians rammer 9.0k / 5.3k, weaver 15.3k / 19.1k, drifter 7.5k / 10.2k.

- **`chaos.mjs [runs=20] [--bot rammer|weaver|drifter|all] [--seed 1]`**:
  Chaos Runs; score percentiles, medals, how runs ended, points by category.
  ~1.5 s a run. Baseline 2026-10-31 (20 runs each, seed 1): rammer median
  6.5k (p75 11.3k, max 24.5k), 4 bronze; weaver 12.7k (22.6k, 30.1k), 10
  bronze; drifter 7.8k (12.4k, 33.3k), 4 bronze; no silver or gold. Boom and
  smash are half to three quarters of the points (the weaver: drift 39%).
- **`heat.mjs [chases=20] [--stars 5] [--secs 180] [--tough] [--perks] [--seed 1]`**:
  chases from a built-up 3 stars to `--stars`, a junction-to-junction
  evader; escapes, busts, wrecks, time to each lower star, crashes, shots
  taken, helicopter time on you. `--tough` keeps the car healthy to test
  the evasion rules alone. Baseline 2026-10-31 (20 chases, 5 stars): stock
  sports car lost in 18, busted 2, median end 26 s, 1 drop to 4 stars;
  tough car: none escaped, 12 down to 4 stars (median 84 s), 3 to 3 stars,
  2 busted. `--perks` maxes every CRED perk; 2026-11-01 (12 chases each,
  seed 1): stock car lost at a median 33 s without, 45 s with; tough car
  2 of 12 down to 3 stars with them, none without; no escapes either way.
- **`inview.mjs [--roam 1200] [--pursuit 300] [--stars 2] [--seed 1] [--view 852x393]`**:
  how much of the living city a driving player sees ([*City life*](city-life.md), the
  in-view meter). A junction-to-junction bot drives the phone view through
  `--roam` seconds of free roam (stars cleared as they come), then a
  `--stars` pursuit (kept there, evading the police like `heat.mjs`), in
  1/8 s `fastForward` chunks, moving the camera and the clock between them;
  per segment: seconds with an incident in view, how often one came into
  view after a quiet spell and the gaps (median, p90, longest), and per
  kind seconds in view, started, seen, ended unseen. ~1 min a run. The
  numbers, before and after the city stopped holding off for stars, are in
  [HISTORY.md](../HISTORY.md) (*V2 in-view numbers*).
- **`mess.mjs [runs=8] [--shots 4] [--seed 1]`**: *Your mess, their
  problem* (City life). Each run: a fresh game, 20 s of traffic, a muscle
  car put 14 m behind a calm driver 40–90 m off and driven into its back;
  the adopted crash followed for 70 s (driver out, patrol on site, tow
  called, DOMINO awards, seconds the driver stood within 8 m of the player:
  `fastForward` doesn't move the camera, so the view isn't asked). Then
  `--shots` runs of the gunfire chain beside a parked car (a player `shot`
  on the bus, as combat sends it): its links, awards and stars. A few
  seconds a run. Numbers under [*City life*](city-life.md).
- **`crashers.mjs [runs=6] [--vans 6] [--seed 1]`**: *RACE CRASHER* and
  [*VAN NICKED*](city-scenes.md) (City life). Races: a street race begun by the spawn (no
  police), a sports car put in the oncoming lane beside its leader,
  rolling, and a bot that drives the route junction to junction (13 m/s
  into the turns, nitro on the straights): joined, won or beaten, how
  long, the stamp (one rendered frame after the win), the prize pulled up
  and how far past the line, then the player put at its door and the real
  enter button pressed (`stepFrame` with `consumeAction`): in, and whether
  that was a carjack. Vans: the ice cream van forced open beside the
  player, its queue left 6 s to fill, taken through the enter button and
  driven straight off at half throttle: the queue, the chase starting, the
  award and stamp, the nearest a chaser got, when they'd all given up, and
  the stars and witness calls. A few seconds a run. Numbers under *City
  life*.
- **`music.mjs <out-dir> [station-id …]`**: renders stations offline
  (`audioLib.mjs`: the game's own audio modules on an OfflineAudioContext
  in the page, ticked like the 25 ms timer) to MP3 (WAV without ffmpeg) for
  listening, with the songs heard and RMS / peak per 5 s window. `SECONDS`
  (90), `SCRIPT` (intensity steps, `0:1,24:3,48:5,72:0`), `MODE=menu`.
  Needs no game page, only the dev server (`URL=http://localhost:5173/`).
  The audio renders repeat too (`audioLib.mjs` seeds `Math.random` afresh
  for each, and renders every drum kit it will play before it starts): the
  same figures every run, the WAVs a 16-bit step apart in a few samples
  (the browser's own float rounding).
  Baseline 2026-11-01 (90 s, default script, raw music output): every
  station at −14.6 to −14.7 dBFS overall, about −18 at intensity 1, −15 at
  3 and −13 at 5; peaks at about 0 dBFS (the music bus and limiter follow in
  the game). New stations should land within a dB of that. The four added
  2026-11-01 do: SIDEWAYS 808 −14.6, GETAWAY 104.3 −15.1, DUBWISE 88.8
  −15.2 and INSERT COIN −14.8 overall, peaks at most +0.7 dBFS (as
  NIGHTDRIVE's +0.6). `MODE=menu` renders sit at −15.3 to −18.5.
- **`stings.mjs <out-dir> [name …]`**: renders the title theme and the
  stings built on its hook the same way, at the voice levels the game plays
  them: `theme`, `wasted`, `busted`, `mission-start`, `mission-passed`,
  `mission-failed`, `count-in` (3-2-1-GO at the real 1 s spacing) and
  `count-in-radio` (the same over the radio at the game's music / SFX
  balance: held down under the count, dropping in on GO). `SECONDS` (the
  theme, 60), `KEY` (MIDI, 45 = A), `INDEX` (the payphone job), `RADIO`,
  `MAJOR` (1 the major spelling, 0 minor; unset: minor for `KEY`, and
  `count-in-radio` follows the radio's song, as the game does). The major
  spellings are as loud as the minor (in D, 2026-11-01: count-in −21.7
  dBFS, mission start −18.8, failed −20.7; RMS within 0.1 dB, peaks within
  0.6); over INSERT COIN `count-in-radio` is −22.2 either way, with no F
  rubbing against its F# any more.
  Baseline 2026-11-01 (raw, key A, seeded): the theme −16.8 dBFS overall
  (about −18 in its intro and first hook, −15.5 in the hook with drums;
  the stations' menu tiers, above, −15.3 to −18.5), peak −1.8; WASTED −14.1
  (the old one −13.5), BUSTED −16.6 (old −16.9 to −18.4), peaking at +1.2
  and +1.5 dBFS from their slam and clang layers (the old ones +3.5 to +4.9
  and +1.6 to +2.1; the limiter follows in the game); mission start −18.8,
  passed −19.4, failed −20.7 now its landing tonic holds (peaks −5.7,
  −4.7, −7.7); the count's hits
  peak at −10, −8 and −5.5 and GO at −4.7.

- **`reactive.mjs <out-dir> [chase|on-foot …]`**: the music that reacts
  to play, through the same modules: `chase` is the radio (NIGHTDRIVE) at
  1 star, then wanted 3, 4, 5 and lost (`SCRIPT` "seconds:stars,…",
  `RADIO`); `on-foot` walks past a parked car, a shopfront and a boombox
  (cut with its scratch) through the street chain. Baseline 2026-11-01
  (raw): the chase −14.5 dBFS at 3 stars, −15.2 at 4 (its verse), −13.7 at
  5, peaks −1 dBFS; on music.mjs's default intensity script −15.9 overall
  (−16 to −18 at 1, −14.4 to −16 at 3, −13.6 to −15 at 5, the stations
  −18, −15, −13), its hook −5 to −6 dB against the rest (the theme's −4).
  On foot: a parked car peaks at gain 0.2 against the car radio (−14 dB)
  2.5 m off, a shop 0.19 at 3.5 m, the boombox 0.6 at 4 m and still 0.05 at
  26 m; a switch is silent for about 0.5 s.
- **`mayhem.mjs [--tier medium|low|high|all] [--time day|night|both] [--scenario mayhem|single|drive|pursuit] [--no-city-fires] [--step 50] [--dpr 3] [--shot dir] [--shots 2,17] [--fx auto|off|on] [--fx-scale 0.25]`**:
  heavy mayhem on the iPhone profile (unlike the others it renders: real
  frames stepped by `__ub.stepFrame(ms)`, Rapier loaded, god mode and the
  destruction test on). Blows up four cars and three walls round the
  player, two more cars at 8 s, two more and a wall at 16 s, and runs to
  36 s (fires, fire trucks, hoses); `single` is one car. Reports peak live
  particles, the transparent fill projected from the camera (screens of
  overdraw; SwiftShader can't time the GPU), glows and their fill, draw
  calls, fires and rubble. `--dpr 1` is faster and gives the same fill
  (a share of the screen). `drive` blows nothing up: a bot drives the
  nearest car round, handbraking into turns (tyre smoke); `pursuit`
  drives the same way at 5 stars (god mode, the car kept whole) with a
  busy scene started round it every 5 s through the TEST menu's starter
  (race, chase, accident, scuffle, tow, turf war, fire: past the holds and
  the wanted cap, a worst case), reporting the busy scenes and police
  units at their peak too. 2026-11-02, medium, 40 s, `--step 100 --dpr 1`:
  draw calls peak 76 / average 60 by day, 68 / 61 at night (7 units, 2–3
  busy scenes at once); `drive` alone 56 / 47. Smoke work is
  the soft particles' fill, or offscreen their fill × scale² × 1.25 plus
  the composite's tiles; `--fx off|on` forces the low-resolution smoke
  path off or on, `--fx-scale` tries another scale (dev server only), and
  `--shots` saves the frames at those seconds (with `--fx auto`, each
  also from the same frame with smoke at full and at low resolution).
  JS ms is the median frame. Numbers under [*Effects and camera*](effects-and-camera.md).
- **`story.mjs [--job s4|s5|s6|all] [--shot dir]`**: KEEP IT LOUD's jobs
  4–6 from the ringing payphone (the TEST tools' jump, then the call and
  LET'S GO) to the debrief, with a bot driving and the police kept off (a
  bot doesn't run). s4 follows the Shift's truck about 17 m back until
  it's caught standing, or after 45 s parks across its lane, then takes
  the van and drives the last 45 m to Doreen (the van's health at the
  end); s5 rams the Mayor's limo (blows it up after 150 s, and says so);
  s6 follows the coach for a lap (the crossings it took, the scenes
  featured, what the street saw), then rams the traffic round it (the
  real points counted; any short of 5,000 after 360 s are added, and
  said). Then PROGRESS's two story rows and their bars (`--shot`: a
  screenshot). 2026-11-02: all three passed; s4 caught at the block
  (48 s; never at a light in 45 s of following), the van at 98–100%;
  s5 in 28–44 s of ramming; s6's coach took the whole tour in order and
  round again, its race, fire and turf flare-up started, 3,100–5,700
  real points over runs.

- **`citySize.mjs [--sizes 16,24,32] [--runs 2] [--only desktop|iphone] [--no-build]`**:
  the W3-A spike. Builds and serves the game like the smoke test, boots it
  at each `?city=` size, and reports boot time (to `window.__ub`), JS heap
  after a GC, and draw calls at the spawn, in the ring and in observe at
  the widest zoom. Numbers in `docs/W3A_CITY.md`.
