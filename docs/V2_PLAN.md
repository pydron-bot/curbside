# Curbside V2 — plan

_Written 2026-11-02 against 0.13.0, second draft. The first draft (towing as
the main verb) was rejected: "I don't want to play a tow truck simulator."
This one starts from what the owner said they enjoy:_

> - "I have been liking how the city has been coming alive with all things
>   that can happen. The random incidents make it really fun to just watch.
>   That and causing mayhem."
> - Reference game: GTA 2.
> - The Graveyard Shift is fine as a side story, not the main story.
> - Towing is fine as a side mission.

_Process: three brainstormers (living city & mayhem, story & player, player's
advocate & reach), a critical judge scoring owner fit first, a rebuttal
round, and a final verdict giving three directions to choose from.
Constraints: wider public release, offline only, two weeks._

**Decided 2026-11-02: direction A (Have-a-Go) with B's mayhem, and the
alarm-fitter story (*Keep It Loud*).** From B come the stolen service
vehicles' tools (fire hose, ice cream chime, alongside the tow winch, V2-09)
and named mayhem with bystanders filming (V2-04); B's tabloid story and
notoriety gate are not used. The three directions are kept below for the
record.

## What's wrong today

The owner's two favourite things never happen together. Every loud incident
(chases, races, fights, muggings, turf flare-ups, accidents, tows) is held
while the player is wanted or in a mode (`LOUD` in
`systems/cityScenes.ts:46`), and a police chase breaks off the moment the
player has a star (`scenes/chases.ts:437`). So the city goes quiet exactly
when the mayhem starts. And apart from the $50 mugging bag and stepping into
a turf war, the player can't join or profit from an incident: they are
scenery.

## Three directions

### A · HAVE-A-GO: the city doesn't stop for you (chosen)

> Every chase, race, fire and punch-up in this city happens whether you're
> there or not, and now your mayhem can crash straight into them.

**Ten minutes of play.** You're 2 stars hot down Neon Mile. A street race is
coming the other way, because incidents no longer stop when you're wanted.
Your pursuing patrol clips a racer and both spin into a fire crew's hose.
Next block, a police chase screams past; you drag the getaway driver out and
**TAKE THE HEAT** stamps across the screen, and the chase's patrol cars are
now after you. Later you ram a different getaway into the kerb in front of a
patrol: **CITIZEN'S ARREST**, cash, and the cops wave you through. You shunt
a cab at a junction; in the mirror the driver gets out shouting, a patrol
pulls up, a tow truck arrives (**DOMINO ×3**). A scanner ping says something
has kicked off in Cobble Row, so you go and look. Between all that, Doreen's
payphone rings with a story job, and every job asks for mayhem, not stealth.

**Main story: KEEP IT LOUD.** You fitted car alarms for twenty years; half the
alarms in Cobble Row are yours. Mayor Prudence Lull, chasing the national
*Quietest City* award, passes a Quiet Streets Act that bans car alarms,
chimes, buskers and kebab vans after ten. You're sacked the same night. The
kerbside traders (Doreen from the ice cream van, Lionel the busker, the kebab
shop) hire you to keep the city loud. Chapter 1 is six jobs, ending with the
award judges' coach touring a city you've made go off all at once.

**Why the owner:** watching and mayhem become the same act, and the villain's
goal is to switch off the thing the owner likes most. It plays like GTA 2
(payphones, stars, carjacking).
**Why a stranger:** within 15 seconds of PLAY a getaway car crashes at your
bus stop and the only prompt is GET IN.
**Biggest risk:** performance with scene cars and 5-star police at once, never
measured on the iPhone; the handoff must never leave an orphaned siren car.

### B · THE MENACE: your rampage is the story

> The city needs a villain, and every bit of chaos you cause makes you a more
> famous one.

Mostly you cause the biggest chaos you can, with better toys: steal the fire
truck from a fire and the action button is a hose; steal the ice cream van and
its chime pulls a queue wherever you park. Named stamps (BARBECUE SEASON for
three chained explosions) and bystanders lifting phones to film. The payphone
rings again only once you're infamous enough, and story jobs are set-piece
rampages. **Story:** you arrive on the night coach for your fifteenth driving
test; four minutes later a crashed getaway, a photographer and a kerb make you
THE CURBSIDE MENACE in the tabloids. A "concerned citizen" on the payphone
feeds you targets, and turns out to be Mayor Lull, who needs a menace to pass
her Quiet Streets Act. **Biggest risk:** the city goes back to being backdrop;
it's the most GTA 2-like and least Curbside's own.

