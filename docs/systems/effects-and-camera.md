# Effects and camera

Everything that makes an action land lives in `src/render/fx*.ts` and
`effects.ts`, driven by `FxDirector` (`fxDirector.ts`), which subscribes to
the event bus. `main.ts` only creates it, scales the time it feeds the sim
by `fx.simScale(dt)` (hit-stop) and calls `fx.update(dt, controls, focusX,
focusZ, playing)` once per frame after placing cars and people.

- **Particles** (`fxParticles.ts`, pure and tested): struct-of-arrays pools
  with a free list, nothing allocated per particle or per frame. Each
  particle has drag, gravity, spin, optional ground bounce and stretch
  along its velocity, and a colour/opacity ramp over its life: fire runs
  white → yellow → orange → red and hands off to smoke as it dies, smoke
  fades in and out (it no longer shrinks), sparks streak, embers flicker.
  Sprites come from a 4×4 atlas drawn on a canvas at start-up
  (`fxAtlas.ts`: fbm puffs, flame, spark, star, ring, tracer, muzzle flare,
  dust). Two camera-facing instanced draws, fire then smoke over it, with
  premultiplied blending so one shader does both alpha smoke and additive
  light: stacked flames saturate to yellow-orange, not white. Smoke is
  dimmed by the sky at night, and thins on screen over the player on foot
  (`effects.seeThrough`, a uniform), so a blast's smoke cloud, your own
  car's included, never hides your character. Counts scale with the tier's
  `particleScale`; explosions close together share one budget.
- **Ground marks** (`fxDecals.ts`): skid ribbons, scorches, bullet pocks
  and scrapes are quads in one ring-buffered mesh that fades them in the
  vertex shader (skids ~22 s, scorches ~75 s in their own 32-slot ring).
  Transparent and drawn first among transparents, i.e. after the ground;
  not drawn at all while no mark is alive. Scrapes dim at night (they're
  unlit).
- **Debris** (`fxDebris.ts`): panels in the exploding car's paint, chips,
  glass and brass casings as one instanced lit box mesh with bounce,
  friction and spin.
- **Fake lights**: ground flashes, shockwave rings, muzzle splashes, pickup
  rings and burning-car glows go into the shared glow mesh through
  `look.addGlowSource` (no draw call, no real lights).
- **Cars** (`fxCarBody.ts`, `fxDriving.ts`): bodies lean out of turns, dip
  under braking, squat on launch, lurch on impacts and hop and tumble in
  blasts, applied to the car root (Euler order YXZ) after main.ts places
  it. Rear wheels lay skid marks when sliding, handbraking, braking hard
  or spinning up; tyre smoke on a real slide; dust off park lawns; wind
  streaks past the player above ~65% of top speed; damaged cars smoke,
  burning ones flame with embers and a flickering glow (stronger at
  night), wrecks burn down and smoulder.
