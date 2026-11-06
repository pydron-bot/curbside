# Look

Everything visual outside the HUD hangs off one `Look` object
(`src/render/look.ts`): `main.ts` creates it, calls `look.update(dt, player)`
and `look.render(camera)` each frame. No real-time light is ever added or
removed (that would recompile every lit material), every program is compiled
on the first frame and again after a restored GL context (night-only meshes
included; on desktop against the HDR target the scene really draws into),
and quality-tier changes only resize or idle things. Every car model's
geometry is uploaded at load, not when that model first drives into view,
and the whole city is drawn once with culling off before the first real
frame (and after a restored context), so no chunk uploads its buffers
the first time it comes into view.

- **Draw calls.** All people wearing one body are one GPU-skinned
  `InstancedMesh` (`characterModel.ts`: the GLB's rigid parts merged at
  load, bones and palette per person in a float texture; see *People*
  below), all cars one instanced mesh
  per model (`vehicleBatch.ts`: paint, steering, brake lights, charring and
  sirens are per-instance attributes), all contact shadows one mesh
  (`contactShadows.ts`) and all faked lights one additive mesh
  (`glowSprites.ts`: headlight beams, tail/brake lights, siren wash, the
  player marker: a ring on foot, round the car a ring that dims at speed
  but never goes out plus a chevron ahead of the bumper, pickup rings). The city is ~5 instanced meshes per 256 m
  chunk. Measured in Chromium (whole frame, incl. shadow pass), iPhone
  15 Pro profile ('medium'): 40 draw calls on foot at spawn, 44–56 driving
  a busy street by day or night, rain included (each car model in view
  costs one call, plus one in the shadow pass); desktop ('high') is 55–69
  including ~14 for bloom; 'low' (no shadow map) 22–27. Programs: 18 on
  phones, 27 on desktop, none compiled after start-up over a full day.
  About 160–250k triangles on the phone (most at night), ~245k on desktop,
  most of it the instanced city in both passes. The destruction test (off
  by default, [*Destruction test*](destruction-test.md)) adds one rubble batch, +1 call
  (+1 in the shadow pass with the desktop style, which `auto` uses on
  phones too) while chunks are on screen; its craters are drawn by the
  building shader, at no call.
- **Light.** `timeOfDay.ts` (pure, tested) keyframes sun/moon direction,
  colour and strength, sky and ground fill, fog, exposure, reflection
  strength and a shared `uNight` (night keeps a strong blue moon and sky
  fill so streets stay readable on phones, which have no bloom to lift
  them); `sceneLighting.ts` applies it to one
  `DirectionalLight`, one `HemisphereLight` and a faint ambient.
  `sunShadow.ts` fits an orthographic PCF shadow box to the visible ground
  every frame, snapped to whole texels (no shimmer); map size comes from the
  tier (2048 / 1024 / off). Tone mapping is ACES plus a grade
  (`post.ts`, installed as `CustomToneMapping`: no extra pass).
- **Surfaces.** `shaderLib.ts` holds the shared uniforms (`uTime`,
  `uNight`, and `uWetness`, which the weather in `fxWeather.ts` drives)
  and GLSL (integer hash, noise, anti-aliased lines, and `ubStreetLight`,
  which lights ground, walls, cars and people from the lamp layout in
  `world/streetLamps.ts` analytically).
  `world/ground.ts` draws the whole ground in one shader that follows the
  city constants exactly; `world/cityMesh.ts` draws buildings, roofs,
  rooftop props, awnings, neon, lamps and trees; `world/districts.ts` and
  `world/buildingPlans.ts` (pure, tested) decide districts, heights,
  palettes, roof types, props and shopfronts.