### C · TURF: the crews fight over the city, and you pick sides

> Four street crews are at war in the city's own turf flare-ups, and every
> punch you throw in one moves a border.

You work for crews and fight in their flare-ups. Win for the VIPERS and your
respect rises, a VIPERS lad walks up with a job, and after an evening the
radar tint shows the border moved a block. **Story:** WITNESS PROTECTION.
You testified against a VIPERS boy and were hidden in Maple Flats as "Robin,
who sells conservatories". The VIPERS are run by his gran, Nana Viper, from a
mobility scooter. **Biggest risk:** closest to a GTA 2 recreation (crew
respect and per-crew jobs), the largest build (only the VIPERS exist as a
crew today), and its payoff shows only after an hour of play.

### What was chosen

A's gameplay and story, plus B's mayhem: the service-vehicle tools and the
named stamps. Both were already scored well by the judge (stealing the fire
truck and hosing people is "the kind of mayhem a GTA 2 fan expects, attached
to vehicles the owner has watched do their jobs").

## Answers to the owner's questions

**The hook.** "Every chase, race, fire and punch-up in this city is happening
whether you're there or not. Drive into one." You're wanted and the city keeps
going: your pursuers pile into a street race, you steal a getaway mid-chase
and inherit its cops, your own fender-bender becomes a scene you watch in
the mirror. And everything the incidents bring in works when you take it:
steal the fire truck and hose the crowd, steal the ice cream van and its
chime pulls a queue to wherever you park.

**Versus GTA 2.** Kept on purpose: top-down camera, carjacking, wanted stars
with roadblocks, SWAT and the helicopter, payphone jobs, guns, mayhem for its
own sake. Different: GTA 2's city is a backdrop of pedestrians and traffic;
Curbside's runs 20+ simulated incidents with their own crews and outcomes,
and in V2 they keep running through your pursuits and can be joined in a
second. Nothing is copied: names, city, characters, missions and UI are
original.

**The name.** Keep CURBSIDE, with **KEEP IT LOUD** as V2's subtitle. Lull's
American consultant wrote "curbside nuisances" into the Quiet Streets Act,
nobody fixed the spelling, and the kerb traders wear it as a badge: "We're
the Curbside." One joke, not a running gag.

**The player.** An alarm fitter, never named or gendered (the traders call
you "Alarms"). Sacked the night the Act passes, you're waiting for the night
bus with your toolbox when a getaway crashes at your shelter with the door
open. You get in. That cold open is job 1; lose the heat and the payphone
rings: Doreen needs someone with nothing to lose. Your trade ties into the
mayhem: every crash, bullet and blast sets off "your" alarms through the
existing `AlarmBoard`.

**The Graveyard Shift and towing.** The 13 written jobs become the **Night
Shift** side story: same ids and lines (saves untouched), ringing only after
dark from the docks-yard phone with a moon badge. The completion page splits
MAIN (the 30% weight) from NIGHT SHIFT. The main story touches it once: Lull
has hired Vex's crew to tow the traders' vans, and you take Doreen's van back
off Vex's truck. **Towing is a side job:** steal any tow truck and the action
button winches; hook a real accident wreck, haul it to the docks yard and get
paid by condition. Vex rings after dark with tow work. Towing is never a
main-story verb.

## Pillars

1. **The city doesn't stop for you.** Incidents keep living while you're
   wanted or in most modes, and turn up on your route.
2. **Every incident has a way in.** Watch it, or in a second steal, end or
   wreck it, with no menu or phone call.
3. **Your mess becomes the city's problem.** What you smash, shoot and shunt
   starts scenes the city's own crews play out, and your biggest chaos gets a
   name and an audience.
4. **Steal the city's workers.** The vehicles the incidents bring in do their
   job for you: hose, chime, winch.
5. **Mayhem drives the story.** No main job fails you for getting stars; the
   villain wants the city quiet.
6. **The first 15 seconds are an incident**, and a stranger on a phone is
   causing mayhem in it before any menu.
7. **Phones first.** Under 150 draw calls on the iPhone, instanced batches,
   no runtime lights, no per-frame allocation, measured on a real device
   mid-plan, not at the end.

## Scope

| # | Item | Size | Priority | From |
|---|---|---|---|---|
| V2-01 | In-view meter: how much of the city the player sees | S | must | A |
| V2-02 | The city doesn't stop: hold split and route-ahead placement | M | must | A |
| V2-03 | Chase handoff: TAKE THE HEAT, CITIZEN'S ARREST | L | must | A |
| V2-04 | Named mayhem: stamps and bystanders filming | S | must | B |
| V2-05 | Incident-aware missions: a `scene` action and a `mayhem` step | S | must | A |
| V2-06 | KEEP IT LOUD chapter 1 (6 jobs) and the main/side split | L | must | A |
| V2-07 | Live cold open; side modes hidden for new players | M | must | A |
| V2-08 | Night Shift side story | S | must | A |
| V2-09 | Borrowed Blues: winch, hose and chime on stolen service vehicles | L | must | A + B |
| V2-10 | Your Mess, Their Problem | M | should | A |
| V2-11 | Scanner pings | M | should | A |
| V2-12 | RACE CRASHER and VAN NICKED | M | should | A |
| V2-13 | Two new incidents: cash-in-transit van, kebab chucking-out time | M | should | A |
| V2-14 | Launch gate: device pass, tier probe, blind playtest | M | must | A |
| V2-15 | Quiet Wardens in free roam after the finale | M | stretch | A |
| V2-16 | Best-moment picture on WASTED/BUSTED (owner-gated) | S | stretch | B |
| V2-17 | Prune for newcomers; ship as 1.0.0 | S | must | A |

Cut order if week 2 slips: V2-13, V2-12, V2-11, then V2-10. The stretch
items wait for everything else to be green.

### V2-01 · In-view meter

- **What:** an allocation-free "seconds in view" counter per incident kind in
  `CityLife` (using `inView()` and each scene's `subject()`), in the session
  log and on `window.__ub`. `tools/tune/inview.mjs` drives 20 scripted
  minutes of free roam plus a 2-star pursuit and reports in-view seconds,
  incidents seen per kind, and incidents that started and ended unseen.
- **Why:** it decides whether week 1 goes on placement or new incidents, and
  turns "the city comes alive" into a number that should go up.
- **Done when:** the harness prints a per-kind table; the baseline is in
  HANDOFF before V2-02; a test shows the counter doesn't allocate per frame.

### V2-02 · The city doesn't stop

- **What:** a new `BUSY` hold set (title, tutorial, and activity only for timed
  race modes and missions that ask for it) for races, fights, muggings, turf,
  accidents and tows, with a per-star rate multiplier: fewer while wanted,
  never zero. `LOUD` stays for title and tutorial. A `routeAhead` placement
  that picks a lane-graph spot 60–150 m ahead of the player's velocity,
  off-screen, at most once per 45 s and only while wanted. Mode audit: race
  modes keep the hold; free roam, taxi, frenzies and Chaos Run don't.
- **Builds on:** `systems/cityScenes.ts`, every `clock.define` in `scenes/*`,
  `fireCrews.ts:96` (fires already run while wanted, so the pattern is
  proven), `simLod`, the lane graph, police pursuit.
- **Done when:** tests cover hold rules per kind and star level and
  route-ahead placement; the V2-01 harness shows an incident in view at least
  every 60–90 s of driving and at least one during a 2-star pursuit; the
  iPhone `medium` profile stays under 150 draw calls in a 5-star soak.

### V2-03 · Chase handoff

- **What:** a pure `chaseHandoff({stars, playerInGetaway, playerNear,
  crimeOnThisChase})` → `continue | takeHeat | turnedOn | breakOff`, called
  first in `stepChase`. `PoliceForce.adopt(v, aboard)` (a public wrapper on
  the private `addUnit`, `police.ts:440`) turns chase cars within ~80 m into
  the player's pursuit, within the tier's unit cap. A `tookGetaway` crime with
  a heat floor of 2 (modelled on `copCarStolen`). A `suspect` flag so knocking
  down chase suspects and muggers isn't assault. One forgiven bump per chase
  unit within 3 s of touching the getaway. New score kinds and street events
  `takeTheHeat` and `citizensArrest` with `GameAudio` cases; the $50 mugging
  bag gets a HAVE-A-GO HERO stamp.
- **Why:** the chase you were watching becomes your mayhem. It also fixes
  today's oddity where cops who saw you attack them simply drive off.
- **Done when:** a decision-table test covers every branch; a scene test has
  the player carjack the getaway and asserts heat ≥ 2, the former chase cars
  in `police.units`, no car left with sirens and no scene, and no chase
  running; a second test rams the getaway next to a patrol and asserts an
  arrest with the player at 0 stars.

### V2-04 · Named mayhem: stamps and bystanders filming

- **What:** one big centred stamp (pooled, no per-frame allocation), synced
  with the `fxDirector` hit-stop: one at a time, at most one every 4 s, bigger
  wins. A pure detector over score awards and street events for the player's
  own chaos: 3+ chained explosions (BARBECUE SEASON; `combat.ts` already
  ripples chain reactions), a pile-up within 3 s, 3 cop cars wrecked in one
  pursuit, a bus through a queue, a rocket into a fire truck mid-hose. The
  have-a-go moments from V2-03 use the same stamp. About 12 original names.
  Bystanders in view switch to the witnesses' film pose, so the street
  visibly reacts (reusing people already on the street, not adding any). Off
  in Chaos Run.
- **Done when:** detector tests (windows, cooldown, priority); smoke
  screenshots at 852×340 show no overlap with stars, radar or activity card.

### V2-05 · Incident-aware missions

- **What:** a `{do: 'scene'}` mission action that starts a scene round a
  point through `SceneStarter`, marks it featured, re-rolls once, then gives
  up quietly (no step ever depends on it). Featured scenes also survive the
  `wanted` hold (`cityLife.ts:375`); featured is reset on mission end,
  WASTED, BUSTED and quit. A `{kind: 'mayhem'; points; near?}` step fed by
  score awards. A flag so job 1 can start without a payphone.
- **Done when:** tests for the mayhem step, a featured scene surviving the
  activity hold at 3 stars, and featured cleared after WASTED.

### V2-06 · KEEP IT LOUD chapter 1

- **What:** six jobs, `arc: 'main'`, ids `s1`–`s6`:
  1. **WRONG STOP** — the cold open: get in, lose the heat.
  2. **MAKE SOME NOISE** — 2,500 points of mayhem in Cobble Row.
  3. **QUIET PLEASE** — flatten two hostile wardens, pick up Lionel, get him to the Mile.
  4. **NINETY-NINE PROBLEMS** — take Doreen's van back off a Graveyard Shift tow truck, unscratched.
  5. **RIBBON CUTTING** — wreck the Mayor's limo.
  6. **QUIETEST CITY** — 5,000 points of mayhem near the judges' coach, with a race, a fire and a turf flare-up started along its route.

  New badges for DOREEN, LIONEL and MAYOR LULL. Completion: 30% to MAIN,
  NIGHT SHIFT separate. Chapter 2 outlined in `STORY.md` only.
- **Done when:** placement tests pass; all six completed on desktop and the
  iPhone; no step fails on gaining stars; old saves keep m1–m13 progress
  (migration test); the completion page shows both bars.

### V2-07 · Live cold open

- **What:** PLAY drops the title camera onto a bus pulling into a shelter,
  with the player standing at it. A forced chase's getaway crashes at the kerb
  within 10 s; the prompt is GET IN, leading into TAKE THE HEAT. Fallback: a
  pre-crashed getaway plus 2 stars if the chase can't start. Runs once;
  Settings gets REPLAY OPENING. Replaces the three tutorial pointers. Chaos
  Run, frenzies, races, exports and taxi stay off the title until `s2` is
  passed.
- **Done when:** the smoke test asserts the player is in a car within 20 s of
  PLAY at 1280×720, 852×393 and 852×340, including the fallback with chases
  forced off; a second run doesn't replay it; side modes are absent for a
  fresh save.

### V2-08 · Night Shift side story

- **What:** `arc: 'night'` on m1–m13 (ids unchanged). Night jobs ring only
  after dark from the docks-yard phone with a moon badge; the two arcs never
  ring the same phone at once. A new Vex opener links them. Fix chapter 1's
  placeholder district text in `missionsData.ts`.
- **Done when:** tests show night jobs only at night and no shared ringing
  phone; a grep test finds no "arts quarter", "suburbs" or "old town";
  existing saves keep their progress.

### V2-09 · Borrowed Blues: steal a service vehicle and its tool works

- **What:** one action-button slot per vehicle type (the fire button's place
  on touch), built once and used by three tools:
  - **Hose (fire truck):** a knockback cone that knocks people flat and puts
    out a burning wreck on hit, drawn with the pooled water/steam particles
    (no new draw calls). Aimed with the existing twin-stick aim on touch.
    Put out a fire before the crew left on the pavement does for a small
    duty streak.
  - **Chime (ice cream van):** the van's chime recruits a queue
    (`Gathering`) to wherever you park it: a lure for mayhem.
  - **Winch (tow truck), the tow side job:** hooks the nearest towable within
    a few metres (accident wrecks, dumped getaways); the hooked car follows
    softly and the truck is speed-capped. Deliver to the docks yard for pay
    by condition, with a small streak. Vex phones after dark with a tow
    contract.

  A guard stops the AI service runs claiming the player's stolen vehicle.
  Ambulance, bus and police duty wait for a later version.
- **Builds on:** `scenes/fireCrews.ts` (fire rules, hose water and steam in
  the effects pools), `scenes/iceCream.ts` and `gathering.ts`,
  `scenes/tows.ts` and `systems/emergency.ts` (`towPose`, `winch`),
  `accidents.towables()`, `scenes/service.ts`, the firetruck, ice cream van
  and tow truck GLBs, `modes/taxi.ts` streak pay.
- **Done when:** tests for the hose cone (knockback, fire out), chime
  recruiting and releasing, hook range, speed cap, pay table and the guard; on
  the iPhone a wreck can be towed to the yard without clipping kerbs, and
  hosing a crowd stays within the draw-call budget.

### V2-10 · Your Mess, Their Problem (should)

- **What:** `accidents.ts` adopts a player-caused crash: the other car's
  driver gets out arguing, then a patrol and a tow arrive. The player's car is
  never held; at most one adopted accident at a time, none on a busy street.
  Gunfire sets off alarms, a witness calls it in and a patrol comes. A
  `root: 'player' | 'city'` flag and a depth counter through `SceneStarter`;
  a DOMINO ×N label (capped at 4) that pays only when the root is the player.
- **Done when:** tests for the adopt rules and depth cap; in the owner's
  20-minute session at least one of their own crashes becomes a visible scene.

### V2-11 · Scanner pings (should)

- **What:** a pure `ScannerFeed`: street event → a short dispatcher line with
  priority and cooldown, shown as a subtitle plus a radar ping (at most two)
  that lasts until the incident ends. While you're wanted it names your car's
  colour and district. A synthesised CITY SCANNER radio station is stretch.
- **Done when:** tests per event kind, cooldowns and 5-star rate limiting; a
  smoke screenshot at 852×340 shows it clear of the HUD; a Settings toggle.

### V2-12 · RACE CRASHER and VAN NICKED (should)

Pull onto a street race's line to join (no rubber-banding); win and the race
car is yours. Drive off in the ice cream van while there's a queue and the
queue chases you on foot. A scene test per hook.

### V2-13 · Two new incidents (should)

A daytime **cash-in-transit van** on its rounds that spills a cash pickup when
wrecked, and **kebab chucking-out time** at 2 a.m. in Neon Mile and Cobble
Row (a stumbling crowd, one shouted argument, a taxi queue). Each gets an
attract-show highlight, a street event and a `GameAudio` case. Existing
batches only; no draw-call increase on the iPhone profile.

### V2-14 · Launch gate

An iPhone 15 Pro pass on the `medium` profile after V2-02 lands, including a
5-star soak with scene cars (HANDOFF so far records one device run, with the
desktop tier forced). A boot-time tier probe. A time-to-first-drive figure in
the session log. Three strangers play blind for 10 minutes; fix the top three
things they trip on. Numbers and notes go in HANDOFF.

### V2-15 · Quiet Wardens (stretch)

After the finale, two hi-vis wardens now and then walk up to a busker, an ice
cream queue or a food cart, only in the player's view, lecture for ~15 s, then
act. Flatten them and the busker plays louder and the queue cheers. At most
one at a time, every 3–5 minutes. The villain becomes something to wreck,
never something that switches incidents off behind your back.

### V2-16 · Best-moment picture (stretch, owner-gated)

Capture the life's best stamped moment during a hit-stop and show it, with a
caption, on WASTED/BUSTED, shareable via the bug-report share path. Built only
if a 10-minute static mock is something the owner would send a friend.

### V2-17 · Prune for newcomers

Remove the three-pointer tutorial in favour of the cold open; side modes
become an unlock list; ship as **1.0.0** with player-facing changelog
notes. A fresh save shows PLAY and Settings only.

## Schedule

| Days | Milestone | Items | Exit criteria |
|---|---|---|---|
| 1 | **M0 Measure** | Direction chosen (A + B's mayhem). V2-01 baseline. V2-05 and V2-08 start. | Choice recorded in HANDOFF; baseline logged. |
| 1–5 | **M1 The city doesn't stop** | Parallel workstreams: City (V2-02), Chase (V2-03 decision table, `adopt`), Story (V2-05 landed, s1–s3 drafted), Side (V2-08), Presentation (V2-04). | The owner plays 20 minutes on the iPhone and says yes to: did a race, fight or accident get in the way of my chase? Did I steal a getaway and inherit its cops? Did a stamp land? In-view numbers up on the baseline. |
| 5–8 | **M2 First session and device gate** | V2-07 cold open; V2-03 finished; s1–s3 playable; V2-14 device pass and 5-star soak; V2-09 action-button slot with the hose and the winch prototype. | Smoke test passes at all three sizes including the fallback; under 150 draw calls in the 5-star soak; s1–s3 complete on the phone; a stolen fire truck hoses a crowd. |
| 8–12 | **M3 Story and side job** | s4–s6 and the coach finale; V2-09 chime, winch and Vex's call; V2-10; V2-11; V2-12 and V2-13 as capacity allows. | Chapter 1 completes on desktop and iPhone; a wreck towed to the yard on the phone; the chime pulls a queue; `npm test` and `npm run build` green. |
| 12–14 | **M4 Playtest and ship** | V2-14 blind playtests and top-3 fixes; V2-17 and the changelog; stretch items only if green. | Three strangers reach a stolen car within 20 s and play 10 minutes unprompted; the owner signs off a 20-minute session; pushed to main with the smoke test passing. |

## Not in V2

| Idea | Why not |
|---|---|
| Daily seeded run and challenge links | Not asked for; traffic isn't deterministic, and scores can't be verified without a server. |
| A tabloid/newspaper theme | All three brainstormers converged on it with no sign the owner wants it. At most it survives as the owner-gated picture (V2-16). |
| Turf map and crew respect | That's direction C; only the VIPERS exist as a crew, and the payoff is invisible in a first session. A candidate for the following fortnight. |
| District CRACKDOWN/LAWLESS states | Retunes scene rates and patrols, and only pays off after an hour. Revisit after the launch gate. |
| Photo mode, trailer tooling, store GIF production | A free camera fights shadows and culling; the rest is marketing tooling, not game. |
| DJs, idents, parody ads, news bulletins | Too much writing for synthesised audio that may read as noise; only the scanner pings ship. |
| Ambulance, bus and police duty jobs | Each is its own mini-activity with HUD needs; the hose, chime and winch ship first on the same action-button slot. |
| B's tabloid story and notoriety gate | The owner chose the alarm-fitter story; mayhem never gates the story. |
| WATCH mode (a free-flying camera to incidents) | The scanner pings serve "just watching" more cheaply for now. |
| Film/"in frame" mission steps, a news-crew protagonist | A passive verb fenced with star penalties: the towing mistake again. |
| Funeral procession, stag conga, film shoot, hydrant geyser | Two new incidents are enough; more depends on the in-view numbers. |
| End-of-life replay reel | Fiddly, and duplicates the picture's job. |

## Risks

- **Performance:** scene cars plus 5-star police with the hold lifted has
  never been measured on the iPhone `medium` tier → per-tier scene budget,
  sim level of detail, and the device soak in M2, not at the end.
- **Chase handoff bookkeeping:** an adopted car left with its siren on and no
  scene → the scene test asserts no orphans; officers never shoot a player
  with no stars.
- **Route-ahead feels scripted** → capped at once per 45 s, only while wanted,
  tuned from the in-view numbers.
- **TAKE THE HEAT must be readable** → stars arrive with the stamp and a siren
  whoop; the forgiven-bump rule is tuned on touch.
- **Story timing** if the direction choice slips → V2-02, V2-05 and V2-08 are
  direction-free and start day 1.
- **The people cap (24) starving story scenes** → the `scene` action fails
  soft and no step depends on it.
- **Tow physics at player speed** → tuned on the phone in M2 before Vex's call
  is written.
- **HUD crowding at 852×340** with stamps, scanner, stars, radar and activity
  card → smoke screenshots at every milestone.

## Decisions

Answered by the owner on 2026-11-02:

- **Direction:** A with B's mayhem; the alarm-fitter story.
- **Chaos Run:** the living city runs through it too (no empty streets).
- **TAKE THE HEAT:** lands on 2 stars.
- **Night Shift:** jobs ring only after dark.
- **Best-moment picture:** a 10-minute mock first; built only if the owner
  would share it.
- **Side modes:** hidden from brand-new players until story job 2.
- **Version:** the finished V2 ships as **1.0.0**, the public release.
  Milestone builds that go to `main` before then are 0.14, 0.15, ….

## Sample script

```
COLD OPEN (no card; the only prompt over the live crash)
GET IN · LOSE THE HEAT
[TAKE THE HEAT stamps; two patrol cars swing in behind you]

JOB 1 OUTRO, the nearest payphone
DOREEN: You're the alarm fitter. Lost your job tonight, I heard. I lost my chimes.
DOREEN: Lull's banned anything louder than a sigh. Fancy keeping this city loud? It pays.
DOREEN: Badly. But in ice cream.

BACKSTORY BEAT (radio card, first drive after job 1)
MAYOR LULL: Mayor Lull. From midnight, car alarms are illegal. So are chimes. And buskers. And joy.
MAYOR LULL: Alarm fitters, please hand in your alarms. Quietly.

JOB 2: MAKE SOME NOISE
DOREEN: Twenty years you wired Cobble Row. Every alarm on that street is yours. Remind them.
OBJECTIVE: MAKE COBBLE ROW LOUD · 0 / 2,500
DOREEN (pass): Heard that from the docks. The council's lodged a complaint. Lovely.

JOB 3: QUIET PLEASE
LIONEL: Two wardens have nicked my hat. My hat is my livelihood. And my hat.
OBJECTIVE: FLATTEN THE WARDENS · GET LIONEL TO THE MILE
LIONEL (in car): I'd pay you, but it's in the hat, and the hat's evidence.

JOB 4: NINETY-NINE PROBLEMS (the Graveyard Shift cameo)
DOREEN: They're towing my van. Council contract. Some night crew in blue.
VEX: Nothing personal. Council pays by the van. You pay in compliments.
OBJECTIVE: TAKE THE VAN BACK · DON'T SCRATCH IT

JOB 6: QUIETEST CITY (finale)
MAYOR LULL: The award judges tour our streets tonight. They will see nothing. That's the point.
DOREEN: Coach leaves Glass Heights at nine. Make sure they see everything.
OBJECTIVE: GIVE THE JUDGES A SHOW · 0 / 5,000
MAYOR LULL (outro): Quietest City has gone to a village with one goat. The goat was louder than you lot, apparently.

NIGHT SHIFT OPENER (after dark, docks-yard phone, moon badge)
VEX: Heard you've a day job now. Cute. The night's still mine, and wrecks need hooking.

STAMPS: TAKE THE HEAT · CITIZEN'S ARREST · HAVE-A-GO HERO · RACE CRASHER · BARBECUE SEASON · DOMINO ×3
```