- **Camera** (`cameraRig.ts`, `fxMotion.ts`): trauma shake (smooth noise ×
  trauma², slight roll), directional kicks on springs, FOV punches; fed by
  crashes (by impact), explosions (by distance), gunfire (a little recoil)
  and getting hurt; behind the title only the flash plays. Look-ahead per screen axis, soft-limited to a share of
  what's visible on that axis, with velocity feed-forward so it never
  trails the car. Measured on the iPhone profile at 86 km/h: 1.45 s of road
  ahead driving up the screen (car at 79% of the height), 1.36 s driving
  down (car at 23%), 2.8 s across (car at 32% / 68% of the width); the car
  never reaches the bottom corners where the thumbs are. On foot the
  camera sits at 20–24 m on a phone and 27–31 m on a desktop (a 16:9
  screen sees less across: ~42 × 23 m, so 22–24 m NPC gunfights stay in
  view), and lifts 5 m (desktop 7 m) with a gun out and 3.5 m in a recent
  fight. Mouse aim leans the view toward the cursor (`rig.aimAt`: 30% of
  the cursor's ground offset, at most 8 m, eased), so you see what you
  shoot at.
  *Camera trial* (V3 L3, LOOK panel → CAMERA (TRIAL)): presets TODAY 0.12,
  TILT 0.2 and TILT 0.3 (`lookTuning` CAMERA_PRESETS) and sliders for tilt,
  on-foot height and field of view, on `rig.trial` (main points it at the
  live look). They apply only through `rig.follow()`, the play camera;
  the title, observe and the map editor drive `update()` and keep
  `opts.tilt` and the 45° lens. The shipped default is today's camera.
  A steeper tilt looks across the street from the south, so the buildings
  on its south side stand between the camera and the player: from a 0.14
  tilt (`cutawayFor`, full at 0.18) the building shader, the city's box
  props and props.glb's kit above 1.5 m discard a dithered cone from the
  camera to the player (`shaderLib` UB_CUTAWAY, `uCutaway` set by
  `Look.update`; the colour pass only, so sun shadows stay whole; one
  uniform test while off). Neon halos on a cut roof stay; the look-ahead
  limits are the same shares of the view.
  `prefers-reduced-motion` keeps a third of the shake, no roll or FOV
  punches, and softer exposure and combo-edge flashes. A blast out of
  sight (over 55 m from the view centre) doesn't flash the screen.
- **Hit-stop** (`HitStop` in `fxMotion.ts`): 40–80 ms of near-frozen sim on
  close or player-caused explosions, heavy crashes and knockouts; overlaps
  keep the longest hold and a cooldown stops chains turning into slow
  motion. Shake and the HUD keep real time; the camera's follow slows with
  the sim (`rig.timeScale`), so the view freezes with the car instead of
  running on ahead of it. Crash sparks start just above roof height so the
  hit's first frames aren't hidden inside the two cars.
- **Weather** (`fxWeather.ts`): every few minutes a shower of a minute or
  two eases in; streets get wet behind it (`uWetness`) and dry slowly:
  everything darkens, and ~3 m puddles gather along the gutters (few
  mid-road, hardly any on pavements) with a faint sky sheen by day and a
  cool one at night. Rain is one instanced draw animated in the vertex
  shader (world-anchored streaks that fan out from the view centre, plus
  small faint splash rings); exposure dips a little; `audio.setRain` adds
  a hiss-and-patter loop.
- **Overlay** (`src/ui/fxOverlay.ts`, `fx.css`): screen-edge flashes at the
  ×5 and ×10 combo, animated with the Web Animations API.
- **Stamps**: on a `stamp` event the director holds the sim for 0.12 s
  (the stamp slams down in it), flashes the edges in the stamp's ink and
  adds a little shake. See *Named mayhem* below.

Budget: at most 5 draw calls for all of it (fire, smoke, debris, ground
marks, rain), each skipped when empty, and no program
compiled after start-up (they are all built at warm-up). Measured in
Chromium with `?debug`, whole frame (iPhone 15 Pro profile, 'medium' tier,
then desktop 'high'):

| Moment | iPhone | Desktop |
|---|---|---|
| One car exploding next to you (before → during) | 43 → 45 | 56 → 59 |
| Five-car chain reaction, peak | 51 → 55 | 66 → 67 |
| SMG and shotgun fight with two armed NPCs | 52 | 61–63 |
| Mid-drift with skid marks and tyre smoke | 47–51 | 61–63 |
| Rain, day / night | 44 / 48 | 60 / 63 |

A five-car chain peaks at ~280 fire, ~180 smoke and ~60 debris particles
on the phone tier (pools hold 900 / 700 / 128).

**Particle budgets** (`quality.ts`, applied by `Effects.applyBudget`). On a
phone the cost of mayhem is fill, not draw calls or JS: big translucent
quads stacked over the screen. `Effects.fill` estimates it each frame
(each drawn quad's area over the visible ground's, a quad counting bigger
the nearer it is to the camera: screens of overdraw). It matches a count
projected through the camera for one blast (5.6 vs 5.4) and reads high
while a chain's smoke is high up (8.7 vs 5.7), which only makes the
budget act a little early. Over the tier's fill budget, big particles
(over 2.5 m) age up to 4× as fast (fully at 1.5× the budget) and new
smoke is held to `smokeMaxOver`; in a chain (another blast within ~¼ s)
the later blasts' smoke and their fireballs' after-smoke are held to it
at once and live 0.65 of their life, since a chain's smoke peaks seconds
after the budget could see it. Fires on screen beyond `fullFires` share
that many fires' flames, smoke and embers, and only the first
`chainLights` blasts of a chain get fake lights. High is the look as
designed (no budget); one car blowing up stays under the medium budget,
so normal play looks the same.

| Tier | particleScale | live fire / smoke | fill budget | smoke max (always / over) | full-rate fires | chain lights |
|---|---|---|---|---|---|---|
| high | 1 | 900 / 700 | none | – / – | all | all |
| medium | 0.75 | 700 / 500 | 7 screens | – / 5 m | 3 | 3 |
| low | 0.5 | 480 / 340 | 4 screens | 4.5 / 3.5 m | 2 | 2 |

Measured with `tools/tune/mayhem.mjs` (iPhone profile, 36 s: four cars and
three walls at once, two cars at 8 s, two cars and a wall at 16 s; six
fires, fire trucks; god mode, destruction test on; peaks unless noted).
Fill is projected through the camera, in screens (`--dpr 1`: fill and
draw calls don't depend on it); before = 0.11.0 with the logging only:

| Tier, time | live fire / smoke | fill peak | fill mean | glows (fill) | draw calls |
|---|---|---|---|---|---|
| medium, day | 327 / 295 → 277 / 256 | 15.2 → 5.7 | 2.32 → 1.25 | 46 (9.7) → 42 (4.9) | 56 → 56 |
| medium, night | 317 / 295 → 277 / 256 | 15.2 → 5.7 | 2.39 → 1.32 | 50 (9.8) → 50 (5.0) | 59 → 59 |
| low, day | 186 / 133 → 169 / 115 | 8.7 → 2.4 | 1.57 → 0.69 | 43 (8.4) → 39 (3.6) | 32 → 32 |
| low, night | 197 / 133 → 169 / 115 | 8.7 → 2.4 | 1.57 → 0.70 | 52 (8.5) → 52 (3.8) | 35 → 35 |
| one car, medium | 66 / 50 → same | 5.4 → 5.4 | 1.33 → 1.33 | 27 (1.6) → same | 47 |
| one car, low | 46 / 33 → same | 3.8 → 1.6 | 0.95 → 0.56 | 27 (1.6) → same | 27 |

Nearly all of it is smoke: the blasts' columns and the fireballs'
after-smoke (up to ~10 m quads, rising toward the camera); flames are
under 0.1 screens even with six fires. Without the living city's fires
(`--no-city-fires`, medium, night) the same run peaks at 14.5 with a mean
of 1.96: its fires (each wreck and hit wall burns 75 s) add ~20% to the
mean fill, ~20% more live fire particles and eight glows, but the peak is
the blasts', as it was before the city.

**Low-resolution smoke** (`render/lowResFx.ts`; the pure plan, cost model
and switch in `lowResFxPlan.ts`, tested). On tiers with `fxScale` under 1
(medium and low: 0.5; high draws them with the scene) the soft particles
(smoke, dust) can render before the scene into a half-size target with no
MSAA: colour plus their alpha-weighted view depth, depth-tested against
every building as an instanced box (one depth-only draw). A composite then
lays them over the scene, one instance per covered tile of a 16×8 grid,
with `gl_FragDepth` at the smoke's mean depth less 3 m, tested against the
real depth: crisp building edges, no halo, and cars don't notch it. Each
frame it projects the particles' quads to tiles and goes offscreen only
when that saves fill (with hysteresis), so normal driving costs nothing. On
phones the target is flagged as an XR target so the particles tone-map and
encode as on the canvas; it needs `EXT_color_buffer_(half_)float`, else
smoke stays full size. The programs are precompiled with the scene's
(`Look.precompile`, also after a lost context) and the target follows the
drawing buffer. `look.lowFx.mode` (`auto`, `off`, `on`) is for tests and
screenshots. Smoke work is in full-resolution screens of fragment work
(offscreen: fill × scale² × 1.25 for the depth output, plus the composite's
tiles); 0.12.0 → 0.12.1, same seed, day, iPhone profile:

| Run, tier | smoke fill → work, peak | mean | frames offscreen | draw calls (peak) |
|---|---|---|---|---|
| mayhem, medium | 7.41 → 3.06 | 1.25 → 0.79 | 50% | 60 → 60 |
| mayhem, low | 2.40 → 1.50 | 0.59 → 0.51 | 20% | 31 → 33 |
| one car, medium | 5.60 → 2.04 | 0.55 → 0.28 | 85% | 52 → 54 |
| one car, low | 1.61 → 0.74 | 0.23 → 0.18 | 36% | 29 → 31 |
| driving (tyre smoke), medium | 0.35 → 0.34 | 0.06 → 0.06 | 0% | 58 → 58 |

Shots of the same frame drawn both ways differ by under 1/255 on average.
Low stays at half scale: a quarter roughly halves its smoke work again but
softens the smoke visibly. The occluder boxes ignore breach holes, parapets,
rooftop kit and trees; the XR-target flag leans on three r186 internals
(recheck on an upgrade).

API for other systems:

```ts
effects.explode(x, z, paint?)              // the whole blast sequence (FxDirector does this on 'explosion')
effects.sparks(x, y, z, n, lo, hi, dirX, dirZ) / effects.embers(x, z, n, lo, hi)
effects.muzzleFlash(x, z, dirX, dirZ, power) / effects.tracer(x1, z1, x2, z2, kind)
effects.burst(x, z, r, g, b, n, radius)    // sparkle + ring (pickups, rewards)
effects.light(x, y, z, r0, r1, r, g, b, life, GLOW.disc | GLOW.ring)  // a fake light
effects.seeThrough(x, y, z, radius)        // thin smoke over a point on screen (FxDirector: the player on foot)
effects.decals.stamp(x, z, r, angle, opacity, life, DECAL.scorch)
rig.addTrauma(0..1); rig.kick(dirX, dirZ, metres); rig.punchFov(degrees)
fx.hitStop.hit(seconds, slow?)             // slow the sim for a moment
fx.setRain(true | false, seconds?)         // start or stop a shower (missions, debug)
fx.overlay.edgeFlash(cssColour, strength)
```

## Named mayhem (stamps)

The player's biggest bits of chaos get a name stamped across the middle of
the screen, and passers-by in view stop and film it. Rules and table in
`systems/stamps.ts` (pure, `tests/stamps.test.ts`), the bus wiring in
`game/stamps.ts`, the element in `ui/stampHud.ts` and `stamp.css`.

| Stamp | For | Weight |
|---|---|---|
| BONFIRE NIGHT | six cars going up in one chain | 9 |
| TAKE THE HEAT | the chase handoff (V2-03, via `show`) | 8 |
| CITIZEN'S ARREST | the chase handoff (V2-03, via `show`) | 8 |
| ENDANGERED PANDAS | three police cars wrecked in one pursuit | 7 |
| PARTING GIFT | a sticky charge of yours going off on a car someone else was driving with you 30 m off, or on the cash van or the Mayor's limo (W3-B, `chargeBlast.gift`) | 7 |
| HEALTH AND SAFETY | a blast of yours within 20 m of a fire crew hosing | 7 |
| BARBECUE SEASON | three cars going up in a chain (each within 2.5 s of the last) | 6 |
| FARES PLEASE | three people knocked down by your bus within 3 s | 6 |
| BLUES AND TWOS | five stars (once a pursuit) | 6 |
| BANK HOLIDAY | four car-on-car crashes within 3 s and 30 m of one of yours (only your first counts) | 5 |
| ABSOLUTE SCENES | the combo reaching ×10 | 5 |
| NOTHING TO SEE HERE | shaking off a chase of 3+ stars (the EVADED bonus) | 5 |
| HAVE-A-GO HERO | the mugging bag handed back (V2-03, via `show`) | 5 |
| RACE CRASHER | a street race joined and won (V2-12, its award) | 6 |
| VAN NICKED | the city's ice cream van driven off from its queue (V2-12, its award) | 4 |
| NEIGHBOURHOOD WATCH | three gang members knocked down within 5 s | 4 |
| FREQUENT FLYER | a STUNT worth 3,500+ | 4 |
| BOWLED OVER | four people knocked down by a car within 3 s | 3 |
| LAST ORDERS | three people punched down within 6 s | 3 |

- **Detector** (`StampDetector`): reads `explosion`, `award`, `crash`,
  `pedDown`, `wanted`, `stunt`, `chargeBlast` and `street` (hose / fireOut) for the
  player's own doing only, with fixed-size windows (`Burst`: n within a
  span, fires once and re-arms after a gap; `Chain`: links within a gap).
  Car explosions only count toward a chain (a grenade on an empty road
  doesn't). A respawn or a bust forgets what's half-counted.
- **One at a time** (`StampArbiter`): at most one every 4 s; the heaviest
  offer in a frame wins; a heavier one within 0.6 s of a lighter one
  replaces it; anything else waits out the cooldown and is dropped once
  1.5 s old.
- **Out**: `Stamps.step()` once a frame emits the winner as `stamp {id, x,
  z}` (the player's position), only in play, alive and free. Listeners:
  the HUD, the fx director (hit-stop, edge flash), `GameAudio` (a rubber
  stamp thunk and a quick chord, the music ducked) and the witnesses
  (filming). Stamps are on in every mode, the Chaos Run included.
- **HUD**: one element built once; a stamp swaps its text and restarts a
  CSS animation (two copies of the keyframes, swapped, so no reflow):
  a 1.9 s slam, hold and fade, nothing running between stamps. Centred
  across, its top under the stars and their pop line (stepping down with
  them under the activity card and the radio's card) or at 42%,
  whichever is lower; a size down at 360 px tall and under, and again
  under the activity card on the phones (clear of the NOS button). Ink: red for
  mayhem, cyan for the have-a-go moments, blue for the police ones.

```ts
stamps.show('takeTheHeat')     // name a moment (cooldown and weights apply)
stamps.force('barbecueSeason') // now, whatever the cooldown (debug)
STAMPS[id]                      // { label, sub, weight, tone }
__ub.stamp('neighbourhoodWatch') // force one from the console / smoke test
```

## Best moment (the WASTED picture)

The life's best stamp is photographed as it lands and shown on WASTED /
BUSTED with its caption, to share. Ranking, caption and file name in
`systems/bestMoment.ts` (pure, `tests/bestMoment.test.ts`); the capture,
card and share in `ui/momentCard.ts` and `moment.css`.

- **Best**: the heaviest stamp of the life (the table's weight); a later
  heavier one replaces it, a tie keeps the first. A respawn (or a bust's
  release, PLAY, the title) starts a new life. No stamp, no picture.
- **Capture**: on the frame the better stamp lands (inside its hit-stop),
  `moment.afterRender()`, called in `main.ts` right after
  `look.render(camera)`, copies the WebGL canvas into one 2D canvas at most
  800 px wide (`MOMENT_WIDTH`) in the same task: no extra render pass, no
  `preserveDrawingBuffer`, and every other frame it is one branch. The
  canvas is reused for the life (≈1.2 MB at 800×369) and zero-sized on
  respawn. Headless Chromium copies in 0.1–1.5 ms; the session log gets a
  `moment` line with the copy's ms (and the JPEG's size and time).
- **Card**: on WASTED / BUSTED the title and numbers step left
  (`#wasted.has-moment`) and the photo sits on the right, tilted, with the
  stamp's name in its ink, its line in lower case and where and when
  (`NEON MILE · 21:07`, the district and the game clock); at 360 px tall
  and under a size down with a wider crop, centred between the score and
  the thumbs. The score's feed lines hide while it shows (the card has the
  numbers; they'd run into its corner). It drops in with the numbers.
- **Share**: the JPEG (quality 0.85, the caption burnt into a dark band at
  the foot, `curbside-<stamp>-<yyyymmdd-hhmmss>.jpg`) is encoded once, on
  WASTED, with `toBlob`; SHARE is live once it's ready. It goes through the
  bug report's path (`shareFiles`, then `saveFiles` if the sheet refuses or
  is missing): SHARED, SHARE again after a cancel, or SAVED. While the
  sheet is up the respawn waits (`moment.simScale()` is 0 and the timer bar
  pauses; at most 60 s). Touch, mouse and VoiceOver; no pad binding.

```ts
__ub.moment.picture   // the life's photo (a canvas) or null
__ub.moment.best      // BestMoment: { has, moment: { id, x, z, hour } }
__ub.moment.copyMs    // the last copy's cost; encodeMs: the JPEG's
```
