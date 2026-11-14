# Curbside V3 — look better, play better

_Written 2026-11-14 against 0.33.0. Items are sized S (part of a session),
M (one session) or L (a stream of its own, several sessions)._

**Decided 2026-11-14 (the owner):** stages 1, 2, 3, 4 and 6 go ahead, with
stage 0 as their baseline; stage 5 isn't chosen. Blender work isn't done
by the code streams: it's written up in
[BLENDER_TODO.md](BLENDER_TODO.md) §16 on for another session, and the code
side ships with stand-ins until the GLBs land. At most two subagents.
Streams: `claude/v3-look` (stages 1–3) and `claude/v3-play` (stages 4 and
6), integrated on `claude/v3`. The dodge roll gets a button on touch
unless the owner says otherwise; the camera presets and the day looks are
built for the owner to choose from.

## How this was put together

- Read the design, system and backlog docs, then ran 0.33.0 headless at
  full resolution and looked at stills: the title, the spawn corner,
  downtown and the Neon Mile by day, at dusk and at night, on foot and in a
  4-star chase. `npm test` (1,803 tests) and `npm run build` pass on this
  branch.
- **Limits.** The headless renderer runs at about 1 frame a second, so the
  look was judged from stills, not in motion, and nothing about how the
  game *feels* was tested. Nobody has played 0.33 on the iPhone yet
  (HANDOFF item 1). Every gameplay point below is a reading of the rules
  and the bot harnesses, to be confirmed by real play.

## What I found

### Look

1. **Night is the game's good side; day is flat.** At night the lamp
   streaks, neon, siren wash and headlight cones make a strong picture. By
   day the same streets are a plain grey slab under near-black shadows,
   with muted colours. A new player's first look depends on the clock.
2. **People are dots.** From overhead a person is a head and shoulders
   about half a metre across: roughly 25 px on a 1280 × 720 view. You can't
   read who is armed, who is hostile or what the player is doing.
3. **Roofs fill a third to a half of the frame and are the plainest
   surface in it.** Blocks are 48 m of every 64 m, so from above most of
   the world is roof. On foot on the Neon Mile the bottom half of the
   screen is flat blue roof. The noise-patterned roof gardens read as a
   glitch up close.
4. **Cars don't show what has happened to them.** Damage is smoke, fire
   and charring; there are no dents, broken glass or missing parts. Crashing
   is the game's main verb and the car looks the same until it smokes. The
   car models are plain boxes from above, and the player's car differs
   from traffic only by its ring.
5. **Daytime pavements are bare.** The shopfronts, where the districts'
   character is, are hidden by the near-vertical camera, and little stands
   on the pavements to make up for it.