- **Neon city (0.22.0).** The in-game look follows the title screen's
  synthwave neon, all at no new draw call or pass:
  - *Grade* (`post.ts` GRADE, inside the tone mapping): violet-indigo
    shadows, rose highlights, a touch of the logo's pink in the upper mids,
    more saturation above the darks. *Sky* (`timeOfDay.ts`): a cyan moon
    and violet fill at night (the old blue night's brightness), a pink and
    magenta sunset into a violet dusk.
  - *Rooftop neon* (`BuildingPlan.roofNeon`, planned on its own stream in
    `buildingPlans.ts`, tested in `tests/roofNeon.test.ts`): tubes on the
    street-facing roof edges, down the corners, and lit signs leaning back
    over the roof (clear of the rooftop kit), by district (arts and
    downtown most); drawn by `cityMesh.ts` in the `boxes` batch with halos
    in the night `glows`. A negative `aGlow` makes a tube stutter now and
    then (propMaterial). Tube emission sits at the night bloom threshold,
    or desktop bloom washes whole buildings.
  - *Wet-look roads* (`ground.ts`): at night the road darkens a little and
    gets damp patches (`gSheen`, most along the gutters) that take a share
    of the lamp light and mirror each lamp head as a warm streak toward the
    viewer (`gLampGlints`: the head mirrored under the ground, seen from
    `cameraPosition`); rain strengthens them. The lamps are picked by where
    the fragment is along each road, not by its block cell: cell edges run
    down the road centrelines and cut the streaks off across junctions (0.22.1). Tail lights smear red on the
    road behind cars.
  - *Car neon* (`carNeon.ts`, pure and tested): every sports car and some
    other civilian cars carry an underglow (rolled per car on create and
    recycle; never police, emergency or work vehicles), one disc glow
    under the body; at night fast cars leave tail-light trails
    (`trailLength`). `GlowSprites` holds 512 a frame.
  - *Headlights*: `CarDims.lampX` is where the model's `headlight`
    vertices sit; the cone is sized so its two lamps (`BEAM_LAMP`) land
    there, one spreading beam per lamp.
  - *Neon nights (0.23.0)*, also no new draw call:
    - *Coloured reflections* (`neonReflect.ts`, pure and tested): every
      shopfront tube, rooftop tube (in ~7 m pieces) and roof sign is listed
      once at load; each frame those in view are mirrored under the ground
      as the camera sees them (`GlowSprites.eye`, set by `Look.render`) and
      drawn as a streak in their colour toward the viewer, only where it
      lands on a road (`onRoad`). Traffic lights do the same in the colour
      they show (`WorldProps.drawGlows`). `GlowSprites` holds 640 a frame.
    - *Siren wash* (`shaderLib` `ubSirenWash`): up to four light bars near
      the view (`uSirens`, fed by `CarBatch.flush`) light buildings and the
      road on the cars' strobe, over ~20 m.
    - *String lights* (`world/stringLights.ts`, pure and tested): two
      strings on about half the road segments between arts blocks, building
      line to building line, sagging over the buses and clear of the lamps;
      wire, bulbs and halos in the city mesh's existing batches.
    - *Animated neon*: `BuildingPlan.roofNeon.sign.anim` (`NEON_ANIM`:
      steady, cycle, chase, sweep) and `chase` on some arts edge tubes,
      packed into `aGlow` as 100 × mode + brightness (`neonGlow`), read back
      in `propMaterial`.
    - *Searchlights* (`world/searchlights.ts`, pure and tested): up to six
      of downtown's tallest roofs, 110 m apart; a housing in the city mesh
      and at night a 60 m beam (`GLOW.search`) sweeping ±1.1 rad.
    - *Steam* (`world/steamVents.ts`, pure and tested; `render/steamLook.ts`):
      a grate in a lane on about a quarter of road segments; at night the
      vents in view breathe soft particles (`Effects.emitSteam`) tinted by
      district, scaled by the tier's particle budget.
  - *After hours (0.24.0)*:
    - *Living windows* (building shader): `uLate` (`sceneLighting.lateness`,
      tested: 0 until 20:00, 1 by 04:00) gives each lit window a bedtime;
      one in eight flickers cold blue (a TV); some arts flats glow pink or
      cyan.
    - *Rain*: `uRain` (now; wetness lags it) rings ripples across the
      puddles (ground shader); moving cars throw spray off their rear tyres
      on a wet road (`fxDriving`); wet cars are glossier and darker (car
      shader, not the tyres).
    - *Fireworks* (`render/fireworks.ts`, `fireworksLevel` tested): 23:30 to
      00:45, shells over the part of downtown in view, below the camera
      (`Effects.firework`), with a flash in the air and on the road.
    - *Explosions*: a crisp shockwave ring out to 21 m, and the last two
      blasts (`uBlasts`, set and faded by `Effects`) flash the walls and
      road orange-white (`ubBlastFlash`).
    - *Wanted edge glow* (`wantedHud` `.w-edge`, CSS): red and blue at the
      screen's edges, faster and stronger per star, halved while searching.
    - *WASTED / BUSTED*: the logo's gradient fill, offset neon outline and
      chromatic ghost, a VHS glitch on landing and every 4.2 s, tape
      scanlines; still with reduced motion.
  - *Sunny side (0.25.0)*, the daytime:
    - *Cloud shadows* (`shaderLib` `ubCloudShade`): drifting noise patches
      ~30-50 m multiply the base colour of ground, buildings, cars, props and
      people by day (emissive stays bright); off at night, mostly off in rain.
    - *Rooftop pools* (`BuildingPlan.roofPool`, own stream, tested): flat
      roofs downtown, residential, arts; deck, loungers and water
      (`NEON_ANIM.water`: caustics by day, underwater lights at night).
    - *Sun glints* (`ubGlint`, `uSunDir`): car paint and glass, metal roof
      panels and skylights, pool ripples; walls get none (vertical glass
      can't send a high sun up to a camera above).
    - *Street art by district*: crossings (`ground.ts` `gDistrict` from the
      block texture), roof murals (arts), logos (downtown), seven-segment bay
      numbers (docks), basketball courts. Toned down in 0.26.0: about one
      crossing in four (hashed per crossing), weathered toward white; murals
      on one flat arts roof in nine, faded; fewer, fainter logos and bay
      numbers; courts in about a fifth of parks, in muted colours.
    - *Flyovers* (`render/flyovers.ts`, path tested): a plane or blimp every
      70-140 s by day, drawn as a shadow in `ubCloudShade` from `uFlyer`.
  - *Day out (0.26.0)*:
    - *Swaying trees* (`propBatch.ts` `SWAY`): the `trees` family (made
      with `sway`, a per-family uniform, so still one program) bends
      downwind in gusts rolling across the city, quadratic in height,
      stronger in rain; green (leaf) vertices flutter. *Dappled light*: the
      family's depth pass cuts round sun flecks (0.6 m cells, some holding
      a shimmering hole, sin-free hash) on the ground followed up the
      light's ray (`DAPPLE`), so the canopy shadow keeps its outline: ~14%
      of it lit at 100%, about a third at 200% (0.30.1; before, a threshold
      on a smooth noise ate it away in blobs and, at 200%, almost whole).
    - *Park water* (`world/parkWater.ts`, tested; `render/waterLook.ts`):
      every open plaza's fountain throws a plume and eight rim arcs (soft
      particles, the hose's stretched drops, started along their flight;
      lit cyan at night), and a faint rainbow on the side away from the sun
      in the ground shader. Oscillating sprinklers on park grass (most in
      residential and old town parks), clear of trees and landmark solids,
      by day while dry, 45 s on in every 75.
    - *Morning mist* (`timeOfDay.morningMist`, tested; `shaderLib`
      `uMist`/`ubMist`): 05:00-08:15, drifting low haze on the ground
      (`ground.ts` `gMistWeight` blends the four nearest blocks' districts)
      and the bottom 5 m of walls; full in the old town and residential
      streets, a fifth elsewhere. The 06:24 fog key is hazier.
    - *Painted billboards* (`BuildingPlan.roofNeon.sign.painted`, drawn last
      on the neon stream; tested): most downtown signs. `aGlow` + 1000
      flags them; `propMaterial` paints one of four adverts by day
      (`BILLBOARD_GLSL`: stripes and roundel, a face, a logo, a sunset,
      with frame and copy) and fades to the neon at dusk. They stand 2.4 m
      (`BILLBOARD_HEIGHT`) so they read from above.
    - *Seagulls* (`systems/gulls.ts`, tested; `render/gullMesh.ts`): small
      flocks circling the water's edge on the industrial quarter's south
      and east coasts, by day; a low-poly gull built in code (white, black
      wing tips, yellow beak) whose wings bend at shoulder and wrist in the
      vertex shader (`aWing`: gliding M, beating in bouts); one draw call
      while any is in view; shadows cast down the sun's ray as contact
      shadows.
  - *HUD*: a pink-cyan-violet radar rim, violet-navy map streets, a hot
    pink health bar, a cyan healthy-car ring. *Settings → Extras → Neon
    filter* (`screenFilter`, off by default): the title's edge light and
    scanlines as a CSS layer (`mountNeonFilter`).
- **Tuning (the LOOK panel, 0.27.0).** TEST → LOOK opens a slim panel
  down one edge of live play (`ui/lookPanel.ts`; folds to a tab, ⇆ swaps
  sides): about fifty plain-named sliders in four groups (sky and light by
  part of the day, the colour grade, neon and night, daytime), a clock that
  holds at any hour (a cheat, like FREEZE; the sliders aren't), each slider's
  distance from the shipped look with a reset, RESET ALL, and EXPORT
  (downloads and copies `look.json`). The sliders are
  `render/lookTuning.ts` (pure, tested: specs, clamping, the store, the
  file); three layers: the code's constants (every slider 100% or 0°), the
  shipped `src/render/look.json` over them (bundled, canonical: only what
  differs, in panel order), and the owner's values over that in
  localStorage (`curbside.look`, applied only while Settings → Test tools is
  on). **To ship a look:** commit the exported file as `src/render/look.json`.
  `render/lookLive.ts` holds the live `look` that readers read at use time,
  and rebuilds what's made from it when a slider moves:
  - *Sky*: `timeOfDay.tuneKeys` (pure, tested) applies the sky sliders to a
    copy of KEYS, each tagged with its band (night, dawn, day, golden,
    sunset, dusk): brightness scales a band's exposure, light and fill its
    sun/moon and hemisphere, warmth/colour scale its colours' distance from
    grey, hues turn them; `sampleSky` reads the tuned keys.
  - *Grade*: the GRADE's numbers are uniforms carried in three's own
    `toneMappingExposure`, patched from a float to a `vec4[4]`
    (`post.ts` GRADE_UNIFORM: exposure, dark/bright saturation, pink mids,
    contrast, shadow and highlight tints). The renderer already uploads it
    to every tone-mapped program, the desktop output pass included, so no
    material changes and nothing recompiles. Write exposure with
    `setExposure`, never `renderer.toneMappingExposure`.
  - *World shaders*: `shaderLib` `uLook` (vec4[4], in `worldUniforms`), one
    slot per shader slider (`lookTuning` SHADER_LOOK), read through `LK_*`
    macros: neon, halos, windows, wet sheen, cloud shadow and cover, flyer
    shadows, glints, tree sway, dapple, rainbow, mist spread, street art,
    billboards. A slot holds the distance from the code's value, so a
    material that misses the uniform draws the shipped look.
  - *Everything else* is JS read each frame: lamp colour and brightness
    (`uLampColor`), headlights, underglow and trails, siren wash
    (`uSirens` strength), neon and signal reflections, searchlights, steam,
    fountains and sprinklers (drop rates), mist thickness (`uMist`), gull
    size, desktop bloom, shadow darkness, car shine.
  Sliders change strength and colour, never shape or placement (build-time
  values such as district palettes aren't on it). Check harnesses:
  `tools/look/panel.mjs` (the panel on phone and desktop) and
  `tools/look/sliders.mjs` (each slider at its ends against frame noise, and
  no program compiled while tuning).
- **Phones vs desktop.** Phones render straight to the canvas: no
  full-screen passes, glow comes from additive sprites, a CSS vignette
  frames the view. Desktops render into a half-float buffer so the 'high'
  tier can bloom (threshold follows the time of day: only real lights bloom
  by day). Cars' paint and glass alone reflect a PMREM studio environment.
  On the medium and low tiers heavy smoke is drawn at half resolution and
  composited back ([*Low-resolution smoke*](effects-and-camera.md) under [*Effects and camera*](effects-and-camera.md)).
  Bloom is left as it is: phones never bloom (no HDR pipeline), and
  desktop 'high' runs `UnrealBloomPass` from half resolution (5 mips,
  linear-sampled taps, 13 passes, ~2.2 screens written). Its bright pass is
  sanitised (`sanitizeBloomInput` in `render/post.ts`): NaN texels become 0
  and the rest are capped at `BLOOM_INPUT_MAX` (64), because the blur would
  otherwise spread one NaN or overflowed pixel into big black blocks (seen
  on desktop Chrome, 0.13.0). One source was the headlight cone in
  `glowSprites.ts`: its v interpolates a hair past 1 along the quad's far
  edge, and `pow(1 - v)` was NaN there, a 1 px black line across the road
  12.7 m ahead of a car even after the sanitising; v is clamped now.


## People

Everyone in the city is drawn from the Blender bodies in `public/assets/`
(rebuild scripts in `blender/`, contracts in `docs/BLENDER_TODO.md`):

- **Bodies, one batch each** (`render/characterBodies.ts`,
  `characterModel.ts`, `game/bodies.ts`): `player` and `player_f` (the
  player's two bodies, picked on the title screen with CHARACTER and saved
  as `settings.character`; `characters.setBody(model, kind)` moves a model
  between batches at once), the street bodies
  `ped_slim` (backpack), `ped_stocky` (ball cap) and `ped_coat` (long coat or
  dress), `cop`, and the story characters `vex`, `tuna` and `pike`. Each GLB
  is one `CharacterBatch`: one draw call plus its shadow pass, and none at
  all while nobody wearing it is on screen (people more than 8 m outside
  the visible ground are left out, so the crowd walking just off-screen
  costs nothing). Batches grow as needed. Palette slots by material suffix:
  `skin`, `hair` (the ball cap, the cop's cap crown), `shirt` (coats too),
  `pants` (the backpack, Vex's overalls), `shoes` (the cop's brim, belt and
  holster, Tuna's headphones), and a fixed-colour `badge` for later.
- **Who wears what.** The crowd is a mix of `player` / `player_f` / `ped_slim` /
  `ped_stocky` / `ped_coat` (14/14/26/24/22%) in the street palettes (caps get
  brighter colours than hair); pooled models only come back as the same
  body, dressed from scratch (nothing of their last outfit carries over;
  when the pool is full the longest-waiting model goes). Officers on foot wear `cop` in police blue with a navy cap (SWAT in
  charcoal, with SMGs). Lil' Tuna (both pick-ups) wears `tuna`; Vex waits
  at the docks yard for every delivery there; Deacon Pike guards his car in
  LAST CALL; the Collector wears Pike's coat in white. Story characters
  keep their own colours; only the friendly ones cheer.
- **Clips** (`characterAnim.ts`): the 23 clips are baked at load into
  Float32Arrays per body (each track's own 24 fps keys; anything not evenly
  keyed and linear is resampled at 30 fps) and sampled by hand with inline
  nlerp/slerp (no `AnimationMixer` per person, no three.js interpolants, no
  garbage per frame) into three layers: legs (Idle/Walk/Run on one gait phase at the
  authored `walkSpeed` / `runSpeed`), a whole-body layer (Fall, Down, GetUp / GetUpFast,
  Arrested, Cower, Cheer, EnterCar, Ride, Stagger: these move the root
  bone, so the instance is never tipped while they play) and the arms,
  chest and head (aims, shots, punches, Throw, Hail), crossfaded by weight.
  `render/peoplePose.ts` turns the simulation's state into them every
  frame, outside `main.ts`. Hit-stop freezes people with the world; a hit's
  Stagger follows the sim's countdown rising, so a card freezing the sim
  doesn't restart it. Models load through `publicUrl()` (`core/paths.ts`),
  so they work under deeek.org/curbside/.
- **Weapons in hand** (`render/heldWeapons.ts`): `weapons.glb`'s pistol,
  SMG, shotgun, grenade, molotov and launcher merged into ONE instanced
  draw call (each instance shows only its own model); each follows its
  holder's right fist, along the arm when lowered and straight ahead when
  aimed. Muzzle flashes and tracers start at the end of the barrel (the
  `muzzle` extra). Hidden in cars, while down, kneeling or just thrown.
- **Moments.** Gunfire right beside a timid bystander makes them cower
  before they run; anyone knocked down falls on their back away from the
  hit (a second knock where they lie doesn't spin them round); the player
  ducks into the driver's door before vanishing (put straight into a car
  elsewhere, as a Chaos Run does, they're simply in), rocks
  back from hits, kneels with hands on head when BUSTED, and cheers a
  passed mission or a Chaos Run medal (event `celebrate`) with any story
  character nearby; hailing fares and waiting mission characters wave.
- **Pigeons** (`systems/pigeons.ts` pure, `render/pigeonMesh.ts`): up to
  three flocks settle out of view on plazas, parks and the kerb side of
  pavements and scatter at a passing car, a runner, the player walking up,
  gunfire, blasts and horns (most come down again a little way off: *City
  life*): one instanced draw call with the `Flap` clip
  sampled into the vertex shader, a contact shadow each, none when no bird
  is in view.
- **Budget** (`?debug`, whole frame): each body on screen costs 2 calls
  (scene and shadow pass), the weapons in hand 1 and the pigeons 1 while
  any are in view; nothing for anyone off screen. iPhone profile
  ('medium'), the moments measured before this work: on foot at the spawn
  44 → 42, a fight among six people with an SMG 44 → 49, driving a busy
  street 48 → 53; the posing scenes 41–50 (two officers on foot 49–57, the
  three story bodies together 44–48). Desktop ('high'): 58 / 60 / 64 →
  63 / 67 / 69, scenes 55–70. Per frame, posing allocates nothing.
- **For other code**: `look.characters.create(outfit, body)`;
  `model.hold(weapon, aiming)`, `model.armed` (the aim pose),
  `model.arrested` / `cowering` / `riding` (Ride: put the root at the
  bike's `<arch>_seat` minus 0.75 m), `model.punch(step)`, `shoot()`,
  `throw()`, `stagger(s)` (an event) / `followStagger(s)` (a sim countdown,
  every frame), `hail(s)`, `cheer(s)`, `enterCar()` (returns its
  length), `reset()`, `hasClip(name)`, `update(dt, speed, down, downLeft)`;
  `population.addPed(agent, outfit?, body?)`; CrowdPed `gun`; bus event
  `celebrate`.
