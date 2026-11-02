# Curbside V2 — plan

_Written 2026-11-02 against 0.13.0. It came out of a brainstorm: three
designers (hook & systems, story & world, presentation & reach), a critical
judge who checked their claims against the code, one rebuttal round, and a
final verdict. Owner's constraints: a **wider public release**, **build on**
the Graveyard Shift story and comic British tone, **offline only** (static
hosting, no backend), **two weeks**._

## The short version

> **Curbside is the top-down city game where you don't steal cars, you tow
> them.** You're the newest hire on a night tow crew. The hook is your tool
> and your weapon, the paint on the kerb decides whether a tow is a job or a
> crime, and every night ends with a parking ticket made of your crimes that
> you can send to a friend as a challenge.

Today the first 30 seconds show a `STEAL A CAR` pointer (`tutorial.ts:31`),
a payphone and the tagline `STEAL · DRIFT · CAUSE CHAOS`
(`titleScreen.ts:77`). That is GTA 2's opening, and a stranger closes the
tab thinking "clone". The game already has the answer: the tow crew premise,
the AI tow trucks that hook, winch and drag cars (`scenes/tows.ts`,
`systems/emergency.ts` `towPose()`/`winch()`), the tow-truck GLB with its
boom and hook, a Parking Commissioner villain. It just never lets the player
do the thing the story is about. V2 does.

## Your four questions

### What's the hook for other players?

The **hook itself**, as a verb. In any tow truck, one context button reads
HOOK: the truck lines itself up and winches the car up. Drag it, DROP it at
the yard, or let go at speed and **FLING** it into a police cordon. It's
easy to grasp, physical and funny, and a car whipping round a junction on a
chain is the five-second clip someone posts.

Wrapped round it: a **six-minute Night Shift** (22:00 to dawn) sized for a
bus ride, a **daily seeded night** everyone plays, and a **Penalty Charge
Notice** share image whose link drops a friend into the same night. With no
backend, the link is the leaderboard. The living city (chases, wrecks, fires,
turf wars) is what makes each night chaotic; it no longer has to be the pitch.

### How do we differ from GTA 2?

What stays: top-down camera, wanted stars, carjacking, a sandbox city.
Strangers will see that, and that's fine if the first minute is about
something else. V2 differs in four ways you play, not just in paint:

1. **Different verb.** In GTA 2 a car is something you sit in. Here you
   also carry one behind you, and drop, deliver or throw it.
2. **Different law.** GTA's rule is "any crime gives a star". Curbside's
   rule is painted on the street: hook a car off tonight's **red kerb** and
   it's a legal tow (no heat, a council fee); hook one anywhere else and
   it's theft (a witness phones it in, stars come, the yard pays ×3). Every
   hook is a risk/reward choice you can see on the ground.