6. **A blast whites out the middle of the screen on desktop.** With
   bloom on, two cars going up at night turned a third of the frame pure
   white for the frames I caught, hiding the wrecks and the police. (Phones
   don't bloom; to be checked there.)
7. **The HUD is good, but the top-centre of the phone screen is crowded.**
   In the 852 × 393 smoke screenshot the radio's NOW PLAYING card sits over
   the job card. The job card, stars, status line, objective and stamp all
   stack above the car.

### Play

1. **There is no data from people.** All tuning so far comes from bots.
   The device pass and the blind playtests (V2-14) haven't happened.
2. **Breadth is well ahead of depth.** 25 story jobs, 11 weapons, 8
   frenzies, 6 races, 40 packages, taxi, exports, towing and 20-odd
   incidents. The three things done every minute have few decisions in
   them:
   - **Escaping the police is one rule:** stay unseen for 6 s plus 3 s a
     star. At 5 stars the harness bot never escaped in 20 chases and the
     stock sports car lasted a median 26 s. I found no payout for getting
     away.
   - **Cash runs out of things to buy.** The shop's three permanent items
     cost $6,500 in all; after that it's ammo.
   - **Fights on foot are lock on and hold fire.** There's no defensive
     move and every enemy is the same 100 HP person with a gun.
3. **Free roam has no short goal.** Between payphone jobs, and after the
   story, a life has no target beyond the score.
4. **Failing a job sends you back to the phone.** There's no retry.
5. **No assist or difficulty options.**

## Principles

- **Readable first.** If the player can't see it, better art and rules
  are wasted.
- **Depth before breadth.** No new mode or incident until driving,
  escaping and fighting each have more decisions in them.
- **Day gets to night's standard.**
- **Every look change is judged on a before/after sheet at phone size;
  every play change on a harness number, then in the owner's hands.**
- **The budgets stay:** under 150 draw calls on the iPhone profile, no
  runtime lights, no shader compiled mid-play, no per-frame allocation.
  Almost everything below is shader, instance-attribute or tuning work
  that adds no draw call.

## The plan

### Stage 0 · A baseline to judge against

| # | Item | Size |
|---|---|---|
| B1 | **Look sheet.** Extend `tools/look/views.mjs` to a fixed set of about 14 views at phone size (day, dusk, night × spawn, downtown, Neon Mile; on foot; a chase; a blast; rain), stitched into one sheet. Add two numbers a view, worked out from the camera and the city data: the player's size on screen and the share of the frame that is roof. | S |
| B2 | **Play baseline.** Run `heat.mjs`, `chaos.mjs` and `inview.mjs` at 0.33.0 and record the numbers the later stages must move. | S |
| B3 | **The owner's device pass** (HANDOFF item 1), alongside. It doesn't block stages 1–3, but what it finds can reorder everything after. | owner |

### Stage 1 · Readability

| # | Item | Where | Size |
|---|---|---|---|
| L1 | **Bigger, brighter people.** Draw people about 1.3–1.4× life size (drawing only: collisions, doors and seats unchanged, as guns in hand already are), lift the outfit palettes' brightness and saturation, add a rim-light term to the character shader and a stronger contact shadow. Hostiles get their own tint. | `characterModel.ts`, `game/bodies.ts`, `contactShadows.ts` | M |
| L2 | **Roofs step back, the street steps forward.** By day roofs go 15–25% darker and less saturated with shading along the parapets, so the eye lands on the road; landmark roofs (helipads, pools, courts) stay bright. Replace the noise-pattern gardens with planted rows. | `cityMesh.ts`, `districts.ts` | M |
| L3 | **Camera trial.** Three presets on LOOK panel sliders (tilt 0.12 as now, 0.2, 0.3; on-foot height; field of view) to show more shopfront and less roof. If a steeper tilt wins, walls and roofs between the camera and the player dither away in the building shader. The owner picks on the phone. | `cameraRig.ts`, `lookTuning.ts`, `cityMesh.ts` | M, L with the cutaway |
| L4 | **One thing at a time top-centre.** The radio card moves or shrinks to one line while a job card is up; the objective line fades into the card after a few seconds; the smoke test's overlap check covers radio card against job card. | `ui/hud.css`, `radioToast.ts`, `tools/smoke.mjs` | S |

### Stage 2 · Daylight

| # | Item | Where | Size |
|---|---|---|---|
| L5 | **Three day looks to choose from.** Three candidate `look.json` files (sunny pastel, hazy gold, high-contrast comic), each with a sheet; the owner picks one or tunes it in the LOOK panel. Sun shadows take their colour from the sky (violet-blue, not black); add sliders for shadow tint and softness if they're missing. This also closes HANDOFF's "waiting on a look.json". | `look.json`, `lookTuning.ts`, `post.ts`, `timeOfDay.ts` | M |
| L6 | **Road and pavement surface.** In the ground shader: aggregate grain, polished wheel tracks, patch repairs, cracks, oil stains at stop lines and bays, drain covers, a kerb highlight and gutter shadow, painted arrows and bus lanes, and pavement slabs that differ by district. Costs fragment time, so it's measured with GPU BREAKDOWN and the low tier keeps today's ground. | `world/ground.ts` | M |
| L7 | **Things on the pavement.** Café tables, crates, A-boards and market stalls outside arts and old-town shopfronts; newspaper boxes, bike racks, planters, parked scooters; leaves and litter in the gutters. All in the existing knock-over prop families, so it's also more to smash. Includes the roadworks kit W3-C already needs. | `world/streetProps.ts`; new props are BLENDER_TODO §17 | L |

### Stage 3 · Cars and crashes

| # | Item | Where | Size |
|---|---|---|---|
| L8 | **Damage you can see.** A per-car damage value for front, rear, left and right, fed by where each hit lands, drives the car's vertex shader: panels crumple inward, glass darkens and cracks, a headlight or tail light goes out, paint scuffs. A bonnet or bumper comes off as debris when the car starts smoking. | `systems/damage.ts`, `vehicleBatch.ts`, `fxDebris.ts` | L |
| L9 | **Cars that read from above.** A Blender pass on all 22 vehicles for the top view: roof and bonnet colour breaks, stripes, spoilers, roof racks, sunroofs, mirrors, wheel arches; two or three liveries per model by shader mask (taxi checks, delivery logos, race numbers). The GLB contracts don't change. | BLENDER_TODO §16 (models in, 2026-11-14); `carMesh.ts`, `vehicleBatch.ts` (`paint2`). **Fix before shipping:** the new sloped nose and boot panels catch the sun glint (`ubGlint` in `vehicleBatch.ts`) as whole flat facets, so by day a car heading down the screen has a white, blooming nose (seen on taxi, van, limo at 13:00, desktop) | L |
| L10 | **Crash juice.** A burst of glass and plastic on hard hits, paint-transfer scrapes on walls, sparks while grinding along one, and a beat of slow motion on a big side-on hit. Cap a blast's brightness so a fireball stays orange with its shape and the wrecks stay visible through it on desktop. Mostly tuning systems that exist. | `fxDirector.ts`, `fxDriving.ts`, `fxDecals.ts` | M |

### Stage 4 · Chases worth having

| # | Item | Where | Size |
|---|---|---|---|
| P1 | **Make 5 stars survivable.** Target: the harness bot in a stock sports car lasts a median 75 s or more and escapes at least 3 times in 20 (today 26 s and never). Knobs: ram cadence, passenger fire, crash share while pursued, the helicopter's refuel window. | `systems/police.ts`, `pursuit.ts`, `tools/tune/heat.mjs` | M |
| P2 | **Three more ways to lose them, each shown on the HUD.** NEW WHEELS: getting into a different car while unseen halves the wait for the next star. LYING LOW: stopped and unseen in a car park or alley, the clock runs double. And the radar shows where the police think you are (a last-seen marker and search ring), so breaking line of sight becomes a decision. | `systems/wanted.ts` (pure, tested), `ui/radar.ts`, `wantedHud.ts` | L |
| P3 | **See it coming.** A roadblock is on the radar and the scanner a few seconds before you reach it. | `systems/police.ts`, `scanner.ts`, `radar.ts` | S |
| P4 | **Pay for getting away.** GOT AWAY pays cash by peak stars and time wanted, and counts toward the life's CRED. | `game/heat.ts`, `progressBank.ts` | S |

### Stage 5 · Reasons to keep playing (not chosen)

| # | Item | Where | Size |
|---|---|---|---|
| P5 | **This life.** Three small goals per life from a pool ("8 near misses", "reach 3 stars and lose them", "bank a ×6 chain", "a 30 m jump"), shown under the cash; each pays cash and CRED, all three a bonus. They count the same events the frenzies do. | new pure module beside `modes/frenzies.ts`, HUD row | M |
| P6 | **A garage to spend on.** At the safehouse: choose the car you start each life in from models you've sold at the docks; three ranks each of ARMOUR, ENGINE, TYRES and NITRO TANK; paint and underglow colour. About $60,000 to buy everything. Off in the Chaos Run and races, as perks are. | `modes/shop.ts`, `progressSave.ts`, `entities/vehicle.ts` | L |
| P7 | **RETRY on a failed job**, from the job's start or from a checkpoint step on the long ones, without the trip back to the phone. | `systems/missions.ts`, `modes/missionMode.ts` | M |
| P8 | **Assists** in Settings: stronger aim assist, relaxed police. A relaxed life earns no medals. | `settings`, `combat.ts`, `heat.ts` | S |

### Stage 6 · On foot

| # | Item | Where | Size |
|---|---|---|---|
| P9 | **A dodge roll:** about 4 m in 0.35 s during which nothing lands, on a short cooldown. Needs a `Roll` clip for the bodies and a touch binding. | `game/player.ts`, `combat.ts`, `touchControls.ts`; the clip is BLENDER_TODO §18 | M |
| P10 | **Three kinds of enemy** from the parts there are: a rusher (fast, 70 HP, fists or a bat), the shooter as now, and a heavy (armoured, a shotgun, slow), told apart by build and colour (L1). Used by the VIPERS, SWAT and story jobs. | `systems/crowd.ts`, `game/population.ts`, `missionsData.ts`; the heavy's body is BLENDER_TODO §20 | M |
| P11 | **A bat to pick up:** one swing floors someone, a few swings and it breaks. | `systems/weapons.ts`; the model and clip are BLENDER_TODO §19 | M |

### Later, not scheduled here

The bigger city (W3-A) and the four street scenes (W3-C) already wait on
the owner's decisions. Of the W3-E ideas, **Blackout** is the one I'd do
first once the above is in: it shows off the night look with almost no new
art.

## Order

1. Stage 0, then stage 1 (L1, L2 and L4 together; L3 once the owner can
   try the presets on the phone).
2. Stages 2 and 4 as parallel streams: they share no files.
3. Stages 3 and 5 as parallel streams.
4. Stage 6.

Each stage ships as its own minor version with a before/after sheet, the
smoke test and the harness numbers. Stages 1 and 2 are worth doing before
1.0.0; the rest can come after if the owner would rather ship.

## What needs the owner

- The device pass (B3), and a short play after each stage.
- L3: which camera preset.
- L5: which day look.
- P6: whether a chosen, upgraded car fits "every life starts the same".
- P9: the touch binding for the roll (a button, or a flick of the stick).

## Not proposed

- New modes, incidents or weapons beyond the bat: there is already more
  to do than a player finds in an evening.
- Bloom or any full-screen pass on phones: the no-pass rule is what keeps
  the frame rate.
- Real-time car deformation physics: the shader crumple gives the look
  for no draw call.
- An online leaderboard: still waiting on the backend decision.

## Risks

- **L1** bigger people may look wrong at car doors and in vehicles; the
  scale is one constant, trialled on the sheet first.
- **L3** a steeper camera changes what the thumbs cover, the look-ahead
  numbers and which side of a street is hidden; it's a trial with the
  current camera kept as preset one.
- **L6, L8** add shader work on the phone's most-drawn surfaces; each is
  measured with GPU BREAKDOWN and gated by tier.
- **P1, P2** make escaping easier; the medals and CRED rates were tuned
  against today's police and may need a second pass.
- **P6** more saved state: new fields go through the save's sanitiser and
  migration tests.