3. **Different session.** A bounded night with a job queue, an opponent who
   does your job instead of shooting at you (Clamp's orange truck), and a
   dawn tally, instead of a sandbox you wander.
4. **Different voice and villain.** A small-scale comic British civic farce
   instead of anonymous gangs, in the cold open, the area cards
   (`RUSTWATER DOCKS · LOADING ONLY. NO WAITING. NO HOPE.`), Tuna's
   dispatch calls and the ticket.

**Pruning matters as much.** Kill frenzies (`KNOCK DOWN 15`) are GTA 2's
most recognisable mechanic under another name, and taxi is Crazy Taxi. V2
hides frenzies, taxi, packages, exports and races from **fresh** saves until
after the first Shift, so a newcomer sees one game, not a GTA checklist.
Saves with progress (yours, your friends') keep everything.

### How does the name relate to the game?

**CURBSIDE becomes the villain's paperwork, and the kerb becomes the playing
field.** In the fiction it's Commissioner Clamp's council scheme, the
*Council Unit for the Regulation of Bays, Streets, Impounds, Drives and
Enforcement*. It's stencilled on his orange trucks, heads every Penalty
Charge Notice, and the first thing that happens to you is a CURBSIDE truck
towing your car. Mechanically, the kerb is the rule set (red = legal tow).

**Curb vs kerb:** keep the CURBSIDE wordmark with a C. It's the URL, the
installed app name and the search term. Everything in the world says
"kerb". The mismatch becomes one joke, used once each:

> **VEX:** It's 'kerb'. With a K. They spelt it wrong so it'd fit on the side of the trucks.
> **CLAMP:** CURBSIDE is spelt with a C. The acronym requires it. Complaints may be made in writing.

### What's the player's backstory?

**Registered Keeper 000001.** You fell asleep in your own car (a faded
mustard compact) on a double yellow in Glass Heights. At 21:04 one of
Clamp's CURBSIDE trucks towed it with you inside. When the winch tilted it
you rolled out onto the kerb, and the truck drove off with your car, and
your phone in the glovebox. You're the scheme's first victim, which is why a
payphone is the only line that can reach you. Vex, who watched from across
the street, rings it, hands you her spare truck and offers you a job doing
to the city what was just done to you. Release fee: $5,000.

It's a grievance anyone with a parking ticket gets, it fits on one card, it
works for either body ("keeper", "occupant"), and it ties you to the crew
and the villain from the first second instead of chapter 2. It's **played**,
not read: control from second 2. Getting your car back is the long thread;
V2 only teases it (`VEHICLE 000001 · IMPOUNDED · $5,000` on the pause card)
and chapter 3 pays it off in V2.1.

## Pillars

1. **One verb: the hook.** Hook, drag, drop, fling, with one context button
   and an auto line-up. Every V2 item teaches the hook, gives it a reason,
   or shares its result. Anything else is out.
2. **The kerb is the law.** Red kerb = legal tow, anything else = theft,
   painted in the existing ground shader. The name, the risk/reward and the
   look are one thing.
3. **One night, one ticket.** The six-minute Night Shift is the session. It
   ends in a Penalty Charge Notice that is the result screen, the share
   image and (with a link) the leaderboard. One mode, one daily, one artefact.
4. **Thirty seconds to the premise, on a real phone.** A live cold open, a
   pruned front door, copy that names the tow, and a launch gated on a
   device pass, a soak and a watched blind playtest.

## Scope

| # | Item | Area | Size | Priority |
|---|---|---|---|---|
| V2-01 | Launch gate: device pass, load budgets, TAP TO PLAY, blind playtest | tech | M | must |
| V2-02 | **The Hook**: auto line-up, drag, drop, FLING, sound and feel | feature | L | must |
| V2-03 | **Kerb Law** and kerb paint | feature | M | must |
| V2-04 | Cold open *Removed With Occupant* | story | M | must |
| V2-05 | WRONG NUMBER becomes the tow tutorial | story | M | must |
| V2-06 | **NIGHT SHIFT** mode | feature | L | must |
| V2-07 | One Clamp rival and the SNATCH | feature | S | should |
| V2-08 | Tuna on dispatch | story | S | should |
| V2-09 | **TONIGHT'S SHIFT** daily and challenge links | feature | M | must |
| V2-10 | **The Penalty Charge Notice** share card | presentation | M | must |
| V2-11 | Final district names and council area cards | story | S | should |
| V2-12 | Prune the front door; old saves stay whole | prune | S | must |
| V2-13 | Storefront copy that sells the tow | presentation | S | must |
| V2-14 | itch.io build, hero shots, gated launch | tech | S | should |
| V2-15 | Tail whip (swing on the hooked car) | feature | M | stretch |

Cut order if week 2 slips: V2-07, V2-11, V2-14 (V2-15 is already a stretch).

### V2-01 · Launch gate

- **What:** (a) Days 1–2: the iPhone 15 Pro real-device pass (HANDOFF to-do
  #2) end to end as a **baseline**: draw calls, fps, thermals, overlaps at
  852×340. (b) Smoke test under 4G throttling (CDP
  `Network.emulateNetworkConditions`) with time-to-title and
  time-to-first-control budgets that fail CI. (c) A single TAP TO PLAY on
  first visit, which also unlocks audio. (d) Day 10: a watched blind
  playtest, 3–5 people on their own phones, with a script (time to first
  hook, first confusion, quit point). (e) Days 11–12: a second device pass
  with V2 in, plus a 15-minute Shift soak.
- **Builds on:** `render/quality.ts`, `DynamicResolution`, the perf overlay
  and `frameStats`, the 0.12 performance reports, `tools/smoke.mjs` iPhone
  and offline profiles, `tutorial.ts` first-run state.
- **Done when:** baseline and post-V2 numbers are in HANDOFF; under 150 draw
  calls (target under 90) in a Shift with an incident, a rival and a hooked
  car in view; the soak holds; load budgets are enforced; playtest notes
  exist and the median stranger hooks a car in under 90 s. **No public post
  before all of this.**

### V2-02 · The Hook

- **What:** In any tow truck, below about 3 m/s with a hookable car within
  6 m and 60° of the truck's axis, the door button reads **HOOK**. A tap
  sets `holdControls` and the existing `pullIn()` drives the truck to the
  spot from `tows.ts` `lineUp()`, nose or tail; after at most 1.5 s it hooks
  anyway, then winches over `WINCH_SECONDS`, carried by `towPose()`. Loaded:
  throttle ×0.8, top speed −20%. The button then reads **DROP**, or
  **FLING** above 8 m/s: the car goes back to the sim with the truck's
  velocity plus a clamped sideways kick.
  - **Eligibility** (pure `hookRig.ts`, tested): unoccupied; reach ≤
    `MAX_REACH` 3.3 (no buses, fire engines, SWAT or garbage trucks); not
    burning; police cars only when abandoned, and always illegal.
  - **Physics:** `Vehicle.towedBy` / `flungBy` / `flungUntil`. The `main.ts`
    pair loop skips truck/towed pairs, and the flung car vs its own truck for
    0.3 s. `involvesPlayer` becomes `isPlayers(a) || isPlayers(b)`, so a
    flung car's hits score FLING and raise heat. **Fallback decided in
    advance:** if carried-car contacts jitter on the phone, ghost the
    carried car and make FLING the only collision path.
  - **Feel:** new `hook`/`unhook`/`fling` events (added compatibly, new
    `GameAudio` cases): synthesised winch whine, chain clank, tension
    rattle, whip crack on FLING. Amber beacon via `look.addGlowSource`.
    60 ms hit-stop and camera kick on FLING. First-hook feed line:
    `IT'S NOT STOLEN · IT'S IN TRANSIT`.
  - An optional `towing` field on the mission `deliver` step plus
    `MissionView.hooked(tag)`, for m1 and chapter 3.
- **Done when:** unit tests cover eligibility, line-up, end choice, release
  clamp and the deliver field; on the iPhone profile at 852×340 a touch
  player stops near a car, taps HOOK and has it lifted within 4 s with no
  steering; DROP and FLING work from the same button; a flung car hitting a
  police car scores and raises heat; no self-collision; allocation-free over
  60 s of towing; the smoke test runs hook → drop through `__ub`.

### V2-03 · Kerb Law and kerb paint

- **What:** The ground shader's kerb term gets two `ubBand` terms: double
  yellows along kerbside road edges (not car-park bays), and a **red** band
  in tonight's tow-away district, chosen by a uniform that exists from boot
  (no mid-play compile). Pure `kerbLaw(x, z, redDistrict)` → `'legal' |
  'illegal'`, tested. Legal tow: small council fee and a feed line. Illegal
  tow (or any police car): `WITNESS CALLING IT IN…` through
  `systems/witnesses.ts`, stars on success, ×3 yard payout. One KERB LAW
  card in Vex's voice on the first hook. Red kerbs are painted in free roam
  too (district from the date seed). Amber beacons on the Graveyard and
  Clamp trucks; three new tokens (hi-vis yellow, cone orange, PCN cream) on
  V2 surfaces only.
- **Done when:** a **day-1 readability spike** passes your sign-off: night
  screenshots at 852×393 and 1280×720 where red reads as distinct from
  yellow without a glow (if not, widen or brighten through the lamp-pool
  term, never a glow strip); `kerbLaw` tested at district edges; red-kerb
  hooks give no stars, yellow ones raise a witness; the shader cost on the
  `low` tier is within budget.

### V2-04 · Cold open: *Removed With Occupant*

- **What:** Fresh saves only. TAP TO PLAY at 21:00 near the Glass Heights
  payphone. A mustard compact with an orange CURBSIDE truck already lined
  up; you start at its door in the `down` state and play `getup` (input
  buffered, control by about 1.5 s) while the car winches up. A
  non-blocking PCN stamp (DOM overlay, any input dismisses it). At t≈3 the
  truck drives off with your car and retires out of sight; at t≈5 the
  payphone rings and the pointer says ANSWER. New `Tows.forceHooked(car,
  paint)` (today's `force()` drives in from 110 m, which is too slow); a
  pure, tested `game/coldOpen.ts` sequences the beats. SKIP chip; auto-skip
  for any save with progress; an ARCHIVE replay entry.
- **Done when:** tap to first accepted input ≤ 2 s on the iPhone profile
  (smoke test); car gone within 15 s; payphone ringing by about 6 s; walking
  away still gets the ring; saves with progress never see it.

### V2-05 · WRONG NUMBER becomes the tow tutorial

- **What:** Rewrite m1 (keeping its jokes and the 3-line limit): Vex's call
  → get in the Graveyard-blue tow truck round the corner (TRUCK blip) →
  deliver a car off the red kerb to the yard bay (legal, paid) → deliver
  one off a yellow line (illegal, witness, 1 star) → lose the heat. FLING
  pointer is optional, shown when towing fast with stars. New pointers HOOK
  IT / DROP AT THE YARD / FLING replace STEAL A CAR on fresh saves only.
  After m1 the truck is parked at the yard and the safehouse; if wrecked, a
  spare spawns out of view within 80 m (*"That was my good one. Spare's at
  the kerb."*). No fail state in m1. About four line retcons (WRONG NUMBER,
  FINE PRINT, NO PARKING) in `missionsData.ts` and `STORY.md` together.
- **Done when:** cold open → m1 passed in under 7 minutes in a playtest;
  mission and line-length tests pass; REPEAT JOB m1 works; a save that
  passed m1 never sees the new pointers.

### V2-06 · NIGHT SHIFT

- **What:** The one new mode. Start in the Graveyard truck at the docks
  yard at 22:00; `look.time` speed set so dawn comes in 6 real minutes (a
  constant). The sim `rand` at `main.ts:190` becomes reseedable and is
  reseeded at shift start. Pure, tested `shift.ts` builds a 12-job queue from
  the seed: 7 badly parked cars (`Population.parkCar`, no new draw calls),
  3 pre-wrecked, 2 abandoned in a lane; a refill rule keeps at least 3 open
  jobs within 300 m. Payout = `exportPayout` (base × condition) × kerb-law
  multiplier; delivery at the yard bay uses the existing export crane-away,
  with Vex standing at the bay. One new `SceneHold` kind, `otherActivity`:
  accidents and fires keep running in a Shift, and their towables join the
  queue with a 1.5× tip; every other scene stays held. Radar shows the 3
  nearest jobs. Ends at dawn, or early on WASTED/BUSTED with a partial
  tally (Chaos Run's respawn-then-results path). A spare truck costs 20
  game-minutes. TALLY card from the Chaos results card: haul, impounds,
  legal vs illegal, best fling. CRED is awarded per shift on the existing
  curve. The title leads with NIGHT SHIFT after m1.
- **Done when:** `shift.ts` tests (same seed → same queue, refill, payouts,
  tally, every end condition); no 45-s stretch without a job within 300 m
  in a 6-minute run; draw calls within the V2-01 target; missions, races
  and Chaos Run unchanged (existing tests green).

### V2-07 · One Clamp rival and the SNATCH (should)

- **What:** In a Shift, `Tows` gets a rival option in the existing single
  tow slot (free because ambient tows are held): Clamp orange, only picks
  queued jobs, slow first dispatch. Hook a car off the rival's boom while
  it's towing → `drop(t)`, a SNATCH score, a feed line and a camera kick.
  Ramming the truck or KOing its driver already ends its tow. Three snatches
  earn a Clamp line on the TALLY. The rival never hooks your truck.
- **Done when:** one orange truck works the queue and can take a job before
  you; SNATCH scores and the rival leaves; a first-time player beats the
  rival's count in 4 of 5 seeded nights.

### V2-08 · Tuna on dispatch (should)

- **What:** Pure `game/dispatch.ts`: about 40 lines by job type (parked,
  wreck, abandoned, fire out, red kerb, rival on our job, snatch, truck
  wrecked, dawn in two minutes) with `{colour} {model} {district}` slots
  from `colourName()`, `CAR_NAMES` and `districtAt`. Seeded rotation, 8–12 s
  minimum gap, silent at 4+ stars and during dialogue cards. Uses the radio
  toast slot (`ui/radioToast.ts`); no new voice.
- **Done when:** tests cover rotation, rate limit, silence rules and length
  at 852×340; in a smoke-run Shift no two lines within 8 s and none overlaps
  the score feed.

### V2-09 · TONIGHT'S SHIFT and challenge links

- **What:** Pure `daily.ts`: local date → seed and spec (red district,
  weather, job queue, rival timing, bounty car). Runs the Night Shift with
  perks off, like the other scored modes. Pure `challengeLink.ts`:
  `#n=MAJOR.YYYYMMDD.HAUL.CARS.INITIALS.CHECKSUM`, sanitised, round-trip and
  tamper tests. Opening a link shows a landing card (*OFFENDER DRK IMPOUNDED
  $14,320 (7 VEHICLES) ON 2 NOV. BEAT IT.*) with one button into that night,
  then clears the hash. A link from another major warns "Issued under
  different bylaws" and still plays. The save gets a sanitised `nights`
  field (per-date best, streak). All copy says "same night", never "same
  replay": the sim isn't lockstep-deterministic.
- **Done when:** a date always gives the same spec within a major; links
  round-trip and reject tampering; a link opened offline in the installed
  PWA shows the landing card and starts that night (smoke test); the
  streak survives a save round-trip.

### V2-10 · The Penalty Charge Notice

- **What:** At the dawn (or WASTED/BUSTED) freeze, a one-shot flag copies the
  GL canvas into a reused 1080-px canvas right after that frame's
  `look.render` (no extra render; `snapshotView` gains an optional reused
  `out` canvas). `ui/ticketCard.ts` composes a 1080×1350 portrait (and a
  1200×630 variant) on canvas 2D when the TALLY opens and calls `toBlob`
  then, so SHARE can call `navigator.share({files})` inside the tap.
  Fallbacks as in `ui/bugReport.ts`: clipboard, then download. Layout: the
  frozen frame (or a SITE PLAN drawn from the radar's block data if capture
  failed), the CURBSIDE header, itemised offences in Clamp's voice, the fine
  = the haul, one *Tarmouth Gazette* headline on the stub, a barcode and the
  link. Pure `offences.ts` ranks lines from a preallocated per-shift tally;
  about 40 offence lines and 20 headlines, tested for length.
- **Done when:** no frame spike at the freeze on the iPhone profile; SHARE on
  iOS Safari opens the share sheet with a PNG in one tap; desktop Firefox
  falls back to download; a forced null capture draws the SITE PLAN;
  **you sign off every offence and headline line** for out-of-context reading.

### V2-11 · Final district names and council area cards (should)

- **What:** MAPLE FLATS → **PRIVET END**; sweep chapter 1's "arts quarter /
  suburbs / old town" and chapter 2's "Maple Flats". The area card's empty
  sub line gets council restrictions:
  - GLASS HEIGHTS · NO STOPPING AT ANY TIME
  - COBBLE ROW · PAY AND DISPLAY. MOSTLY PAY.
  - RUSTWATER DOCKS · LOADING ONLY. NO WAITING. NO HOPE.
  - PRIVET END · RESIDENTS' PERMITS ONLY
  - NEON MILE keeps VIPERS TURF; tonight's red district adds `· RED KERBS TONIGHT`.

  Title small print: *A GREATER TARMOUTH BOROUGH COUNCIL INITIATIVE*
  (subject to a name check). A STORY.md *World* section makes
  kerb-vs-CURBSIDE canon.
- **Done when:** no placeholder district text remains (grep + test); every
  crossing shows its line and fits at 852×340.

### V2-12 · Prune the front door; old saves stay whole

- **What:** Fresh saves: taxi, frenzies, packages, exports and races are
  hidden from the title and radar until the first Shift (or chapter 1 job
  3), each unlocking with one feed card. Chaos Run unlocks after the first
  Shift. Any save with progress unlocks everything and skips the cold open
  and new pointers. Reweight completion to include Shifts without a sharp
  drop for veterans. Public-release content pass: retire `KNOCK DOWN 15`
  (`fz-brawl`); rename the *Kerb Crawler* song (`stations.ts:381`, UK slang
  for soliciting) to *Kerb Appeal*; review frenzy titles and other lines
  that read badly out of context.
- **Done when:** a fresh save's title shows only story/free roam, NIGHT SHIFT
  (after m1) and TONIGHT'S SHIFT; a real pre-V2 save loads with every mode
  and no cold open (migration test); the two strings are gone.

### V2-13 · Storefront copy

- **What:** Tagline **HOOK IT · TOW IT · CONTEST THE FINE**. New og/twitter
  description: *"They towed your car with you asleep in it. Join the
  Graveyard Shift, a night tow crew, and take the city back one kerb at a
  time. Plays in your browser and on your phone."* Six council-sign attract
  captions; a 150-word itch/Reddit blurb leading with the cold open and
  Tonight's Shift; a new `og.jpg` (a car on the hook under sodium light, a
  PCN stub in the corner). Ships with the hook, not before; never mentions
  unbuilt features.

### V2-14 · itch.io build and gated launch (should)

- **What:** `npm run build:itch` (relative base, PWA off, install/update
  prompts suppressed in an iframe, a fullscreen button) with an itch smoke
  variant in `ci.yml`. A dev-only `__ub.stage(name)` sets up three hero shots
  (HOOK on a red kerb at 22:00; FLING into a cordon at 2 stars; REMOVED WITH
  OCCUPANT) through the scene starter, so re-shoots are repeatable. You
  record 4–6 GIFs on a desktop GPU plus one iPhone screen recording (about
  an hour). The store page tells iPhone players to use deeek.org, because
  saves don't cross origins. Posts (r/WebGames, r/threejs, r/IndieDev) carry
  a Tonight's Shift link and wait for V2-01's gate; they can slip past day
  14 without blocking the release.

### V2-15 · Tail whip (stretch)

A pure, tested heading-lag spring (≤ 35°) on `towPose`'s output that grows
with speed, yaw rate and handbrake, plus a SWING score for hits while
carried. Only if carried-car contacts proved stable on the device in V2-02,
and behind a flag.

## Schedule

| Days | Milestone | Items | Exit criteria |
|---|---|---|---|
| 1–2 | **M0 Foundations and gates** | Baseline device pass + 15-min soak (you); agree the event and tally schema (hook/unhook/fling, `towedBy`/`flungBy`, Shift tally) because V2-02/06/08/10 all depend on it; reseedable sim `rand` with a test; red-kerb readability spike; start `hookRig.ts`. In parallel: content review, district rename and area cards, first drafts of offence, dispatch, cold-open and m1 lines; 4G load budgets in the smoke test. | Baseline numbers recorded; schema merged; `rand.seed` tested; red-kerb screenshots approved or fallback chosen; `hookRig` tests green; load budgets reported. |
| 2–5 | **M1 The verb** | V2-02 (a) line-up, winch, drag, DROP, loaded handling, pair-loop skip; (b) FLING, attribution, score and heat, `towing` field; tow sounds and feel in the same PR. In parallel: V2-03 kerb law and witnesses; V2-04 `forceHooked` and cold open. **Day 5: you play hook, drag and fling on your iPhone. If it isn't fun, day 6 goes on feel before the Shift is built on it.** | One-button hook/drag/drop/fling on the phone; flung car scores and raises heat; no self-collision; allocation-free; kerb law works; cold open plays in 15 s; your day-5 check passes. |
| 5–9 | **M2 The night** | V2-06 Shift; V2-05 m1 rewrite. In parallel: V2-09 daily and links; V2-08 dispatch; V2-12 gating and save migration. V2-07 rival once the queue exists (first to cut). | Full Shift and Tonight's Shift on the iPhone profile within budget; no 45-s job drought; WASTED gives a partial tally; fresh save goes cold open → m1 → Shift; old saves load with everything; existing tests green. |
| 8–10 | **M3 The ticket and the storefront** | V2-10 PCN; V2-13 copy and og image; V2-14 itch build and hero shots. **Day 10: blind playtest, 3–5 newcomers.** | SHARE on iOS opens the sheet with the PCN; links round-trip offline; copy merged; itch smoke green; playtest notes recorded. |
| 11–14 | **M4 Tune, gate, ship** | Fix the top 3–5 playtest findings; second device pass + 15-min Shift soak (you); V2-15 only if all green; version, changelog, smoke test, push to main; GIFs and itch page; launch posts only once all gates pass. | All `must` items done; device pass and soak pass; smoke test green on every profile; deployed to deeek.org/curbside. |

Parallel worktrees all wire through `main.ts` and the pair loop, so the
day-1 schema PR and one owner for `main.ts` wiring per milestone keep merges
sane. Pure logic goes in modules with tests, as `CLAUDE.md` requires.

## Not in V2

| Idea | Why not now |
|---|---|
| The impound yard as a persistent base, collection book, upgrades | A 10th-hour feature in a release about the first 30 seconds; needs recycling exemptions, docks sim load and save migration. Only a "rare car impounded" line on the TALLY survives. Revisit in V2.1 with Shift play logs. |
| Tuna's in-run mod picks | A generic roguelite bolt-on on a verb that isn't tuned yet. |
| Bylaw difficulty ladder | No first-session value; depends on the open five-star tuning (BACKLOG). |
| **Chapter 3** (Mayor Bunting, *Tough on Kerbs*) | Strangers never reach job 14. Plan it as **V2.1's headline**: four of six jobs as tow jobs using V2's `towing` deliver field, plus the "get Vehicle 000001 back" payoff. |
| *Tarmouth Gazette* as a second share image | Dilutes the PCN; one headline on the stub survives. |
| Story cameos in free roam (Clamp as lollipop man, etc.) | Gated on story progress, so strangers never see them; arrive with chapter 3. Only Vex at the yard bay survives. |
| Packages as Clamp's files | Reskins a collectible V2 hides from newcomers; half-day filler for V2.1. |
| Photo mode | Free camera exposes chunk culling and the roof cap; the PCN covers sharing. |
| Night-bus radio: DJ, parody ads, babble voice | 150–200 lines and an untested voice; only the dispatch idea survives (V2-08). |
| Instant replay / clip export | Sim state freeze/restore and MediaRecorder on iOS would eat the two weeks. |
| A separate 2:00 Chaos Run daily | Would rehearse the GTA-2 loop daily; its link format ships inside V2-09. |
| Wheel-clamp cold open | A clamp teaches the wrong verb and needs Blender work; a tow reuses `Tows`. |
| Hooking occupied cars, big vehicles, rivals hooking you, warden clamping | Each adds a failure state or new physics on an unproven verb; V2.1 at the earliest. |
| Stencilled road words, bay numbers, full UI token refresh, mid-run stamps, automated trailer rig | Shader cost on phones, half-styled screens, extra renders mid-play, no GPU in the agent sessions. |
| Lazy GLB loading, a driving assist, colour-safe radar shapes | Lazy loading risks a mid-play shader compile; assist muddies scored modes; colour-safe radar is worth doing, just not on this path. |
| Tarmouth-Ohio twinning lore, CRED retune, exports→impound migration | Lore strangers don't need; no Shift data to retune against; no first-session value. |

## Risks

- **The verb isn't fun.** Everything rests on the hook → the day-5 phone
  check; day 6 goes on feel if it fails.
- **Carried-car contacts jitter or tunnel** → the ghosting fallback is
  decided in advance; FLING stays the collision path; SWING stays a stretch.
- **Auto line-up fails in tight spots or feels like the game is driving** →
  the 1.5 s hook-anyway timeout, instant release on cancel, a generous snap.
- **Red kerb doesn't read at night** → day-1 screenshot go/no-go.
- **The baseline device pass finds problems that eat week 2** → it runs on
  days 1–2; cut order V2-07, V2-11, V2-14.
- **Draw calls in a busy Shift** → queued jobs are parked instances, the
  rival reuses the tow slot, only accidents and fires bypass the hold;
  target under 90.
- **Merge contention** through `main.ts` → schema PR first, one wiring owner.
- **Old saves** → a migration test on a real pre-V2 save.
- **Daily fairness** → "same night", not "same replay"; the link carries the
  major; spec tests frozen within a major.
- **iOS share-with-files needs a direct tap** → `toBlob` at TALLY open; a
  first-class download/clipboard fallback.
- **Content read out of context** → your sign-off on offence and headline
  lines; the two renames before launch.
- **A bad first Reddit impression can't be undone** → no public post before
  the device pass, the soak and the blind playtest. 2.0 can deploy to
  deeek.org before the posts go out.

## Open questions for you

1. **Version:** 2.0.0 (matches "V2" and the link's major) or 1.0.0 as the
   public release? `package.json` is 0.13.0.
2. **City name:** is *Tarmouth* / *Greater Tarmouth Borough Council* OK after
   a quick real-place and trademark check, or should the city stay unnamed?
3. **Pruning:** hide taxi, frenzies, packages, exports and races from fresh
   saves until the first Shift? Retire KNOCK DOWN 15 outright, or rename it?
4. **Cold open:** automatic on a fresh save (SKIP chip, control within 2 s),
   or opt-in from the title?
5. **Your time:** two iPhone sessions (about 2 h on days 1–2, about 2 h on
   days 11–12), and 3–5 people who've never seen the game for day 10?
6. **Currency:** stays $, with at most one joke about it in the PCN small print?
7. **Shift length:** start at 6 minutes and let the playtest move it (likely 4–8)?
8. **Initials on share links:** typed by the player (up to three), optional,
   or blank by default?
9. **Launch timing:** posts wait for the gates even if that's after day 14,
   or is there a date to hit?
10. **Chaos Run:** on the title after the first Shift as practice, or hidden
    until later?

## Sample script

```
COLD OPEN (21:04, Glass Heights; live, control from second 2)
[PCN stamp, non-blocking]
PENALTY CHARGE NOTICE 000001 · CURBSIDE · COMMISSIONER CLAMP
Vehicle removed from double yellow, 21:04. Occupant found asleep. Occupant tipped onto kerb.
Vehicle and contents (1 phone) held at the Council impound. Release fee: $5,000.

[The payphone rings. WRONG NUMBER, rewritten]
VEX: Saw that. Clamp's lot towed your car with you asleep in it. Rude. Even by my standards.
VEX: Name's Vex. I run the Graveyard Shift. Towing, mostly. The 'mostly' pays better.
VEX: My truck's round the corner, keys in. Hook something off a red kerb and bring it to the yard.

FIRST HOOK
FEED: IT'S NOT STOLEN · IT'S IN TRANSIT
VEX (KERB LAW card): Red kerb, the council pays us to tow it. Anywhere else it's theft. Pick your crimes.
FEED (illegal hook): WITNESS CALLING IT IN…

TRUCK WRECKED
VEX: That was my good one. Spare's at the kerb.

NIGHT SHIFT, Tuna on dispatch
TUNA: Blue estate, Cobble Row, parked like a crime. Go and be the law. Sort of.
TUNA: Red sedan, Glass Heights, nose in a lamp post. Owner's gone. Lamp post's fine.
TUNA: Orange truck's on our job in Neon Mile. Snatch it off his hook. Politely.
TUNA: Sun's up in two minutes. Anything not on the yard by then is a hobby.

RETCONS
VEX (FINE PRINT): Someone's towed MY tow truck. Signed 'Commissioner Clamp'. Same as your ticket, kid.
CLAMP (NO PARKING): Registered Keeper 000001. I have read your file. It is thick. Good evening.

DAWN TALLY, after three snatches
CLAMP: Good evening. This is a formal complaint. It has been filed. Under 'you'.

THE PCN
OFFENCE 4a: REMOVAL OF A VEHICLE WITHOUT THE CORRECT FORM ×7
OFFENCE 9: VEHICLE DEPLOYED AS PROJECTILE AT POLICE CORDON
OFFENCE 19: FAILED TO GIVE WAY TO 6 POLICE VEHICLES. ALSO RAMMED THEM.
STUB: POLICE "TIRED" AS 7 CARS VANISH FROM COBBLE ROW

CHALLENGE LANDING CARD (#n=2.20261102.14320.7.DRK.k3f)
OFFENDER DRK IMPOUNDED $14,320 (7 VEHICLES) ON 2 NOV. BEAT IT.
```
